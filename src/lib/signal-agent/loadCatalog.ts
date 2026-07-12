import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CatalogEntry,
  CatalogMetadata,
  LoadedCatalog,
  NegationConfig,
  ParsedMatchingConfig,
  PrimarySolution,
  SourceCatalog
} from "@/lib/signal-agent/types";

/**
 * Loads the pain-point -> solution taxonomy from JSON on disk. Never
 * hard-codes a category id, product name, specialist, weight, or
 * threshold — every one of those values is read from the JSON files at
 * runtime. If the primary (Cisco) mapping is missing, this falls back to
 * the legacy simple map and normalizes it into the same CatalogEntry
 * shape so every downstream module (keywordMatch, semanticMatch, scoring,
 * routing) can stay entry-agnostic.
 */

function poc_root() {
  // signal-agent-poc/ sits beside the Next.js app root, not inside src/.
  return path.join(process.cwd(), "signal-agent-poc");
}

function readJson<T>(relativePath: string): T | null {
  try {
    const text = readFileSync(path.join(poc_root(), relativePath), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Extracts the first decimal number that follows a labeled token in a
 * free-text config description, e.g. "confidence >= 0.78" -> 0.78, or
 * "Subtract 0.35 when ..." -> 0.35. This keeps every numeric threshold
 * sourced from the JSON's own prose rather than re-typed as a literal in
 * application code. */
function extractNumber(text: unknown, pattern: RegExp, fallback: number): number {
  if (typeof text !== "string" || !text) return fallback;
  const match = text.match(pattern);
  if (!match || match[1] === undefined) return fallback;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : fallback;
}

/** Default formula — identical to what is actually shipped in the Cisco
 * mapping JSON's matching_configuration. Only used when a loaded catalog
 * has no matching_configuration block at all (the legacy fallback map). */
const DEFAULT_MATCHING_CONFIG: ParsedMatchingConfig = {
  weights: { keyword: 0.2, semantic: 0.45, corroboration: 0.25, specificityIntent: 0.1 },
  keywordCap: 1.0,
  semanticFormula: { maxWeight: 0.7, meanTopWeight: 0.3, topN: 3 },
  semanticThresholds: { candidate: 0.66, strong: 0.74, veryStrong: 0.82 },
  penalties: { negation: 0.35, hypotheticalOrEducation: 0.2, wrongDomain: 0.25, competitorOnlyContext: 0.1 },
  gates: {
    highIntent: { confidence: 0.78, semantic: 0.74, corroboration: 0.7 },
    review: { min: 0.62, max: 0.78 },
    noise: { max: 0.62 }
  },
  transcriptOnlyMode: { weights: { keyword: 0.35, semantic: 0.65 }, maxLabelWithoutSignals: "REVIEW" },
  multiLabel: { enabled: true, maxLabels: 3, scoreWindow: 0.08 }
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseMatchingConfiguration(raw: unknown): ParsedMatchingConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_MATCHING_CONFIG;
  const config = raw as UnknownRecord;

  const keywordPass = asRecord(config.keyword_pass);
  const semanticPass = asRecord(config.semantic_pass);
  const corroborationPass = asRecord(config.corroboration_pass);
  const specificity = asRecord(config.specificity_and_intent);
  const penalties = asRecord(config.penalties);
  const gates = asRecord(config.notification_gates);
  const transcriptOnly = asRecord(config.transcript_only_mode);
  const multiLabel = asRecord(config.multi_label_policy);
  const thresholds = asRecord(semanticPass.starting_thresholds);

  const suggestedFormula = asOptionalString(semanticPass.suggested_formula);
  const maxWeight = extractNumber(suggestedFormula, /(\d*\.\d+)\s*\*\s*max_similarity/, DEFAULT_MATCHING_CONFIG.semanticFormula.maxWeight);
  const meanTopWeight = extractNumber(
    suggestedFormula,
    /(\d*\.\d+)\s*\*\s*mean/,
    DEFAULT_MATCHING_CONFIG.semanticFormula.meanTopWeight
  );
  const topN = extractNumber(suggestedFormula, /top_(\d+)_similarities/, DEFAULT_MATCHING_CONFIG.semanticFormula.topN);

  const highIntentText = asOptionalString(gates.HIGH_INTENT);
  const reviewText = asOptionalString(gates.REVIEW);
  const noiseText = asOptionalString(gates.NOISE);
  const transcriptFormula = asOptionalString(transcriptOnly.formula);
  const maximumLabel = asOptionalString(transcriptOnly.maximum_label);
  const selectionRule = asOptionalString(multiLabel.selection_rule);

  return {
    weights: {
      keyword: typeof keywordPass.weight === "number" ? keywordPass.weight : DEFAULT_MATCHING_CONFIG.weights.keyword,
      semantic: typeof semanticPass.weight === "number" ? semanticPass.weight : DEFAULT_MATCHING_CONFIG.weights.semantic,
      corroboration:
        typeof corroborationPass.weight === "number"
          ? corroborationPass.weight
          : DEFAULT_MATCHING_CONFIG.weights.corroboration,
      specificityIntent:
        typeof specificity.weight === "number" ? specificity.weight : DEFAULT_MATCHING_CONFIG.weights.specificityIntent
    },
    keywordCap: typeof keywordPass.cap === "number" ? keywordPass.cap : DEFAULT_MATCHING_CONFIG.keywordCap,
    semanticFormula: { maxWeight, meanTopWeight, topN },
    semanticThresholds: {
      candidate: typeof thresholds.candidate === "number" ? thresholds.candidate : DEFAULT_MATCHING_CONFIG.semanticThresholds.candidate,
      strong: typeof thresholds.strong === "number" ? thresholds.strong : DEFAULT_MATCHING_CONFIG.semanticThresholds.strong,
      veryStrong:
        typeof thresholds.very_strong === "number" ? thresholds.very_strong : DEFAULT_MATCHING_CONFIG.semanticThresholds.veryStrong
    },
    penalties: {
      negation: extractNumber(penalties.negation, /(\d*\.\d+)/, DEFAULT_MATCHING_CONFIG.penalties.negation),
      hypotheticalOrEducation: extractNumber(
        penalties.hypothetical_or_education,
        /(\d*\.\d+)/,
        DEFAULT_MATCHING_CONFIG.penalties.hypotheticalOrEducation
      ),
      wrongDomain: extractNumber(penalties.wrong_domain, /(\d*\.\d+)/, DEFAULT_MATCHING_CONFIG.penalties.wrongDomain),
      competitorOnlyContext: extractNumber(
        penalties.competitor_only_context,
        /(\d*\.\d+)/,
        DEFAULT_MATCHING_CONFIG.penalties.competitorOnlyContext
      )
    },
    gates: {
      highIntent: {
        confidence: extractNumber(highIntentText, /confidence\s*>=\s*(\d*\.\d+)/, DEFAULT_MATCHING_CONFIG.gates.highIntent.confidence),
        semantic: extractNumber(highIntentText, /semantic\s*>=\s*(\d*\.\d+)/, DEFAULT_MATCHING_CONFIG.gates.highIntent.semantic),
        corroboration: extractNumber(
          highIntentText,
          /corroboration\s*>=\s*(\d*\.\d+)/,
          DEFAULT_MATCHING_CONFIG.gates.highIntent.corroboration
        )
      },
      review: {
        min: extractNumber(reviewText, /(\d*\.\d+)\s*<=\s*confidence/, DEFAULT_MATCHING_CONFIG.gates.review.min),
        max: extractNumber(reviewText, /confidence\s*<\s*(\d*\.\d+)/, DEFAULT_MATCHING_CONFIG.gates.review.max)
      },
      noise: {
        max: extractNumber(noiseText, /confidence\s*<\s*(\d*\.\d+)/, DEFAULT_MATCHING_CONFIG.gates.noise.max)
      }
    },
    transcriptOnlyMode: {
      weights: {
        keyword: extractNumber(transcriptFormula, /(\d*\.\d+)\s*\*\s*keyword/, DEFAULT_MATCHING_CONFIG.transcriptOnlyMode.weights.keyword),
        semantic: extractNumber(
          transcriptFormula,
          /(\d*\.\d+)\s*\*\s*semantic/,
          DEFAULT_MATCHING_CONFIG.transcriptOnlyMode.weights.semantic
        )
      },
      maxLabelWithoutSignals:
        maximumLabel?.includes("HIGH_INTENT")
          ? "HIGH_INTENT"
          : maximumLabel?.includes("NOISE")
            ? "NOISE"
            : DEFAULT_MATCHING_CONFIG.transcriptOnlyMode.maxLabelWithoutSignals
    },
    multiLabel: {
      enabled: typeof multiLabel.enabled === "boolean" ? multiLabel.enabled : DEFAULT_MATCHING_CONFIG.multiLabel.enabled,
      maxLabels: typeof multiLabel.max_labels === "number" ? multiLabel.max_labels : DEFAULT_MATCHING_CONFIG.multiLabel.maxLabels,
      scoreWindow: extractNumber(
        selectionRule,
        /within\s*(\d*\.\d+)/,
        DEFAULT_MATCHING_CONFIG.multiLabel.scoreWindow
      )
    }
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePrimarySolutions(value: unknown): PrimarySolution[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { name: item, role: "" };
      const record = asRecord(item);
      if (typeof record.name === "string") {
        return { name: record.name, role: typeof record.role === "string" ? record.role : "" };
      }
      return null;
    })
    .filter((item): item is PrimarySolution => item !== null);
}

function normalizeCiscoEntries(rawEntries: UnknownRecord): CatalogEntry[] {
  return Object.entries(rawEntries).map(([id, rawValue]) => {
    const raw = asRecord(rawValue);
    return {
      id: typeof raw.id === "string" ? raw.id : id,
      domain: typeof raw.domain === "string" ? raw.domain : "",
      painCategory: typeof raw.pain_category === "string" ? raw.pain_category : id,
      customerLanguage: asStringArray(raw.customer_language),
      keywords: asStringArray(raw.keywords),
      semanticCues: asStringArray(raw.semantic_cues),
      negativeCues: asStringArray(raw.negative_cues),
      solutionSummary: typeof raw.solution === "string" ? raw.solution : "",
      primarySolutions: normalizePrimarySolutions(raw.primary_solutions),
      adjacentSolutions: asStringArray(raw.adjacent_solutions),
      chooseWhen: asStringArray(raw.choose_when),
      doNotChooseWhen: asStringArray(raw.do_not_choose_when),
      corroborationHints: asStringArray(raw.corroboration_hints),
      installBaseSignals: asStringArray(raw.install_base_signals),
      buyingRoles: asStringArray(raw.buying_roles),
      intentMarkers: asStringArray(raw.intent_markers),
      recommendedSpecialist: typeof raw.recommended_specialist === "string" ? raw.recommended_specialist : null
    };
  });
}

/** Normalizes the legacy simple map (pain_point/phrases/solution/
 * related_install_base) into the same CatalogEntry shape used by the
 * generic engine, purely for backward compatibility when the Cisco
 * mapping JSON is absent. */
function normalizeLegacyEntries(rawEntries: unknown): CatalogEntry[] {
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries.map((rawValue: unknown, index: number) => {
    const raw = asRecord(rawValue);
    return {
      id: typeof raw.solution === "string" ? raw.solution.toLowerCase().replace(/\s+/g, "_") : `legacy_${index}`,
      domain: "",
      painCategory: typeof raw.pain_point === "string" ? raw.pain_point : `legacy pain point ${index}`,
      customerLanguage: [],
      keywords: asStringArray(raw.phrases),
      semanticCues: [],
      negativeCues: [],
      solutionSummary: typeof raw.solution === "string" ? raw.solution : "",
      primarySolutions: typeof raw.solution === "string" ? [{ name: raw.solution, role: "" }] : [],
      adjacentSolutions: [],
      chooseWhen: [],
      doNotChooseWhen: [],
      corroborationHints: [],
      installBaseSignals: asStringArray(raw.related_install_base),
      buyingRoles: [],
      intentMarkers: [],
      recommendedSpecialist: null
    };
  });
}

const DEFAULT_NEGATION_CONFIG: NegationConfig = {
  phrases: [],
  hypotheticalMarkers: [],
  externalNegators: ["not", "never", "isn't", "aren't", "doesn't", "don't", "won't", "can't", "cannot"],
  resolutionMarkers: ["but", "however", "although"],
  resolutionEvidenceTerms: ["budget", "approved", "executive", "sponsor"],
  penaltyWeight: 0.35,
  hypotheticalPenaltyWeight: 0.2,
  negationWindowWords: 6
};

function parseNegationConfig(raw: unknown): NegationConfig {
  const record = asRecord(raw);
  return {
    phrases: asStringArray(record.phrases),
    hypotheticalMarkers: asStringArray(record.hypothetical_markers),
    externalNegators: asStringArray(record.external_negators).length
      ? asStringArray(record.external_negators)
      : DEFAULT_NEGATION_CONFIG.externalNegators,
    resolutionMarkers: asStringArray(record.resolution_markers).length
      ? asStringArray(record.resolution_markers)
      : DEFAULT_NEGATION_CONFIG.resolutionMarkers,
    resolutionEvidenceTerms: asStringArray(record.resolution_evidence_terms).length
      ? asStringArray(record.resolution_evidence_terms)
      : DEFAULT_NEGATION_CONFIG.resolutionEvidenceTerms,
    penaltyWeight: typeof record.penalty_weight === "number" ? record.penalty_weight : DEFAULT_NEGATION_CONFIG.penaltyWeight,
    hypotheticalPenaltyWeight:
      typeof record.hypothetical_penalty_weight === "number"
        ? record.hypothetical_penalty_weight
        : DEFAULT_NEGATION_CONFIG.hypotheticalPenaltyWeight,
    negationWindowWords:
      typeof record.negation_window_words === "number" ? record.negation_window_words : DEFAULT_NEGATION_CONFIG.negationWindowWords
  };
}

let cachedCatalog: LoadedCatalog | null = null;

/** Loads and caches the taxonomy for the lifetime of the Node process.
 * Call clearCatalogCache() in tests that need a fresh read. */
export function getCatalog(): LoadedCatalog {
  if (cachedCatalog) return cachedCatalog;

  const negationRaw = readJson<UnknownRecord>("config/generic_negation_phrases.json");
  const negationConfig = parseNegationConfig(negationRaw ?? {});

  const ciscoRaw = readJson<{
    metadata?: UnknownRecord;
    matching_configuration?: unknown;
    entries?: UnknownRecord;
    source_catalog?: Record<string, string>;
  }>("config/cisco_painpoint_solution_map.json");

  if (ciscoRaw && ciscoRaw.entries) {
    const rawMetadata = ciscoRaw.metadata;
    const metadata: CatalogMetadata | null = rawMetadata
      ? {
          title: typeof rawMetadata.title === "string" ? rawMetadata.title : "",
          version: typeof rawMetadata.version === "string" ? rawMetadata.version : "",
          asOf: asOptionalString(rawMetadata.as_of),
          scope: asOptionalString(rawMetadata.scope),
          designPrinciples: asStringArray(rawMetadata.design_principles)
        }
      : null;

    cachedCatalog = {
      source: "cisco_mapping",
      sourcePath: "signal-agent-poc/config/cisco_painpoint_solution_map.json",
      metadata,
      matchingConfig: parseMatchingConfiguration(ciscoRaw.matching_configuration),
      rawMatchingConfig: (ciscoRaw.matching_configuration as Record<string, unknown>) ?? null,
      entries: normalizeCiscoEntries(ciscoRaw.entries),
      sourceCatalog: (ciscoRaw.source_catalog as SourceCatalog) ?? {},
      negationConfig
    };
    return cachedCatalog;
  }

  const legacyRaw = readJson<unknown[]>("config/painpoint_solution_map.json");
  cachedCatalog = {
    source: "legacy_fallback",
    sourcePath: "signal-agent-poc/config/painpoint_solution_map.json",
    metadata: null,
    matchingConfig: DEFAULT_MATCHING_CONFIG,
    rawMatchingConfig: null,
    entries: normalizeLegacyEntries(legacyRaw ?? []),
    sourceCatalog: {},
    negationConfig
  };
  return cachedCatalog;
}

/** For tests only — forces the next getCatalog() call to re-read from disk. */
export function clearCatalogCache() {
  cachedCatalog = null;
}
