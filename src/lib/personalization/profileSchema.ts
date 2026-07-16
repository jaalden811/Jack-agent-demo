import { z } from "zod";
import type { SafeSellerProfile, SellerProfile } from "@/lib/personalization/types";

/**
 * Zod validation + normalization for the seller profile. Private
 * compensation context is validated but NEVER leaves the server for other
 * recipients (see toSafeProfile). Profiles persist by person_id or
 * normalized internal email.
 */

export const PROFILE_SCHEMA_VERSION = "seller-profile-v1";

const goalSchema = z.object({
  goal_id: z.string().min(1),
  weight: z.number().min(0).max(1).default(0.5),
  target: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  timeframe: z.enum(["quarter", "year", "rolling"]).default("year")
});

const compensationSchema = z
  .object({
    currency: z.string().nullable().default(null),
    annual_target: z.number().positive().nullable().default(null),
    current_attainment: z.number().min(0).nullable().default(null),
    pipeline_coverage_target: z.number().positive().nullable().default(null),
    minimum_opportunity_value: z.number().min(0).nullable().default(null),
    private: z.literal(true).default(true)
  })
  .default({ currency: null, annual_target: null, current_attainment: null, pipeline_coverage_target: null, minimum_opportunity_value: null, private: true });

const notificationPreferencesSchema = z
  .object({
    mode: z.enum(["immediate", "in_app_only", "daily_digest"]).default("immediate"),
    quiet_hours: z.object({ enabled: z.boolean().default(false), start: z.string().default("20:00"), end: z.string().default("07:00") }).default({ enabled: false, start: "20:00", end: "07:00" }),
    max_immediate_per_day: z.number().int().positive().nullable().default(null),
    min_personal_relevance: z.number().min(0).max(100).nullable().default(null),
    min_signal_strength: z.number().min(0).max(1).nullable().default(null),
    alert_on_review: z.boolean().default(true),
    alert_on_high_intent: z.boolean().default(true),
    never_alert_on_noise: z.boolean().default(true),
    message_density: z.enum(["concise", "standard", "detailed"]).default("standard"),
    tone: z.enum(["executive", "commercial", "technical", "neutral"]).default("neutral"),
    channels: z.array(z.enum(["webex", "outlook", "in_app"])).default(["in_app"])
  })
  .default({
    mode: "immediate",
    quiet_hours: { enabled: false, start: "20:00", end: "07:00" },
    max_immediate_per_day: null,
    min_personal_relevance: null,
    min_signal_strength: null,
    alert_on_review: true,
    alert_on_high_intent: true,
    never_alert_on_noise: true,
    message_density: "standard",
    tone: "neutral",
    channels: ["in_app"]
  });

const strList = z.array(z.string().min(1)).default([]);

/** Input schema — tolerant of partial input from the setup wizard. */
export const sellerProfileInputSchema = z.object({
  profile_id: z.string().min(1).optional(),
  person_id: z.string().min(1).nullable().default(null),
  display_name: z.string().min(1),
  email: z.string().email(),
  title: z.string().nullable().default(null),
  role_family: z.string().min(1).default("sales"),
  lane: z.enum(["sales", "technical", "specialist", "leadership", "operations"]).default("sales"),
  location: z.string().nullable().default(null),
  geographies: strList,
  territories: strList,
  segments: strList,
  specialties: strList,
  product_domains: strList,
  assigned_account_types: strList,
  measurement_metrics: strList,
  goals: z.array(goalSchema).default([]),
  compensation_context: compensationSchema,
  notification_preferences: notificationPreferencesSchema,
  active: z.boolean().default(true)
});

export type SellerProfileInput = z.input<typeof sellerProfileInputSchema>;

/** Normalized internal email -> deterministic key (lowercased, trimmed). */
export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Deterministic profile id from person_id or normalized email. */
export function profileIdFor(input: { person_id?: string | null; email: string }): string {
  if (input.person_id && input.person_id.trim()) return `person:${input.person_id.trim()}`;
  return `email:${normalizeEmailKey(input.email)}`;
}

/** 0..1 completeness over the fields that materially improve personalization. */
export function computeProfileCompleteness(p: SellerProfile): number {
  const checks = [
    Boolean(p.display_name),
    Boolean(p.email),
    Boolean(p.role_family),
    Boolean(p.lane),
    p.territories.length > 0,
    p.segments.length > 0,
    p.specialties.length > 0,
    p.product_domains.length > 0,
    p.measurement_metrics.length > 0,
    p.goals.length > 0
  ];
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100) / 100;
}

/** Validate + normalize wizard input into a persisted profile (fills
 * schema_version/timestamps/completeness). Throws ZodError on invalid input. */
export function normalizeSellerProfile(rawInput: unknown, existing?: SellerProfile | null): SellerProfile {
  const parsed = sellerProfileInputSchema.parse(rawInput);
  const now = new Date().toISOString();
  const profile_id = parsed.profile_id ?? existing?.profile_id ?? profileIdFor({ person_id: parsed.person_id, email: parsed.email });
  const base: SellerProfile = {
    profile_id,
    person_id: parsed.person_id,
    display_name: parsed.display_name,
    email: parsed.email,
    title: parsed.title,
    role_family: parsed.role_family,
    lane: parsed.lane,
    location: parsed.location,
    geographies: parsed.geographies,
    territories: parsed.territories,
    segments: parsed.segments,
    specialties: parsed.specialties,
    product_domains: parsed.product_domains,
    assigned_account_types: parsed.assigned_account_types,
    measurement_metrics: parsed.measurement_metrics,
    goals: parsed.goals,
    compensation_context: parsed.compensation_context,
    notification_preferences: parsed.notification_preferences,
    version: PROFILE_SCHEMA_VERSION,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    profile_completeness: 0,
    active: parsed.active
  };
  base.profile_completeness = computeProfileCompleteness(base);
  return base;
}

/** Strip private compensation context — for any view exposed to a recipient
 * OTHER than the profile owner, shared audit exports, or public links. */
export function toSafeProfile(profile: SellerProfile): SafeSellerProfile {
  const clone = { ...profile } as Partial<SellerProfile>;
  delete clone.compensation_context;
  return clone as SafeSellerProfile;
}
