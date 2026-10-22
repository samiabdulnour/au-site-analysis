// Email: the two messages this server sends — the verification link a sign-up
// is asked to click, and the password-reset link an account asks for. Sent
// through Resend's REST API with plain fetch, like Stripe (src/billing.ts):
// no SDK, no SMTP, two settings from the environment:
//
//   RESEND_API_KEY   re_… — from resend.com, with the sending domain verified
//   EMAIL_FROM       Site Analyst <no-reply@site-analyst.com>
//
// With either unset nothing is sent and both features switch themselves off:
// a new account counts as verified, since there is no link to click, and the
// reset form says this server cannot email one. The free side never needed
// email to work and still does not.

import { VERIFY_DAYS, RESET_MINUTES } from './accounts.js';

const KEY = process.env.RESEND_API_KEY?.trim() ?? '';
const FROM = process.env.EMAIL_FROM?.trim() ?? '';
// Where the API lives. Settable only so the tests can stand a server of their
// own in Resend's place; production leaves it alone.
const API = process.env.EMAIL_API_URL?.trim() || 'https://api.resend.com/emails';

export const emailEnabled = Boolean(KEY && FROM);

async function send(to: string, subject: string, text: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    // Told apart from the service refusing something: here it never answered.
    throw new Error(`no answer from the email service (${e?.cause?.code ?? e?.message ?? e})`);
  }
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `the email service answered ${res.status}`);
  }
}

// Plain text, both of them: each is one line of purpose and one link, and a
// link in plain text is one a cautious reader can see the address of.

export function sendVerification(to: string, origin: string, token: string): Promise<void> {
  return send(to, 'Verify your email — Site Analyst',
`Click to verify this address for your Site Analyst account:

${origin}/api/verify?token=${token}

The link works for ${VERIFY_DAYS} days. If you did not make this account,
ignore this email and the account stays unverified.
`);
}

export function sendReset(to: string, origin: string, token: string): Promise<void> {
  return send(to, 'Reset your password — Site Analyst',
`Someone asked to reset the password of the Site Analyst account on this
address. Click to choose a new one:

${origin}/?reset=${token}

The link works once, within ${RESET_MINUTES} minutes. If it was not you,
ignore this email and your password stays as it is.
`);
}
