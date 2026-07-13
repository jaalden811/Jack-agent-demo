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

  // Webex Bot — optional fallback sender only. Delivery defaults to the
  // connected user's own OAuth token (spark:messages_write); the bot is
  // never required.
  WEBEX_BOT_ACCESS_TOKEN: trimmedString,

  // Autonomous webhook mode
  WEBEX_PUBLIC_BASE_URL: trimmedString,
  WEBEX_AUTOPILOT_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  WEBEX_WEBHOOK_SECRET: trimmedString,

  // Auto-send after analysis (Demo/Paste/Upload/manually-selected Webex
  // transcripts) — distinct from the webhook-triggered autopilot above.
  SIGNAL_AGENT_AUTO_SEND_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v.trim().toLowerCase() === "true")),

  // Outlook / Microsoft Graph OAuth (real email delivery via Mail.Send)
  MICROSOFT_CLIENT_ID: trimmedString,
  MICROSOFT_CLIENT_SECRET: trimmedString,
  MICROSOFT_TENANT_ID: z.string().optional().default("organizations"),
  MICROSOFT_REDIRECT_URI: z.string().optional().default("http://localhost:3010/api/outlook/oauth/callback"),
  MICROSOFT_SCOPES: z.string().optional().default("openid profile offline_access User.Read Mail.Send")
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
    hasMicrosoftOAuth: Boolean(parsed.data.MICROSOFT_CLIENT_ID && parsed.data.MICROSOFT_CLIENT_SECRET),
    webexPublicBaseUrlUsable: Boolean(
      parsed.data.WEBEX_PUBLIC_BASE_URL &&
        /^https:\/\//i.test(parsed.data.WEBEX_PUBLIC_BASE_URL) &&
        !/localhost|127\.0\.0\.1/i.test(parsed.data.WEBEX_PUBLIC_BASE_URL)
    )
  };
}
