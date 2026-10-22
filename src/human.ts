// The human check on the forms a bot would fill: Cloudflare Turnstile, which
// asks most people nothing at all and the rest to tick a box. The page renders
// the widget with the site key and sends back the token it hands over; this
// asks Cloudflare whether the token is good. Plain fetch, like Stripe and
// Resend. Two settings, from the Turnstile page of a Cloudflare account:
//
//   TURNSTILE_SITE_KEY     0x4AAA… — public: it goes to the page as it is
//   TURNSTILE_SECRET_KEY   0x4AAA… — this server's alone
//
// With either unset there is no check and every form works as before; what
// holds the forms down then is the per-IP limits and the email caps alone.

const SITE_KEY = process.env.TURNSTILE_SITE_KEY?.trim() ?? '';
const SECRET = process.env.TURNSTILE_SECRET_KEY?.trim() ?? '';
// Settable only so the tests can stand a server of their own in Cloudflare's
// place; production leaves it alone.
const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL?.trim()
  || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The key the page renders the widget with, or null when there is no check here. */
export const humanCheckKey: string | null = SITE_KEY && SECRET ? SITE_KEY : null;

/**
 * Whether the page's token says a person filled the form. True when there is
 * no check here. Cloudflare not answering counts as no: a check that opens
 * when it cannot be asked is one a bot only has to wait out.
 */
export async function isHuman(token: unknown, ip: string): Promise<boolean> {
  if (!humanCheckKey) return true;
  const response = String(token ?? '');
  if (!response || response.length > 2048) return false;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: SECRET, response, remoteip: ip }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`human check: Cloudflare answered ${res.status}`);
      return false;
    }
    const body: any = await res.json().catch(() => ({}));
    return body?.success === true;
  } catch (e: any) {
    console.log(`human check: no answer from Cloudflare (${e?.cause?.code ?? e?.message ?? e})`);
    return false;
  }
}
