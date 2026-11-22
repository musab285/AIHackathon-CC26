/**
 * Shared-Phone Privacy Draft Storage
 * - Never stores raw message text in a single shared localStorage key.
 * - Uses sessionStorage namespaced strictly by `draft:{helper_id}:{family_id}`.
 * - Stores only minimal non-sensitive metadata and a truncated, PII-masked snippet.
 * - Auto-clears on submit, family switch, or explicit "Clear Local Drafts / Lock Phone".
 */

export interface SafeDraftPayload {
  sender_claimed: string;
  payment_ref: string;
  snippet: string;
  saved_at: string;
}

const DRAFT_PREFIX = 'draft:';

function maskQuickPii(text: string): string {
  return text
    .replace(/\b\d{5}-\d{7}-\d\b/g, '[MASKED-ID]')
    .replace(/\b(otp|pin|code)([:\s#-]{0,6})(\d{4,6})\b/gi, '$1$2[MASKED]');
}

export function buildDraftKey(helperId: string, familyId: string | null): string {
  return `${DRAFT_PREFIX}${helperId}:${familyId ?? 'self'}`;
}

export function saveIsolatedDraft(
  helperId: string,
  familyId: string | null,
  draft: { sender_claimed: string; payment_ref: string; message_text: string }
): void {
  try {
    const key = buildDraftKey(helperId, familyId);
    const trimmed = draft.message_text.trim();
    if (!trimmed && !draft.sender_claimed.trim() && !draft.payment_ref.trim()) {
      window.sessionStorage.removeItem(key);
      return;
    }
    const safePayload: SafeDraftPayload = {
      sender_claimed: draft.sender_claimed.slice(0, 40),
      payment_ref: draft.payment_ref.slice(0, 32),
      // Store truncated, quick-masked snippet only (max 280 chars)
      snippet: maskQuickPii(trimmed).slice(0, 280),
      saved_at: new Date().toISOString(),
    };
    window.sessionStorage.setItem(key, JSON.stringify(safePayload));
  } catch {
    // Graceful no-op in restricted browsing contexts
  }
}

export function loadIsolatedDraft(
  helperId: string,
  familyId: string | null
): SafeDraftPayload | null {
  try {
    const raw = window.sessionStorage.getItem(buildDraftKey(helperId, familyId));
    if (!raw) return null;
    return JSON.parse(raw) as SafeDraftPayload;
  } catch {
    return null;
  }
}

export function clearIsolatedDraft(helperId: string, familyId: string | null): void {
  try {
    window.sessionStorage.removeItem(buildDraftKey(helperId, familyId));
  } catch {
    // ignore
  }
}

export function clearAllHelperDrafts(): number {
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.sessionStorage.removeItem(k);
      removed += 1;
    }
  } catch {
    // ignore
  }
  return removed;
}

export function countActiveLocalDrafts(): number {
  let count = 0;
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) count += 1;
    }
  } catch {
    // ignore
  }
  return count;
}
