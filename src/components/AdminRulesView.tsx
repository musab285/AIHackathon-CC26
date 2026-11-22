import React, { useEffect, useState } from 'react';
import { Lock, Plus, Save, Sliders, Terminal } from 'lucide-react';
import type {
  EvalStatsResponse,
  RuleRecord,
  RuleType,
  UserPublic,
} from '../shared/types';
import { api } from '../utils/api';

interface AdminRulesViewProps {
  user: UserPublic;
  demoApiKey: string;
}

export function AdminRulesView({ user, demoApiKey }: AdminRulesViewProps) {
  const isAdmin = user.role === 'admin';
  const canRead = user.role === 'admin' || user.role === 'officer' || user.role === 'auditor';

  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [activeRuleVersion, setActiveRuleVersion] = useState(1);
  const [stats, setStats] = useState<EvalStatsResponse | null>(null);

  const [scamThr, setScamThr] = useState(0.8);
  const [officialThr, setOfficialThr] = useState(0.95);
  const [askInfoThr, setAskInfoThr] = useState(0.6);

  // Add new rule state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RuleType>('keyword');
  const [newPattern, setNewPattern] = useState('');
  const [newWeight, setNewWeight] = useState(0.45);

  // Public /v1/check API tester
  const [apiKeyInput, setApiKeyInput] = useState(demoApiKey || 'rmc_demo_public_key_2026');
  const [apiTestMsg, setApiTestMsg] = useState(
    'Ehsaas urgent: click bit.ly/claim-now and pay Rs 500 fee today.'
  );
  const [apiTestResult, setApiTestResult] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = async () => {
    if (!canRead) return;
    setError(null);
    try {
      const [rulesRes, thrRes, statsRes] = await Promise.all([
        api.getRules(),
        api.getThresholds(),
        api.getStats(),
      ]);
      setRules(rulesRes.rules);
      setActiveRuleVersion(rulesRes.active_version);
      setScamThr(thrRes.active.scam_auto_threshold);
      setOfficialThr(thrRes.active.official_match_threshold);
      setAskInfoThr(thrRes.active.ask_info_threshold);
      setStats(statsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin configuration.');
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  if (!canRead) {
    return (
      <section className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-[#64748B]" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-bold text-[#0F172A]">Admin or Governance Role Required</h2>
        <p className="mt-1 text-sm text-[#475569]">
          Switch to <strong>Kamran Qureshi (Admin)</strong> to edit versioned rules, adjust
          asymmetric thresholds, and inspect the live N=30 synthetic evaluation table.
        </p>
      </section>
    );
  }

  const handleSaveThresholds = async () => {
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.updateThresholds({
        scam_auto_threshold: scamThr,
        official_match_threshold: officialThr,
        ask_info_threshold: askInfoThr,
      });
      const updatedStats = await api.getStats();
      setStats(updatedStats);
      setNotice(
        `Saved Thresholds v${res.active.version} live without redeploy. Synthetic N=30 metrics recalculated.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update thresholds.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.createRule({
        name: newName,
        rule_type: newType,
        pattern: newPattern,
        weight: newWeight,
      });
      setNewName('');
      setNewPattern('');
      setNotice(
        `Created rule "${res.rule.name}" under Rule Version v${res.active_version}. Older case decisions retain their original version.`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create rule.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRule = async (rule: RuleRecord) => {
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.updateRule(rule.id, { active: !rule.active });
      setNotice(
        `Published Rule Version v${res.active_version} (${rule.name} set to ${res.rule.active ? 'active' : 'inactive'}).`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update rule.');
    } finally {
      setBusy(false);
    }
  };

  const handleWeightBump = async (rule: RuleRecord, delta: number) => {
    if (!isAdmin) return;
    const nextWeight = Number(Math.min(1, Math.max(0.05, rule.weight + delta)).toFixed(2));
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateRule(rule.id, { weight: nextWeight });
      setNotice(`Updated "${rule.name}" weight to ${nextWeight} in Rule Version v${res.active_version}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Weight update failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestPublicApi = async () => {
    setError(null);
    try {
      const data = await api.publicCheck(apiKeyInput, {
        message_text: apiTestMsg,
        sender_claimed: '0300-0000000',
      });
      setApiTestResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiTestResult(
        JSON.stringify({ error: err instanceof Error ? err.message : 'API Error' }, null, 2)
      );
    }
  };

  const activeRules = rules.filter((r) => r.active);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A]">
            Live Rules, Asymmetric Thresholds &amp; Synthetic Eval
          </h2>
          <p className="mt-0.5 text-sm text-[#475569]">
            Rule edits create immutable new versions instantly with zero redeploy. Missed scams are
            weighted 10x heavier than false alarms.
          </p>
        </div>
        <div className="font-mono text-xs text-[#475569] tabular-nums">
          Active Rule v{activeRuleVersion} · Threshold v{stats?.active_threshold_version ?? 1}
          {!isAdmin ? ' · Read-Only View' : ''}
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

      {/* Honest N=30 Synthetic Prototype Metrics Strip */}
      {stats && (
        <section aria-label="Synthetic Dataset Evaluation Summary" className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
            <h3 className="text-sm font-bold text-[#0F172A]">{stats.dataset_label}</h3>
            <span className="text-xs text-[#64748B]">
              Raw error counts only — prototype synthetic dataset (no inflated accuracy claims)
            </span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="border-r border-[#E2E8F0] pr-4 last:border-none">
              <p className="text-xs text-[#64748B]">Missed Scams (10x cost)</p>
              <p
                className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                  stats.metrics.missed_scams > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'
                }`}
              >
                {stats.metrics.missed_scams}
              </p>
            </div>
            <div className="border-r border-[#E2E8F0] pr-4 last:border-none">
              <p className="text-xs text-[#64748B]">False Alarms (1x cost)</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#B45309] tabular-nums">
                {stats.metrics.false_alarms}
              </p>
            </div>
            <div className="border-r border-[#E2E8F0] pr-4 last:border-none">
              <p className="text-xs text-[#64748B]">Human Handoffs</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#1D4ED8] tabular-nums">
                {stats.metrics.human_handoffs}
              </p>
            </div>
            <div className="border-r border-[#E2E8F0] pr-4 last:border-none">
              <p className="text-xs text-[#64748B]">Scams Auto-Flagged</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                {stats.metrics.scams_caught_auto} / 12
              </p>
            </div>
            <div>
              <p className="text-xs text-[#64748B]">Mock Official Matches</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
                {stats.metrics.official_verified_matches} / 10
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Asymmetric Threshold Sliders + Add Rule */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section
          aria-label="Asymmetric Decision Thresholds"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 lg:col-span-6"
        >
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
            <h3 className="text-base font-bold text-[#0F172A]">Asymmetric Threshold Controls</h3>
          </div>
          <p className="mt-1 text-xs text-[#475569]">
            Tighten scam auto-warning or official verification gates live. Official matches always
            also require a verified Mock Sender Registry hit.
          </p>

          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold">
                <label htmlFor="slider-scam">Scam Auto-Warn Threshold</label>
                <span className="font-mono text-[#B91C1C] tabular-nums">{scamThr.toFixed(2)}</span>
              </div>
              <input
                id="slider-scam"
                type="range"
                min={0.5}
                max={0.95}
                step={0.05}
                disabled={!isAdmin}
                value={scamThr}
                onChange={(e) => setScamThr(Number(e.target.value))}
                className="mt-2 w-full accent-[#0F4C5C]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-semibold">
                <label htmlFor="slider-official">Official Match Threshold (+ Registry Required)</label>
                <span className="font-mono text-[#15803D] tabular-nums">
                  {officialThr.toFixed(2)}
                </span>
              </div>
              <input
                id="slider-official"
                type="range"
                min={0.8}
                max={0.99}
                step={0.01}
                disabled={!isAdmin}
                value={officialThr}
                onChange={(e) => setOfficialThr(Number(e.target.value))}
                className="mt-2 w-full accent-[#0F4C5C]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-semibold">
                <label htmlFor="slider-askinfo">Ask Non-Sensitive Info Threshold</label>
                <span className="font-mono text-[#B45309] tabular-nums">
                  {askInfoThr.toFixed(2)}
                </span>
              </div>
              <input
                id="slider-askinfo"
                type="range"
                min={0.35}
                max={0.85}
                step={0.05}
                disabled={!isAdmin}
                value={askInfoThr}
                onChange={(e) => setAskInfoThr(Number(e.target.value))}
                className="mt-2 w-full accent-[#0F4C5C]"
              />
            </div>

            {isAdmin && (
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveThresholds}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F4C5C] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save Threshold Version &amp; Re-Evaluate N=30
              </button>
            )}
          </div>
        </section>

        {/* Add Rule Form */}
        <section
          aria-label="Add Detection Rule"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 lg:col-span-6"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
            <h3 className="text-base font-bold text-[#0F172A]">Publish New Versioned Rule</h3>
          </div>
          <p className="mt-1 text-xs text-[#475569]">
            Add a new scam phrase, phishing domain, or urgency regex without redeploying code.
          </p>

          <form onSubmit={handleAddRule} className="mt-4 space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="rule-name" className="block text-xs font-medium text-[#334155]">
                  Rule Name
                </label>
                <input
                  id="rule-name"
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Fake Biometric Home Visit"
                  className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="rule-type" className="block text-xs font-medium text-[#334155]">
                  Rule Category
                </label>
                <select
                  id="rule-type"
                  disabled={!isAdmin}
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as RuleType)}
                  className="mt-1 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0F172A]"
                >
                  <option value="keyword">keyword</option>
                  <option value="link">link</option>
                  <option value="pii_request">pii_request</option>
                  <option value="urgency">urgency</option>
                  <option value="sender_mismatch">sender_mismatch</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="rule-pattern" className="block text-xs font-medium text-[#334155]">
                  Regex or Keyword Pattern
                </label>
                <input
                  id="rule-pattern"
                  type="text"
                  required
                  disabled={!isAdmin}
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  placeholder="e.g. home\s*biometric\s*fee|agent\s*visit\s*rs"
                  className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="rule-weight" className="block text-xs font-medium text-[#334155]">
                  Weight (0.05–1.0)
                </label>
                <input
                  id="rule-weight"
                  type="number"
                  min={0.05}
                  max={1}
                  step={0.05}
                  disabled={!isAdmin}
                  value={newWeight}
                  onChange={(e) => setNewWeight(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-sm tabular-nums text-[#0F172A]"
                />
              </div>
            </div>

            {isAdmin && (
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F4C5C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Rule (Creates v{activeRuleVersion + 1})
              </button>
            )}
          </form>
        </section>
      </div>

      {/* Active Versioned Rules Table */}
      <section aria-label="Active Rules Table" className="rounded-xl border border-[#E2E8F0] bg-white">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
          <h3 className="text-base font-bold text-[#0F172A]">
            Active Detection Rules ({activeRules.length})
          </h3>
          <span className="font-mono text-xs text-[#64748B]">
            Total revisions stored: {rules.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
              <tr>
                <th className="px-5 py-3 font-semibold">Ver</th>
                <th className="px-5 py-3 font-semibold">Rule Name</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Pattern</th>
                <th className="px-5 py-3 text-right font-semibold">Weight</th>
                {isAdmin && <th className="px-5 py-3 text-right font-semibold">Live Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {activeRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-[#F8FAFC]">
                  <td className="px-5 py-3 font-mono text-[#64748B] tabular-nums">
                    v{rule.version}
                  </td>
                  <td className="px-5 py-3 font-semibold text-[#0F172A]">{rule.name}</td>
                  <td className="px-5 py-3 font-mono text-[#475569]">{rule.rule_type}</td>
                  <td className="max-w-xs truncate px-5 py-3 font-mono text-[#64748B]">
                    {rule.pattern}
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-[#0F172A] tabular-nums">
                    {rule.weight.toFixed(2)}
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleWeightBump(rule, 0.05)}
                          className="rounded border border-[#CBD5E1] px-2 py-1 font-mono text-[11px] hover:bg-[#F1F5F9] cursor-pointer"
                          aria-label={`Increase weight of ${rule.name}`}
                        >
                          +0.05
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleWeightBump(rule, -0.05)}
                          className="rounded border border-[#CBD5E1] px-2 py-1 font-mono text-[11px] hover:bg-[#F1F5F9] cursor-pointer"
                          aria-label={`Decrease weight of ${rule.name}`}
                        >
                          -0.05
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleRule(rule)}
                          className="rounded border border-[#FECACA] px-2 py-1 text-[11px] font-medium text-[#991B1B] hover:bg-[#FEF2F2] cursor-pointer"
                        >
                          Disable
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Synthetic Dataset N=30 Evaluation Breakdown + Public /v1/check Tester */}
      <div className="grid gap-6 xl:grid-cols-12">
        {stats && (
          <section
            aria-label="Synthetic N=30 Evaluation Table"
            className="rounded-xl border border-[#E2E8F0] bg-white xl:col-span-8"
          >
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
              <h3 className="text-base font-bold text-[#0F172A]">
                Synthetic Evaluation Breakdown (N=30)
              </h3>
              <span className="font-mono text-xs text-[#64748B] tabular-nums">
                Asymmetric Cost: {stats.metrics.asymmetric_cost_score}
              </span>
            </div>
            <div className="max-h-[380px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">ID</th>
                    <th className="px-4 py-2.5 font-semibold">Category</th>
                    <th className="px-4 py-2.5 font-semibold">Truth</th>
                    <th className="px-4 py-2.5 font-semibold">Predicted Verdict</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Scam / Off</th>
                    <th className="px-4 py-2.5 font-semibold">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {stats.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-2.5 font-mono text-[#64748B]">{row.id}</td>
                      <td className="px-4 py-2.5 text-[#0F172A]">{row.category}</td>
                      <td className="px-4 py-2.5 font-mono capitalize text-[#334155]">
                        {row.ground_truth}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[#334155]">
                        {row.predicted_verdict}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#475569]">
                        {row.scam_score.toFixed(2)} / {row.official_score.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 font-semibold">
                        <span
                          className={
                            row.outcome === 'missed_scam'
                              ? 'text-[#B91C1C]'
                              : row.outcome === 'false_alarm'
                                ? 'text-[#B45309]'
                                : row.outcome === 'human_handoff'
                                  ? 'text-[#1D4ED8]'
                                  : 'text-[#15803D]'
                          }
                        >
                          {row.outcome.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Public Partner API Tester */}
        <section
          aria-label="Public Partner API Tester"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 xl:col-span-4"
        >
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
            <h3 className="text-base font-bold text-[#0F172A]">Public API: POST /v1/check</h3>
          </div>
          <p className="mt-1 text-xs text-[#475569]">
            Authenticated via <code>X-API-Key</code> with server-side rate limiting (20 req/min).
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="public-api-key" className="block text-xs font-medium text-[#334155]">
                Demo X-API-Key Header
              </label>
              <input
                id="public-api-key"
                type="text"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label htmlFor="public-api-msg" className="block text-xs font-medium text-[#334155]">
                Message Payload
              </label>
              <textarea
                id="public-api-msg"
                rows={3}
                value={apiTestMsg}
                onChange={(e) => setApiTestMsg(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] p-2.5 text-xs text-[#0F172A]"
              />
            </div>
            <button
              type="button"
              onClick={handleTestPublicApi}
              className="w-full rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E293B] cursor-pointer"
            >
              Send POST /v1/check Request
            </button>

            {apiTestResult && (
              <pre className="max-h-52 overflow-auto rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-mono text-[11px] text-[#0F172A]">
                {apiTestResult}
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
