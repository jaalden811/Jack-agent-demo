import type { IngestedTranscript, ParticipantRecord, StakeholderOwnershipType, StakeholderRecord } from "@/lib/signal-agent/types";

/**
 * Three-tier stakeholder model (Section 3 of the transcript-analysis
 * repair): every function here is generic and product-agnostic —
 * nothing here references a Cisco/Splunk product or taxonomy category.
 *
 *   A. Call participants        — @/lib/signal-agent/transcript's ParticipantRecord[]
 *   B. Explicitly named stakeholders — a named, customer-side participant
 *      with a discernible role/title, or explicitly identified in
 *      dialogue as responsible/approving/operating/required for a next step.
 *   C. Inferred functional owners — a function that appears responsible
 *      from generic organizational-role language in the dialogue, with
 *      no individual definitively named. `name` is always null here —
 *      a function is never promoted to a fabricated person.
 */

// Ownership classification is shared by explicit-stakeholder title
// parsing and functional-owner inference — same keyword-group mechanism
// used throughout this codebase (e.g. peachtreeRouting.ts's SIGNAL_PATTERNS),
// detecting a *linguistic* signal, never a specific person or product.
const OWNERSHIP_KEYWORD_GROUPS: Array<{ type: StakeholderOwnershipType; keywords: string[] }> = [
  { type: "executive", keywords: ["chief", "cio", "cto", "ceo", "cfo", "evp", "svp", "president", "executive"] },
  { type: "security_architecture", keywords: ["security architect", "security architecture"] },
  { type: "enterprise_architecture", keywords: ["enterprise architect", "enterprise architecture"] },
  { type: "cloud_platform", keywords: ["cloud platform", "cloud engineering", "cloud operations"] },
  { type: "reliability", keywords: ["reliability", "site reliability", "sre"] },
  { type: "finance_vendor_management", keywords: ["finance", "vendor management", "procurement", "sourcing", "fp&a"] },
  { type: "itsm", keywords: ["service management", "itsm", "servicenow"] },
  { type: "security", keywords: ["security", "ciso", "soc"] },
  { type: "infrastructure", keywords: ["infrastructure"] },
  { type: "application", keywords: ["application", "platform", "product", "app "] },
  { type: "technical", keywords: ["engineer", "architect", "technical", "engineering"] },
  { type: "operational", keywords: ["operations", "vp", "director", "manager", "ops"] }
];

export function classifyOwnership(role: string): StakeholderOwnershipType {
  const lower = role.toLowerCase();
  for (const group of OWNERSHIP_KEYWORD_GROUPS) {
    const matched = group.keywords.some((keyword) => {
      // Require a word boundary immediately before the keyword (but not
      // necessarily after) — this still lets "engineer" match inside
      // "engineering", while preventing short acronym-like keywords
      // (e.g. "cto", "vp") from false-positive matching mid-word
      // substrings such as "director".
      const pattern = new RegExp(`\\b${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      return pattern.test(lower);
    });
    if (matched) return group.type;
  }
  return "operational";
}

function formatLocation(record: ParticipantRecord, transcript: IngestedTranscript): string | null {
  if (record.firstEvidenceIndex === null) return null;
  const sentence = transcript.sentences[record.firstEvidenceIndex];
  return sentence?.timestamp ?? `turn ${record.firstEvidenceIndex + 1}`;
}

function firstEvidenceQuote(record: ParticipantRecord, transcript: IngestedTranscript): string | null {
  if (record.firstEvidenceIndex === null) return null;
  return transcript.sentences[record.firstEvidenceIndex]?.text ?? null;
}

/** Tier B: every customer-side participant with a name AND a
 * discernible role — either from a header/participant line or from
 * having spoken — is an explicitly named stakeholder. Vendor-side
 * participants (Cisco sellers) are never included here, regardless of
 * how often they spoke. */
export function extractNamedStakeholders(transcript: IngestedTranscript): StakeholderRecord[] {
  const stakeholders: StakeholderRecord[] = [];

  for (const record of transcript.participantRecords) {
    if (record.classification !== "customer") continue;
    if (!record.title && record.turnCount === 0) continue; // no evidence this person exists beyond a bare name

    const role = record.title ?? "Customer stakeholder";
    const evidence = firstEvidenceQuote(record, transcript) ?? `${record.name} is listed as a call participant (${role}).`;
    const confidence = record.title && record.turnCount > 0 ? 0.9 : record.title ? 0.7 : 0.55;

    stakeholders.push({
      name: record.name,
      function_or_role: role,
      ownership_type: classifyOwnership(role),
      tier: "explicit",
      evidence,
      location: formatLocation(record, transcript),
      confidence,
      why_it_matters: `${record.name} (${role}) is a named customer-side participant with visibility into this opportunity.`
    });
  }

  return stakeholders;
}

// Generic organizational-function mentions that suggest a responsible
// function even when no individual is named for it. Every phrase here
// detects a *linguistic* signal about an organizational function, never
// a specific product or person.
const FUNCTIONAL_OWNER_PATTERNS: Array<{ function_name: string; ownership_type: StakeholderOwnershipType; patterns: RegExp[] }> = [
  {
    function_name: "Platform Reliability",
    ownership_type: "reliability",
    patterns: [/\b(reliability|sre|site reliability)\s+(team|group|org|function)\b/i]
  },
  {
    function_name: "Enterprise Architecture",
    ownership_type: "enterprise_architecture",
    patterns: [
      /\benterprise architecture\s+(team|group|board|review)\b/i,
      /\barchitecture review board\b/i,
      // "Enterprise Architecture ... design authority / sign off / review"
      // — the same organizational function described by decision-authority
      // language rather than a "team/group/board" noun suffix.
      /\benterprise architecture\b[^.!?]{0,60}\b(design authority|sign off|signs off|review)\b/i
    ]
  },
  {
    function_name: "Executive Sponsor (CIO)",
    ownership_type: "executive",
    patterns: [/\b(cio|chief information officer)\b/i]
  },
  {
    function_name: "Budget Authority (VP)",
    ownership_type: "operational",
    patterns: [/\bvp\b[^.!?]{0,60}\bbudget\b/i, /\bbudget\b[^.!?]{0,60}\bvp\b/i]
  },
  {
    function_name: "Security Authority (CISO)",
    ownership_type: "security",
    patterns: [/\b(ciso|chief information security officer)\b/i]
  },
  {
    function_name: "Security Architecture",
    ownership_type: "security_architecture",
    patterns: [/\bsecurity architecture\s+(team|group|function)\b/i]
  },
  {
    function_name: "Security Operations",
    ownership_type: "security",
    patterns: [/\b(security operations|soc)\s+(team|group|function)\b/i]
  },
  {
    function_name: "Cloud Platform",
    ownership_type: "cloud_platform",
    patterns: [/\bcloud (platform|engineering)(\s+\w+){0,2}\s+(team|group|function)\b/i]
  },
  {
    function_name: "Infrastructure Operations",
    ownership_type: "infrastructure",
    patterns: [/\binfrastructure\s+(team|group|operations)\b/i]
  },
  {
    function_name: "Application Development",
    ownership_type: "application",
    patterns: [/\b(application|app)\s+(development|engineering)\s+(team|group)\b/i]
  },
  {
    function_name: "Finance / Vendor Management",
    ownership_type: "finance_vendor_management",
    patterns: [/\bfinance\s+(team|group|estimated)\b/i, /\bvendor management\s+(team|group|office)?\b/i, /\bprocurement\s+(team|group)\b/i]
  },
  {
    function_name: "IT Service Management",
    ownership_type: "itsm",
    patterns: [/\b(it service management|itsm)\s+(team|group|process)?\b/i, /\bservicenow\s+(team|workflow)\b/i]
  }
];

/** Tier C: scans for generic organizational-function language that was
 * NOT already attributed to a named stakeholder above. Never invents a
 * person's name — `name` is always null. */
export function inferFunctionalOwners(transcript: IngestedTranscript, namedStakeholders: StakeholderRecord[]): StakeholderRecord[] {
  const alreadyNamedFunctions = new Set(namedStakeholders.map((s) => s.ownership_type));
  const owners: StakeholderRecord[] = [];
  const seenFunctions = new Set<string>();

  for (const chunk of transcript.chunks) {
    for (const def of FUNCTIONAL_OWNER_PATTERNS) {
      if (seenFunctions.has(def.function_name)) continue;
      const matched = def.patterns.find((pattern) => pattern.test(chunk.text));
      if (!matched) continue;

      seenFunctions.add(def.function_name);
      owners.push({
        name: null,
        function_or_role: def.function_name,
        ownership_type: def.ownership_type,
        tier: "inferred_functional",
        evidence: chunk.text,
        location: chunk.timestamp ?? `turn ${chunk.index + 1}`,
        // Lower confidence than a named stakeholder with the same
        // function, since no individual was identified; even lower if a
        // named stakeholder already covers this exact ownership type
        // (the function is likely already represented by a named person).
        confidence: alreadyNamedFunctions.has(def.ownership_type) ? 0.35 : 0.55,
        why_it_matters: `${def.function_name} appears responsible for this workstream, but no individual was named in the transcript — flag for discovery.`
      });
    }
  }

  return owners;
}
