import type { AccountRecord, EntryEvaluation } from "@/lib/signal-agent/types";
import type { RoutingResult } from "@/lib/signal-agent/routing";

/**
 * Drafts the internal-only notification. Never contacts a customer, never
 * invents a specialist name — `recommendedSpecialist` is always the
 * role/team description text already present on the matched entry.
 */

function formatInstallBase(installBase: string[]): string {
  return installBase.length > 0 ? installBase.join(", ") : "none on file";
}

function formatDealSnapshot(account: AccountRecord): string {
  if (!account.matched) return "no account match — transcript-only signal, no CRM corroboration available";
  const stage = account.opportunityStage ?? account.stage ?? "no active stage on file";
  const value = account.dealValue ? `$${account.dealValue.toLocaleString("en-US")}` : "no deal value on file";
  const budget = account.budgetSignal ?? "no explicit budget signal on file";
  return `stage=${stage}, value=${value}, install_base=[${formatInstallBase(account.installBase)}], budget_signal=${budget}`;
}

export function draftNotification(params: { evaluation: EntryEvaluation; account: AccountRecord; routing: RoutingResult }): string {
  const { evaluation, account, routing } = params;
  const accountLabel = account.matched ? account.account : "Unknown account (transcript-only)";
  const reviewNote =
    evaluation.intentLabel === "REVIEW"
      ? "\n\nStatus: NEEDS HUMAN REVIEW — confidence is in the review band or evidence is ambiguous; a specialist should validate before any customer-facing action."
      : "";

  const lines = [
    `Signal detected: ${evaluation.entry.painCategory}`,
    "",
    `Account: ${accountLabel}`,
    `Mapped solution: ${routing.recommendedSolution.join(", ") || "unspecified"}`,
    `Why now: ${routing.whyThisSolution}`,
    `Deal snapshot: ${formatDealSnapshot(account)}`,
    `Recommended action: Loop in the ${routing.recommendedSpecialist ?? "appropriate specialist"} for a review of ${
      routing.recommendedSolution.join(", ") || "the matched solution"
    } with ${accountLabel}.`,
    `Owner: ${routing.recommendedSpecialist ?? "Unassigned — no specialist configured for this category"}`,
    reviewNote,
    "",
    "Do not contact the customer directly from this automation."
  ];

  return lines.filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}
