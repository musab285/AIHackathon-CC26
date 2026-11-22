import type { CandidateMatch, FamilyRecord } from '../../src/shared/types';

// Canonical South Asian / Urdu-English transliteration token map
const TOKEN_CANONICAL: Record<string, string> = {
  mohammad: 'muhammad',
  mohammed: 'muhammad',
  muhammed: 'muhammad',
  muhamad: 'muhammad',
  mohamad: 'muhammad',
  mohd: 'muhammad',
  md: 'muhammad',
  mhd: 'muhammad',
  hussain: 'husain',
  hussein: 'husain',
  hossein: 'husain',
  hossain: 'husain',
  ayesha: 'aisha',
  aysha: 'aisha',
  aiesha: 'aisha',
  aishah: 'aisha',
  fatimah: 'fatima',
  fatemah: 'fatima',
  fatema: 'fatima',
  usman: 'usman',
  osman: 'usman',
  uthman: 'usman',
  zainab: 'zainab',
  zaynab: 'zainab',
  zenab: 'zainab',
  siddiqui: 'sidiqi',
  siddiqi: 'sidiqi',
  sideeqi: 'sidiqi',
  tariq: 'tarik',
  tarik: 'tarik',
  tareq: 'tarik',
  rehman: 'rahman',
  rahman: 'rahman',
  raheem: 'rahim',
  rahim: 'rahim',
  kareem: 'karim',
  karim: 'karim',
  saleem: 'salim',
  salim: 'salim',
  waseem: 'wasim',
  wasim: 'wasim',
  nadeem: 'nadim',
  nadim: 'nadim',
  bibi: 'bibi',
  beebi: 'bibi',
  bano: 'bano',
  banu: 'bano',
  khatoon: 'khatun',
  khatun: 'khatun',
  sheikh: 'shaikh',
  shaikh: 'shaikh',
  shiekh: 'shaikh',
  ahmed: 'ahmad',
  ahmad: 'ahmad',
  ehmad: 'ahmad',
  yousuf: 'yusuf',
  yusuf: 'yusuf',
  yousaf: 'yusuf',
  youssef: 'yusuf',
};

function normalizeToken(rawToken: string): string {
  const lower = rawToken.toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return '';
  if (TOKEN_CANONICAL[lower]) {
    return TOKEN_CANONICAL[lower];
  }
  // Lightweight phonetic reduction: collapse doubles, map q->k, ph->f, z/s/c clusters, oo->u, ee->i
  const reduced = lower
    .replace(/ph/g, 'f')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/q/g, 'k')
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/ey|ay/g, 'ai')
    .replace(/([a-z])\1+/g, '$1');
  return TOKEN_CANONICAL[reduced] ?? reduced;
}

export function computePhoneticKey(displayName: string): string {
  const tokens = displayName
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  return tokens.join('-');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function tokenSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Returns possible candidate family matches WITHOUT ever auto-merging.
 * The Helper or Department Officer must explicitly confirm same person vs. new record.
 */
export function findCandidateMatches(
  displayName: string,
  families: FamilyRecord[]
): CandidateMatch[] {
  const targetKey = computePhoneticKey(displayName);
  if (!targetKey) return [];
  const targetTokens = targetKey.split('-');

  const candidates: CandidateMatch[] = [];

  for (const family of families) {
    const famKey = family.phonetic_key || computePhoneticKey(family.display_name);
    if (famKey === targetKey) {
      candidates.push({
        family,
        match_reason: `Exact phonetic spelling variant match (${targetKey})`,
        similarity: 0.98,
      });
      continue;
    }

    const famTokens = famKey.split('-');
    const overallSim = tokenSimilarity(targetKey, famKey);
    const sharedTokens = targetTokens.filter((t) => famTokens.includes(t));

    if (overallSim >= 0.78) {
      candidates.push({
        family,
        match_reason: `High phonetic similarity (${Math.round(overallSim * 100)}%)`,
        similarity: Number(overallSim.toFixed(2)),
      });
    } else if (sharedTokens.length >= 1 && targetTokens.length >= 2 && famTokens.length >= 2) {
      const avgBestTokenSim =
        targetTokens.reduce((sum, tt) => {
          const best = Math.max(...famTokens.map((ft) => tokenSimilarity(tt, ft)));
          return sum + best;
        }, 0) / targetTokens.length;
      if (avgBestTokenSim >= 0.8) {
        candidates.push({
          family,
          match_reason: `Partial transliteration overlap on "${sharedTokens.join(', ')}"`,
          similarity: Number(avgBestTokenSim.toFixed(2)),
        });
      }
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}
