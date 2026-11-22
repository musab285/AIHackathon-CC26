import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  ClipboardCheck,
  FileSearch,
  LogIn,
  Menu,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { UserPublic, UserRole } from './shared/types';
import { api, setAuthToken } from './utils/api';
import {
  signInWithGooglePopup,
  signOutGoogle,
  subscribeFirebaseAuth,
} from './lib/firebase';
import { CheckerView } from './components/CheckerView';
import { OfficerReviewView } from './components/OfficerReviewView';
import { AdminRulesView } from './components/AdminRulesView';
import { AuditConsentView } from './components/AuditConsentView';
import { LoginModal } from './components/LoginModal';

type ScreenKey = 'checker' | 'review' | 'admin' | 'audit-consent';

const NAV_ITEMS: Array<{
  key: ScreenKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}> = [
  {
    key: 'checker',
    label: 'Check Message',
    icon: ShieldCheck,
    roles: ['citizen', 'helper', 'officer', 'admin', 'auditor'],
  },
  {
    key: 'review',
    label: 'Officer Queue',
    icon: ClipboardCheck,
    roles: ['officer', 'admin'],
  },
  {
    key: 'admin',
    label: 'Rules & Eval',
    icon: Sliders,
    roles: ['admin', 'officer', 'auditor'],
  },
  {
    key: 'audit-consent',
    label: 'Audit & Consent',
    icon: FileSearch,
    roles: ['citizen', 'helper', 'officer', 'admin', 'auditor'],
  },
];

function defaultScreenForRole(role: UserRole): ScreenKey {
  if (role === 'officer') return 'review';
  if (role === 'admin') return 'admin';
  if (role === 'auditor') return 'audit-consent';
  return 'checker';
}

export default function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [accounts, setAccounts] = useState<UserPublic[]>([]);
  const [demoApiKey, setDemoApiKey] = useState('');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [screen, setScreen] = useState<ScreenKey>('checker');
  const [loginOpen, setLoginOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);

  const signInWithDemoRole = async (role: UserRole) => {
    const res = await api.loginWithRole(role);
    setAuthToken(res.token);
    setUser(res.user);
    setScreen(defaultScreenForRole(res.user.role));
    const me = await api.getMe();
    setGeminiConfigured(me.gemini_configured);
  };

  const signInWithCredentials = async (email: string, password: string) => {
    const res = await api.loginWithCredentials(email, password);
    setAuthToken(res.token);
    setUser(res.user);
    setScreen(defaultScreenForRole(res.user.role));
    const me = await api.getMe();
    setGeminiConfigured(me.gemini_configured);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const demoRes = await api.getDemoAccounts();
        if (!mounted) return;
        setAccounts(demoRes.accounts);
        setDemoApiKey(demoRes.demo_api_key_hint);
        // Auto-authenticate into Community Helper demo session for instant evaluation
        const loginRes = await api.loginWithRole('helper');
        if (!mounted) return;
        setAuthToken(loginRes.token);
        setUser(loginRes.user);
        const me = await api.getMe();
        if (!mounted) return;
        setGeminiConfigured(me.gemini_configured);
      } catch (err) {
        if (!mounted) return;
        setBootError(err instanceof Error ? err.message : 'Unable to connect to server.');
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeFirebaseAuth((fbUser) => {
      setFirebaseUser(fbUser);
    });
    return () => unsub();
  }, []);

  const handleGoogleCloudConnect = async () => {
    await signInWithGooglePopup(user?.role ?? 'helper');
  };

  const handleGoogleCloudDisconnect = async () => {
    await signOutGoogle();
  };

  const currentNavLabel = NAV_ITEMS.find((i) => i.key === screen)?.label ?? 'Check Message';

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      {/* Persistent Prototype & Anti-Phishing Safety Banner */}
      <div
        role="banner"
        className="border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2 text-center text-xs font-medium text-[#78350F]"
      >
        <span className="inline-flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[#B45309]" aria-hidden="true" />
          <strong>PROTOTYPE — Not an official government or payment service.</strong> Never share
          OTP, CNIC, or PIN. If uploading or pasting screenshots, hide personal numbers.
        </span>
      </div>

      <div className="flex min-h-[calc(100vh-37px)]">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-[#E2E8F0] bg-white lg:flex">
          <div className="flex h-16 items-center border-b border-[#E2E8F0] px-6">
            <span className="font-display text-base font-bold tracking-tight text-[#0F172A] whitespace-nowrap">
              Relief Message Checker
            </span>
          </div>

          <nav aria-label="Primary Navigation" className="flex-1 space-y-1 p-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = screen === item.key;
              const allowed = user ? item.roles.includes(user.role) : true;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setScreen(item.key)}
                  className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#0F4C5C] text-white'
                      : 'text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </span>
                  {!allowed && (
                    <span className="text-[10px] opacity-70">RBAC</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Quick Role Switcher Footer */}
          <div className="border-t border-[#E2E8F0] p-4">
            <p className="text-[11px] font-semibold text-[#64748B]">Quick Role Switch (Demo JWT)</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(['helper', 'citizen', 'officer', 'admin', 'auditor'] as UserRole[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => signInWithDemoRole(role)}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    user?.role === role
                      ? 'border-[#0F4C5C] bg-[#F0F9FA] text-[#0F4C5C]'
                      : 'border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
            {user && (
              <div className="mt-3 border-t border-[#E2E8F0] pt-3">
                <p className="truncate text-xs font-semibold text-[#0F172A]">{user.name}</p>
                <p className="truncate text-[11px] text-[#64748B]">
                  {user.email} · {user.role}
                </p>
                {firebaseUser && (
                  <p className="mt-1 truncate text-[11px] font-medium text-[#15803D]">
                    Cloud Sync: {firebaseUser.email}
                  </p>
                )}
              </div>
            )}
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:border-[#CBD5E1] hover:text-[#0F172A]"
            >
              <BookOpen className="h-3.5 w-3.5 text-[#0F4C5C]" aria-hidden="true" />
              OpenAPI Docs (/docs)
            </a>
          </div>
        </aside>

        {/* Main Viewport */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Bar Contract: Breadcrumb/Title — Nav — 1 Primary Action */}
          <header className="flex h-16 items-center justify-between gap-8 border-b border-[#E2E8F0] bg-white px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                aria-label="Open navigation menu"
                onClick={() => setMobileNavOpen(true)}
                className="rounded-lg p-2 text-[#334155] hover:bg-[#F1F5F9] lg:hidden cursor-pointer"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="flex items-center gap-2 text-sm text-[#64748B] truncate">
                <Scale className="hidden h-4 w-4 text-[#0F4C5C] sm:block shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline whitespace-nowrap">Relief Checker</span>
                <span className="hidden sm:inline" aria-hidden="true">/</span>
                <h1 className="truncate text-sm font-bold text-[#0F172A]">{currentNavLabel}</h1>
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              {user && (
                <span className="hidden text-xs text-[#475569] md:inline whitespace-nowrap">
                  {user.name} · <span className="font-mono capitalize">{user.role}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B3B48] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                Switch Account
              </button>
            </div>
          </header>

          {/* Mobile Navigation Drawer */}
          {mobileNavOpen && (
            <div className="fixed inset-0 z-40 flex lg:hidden">
              <div
                className="fixed inset-0 bg-[#0F172A]/40"
                onClick={() => setMobileNavOpen(false)}
              />
              <div className="relative z-10 flex w-72 flex-col bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                  <span className="font-display text-base font-bold text-[#0F172A]">
                    Relief Message Checker
                  </span>
                  <button
                    type="button"
                    aria-label="Close navigation menu"
                    onClick={() => setMobileNavOpen(false)}
                    className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9]"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <nav className="mt-4 space-y-1">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setScreen(item.key);
                          setMobileNavOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium ${
                          screen === item.key
                            ? 'bg-[#0F4C5C] text-white'
                            : 'text-[#334155] hover:bg-[#F1F5F9]'
                        }`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>
                <div className="mt-6 border-t border-[#E2E8F0] pt-4">
                  <p className="text-xs font-semibold text-[#64748B]">Switch Role</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {(['helper', 'citizen', 'officer', 'admin', 'auditor'] as UserRole[]).map(
                      (role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => {
                            signInWithDemoRole(role);
                            setMobileNavOpen(false);
                          }}
                          className="rounded-md border border-[#E2E8F0] px-2.5 py-1.5 text-xs font-medium capitalize"
                        >
                          {role}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <main className="mx-auto w-full max-w-[1240px] flex-1 p-4 sm:p-6 lg:p-8">
            {booting ? (
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-10 text-center text-sm text-[#64748B]">
                Initializing Relief Message Checker workspace...
              </div>
            ) : bootError || !user ? (
              <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-6 text-sm text-[#991B1B]">
                {bootError || 'Sign in to continue.'}
              </div>
            ) : (
              <>
                {screen === 'checker' && (
                  <CheckerView user={user} geminiConfigured={geminiConfigured} />
                )}
                {screen === 'review' && <OfficerReviewView user={user} />}
                {screen === 'admin' && <AdminRulesView user={user} demoApiKey={demoApiKey} />}
                {screen === 'audit-consent' && <AuditConsentView user={user} />}
              </>
            )}
          </main>
        </div>
      </div>

      <LoginModal
        open={loginOpen}
        accounts={accounts}
        currentUser={user}
        firebaseUser={firebaseUser}
        onClose={() => setLoginOpen(false)}
        onDemoRoleLogin={signInWithDemoRole}
        onPasswordLogin={signInWithCredentials}
        onGoogleCloudConnect={handleGoogleCloudConnect}
        onGoogleCloudDisconnect={handleGoogleCloudDisconnect}
      />
    </div>
  );
}
