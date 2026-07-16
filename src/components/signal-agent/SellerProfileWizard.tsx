"use client";

import { useEffect, useState } from "react";
import type { ObjectiveDefinition, SellerProfile } from "@/lib/personalization/types";

/**
 * Compact seller-profile setup. Renders objective options from the
 * data-driven catalog (never hard-coded here). Persists server-side via
 * /api/signal-agent/seller-profile. Compensation is optional and private.
 */

function csv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function SellerProfileWizard({ onSaved, onSkip }: { onSaved?: (profile: SellerProfile) => void; onSkip?: () => void }) {
  const [objectives, setObjectives] = useState<ObjectiveDefinition[]>([]);
  const [metricsCatalog, setMetricsCatalog] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [roleFamily, setRoleFamily] = useState("sales");
  const [lane, setLane] = useState("sales");
  const [territories, setTerritories] = useState("");
  const [segments, setSegments] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [productDomains, setProductDomains] = useState("");
  const [metrics, setMetrics] = useState<string[]>([]);
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [annualTarget, setAnnualTarget] = useState("");
  const [density, setDensity] = useState("standard");
  const [tone, setTone] = useState("neutral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cat, prof] = await Promise.all([
          fetch("/api/signal-agent/objective-catalog").then((r) => r.json()),
          fetch("/api/signal-agent/seller-profile").then((r) => r.json())
        ]);
        setObjectives((cat.objectives ?? []) as ObjectiveDefinition[]);
        setMetricsCatalog((cat.measurement_metrics ?? []) as string[]);
        const p = prof.profile as SellerProfile | null;
        if (p) {
          setDisplayName(p.display_name);
          setEmail(p.email);
          setRoleFamily(p.role_family);
          setLane(p.lane);
          setTerritories(p.territories.join(", "));
          setSegments(p.segments.join(", "));
          setSpecialties(p.specialties.join(", "));
          setProductDomains(p.product_domains.join(", "));
          setMetrics(p.measurement_metrics);
          setGoalIds(p.goals.map((g) => g.goal_id));
          setAnnualTarget(p.compensation_context.annual_target ? String(p.compensation_context.annual_target) : "");
          setDensity(p.notification_preferences.message_density);
          setTone(p.notification_preferences.tone);
        }
      } catch {
        setError("Could not load the objective catalog.");
      }
    })();
  }, []);

  const toggle = (list: string[], value: string, set: (v: string[]) => void) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        display_name: displayName,
        email,
        role_family: roleFamily,
        lane,
        territories: csv(territories),
        segments: csv(segments),
        specialties: csv(specialties),
        product_domains: csv(productDomains),
        measurement_metrics: metrics,
        goals: goalIds.map((goal_id) => ({ goal_id, weight: 1, target: null, unit: null, timeframe: "year" })),
        compensation_context: { annual_target: annualTarget ? Number(annualTarget) : null, current_attainment: null, currency: "USD", pipeline_coverage_target: null, minimum_opportunity_value: null, private: true },
        notification_preferences: { message_density: density, tone }
      };
      const res = await fetch("/api/signal-agent/seller-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json()) as { profile?: SellerProfile; error?: string };
      if (!res.ok || !j.profile) throw new Error(j.error ?? "Could not save profile");
      onSaved?.(j.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  const applicableObjectives = objectives.filter((o) => o.applicable_role_families.includes(roleFamily) || o.applicable_role_families.length === 0);

  return (
    <div className="setup-step seller-wizard">
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Personalize alerts and message emphasis to your goals. You can skip this — personalization and alert relevance will be limited without it. Compensation is optional and never shared with other recipients.
      </p>

      <div className="wizard-grid">
        <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" /></label>
        <label>Internal email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@cisco.com" /></label>
        <label>Role family
          <select value={roleFamily} onChange={(e) => setRoleFamily(e.target.value)}>
            <option value="sales">sales</option><option value="specialist">specialist</option><option value="technical">technical</option><option value="leadership">leadership</option><option value="operations">operations</option>
          </select>
        </label>
        <label>Lane
          <select value={lane} onChange={(e) => setLane(e.target.value)}>
            <option value="sales">sales</option><option value="specialist">specialist</option><option value="technical">technical</option><option value="leadership">leadership</option><option value="operations">operations</option>
          </select>
        </label>
        <label>Territories<input value={territories} onChange={(e) => setTerritories(e.target.value)} placeholder="NA-West, EMEA (comma-separated)" /></label>
        <label>Segments<input value={segments} onChange={(e) => setSegments(e.target.value)} placeholder="enterprise, public sector" /></label>
        <label>Specialties<input value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="security, observability" /></label>
        <label>Product domains<input value={productDomains} onChange={(e) => setProductDomains(e.target.value)} placeholder="soc_detection_response, ..." /></label>
        <label>Annual target (optional, private)<input value={annualTarget} onChange={(e) => setAnnualTarget(e.target.value)} placeholder="e.g. 2000000" inputMode="numeric" /></label>
        <label>Message density
          <select value={density} onChange={(e) => setDensity(e.target.value)}><option value="concise">concise</option><option value="standard">standard</option><option value="detailed">detailed</option></select>
        </label>
        <label>Tone
          <select value={tone} onChange={(e) => setTone(e.target.value)}><option value="neutral">neutral</option><option value="executive">executive</option><option value="commercial">commercial</option><option value="technical">technical</option></select>
        </label>
      </div>

      <fieldset className="wizard-fieldset">
        <legend>How you are measured</legend>
        <div className="chip-row">
          {metricsCatalog.map((m) => (
            <label key={m} className={`chip ${metrics.includes(m) ? "chip-success" : "chip-muted"}`}>
              <input type="checkbox" checked={metrics.includes(m)} onChange={() => toggle(metrics, m, setMetrics)} style={{ marginRight: 4 }} />{m.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="wizard-fieldset">
        <legend>Goals (weighted equally)</legend>
        <div className="chip-row">
          {applicableObjectives.map((o) => (
            <label key={o.objective_id} className={`chip ${goalIds.includes(o.objective_id) ? "chip-success" : "chip-muted"}`} title={o.description}>
              <input type="checkbox" checked={goalIds.includes(o.objective_id)} onChange={() => toggle(goalIds, o.objective_id, setGoalIds)} style={{ marginRight: 4 }} />{o.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="chip-danger">{error}</p>}
      <div className="actions">
        <button type="button" className="button primary" onClick={save} disabled={busy || !displayName || !email}>{busy ? "Saving…" : "Save profile"}</button>
        {onSkip && <button type="button" className="button secondary" onClick={onSkip} disabled={busy}>Skip for now</button>}
      </div>
    </div>
  );
}
