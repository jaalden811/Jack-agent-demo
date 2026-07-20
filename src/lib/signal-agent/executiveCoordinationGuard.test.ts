import { describe, expect, it } from "vitest";
import { detectExecutiveCoordinationTrigger } from "@/lib/signal-agent/executiveCoordinationGuard";

/**
 * The executive-coordination guard must fire ONLY on an explicit customer signal
 * (a requested exec meeting or a leadership-level block) — never on distributed
 * authority, a committee, a board target, an economic buyer being unknown, or an
 * executive merely attending. Generic phrasing only; no fixture literals.
 */
describe("detectExecutiveCoordinationTrigger", () => {
  it("fires EXEC_MEETING_REQUESTED when the customer requests executive-to-executive engagement", () => {
    for (const s of [
      "Our CIO would like to meet with your leadership before we commit.",
      "Can we set up an executive briefing?",
      "We'd want an exec-to-exec conversation on this.",
      "Bring in your VP for a board-level discussion."
    ]) {
      expect(detectExecutiveCoordinationTrigger([s])?.code, s).toBe("EXEC_MEETING_REQUESTED");
    }
  });

  it("fires EXEC_ALIGNMENT_BLOCKED when the decision is stalled at leadership", () => {
    for (const s of [
      "We can't get alignment at leadership on this.",
      "It's stalled at the committee and needs to be escalated to leadership.",
      "This is politically blocked right now."
    ]) {
      expect(detectExecutiveCoordinationTrigger([s])?.code, s).toBe("EXEC_ALIGNMENT_BLOCKED");
    }
  });

  it("does NOT fire on distributed authority / committee / board / exec attendance alone", () => {
    for (const s of [
      "The committee approves strategic investments and finance validates the model.",
      "Our board has asked us to reduce the time to executive understanding.",
      "There is no single approver; several teams hold budget.",
      "Our CISO attended to review the security angle.",
      "Procurement comes after technical validation."
    ]) {
      expect(detectExecutiveCoordinationTrigger([s]), s).toBeNull();
    }
  });
});
