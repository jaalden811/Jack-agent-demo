import { readFileSync } from "node:fs";
import path from "node:path";
import { isInterrogative } from "@/lib/signal-agent/speechAct";

/**
 * Deterministic speaker-side inference (Section 9). When a transcript
 * carries no explicit customer/vendor role tags, sellers would otherwise
 * default to "customer" and their discovery questions / product proposals
 * would pollute customer intent, the buying committee, and MEDDPICC.
 *
 * This infers the side of each speaker from generic *behavioral* cues
 * loaded from configuration — seller behavior (proposing to show/
 * demonstrate, promising follow-up material, mapping capabilities to the
 * buyer, heavy discovery questioning) versus customer behavior (owning an
 * environment/budget/team, stating internal pain/constraints). No speaker
 * name, company, or product is referenced. There is a safe fallback: when
 * evidence is weak or contradictory the speaker is left as-is (customer),
 * so no one is silently dropped.
 */

export type SpeakerSide = "customer" | "vendor" | "unknown";

type WeightedPattern = { pattern: string; weight: number };
type SpeakerSideConfig = {
  seller_indicators: WeightedPattern[];
  customer_indicators: WeightedPattern[];
  rules: {
    question_seller_weight: number;
    min_turns: number;
    min_seller_lexical_score: number;
    vendor_margin: number;
  };
};

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/speaker_side_signals.json";
let cachedConfig: (SpeakerSideConfig & { _seller: RegExp[]; _customer: RegExp[] }) | null = null;

export function clearSpeakerSideConfigCache(): void {
  cachedConfig = null;
}

function loadConfig(): SpeakerSideConfig & { _seller: RegExp[]; _customer: RegExp[] } {
  if (cachedConfig) return cachedConfig;
  const text = readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8");
  const parsed = JSON.parse(text) as SpeakerSideConfig;
  cachedConfig = {
    ...parsed,
    _seller: parsed.seller_indicators.map((p) => new RegExp(p.pattern, "i")),
    _customer: parsed.customer_indicators.map((p) => new RegExp(p.pattern, "i"))
  };
  return cachedConfig;
}

export type SpeakerSideInference = {
  side: SpeakerSide;
  seller_score: number;
  customer_score: number;
  evidence: string[];
};

/** Infers one speaker's side from the text of their turns. */
export function inferSpeakerSide(turns: string[]): SpeakerSideInference {
  const config = loadConfig();
  const evidence: string[] = [];
  let sellerLexical = 0;
  let customerScore = 0;
  let questionCount = 0;

  for (const turn of turns) {
    for (let i = 0; i < config._seller.length; i += 1) {
      if (config._seller[i].test(turn)) {
        sellerLexical += config.seller_indicators[i].weight;
        evidence.push(`seller: ${config.seller_indicators[i].pattern}`);
      }
    }
    for (let i = 0; i < config._customer.length; i += 1) {
      if (config._customer[i].test(turn)) {
        customerScore += config.customer_indicators[i].weight;
        evidence.push(`customer: ${config.customer_indicators[i].pattern}`);
      }
    }
    if (isInterrogative(turn)) questionCount += 1;
  }

  // Questions are only a weak tie-breaker layered on top of explicit
  // seller lexical evidence — a curious customer who asks questions but
  // uses no seller language is never reclassified as a vendor.
  const sellerScore = sellerLexical + questionCount * config.rules.question_seller_weight;

  let side: SpeakerSide = "unknown";
  if (turns.length >= config.rules.min_turns && sellerLexical >= config.rules.min_seller_lexical_score && sellerScore - customerScore >= config.rules.vendor_margin) {
    side = "vendor";
  } else if (customerScore > 0) {
    side = "customer";
  }

  return {
    side,
    seller_score: Math.round(sellerScore * 100) / 100,
    customer_score: Math.round(customerScore * 100) / 100,
    evidence: Array.from(new Set(evidence))
  };
}

/** Infers the side of every speaker from their grouped turns. Returns a
 * map keyed by the exact speaker name provided. */
export function inferSpeakerSides(turnsBySpeaker: Map<string, string[]>): Map<string, SpeakerSideInference> {
  const out = new Map<string, SpeakerSideInference>();
  for (const [speaker, turns] of turnsBySpeaker.entries()) {
    out.set(speaker, inferSpeakerSide(turns));
  }
  return out;
}
