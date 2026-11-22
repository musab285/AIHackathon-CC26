import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPii, checkSensitiveProofRequest } from './piiGuard';
import { computePhoneticKey, findCandidateMatches } from './nameMatcher';
import { lookupMockSenderRegistry, lookupMockPayment } from './mockServices';
import { evaluateRules } from './rulesEngine';
import { deterministicClassify } from './classifier';
import { routeVerdict } from './router';
import { evaluateSyntheticDataset, runVerificationPipeline } from './pipeline';
import { RelationalStore } from '../db/store';
import { toPublicUser } from '../security';

test('PII guardrail redacts CNIC and OTP before storage', () => {
  const input = 'My CNIC is 35202-1234567-1 and OTP: 482910 for relief check.';
  const result = redactPii(input);
  assert.equal(result.piiRedacted, true);
  assert.ok(result.redactedTypes.includes('cnic'));
  assert.ok(result.redactedTypes.includes('otp_or_pin'));
  assert.ok(!result.sanitizedText.includes('35202-1234567-1'));
  assert.ok(!result.sanitizedText.includes('482910'));
  assert.ok(result.sanitizedText.includes('[REDACTED-CNIC]'));
  assert.ok(result.sanitizedText.includes('[REDACTED-OTP]'));
});

test('Anti-phishing guardrail blocks sensitive proof prompts from officers', () => {
  const bad1 = checkSensitiveProofRequest('Please reply with your 6-digit OTP code');
  assert.equal(bad1.allowed, false);
  assert.ok(bad1.violatedTerms.length > 0);

  const bad2 = checkSensitiveProofRequest('Send your CNIC number and JazzCash PIN');
  assert.equal(bad2.allowed, false);

  const good = checkSensitiveProofRequest('Did this SMS arrive from a personal mobile number or an official shortcode?');
  assert.equal(good.allowed, true);
});

test('Phonetic name matcher groups Muhammad/Mohammad/Muhammed as candidates without auto-merging', () => {
  const k1 = computePhoneticKey('Muhammad Tariq');
  const k2 = computePhoneticKey('Mohammad Tareq');
  const k3 = computePhoneticKey('Muhammed Tarik');
  assert.equal(k1, k2);
  assert.equal(k2, k3);

  const store = new RelationalStore(false);
  const candidates = findCandidateMatches('Mohammad Tariq', store.state.families);
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].family.display_name, 'Muhammad Tariq');
  assert.ok(candidates[0].similarity >= 0.95);
});

test('Asymmetric router NEVER marks a message official without verified mock registry match', () => {
  const store = new RelationalStore(false);
  const rules = store.getActiveRules();
  const thresholds = store.getActiveThresholds();

  // Official-sounding text from an unregistered sender
  const sender = 'UNKNOWN-DESK';
  const text = 'Your quarterly relief installment is ready for biometric collection. No fee is charged.';
  const registryCheck = lookupMockSenderRegistry(sender, text);
  assert.equal(registryCheck.matched, false);

  const rulesRes = evaluateRules(text, sender, rules);
  const cls = deterministicClassify({
    sanitizedText: text,
    senderClaimed: sender,
    matchedRules: rulesRes.matchedRules,
    ruleScore: rulesRes.ruleScore,
    registryCheck,
  });
  const routed = routeVerdict({
    ruleScore: rulesRes.ruleScore,
    hasHardRedFlag: rulesRes.hasHardRedFlag,
    aiOutput: cls.output,
    registryCheck,
    paymentCheck: lookupMockPayment(null),
    thresholds,
  });

  assert.notEqual(routed.verdict, 'matches_mock_official_notice');
  assert.equal(routed.verdict, 'unverified_officer_review');
  assert.ok(routed.user_explanation_en.includes('I am not sure'));
});

test('Verified 8171 official notice matches with spoofed-sender caveat', () => {
  const store = new RelationalStore(false);
  const rules = store.getActiveRules();
  const thresholds = store.getActiveThresholds();

  const sender = '8171';
  const text =
    '8171 Mock Notice: Your quarterly relief installment of Rs 10,500 is ready for biometric collection at your nearest camp site. No fee is charged.';
  const registryCheck = lookupMockSenderRegistry(sender, text);
  assert.equal(registryCheck.matched, true);

  const rulesRes = evaluateRules(text, sender, rules);
  const cls = deterministicClassify({
    sanitizedText: text,
    senderClaimed: sender,
    matchedRules: rulesRes.matchedRules,
    ruleScore: rulesRes.ruleScore,
    registryCheck,
  });
  const routed = routeVerdict({
    ruleScore: rulesRes.ruleScore,
    hasHardRedFlag: rulesRes.hasHardRedFlag,
    aiOutput: cls.output,
    registryCheck,
    paymentCheck: lookupMockPayment('PAY-8171-4401'),
    thresholds,
  });

  assert.equal(routed.verdict, 'matches_mock_official_notice');
  assert.ok(routed.user_explanation_en.toLowerCase().includes('spoofed'));
});

test('Withdrawn consent blocks mock payment lookup and writes consent_denied audit log', async () => {
  const store = new RelationalStore(false);
  const helper = toPublicUser(store.state.users.find((u) => u.role === 'helper')!);

  // Withdraw mock_payment consent for FAM-101
  const consent = store.state.consents.find(
    (c) => c.subject_id === 'FAM-101' && c.scope === 'mock_payment'
  )!;
  consent.status = 'withdrawn';
  consent.withdrawn_at = new Date().toISOString();

  const res = await runVerificationPipeline({
    store,
    actor: helper,
    familyId: 'FAM-101',
    senderClaimed: '8171',
    paymentRef: 'PAY-8171-4401',
    messageText:
      '8171 Mock Notice: Your quarterly relief installment of Rs 10,500 is ready for biometric collection at your nearest camp site. No fee is charged.',
  });

  assert.equal(res.trace.payment_check.blocked_by_consent, true);
  assert.equal(res.trace.payment_check.status, 'skipped');
  const deniedAudit = store.state.audit_log.find((a) => a.action === 'consent_denied');
  assert.ok(deniedAudit, 'Expected consent_denied audit event');
});

test('Synthetic N=30 evaluation catches scams with zero missed scams at default thresholds', () => {
  const store = new RelationalStore(false);
  const stats = evaluateSyntheticDataset(
    store.getActiveRules(),
    store.getActiveThresholds(),
    store.state.cases
  );
  assert.equal(stats.sample_size, 30);
  assert.equal(stats.metrics.missed_scams, 0);
  assert.ok(stats.metrics.scams_caught_auto >= 10);
  assert.ok(stats.metrics.official_verified_matches >= 8);
});
