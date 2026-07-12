"use client";

import { useState } from "react";
import type { CatalogResponse } from "@/lib/signal-agent/types";
import { Modal } from "@/components/signal-agent/Modal";
import { TaxonomyDrawer } from "@/components/signal-agent/TaxonomyDrawer";

function ScoringConfigModal({ catalog, onClose }: { catalog: CatalogResponse; onClose: () => void }) {
  return (
    <Modal title="Scoring configuration" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Read live from <code>matching_configuration</code> in {catalog.source_path}. Every weight and threshold the engine uses comes from
        this block — nothing is re-typed as a literal in application code.
      </p>
      <pre className="raw-json">{JSON.stringify(catalog.matching_configuration, null, 2)}</pre>
    </Modal>
  );
}

function SourceCatalogModal({ catalog, onClose }: { catalog: CatalogResponse; onClose: () => void }) {
  const entries = Object.entries(catalog.source_catalog);
  return (
    <Modal title={`Source catalog (${entries.length} products)`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Public documentation references only — never a live API endpoint the app calls.
      </p>
      <ul className="compact-list">
        {entries.map(([name, url]) => (
          <li key={name}>
            <strong>{name}</strong> —{" "}
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ReferencePackPanel({
  catalog,
  reportLoaded,
  onReload
}: {
  catalog: CatalogResponse | null;
  reportLoaded: boolean;
  onReload: () => void;
}) {
  const [openModal, setOpenModal] = useState<"taxonomy" | "scoring" | "source" | null>(null);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Reference pack</h2>
          <p className="muted">The active source of truth for every category, product, specialist, weight, and threshold in this app.</p>
        </div>
      </div>

      {catalog ? (
        <div className="reference-grid">
          <div className="reference-card">
            <strong>Cisco Pain-Point to Solution Mapping Dictionary</strong>
            <span className="muted">
              File: <code>{catalog.source_path}</code>
            </span>
            <span className="muted">Version: {catalog.metadata?.version ?? "unknown"}</span>
            <span className="muted">As of: {catalog.metadata?.asOf ?? "unknown"}</span>
            <span className="muted">Category count: {catalog.entry_count}</span>
            {catalog.matching_configuration && (
              <span className="muted">
                Matching formula: {(catalog.matching_configuration as { final_formula?: string }).final_formula ?? "not specified"}
              </span>
            )}
          </div>
          <div className="reference-card">
            <strong>Cisco Portfolio Pain-Point → Solution Mapping Report</strong>
            <span className="muted">File: signal-agent-poc/docs/cisco_portfolio_painpoint_mapping_report.md</span>
            <span className={reportLoaded ? "provider-yes" : "provider-no"}>{reportLoaded ? "Status: Loaded" : "Status: Not loaded"}</span>
            <span className="muted">Purpose: Product-role disambiguation and taxonomy methodology.</span>
          </div>
        </div>
      ) : (
        <p className="muted">Loading reference pack…</p>
      )}

      <div className="actions">
        <button type="button" className="button secondary" onClick={() => setOpenModal("taxonomy")} disabled={!catalog}>
          View taxonomy
        </button>
        <button type="button" className="button secondary" onClick={() => setOpenModal("scoring")} disabled={!catalog}>
          View scoring configuration
        </button>
        <button type="button" className="button secondary" onClick={() => setOpenModal("source")} disabled={!catalog}>
          View source catalog
        </button>
        <button type="button" className="button secondary" onClick={onReload}>
          Reload reference pack
        </button>
      </div>

      {openModal === "taxonomy" && <TaxonomyDrawer catalog={catalog} onClose={() => setOpenModal(null)} />}
      {openModal === "scoring" && catalog && <ScoringConfigModal catalog={catalog} onClose={() => setOpenModal(null)} />}
      {openModal === "source" && catalog && <SourceCatalogModal catalog={catalog} onClose={() => setOpenModal(null)} />}
    </section>
  );
}
