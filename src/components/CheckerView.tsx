import React, { useEffect, useRef, useState } from 'react';
import {
  Lock,
  Mic,
  MicOff,
  SearchCheck,
  UserPlus,
  Users,
  AlertCircle,
  Check,
  Sparkles,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import type {
  CandidateMatch,
  CaseWithDecisions,
  FamilyRecord,
  UserPublic,
} from '../shared/types';
import { api } from '../utils/api';
import {
  clearAllHelperDrafts,
  clearIsolatedDraft,
  countActiveLocalDrafts,
  loadIsolatedDraft,
  saveIsolatedDraft,
} from '../utils/draftStorage';
import {
  clearAllOfflineQueues,
  enqueueOfflineCheck,
  loadOfflineQueue,
  removeOfflineItem,
  type QueuedCheckItem,
} from '../utils/offlineQueue';
import { syncCaseSnapshotToFirestore } from '../lib/firebase';
import { isVoiceInputSupported, startVoiceDictation } from '../utils/speech';
import { VerdictDisplay } from './VerdictDisplay';

interface CheckerViewProps {
  user: UserPublic;
  geminiConfigured: boolean;
}

const SAMPLE_PRESETS = [
  {
    label: 'Scam + Accidental CNIC/OTP',
    sender: '0301-8842109',
    paymentRef: '',
    text: 'Mubarak ho! Apka 25,000 BISP relief approve ho gaya hai. Fauran apna OTP 482910 aur CNIC 35202-1234567-1 bhejein aur Rs 500 registration fee Easypaisa par bhej dein.',
  },
  {
    label: 'Mock Official 8171 Notice',
    sender: '8171',
    paymentRef: 'PAY-8171-4401',
    text: '8171 Mock Notice: Your quarterly relief installment of Rs 10,500 is ready for biometric collection at your nearest camp site. No fee is charged.',
  },
  {
    label: 'Ambiguous Forward ("Not Sure")',
    sender: 'INFO-SMS',
    paymentRef: '',
    text: 'Your family name is on the local flood relief list. Please meet the union council secretary on Wednesday morning with your survey slip.',
  },
];

export function CheckerView({ user, geminiConfigured }: CheckerViewProps) {
  const isHelperMode = user.role === 'helper' || user.role === 'admin';
  const isAuditor = user.role === 'auditor';

  const [families, setFamilies] = useState<FamilyRecord[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>('');
  const [senderClaimed, setSenderClaimed] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [messageText, setMessageText] = useState('');
  const [useGemini, setUseGemini] = useState(false);

  const [cases, setCases] = useState<CaseWithDecisions[]>([]);
  const [activeResult, setActiveResult] = useState<CaseWithDecisions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Voice dictation state
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'en-US' | 'ur-PK'>('en-US');
  const stopVoiceRef = useRef<(() => void) | null>(null);
  const voiceSupported = isVoiceInputSupported();

  // Shared-phone draft count & Offline-First sync queue
  const [draftCount, setDraftCount] = useState<number>(() => countActiveLocalDrafts());
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<QueuedCheckItem[]>(() =>
    loadOfflineQueue(user.id)
  );
  const [syncingQueue, setSyncingQueue] = useState(false);
  const isEffectiveOffline = !browserOnline || simulateOffline;

  // New Family + Phonetic Candidate Match Modal/Panel
  const [showNewFamily, setShowNewFamily] = useState(false);
  const [newFamName, setNewFamName] = useState('');
  const [newFamPhone, setNewFamPhone] = useState('0300-***-');
  const [newFamWard, setNewFamWard] = useState('');
  const [newFamNotes, setNewFamNotes] = useState('');
  const [candidates, setCandidates] = useState<CandidateMatch[]>([]);
  const [candidateMessage, setCandidateMessage] = useState<string | null>(null);
  const [famSaving, setFamSaving] = useState(false);

  const loadData = async () => {
    try {
      const [casesRes, famRes] = await Promise.all([
        api.getCases(),
        isHelperMode ? api.getFamilies() : Promise.resolve({ families: [] }),
      ]);
      setCases(casesRes.cases);
      if (isHelperMode) {
        setFamilies(famRes.families);
        if (!selectedFamilyId && famRes.families.length > 0) {
          setSelectedFamilyId(famRes.families[0].id);
        }
      }
      if (!activeResult && casesRes.cases.length > 0) {
        setActiveResult(casesRes.cases[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cases.');
    }
  };

  useEffect(() => {
    loadData();
    setOfflineQueue(loadOfflineQueue(user.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Restore isolated per-family draft when switching family
  const handleFamilySwitch = (nextFamilyId: string) => {
    // Auto-clear previous family's in-flight draft on switch per shared-phone privacy rule
    clearIsolatedDraft(user.id, selectedFamilyId || null);
    setSelectedFamilyId(nextFamilyId);

    const restored = loadIsolatedDraft(user.id, nextFamilyId || null);
    if (restored) {
      setSenderClaimed(restored.sender_claimed);
      setPaymentRef(restored.payment_ref);
      setMessageText(restored.snippet);
    } else {
      setSenderClaimed('');
      setPaymentRef('');
      setMessageText('');
    }
    setDraftCount(countActiveLocalDrafts());
    setStatusNotice(
      'Previous family draft cleared from shared phone session storage before switching.'
    );
  };

  // Save minimal isolated draft while typing (sessionStorage key `draft:{helper_id}:{family_id}`)
  useEffect(() => {
    if (isAuditor) return;
    const timer = setTimeout(() => {
      saveIsolatedDraft(user.id, selectedFamilyId || null, {
        sender_claimed: senderClaimed,
        payment_ref: paymentRef,
        message_text: messageText,
      });
      setDraftCount(countActiveLocalDrafts());
    }, 250);
    return () => clearTimeout(timer);
  }, [user.id, selectedFamilyId, senderClaimed, paymentRef, messageText, isAuditor]);

  const handleLockAndClearDrafts = () => {
    const removed = clearAllHelperDrafts();
    const removedQueues = clearAllOfflineQueues();
    setOfflineQueue([]);
    setSenderClaimed('');
    setPaymentRef('');
    setMessageText('');
    setDraftCount(0);
    setStatusNotice(
      `Shared phone cleared: wiped ${removed} local draft key(s) and ${removedQueues} offline queue(s), and cleared the input box.`
    );
  };

  const handleSyncOfflineQueue = async () => {
    if (isEffectiveOffline || syncingQueue) return;
    const items = loadOfflineQueue(user.id);
    if (items.length === 0) return;

    setSyncingQueue(true);
    setError(null);
    let syncedCount = 0;
    let replayCount = 0;
    let lastCase: CaseWithDecisions | null = null;

    try {
      for (const item of items) {
        const res = await api.submitCase({
          message_text: item.message_text,
          sender_claimed: item.sender_claimed,
          payment_ref: item.payment_ref,
          family_id: item.family_id,
          use_gemini: item.use_gemini,
          client_request_id: item.client_request_id,
        });
        void syncCaseSnapshotToFirestore(res.case).catch(() => undefined);
        const remaining = removeOfflineItem(user.id, item.client_request_id);
        setOfflineQueue(remaining);
        lastCase = res.case;
        if (res.idempotent_replay) {
          replayCount += 1;
        } else {
          syncedCount += 1;
        }
        setCases((prev) =>
          prev.some((c) => c.id === res.case.id)
            ? prev.map((c) => (c.id === res.case.id ? res.case : c))
            : [res.case, ...prev]
        );
      }

      if (lastCase) {
        setActiveResult(lastCase);
      }
      setStatusNotice(
        `Offline sync complete: ${syncedCount} queued check(s) evaluated${replayCount > 0 ? ` (${replayCount} duplicate replay prevented via client_request_id)` : ''}.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Sync paused (${err.message}). Queued items remain safe for retry.`
          : 'Sync paused. Queued items remain safe for retry.'
      );
    } finally {
      setSyncingQueue(false);
    }
  };

  const handleToggleVoice = () => {
    if (listening && stopVoiceRef.current) {
      stopVoiceRef.current();
      setListening(false);
      return;
    }
    setError(null);
    const stop = startVoiceDictation({
      lang: voiceLang,
      onTranscript: (text) => {
        setMessageText((prev) => (prev ? `${prev} ${text}` : text));
      },
      onError: (msg) => {
        setError(msg);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (stop) {
      stopVoiceRef.current = stop;
      setListening(true);
    }
  };

  const handleCheckSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuditor) return;
    setError(null);
    setStatusNotice(null);

    if (messageText.trim().length < 6) {
      setError('Please paste or dictate a message of at least 6 characters.');
      return;
    }

    if (isEffectiveOffline) {
      const fam = families.find((f) => f.id === selectedFamilyId);
      const queued = enqueueOfflineCheck(user.id, {
        message_text: messageText,
        sender_claimed: senderClaimed,
        payment_ref: paymentRef.trim() || null,
        family_id: isHelperMode && selectedFamilyId ? selectedFamilyId : null,
        family_label: fam ? `${fam.display_name} (${fam.id})` : null,
        use_gemini: useGemini,
      });
      setOfflineQueue(loadOfflineQueue(user.id));
      clearIsolatedDraft(user.id, selectedFamilyId || null);
      setMessageText('');
      setSenderClaimed('');
      setPaymentRef('');
      setDraftCount(countActiveLocalDrafts());
      setStatusNotice(
        `Saved offline (${queued.client_request_id.slice(0, 14)}...). Reconnect signal and click "Sync Queued Checks" for idempotent verification.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.submitCase({
        message_text: messageText,
        sender_claimed: senderClaimed,
        payment_ref: paymentRef.trim() || null,
        family_id: isHelperMode && selectedFamilyId ? selectedFamilyId : null,
        use_gemini: useGemini,
      });
      void syncCaseSnapshotToFirestore(res.case).catch(() => undefined);

      // Auto-clear isolated draft immediately upon submission
      clearIsolatedDraft(user.id, selectedFamilyId || null);
      setMessageText('');
      setSenderClaimed('');
      setPaymentRef('');
      setDraftCount(countActiveLocalDrafts());

      setActiveResult(res.case);
      setCases((prev) => [res.case, ...prev]);
      setStatusNotice(
        `Case ${res.case.id} evaluated and saved. Local draft auto-cleared from this device.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message check failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEscalate = async (caseId: string) => {
    setError(null);
    try {
      const res = await api.escalateCase(caseId, 'Escalated from Checker screen for officer review.');
      void syncCaseSnapshotToFirestore(res.case).catch(() => undefined);
      setActiveResult(res.case);
      setCases((prev) => prev.map((c) => (c.id === caseId ? res.case : c)));
      setStatusNotice(`Case ${caseId} escalated to the Department Officer review queue.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escalation failed.');
    }
  };

  const handleAnswerFollowup = async (caseId: string, answer: string) => {
    setError(null);
    try {
      const res = await api.submitFollowup(caseId, answer);
      void syncCaseSnapshotToFirestore(res.case).catch(() => undefined);
      setActiveResult(res.case);
      setCases((prev) => prev.map((c) => (c.id === caseId ? res.case : c)));
      setStatusNotice(`Safe context added and sent to Department Officer for verification.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send answer.');
    }
  };

  const handleCloseCase = async (caseId: string) => {
    setError(null);
    try {
      const res = await api.closeCase(caseId);
      void syncCaseSnapshotToFirestore(res.case).catch(() => undefined);
      setActiveResult(res.case);
      setCases((prev) => prev.map((c) => (c.id === caseId ? res.case : c)));
      setStatusNotice(`Case ${caseId} closed and recorded in the append-only audit trail.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close case.');
    }
  };

  const handleCreateFamilySubmit = async (confirmNew: boolean) => {
    if (newFamName.trim().length < 2) {
      setError('Enter a family display name (at least 2 characters).');
      return;
    }
    setFamSaving(true);
    setError(null);
    try {
      const res = await api.createFamily({
        display_name: newFamName.trim(),
        phone_masked: newFamPhone.trim(),
        village_or_ward: newFamWard.trim(),
        notes: newFamNotes.trim(),
        confirm_new: confirmNew,
      });

      if (res.status === 'candidates_found') {
        setCandidates(res.candidate_matches);
        setCandidateMessage(res.message);
      } else {
        setFamilies((prev) => [res.family, ...prev]);
        setSelectedFamilyId(res.family.id);
        setShowNewFamily(false);
        setNewFamName('');
        setNewFamWard('');
        setNewFamNotes('');
        setCandidates([]);
        setCandidateMessage(null);
        setStatusNotice(
          `Created separate family record ${res.family.display_name} (${res.family.id}, key: ${res.family.phonetic_key}).`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create family record.');
    } finally {
      setFamSaving(false);
    }
  };

  const handleConfirmExistingCandidate = (family: FamilyRecord) => {
    setSelectedFamilyId(family.id);
    setShowNewFamily(false);
    setNewFamName('');
    setCandidates([]);
    setCandidateMessage(null);
    setStatusNotice(
      `Selected existing family record ${family.display_name} (${family.id}) without duplicating or auto-merging.`
    );
  };

  const selectedFamily = families.find((f) => f.id === selectedFamilyId) ?? null;

  return (
    <div className="space-y-6">
      {/* Helper Mode Shared-Phone Bar */}
      {isHelperMode && (
        <section
          aria-label="Community Helper Family Selector"
          className="rounded-xl border border-[#E2E8F0] bg-white p-5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
                <Users className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
                <label htmlFor="helper-family-select" className="whitespace-nowrap">
                  Helper Mode Family
                </label>
              </div>
              <select
                id="helper-family-select"
                value={selectedFamilyId}
                onChange={(e) => handleFamilySwitch(e.target.value)}
                className="min-w-[280px] rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-sm font-medium text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
              >
                <option value="">Personal / Unlinked Check</option>
                {families.map((fam) => (
                  <option key={fam.id} value={fam.id}>
                    {fam.display_name} ({fam.id} · {fam.village_or_ward || fam.phone_masked})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowNewFamily((prev) => !prev);
                  setCandidates([]);
                  setCandidateMessage(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
                {showNewFamily ? 'Close Family Form' : 'New Family'}
              </button>
              <button
                type="button"
                onClick={handleLockAndClearDrafts}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-semibold text-[#991B1B] hover:bg-[#FEE2E2] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                Clear Local Drafts / Lock Phone ({draftCount})
              </button>
            </div>
          </div>

          {selectedFamily && (
            <p className="mt-2.5 text-xs text-[#64748B]">
              Active household: <span className="font-medium text-[#334155]">{selectedFamily.display_name}</span>
              {' · '}
              <span className="font-mono">key: {selectedFamily.phonetic_key}</span>
              {' · '}
              <span className="font-mono">{selectedFamily.phone_masked}</span>
              {selectedFamily.village_or_ward ? ` · ${selectedFamily.village_or_ward}` : ''}
            </p>
          )}

          {showNewFamily && (
            <div className="mt-5 border-t border-[#E2E8F0] pt-5">
              <h3 className="text-sm font-bold text-[#0F172A]">
                Register Family (Phonetic Variant Check — Never Auto-Merges)
              </h3>
              <p className="mt-1 text-xs text-[#475569]">
                Try typing &ldquo;Mohammad Tariq&rdquo; or &ldquo;Muhammed Tareq&rdquo; to see
                phonetic candidate matching against &ldquo;Muhammad Tariq&rdquo;.
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div>
                  <label htmlFor="new-fam-name" className="block text-xs font-medium text-[#334155]">
                    Display Name (as spoken)
                  </label>
                  <input
                    id="new-fam-name"
                    type="text"
                    value={newFamName}
                    onChange={(e) => {
                      setNewFamName(e.target.value);
                      setCandidates([]);
                      setCandidateMessage(null);
                    }}
                    placeholder="e.g. Mohammad Tariq"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="new-fam-phone" className="block text-xs font-medium text-[#334155]">
                    Masked Phone
                  </label>
                  <input
                    id="new-fam-phone"
                    type="text"
                    value={newFamPhone}
                    onChange={(e) => setNewFamPhone(e.target.value)}
                    placeholder="0300-***-1234"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="new-fam-ward" className="block text-xs font-medium text-[#334155]">
                    Village / Ward
                  </label>
                  <input
                    id="new-fam-ward"
                    type="text"
                    value={newFamWard}
                    onChange={(e) => setNewFamWard(e.target.value)}
                    placeholder="Ward 4, Multan"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={famSaving}
                    onClick={() => handleCreateFamilySubmit(false)}
                    className="w-full rounded-lg bg-[#0F4C5C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    {famSaving ? 'Checking...' : 'Check & Add Family'}
                  </button>
                </div>
              </div>

              {candidates.length > 0 && (
                <div className="mt-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4">
                  <p className="text-sm font-semibold text-[#92400E]">
                    Possible Name-Spelling Match Found (Not Auto-Merged)
                  </p>
                  <p className="mt-1 text-xs text-[#78350F]">{candidateMessage}</p>
                  <div className="mt-3 space-y-2">
                    {candidates.map((cand) => (
                      <div
                        key={cand.family.id}
                        className="flex flex-col gap-2 rounded-lg border border-[#FDE68A] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-[#0F172A]">
                            {cand.family.display_name}{' '}
                            <span className="font-mono text-xs font-normal text-[#64748B]">
                              ({cand.family.id} · {cand.family.village_or_ward})
                            </span>
                          </p>
                          <p className="text-xs text-[#475569]">
                            {cand.match_reason} · Similarity {Math.round(cand.similarity * 100)}%
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleConfirmExistingCandidate(cand.family)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#0F4C5C] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F4C5C] hover:bg-[#F0F9FA] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Use Existing Person
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-end">
                    <button
                      type="button"
                      disabled={famSaving}
                      onClick={() => handleCreateFamilySubmit(true)}
                      className="rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E293B] whitespace-nowrap cursor-pointer"
                    >
                      Not the Same Person — Create Separate Record
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {statusNotice && (
        <div className="rounded-xl border border-[#BAE6FD] bg-[#F0F9FF] px-4 py-3 text-xs font-medium text-[#0C4A6E]">
          {statusNotice}
        </div>
      )}

      {/* Main 2-Column Checker + Active Result */}
      <div className="grid gap-6 xl:grid-cols-12">
        {/* Left: Message Input Form */}
        <section
          aria-label="Check Relief Message Form"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 xl:col-span-7"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Verify a Relief Message</h2>
              <p className="mt-0.5 text-sm text-[#475569]">
                Paste or speak the SMS or WhatsApp text. Accidental CNICs and OTPs are masked before
                saving.
              </p>
            </div>
            {!isAuditor && (
              <button
                type="button"
                onClick={() => setSimulateOffline((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isEffectiveOffline
                    ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#92400E]'
                    : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
                }`}
              >
                {isEffectiveOffline ? (
                  <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Wifi className="h-3.5 w-3.5 text-[#15803D]" aria-hidden="true" />
                )}
                {isEffectiveOffline ? 'Offline Mode (Reconnect)' : 'Simulate Offline'}
              </button>
            )}
          </div>

          {offlineQueue.length > 0 && (
            <div className="mt-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#92400E] tabular-nums">
                  Offline Queue: {offlineQueue.length} message
                  {offlineQueue.length === 1 ? '' : 's'} awaiting sync (idempotent{' '}
                  <code className="font-mono">client_request_id</code> protected)
                </p>
                <button
                  type="button"
                  disabled={isEffectiveOffline || syncingQueue}
                  onClick={handleSyncOfflineQueue}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${syncingQueue ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  {syncingQueue
                    ? 'Syncing...'
                    : isEffectiveOffline
                      ? 'Reconnect to Sync'
                      : 'Sync Queued Checks'}
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-[#78350F]">
                {offlineQueue.map((item) => (
                  <li key={item.client_request_id} className="truncate font-mono text-[11px]">
                    [{item.sender_claimed || 'no-sender'}] {item.message_text.slice(0, 72)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Quick Test Presets */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#64748B]">Load synthetic example:</span>
            {SAMPLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={isAuditor}
                onClick={() => {
                  setSenderClaimed(preset.sender);
                  setPaymentRef(preset.paymentRef);
                  setMessageText(preset.text);
                  setError(null);
                }}
                className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#334155] hover:border-[#94A3B8] hover:bg-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleCheckSubmit} className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="sender-claimed-input"
                  className="block text-xs font-semibold text-[#334155]"
                >
                  Sender Number or Name (optional)
                </label>
                <input
                  id="sender-claimed-input"
                  type="text"
                  disabled={isAuditor}
                  value={senderClaimed}
                  onChange={(e) => setSenderClaimed(e.target.value)}
                  placeholder="e.g. 8171, 8558, or 0301-8842109"
                  className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none disabled:bg-[#F8FAFC]"
                />
              </div>

              <div>
                <label
                  htmlFor="payment-ref-input"
                  className="block text-xs font-semibold text-[#334155]"
                >
                  Mock Payment Ref (optional, never CNIC)
                </label>
                <input
                  id="payment-ref-input"
                  type="text"
                  disabled={isAuditor}
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. PAY-8171-4401 or PAY-9999-7782"
                  className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 font-mono text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none disabled:bg-[#F8FAFC]"
                />
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="relief-message-textarea"
                  className="block text-xs font-semibold text-[#334155]"
                >
                  Relief Message Text (English, Roman Urdu, or Urdu)
                </label>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Voice dictation language"
                    value={voiceLang}
                    onChange={(e) => setVoiceLang(e.target.value as 'en-US' | 'ur-PK')}
                    className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs text-[#334155]"
                  >
                    <option value="en-US">Voice: English</option>
                    <option value="ur-PK">Voice: Urdu</option>
                  </select>
                  <button
                    type="button"
                    disabled={isAuditor || !voiceSupported}
                    onClick={handleToggleVoice}
                    title={
                      voiceSupported
                        ? 'Dictate message using microphone'
                        : 'Web Speech dictation not supported in this browser'
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      listening
                        ? 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]'
                        : 'border-[#CBD5E1] bg-white text-[#0F172A] hover:bg-[#F8FAFC]'
                    } disabled:opacity-50`}
                  >
                    {listening ? (
                      <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {listening ? 'Stop Mic' : 'Speak Message'}
                  </button>
                </div>
              </div>

              <textarea
                id="relief-message-textarea"
                rows={5}
                disabled={isAuditor}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Paste the forwarded relief message here. Never share your OTP, CNIC, or PIN."
                className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] bg-white p-4 text-base leading-relaxed text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none disabled:bg-[#F8FAFC]"
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-[#E2E8F0] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-2 text-xs text-[#475569]">
                <input
                  type="checkbox"
                  checked={useGemini}
                  disabled={!geminiConfigured || isAuditor}
                  onChange={(e) => setUseGemini(e.target.checked)}
                  className="h-4 w-4 rounded border-[#CBD5E1] text-[#0F4C5C]"
                />
                <Sparkles className="h-3.5 w-3.5 text-[#0F4C5C]" aria-hidden="true" />
                <span>
                  Deep AI language analysis{' '}
                  {geminiConfigured ? '(server-side enabled)' : '(hybrid rules & NLP active)'}
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting || isAuditor}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F4C5C] px-6 py-3 text-sm font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SearchCheck className="h-4 w-4" aria-hidden="true" />
                {isAuditor
                  ? 'Read-Only Auditor Role'
                  : isEffectiveOffline
                    ? 'Queue Check Offline'
                    : submitting
                      ? 'Checking Safely...'
                      : 'Check Message Now'}
              </button>
            </div>
          </form>
        </section>

        {/* Right: Recent Cases History */}
        <section
          aria-label="Recent Verification Cases"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 xl:col-span-5"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
            <h2 className="text-base font-bold text-[#0F172A]">Recent Checks</h2>
            <span className="font-mono text-xs text-[#64748B] tabular-nums">
              {cases.length} case{cases.length === 1 ? '' : 's'}
            </span>
          </div>

          {cases.length === 0 ? (
            <p className="mt-6 text-sm text-[#64748B]">
              No messages checked yet. Submit a relief message on the left to see its safety verdict
              and plain-language explanation.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[#E2E8F0] max-h-[380px] overflow-y-auto">
              {cases.map((c) => {
                const selected = activeResult?.id === c.id;
                const verdictText =
                  c.verdict === 'suspicious'
                    ? 'Suspicious'
                    : c.verdict === 'matches_mock_official_notice'
                      ? 'Mock Official Match'
                      : c.verdict === 'needs_non_sensitive_info'
                        ? 'Needs Safe Info'
                        : 'Sent to Officer';
                const verdictColor =
                  c.verdict === 'suspicious'
                    ? 'text-[#B91C1C]'
                    : c.verdict === 'matches_mock_official_notice'
                      ? 'text-[#15803D]'
                      : c.verdict === 'needs_non_sensitive_info'
                        ? 'text-[#B45309]'
                        : 'text-[#1D4ED8]';

                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveResult(c)}
                      className={`w-full px-3 py-3 text-left transition-colors cursor-pointer ${
                        selected ? 'bg-[#F0F9FA]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={`font-semibold ${verdictColor}`}>{verdictText}</span>
                        <span className="font-mono text-[#64748B] tabular-nums">
                          {c.id} · v{c.rule_version}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-[#334155]">{c.message_text}</p>
                      <p className="mt-1 text-[11px] text-[#64748B]">
                        Sender: {c.sender_claimed || 'Unknown'}
                        {c.family_name ? ` · ${c.family_name}` : ''}
                        {c.pii_redacted ? ' · PII Redacted' : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Prominent Verdict Display for Active Case */}
      {activeResult && (
        <VerdictDisplay
          caseData={activeResult}
          canEscalate={!isAuditor}
          onEscalate={handleEscalate}
          onAnswerFollowup={!isAuditor ? handleAnswerFollowup : undefined}
          onCloseCase={!isAuditor ? handleCloseCase : undefined}
        />
      )}
    </div>
  );
}
