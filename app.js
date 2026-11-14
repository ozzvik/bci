/* BCI – shared code of the dashboard (index.html) and the grow-room app (grow.html).
   Reads the Tray app server (Google Apps Script). Each answer is also kept in this phone, so the page shows the last numbers at once
   and refreshes them in the background. */
const API = 'https://script.google.com/macros/s/AKfycbyOsuvirg1KZs6F2uKJ0KAy2tVHMiu-_iAiulwBLsbynybTMmjjiyhK_IptGJjPOESR/exec';
const DAY = 86400000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return JSON.parse(localStorage.getItem('bci.' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('bci.' + k, JSON.stringify(v)); } catch (e) {} } };

async function api(query) {
  let txt = '';
  for (let a = 0; a < 3; a++) {
    try { txt = await (await fetch(API + '?' + query + '&t=' + Date.now(), { redirect: 'follow' })).text(); if (txt.trim().startsWith('{')) break; } catch (e) { if (a === 2) throw new Error('אין חיבור לשרת'); }
  }
  let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('השרת החזיר שגיאה – נסה שוב'); }
  if (!j.ok) throw new Error(j.error || 'הבקשה נכשלה');
  return j;
}
async function apiPost(body) {
  const txt = await (await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })).text();
  const j = JSON.parse(txt); if (!j.ok) throw new Error(j.error || 'הבקשה נכשלה'); return j;
}
/** shows the kept answer at once (if any), then asks the server and shows the new one */
async function cached(key, query, show, onErr) {
  const old = store.get(key);
  if (old) show(old, true);
  try { const j = await api(query); store.set(key, j); show(j, false); return j; }
  catch (e) { if (onErr) onErr(e, !!old); }
}

/* ---------- numbers ---------- */
const fmt = (v, d) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '.');
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function ago(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'עכשיו' : m < 60 ? 'לפני ' + m + ' דק׳' : m < 48 * 60 ? 'לפני ' + Math.round(m / 60) + ' שע׳' : 'לפני ' + Math.round(m / 1440) + ' ימים'; }
function cycleDay(cycle, t) { if (!cycle || !cycle.start) return null; const s = new Date(cycle.start + 'T00:00:00').getTime(); return Math.floor((new Date(dayKey(t) + 'T00:00:00').getTime() - s) / DAY) + 1; }
const vpdOf = (t, h) => 0.6108 * Math.exp(17.27 * t / (t + 237.3)) * (1 - h / 100);
/** VPD band: below 0.8 too humid, 0.8–1.5 good (veg + flower), above 1.6 too dry */
function vpdState(v) { return v == null ? '' : v < 0.6 || v > 1.8 ? 'bad' : v < 0.8 || v > 1.5 ? 'warn' : 'good'; }

/* ---------- plant weight: irrigations, full weight, dryback (same rules as the admin page) ---------- */
function analyseWeight(points, cycle) {
  const all = points.map((p) => ({ t: new Date(p.at).getTime(), w: p.w == null ? NaN : Number(p.w) })).filter((p) => isFinite(p.t) && isFinite(p.w)).sort((a, b) => a.t - b.t);
  const sw = all.map((p) => p.w).sort((a, b) => a - b), q = (f) => sw.length ? sw[Math.min(sw.length - 1, Math.floor(f * sw.length))] : 0;
  const med = q(0.5), iqr = Math.max(q(0.75) - q(0.25), Math.abs(med) * 0.15, 50), lo0 = q(0.25) - 3 * iqr, hi0 = q(0.75) + 3 * iqr;
  let pts = all.filter((p) => p.w >= lo0 && p.w <= hi0);
  pts = pts.filter((p, i) => { if (!i || i === pts.length - 1) return true; const a = p.w - pts[i - 1].w, b = p.w - pts[i + 1].w, lim = Math.max(30, p.w * 0.015); return !(a * b > 0 && Math.abs(a) > lim && Math.abs(b) > lim && Math.abs(pts[i + 1].w - pts[i - 1].w) < lim && pts[i + 1].t - pts[i - 1].t < 20 * 60000); });
  const ev = [];
  for (let i = 1; i < pts.length; i++) {
    let lo = pts[i - 1]; for (let k = i - 1; k >= 0 && pts[i].t - pts[k].t <= 30 * 60000; k--) if (pts[k].w < lo.w) lo = pts[k];
    if (pts[i].w - lo.w > Math.max(40, lo.w * 0.01)) {
      const last = ev[ev.length - 1];
      if (last && pts[i].t - last.peakT < 45 * 60000) { if (pts[i].w > last.peak) { last.peak = pts[i].w; last.peakT = pts[i].t; } }
      else ev.push({ t: lo.t, before: lo.w, peak: pts[i].w, peakT: pts[i].t });
    }
  }
  ev.forEach((e) => { const af = pts.filter((p) => p.t >= e.peakT + 30 * 60000 && p.t <= e.peakT + 60 * 60000).map((p) => p.w).sort((a, b) => a - b); e.full = af.length ? af[Math.floor(af.length / 2)] : e.peak; e.added = e.peak - e.before; });
  const manual = cycle && +cycle.fullW > 0 ? +cycle.fullW : null;
  let k = 0, f = null, runMax = -Infinity;
  pts.forEach((p) => { runMax = Math.max(runMax, p.w); while (k < ev.length && ev[k].peakT + 30 * 60000 <= p.t) { f = ev[k].full; k++; } p.full = manual || (f != null ? f : runMax); p.db = p.full ? (p.full - p.w) / p.full * 100 : null; });
  return { pts, ev, dropped: all.length - pts.length };
}
function slopeGH(pts) { if (pts.length < 3) return null; const n = pts.length, mt = pts.reduce((a, p) => a + p.t, 0) / n, mw = pts.reduce((a, p) => a + p.w, 0) / n; let nu = 0, de = 0; pts.forEach((p) => { nu += (p.t - mt) * (p.w - mw); de += (p.t - mt) ** 2; }); return de ? nu / de * 3600000 : null; }
function quietPts(A, from, to) { return A.pts.filter((p) => p.t >= from && p.t <= to && !A.ev.some((e) => p.t >= e.t - 10 * 60000 && p.t <= e.peakT + 60 * 60000)); }
/** everything the screens show about the plant now */
function plantNow(points, cycle) {
  // only the grow-room scale (the sheet also gets the readings of other scales, e.g. M5-scale2 in propagation)
  const dev = (cycle && cycle.scale) || 'M5-grow';
  points = points.filter((p) => !p.device || p.device === dev);
  const A = analyseWeight(points, cycle), lim = +(cycle && cycle.limit) || 20, out = { A, lim };
  const n = A.pts[A.pts.length - 1];
  if (n) {
    out.w = n.w; out.t = n.t; out.full = n.full; out.db = n.db;
    const sp = slopeGH(quietPts(A, n.t - 3 * 3600000, n.t)); out.speed = sp != null ? -sp : null;
    const limW = n.full ? n.full * (1 - lim / 100) : null;
    if (n.db != null && n.db >= lim) out.eta = 0;
    else if (out.speed > 1 && limW != null) out.eta = (n.w - limW) / out.speed;   // hours
    out.lastIrr = A.ev[A.ev.length - 1] || null;
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    out.todayLoss = 0; A.pts.forEach((p, i) => { if (i && p.t >= d0 && p.w < A.pts[i - 1].w && p.t - A.pts[i - 1].t < 40 * 60000) out.todayLoss += A.pts[i - 1].w - p.w; });
    out.todayIrr = A.ev.filter((e) => e.t >= d0).length;
  }
  const air = points.filter((p) => p.t != null && p.h != null).map((p) => ({ t: new Date(p.at).getTime(), temp: +p.t, rh: +p.h, vpd: vpdOf(+p.t, +p.h) })).sort((a, b) => a.t - b.t);
  out.air = air; out.airNow = air[air.length - 1] || null;
  return out;
}

/* ---------- charts (SVG) ---------- */
function niceTicks(min, max, n) { const span = max - min || 1, s0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(s0))), f = s0 / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v); return out; }
function nightBands(t0, t1) {
  const out = [], d = new Date(t0); d.setHours(0, 0, 0, 0);
  for (let t = d.getTime() - DAY; t < t1 + DAY; t += DAY) {
    const doy = Math.floor((t - new Date(new Date(t).getFullYear(), 0, 0)) / DAY), dl = 12 + 2.1 * Math.sin(2 * Math.PI * (doy - 80) / 365), noon = 11.75 + (new Date(t).getTimezoneOffset() === -180 ? 1 : 0);
    out.push([t + (noon + dl / 2) * 3600000, t + DAY + (noon - dl / 2) * 3600000]);
  }
  return out;
}
function chart(el, o) {
  const W = el.clientWidth || 360, H = o.height || 220, L = 48, R = o.yr ? 40 : 10, T = 8, B = 22;
  const x = (t) => L + (t - o.t0) / (o.t1 - o.t0) * (W - L - R);
  const yl = (v) => T + (1 - (v - o.yl.min) / (o.yl.max - o.yl.min)) * (H - T - B);
  const yr = o.yr ? (v) => T + (1 - (v - o.yr.min) / (o.yr.max - o.yr.min)) * (H - T - B) : null;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '">';
  nightBands(o.t0, o.t1).forEach((b) => { const a = Math.max(o.t0, b[0]), z = Math.min(o.t1, b[1]); if (z > a) s += '<rect x="' + x(a).toFixed(1) + '" y="' + T + '" width="' + (x(z) - x(a)).toFixed(1) + '" height="' + (H - T - B) + '" fill="var(--night)"/>'; });
  (o.bands || []).forEach((b) => { s += '<rect x="' + L + '" y="' + yl(b[1]).toFixed(1) + '" width="' + (W - L - R) + '" height="' + Math.max(0, yl(b[0]) - yl(b[1])).toFixed(1) + '" fill="' + b[2] + '"/>'; });
  niceTicks(o.yl.min, o.yl.max, 4).forEach((v) => { const y = yl(v).toFixed(1); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="var(--grid)"/><text x="' + (L - 6) + '" y="' + y + '" dy="4" text-anchor="end">' + (o.yl.fmt ? o.yl.fmt(v) : fmt(v)) + '</text>'; });
  if (o.yr) niceTicks(Math.min(o.yr.min, o.yr.max), Math.max(o.yr.min, o.yr.max), 4).forEach((v) => { const t = o.yr.fmt ? o.yr.fmt(v) : fmt(v); if (t) s += '<text x="' + (W - R + 5) + '" y="' + yr(v).toFixed(1) + '" dy="4">' + t + '</text>'; });
  const spanD = (o.t1 - o.t0) / DAY, stepH = spanD <= 1.2 ? 6 : spanD <= 4 ? 12 : 24, every = Math.max(1, Math.ceil(spanD / (W < 500 ? 5 : 10)));
  const first = new Date(o.t0); first.setMinutes(0, 0, 0); first.setHours(Math.ceil(first.getHours() / stepH) * stepH);
  for (let t = first.getTime(), k = 0; t <= o.t1; t += stepH * 3600000) { const d = new Date(t), mid = d.getHours() === 0; if (stepH === 24 && (k++ % every)) continue; s += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + (mid || stepH === 24 ? dm(t) : hm(t)) + '</text>'; }
  (o.series || []).forEach((se) => {
    const y = se.axis === 'r' ? yr : yl; let d = '', prev = null;
    if (se.bars) { se.pts.forEach((p) => { if (p[1] == null) return; const x0 = x(p[0]), x1 = x(p[0] + se.bars) - 1, y0 = y(Math.max(0, p[1])), y1 = y(Math.min(0, p[1])); s += '<rect x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + Math.max(.5, y1 - y0).toFixed(1) + '" rx="1.5" fill="' + se.color + '" opacity=".85"/>'; }); return; }
    se.pts.forEach((p) => { if (p[1] == null || !isFinite(p[1])) { prev = null; return; } const X = x(p[0]).toFixed(1), Y = y(p[1]).toFixed(1); d += (!prev || (se.gap && p[0] - prev[0] > se.gap)) ? 'M' + X + ',' + Y : se.step ? 'H' + X + 'V' + Y : 'L' + X + ',' + Y; prev = p; });
    if (se.fill && d) s += '<path d="' + d + 'V' + (H - B) + 'H' + x(se.pts.find((p) => p[1] != null)[0]).toFixed(1) + 'Z" fill="' + se.color + '" opacity=".10"/>';
    if (d) s += '<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="' + (se.width || 1.8) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
  });
  (o.markers || []).forEach((m) => { const X = x(m.t).toFixed(1); s += '<line x1="' + X + '" x2="' + X + '" y1="' + T + '" y2="' + (H - B) + '" stroke="' + m.color + '" stroke-opacity=".3"/><circle cx="' + X + '" cy="' + (T + 5) + '" r="4" fill="' + m.color + '"/>'; });
  s += '<line class="cx" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-dasharray="3 3" style="display:none"/><circle class="cd" r="4.5" fill="var(--card)" stroke="var(--green)" stroke-width="2" style="display:none"/>';
  s += '<rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>' + (o.tip ? '<div class="tip" style="display:none"></div>' : '');
  el.innerHTML = s;
  const svg = el.querySelector('svg'), hit = svg.lastChild, cx = svg.querySelector('.cx'), cd = svg.querySelector('.cd'), tip = el.querySelector('.tip');
  const toT = (ev) => { const r = svg.getBoundingClientRect(), px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * W / r.width; return o.t0 + (px - L) / (W - L - R) * (o.t1 - o.t0); };
  if (o.onHover) {
    const mv = (ev) => { const p = o.onHover(toT(ev)); if (!p) return; const X = x(p.t); cx.setAttribute('x1', X); cx.setAttribute('x2', X); cx.style.display = ''; if (p.v != null) { cd.setAttribute('cx', X); cd.setAttribute('cy', (p.axis === 'r' ? yr : yl)(p.v)); cd.style.display = ''; } if (tip) { tip.style.display = ''; tip.innerHTML = p.html; const r = svg.getBoundingClientRect(), left = X * r.width / W; tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(0, left + 12)) + 'px'; } };
    hit.addEventListener('mousemove', mv); hit.addEventListener('touchmove', mv, { passive: true }); hit.addEventListener('touchstart', mv, { passive: true });
    const out = () => { cx.style.display = 'none'; cd.style.display = 'none'; if (tip) tip.style.display = 'none'; };
    hit.addEventListener('mouseleave', out); hit.addEventListener('touchend', () => setTimeout(out, 1800));
  }
  if (o.onClick) hit.addEventListener('click', (ev) => o.onClick(toT(ev)));
}

/* ---------- two cameras joined into one picture (the alignment is set in the admin page) ---------- */
function stGeo(st, asp) {
  const a = asp || 0.75, s = +st.s || 1, r = (+st.r || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), bc = [st.dx + s / 2, st.dy + s * a / 2], hw = s / 2, hh = s * a / 2;
  const bC = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [bc[0] + x * c - y * sn, bc[1] + x * sn + y * c]), aC = [[0, 0], [1, 0], [1, a], [0, a]];
  const xs = aC.concat(bC).map((p) => p[0]), ys = aC.concat(bC).map((p) => p[1]);
  let d = [bc[0] - 0.5, bc[1] - a / 2]; const L = Math.hypot(d[0], d[1]) || 1; d = [d[0] / L, d[1] / L];
  return { a, r, c, sn, bc, hw, hh, d, eA: Math.max(...aC.map((p) => p[0] * d[0] + p[1] * d[1])), eB: Math.min(...bC.map((p) => p[0] * d[0] + p[1] * d[1])), minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
function stGain(A, B, g) {
  const small = (im) => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, 64, 48); return x.getImageData(0, 0, 64, 48).data; };
  const da = small(A), db = small(B), lum = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; let sa = 0, sb = 0, n = 0;
  for (let yi = 0; yi < 48; yi++) for (let xi = 0; xi < 64; xi++) {
    const px = (xi + .5) / 64, py = (yi + .5) / 48 * g.a, t = px * g.d[0] + py * g.d[1]; if (t < g.eB || t > g.eA) continue;
    const vx = px - g.bc[0], vy = py - g.bc[1], qx = vx * g.c + vy * g.sn, qy = -vx * g.sn + vy * g.c; if (Math.abs(qx) > g.hw || Math.abs(qy) > g.hh) continue;
    sa += lum(da, (yi * 64 + xi) * 4); sb += lum(db, (Math.min(47, Math.floor((qy + g.hh) / (2 * g.hh) * 48)) * 64 + Math.min(63, Math.floor((qx + g.hw) / (2 * g.hw) * 64))) * 4); n++;
  }
  return n > 20 && sb > 0 ? Math.max(.6, Math.min(1.6, sa / sb)) : 1;
}
function joinImages(A, B, st, W) {
  const g = stGeo(st, A.height / A.width), k = W / (g.maxX - g.minX), H = Math.round((g.maxY - g.minY) * k), X = (v) => (v - g.minX) * k, Y = (v) => (v - g.minY) * k;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.drawImage(A, X(0), Y(0), k, g.a * k);
  if (B) {
    const off = document.createElement('canvas'); off.width = W; off.height = H; const o = off.getContext('2d'), gain = stGain(A, B, g);
    o.save(); o.translate(X(g.bc[0]), Y(g.bc[1])); o.rotate(g.r); if (Math.abs(gain - 1) > .02) o.filter = 'brightness(' + gain.toFixed(3) + ')'; o.drawImage(B, -g.hw * k, -g.hh * k, 2 * g.hw * k, 2 * g.hh * k); o.restore();
    if (g.eA > g.eB + .005) { const gr = o.createLinearGradient(X(g.d[0] * g.eB), Y(g.d[1] * g.eB), X(g.d[0] * g.eA), Y(g.d[1] * g.eA)); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); o.globalCompositeOperation = 'destination-in'; o.fillStyle = gr; o.fillRect(0, 0, W, H); }
    ctx.drawImage(off, 0, 0);
  }
  return cv.toDataURL('image/jpeg', .9);
}
const loadImg = (src) => new Promise((ok) => { if (!src) return ok(null); const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
/** the newest photo (both cameras joined when set so) as an image URL */
async function newestPhoto(gp) {
  const L = gp.latest || [];
  if (!L[0]) return L[1] ? { src: 'data:image/jpeg;base64,' + L[1].b64, at: L[1].at } : null;
  const a = 'data:image/jpeg;base64,' + L[0].b64;
  if (!gp.stitch || !L[1]) return { src: a, at: L[0].at };
  const [A, B] = await Promise.all([loadImg(a), loadImg('data:image/jpeg;base64,' + L[1].b64)]);
  return { src: A ? joinImages(A, B, gp.stitch, A.width) : a, at: L[0].at };
}

/* ---------- small things ---------- */
const ICON = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
function tile(label, value, unit, sub, cls, extra) {
  return '<div class="tile ' + (cls || '') + '"><div class="l">' + label + '</div><div class="v">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' + (extra || '') + '<div class="s">' + (sub || '') + '</div></div>';
}
function lightbox(src, cap) {
  let lb = $('lb'); if (!lb) { lb = document.createElement('div'); lb.id = 'lb'; lb.className = 'lightbox'; lb.innerHTML = '<img><button class="x" aria-label="סגור">✕</button><div class="cap"></div>'; document.body.appendChild(lb); lb.addEventListener('click', () => lb.classList.remove('on')); }
  lb.querySelector('img').src = src; lb.querySelector('.cap').textContent = cap || ''; lb.classList.add('on');
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

/* ================= AROYA-style pieces: recipe phases, metric tiles with a trend line, one chart of everything, side rail ================= */
const COL = { vpd: '#3ddc97', temp: '#f5b942', rh: '#22c3e6', w: '#9d8cff', irr: '#3b8cff' };
/* The recipe: the phases of flowering by week, with the targets of each phase.
   id = the fertigation program of that phase (fert.html). Climate and dryback bands are starting values – change them here. */
const RECIPE = [
  { id: 'veg',      name: 'צימוח',   en: 'Veg',      from: 1, to: 2,  vpd: [0.8, 1.1], temp: [24, 28], rh: [60, 70], db: [10, 15] },
  { id: 'stretch',  name: 'מתיחה',   en: 'Stretch',  from: 3, to: 3,  vpd: [1.0, 1.2], temp: [24, 28], rh: [55, 65], db: [12, 18] },
  { id: 'bulking',  name: 'Bulking', en: 'Bulking',  from: 4, to: 6,  vpd: [1.1, 1.4], temp: [24, 27], rh: [50, 60], db: [15, 20] },
  { id: 'ripening', name: 'הבשלה',   en: 'Ripening', from: 7, to: 8,  vpd: [1.2, 1.5], temp: [22, 26], rh: [45, 55], db: [18, 25] },
  { id: 'flush',    name: 'שטיפה',   en: 'Flush',    from: 9, to: 99, vpd: [1.2, 1.5], temp: [20, 25], rh: [45, 55], db: [18, 25] },
];
function phaseOf(cycle) {
  const day = cycleDay(cycle, Date.now()); if (!cycle || !cycle.start || !day || day < 1) return null;
  const week = Math.floor((day - 1) / 7) + 1;
  return { day, week, ph: RECIPE.find((p) => week >= p.from && week <= p.to) || RECIPE[RECIPE.length - 1] };
}
const band = (v, b, soft) => v == null || !isFinite(v) ? 'off' : v >= b[0] && v <= b[1] ? '' : v >= b[0] - soft && v <= b[1] + soft ? 'warn' : 'bad';
const thin = (a, n) => { if (a.length <= n) return a; const s = a.length / n, o = []; for (let i = 0; i < n; i++) o.push(a[Math.floor(i * s)]); o.push(a[a.length - 1]); return o; };
const arrMin = (a) => a.reduce((m, v) => v < m ? v : m, Infinity), arrMax = (a) => a.reduce((m, v) => v > m ? v : m, -Infinity);
function spark(vals, color) {
  vals = thin((vals || []).filter((v) => v != null && isFinite(v)), 40);
  if (vals.length < 2) return '<svg class="sp" viewBox="0 0 100 22"></svg>';
  const mn = arrMin(vals), r = (arrMax(vals) - mn) || 1;
  return '<svg class="sp" viewBox="0 0 100 22" preserveAspectRatio="none"><path d="' + vals.map((v, i) => (i ? 'L' : 'M') + (i * 100 / (vals.length - 1)).toFixed(1) + ',' + (19 - (v - mn) / r * 16).toFixed(1)).join('') + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
}
/** a metric: colour dot + name, the value now, the target, the trend of the chosen range */
function ktile(label, color, value, unit, target, vals, st, sub) {
  return '<div class="k ' + (st || '') + '"><div class="l"><span class="dot" style="background:' + color + '"></span>' + label + '</div><div class="v">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div><div class="t">' + (target || '&nbsp;') + '</div>' + (vals ? spark(vals, color) : '') + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
}
const legend = (a, w, when) => '<div class="lg2">' + (when ? '<span class="when">' + when + '</span>' : '') + [['VPD', COL.vpd, a ? fmt(a.vpd, 2) : '—'], ['טמפ׳', COL.temp, a ? fmt(a.temp, 1) + '°' : '—'], ['לחות', COL.rh, a ? fmt(a.rh) + '%' : '—'], ['משקל', COL.w, w != null ? fmt(w) + 'g' : '—'], ['השקיה', COL.irr, '']].map((x) => '<span><i class="dot" style="background:' + x[1] + '"></i>' + x[0] + (x[2] ? ' <b>' + x[2] + '</b>' : '') + '</span>').join('') + '</div>';

/** One chart of everything: VPD, temperature, humidity and the plant weight on one time line (each on its own scale),
    the green band = the VPD target, blue dots = irrigations, the shaded parts = night. o: {t0,t1,air,wpts,ev,band,height} */
function multiChart(el, o) {
  const W = el.clientWidth || 360, H = o.height || 190, L = 30, R = 8, T = 12, B = 18;
  const X = (t) => L + (t - o.t0) / (o.t1 - o.t0) * (W - L - R);
  const air = o.air.filter((p) => p.t >= o.t0 && p.t <= o.t1), wp = (o.wpts || []).filter((p) => p.t >= o.t0 && p.t <= o.t1);
  const rng = (a, pad, lo, hi) => { if (!a.length) return [lo != null ? lo : 0, hi != null ? hi : 1]; let mn = arrMin(a), mx = arrMax(a); if (lo != null) { mn = Math.min(mn, lo); mx = Math.max(mx, hi); } const p = ((mx - mn) || 1) * pad; return [mn - p, mx + p]; };
  const S = [
    { c: COL.temp, w: 1.4, pts: air.map((p) => [p.t, p.temp]), r: rng(air.map((p) => p.temp), .3) },
    { c: COL.rh, w: 1.4, pts: air.map((p) => [p.t, p.rh]), r: rng(air.map((p) => p.rh), .3) },
    { c: COL.w, w: 1.8, pts: wp.map((p) => [p.t, p.w]), r: rng(wp.map((p) => p.w), .12) },
    { c: COL.vpd, w: 2.1, pts: air.map((p) => [p.t, p.vpd]), r: rng(air.map((p) => p.vpd), .2, o.band ? o.band[0] : null, o.band ? o.band[1] : null) },
  ];
  const Y = (v, r) => T + (1 - (v - r[0]) / (r[1] - r[0])) * (H - T - B), rv = S[3].r;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" style="direction:ltr">';
  nightBands(o.t0, o.t1).forEach((b) => { const a = Math.max(o.t0, b[0]), z = Math.min(o.t1, b[1]); if (z > a) s += '<rect x="' + X(a).toFixed(1) + '" y="' + T + '" width="' + (X(z) - X(a)).toFixed(1) + '" height="' + (H - T - B) + '" fill="var(--night)"/>'; });
  if (o.band) s += '<rect x="' + L + '" y="' + Y(o.band[1], rv).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (Y(o.band[0], rv) - Y(o.band[1], rv)).toFixed(1) + '" fill="' + COL.vpd + '" opacity=".10"/>';
  niceTicks(rv[0], rv[1], 4).forEach((v) => { const y = Y(v, rv).toFixed(1); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="var(--grid)"/><text x="' + (L - 5) + '" y="' + y + '" dy="3.5" text-anchor="end" style="fill:' + COL.vpd + ';opacity:.7">' + fmt(v, 1) + '</text>'; });
  const spanD = (o.t1 - o.t0) / DAY, stepH = spanD <= 1.2 ? 6 : spanD <= 2.5 ? 12 : 24, every = Math.max(1, Math.ceil(spanD / (W < 500 ? 5 : 10)));
  const first = new Date(o.t0); first.setMinutes(0, 0, 0); first.setHours(Math.ceil(first.getHours() / stepH) * stepH);
  for (let t = first.getTime(), k = 0; t <= o.t1; t += stepH * 3600000) { const d = new Date(t); if (stepH === 24 && (k++ % every)) continue; s += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle">' + (d.getHours() === 0 || stepH === 24 ? dm(t) : hm(t)) + '</text>'; }
  (o.ev || []).filter((e) => e.peakT >= o.t0 && e.peakT <= o.t1).forEach((e) => { const x = X(e.peakT).toFixed(1); s += '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '" stroke="' + COL.irr + '" stroke-opacity=".3" stroke-dasharray="3 3"/><circle cx="' + x + '" cy="' + (T - 4) + '" r="3.5" fill="' + COL.irr + '"/>'; });
  S.forEach((se) => { let d = '', prev = null; thin(se.pts, 600).forEach((p) => { if (p[1] == null || !isFinite(p[1])) return; d += (!prev || p[0] - prev > 45 * 60000 ? 'M' : 'L') + X(p[0]).toFixed(1) + ',' + Y(p[1], se.r).toFixed(1); prev = p[0]; }); if (d) s += '<path d="' + d + '" fill="none" stroke="' + se.c + '" stroke-width="' + se.w + '" stroke-linejoin="round"/>'; });
  s += '<line class="cx" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-dasharray="3 3" style="display:none"/><rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>';
  el.innerHTML = air.length || wp.length ? s : '<p class="muted small" style="padding:30px 0;text-align:center">אין נתונים בטווח הזה</p>';
  const svg = el.querySelector('svg'); if (!svg) return;
  const hit = svg.lastChild, cx = svg.querySelector('.cx');
  const near = (a, t) => { let b = null, bd = Infinity; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i].t - t); if (d < bd) { bd = d; b = a[i]; } } return bd < 60 * 60000 ? b : null; };
  // the values under the finger are shown in the legend above the chart (o.lg) – nothing floats over the lines
  const mv = (ev) => {
    const r = svg.getBoundingClientRect(), px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * W / r.width, t = o.t0 + (px - L) / (W - L - R) * (o.t1 - o.t0), a = near(air, t), w = near(wp, t);
    if (!a && !w) return; const x = X((a || w).t);
    cx.setAttribute('x1', x); cx.setAttribute('x2', x); cx.style.display = '';
    if (o.lg) o.lg.innerHTML = legend(a, w ? w.w : null, dm((a || w).t) + ' ' + hm((a || w).t));
  };
  const out = () => { cx.style.display = 'none'; if (o.lg && o.lgHtml != null) o.lg.innerHTML = o.lgHtml; };
  // pointer events = mouse, finger and pen alike; a finger may still scroll the page up/down (touch-action: pan-y)
  hit.style.touchAction = 'pan-y'; let outT;
  const go = (ev) => { clearTimeout(outT); mv(ev); };
  hit.addEventListener('pointermove', go); hit.addEventListener('pointerdown', go);
  hit.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') out(); });
  ['pointerup', 'pointercancel'].forEach((k) => hit.addEventListener(k, (ev) => { if (ev.pointerType !== 'mouse') outT = setTimeout(out, 2500); }));
}
/** the time range the charts show, kept in this phone. opts = [[hours, label], ...] */
function rangeSeg(el, opts, onChange) {
  let h = store.get('range') || 48; if (!opts.some((o) => o[0] === h)) h = 48;
  const draw = () => { el.innerHTML = opts.map((o) => '<button class="' + (o[0] === h ? 'on' : '') + '" data-h="' + o[0] + '">' + o[1] + '</button>').join(''); el.querySelectorAll('button').forEach((b) => b.onclick = () => { h = +b.dataset.h; store.set('range', h); draw(); onChange(h); }); };
  draw(); return () => h;
}
/* side rail with the areas – on wide screens, on every page */
(function () {
  const pg = (location.pathname.split('/').pop() || 'index.html').toLowerCase(), um = store.get('mgmtUrl');
  const items = [['🏠', 'בית', 'index.html', ['index.html', '']], ['🗂️', 'ניהול', 'mgmt.html', ['mgmt.html']], ['🌱', 'ריבוי', 'prop.html', ['prop.html']], ['🌿', 'גידול', 'batch.html', ['batch.html', 'grow.html', 'photos.html']], ['📦', 'מלאי', 'mgmt.html#inv', []], ['💧', 'דישון', 'fert.html', ['fert.html']]];
  const el = document.createElement('aside'); el.className = 'side';
  el.innerHTML = '<img src="icon-192.png" alt="">' + items.map((i) => '<a' + (i[2] ? ' href="' + esc(i[2]) + '"' : '') + ' data-t="' + i[1] + '" class="' + (i[3].indexOf(pg) >= 0 ? 'on' : '') + (i[2] ? '' : ' off') + '">' + i[0] + '</a>').join('');
  document.body.appendChild(el); document.body.classList.add('has-side');
})();

/* number fields. On a phone/tablet: the app's own keypad slides up (big keys, a dot, delete, "next field", done) instead of the phone keyboard.
   On a computer: the normal keyboard; a click selects the old value so typing replaces it. */
(function () {
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const SEL = 'input[type="number"]';
  const mark = (i) => { if (!i.dataset.kp) { i.dataset.kp = 1; i.setAttribute('inputmode', touch ? 'none' : 'decimal'); } };
  const fix = (root) => { if (root.matches && root.matches(SEL)) mark(root); if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(mark); };
  fix(document); new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) fix(n); }))).observe(document.body, { childList: true, subtree: true });
  if (!touch) { document.addEventListener('focusin', (e) => { const t = e.target; if (t && t.matches && t.matches(SEL)) setTimeout(() => { try { t.select(); } catch (err) {} }, 0); }); return; }

  const pad = document.createElement('div'); pad.className = 'numpad'; pad.hidden = true;
  pad.innerHTML = '<div class="np-top"><span class="np-lbl"></span><b class="np-val"></b></div><div class="np-keys">' +
    ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'del'].map((k) => '<button type="button" data-k="' + k + '">' + (k === 'del' ? '⌫' : k) + '</button>').join('') +
    '</div><div class="np-act"><button type="button" data-k="clr">נקה</button><button type="button" data-k="next">הבא ›</button><button type="button" data-k="ok" class="np-ok">✓ סיום</button></div>';
  document.body.appendChild(pad);
  let cur = null, buf = '', fresh = true;
  const lblOf = (i) => { const l = i.getAttribute('aria-label') || i.placeholder || ''; if (l) return l; const lab = i.id && document.querySelector('label[for="' + i.id + '"]'); if (lab) return lab.textContent.trim(); const row = i.closest('label, .it, .row, .el, .mt, div'); return row ? (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : ''; };
  const show = () => { pad.querySelector('.np-val').textContent = buf === '' ? '–' : buf; };
  const write = () => {
    if (!cur) return; const n = Number(buf);
    if (buf === '' || buf === '.') cur.value = ''; else if (isFinite(n)) cur.value = buf.endsWith('.') ? String(n) : buf;
    cur.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const close = () => { if (!cur) return; const c = cur; cur = null; pad.hidden = true; document.body.classList.remove('np-open'); c.dispatchEvent(new Event('change', { bubbles: true })); c.blur(); };
  const open = (i) => {
    if (cur === i) return; if (cur) { const c = cur; c.dispatchEvent(new Event('change', { bubbles: true })); }
    cur = i; buf = i.value || ''; fresh = true;
    pad.querySelector('.np-lbl').textContent = lblOf(i); show();
    pad.hidden = false; document.body.classList.add('np-open');
    setTimeout(() => i.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  };
  document.addEventListener('focusin', (e) => { const t = e.target; if (t && t.matches && t.matches(SEL) && !t.disabled && !t.readOnly) open(t); });
  // a tap anywhere else closes the keypad – after that tap did its own job, so the page does not jump under the finger
  document.addEventListener('click', (e) => { if (cur && !pad.contains(e.target) && !(e.target.matches && e.target.matches(SEL))) setTimeout(close, 0); }, true);
  document.addEventListener('focusin', (e) => { const t = e.target; if (cur && t !== cur && !(t.matches && t.matches(SEL))) setTimeout(close, 0); });   // typing in a text field
  pad.addEventListener('pointerdown', (e) => e.preventDefault());       // keep the field focused while keys are pressed
  pad.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !cur) return; const k = b.dataset.k;
    if (k === 'ok') return close();
    if (k === 'next') { const all = [...document.querySelectorAll(SEL)].filter((x) => x.offsetParent && !x.disabled && !x.readOnly), j = all.indexOf(cur); const nx = all[j + 1]; if (!nx) return close(); nx.focus(); open(nx); return; }
    if (k === 'clr') buf = '';
    else if (k === 'del') buf = fresh ? '' : buf.slice(0, -1);
    else if (k === '.') { if (fresh) buf = '0.'; else if (buf.indexOf('.') < 0) buf = (buf || '0') + '.'; }
    else buf = (fresh || buf === '0') ? k : buf + k;
    fresh = false; show(); write();
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (err) {}
  });
})();
