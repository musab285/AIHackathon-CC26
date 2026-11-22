import type { RelationalStore } from './store';
import { toPublicUser } from '../security';
import { runVerificationPipeline } from '../services/pipeline';

export async function seedInitialCasesIfEmpty(store: RelationalStore): Promise<void> {
  if (store.state.cases.length > 0) return;

  const helper = toPublicUser(store.state.users.find((u) => u.role === 'helper')!);
  const citizen = toPublicUser(store.state.users.find((u) => u.role === 'citizen')!);

  const initialCases = [
    {
      actor: helper,
      familyId: 'FAM-101',
      senderClaimed: '0301-8842109',
      paymentRef: null,
      messageText:
        'Mubarak ho! Apka 25,000 BISP relief approve ho gaya hai. Fauran apna 6-digit OTP code 482910 aur CNIC 35202-1234567-1 bhejein warna account block ho jaye ga.',
    },
    {
      actor: helper,
      familyId: 'FAM-102',
      senderClaimed: '8171',
      paymentRef: 'PAY-8171-4401',
      messageText:
        '8171 Mock Notice: Your quarterly relief installment of Rs 10,500 is ready for biometric collection at your nearest camp site. No fee is charged.',
    },
    {
      actor: helper,
      familyId: 'FAM-103',
      senderClaimed: 'INFO-SMS',
      paymentRef: null,
      messageText:
        'Your family name is on the local flood list. Please meet the union council secretary on Wednesday morning with your survey slip.',
    },
    {
      actor: citizen,
      familyId: null,
      senderClaimed: '8171',
      paymentRef: 'PAY-UNKNOWN-999',
      messageText:
        '8171: Your relief status has changed. Visit your nearest camp site to check eligibility.',
    },
    {
      actor: helper,
      familyId: 'FAM-104',
      senderClaimed: '0322-8899001',
      paymentRef: null,
      messageText:
        'Urgent reminder: bring your survey slip to Tehsil office before Friday closing to avoid delay in ration list.',
    },
  ];

  for (const item of initialCases) {
    await runVerificationPipeline({
      store,
      actor: item.actor,
      familyId: item.familyId,
      senderClaimed: item.senderClaimed,
      paymentRef: item.paymentRef,
      messageText: item.messageText,
      useGemini: false,
      persistCase: true,
    });
  }
}
