import { suggestAddresses } from './src/fetch/geocode.js';
for (const q of ['134 showground', '26 campsie st', '212 bondi rd']) {
  const t = Date.now();
  try { const s = await suggestAddresses(q); console.log(`${q} (${Date.now()-t}ms) ->`, s.slice(0,3)); }
  catch (e:any) { console.log(`${q} -> ERROR`, e.message.slice(0,100)); }
}
