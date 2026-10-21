// The two sides of the site, and what each one is given.
//
// Free: every drawing, generated the same way, with its PDF served with the
// watermark stamped on every page. Subscription: the PDF as drawn, and the
// open formats beside it — the CAD package (DXF, and DWG where the converter is
// installed), the yield's CSV and the deck's JSON.
//
// The drawing itself is identical on both sides: one job, one PDF on disk, and
// the watermark is applied when a free account downloads it. So a sheet drawn
// for a free account is reused, clean, by a subscriber who asks for the same
// address, and the reverse — nothing is ever drawn twice to serve two plans.
//
// Every route that decides what a visitor may download reads this table, so a
// new privilege is a new column here rather than a new condition scattered
// through the server.

export type Plan = 'free' | 'subscription';

export interface Grants {
  /** The PDF as drawn. Without it the PDF is served watermarked. */
  cleanPdf: boolean;
  /** The CAD package and the data files (CSV, JSON). */
  openData: boolean;
}

export const GRANTS: Record<Plan, Grants> = {
  free:         { cleanPdf: false, openData: false },
  subscription: { cleanPdf: true,  openData: true },
};

/**
 * The Stripe subscription states that are paid for. `past_due` is not one:
 * Stripe keeps retrying the card for a while, and the account goes back to
 * free until a payment lands — the webhook flips it back the moment one does.
 */
const PAID = new Set(['active', 'trialing']);
export const paidFor = (status: string | undefined) => PAID.has(status ?? '');

/**
 * Accounts given the subscription without paying for it: the office's own, a
 * client being shown the tool, the operator checking what subscribers see
 * before billing is switched on. Comma-separated emails.
 */
const COMPLIMENTARY = new Set(
  (process.env.SUBSCRIPTION_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
);

export function planOf(a: { email: string; subscriptionStatus?: string }): Plan {
  return COMPLIMENTARY.has(a.email) || paidFor(a.subscriptionStatus) ? 'subscription' : 'free';
}

/** What the pricing page says the subscription costs, e.g. "A$49 a month". */
export const PRICE_LABEL = process.env.PRICE_LABEL?.trim() || 'monthly';
