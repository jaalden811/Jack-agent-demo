import { readFileSync } from "node:fs";
import path from "node:path";
import type { ObjectiveSearchRule } from "@/lib/objective-search/types";

/** Loads the data-driven objective-to-search map from config. */

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/seller_objective_search_map.json";

type ObjectiveSearchMap = {
  metadata: { version: string };
  forbidden_signal_intents: string[];
  rules: ObjectiveSearchRule[];
};

let cached: ObjectiveSearchMap | null = null;
export function clearObjectiveSearchMapCache(): void {
  cached = null;
}
export function loadObjectiveSearchMap(): ObjectiveSearchMap {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8")) as ObjectiveSearchMap;
  return cached;
}

export function searchRuleFor(objectiveId: string): ObjectiveSearchRule | null {
  return loadObjectiveSearchMap().rules.find((r) => r.objective_id === objectiveId && r.active) ?? null;
}

export function forbiddenSignalIntents(): string[] {
  return loadObjectiveSearchMap().forbidden_signal_intents;
}
