/* The emailed links and what holds the account forms down, through the server.
 *
 * Resend is stood in for by a local endpoint that keeps every message, and the
 * server is booted against it (EMAIL_API_URL) on throwaway directories with a
 * finished sheet planted and three accounts written in beforehand: one from
 * before verification existed, one signed up and never verified, and one a
 * stranger made on somebody else's address. Nothing is drawn, and nothing
 * reaches Resend, Cloudflare, NSW ePlanning or Stripe. The human check is off
 * here (test/bots.mts has it on). Then:
 *
 *   - a sign-up is no account until its emailed link is pressed: no session,
 *     no sign-in, and the link — pressed, not merely opened — makes it, once;
 *   - signing up again with an address that has an account is answered like
 *     any sign-up and emails the owner instead of a link;
 *   - an account never verified is left as it is, and the stranger's one is
 *     handed to whoever proves the mailbox, signing the stranger out;
 *   - a listed address is given the subscription only once it is verified;
 *   - the reset link sets a new password once, and signs the old one out;
 *   - one inbox is sent at most three emails an hour;
 *   - wrong passwords from many addresses hold the account, not its owner's
 *     other accounts; and a forged X-Forwarded-For starts no limit afresh.
 *
 *   npx tsx test/auth-email.mts
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/accounts.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3126, MAIL_PORT = 3127;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = mkdtempSync(join(tmpdir(), 'auth-email-'));
const webOut = join(tmp, 'web'), accountsDir = join(tmp, 'accounts');

// ---- a finished sheet, planted ------------------------------------------------
const jobId = randomUUID();
mkdirSync(join(webOut, jobId), { recursive: true });
writeFileSync(join(webOut, jobId, 'CONTEXT_ANALYSIS.pdf'), 'stands in for a PDF');
writeFileSync(join(webOut, 'jobs.json'), JSON.stringify([{
  id: jobId, address: '1 Test Street, Sydney NSW 2000', sheet: 'context', scale: 3000,
  rotate: 'north', template: 'flamingo', status: 'done', log: [], createdAt: Date.now(),
  pdf: 'CONTEXT_ANALYSIS.pdf',
}]));
const JOB = { address: '1 Test Street, Sydney NSW 2000', sheet: 'context', scale: 3000, rotate: 'north', template: 'flamingo' };

// ---- accounts from before ---------------------------------------------------------
// From before verification existed (no field); signed up and never verified
// (0); and a stranger's sign-up on somebody else's address, also never
// verified. The listed address is the last two's kind: unverified.
mkdirSync(accountsDir, { recursive: true });
const account = async (email: string, password: string, emailVerified?: number) => ({
  id: randomUUID(), email, passwordHash: await hashPassword(password), createdAt: Date.now(),
  ...(emailVerified === undefined ? {} : { emailVerified }),
});
writeFileSync(join(accountsDir, 'accounts.json'), JSON.stringify([
  await account('old@example.com', 'the old account'),
  await account('quiet@example.com', 'never clicked', 0),
  await account('victim@example.com', 'the squatter', 0),
  await account('boss@example.com', 'listed but unproven', 0),
]));

// ---- the email service, stood in for -----------------------------------------
interface Mail { to: string; subject: string; text: string }
const mails: Mail[] = [];
const mailServer = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const m = JSON.parse(body);
    mails.push({ to: m.to[0], subject: m.subject, text: m.text });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"stub"}');
  });
});
mailServer.listen(MAIL_PORT);

/** The nth message to an address, once it arrives — most sends are not awaited. */
async function mail(to: string, nth: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const got = mails.filter((m) => m.to === to);
    if (got.length >= nth) return got[nth - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${nth}th email to ${to} arrived`);
}
const countTo = (to: string) => mails.filter((m) => m.to === to).length;
const settle = () => new Promise((r) => setTimeout(r, 600));
const tokenIn = (m: Mail, param: string) =>
  m.text.match(new RegExp(`${param}=([0-9a-f]{64})`))?.[1] ?? '';

// ---- the server ---------------------------------------------------------------
const server = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'server.ts')], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), WEB_OUT_DIR: webOut, ACCOUNTS_DIR: accountsDir,
    ACCESS_CODE: 'office-code', ADMIN_CODE: '', ALLOW_NO_AUTH: '',
    RESEND_API_KEY: 're_for_tests', EMAIL_FROM: 'Site Analyst <test@example.com>',
    EMAIL_API_URL: `http://127.0.0.1:${MAIL_PORT}/emails`,
    SMTP_HOST: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
    SUBSCRIPTION_EMAILS: 'boss@example.com',
    STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', STRIPE_WEBHOOK_SECRET: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (c) => { serverLog += c; });
server.stderr.on('data', (c) => { serverLog += c; });

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * A browser of its own: keeps the cookies it is given. `from` is the address
 * Caddy would add as the last X-Forwarded-For entry, so the per-IP limits
 * count each browser apart, as they would for different visitors.
 */
function browser(from = `10.0.0.${Math.floor(Math.random() * 250) + 1}`) {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(BASE + path, {
      redirect: 'manual',
      ...init,
      headers: {
        'X-Forwarded-For': from,
        ...(init.headers as Record<string, string>),
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const v = pair.slice(i + 1);
      if (v) jar.set(pair.slice(0, i), v); else jar.delete(pair.slice(0, i));
    }
    return res;
  };
}
type Browser = ReturnType<typeof browser>;
const post = (b: Browser, path: string, body: unknown, headers: Record<string, string> = {}) =>
  b(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const me = async (b: Browser) => (await b('/api/me')).json();

/** Sign up and press the emailed link, the way a person does. */
async function signUp(b: Browser, email: string, password: string) {
  const before = countTo(email);
  await post(b, '/api/signup', { email, password });
  const link = await mail(email, before + 1);
  return post(b, '/api/signup/confirm', { token: tokenIn(link, 'confirm') });
}

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${BASE}/robots.txt`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`server never answered:\n${serverLog}`);

  // ---- a sign-up is no account until its link is pressed -------------------------
  const alice = browser();
  const signed = await post(alice, '/api/signup', { email: 'alice@example.com', password: 'long enough' });
  const signedBody = await signed.json();
  check('sign-up answers "check your email", 202', signed.status === 202 && signedBody.pending === true, JSON.stringify(signedBody));
  check('…and signs nobody in', (await me(alice)).authed === false);
  check('…and makes no account to sign in to',
    (await post(browser(), '/api/login', { email: 'alice@example.com', password: 'long enough' })).status === 401);
  check('drawing stays open without an account (the planted sheet is reused)',
    (await post(alice, '/api/jobs', JOB)).status === 200);

  const link = await mail('alice@example.com', 1);
  const confirmToken = tokenIn(link, 'confirm');
  check('the email is the sign-up link, to the page', link.subject.startsWith('Finish signing up') && confirmToken.length === 64, link.text);
  check('a wrong link makes nothing',
    (await post(browser(), '/api/signup/confirm', { token: '0'.repeat(64) })).status === 400);
  const done = await post(alice, '/api/signup/confirm', { token: confirmToken });
  const doneBody = await done.json();
  check('pressed: the account is made and this browser signed in',
    done.status === 200 && (await me(alice)).account?.email === 'alice@example.com', JSON.stringify(doneBody));
  check('…verified from the start', doneBody.account?.verified === true);
  const stored = JSON.parse(readFileSync(join(accountsDir, 'accounts.json'), 'utf8'))
    .find((a: any) => a.email === 'alice@example.com');
  check('the account records the terms in force at the form, and when',
    typeof stored?.termsVersion === 'string' && stored.termsAcceptedAt > 0 && stored.termsAcceptedAt <= Date.now(),
    JSON.stringify({ v: stored?.termsVersion, at: stored?.termsAcceptedAt }));
  check('a sign-up link works once',
    (await post(browser(), '/api/signup/confirm', { token: confirmToken })).status === 400);
  check('the password chosen at sign-up signs in',
    (await post(browser(), '/api/login', { email: 'alice@example.com', password: 'long enough' })).status === 200);

  // ---- an address with an account ------------------------------------------------
  const again = await post(browser(), '/api/signup', { email: 'alice@example.com', password: 'somebody else' });
  const againBody = await again.json();
  check('signing up with a taken address is answered like any sign-up',
    again.status === 202 && againBody.pending === true &&
    againBody.message.replace('alice@example.com', '') === signedBody.message.replace('alice@example.com', ''),
    JSON.stringify(againBody));
  const note = await mail('alice@example.com', 2);
  check('…and the owner is emailed to say so, with no link that changes anything',
    note.subject.startsWith('You already have an account') && !tokenIn(note, 'confirm'), note.text);
  check('…and the password is still the owner\'s',
    (await post(browser(), '/api/login', { email: 'alice@example.com', password: 'long enough' })).status === 200);

  // ---- accounts from before ------------------------------------------------------
  check('an account from before verification signs in as it always did',
    (await post(browser(), '/api/login', { email: 'old@example.com', password: 'the old account' })).status === 200);
  const quiet = browser();
  check('an account never verified is left as it is: it signs in',
    (await post(quiet, '/api/login', { email: 'quiet@example.com', password: 'never clicked' })).status === 200);
  check('…says it is unverified', (await me(quiet)).account?.verified === false);
  check('…and can still have its link resent', (await quiet('/api/verify/resend', { method: 'POST' })).status === 200);
  const verifyLink = await mail('quiet@example.com', 1);
  check('…which verifies it',
    (await quiet(`/api/verify?token=${tokenIn(verifyLink, 'token')}`)).headers.get('location') === '/?verified=1' &&
    (await me(quiet)).account?.verified === true);

  // ---- a stranger's sign-up on somebody else's address ------------------------------
  const squatter = browser();
  await post(squatter, '/api/login', { email: 'victim@example.com', password: 'the squatter' });
  check('the stranger holds a session on the address', (await me(squatter)).account?.email === 'victim@example.com');
  const owner = browser();
  const claimed = await signUp(owner, 'victim@example.com', 'the real owner');
  check('the mailbox\'s owner signs up and the link hands them the account',
    claimed.status === 200 && (await me(owner)).account?.verified === true);
  check('…the stranger is signed out', (await me(squatter)).authed === false);
  check('…and the stranger\'s password is dead',
    (await post(browser(), '/api/login', { email: 'victim@example.com', password: 'the squatter' })).status === 401);

  // ---- a listed address, given the subscription only once proven ---------------------
  const boss = browser();
  await post(boss, '/api/login', { email: 'boss@example.com', password: 'listed but unproven' });
  check('a listed address that is unverified is not given the subscription', (await me(boss)).plan === 'free');
  await boss('/api/verify/resend', { method: 'POST' });
  const bossLink = await mail('boss@example.com', 1);
  await boss(`/api/verify?token=${tokenIn(bossLink, 'token')}`);
  check('…and is, once its mailbox has answered', (await me(boss)).plan === 'subscription');

  // ---- the password reset -----------------------------------------------------
  const bob = browser();
  await signUp(bob, 'bob@example.com', 'the old password');

  const unknown = await post(browser(), '/api/password/forgot', { email: 'nobody@example.com' });
  const unknownBody = await unknown.json();
  const known = await post(browser(), '/api/password/forgot', { email: 'bob@example.com' });
  check('forgot answers an unknown address exactly like a known one',
    unknown.status === 200 && known.status === 200 &&
    unknownBody.message === (await known.json()).message, JSON.stringify(unknownBody));

  const reset = await mail('bob@example.com', 2);
  const resetToken = tokenIn(reset, 'reset');
  check('the reset email names a link', reset.subject.includes('Reset') && resetToken.length === 64, reset.text);
  check('…and the unknown address was sent nothing', countTo('nobody@example.com') === 0);
  check('reset refuses a short password',
    (await post(browser(), '/api/password/reset', { token: resetToken, password: 'short' })).status === 400);
  const fresh = browser();
  const changed = await post(fresh, '/api/password/reset', { token: resetToken, password: 'the new password' });
  check('the reset link sets the password and signs this browser in',
    changed.status === 200 && (await me(fresh)).authed === true);
  check('the browser holding the old password is signed out', (await me(bob)).authed === false);
  check('a reset link works once',
    (await post(browser(), '/api/password/reset', { token: resetToken, password: 'another password' })).status === 400);
  check('the new password signs in',
    (await post(browser(), '/api/login', { email: 'bob@example.com', password: 'the new password' })).status === 200);

  // ---- one inbox is not flooded ------------------------------------------------------
  // bob has had two emails this hour (the link, the reset); a third may go, no more.
  for (let i = 0; i < 4; i++) await post(browser(), '/api/password/forgot', { email: 'bob@example.com' });
  await settle();
  check('one address is sent at most three emails in an hour', countTo('bob@example.com') === 3, String(countTo('bob@example.com')));
  check('…and the form still answers alike',
    (await post(browser(), '/api/password/forgot', { email: 'bob@example.com' })).status === 200);

  // ---- the notes cannot spend the links' allowance ---------------------------------------
  // Strangers signing up with alice's address send her "you already have an
  // account" notes; past one an hour they stop, and her own reset still goes.
  const aliceBefore = countTo('alice@example.com');
  for (let i = 0; i < 4; i++) await post(browser(), '/api/signup', { email: 'alice@example.com', password: 'a stranger' });
  await settle();
  check('repeated sign-ups with a taken address send its owner no flood of notes',
    countTo('alice@example.com') === aliceBefore, `${countTo('alice@example.com') - aliceBefore} more`);
  await post(browser(), '/api/password/forgot', { email: 'alice@example.com' });
  check('…and the owner\'s own reset email still goes',
    (await mail('alice@example.com', aliceBefore + 1)).text.includes('reset='));

  // ---- wrong passwords from many addresses ---------------------------------------------
  // Ten guesses at one account, each from a different address — what a botnet
  // does — and the account is held; its owner's right password included, which
  // without the human check is the brake there is. Another account is not.
  await signUp(browser(), 'carol@example.com', 'carol\'s password');
  for (let i = 0; i < 10; i++)
    await post(browser(`10.9.0.${i + 1}`), '/api/login', { email: 'carol@example.com', password: `guess ${i}` });
  const held = await post(browser(), '/api/login', { email: 'carol@example.com', password: 'carol\'s password' });
  check('ten wrong passwords, spread over ten addresses, hold the account', held.status === 429, String(held.status));
  check('…and only that account',
    (await post(browser(), '/api/login', { email: 'alice@example.com', password: 'long enough' })).status === 200);

  // ---- a forged X-Forwarded-For ----------------------------------------------------------
  // Caddy appends the address it was reached from; a visitor's own header comes
  // before it. Varying the forged part must not start the limit afresh.
  let lastStatus = 0;
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${BASE}/api/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i + 1}, 10.66.0.1` },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    lastStatus = r.status;
  }
  check('a forged first X-Forwarded-For entry does not dodge the limit', lastStatus === 429, String(lastStatus));

  // ---- the code is not an account ---------------------------------------------
  const code = browser();
  await post(code, '/api/login', { code: 'office-code' });
  check('a code session generates without any account', (await post(code, '/api/jobs', JOB)).status === 200);
} finally {
  server.kill();
  mailServer.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed. Server log:\n${serverLog}`);
  process.exit(1);
}
console.log('\nall checks passed');
