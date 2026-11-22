import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { CaseWithDecisions, ConsentRecord, UserRole } from '../shared/types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration — Firestore client is offline.');
    }
    // Expected permission-denied on default-deny test/connection confirms live connectivity.
  }
}

void testConnection();

export function subscribeFirebaseAuth(cb: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGooglePopup(role: UserRole = 'helper'): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  await syncUserProfileToFirestore(result.user, role);
  return result.user;
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}

function sanitizeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export async function syncUserProfileToFirestore(
  fbUser: FirebaseUser,
  role: UserRole
): Promise<void> {
  if (!fbUser.emailVerified) return;
  const userPath = `users/${fbUser.uid}`;
  const ref = doc(db, 'users', fbUser.uid);
  const safeName = (fbUser.displayName || fbUser.email || 'Relief Checker User').slice(0, 120);
  const allowedRole: UserRole = role === 'citizen' || role === 'helper' ? role : 'helper';

  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        uid: fbUser.uid,
        displayName: safeName,
        role: allowedRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: safeName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncCaseSnapshotToFirestore(caseRecord: CaseWithDecisions): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;

  const docId = sanitizeDocId(`${caseRecord.id}_${fbUser.uid.slice(0, 8)}`);
  const casePath = `cloud_cases/${docId}`;
  const ref = doc(db, 'cloud_cases', docId);

  const safeMsg =
    caseRecord.message_text.length >= 6
      ? caseRecord.message_text.slice(0, 2500)
      : `${caseRecord.message_text} [checked]`;

  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        caseId: docId,
        ownerUid: fbUser.uid,
        verdict: caseRecord.verdict,
        status: caseRecord.status,
        confidence: Number(Math.min(1, Math.max(0, caseRecord.confidence)).toFixed(2)),
        ruleVersion: Math.max(1, Math.min(10000, Math.round(caseRecord.rule_version))),
        senderClaimed: (caseRecord.sender_claimed || '').slice(0, 64),
        redactedMessage: safeMsg,
        piiRedacted: Boolean(caseRecord.pii_redacted),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      if (existingData?.status === 'closed') {
        return true;
      }
      await updateDoc(ref, {
        status: caseRecord.status,
        verdict: caseRecord.verdict,
        updatedAt: serverTimestamp(),
      });
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, casePath);
  }
}

export async function syncConsentSnapshotToFirestore(consent: ConsentRecord): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;

  const docId = sanitizeDocId(`${consent.id}_${fbUser.uid.slice(0, 8)}`);
  const consentPath = `cloud_consents/${docId}`;
  const ref = doc(db, 'cloud_consents', docId);

  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        consentId: docId,
        ownerUid: fbUser.uid,
        subjectId: sanitizeDocId(consent.subject_id),
        scope: consent.scope,
        status: consent.status,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        status: consent.status,
        updatedAt: serverTimestamp(),
      });
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, consentPath);
  }
}

export async function countCloudSyncedCases(): Promise<number> {
  const fbUser = auth.currentUser;
  if (!fbUser) return 0;
  try {
    const q = query(collection(db, 'cloud_cases'), where('ownerUid', '==', fbUser.uid));
    const snap = await getDocs(q);
    return snap.size;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'cloud_cases');
  }
}
