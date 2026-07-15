import { z } from "zod";
import { runStage } from "@/lib/circuit/stages/stageRunner";
import { invalidUrls } from "@/lib/circuit/stages/evidenceValidator";
import type { StageDefinition, StageResult } from "@/lib/circuit/stages/types";

/**
 * Stage B — SerpAPI public-evidence classification (Phase 3). Circuit
 * classifies ONLY the normalized SerpAPI sources supplied in the input:
 * entity match, authority, transcript relevance, signal category, the
 * public fact, its implication + limitation, and the three eligibility
 * levels (account-context / narrative / scoring). Circuit may NOT invent a
 * URL, a title, or any private deal fact. The deterministic classification
 * (supplied on the input) is the fallback.
 */

const score01 = z.preprocess((v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
}, z.number().min(0).max(1));

const strList = z.preprocess((v) => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
  if (v === null || v === undefined) return [];
  return v;
}, z.array(z.string()));

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

const classifiedSource = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      source_id: pick(o, ["source_id", "id", "sourceId"]) ?? "",
      entity_match: pick(o, ["entity_match", "entityMatch"]) ?? 0,
      source_authority: pick(o, ["source_authority", "authority", "sourceAuthority"]) ?? 0,
      transcript_relevance: pick(o, ["transcript_relevance", "relevance", "transcriptRelevance"]) ?? 0,
      signal_category: pick(o, ["signal_category", "category"]) ?? "unknown",
      public_fact: pick(o, ["public_fact", "fact", "claim"]) ?? "",
      implication: pick(o, ["implication"]) ?? "",
      limitation: pick(o, ["limitation"]) ?? "",
      account_context_eligible: pick(o, ["account_context_eligible", "accountContextEligible"]) ?? false,
      narrative_eligible: pick(o, ["narrative_eligible", "narrativeEligible"]) ?? false,
      scoring_eligible: pick(o, ["scoring_eligible", "scoringEligible"]) ?? false,
      supports: pick(o, ["supports"]) ?? [],
      contradicts: pick(o, ["contradicts"]) ?? [],
      evidence_ids: pick(o, ["evidence_ids", "evidence", "evidence_id"]) ?? []
    };
  }
  return v;
}, z.object({
  source_id: z.string().min(1),
  entity_match: score01,
  source_authority: score01,
  transcript_relevance: score01,
  signal_category: z.string(),
  public_fact: z.string(),
  implication: z.string(),
  limitation: z.string(),
  account_context_eligible: z.boolean(),
  narrative_eligible: z.boolean(),
  scoring_eligible: z.boolean(),
  supports: strList,
  contradicts: strList,
  evidence_ids: strList
}));

const distilledSignal = z.object({
  claim: z.string(),
  category: z.string(),
  strength: z.string(),
  primary_source_id: z.string(),
  corroborating_source_ids: strList,
  implication: z.string(),
  limitation: z.string()
}).partial({ implication: true, limitation: true, corroborating_source_ids: true });

const rejectedSource = z.preprocess((v) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { source_id: pick(o, ["source_id", "id"]) ?? "", reason: pick(o, ["reason", "rejection_reason"]) ?? "" };
  }
  return v;
}, z.object({ source_id: z.string().min(1), reason: z.string() }));

export const stageBSchema = z.object({
  classified_sources: z.array(classifiedSource),
  distilled_signals: z.array(distilledSignal),
  rejected_sources: z.array(rejectedSource)
});

export type StageBOutput = z.infer<typeof stageBSchema>;

export type StageBSource = {
  source_id: string;
  query_id?: string;
  query_purpose?: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published_at?: string | null;
  account_candidate?: string | null;
  transcript_themes?: string[];
  source_authority?: number;
};

export type StageBInput = {
  run_id: string;
  account: string | null;
  sources: StageBSource[];
  deterministic: StageBOutput;
};

export function allowedStageBSourceIds(input: StageBInput): Set<string> {
  return new Set(input.sources.map((s) => s.source_id));
}
export function allowedStageBUrls(input: StageBInput): Set<string> {
  return new Set(input.sources.map((s) => s.url).filter(Boolean));
}

function referencedSourceIds(output: StageBOutput): string[] {
  const ids: string[] = [];
  for (const c of output.classified_sources) ids.push(c.source_id);
  for (const d of output.distilled_signals) {
    ids.push(d.primary_source_id);
    ids.push(...(d.corroborating_source_ids ?? []));
  }
  for (const r of output.rejected_sources) ids.push(r.source_id);
  return ids.filter(Boolean);
}

const stageBDefinition: StageDefinition<StageBInput, StageBOutput> = {
  stage: "B",
  schema: stageBSchema,
  buildPrompt: (input) => {
    const payload = {
      run_context: { run_id: input.run_id, account: input.account },
      public_evidence: input.sources,
      task:
        "STAGE B — classify ONLY the supplied SerpAPI sources. For each source set entity_match, source_authority, transcript_relevance (all 0..1), signal_category, the public_fact, its implication and limitation, and the three eligibility flags: account_context_eligible (credible + correct company, even if opportunity relevance is 0), narrative_eligible (account-context + real transcript relevance + credible + direct claim), scoring_eligible (narrative + strong/supporting + no contradiction). Public evidence may confirm public company identity/domain/strategy/leadership but NEVER private budget, opportunity stage, renewal, procurement, Economic Buyer, Champion, or private install base. Do NOT invent a URL, title, or source_id — reference ONLY the supplied source_ids and URLs. Cluster duplicates into distilled_signals; put unusable sources in rejected_sources with a reason. Return ONE JSON object with EXACTLY these keys and item shapes: " +
        JSON.stringify({
          classified_sources: [{ source_id: "string", entity_match: 0.0, source_authority: 0.0, transcript_relevance: 0.0, signal_category: "string", public_fact: "string", implication: "string", limitation: "string", account_context_eligible: true, narrative_eligible: false, scoring_eligible: false, supports: ["string"], contradicts: ["string"], evidence_ids: ["string"] }],
          distilled_signals: [{ claim: "string", category: "string", strength: "strong|supporting|weak", primary_source_id: "string", corroborating_source_ids: ["string"], implication: "string", limitation: "string" }],
          rejected_sources: [{ source_id: "string", reason: "string" }]
        })
    };
    return JSON.stringify(payload);
  },
  validate: (output, input) => {
    const issues: string[] = [];
    const allowedIds = allowedStageBSourceIds(input);
    const badIds = Array.from(new Set(referencedSourceIds(output).filter((id) => !allowedIds.has(id))));
    if (badIds.length > 0) issues.push(`referenced source_ids not present in input: ${badIds.slice(0, 6).join(", ")}`);
    const badUrls = invalidUrls(output, allowedStageBUrls(input));
    if (badUrls.length > 0) issues.push(`invented URLs not present in input: ${badUrls.slice(0, 6).join(", ")}`);
    return issues;
  },
  deterministicFallback: (input) => input.deterministic
};

export async function runStageB(input: StageBInput, opts?: { timeoutMs?: number }): Promise<StageResult<StageBOutput>> {
  return runStage(stageBDefinition, input, opts);
}
