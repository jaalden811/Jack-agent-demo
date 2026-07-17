import type { IngestedTranscript, ParticipantClassification, ParticipantRecord, TranscriptChunk, TranscriptDiagnostics, TranscriptSentence } from "@/lib/signal-agent/types";
import { inferSpeakerSides } from "@/lib/signal-agent/speakerSide";

/**
 * Splits a transcript into speaker turns and sentences, extracts account,
 * participant headers, and structural participant records, and preserves
 * one sentence of context before and after each sentence — per
 * matching_configuration.sentence_chunking in the Cisco mapping JSON:
 * "Split by speaker turn and sentence; preserve 1 sentence before and
 * after each candidate sentence."
 *
 * Contains no pain-point, product, or scoring logic — purely text
 * structuring, mirroring signal-agent-poc/skills/ingest_transcript.py.
 *
 * Supports every common call-transcript speaker format, not just one:
 *   [Speaker]: text                (legacy bracket format)
 *   [00:00] Speaker: text          (bracketed timestamp)
 *   00:00 — Speaker: text          (em dash timestamp)
 *   00:00 - Speaker: text          (hyphen timestamp)
 *   Speaker: text                  (plain, no timestamp)
 * plus participant header lines appearing before/within the transcript:
 *   Participants: Name (role), Name2 (role2)   (legacy one-liner)
 *   Maya Chen — Cisco Account Executive         (per-line header)
 *   Daniel Cho (Customer, Reliability Lead)      (per-line header)
 */

const ACCOUNT_LINE_RE = /^Account:\s*(.+)$/i;
const PARTICIPANTS_LINE_RE = /^Participants:\s*(.+)$/i;
const PARTICIPANT_ENTRY_RE = /([^,(]+?)\s*\(([^)]*)\)/g;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const MIN_SENTENCE_CHARS = 8;

const TIMESTAMP = "\\d{1,2}:\\d{2}(?::\\d{2})?";
const BRACKETED_TIMESTAMP_SPEAKER_RE = new RegExp(`^\\[(${TIMESTAMP})\\]\\s+([^:\\[\\]]+):\\s*(.*)$`);
// Separators are only ever treated as a speaker delimiter in the
// timestamp-header position — anchored at the very start of the line by
// a strict MM:SS/HH:MM:SS pattern, so a bare hyphen here can never be
// confused with a hyphen inside ordinary transcript prose (Section 2).
const DASH_TIMESTAMP_SPEAKER_RE = new RegExp(`^(${TIMESTAMP})\\s*[—–-]\\s*([^:]+):\\s*(.*)$`);
const LEGACY_BRACKET_SPEAKER_RE = /^\[([^\]]+)\]:\s*(.*)$/;
const PLAIN_SPEAKER_RE = /^([A-Za-z][A-Za-z0-9 .']{0,59}):\s*(.+)$/;
// No-timestamp "Name — Title" participant-header line. Deliberately
// restricted to em/en dash ONLY, always padded by whitespace on both
// sides — a bare mid-word hyphen inside an ordinary hyphenated compound
// word (of which there are unboundedly many, in any transcript, on any
// topic) must never be treated as this separator; only the
// timestamp-anchored regex above may use a plain hyphen. See
// isPlausibleSpeakerName for the additional name-shape guard that
// rejects sentence-like fragments even when the separator shape alone
// would otherwise match.
// Name tokens may contain an internal hyphen (real compound names, e.g.
// "Okafor-Lindqvist" or "Jean-Paul") — this is safe because the
// separator itself still requires a padded em/en dash, never a bare
// hyphen, so an ordinary hyphenated word in prose still can't supply
// that separator.
const HEADER_NAME_TITLE_RE = /^([A-Za-z][\w'.-]*(?:\s+[A-Za-z][\w'.-]*){0,4})\s+[—–]\s+(.+)$/;
const HEADER_NAME_PAREN_RE = /^([A-Za-z][\w'.\- ]*?)\s*\(([^)]+)\)\s*$/;

// Words that never begin a real person's name but commonly begin an
// ordinary sentence or mid-transcript continuation line — a
// dash/hyphen-anchored header regex would otherwise misfire on any
// sentence that happens to start with an article, conjunction, or verb
// and later contains an unrelated hyphenated compound word, on any
// topic, in any transcript. Checked case-insensitively against the
// first word of any header/plain-speaker candidate name.
const IMPLAUSIBLE_LEADING_NAME_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "so", "plus", "minus", "include", "includes", "including", "excludes",
  "provide", "provides", "providing", "please", "this", "that", "these", "those", "is", "are", "was", "were",
  "will", "would", "could", "should", "shall", "can", "cannot", "must", "has", "have", "had", "do", "does",
  "did", "we", "you", "they", "it", "if", "because", "since", "while", "when", "then", "also", "our", "your",
  "their", "its", "not", "no", "yes", "there", "here", "what", "which", "who", "how", "why", "next", "let",
  "let's", "here's", "there's", "it's", "we're", "for", "with", "without", "about", "across", "over", "under",
  "between", "during", "before", "after", "once", "each", "every", "some", "any", "all", "both", "few", "more",
  "most", "other", "such", "only", "just", "than", "too", "very", "so's"
]);

// Lowercase particles that legitimately appear inside real personal names
// (e.g. "Juan de la Cruz", "Ludwig van der Rohe"). Interior words outside
// this set that are lowercase mark a 3+-word label as a non-name annotation.
const NAME_PARTICLES = new Set([
  "de", "del", "della", "van", "von", "der", "den", "la", "le", "du", "da", "di",
  "dos", "das", "bin", "al", "ibn", "san", "st", "mac", "mc", "o", "y", "e", "ter", "ten"
]);

/** Speaker/header-name plausibility guard (Section 2 "Speaker
 * validation"): 1-80 characters, letters/spaces/apostrophes/periods/
 * internal hyphens only (so real compound names like "Okafor-Lindqvist"
 * or "Jean-Paul" are never rejected), no more than 5 space-separated
 * words, and never starting with an ordinary sentence-continuation
 * word. This is what actually prevents an ordinary sentence fragment
 * from ever becoming a fabricated participant — the separator-shape
 * regexes (which require a padded em/en dash, never a bare mid-word
 * hyphen) are the primary defense; this is a second, independent one. */
export function isPlausibleSpeakerName(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return false;
  if (!/^[A-Za-z][A-Za-z\s'.-]*$/.test(trimmed)) return false;
  if (trimmed.includes("--") || trimmed.startsWith("-") || trimmed.endsWith("-")) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  // Check every hyphen-joined sub-token too (e.g. a compound word split
  // on its internal hyphen into two halves), not just space-separated
  // words — a fragment whose first half is an ordinary
  // sentence-continuation word should still be rejected even when the
  // whole token contains an internal hyphen.
  for (const word of words) {
    const subTokens = word.split("-");
    if (IMPLAUSIBLE_LEADING_NAME_WORDS.has(subTokens[0].toLowerCase())) return false;
  }
  // Multi-word (3+) labels that are actually annotations/artifacts rather
  // than personal names — e.g. "System note appended by organizer",
  // "Recording started automatically" — carry ordinary lowercase interior
  // words. A real 3+-word personal name is title-cased (interior words are
  // capitalized) except for short name particles (de, van, der, …). This
  // is a generic shape check, never a scenario/name/word allow-list.
  if (words.length >= 3) {
    for (let i = 1; i < words.length; i += 1) {
      const first = words[i][0];
      if (first === first.toLowerCase() && first !== first.toUpperCase() && !NAME_PARTICLES.has(words[i].toLowerCase())) {
        return false;
      }
    }
  }
  return true;
}

// Header/label lines that must never be mistaken for a speaker name or a
// participant header, however they're formatted. Two families: (1) meeting
// metadata labels ("Account:", "Date:"), and (2) common single-word discourse
// markers / sentence adverbs that frequently precede a colon mid-utterance
// ("Tentatively: indicator, first-seen time, …", "Correction: …") — these are
// continuations of the open turn, never a new speaker. Generic English
// discourse vocabulary, never a scenario/name list.
const NON_SPEAKER_KEYS = new Set([
  // Meeting-metadata labels.
  "account",
  "participants",
  "attendees",
  "topic",
  "date",
  "meeting",
  "subject",
  "title",
  "time",
  "duration",
  "location",
  "agenda",
  "call",
  // Discourse markers / sentence adverbs.
  "tentatively",
  "correction",
  "corrections",
  "clarification",
  "understood",
  "agreed",
  "exactly",
  "correct",
  "incorrect",
  "possibly",
  "maybe",
  "actually",
  "honestly",
  "frankly",
  "note",
  "notes",
  "warning",
  "caveat",
  "aside",
  "example",
  "summary",
  "reminder",
  "recap",
  "context",
  "background",
  "update",
  "conclusion",
  "translation",
  "translated",
  "additionally",
  "similarly",
  "however",
  "meanwhile",
  "otherwise",
  "regardless",
  "importantly",
  "notably",
  "specifically",
  "finally",
  "fyi"
]);

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_CHARS);
}

type DialogueLine = { timestamp: string | null; speaker: string; text: string };

/** Detects the two timestamp-anchored speaker-header formats — these are
 * unambiguous (a line can only match if it literally begins with a
 * MM:SS/HH:MM:SS timestamp), so their presence tells us the transcript
 * uses an explicit per-turn header format. */
function hasTimestampedHeader(line: string): boolean {
  return BRACKETED_TIMESTAMP_SPEAKER_RE.test(line) || DASH_TIMESTAMP_SPEAKER_RE.test(line);
}

function parseDialogueLine(line: string, options: { allowPlainSpeaker: boolean }): DialogueLine | null {
  let match = line.match(BRACKETED_TIMESTAMP_SPEAKER_RE);
  if (match && isPlausibleSpeakerName(match[2])) return { timestamp: match[1], speaker: match[2].trim(), text: match[3].trim() };

  match = line.match(DASH_TIMESTAMP_SPEAKER_RE);
  if (match && isPlausibleSpeakerName(match[2])) return { timestamp: match[1], speaker: match[2].trim(), text: match[3].trim() };

  match = line.match(LEGACY_BRACKET_SPEAKER_RE);
  if (match && isPlausibleSpeakerName(match[1])) return { timestamp: null, speaker: match[1].trim(), text: match[2].trim() };

  // The bare, untimestamped "Name: text" pattern is only trusted as a
  // speaker header when the transcript does NOT otherwise use an
  // explicit timestamped/bracketed header format. Real transcripts use
  // one consistent speaker-label format; once timestamped headers are
  // present, an ordinary sentence that merely happens to contain a
  // leading "Something: ..." clause (e.g. "Three answers: what is
  // affected, ...") is a continuation of the open turn, never a new
  // speaker — this is what prevents such a sentence from fabricating a
  // participant, generically, on any topic.
  if (options.allowPlainSpeaker) {
    match = line.match(PLAIN_SPEAKER_RE);
    if (match) {
      const key = match[1].trim().toLowerCase();
      if (NON_SPEAKER_KEYS.has(key)) return null;
      if (!isPlausibleSpeakerName(match[1])) return null;
      return { timestamp: null, speaker: match[1].trim(), text: match[2].trim() };
    }
  }

  return null;
}

type HeaderLine = { name: string; descriptor: string };
/** `null` when the line doesn't even resemble a header; a HeaderLine on
 * a genuine match; or the raw candidate name string when the line
 * matched the separator shape but failed speaker-name plausibility —
 * surfaced via `transcript_diagnostics.rejected_header_candidates`
 * rather than silently becoming a fabricated participant. */
type HeaderLineOutcome = { kind: "header"; value: HeaderLine } | { kind: "rejected"; candidate: string } | null;

function parseHeaderLine(line: string): HeaderLineOutcome {
  let match = line.match(HEADER_NAME_PAREN_RE);
  if (match) {
    const key = match[1].trim().toLowerCase();
    if (NON_SPEAKER_KEYS.has(key)) return null;
    if (!isPlausibleSpeakerName(match[1])) return { kind: "rejected", candidate: match[1].trim() };
    return { kind: "header", value: { name: match[1].trim(), descriptor: match[2].trim() } };
  }

  match = line.match(HEADER_NAME_TITLE_RE);
  if (match) {
    const key = match[1].trim().toLowerCase();
    if (NON_SPEAKER_KEYS.has(key)) return null;
    if (match[2].length > 80) return null; // implausibly long "title" — not a header line
    if (!isPlausibleSpeakerName(match[1])) return { kind: "rejected", candidate: match[1].trim() };
    return { kind: "header", value: { name: match[1].trim(), descriptor: match[2].trim() } };
  }

  return null;
}

function classifyDescriptor(
  descriptor: string,
  defaultWhenAmbiguous: ParticipantClassification
): { title: string | null; organization: string | null; classification: ParticipantClassification } {
  if (/\bcisco\b/i.test(descriptor)) {
    const title = descriptor.replace(/\bcisco\b/gi, "").replace(/^[,\s-]+|[,\s-]+$/g, "").trim() || null;
    return { title, organization: "Cisco", classification: "vendor" };
  }
  // An explicit "customer" tag is checked before the generic vendor/
  // partner keywords, since a customer-side title can itself mention
  // "vendor" (e.g. "Vendor Management") without that making the person
  // a vendor-side participant.
  if (/\bcustomer\b/i.test(descriptor)) {
    const title = descriptor.replace(/customer,?\s*/i, "").trim() || null;
    return { title, organization: null, classification: "customer" };
  }
  if (/^\s*(vendor|partner)\b/i.test(descriptor)) {
    const title = descriptor.replace(/^\s*(vendor|partner),?\s*/i, "").trim() || null;
    return { title, organization: null, classification: "vendor" };
  }
  return { title: descriptor.trim() || null, organization: null, classification: defaultWhenAmbiguous };
}

/** The subset of chunks treated as "candidate pain language" for matching
 * — customer-attributed chunks when a Customer role was tagged, otherwise
 * every chunk (freeform paste / untagged transcript), so nothing is
 * silently dropped. Shared by keywordMatch.ts and semanticMatch.ts so both
 * always operate on the exact same, consistently ordered chunk set. */
export function selectRelevantChunks(transcript: IngestedTranscript): TranscriptChunk[] {
  const customerChunks = transcript.chunks.filter((chunk) => chunk.isCustomer);
  return customerChunks.length > 0 ? customerChunks : transcript.chunks;
}

/**
 * Normalizes a transcript that was pasted as (nearly) ONE line with no
 * speaker newlines — e.g. "Rachel: ... Jordan: ... Maya: ..." — by inserting
 * a newline before each recurring inline "Speaker:" label so the line-anchored
 * parser recovers real turns (instead of one giant turn → "Participants: 1").
 * Conservative: only fires when there are far fewer newlines than distinct
 * inline speakers, so normally-formatted transcripts are untouched.
 */
export function normalizeInlineSpeakers(rawText: string): string {
  const inlineSpeakerRe = /(^|\s)([A-Z][a-z]+(?:\s[A-Z][a-z]+)?):\s/g;
  const matches = [...rawText.matchAll(inlineSpeakerRe)];
  const distinct = new Set(matches.map((m) => m[2].trim().toLowerCase()).filter((n) => !NON_SPEAKER_KEYS.has(n.split(/\s+/)[0])));
  const newlineCount = (rawText.match(/\n/g) ?? []).length;
  if (matches.length < 4 || distinct.size < 2 || newlineCount >= distinct.size) return rawText;
  return rawText.replace(inlineSpeakerRe, (full, pre: string, name: string) => {
    if (NON_SPEAKER_KEYS.has(name.trim().toLowerCase().split(/\s+/)[0])) return full;
    return `${pre && pre.length ? "\n" : ""}${name}: `;
  });
}

export function ingestTranscript(rawText: string): IngestedTranscript {
  const lines = normalizeInlineSpeakers(rawText).split(/\r?\n/);

  let account: string | null = null;
  const recordsByKey = new Map<string, ParticipantRecord>();
  const orderedKeys: string[] = [];

  // Fuzzy-matches a bare first name used in dialogue turns (e.g.
  // "Maya:") to a fuller name already known from a header/participant
  // line (e.g. "Maya Chen — Cisco Account Executive"), and vice versa,
  // so the same person's turns are never split into two participant
  // records just because one format uses a short name.
  function ensureRecord(name: string): ParticipantRecord {
    const trimmedName = name.trim();
    const key = trimmedName.toLowerCase();
    const existing = recordsByKey.get(key);
    if (existing) return existing;

    if (!trimmedName.includes(" ")) {
      const matches = orderedKeys.filter((k) => k.startsWith(`${key} `));
      if (matches.length === 1) return recordsByKey.get(matches[0])!;
    } else {
      const firstWord = key.split(/\s+/)[0];
      const shortRecord = recordsByKey.get(firstWord);
      if (shortRecord && !shortRecord.name.includes(" ")) {
        shortRecord.name = trimmedName;
        recordsByKey.delete(firstWord);
        recordsByKey.set(key, shortRecord);
        const index = orderedKeys.indexOf(firstWord);
        if (index !== -1) orderedKeys[index] = key;
        return shortRecord;
      }
    }

    const record: ParticipantRecord = {
      name: trimmedName,
      title: null,
      organization: null,
      classification: "unknown",
      turnCount: 0,
      firstEvidenceIndex: null,
      lastEvidenceIndex: null
    };
    recordsByKey.set(key, record);
    orderedKeys.push(key);
    return record;
  }

  // Pass 1 — "Account:" line and the legacy "Participants: Name (role), ..."
  // one-liner. Untagged participants here default to "internal" (not
  // customer) — this format's convention is explicit customer tagging, so
  // an untagged entry is assumed to be the vendor/internal side.
  for (const line of lines) {
    const trimmed = line.trim();

    if (account === null) {
      const accountMatch = trimmed.match(ACCOUNT_LINE_RE);
      if (accountMatch) {
        account = accountMatch[1].trim() || null;
        continue;
      }
    }

    const participantsMatch = trimmed.match(PARTICIPANTS_LINE_RE);
    if (participantsMatch) {
      const entryRe = new RegExp(PARTICIPANT_ENTRY_RE);
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRe.exec(participantsMatch[1])) !== null) {
        const name = entryMatch[1].trim();
        const roleText = entryMatch[2].trim();
        if (!name) continue;
        const record = ensureRecord(name);
        const { title, organization, classification } = classifyDescriptor(roleText, "internal");
        record.title = title;
        record.organization = organization;
        record.classification = classification;
      }
    }
  }

  // Pass 2 — one single ordered walk that both (a) recognizes standalone
  // participant header lines ("Maya Chen — Cisco Account Executive" /
  // "Daniel Cho (Reliability Lead)") and (b) builds each dialogue turn
  // by accumulating every subsequent line into the currently open
  // speaker's turn until the next recognized speaker header — so a
  // real transcript's wrapped/multi-line turns are never silently
  // dropped (previously only the first line of a multi-line turn ever
  // reached scoring). A header line always closes any open turn (it is
  // metadata, never dialogue content); a line matching neither pattern
  // is a continuation of the open turn, or — if no turn is open yet —
  // an orphan line that is recorded for diagnostics but never
  // fabricates a participant.
  // A transcript that uses explicit timestamped/bracketed headers for
  // any turn is treated as using that format throughout — so the bare
  // "Name: text" fallback is disabled, and a sentence with a leading
  // "clause: ..." can never be mistaken for a new speaker turn.
  const usesTimestampedHeaders = lines.some((line) => hasTimestampedHeader(line.trim()));
  const allowPlainSpeaker = !usesTimestampedHeaders;

  let headersDetected = 0;
  const rejectedHeaderCandidates: string[] = [];
  const turns: Array<{ record: ParticipantRecord; timestamp: string | null; textParts: string[] }> = [];
  let openTurn: { record: ParticipantRecord; timestamp: string | null; textParts: string[] } | null = null;

  function closeOpenTurn() {
    if (openTurn) {
      turns.push(openTurn);
      openTurn = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue; // blank lines never close or start a turn — real transcripts wrap paragraphs across blank lines
    if (ACCOUNT_LINE_RE.test(trimmed) || PARTICIPANTS_LINE_RE.test(trimmed)) continue; // already consumed in Pass 1

    const dialogue = parseDialogueLine(trimmed, { allowPlainSpeaker });
    if (dialogue) {
      closeOpenTurn();
      headersDetected += 1;
      const record = ensureRecord(dialogue.speaker);
      record.turnCount += 1;
      openTurn = { record, timestamp: dialogue.timestamp, textParts: dialogue.text ? [dialogue.text] : [] };
      continue;
    }

    const header = parseHeaderLine(trimmed);
    if (header?.kind === "rejected") {
      rejectedHeaderCandidates.push(header.candidate);
      // Falls through to continuation handling below — a rejected
      // header candidate is still real transcript content and must
      // not be dropped.
    } else if (header?.kind === "header") {
      closeOpenTurn(); // a genuine header line is metadata, not dialogue continuation
      const record = ensureRecord(header.value.name);
      if (record.classification === "unknown") {
        const { title, organization, classification } = classifyDescriptor(header.value.descriptor, "customer");
        record.title = title;
        record.organization = organization;
        record.classification = classification;
      }
      continue;
    }

    // Continuation of the currently open speaker turn (the normal case
    // for a wrapped/multi-line turn), or an orphan line with no open
    // turn yet (e.g. free text before the first recognized speaker).
    if (openTurn) {
      openTurn.textParts.push(trimmed);
    }
  }
  closeOpenTurn();

  // Pass 3 — split every accumulated turn's full text into sentences.
  // Builds the full ordered sentence sequence (what context-window
  // lookups are computed against) and each participant's first/last
  // evidence index.
  const sentences: TranscriptSentence[] = [];
  const sentenceRecords: Array<ParticipantRecord | null> = [];
  const sawSpeakerLines = turns.length > 0;

  for (const turn of turns) {
    const fullText = turn.textParts.join(" ").replace(/\s+/g, " ").trim();
    if (!fullText) continue;

    for (const sentenceText of splitSentences(fullText)) {
      const sentenceIndex = sentences.length;
      if (turn.record.firstEvidenceIndex === null) turn.record.firstEvidenceIndex = sentenceIndex;
      turn.record.lastEvidenceIndex = sentenceIndex;
      sentences.push({
        index: sentenceIndex,
        speaker: turn.record.name,
        isCustomer: false, // resolved below, once every record's classification is final
        text: sentenceText,
        timestamp: turn.timestamp
      });
      sentenceRecords.push(turn.record);
    }
  }

  // Resolve any remaining "unknown" classifications (a name that only
  // ever appeared as a bare dialogue speaker, with no header/legacy tag).
  // If some participants were explicitly tagged customer, an untagged one
  // defaults to internal. If NOBODY was tagged, sellers would otherwise
  // all default to customer and pollute customer intent / the buying
  // committee — so first run deterministic, behavior-based speaker-side
  // inference (Section 9) to separate vendor-side speakers from
  // customer-side ones; anyone not confidently vendor stays customer
  // (freeform-paste assumption — never silently drop evidence).
  const anyExplicitCustomerTag = Array.from(recordsByKey.values()).some((record) => record.classification === "customer");
  if (!anyExplicitCustomerTag) {
    const turnsByRecordName = new Map<string, string[]>();
    sentences.forEach((sentence, index) => {
      const record = sentenceRecords[index];
      if (!record || record.classification !== "unknown") return;
      const list = turnsByRecordName.get(record.name) ?? [];
      list.push(sentence.text);
      turnsByRecordName.set(record.name, list);
    });
    const sideByName = inferSpeakerSides(turnsByRecordName);
    for (const record of recordsByKey.values()) {
      if (record.classification !== "unknown") continue;
      record.classification = sideByName.get(record.name)?.side === "vendor" ? "vendor" : "customer";
    }
  } else {
    for (const record of recordsByKey.values()) {
      if (record.classification === "unknown") record.classification = "internal";
    }
  }

  sentences.forEach((sentence, index) => {
    const record = sentenceRecords[index];
    sentence.isCustomer = record ? record.classification === "customer" : true;
  });

  // Freeform pasted text with no recognized speaker turns at all — treat
  // the whole thing as one unattributed, customer-equivalent block
  // instead of silently dropping content, matching ingest_transcript.py's
  // fallback.
  if (!sawSpeakerLines) {
    for (const sentenceText of splitSentences(rawText)) {
      sentences.push({
        index: sentences.length,
        speaker: null,
        isCustomer: true,
        text: sentenceText,
        timestamp: null
      });
    }
  }

  const chunks: TranscriptChunk[] = sentences.map((sentence, position) => ({
    index: sentence.index,
    speaker: sentence.speaker,
    isCustomer: sentence.isCustomer,
    text: sentence.text,
    timestamp: sentence.timestamp,
    contextBefore: position > 0 ? sentences[position - 1].text : null,
    contextAfter: position < sentences.length - 1 ? sentences[position + 1].text : null
  }));

  const participantRecords = orderedKeys.map((key) => recordsByKey.get(key)!);
  const participants = participantRecords.map((record) => (record.title ? `${record.name} (${record.title})` : record.name));

  const diagnostics: TranscriptDiagnostics = {
    raw_characters: rawText.length,
    raw_lines: lines.length,
    speaker_headers_detected: headersDetected,
    turns_parsed: turns.length,
    sentences_parsed: sentences.length,
    participants: participantRecords.map((record) => record.name),
    rejected_header_candidates: rejectedHeaderCandidates
  };

  return {
    account,
    participants,
    participantRecords,
    sentences,
    chunks,
    rawText,
    diagnostics
  };
}
