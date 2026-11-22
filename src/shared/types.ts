export type UserRole = 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor';

export type Verdict =
  | 'suspicious'
  | 'matches_mock_official_notice'
  | 'needs_non_sensitive_info'
  | 'unverified_officer_review';

export type CaseStatus =
  | 'open'
  | 'needs_info'
  | 'in_review'
  | 'resolved'
  | 'closed';

export type RuleType =
  | 'keyword'
  | 'link'
  | 'pii_request'
  | 'urgency'
  | 'sender_mismatch';

export type ConsentScope = 'case_review' | 'mock_identity' | 'mock_payment';

export interface UserPublic {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface UserRecord extends UserPublic {
  password_hash: string;
}

export interface FamilyRecord {
  id: string;
  helper_id: string;
  display_name: string;
  phonetic_key: string;
  phone_masked: string;
  village_or_ward: string;
  notes: string;
  updated_at: string;
}

export interface CandidateMatch {
  family: FamilyRecord;
  match_reason: string;
  similarity: number;
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  label: string;
  key_prefix: string;
  key_hash: string;
  rate_limit_per_min: number;
  active: boolean;
  created_at: string;
}

export interface AIDecisionOutput {
  predicted_label: 'scam' | 'official_like' | 'uncertain';
  confidence: number;
  scam_signals: string[];
  plain_reason_en: string;
  plain_reason_ur: string;
  safe_followup_question: string | null;
}

export interface MatchedRuleDetail {
  rule_id: string;
  name: string;
  rule_type: RuleType;
  weight: number;
  matched_snippet: string;
}

export interface MockRegistryCheck {
  checked: boolean;
  blocked_by_consent?: boolean;
  matched: boolean;
  sender_id: string | null;
  notice_id: string | null;
  official_program: string | null;
  disclaimer: string;
}

export interface MockPaymentCheck {
  checked: boolean;
  blocked_by_consent?: boolean;
  payment_ref: string | null;
  status: 'valid_pending' | 'not_found' | 'duplicate_flagged' | 'disbursed_mock' | 'skipped';
  detail: string;
}

export interface AuditorTrace {
  input_hash: string;
  pii_redacted: boolean;
  redacted_types: string[];
  duplicate_case_count: number;
  rule_version: number;
  threshold_version: number;
  model_version: string;
  matched_rules: MatchedRuleDetail[];
  rule_score: number;
  ai_output: AIDecisionOutput;
  scam_score: number;
  official_score: number;
  confidence: number;
  registry_check: MockRegistryCheck;
  payment_check: MockPaymentCheck;
  thresholds_applied: {
    scam_auto_threshold: number;
    official_match_threshold: number;
    ask_info_threshold: number;
  };
  verdict: Verdict;
  routing_reason: string;
  evaluated_at: string;
}

export interface CaseRecord {
  id: string;
  submitted_by: string;
  submitted_by_name: string;
  family_id: string | null;
  family_name: string | null;
  message_text: string;
  message_hash: string;
  sender_claimed: string;
  payment_ref: string | null;
  status: CaseStatus;
  verdict: Verdict;
  confidence: number;
  rule_version: number;
  assigned_officer: string | null;
  pii_redacted: boolean;
  duplicate_count: number;
  created_at: string;
  updated_at: string;
}

export interface DecisionRecord {
  id: string;
  case_id: string;
  verdict: Verdict;
  confidence: number;
  user_explanation_en: string;
  user_explanation_ur: string;
  safe_followup_question: string | null;
  rule_version: number;
  model_version: string;
  auditor_trace: AuditorTrace;
  decided_by: 'ai' | 'officer';
  decided_by_user_id: string | null;
  officer_notes: string | null;
  created_at: string;
}

export interface CaseWithDecisions extends CaseRecord {
  decisions: DecisionRecord[];
  latest_decision: DecisionRecord | null;
}

export interface RuleRecord {
  id: string;
  version: number;
  name: string;
  rule_type: RuleType;
  pattern: string;
  weight: number;
  active: boolean;
  created_by: string;
  created_at: string;
}

export interface ThresholdConfig {
  id: string;
  version: number;
  scam_auto_threshold: number;
  official_match_threshold: number;
  ask_info_threshold: number;
  active: boolean;
  created_by: string;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  subject_type: 'user' | 'family';
  subject_id: string;
  subject_label: string;
  owner_user_id: string;
  grantee_role: UserRole;
  scope: ConsentScope;
  status: 'active' | 'withdrawn';
  granted_at: string;
  withdrawn_at: string | null;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: UserRole | 'ai' | 'system';
  actor_type: 'user' | 'ai' | 'system';
  action: string;
  access_kind: 'read' | 'write' | 'decision' | 'security';
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SyntheticSample {
  id: string;
  sender_claimed: string;
  payment_ref: string | null;
  message_text: string;
  ground_truth: 'scam' | 'official' | 'ambiguous';
  category: string;
}

export interface SyntheticEvalRow {
  id: string;
  category: string;
  sender_claimed: string;
  snippet: string;
  ground_truth: 'scam' | 'official' | 'ambiguous';
  predicted_verdict: Verdict;
  scam_score: number;
  official_score: number;
  outcome: 'correct' | 'false_alarm' | 'missed_scam' | 'human_handoff';
}

export interface EvalStatsResponse {
  dataset_label: string;
  sample_size: number;
  active_rule_version: number;
  active_threshold_version: number;
  thresholds: {
    scam_auto_threshold: number;
    official_match_threshold: number;
    ask_info_threshold: number;
  };
  metrics: {
    false_alarms: number;
    missed_scams: number;
    human_handoffs: number;
    scams_caught_auto: number;
    official_verified_matches: number;
    asymmetric_cost_score: number;
  };
  live_case_counts: {
    total: number;
    suspicious: number;
    matches_mock_official_notice: number;
    needs_non_sensitive_info: number;
    unverified_officer_review: number;
    open_officer_queue: number;
  };
  rows: SyntheticEvalRow[];
}
