import { describe, expect, it } from "vitest";
import {
  isForwardNextStep,
  isObjectionOrSkepticism,
  isPastRecollectionOfActivity
} from "@/lib/qualification/nextStepPolarity";
import { extractGenericSignals, groupGenericSignalsByBucket } from "@/lib/qualification/genericSignalExtraction";
import type { IngestedTranscript, TranscriptChunk } from "@/lib/signal-agent/types";

// A skeptical recollection of a past workshop experience — matches a
// next-step *shape* ("...workshop...") but is really an objection.
const OBJECTION = "We've seen service maps that look impressive in a workshop and become fiction six months later.";
// A genuine, customer-requested next step (note the trailing negation is of
// a *presentation*, not of the working session itself).
const GENUINE = "I'd like a working session around two or three scenarios, not a generic platform presentation.";

function chunk(index: number, text: string): TranscriptChunk {
  return { index, speaker: "Customer", isCustomer: true, text, timestamp: null, contextBefore: null, contextAfter: null };
}

function transcriptOf(...texts: string[]): IngestedTranscript {
  return {
    account: null,
    participants: [],
    participantRecords: [],
    sentences: [],
    chunks: texts.map((t, i) => chunk(i, t)),
    rawText: texts.join("\n"),
    diagnostics: {
      raw_characters: 0,
      raw_lines: 0,
      speaker_headers_detected: 0,
      turns_parsed: 0,
      sentences_parsed: 0
    } as IngestedTranscript["diagnostics"]
  };
}

describe("next-step signal polarity", () => {
  it("treats a skeptical recollection of a past workshop as NOT a forward next step", () => {
    expect(isObjectionOrSkepticism(OBJECTION)).toBe(true);
    expect(isPastRecollectionOfActivity(OBJECTION)).toBe(true);
    expect(isForwardNextStep(OBJECTION)).toBe(false);
  });

  it("treats a customer-requested working session as a genuine forward next step", () => {
    expect(isObjectionOrSkepticism(GENUINE)).toBe(false);
    expect(isForwardNextStep(GENUINE)).toBe(true);
  });

  it("does not misread a negation of a non-activity noun as a rejected activity", () => {
    // "not a generic platform presentation" must NOT count as rejecting a workshop/pilot/session.
    expect(isObjectionOrSkepticism("Let's do a pilot, not a generic platform presentation.")).toBe(false);
  });

  it("detects an explicit rejection of the activity itself", () => {
    expect(isObjectionOrSkepticism("We do not want another workshop.")).toBe(true);
    expect(isForwardNextStep("We do not want another workshop.")).toBe(false);
  });

  it("excludes objection sentences from extracted next-step signals but keeps genuine ones", () => {
    const signals = extractGenericSignals(transcriptOf(OBJECTION, GENUINE));
    const { next_steps } = groupGenericSignalsByBucket(signals);
    const texts = next_steps.map((s) => s.text);
    expect(texts).toContain(GENUINE);
    expect(texts).not.toContain(OBJECTION);
  });
});
