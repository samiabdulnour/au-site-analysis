/* The plans page, and the account's place to subscribe and manage billing.

   It says which plan this browser is on and offers the one thing to do next:
   make an account, subscribe, or go to Stripe's billing page. The payment
   itself happens on Stripe's pages; this one only sends the visitor there. */

const $ = (id) => document.getElementById(id);
const mine = $('mine'), act = $('act'), err = $('error');

function link(label, href, primary) {
  const a = document.createElement('a');
  a.className = primary ? 'btn primary' : 'btn';
  a.href = href;
  a.textContent = label;
  act.append(a);
}

/** A button that asks the server for a Stripe page and goes there. */
function toStripe(label, path, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'btn primary' : 'btn';
  b.textContent = label;
  b.addEventListener('click', async () => {
    err.textContent = '';
    b.disabled = true;
    try {
      const r = await fetch(path, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) return location.assign(j.url);
      err.textContent = j.error || 'something went wrong — try again';
    } catch {
      err.textContent = 'no answer from the server — try again';
    }
    b.disabled = false;
  });
  act.append(b);
}

const day = (ms) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

function show(j) {
  act.innerHTML = '';
  if (!j || !j.authed) {
    mine.textContent = 'No account: you can generate every drawing and see it on the page. ' +
      'A free account — an email and a password — downloads its PDF, with a watermark, ' +
      'and buying one address or the subscription starts from it.';
    link('CREATE A FREE ACCOUNT', '/?signup', true);
    link('SIGN IN', '/?signin');
    return;
  }
  const a = j.account;
  if (j.plan === 'subscription') {
    if (!a) {
      mine.textContent = 'This browser holds the office access code, which includes everything the subscription does.';
    } else if (a.status) {
      mine.textContent = 'Subscription, ' + a.email + (a.renewsAt ? ', paid to ' + day(a.renewsAt) : '') + '.';
    } else {
      mine.textContent = 'Subscription, ' + a.email + ', given without charge.';
    }
    if (a && a.portal) toStripe('MANAGE BILLING', '/api/billing/portal');
    return;
  }
  if (a.status === 'past_due' || a.status === 'unpaid') {
    mine.textContent = 'Free, ' + a.email + ': the last payment did not go through. ' +
      'Update the card and the subscription comes back.';
    toStripe('MANAGE BILLING', '/api/billing/portal', true);
    return;
  }
  mine.textContent = 'Free, ' + a.email + '.';
  if (j.billing && j.billing.subscription) toStripe('SUBSCRIBE', '/api/billing/checkout', true);
  else mine.textContent += ' Subscriptions open soon.';
  if (a.portal) toStripe('MANAGE BILLING', '/api/billing/portal');
  // The sites bought one at a time, each with the day it runs out.
  if (a.sites && a.sites.length) {
    mine.textContent += ' Unlocked: ' +
      a.sites.map((s) => s.address + ', until ' + day(s.until)).join('; ') + '.';
  }
}

async function me() {
  try {
    const r = await fetch('/api/me');
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

(async () => {
  let j = await me();
  // Back from Checkout. Stripe tells this server by webhook, which can land a
  // few seconds after the visitor does, so wait for it rather than showing
  // "Free" to someone who has just paid.
  if (new URLSearchParams(location.search).has('subscribed') && j && j.plan !== 'subscription') {
    mine.textContent = 'Payment received — confirming with Stripe…';
    for (let i = 0; i < 15 && j && j.plan !== 'subscription'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      j = await me();
    }
  }
  show(j);
})();
