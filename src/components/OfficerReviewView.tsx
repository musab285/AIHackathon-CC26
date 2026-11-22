import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lock,
  ShieldAlert,
  Send,
} from 'lucide-react';
import type { CaseWithDecisions, UserPublic, Verdict } from '../shared/types';
import { api } from '../utils/api';

interface OfficerReviewViewProps {
  user: UserPublic;
}

type QueueFilter = 'pending' | 'resolved' | 'all';

export function OfficerReviewView({ user }: OfficerReviewViewProps) {
  const canReview = user.role === 'officer' || user.role === 'admin';

  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [queue, setQueue] = useState<Array<CaseWithDecisions & { consent_blocked?: boolean }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [officerNotes, setOfficerNotes] = useState('');
  const [safeQuestion, setSafeQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadQueue = async (nextFilter: QueueFilter = filter) => {
    if (!canReview) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReviewQueue(nextFilter);
      setQueue(res.queue);
      if (res.queue.length > 0) {
        setSelectedId((prev) =>
          prev && res.queue.some((q) => q.id === prev) ? prev : res.queue[0].id
        );
      } else {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load officer queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, filter]);

  if (!canReview) {
    return (
      <section className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-[#64748B]" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-bold text-[#0F172A]">Department Officer Access Required</h2>
        <p className="mt-1 text-sm text-[#475569]">
          Server-side RBAC restricts the Officer Review Queue to Department Officer and Admin roles.
          Use the role switcher to sign in as <strong>Farhana Malik (Officer)</strong>.
        </p>
      </section>
    );
  }

  const selected = queue.find((q) => q.id === selectedId) ?? null;
  const trace = selected?.latest_decision?.auditor_trace ?? null;

  const handleDecision = async (verdict: Verdict) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await api.officerDecide(selected.id, verdict, officerNotes);
      setOfficerNotes('');
      setFeedback(`Decision "${verdict}" recorded for ${selected.id} and appended to audit log.`);
      await loadQueue(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await api.officerRequestInfo(selected.id, safeQuestion);
      setSafeQuestion('');
      setFeedback(`Safe non-sensitive info request sent for ${selected.id}.`);
      await loadQueue(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request blocked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A]">Department Officer Review Queue</h2>
          <p className="mt-0.5 text-sm text-[#475569]">
            Prioritized by &ldquo;I Am Not Sure&rdquo; handoffs and lowest confidence. Sensitive
            proof requests (OTP, CNIC, PIN) are blocked server-side.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#E2E8F0]/70 p-1 shrink-0">
          {(['pending', 'resolved', 'all'] as QueueFilter[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors whitespace-nowrap cursor-pointer ${
                filter === tab
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {tab === 'pending' ? 'Pending Queue' : tab === 'resolved' ? 'Resolved' : 'All Cases'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#991B1B]"
        >
          {error}
        </div>
      )}

      {feedback && (
        <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm font-medium text-[#166534]">
          {feedback}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Queue List */}
        <section
          aria-label="Priority Case List"
          className="rounded-xl border border-[#E2E8F0] bg-white lg:col-span-5"
        >
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3.5">
            <h3 className="text-sm font-bold text-[#0F172A]">Cases by Priority</h3>
            <span className="font-mono text-xs text-[#64748B] tabular-nums">
              {loading ? 'Loading...' : `${queue.length} item${queue.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {queue.length === 0 ? (
            <p className="p-6 text-sm text-[#64748B]">
              No cases in this filter view. Switch to &ldquo;All Cases&rdquo; or submit an
              ambiguous message in the Checker.
            </p>
          ) : (
            <ul className="divide-y divide-[#E2E8F0] max-h-[600px] overflow-y-auto">
              {queue.map((item) => {
                const isSelected = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setError(null);
                        setFeedback(null);
                      }}
                      className={`w-full px-5 py-4 text-left transition-colors cursor-pointer ${
                        isSelected ? 'bg-[#F0F9FA]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-[#0F172A]">{item.id}</span>
                        <span className="font-mono text-[#475569] tabular-nums">
                          Conf {Math.round(item.confidence * 100)}% · Rule v{item.rule_version}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-[#1D4ED8]">
                        {item.consent_blocked
                          ? 'Consent Withdrawn (Blocked)'
                          : item.verdict.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-[#334155]">
                        {item.message_text}
                      </p>
                      <p className="mt-1.5 text-[11px] text-[#64748B]">
                        Sender: {item.sender_claimed || '(blank)'} · Status: {item.status}
                        {item.family_name ? ` · ${item.family_name}` : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Case Review Panel */}
        <section
          aria-label="Selected Case Inspection"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 lg:col-span-7"
        >
          {!selected ? (
            <p className="text-sm text-[#64748B]">Select a case from the queue to inspect.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                <div>
                  <p className="font-mono text-xs text-[#64748B] tabular-nums">
                    {selected.id} · Submitted by {selected.submitted_by_name}
                    {selected.family_name ? ` · Family: ${selected.family_name}` : ''}
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-[#0F172A]">
                    Structured AI Case Notes &amp; Human Verification
                  </h3>
                </div>
                <span className="font-mono text-xs font-semibold text-[#0F4C5C] tabular-nums">
                  Status: {selected.status}
                </span>
              </div>

              {selected.consent_blocked ? (
                <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-5 text-sm text-[#991B1B]">
                  <p className="font-bold">403 Server-Enforced Consent Block</p>
                  <p className="mt-1">
                    This subject withdrew <code>case_review</code> consent. Message content is
                    redacted and review actions are rejected server-side.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-xs font-semibold text-[#475569]">
                      Submitted Message (PII-Redacted)
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#0F172A]">
                      {selected.message_text}
                    </p>
                    <p className="mt-2 font-mono text-xs text-[#64748B]">
                      Sender Claimed: {selected.sender_claimed || '(none)'} · Payment Ref:{' '}
                      {selected.payment_ref || '(none)'} · Prior Duplicate Matches:{' '}
                      {selected.duplicate_count}
                    </p>
                  </div>

                  {trace && (
                    <div className="grid gap-3 border-y border-[#E2E8F0] py-4 text-xs sm:grid-cols-2">
                      <div>
                        <p className="font-semibold text-[#0F172A]">AI Routing Reason</p>
                        <p className="mt-1 text-[#475569]">{trace.routing_reason}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#0F172A]">
                          Scores (Rule v{trace.rule_version} / Thr v{trace.threshold_version})
                        </p>
                        <p className="mt-1 font-mono text-[#334155] tabular-nums">
                          Scam: {trace.scam_score} · Official: {trace.official_score} · Registry:{' '}
                          {trace.registry_check.matched
                            ? `MATCHED (${trace.registry_check.notice_id})`
                            : 'NO MATCH'}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#0F172A]">Matched Rules</p>
                        <p className="mt-1 text-[#475569]">
                          {trace.matched_rules.length > 0
                            ? trace.matched_rules
                                .map((r) => `${r.name} (+${r.weight})`)
                                .join('; ')
                            : 'No rule hits'}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#0F172A]">Mock Payment Service</p>
                        <p className="mt-1 text-[#475569]">
                          {trace.payment_check.blocked_by_consent
                            ? 'Blocked by withdrawn mock_payment consent'
                            : `${trace.payment_check.status} — ${trace.payment_check.detail}`}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Officer Decision Form */}
                  <div className="space-y-3">
                    <label
                      htmlFor="officer-notes-input"
                      className="block text-xs font-semibold text-[#334155]"
                    >
                      Officer Verification Notes (saved immutably in decision &amp; audit trail)
                    </label>
                    <textarea
                      id="officer-notes-input"
                      rows={2}
                      value={officerNotes}
                      onChange={(e) => setOfficerNotes(e.target.value)}
                      placeholder="Example: Verified with Multan Tehsil relief desk schedule; no SMS fee requested."
                      className="w-full rounded-lg border border-[#CBD5E1] p-3 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDecision('suspicious')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        Flag as Suspicious
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDecision('matches_mock_official_notice')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Confirm Mock Official Match
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDecision('unverified_officer_review')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        Keep Unverified
                      </button>
                    </div>
                  </div>

                  {/* Request Safe Info (Anti-Phishing Guardrail Protected) */}
                  <form
                    onSubmit={handleRequestInfo}
                    className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="officer-safe-question"
                        className="flex items-center gap-1.5 text-xs font-bold text-[#92400E]"
                      >
                        <HelpCircle className="h-4 w-4" aria-hidden="true" />
                        Request Safe Non-Sensitive Info (OTP / CNIC / PIN blocked server-side)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setSafeQuestion('Please reply with your 6-digit OTP and CNIC number.')
                        }
                        className="text-[11px] font-semibold text-[#991B1B] underline cursor-pointer"
                      >
                        Test Guardrail Block
                      </button>
                    </div>
                    <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="officer-safe-question"
                        type="text"
                        value={safeQuestion}
                        onChange={(e) => setSafeQuestion(e.target.value)}
                        placeholder="Ask safe context only (e.g. Did this arrive via WhatsApp or SMS?)"
                        className="flex-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={busy || safeQuestion.trim().length < 8}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F4C5C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Send Safe Request
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
