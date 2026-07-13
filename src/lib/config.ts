import { z } from "zod";

// Trim string env vars at parse time so trailing spaces don't cause "missing" false-positives.
const trimmedString = z
  .string()
  .transform((v) => v.trim())
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const envSchema = z.object({
  OPENAI_API_KEY: trimmedString,
  OPENAI_EMBEDDING_MODEL: z.string().optional().default("text-embedding-3-small"),
  SEARCH_API_KEY: trimmedString,
  SEARCH_PROVIDER: z.enum(["tavily", "brave", "exa", "serpapi"]).optional().default("tavily"),
  FIRECRAWL_API_KEY: trimmedString,
  DATABASE_URL: trimmedString,
  SUPABASE_URL: trimmedString,
  SUPABASE_SERVICE_ROLE_KEY: trimmedString,
  HUNTER_API_KEY: trimmedString,
  PEOPLE_DATA_LABS_API_KEY: trimmedString,
  CLEARBIT_API_KEY: trimmedString,
  LOCAL_DATA_DIR: z.string().optional().default(".data"),

  // Webex OAuth Integration (connected-user meeting/transcript access)
  WEBEX_CLIENT_ID: trimmedString,
  WEBEX_CLIENT_SECRET: trimmedString,
  WEBEX_REDIRECT_URI: z.string().optional().default("http://localhost:3010/api/webex/oauth/callback"),
  WEBEX_SCOPES: z
    .string()
    .optional()
    .default("meeting:transcripts_read meeting:schedules_read spark:people_read spark:rooms_read spark:messages_write"),

  // Webex Bot (outbound alert identity — separate from the OAuth Integration)
  WEBEX_BOT_ACCESS_TOKEN: trimmedString,

  // Peachtree pilot routing recipients
  WEBEX_SALES_RECIPIENT_EMAIL: trimmedString,
  WEBEX_TECHNICAL_RECIPIENT_EMAIL: trimmedString,

  // Autonomous webhook mode
  WEBEX_PUBLIC_BASE_URL: trimmedString,
  WEBEX_AUTOPILOT_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  WEBEX_WEBHOOK_SECRET: trimmedString
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
    ),
    hasWebexOAuth: Boolean(parsed.data.WEBEX_CLIENT_ID && parsed.data.WEBEX_CLIENT_SECRET),
    hasWebexBot: Boolean(parsed.data.WEBEX_BOT_ACCESS_TOKEN),
    hasSalesRecipient: Boolean(parsed.data.WEBEX_SALES_RECIPIENT_EMAIL),
    hasTechnicalRecipient: Boolean(parsed.data.WEBEX_TECHNICAL_RECIPIENT_EMAIL),
    webexPublicBaseUrlUsable: Boolean(
      parsed.data.WEBEX_PUBLIC_BASE_URL &&
        /^https:\/\//i.test(parsed.data.WEBEX_PUBLIC_BASE_URL) &&
        !/localhost|127\.0\.0\.1/i.test(parsed.data.WEBEX_PUBLIC_BASE_URL)
    )
  };
}
