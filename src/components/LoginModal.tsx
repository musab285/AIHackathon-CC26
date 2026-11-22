import React, { useState } from 'react';
import { Cloud, CloudOff, KeyRound, ShieldCheck, X } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { UserPublic, UserRole } from '../shared/types';

interface LoginModalProps {
  open: boolean;
  accounts: UserPublic[];
  currentUser: UserPublic | null;
  firebaseUser: FirebaseUser | null;
  onClose: () => void;
  onDemoRoleLogin: (role: UserRole) => Promise<void>;
  onPasswordLogin: (email: string, password: string) => Promise<void>;
  onGoogleCloudConnect: () => Promise<void>;
  onGoogleCloudDisconnect: () => Promise<void>;
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  helper: 'Check messages for up to 40 families, phonetic candidate matching, local draft protection',
  citizen: 'Check personal relief messages, manage consent, correct data, and view own history',
  officer: 'Review unverified cases ("I am not sure"), decide outcomes, safe non-sensitive info requests',
  admin: 'Edit versioned detection rules, tune asymmetric thresholds, inspect N=30 synthetic eval',
  auditor: 'Read-only access to append-only read/write logs and complete JSON decision traces',
};

export function LoginModal({
  open,
  accounts,
  currentUser,
  firebaseUser,
  onClose,
  onDemoRoleLogin,
  onPasswordLogin,
  onGoogleCloudConnect,
  onGoogleCloudDisconnect,
}: LoginModalProps) {
  const [email, setEmail] = useState('helper@relief.demo');
  const [password, setPassword] = useState('demo1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleRoleClick = async (role: UserRole) => {
    setBusy(true);
    setError(null);
    try {
      await onDemoRoleLogin(role);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onPasswordLogin(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await onGoogleCloudConnect();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google Sign-In popup was cancelled or blocked by the browser.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await onGoogleCloudDisconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect cloud sync.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-dialog-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
          <div>
            <h2 id="login-dialog-title" className="text-lg font-bold text-[#0F172A]">
              Sign In, Switch Role, or Connect Cloud Sync
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              Issues a server-signed Bearer token in memory with strict server-side RBAC, plus
              optional Google Cloud Firestore persistence.
            </p>
          </div>
          {currentUser && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sign-in dialog"
              className="rounded-lg p-2 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
            {error}
          </div>
        )}

        {/* Firebase Google Cloud Sync Panel */}
        <div className="mt-5 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                <Cloud className="h-4 w-4 text-[#0F4C5C]" aria-hidden="true" />
                Firebase Cloud Firestore Persistence
              </p>
              <p className="mt-0.5 text-xs text-[#475569]">
                {firebaseUser
                  ? `Connected as ${firebaseUser.displayName || firebaseUser.email}. PII-redacted case & consent snapshots mirror automatically to Firestore.`
                  : 'Sign in with Google to persist your verified PII-redacted cases and consent status in Cloud Firestore across sessions.'}
              </p>
            </div>
            {firebaseUser ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleDisconnect}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#FECACA] bg-white px-3.5 py-2 text-xs font-semibold text-[#991B1B] hover:bg-[#FEF2F2] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                Sign Out Cloud
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleConnect}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                Sign In with Google
              </button>
            )}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold text-[#475569]">
            One-Click Hackathon Role Accounts (password for manual login: demo1234)
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {accounts.map((acc) => {
              const isCurrent = currentUser?.id === acc.id;
              return (
                <button
                  key={acc.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleRoleClick(acc.role)}
                  className={`flex flex-col items-start rounded-lg border p-3.5 text-left transition-colors cursor-pointer ${
                    isCurrent
                      ? 'border-[#0F4C5C] bg-[#F0F9FA]'
                      : 'border-[#E2E8F0] bg-white hover:border-[#94A3B8] hover:bg-[#F8FAFC]'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#0F172A]">{acc.name}</span>
                    <span className="font-mono text-xs font-medium text-[#0F4C5C] capitalize">
                      {acc.role}
                    </span>
                  </div>
                  <span className="mt-0.5 text-xs text-[#64748B]">{acc.email}</span>
                  <span className="mt-2 text-xs leading-snug text-[#475569]">
                    {ROLE_DESCRIPTIONS[acc.role]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 border-t border-[#E2E8F0] pt-5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#475569]">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Manual Email &amp; Password Sign-In
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-[#334155]">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-[#334155]">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0F4C5C] focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C5C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B3B48] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Sign In
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
