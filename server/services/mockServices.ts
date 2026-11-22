import type { MockPaymentCheck, MockRegistryCheck } from '../../src/shared/types';

export interface MockOfficialNotice {
  notice_id: string;
  sender_id: string;
  program_name: string;
  required_keywords: string[];
  forbidden_patterns: RegExp[];
  sample_text: string;
  region: string;
}

const FORBIDDEN_SCAM_RE =
  /\b(otp|mpin|tpin|atm\s*pin|pay\s*fee|registration\s*fee|processing\s*fee|processing\s*charges|easyload|send\s*cnic|whatsapp)\b|https?:\/\/|bit\.ly|tinyurl/i;

export const MOCK_OFFICIAL_REGISTRY: MockOfficialNotice[] = [
  {
    notice_id: 'MOCK-NTC-8171-Q4',
    sender_id: '8171',
    program_name: 'Mock Relief Stipend Cycle Q4',
    required_keywords: ['kafalat', 'stipend', 'installment', 'qist', 'relief', 'benazir', 'ehsaas', 'camp'],
    forbidden_patterns: [FORBIDDEN_SCAM_RE],
    sample_text: '8171 Mock Notice: Your quarterly relief installment of Rs 10,500 is ready for biometric collection at your nearest camp site. No fee is charged.',
    region: 'National Mock Registry',
  },
  {
    notice_id: 'MOCK-NTC-8558-FLOOD',
    sender_id: '8558',
    program_name: 'Mock Emergency Flood Cash Grant',
    required_keywords: ['flood', 'relief', 'grant', 'survey', 'tehsil', 'center', 'biometric'],
    forbidden_patterns: [FORBIDDEN_SCAM_RE],
    sample_text: '8558 Mock Notice: Your household survey for Emergency Flood Grant is verified. Visit Tehsil Relief Center with original ID for biometric verification.',
    region: 'Provincial Mock Registry',
  },
  {
    notice_id: 'MOCK-NTC-9999-RATION',
    sender_id: '9999',
    program_name: 'Mock Subsidized Ration Token',
    required_keywords: ['ration', 'atta', 'subsidy', 'utility', 'token', 'store'],
    forbidden_patterns: [FORBIDDEN_SCAM_RE],
    sample_text: '9999 Mock Notice: Your household is eligible for subsidized ration flour at registered Utility Stores. No registration fee applies.',
    region: 'District Mock Registry',
  },
  {
    notice_id: 'MOCK-NTC-PDMA-RELIEF',
    sender_id: 'PDMA-MOCK',
    program_name: 'Mock District Relief Verification',
    required_keywords: ['relief', 'camp', 'verification', 'district', 'schedule', 'biometric'],
    forbidden_patterns: [FORBIDDEN_SCAM_RE],
    sample_text: 'PDMA-MOCK: Relief verification camp opens Tuesday 9 AM at Union Council Office. Bring original ID card in person; never share codes over phone.',
    region: 'District Mock Registry',
  },
];

export const MOCK_IDENTITY_RECORDS: Record<
  string,
  { ref: string; status: 'verified_mock' | 'pending_survey' | 'not_found'; district: string; household_tier: string }
> = {
  'FAM-101': { ref: 'FAM-101', status: 'verified_mock', district: 'Multan (Mock)', household_tier: 'Tier-1 Eligible (Mock)' },
  'FAM-102': { ref: 'FAM-102', status: 'verified_mock', district: 'Sukkur (Mock)', household_tier: 'Tier-1 Eligible (Mock)' },
  'FAM-103': { ref: 'FAM-103', status: 'pending_survey', district: 'Dadu (Mock)', household_tier: 'Survey Pending (Mock)' },
  'FAM-104': { ref: 'FAM-104', status: 'verified_mock', district: 'Swat (Mock)', household_tier: 'Tier-2 Ration (Mock)' },
};

export const MOCK_PAYMENT_RECORDS: Record<
  string,
  { status: 'valid_pending' | 'not_found' | 'duplicate_flagged' | 'disbursed_mock'; amount_pkr: number; program: string; detail: string }
> = {
  'PAY-8171-4401': {
    status: 'valid_pending',
    amount_pkr: 10500,
    program: 'Mock Relief Stipend Cycle Q4',
    detail: 'Pending biometric collection at authorized mock camp site (zero fee).',
  },
  'PAY-8558-2219': {
    status: 'disbursed_mock',
    amount_pkr: 25000,
    program: 'Mock Emergency Flood Cash Grant',
    detail: 'Marked collected on mock ledger; confirm with Tehsil desk if unpaid.',
  },
  'PAY-9999-7782': {
    status: 'duplicate_flagged',
    amount_pkr: 0,
    program: 'Mock Subsidized Ration Token',
    detail: 'Reference flagged for duplicate claim attempts in mock ledger.',
  },
  'PAY-8171-9002': {
    status: 'valid_pending',
    amount_pkr: 10500,
    program: 'Mock Relief Stipend Cycle Q4',
    detail: 'Queued for camp disbursement this week (mock).',
  },
};

const SPOOF_DISCLAIMER =
  'Prototype Mock Registry Only: Forwarded SMS sender names (like 8171) can still be spoofed. Confirm in person at an official desk and never pay fees or share OTP/PIN.';

export function lookupMockSenderRegistry(senderClaimed: string, messageText: string): MockRegistryCheck {
  const cleanSender = senderClaimed.trim().toUpperCase();
  const lowerMsg = messageText.toLowerCase();

  const notice = MOCK_OFFICIAL_REGISTRY.find(
    (entry) =>
      entry.sender_id.toUpperCase() === cleanSender ||
      (cleanSender === '' && lowerMsg.includes(entry.sender_id.toLowerCase()))
  );

  if (!notice) {
    return {
      checked: true,
      matched: false,
      sender_id: cleanSender || null,
      notice_id: null,
      official_program: null,
      disclaimer: SPOOF_DISCLAIMER,
    };
  }

  const hasForbidden = notice.forbidden_patterns.some((re) => re.test(messageText));
  const keywordHits = notice.required_keywords.filter((kw) => lowerMsg.includes(kw));

  if (hasForbidden || keywordHits.length === 0) {
    return {
      checked: true,
      matched: false,
      sender_id: notice.sender_id,
      notice_id: null,
      official_program: notice.program_name,
      disclaimer:
        'Sender ID resembles a mock official shortcode, but message content contains red flags or does not match any active mock notice template.',
    };
  }

  return {
    checked: true,
    matched: true,
    sender_id: notice.sender_id,
    notice_id: notice.notice_id,
    official_program: notice.program_name,
    disclaimer: SPOOF_DISCLAIMER,
  };
}

export function lookupMockPayment(paymentRef: string | null): MockPaymentCheck {
  if (!paymentRef || !paymentRef.trim()) {
    return {
      checked: false,
      payment_ref: null,
      status: 'skipped',
      detail: 'No payment reference supplied.',
    };
  }
  const normalized = paymentRef.trim().toUpperCase();
  const record = MOCK_PAYMENT_RECORDS[normalized];
  if (!record) {
    return {
      checked: true,
      payment_ref: normalized,
      status: 'not_found',
      detail: 'Reference not found in Mock Payment Registry.',
    };
  }
  return {
    checked: true,
    payment_ref: normalized,
    status: record.status,
    detail: `${record.program}: ${record.detail}`,
  };
}

export function lookupMockIdentity(ref: string) {
  const normalized = ref.trim().toUpperCase();
  return (
    MOCK_IDENTITY_RECORDS[normalized] ?? {
      ref: normalized,
      status: 'not_found' as const,
      district: 'Unknown (Mock)',
      household_tier: 'Not Registered in Mock DPI',
    }
  );
}
