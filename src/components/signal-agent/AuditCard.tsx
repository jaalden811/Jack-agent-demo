"use client";

import { useEffect, useState } from "react";
import type { AuditSummary, SignalAgentRunResult } from "@/lib/signal-agent/types";

export function AuditCard({ latestAudit, refreshToken }: { latestAudit: SignalAgentRunResult["audit"] | null; refreshToken: number }) {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/signal-agent/audit?limit=5")
      .then((response) => response.json())
      .then((data: AuditSummary) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // refreshToken changes after every run, forcing a refetch.
  }, [refreshToken]);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Audit log</h2>
          <p className="muted">Every run — HIGH_INTENT, REVIEW, or NOISE — appends one record here.</p>
        </div>
      </div>

      {latestAudit && (
        <div className={`warning slim ${latestAudit.logged ? "audit-ok" : ""}`}>
          {latestAudit.logged ? "This run was logged to " : "This run was NOT logged — "}
          <code>{latestAudit.path}</code>
          {latestAudit.warning ? ` — ${latestAudit.warning}` : ""}
        </div>
      )}

      {loadError && <p className="muted">Could not load the audit summary.</p>}

      {summary && summary.available ? (
        <>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {summary.totalRecords} total record{summary.totalRecords === 1 ? "" : "s"} on disk. Showing the most recent{" "}
            {summary.records.length}.
          </p>
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Account</th>
                  <th>Verdict</th>
                  <th>Pain category</th>
                  <th>Specialist</th>
                </tr>
              </thead>
              <tbody>
                {summary.records.map((record, index) => (
                  <tr key={index}>
                    <td>{String(record.timestamp ?? "—")}</td>
                    <td>{String(record.account ?? "—")}</td>
                    <td>{String(record.intent_label ?? "—")}</td>
                    <td>{String(record.pain_category_label ?? "—")}</td>
                    <td>{String(record.recommended_specialist ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">{summary?.warning ?? "No audit records yet — run the agent to create the first one."}</p>
      )}
    </section>
  );
}
