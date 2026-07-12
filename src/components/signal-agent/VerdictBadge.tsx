export function VerdictBadge({ verdict }: { verdict: "HIGH_INTENT" | "REVIEW" | "NOISE" }) {
  const label = verdict === "HIGH_INTENT" ? "High intent" : verdict === "REVIEW" ? "Needs human review" : "Noise — suppressed";
  return <span className={`verdict-badge verdict-${verdict.toLowerCase()}`}>{label}</span>;
}
