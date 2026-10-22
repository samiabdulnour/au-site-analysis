/* The two sides of the site, driven through the server.
 *
 * A finished sheet is planted in a job index of its own — a PDF, a CAD zip and
 * a CSV — and the server is booted on it with throwaway directories, so no
 * sheet is drawn and nothing reaches NSW ePlanning, Overpass or Stripe. Then:
 * a free account gets the PDF stamped and is refused the open formats; an
 * account given the subscription, the shared code, and an account Stripe's
 * webhook says has paid all get the PDF as drawn and the files; a forged
 * webhook changes nothing; and a cancelled subscription goes back to free.
 *
 *   npx tsx test/plans.mts
 */

import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3125;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'whsec_for_tests';

const tmp = mkdtempSync(join(tmpdir(), 'plans-'));
const webOut = join(tmp, 'web'), accountsDir = join(tmp, 'accounts');

// ---- the planted sheet ------------------------------------------------------
const jobId = randomUUID();
const jobDir = join(webOut, jobId);
mkdirSync(jobDir, { recursive: true });
const doc = await PDFDocument.create();
doc.addPage([2384, 1684]);
doc.addPage([1191, 842]);
const clean = Buffer.from(await doc.save());
writeFileSync(join(jobDir, 'CONTEXT_ANALYSIS.pdf'), clean);
writeFileSync(join(jobDir, 'CONTEXT_ANALYSIS_CAD.zip'), 'not really a zip');
writeFileSync(join(jobDir, 'DATA.csv'), 'a,b\n1,2\n');
// The picture the page shows once a drawing is done. Any bytes will do here.
writeFileSync(join(jobDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
// A second sheet at another address: unlocking one site must leave this one stamped.
const otherId = randomUUID();
mkdirSync(join(webOut, otherId), { recursive: true });
writeFileSync(join(webOut, otherId, 'SITE_ANALYSIS.pdf'), clean);
writeFileSync(join(webOut, 'jobs.json'), JSON.stringify([{
  id: jobId, address: '1 Test Street, Sydney NSW 2000', sheet: 'context', scale: 3000,
  rotate: 'north', template: 'flamingo', status: 'done', log: [], createdAt: Date.now(),
  pdf: 'CONTEXT_ANALYSIS.pdf', cad: 'CONTEXT_ANALYSIS_CAD.zip', data: 'DATA.csv',
}, {
  id: otherId, address: '9 Other Road, Sydney NSW 2000', sheet: 'site', scale: 0,
  rotate: 'north', template: 'flamingo', status: 'done', log: [], createdAt: Date.now(),
  pdf: 'SITE_ANALYSIS.pdf',
}]));

// ---- the server -------------------------------------------------------------
const server = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'server.ts')], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), WEB_OUT_DIR: webOut, ACCOUNTS_DIR: accountsDir,
    ACCESS_CODE: 'office-code', ADMIN_CODE: 'operator-code', ALLOW_NO_AUTH: '',
    SUBSCRIPTION_EMAILS: 'office@example.com',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '',
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

function webhook(event: unknown, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return fetch(`${BASE}/api/billing/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw,
  });
}

/** What a session is given of a sheet: its plan, whether the PDF comes clean, and the CAD's answer. */
async function holds(b: ReturnType<typeof browser>, id = jobId) {
  const me = await (await b('/api/me')).json();
  const job = await (await b(`/api/jobs/${id}`)).json();
  const pdfRes = await b(`/api/jobs/${id}/pdf`);
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  const cad = (await b(`/api/jobs/${id}/cad`)).status;
  const data = (await b(`/api/jobs/${id}/data`)).status;
  return { plan: me.plan, pdfStatus: pdfRes.status, cleanPdf: pdf.equals(clean), pdf, cad, data,
           cache: pdfRes.headers.get('cache-control'), disposition: pdfRes.headers.get('content-disposition'),
           grants: job.grants, me };
}

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${BASE}/robots.txt`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`server never answered:\n${serverLog}`);

  // ---- no session -----------------------------------------------------------
  const anon = browser();
  check('no session: /api/me is 401', (await anon('/api/me')).status === 401);
  check('no session: the PDF is 401', (await anon(`/api/jobs/${jobId}/pdf`)).status === 401);
  check('the plans page answers, price filled in',
    await anon('/pricing').then(async (r) => r.status === 200 && !(await r.text()).includes('%PRICE%')));

  // ---- a free account -------------------------------------------------------
  const free = browser();
  check('sign-up refuses a short password',
    (await post(free, '/api/signup', { email: 'free@example.com', password: 'short' })).status === 400);
  check('sign-up refuses a non-address',
    (await post(free, '/api/signup', { email: 'nobody', password: 'long enough' })).status === 400);
  const signed = await post(free, '/api/signup', { email: 'Free@Example.com ', password: 'long enough' });
  const signedBody = await signed.json();
  check('sign-up makes a free account', signed.status === 201 && signedBody.plan === 'free',
    JSON.stringify(signedBody));
  check('the same email cannot sign up twice',
    (await post(browser(), '/api/signup', { email: 'free@example.com', password: 'another one' })).status === 409);

  const f1 = await holds(free);
  check('free: the PDF is served', f1.pdfStatus === 200);
  check('free: the PDF is stamped, not the one drawn', !f1.cleanPdf);
  const stamped = await PDFDocument.load(f1.pdf);
  check('free: every page is still there', stamped.getPageCount() === 2);
  check('free: the CAD is refused with 402', f1.cad === 402, String(f1.cad));
  check('free: the data is refused with 402', f1.data === 402, String(f1.data));
  check('downloads are not cached in between', f1.cache === 'private, no-store', String(f1.cache));
  const shown = await (await free(`/api/jobs/${jobId}`)).json();
  const picture = await free(`/api/jobs/${jobId}/preview`);
  check('the finished drawing\'s picture is offered and served, to every plan',
    shown.hasPreview === true && picture.status === 200 && picture.headers.get('content-type') === 'image/jpeg');
  const none = await (await free(`/api/jobs/${otherId}`)).json();
  check('a drawing without a picture says so, and serves none',
    none.hasPreview === false && (await free(`/api/jobs/${otherId}/preview`)).status === 404);
  const kept = readFileSync(join(jobDir, 'CONTEXT_ANALYSIS.pdf'));
  check('the sheet on disk stays clean', kept.equals(clean));
  // OPEN PDF shows it in the browser; DOWNLOAD PDF asks for the same file to be saved.
  check('the PDF opens in the browser', f1.disposition?.startsWith('inline;') === true, String(f1.disposition));
  const saved = await free(`/api/jobs/${jobId}/pdf?download`);
  const savedAs = saved.headers.get('content-disposition');
  check('?download saves it, stamped all the same',
    saved.status === 200 && savedAs?.startsWith('attachment;') === true && !Buffer.from(await saved.arrayBuffer()).equals(clean),
    `${saved.status} ${savedAs}`);

  // ---- signing in and out ---------------------------------------------------
  const again = browser();
  check('wrong password is refused',
    (await post(again, '/api/login', { email: 'free@example.com', password: 'not it' })).status === 401);
  check('unknown email is refused the same way',
    (await post(again, '/api/login', { email: 'nobody@example.com', password: 'long enough' })).status === 401);
  const login = await post(again, '/api/login', { email: 'FREE@example.com', password: 'long enough' });
  check('right password signs in', login.status === 200 && (await login.json()).plan === 'free');
  await again('/api/logout', { method: 'POST' });
  check('signing out puts the account down', (await again('/api/me')).status === 401);

  // ---- the subscription, three ways ------------------------------------------
  const office = browser();
  await post(office, '/api/signup', { email: 'office@example.com', password: 'long enough' });
  const o = await holds(office);
  check('given without charge: the PDF as drawn', o.plan === 'subscription' && o.cleanPdf);
  check('given without charge: the CAD and data', o.cad === 200 && o.data === 200, `${o.cad} ${o.data}`);

  const code = browser();
  await post(code, '/api/login', { code: 'office-code' });
  const c = await holds(code);
  check('the shared code: the PDF as drawn, and the files', c.plan === 'subscription' && c.cleanPdf && c.cad === 200);

  // What Checkout puts on the subscription, so Stripe's events name the account.
  const freeId = JSON.parse(readFileSync(join(accountsDir, 'accounts.json'), 'utf8'))
    .find((a: any) => a.email === 'free@example.com').id;
  const sub = (status: string) => ({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test', status, metadata: { account_id: freeId },
                      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } } },
  });

  check('a forged webhook is refused', (await webhook(sub('active'), 'whsec_wrong')).status === 400);
  check('…and grants nothing', (await holds(free)).plan === 'free');

  check('a signed webhook is accepted', (await webhook(sub('active'))).status === 200);
  const paid = await holds(free);
  check('paid: the same account now gets the PDF as drawn', paid.plan === 'subscription' && paid.cleanPdf);
  check('paid: and the CAD', paid.cad === 200);
  const me = await (await free('/api/me')).json();
  check('paid: /api/me says when it is paid to', typeof me.account?.renewsAt === 'number', JSON.stringify(me.account));

  await webhook({ ...sub('canceled'), type: 'customer.subscription.deleted' });
  const lapsed = await holds(free);
  check('cancelled: back to free, stamped again', lapsed.plan === 'free' && !lapsed.cleanPdf && lapsed.cad === 402);

  // ---- one site, bought on its own ---------------------------------------------
  const paidFor = (id: string, address: string, paymentStatus = 'paid') => ({
    type: 'checkout.session.completed',
    data: { object: { id, mode: 'payment', payment_status: paymentStatus, customer: 'cus_site',
                      client_reference_id: freeId, metadata: { account_id: freeId, kind: 'site', address } } },
  });
  await webhook(paidFor('cs_unsettled', '1 Test Street, Sydney NSW 2000', 'unpaid'));
  check('an unsettled payment unlocks nothing', !(await holds(free)).cleanPdf);

  // Spelt differently from the job: case and punctuation do not make another site.
  check('a paid site is accepted', (await webhook(paidFor('cs_site', '1 TEST STREET SYDNEY NSW 2000'))).status === 200);
  const site = await holds(free);
  check('unlocked: that site\'s PDF as drawn, and its CAD and data',
    site.plan === 'free' && site.cleanPdf && site.cad === 200 && site.data === 200, JSON.stringify(site.grants));
  check('unlocked: the job says so to the page', site.grants?.cleanPdf === true && site.grants?.openData === true);
  const other = await holds(free, otherId);
  check('unlocked: another site is still stamped', !other.cleanPdf && other.grants?.cleanPdf === false);
  const until = site.me.account?.sites?.[0]?.until;
  check('unlocked: /api/me lists the site and when it runs out',
    site.me.account?.sites?.length === 1 && until > Date.now() + 29 * 86400_000, JSON.stringify(site.me.account));

  await webhook(paidFor('cs_site', '1 Test Street, Sydney NSW 2000'));
  const twice = (await (await free('/api/me')).json()).account?.sites?.[0]?.until;
  check('the same payment delivered twice extends nothing', twice === until, `${twice} vs ${until}`);

  // A method that settles days later: completed arrives unpaid, then the same
  // session again as async_payment_succeeded once the money is in.
  await webhook(paidFor('cs_slow', '9 Other Road, Sydney NSW 2000', 'unpaid'));
  check('a slow payment, not yet settled, unlocks nothing', !(await holds(free, otherId)).cleanPdf);
  await webhook({ ...paidFor('cs_slow', '9 Other Road, Sydney NSW 2000'), type: 'checkout.session.async_payment_succeeded' });
  check('…and unlocks the site once Stripe says it settled', (await holds(free, otherId)).cleanPdf);

  check('unlock refuses without Stripe',
    (await post(free, '/api/billing/unlock', { job: otherId })).status === 503);

  // ---- billing with Stripe switched off ---------------------------------------
  const checkout = await free('/api/billing/checkout', { method: 'POST' });
  check('checkout says subscriptions are not open, without Stripe', checkout.status === 503);
  check('checkout needs an account, not a code',
    (await code('/api/billing/checkout', { method: 'POST' })).status === 400);
} finally {
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed. Server log:\n${serverLog}`);
  process.exit(1);
}
console.log('\nall checks passed');
