import type { EntryEvaluation, PrimarySolution } from "@/lib/signal-agent/types";

/**
 * Turns a scored entry into the routing decision (solution, specialist,
 * next action) using only fields already present on the matched entry —
 * `choose_when` / `do_not_choose_when` / `recommended_specialist` /
 * `primary_solutions` / `adjacent_solutions` — never a hard-coded mapping
 * from category id to product/specialist.
 */

export type RoutingResult = {
  recommendedSolution: string[];
  primarySolutions: PrimarySolution[];
  adjacentSolutions: string[];
  whyThisSolution: string;
  whyNotAdjacentSolution: string;
  recommendedSpecialist: string | null;
  nextBestAction: "specialist_route" | "human_review" | "suppress";
  shouldNotify: boolean;
};

export function buildRouting(evaluation: EntryEvaluation): RoutingResult {
  const { entry, intentLabel } = evaluation;

  const primarySolutions = entry.primarySolutions.length > 0 ? entry.primarySolutions : entry.solutionSummary ? [{ name: entry.solutionSummary, role: "" }] : [];
  const recommendedSolution = primarySolutions.map((solution) => solution.name);

  const evidenceParts: string[] = [];
  if (evaluation.matchedKeywords.length > 0) {
    evidenceParts.push(`${evaluation.matchedKeywords.length} keyword match(es)`);
  }
  if (evaluation.matchedSemanticCues.length > 0) {
    evidenceParts.push(`${evaluation.matchedSemanticCues.length} semantic cue match(es)`);
  }
  if (evaluation.corroboration.length > 0) {
    evidenceParts.push(`${evaluation.corroboration.length} account corroboration signal(s)`);
  }
  const evidenceSummary = evidenceParts.length > 0 ? evidenceParts.join(", ") : "no strong evidence";

  const chooseWhen = entry.chooseWhen[0] ? ` ${entry.chooseWhen[0]}` : "";
  const whyThisSolution = `Matched pain category "${entry.painCategory}" via ${evidenceSummary} (confidence ${Math.round(
    evaluation.confidence * 100
  )}%).${chooseWhen}`;

  const whyNotAdjacentSolution =
    entry.doNotChooseWhen.length > 0
      ? entry.doNotChooseWhen.slice(0, 2).join(" ")
      : entry.adjacentSolutions.length > 0
        ? `No disqualifying signal found for the adjacent solution(s): ${entry.adjacentSolutions.join(", ")}.`
        : "No adjacent-solution conflict was detected for this signal.";

  const nextBestAction: RoutingResult["nextBestAction"] =
    intentLabel === "HIGH_INTENT" ? "specialist_route" : intentLabel === "REVIEW" ? "human_review" : "suppress";

  return {
    recommendedSolution,
    primarySolutions,
    adjacentSolutions: entry.adjacentSolutions,
    whyThisSolution,
    whyNotAdjacentSolution,
    recommendedSpecialist: entry.recommendedSpecialist,
    nextBestAction,
    // classifyIntent() in scoring.ts already forces NOISE whenever there is
    // an unresolved negation, so by construction any non-NOISE label here
    // has already cleared that gate — this is the full notification gate:
    // never notify on NOISE, always allow HIGH_INTENT/REVIEW through.
    shouldNotify: intentLabel !== "NOISE"
  };
}
