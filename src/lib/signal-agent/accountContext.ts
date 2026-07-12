import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import type { AccountRecord, BuyingIntentEvidence, CatalogEntry, CorroborationSignal, IngestedTranscript } from "@/lib/signal-agent/types";
import { customerHaystack, normalize } from "@/lib/signal-agent/keywordMatch";

/**
 * Local synthetic account data (signal-agent-poc/data/accounts.csv) used
 * as a stand-in for Salesforce/CRM corroboration. Corroboration scoring
 * is generic: it scans every column of the matched account row as text
 * and checks it against each entry's own corroboration_hints /
 * install_base_signals / intent_markers — there is no per-field-name
 * switch statement wired to a specific pain category or product.
 */

function accountsCsvPath() {
  return path.join(process.cwd(), "signal-agent-poc", "data", "accounts.csv");
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toBool(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unmatchedRecord(accountName: string | null): AccountRecord {
  return {
    account: accountName ?? "",
    matched: false,
    openOpportunity: false,
    stage: null,
    opportunityStage: null,
    dealValue: 0,
    installBase: [],
    budgetSignal: null,
    installBaseCategory: null,
    lifecyclePressure: null,
    strategicInitiative: null,
    multiSite: false,
    cloudComplexity: null,
    securityPriority: false,
    renewalWindowMonths: null,
    servicePerformanceIssue: false,
    recentIncident: false,
    complianceDeadline: false,
    aiInitiative: false,
    siteCount: null,
    affectedUsers: null,
    raw: {}
  };
}

let cachedRows: Record<string, string>[] | null = null;

function readAccountRows(): Record<string, string>[] {
  if (cachedRows) return cachedRows;
  try {
    const text = readFileSync(accountsCsvPath(), "utf8");
    cachedRows = parseCsv(text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  } catch {
    cachedRows = [];
  }
  return cachedRows;
}

/** For tests only — forces the next lookup to re-read accounts.csv. */
export function clearAccountsCache() {
  cachedRows = null;
}

/** Merges a user-pasted account JSON override (Card 3 "paste account JSON")
 * on top of any CSV match — override fields win. This never invents data:
 * it only accepts values the caller explicitly provided. */
export function applyAccountOverride(
  base: AccountRecord,
  override: Record<string, string | number | boolean> | undefined
): AccountRecord {
  if (!override || Object.keys(override).length === 0) return base;

  const rawOverride: Record<string, string> = {};
  for (const [key, value] of Object.entries(override)) {
    rawOverride[key] = String(value);
  }
  const mergedRaw = { ...base.raw, ...rawOverride, account: base.matched ? base.account : String(override.account ?? base.account) };

  const merged = findAccountFromRow(mergedRaw);
  return { ...merged, matched: true };
}

function findAccountFromRow(row: Record<string, string>): AccountRecord {
  const installBase = (row.install_base ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    account: row.account ?? "",
    matched: true,
    openOpportunity: toBool(row.open_opportunity),
    stage: toStringOrNull(row.stage),
    opportunityStage: toStringOrNull(row.opportunity_stage) ?? toStringOrNull(row.stage),
    dealValue: toNumber(row.deal_value) ?? 0,
    installBase,
    budgetSignal: toStringOrNull(row.budget_signal),
    installBaseCategory: toStringOrNull(row.install_base_category),
    lifecyclePressure: toStringOrNull(row.lifecycle_pressure),
    strategicInitiative: toStringOrNull(row.strategic_initiative),
    multiSite: toBool(row.multi_site),
    cloudComplexity: toStringOrNull(row.cloud_complexity),
    securityPriority: toBool(row.security_priority),
    renewalWindowMonths: toNumber(row.renewal_window_months),
    servicePerformanceIssue: toBool(row.service_performance_issue),
    recentIncident: toBool(row.recent_incident),
    complianceDeadline: toBool(row.compliance_deadline),
    aiInitiative: toBool(row.ai_initiative),
    siteCount: toNumber(row.site_count),
    affectedUsers: toNumber(row.affected_users),
    raw: row
  };
}

export function findAccount(accountName: string | null): AccountRecord {
  if (!accountName) return unmatchedRecord(accountName);

  const target = normalizeName(accountName);
  const rows = readAccountRows();
  const row = rows.find((candidate) => normalizeName(candidate.account ?? "") === target);
  if (!row) return unmatchedRecord(accountName);

  return findAccountFromRow(row);
}

/** Builds a single lower-cased text blob out of every non-empty,
 * non-false column on the account row, so the hint-matching step below
 * can treat all account fields uniformly regardless of what new columns
 * get added to accounts.csv later. */
function buildAccountTextBlob(raw: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === "account") continue;
    const trimmed = (value ?? "").trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === "false" || lower === "0") continue;

    const readableKey = key.replace(/_/g, " ");
    if (lower === "true") {
      parts.push(readableKey);
    } else {
      parts.push(`${readableKey} ${trimmed}`);
      parts.push(trimmed);
    }
  }
  return parts.join(" | ").toLowerCase().replace(/-/g, " ");
}

export type CorroborationResult = {
  score: number;
  signals: CorroborationSignal[];
};

export function scoreCorroboration(entry: CatalogEntry, account: AccountRecord): CorroborationResult {
  if (!account.matched) return { score: 0, signals: [] };

  const blob = buildAccountTextBlob(account.raw);
  const signals: CorroborationSignal[] = [];
  const seenLabels = new Set<string>();
  let hits = 0;

  const addSignal = (label: string) => {
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    signals.push({ signal: label, source: "account_csv" });
    hits += 1;
  };

  if (account.openOpportunity) addSignal("Open opportunity in active pipeline");
  if (account.budgetSignal) addSignal(account.budgetSignal);

  const hintGroups: Array<{ hints: string[]; label: (hint: string) => string }> = [
    { hints: entry.installBaseSignals, label: (hint) => `Existing ${hint} in install base` },
    { hints: entry.corroborationHints, label: (hint) => hint },
    { hints: entry.intentMarkers, label: (hint) => `Intent signal: ${hint}` }
  ];

  for (const group of hintGroups) {
    for (const hint of group.hints) {
      if (!hint) continue;
      if (blob.includes(hint.toLowerCase().replace(/-/g, " "))) {
        addSignal(group.label(hint));
      }
    }
  }

  if (entry.domain && blob.includes(entry.domain.toLowerCase().replace(/-/g, " "))) {
    addSignal(`Install-base category aligns with ${entry.domain}`);
  }

  const score = hits > 0 ? Math.min(1, 1 - Math.exp(-hits / 3)) : 0;
  return { score, signals };
}

const INTENT_TYPE_LABELS: Record<string, string> = {
  budget: "Budget/funding confirmed in transcript",
  timeline: "Explicit timeline stated in transcript",
  owner: "Named ownership stated in transcript",
  impact: "Quantified business impact stated in transcript",
  renewal: "Renewal event referenced in transcript",
  evaluation: "Active evaluation/pilot language in transcript",
  next_step: "Concrete next-step commitment in transcript"
};

/** Transcript-derived corroboration (Ground Rule from Section 6): budget,
 * timing, ownership, incident, quantified impact, renewal, pilot scope,
 * existing technology footprint, and requested next step — all read
 * directly from the transcript, independent of any CRM/CSV row. This is
 * what lets a transcript with no account match still be treated as a real
 * signal rather than automatically capped at NOISE. */
export function scoreTranscriptCorroboration(
  entry: CatalogEntry,
  transcript: IngestedTranscript,
  intentEvidence: BuyingIntentEvidence[],
  stakeholderCount: number
): CorroborationResult {
  const signals: CorroborationSignal[] = [];
  const seenLabels = new Set<string>();
  let hits = 0;

  const addSignal = (label: string) => {
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    signals.push({ signal: label, source: "transcript" });
    hits += 1;
  };

  const typesPresent = new Set(intentEvidence.map((item) => item.type));
  for (const type of typesPresent) {
    addSignal(INTENT_TYPE_LABELS[type] ?? `${type} evidence found in transcript`);
  }

  if (stakeholderCount > 0) {
    addSignal(`${stakeholderCount} named stakeholder(s) identified in transcript`);
  }

  const { text: haystack } = customerHaystack(transcript);
  for (const signal of entry.installBaseSignals) {
    if (signal && haystack.includes(normalize(signal))) {
      addSignal(`Existing ${signal} footprint mentioned in transcript`);
    }
  }

  const score = hits > 0 ? Math.min(1, 1 - Math.exp(-hits / 3)) : 0;
  return { score, signals };
}
