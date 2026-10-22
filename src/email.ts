// Email: the two messages this server sends — the verification link a sign-up
// is asked to click, and the password-reset link an account asks for. Two ways
// to send them, chosen by which settings are present:
//
//   SMTP, through a mailbox of your own (Namecheap Private Email, say):
//     SMTP_HOST    mail.privateemail.com
//     SMTP_PORT    465 for SSL (the default), or 587 for STARTTLS
//     SMTP_USER    the mailbox's full address
//     SMTP_PASS    the mailbox's password
//
//   Resend's REST API, with plain fetch like Stripe (src/billing.ts):
//     RESEND_API_KEY   re_… — from resend.com, with the sending domain verified
//
// and either way
//
//   EMAIL_FROM   Site Analyst <no-reply@site-analyst.com> — for SMTP, the
//                mailbox itself or one of its aliases: a mail server refuses,
//                or marks as spam, mail "from" an address it does not hold.
//
// SMTP wins when SMTP_HOST is set. With neither way complete nothing is sent
// and both features switch themselves off: a new account counts as verified,
// since there is no link to click, and the reset form says this server cannot
// email one. The free side never needed email to work and still does not.

import { createTransport, type Transporter } from 'nodemailer';
import { VERIFY_DAYS, RESET_MINUTES, SIGNUP_HOURS } from './accounts.js';

const KEY = process.env.RESEND_API_KEY?.trim() ?? '';
const FROM = process.env.EMAIL_FROM?.trim() ?? '';
// Where the API lives. Settable only so the tests can stand a server of their
// own in Resend's place; production leaves it alone.
const API = process.env.EMAIL_API_URL?.trim() || 'https://api.resend.com/emails';

const SMTP_HOST = process.env.SMTP_HOST?.trim() ?? '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER?.trim() ?? '';
// Not trimmed: a password may end in a space.
const SMTP_PASS = process.env.SMTP_PASS ?? '';

/** How mail goes out here, for the log at start: 'smtp', 'resend' or 'off'. */
export const emailVia: 'smtp' | 'resend' | 'off' = !FROM ? 'off'
  : SMTP_HOST ? (SMTP_USER && SMTP_PASS ? 'smtp' : 'off')
  : KEY ? 'resend' : 'off';
export const emailEnabled = emailVia !== 'off';

let transport: Transporter | undefined;

function smtp(): Transporter {
  // Port 465 is TLS from the first byte; any other port must upgrade with
  // STARTTLS before the password is sent, except to this machine itself,
  // where there is no wire to read it from.
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|::1)$/.test(SMTP_HOST);
  return transport ??= createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT !== 465 && !loopback,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000,
  });
}

// ---- how much may go out ------------------------------------------------------
//
// Every email here goes to an address somebody typed into a form, so without a
// ceiling the forms are a way to mail strangers from this mailbox — and a
// mailbox that does that gets suspended by its host and its domain filed as
// spam, which takes the real links down with it. Per recipient, so one inbox
// cannot be flooded; and in all, so many inboxes cannot be either. Held in
// memory: a restart forgets them, but a visitor cannot make one happen.
//
// The links (sign-up, verification, reset) and the "you already have an
// account" note are counted apart: anyone can make the note go to an address
// by signing up with it, and if notes spent the links' allowance, a stranger
// could stop an owner's own reset email from being sent.

const LIMITS = {
  link: { hour: 3, day: 10 },
  note: { hour: 1, day: 3 },
} as const;
type Kind = keyof typeof LIMITS;
const PER_HOUR = Number(process.env.EMAIL_MAX_PER_HOUR) || 100;

const sentTo = new Map<string, number[]>();
let sentAll: number[] = [];
let warnedAt = 0;

/** Refused for the cap rather than by the mail server: said apart, so a form can say "try later". */
export class EmailCapped extends Error {}

function spendAllowance(to: string, kind: Kind) {
  const now = Date.now(), hour = now - 3600_000, day = now - 86400_000;
  const key = `${kind}:${to}`, cap = LIMITS[kind];
  sentAll = sentAll.filter((t) => t > hour);
  for (const [k, ts] of sentTo) {
    const kept = ts.filter((t) => t > day);
    if (kept.length) sentTo.set(k, kept); else sentTo.delete(k);
  }
  const mine = sentTo.get(key) ?? [];
  if (mine.filter((t) => t > hour).length >= cap.hour || mine.length >= cap.day)
    throw new EmailCapped(`${to} has had its ${kind === 'note' ? 'notes' : 'links'} for now`);
  if (sentAll.length >= PER_HOUR) {
    // Once an hour in the log, not once a refusal: a flood would bury it.
    if (now - warnedAt > 3600_000) {
      warnedAt = now;
      console.log(`email: WARNING — ${PER_HOUR} emails in the last hour, the cap; holding the rest (EMAIL_MAX_PER_HOUR)`);
    }
    throw new EmailCapped('the hourly cap is reached');
  }
  mine.push(now);
  sentTo.set(key, mine);
  sentAll.push(now);
}

async function send(to: string, subject: string, text: string, kind: Kind = 'link'): Promise<void> {
  spendAllowance(to.toLowerCase(), kind);
  if (emailVia === 'smtp') {
    try {
      await smtp().sendMail({ from: FROM, to, subject, text });
    } catch (e: any) {
      // Nodemailer's words carry the server's reply ("535 Authentication
      // failed") or the connection's ("ETIMEDOUT"), which is what the log needs.
      throw new Error(`the mail server: ${e?.message ?? e}`);
    }
    return;
  }
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

// Plain text, all of them: each is one line of purpose and one link, and a
// link in plain text is one a cautious reader can see the address of.

// The link opens the page, which asks for a press before anything happens:
// mail scanners open every link in a message, and one that made the account
// on being opened would spend itself before its owner ever clicked.
export function sendSignupLink(to: string, origin: string, token: string): Promise<void> {
  return send(to, 'Finish signing up — Site Analyst',
`Click to finish making your Site Analyst account:

${origin}/?confirm=${token}

The link works once, within ${SIGNUP_HOURS} hours. If you did not sign up,
ignore this email and no account is made.
`);
}

// What a sign-up for an address that already has an account is sent instead
// of a link, so the form can answer every sign-up alike and not say which
// addresses have accounts.
export function sendAlreadyRegistered(to: string, origin: string): Promise<void> {
  return send(to, 'You already have an account — Site Analyst',
`Someone, perhaps you, tried to sign up to Site Analyst with this address,
but it already has an account. Sign in at

${origin}/?signin

and if the password is forgotten, choose "reset" there to email a new one.
If it was not you, ignore this email: nothing has changed.
`, 'note');
}

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
