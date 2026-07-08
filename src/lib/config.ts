import { z } from "zod";

// Trim string env vars at parse time so trailing spaces don't cause "missing" false-positives.
const trimmedString = z
  .string()
  .transform((v) => v.trim())
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const envSchema = z.object({
  OPENAI_API_KEY: trimmedString,
  SEARCH_API_KEY: trimmedString,
  SEARCH_PROVIDER: z.enum(["tavily", "brave", "exa", "serpapi"]).optional().default("tavily"),
  FIRECRAWL_API_KEY: trimmedString,
  DATABASE_URL: trimmedString,
  SUPABASE_URL: trimmedString,
  SUPABASE_SERVICE_ROLE_KEY: trimmedString,
  HUNTER_API_KEY: trimmedString,
  PEOPLE_DATA_LABS_API_KEY: trimmedString,
  CLEARBIT_API_KEY: trimmedString,
  LOCAL_DATA_DIR: z.string().optional().default(".data")
});

export function getConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return {
    ...parsed.data,
    hasSearch: Boolean(parsed.data.SEARCH_API_KEY),
    hasEmbeddings: Boolean(parsed.data.OPENAI_API_KEY),
    hasFirecrawl: Boolean(parsed.data.FIRECRAWL_API_KEY),
    hasSupabase: Boolean(parsed.data.SUPABASE_URL && parsed.data.SUPABASE_SERVICE_ROLE_KEY),
    hasContactEnrichment: Boolean(
      parsed.data.HUNTER_API_KEY ||
        parsed.data.PEOPLE_DATA_LABS_API_KEY ||
        parsed.data.CLEARBIT_API_KEY
    )
  };
}
