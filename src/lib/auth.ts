import { signal } from '@preact/signals';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { env } from '../config/env';
import { api } from '../api';
import { refreshEntitlements } from '../state/bootstrap';
import { readPref, writePref } from './device';

export interface SignedInUser {
  id: string;
  email?: string;
}

/** Supabase auth (email OTP + Google). The client is loaded lazily so it costs nothing until used. */
export const authUser = signal<SignedInUser | null>(null);
export const authReady = signal(false);
export const authAvailable = !!(env.supabaseUrl && env.supabaseAnonKey) || env.apiMode === 'mock';

let client: Promise<SupabaseClient> | undefined;
function supabase(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(env.supabaseUrl!, env.supabaseAnonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }),
  );
  return client;
}

let listening = false;
function listen(sb: SupabaseClient) {
  if (listening) return;
  listening = true;
  sb.auth.onAuthStateChange((_e, s) => applySession(s));
}

function applySession(s: Session | null) {
  api.setAuthToken(s?.access_token);
  authUser.value = s?.user ? { id: s.user.id, email: s.user.email ?? undefined } : null;
  void refreshEntitlements();
}

export async function initAuth() {
  if (env.apiMode === 'mock') {
    const u = readPref<SignedInUser | null>('mock_user', null);
    authUser.value = u;
    authReady.value = true;
    return;
  }
  if (!authAvailable) {
    authReady.value = true;
    return;
  }
  // Only load Supabase eagerly if a session exists or we are returning from an OAuth redirect.
  const hasSession = Object.keys(localStorageSafe()).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  if (!hasSession && !/[?&#](code|access_token)=/.test(location.href)) {
    authReady.value = true;
    return;
  }
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  applySession(data.session);
  listen(sb);
  authReady.value = true;
}

function localStorageSafe(): Record<string, string> {
  try {
    return { ...localStorage };
  } catch {
    return {};
  }
}

/** Step 1 of email sign-in: send a 6-digit code (and magic link) to the address. */
export async function sendEmailCode(email: string) {
  if (env.apiMode === 'mock') return;
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin } });
  if (error) throw error;
  listen(sb);
}

/** Step 2: verify the code. */
export async function verifyEmailCode(email: string, token: string) {
  if (env.apiMode === 'mock') {
    const u = { id: `mock-${email}`, email };
    writePref('mock_user', u);
    writePref('mock_signed_in', true);
    authUser.value = u;
    void refreshEntitlements();
    return;
  }
  const sb = await supabase();
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  listen(sb);
  applySession(data.session);
}

export async function signInWithGoogle() {
  if (env.apiMode === 'mock') return verifyEmailCode('google.user@example.com', '000000');
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
  if (error) throw error;
}

export async function signOut() {
  if (env.apiMode === 'mock') {
    writePref('mock_user', null);
    writePref('mock_signed_in', false);
    authUser.value = null;
    void refreshEntitlements();
    return;
  }
  const sb = await supabase();
  await sb.auth.signOut();
  applySession(null);
}
