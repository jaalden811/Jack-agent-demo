"use client";

import { useEffect, useState } from "react";
import type { SellerProfile } from "@/lib/personalization/types";
import { SellerProfileWizard } from "@/components/signal-agent/SellerProfileWizard";

/**
 * First-run landing menu (Section: "a menu before you even select anything").
 * Before the first analysis, invites the user to configure their seller
 * profile — who they are, location, goals, and how they're measured — so
 * alerts are ranked and worded to their goals. Skippable (personalization
 * then degrades gracefully). Disappears once a profile exists.
 */
export function FirstRunMenu({ onConfigured }: { onConfigured?: () => void }) {
  const [state, setState] = useState<"loading" | "needs_setup" | "configuring" | "done">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/signal-agent/seller-profile")
      .then((r) => r.json())
      .then((j: { profile: SellerProfile | null }) => {
        if (!active) return;
        setState(j.profile && j.profile.active ? "done" : "needs_setup");
      })
      .catch(() => active && setState("needs_setup"));
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading" || state === "done") return null;

  return (
    <section className="panel first-run-menu" aria-label="Get started">
      <div className="summary-headline" style={{ flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: "1.05rem" }}>Start here — set up your seller profile</strong>
        <span className="topbar-pill pending">personalization</span>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        Tell the agent who you are — location, role, your goals, and how you&apos;re measured. Then every alert is ranked and written to <strong>your</strong> goals (e.g. &ldquo;this maps to your security-expansion goal&rdquo; or &ldquo;≈ 12% of your annual target&rdquo;) instead of a generic tag dump. You can skip it, but relevance and quota-impact will be limited.
      </p>

      {state === "needs_setup" && (
        <div className="chip-row" style={{ marginTop: 8 }}>
          <button type="button" className="button primary" onClick={() => setState("configuring")}>Set up my profile</button>
          <button type="button" className="button secondary" onClick={() => setState("done")}>Skip for now</button>
        </div>
      )}

      {state === "configuring" && (
        <div style={{ marginTop: 10 }}>
          <SellerProfileWizard
            onSaved={() => {
              setState("done");
              onConfigured?.();
            }}
            onSkip={() => setState("done")}
          />
        </div>
      )}
    </section>
  );
}
