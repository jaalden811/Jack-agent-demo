import type { IngestedTranscript, ParticipantClassification, ParticipantRecord, TranscriptChunk, TranscriptSentence } from "@/lib/signal-agent/types";

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
const BRACKETED_TIMESTAMP_SPEAKER_RE = new RegExp(`^\\[(${TIMESTAMP})\\]\\s+([^:\\[\\]]+):\\s*(.+)$`);
const DASH_TIMESTAMP_SPEAKER_RE = new RegExp(`^(${TIMESTAMP})\\s*[—–-]\\s*([^:]+):\\s*(.+)$`);
const LEGACY_BRACKET_SPEAKER_RE = /^\[([^\]]+)\]:\s*(.+)$/;
const PLAIN_SPEAKER_RE = /^([A-Za-z][A-Za-z0-9 .'-]{1,60}):\s*(.+)$/;
const HEADER_NAME_TITLE_RE = /^([A-Za-z][\w'.]*(?:\s+[A-Za-z][\w'.]*){0,4})\s*[—–-]\s*(.+)$/;
const HEADER_NAME_PAREN_RE = /^([A-Za-z][\w'. ]*?)\s*\(([^)]+)\)\s*$/;

// Header/label lines that must never be mistaken for a speaker name or a
// participant header, however they're formatted.
const NON_SPEAKER_KEYS = new Set([
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
  "call"
]);

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_CHARS);
}

type DialogueLine = { timestamp: string | null; speaker: string; text: string };

function parseDialogueLine(line: string): DialogueLine | null {
  let match = line.match(BRACKETED_TIMESTAMP_SPEAKER_RE);
  if (match) return { timestamp: match[1], speaker: match[2].trim(), text: match[3].trim() };

  match = line.match(DASH_TIMESTAMP_SPEAKER_RE);
  if (match) return { timestamp: match[1], speaker: match[2].trim(), text: match[3].trim() };

  match = line.match(LEGACY_BRACKET_SPEAKER_RE);
  if (match) return { timestamp: null, speaker: match[1].trim(), text: match[2].trim() };

  match = line.match(PLAIN_SPEAKER_RE);
  if (match) {
    const key = match[1].trim().toLowerCase();
    if (NON_SPEAKER_KEYS.has(key)) return null;
    return { timestamp: null, speaker: match[1].trim(), text: match[2].trim() };
  }

  return null;
}

type HeaderLine = { name: string; descriptor: string };

function parseHeaderLine(line: string): HeaderLine | null {
  let match = line.match(HEADER_NAME_PAREN_RE);
  if (match) {
    const key = match[1].trim().toLowerCase();
    if (NON_SPEAKER_KEYS.has(key)) return null;
    return { name: match[1].trim(), descriptor: match[2].trim() };
  }

  match = line.match(HEADER_NAME_TITLE_RE);
  if (match) {
    const key = match[1].trim().toLowerCase();
    if (NON_SPEAKER_KEYS.has(key)) return null;
    if (match[2].length > 80) return null; // implausibly long "title" — not a header line
    return { name: match[1].trim(), descriptor: match[2].trim() };
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

export function ingestTranscript(rawText: string): IngestedTranscript {
  const lines = rawText.split(/\r?\n/);

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

  // Pass 2 — standalone participant header lines ("Maya Chen — Cisco
  // Account Executive" / "Daniel Cho (Reliability Lead)") that are not
  // themselves a dialogue turn. This format has no tagging convention, so
  // an ambiguous (non-Cisco/vendor) descriptor defaults to "customer".
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || parseDialogueLine(trimmed)) continue;
    const header = parseHeaderLine(trimmed);
    if (!header) continue;
    const record = ensureRecord(header.name);
    if (record.classification !== "unknown") continue; // don't override an explicit legacy tag
    const { title, organization, classification } = classifyDescriptor(header.descriptor, "customer");
    record.title = title;
    record.organization = organization;
    record.classification = classification;
  }

  // Pass 3 — every recognized dialogue turn, across every supported
  // format. Builds the full ordered sentence sequence (what context-
  // window lookups are computed against) and each participant's turn
  // count and first/last evidence index.
  const sentences: TranscriptSentence[] = [];
  const sentenceRecords: Array<ParticipantRecord | null> = [];
  let sawSpeakerLines = false;

  for (const line of lines) {
    const dialogue = parseDialogueLine(line.trim());
    if (!dialogue || !dialogue.text) continue;
    sawSpeakerLines = true;

    const record = ensureRecord(dialogue.speaker);
    record.turnCount += 1;

    for (const sentenceText of splitSentences(dialogue.text)) {
      const sentenceIndex = sentences.length;
      if (record.firstEvidenceIndex === null) record.firstEvidenceIndex = sentenceIndex;
      record.lastEvidenceIndex = sentenceIndex;
      sentences.push({
        index: sentenceIndex,
        speaker: record.name,
        isCustomer: false, // resolved below, once every record's classification is final
        text: sentenceText,
        timestamp: dialogue.timestamp
      });
      sentenceRecords.push(record);
    }
  }

  // Resolve any remaining "unknown" classifications (a name that only
  // ever appeared as a bare dialogue speaker, with no header/legacy tag)
  // the same way the legacy parser did: if some participants were
  // explicitly tagged customer, an untagged one defaults to internal;
  // if nobody was tagged, everyone defaults to customer (freeform-paste
  // assumption — never silently drop evidence).
  const anyExplicitCustomerTag = Array.from(recordsByKey.values()).some((record) => record.classification === "customer");
  for (const record of recordsByKey.values()) {
    if (record.classification === "unknown") {
      record.classification = anyExplicitCustomerTag ? "internal" : "customer";
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

  return {
    account,
    participants,
    participantRecords,
    sentences,
    chunks,
    rawText
  };
}
