export interface QueuedCheckItem {
  client_request_id: string;
  message_text: string;
  sender_claimed: string;
  payment_ref: string | null;
  family_id: string | null;
  family_label: string | null;
  use_gemini: boolean;
  queued_at: string;
}

const OFFLINE_QUEUE_PREFIX = 'offline_queue:';

function queueKey(userId: string): string {
  return `${OFFLINE_QUEUE_PREFIX}${userId}`;
}

export function generateClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `req-${crypto.randomUUID()}`;
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function quickMaskSensitiveText(text: string): string {
  return text
    .replace(/\b\d{5}-\d{7}-\d\b/g, '[REDACTED-CNIC]')
    .replace(/\b(?:otp|pin|code)[\s:=#-]{0,4}(\d{4,6})\b/gi, '[REDACTED-OTP]')
    .slice(0, 2000);
}

export function loadOfflineQueue(userId: string): QueuedCheckItem[] {
  try {
    const raw = sessionStorage.getItem(queueKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedCheckItem[]) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineCheck(
  userId: string,
  item: Omit<QueuedCheckItem, 'client_request_id' | 'queued_at'>
): QueuedCheckItem {
  const existing = loadOfflineQueue(userId);
  const queued: QueuedCheckItem = {
    ...item,
    message_text: quickMaskSensitiveText(item.message_text),
    client_request_id: generateClientRequestId(),
    queued_at: new Date().toISOString(),
  };
  const next = [...existing, queued];
  try {
    sessionStorage.setItem(queueKey(userId), JSON.stringify(next));
  } catch {
    // Ignore sessionStorage quota errors
  }
  return queued;
}

export function removeOfflineItem(userId: string, clientRequestId: string): QueuedCheckItem[] {
  const next = loadOfflineQueue(userId).filter((i) => i.client_request_id !== clientRequestId);
  try {
    if (next.length === 0) {
      sessionStorage.removeItem(queueKey(userId));
    } else {
      sessionStorage.setItem(queueKey(userId), JSON.stringify(next));
    }
  } catch {
    // Ignore
  }
  return next;
}

export function clearAllOfflineQueues(): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(OFFLINE_QUEUE_PREFIX)) {
        keys.push(k);
      }
    }
    for (const k of keys) {
      sessionStorage.removeItem(k);
      removed += 1;
    }
  } catch {
    // Ignore
  }
  return removed;
}
