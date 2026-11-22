import React, { useEffect, useState } from 'react';
import {
  Edit3,
  FileSearch,
  RefreshCw,
  ShieldOff,
  ShieldCheck,
  TestTube2,
} from 'lucide-react';
import type {
  AuditLogEntry,
  CaseWithDecisions,
  ConsentRecord,
  FamilyRecord,
  UserPublic,
} from '../shared/types';
import { api } from '../utils/api';

interface AuditConsentViewProps {
  user: UserPublic;
}

export function AuditConsentView({ user }: AuditConsentViewProps) {
  const isAuditor = user.role === 'auditor';
  const canEditConsent = user.role === 'citizen' || user.role === 'helper' || user.role === 'admin';

  const [activeTab, setActiveTab] = useState<'consent' | 'audit'>(
    isAuditor ? 'audit' : 'consent'
  );

  // Consent & Family correction state
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [families, setFamilies] = useState<FamilyRecord[]>([]);
  const [editingFamId, setEditingFamId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editWard, setEditWard] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [consentTestResult, setConsentTestResult] = useState<string | null>(null);

  // Audit & Decision Trace state
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [accessKindFilter, setAccessKindFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cases, setCases] = useState<CaseWithDecisions[]>([]);
  const [selectedTraceCase, setSelectedTraceCase] = useState<CaseWithDecisions | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadConsentData = async () => {
    try {
      const [cRes, fRes] = await Promise.all([
        api.getConsents(),
        user.role === 'helper' || user.role === 'admin' || user.role === 'auditor'
          ? api.getFamilies()
          : Promise.resolve({ families: [] }),
      ]);
      setConsents(cRes.consents);
      setFamilies(fRes.families);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load consent records.');
    }
  };

  const loadAuditData = async () => {
    try {
      const [lRes, cRes] = await Promise.all([
        api.getAuditLogs({
          access_kind: accessKindFilter,
          search: searchQuery,
        }),
        api.getCases(),
      ]);
      setLogs(lRes.logs);
      setCases(cRes.cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs.');
    }
  };

  useEffect(() => {
    if (isAuditor) setActiveTab('audit');
    loadConsentData();
    loadAuditData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    loadAuditData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessKindFilter]);

  const handleWithdraw = async (consent: ConsentRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.withdrawConsent(consent.id);
      setNotice(
        `Consent withdrawn for ${consent.subject_label} (${consent.scope}). Server-side access is now blocked.`
      );
      await loadConsentData();
      await loadAuditData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleReinstate = async (consent: ConsentRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.reinstateConsent(consent.id);
      setNotice(`Consent reinstated for ${consent.subject_label} (${consent.scope}).`);
      await loadConsentData();
      await loadAuditData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reinstatement failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestServerEnforcement = async (familyId: string) => {
    setConsentTestResult(null);
    try {
      const res = await api.testMockIdentityLookup(familyId);
      setConsentTestResult(
        `HTTP 200 Allowed (consent active): ${res.ref} · ${res.status} · ${res.district} · ${res.household_tier}`
      );
    } catch (err) {
      setConsentTestResult(
        `SERVER ENFORCED BLOCK: ${err instanceof Error ? err.message : '403 Forbidden'}`
      );
    } finally {
      await loadAuditData();
    }
  };

  const handleStartEditFamily = (fam: FamilyRecord) => {
    setEditingFamId(fam.id);
    setEditName(fam.display_name);
    setEditWard(fam.village_or_ward);
    setEditNotes(fam.notes);
  };

  const handleSaveFamilyCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFamId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateFamily(editingFamId, {
        display_name: editName,
        village_or_ward: editWard,
        notes: editNotes,
      });
      setEditingFamId(null);
      setNotice(`Corrected family profile ${editingFamId} and logged change to append-only audit trail.`);
      await loadConsentData();
      await loadAuditData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleInspectCaseTrace = async (caseId: string) => {
    setError(null);
    try {
      if (user.role === 'auditor' || user.role === 'admin' || user.role === 'officer') {
        const res = await api.getCaseTrace(caseId);
        setSelectedTraceCase(res.case);
        await loadAuditData();
      } else {
        const local = cases.find((c) => c.id === caseId) ?? null;
        setSelectedTraceCase(local);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load trace.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A]">
            Consent Governance &amp; Append-Only Audit Trail
          </h2>
          <p className="mt-0.5 text-sm text-[#475569]">
            {isAuditor
              ? 'Read-Only Auditor Mode: zero write endpoints permitted. Inspect all reads, writes, consent checks, and JSON AI decision traces.'
              : 'View who has access, correct family profile fields, withdraw consent (enforced server-side), and inspect decision traces.'}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#E2E8F0]/70 p-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('consent')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'consent'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            Consent &amp; Data Correction
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            Audit Log &amp; JSON Traces
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm text-[#166534]">
          {notice}
        </div>
      )}

      {activeTab === 'consent' && (
        <div className="space-y-6">
          {/* Consent Permissions Table */}
          <section
            aria-label="Active Sharing Consents"
            className="rounded-xl border border-[#E2E8F0] bg-white"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">
                  Data Sharing Consents (Server-Enforced)
                </h3>
                <p className="text-xs text-[#64748B]">
                  Withdrawing a scope immediately blocks downstream mock lookups or officer reads
                  with HTTP 403 and logs a security event.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleTestServerEnforcement('FAM-101')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#0F4C5C] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#F0F9FA] whitespace-nowrap cursor-pointer"
              >
                <TestTube2 className="h-4 w-4" aria-hidden="true" />
                Test FAM-101 Mock Identity Access
              </button>
            </div>

            {consentTestResult && (
              <div
                className={`mx-6 mt-4 rounded-lg border px-4 py-3 font-mono text-xs ${
                  consentTestResult.includes('BLOCK')
                    ? 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
                    : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'
                }`}
              >
                {consentTestResult}
              </div>
            )}

            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Subject</th>
                    <th className="px-6 py-3 font-semibold">Grantee</th>
                    <th className="px-6 py-3 font-semibold">Scope</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                    {canEditConsent && (
                      <th className="px-6 py-3 text-right font-semibold">Control</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {consents.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-6 py-3.5 font-semibold text-[#0F172A]">
                        {c.subject_label}
                      </td>
                      <td className="px-6 py-3.5 capitalize text-[#475569]">{c.grantee_role}</td>
                      <td className="px-6 py-3.5 font-mono text-[#334155]">{c.scope}</td>
                      <td className="px-6 py-3.5 font-semibold">
                        <span
                          className={
                            c.status === 'active' ? 'text-[#15803D]' : 'text-[#B91C1C]'
                          }
                        >
                          {c.status === 'active' ? 'Active' : 'Withdrawn (Blocked)'}
                        </span>
                      </td>
                      {canEditConsent && (
                        <td className="px-6 py-3.5 text-right">
                          {c.status === 'active' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleWithdraw(c)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-1.5 text-xs font-semibold text-[#991B1B] hover:bg-[#FEE2E2] whitespace-nowrap cursor-pointer"
                            >
                              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                              Withdraw Consent
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleReinstate(c)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-1.5 text-xs font-semibold text-[#166534] hover:bg-[#DCFCE7] whitespace-nowrap cursor-pointer"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Reinstate
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Data Correction for Managed Families */}
          {families.length > 0 && (
            <section
              aria-label="Correct Shared Family Profile Data"
              className="rounded-xl border border-[#E2E8F0] bg-white p-6"
            >
              <h3 className="text-base font-bold text-[#0F172A]">
                Correct Family Profile Data (Logged in Audit Trail)
              </h3>
              <p className="mt-1 text-xs text-[#475569]">
                Correct spelling or ward information without merging separate families.
              </p>

              <div className="mt-4 divide-y divide-[#E2E8F0]">
                {families.map((fam) => (
                  <div key={fam.id} className="py-3.5">
                    {editingFamId === fam.id ? (
                      <form
                        onSubmit={handleSaveFamilyCorrection}
                        className="grid gap-3 sm:grid-cols-4"
                      >
                        <input
                          type="text"
                          aria-label="Display name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          aria-label="Village or ward"
                          value={editWard}
                          onChange={(e) => setEditWard(e.target.value)}
                          className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          aria-label="Notes"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={busy}
                            className="rounded-lg bg-[#0F4C5C] px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
                          >
                            Save Correction
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingFamId(null)}
                            className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-semibold text-[#475569] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#0F172A]">
                            {fam.display_name}{' '}
                            <span className="font-mono text-xs font-normal text-[#64748B]">
                              {fam.id} · phonetic_key: {fam.phonetic_key}
                            </span>
                          </p>
                          <p className="text-xs text-[#475569]">
                            {fam.village_or_ward} · {fam.phone_masked} · {fam.notes}
                          </p>
                        </div>
                        {canEditConsent && (
                          <button
                            type="button"
                            onClick={() => handleStartEditFamily(fam)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            Correct Data
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="grid gap-6 xl:grid-cols-12">
          {/* Append-Only Audit Log */}
          <section
            aria-label="Append-Only Audit Log"
            className="rounded-xl border border-[#E2E8F0] bg-white xl:col-span-7"
          >
            <div className="flex flex-col gap-3 border-b border-[#E2E8F0] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'read', 'write', 'decision', 'security'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setAccessKindFilter(kind)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize cursor-pointer ${
                      accessKindFilter === kind
                        ? 'bg-[#0F4C5C] text-white'
                        : 'bg-[#F1F5F9] text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    {kind}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="search"
                  aria-label="Filter audit logs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadAuditData();
                  }}
                  placeholder="Filter action or entity..."
                  className="rounded-lg border border-[#CBD5E1] px-3 py-1.5 text-xs text-[#0F172A]"
                />
                <button
                  type="button"
                  onClick={loadAuditData}
                  aria-label="Refresh audit logs"
                  className="rounded-lg border border-[#CBD5E1] p-1.5 text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="max-h-[540px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Time</th>
                    <th className="px-4 py-2.5 font-semibold">Kind</th>
                    <th className="px-4 py-2.5 font-semibold">Action</th>
                    <th className="px-4 py-2.5 font-semibold">Actor</th>
                    <th className="px-4 py-2.5 font-semibold">Entity / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {logs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#64748B] tabular-nums whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] font-semibold">
                        <span
                          className={
                            entry.access_kind === 'security'
                              ? 'text-[#B91C1C]'
                              : entry.access_kind === 'decision'
                                ? 'text-[#0F4C5C]'
                                : entry.access_kind === 'write'
                                  ? 'text-[#B45309]'
                                  : 'text-[#475569]'
                          }
                        >
                          {entry.access_kind}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-medium text-[#0F172A]">
                        {entry.action}
                      </td>
                      <td className="px-4 py-2.5 text-[#334155]">
                        {entry.actor_name}{' '}
                        <span className="text-[#64748B]">({entry.actor_role})</span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 font-mono text-[11px] text-[#64748B]">
                        {entry.entity_type}:{entry.entity_id} · {JSON.stringify(entry.payload)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-Case JSON Decision Trace Viewer */}
          <section
            aria-label="JSON Decision Trace Viewer"
            className="rounded-xl border border-[#E2E8F0] bg-white p-5 xl:col-span-5"
          >
            <div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
              <FileSearch className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
              <h3 className="text-base font-bold text-[#0F172A]">Per-Case Decision Trace (JSON)</h3>
            </div>
            <p className="mt-2 text-xs text-[#475569]">
              Select any case to inspect its immutable <code>input_hash</code>,{' '}
              <code>rule_version</code>, <code>model_version</code>, <code>matched_rules</code>,
              registry check, and verdict rationale.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {cases.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleInspectCaseTrace(c.id)}
                  className={`rounded-md border px-2.5 py-1.5 font-mono text-xs cursor-pointer ${
                    selectedTraceCase?.id === c.id
                      ? 'border-[#0F4C5C] bg-[#F0F9FA] font-semibold text-[#0F4C5C]'
                      : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {c.id} (v{c.rule_version})
                </button>
              ))}
            </div>

            {selectedTraceCase?.latest_decision ? (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-[#334155]">
                  <strong>Decisions recorded for {selectedTraceCase.id}:</strong>{' '}
                  {selectedTraceCase.decisions.length} (latest by{' '}
                  <span className="font-mono">{selectedTraceCase.latest_decision.decided_by}</span>)
                </div>
                <pre className="max-h-[420px] overflow-auto rounded-lg border border-[#E2E8F0] bg-[#0F172A] p-4 font-mono text-[11px] leading-relaxed text-[#E2E8F0]">
                  {JSON.stringify(selectedTraceCase.latest_decision.auditor_trace, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="mt-6 text-xs text-[#64748B]">
                Click a case button above to load its full JSON auditor trace (and record an{' '}
                <code>audit_trace_viewed</code> read event).
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
