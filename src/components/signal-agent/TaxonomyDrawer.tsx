"use client";

import { useMemo, useState } from "react";
import type { CatalogResponse, CatalogWireEntry } from "@/lib/signal-agent/types";
import { Modal } from "@/components/signal-agent/Modal";

function matchesSearch(entry: CatalogWireEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.id,
    entry.domain,
    entry.pain_category,
    ...entry.keywords,
    ...entry.primary_solutions.map((solution) => solution.name),
    entry.recommended_specialist ?? ""
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/** Renders whatever entries the catalog API returns — adding a category to
 * the JSON later requires no change here. Only opens when the user
 * explicitly clicks "Taxonomy"; never shown on the page by default. */
export function TaxonomyDrawer({ catalog, onClose }: { catalog: CatalogResponse | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!catalog) return [];
    return catalog.entries.filter((entry) => (domainFilter === "all" || entry.domain === domainFilter) && matchesSearch(entry, query));
  }, [catalog, domainFilter, query]);

  const selectedEntry = useMemo(() => catalog?.entries.find((entry) => entry.id === selectedId) ?? null, [catalog, selectedId]);

  return (
    <Modal title={`Taxonomy (${catalog?.entry_count ?? 0} categories)`} onClose={onClose}>
      {!catalog ? (
        <p className="muted">Loading catalog…</p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Loaded live from <code>{catalog.source_path}</code>
            {catalog.metadata?.version ? ` (v${catalog.metadata.version})` : ""}. Nothing on this screen is hard-coded — add a category to
            the JSON and it appears here automatically.
          </p>
          <div className="taxonomy-controls">
            <input type="search" placeholder="Search by keyword, solution, or specialist…" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}>
              <option value="all">All domains ({catalog.domains.length})</option>
              {catalog.domains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </select>
          </div>

          <div className="taxonomy-layout">
            <ul className="taxonomy-list">
              {filteredEntries.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className={`taxonomy-item ${selectedId === entry.id ? "active" : ""}`} onClick={() => setSelectedId(entry.id)}>
                    <strong>{entry.pain_category}</strong>
                    <span className="muted">{entry.domain}</span>
                  </button>
                </li>
              ))}
              {filteredEntries.length === 0 && <p className="muted">No categories match this search/filter.</p>}
            </ul>

            <div className="taxonomy-detail">
              {selectedEntry ? (
                <>
                  <h3>{selectedEntry.pain_category}</h3>
                  <p className="muted">
                    {selectedEntry.domain} · <code>{selectedEntry.id}</code>
                  </p>
                  <strong>Keywords</strong>
                  <div className="chip-row">
                    {selectedEntry.keywords.map((keyword) => (
                      <span className="chip" key={keyword}>
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <strong>Semantic cues</strong>
                  <ul className="compact-list">
                    {selectedEntry.semantic_cues.map((cue) => (
                      <li key={cue}>{cue}</li>
                    ))}
                  </ul>
                  <strong>Primary solutions</strong>
                  <ul className="compact-list">
                    {selectedEntry.primary_solutions.map((solution) => (
                      <li key={solution.name}>
                        <strong>{solution.name}</strong>
                        {solution.role ? ` — ${solution.role}` : ""}
                      </li>
                    ))}
                  </ul>
                  <strong>Choose when</strong>
                  <ul className="compact-list">
                    {selectedEntry.choose_when.map((rule, index) => (
                      <li key={index}>{rule}</li>
                    ))}
                  </ul>
                  <strong>Do not choose when</strong>
                  <ul className="compact-list">
                    {selectedEntry.do_not_choose_when.map((rule, index) => (
                      <li key={index}>{rule}</li>
                    ))}
                  </ul>
                  <strong>Recommended specialist</strong>
                  <p>{selectedEntry.recommended_specialist ?? "Not configured"}</p>
                </>
              ) : (
                <p className="muted">Select a category on the left to see its full taxonomy detail.</p>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
