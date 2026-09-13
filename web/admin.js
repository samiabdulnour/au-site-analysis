/* The operator's gate.

   Kept apart from the one on / because the two codes grant different things:
   that one draws sheets, this one shows every address anyone searched for and
   why their sheets failed. It asks every time, and it takes only the operator
   code — a shared code entered here is turned away without touching the
   session, so nobody trades a working one for a refusal. */

const $ = (id) => document.getElementById(id);
const err = $('error');

// Say so rather than letting them discover it by typing a code that already
// works. The form stays usable either way: this is only a shortcut onward.
fetch('/api/me').then(async (r) => {
  if (!r.ok) return;
  const j = await r.json();
  if (j.operator) $('already').hidden = false;
}).catch(() => { /* the gate works whether or not this answers */ });

$('gate').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  let r;
  try {
    r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: $('code').value, gate: 'admin' }),
    });
  } catch {
    err.textContent = 'no answer from the server — try again';
    return;
  }
  // Straight to what they came for; the cookie is set by now.
  if (r.ok) return location.replace('/status');
  let j = {};
  try { j = await r.json(); } catch { /* fall back to the line below */ }
  err.textContent = j.error || 'wrong operator code';
  $('code').select();
});
