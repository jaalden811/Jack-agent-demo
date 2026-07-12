const STEPS = [
  "Transcript",
  "Signal Extraction",
  "Pain Classification",
  "Portfolio Validation",
  "Scoring",
  "Specialist Routing",
  "Internal Notification",
  "Audit Log"
];

export function ArchitectureFlow() {
  return (
    <div className="flow-strip" aria-label="Signal-to-Solution architecture flow">
      {STEPS.map((step, index) => (
        <div className="flow-step" key={step}>
          <span className="flow-step-index">{index + 1}</span>
          <span>{step}</span>
          {index < STEPS.length - 1 && <span className="flow-arrow" aria-hidden="true">→</span>}
        </div>
      ))}
    </div>
  );
}
