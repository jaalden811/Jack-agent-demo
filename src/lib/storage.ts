import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { ProviderStatusSnapshot, ResearchRun } from "@/lib/types";

type ResearchIndex = {
  runs: ResearchRun[];
};

const emptyIndex: ResearchIndex = { runs: [] };

function legacyFallbackStatus(): ProviderStatusSnapshot {
  return {
    overall: "fallback_mode_active",
    searchProvider: "tavily",
    checks: [],
    liveSearchAvailable: false,
    openAiEmbeddingsAvailable: false,
    firecrawlAvailable: false,
    contactEnrichmentAvailable: false,
    fallbackModeActive: true,
    summary: "Legacy run without provider snapshot; treat as unverified fallback."
  };
}

function normalizeRun(run: ResearchRun) {
  return {
    ...run,
    providerStatus: run.providerStatus ?? legacyFallbackStatus(),
    liveSearchUsed: run.liveSearchUsed ?? false,
    openAiEmbeddingsUsed: run.openAiEmbeddingsUsed ?? false,
    firecrawlExtractionUsed: run.firecrawlExtractionUsed ?? false,
    contactEnrichmentUsed: run.contactEnrichmentUsed ?? false,
    isVerified: run.isVerified ?? false,
    isFallback: run.isFallback ?? true
  };
}

function dataFilePath() {
  const config = getConfig();
  return path.join(process.cwd(), config.LOCAL_DATA_DIR, "research-runs.json");
}

async function readIndex(): Promise<ResearchIndex> {
  try {
    const file = dataFilePath();
    const content = await readFile(file, "utf8");
    return JSON.parse(content) as ResearchIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex;
    }
    throw error;
  }
}

async function writeIndex(index: ResearchIndex) {
  const file = dataFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(index, null, 2));
}

export async function saveRun(run: ResearchRun) {
  const index = await readIndex();
  const existing = index.runs.findIndex((item) => item.id === run.id);
  if (existing >= 0) {
    index.runs[existing] = run;
  } else {
    index.runs.unshift(run);
  }
  await writeIndex(index);
  return run;
}

export async function getRun(runId: string) {
  const index = await readIndex();
  const run = index.runs.find((item) => item.id === runId);
  return run ? normalizeRun(run) : null;
}

export async function listRuns() {
  const index = await readIndex();
  return index.runs.map(normalizeRun);
}
