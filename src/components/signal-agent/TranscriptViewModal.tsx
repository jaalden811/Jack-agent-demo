import type { TranscriptMeta } from "@/lib/signal-agent/types";
import { Modal } from "@/components/signal-agent/Modal";

export function TranscriptViewModal({ meta, onClose }: { meta: TranscriptMeta; onClose: () => void }) {
  return (
    <Modal title={meta.title ?? "Transcript"} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Account: {meta.account ?? "Not stated"} · {meta.participant_count} participant(s) · {meta.sentence_count} sentence(s) analyzed
      </p>
      <pre className="raw-json transcript-view">{meta.raw_text}</pre>
    </Modal>
  );
}
