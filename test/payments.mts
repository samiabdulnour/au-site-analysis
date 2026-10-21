/* Paying for a drawing, without Stripe: the prices read from the env, the
 * Checkout session asked for, a session's payment read back, and a webhook's
 * signature checked — fetch stood in for, the signatures made here with a
 * made-up secret. CI never calls Stripe.
 *
 *   npx tsx test/payments.mts
 */

import { createHmac } from 'node:crypto';
import { parsePrices, paymentsFromEnv, createCheckout, paidOrder, webhookPayment, form, StripeError } from '../src/payments.js';

const fails: string[] = [];
const check = (name: string, ok: boolean) => { if (!ok) fails.push(name); };

// ---- prices --------------------------------------------------------------

const one = parsePrices('49');
check('a bare amount prices every drawing', 'prices' in one && Object.values(one.prices).every((c) => c === 4900));
const two = parsePrices('49, slides=149.50');
check('a drawing priced apart from the rest', 'prices' in two && two.prices.slides === 14950 && two.prices.context === 4900);
check('each drawing named, no default', 'prices' in parsePrices('context=1,site=2,summary=3,yield=4,slides=5'));
check('a drawing left without a price is refused', 'error' in parsePrices('slides=149'));
check('an unknown drawing is refused', 'error' in parsePrices('49,deck=149'));
check('under Stripe\'s minimum is refused', 'error' in parsePrices('0.20'));
check('three decimals are refused', 'error' in parsePrices('49.999'));
check('nothing is nothing', 'error' in parsePrices(''));

check('no key, no payments', paymentsFromEnv({ PRICES_AUD: '49' }).pay === null);
check('a key without prices sells nothing', paymentsFromEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }).pay === null);
check('a test key is test mode', paymentsFromEnv({ STRIPE_SECRET_KEY: 'sk_test_x', PRICES_AUD: '49' }).pay?.live === false);
check('a live key is live', paymentsFromEnv({ STRIPE_SECRET_KEY: 'sk_live_x', PRICES_AUD: '49' }).pay?.live === true);
check('a restricted live key is live', paymentsFromEnv({ STRIPE_SECRET_KEY: 'rk_live_x', PRICES_AUD: '49' }).pay?.live === true);

check('form encodes nested keys in brackets',
  form({ a: { b: [{ c: 1 }] }, d: 'x y' }).toString() === 'a%5Bb%5D%5B0%5D%5Bc%5D=1&d=x+y');

// ---- the session asked for, and read back --------------------------------

const pay = paymentsFromEnv({ STRIPE_SECRET_KEY: 'sk_test_secret', PRICES_AUD: '49,slides=149' }).pay!;
const order = { address: '150 George Street, Parramatta', sheet: 'slides', scale: 8000, rotate: 'north', template: '' };

const realFetch = globalThis.fetch;
let seen: { url: string; init: RequestInit } | null = null;
const answer = (status: number, body: unknown) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
};

answer(200, { id: 'cs_test_abc123def456', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123def456' });
const s = await createCheckout(pay, order, 'Site report', 'https://site-analyst.com');
const sent = new URLSearchParams(String(seen!.init.body));
check('the session is created by POST to Checkout', seen!.url === 'https://api.stripe.com/v1/checkout/sessions' && seen!.init.method === 'POST');
check('the secret key goes as a bearer token', (seen!.init.headers as Record<string, string>).Authorization === 'Bearer sk_test_secret');
check('one drawing at its own price, in AUD',
  sent.get('line_items[0][price_data][unit_amount]') === '14900' &&
  sent.get('line_items[0][price_data][currency]') === 'aud' &&
  sent.get('line_items[0][quantity]') === '1');
check('the address is on the line', sent.get('line_items[0][price_data][product_data][description]') === order.address);
check('the order rides in the metadata', sent.get('metadata[app]') === 'site-analyst' &&
  sent.get('metadata[address]') === order.address && sent.get('metadata[sheet]') === 'slides' && sent.get('metadata[scale]') === '8000');
check('the ways to pay are left to the dashboard', ![...sent.keys()].some((k) => k.startsWith('payment_method_types')));
check('Stripe is asked to fill in the session id on the way back',
  sent.get('success_url') === 'https://site-analyst.com/?paid={CHECKOUT_SESSION_ID}');
check('the payer is sent to Stripe\'s page', s.url.startsWith('https://checkout.stripe.com/'));

const meta = { app: 'site-analyst', address: order.address, sheet: 'slides', scale: '8000', rotate: 'north', template: '' };
answer(200, { id: 'cs_test_abc123def456', payment_status: 'paid', created: 1_700_000_000, metadata: meta });
const p = await paidOrder(pay, 'cs_test_abc123def456');
check('a paid session reads as paid', p.paid && p.order?.address === order.address && p.order?.scale === 8000);
check('the session is asked for by its id', seen!.url === 'https://api.stripe.com/v1/checkout/sessions/cs_test_abc123def456');
check('when it was opened, in ms', p.createdAt === 1_700_000_000_000);

answer(200, { id: 'cs_test_abc123def456', payment_status: 'unpaid', created: 1, metadata: meta });
check('an unpaid session is not paid', !(await paidOrder(pay, 'cs_test_abc123def456')).paid);

answer(200, { id: 'cs_test_abc123def456', payment_status: 'paid', created: 1, metadata: { foo: 'bar' } });
check('another product\'s session orders nothing here', (await paidOrder(pay, 'cs_test_abc123def456')).order === null);

answer(404, { error: { message: 'No such checkout.session' } });
const missing = await paidOrder(pay, 'cs_test_nope0000000').catch((e) => e);
check('an unknown session is Stripe\'s 404', missing instanceof StripeError && missing.status === 404);

globalThis.fetch = realFetch;

// ---- the webhook ---------------------------------------------------------

const whsec = 'whsec_madeup';
const now = 1_700_000_000_000;
const sign = (body: string, t = now / 1000, secret = whsec) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const event = (type: string, status: string, metadata: unknown = meta) => JSON.stringify({
  type, data: { object: { id: 'cs_test_abc123def456', payment_status: status, metadata } },
});

const paid = event('checkout.session.completed', 'paid');
const got = webhookPayment(Buffer.from(paid), sign(paid), whsec, now);
check('a signed, paid session is drawn for', got.ok && got.session === 'cs_test_abc123def456' && got.order?.sheet === 'slides');
check('a second v1 among the signatures still counts',
  webhookPayment(Buffer.from(paid), `${sign(paid)},v1=${'0'.repeat(64)}`, whsec, now).ok);
check('the wrong secret is refused', !webhookPayment(Buffer.from(paid), sign(paid, now / 1000, 'whsec_other'), whsec, now).ok);
check('a changed body is refused', !webhookPayment(Buffer.from(paid.replace('8000', '4000')), sign(paid), whsec, now).ok);
check('a delivery six minutes old is refused', !webhookPayment(Buffer.from(paid), sign(paid, now / 1000 - 360), whsec, now).ok);
check('no signature is refused', !webhookPayment(Buffer.from(paid), '', whsec, now).ok);
check('no secret configured refuses everything', !webhookPayment(Buffer.from(paid), sign(paid), '', now).ok);

const unpaid = event('checkout.session.completed', 'unpaid');
const u = webhookPayment(Buffer.from(unpaid), sign(unpaid), whsec, now);
check('a session completed but not paid is acknowledged, not drawn', u.ok && !u.session);
const later = event('checkout.session.async_payment_succeeded', 'paid');
check('a payment that clears later is drawn for', webhookPayment(Buffer.from(later), sign(later), whsec, now).ok &&
  (webhookPayment(Buffer.from(later), sign(later), whsec, now) as { session?: string }).session === 'cs_test_abc123def456');
const other = event('checkout.session.completed', 'paid', { foo: 'bar' });
const o = webhookPayment(Buffer.from(other), sign(other), whsec, now);
check('another product\'s payment is acknowledged, not drawn', o.ok && !o.session);
const expired = event('checkout.session.expired', 'unpaid');
check('other events are acknowledged, not drawn', (() => { const e = webhookPayment(Buffer.from(expired), sign(expired), whsec, now); return e.ok && !e.session; })());

if (fails.length) {
  console.error('FAIL: ' + fails.join('; '));
  process.exit(1);
}
console.log('  ok — prices, the Checkout session, a session read back and the webhook\'s signature');
