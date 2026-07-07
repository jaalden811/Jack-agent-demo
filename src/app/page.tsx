import ResearchWorkspace from "@/components/ResearchWorkspace";

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <h1>Cisco Market + Buyer Intelligence Agent</h1>
        <p>
          Enter a Cisco product and target market to generate source-backed account recommendations,
          buyer-role hypotheses, pain-point evidence, confidence scoring, and exportable reports. The
          app defaults to public-source-only research and marks unverifiable contact data instead of
          inventing it.
        </p>
      </section>
      <ResearchWorkspace />
    </main>
  );
}
