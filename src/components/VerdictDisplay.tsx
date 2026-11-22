import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ShieldAlert,
  Volume2,
  VolumeX,
  UserCheck,
  Send,
} from 'lucide-react';
import type { CaseWithDecisions, Verdict } from '../shared/types';
import { isReadAloudSupported, speakExplanation, stopSpeaking } from '../utils/speech';

interface VerdictDisplayProps {
  caseData: CaseWithDecisions;
  onEscalate?: (caseId: string) => Promise<void>;
  onAnswerFollowup?: (caseId: string, answer: string) => Promise<void>;
  canEscalate?: boolean;
}

const VERDICT_META: Record<
  Verdict,
  {
    title: string;
    subtitle: string;
    containerClass: string;
    headingClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  suspicious: {
    title: 'Suspicious — Likely Scam',
    subtitle: 'Do not send money, click links, or share OTP, CNIC, or PIN.',
    containerClass: 'bg-[#FEF2F2] border-[#FECACA]',
    headingClass: 'text-[#991B1B]',
    icon: ShieldAlert,
  },
  matches_mock_official_notice: {
    title: 'Matches Mock Official Notice',
    subtitle: 'Matched prototype sender registry, but forwarded sender names can still be spoofed.',
    containerClass: 'bg-[#F0FDF4] border-[#BBF7D0]',
    headingClass: 'text-[#166534]',
    icon: CheckCircle2,
  },
  needs_non_sensitive_info: {
    title: 'Needs Safe Non-Sensitive Info',
    subtitle: 'Mixed signals detected. Answer one safe question below without sharing OTP/CNIC/PIN.',
    containerClass: 'bg-[#FFFBEB] border-[#FDE68A]',
    headingClass: 'text-[#92400E]',
    icon: HelpCircle,
  },
  unverified_officer_review: {
    title: 'Sent to Department Officer — I Am Not Sure',
    subtitle: 'Unverified message routed for human verification to protect your savings.',
    containerClass: 'bg-[#EFF6FF] border-[#BFDBFE]',
    headingClass: 'text-[#1E40AF]',
    icon: AlertTriangle,
  },
};

export function VerdictDisplay({
  caseData,
  onEscalate,
  onAnswerFollowup,
  canEscalate = true,
}: VerdictDisplayProps) {
  const [speakingLang, setSpeakingLang] = useState<'en' | 'ur' | null>(null);
  const [followupAnswer, setFollowupAnswer] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const meta = VERDICT_META[caseData.verdict];
  const Icon = meta.icon;
  const latest = caseData.latest_decision;
  const trace = latest?.auditor_trace;
  const ttsSupported = isReadAloudSupported();

  const handleSpeak = (lang: 'en' | 'ur') => {
    if (!latest) return;
    if (speakingLang === lang) {
      stopSpeaking();
      setSpeakingLang(null);
      return;
    }
    const text = lang === 'en' ? latest.user_explanation_en : latest.user_explanation_ur;
    const ok = speakExplanation(text, lang === 'en' ? 'en-US' : 'ur-PK');
    if (ok) {
      setSpeakingLang(lang);
      setTimeout(() => setSpeakingLang(null), 9000);
    }
  };

  const handleEscalateClick = async () => {
    if (!onEscalate) return;
    setBusyAction(true);
    try {
      await onEscalate(caseData.id);
    } finally {
      setBusyAction(false);
    }
  };

  const handleFollowupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAnswerFollowup || !followupAnswer.trim()) return;
    setBusyAction(true);
    try {
      await onAnswerFollowup(caseData.id, followupAnswer.trim());
      setFollowupAnswer('');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <section
      aria-label="Verification Result"
      className={`rounded-xl border p-6 ${meta.containerClass}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className={`mt-0.5 shrink-0 ${meta.headingClass}`}>
            <Icon className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-medium text-[#475569] tabular-nums">
              Case {caseData.id} · Rule v{caseData.rule_version} · Confidence{' '}
              {Math.round(caseData.confidence * 100)}%
              {caseData.family_name ? ` · Family: ${caseData.family_name}` : ''}
            </p>
            <h3 className={`mt-1 text-xl font-bold tracking-tight ${meta.headingClass}`}>
              {meta.title}
            </h3>
            <p className="mt-1 text-sm text-[#334155]">{meta.subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {ttsSupported && latest && (
            <>
              <button
                type="button"
                onClick={() => handleSpeak('en')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                aria-label="Read explanation aloud in English"
              >
                {speakingLang === 'en' ? (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )}
                {speakingLang === 'en' ? 'Stop Audio' : 'Read English'}
              </button>
              <button
                type="button"
                onClick={() => handleSpeak('ur')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                aria-label="Read explanation aloud in Urdu"
              >
                {speakingLang === 'ur' ? (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )}
                {speakingLang === 'ur' ? 'Stop Audio' : 'اردو سنیں'}
              </button>
            </>
          )}
        </div>
      </div>

      {latest && (
        <div className="mt-5 grid gap-4 border-t border-black/10 pt-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-[#475569]">Plain Explanation (English)</p>
            <p className="mt-1 text-sm leading-relaxed text-[#0F172A]">
              {latest.user_explanation_en}
            </p>
          </div>
          <div dir="rtl" className="text-right">
            <p className="text-xs font-semibold text-[#475569]">آسان وضاحت (اردو)</p>
            <p className="mt-1 text-base leading-relaxed text-[#0F172A]">
              {latest.user_explanation_ur}
            </p>
          </div>
        </div>
      )}

      {caseData.pii_redacted && (
        <div className="mt-4 rounded-lg border border-[#FDE68A] bg-white/90 px-4 py-3 text-xs text-[#92400E]">
          <strong>Privacy Guardrail Triggered:</strong> Accidental CNIC, OTP, or account digits were
          automatically masked before saving (<code className="font-mono">[REDACTED]</code>), and a{' '}
          <code className="font-mono">pii_redacted</code> event was recorded in the audit trail.
        </div>
      )}

      {trace && (
        <div className="mt-4 grid gap-3 border-t border-black/10 pt-4 text-xs text-[#334155] sm:grid-cols-3">
          <div>
            <span className="font-semibold text-[#0F172A]">Mock Sender Registry: </span>
            {trace.registry_check.matched
              ? `Matched ${trace.registry_check.notice_id} (${trace.registry_check.official_program})`
              : 'No verified official notice match'}
          </div>
          <div>
            <span className="font-semibold text-[#0F172A]">Mock Payment Check: </span>
            {trace.payment_check.blocked_by_consent
              ? 'Blocked server-side (consent withdrawn)'
              : trace.payment_check.checked
                ? `${trace.payment_check.status} — ${trace.payment_check.detail}`
                : 'No payment ref entered'}
          </div>
          <div>
            <span className="font-semibold text-[#0F172A]">Triggered Rules: </span>
            {trace.matched_rules.length > 0
              ? trace.matched_rules.map((r) => r.name).join('; ')
              : 'None'}
          </div>
        </div>
      )}

      {caseData.verdict === 'needs_non_sensitive_info' &&
        latest?.safe_followup_question &&
        onAnswerFollowup && (
          <form
            onSubmit={handleFollowupSubmit}
            className="mt-5 rounded-lg border border-[#FDE68A] bg-white p-4"
          >
            <label
              htmlFor={`followup-${caseData.id}`}
              className="block text-sm font-semibold text-[#0F172A]"
            >
              Safe Follow-up Question (Never enter OTP, CNIC, or PIN)
            </label>
            <p className="mt-1 text-sm text-[#475569]">{latest.safe_followup_question}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                id={`followup-${caseData.id}`}
                type="text"
                value={followupAnswer}
                onChange={(e) => setFollowupAnswer(e.target.value)}
                placeholder="Example: Came from a 0301 personal number and asked for Rs 500 fee"
                className="flex-1 rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
              />
              <button
                type="submit"
                disabled={busyAction || followupAnswer.trim().length < 2}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C5C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send Safe Answer
              </button>
            </div>
          </form>
        )}

      {canEscalate &&
        onEscalate &&
        caseData.status !== 'in_review' &&
        caseData.status !== 'closed' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4">
            <p className="text-xs text-[#475569]">
              Still unsure or worried this sender was spoofed? Send directly to a human officer.
            </p>
            <button
              type="button"
              disabled={busyAction}
              onClick={handleEscalateClick}
              className="inline-flex items-center gap-2 rounded-lg border border-[#0F4C5C] bg-white px-4 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#F0F9FA] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              Escalate to Department Officer
            </button>
          </div>
        )}
    </section>
  );
}
