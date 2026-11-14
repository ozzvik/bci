/* BCI ⇄ CannaFlow ("בסדר", the gantt / management app): two-way sync.
   Both apps work on the same record in CannaFlow's database (Supabase, table shared_state, key 'main').
   You sign in here once with your CannaFlow email and password; the sign-in stays on this device.
   Every change is written as a small patch on the newest copy: read → change one thing → write only if nobody wrote in between
   (otherwise read again and redo), so nothing anyone did in CannaFlow is overwritten. CannaFlow sees the change at once (realtime). */
const CF_URL = 'https://epbzibkuwrtjaugezqcd.supabase.co';
// the public "anon" key of the CannaFlow web app (the same one its own page uses; the data itself needs your sign-in)
const CF_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwYnppYmt1d3J0amF1Z2V6cWNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTQzMTYsImV4cCI6MjA5MTgzMDMxNn0.RhtAr1PA0fIL2caeGXTHeMHJoqkqufow6LcEjGOrhHY';
const CF_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const CF_APP = 'https://cannaflow.netlify.app';
const CF = { sb: null, user: null, data: null, at: null, by: null, ch: null, subs: [] };

const CF_DEPTS = { prop: 'ריבוי', grow: 'גידול', post: 'פוסט הארווסט', ops: 'תפעול ואחזקה', purch: 'רכש' };
// CannaFlow's built-in list of materials (its INV_MATERIALS); materials added there come from data.invMaterials
const CF_MATS = [
  { id: 'cal_tm', name: 'Haifa Cal™', unit: 'שק', minStock: 2, target: 8, cat: 'מקרו' },
  { id: 'micro_combi', name: 'Micro Combi', unit: 'שק', minStock: 1, target: 4, cat: 'מקרו' },
  { id: 'b7000', name: 'B-7000 ICL', unit: 'שק', minStock: 1, target: 4, cat: 'מקרו' },
  { id: 'bittermag', name: 'BitterMag', unit: 'שק', minStock: 2, target: 8, cat: 'מקרו' },
  { id: 'mkp', name: 'MKP', unit: 'שק', minStock: 1, target: 4, cat: 'מקרו' },
  { id: 'multi_k', name: 'Multi-K', unit: 'שק', minStock: 1, target: 4, cat: 'מקרו' },
  { id: 'sop', name: 'SOP', unit: 'שק', minStock: 1, target: 3, cat: 'מקרו' },
  { id: 'map', name: 'MAP', unit: 'שק', minStock: 1, target: 2, cat: 'מקרו' },
  { id: 'wall_up_si', name: 'Wall Up Si', unit: 'שק', minStock: 1, target: 2, cat: 'מקרו' },
  { id: 'cal_abs', name: 'Cal Absolute', unit: 'שק', minStock: 1, target: 4, cat: 'מקרו' },
  { id: 'phosphoric', name: 'חומצה זרחתית', unit: "ג'ריקן", minStock: 2, target: 4, cat: 'חומצות' },
  { id: 'koh', name: 'KOH', unit: 'שק', minStock: 1, target: 3, cat: 'חומצות' },
];

function cfLib() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = CF_LIB; s.onload = ok; s.onerror = () => no(new Error('אין חיבור לשרת של CannaFlow')); document.head.appendChild(s); });
}
/** → the signed-in user, or null */
async function cfInit() {
  await cfLib();
  if (!CF.sb) CF.sb = window.supabase.createClient(CF_URL, CF_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bci.cf.auth' } });
  const { data } = await CF.sb.auth.getSession();
  CF.user = data && data.session ? data.session.user : null;
  return CF.user;
}
async function cfLogin(email, pass) {
  const { data, error } = await CF.sb.auth.signInWithPassword({ email, password: pass });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : error.message);
  CF.user = data.user; return CF.user;
}
async function cfLogout() { try { await CF.sb.auth.signOut(); } catch (e) {} CF.user = null; CF.data = null; store.set('cf.cache', null); cfEmit(); }

function cfCached() { const c = store.get('cf.cache'); if (c && c.d) { CF.data = c.d; CF.at = c.at; CF.by = c.by; } return CF.data; }
async function cfFetch() {
  const { data, error } = await CF.sb.from('shared_state').select('value,updated_at,updated_by').eq('key', 'main').single();
  if (error) throw new Error(error.message);
  CF.data = JSON.parse(data.value); CF.at = data.updated_at; CF.by = data.updated_by;
  store.set('cf.cache', { d: CF.data, at: CF.at, by: CF.by, t: Date.now() });
  return CF.data;
}
/** change one thing: fn(copy of the newest data) edits it in place (return false = nothing to write) */
async function cfPatch(fn) {
  if (!CF.user) throw new Error('לא מחובר ל-CannaFlow');
  for (let i = 0; i < 4; i++) {
    await cfFetch();
    const d = JSON.parse(JSON.stringify(CF.data)), n0 = (d.tasks || []).length;
    if (fn(d) === false) return CF.data;
    if (!Array.isArray(d.tasks) || d.tasks.length < n0 - 2) throw new Error('נחסם: השינוי היה מוחק משימות');   // never wipe the gantt
    const now = new Date().toISOString();
    const { data, error } = await CF.sb.from('shared_state')
      .update({ value: JSON.stringify(d), updated_at: now, updated_by: (CF.user.email || '') + ' · BCI' })
      .eq('key', 'main').eq('updated_at', CF.at).select('updated_at');
    if (error) throw new Error(error.message);
    if (data && data.length) { CF.data = d; CF.at = data[0].updated_at || now; store.set('cf.cache', { d, at: CF.at, by: CF.by, t: Date.now() }); cfEmit(); return d; }
    await new Promise((r) => setTimeout(r, 300 + 400 * i));      // someone wrote in between – read again and redo
  }
  throw new Error('CannaFlow עסוק – נסה שוב');
}
/** call fn(data) whenever the data changes (here or in CannaFlow) */
function cfOn(fn) { CF.subs.push(fn); }
function cfEmit() { CF.subs.forEach((f) => { try { f(CF.data); } catch (e) { console.error(e); } }); }
function cfLive() {
  if (!CF.sb || !CF.user || CF.ch) return;
  CF.ch = CF.sb.channel('bci_cf').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_state', filter: 'key=eq.main' }, (p) => {
    try { CF.data = JSON.parse(p.new.value); CF.at = p.new.updated_at; CF.by = p.new.updated_by; store.set('cf.cache', { d: CF.data, at: CF.at, by: CF.by, t: Date.now() }); cfEmit(); } catch (e) {}
  }).subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && CF.user) cfFetch().then(cfEmit).catch(() => {}); });
}
/** start: show the copy on the device at once, then sign-in check + fresh data + live updates. → true when signed in */
async function cfStart() {
  if (cfCached()) cfEmit();
  try { if (!(await cfInit())) return false; await cfFetch(); cfEmit(); cfLive(); return true; }
  catch (e) { console.warn('cf', e); return !!CF.user; }
}

/* ---------- reading the data ---------- */
const cfToday = () => dayKey(Date.now());
const cfAddDays = (d, n) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() + n); return dayKey(t.getTime()); };
const cfRoomName = (d, id) => { const r = ((d && d.rooms) || []).find((x) => x.id === id); return r ? r.name : (id || ''); };
/** batches = tasks grouped by their batch id; the batch's first task carries its name */
function cfBatches(d) {
  const by = {}; ((d && d.tasks) || []).forEach((t) => { if (t.batch) (by[t.batch] = by[t.batch] || []).push(t); });
  const find = (L, words) => L.find((t) => words.some((w) => (t.name || '').indexOf(w) >= 0));
  return Object.keys(by).map((id) => {
    const L = by[id].slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')), root = L.find((t) => t.id === id) || L[0];
    const flower = find(L, ['הפרחה', 'flower']), harvest = find(L, ['קציר', 'harvest']), plant = find(L, ['שתילה', 'planting']);
    const room = (flower && (flower.growRoom || flower.room)) || root.growRoom || root.room || '';
    const strain = root.strain || (L.find((t) => t.strain) || {}).strain || '';
    return { id, name: strain || (root.name || '').replace(/^(שתילה|ייחורים|הפרחה)\s*[·\-–]\s*/, '') || root.name || id, strain, room, roomName: cfRoomName(d, room), tasks: L,
      flower: flower ? flower.date : '', flowerId: flower ? flower.id : '', harvest: harvest ? harvest.date : '', plant: plant ? plant.date : '',
      open: L.filter((t) => !t.done).length, phases: (d.batchPhases || {})[id] || null };
  }).filter((b) => b.open || (b.harvest && b.harvest >= cfAddDays(cfToday(), -21)))
    .sort((a, b) => (a.flower || a.plant || '').localeCompare(b.flower || b.plant || ''));
}
function cfMaterials(d) {
  const meta = (d && d._invMeta) || {}, tg = (d && d._invTargets) || {}, st = (d && d.invState) || {}, inv = (d && d.inventory) || {};
  return CF_MATS.concat((d && d.invMaterials) || []).map((m) => {
    const mt = meta[m.id] || {}, s = st[m.id];
    const qty = s && s.qty != null ? s.qty : inv[m.id] != null ? inv[m.id] : null;
    return Object.assign({}, m, { target: mt.target != null ? mt.target : tg[m.id] != null ? tg[m.id] : m.target, qty });
  });
}

/* ---------- changing the data (each one a small patch) ---------- */
const cfUid = () => 'x' + Date.now() + Math.random().toString(36).slice(2, 5);
/** done / not done – and, like in CannaFlow, a task that is done creates its follow-up ("trigger") tasks */
function cfSetDone(id, done) {
  return cfPatch((d) => {
    const t = (d.tasks || []).find((x) => x.id === id); if (!t || !!t.done === !!done) return false;
    t.done = !!done; if (done) t.doneAt = new Date().toISOString(); else delete t.doneAt;
    if (done) (t.triggers || []).forEach((tr) => {
      const nd = t.date ? cfAddDays(t.date, tr.days || 0) : '';
      if (!d.tasks.find((x) => x.name === tr.name && x.dept === tr.dept && x.date === nd))
        d.tasks.push({ id: cfUid(), dept: tr.dept, name: tr.name, room: t.room, date: nd, priority: 'normal', note: '⚡ מ: ' + t.name, done: false, chain: [], triggers: [] });
    });
  });
}
function cfAddTask(o) {
  const t = Object.assign({ id: cfUid(), dept: 'grow', name: '', room: '', date: cfToday(), priority: 'normal', note: '', done: false, chain: [], triggers: [] }, o);
  return cfPatch((d) => { d.tasks = d.tasks || []; if (t._bci && d.tasks.some((x) => x._bci === t._bci)) return false; d.tasks.push(t); }).then(() => t);
}
function cfDelTask(match) { return cfPatch((d) => { const n = d.tasks.length; d.tasks = d.tasks.filter((t) => !match(t)); if (d.tasks.length === n) return false; }); }
function cfSetQty(id, qty) {
  return cfPatch((d) => {
    d.invState = d.invState || { activeCard: null, extras: [], extraCounter: 0 }; d.invState[id] = d.invState[id] || { qty: null, priority: 'normal' };
    d.invState[id].qty = qty; d.inventory = d.inventory || {}; if (qty != null) d.inventory[id] = qty;
  });
}
/** move the flowering of a batch to a new date; with shift=true the later tasks of the batch that are not done move by the same days */
function cfMoveFlower(batchId, newDate, shift) {
  return cfPatch((d) => {
    const L = (d.tasks || []).filter((t) => t.batch === batchId), f = L.find((t) => /הפרחה|flower/.test(t.name || ''));
    if (!f || !f.date || f.date === newDate) return false;
    const delta = Math.round((new Date(newDate + 'T12:00:00') - new Date(f.date + 'T12:00:00')) / DAY);
    L.forEach((t) => { if (t === f || (shift && !t.done && t.date && t.date > f.date)) t.date = cfAddDays(t.date, delta); });
  });
}

/* ---------- sign-in box (any page) ---------- */
function cfLoginBox(el, onIn) {
  el.innerHTML = '<div class="cflog"><b>🔗 חיבור ל-CannaFlow (בסדר)</b><p class="muted small">כדי שהחדרים, האצוות, המשימות והמלאי יסונכרנו בין האפליקציות – התחבר עם אותו אימייל וסיסמה של CannaFlow. החיבור נשמר במכשיר הזה.</p>' +
    '<div class="form"><input id="cfE" type="email" autocomplete="username" placeholder="אימייל" style="direction:ltr"><input id="cfP" type="password" autocomplete="current-password" placeholder="סיסמה" style="direction:ltr"><button class="btn primary" id="cfGo">התחבר</button></div><div class="msg" id="cfErr"></div></div>';
  const go = async () => {
    const e = $('cfE').value.trim(), p = $('cfP').value; if (!e || !p) { $('cfErr').textContent = 'נא למלא אימייל וסיסמה'; return; }
    $('cfGo').disabled = true; $('cfErr').textContent = 'מתחבר…';
    try { await cfInit(); await cfLogin(e, p); await cfFetch(); cfLive(); $('cfErr').textContent = ''; onIn && onIn(); cfEmit(); }
    catch (err) { $('cfErr').textContent = err.message; } finally { const b = $('cfGo'); if (b) b.disabled = false; }
  };
  $('cfGo').onclick = go; $('cfP').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
