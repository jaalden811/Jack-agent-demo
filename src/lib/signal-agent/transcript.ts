import type { IngestedTranscript, TranscriptChunk, TranscriptSentence } from "@/lib/signal-agent/types";

/**
 * Splits a transcript into speaker turns and sentences, extracts account /
 * participants when present, and preserves one sentence of context before
 * and after each sentence — per
 * matching_configuration.sentence_chunking in the Cisco mapping JSON:
 * "Split by speaker turn and sentence; preserve 1 sentence before and
 * after each candidate sentence."
 *
 * Contains no pain-point, product, or scoring logic — purely text
 * structuring, mirroring signal-agent-poc/skills/ingest_transcript.py.
 */

const ACCOUNT_LINE_RE = /^Account:\s*(.+)$/i;
const PARTICIPANTS_LINE_RE = /^Participants:\s*(.+)$/i;
const PARTICIPANT_ENTRY_RE = /([^,(]+?)\s*\(([^)]*)\)/g;
const SPEAKER_LINE_RE = /^\[([^\]]+)\]:\s*(.+)$/;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const MIN_SENTENCE_CHARS = 8;

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_CHARS);
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
  const participants: string[] = [];
  const customerNames = new Set<string>();

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
      const entryText = participantsMatch[1];
      let entryMatch: RegExpExecArray | null;
      const entryRe = new RegExp(PARTICIPANT_ENTRY_RE);
      while ((entryMatch = entryRe.exec(entryText)) !== null) {
        const name = entryMatch[1].trim();
        const role = entryMatch[2].trim();
        if (!name) continue;
        participants.push(role ? `${name} (${role})` : name);
        if (role.toLowerCase().includes("customer")) {
          customerNames.add(name);
        }
      }
    }
  }

  // Build the full ordered sentence sequence (every speaker turn), which is
  // what context-window lookups (before/after) are computed against — this
  // preserves cross-speaker context (e.g. a rep's leading question) exactly
  // as the chunking rationale in the mapping JSON calls for.
  const sentences: TranscriptSentence[] = [];
  let sawSpeakerLines = false;

  for (const line of lines) {
    const speakerMatch = line.trim().match(SPEAKER_LINE_RE);
    if (!speakerMatch) continue;
    sawSpeakerLines = true;
    const speaker = speakerMatch[1].trim();
    const utterance = speakerMatch[2].trim();
    const isCustomer = customerNames.size === 0 || customerNames.has(speaker);
    for (const sentenceText of splitSentences(utterance)) {
      sentences.push({
        index: sentences.length,
        speaker,
        isCustomer,
        text: sentenceText
      });
    }
  }

  // Freeform pasted text with no "[Speaker]:" turns at all — treat the
  // whole thing as one unattributed, customer-equivalent block instead of
  // silently dropping content, matching ingest_transcript.py's fallback.
  if (!sawSpeakerLines) {
    for (const sentenceText of splitSentences(rawText)) {
      sentences.push({
        index: sentences.length,
        speaker: null,
        isCustomer: true,
        text: sentenceText
      });
    }
  }

  const chunks: TranscriptChunk[] = sentences.map((sentence, position) => ({
    index: sentence.index,
    speaker: sentence.speaker,
    isCustomer: sentence.isCustomer,
    text: sentence.text,
    contextBefore: position > 0 ? sentences[position - 1].text : null,
    contextAfter: position < sentences.length - 1 ? sentences[position + 1].text : null
  }));

  return {
    account,
    participants,
    sentences,
    chunks,
    rawText
  };
}
