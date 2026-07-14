/**
 * JSON Schemas for OpenAI Structured Outputs (Responses API
 * `text.format: { type: "json_schema", strict: true, schema }`).
 * Every property is explicitly declared, every property is listed in
 * `required` (OpenAI's strict-mode constraint), and every object sets
 * `additionalProperties: false` — per the OpenAI implementation guide.
 */

const meddpiccFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "confidence", "evidence_ids", "gaps", "next_question"],
  properties: {
    status: { type: "string", enum: ["CONFIRMED", "PARTIAL", "HYPOTHESIS", "MISSING", "CONFLICTING"] },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence_ids: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    next_question: { type: "string" }
  }
} as const;

const meddpiccSchema = {
  type: "object",
  additionalProperties: false,
  required: ["metrics", "economic_buyer", "decision_criteria", "decision_process", "paper_process", "identify_pain", "champion", "competition"],
  properties: {
    metrics: meddpiccFieldSchema,
    economic_buyer: meddpiccFieldSchema,
    decision_criteria: meddpiccFieldSchema,
    decision_process: meddpiccFieldSchema,
    paper_process: meddpiccFieldSchema,
    identify_pain: meddpiccFieldSchema,
    champion: meddpiccFieldSchema,
    competition: meddpiccFieldSchema
  }
} as const;

export const qualificationExtractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "account_candidates",
    "stakeholders",
    "commercial_signals",
    "technical_signals",
    "preliminary_meddpicc",
    "search_plan_inputs",
    "missing_information",
    "contradictions"
  ],
  properties: {
    account_candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "domain", "confidence", "evidence_ids"],
        properties: {
          name: { type: "string" },
          domain: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence_ids: { type: "array", items: { type: "string" } }
        }
      }
    },
    stakeholders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "stated_title",
          "company",
          "speaker_label",
          "functional_area",
          "buying_role",
          "buying_role_status",
          "influence",
          "sentiment",
          "commitments",
          "objections",
          "goals",
          "evidence_ids",
          "confidence"
        ],
        properties: {
          name: { type: "string" },
          stated_title: { type: ["string", "null"] },
          company: { type: ["string", "null"] },
          speaker_label: { type: ["string", "null"] },
          functional_area: {
            type: "string",
            enum: ["sales", "finance", "procurement", "executive", "networking", "security", "observability", "application", "operations", "architecture", "other"]
          },
          buying_role: {
            type: "string",
            enum: ["economic_buyer", "champion", "technical_decision_maker", "evaluator", "influencer", "procurement", "end_user", "unknown"]
          },
          buying_role_status: { type: "string", enum: ["confirmed", "probable", "hypothesis", "unknown"] },
          influence: { type: "string", enum: ["high", "medium", "low", "unknown"] },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed", "unknown"] },
          commitments: { type: "array", items: { type: "string" } },
          objections: { type: "array", items: { type: "string" } },
          goals: { type: "array", items: { type: "string" } },
          evidence_ids: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    commercial_signals: {
      type: "object",
      additionalProperties: false,
      required: ["budget", "timeline", "renewal", "procurement", "business_impact", "purchase_language", "competitor_mentions"],
      properties: {
        budget: { type: "array", items: { type: "string" } },
        timeline: { type: "array", items: { type: "string" } },
        renewal: { type: "array", items: { type: "string" } },
        procurement: { type: "array", items: { type: "string" } },
        business_impact: { type: "array", items: { type: "string" } },
        purchase_language: { type: "array", items: { type: "string" } },
        competitor_mentions: { type: "array", items: { type: "string" } }
      }
    },
    technical_signals: {
      type: "object",
      additionalProperties: false,
      required: ["current_environment", "architecture", "integrations", "operational_gaps", "success_criteria", "pilot_or_workshop_requests", "risks"],
      properties: {
        current_environment: { type: "array", items: { type: "string" } },
        architecture: { type: "array", items: { type: "string" } },
        integrations: { type: "array", items: { type: "string" } },
        operational_gaps: { type: "array", items: { type: "string" } },
        success_criteria: { type: "array", items: { type: "string" } },
        pilot_or_workshop_requests: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } }
      }
    },
    preliminary_meddpicc: meddpiccSchema,
    search_plan_inputs: {
      type: "object",
      additionalProperties: false,
      required: ["account_queries_needed", "stakeholder_queries_needed", "initiative_queries_needed", "competition_queries_needed", "incident_queries_needed"],
      properties: {
        account_queries_needed: { type: "boolean" },
        stakeholder_queries_needed: { type: "boolean" },
        initiative_queries_needed: { type: "boolean" },
        competition_queries_needed: { type: "boolean" },
        incident_queries_needed: { type: "boolean" }
      }
    },
    missing_information: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } }
  }
} as const;

export const publicEvidenceClassificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["classified_results"],
  properties: {
    classified_results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_id", "entity_match", "signal_type", "summary", "supported_claims", "unsupported_or_ambiguous_claims", "meddpicc_relevance", "confidence"],
        properties: {
          source_id: { type: "string" },
          entity_match: { type: "string", enum: ["confirmed", "probable", "weak", "no_match"] },
          signal_type: {
            type: "string",
            enum: ["account_identity", "stakeholder_role", "public_initiative", "public_incident", "technology_footprint", "competition", "financial_priority", "irrelevant"]
          },
          summary: { type: "string" },
          supported_claims: { type: "array", items: { type: "string" } },
          unsupported_or_ambiguous_claims: { type: "array", items: { type: "string" } },
          meddpicc_relevance: {
            type: "array",
            items: { type: "string", enum: ["metrics", "economic_buyer", "decision_criteria", "decision_process", "paper_process", "identify_pain", "champion", "competition"] }
          },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
} as const;

export const messageSynthesisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sales_webex_markdown", "technical_webex_markdown", "sales_email_subject", "sales_email_html", "technical_email_subject", "technical_email_html"],
  properties: {
    sales_webex_markdown: { type: "string" },
    technical_webex_markdown: { type: "string" },
    sales_email_subject: { type: "string" },
    sales_email_html: { type: "string" },
    technical_email_subject: { type: "string" },
    technical_email_html: { type: "string" }
  }
} as const;
