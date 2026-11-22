import type {
  ApiKeyRecord,
  AuditLogEntry,
  CaseRecord,
  ConsentRecord,
  DecisionRecord,
  FamilyRecord,
  RuleRecord,
  SyntheticSample,
  ThresholdConfig,
  UserRecord,
} from '../../src/shared/types';
import { hashPassword, sha256 } from '../security';
import { computePhoneticKey } from '../services/nameMatcher';

export const DEMO_PUBLIC_API_KEY = 'rmc_demo_public_key_2026';

export interface DatabaseState {
  users: UserRecord[];
  families: FamilyRecord[];
  api_keys: ApiKeyRecord[];
  cases: CaseRecord[];
  decisions: DecisionRecord[];
  rules: RuleRecord[];
  thresholds: ThresholdConfig[];
  consents: ConsentRecord[];
  audit_log: AuditLogEntry[];
}

export const SYNTHETIC_DATASET: SyntheticSample[] = [
  // 12 Synthetic Scams
  {
    id: 'SYN-01',
    sender_claimed: '0301-8842109',
    payment_ref: null,
    message_text: 'Mubarak ho! Apka 25000 BISP relief approve ho gaya hai. Fauran apna 6-digit OTP code bhejein warna account block ho jaye ga.',
    ground_truth: 'scam',
    category: 'OTP Theft + Urgency',
  },
  {
    id: 'SYN-02',
    sender_claimed: '0345-9910234',
    payment_ref: null,
    message_text: 'Ehsaas Program 14,000 cash ready. Pay Rs 500 registration fee on Easypaisa 0345-9910234 to release your installment today.',
    ground_truth: 'scam',
    category: 'Upfront Fee Scam',
  },
  {
    id: 'SYN-03',
    sender_claimed: '8171-HELP',
    payment_ref: null,
    message_text: 'BISP Relief Urgent: Click http://bit.ly/bisp-claim-now and enter CNIC + JazzCash PIN within 30 minutes.',
    ground_truth: 'scam',
    category: 'Phishing Link + Spoofed Sender',
  },
  {
    id: 'SYN-04',
    sender_claimed: '0312-4412098',
    payment_ref: null,
    message_text: 'Congratulations you won 70 hazar Jeeto Pakistan Flood Relief lucky draw! WhatsApp agent 0312-4412098 and send Rs 1000 easyload.',
    ground_truth: 'scam',
    category: 'Fake Lucky Draw',
  },
  {
    id: 'SYN-05',
    sender_claimed: '0333-7741200',
    payment_ref: 'PAY-9999-7782',
    message_text: 'Government Ration Subsidy approved. Send your CNIC photo and bank password on WhatsApp to claim flour bags immediately.',
    ground_truth: 'scam',
    category: 'CNIC + Bank Credential Phishing',
  },
  {
    id: 'SYN-06',
    sender_claimed: 'BISP-OFFER',
    payment_ref: null,
    message_text: 'Download official relief app from http://tinyurl.com/relief-apk and share verification code with our officer.',
    ground_truth: 'scam',
    category: 'Malicious APK + OTP',
  },
  {
    id: 'SYN-07',
    sender_claimed: '0300-1129876',
    payment_ref: null,
    message_text: 'Apki Kafalat qist 10500 ruk gayi hai. Abhi Rs 350 processing charges bhej kar bahal karwayein, last chance today.',
    ground_truth: 'scam',
    category: 'Fake Suspension Fee',
  },
  {
    id: 'SYN-08',
    sender_claimed: '0321-5567123',
    payment_ref: null,
    message_text: 'NADRA verification alert: Reply with your CNIC number and MPIN code to keep your relief wallet active.',
    ground_truth: 'scam',
    category: 'MPIN Harvesting',
  },
  {
    id: 'SYN-09',
    sender_claimed: 'RELIEF-GOV',
    payment_ref: null,
    message_text: 'Urgent Flood Grant Rs 50,000! Open https://forms.gle/fake-grant-wallet and enter ATM PIN for direct transfer.',
    ground_truth: 'scam',
    category: 'Phishing Form + ATM PIN',
  },
  {
    id: 'SYN-10',
    sender_claimed: '0308-9023411',
    payment_ref: null,
    message_text: '8171 Agent calling: Your installment is stuck. Share the 4-digit code that just arrived on your phone to unlock cash.',
    ground_truth: 'scam',
    category: 'Social Engineering OTP',
  },
  {
    id: 'SYN-11',
    sender_claimed: '0315-6678901',
    payment_ref: null,
    message_text: 'Benazir Relief Bonus: Send Rs 600 JazzCash par bhej dein tax clearance ke liye, 25000 fauran mil jaye ga.',
    ground_truth: 'scam',
    category: 'Advance Tax Fee Scam',
  },
  {
    id: 'SYN-12',
    sender_claimed: '8558-ALERT',
    payment_ref: null,
    message_text: 'Flood grant expire today! Click wa.me/923000000001 and send shanakhti card ki tasveer + secret code.',
    ground_truth: 'scam',
    category: 'WhatsApp Redirect + ID Theft',
  },

  // 10 Synthetic Mock Official-Notice Matches
  {
    id: 'SYN-13',
    sender_claimed: '8171',
    payment_ref: 'PAY-8171-4401',
    message_text: '8171 Mock Notice: Your quarterly relief installment of Rs 10,500 is ready for biometric collection at your nearest camp site. No fee is charged.',
    ground_truth: 'official',
    category: '8171 Quarterly Stipend',
  },
  {
    id: 'SYN-14',
    sender_claimed: '8558',
    payment_ref: 'PAY-8558-2219',
    message_text: '8558 Mock Notice: Your household survey for Emergency Flood Grant is verified. Visit Tehsil Relief Center for biometric verification. No fee applies.',
    ground_truth: 'official',
    category: '8558 Flood Survey Verified',
  },
  {
    id: 'SYN-15',
    sender_claimed: '9999',
    payment_ref: null,
    message_text: '9999 Mock Notice: Your household is eligible for subsidized ration flour at registered Utility Stores. No fee is charged.',
    ground_truth: 'official',
    category: '9999 Ration Subsidy',
  },
  {
    id: 'SYN-16',
    sender_claimed: 'PDMA-MOCK',
    payment_ref: null,
    message_text: 'PDMA-MOCK: Relief verification camp opens Tuesday 9 AM at Union Council Office. Bring original ID card in person; never share codes over phone.',
    ground_truth: 'official',
    category: 'PDMA Camp Schedule',
  },
  {
    id: 'SYN-17',
    sender_claimed: '8171',
    payment_ref: 'PAY-8171-9002',
    message_text: '8171 Kafalat Notice: Your Q4 stipend qist is queued at the authorized biometric camp site. Koi fees nahi hai.',
    ground_truth: 'official',
    category: '8171 Bilingual Notice',
  },
  {
    id: 'SYN-18',
    sender_claimed: '8558',
    payment_ref: null,
    message_text: '8558 Flood Relief: Biometric desk is open at Tehsil Center from 9 AM to 4 PM. Service is free of cost.',
    ground_truth: 'official',
    category: '8558 Desk Timings',
  },
  {
    id: 'SYN-19',
    sender_claimed: '9999',
    payment_ref: null,
    message_text: '9999 Ration Program: Monthly atta subsidy token is active at registered Utility Store counters. Free of cost.',
    ground_truth: 'official',
    category: '9999 Utility Store Token',
  },
  {
    id: 'SYN-20',
    sender_claimed: '8171',
    payment_ref: 'PAY-8171-4401',
    message_text: '8171 Relief Update: Benazir Kafalat installment ready for biometric verification at district camp site. No fee required.',
    ground_truth: 'official',
    category: '8171 Biometric Update',
  },
  {
    id: 'SYN-21',
    sender_claimed: 'PDMA-MOCK',
    payment_ref: null,
    message_text: 'PDMA-MOCK: District relief survey team will visit Union Council hall tomorrow. Biometric check is free of cost; never share codes.',
    ground_truth: 'official',
    category: 'PDMA Survey Notice',
  },
  {
    id: 'SYN-22',
    sender_claimed: '8171',
    payment_ref: null,
    message_text: '8171 Mock Notice: Your household survey for quarterly relief stipend is complete. Collect at official desk with biometric check, no fee.',
    ground_truth: 'official',
    category: '8171 Survey Complete',
  },

  // 8 Ambiguous / Edge Cases (should trigger needs_non_sensitive_info or unverified_officer_review)
  {
    id: 'SYN-23',
    sender_claimed: '',
    payment_ref: null,
    message_text: 'Bhai relief ka paisa aaya hai, kal subah market ki dukaan par aa kar check karwa lena.',
    ground_truth: 'ambiguous',
    category: 'Forwarded Shopkeeper Note',
  },
  {
    id: 'SYN-24',
    sender_claimed: 'INFO-SMS',
    payment_ref: null,
    message_text: 'Your family name is on the local flood list. Please meet the union council secretary on Wednesday morning.',
    ground_truth: 'ambiguous',
    category: 'Unregistered Local Sender',
  },
  {
    id: 'SYN-25',
    sender_claimed: '8171',
    payment_ref: 'PAY-UNKNOWN-999',
    message_text: '8171: Your relief status has changed. Visit your nearest camp site to check eligibility.',
    ground_truth: 'ambiguous',
    category: 'Official Shortcode w/ Unknown Payment Ref',
  },
  {
    id: 'SYN-26',
    sender_claimed: '0304-1122334',
    payment_ref: null,
    message_text: 'Salam, main mohalla committee se bol raha hoon, kal ration ki parchi masjid ke bahar mile gi.',
    ground_truth: 'ambiguous',
    category: 'Community Informal Forward',
  },
  {
    id: 'SYN-27',
    sender_claimed: 'RELIEF-DESK',
    payment_ref: null,
    message_text: 'Urgent reminder: bring your survey slip to Tehsil office before Friday closing.',
    ground_truth: 'ambiguous',
    category: 'Urgent Tone Without Scam Ask',
  },
  {
    id: 'SYN-28',
    sender_claimed: '',
    payment_ref: null,
    message_text: 'Forwarded: Government is giving 12000 this month to all families in Multan district.',
    ground_truth: 'ambiguous',
    category: 'Viral Rumor Forward',
  },
  {
    id: 'SYN-29',
    sender_claimed: '9999',
    payment_ref: null,
    message_text: '9999: Please update your household details at the center next week.',
    ground_truth: 'ambiguous',
    category: 'Short Vague Notice',
  },
  {
    id: 'SYN-30',
    sender_claimed: '0322-8899001',
    payment_ref: null,
    message_text: 'Aap ka naam relief list mein shamil hai, tafseel ke liye kal daftar aa jayein.',
    ground_truth: 'ambiguous',
    category: 'Personal Number In-Person Invite',
  },
];

export function createInitialDatabaseState(): DatabaseState {
  const now = new Date().toISOString();
  const demoHash = hashPassword('demo1234');

  const users: UserRecord[] = [
    {
      id: 'usr-helper-1',
      name: 'Sanaullah Khan',
      email: 'helper@relief.demo',
      role: 'helper',
      password_hash: demoHash,
      created_at: now,
    },
    {
      id: 'usr-citizen-1',
      name: 'Muhammad Tariq',
      email: 'citizen@relief.demo',
      role: 'citizen',
      password_hash: demoHash,
      created_at: now,
    },
    {
      id: 'usr-officer-1',
      name: 'Farhana Malik',
      email: 'officer@relief.demo',
      role: 'officer',
      password_hash: demoHash,
      created_at: now,
    },
    {
      id: 'usr-admin-1',
      name: 'Kamran Qureshi',
      email: 'admin@relief.demo',
      role: 'admin',
      password_hash: demoHash,
      created_at: now,
    },
    {
      id: 'usr-auditor-1',
      name: 'Dr. Naila Rasheed',
      email: 'auditor@relief.demo',
      role: 'auditor',
      password_hash: demoHash,
      created_at: now,
    },
  ];

  const familySeeds = [
    {
      id: 'FAM-101',
      display_name: 'Muhammad Tariq',
      phone_masked: '0300-***-4412',
      village_or_ward: 'Ward 4, Multan',
      notes: 'Shopkeeper assisting elderly parents; prefers Urdu audio readout.',
    },
    {
      id: 'FAM-102',
      display_name: 'Fatima Bibi',
      phone_masked: '0345-***-8819',
      village_or_ward: 'Kacha Basti, Sukkur',
      notes: 'Uses shared neighbor handset; verify via biometric camp only.',
    },
    {
      id: 'FAM-103',
      display_name: 'Hussain Shah',
      phone_masked: '0312-***-2204',
      village_or_ward: 'UC-9, Dadu',
      notes: 'Flood survey submitted last month; awaiting official schedule.',
    },
    {
      id: 'FAM-104',
      display_name: 'Ayesha Siddiqui',
      phone_masked: '0333-***-6190',
      village_or_ward: 'Mingora Ward 2, Swat',
      notes: 'Enrolled in subsidized ration program.',
    },
    {
      id: 'FAM-105',
      display_name: 'Usman Ghani',
      phone_masked: '0301-***-9033',
      village_or_ward: 'Basti Noor, Bahawalpur',
      notes: 'Low connectivity area; relies on helper desk visits.',
    },
    {
      id: 'FAM-106',
      display_name: 'Zainab Noor',
      phone_masked: '0321-***-5518',
      village_or_ward: 'Chak 18, Sahiwal',
      notes: 'Received two spoofed calls last week.',
    },
  ];

  const families: FamilyRecord[] = familySeeds.map((f) => ({
    ...f,
    helper_id: 'usr-helper-1',
    phonetic_key: computePhoneticKey(f.display_name),
    updated_at: now,
  }));

  const api_keys: ApiKeyRecord[] = [
    {
      id: 'key-1',
      user_id: 'usr-admin-1',
      label: 'Hackathon Partner Check Key (Mock)',
      key_prefix: DEMO_PUBLIC_API_KEY.slice(0, 12),
      key_hash: sha256(DEMO_PUBLIC_API_KEY),
      rate_limit_per_min: 20,
      active: true,
      created_at: now,
    },
  ];

  const rules: RuleRecord[] = [
    {
      id: 'rule-1',
      version: 1,
      name: 'OTP / PIN / Verification Code Request',
      rule_type: 'pii_request',
      pattern: '\\b(otp|pin|mpin|tpin|verification\\s*code|secret\\s*code|4[-\\s]?digit|6[-\\s]?digit|code\\s*bhej)\\b',
      weight: 0.62,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-2',
      version: 1,
      name: 'CNIC Photo / Credential Harvesting',
      rule_type: 'pii_request',
      pattern: '\\b(send\\s*cnic|cnic\\s*bhej|cnic\\s*photo|shanakhti\\s*card\\s*ki\\s*tasveer|bank\\s*password|reply\\s*with\\s*cnic)\\b',
      weight: 0.58,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-3',
      version: 1,
      name: 'Shortened or External Phishing Link',
      rule_type: 'link',
      pattern: '(https?:\\/\\/|bit\\.ly|tinyurl\\.com|forms\\.gle|wa\\.me|t\\.me|\\.apk\\b)',
      weight: 0.55,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-4',
      version: 1,
      name: 'Upfront Fee / Easyload / Processing Charge',
      rule_type: 'keyword',
      pattern: '\\b(registration\\s*fee|processing\\s*fee|processing\\s*charges|easyload|easy\\s*load|pay\\s*rs\\.?\\s*\\d+|rs\\.?\\s*\\d+\\s*(?:bhej|send|charges|fee)|tax\\s*clearance)\\b',
      weight: 0.60,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-5',
      version: 1,
      name: 'Fake Lottery / Lucky Draw Relief Claim',
      rule_type: 'keyword',
      pattern: '\\b(lucky\\s*draw|jeeto|inaam|lottery|congratulations\\s*you\\s*won|25\\s*lakh|70\\s*hazar)\\b',
      weight: 0.52,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-6',
      version: 1,
      name: 'High-Pressure Urgency / Account Block Threat',
      rule_type: 'urgency',
      pattern: '\\b(fauran|within\\s*\\d+\\s*(?:min|hour)|account\\s*block|band\\s*ho\\s*jaye|expire\\s*today|last\\s*chance)\\b',
      weight: 0.28,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-7',
      version: 1,
      name: 'Official Program Claimed From Unverified Sender',
      rule_type: 'sender_mismatch',
      pattern: '\\b(bisp|ehsaas|kafalat|benazir|8171|8558|9999|nadra|government\\s*ration|flood\\s*grant)\\b',
      weight: 0.34,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
    {
      id: 'rule-8',
      version: 1,
      name: 'Private WhatsApp Agent Contact',
      rule_type: 'keyword',
      pattern: '\\b(whatsapp\\s*(?:agent|number|par|kar)|agent\\s*calling|call\\s*officer\\s*03)\\b',
      weight: 0.36,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
  ];

  const thresholds: ThresholdConfig[] = [
    {
      id: 'thr-1',
      version: 1,
      scam_auto_threshold: 0.8,
      official_match_threshold: 0.95,
      ask_info_threshold: 0.6,
      active: true,
      created_by: 'usr-admin-1',
      created_at: now,
    },
  ];

  const consents: ConsentRecord[] = [
    {
      id: 'cns-1',
      subject_type: 'user',
      subject_id: 'usr-citizen-1',
      subject_label: 'Muhammad Tariq (Citizen Self)',
      owner_user_id: 'usr-citizen-1',
      grantee_role: 'officer',
      scope: 'case_review',
      status: 'active',
      granted_at: now,
      withdrawn_at: null,
    },
    {
      id: 'cns-2',
      subject_type: 'user',
      subject_id: 'usr-citizen-1',
      subject_label: 'Muhammad Tariq (Citizen Self)',
      owner_user_id: 'usr-citizen-1',
      grantee_role: 'officer',
      scope: 'mock_payment',
      status: 'active',
      granted_at: now,
      withdrawn_at: null,
    },
    ...families.flatMap((fam, idx) =>
      (['case_review', 'mock_identity', 'mock_payment'] as const).map((scope, sIdx) => ({
        id: `cns-fam-${idx + 1}-${sIdx + 1}`,
        subject_type: 'family' as const,
        subject_id: fam.id,
        subject_label: `${fam.display_name} (${fam.id})`,
        owner_user_id: fam.helper_id,
        grantee_role: 'officer' as const,
        scope,
        status: 'active' as const,
        granted_at: now,
        withdrawn_at: null,
      }))
    ),
  ];

  const audit_log: AuditLogEntry[] = [
    {
      id: 'aud-seed-1',
      actor_id: 'system',
      actor_name: 'Platform Bootstrap',
      actor_role: 'system',
      actor_type: 'system',
      action: 'seed_initialized',
      access_kind: 'write',
      entity_type: 'system',
      entity_id: 'prototype-v1',
      payload: {
        users_seeded: users.length,
        families_seeded: families.length,
        rules_version: 1,
        thresholds_version: 1,
        synthetic_eval_size: SYNTHETIC_DATASET.length,
      },
      created_at: now,
    },
  ];

  return {
    users,
    families,
    api_keys,
    cases: [],
    decisions: [],
    rules,
    thresholds,
    consents,
    audit_log,
  };
}
