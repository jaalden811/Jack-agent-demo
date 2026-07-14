import { z } from "zod";

// Trim string env vars at parse time so trailing spaces don't cause "missing" false-positives.
const trimmedString = z
  .string()
  .transform((v) => v.trim())
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const envSchema = z.object({
  OPENAI_API_KEY: trimmedString,
  // Embeddings (semantic transcript matching, via the OpenAI embeddings
  // endpoint) and synthesis (executive-brief generation, via the
  // Responses API) are separate capabilities with separate models — an
  // embedding-only model such as text-embedding-3-small can never
  // perform synthesis. OPENAI_MODEL is kept only as a backward-compatible
  // alias when it unambiguously means "synthesis model" (see below).
  OPENAI_EMBEDDING_MODEL: z.string().optional().default("text-embedding-3-small"),
  OPENAI_SYNTHESIS_MODEL: trimmedString,
  OPENAI_MODEL: trimmedString,
  OPENAI_QUALIFICATION_ENABLED: z.string().optional().default("true").transform((v) => v.trim().toLowerCase() !== "false"),
  OPENAI_MESSAGE_SYNTHESIS_ENABLED: z.string().optional().default("true").transform((v) => v.trim().toLowerCase() !== "false"),
  OPENAI_PUBLIC_EVIDENCE_CLASSIFICATION_ENABLED: z.string().optional().default("true").transform((v) => v.trim().toLowerCase() !== "false"),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().optional().default(45_000),
  OPENAI_MAX_RETRIES: z.coerce.number().optional().default(2),
  OPENAI_STORE_RESPONSES: z.string().optional().default("false").transform((v) => v.trim().toLowerCase() === "true"),
  SEARCH_API_KEY: trimmedString,
  SEARCH_PROVIDER: z.enum(["tavily", "brave", "exa", "serpapi"]).optional().default("tavily"),

  // Dedicated SerpAPI connector (@/lib/connectors/serpapi) — reuses the
  // existing SEARCH_PROVIDER/SEARCH_API_KEY, never a second key variable.
  SERPAPI_ENGINE: z.string().optional().default("google"),
  SERPAPI_LANGUAGE: z.string().optional().default("en"),
  SERPAPI_COUNTRY: z.string().optional().default("us"),
  SERPAPI_SAFE: z.string().optional().default("active"),
  SERPAPI_MAX_QUERIES_PER_RUN: z.coerce.number().optional().default(8),
  SERPAPI_MAX_RESULTS_PER_QUERY: z.coerce.number().optional().default(10),
  SERPAPI_DEFAULT_RESULT_LIMIT: z.coerce.number().optional().default(5),
  SERPAPI_CACHE_TTL_SECONDS: z.coerce.number().optional().default(86_400),
  SERPAPI_REQUEST_TIMEOUT_MS: z.coerce.number().optional().default(15_000),
  SERPAPI_MAX_RETRIES: z.coerce.number().optional().default(2),
  SERPAPI_SECOND_PAGE_ENABLED: z.string().optional().default("false").transform((v) => v.trim().toLowerCase() === "true"),

  // Public, HTTPS-only origin used to build outbound share links — never
  // derived from localhost/the request Host header. See
  // @/lib/signal-agent/shareLink.
  APP_PUBLIC_BASE_URL: trimmedString,
  SIGNAL_SHARE_LINK_TTL_HOURS: z.coerce.number().optional().default(168),
  SIGNAL_SHARE_LINK_SECRET: trimmedString,
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
  // Raw value only, trimmed with an empty/whitespace-only value treated
  // as unset (falls back to DEFAULT_WEBEX_SCOPES below in getConfig()).
  // The value is never sent to Webex as-is — every caller normalizes it
  // via @/lib/webex/scopes#normalizeScopes to strip quotes/commas/
  // duplicates before it ever reaches the `/authorize` request.
  WEBEX_SCOPES: trimmedString,

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

// Required core scopes (identity, outbound messaging, meeting schedule
// access) plus the one optional capability (transcript read). "Connect
// Webex" only ever requests the core subset; "Enable transcript access"
// separately requests this full set — see @/lib/webex/scopePolicy.
const DEFAULT_WEBEX_SCOPES = "spark:people_read spark:messages_write meeting:schedules_read meeting:transcripts_read";

// Documented default synthesis model — a small, fast chat-completion
// model appropriate for grounded, structured JSON synthesis. Only used
// when neither OPENAI_SYNTHESIS_MODEL nor the legacy OPENAI_MODEL alias
// is configured.
const DEFAULT_SYNTHESIS_MODEL = "gpt-4o-mini";

export function getConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return {
    ...parsed.data,
    WEBEX_SCOPES: parsed.data.WEBEX_SCOPES ?? DEFAULT_WEBEX_SCOPES,
    // OPENAI_MODEL is accepted as a backward-compatible alias only for
    // synthesis — its historical meaning in this codebase was always
    // "the chat/completions model", never the embedding model.
    OPENAI_SYNTHESIS_MODEL: parsed.data.OPENAI_SYNTHESIS_MODEL ?? parsed.data.OPENAI_MODEL ?? DEFAULT_SYNTHESIS_MODEL,
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
    ),
    hasSerpApi: Boolean(parsed.data.SEARCH_API_KEY && parsed.data.SEARCH_PROVIDER === "serpapi")
  };
}
