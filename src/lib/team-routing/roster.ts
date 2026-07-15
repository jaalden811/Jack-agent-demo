import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Team roster (Phase 4). Loaded from configuration — no person is
 * hard-coded in TypeScript. The deterministic router selects real people
 * from this roster; Circuit only recommends role families. Inactive
 * members and anyone outside the roster are never selected.
 */

export type RosterLane = "sales" | "technical" | "specialist" | "leadership" | "operations";

export type RosterMember = {
  person_id: string;
  name: string;
  emails: string[];
  webex_email: string | null;
  title: string;
  role_family: string;
  lane: RosterLane;
  specialties: string[];
  product_domains: string[];
  accounts: string[];
  territories: string[];
  manager_person_id: string | null;
  fallback_queue: string | null;
  notification_channels: string[];
  default_webex_room_id: string | null;
  active: boolean;
};

export type Roster = { members: RosterMember[] };

const ROSTER_RELATIVE_PATH = "signal-agent-poc/config/team_roster.json";
let cached: Roster | null = null;

export function clearRosterCache(): void {
  cached = null;
}

export function loadRoster(): Roster {
  if (cached) return cached;
  try {
    const text = readFileSync(path.join(process.cwd(), ROSTER_RELATIVE_PATH), "utf8");
    const parsed = JSON.parse(text) as { members?: RosterMember[] };
    cached = { members: Array.isArray(parsed.members) ? parsed.members : [] };
  } catch {
    cached = { members: [] };
  }
  return cached;
}

/** Parses a roster from arbitrary JSON (upload/preview) with duplicate
 * detection and basic email validation — returns members + issues without
 * persisting. */
export function parseRoster(input: unknown): { members: RosterMember[]; issues: string[] } {
  const issues: string[] = [];
  const raw = (input && typeof input === "object" && Array.isArray((input as { members?: unknown }).members)
    ? (input as { members: unknown[] }).members
    : Array.isArray(input)
      ? (input as unknown[])
      : []) as Array<Record<string, unknown>>;

  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const members: RosterMember[] = [];
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const r of raw) {
    const person_id = String(r.person_id ?? "").trim();
    const name = String(r.name ?? "").trim();
    const emails = Array.isArray(r.emails) ? r.emails.map((e) => String(e).trim()).filter(Boolean) : [];
    if (!person_id || !name) {
      issues.push(`skipped a member missing person_id or name`);
      continue;
    }
    if (seenIds.has(person_id)) {
      issues.push(`duplicate person_id: ${person_id}`);
      continue;
    }
    seenIds.add(person_id);
    for (const e of emails) {
      if (!emailRe.test(e)) issues.push(`invalid email for ${person_id}: ${e}`);
      else if (seenEmails.has(e.toLowerCase())) issues.push(`duplicate email: ${e}`);
      else seenEmails.add(e.toLowerCase());
    }
    members.push({
      person_id,
      name,
      emails,
      webex_email: r.webex_email ? String(r.webex_email) : null,
      title: String(r.title ?? ""),
      role_family: String(r.role_family ?? "unknown"),
      lane: (["sales", "technical", "specialist", "leadership", "operations"].includes(String(r.lane)) ? String(r.lane) : "specialist") as RosterLane,
      specialties: Array.isArray(r.specialties) ? r.specialties.map(String) : [],
      product_domains: Array.isArray(r.product_domains) ? r.product_domains.map(String) : [],
      accounts: Array.isArray(r.accounts) ? r.accounts.map(String) : [],
      territories: Array.isArray(r.territories) ? r.territories.map(String) : [],
      manager_person_id: r.manager_person_id ? String(r.manager_person_id) : null,
      fallback_queue: r.fallback_queue ? String(r.fallback_queue) : null,
      notification_channels: Array.isArray(r.notification_channels) ? r.notification_channels.map(String) : ["webex"],
      default_webex_room_id: r.default_webex_room_id ? String(r.default_webex_room_id) : null,
      active: r.active !== false
    });
  }
  return { members, issues };
}

export function activeMembers(roster: Roster = loadRoster()): RosterMember[] {
  return roster.members.filter((m) => m.active);
}

/** Matches a name/email to a roster member (email exact-match first, then
 * case-insensitive full-name). Returns null when no confident match. */
export function matchRosterMember(params: { name?: string | null; email?: string | null }, roster: Roster = loadRoster()): RosterMember | null {
  const email = params.email?.trim().toLowerCase();
  if (email) {
    const byEmail = roster.members.find((m) => m.emails.some((e) => e.toLowerCase() === email) || m.webex_email?.toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = params.name?.trim().toLowerCase();
  if (name) {
    const byName = roster.members.find((m) => m.name.toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}
