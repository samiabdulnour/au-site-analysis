/* The human check and the honeypot, through the server.
 *
 * Cloudflare Turnstile's siteverify is stood in for by a local endpoint that
 * passes one token and nothing else, and Resend by another that keeps every
 * message; the server is booted against both on throwaway directories, so
 * nothing reaches Cloudflare, Resend, NSW ePlanning or Stripe. Then: the page
 * is told the site key; sign-up and the reset email need a good token, and a
 * filled-in honeypot is answered like anyone with nothing sent; sign-in asks
 * nothing until three wrong passwords at one account or five from one
 * address, then wants a good token even with the right password, and forgets
 * once someone gets in; the codes are guarded the same way; a new sheet or
 * batch from a visitor without a session needs a good token, and then meets
 * that visitor's own day of free sheets — one address's spent day, kept on
 * disk from before the server started, is not another's (and nothing is
 * ever queued); and Cloudflare not answering refuses rather than lets
 * through.
 *
 *   npx tsx test/bots.mts
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3131, MAIL_PORT = 3132, CF_PORT = 3133;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE_KEY = 'site-key-for-tests', SECRET = 'secret-for-tests', GOOD = 'good-token';

const tmp = mkdtempSync(join(tmpdir(), 'bots-'));

// One visitor who drew both their free sheets before this server started, as
// the server keeps it on the volume: the address hashed, its day still running.
const SPENT = '10.0.9.1', GUEST_SHEETS = 2;
const guestKey = (ip: string) => createHash('sha256').update(`site-analyst-guest:${ip}`).digest('hex').slice(0, 32);
mkdirSync(join(tmp, 'web'), { recursive: true });
writeFileSync(join(tmp, 'web', 'guests.json'),
  JSON.stringify({ [guestKey(SPENT)]: { count: GUEST_SHEETS, resetAt: Date.now() + 3600_000 } }));

// ---- Cloudflare, stood in for -------------------------------------------------
let cfDown = false;
const asked: { response: string; remoteip: string }[] = [];
const cf = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const f = new URLSearchParams(body);
    asked.push({ response: f.get('response') ?? '', remoteip: f.get('remoteip') ?? '' });
    if (cfDown) { res.writeHead(502); res.end('bad gateway'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: f.get('secret') === SECRET && f.get('response') === GOOD }));
  });
});
cf.listen(CF_PORT);

// ---- the email service, stood in for -----------------------------------------
const mails: { to: string; text: string }[] = [];
const mailServer = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const m = JSON.parse(body);
    mails.push({ to: m.to[0], text: m.text });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"stub"}');
  });
});
mailServer.listen(MAIL_PORT);
const countTo = (to: string) => mails.filter((m) => m.to === to).length;
async function mail(to: string, nth: number) {
  for (let i = 0; i < 40; i++) {
    const got = mails.filter((m) => m.to === to);
    if (got.length >= nth) return got[nth - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${nth}th email to ${to} arrived`);
}
const settle = () => new Promise((r) => setTimeout(r, 600));

// ---- the server ---------------------------------------------------------------
const server = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'server.ts')], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), WEB_OUT_DIR: join(tmp, 'web'), ACCOUNTS_DIR: join(tmp, 'accounts'),
    ACCESS_CODE: 'office-code', ADMIN_CODE: '', ALLOW_NO_AUTH: '',
    TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET,
    TURNSTILE_VERIFY_URL: `http://127.0.0.1:${CF_PORT}/siteverify`,
    RESEND_API_KEY: 're_for_tests', EMAIL_FROM: 'Site Analyst <test@example.com>',
    EMAIL_API_URL: `http://127.0.0.1:${MAIL_PORT}/emails`, SMTP_HOST: '',
    STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', STRIPE_WEBHOOK_SECRET: '',
    GUEST_SHEETS_PER_DAY: String(GUEST_SHEETS),
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

/** A browser of its own, reaching the server from `from` as Caddy would say. */
function browser(from = `10.0.1.${Math.floor(Math.random() * 250) + 1}`) {
  const jar = new Map<string, string>();
  return async (path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Forwarded-For': from,
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
}
const answer = async (r: Response) => ({ status: r.status, ...(await r.json()) });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${BASE}/robots.txt`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`server never answered:\n${serverLog}`);

  check('the page is told the site key', (await (await browser()('/api/me')).json()).humanCheck === SITE_KEY);

  // ---- sign-up --------------------------------------------------------------------
  const who = { email: 'erin@example.com', password: 'erin\'s password' };
  const none = await answer(await browser()('/api/signup', who));
  check('sign-up without the check is refused, and says to do it', none.status === 403 && none.human === true, JSON.stringify(none));
  check('…as is a token Cloudflare does not pass',
    (await browser()('/api/signup', { ...who, human: 'forged' })).status === 403);
  const tasted = asked.at(-1);
  check('Cloudflare is asked about the visitor\'s own address', tasted?.remoteip?.startsWith('10.0.1.') === true, JSON.stringify(tasted));
  const erin = browser();
  const ok = await answer(await erin('/api/signup', { ...who, human: GOOD }));
  check('with a good token it goes ahead', ok.status === 202 && ok.pending === true, JSON.stringify(ok));
  const link = await mail('erin@example.com', 1);
  const token = link.text.match(/confirm=([0-9a-f]{64})/)?.[1] ?? '';
  check('…and the link needs no check of its own: pressing it is the proof',
    (await erin('/api/signup/confirm', { token })).status === 200);

  const trapped = await answer(await browser()('/api/signup', { email: 'bot@example.com', password: 'a bot\'s pass', human: GOOD, website: 'http://spam.example' }));
  check('a filled-in honeypot is answered like anyone', trapped.status === 202 && trapped.pending === true);
  await settle();
  check('…and nothing is sent', countTo('bot@example.com') === 0);

  // ---- the reset email ---------------------------------------------------------------
  check('a reset email without the check is refused',
    (await browser()('/api/password/forgot', { email: 'erin@example.com' })).status === 403);
  check('a honeypot asking for one is answered like anyone',
    (await browser()('/api/password/forgot', { email: 'erin@example.com', human: GOOD, website: 'x' })).status === 200);
  await settle();
  check('…and sent nothing', countTo('erin@example.com') === 1);
  check('with a good token the reset email goes',
    (await browser()('/api/password/forgot', { email: 'erin@example.com', human: GOOD })).status === 200 &&
    (await mail('erin@example.com', 2)).text.includes('reset='));

  // ---- sign-in: three wrong at one account ----------------------------------------------
  const guess = (n: number) => browser(`10.0.2.${n}`)('/api/login', { email: 'erin@example.com', password: `guess ${n}` }).then(answer);
  const first = await guess(1), second = await guess(2);
  check('the first wrong passwords ask nothing', first.status === 401 && !first.human && !second.human);
  const third = await guess(3);
  check('the third says the next try meets the check', third.status === 401 && third.human === true, JSON.stringify(third));
  const right = { email: 'erin@example.com', password: who.password };
  const owner = browser('10.0.2.99');
  const blocked = await answer(await owner('/api/login', right));
  check('then even the right password needs a good token', blocked.status === 401 && blocked.human === true, JSON.stringify(blocked));
  check('…a forged one does not do', (await owner('/api/login', { ...right, human: 'forged' })).status === 401);
  check('…a good one lets the owner in', (await owner('/api/login', { ...right, human: GOOD })).status === 200);
  const after = await answer(await browser('10.0.2.98')('/api/login', { email: 'erin@example.com', password: 'one more slip' }));
  check('once in, the count starts again', after.status === 401 && !after.human, JSON.stringify(after));

  // ---- sign-in: five wrong from one address ---------------------------------------------
  const roamer = browser('10.0.3.1');
  for (let i = 0; i < 5; i++) await roamer('/api/login', { email: `nobody${i}@example.com`, password: 'whatever' });
  check('five wrong from one address, at five accounts: that address meets the check',
    (await answer(await roamer('/api/login', { email: 'nobody9@example.com', password: 'whatever' }))).human === true);
  check('…and no other address does',
    !(await answer(await browser('10.0.3.2')('/api/login', { email: 'nobody9@example.com', password: 'whatever' }))).human);

  // ---- the codes ---------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) await browser(`10.0.4.${i + 1}`)('/api/login', { code: `wrong ${i}` });
  const office = browser('10.0.4.50');
  check('three wrong codes, and the right one needs the check',
    (await answer(await office('/api/login', { code: 'office-code' }))).human === true);
  check('…and gets in with it', (await office('/api/login', { code: 'office-code', human: GOOD })).status === 200);

  // ---- drawing without a session ------------------------------------------------------------
  const sheet = { address: '26-30 Campsie St, Campsie NSW 2194', sheet: 'context' };
  const guestNone = await answer(await browser(SPENT)('/api/jobs', sheet));
  check('a new sheet without a session and without the check is refused, and says to do it',
    guestNone.status === 403 && guestNone.human === true, JSON.stringify(guestNone));
  check('…as is a forged token', (await browser(SPENT)('/api/jobs', { ...sheet, human: 'forged' })).status === 403);
  const spent = await answer(await browser(SPENT)('/api/jobs', { ...sheet, human: GOOD }));
  check('a good token passes the check, and a visitor whose free sheets are drawn is told to sign up',
    spent.status === 429 && /free sheets for today/.test(spent.error ?? ''), JSON.stringify(spent));
  const batch = { addresses: [sheet.address, '1 Bay Street, Botany NSW 2019', '2 Bay Street, Botany NSW 2019'], sheet: 'context' };
  check('a batch without a session needs the check too',
    (await answer(await browser()('/api/batches', batch))).human === true);
  const own = await answer(await browser('10.0.9.2')('/api/batches', { ...batch, human: GOOD }));
  check('another visitor has a day of their own, not what is left of the first one\'s',
    own.status === 429 && own.error?.includes(`${GUEST_SHEETS} of your free sheets left today`), JSON.stringify(own));

  // ---- Cloudflare not answering ----------------------------------------------------------------
  cfDown = true;
  check('Cloudflare not answering refuses, rather than lets through',
    (await browser()('/api/signup', { email: 'frank@example.com', password: 'frank\'s pass', human: GOOD })).status === 403);
  check('…and says so in the log', /human check: Cloudflare answered 502/.test(serverLog), serverLog.slice(-300));
} finally {
  server.kill();
  cf.close();
  mailServer.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed. Server log:\n${serverLog}`);
  process.exit(1);
}
console.log('\nall checks passed');
