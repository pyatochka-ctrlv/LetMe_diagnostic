/* =====================================================================
   ОСТРІВ СУПЕРСИЛ — CORE
   Стан, логіка станцій, оцінювання, синхронізація пульт ↔ гра, самотести.
   Пульт (pult.html) — єдине джерело правди: змінює стан і розсилає його.
   Гра (index.html) лише відображає стан.
   ===================================================================== */
'use strict';
const ORDER = CONFIG.order;
const SKILL_KEYS = CONFIG.skills.map(s => s.key);

/* ---------------- утиліти ---------------- */
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function rnd(n) { return Math.floor(Math.random() * n); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ceilAvg(...xs) { const v = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.ceil(v - 1e-9); }
function ceilAvgN(...xs) { const v = xs.filter(x => typeof x === 'number'); return v.length ? ceilAvg(...v) : null; }
function th(v, l3, l2) { return v >= l3 ? 3 : v >= l2 ? 2 : 1; }
function num(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function pl(n, f) { const a = Math.abs(n) % 100, b = a % 10; return f[(a > 10 && a < 20) ? 2 : b === 1 ? 0 : (b >= 2 && b <= 4) ? 1 : 2]; }
function tplG(str, gender) { return String(str ?? '').replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, m, f) => (gender === 'f' ? f : m)); }
function fill(str, vars) { return String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m)); }
function pick78(v, g) { return v && typeof v === 'object' && !Array.isArray(v) && ('78' in v || '910' in v) ? v[g] : v; }
function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => { const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16); });
}
function addMonths(iso, m) { const d = new Date(iso); const day = d.getDate(); d.setMonth(d.getMonth() + m); if (d.getDate() < day) d.setDate(0); return d; }
function fmtDate(d) { return new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function skillOf(k) { return CONFIG.skills.find(s => s.key === k); }
function probeNames(k, g) { const p = skillOf(k).probes; return Array.isArray(p) ? p : p[g]; }

/* ---------------- стан ---------------- */
function freshState(sound = true) {
  return { v: 4, id: uuid(), rev: 0, phase: 'setup',
    setup: { name: '', teacher: '', group: null, age: null, gender: null, version: 'A' },
    hero: { head: null, cape: null }, cur: 'hero', st: {}, items: [], self: {}, sound,
    t: { lessonStart: null, lessonEnd: null }, skips: { probes: 0, stations: 0 }, fx: { n: 0, kind: '', data: null }, sheet: null, date: new Date().toISOString() };
}
function ctxOf(S, key) {
  const g = S.setup.group, v = S.setup.version, V = CONFIG.versions[v] || CONFIG.versions.A, c = V[key] || {};
  return { g, v, gender: S.setup.gender, C: Object.assign({}, c, c[g] || {}), T: CONFIG.thresholds[key] || {} };
}
function fx(S, kind, data) { S.fx = { n: (S.fx ? S.fx.n : 0) + 1, kind, data: data ?? null, at: Date.now() }; }
function capeColor(id) { return (CONFIG.capes.find(c => c.id === id) || { color: '#C9D3E8' }).color; }

/* ---------------- чиста логіка ---------------- */
function wordle(guess, code) {
  const n = code.length, res = Array(n).fill('grey'), left = {};
  for (let i = 0; i < n; i++) { if (guess[i] === code[i]) res[i] = 'green'; else left[code[i]] = (left[code[i]] || 0) + 1; }
  for (let i = 0; i < n; i++) { if (res[i] !== 'green' && left[guess[i]] > 0) { res[i] = 'yellow'; left[guess[i]]--; } }
  return res;
}
// Емоції: 1–2 вибори. Усі обрані прийнятні → 1; дві, одна прийнятна → 0,5; інакше 0
function emoScore(ok, chosen) {
  if (!chosen || !chosen.length) return 0;
  const good = chosen.filter(c => ok.includes(c)).length;
  if (good === chosen.length) return 1;
  if (chosen.length === 2 && good === 1) return 0.5;
  return 0;
}
function emFrames(ctx) {
  if (ctx.g === '78') return ctx.C.comics.flatMap((c, ci) => c.frames.map((f, fi) => ({ ...f, title: c.title, head: c.head, ci, fi, n: c.frames.length })));
  return ctx.C.cases.flatMap((c, ci) => c.frames.map((f, fi) => ({ ...f, title: c.title, text: c.text, heads: c.heads, ci, fi, n: c.frames.length })));
}
function safeLevel(s, T) {
  if (s.end === 'skipped') return null;
  const l1 = s.locks[0]; if (!l1) return null;
  if (l1.opened || (s.end === 'time' && l1.attempts.length >= T.minAttempts)) return 3;
  if (s.end === 'stopped') return s.stoppedAt >= T.stopSec ? 2 : 1;
  return 2;
}
function safeHelpLevel(s) {
  if (s.end === 'skipped') return null;
  const stuck = s.locks.filter(l => l.stuckAt !== null && l.stuckAt !== undefined);
  if (!stuck.length) return null;
  if (stuck.some(l => l.hint)) return 3;
  return s.end === 'stopped' ? 1 : 2;
}
// Похід 9–10: порушені правила плану. plan = {blockId: startHour}
function hikeViolations(plan, C, withRain) {
  const out = [], blocks = C.blocks, at = id => plan[id], dur = id => blocks.find(b => b.id === id).dur, end = id => at(id) + dur(id);
  blocks.forEach(b => { if (at(b.id) === undefined) out.push('all:' + b.id); });
  const has = id => at(id) !== undefined;
  if (has('first') && has('peak') && end('first') > at('peak')) out.push('order');
  if (has('lunch') && (at('lunch') < 12 || end('lunch') > 15)) out.push('lunch');
  if (has('down') && blocks.some(b => b.id !== 'down' && has(b.id) && end(b.id) > at('down'))) out.push('last');
  if (has('down') && end('down') > C.end) out.push('back');
  if (withRain && has('peak') && at('peak') < C.rain.until) out.push('rain');
  return out;
}
function hikeFits(plan, C, id, start) {
  const d = C.blocks.find(b => b.id === id).dur;
  if (start + d > C.end) return false;
  for (const b of C.blocks) {
    if (b.id === id || plan[b.id] === undefined) continue;
    const s2 = plan[b.id], e2 = s2 + b.dur;
    if (start < e2 && s2 < start + d) return false;
  }
  return true;
}
// Майданчик 7–8: відмітки судді
function judgeLevel(marks) {
  const m = new Set(marks);
  if (m.has('twoPlus') || (m.has('askBoth') && m.has('one'))) return 3;
  if (m.has('askBoth') || m.has('one')) return 2;
  return 1;
}
function compromiseLevel(cardIds, C) {
  const ws = new Set(cardIds.flatMap(id => (C.cards.find(c => c.id === id) || { wishes: [] }).wishes));
  const cats = [...ws].some(w => w.startsWith('cats')), foxes = [...ws].some(w => w.startsWith('foxes'));
  if (cats && foxes && ws.size >= 3) return 3;
  if (cats !== foxes) return 1;
  return 2;
}
function radioAvg(answers, ask, g, T) {
  const a = answers.filter(x => typeof x === 'number'); if (!a.length) return null;
  let avg = a.reduce((x, y) => x + y, 0) / a.length;
  if (g === '910' && ask === 'yes') avg += T.askBonus910;
  return avg;
}
function money910Day(dayIdx, C, choice) {
  const w = C.weather[dayIdx]; return Math.round(C.base[w] * C.factor[choice]);
}

/* =====================================================================
   СТАНЦІЇ
   init(ctx) · probeOf(s) · canNext(s,ctx) · next(S,s,ctx) · act{} · skipProbe(S,s,ctx) · tick(S,s,ctx,now) · score(s,ctx)
   ===================================================================== */
const ST = {};
function stationDone(S, key, s) {
  s.step = 'done'; s.done = true; s.t1 = Date.now(); closeProbe(s);
  const it = CONFIG.costume[key];
  if (it !== undefined && !S.items.includes(it)) { S.items.push(it); fx(S, 'item', { item: it, key }); }
}
function closeProbe(s) { const p = s.curP; if (p && s.pt && s.pt[p] && !s.pt[p].end) s.pt[p].end = Date.now(); }

/* ---------- 0. Прибуття ---------- */
ST.hero = {
  init: () => ({ step: 'pick' }),
  probeOf: () => null,
  canNext: (s, ctx, S) => !!(S.hero.head && S.hero.cape),
  next(S, s) { s.done = true; s.t1 = Date.now(); return 'advance'; },
  act: {
    head(S, s, a) { S.hero.head = a; },
    cape(S, s, a) { S.hero.cape = a; }
  },
  score: () => null
};

/* ---------- 1. Кіностудія — Емоції ---------- */
ST.emotions = {
  init: () => ({ step: 'intro', fi: 0, ans: [], calm: { n: 0, none: false, endsAt: null }, skip: {} }),
  probeOf: s => (s.step === 'intro' || s.step === 'frames' ? 1 : s.step === 'calmReady' || s.step === 'calm' ? 2 : null),
  canNext: () => true,
  nextLabel: s => (s.step === 'calmReady' ? 'Старт 60 с' : 'Далі'),
  next(S, s, ctx) {
    const F = emFrames(ctx);
    if (s.step === 'intro') s.step = 'frames';
    else if (s.step === 'frames') { if (s.fi < F.length - 1) s.fi++; else s.step = 'calmReady'; }
    else if (s.step === 'calmReady') { s.step = 'calm'; s.calm.endsAt = Date.now() + ctx.T.calmSec * 1000; }
    else if (s.step === 'calm') stationDone(S, 'emotions', s);
  },
  act: {
    pick(S, s, id) {
      if (s.step !== 'frames') return false;
      const ch = s.ans[s.fi] || (s.ans[s.fi] = []), k = ch.indexOf(id);
      if (k >= 0) ch.splice(k, 1); else { ch.push(id); if (ch.length > 2) ch.shift(); }
    },
    prev(S, s) { if (s.step === 'frames' && s.fi > 0) s.fi--; else return false; },
    plus(S, s) { if (s.step !== 'calm') return false; s.calm.n++; fx(S, 'sparkle'); },
    none(S, s) { if (s.step !== 'calm' && s.step !== 'calmReady') return false; s.calm.none = true; stationDone(S, 'emotions', s); }
  },
  skipProbe(S, s) {
    if (s.step === 'intro' || s.step === 'frames') { s.skip.p1 = true; s.step = 'calmReady'; }
    else { s.skip.p2 = true; stationDone(S, 'emotions', s); }
  },
  tick(S, s) { if (s.step === 'calm' && s.calm.endsAt && Date.now() >= s.calm.endsAt) { stationDone(S, 'emotions', s); return true; } },
  score(s, ctx) {
    const F = emFrames(ctx), T = ctx.T;
    let p1 = null, p2 = null;
    if (!s.skip.p1) {
      const sc = F.map((f, i) => emoScore(f.ok, s.ans[i] || [])), sum = sc.reduce((a, b) => a + b, 0), t = T.frames[ctx.g];
      const miss = F.map((f, i) => ({ f, sc: sc[i], ch: s.ans[i] || [] })).filter(x => x.sc < 1);
      p1 = { level: th(sum, t.l3, t.l2), short: `${num(sum)} з ${F.length}`,
        ev: `${num(sum)} з ${F.length} балів за кадри${miss.length ? `; інакше побачено: ${miss.map(x => `«${x.f.caption || x.f.question}» — ${x.ch.length ? x.ch.map(id => CONFIG.emotionNames[id].toLowerCase()).join(', ') : 'без відповіді'}`).join('; ')}` : ''}`,
        raw: { answers: s.ans, scores: sc, sum } };
    }
    if (!s.skip.p2) {
      const n = s.calm.none ? 0 : s.calm.n, t = T.calm[ctx.g];
      p2 = { level: th(n, t.l3, t.l2), short: `${n} ${pl(n, ['спосіб', 'способи', 'способів'])}`, ev: s.calm.none && !s.calm.n ? 'Способів заспокоїтися не назвала («не знаю»)' : `Способів заспокоїтися за 60 с — ${n}`, raw: { n, none: s.calm.none } };
    }
    return { p1, p2 };
  }
};

/* ---------- 2. Сейф — Наполегливість ---------- */
ST.safe = {
  init(ctx) {
    const tr = ctx.C.trial;
    return { step: 'intro', trial: { code: shuffle(tr.fruits).slice(0, tr.slots), attempts: [], guess: [], opened: false }, lock: 0, locks: [], guess: [], startedAt: null, endsAt: null, end: null, stoppedAt: null, phase: 'play' };
  },
  makeLock(L) { return { code: shuffle(L.fruits).slice(0, L.slots), attempts: [], hint: null, opened: false, openedAt: null, greens: [], noNew: 0, stuckAt: null }; },
  elapsed: s => Math.round((Date.now() - s.startedAt) / 1000),
  probeOf: s => (s.step === 'play' ? 1 : null),
  canNext: s => (s.step === 'intro' || s.step === 'trial' || (s.step === 'play' && s.phase === 'opened')),
  nextLabel: s => (s.step === 'trial' ? 'Далі: справжній сейф (4 хв)' : s.phase === 'opened' ? 'Далі: замок 2' : 'Далі'),
  next(S, s, ctx) {
    if (s.step === 'intro') s.step = 'trial';
    else if (s.step === 'trial') { s.step = 'play'; s.startedAt = Date.now(); s.endsAt = s.startedAt + ctx.T.totalSec * 1000; s.locks = [ST.safe.makeLock(ctx.C.locks[0])]; s.guess = []; }
    else if (s.step === 'play' && s.phase === 'opened') { s.lock = 1; s.locks.push(ST.safe.makeLock(ctx.C.locks[1])); s.guess = []; s.phase = 'play'; }
  },
  finish(S, s, end) { s.end = end; if (end === 'stopped') s.stoppedAt = ST.safe.elapsed(s); stationDone(S, 'safe', s); },
  slots(s, ctx) { return s.step === 'trial' ? ctx.C.trial.slots : ctx.C.locks[s.lock].slots; },
  act: {
    fruit(S, s, f, ctx) {
      if (s.step === 'trial') { if (s.trial.guess.length < ctx.C.trial.slots) s.trial.guess.push(f); else return false; return; }
      if (s.step !== 'play' || s.phase !== 'play') return false;
      const L = ctx.C.locks[s.lock], lk = s.locks[s.lock];
      for (let i = 0; i < L.slots; i++) { if (lk.hint && lk.hint.pos === i) continue; if (!s.guess[i]) { s.guess[i] = f; return; } }
      return false;
    },
    erase(S, s, _, ctx) {
      if (s.step === 'trial') { if (!s.trial.guess.length) return false; s.trial.guess.pop(); return; }
      const L = ctx.C.locks[s.lock], lk = s.locks[s.lock]; if (!lk) return false;
      for (let i = L.slots - 1; i >= 0; i--) { if (lk.hint && lk.hint.pos === i) continue; if (s.guess[i]) { s.guess[i] = null; s.corr = (s.corr || 0) + 1; return; } }
      return false;
    },
    check(S, s, _, ctx) {
      if (s.step === 'trial') {
        const t = s.trial; if (t.guess.length !== ctx.C.trial.slots) return false;
        const fb = wordle(t.guess, t.code); t.attempts.push({ guess: t.guess.slice(), fb }); t.guess = [];
        if (fb.every(x => x === 'green')) { t.opened = true; fx(S, 'open'); }
        return;
      }
      if (s.step !== 'play' || s.phase !== 'play') return false;
      const L = ctx.C.locks[s.lock], lk = s.locks[s.lock];
      const g = Array.from({ length: L.slots }, (_, i) => (lk.hint && lk.hint.pos === i) ? lk.hint.fruit : s.guess[i]);
      if (g.some(x => !x)) return false;
      const fb = wordle(g, lk.code); lk.attempts.push({ guess: g, fb, at: ST.safe.elapsed(s) }); s.guess = [];
      const newG = fb.map((x, i) => (x === 'green' && !lk.greens.includes(i) ? i : -1)).filter(i => i >= 0);
      if (newG.length) { lk.greens.push(...newG); lk.noNew = 0; } else { lk.noNew++; if (lk.noNew >= ctx.T.stuckAfter && lk.stuckAt === null) lk.stuckAt = ST.safe.elapsed(s); }
      if (fb.every(x => x === 'green')) {
        lk.opened = true; lk.openedAt = ST.safe.elapsed(s); fx(S, 'open');
        if (s.lock === 0) s.phase = 'opened'; else ST.safe.finish(S, s, 'opened');
      }
    },
    hint(S, s, _, ctx) {
      if (s.step !== 'play' || s.phase !== 'play') return false;
      const lk = s.locks[s.lock], L = ctx.C.locks[s.lock]; if (lk.hint) return false;
      const cand = Array.from({ length: L.slots }, (_, i) => i).filter(i => !lk.greens.includes(i)); if (!cand.length) return false;
      const pos = cand[rnd(cand.length)]; lk.hint = { pos, fruit: lk.code[pos], at: ST.safe.elapsed(s), afterStuck: lk.stuckAt !== null }; s.guess[pos] = null;
    },
    stop(S, s) { if (s.step !== 'play') return false; ST.safe.finish(S, s, 'stopped'); }
  },
  skipProbe(S, s) { if (s.step === 'intro' || s.step === 'trial') { s.step = 'trial'; ST.safe.next(S, s, ctxOf(S, 'safe')); return; } s.end = 'skipped'; stationDone(S, 'safe', s); },
  tick(S, s) { if (s.step === 'play' && s.endsAt && Date.now() >= s.endsAt) { ST.safe.finish(S, s, 'time'); return true; } },
  score(s, ctx) {
    if (s.end === 'skipped' || !s.locks.length) return { p1: null, p2: null };
    const l1 = s.locks[0], l2 = s.locks[1], n = k => `${k} ${pl(k, ['спроба', 'спроби', 'спроб'])}`;
    const tail = s.end === 'time' ? ' до кінця часу' : s.end === 'stopped' ? `, зупинилась на ${fmtTime(s.stoppedAt)}` : '';
    let ev = l1.opened ? `Замок 1 відкрито: ${n(l1.attempts.length)} (${fmtTime(l1.openedAt)})` : `Замок 1: ${n(l1.attempts.length)}${tail}`;
    if (l2) ev += `; замок 2 — ${n(l2.attempts.length)}${l2.opened ? ', відкрито' : tail}`;
    const p1 = { level: safeLevel(s, ctx.T), short: l1.opened ? `відкрито, ${n(l1.attempts.length)}` : `${n(l1.attempts.length)}${s.end === 'stopped' ? ', зупинка' : ''}`, ev, raw: { end: s.end, stoppedAt: s.stoppedAt, locks: s.locks } };
    const hl = safeHelpLevel(s), stuck = s.locks.find(l => l.stuckAt !== null);
    const p2 = { level: hl, short: hl === null ? 'не застрягала' : stuck.hint ? 'попросила підказку' : 'не просила',
      ev: hl === null ? 'Не застрягала (не було 3 спроб поспіль без нового зеленого) — не оцінено' : `Застрягла на ${fmtTime(stuck.stuckAt)}; ${s.locks.some(l => l.stuckAt !== null && l.hint) ? 'попросила підказку' : s.end === 'stopped' ? 'підказку не просила й зупинилась' : 'підказку не просила, продовжувала'}`,
      raw: { stuck: s.locks.map(l => ({ stuckAt: l.stuckAt, hint: l.hint })) } };
    return { p1, p2 };
  }
};

/* ---------- 3. Лимонадна лавка — Гроші ---------- */
ST.money = {
  init: ctx => (ctx.g === '78'
    ? { step: 'intro', cart: [], revenue: 0, coins: 0, piggy: 0, shelf: 0, eveningCoins: 0, skip: {} }
    : { step: 'intro', day: 0, wallet: ctx.C.start, piggy: 0, inv: Object.fromEntries(ctx.C.ingredients.map(i => [i.id, 0])), days: [], skip: {} }),
  probeOf: s => (s.step === 'evening' || s.step === 'evening910' ? 2 : 1),
  canNext: (s) => (s.step === 'day' ? !!(s.days[s.day] && s.days[s.day].price) : s.step === 'evening910' ? !!(s.days[s.day] && s.days[s.day].save) : true),
  spent78: (s, C) => s.cart.reduce((a, id) => a + C.goods.find(g => g.id === id).price, 0),
  startDay(s, C) { const d = { weather: C.weather[s.day], buys: [], trap: false, price: null, rent: C.rent, spend: C.rent }; s.wallet -= C.rent; s.days[s.day] = d; s.step = 'day'; },
  next(S, s, ctx) {
    const C = ctx.C;
    if (ctx.g === '78') {
      if (s.step === 'intro') s.step = 'buy';
      else if (s.step === 'buy') {
        const needN = s.cart.filter(id => C.goods.find(g => g.id === id).need).length;
        s.revenue = needN * C.revenuePerNeed; s.coins = C.budget - ST.money.spent78(s, C) + s.revenue; s.step = 'sell'; fx(S, 'coins');
      } else if (s.step === 'sell') { s.eveningCoins = s.coins; s.step = 'evening'; }
      else if (s.step === 'evening') stationDone(S, 'money', s);
      return;
    }
    if (s.step === 'intro') ST.money.startDay(s, C);
    else if (s.step === 'day') {
      const d = s.days[s.day], ok = C.ingredients.every(i => s.inv[i.id] >= 1);
      if (ok) { C.ingredients.forEach(i => s.inv[i.id]--); d.customers = money910Day(s.day, C, d.price); d.revenue = d.customers * d.price; }
      else { d.noIngr = true; d.customers = 0; d.revenue = 0; }
      s.wallet += d.revenue; d.profit = d.revenue - d.spend; s.step = 'sell910'; fx(S, 'coins');
    } else if (s.step === 'sell910') s.step = 'evening910';
    else if (s.step === 'evening910') {
      const d = s.days[s.day];
      if (s.day < C.weather.length - 1) { s.day++; ST.money.startDay(s, C); } else stationDone(S, 'money', s);
      void d;
    }
  },
  act: {
    toggle(S, s, id, ctx) {
      if (s.step !== 'buy') return false;
      const C = ctx.C, k = s.cart.indexOf(id);
      if (k >= 0) { s.cart.splice(k, 1); return; }
      const g = C.goods.find(x => x.id === id);
      if (g.price > C.budget - ST.money.spent78(s, C)) { fx(S, 'toast', 'Монет не вистачає'); return 'fx'; }
      s.cart.push(id);
    },
    piggy(S, s) { if (s.step !== 'evening' || s.coins <= 0) return false; s.coins--; s.piggy++; fx(S, 'coin'); },
    shelf(S, s, _, ctx) { if (s.step !== 'evening' || s.coins <= 0 || s.shelf >= ctx.C.shelf.price) return false; s.coins--; s.shelf++; fx(S, 'coin'); },
    buy(S, s, a, ctx) {
      if (s.step !== 'day') return false;
      const [id, size] = a.split(':'), ing = ctx.C.ingredients.find(i => i.id === id), pk = ing[size], d = s.days[s.day];
      if (pk.price > s.wallet) { fx(S, 'toast', 'Грошей не вистачає'); return 'fx'; }
      s.wallet -= pk.price; s.inv[id] += pk.days; d.buys.push({ id, size, price: pk.price }); d.spend += pk.price;
    },
    trap(S, s, _, ctx) {
      if (s.step !== 'day') return false;
      const d = s.days[s.day], t = ctx.C.trap;
      if (d.trap) return false;
      if (t.price > s.wallet) { fx(S, 'toast', 'Грошей не вистачає'); return 'fx'; }
      s.wallet -= t.price; d.trap = true; d.spend += t.price;
    },
    price(S, s, p) { if (s.step !== 'day') return false; s.days[s.day].price = +p; },
    save(S, s, a) {
      if (s.step !== 'evening910') return false;
      const d = s.days[s.day];
      if (d.save) { s.wallet += d.saved; s.piggy -= d.saved; }
      const part = a === 'all' ? 1 : a === 'half' ? 0.5 : 0;
      d.save = a; d.saved = Math.min(s.wallet, Math.floor(Math.max(0, d.profit) * part)); s.wallet -= d.saved; s.piggy += d.saved;
      if (d.saved) fx(S, 'coin');
    }
  },
  skipProbe(S, s, ctx) {
    if (ctx.g === '78') {
      if (s.step === 'intro' || s.step === 'buy') { s.skip.p1 = true; s.step = 'buy'; ST.money.next(S, s, ctx); }
      else { s.skip.p2 = true; stationDone(S, 'money', s); }
      return;
    }
    if (s.step === 'evening910') s.skip.p2 = true; else s.skip.p1 = true;
    stationDone(S, 'money', s);
  },
  score(s, ctx) {
    const C = ctx.C, T = CONFIG.thresholds.money[ctx.g];
    if (ctx.g === '78') {
      const needN = s.cart.filter(id => C.goods.find(g => g.id === id).need).length, wants = s.cart.filter(id => !C.goods.find(g => g.id === id).need);
      const p1 = s.skip.p1 ? null : { level: needN >= 3 ? 3 : needN === 2 ? 2 : 1, short: `потрібне ${needN}/3`,
        ev: `Куплено потрібного: ${needN} з 3${wants.length ? `; ще взято: ${wants.map(id => C.goods.find(g => g.id === id).name.toLowerCase()).join(', ')}` : ''}`, raw: { cart: s.cart } };
      const share = s.eveningCoins ? s.piggy / s.eveningCoins : 0;
      const p2 = s.skip.p2 || s.step === 'buy' || s.step === 'sell' ? null : { level: th(share, T.save.l3, T.save.l2), short: `${s.piggy} з ${s.eveningCoins} у скарбничку`,
        ev: `Увечері ${s.eveningCoins} ${pl(s.eveningCoins, ['монета', 'монети', 'монет'])}: у скарбничку на ${C.goal.name.toLowerCase()} — ${s.piggy}, на ${C.shelf.name.toLowerCase()} — ${s.shelf}, лишилось — ${s.coins}`, raw: { eveningCoins: s.eveningCoins, piggy: s.piggy, shelf: s.shelf, coins: s.coins } };
      return { p1, p2 };
    }
    const done = s.days.filter(d => d && d.revenue !== undefined);
    const noIngr = done.filter(d => d.noIngr).length, trap = s.days.some(d => d && d.trap);
    const p1 = s.skip.p1 || !done.length ? null : { level: (!noIngr && !trap) ? 3 : (!noIngr || !trap) ? 2 : 1, short: `без інгредієнтів: ${noIngr} дн., пастка: ${trap ? 'так' : 'ні'}`,
      ev: `Днів без інгредієнтів — ${noIngr} з ${done.length}; пастку «${C.trap.name}» ${trap ? 'взято' : 'не взято'}`, raw: { days: s.days } };
    const evs = s.days.filter(d => d && d.save), profit = evs.reduce((a, d) => a + Math.max(0, d.profit), 0), saved = evs.reduce((a, d) => a + d.saved, 0);
    const share = profit ? saved / profit : 0, reached = s.piggy >= C.goal.price;
    const p2 = s.skip.p2 || !evs.length ? null : { level: reached ? 3 : th(share, T.save.l3, T.save.l2), short: `відкладено ${Math.round(share * 100)}%`,
      ev: `Прибуток ${profit} грн, відкладено ${saved} грн (${Math.round(share * 100)}%); у скарбничці ${s.piggy} з ${C.goal.price} грн`, raw: { profit, saved, piggy: s.piggy } };
    return { p1, p2 };
  }
};

/* ---------- 4. Похід — Планування ---------- */
ST.hike = {
  init: ctx => (ctx.g === '78' ? { step: 'intro', pack: [], route: null, skip: {} } : { step: 'intro', sel: null, plan: {}, plan1: null, plan2: null, skip: {} }),
  probeOf: s => (['intro', 'pack', 'plan'].includes(s.step) ? 1 : ['bridge', 'rain', 'replan'].includes(s.step) ? 2 : null),
  canNext: s => (s.step === 'bridge' ? !!s.route : true),
  next(S, s, ctx) {
    if (ctx.g === '78') {
      if (s.step === 'intro') s.step = 'pack'; else if (s.step === 'pack') s.step = 'bridge'; else if (s.step === 'bridge') stationDone(S, 'hike', s);
      return;
    }
    if (s.step === 'intro') s.step = 'plan';
    else if (s.step === 'plan') { s.plan1 = { plan: { ...s.plan }, v: hikeViolations(s.plan, ctx.C, false) }; s.step = 'rain'; s.sel = null; }
    else if (s.step === 'rain') s.step = 'replan';
    else if (s.step === 'replan') { s.plan2 = { plan: { ...s.plan }, v: hikeViolations(s.plan, ctx.C, true) }; stationDone(S, 'hike', s); }
  },
  act: {
    item(S, s, id, ctx) {
      if (s.step !== 'pack') return false;
      const k = s.pack.indexOf(id);
      if (k >= 0) { s.pack.splice(k, 1); return; }
      if (s.pack.length >= ctx.C.pockets) { fx(S, 'toast', 'Кишеньки закінчились'); return 'fx'; }
      s.pack.push(id);
    },
    route(S, s, id) { if (s.step !== 'bridge') return false; s.route = id; },
    sel(S, s, id) { if (s.step !== 'plan' && s.step !== 'replan') return false; s.sel = s.sel === id ? null : id; },
    place(S, s, h, ctx) {
      if ((s.step !== 'plan' && s.step !== 'replan') || !s.sel) return false;
      const start = +h; if (!hikeFits(s.plan, ctx.C, s.sel, start)) { fx(S, 'toast', 'Не вміщається'); return 'fx'; }
      s.plan[s.sel] = start; s.sel = null;
    },
    remove(S, s, id) { if ((s.step !== 'plan' && s.step !== 'replan') || s.plan[id] === undefined) return false; delete s.plan[id]; }
  },
  skipProbe(S, s, ctx) {
    if (ctx.g === '78') { if (s.step === 'intro' || s.step === 'pack') { s.skip.p1 = true; s.step = 'bridge'; } else { s.skip.p2 = true; stationDone(S, 'hike', s); } return; }
    if (s.step === 'intro' || s.step === 'plan') { s.skip.p1 = true; s.step = 'rain'; s.sel = null; } else { s.skip.p2 = true; stationDone(S, 'hike', s); }
  },
  score(s, ctx) {
    const C = ctx.C, T = CONFIG.thresholds.hike;
    if (ctx.g === '78') {
      const needN = s.pack.filter(id => C.items.find(i => i.id === id).need).length, extra = s.pack.length - needN;
      const p1 = s.skip.p1 ? null : { level: th(needN, T.pack.l3, T.pack.l2), short: `потрібних ${needN}/6`, ev: `У рюкзаку потрібних речей — ${needN} з 6, зайвих — ${extra}`, raw: { pack: s.pack } };
      const r = C.routes.find(x => x.id === s.route);
      const p2 = s.skip.p2 || !r ? null : { level: r.level, short: r.name.toLowerCase(), ev: `Обраний шлях: «${r.name}» (${r.suns}☀️; ${r.note.toLowerCase()})`, raw: { route: s.route } };
      return { p1, p2 };
    }
    const vl = n => (n <= T.violations.l3 ? 3 : n <= T.violations.l2 ? 2 : 1);
    const why = v => v.map(x => x.startsWith('all') ? 'не все в розкладі' : x === 'rain' ? C.rain.rule.toLowerCase() : C.rules[x].toLowerCase());
    const p1 = s.skip.p1 || !s.plan1 ? null : { level: vl(s.plan1.v.length), short: `${s.plan1.v.length} поруш.`, ev: `План: порушень — ${s.plan1.v.length}${s.plan1.v.length ? ` (${why(s.plan1.v).join('; ')})` : ''}`, raw: s.plan1 };
    const p2 = s.skip.p2 || !s.plan2 ? null : { level: vl(s.plan2.v.length), short: `${s.plan2.v.length} поруш.`, ev: `Після зливи: порушень — ${s.plan2.v.length}${s.plan2.v.length ? ` (${why(s.plan2.v).join('; ')})` : ''}`, raw: s.plan2 };
    return { p1, p2 };
  }
};

/* ---------- 5. Ринок Боба — Домовленості ---------- */
ST.bob = {
  init: () => ({ step: 'intro', replies: [], demands: 0, hinted: false, revealed: false, askedNeed: false, via: null, left: false, line: 'hello', face: 'normal', tries: [], result: null, haggle: null, skip: {} }),
  probeOf: s => (s.step === 'intro' || s.step === 'talk' ? 1 : s.step === 'trade' || s.step === 'haggle' ? 2 : null),
  canNext: s => (s.step === 'intro' || s.step === 'bye'),
  next(S, s) { if (s.step === 'intro') { s.step = 'talk'; s.line = 'hello'; } else if (s.step === 'bye') stationDone(S, 'bob', s); },
  toBye(s) { s.step = 'bye'; },
  act: {
    code(S, s, id, ctx) {
      if (s.step !== 'talk' || s.replies.length >= ctx.C.maxReplies) return false;
      s.replies.push(id);
      if (id === 'demand') { s.demands++; s.line = 'demand'; s.face = 'hurt'; if (s.demands >= 2) { s.left = true; s.line = 'leave'; fx(S, 'leave'); ST.bob.toBye(s); return; } }
      else if (id === 'askNoTrade') { s.hinted = true; s.line = 'askNoTrade'; s.face = 'normal'; }
      else if (id === 'askNeed') { s.revealed = true; s.askedNeed = true; s.line = 'wish'; s.face = 'joy'; }
      else if (id === 'offer') { s.line = s.revealed ? 'offerKnown' : 'offerHidden'; s.face = 'normal'; s.via = 'offer'; s.step = 'trade'; return; }
      else if (id === 'silent') { s.line = 'silent'; s.face = 'normal'; }
      if (s.step === 'talk' && s.replies.length >= ctx.C.maxReplies) { s.line = 'tooLong'; s.via = 'tooLong'; s.step = 'trade'; }
    },
    give(S, s, id, ctx) {
      if (s.step !== 'trade') return false;
      s.tries.push(id);
      if (id === 'fair') { if (ctx.g === '910') { s.step = 'haggle'; s.line = 'haggle'; s.face = 'normal'; return; } s.result = 'fair'; s.line = 'fair'; s.face = 'joy'; ST.bob.toBye(s); return; }
      if (id === 'overpay') { s.result = 'overpay'; s.line = 'overpay'; s.face = 'joy'; ST.bob.toBye(s); return; }
      s.line = id; s.face = id === 'unfair' ? 'hurt' : 'normal';
      if (s.tries.length >= 3) { s.line = 'noDeal'; ST.bob.toBye(s); }
    },
    haggle(S, s, code, ctx) {
      if (s.step !== 'haggle') return false;
      s.haggle = code; s.result = ctx.C.haggle910[code]; s.line = code === 'agree' ? 'haggleAgree' : code === 'other' ? 'haggleOther' : 'haggleRefuse'; s.face = 'joy'; ST.bob.toBye(s);
    }
  },
  skipProbe(S, s) {
    if (s.step === 'intro' || s.step === 'talk') { s.skip.p1 = true; s.step = 'trade'; s.line = 'offerHidden'; }
    else { s.skip.p2 = true; ST.bob.toBye(s); }
  },
  // репліка Боба для гри
  lineText(s, C) { return s.line === 'wish' ? C.wish.text : (C.lines[s.line] || ''); },
  score(s) {
    const p1 = s.skip.p1 ? null : { level: s.askedNeed ? 3 : (s.hinted && s.via === 'offer') ? 2 : 1,
      short: s.askedNeed ? 'спитала про потребу' : s.hinted && s.via === 'offer' ? 'обмін після натяку' : s.left ? 'Боб пішов' : 'не з’ясувала',
      ev: `Реплік: ${s.replies.length} (${s.replies.map(r => CONFIG.codes.bobTalk.items.find(i => i.id === r).label.toLowerCase()).join(' → ') || '—'})${s.left ? '; Боб пішов після двох вимог' : ''}`, raw: { replies: s.replies } };
    const res = { fair: 'чесний обмін', overpay: 'переплата' };
    const p2 = s.skip.p2 ? null : { level: s.result === 'fair' ? 3 : s.result === 'overpay' ? 2 : 1,
      short: res[s.result] || (s.left ? 'без обміну (Боб пішов)' : 'без обміну'),
      ev: `Обмін: ${res[s.result] || 'не відбувся'}${s.tries.length ? `; запропоновано: ${s.tries.length} ${pl(s.tries.length, ['раз', 'рази', 'разів'])}` : ''}${s.haggle ? `; на торг — «${CONFIG.codes.bobHaggle.items.find(i => i.id === s.haggle).label.toLowerCase()}»` : ''}`, raw: { tries: s.tries, result: s.result, haggle: s.haggle } };
    return { p1, p2 };
  }
};

/* ---------- 6. Майданчик — Вирішення суперечок ---------- */
ST.playground = {
  init: () => ({ step: 'intro', marks: [], cards: [], piles: {}, skip: {} }),
  probeOf: s => (['intro', 'judge', 'piles'].includes(s.step) ? 1 : ['rules', 'compromise'].includes(s.step) ? 2 : null),
  canNext: () => true,
  next(S, s, ctx) {
    if (s.step === 'intro') s.step = ctx.g === '78' ? 'judge' : 'piles';
    else if (s.step === 'judge') { s.step = 'rules'; s.cards = []; }
    else if (s.step === 'piles') { s.step = 'compromise'; s.cards = []; }
    else stationDone(S, 'playground', s);
  },
  act: {
    mark(S, s, id) { if (s.step !== 'judge') return false; const k = s.marks.indexOf(id); if (k >= 0) s.marks.splice(k, 1); else s.marks.push(id); },
    card(S, s, id) {
      if (s.step !== 'rules' && s.step !== 'compromise') return false;
      const max = s.step === 'rules' ? 2 : 3, k = s.cards.indexOf(id);
      if (k >= 0) s.cards.splice(k, 1); else { s.cards.push(id); if (s.cards.length > max) s.cards.shift(); }
    },
    pile(S, s, a) { if (s.step !== 'piles') return false; const [i, p] = a.split(':'); s.piles[i] = p; }
  },
  skipProbe(S, s, ctx) {
    if (['intro', 'judge', 'piles'].includes(s.step)) { s.skip.p1 = true; s.step = ctx.g === '78' ? 'rules' : 'compromise'; s.cards = []; }
    else { s.skip.p2 = true; stationDone(S, 'playground', s); }
  },
  score(s, ctx) {
    const C = ctx.C, lab = id => CONFIG.codes.judge.items.find(i => i.id === id).label.toLowerCase();
    if (ctx.g === '78') {
      const p1 = s.skip.p1 ? null : { level: judgeLevel(s.marks), short: s.marks.length ? s.marks.map(lab).join(', ') : '—', ev: `Суддя: ${s.marks.length ? s.marks.map(lab).join('; ') : 'нічого не відмічено'}`, raw: { marks: s.marks } };
      const fair = s.cards.filter(id => C.cards.find(c => c.id === id).fair).length;
      const p2 = s.skip.p2 ? null : { level: fair >= 2 ? 3 : fair === 1 ? 2 : 1, short: `чесних ${fair}/2`, ev: `Обрані правила: ${s.cards.map(id => `«${C.cards.find(c => c.id === id).text}»`).join(', ') || '—'}; чесних — ${fair} з 2`, raw: { cards: s.cards } };
      return { p1, p2 };
    }
    const correct = C.phrases.filter((p, i) => s.piles[i] === p.pile).length, T = CONFIG.thresholds.playground.piles;
    const p1 = s.skip.p1 ? null : { level: th(correct, T.l3, T.l2), short: `${correct}/6`, ev: `Звинувачення / я-повідомлення: розкладено правильно ${correct} з 6`, raw: { piles: s.piles } };
    const ws = [...new Set(s.cards.flatMap(id => C.cards.find(c => c.id === id).wishes))];
    const p2 = s.skip.p2 ? null : { level: compromiseLevel(s.cards, C), short: `${ws.length} бажань`,
      ev: `Гра з карток: ${s.cards.map(id => `«${C.cards.find(c => c.id === id).text}»`).join(', ') || '—'}; враховано бажань — ${ws.length} з 4`, raw: { cards: s.cards } };
    return { p1, p2 };
  }
};

/* ---------- 7. Радіо Хвиля — Голос і розмова ---------- */
ST.radio = {
  init: () => ({ step: 'intro', qi: 0, answers: [], ask: null, topic: null, marks: [], endsAt: null, running: false, ended: false, skip: {} }),
  probeOf: s => (['intro', 'q', 'ask'].includes(s.step) ? 1 : s.step === 'opinion' ? 2 : null),
  canNext: s => (s.step === 'q' ? typeof s.answers[s.qi] === 'number' : s.step === 'ask' ? !!s.ask : s.step === 'opinion' ? s.topic !== null : true),
  nextLabel: s => (s.step === 'opinion' && !s.running && !s.ended ? 'Старт 30 с' : 'Далі'),
  next(S, s, ctx) {
    const Q = ctx.C.questions;
    if (s.step === 'intro') s.step = 'q';
    else if (s.step === 'q') { if (s.qi < Q.length - 1) s.qi++; else s.step = 'ask'; }
    else if (s.step === 'ask') { if (ctx.g === '910') s.step = 'opinion'; else stationDone(S, 'radio', s); }
    else if (s.step === 'opinion') {
      if (!s.running && !s.ended) { s.running = true; s.endsAt = Date.now() + CONFIG.thresholds.radio.opinionSec * 1000; }
      else stationDone(S, 'radio', s);
    }
  },
  act: {
    code(S, s, v) { if (s.step !== 'q') return false; s.answers[s.qi] = +v; fx(S, 'thanks'); },
    ask(S, s, v) { if (s.step !== 'ask') return false; s.ask = v; },
    topic(S, s, i) { if (s.step !== 'opinion' || s.running || s.ended) return false; s.topic = +i; },
    mark(S, s, id) { if (s.step !== 'opinion') return false; const k = s.marks.indexOf(id); if (k >= 0) s.marks.splice(k, 1); else s.marks.push(id); }
  },
  skipProbe(S, s, ctx) {
    if (['intro', 'q', 'ask'].includes(s.step)) { s.skip.p1 = true; if (ctx.g === '910') s.step = 'opinion'; else stationDone(S, 'radio', s); }
    else { s.skip.p2 = true; stationDone(S, 'radio', s); }
  },
  tick(S, s) { if (s.step === 'opinion' && s.running && Date.now() >= s.endsAt) { s.running = false; s.ended = true; fx(S, 'timer'); return true; } },
  score(s, ctx) {
    const T = CONFIG.thresholds.radio, avg = radioAvg(s.answers, s.ask, ctx.g, T);
    const lab = v => CONFIG.codes.radioAnswer.items.find(i => i.id === v).label.toLowerCase();
    const p1 = s.skip.p1 || avg === null ? null : { level: th(avg, T.avg.l3, T.avg.l2), short: `середнє ${num(avg)}`,
      ev: `Відповіді: ${s.answers.map(lab).join('; ')}; зустрічне питання — ${s.ask === 'yes' ? 'так' : s.ask === 'no' ? 'ні' : '—'}${ctx.g === '910' && s.ask === 'yes' ? ` (+${num(T.askBonus910)})` : ''}; середнє — ${num(avg)}`,
      raw: { answers: s.answers, ask: s.ask } };
    let p2 = null;
    if (ctx.g === '910' && !s.skip.p2 && s.topic !== null && (s.running || s.ended)) {
      const n = s.marks.length, labm = id => CONFIG.codes.radioOpinion.items.find(i => i.id === id).label.toLowerCase();
      p2 = { level: n >= 3 ? 3 : n === 2 ? 2 : 1, short: `${n}/3`, ev: `Думка за 30 с («${ctx.C.topics[s.topic]}»): ${s.marks.length ? s.marks.map(labm).join(', ') : 'нічого з трьох'}`, raw: { topic: s.topic, marks: s.marks } };
    }
    return { p1, p2, single: ctx.g === '78' };
  }
};

/* ---------- Фінал ---------- */
ST.final = {
  init: () => ({ step: 'batteries' }),
  probeOf: () => null,
  canNext: s => s.step === 'batteries',
  next(S, s) {
    if (s.step === 'batteries') {
      s.step = 'crown'; s.done = true; s.t1 = Date.now();
      if (!S.items.includes(CONFIG.costume.final)) S.items.push(CONFIG.costume.final);
      fx(S, 'crown'); S.t.lessonEnd = S.t.lessonEnd || Date.now(); S.phase = 'report';
    }
  },
  act: { self(S, s, a) { const [k, n] = a.split(':'), v = +n; S.self[k] = S.self[k] === v ? (v - 1 || null) : v; if (!S.self[k]) delete S.self[k]; } },
  score: () => null
};

/* =====================================================================
   ДІЇ ПУЛЬТА (змінюють стан)
   ===================================================================== */
function curStation(S) { const key = S.cur; let s = S.st[key]; if (!s) { s = S.st[key] = ST[key].init(ctxOf(S, key)); s.t0 = Date.now(); s.pt = {}; s.skipProbes = []; s.corr = 0; } return s; }
function trackProbe(S) {
  const s = S.st[S.cur]; if (!s || s.done) return;
  const p = ST[S.cur].probeOf(s, ctxOf(S, S.cur));
  if (p !== s.curP) { closeProbe(s); s.curP = p; if (p && !s.pt[p]) s.pt[p] = { start: Date.now() }; }
}
function advanceStation(S) {
  const i = ORDER.indexOf(S.cur);
  if (i < ORDER.length - 1) { S.cur = ORDER[i + 1]; curStation(S); fx(S, 'walk', { to: S.cur }); }
}
const A = {
  start(S) { if (S.phase !== 'setup') return false; S.phase = 'lesson'; S.cur = 'hero'; S.t.lessonStart = Date.now(); S.date = new Date().toISOString(); curStation(S); },
  next(S) {
    if (S.phase !== 'lesson' && !(S.phase === 'report' && S.cur === 'final' && S.st.final && S.st.final.step === 'batteries')) return false;
    const key = S.cur, s = curStation(S), ctx = ctxOf(S, key), M = ST[key];
    if (s.step === 'done' && key !== 'hero' && key !== 'final') { advanceStation(S); trackProbe(S); return; }
    if (!M.canNext(s, ctx, S)) return false;
    const r = M.next(S, s, ctx);
    if (r === 'advance') advanceStation(S);
    trackProbe(S);
  },
  act(S, name, arg) {
    const key = S.cur, s = curStation(S), M = ST[key];
    if (!M.act[name]) return false;
    const r = M.act[name](S, s, arg, ctxOf(S, key));
    trackProbe(S);
    return r;
  },
  skipProbe(S) {
    const key = S.cur, s = curStation(S), M = ST[key];
    if (!M.skipProbe || s.done) return false;
    const p = M.probeOf(s, ctxOf(S, key));
    s.skipProbes.push(p || 0); S.skips.probes++;
    M.skipProbe(S, s, ctxOf(S, key)); trackProbe(S);
  },
  skipStation(S) {
    const key = S.cur, s = curStation(S);
    if (s.done || key === 'hero' || key === 'final') return false;
    s.skipped = true; S.skips.stations++; stationDone(S, key, s); trackProbe(S);
  },
  tick(S) {
    if (S.phase !== 'lesson') return false;
    const key = S.cur, s = S.st[key], M = ST[key];
    if (!s || !M.tick || s.done) return false;
    const r = M.tick(S, s, ctxOf(S, key)); if (r) trackProbe(S);
    return r;
  }
};

/* =====================================================================
   ОЦІНЮВАННЯ
   ===================================================================== */
function scoreAll(S) {
  const out = {};
  SKILL_KEYS.forEach(k => {
    const s = S.st[k];
    if (!s || !s.done) { out[k] = { level: null, p1: null, p2: null, missing: true }; return; }
    if (s.skipped) { out[k] = { level: null, p1: null, p2: null, skipped: true }; return; }
    const r = ST[k].score(s, ctxOf(S, k));
    const level = r.single ? (r.p1 ? r.p1.level : null) : ceilAvgN(r.p1 && r.p1.level, r.p2 && r.p2.level);
    out[k] = { level, p1: r.p1, p2: r.p2, single: !!r.single, skipped: level === null };
  });
  return out;
}
function titleSkill(S, L) {
  let best = null;
  SKILL_KEYS.forEach(k => {
    const lv = L[k].level || 0, self = S.self[k] || 9;
    if (!best || lv > best.lv || (lv === best.lv && self < best.self)) best = { k, lv, self };
  });
  return best.k;
}
function lessonMinutes(S) { return S.t.lessonStart ? Math.max(1, Math.round(((S.t.lessonEnd || Date.now()) - S.t.lessonStart) / 60000)) : null; }
function stationMinutes(S, k) { const s = S.st[k]; return s && s.t0 && s.t1 ? Math.round((s.t1 - s.t0) / 6000) / 10 : null; }

/* ---------------- рядок для Google Таблиці ---------------- */
function sheetRecord(S) {
  const L = scoreAll(S), sk = CONFIG.skills, g = S.setup.group;
  const headers = ['id', 'Надіслано', 'Вчитель', 'Дитина', 'Вік', 'Група', 'Стать', 'Версія', 'Дата уроку', 'Тривалість, хв',
    ...sk.map(x => 'Рівень: ' + x.area),
    ...sk.flatMap(x => probeNames(x.key, g || '78').map((p, i) => `Проба ${i + 1}: ${x.area}`)),
    ...sk.map(x => 'Хв: ' + x.area), ...sk.map(x => 'Самооцінка: ' + x.area),
    'Пропуски', 'Версія гри', 'Сирі дані (JSON)'];
  const raw = Object.fromEntries(SKILL_KEYS.map(k => [k, { level: L[k].level, p1: L[k].p1, p2: L[k].p2, skipped: !!L[k].skipped, state: S.st[k] || null, pt: S.st[k] && S.st[k].pt }]));
  const row = [S.id, new Date().toISOString(), (S.setup.teacher || '').trim(), (S.setup.name || '').trim().split(/\s+/)[0] || '', S.setup.age || '',
    g ? CONFIG.groups[g].label : '', S.setup.gender === 'f' ? 'дівчинка' : S.setup.gender === 'm' ? 'хлопчик' : '', S.setup.version,
    fmtDate(S.date), lessonMinutes(S) || '',
    ...SKILL_KEYS.map(k => L[k].level || ''),
    ...SKILL_KEYS.flatMap(k => [L[k].p1 ? L[k].p1.level ?? '' : '', L[k].p2 ? L[k].p2.level ?? '' : '']),
    ...SKILL_KEYS.map(k => stationMinutes(S, k) ?? ''), ...SKILL_KEYS.map(k => S.self[k] || ''),
    S.skips.probes + S.skips.stations, CONFIG.version,
    JSON.stringify({ id: S.id, setup: S.setup, hero: S.hero, skips: S.skips, t: S.t, self: S.self, skills: raw })];
  return { headers, row };
}

/* =====================================================================
   СИНХРОНІЗАЦІЯ: BroadcastChannel + localStorage (подія storage — запасний канал)
   ===================================================================== */
const SYNC = {
  bc: null, role: null, onMsg: null,
  init(role, onMsg) {
    this.role = role; this.onMsg = onMsg;
    try { this.bc = new BroadcastChannel(CONFIG.channel); this.bc.onmessage = e => onMsg(e.data); } catch (e) { this.bc = null; }
    window.addEventListener('storage', e => {
      if (role === 'game' && e.key === CONFIG.storageKey && e.newValue) { try { onMsg({ type: 'state', state: JSON.parse(e.newValue) }); } catch (er) { } }
      if (role === 'pult' && e.key === CONFIG.storageKey + '-ping') onMsg({ type: 'ping' });
      if (role === 'pult' && e.key === CONFIG.storageKey + '-hello') onMsg({ type: 'hello' });
    });
  },
  post(msg) { try { if (this.bc) this.bc.postMessage(msg); } catch (e) { } },
  publish(S) { S.rev = (S.rev || 0) + 1; const json = JSON.stringify(S); try { localStorage.setItem(CONFIG.storageKey, json); } catch (e) { } this.post({ type: 'state', state: S }); },
  load() { try { const x = JSON.parse(localStorage.getItem(CONFIG.storageKey)); if (x && x.v === 4) return x; } catch (e) { } return null; },
  ping() { this.post({ type: 'ping' }); try { localStorage.setItem(CONFIG.storageKey + '-ping', String(Date.now())); } catch (e) { } },
  hello() { this.post({ type: 'hello' }); try { localStorage.setItem(CONFIG.storageKey + '-hello', String(Date.now())); } catch (e) { } }
};

/* =====================================================================
   САМОТЕСТИ (pult.html?test=1)
   ===================================================================== */
function selfTest() {
  const R = [], eq = (name, got, exp) => R.push({ name, ok: JSON.stringify(got) === JSON.stringify(exp), got: JSON.stringify(got), exp: JSON.stringify(exp) });
  const G = 'green', Y = 'yellow', X = 'grey';
  // Wordle
  eq('Wordle: усе на місці', wordle(['🍎', '🍌', '🍇'], ['🍎', '🍌', '🍇']), [G, G, G]);
  eq('Wordle: правильний фрукт у середині', wordle(['🍓', '🍌', '🍒'], ['🍎', '🍌', '🍇']), [X, G, X]);
  eq('Wordle: усі є, але не на місці', wordle(['🍌', '🍇', '🍎'], ['🍎', '🍌', '🍇']), [Y, Y, Y]);
  eq('Wordle: нічого немає', wordle(['🍓', '🍒', '🍐'], ['🍎', '🍌', '🍇']), [X, X, X]);
  eq('Wordle: повтор — один зелений, решта сірі', wordle(['🍎', '🍎', '🍎'], ['🍌', '🍎', '🍇']), [X, G, X]);
  eq('Wordle: повтор — лише один жовтий', wordle(['🍎', '🍎', '🍌'], ['🍌', '🍇', '🍎']), [Y, X, Y]);
  eq('Wordle: зелений має пріоритет над жовтим', wordle(['🍎', '🍌', '🍎', '🍎'], ['🍇', '🍌', '🍎', '🍓']), [X, G, G, X]);
  eq('Wordle: 5 місць, змішано', wordle(['🥝', '🍎', '🍐', '🍇', '🍌'], ['🍎', '🥝', '🍐', '🍒', '🍓']), [Y, Y, G, X, X]);
  // Емоції
  eq('Кадр: один прийнятний → 1', emoScore(['joy', 'surprise'], ['joy']), 1);
  eq('Кадр: два прийнятні → 1', emoScore(['joy', 'surprise'], ['joy', 'surprise']), 1);
  eq('Кадр: два, один прийнятний → 0,5', emoScore(['joy'], ['joy', 'sad']), 0.5);
  eq('Кадр: неприйнятний / порожньо → 0', [emoScore(['joy'], ['sad']), emoScore(['joy'], [])], [0, 0]);
  // ceilAvg з пропусками
  eq('ceilAvg з пропущеними пробами', [ceilAvgN(3, null), ceilAvgN(2, 3), ceilAvgN(null, null), ceilAvgN(1, 2)], [3, 3, null, 2]);
  // Сейф
  const T = CONFIG.thresholds.safe, lk = o => Object.assign({ attempts: [1, 2, 3], opened: false, hint: null, stuckAt: null }, o);
  eq('Сейф П1: відкрито / до кінця часу / зупинка ≥90 / <90', [
    safeLevel({ end: 'opened', locks: [lk({ opened: true })] }, T), safeLevel({ end: 'time', locks: [lk()] }, T),
    safeLevel({ end: 'stopped', stoppedAt: 120, locks: [lk()] }, T), safeLevel({ end: 'stopped', stoppedAt: 40, locks: [lk()] }, T)], [3, 3, 2, 1]);
  eq('Сейф П2: застрягла+підказка / не просила / зупинилась / не застрягала', [
    safeHelpLevel({ end: 'time', locks: [lk({ stuckAt: 60, hint: { pos: 0 } })] }), safeHelpLevel({ end: 'time', locks: [lk({ stuckAt: 60 })] }),
    safeHelpLevel({ end: 'stopped', locks: [lk({ stuckAt: 60 })] }), safeHelpLevel({ end: 'opened', locks: [lk()] })], [3, 2, 1, null]);
  // «Застрягла» на реальній станції: 3 спроби поспіль без нового зеленого
  const S0 = freshState(false); Object.assign(S0.setup, { group: '78', version: 'A', gender: 'f' }); S0.phase = 'lesson'; S0.cur = 'safe';
  const sf = curStation(S0); A.next(S0); A.next(S0); const code = sf.locks[0].code, other = CONFIG.versions.A.safe['78'].locks[0].fruits.filter(f => !code.includes(f));
  const tryG = g => { g.forEach(f => A.act(S0, 'fruit', f)); A.act(S0, 'check'); };
  tryG([other[0], other[1], code[0]]); tryG([other[1], other[0], code[0]]); tryG([other[0], code[0], other[1]]);
  eq('Сейф: «застрягла» після 3 спроб без нового зеленого', sf.locks[0].stuckAt !== null, true);
  A.act(S0, 'hint'); A.act(S0, 'stop');
  eq('Сейф: застрягла й попросила підказку → П2 = 3', ST.safe.score(sf, ctxOf(S0, 'safe')).p2.level, 3);
  // Лавка 7–8
  const M8 = freshState(false); Object.assign(M8.setup, { group: '78', version: 'A' }); M8.phase = 'lesson'; M8.cur = 'money';
  const m8 = curStation(M8); A.next(M8); ['lemons', 'sugar', 'cups', 'lolly'].forEach(id => A.act(M8, 'toggle', id));
  eq('Лавка 7–8: бюджет не дає взяти наліпки', A.act(M8, 'toggle', 'stickers'), 'fx');
  A.next(M8); A.next(M8);
  eq('Лавка 7–8: виручка 12, увечері 13 монет', [m8.revenue, m8.eveningCoins], [12, 13]);
  for (let i = 0; i < 7; i++) A.act(M8, 'piggy'); for (let i = 0; i < 5; i++) A.act(M8, 'shelf');
  const sm8 = ST.money.score(m8, ctxOf(M8, 'money'));
  eq('Лавка 7–8: П1 усе потрібне → 3, П2 7/13 → 3', [sm8.p1.level, sm8.p2.level], [3, 3]);
  // Лавка 9–10
  const M9 = freshState(false); Object.assign(M9.setup, { group: '910', version: 'A' }); M9.phase = 'lesson'; M9.cur = 'money';
  const m9 = curStation(M9); A.next(M9);
  eq('Лавка 9–10: оренда списана, 25 грн', m9.wallet, 25);
  A.act(M9, 'buy', 'lemons:big'); A.act(M9, 'buy', 'cups:big'); A.act(M9, 'price', 8); A.next(M9);
  eq('Лавка 9–10: день 1 сонячно, 8 грн → 9 покупців, 72 грн', [m9.days[0].customers, m9.days[0].revenue], [9, 72]);
  A.next(M9); A.act(M9, 'save', 'all'); A.next(M9);
  A.act(M9, 'price', 8); A.next(M9); A.next(M9); A.act(M9, 'save', 'all'); A.next(M9);
  A.act(M9, 'trap'); A.act(M9, 'price', 5); A.next(M9); A.next(M9); A.act(M9, 'save', 'none'); A.next(M9);
  const sm9 = ST.money.score(m9, ctxOf(M9, 'money'));
  eq('Лавка 9–10: великі упаковки — без пустих днів; пастка → П1 = 2', sm9.p1.level, 2);
  eq('Лавка 9–10: відкладено 2 дні з 3 → П2', sm9.p2.level, m9.piggy >= 120 ? 3 : th(sm9.p2.raw.saved / sm9.p2.raw.profit, 0.6, 0.3));
  // Похід
  const HC = CONFIG.versions.A.hike['910'];
  eq('Розклад: план без порушень', hikeViolations({ first: 8, rest: 10, lunch: 12, peak: 13, down: 15 }, HC, false), []);
  eq('Розклад: обід о 16 і вершина до озера', hikeViolations({ peak: 8, first: 10, rest: 12, lunch: 16, down: 17 }, HC, false), ['order', 'lunch']);
  eq('Розклад: той самий план після зливи — порушення', hikeViolations({ first: 8, rest: 10, lunch: 12, peak: 13, down: 15 }, HC, true), ['rain']);
  eq('Розклад: перебудований план після зливи', hikeViolations({ first: 8, rest: 10, lunch: 12, peak: 15, down: 17 }, HC, true), []);
  eq('Розклад: інший правильний план після зливи', hikeViolations({ first: 10, lunch: 12, rest: 13, peak: 15, down: 17 }, HC, true), []);
  eq('Розклад: незаповнена справа — порушення', hikeViolations({ first: 8, lunch: 12, peak: 13, down: 15 }, HC, false), ['all:rest']);
  eq('Розклад: накладання не вміщається', [hikeFits({ first: 8 }, HC, 'peak', 9), hikeFits({ first: 8 }, HC, 'down', 18)], [false, false]);
  const routes = CONFIG.versions.A.hike['78'].routes;
  eq('Маршрут 7–8: ліс 3, додому 2, гора 1, брід 1', ['forest', 'home', 'mountain', 'ford'].map(id => routes.find(r => r.id === id).level), [3, 2, 1, 1]);
  // Боб
  const B = (g, codes, give) => {
    const SB = freshState(false); Object.assign(SB.setup, { group: g, version: 'A' }); SB.phase = 'lesson'; SB.cur = 'bob';
    const b = curStation(SB); A.next(SB); codes.forEach(c => A.act(SB, 'code', c)); (give || []).forEach(x => x.startsWith('h:') ? A.act(SB, 'haggle', x.slice(2)) : A.act(SB, 'give', x));
    return { b, sc: ST.bob.score(b, ctxOf(SB, 'bob')) };
  };
  const b1 = B('78', ['demand', 'demand']);
  eq('Боб: дві вимоги — Боб іде', [b1.b.left, b1.b.step, b1.sc.p2.level], [true, 'bye', 1]);
  const b2 = B('78', ['askNeed', 'offer'], ['fair']);
  eq('Боб: спитала про потребу + чесний обмін → 3/3', [b2.sc.p1.level, b2.sc.p2.level, b2.b.line], [3, 3, 'fair']);
  const b3 = B('78', ['askNoTrade', 'offer'], ['unfair', 'overpay']);
  eq('Боб: натяк → обмін, фантик відхилено, переплата → 2/2', [b3.sc.p1.level, b3.sc.p2.level, b3.b.tries], [2, 2, ['unfair', 'overpay']]);
  const b4 = B('910', ['askNeed', 'offer'], ['fair', 'h:agree']);
  eq('Боб 9–10: торг «Дай дві» → погодилась → переплата', [b4.b.result, b4.sc.p2.level], ['overpay', 2]);
  const b5 = B('78', ['silent', 'silent', 'silent', 'silent', 'silent']);
  eq('Боб: 5 реплік — перехід до обміну', [b5.b.step, b5.b.via], ['trade', 'tooLong']);
  // Майданчик
  eq('Суддя: комбінації відміток', [judgeLevel(['twoPlus']), judgeLevel(['askBoth', 'one']), judgeLevel(['askBoth']), judgeLevel(['one']), judgeLevel(['side']), judgeLevel(['side', 'silent'])], [3, 3, 2, 2, 1, 1]);
  const PC = CONFIG.versions.A.playground['910'];
  eq('Компроміс: обидві команди і ≥3 бажання → 3; одна команда → 1; мало бажань → 2', [compromiseLevel(['c1', 'c2', 'c3'], PC), compromiseLevel(['c2', 'c5', 'c6'], PC), compromiseLevel(['c4', 'c5', 'c6'], PC)], [3, 1, 2]);
  // Радіо
  const RT = CONFIG.thresholds.radio;
  eq('Радіо: середнє 7–8 без бонусу; 9–10 з бонусом', [radioAvg([2, 2, 3], 'yes', '78', RT), radioAvg([2, 2], 'yes', '910', RT), radioAvg([2, 3], 'no', '910', RT)], [7 / 3, 2.5, 2.5]);
  eq('Радіо: рівень 9–10 з бонусом 2 → 2,5 → 3', th(radioAvg([2, 2], 'yes', '910', RT), RT.avg.l3, RT.avg.l2), 3);
  // Предмети костюма, зокрема при пропуску станції
  const SI = freshState(false); Object.assign(SI.setup, { group: '78', version: 'A', gender: 'm' }); SI.phase = 'lesson'; SI.cur = 'emotions'; curStation(SI);
  A.skipStation(SI);
  eq('Костюм: пропущена станція однаково дає Маску', SI.items, [CONFIG.costume.emotions]);
  A.next(SI); A.skipStation(SI); A.next(SI); A.skipStation(SI);
  eq('Костюм: порядок предметів Маска → Щит → Пояс', SI.items, [0, 3, 1]);
  eq('Костюм: навушники за Радіо (шар 7) і корона на фіналі', [CONFIG.costume.radio, CONFIG.costume.final], [7, 6]);
  // Рядок для таблиці
  const SR = freshState(false); Object.assign(SR.setup, { name: 'Олеся Іваненко', teacher: 'Марія', group: '78', age: 8, gender: 'f', version: 'B' });
  SR.t.lessonStart = Date.now() - 40 * 60000; SR.t.lessonEnd = Date.now(); SR.st.emotions = { done: true, skipped: true }; SR.self.emotions = 2; SR.skips.stations = 1;
  const rec = sheetRecord(SR), col = h => rec.row[rec.headers.indexOf(h)];
  eq('Таблиця: заголовки й рядок однакової довжини', rec.headers.length === rec.row.length, true);
  eq('Таблиця: лише ім’я, версія, тривалість, пропуски', [col('Дитина'), col('Версія'), col('Тривалість, хв'), col('Пропуски')], ['Олеся', 'B', 40, 1]);
  eq('Таблиця: пропущена станція — порожній рівень', [col('Рівень: Емоції'), col('Проба 1: Емоції'), col('Самооцінка: Емоції')], ['', '', 2]);
  eq('Таблиця: сирі дані останньою колонкою', JSON.parse(rec.row[rec.row.length - 1]).setup.version, 'B');
  // Рід
  eq('Рід: підстановка', [tplG('мрія{в|ла}', 'm'), tplG('мрія{в|ла}', 'f'), tplG('готов{ий|а}', 'f')], ['мріяв', 'мріяла', 'готова']);
  eq('Версії А і Б мають однакову структуру', JSON.stringify(Object.keys(CONFIG.versions.A)) === JSON.stringify(Object.keys(CONFIG.versions.B)), true);

  const pass = R.filter(r => r.ok).length, fail = R.length - pass;
  console.log(`%c[САМОТЕСТИ] ${pass}/${R.length} пройдено${fail ? `, ${fail} провалено` : ''}`, `font-weight:bold;color:${fail ? '#c00' : '#1F9D63'}`);
  R.forEach(r => (r.ok ? console.log('  ✔ ' + r.name) : console.error(`  ✘ ${r.name}: отримано ${r.got}, очікувалось ${r.exp}`)));
  if (typeof window !== 'undefined') window.__selftest = { pass, fail, total: R.length, results: R };
  return { pass, fail, total: R.length, results: R };
}
