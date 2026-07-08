import ResearchWorkspace from "@/components/ResearchWorkspace";
import Image from "next/image";

export default function Home() {
  return (
    <main className="shell">
      <section className="jack-hero" aria-label="Jack hero">
        <div className="jack-image-frame">
          <Image
            src="/jack.jpg"
            alt="Jack"
            width={720}
            height={420}
            className="jack-image"
            priority
            unoptimized
          />
        </div>
        <p className="jack-headline">YO JACK IS SICK!!!</p>
        <p className="asset-todo">
          TODO: place the attached chat image at <code>public/jack.jpg</code>. No image asset was present in the repository.
        </p>
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
