// Billing: the subscription is sold through Stripe Checkout and managed in
// Stripe's customer portal, so no card number ever reaches this server — it
// sends the visitor to Stripe and is told by webhook what happened there.
//
// Plain fetch against Stripe's REST API rather than its SDK, like every other
// service this server talks to. The settings, all from the environment:
//
//   STRIPE_SECRET_KEY      sk_live_… (sk_test_… while trying it out)
//   STRIPE_PRICE_ID        price_… — the recurring price the subscription sells
//   STRIPE_SITE_PRICE_ID   price_… — the one-time price one site sells for
//   STRIPE_WEBHOOK_SECRET  whsec_… — from the webhook endpoint pointed at
//                          https://<domain>/api/billing/webhook
//
// Each price opens its own way to pay, so either can be sold without the
// other. With neither, the pricing page says payments are not open yet and
// nothing here is called; the free side works regardless.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { accountById, accountByCustomer, updateAccount, unlockSite, type Account } from './accounts.js';
import { paidFor } from './plans.js';

const KEY = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
const PRICE = process.env.STRIPE_PRICE_ID?.trim() ?? '';
const SITE_PRICE = process.env.STRIPE_SITE_PRICE_ID?.trim() ?? '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';

/** Can a visitor subscribe here? */
export const subscriptionsOpen = Boolean(KEY && PRICE);
/** Can a visitor buy one site here? */
export const sitesOpen = Boolean(KEY && SITE_PRICE);
/** Is Stripe in use at all? */
export const billingEnabled = subscriptionsOpen || sitesOpen;
export const webhookEnabled = Boolean(WEBHOOK_SECRET);

async function stripe(path: string, params?: Record<string, string>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: params ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${KEY}`,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: params ? new URLSearchParams(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    // Told apart from Stripe refusing something: here it never answered.
    throw new Error(`no answer from Stripe (${e?.cause?.code ?? e?.message ?? e})`);
  }
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

/**
 * A Checkout page for one site: a single card payment, after which the webhook
 * unlocks the address for the account. The address rides in the metadata, as
 * the job had it, and on the payment's description, so the receipt says which
 * site it paid for — the line an office passes on to its client.
 */
export async function siteCheckoutUrl(a: Account, address: string, jobId: string, origin: string): Promise<string> {
  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price]': SITE_PRICE,
    'line_items[0][quantity]': '1',
    // Cards (and the wallets that carry them) settle at once. A debit that
    // settles days later would need another webhook event to unlock on.
    'payment_method_types[0]': 'card',
    // Back to the same drawing, which the page picks up and offers again clean.
    success_url: `${origin}/?job=${jobId}&paid=1`,
    cancel_url: `${origin}/?job=${jobId}`,
    client_reference_id: a.id,
    'metadata[account_id]': a.id,
    'metadata[kind]': 'site',
    'metadata[address]': address,
    'payment_intent_data[description]': `Site Analyst: ${address}`,
  };
  if (a.stripeCustomerId) params.customer = a.stripeCustomerId;
  else {
    params.customer_email = a.email;
    // So the account has a customer, as a subscriber's does, and its next
    // purchase keeps the card and the receipts in one place.
    params.customer_creation = 'always';
  }
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

// ---- checking the setup ------------------------------------------------------
//
// The keys live on the host, where nobody can see them from here, and most of
// what can be wrong with them is quiet: a test key with a live price fails only
// when someone tries to pay, and a webhook missing an event takes the money
// without ever granting the subscription. So the operator view asks Stripe what
// it has, and says what it found, a line each.

export type CheckRow = [label: string, finding: string, ok: boolean];

const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
];

/**
 * The last event that arrived signed, and the last one refused. Stripe never
 * hands the signing secret back, so an event arriving is the only proof that
 * STRIPE_WEBHOOK_SECRET is the endpoint's.
 */
export const webhookSeen: { accepted?: { at: number; type: string }; refused?: number } = {};

const minutesAgo = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m === 1 ? 'a minute ago' : `${m} minutes ago`;
};

function webhookRow(): CheckRow {
  const { accepted, refused } = webhookSeen;
  if (!webhookEnabled) return ['webhook secret', 'not set: payments will not reach the accounts', false];
  if (refused && (!accepted || refused > accepted.at))
    return ['webhook secret', `an event was refused ${minutesAgo(refused)}: the secret is not this endpoint's`, false];
  if (accepted) return ['webhook secret', `matches: ${accepted.type} received ${minutesAgo(accepted.at)}`, true];
  return ['webhook secret', "set; nothing received yet — send a test event from the endpoint's page in Stripe", true];
}

let checked: { at: number; rows: CheckRow[] } | undefined;

/** What Stripe says about this server's settings. Asked at most every five minutes. */
export async function checkBilling(): Promise<CheckRow[]> {
  if (!billingEnabled)
    return [['billing', 'off — no STRIPE_SECRET_KEY, or neither STRIPE_PRICE_ID nor STRIPE_SITE_PRICE_ID', true]];
  if (checked && Date.now() - checked.at < 5 * 60_000) return [...checked.rows, webhookRow()];
  const live = /^(sk|rk)_live_/.test(KEY);
  type Answer = { v: any } | { e: Error };
  const ask = (path: string): Promise<Answer> => stripe(path).then((v) => ({ v }), (e: Error) => ({ e }));
  const none: Answer = { v: null };
  const [account, price, sitePrice, hooks, portal] = await Promise.all([
    ask('account'),
    PRICE ? ask(`prices/${encodeURIComponent(PRICE)}`) : none,
    SITE_PRICE ? ask(`prices/${encodeURIComponent(SITE_PRICE)}`) : none,
    ask('webhook_endpoints?limit=100'),
    ask('billing_portal/configurations?is_default=true&limit=1'),
  ]);
  const rows: CheckRow[] = [];

  /** A price, and whether it is the kind its way of paying needs. */
  const priceRow = (label: string, id: string, answer: Answer, recurring: boolean) => {
    if ('e' in answer) {
      rows.push([label, `${id}: ${answer.e.message}` +
        (/no such price/i.test(answer.e.message) ? ` — is it a ${live ? 'test' : 'live'}-mode price?` : ''), false]);
      return;
    }
    const p = answer.v;
    const amount = p.unit_amount == null ? 'no fixed amount'
      : `${(p.unit_amount / 100).toFixed(2)} ${String(p.currency).toUpperCase()}`;
    const n = p.recurring?.interval_count ?? 1;
    const every = p.recurring ? ` every ${n > 1 ? `${n} ${p.recurring.interval}s` : p.recurring.interval}` : ' once';
    const right = Boolean(p.recurring) === recurring;
    rows.push([label, amount + every + (p.active ? '' : ' · archived') +
      (right ? '' : recurring ? ' · one-off: a subscription needs a recurring price'
                              : ' · recurring: one site needs a one-off price'), Boolean(p.active) && right]);
  };

  if ('e' in account) {
    rows.push(['stripe account', account.e.message, false]);
  } else {
    const a = account.v;
    // The name is the thing to read: it says which of your Stripe accounts the key belongs to.
    const name = a.settings?.dashboard?.display_name || a.business_profile?.name || a.id;
    const ready = !live || Boolean(a.charges_enabled);
    rows.push(['stripe account', `${name} · ${live ? 'live' : 'test'} mode` +
      (ready ? '' : ' · cannot take payments until the account is activated'), ready]);
  }

  if (PRICE) priceRow('subscription price', PRICE, price, true);
  if (SITE_PRICE) priceRow('site price', SITE_PRICE, sitePrice, false);

  if ('e' in hooks) {
    rows.push(['webhook endpoint', hooks.e.message, false]);
  } else {
    const mine = (hooks.v.data ?? []).filter((h: any) => String(h.url).endsWith('/api/billing/webhook'));
    if (!mine.length) rows.push(['webhook endpoint', 'none points at /api/billing/webhook', false]);
    for (const h of mine) {
      const events: string[] = h.enabled_events ?? [];
      const missing = events.includes('*') ? [] : EVENTS.filter((e) => !events.includes(e));
      const on = h.status === 'enabled';
      rows.push(['webhook endpoint', String(h.url) + (on ? '' : ' · disabled') +
        (missing.length ? ` · missing ${missing.join(', ')}` : ''), on && !missing.length]);
    }
  }

  if ('e' in portal) {
    rows.push(['customer portal', portal.e.message, false]);
  } else {
    const saved = Boolean(portal.v.data?.[0]?.active);
    rows.push(['customer portal', saved ? 'saved' : 'not saved yet: Settings → Billing → Customer portal, then Save', saved]);
  }

  checked = { at: Date.now(), rows };
  return [...rows, webhookRow()];
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
      if (o.mode === 'payment') {
        if (o.metadata?.kind !== 'site' || !o.metadata?.address) return `ignored a payment by ${a.id} for no site`;
        if (o.payment_status !== 'paid') return `site payment by ${a.id} not settled yet`;
        if (idOf(o.customer)) updateAccount(a, { stripeCustomerId: idOf(o.customer) });
        return unlockSite(a, String(o.metadata.address), String(o.id))
          ? `${a.id} unlocked a site` : `${a.id}'s site payment was already counted`;
      }
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
