/* fert.js — מנוע מחשבון הדישון של BCI.
   נטען אחרי app.js (משתמש ב-$, api, apiPost, store, fmt, esc).

   מודל הנתונים
   ------------
   FERTS   – מסד דשנים גולמיים: אחוז מסה (w/w) של כל יסוד בדשן. ניתן לעריכה במסך "סטוקים".
   stock   – מיכל ריכוז: { id, name, note, vol (ליטר מים במיכל), items:[{fert, g}] }
   program – תוכנית דישון: { id, name, phase, mode:'ec'|'ppm', targetEC,
                            inj:{ stockId: ל/קוב }, targets:{ elem: ppm } }

   חישוב קדמי:  ppm_e = Σ_סטוק  gPerL(סטוק,e) · inj[סטוק]
                כאשר gPerL = Σ(גרם·אחוז יסוד)/נפח המיכל  [גרם יסוד לליטר סטוק]
                (הזרקת L ליטר סטוק ל-1000 ליטר מים ⇒ תרומה של gPerL·L ppm)
   חישוב הפוך:  נתון יעד ppm לכל יסוד ⇒ פותרים inj[]≥0 בשיטת NNLS (ריבועים פחותים אי-שליליים).
*/

/* ---------- יסודות ותצוגה ---------- */
const ELEMS = ['N', 'P', 'K', 'Ca', 'Mg', 'S', 'Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo'];
const ELEM_HE = { N: 'חנקן', P: 'זרחן', K: 'אשלגן', Ca: 'סידן', Mg: 'מגנזיום', S: 'גופרית', Fe: 'ברזל', Mn: 'מנגן', Zn: 'אבץ', B: 'בורון', Cu: 'נחושת', Mo: 'מוליבדן' };
// EC כמו בגיליון (Calculator!B6): סך כל היסודות כולל כלור ÷ 500 + 0.4 (המים)
const EC_DIV = 500, EC_WATER = 0.4;
const ecOfPpm = (sum) => sum / EC_DIV + EC_WATER;
const EC_MAIN = ['N', 'P', 'K', 'Ca', 'Mg', 'S'];

/* ---------- מסד דשנים (אחוז יסוד במסה) — מתוך הגיליון "מחשבון דשן עדכני" ---------- */
const FERTS_DEFAULT = {
  'Haifa Cal':        { N: 15.5, Ca: 19.0 },                                  // חנקתי סידן
  'Cal Absolute':     { Ca: 27.3, Cl: 48.2 },                                 // מיכל C — כלוריד סידן
  'Haifa BitterMag':  { Mg: 9.8, S: 13.0 },
  'Haifa MKP':        { P: 22.7, K: 28.7 },
  'Haifa Multi-K':    { N: 13.0, K: 38.0 },
  'Haifa SOP':        { K: 42.3, S: 18.0 },
  'Haifa MAP':        { N: 12.0, P: 22.7, S: 1.8 },
  'Haifa growclean':  { N: 5.0, P: 13.5, K: 33.2 },
  'Micro Combi':      { Fe: 7.4, Zn: 1.1, Cu: 0.8, Mn: 3.7, Mo: 0.5 },
  'B-7000':           { B: 0.7 },
  'חומצה זרחתית 85%': { P: 26.7 },                                            // להורדת pH ותרומת P
};

/* ---------- סטוקים (A–E + חומצה) — מתוך הגיליון, מאומתים מול הפלט המחושב שלו ----------
   נפח = ליטר מים במיכל; items בגרם. אומת: מינון A0 B1.5 C2 D2 E2 ⇒ ppm תואם לגיליון בכל היסודות. */
const STOCKS_DEFAULT = [
  { id: 'A', name: 'מיכל A', note: 'חנקן / סידן', vol: 1000, items: [{ fert: 'Haifa Cal', g: 200000 }] },
  { id: 'B', name: 'מיכל B', note: 'NPK', vol: 1000, items: [{ fert: 'Haifa MKP', g: 50000 }, { fert: 'Haifa Multi-K', g: 75000 }, { fert: 'Haifa SOP', g: 50000 }, { fert: 'Haifa MAP', g: 10000 }, { fert: 'Haifa growclean', g: 25000 }] },
  { id: 'C', name: 'מיכל C', note: 'Absolute (סידן)', vol: 250, items: [{ fert: 'Cal Absolute', g: 50000 }] },
  { id: 'D', name: 'מיכל D', note: 'ביטר-מג', vol: 500, items: [{ fert: 'Haifa BitterMag', g: 175000 }, { fert: 'B-7000', g: 10000 }] },
  { id: 'E', name: 'מיכל E', note: 'מיקרו', vol: 500, items: [{ fert: 'Micro Combi', g: 5000 }, { fert: 'B-7000', g: 10000 }] },
  { id: 'ACID', name: 'חומצה', note: 'זרחתית', vol: 100, items: [{ fert: 'חומצה זרחתית 85%', g: 85000 }] },
];

/* ---------- תוכניות לפי שלב פיזיולוגי — הזרקה ויעדי ppm מתוך הגיליון ----------
   inj = ל/קוב (טבלת "שלב הגידול"); targets = יעדי ppm (טבלת "שלב פיזיולוגי"). */
const PROGRAMS_DEFAULT = [
  { id: 'veg',      name: 'צימוח', phase: 'VEG · שבוע 1-2',   mode: 'ec', targetEC: 2.0, inj: { A: 4, B: 4, C: 0, D: 0, E: 1.25, ACID: 0.12 }, targets: { N: 140, P: 40, K: 160, Ca: 180, Mg: 75 } },
  { id: 'stretch',  name: 'מתיחה', phase: 'Stretch · שבוע 3', mode: 'ec', targetEC: 2.2, inj: { A: 4, B: 5, C: 1, D: 1.5, E: 1.25, ACID: 0.12 }, targets: { N: 130, P: 50, K: 200, Ca: 180, Mg: 80 } },
  { id: 'bulking',  name: 'שיא Bulking', phase: 'Peak · שבוע 4-6', mode: 'ec', targetEC: 2.6, inj: { A: 1.5, B: 6.5, C: 4.5, D: 1.5, E: 1.25, ACID: 0.12 }, targets: { N: 105, P: 70, K: 290, Ca: 160, Mg: 85 } },
  { id: 'ripening', name: 'הבשלה', phase: 'Ripening · שבוע 7-8', mode: 'ec', targetEC: 2.4, inj: { A: 0, B: 5, C: 3.5, D: 1.5, E: 1.25, ACID: 0.12 }, targets: { N: 40, P: 40, K: 220, Ca: 150, Mg: 60 } },
];
const PROGRAM_DEFAULT = PROGRAMS_DEFAULT[2];

/* ---------- מצב (state) ---------- */
let FERTS = JSON.parse(JSON.stringify(FERTS_DEFAULT));
let STOCKS = JSON.parse(JSON.stringify(STOCKS_DEFAULT));
let PROGRAMS = JSON.parse(JSON.stringify(PROGRAMS_DEFAULT));

/* ---------- חישוב כימי ---------- */
/** גרם יסוד e לליטר סטוק אחד */
function gPerL(stock, e) {
  if (!stock.vol) return 0;
  let g = 0;
  (stock.items || []).forEach((it) => {
    const comp = FERTS[it.fert]; if (!comp || comp[e] == null) return;
    g += (Number(it.g) || 0) * comp[e] / 100;
  });
  return g / stock.vol;
}
/** מטריצת A[e][stockId] = gPerL — שורה ליסוד, עמודה לסטוק */
function matrix(stocks) {
  const A = {}; ELEMS.forEach((e) => { A[e] = {}; stocks.forEach((s) => { A[e][s.id] = gPerL(s, e); }); });
  return A;
}
/** חישוב קדמי: נתון inj (ל/קוב לכל סטוק) ⇒ ppm לכל יסוד + EC */
function forward(stocks, inj) {
  const ppm = {}; let tot = 0, all = 0;
  ELEMS.concat(['Cl']).forEach((e) => {
    let v = 0; stocks.forEach((s) => { v += gPerL(s, e) * (Number(inj[s.id]) || 0); });
    if (e !== 'Cl') { ppm[e] = v; tot += v; } else ppm.Cl = v;
    all += v;
  });
  return { ppm, total: tot, ec: ecOfPpm(all) };
}
/** המרה בין EC ליעד — מקנה סט targets משוער מ-EC לפי יחסי התוכנית הנוכחית */
function scaleTargetsToEC(baseTargets, targetEC) {
  const sum = ELEMS.reduce((s, e) => s + (baseTargets[e] || 0), 0);
  if (!sum) return Object.assign({}, baseTargets);
  const k = Math.max(0, targetEC - EC_WATER) * EC_DIV / sum, out = {}; ELEMS.forEach((e) => { if (baseTargets[e] != null) out[e] = baseTargets[e] * k; }); return out;
}

/* ---------- פתרון הפוך: NNLS (ריבועים פחותים אי-שליליים) ----------
   מוצא inj[]≥0 שממזער ‖A·inj − יעד‖² ; A[e][s]=gPerL, יעד=ppm לכל יסוד.
   ירידה לפי קואורדינטות — יציב ומהיר למימדים קטנים (≤6 סטוקים). */
function nnls(stocks, targets, opts) {
  opts = opts || {};
  const cols = stocks.map((s) => s.id).filter((id) => !(opts.lock && id in opts.lock));
  const n = cols.length;
  const rows = ELEMS.filter((e) => targets[e] != null);
  // opts.rel: every element counts by its relative miss (so 2 ppm of iron matters like 290 ppm of potassium)
  const wt = rows.map((e) => opts.rel ? 1 / Math.max(Number(targets[e]) || 0, 1) : 1);
  const A = rows.map((e, ri) => cols.map((id) => gPerL(stocks.find((s) => s.id === id), e) * wt[ri]));
  // יעד בניכוי תרומת סטוקים נעולים (למשל חומצה בקיבוע ידני)
  const b = rows.map((e, ri) => {
    let t = targets[e];
    if (opts.lock) stocks.forEach((s) => { if (s.id in opts.lock) t -= gPerL(s, e) * opts.lock[s.id]; });
    return t * wt[ri];
  });
  // AtA, Atb
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0)), Atb = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < n; k++) { let s = 0; for (let r = 0; r < rows.length; r++) s += A[r][j] * A[r][k]; AtA[j][k] = s; }
    let s = 0; for (let r = 0; r < rows.length; r++) s += A[r][j] * b[r]; Atb[j] = s;
  }
  const x = new Array(n).fill(0);
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    for (let j = 0; j < n; j++) {
      if (AtA[j][j] < 1e-12) continue;
      let num = Atb[j]; for (let k = 0; k < n; k++) if (k !== j) num -= AtA[j][k] * x[k];
      const nv = Math.max(0, num / AtA[j][j]); moved += Math.abs(nv - x[j]); x[j] = nv;
    }
    if (moved < 1e-7) break;
  }
  const inj = {}; cols.forEach((id, j) => inj[id] = x[j]); if (opts.lock) Object.assign(inj, opts.lock);
  return inj;
}

/* ---------- אחסון: שרת לסנכרון, נפילה ל-localStorage ----------
   כל עוד נקודות הקצה בשרת לא נפרסו — הכול עובד מקומית, והסנכרון מתחיל מעצמו כשהן יעלו. */
const FKEY = 'fert.data';
function readLocal() { const d = store.get(FKEY); if (d && d.stocks) { STOCKS = d.stocks; PROGRAMS = d.programs || PROGRAMS; if (d.ferts) FERTS = d.ferts; } }
function writeLocal() { store.set(FKEY, { stocks: STOCKS, programs: PROGRAMS, ferts: FERTS, at: Date.now() }); }

async function loadFert() {
  readLocal();                                   // מיידי מהמכשיר
  try {
    const j = await api('action=fert');          // ואז מהשרת (אם נפרס)
    if (j.stocks) STOCKS = j.stocks;
    if (j.programs) PROGRAMS = j.programs;
    if (j.ferts) FERTS = j.ferts;
    writeLocal();
    return { synced: true };
  } catch (e) { return { synced: false, error: e.message }; }
}
async function pushFert(partial) {               // partial: {stocks?, programs?, ferts?}
  Object.assign({ STOCKS, PROGRAMS, FERTS }, {});
  writeLocal();
  try { await apiPost(Object.assign({ action: 'saveFert' }, partial, { stocks: STOCKS, programs: PROGRAMS, ferts: FERTS })); return true; }
  catch (e) { return false; }                    // נשמר מקומית; יסונכרן כשהשרת יתמוך
}
