import ResearchWorkspace from "@/components/ResearchWorkspace";

export default function Home() {
  return (
    <main className="shell">
      <section className="jack-hero" aria-label="Jack hero">
        <div className="jack-image-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/jack.jpg" alt="Jack" width={700} height={420} className="jack-image" />
        </div>
        <p className="jack-headline">YO JACK IS SICK!!!</p>
      </section>
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
