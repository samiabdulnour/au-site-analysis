// Pay per drawing, through Stripe's hosted Checkout. No SDK: two calls to
// Stripe's REST API and the webhook's signature check, over fetch and
// node:crypto — the server has no other dependency of this kind, and three
// endpoints are not a reason to take one on.
//
// The flow: the visitor picks an address and a drawing, the server opens a
// Checkout session with that order in its metadata, Stripe takes the payment
// and sends the visitor back with the session id. The server asks Stripe
// whether that session is paid before it draws anything. The webhook does the
// same on Stripe's say-so, for a visitor who paid and closed the tab before the
// redirect.

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';

export type Kind = 'context' | 'site' | 'summary' | 'yield' | 'slides';
const KINDS: Kind[] = ['context', 'site', 'summary', 'yield', 'slides'];

/** What a payment buys: one drawing, with every option that changes it. */
export interface Order {
  address: string;
  sheet: string;
  scale: number;
  rotate: string;
  template: string;
}

export interface Payments {
  secret: string;
  webhookSecret: string;
  live: boolean;
  /** Cents, by drawing. */
  prices: Record<Kind, number>;
}

/** Stripe refuses an AUD charge under fifty cents. */
const MIN_CENTS = 50;

/**
 * The prices, from PRICES_AUD: a bare amount for every drawing, and
 * `kind=amount` for any drawing priced apart from it — `49,slides=149`.
 * Null, with the reason, when a drawing is left without a price: a drawing
 * that cannot be priced cannot be sold, and guessing a price is worse.
 */
export function parsePrices(spec: string): { prices: Record<Kind, number> } | { error: string } {
  let all: number | undefined;
  const each: Partial<Record<Kind, number>> = {};
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(?:([a-z]+)\s*=\s*)?(\d+(?:\.\d{1,2})?)$/);
    if (!m) return { error: `cannot read "${part}"` };
    const cents = Math.round(Number(m[2]) * 100);
    if (cents < MIN_CENTS) return { error: `"${part}" is under Stripe's A$0.50 minimum` };
    if (!m[1]) { all = cents; continue; }
    if (!KINDS.includes(m[1] as Kind)) return { error: `no drawing called "${m[1]}"` };
    each[m[1] as Kind] = cents;
  }
  const prices = {} as Record<Kind, number>;
  for (const k of KINDS) {
    const p = each[k] ?? all;
    if (p === undefined) return { error: `no price for ${k}` };
    prices[k] = p;
  }
  return { prices };
}

/** Payments are on when there is a key and every drawing has a price. */
export function paymentsFromEnv(env: NodeJS.ProcessEnv): { pay: Payments | null; note: string } {
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? '';
  if (!secret) return { pay: null, note: 'payments off (no STRIPE_SECRET_KEY)' };
  const parsed = parsePrices(env.PRICES_AUD ?? '');
  if ('error' in parsed) return { pay: null, note: `payments off — PRICES_AUD: ${parsed.error}` };
  const live = /^[sr]k_live_/.test(secret);
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  const list = KINDS.map((k) => `${k} ${(parsed.prices[k] / 100).toFixed(2)}`).join(', ');
  return {
    pay: { secret, webhookSecret, live, prices: parsed.prices },
    note: `payments on (${live ? 'LIVE' : 'test'} mode), AUD ${list}` +
      (webhookSecret ? '' : ' — no STRIPE_WEBHOOK_SECRET, so a payer who closes the tab before the redirect is drawn for only when they come back'),
  };
}

/** Stripe's form encoding: nested keys in brackets, `a[b][c]=v`. */
export function form(obj: Record<string, unknown>, prefix = ''): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${key}[${i}]`));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, key ? `${key}[${k}]` : k);
    else out.append(key, String(v));
  };
  walk(obj, prefix);
  return out;
}

/** Stripe's refusal, with its status: a 404 is an unknown session, not an outage. */
export class StripeError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function stripe(secret: string, method: 'GET' | 'POST', path: string, body?: URLSearchParams): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(res.status, `Stripe ${res.status}: ${j?.error?.message ?? 'no message'}`);
  return j;
}

/** The session ids Stripe issues; anything else never reaches its URL path. */
export const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/;

/** Marks the sessions this server opened, so another product's are left alone. */
const APP = 'site-analyst';

export async function createCheckout(
  pay: Payments, order: Order, label: string, base: string,
): Promise<{ id: string; url: string }> {
  const s = await stripe(pay.secret, 'POST', '/checkout/sessions', form({
    // Which ways to pay are offered is set in Stripe's dashboard, not here —
    // its API no longer takes a list. Cards and wallets clear at once; a bank
    // debit left on there clears days later, and is drawn for by the webhook.
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'aud',
        unit_amount: pay.prices[order.sheet as Kind],
        product_data: { name: label, description: order.address },
      },
    }],
    metadata: { app: APP, ...order },
    payment_intent_data: { description: `${label} — ${order.address}` },
    // Stripe fills in {CHECKOUT_SESSION_ID}; the page takes it from there.
    success_url: `${base}/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?cancelled=1`,
  }));
  return { id: s.id, url: s.url };
}

/** The order a session paid for, read back from the metadata this server wrote. */
function orderOf(s: any): Order | null {
  const m = s?.metadata;
  if (!m || m.app !== APP || typeof m.address !== 'string') return null;
  return {
    address: m.address, sheet: String(m.sheet ?? ''), scale: Number(m.scale) || 0,
    rotate: String(m.rotate ?? ''), template: String(m.template ?? ''),
  };
}

/** Whether the session is paid, for what, and when it was opened. Asked of Stripe, never taken from the visitor. */
export async function paidOrder(
  pay: Payments, id: string,
): Promise<{ paid: boolean; order: Order | null; createdAt: number }> {
  const s = await stripe(pay.secret, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`);
  return { paid: s.payment_status === 'paid', order: orderOf(s), createdAt: Number(s.created) * 1000 || 0 };
}

/**
 * The session a webhook delivery says was paid, or null for anything else.
 * The signature is Stripe's scheme: HMAC-SHA256 over `timestamp.body` with the
 * endpoint's signing secret, a delivery older than five minutes refused so a
 * captured one cannot be replayed.
 */
export function webhookPayment(
  raw: Buffer, header: string, secret: string, now = Date.now(),
): { ok: false } | { ok: true; session?: string; order?: Order } {
  if (!secret) return { ok: false };
  const parts = header.split(',').map((p) => p.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(t) || !sigs.length || Math.abs(now / 1000 - t) > 300) return { ok: false };
  const want = Buffer.from(createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex'));
  if (!sigs.some((s) => s.length === want.length && timingSafeEqual(Buffer.from(s), want))) return { ok: false };

  let event: any;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return { ok: false }; }
  const s = event?.data?.object;
  const paidNow = event?.type === 'checkout.session.completed' || event?.type === 'checkout.session.async_payment_succeeded';
  if (!paidNow || s?.payment_status !== 'paid' || !SESSION_ID.test(String(s?.id))) return { ok: true };
  const order = orderOf(s);
  return order ? { ok: true, session: s.id, order } : { ok: true };
}
