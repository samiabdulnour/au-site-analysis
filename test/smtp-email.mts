/* The emailed links sent over SMTP, as through a Namecheap Private Email box.
 *
 * The mail server is stood in for by a small SMTP server on this machine that
 * keeps the login and every message, and the site's server is booted against
 * it on throwaway directories — with a Resend key set too, aimed at a port
 * nothing answers on, so a link that arrives is proof SMTP won. Then: the log
 * says email goes by SMTP; the verification email logs in as the mailbox,
 * comes from it, reaches the sign-up's address, and its link verifies; the
 * reset email's link sets a new password that signs in; and a mail server
 * refusing the login makes RESEND say it could not send rather than "sent".
 * Nothing reaches a real mail server, Resend, NSW ePlanning or Stripe.
 *
 *   npx tsx test/smtp-email.mts
 */

import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3128, SMTP_PORT = 3129, DEAD_PORT = 3130;
const BASE = `http://127.0.0.1:${PORT}`;
const MAILBOX = 'no-reply@example.com';
// A password the deployer's env file would have to quote, carried intact.
const PASSWORD = 'p$ss w0rd!';

const tmp = mkdtempSync(join(tmpdir(), 'smtp-email-'));

// ---- the mail server, stood in for ---------------------------------------------
interface Mail { login: string; envelopeFrom: string; rcpt: string[]; headers: Record<string, string>; text: string }
const mails: Mail[] = [];
let acceptLogin = true;

/** RFC 2047 words, as a subject with an em dash in it arrives. */
const decodeWords = (s: string) => s.replace(/=\?utf-8\?([qb])\?([^?]*)\?=/gi, (_, enc, data) =>
  enc.toLowerCase() === 'b' ? Buffer.from(data, 'base64').toString('utf8')
    : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));

function parse(raw: string): { headers: Record<string, string>; text: string } {
  const split = raw.indexOf('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  let body = raw.slice(split + 4);
  const cte = (headers['content-transfer-encoding'] ?? '').toLowerCase();
  if (cte === 'quoted-printable') {
    body = Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  } else if (cte === 'base64') {
    body = Buffer.from(body, 'base64').toString('utf8');
  }
  return { headers, text: body };
}

const smtpServer = createServer((sock: Socket) => {
  let buf = '', login = '', envelopeFrom = '', rcpt: string[] = [];
  let mode: 'cmd' | 'data' | 'authPlain' | 'loginUser' | 'loginPass' = 'cmd';
  let data: string[] = [], user = '';
  const say = (s: string) => sock.write(`${s}\r\n`);
  const authed = (u: string, p: string) => {
    if (acceptLogin && u === MAILBOX && p === PASSWORD) { login = u; say('235 2.7.0 Authentication successful'); }
    else say('535 5.7.8 Authentication failed');
  };
  const plain = (b64: string) => { const [, u, p] = Buffer.from(b64, 'base64').toString('utf8').split('\0'); authed(u, p); };
  say('220 stub ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (mode === 'data') {
        if (line === '.') {
          mails.push({ login, envelopeFrom, rcpt, ...parse(data.join('\r\n')) });
          data = []; rcpt = []; mode = 'cmd';
          say('250 2.0.0 queued');
        } else data.push(line.startsWith('..') ? line.slice(1) : line);
        continue;
      }
      if (mode === 'authPlain') { mode = 'cmd'; plain(line); continue; }
      if (mode === 'loginUser') { user = Buffer.from(line, 'base64').toString('utf8'); mode = 'loginPass'; say('334 UGFzc3dvcmQ6'); continue; }
      if (mode === 'loginPass') { mode = 'cmd'; authed(user, Buffer.from(line, 'base64').toString('utf8')); continue; }
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === 'EHLO') say('250-stub\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8');
      else if (verb === 'HELO') say('250 stub');
      else if (/^AUTH PLAIN \S/i.test(line)) plain(line.slice(11));
      else if (/^AUTH PLAIN$/i.test(line)) { mode = 'authPlain'; say('334 '); }
      else if (/^AUTH LOGIN$/i.test(line)) { mode = 'loginUser'; say('334 VXNlcm5hbWU6'); }
      else if (verb === 'MAIL') {
        if (!login) { say('530 5.7.0 Authentication required'); continue; }
        envelopeFrom = line.match(/<([^>]*)>/)?.[1] ?? ''; say('250 2.1.0 ok');
      }
      else if (verb === 'RCPT') { rcpt.push(line.match(/<([^>]*)>/)?.[1] ?? ''); say('250 2.1.5 ok'); }
      else if (verb === 'DATA') { mode = 'data'; say('354 go ahead'); }
      else if (verb === 'QUIT') { say('221 bye'); sock.end(); }
      else say('250 ok');   // RSET, NOOP
    }
  });
  sock.on('error', () => {});
});
smtpServer.listen(SMTP_PORT, '127.0.0.1');

/** The nth message to an address, once it arrives — the sign-up's send is not awaited. */
async function mail(to: string, nth: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const got = mails.filter((m) => m.rcpt.includes(to));
    if (got.length >= nth) return got[nth - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${nth}th email to ${to} arrived`);
}
const tokenIn = (m: Mail, param: string) => m.text.match(new RegExp(`${param}=([0-9a-f]{64})`))?.[1] ?? '';

// ---- the server ---------------------------------------------------------------
const server = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'server.ts')], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), WEB_OUT_DIR: join(tmp, 'web'), ACCOUNTS_DIR: join(tmp, 'accounts'),
    ACCESS_CODE: '', ADMIN_CODE: '', ALLOW_NO_AUTH: '',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: MAILBOX, SMTP_PASS: PASSWORD,
    EMAIL_FROM: `Site Analyst <${MAILBOX}>`,
    RESEND_API_KEY: 're_unused', EMAIL_API_URL: `http://127.0.0.1:${DEAD_PORT}/emails`,
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
  check('the log says email goes by SMTP', serverLog.includes('email smtp'), serverLog.trim());

  // ---- verification, over SMTP -------------------------------------------------
  const carol = browser();
  const signed = await post(carol, '/api/signup', { email: 'carol@example.com', password: 'long enough', agreed: true });
  check('sign-up says the email is unverified',
    signed.status === 201 && (await signed.json()).account?.verified === false);
  const v = await mail('carol@example.com', 1);
  check('the mail server was logged in to as the mailbox, password intact', v.login === MAILBOX);
  check('it comes from the mailbox', v.envelopeFrom === MAILBOX && v.headers.from?.includes(MAILBOX), JSON.stringify(v.headers.from));
  check('it goes to the sign-up and no one else', v.rcpt.length === 1 && v.headers.to?.includes('carol@example.com'));
  check('the subject arrives whole, dash and all', v.headers.subject === 'Verify your email — Site Analyst', v.headers.subject);
  const verifyToken = tokenIn(v, 'token');
  check('the email carries the link', verifyToken.length === 64, v.text);
  const clicked = await carol(`/api/verify?token=${verifyToken}`);
  check('the emailed link verifies', clicked.headers.get('location') === '/?verified=1');
  check('verified: /api/me says so', (await (await carol('/api/me')).json()).account?.verified === true);

  // ---- the password reset, over SMTP ---------------------------------------------
  await post(browser(), '/api/password/forgot', { email: 'carol@example.com' });
  const r = await mail('carol@example.com', 2);
  const resetToken = tokenIn(r, 'reset');
  check('the reset email arrives with its link', r.headers.subject?.startsWith('Reset') === true && resetToken.length === 64, r.text);
  check('the reset link sets the new password',
    (await post(browser(), '/api/password/reset', { token: resetToken, password: 'a new password' })).status === 200);
  check('the new password signs in',
    (await post(browser(), '/api/login', { email: 'carol@example.com', password: 'a new password' })).status === 200);

  // ---- the mail server refusing the login ----------------------------------------
  acceptLogin = false;
  const dave = browser();
  await post(dave, '/api/signup', { email: 'dave@example.com', password: 'long enough', agreed: true });
  const resend = await dave('/api/verify/resend', { method: 'POST' });
  check('a refused login: RESEND says it could not send', resend.status === 502, String(resend.status));
  await new Promise((r) => setTimeout(r, 300));
  check('…and the log names the server\'s refusal', /535/.test(serverLog), serverLog.slice(-400));
  check('…and the password never reaches the log', !serverLog.includes(PASSWORD));
} finally {
  server.kill();
  smtpServer.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed. Server log:\n${serverLog}`);
  process.exit(1);
}
console.log('\nall checks passed');
