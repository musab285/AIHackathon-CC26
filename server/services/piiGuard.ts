export interface PiiRedactionResult {
  sanitizedText: string;
  piiRedacted: boolean;
  redactedTypes: string[];
}

// Detects Pakistani CNIC format (12345-1234567-1) or 13-digit CNICs near CNIC keywords
const CNIC_DASHED_RE = /\b\d{5}-\d{7}-\d\b/g;
const CNIC_CONTEXT_RE = /\b(cnic|nic|id\s*card|shanakhti|card\s*no\.?|nadra)([:\s#-]{0,6})(\d{13})\b/gi;

// Detects OTP / PIN codes (4-6 digits near OTP/PIN/code keywords or standalone 6-digit codes)
const OTP_CONTEXT_RE =
  /\b(otp|pin|mpin|tpin|passcode|verification\s*code|secret\s*code|code|password)([:\s#-]{0,8})(\d{4,6})\b/gi;
const OTP_AFTER_DIGITS_RE = /\b(\d{4,6})(\s+(?:is\s+your\s+|hai\s+apka\s+)?(?:otp|pin|mpin|verification\s*code|secret\s*code))\b/gi;

// Detects bank account / IBAN-like strings accidentally pasted
const IBAN_RE = /\bPK\d{2}[A-Z]{4}\d{12,16}\b/gi;

export function normalizeMessageText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function redactPii(rawText: string): PiiRedactionResult {
  let sanitized = normalizeMessageText(rawText);
  const redactedSet = new Set<string>();

  if (CNIC_DASHED_RE.test(sanitized)) {
    redactedSet.add('cnic');
    sanitized = sanitized.replace(CNIC_DASHED_RE, '[REDACTED-CNIC]');
  }

  if (CNIC_CONTEXT_RE.test(sanitized)) {
    redactedSet.add('cnic');
    sanitized = sanitized.replace(CNIC_CONTEXT_RE, '$1$2[REDACTED-CNIC]');
  }

  if (OTP_CONTEXT_RE.test(sanitized)) {
    redactedSet.add('otp_or_pin');
    sanitized = sanitized.replace(OTP_CONTEXT_RE, '$1$2[REDACTED-OTP]');
  }

  if (OTP_AFTER_DIGITS_RE.test(sanitized)) {
    redactedSet.add('otp_or_pin');
    sanitized = sanitized.replace(OTP_AFTER_DIGITS_RE, '[REDACTED-OTP]$2');
  }

  if (IBAN_RE.test(sanitized)) {
    redactedSet.add('bank_iban');
    sanitized = sanitized.replace(IBAN_RE, '[REDACTED-IBAN]');
  }

  return {
    sanitizedText: sanitized,
    piiRedacted: redactedSet.size > 0,
    redactedTypes: Array.from(redactedSet),
  };
}

const FORBIDDEN_PROOF_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'OTP / verification code', regex: /\b(o\.?t\.?p|one[\s-]?time\s*pass|verification\s*code|4[\s-]?digit|6[\s-]?digit)\b/i },
  { label: 'CNIC / national ID number', regex: /\b(c\.?n\.?i\.?c|shanakhti|nadra\s*number|id\s*card\s*number|identity\s*number)\b/i },
  { label: 'PIN / MPIN / ATM PIN', regex: /\b(m?pin|tpin|atm\s*pin|secret\s*pin|wallet\s*pin)\b/i },
  { label: 'bank password / CVV', regex: /\b(password|passcode|bank\s*login|cvv|card\s*number|debit\s*card|easypaisa\s*pin|jazzcash\s*pin)\b/i },
];

export interface SensitiveProofCheckResult {
  allowed: boolean;
  violatedTerms: string[];
}

export function checkSensitiveProofRequest(promptText: string): SensitiveProofCheckResult {
  const violatedTerms: string[] = [];
  for (const { label, regex } of FORBIDDEN_PROOF_PATTERNS) {
    if (regex.test(promptText)) {
      violatedTerms.push(label);
    }
  }
  return {
    allowed: violatedTerms.length === 0,
    violatedTerms,
  };
}
