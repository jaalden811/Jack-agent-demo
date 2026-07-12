import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import type { AccountRecord, CatalogEntry, CorroborationSignal } from "@/lib/signal-agent/types";

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

export function findAccount(accountName: string | null): AccountRecord {
  if (!accountName) return unmatchedRecord(accountName);

  const target = normalizeName(accountName);
  const rows = readAccountRows();
  const row = rows.find((candidate) => normalizeName(candidate.account ?? "") === target);
  if (!row) return unmatchedRecord(accountName);

  const installBase = (row.install_base ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    account: row.account,
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
