/* The operator view's Stripe check, on made-up answers from Stripe.
 *
 * Stripe is stood in for by a fetch that answers the four questions the check
 * asks: the account, the price, the webhook endpoints and the portal. Once with
 * everything right, and once with the mistakes the check exists for: a live
 * key on an account not yet activated, a price from the other mode, a webhook
 * missing an event, a portal never saved, a recurring price sold as one site,
 * and a secret that is not the endpoint's. CI never calls Stripe.
 *
 *   npx tsx test/billing-check.mts
 */

type Answers = Record<string, { status: number; body: unknown }>;

/** A Stripe that answers by path, and a module loaded fresh against it. */
async function against(key: string, answers: Answers, run: number) {
  process.env.STRIPE_SECRET_KEY = key;
  process.env.STRIPE_PRICE_ID = 'price_test';
  process.env.STRIPE_SITE_PRICE_ID = 'price_site';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  globalThis.fetch = (async (input: string | URL) => {
    const path = String(input).replace('https://api.stripe.com/v1/', '');
    const a = answers[path] ?? { status: 404, body: { error: { message: `nothing at ${path}` } } };
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  // A fresh copy each run: the settings are read when the module loads, and
  // the check keeps its answer for five minutes.
  return import(`../src/billing.ts?run=${run}`);
}

const good: Answers = {
  account: { status: 200, body: { id: 'acct_1', settings: { dashboard: { display_name: 'Site Analyst' } }, charges_enabled: true } },
  'prices/price_test': { status: 200, body: { active: true, unit_amount: 4900, currency: 'aud', recurring: { interval: 'month', interval_count: 1 } } },
  'prices/price_site': { status: 200, body: { active: true, unit_amount: 7900, currency: 'aud', recurring: null } },
  'webhook_endpoints?limit=100': { status: 200, body: { data: [{
    url: 'https://site-analyst.com/api/billing/webhook', status: 'enabled',
    enabled_events: ['checkout.session.completed', 'customer.subscription.created',
                     'customer.subscription.updated', 'customer.subscription.deleted'],
  }] } },
  'billing_portal/configurations?is_default=true&limit=1': { status: 200, body: { data: [{ active: true }] } },
};

const broken: Answers = {
  account: { status: 200, body: { id: 'acct_2', business_profile: { name: 'Site Analyst' }, charges_enabled: false } },
  'prices/price_test': { status: 404, body: { error: { message: "No such price: 'price_test'" } } },
  'prices/price_site': { status: 200, body: { active: true, unit_amount: 7900, currency: 'aud', recurring: { interval: 'month' } } },
  'webhook_endpoints?limit=100': { status: 200, body: { data: [{
    url: 'https://site-analyst.com/api/billing/webhook', status: 'enabled',
    enabled_events: ['checkout.session.completed', 'customer.subscription.updated'],
  }] } },
  'billing_portal/configurations?is_default=true&limit=1': { status: 200, body: { data: [] } },
};

let failures = 0;
function expect(label: string, ok: boolean, rows: unknown) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) { failures += 1; console.log(`       ${JSON.stringify(rows)}`); }
}
const row = (rows: [string, string, boolean][], k: string) => rows.find((r) => r[0] === k);

{
  const b = await against('sk_test_x', good, 1);
  const rows = await b.checkBilling();
  expect('right: every line passes', rows.every((r: any) => r[2]), rows);
  expect('right: names the account and its mode', row(rows, 'stripe account')?.[1] === 'Site Analyst · test mode', rows);
  expect('right: reads the subscription price', row(rows, 'subscription price')?.[1] === '49.00 AUD every month', rows);
  expect('right: reads the site price', row(rows, 'site price')?.[1] === '79.00 AUD once', rows);
  expect('right: nothing received yet is not a failure', row(rows, 'webhook secret')?.[2] === true, rows);

  // A signed event proves the secret; a refused one after it says it changed.
  b.webhookSeen.accepted = { at: Date.now(), type: 'customer.subscription.updated' };
  expect('an event received proves the secret', /^matches/.test(row(await b.checkBilling(), 'webhook secret')![1]), rows);
  b.webhookSeen.refused = Date.now() + 1;
  expect('a refused event after it is a failure', row(await b.checkBilling(), 'webhook secret')?.[2] === false, rows);
}

{
  const b = await against('sk_live_x', broken, 2);
  const rows = await b.checkBilling();
  expect('broken: a live account not activated', row(rows, 'stripe account')?.[2] === false, rows);
  expect('broken: a price from the other mode, said so',
    row(rows, 'subscription price')?.[2] === false && /test-mode price/.test(row(rows, 'subscription price')![1]), rows);
  expect('broken: a recurring price sold as one site',
    row(rows, 'site price')?.[2] === false && /one site needs a one-off price/.test(row(rows, 'site price')![1]), rows);
  expect('broken: the missing webhook event, named',
    row(rows, 'webhook endpoint')?.[2] === false && /customer\.subscription\.deleted/.test(row(rows, 'webhook endpoint')![1])
      && !/customer\.subscription\.updated/.test(row(rows, 'webhook endpoint')![1]), rows);
  expect('broken: the portal never saved', row(rows, 'customer portal')?.[2] === false, rows);
}

{
  delete process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = '';
  const b = await import('../src/billing.ts?run=3');
  expect('no keys: neither way to pay is open', !b.subscriptionsOpen && !b.sitesOpen, []);
  const rows = await b.checkBilling();
  expect('no keys: billing is off, and that is not a failure', rows.length === 1 && rows[0][2] === true, rows);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
