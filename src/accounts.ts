// Accounts: an email, a password, and which side of the site they are on.
//
// One JSON file on the host volume beside the job index, written whole and
// moved into place — the same as jobs.json, for the same reason: a deploy
// landing mid-write must not lose every account to save one. A few thousand
// accounts are a few hundred kilobytes; past that, this is the module to move
// onto a database, and nothing outside it reads the file.
//
// Stripe is the record of who has paid. What is kept here is a copy, brought
// up to date by the webhook (src/billing.ts), so this file going missing
// would cost accounts their passwords but not their subscriptions.

import { randomUUID, randomBytes, scrypt, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { planOf, siteKey, UNLOCK_DAYS } from './plans.js';

export interface Account {
  id: string;
  /** Trimmed and lower-cased: the one spelling an address is matched by. */
  email: string;
  passwordHash: string;
  createdAt: number;
  stripeCustomerId?: string;
  subscriptionId?: string;
  /** Stripe's word for it: active, trialing, past_due, canceled… */
  subscriptionStatus?: string;
  /** When the period paid for ends, ms since the epoch. */
  currentPeriodEnd?: number;
  /** Sites bought one at a time. */
  sites?: SiteUnlock[];
  /**
   * When the address clicked its verification link, ms since the epoch.
   * 0 means asked and not yet clicked; absent means the account is from
   * before verification existed, which counts as verified (isVerified) —
   * shipping the feature must not lock out everyone already signed up.
   */
  emailVerified?: number;
  /** SHA-256 of the verification link's token, while one is out. */
  verifyTokenHash?: string;
  verifyTokenExp?: number;
  /** SHA-256 of the password-reset link's token, while one is out. */
  resetTokenHash?: string;
  resetTokenExp?: number;
  /** The terms of use agreed to at sign-up (TERMS_VERSION), and when; absent on accounts from before the terms. */
  termsVersion?: string;
  termsAcceptedAt?: number;
}

export interface SiteUnlock {
  /** siteKey(address): what a job's address is matched against. */
  key: string;
  /** As it was when bought, for the account's own list. */
  address: string;
  until: number;
  /** The Checkout sessions that paid for it, so a webhook delivered twice extends nothing. */
  sessions: string[];
}

let file = '';
let secret = '';
const accounts = new Map<string, Account>();

/**
 * Load the accounts and the key sessions are signed with. The key comes from
 * SESSION_SECRET when it is set, and is otherwise made once and kept beside
 * the accounts — it has to survive a deploy, and the auto-deployer lands one
 * whenever main moves, so a key made fresh at every boot would sign everybody
 * out every few minutes.
 */
export function initAccounts(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  file = join(dir, 'accounts.json');
  secret = process.env.SESSION_SECRET?.trim() ?? '';
  if (!secret) {
    const keyFile = join(dir, 'session.secret');
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = readFileSync(keyFile, 'utf8').trim();
  }
  let rows: unknown;
  try { rows = JSON.parse(readFileSync(file, 'utf8')); } catch { return; }
  if (!Array.isArray(rows)) return;
  for (const r of rows as Account[]) {
    if (r && typeof r.id === 'string' && typeof r.email === 'string' && typeof r.passwordHash === 'string')
      accounts.set(r.id, r);
  }
}

function save() {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...accounts.values()]), { mode: 0o600 });
  renameSync(tmp, file);
}

export const normaliseEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const PASSWORD_MIN = 8;

export function accountById(id: string): Account | undefined { return accounts.get(id); }
export function accountByEmail(email: string): Account | undefined {
  const e = normaliseEmail(email);
  for (const a of accounts.values()) if (a.email === e) return a;
  return undefined;
}
export function accountByCustomer(customerId: string): Account | undefined {
  for (const a of accounts.values()) if (a.stripeCustomerId === customerId) return a;
  return undefined;
}

/** For the status view: how many accounts there are, and how many are on each side. */
export function accountCounts(): { total: number; subscription: number } {
  const all = [...accounts.values()];
  return { total: all.length, subscription: all.filter((a) => planOf(a) === 'subscription').length };
}

export function updateAccount(a: Account, patch: Partial<Omit<Account, 'id' | 'email'>>) {
  Object.assign(a, patch);
  save();
}

/**
 * A site paid for: unlocked for UNLOCK_DAYS from now, or from when it would
 * have run out if it is still unlocked. False when this payment was already
 * counted.
 */
export function unlockSite(a: Account, address: string, session: string): boolean {
  const sites = a.sites ?? [];
  if (sites.some((s) => s.sessions.includes(session))) return false;
  const key = siteKey(address);
  let site = sites.find((s) => s.key === key);
  if (!site) sites.push(site = { key, address, until: 0, sessions: [] });
  site.until = Math.max(site.until, Date.now()) + UNLOCK_DAYS * 86400_000;
  site.sessions.push(session);
  a.sites = sites;
  save();
  return true;
}

export const unlockedSites = (a: Account) => (a.sites ?? []).filter((s) => s.until > Date.now());
export const siteUnlocked = (a: Account, address: string) =>
  unlockedSites(a).some((s) => s.key === siteKey(address));

// ---- passwords -------------------------------------------------------------
//
// scrypt from node:crypto, so no dependency, and asynchronous: a hash takes
// tens of milliseconds, and the synchronous form would hold the event loop —
// every visitor's progress polling — for each one.

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))));
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  // The parameters travel with the hash, so they can be raised later without
  // locking out every account hashed before.
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Checked against when the email matches no account, so a wrong address takes
// as long to refuse as a wrong password and the timing does not say which
// emails have accounts.
let decoy: Promise<string> | undefined;

export async function createAccount(email: string, password: string, termsVersion?: string): Promise<Account> {
  const account: Account = {
    id: randomUUID(),
    email: normaliseEmail(email),
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
    ...(termsVersion ? { termsVersion, termsAcceptedAt: Date.now() } : {}),
  };
  // Checked after the hash, not before: the hash yields the event loop, and a
  // second sign-up for the same address could have landed in the meantime.
  if (accountByEmail(account.email)) throw new Error('exists');
  accounts.set(account.id, account);
  save();
  return account;
}

export async function signIn(email: string, password: string): Promise<Account | undefined> {
  const a = accountByEmail(email);
  if (!a) {
    decoy ??= hashPassword('not a password anybody has');
    await passwordMatches(password, await decoy);
    return undefined;
  }
  return (await passwordMatches(password, a.passwordHash)) ? a : undefined;
}

// ---- emailed links: verification and password reset -------------------------
//
// Both features are one emailed link each. The account keeps only the SHA-256
// of the token in the link, so this file — and any backup of it — never holds
// anything that opens an account; the email is the secret's only copy. Lookup
// walks the accounts the way accountByEmail does: the same few thousand rows,
// and the same module to move onto a database when that stops being fine.

export const VERIFY_DAYS = 7;
export const RESET_MINUTES = 60;

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Verified: the address clicked its link, or the account predates asking. */
export const isVerified = (a: Account) => a.emailVerified !== 0;

/** A fresh verification link's token; whatever was emailed before stops working. */
export function issueVerification(a: Account): string {
  const token = randomBytes(32).toString('hex');
  updateAccount(a, {
    emailVerified: 0,
    verifyTokenHash: tokenHash(token),
    verifyTokenExp: Date.now() + VERIFY_DAYS * 86400_000,
  });
  return token;
}

export function confirmEmail(a: Account) {
  updateAccount(a, { emailVerified: Date.now(), verifyTokenHash: undefined, verifyTokenExp: undefined });
}

/** A fresh reset link's token. Issuing one touches nothing — only using it does. */
export function issueReset(a: Account): string {
  const token = randomBytes(32).toString('hex');
  updateAccount(a, {
    resetTokenHash: tokenHash(token),
    resetTokenExp: Date.now() + RESET_MINUTES * 60_000,
  });
  return token;
}

function byToken(token: string, kind: 'verify' | 'reset'): Account | undefined {
  if (!/^[0-9a-f]{64}$/.test(token)) return undefined;
  const want = Buffer.from(tokenHash(token));
  for (const a of accounts.values()) {
    const hash = kind === 'verify' ? a.verifyTokenHash : a.resetTokenHash;
    const exp = kind === 'verify' ? a.verifyTokenExp : a.resetTokenExp;
    if (!hash || !exp || exp < Date.now()) continue;
    const got = Buffer.from(hash);
    if (got.length === want.length && timingSafeEqual(got, want)) return a;
  }
  return undefined;
}

export const accountByVerifyToken = (token: string) => byToken(token, 'verify');
export const accountByResetToken = (token: string) => byToken(token, 'reset');

/**
 * The reset link used: the new password in, the link spent. Every session
 * signed over the old hash dies with it (the cookie's signature covers its
 * tail), which is the point — whoever asked for the reset wants the browsers
 * holding the old password out. The link arriving back also proves the
 * address receives this account's mail, which is everything verification
 * asks, so an unverified account that resets its password is verified by it.
 */
export async function resetPassword(a: Account, password: string) {
  const passwordHash = await hashPassword(password);
  updateAccount(a, {
    passwordHash,
    resetTokenHash: undefined, resetTokenExp: undefined,
    emailVerified: a.emailVerified === 0 ? Date.now() : a.emailVerified,
    verifyTokenHash: undefined, verifyTokenExp: undefined,
  });
}

// ---- sessions --------------------------------------------------------------
//
// The cookie names the account and when it expires, and is signed. The
// signature also covers the tail of the password hash, so changing a password
// signs out every browser that held the old one without a session table.

export const ACCOUNT_COOKIE = 'sa_account';
export const SESSION_DAYS = 30;

const sign = (body: string, a: Account) =>
  createHmac('sha256', secret).update(`${body}.${a.passwordHash.slice(-16)}`).digest('hex');

export function sessionCookieValue(a: Account): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = `${a.id}.${exp}`;
  return `${body}.${sign(body, a)}`;
}

export function accountFromCookie(header: string | undefined): Account | undefined {
  const m = (header ?? '').match(/(?:^|;\s*)sa_account=([0-9a-f-]{36})\.(\d{1,12})\.([0-9a-f]{64})/);
  if (!m || Number(m[2]) * 1000 < Date.now()) return undefined;
  const a = accounts.get(m[1]);
  if (!a) return undefined;
  const want = Buffer.from(sign(`${m[1]}.${m[2]}`, a));
  const got = Buffer.from(m[3]);
  return got.length === want.length && timingSafeEqual(got, want) ? a : undefined;
}
