export function RawJsonPanel({ title, data }: { title: string; data: unknown }) {
  return (
    <details className="debug-panel">
      <summary>{title} (debugging only)</summary>
      <div className="debug-body">
        <pre className="raw-json">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </details>
  );
}
