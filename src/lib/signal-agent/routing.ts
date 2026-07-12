import type { AdjacentSolutionDecision, CatalogEntry, EntryEvaluation, IngestedTranscript, PrimarySolution, SolutionDecision } from "@/lib/signal-agent/types";
import { selectRelevantChunks } from "@/lib/signal-agent/transcript";
import { evaluateRules } from "@/lib/signal-agent/ruleEvaluation";

/**
 * Turns a scored entry into a routing decision, evaluating
 * `choose_when`/`do_not_choose_when` as rules against transcript
 * evidence (Section 7) instead of ever asserting them as customer facts.
 * Never a hard-coded mapping from category id to product/specialist —
 * every string used here comes off the matched entry (or another entry
 * in the same loaded catalog when evaluating adjacent solutions).
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
  solutionDecision: SolutionDecision;
};

function sentenceTexts(transcript: IngestedTranscript): string[] {
  return selectRelevantChunks(transcript).map((chunk) => chunk.text);
}

/** Finds other catalog entries whose primary solution names overlap with
 * this entry's `adjacentSolutions` list, so their own choose_when/
 * do_not_choose_when rules can be evaluated against the same transcript —
 * this is how we ground statements like "AppDynamics should not be
 * primary" in actual taxonomy rules + evidence, not a hard-coded product
 * comparison. */
function findAdjacentEntries(entry: CatalogEntry, allEntries: CatalogEntry[]): CatalogEntry[] {
  if (entry.adjacentSolutions.length === 0) return [];
  const adjacentNamesLower = entry.adjacentSolutions.map((name) => name.toLowerCase());
  return allEntries.filter(
    (candidate) =>
      candidate.id !== entry.id &&
      candidate.primarySolutions.some((solution) => adjacentNamesLower.some((name) => name.includes(solution.name.toLowerCase()) || solution.name.toLowerCase().includes(name)))
  );
}

function buildSolutionDecision(entry: CatalogEntry, transcript: IngestedTranscript, allEntries: CatalogEntry[]): SolutionDecision {
  const sentences = sentenceTexts(transcript);
  const chooseWhenEvidence = evaluateRules(entry.chooseWhen, sentences);
  const doNotChooseConflicts = evaluateRules(entry.doNotChooseWhen, sentences);

  const ownPrimarySolutionNames = new Set(entry.primarySolutions.map((solution) => solution.name.toLowerCase()));
  const adjacentEntries = findAdjacentEntries(entry, allEntries);
  const adjacentSolutionsConsidered: AdjacentSolutionDecision[] = [];

  for (const adjacentEntry of adjacentEntries) {
    const adjacentDoNotChoose = evaluateRules(adjacentEntry.doNotChooseWhen, sentences);
    const adjacentChooseWhen = evaluateRules(adjacentEntry.chooseWhen, sentences);
    const disqualifying = adjacentDoNotChoose.find((rule) => rule.status === "matched");
    const contradictedChoose = adjacentChooseWhen.find((rule) => rule.status === "contradicted");
    const supportingChoose = adjacentChooseWhen.find((rule) => rule.status === "matched");

    for (const solution of adjacentEntry.primarySolutions) {
      // A product this entry itself already recommends as primary is not
      // a genuine "adjacent alternative" — never flag it via a collision
      // with another entry's rules.
      if (ownPrimarySolutionNames.has(solution.name.toLowerCase())) continue;

      if (disqualifying) {
        adjacentSolutionsConsidered.push({
          solution: solution.name,
          decision: "exclude",
          reason: `Do-not-choose condition evidenced: "${disqualifying.rule}" — ${disqualifying.evidence}`
        });
      } else if (contradictedChoose) {
        adjacentSolutionsConsidered.push({
          solution: solution.name,
          decision: "exclude",
          reason: `Its own choose-when condition is contradicted by the transcript: "${contradictedChoose.rule}" — ${contradictedChoose.evidence}`
        });
      } else if (supportingChoose) {
        adjacentSolutionsConsidered.push({
          solution: solution.name,
          decision: "secondary",
          reason: `Choose-when condition evidenced: "${supportingChoose.rule}" — ${supportingChoose.evidence}`
        });
      } else {
        adjacentSolutionsConsidered.push({
          solution: solution.name,
          decision: "needs_discovery",
          reason: "No transcript evidence yet either supports or rules out this adjacent solution — ask a discovery question before including or excluding it."
        });
      }
    }
  }

  const retainedExisting = entry.installBaseSignals.filter((signal) => sentences.some((sentence) => sentence.toLowerCase().includes(signal.toLowerCase())));

  return {
    recommended: entry.primarySolutions.map((solution) => solution.name),
    supporting_products: adjacentSolutionsConsidered.filter((item) => item.decision === "secondary" || item.decision === "include").map((item) => item.solution),
    retained_existing_platforms: retainedExisting,
    choose_when_evidence: chooseWhenEvidence,
    do_not_choose_conflicts: doNotChooseConflicts,
    adjacent_solutions_considered: adjacentSolutionsConsidered
  };
}

export function buildRouting(evaluation: EntryEvaluation, transcript: IngestedTranscript, allEntries: CatalogEntry[]): RoutingResult {
  const { entry, intentLabel } = evaluation;

  const primarySolutions = entry.primarySolutions.length > 0 ? entry.primarySolutions : entry.solutionSummary ? [{ name: entry.solutionSummary, role: "" }] : [];
  const recommendedSolution = primarySolutions.map((solution) => solution.name);

  const solutionDecision = buildSolutionDecision(entry, transcript, allEntries);

  const evidenceParts: string[] = [];
  if (evaluation.matchedKeywords.length > 0) evidenceParts.push(`${evaluation.matchedKeywords.length} keyword match(es)`);
  if (evaluation.matchedSemanticCues.length > 0) evidenceParts.push(`${evaluation.matchedSemanticCues.length} semantic cue match(es)`);
  if (evaluation.intentEvidence.length > 0) evidenceParts.push(`${new Set(evaluation.intentEvidence.map((item) => item.type)).size} distinct buying-intent signal type(s)`);
  if (evaluation.corroboration.length + evaluation.transcriptCorroboration.length > 0) {
    evidenceParts.push(`${evaluation.corroboration.length + evaluation.transcriptCorroboration.length} corroboration signal(s)`);
  }
  const evidenceSummary = evidenceParts.length > 0 ? evidenceParts.join(", ") : "no strong evidence";

  const matchedChooseWhen = solutionDecision.choose_when_evidence.find((rule) => rule.status === "matched");
  const chooseWhenNote = matchedChooseWhen ? ` ${matchedChooseWhen.rule}` : "";
  const whyThisSolution = `Matched pain category "${entry.painCategory}" via ${evidenceSummary} (confidence ${Math.round(evaluation.confidence * 100)}%).${chooseWhenNote}`;

  const excludedAdjacent = solutionDecision.adjacent_solutions_considered.filter((item) => item.decision === "exclude");
  const whyNotAdjacentSolution =
    excludedAdjacent.length > 0
      ? excludedAdjacent.map((item) => `${item.solution}: ${item.reason}`).join(" ")
      : entry.adjacentSolutions.length > 0
        ? `No transcript evidence yet disqualifies the adjacent solution(s) considered: ${entry.adjacentSolutions.join(", ")} — treat as needs_discovery.`
        : "No adjacent solutions are defined for this category.";

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
    // Explicit unresolved negation already forces intentLabel to NOISE in
    // scoring.ts's classifyIntent(), so any non-NOISE label here has
    // already cleared the negation gate — this *is* the full notification
    // gate: never notify on NOISE, always allow HIGH_INTENT/REVIEW.
    shouldNotify: intentLabel !== "NOISE",
    solutionDecision
  };
}
