/** Pursuit feedback + value-capture types. Distinct from the existing
 * action-feedback (accept/assign/defer/...) — captures the recipient's
 * intent to pursue, which is a different product signal. */

export type PursuitDecision = "pursue" | "need_more_information" | "not_now" | "pass";

export type PursuitActionStatus = "recommended" | "accepted" | "in_progress" | "completed" | "deferred" | "rejected";

export type OpportunityFeedback = {
  feedback_id: string;
  run_id: string;
  account: string;
  opportunity_motion_id: string;
  profile_id: string | null;
  decision: PursuitDecision;
  reason_code: string | null;
  free_text: string | null;
  timestamp: string;
  next_review_at: string | null;
  action_status: PursuitActionStatus;
};

export const VALID_PURSUIT_DECISIONS: readonly PursuitDecision[] = ["pursue", "need_more_information", "not_now", "pass"];

/** Maps a pursuit decision to the resulting action status. Pursue accepts the
 * Next Best Action; the others carry distinct product meaning. */
export function actionStatusForDecision(decision: PursuitDecision): PursuitActionStatus {
  switch (decision) {
    case "pursue":
      return "accepted";
    case "need_more_information":
      return "recommended";
    case "not_now":
      return "deferred";
    case "pass":
      return "rejected";
  }
}
