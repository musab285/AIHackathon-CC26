import type { MatchedRuleDetail, RuleRecord } from '../../src/shared/types';

export interface RulesEvaluationResult {
  matchedRules: MatchedRuleDetail[];
  ruleScore: number;
  hasHardRedFlag: boolean;
  ruleVersion: number;
}

const KNOWN_OFFICIAL_SHORTCODES = new Set(['8171', '8558', '9999', 'PDMA-MOCK']);

function safeRegexMatch(pattern: string, input: string): string | null {
  try {
    const regex = new RegExp(pattern, 'i');
    const match = input.match(regex);
    return match ? match[0] : null;
  } catch {
    // Fallback to plain case-insensitive substring if admin typed non-regex syntax
    const idx = input.toLowerCase().indexOf(pattern.toLowerCase());
    if (idx === -1) return null;
    return input.slice(idx, idx + pattern.length);
  }
}

export function evaluateRules(
  messageText: string,
  senderClaimed: string,
  activeRules: RuleRecord[]
): RulesEvaluationResult {
  const matchedRules: MatchedRuleDetail[] = [];
  let totalWeight = 0;
  let hasHardRedFlag = false;

  const activeOnly = activeRules.filter((r) => r.active);
  const maxVersion = activeOnly.reduce((max, r) => Math.max(max, r.version), 1);

  const normalizedSender = senderClaimed.trim().toUpperCase();
  const looksLikePersonalPhone = /^(\+?92|0)?3\d{2}[-\s]?\d{7}$/.test(normalizedSender);

  for (const rule of activeOnly) {
    let matchedSnippet: string | null = null;

    if (rule.rule_type === 'sender_mismatch') {
      const claimsOfficialProgram = safeRegexMatch(rule.pattern, messageText);
      const isOfficialShortcode = KNOWN_OFFICIAL_SHORTCODES.has(normalizedSender);
      if (claimsOfficialProgram && (!normalizedSender || looksLikePersonalPhone || !isOfficialShortcode)) {
        matchedSnippet = `Claims "${claimsOfficialProgram}" from non-official sender "${senderClaimed || 'Unknown'}"`;
      }
    } else {
      matchedSnippet = safeRegexMatch(rule.pattern, messageText);
    }

    if (matchedSnippet) {
      matchedRules.push({
        rule_id: rule.id,
        name: rule.name,
        rule_type: rule.rule_type,
        weight: rule.weight,
        matched_snippet: matchedSnippet,
      });
      totalWeight += rule.weight;
      if (rule.rule_type === 'pii_request' || rule.rule_type === 'link' || rule.weight >= 0.45) {
        hasHardRedFlag = true;
      }
    }
  }

  // Clamp total rule scam score to [0, 1]
  const ruleScore = Number(Math.min(1, Math.max(0, totalWeight)).toFixed(3));

  return {
    matchedRules,
    ruleScore,
    hasHardRedFlag,
    ruleVersion: maxVersion,
  };
}
