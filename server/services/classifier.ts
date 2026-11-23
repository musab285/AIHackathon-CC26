import { GoogleGenAI, Type } from '@google/genai';
import type { AIDecisionOutput, MatchedRuleDetail, MockRegistryCheck } from '../../src/shared/types';
import { checkSensitiveProofRequest } from './piiGuard';

export interface ClassifierInput {
  sanitizedText: string;
  senderClaimed: string;
  matchedRules: MatchedRuleDetail[];
  ruleScore: number;
  registryCheck: MockRegistryCheck;
  useGemini?: boolean;
}

export interface ClassifierResult {
  output: AIDecisionOutput;
  modelVersion: string;
}

export function validateAIDecisionOutput(raw: unknown): AIDecisionOutput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AIDecisionOutput validation failed: expected object');
  }
  const obj = raw as Record<string, unknown>;
  const label = obj.predicted_label;
  if (label !== 'scam' && label !== 'official_like' && label !== 'uncertain') {
    throw new Error(`Invalid predicted_label: ${String(label)}`);
  }
  const confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid confidence: ${String(obj.confidence)}`);
  }
  const signals = Array.isArray(obj.scam_signals)
    ? obj.scam_signals.map((s) => String(s)).slice(0, 8)
    : [];
  const plainEn = typeof obj.plain_reason_en === 'string' && obj.plain_reason_en.trim()
    ? obj.plain_reason_en.trim()
    : 'Automated message check completed.';
  const plainUr = typeof obj.plain_reason_ur === 'string' && obj.plain_reason_ur.trim()
    ? obj.plain_reason_ur.trim()
    : 'پیغام کی خودکار جانچ مکمل ہو گئی ہے۔';

  let safeFollowup: string | null =
    typeof obj.safe_followup_question === 'string' && obj.safe_followup_question.trim()
      ? obj.safe_followup_question.trim()
      : null;

  // Enforce anti-phishing invariant on AI output
  if (safeFollowup && !checkSensitiveProofRequest(safeFollowup).allowed) {
    safeFollowup =
      'Without sharing any OTP, CNIC, or PIN: was this message sent from a personal mobile number or did anyone ask for a fee?';
  }

  return {
    predicted_label: label,
    confidence: Number(confidence.toFixed(3)),
    scam_signals: signals,
    plain_reason_en: plainEn,
    plain_reason_ur: plainUr,
    safe_followup_question: safeFollowup,
  };
}

// Lightweight deterministic hybrid NLP classifier (Roman Urdu + English signals)
const SCAM_LEXICON: Array<{ term: string; weight: number; re: RegExp }> = [
  { term: 'asks for OTP/PIN/code', weight: 0.48, re: /\b(otp|pin|mpin|code\s*bhej|send\s*code|share\s*(?:the\s*)?(?:\d[- ]?digit\s*)?code|verification\s*code|password)\b/i },
  { term: 'asks for upfront fee or load', weight: 0.46, re: /\b(pay\s*(?:rs\.?\s*\d+\s*)?(?:registration\s*|processing\s*)?fee|processing\s*(?:fee|charges)|easyload|easy\s*load|jazzcash\s*par\s*bhej|easypaisa\s*bhej|rs\.?\s*\d{2,4}\s*(?:bhej|send|pay|fee|charges)|tax\s*clearance)\b/i },
  { term: 'suspicious external link', weight: 0.42, re: /(https?:\/\/|bit\.ly|tinyurl|t\.me|wa\.me|forms\.gle|apk|click\s*here|link\s*par\s*click)/i },
  { term: 'fake prize / lucky draw claim', weight: 0.40, re: /\b(jeeto|inaam|lottery|lucky\s*draw|prize|congratulations\s*you\s*won|25\s*lakh|70\s*hazar|jeeta\s*hai)\b/i },
  { term: 'urgent account block threat', weight: 0.25, re: /\b(urgent|fauran|abhi|within\s*\d+\s*(?:min|hour)|block\s*ho\s*jaye|band\s*ho\s*jaye|last\s*chance|expire\s*today)\b/i },
  { term: 'requests CNIC photo or personal number', weight: 0.42, re: /\b(send\s*cnic|cnic\s*bhej|shanakhti\s*card\s*ki\s*tasveer|cnic\s*photo|reply\s*with\s*cnic|\[REDACTED-CNIC\]|\[REDACTED-OTP\])\b/i },
  { term: 'WhatsApp agent contact', weight: 0.30, re: /\b(whatsapp\s*(?:kar|par|number|rabta)|call\s*agent|officer\s*number\s*03)\b/i },
];

const OFFICIAL_LEXICON: Array<{ term: string; weight: number; re: RegExp }> = [
  { term: 'biometric in-person collection', weight: 0.35, re: /\b(biometric|camp\s*site|tehsil|union\s*council|utility\s*store|registered\s*center|official\s*desk)\b/i },
  { term: 'explicit zero-fee reminder', weight: 0.30, re: /\b(no\s*fee|koi\s*fees\s*nahi|free\s*of\s*cost|never\s*share\s*codes|muft)\b/i },
  { term: 'standard stipend/ration wording', weight: 0.25, re: /\b(quarterly\s*relief|installment|qist|subsidized\s*ration|household\s*survey|flood\s*grant|kafalat)\b/i },
];

export function deterministicClassify(input: ClassifierInput): ClassifierResult {
  const { sanitizedText, matchedRules, ruleScore, registryCheck } = input;
  const scamSignals: string[] = [];
  let lexiconScam = 0;

  for (const item of SCAM_LEXICON) {
    if (item.re.test(sanitizedText)) {
      scamSignals.push(item.term);
      lexiconScam += item.weight;
    }
  }

  for (const r of matchedRules) {
    if (!scamSignals.includes(r.name)) {
      scamSignals.push(r.name);
    }
  }

  let officialSignalScore = 0;
  for (const item of OFFICIAL_LEXICON) {
    if (item.re.test(sanitizedText)) {
      officialSignalScore += item.weight;
    }
  }

  const combinedScam = Math.min(0.99, Math.max(ruleScore, lexiconScam * 0.85 + ruleScore * 0.35));

  let rawOutput: AIDecisionOutput;

  if (combinedScam >= 0.72) {
    rawOutput = {
      predicted_label: 'scam',
      confidence: Number(Math.min(0.98, Math.max(0.75, combinedScam)).toFixed(3)),
      scam_signals: scamSignals.slice(0, 6),
      plain_reason_en:
        scamSignals.length > 0
          ? `Warning: High-risk scam signs found (${scamSignals.slice(0, 2).join(', ')}).`
          : 'Warning: This message shows strong signs of a relief payment scam.',
      plain_reason_ur:
        'خبردار: اس پیغام میں دھوکہ دہی (اسکیم) کی واضح علامات موجود ہیں۔',
      safe_followup_question: null,
    };
  } else if (registryCheck.matched && combinedScam < 0.2 && officialSignalScore >= 0.45) {
    const conf = Number(Math.min(0.97, 0.84 + officialSignalScore * 0.16).toFixed(3));
    rawOutput = {
      predicted_label: 'official_like',
      confidence: conf,
      scam_signals: [],
      plain_reason_en: `Text structure aligns with mock official notice from ${registryCheck.sender_id} and has no fee, link, or OTP requests.`,
      plain_reason_ur: `پیغام کا انداز ${registryCheck.sender_id} کے موک سرکاری نوٹس سے ملتا ہے اور اس میں کوئی لنک، فیس یا کوڈ نہیں مانگا گیا۔`,
      safe_followup_question: null,
    };
  } else if (combinedScam >= 0.35) {
    rawOutput = {
      predicted_label: 'uncertain',
      confidence: Number(Math.min(0.74, Math.max(0.58, combinedScam + 0.15)).toFixed(3)),
      scam_signals: scamSignals.slice(0, 5),
      plain_reason_en: 'Some warning signs appeared, but more non-sensitive context is needed before deciding.',
      plain_reason_ur: 'اس پیغام میں کچھ مشکوک اشارے ہیں، حتمی فیصلے سے پہلے محفوظ معلومات درکار ہیں۔',
      safe_followup_question:
        'Without sharing any OTP, CNIC, or PIN: did this arrive from a personal 03XX mobile number or ask you to visit a private shop?',
    };
  } else {
    rawOutput = {
      predicted_label: 'uncertain',
      confidence: Number(Math.min(0.55, 0.35 + officialSignalScore * 0.2).toFixed(3)),
      scam_signals: scamSignals,
      plain_reason_en: 'Could not verify this message against the mock official notice registry.',
      plain_reason_ur: 'یہ پیغام موک سرکاری رجسٹری سے تصدیق نہیں ہو سکا۔',
      safe_followup_question: null,
    };
  }

  return {
    output: validateAIDecisionOutput(rawOutput),
    modelVersion: 'hybrid-rules-nlp-v1',
  };
}

export async function classifyMessage(input: ClassifierInput): Promise<ClassifierResult> {
  if (!input.useGemini) {
    return deterministicClassify(input);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in Settings > Secrets. Switch off Gemini Enhanced Mode or configure your API key.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = [
    'You are a safety-first relief payment scam analyzer for low-literacy citizens and community helpers.',
    'A missed scam costs 10x more than a false alarm. Never declare a message safe just from tone or sender name.',
    'Never ask the user for OTP, CNIC, PIN, password, or bank details in safe_followup_question.',
    'Analyze the redacted message and return strictly valid JSON matching the schema.',
    'Keep plain_reason_en to one clear plain-English sentence and plain_reason_ur to one clear Urdu sentence.',
  ].join(' ');

  const prompt = JSON.stringify({
    sender_claimed: input.senderClaimed || '(none)',
    message_text_redacted: input.sanitizedText,
    matched_rules: input.matchedRules.map((r) => `${r.name} (${r.rule_type}, w=${r.weight})`),
    mock_registry_matched: input.registryCheck.matched,
    mock_registry_program: input.registryCheck.official_program,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          predicted_label: {
            type: Type.STRING,
            description: 'Must be one of: scam, official_like, uncertain',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score between 0.0 and 1.0',
          },
          scam_signals: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Short plain-language red flags detected',
          },
          plain_reason_en: {
            type: Type.STRING,
            description: 'One simple sentence explaining why in English',
          },
          plain_reason_ur: {
            type: Type.STRING,
            description: 'One simple sentence explaining why in Urdu script',
          },
          safe_followup_question: {
            type: Type.STRING,
            nullable: true,
            description: 'Optional non-sensitive question (NEVER ask for OTP, CNIC, PIN, password)',
          },
        },
        required: [
          'predicted_label',
          'confidence',
          'scam_signals',
          'plain_reason_en',
          'plain_reason_ur',
        ],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  const parsed = JSON.parse(rawText);
  return {
    output: validateAIDecisionOutput(parsed),
    modelVersion: 'gemini-3.8-flash',
  };
}
