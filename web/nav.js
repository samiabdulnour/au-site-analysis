/* The session's way in and out on the pages besides the tool (How it works,
   plans, terms): SIGN IN opens the tool's account form, SIGN OUT ends the
   session, and a signed-in visitor's band turns yellow as it does on the
   tool. Both are in the page from the start, one hidden, so the nav never
   gains a word after it is drawn; the server's answer only says which. */

(async () => {
  const band = document.querySelector('.band');
  const signIn = document.getElementById('signIn');
  const signOut = document.getElementById('signOut');
  if (!signIn || !signOut) return;
  const show = (authed, required) => {
    if (band) band.classList.toggle('hi', authed);
    signIn.hidden = authed;
    // A session given by the office's code ends the same way; one the server
    // does not require has nothing to sign out of.
    signOut.hidden = !(authed && required);
  };
  // Yellow, with SIGN OUT, from the start when the last page knew of a
  // session, rather than once the server answers; the answer puts it right
  // either way, and is remembered for the next page.
  try { if (localStorage.getItem('sa:authed')) show(true, true); } catch { /* private mode */ }
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    // The server clears the HttpOnly cookie, so the page only asks it to.
    try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ask anyway */ }
    location.reload();
  });
  let me = null;
  try {
    const r = await fetch('/api/me');
    me = r.ok ? await r.json() : null;
  } catch { /* offline: leave it as it stands */ }
  if (!me) return;
  show(Boolean(me.authed), Boolean(me.required));
  try { localStorage.setItem('sa:authed', me.authed ? '1' : ''); } catch { /* private mode */ }
})();
