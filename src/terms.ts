// The terms of use: their version, which an account records when it is made
// (using the site is accepting them, as every footer says), and the one
// sentence said wherever money changes hands. The
// page itself is web/terms.html; change its "Version" line with TERMS_VERSION.

/** The date the current terms took effect; an account stores the version in force when it was made. */
export const TERMS_VERSION = '2026-10-22';

/** Said above Stripe Checkout's pay button, for a site and for the subscription alike; Stripe's page needs the address whole. */
export const paymentNotice = (origin: string) =>
  'Site Analyst draws only from open public data as it stands when a drawing is made. It does not guarantee that data is complete, current or correct, ' +
  `and a drawing is no substitute for a planning certificate, a survey or professional advice. Terms of use: ${origin}/terms`;
