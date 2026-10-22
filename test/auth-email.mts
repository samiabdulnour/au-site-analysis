/* The emailed links, driven through the server.
 *
 * Resend is stood in for by a local endpoint that keeps every message, and the
 * server is booted against it (EMAIL_API_URL) on throwaway directories with a
 * finished sheet planted, so nothing is drawn and nothing reaches Resend, NSW
 * ePlanning or Stripe. Then: a sign-up is unverified and refused generation; a
 * wrong, spent or reused token verifies nothing; the emailed link verifies and
 * generation opens; resend sends a fresh link; the forgot form answers the
 * same for an unknown address and sends nothing; the reset link sets the new
 * password, signs that browser in, signs the old one out, and verifies the
 * address it arrived on; and a reset link works exactly once.
 *
 *   npx tsx test/auth-email.mts
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3126, MAIL_PORT = 3127;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = mkdtempSync(join(tmpdir(), 'auth-email-'));
const webOut = join(tmp, 'web'), accountsDir = join(tmp, 'accounts');

// ---- a finished sheet, planted ------------------------------------------------
// Generation is refused until the email verifies, and the proof it opens again
// must not draw anything: asking for this sheet's exact options answers from
// the reuse check, before any pipeline would run.
const jobId = randomUUID();
mkdirSync(join(webOut, jobId), { recursive: true });
writeFileSync(join(webOut, jobId, 'CONTEXT_ANALYSIS.pdf'), 'stands in for a PDF');
writeFileSync(join(webOut, 'jobs.json'), JSON.stringify([{
  id: jobId, address: '1 Test Street, Sydney NSW 2000', sheet: 'context', scale: 3000,
  rotate: 'north', template: 'flamingo', status: 'done', log: [], createdAt: Date.now(),
  pdf: 'CONTEXT_ANALYSIS.pdf',
}]));
const JOB = { address: '1 Test Street, Sydney NSW 2000', sheet: 'context', scale: 3000, rotate: 'north', template: 'flamingo' };

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

/** The nth message to an address, once it arrives — the sends are not awaited. */
async function mail(to: string, nth: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const got = mails.filter((m) => m.to === to);
    if (got.length >= nth) return got[nth - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${nth}th email to ${to} arrived`);
}
const countTo = (to: string) => mails.filter((m) => m.to === to).length;
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

/** A browser of its own: keeps the cookies it is given. */
function browser() {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(BASE + path, {
      redirect: 'manual',
      ...init,
      headers: { ...(init.headers as Record<string, string>), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
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
const post = (b: ReturnType<typeof browser>, path: string, body: unknown) =>
  b(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${BASE}/robots.txt`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`server never answered:\n${serverLog}`);

  // ---- a sign-up is asked to verify ------------------------------------------
  const alice = browser();
  const signed = await post(alice, '/api/signup', { email: 'alice@example.com', password: 'long enough' });
  const signedBody = await signed.json();
  check('sign-up works and says the email is unverified',
    signed.status === 201 && signedBody.account?.verified === false, JSON.stringify(signedBody));
  check('unverified: generating is refused', (await post(alice, '/api/jobs', JOB)).status === 403);
  check('unverified: a batch is refused too',
    (await post(alice, '/api/batches', { addresses: [JOB.address], sheet: 'context' })).status === 403);

  const sent = await mail('alice@example.com', 1);
  const verifyToken = tokenIn(sent, 'token');
  check('the verification email names a link', sent.subject.includes('Verify') && verifyToken.length === 64, sent.text);

  const wrong = await alice(`/api/verify?token=${'0'.repeat(64)}`);
  check('a wrong token verifies nothing',
    wrong.status === 303 && wrong.headers.get('location') === '/?verified=0', String(wrong.status));
  check('…and the account stays unverified',
    (await (await alice('/api/me')).json()).account?.verified === false);

  // ---- resend, then the link --------------------------------------------------
  const resend = await alice('/api/verify/resend', { method: 'POST' });
  check('resend sends a fresh link', resend.status === 200, String(resend.status));
  const resent = await mail('alice@example.com', 2);
  const freshToken = tokenIn(resent, 'token');
  check('the fresh link replaces the old one: the first token is dead',
    (await alice(`/api/verify?token=${verifyToken}`)).headers.get('location') === '/?verified=0');

  const clicked = await alice(`/api/verify?token=${freshToken}`);
  check('the emailed link verifies',
    clicked.status === 303 && clicked.headers.get('location') === '/?verified=1');
  check('verified: /api/me says so', (await (await alice('/api/me')).json()).account?.verified === true);
  const job = await post(alice, '/api/jobs', JOB);
  check('verified: generating opens (the planted sheet is reused)',
    job.status === 200 && (await job.json()).reused === true, String(job.status));
  check('a verification link works once',
    (await alice(`/api/verify?token=${freshToken}`)).headers.get('location') === '/?verified=0');
  check('verified: resend has nothing to send', (await alice('/api/verify/resend', { method: 'POST' })).status === 409);

  // ---- the password reset -----------------------------------------------------
  const bob = browser();
  await post(bob, '/api/signup', { email: 'bob@example.com', password: 'the old password' });
  await mail('bob@example.com', 1);

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
  check('reset refuses a wrong token',
    (await post(browser(), '/api/password/reset', { token: '0'.repeat(64), password: 'the new password' })).status === 400);

  const fresh = browser();
  const done = await post(fresh, '/api/password/reset', { token: resetToken, password: 'the new password' });
  const doneBody = await done.json();
  check('the reset link sets the password and signs this browser in',
    done.status === 200 && (await (await fresh('/api/me')).json()).authed === true, JSON.stringify(doneBody));
  check('the link arriving back verifies the address it was sent to', doneBody.account?.verified === true);
  check('the browser holding the old password is signed out', (await bob('/api/me')).status === 401);
  check('a reset link works once',
    (await post(browser(), '/api/password/reset', { token: resetToken, password: 'another password' })).status === 400);
  check('the old password is dead',
    (await post(browser(), '/api/login', { email: 'bob@example.com', password: 'the old password' })).status === 401);
  check('the new password signs in',
    (await post(browser(), '/api/login', { email: 'bob@example.com', password: 'the new password' })).status === 200);

  // ---- the code is not an account ---------------------------------------------
  const code = browser();
  await post(code, '/api/login', { code: 'office-code' });
  check('a code session generates without any verification',
    (await post(code, '/api/jobs', JOB)).status === 200);
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
