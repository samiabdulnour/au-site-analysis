// Billing: the subscription is sold through Stripe Checkout and managed in
// Stripe's customer portal, so no card number ever reaches this server — it
// sends the visitor to Stripe and is told by webhook what happened there.
//
// Plain fetch against Stripe's REST API rather than its SDK, like every other
// service this server talks to. Three settings, all from the environment:
//
//   STRIPE_SECRET_KEY      sk_live_… (sk_test_… while trying it out)
//   STRIPE_PRICE_ID        price_… — the recurring price the subscription sells
//   STRIPE_WEBHOOK_SECRET  whsec_… — from the webhook endpoint pointed at
//                          https://<domain>/api/billing/webhook
//
// Without the first two the pricing page says subscriptions are not open yet
// and nothing here is called; the free side works regardless.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { accountById, accountByCustomer, updateAccount, type Account } from './accounts.js';
import { paidFor } from './plans.js';

const KEY = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
const PRICE = process.env.STRIPE_PRICE_ID?.trim() ?? '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';

/** Can a visitor subscribe here at all? */
export const billingEnabled = Boolean(KEY && PRICE);
export const webhookEnabled = Boolean(WEBHOOK_SECRET);

async function stripe(path: string, params?: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe answered ${res.status}`);
  return body;
}

/**
 * A Checkout page for this account's subscription. The account's id rides on
 * the session and on the subscription it creates, so every event Stripe sends
 * about it afterwards can be matched to the account without trusting the email.
 */
export async function checkoutUrl(a: Account, origin: string): Promise<string> {
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': PRICE,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/pricing?subscribed=1`,
    cancel_url: `${origin}/pricing`,
    client_reference_id: a.id,
    'metadata[account_id]': a.id,
    'subscription_data[metadata][account_id]': a.id,
    allow_promotion_codes: 'true',
  };
  // An account that has paid before keeps its Stripe customer, so its invoices
  // and card stay in one place.
  if (a.stripeCustomerId) params.customer = a.stripeCustomerId;
  else params.customer_email = a.email;
  return String((await stripe('checkout/sessions', params)).url);
}

/** Stripe's own page for the card, the invoices and cancelling. */
export async function portalUrl(a: Account, origin: string): Promise<string> {
  return String((await stripe('billing_portal/sessions', {
    customer: a.stripeCustomerId ?? '',
    return_url: `${origin}/pricing`,
  })).url);
}

/**
 * Stripe signs each webhook with the endpoint's secret: `t=<unix>,v1=<hex>`,
 * an HMAC-SHA256 of `<t>.<raw body>`. Checked against the bytes as they
 * arrived — a body parsed and re-serialised would not match — and refused
 * outside five minutes, so a captured request cannot be replayed later.
 */
export function verifySignature(raw: Buffer, header: string, secret = WEBHOOK_SECRET, now = Date.now()): boolean {
  if (!secret) return false;
  const parts = header.split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
  });
  const t = parts.find(([k]) => k === 't')?.[1] ?? '';
  if (!/^\d{1,12}$/.test(t) || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const want = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return parts.some(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v)
    && timingSafeEqual(Buffer.from(v, 'hex'), want));
}

/** A Stripe reference is an id, or the object itself when it was expanded. */
const idOf = (v: any): string | undefined =>
  typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : undefined;

function applySubscription(a: Account, sub: any) {
  const id = idOf(sub);
  // A subscription that ended must not overwrite a newer one that is paid
  // for: Stripe does not promise to deliver events in order, and an account
  // that cancelled and subscribed again has both.
  if (a.subscriptionId && id !== a.subscriptionId && paidFor(a.subscriptionStatus) && !paidFor(sub.status)) return;
  // Newer API versions moved the period end from the subscription onto its items.
  const end = Number(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end) || 0;
  updateAccount(a, {
    subscriptionId: id ?? a.subscriptionId,
    subscriptionStatus: String(sub.status ?? ''),
    stripeCustomerId: idOf(sub.customer) ?? a.stripeCustomerId,
    currentPeriodEnd: end ? end * 1000 : undefined,
  });
}

/**
 * Bring an account up to date with what Stripe reports. Returns what was done,
 * for the log. With the key set, the subscription is read back from Stripe
 * rather than taken from the event, which may be older than one already
 * applied; without it (tests, or a webhook set up before the key) the event's
 * own copy is used.
 */
export async function handleEvent(event: any): Promise<string> {
  const o = event?.data?.object ?? {};
  switch (event?.type) {
    case 'checkout.session.completed': {
      const a = accountById(String(o.client_reference_id ?? o.metadata?.account_id ?? ''));
      if (!a) return 'checkout for no known account';
      updateAccount(a, {
        stripeCustomerId: idOf(o.customer) ?? a.stripeCustomerId,
        subscriptionId: idOf(o.subscription) ?? a.subscriptionId,
      });
      if (KEY && a.subscriptionId) applySubscription(a, await stripe(`subscriptions/${a.subscriptionId}`));
      return `checkout linked to ${a.id}`;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const customer = idOf(o.customer);
      const a = accountById(String(o.metadata?.account_id ?? ''))
        ?? (customer ? accountByCustomer(customer) : undefined);
      if (!a) return `${event.type} for no known account`;
      const sub = KEY && idOf(o) ? await stripe(`subscriptions/${idOf(o)}`) : o;
      applySubscription(a, sub);
      return `${a.id} is ${a.subscriptionStatus}`;
    }
    default:
      return `ignored ${String(event?.type)}`;
  }
}
