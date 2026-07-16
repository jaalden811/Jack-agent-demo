/** Local product-value analytics events. ONLY observable events — never a
 * message open/read (Webex/Outlook don't reliably provide that). */

export type ProductEventType =
  | "profile_created"
  | "profile_updated"
  | "alert_generated"
  | "alert_suppressed"
  | "alert_delivered"
  | "full_brief_opened"
  | "progressive_section_opened"
  | "assistant_question_asked"
  | "public_research_requested"
  | "pursue_selected"
  | "need_more_information_selected"
  | "not_now_selected"
  | "pass_selected"
  | "action_accepted"
  | "action_completed";

export const VALID_PRODUCT_EVENT_TYPES: readonly ProductEventType[] = [
  "profile_created",
  "profile_updated",
  "alert_generated",
  "alert_suppressed",
  "alert_delivered",
  "full_brief_opened",
  "progressive_section_opened",
  "assistant_question_asked",
  "public_research_requested",
  "pursue_selected",
  "need_more_information_selected",
  "not_now_selected",
  "pass_selected",
  "action_accepted",
  "action_completed"
];

export type ProductEvent = {
  event_id: string;
  type: ProductEventType;
  timestamp: string;
  run_id: string | null;
  account: string | null;
  profile_id: string | null;
  metadata: Record<string, unknown>;
};

export type AnalyticsSummary = {
  total_events: number;
  alerts_generated: number;
  alerts_suppressed: number;
  pursue_rate: number;
  action_acceptance: number;
  action_completion: number;
  assistant_questions: number;
  public_research_requests: number;
  avg_personal_relevance: number | null;
  top_suppression_reasons: Array<{ reason: string; count: number }>;
  top_seller_objectives: Array<{ objective_id: string; count: number }>;
};
