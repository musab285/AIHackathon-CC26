import type {
  AuditLogEntry,
  CandidateMatch,
  CaseWithDecisions,
  ConsentRecord,
  EvalStatsResponse,
  FamilyRecord,
  RuleRecord,
  RuleType,
  ThresholdConfig,
  UserPublic,
  UserRole,
  Verdict,
} from '../shared/types';

// Auth token is kept strictly in JS memory — NEVER stored in localStorage or sessionStorage
let memoryAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return memoryAuthToken;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryAuthToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `Request failed (${res.status})` };
  }

  if (!res.ok) {
    const errMsg =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    const error = new Error(errMsg) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  return data as T;
}

export const api = {
  getDemoAccounts: () =>
    apiFetch<{ accounts: UserPublic[]; demo_api_key_hint: string }>('/api/auth/demo-accounts'),

  loginWithRole: (demoRole: UserRole) =>
    apiFetch<{ token: string; user: UserPublic }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ demo_role: demoRole }),
    }),

  loginWithCredentials: (email: string, password: string) =>
    apiFetch<{ token: string; user: UserPublic }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMe: () => apiFetch<{ user: UserPublic; gemini_configured: boolean }>('/api/auth/me'),

  // Cases
  submitCase: (payload: {
    message_text: string;
    sender_claimed: string;
    payment_ref?: string | null;
    family_id?: string | null;
    use_gemini?: boolean;
  }) =>
    apiFetch<{ case: CaseWithDecisions }>('/api/cases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCases: () => apiFetch<{ cases: CaseWithDecisions[] }>('/api/cases'),

  getCaseById: (id: string) => apiFetch<{ case: CaseWithDecisions }>(`/api/cases/${id}`),

  escalateCase: (id: string, reason?: string) =>
    apiFetch<{ case: CaseWithDecisions }>(`/api/cases/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  submitFollowup: (id: string, answer: string) =>
    apiFetch<{ case: CaseWithDecisions }>(`/api/cases/${id}/followup`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),

  closeCase: (id: string) =>
    apiFetch<{ case: CaseWithDecisions }>(`/api/cases/${id}/close`, {
      method: 'POST',
    }),

  // Families
  getFamilies: () => apiFetch<{ families: FamilyRecord[] }>('/api/families'),

  checkFamilyCandidates: (displayName: string) =>
    apiFetch<{ phonetic_key: string; candidate_matches: CandidateMatch[] }>(
      '/api/families/candidates',
      {
        method: 'POST',
        body: JSON.stringify({ display_name: displayName }),
      }
    ),

  createFamily: (payload: {
    display_name: string;
    phone_masked: string;
    village_or_ward: string;
    notes: string;
    confirm_new?: boolean;
  }) =>
    apiFetch<
      | { status: 'created'; family: FamilyRecord }
      | {
          status: 'candidates_found';
          phonetic_key: string;
          candidate_matches: CandidateMatch[];
          message: string;
        }
    >('/api/families', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateFamily: (
    id: string,
    payload: Partial<Pick<FamilyRecord, 'display_name' | 'phone_masked' | 'village_or_ward' | 'notes'>>
  ) =>
    apiFetch<{ family: FamilyRecord }>(`/api/families/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Officer Review
  getReviewQueue: (status: 'pending' | 'resolved' | 'all' = 'pending') =>
    apiFetch<{ queue: Array<CaseWithDecisions & { consent_blocked?: boolean }> }>(
      `/api/review/queue?status=${status}`
    ),

  officerDecide: (id: string, verdict: Verdict, officerNotes: string) =>
    apiFetch<{ case: CaseWithDecisions }>(`/api/review/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ verdict, officer_notes: officerNotes }),
    }),

  officerRequestInfo: (id: string, question: string) =>
    apiFetch<{ case: CaseWithDecisions }>(`/api/review/${id}/request-info`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  // Admin Rules & Thresholds
  getRules: () => apiFetch<{ rules: RuleRecord[]; active_version: number }>('/api/rules'),

  createRule: (payload: {
    name: string;
    rule_type: RuleType;
    pattern: string;
    weight: number;
  }) =>
    apiFetch<{ rule: RuleRecord; active_version: number }>('/api/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateRule: (
    id: string,
    payload: Partial<Pick<RuleRecord, 'name' | 'rule_type' | 'pattern' | 'weight' | 'active'>>
  ) =>
    apiFetch<{ rule: RuleRecord; active_version: number }>(`/api/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getThresholds: () =>
    apiFetch<{ active: ThresholdConfig; history: ThresholdConfig[] }>('/api/thresholds'),

  updateThresholds: (payload: {
    scam_auto_threshold: number;
    official_match_threshold: number;
    ask_info_threshold: number;
  }) =>
    apiFetch<{ active: ThresholdConfig; history: ThresholdConfig[] }>('/api/thresholds', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Consent
  getConsents: () => apiFetch<{ consents: ConsentRecord[] }>('/api/consent'),

  withdrawConsent: (id: string) =>
    apiFetch<{ consent: ConsentRecord; message: string }>(`/api/consent/${id}`, {
      method: 'DELETE',
    }),

  reinstateConsent: (id: string) =>
    apiFetch<{ consent: ConsentRecord }>(`/api/consent/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    }),

  // Audit
  getAuditLogs: (params?: { access_kind?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.access_kind) qs.set('access_kind', params.access_kind);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ logs: AuditLogEntry[] }>(`/api/audit${suffix}`);
  },

  getCaseTrace: (id: string) =>
    apiFetch<{ case: CaseWithDecisions }>(`/api/audit/cases/${id}/trace`),

  // Stats
  getStats: () => apiFetch<EvalStatsResponse>('/api/stats'),

  // Mock DPI lookup test (verifies server-side consent enforcement)
  testMockIdentityLookup: (familyRef: string) =>
    apiFetch<{ ref: string; status: string; district: string; household_tier: string }>(
      `/api/mock/identity/${encodeURIComponent(familyRef)}`
    ),

  // Public Partner API /v1/check
  publicCheck: async (
    apiKey: string,
    payload: { message_text: string; sender_claimed: string; payment_ref?: string }
  ) => {
    const res = await fetch('/v1/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  },
};
