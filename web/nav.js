/* The session's way in and out on the pages besides the tool (How it works,
   plans, terms): SIGN IN opens the tool's account form, SIGN OUT ends the
   session, and a signed-in visitor's band turns yellow as it does on the
   tool. The links the page already has stay as they are. */

(async () => {
  const nav = document.querySelector('.nav');
  const band = document.querySelector('.band');
  if (!nav) return;
  // The band is yellow from the start when the last page knew of a session,
  // rather than turning yellow once the server answers; the answer puts it
  // right either way, and is remembered for the next page.
  const remember = (on) => { try { localStorage.setItem('sa:authed', on ? '1' : ''); } catch { /* private mode */ } };
  try { if (band && localStorage.getItem('sa:authed')) band.classList.add('hi'); } catch { /* private mode */ }
  let me = null;
  try {
    const r = await fetch('/api/me');
    me = r.ok ? await r.json() : null;
  } catch { /* offline: offer the way in */ }
  if (me) {
    if (band) band.classList.toggle('hi', Boolean(me.authed));
    remember(me.authed);
  }

  if (me && me.authed) {
    // A session given by the office's code ends the same way; the server
    // clears the HttpOnly cookie, so the page only asks it to.
    if (!me.required) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = 'SIGN OUT';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ask anyway */ }
      location.reload();
    });
    nav.append(b);
    return;
  }
  const a = document.createElement('a');
  a.className = 'btn';
  a.href = '/?signin';
  a.textContent = 'SIGN IN';
  nav.append(a);
})();
