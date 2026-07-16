import { readFileSync } from "node:fs";
import path from "node:path";
import type { ObjectiveDefinition } from "@/lib/personalization/types";

/**
 * Loads the data-driven seller objective catalog from config. The catalog is
 * the single source of truth for objectives/goals — components render it and
 * never hard-code objective lists. References existing taxonomy entry ids.
 */

const CONFIG_RELATIVE_PATH = "signal-agent-poc/config/seller_objective_catalog.json";

type ObjectiveCatalog = {
  metadata: { version: string };
  measurement_metrics: string[];
  objectives: ObjectiveDefinition[];
};

let cached: ObjectiveCatalog | null = null;

export function clearObjectiveCatalogCache(): void {
  cached = null;
}

export function loadObjectiveCatalog(): ObjectiveCatalog {
  if (cached) return cached;
  const text = readFileSync(path.join(process.cwd(), CONFIG_RELATIVE_PATH), "utf8");
  cached = JSON.parse(text) as ObjectiveCatalog;
  return cached;
}

export function listObjectives(activeOnly = true): ObjectiveDefinition[] {
  const objectives = loadObjectiveCatalog().objectives;
  return activeOnly ? objectives.filter((o) => o.active) : objectives;
}

export function getObjective(objectiveId: string): ObjectiveDefinition | null {
  return loadObjectiveCatalog().objectives.find((o) => o.objective_id === objectiveId) ?? null;
}

export function listMeasurementMetrics(): string[] {
  return loadObjectiveCatalog().measurement_metrics;
}

/** Objectives applicable to a given role family (for the setup wizard). */
export function objectivesForRoleFamily(roleFamily: string): ObjectiveDefinition[] {
  const rf = roleFamily.trim().toLowerCase();
  return listObjectives().filter((o) => o.applicable_role_families.map((r) => r.toLowerCase()).includes(rf));
}
