"use client";

import { useEffect, useState } from "react";

/**
 * Per-lane Webex space picker. Lets the user choose a real Webex space as the
 * delivery destination for a lane — required for the technical lane when the
 * recipient is the connected user (a 1:1 self-DM is not allowed). Reads/writes
 * via /api/webex/spaces; never handles tokens. Surfaces a precise scope
 * deficiency (reconnect required) rather than failing silently.
 */

type Space = { id: string; title: string };
type Lane = "sales" | "technical";
type SelectedSpace = { roomId: string; title: string | null };
type SpacesResponse = {
  spaces: Space[];
  selected: Partial<Record<Lane, SelectedSpace>>;
  error: string | null;
  scope_required: string | null;
};

const LANES: Array<{ lane: Lane; label: string }> = [
  { lane: "technical", label: "Technical / Specialist lane" },
  { lane: "sales", label: "Sales / Commercial lane" }
];

export function WebexSpacePicker() {
  const [data, setData] = useState<SpacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingLane, setSavingLane] = useState<Lane | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/webex/spaces")
      .then((r) => r.json())
      .then((d: SpacesResponse) => setData(d))
      .catch(() => setData({ spaces: [], selected: {}, error: "Could not load Webex spaces.", scope_required: null }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Deferred to a microtask so this is not a synchronous setState within the
    // effect body itself (same pattern as SignalAgentWorkspace).
    void Promise.resolve().then(load);
  }, []);

  async function selectSpace(lane: Lane, roomId: string) {
    setSavingLane(lane);
    const space = data?.spaces.find((s) => s.id === roomId) ?? null;
    try {
      const res = await fetch("/api/webex/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane, room_id: roomId || null, title: space?.title ?? null })
      });
      const body = await res.json();
      if (res.ok) setData((prev) => (prev ? { ...prev, selected: body.selected } : prev));
    } finally {
      setSavingLane(null);
    }
  }

  return (
    <div className="space-picker">
      <span className="muted" style={{ fontSize: "0.82rem" }}>
        Deliver a lane to a Webex space (required for a lane whose recipient is you — a 1:1 message to yourself is blocked).
      </span>

      {loading && <p className="muted">Loading spaces…</p>}

      {data?.error && (
        <p className="warning slim" style={{ marginTop: 8 }}>
          {data.error}
          {data.scope_required && (
            <>
              {" "}
              <a href="/api/webex/oauth/start">Reconnect Webex</a>.
            </>
          )}
        </p>
      )}

      {!loading && !data?.error && data && data.spaces.length === 0 && (
        <p className="muted">No group spaces found for the connected Webex user.</p>
      )}

      {!loading && data && data.spaces.length > 0 && (
        <div className="summary-grid" style={{ marginTop: 8 }}>
          {LANES.map(({ lane, label }) => {
            const selected = data.selected?.[lane]?.roomId ?? "";
            return (
              <label key={lane} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="muted">{label}</span>
                <select
                  className="input"
                  value={selected}
                  disabled={savingLane === lane}
                  onChange={(e) => void selectSpace(lane, e.target.value)}
                >
                  <option value="">— Use routed recipient (no space) —</option>
                  {data.spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
