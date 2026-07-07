import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  SEARCH_API_KEY: z.string().optional(),
  SEARCH_PROVIDER: z.enum(["tavily", "brave", "exa", "serpapi"]).optional().default("tavily"),
  FIRECRAWL_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  HUNTER_API_KEY: z.string().optional(),
  PEOPLE_DATA_LABS_API_KEY: z.string().optional(),
  CLEARBIT_API_KEY: z.string().optional(),
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
