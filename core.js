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
/* ---------- Twemoji: замінює емодзі на SVG-картинки (img.emoji) після кожного рендеру ---------- */
function emojify(el) {
  if (!el || typeof twemoji === 'undefined') return;
  try { twemoji.parse(el, { base: CONFIG.twemoji.base, folder: 'svg', ext: '.svg', className: 'emoji' }); } catch (e) { }
}
/* ---------- піксельні пропси (SVG) ---------- */
function pixelSVG(rows, pal, px, cls) {
  const h = rows.length, w = rows[0].length; let r = '';
  rows.forEach((row, y) => { for (let x = 0; x < w; x++) { const c = pal[row[x]]; if (c) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`; } });
  return `<svg class="${cls || 'pxp'}" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
const COIN_ROWS = ['..kkkk..', '.kyyyyk.', 'kyWyyyyk', 'kyWyyyok', 'kyyyyyok', 'kyyyyook', '.kooook.', '..kkkk..'];
function coinSVG(px = 2) { return pixelSVG(COIN_ROWS, { k: '#1E2A5A', y: '#FFC93C', W: '#FFF1A8', o: '#E8A915' }, px, 'pxcoin'); }
const ROPE_ROWS = ['...kkkkkk...', '..kYYYYYYk..', '.kYyyyyyyYk.', 'kYyk....kyYk', 'kYk.kkkk.kYk', 'kYk.kYYk.kYk', 'kYk.kyyk.kYk', 'kYyk.kk.kyYk', '.kYykkkkyYk.', '..kYYYYYYk..', '...kkkkYYk..', '.......kYk..', '.......kYk..', '........k...'];
function ropeSVG(px = 4) { return pixelSVG(ROPE_ROWS, { k: '#1E2A5A', Y: '#D9A35B', y: '#A8702F' }, px, 'pxrope'); }
// коротке питання самооцінки для картки фіналу: «Наскільки вмієш …?»
function selfShort(sk) { const q = sk.selfQ || ''; return q.replace(/^Як ти оцінюєш,\s*н/, 'Н'); }
function fill(str, vars) { return String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m)); }
function pick78(v, g) { return v && typeof v === 'object' && !Array.isArray(v) && ('78' in v || '910' in v) ? v[g] : v; }
function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => { const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16); });
}
function fmtDate(d) { return new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function skillOf(k) { return CONFIG.skills.find(s => s.key === k); }
function probeNames(k, g) { const p = skillOf(k).probes; return Array.isArray(p) ? p : p[g]; }

/* ---------------- стан ---------------- */
function freshState(sound = true) {
  return { v: 5, id: uuid(), rev: 0, phase: 'setup',
    setup: { name: '', surname: '', mik: '', group: null, age: null, gender: null },
    hero: { head: null, cape: null }, cur: 'hero', st: {}, items: [], self: {}, sound,
    t: { lessonStart: null, lessonEnd: null }, skips: { probes: 0, stations: 0 }, fx: { n: 0, kind: '', data: null }, sheet: null, date: new Date().toISOString() };
}
function ctxOf(S, key) {
  const g = S.setup.group, c = CONFIG.content[key] || {};
  return { g, gender: S.setup.gender, C: Object.assign({}, c, c[g] || {}), T: CONFIG.thresholds[key] || {} };
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
  if (ctx.g === '78') return ctx.C.comics.flatMap((c, ci) => c.frames.map((f, fi) => ({ ...f, title: c.title, head: c.head, warm: !!c.warm, ci, fi, n: c.frames.length })));
  return ctx.C.cases.flatMap((c, ci) => c.frames.map((f, fi) => ({ ...f, title: c.title, text: c.text, heads: c.heads, warm: !!c.warm, mask: !!c.mask, ci, fi, n: c.frames.length })));
}
// Сейф: обидві проби рахуються на замку 2 (складнішому)
function safeLevel(s, T) {
  if (s.end === 'skipped') return null;
  const l = s.locks[1]; if (!l) return null;
  if (l.opened || (s.end === 'time' && l.attempts.length >= T.minAttempts)) return 3;
  if (s.end === 'stopped') return s.stoppedAt >= T.stopSec ? 2 : 1;
  return 2;
}
function safeHelpLevel(s) {
  if (s.end === 'skipped') return null;
  const l = s.locks[1]; if (!l || l.stuckAt === null || l.stuckAt === undefined) return null;
  if (l.hint) return 3;
  return s.end === 'stopped' ? 1 : 2;
}
// Майданчик 9–10, «Чат класу»: я-повідомлення + пояснення
function chatLevel(chat, why) {
  const n = chat.filter(x => x === 'i').length;
  if (n === 3 && why === 'feel') return 3;
  if (n === 2 || n === 3) return 2;
  return 1;
}
function sumCoins(coins) { return coins.reduce((a, b) => a + b, 0); }
function picnic910Points(cart) {
  const n = id => cart[id] || 0; let p = 0;
  if (n('sandwich') >= 3 || n('baton') >= 1) p += 1;
  if (n('juice15') >= 1 || n('juice05') >= 3) p += 1;
  if (n('juice15') >= 1) p += 0.5;
  if (n('baton') >= 1) p += 0.5;
  if (n('promo') === 0) p += 1;
  return p;
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
  if (!ws.size || cats !== foxes) return 1;
  return 2;
}
function radioAvg(answers, ask, g, T) {
  const a = answers.filter(x => typeof x === 'number'); if (!a.length) return null;
  let avg = a.reduce((x, y) => x + y, 0) / a.length;
  if (g === '910' && ask === 'yes') avg += T.askBonus910;
  return avg;
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
  init: () => ({ step: 'intro', fi: 0, ans: [], seen: {}, calm: { n: 0, none: false, endsAt: null }, skip: {} }),
  probeOf: s => (['intro', 'caseIntro', 'frames'].includes(s.step) ? 1 : s.step === 'calmReady' || s.step === 'calm' ? 2 : null),
  canNext: () => true,
  nextLabel: s => (s.step === 'calmReady' ? 'Старт 60 с' : 'Далі'),
  // перехід до кадру i: перед кейсом «показує / відчуває» — екран-пояснення
  goFrame(s, F, i) { s.fi = i; const f = F[i]; if (f.mask && f.fi === 0 && !s.seen[f.ci]) { s.seen[f.ci] = true; s.step = 'caseIntro'; } else s.step = 'frames'; },
  next(S, s, ctx) {
    const F = emFrames(ctx);
    if (s.step === 'intro') ST.emotions.goFrame(s, F, 0);
    else if (s.step === 'caseIntro') s.step = 'frames';
    else if (s.step === 'frames') { if (s.fi < F.length - 1) ST.emotions.goFrame(s, F, s.fi + 1); else s.step = 'calmReady'; }
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
    if (['intro', 'caseIntro', 'frames'].includes(s.step)) { s.skip.p1 = true; s.step = 'calmReady'; }
    else { s.skip.p2 = true; stationDone(S, 'emotions', s); }
  },
  tick(S, s) { if (s.step === 'calm' && s.calm.endsAt && Date.now() >= s.calm.endsAt) { stationDone(S, 'emotions', s); return true; } },
  score(s, ctx) {
    const F = emFrames(ctx), T = ctx.T;
    let p1 = null, p2 = null;
    if (!s.skip.p1) {
      const sc = F.map((f, i) => emoScore(f.ok, s.ans[i] || [])), sum = sc.reduce((a, b) => a + b, 0), share = sum / F.length;
      const miss = F.map((f, i) => ({ f, sc: sc[i], ch: s.ans[i] || [] })).filter(x => x.sc < 1);
      p1 = { level: th(share + 1e-9, T.frames.l3, T.frames.l2), short: `${num(sum)} з ${F.length}`,
        ev: `${num(sum)} з ${F.length} балів за кадри${miss.length ? `; інакше побачено: ${miss.map(x => `«${x.f.caption || x.f.question}» — ${x.ch.length ? x.ch.map(id => CONFIG.emotionNames[id].toLowerCase()).join(', ') : 'без відповіді'}`).join('; ')}` : ''}`,
        raw: { answers: s.ans, scores: sc, sum } };
    }
    if (!s.skip.p2) {
      const n = s.calm.none ? 0 : s.calm.n, t = T.calm[ctx.g];
      p2 = { level: th(n, t.l3, t.l2), short: `${n}`, ev: s.calm.none && !s.calm.n ? 'Способів заспокоїтися не назвала («не знаю»)' : `Способів заспокоїтися за 60 с — ${n}`, raw: { n, none: s.calm.none } };
    }
    return { p1, p2 };
  },
  // коди для «Усіх відповідей»: K1…K6 — кадри, K* — способи
  codes(s, ctx) {
    const F = emFrames(ctx), out = [];
    if (!s.skip.p1) F.forEach((f, i) => {
      const ch = s.ans[i] || [], sc = emoScore(f.ok, ch), nm = a => a.map(id => CONFIG.emotionNames[id]).join(', ');
      out.push(`K${i + 1} ${sc === 1 ? '✅' : sc === 0.5 ? '½' : '❌'} ${ch.length ? nm(ch) : '—'}${sc < 1 ? ` → ${nm(f.ok)}` : ''}`);
    }); else out.push('K пропущено');
    out.push(s.skip.p2 ? 'K* пропущено' : `K* способів: ${s.calm.none ? 0 : s.calm.n}`);
    return out;
  }
};

/* ---------- 2. Сейф — Наполегливість (замок 1 — розминка, замок 2 — оцінюється) ---------- */
ST.safe = {
  init: () => ({ step: 'intro', lock: 0, locks: [], guess: [], startedAt: null, endsAt: null, end: null, stoppedAt: null }),
  makeLock(L) { return { code: shuffle(L.fruits).slice(0, L.slots), attempts: [], hint: null, opened: false, openedAt: null, greens: [], noNew: 0, stuckAt: null, startedAt: Date.now() }; },
  elapsed: s => Math.round((Date.now() - (s.startedAt || Date.now())) / 1000),
  L: (s, ctx) => (s.lock === 0 ? ctx.C.warm : ctx.C.hard),
  probeOf: s => (s.step === 'hard' ? 1 : null),
  canNext: s => s.step === 'intro' || s.step === 'warm',
  nextLabel: s => (s.step === 'warm' ? 'Далі: складніший замок' : 'Далі'),
  next(S, s, ctx) {
    if (s.step === 'intro') { s.step = 'warm'; s.lock = 0; s.locks = [ST.safe.makeLock(ctx.C.warm)]; s.guess = []; }
    else if (s.step === 'warm') { s.step = 'hard'; s.lock = 1; s.locks[1] = ST.safe.makeLock(ctx.C.hard); s.guess = []; s.startedAt = Date.now(); s.endsAt = s.startedAt + ctx.T.hardSec * 1000; }
  },
  finish(S, s, end) { s.end = end; if (end === 'stopped') s.stoppedAt = ST.safe.elapsed(s); stationDone(S, 'safe', s); },
  act: {
    fruit(S, s, f, ctx) {
      if (s.step !== 'warm' && s.step !== 'hard') return false;
      const L = ST.safe.L(s, ctx), lk = s.locks[s.lock];
      if (lk.opened) return false;
      for (let i = 0; i < L.slots; i++) { if (lk.hint && lk.hint.pos === i) continue; if (!s.guess[i]) { s.guess[i] = f; return; } }
      return false;
    },
    erase(S, s, _, ctx) {
      const L = ST.safe.L(s, ctx), lk = s.locks[s.lock]; if (!lk) return false;
      for (let i = L.slots - 1; i >= 0; i--) { if (lk.hint && lk.hint.pos === i) continue; if (s.guess[i]) { s.guess[i] = null; s.corr = (s.corr || 0) + 1; return; } }
      return false;
    },
    check(S, s, _, ctx) {
      if (s.step !== 'warm' && s.step !== 'hard') return false;
      const L = ST.safe.L(s, ctx), lk = s.locks[s.lock]; if (lk.opened) return false;
      const g = Array.from({ length: L.slots }, (_, i) => (lk.hint && lk.hint.pos === i) ? lk.hint.fruit : s.guess[i]);
      if (g.some(x => !x)) return false;
      const at = s.step === 'hard' ? ST.safe.elapsed(s) : Math.round((Date.now() - lk.startedAt) / 1000);
      const fb = wordle(g, lk.code); lk.attempts.push({ guess: g, fb, at }); s.guess = [];
      const newG = fb.map((x, i) => (x === 'green' && !lk.greens.includes(i) ? i : -1)).filter(i => i >= 0);
      if (newG.length) { lk.greens.push(...newG); lk.noNew = 0; } else { lk.noNew++; if (lk.noNew >= ctx.T.stuckAfter && lk.stuckAt === null) lk.stuckAt = at; }
      if (fb.every(x => x === 'green')) { lk.opened = true; lk.openedAt = at; fx(S, 'open'); if (s.step === 'hard') ST.safe.finish(S, s, 'opened'); }
    },
    hint(S, s, _, ctx) {
      if (s.step !== 'warm' && s.step !== 'hard') return false;
      const lk = s.locks[s.lock], L = ST.safe.L(s, ctx); if (lk.hint || lk.opened) return false;
      const cand = Array.from({ length: L.slots }, (_, i) => i).filter(i => !lk.greens.includes(i)); if (!cand.length) return false;
      const pos = cand[rnd(cand.length)]; lk.hint = { pos, fruit: lk.code[pos], at: s.step === 'hard' ? ST.safe.elapsed(s) : null, afterStuck: lk.stuckAt !== null }; s.guess[pos] = null;
    },
    stop(S, s) { if (s.step !== 'hard') return false; ST.safe.finish(S, s, 'stopped'); }
  },
  skipProbe(S, s, ctx) { if (s.step === 'intro' || s.step === 'warm') { if (s.step === 'intro') ST.safe.next(S, s, ctx); ST.safe.next(S, s, ctx); return; } s.end = 'skipped'; stationDone(S, 'safe', s); },
  tick(S, s) { if (s.step === 'hard' && s.endsAt && Date.now() >= s.endsAt) { ST.safe.finish(S, s, 'time'); return true; } },
  score(s, ctx) {
    const lk = s.locks[1];
    if (s.end === 'skipped' || !lk) return { p1: null, p2: null };
    const n = k => `${k} ${pl(k, ['спроба', 'спроби', 'спроб'])}`;
    const tail = s.end === 'time' ? ', до кінця часу' : s.end === 'stopped' ? `, зупинилась на ${fmtTime(s.stoppedAt)}` : '';
    const ev = (lk.opened ? `Складніший замок відкрито: ${n(lk.attempts.length)} (${fmtTime(lk.openedAt)})` : `Складніший замок: ${n(lk.attempts.length)}${tail}`) + (s.locks[0] ? `; розминка — ${n(s.locks[0].attempts.length)}${s.locks[0].opened ? ', відкрито' : ''}` : '');
    const p1 = { level: safeLevel(s, ctx.T), short: lk.opened ? `відкрито, ${n(lk.attempts.length)}` : `${n(lk.attempts.length)}${s.end === 'stopped' ? ', зупинка' : s.end === 'time' ? ', до кінця часу' : ''}`, ev, raw: { end: s.end, stoppedAt: s.stoppedAt, locks: s.locks } };
    const hl = safeHelpLevel(s);
    const p2 = { level: hl, short: hl === null ? 'не застрягала' : lk.hint ? 'попросила підказку' : 'не просила',
      ev: hl === null ? 'Не застрягала (не було 3 спроб поспіль без нового зеленого) — не оцінено' : `Застрягла на ${fmtTime(lk.stuckAt)}; ${lk.hint ? 'попросила підказку' : s.end === 'stopped' ? 'підказку не просила й зупинилась' : 'підказку не просила, продовжувала'}`,
      raw: { stuckAt: lk.stuckAt, hint: lk.hint } };
    return { p1, p2 };
  },
  codes(s) {
    const w = s.locks[0], h = s.locks[1], out = [];
    if (w) out.push(`S1 ${w.attempts.length} спр.${w.opened ? ', відкрито' : ''}`);
    if (s.end === 'skipped' || !h) out.push('S2 пропущено');
    else out.push(`S2 ${h.attempts.length} спр., ${fmtTime(h.opened ? h.openedAt : s.end === 'stopped' ? s.stoppedAt : ST.safe.elapsed(s))}, ${h.hint ? 'підказка' : 'без підказки'}, ${h.opened ? 'відкрито' : s.end === 'stopped' ? 'зупинилась' : 'час вийшов'}${h.stuckAt !== null ? ', застрягла' : ''}`);
    return out;
  }
};

/* ---------- 3. Крамниця — Гроші (сова Ухта) ---------- */
ST.money = {
  init: ctx => (ctx.g === '78'
    ? { step: 'intro', cart: [], t: 0, plate: [], paid: [], owl: 'hello', basket: [], skip: {} }
    : { step: 'intro', cart: {}, q: 0, typed: '', choice: null, answers: [], owl: 'hello', skip: {} }),
  probeOf: s => (s.step === 'intro' || s.step === 'picnic' ? 1 : ['exactIntro', 'exact', 'deal'].includes(s.step) ? 2 : null),
  canNext: s => (s.step === 'exact' ? s.plate.length > 0 : s.step === 'deal' ? (s.choice !== null || s.typed !== '') : true),
  nextLabel: s => (s.step === 'exact' ? 'Заплатити' : 'Далі'),
  spent(s, C, g) { return g === '78' ? s.cart.reduce((a, id) => a + C.goods.find(x => x.id === id).price, 0) : Object.entries(s.cart).reduce((a, [id, n]) => a + n * C.goods.find(x => x.id === id).price, 0); },
  next(S, s, ctx) {
    const C = ctx.C;
    if (s.step === 'intro') { s.step = 'picnic'; s.owl = 'hello'; return; }
    if (s.step === 'picnic') { s.step = ctx.g === '78' ? 'exactIntro' : 'deal'; s.owl = ctx.g === '78' ? 'register' : 'deal'; return; }
    if (s.step === 'exactIntro') { s.step = 'exact'; s.owl = null; return; }
    if (s.step === 'exact') {
      const T = C.targets[s.t], sum = sumCoins(s.plate), exact = sum === T.sum;
      s.paid.push({ target: T.sum, coins: s.plate.slice(), sum, exact }); if (exact) s.basket.push(T.e);
      s.owl = exact ? 'give' : 'thanks'; s.plate = []; s.t++; fx(S, 'coin');
      if (s.t >= C.targets.length) stationDone(S, 'money', s);
      return;
    }
    if (s.step === 'deal') {
      const D = C.deals[s.q], ans = D.type === 'choice' ? s.choice : (s.typed === '' ? null : +s.typed);
      s.answers.push({ q: s.q, answer: ans, ok: ans === D.ok }); s.choice = null; s.typed = ''; s.q++;
      if (s.q >= C.deals.length) stationDone(S, 'money', s);
    }
  },
  act: {
    toggle(S, s, id, ctx) {
      if (s.step !== 'picnic' || ctx.g !== '78') return false;
      const C = ctx.C, k = s.cart.indexOf(id);
      if (k >= 0) { s.cart.splice(k, 1); return; }
      if (C.goods.find(x => x.id === id).price > C.budget - ST.money.spent(s, C, '78')) { fx(S, 'toast', ctx.C.owl.lines.notEnough78); return 'fx'; }
      s.cart.push(id);
    },
    add(S, s, id, ctx) {
      if (s.step !== 'picnic' || ctx.g !== '910') return false;
      const C = ctx.C; if (C.goods.find(x => x.id === id).price > C.budget - ST.money.spent(s, C, '910')) { fx(S, 'toast', ctx.C.owl.lines.notEnough910); return 'fx'; }
      s.cart[id] = (s.cart[id] || 0) + 1;
    },
    remove(S, s, id) { if (s.step !== 'picnic' || !s.cart[id]) return false; s.cart[id]--; if (!s.cart[id]) delete s.cart[id]; },
    coin(S, s, v) { if (s.step !== 'exact' || s.plate.length >= 14) return false; s.plate.push(+v); s.owl = null; },
    uncoin(S, s, i) { if (s.step !== 'exact' || !s.plate.length) return false; s.plate.splice(+i, 1); s.corr = (s.corr || 0) + 1; },
    choose(S, s, a) { if (s.step !== 'deal') return false; s.choice = a; },
    key(S, s, a) { if (s.step !== 'deal') return false; if (a === 'del') s.typed = s.typed.slice(0, -1); else if (s.typed.length < 3) s.typed += a; }
  },
  skipProbe(S, s, ctx) {
    if (s.step === 'intro' || s.step === 'picnic') { s.skip.p1 = true; s.step = ctx.g === '78' ? 'exactIntro' : 'deal'; s.owl = ctx.g === '78' ? 'register' : 'deal'; }
    else { s.skip.p2 = true; stationDone(S, 'money', s); }
  },
  score(s, ctx) {
    const C = ctx.C, T = CONFIG.thresholds.money[ctx.g];
    if (ctx.g === '78') {
      const has = f => s.cart.some(id => C.goods.find(g => g.id === id)[f]), food = has('food'), drink = has('drink');
      const p1 = s.skip.p1 ? null : { level: food && drink ? 3 : (food || drink) ? 2 : 1, short: `їжа ${food ? '✓' : '—'}, вода ${drink ? '✓' : '—'}`,
        ev: `Пікнік: їжа — ${food ? 'так' : 'ні'}, вода — ${drink ? 'так' : 'ні'} (витрачено ${ST.money.spent(s, C, '78')} з ${C.budget} монет; ${s.cart.map(id => C.goods.find(g => g.id === id).name.toLowerCase()).join(', ') || 'нічого'})`, raw: { cart: s.cart, food, drink } };
      const ex = s.paid.filter(x => x.exact).length;
      const p2 = s.skip.p2 || !s.paid.length ? null : { level: th(ex, T.exact.l3, T.exact.l2), short: `${ex} з ${C.targets.length}`,
        ev: `Без решти: точно ${ex} з ${C.targets.length} (${s.paid.map(x => x.exact ? `${x.target} ✔` : `${x.target} → ${x.sum}`).join(', ')})`, raw: { paid: s.paid } };
      return { p1, p2 };
    }
    const pts = picnic910Points(s.cart);
    const p1 = s.skip.p1 ? null : { level: th(pts, T.picnic.l3, T.picnic.l2), short: `${num(pts)} з 4`,
      ev: `Пікнік: ${num(pts)} з 4 балів (витрачено ${ST.money.spent(s, C, '910')} з ${C.budget} грн; ${Object.entries(s.cart).map(([id, n]) => `${C.goods.find(g => g.id === id).name.toLowerCase()} × ${n}`).join(', ') || 'нічого'})`, raw: { cart: s.cart, points: pts } };
    const ok = s.answers.filter(x => x.ok).length, change = s.answers.find(x => C.deals[x.q].type === 'number');
    const p2 = s.skip.p2 || !s.answers.length ? null : { level: th(ok, T.deal.l3, T.deal.l2), short: `${ok} з ${C.deals.length}`,
      ev: `«Що вигідніше?» — ${ok} з ${C.deals.length}${change ? `, решта: ${change.answer ?? '—'}` : ''}`, raw: { answers: s.answers } };
    return { p1, p2 };
  },
  codes(s, ctx) {
    const C = ctx.C, out = [];
    if (ctx.g === '78') {
      const has = f => s.cart.some(id => C.goods.find(g => g.id === id)[f]);
      out.push(s.skip.p1 ? 'C1 пропущено' : `C1 ${has('food') ? '✅' : '❌'} їжа ${has('drink') ? '✅' : '❌'} вода`);
      out.push(s.skip.p2 ? 'C2 пропущено' : `C2 ${s.paid.map((x, i) => `${x.exact ? '✅' : '❌'} ${C.targets[i].acc} ${x.exact ? x.sum : `${x.sum} → ${x.target}`}`).join(', ') || '—'}`);
    } else {
      out.push(s.skip.p1 ? 'C1 пропущено' : `C1 ${num(picnic910Points(s.cart))} б.: ${Object.entries(s.cart).map(([id, n]) => `${C.goods.find(g => g.id === id).name.toLowerCase()}×${n}`).join(', ') || '—'}`);
      out.push(s.skip.p2 ? 'C2 пропущено' : `C2 ${s.answers.map(a => { const D = C.deals[a.q]; return D.type === 'number' ? `${a.ok ? '✅' : '❌'} решта ${a.answer ?? '—'}${a.ok ? '' : ` → ${D.ok}`}` : (a.ok ? '✅' : '❌'); }).join(' ')}`);
    }
    return out;
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
      if (s.tries.length >= (ctx.C.maxTries || 3)) { s.line = 'noDeal'; ST.bob.toBye(s); }
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
// 7–8: Правила (розминка) → Суддя. 9–10: Компроміс (розминка) → Чат класу.
ST.playground = {
  init: () => ({ step: 'intro', marks: [], cards: [], chat: [], ci: 0, why: null, skip: {} }),
  probeOf: s => (['intro', 'rules', 'compromise'].includes(s.step) ? 1 : ['judge', 'chat', 'why'].includes(s.step) ? 2 : null),
  canNext: s => (s.step === 'chat' ? false : s.step === 'why' ? !!s.why : true),
  next(S, s, ctx) {
    if (s.step === 'intro') { s.step = ctx.g === '78' ? 'rules' : 'compromise'; s.cards = []; }
    else if (s.step === 'rules') s.step = 'judge';
    else if (s.step === 'compromise') { s.step = 'chat'; s.ci = 0; }
    else stationDone(S, 'playground', s);
  },
  act: {
    mark(S, s, id) { if (s.step !== 'judge') return false; const k = s.marks.indexOf(id); if (k >= 0) s.marks.splice(k, 1); else s.marks.push(id); },
    card(S, s, id) {
      if (s.step !== 'rules' && s.step !== 'compromise') return false;
      const max = s.step === 'rules' ? 2 : 3, k = s.cards.indexOf(id);
      if (k >= 0) s.cards.splice(k, 1); else { s.cards.push(id); if (s.cards.length > max) s.cards.shift(); }
    },
    // відповідь у чаті: id варіанта ('i' | 'blame'); повідомлення «надсилається», співрозмовник реагує
    reply(S, s, id, ctx) {
      if (s.step !== 'chat') return false;
      s.chat[s.ci] = id; s.ci++; fx(S, 'sent');
      if (s.ci >= ctx.C.chat.messages.length) s.step = 'why';
    },
    why(S, s, id) { if (s.step !== 'why') return false; s.why = id; }
  },
  skipProbe(S, s, ctx) {
    if (['intro', 'rules', 'compromise'].includes(s.step)) { s.skip.p1 = true; s.step = ctx.g === '78' ? 'judge' : 'chat'; s.ci = 0; }
    else { s.skip.p2 = true; stationDone(S, 'playground', s); }
  },
  score(s, ctx) {
    const C = ctx.C, lab = id => CONFIG.codes.judge.items.find(i => i.id === id).label.toLowerCase();
    if (ctx.g === '78') {
      const fair = s.cards.filter(id => C.cards.find(c => c.id === id).fair).length;
      const p1 = s.skip.p1 ? null : { level: fair >= 2 ? 3 : fair === 1 ? 2 : 1, short: `чесних ${fair} з 2`, ev: `Обрані правила: ${s.cards.map(id => `«${C.cards.find(c => c.id === id).text}»`).join(', ') || '—'}; чесних — ${fair} з 2`, raw: { cards: s.cards } };
      const p2 = s.skip.p2 ? null : { level: judgeLevel(s.marks), short: s.marks.length ? s.marks.map(lab).join(', ') : '—', ev: `Суддя: ${s.marks.length ? s.marks.map(lab).join('; ') : 'нічого не відмічено'}`, raw: { marks: s.marks } };
      return { p1, p2 };
    }
    const ws = [...new Set(s.cards.flatMap(id => C.cards.find(c => c.id === id).wishes))];
    const p1 = s.skip.p1 ? null : { level: compromiseLevel(s.cards, C), short: `${ws.length} бажань з 4`,
      ev: `Гра з карток: ${s.cards.map(id => `«${C.cards.find(c => c.id === id).text}»`).join(', ') || '—'}; враховано бажань — ${ws.length} з 4`, raw: { cards: s.cards } };
    const iN = s.chat.filter(x => x === 'i').length, whyL = s.why ? CONFIG.codes.chatWhy.items.find(i => i.id === s.why).label.toLowerCase() : '—';
    const p2 = s.skip.p2 || !s.chat.length ? null : { level: chatLevel(s.chat, s.why), short: `я-повідомлень ${iN} з 3`,
      ev: `Чат класу: я-повідомлень ${iN} з 3, звинувачень ${s.chat.length - iN}; пояснення — ${whyL}`, raw: { chat: s.chat, why: s.why } };
    return { p1, p2 };
  },
  codes(s, ctx) {
    const C = ctx.C, out = [];
    if (ctx.g === '78') {
      out.push(s.skip.p1 ? 'M1 пропущено' : `M1 правила: ${s.cards.map(id => (C.cards.find(c => c.id === id).fair ? '✅' : '❌') + ' ' + C.cards.find(c => c.id === id).text.toLowerCase()).join(', ') || '—'}`);
      out.push(s.skip.p2 ? 'M2 пропущено' : `M2 суддя: ${s.marks.map(id => CONFIG.codes.judge.items.find(i => i.id === id).label.toLowerCase()).join(', ') || '—'}`);
    } else {
      out.push(s.skip.p1 ? 'M1 пропущено' : `M1 компроміс: ${s.cards.join(', ') || '—'} (${compromiseLevel(s.cards, C) === 3 ? 'обидві команди' : 'частково'})`);
      out.push(s.skip.p2 ? 'M2 пропущено' : `M2 чат: ${s.chat.map(x => (x === 'i' ? 'я' : 'звин.')).join(', ')}; ${s.why ? CONFIG.codes.chatWhy.items.find(i => i.id === s.why).label.toLowerCase() : 'без пояснення'}`);
    }
    return out;
  }
};

/* ---------- 7. Радіо Хвиля — Голос і розмова (з «Таємним гостем») ---------- */
ST.radio = {
  init: () => ({ step: 'intro', guest: null, guestMode: null, guestCape: null, qi: 0, answers: [], ask: null, topic: null, marks: [], endsAt: null, running: false, ended: false, skip: {} }),
  probeOf: s => (['intro', 'guest', 'q', 'ask'].includes(s.step) ? 1 : s.step === 'opinion' ? 2 : null),
  canNext: s => (s.step === 'guest' ? !!s.guestMode : s.step === 'q' ? typeof s.answers[s.qi] === 'number' : s.step === 'ask' ? !!s.ask : s.step === 'opinion' ? s.topic !== null : true),
  nextLabel: s => (s.step === 'opinion' && !s.running && !s.ended ? 'Старт 30 с' : 'Далі'),
  next(S, s, ctx) {
    const Q = ctx.C.questions;
    if (s.step === 'intro') s.step = 'guest';
    else if (s.step === 'guest') s.step = 'q';
    else if (s.step === 'q') { if (s.qi < Q.length - 1) s.qi++; else s.step = 'ask'; }
    else if (s.step === 'ask') { if (ctx.g === '910') s.step = 'opinion'; else stationDone(S, 'radio', s); }
    else if (s.step === 'opinion') {
      if (!s.running && !s.ended) { s.running = true; s.endsAt = Date.now() + CONFIG.thresholds.radio.opinionSec * 1000; }
      else stationDone(S, 'radio', s);
    }
  },
  act: {
    // ім’я героя-ведучого (до 30 символів); порожнє ім’я — ще не обрано
    guest(S, s, name) {
      if (s.step !== 'guest') return false;
      const n = String(name || '').trim().slice(0, 30);
      s.guest = n || null; s.guestMode = n ? 'named' : null;
      if (n && s.guestCape === null) s.guestCape = rnd(CONFIG.capes.length);
    },
    noGuest(S, s) { if (s.step !== 'guest') return false; s.guest = null; s.guestMode = 'iskra'; },
    code(S, s, v) { if (s.step !== 'q') return false; s.answers[s.qi] = +v; fx(S, 'thanks'); },
    ask(S, s, v) { if (s.step !== 'ask') return false; s.ask = v; },
    topic(S, s, i) { if (s.step !== 'opinion' || s.running || s.ended) return false; s.topic = +i; },
    mark(S, s, id) { if (s.step !== 'opinion') return false; const k = s.marks.indexOf(id); if (k >= 0) s.marks.splice(k, 1); else s.marks.push(id); }
  },
  skipProbe(S, s, ctx) {
    if (['intro', 'guest', 'q', 'ask'].includes(s.step)) { s.skip.p1 = true; if (ctx.g === '910') s.step = 'opinion'; else stationDone(S, 'radio', s); }
    else { s.skip.p2 = true; stationDone(S, 'radio', s); }
  },
  tick(S, s) { if (s.step === 'opinion' && s.running && Date.now() >= s.endsAt) { s.running = false; s.ended = true; fx(S, 'timer'); return true; } },
  score(s, ctx) {
    const T = CONFIG.thresholds.radio, avg = radioAvg(s.answers, s.ask, ctx.g, T);
    const lab = v => CONFIG.codes.radioAnswer.items.find(i => i.id === v).label.toLowerCase();
    const p1 = s.skip.p1 || avg === null ? null : { level: th(avg + 1e-9, T.avg.l3, T.avg.l2), short: `середнє ${num(avg)}`,
      ev: `Ведучий: ${guestName(s)}. Відповіді: ${s.answers.map(lab).join('; ')}; зустрічне питання — ${s.ask === 'yes' ? 'так' : s.ask === 'no' ? 'ні' : '—'}${ctx.g === '910' && s.ask === 'yes' ? ` (+${num(T.askBonus910)})` : ''}; середнє — ${num(avg)}`,
      raw: { answers: s.answers, ask: s.ask, guest: s.guest } };
    let p2 = null;
    if (ctx.g === '910' && !s.skip.p2 && s.topic !== null && (s.running || s.ended)) {
      const n = s.marks.length, labm = id => CONFIG.codes.radioOpinion.items.find(i => i.id === id).label.toLowerCase();
      p2 = { level: n >= 3 ? 3 : n === 2 ? 2 : 1, short: `${n} з 3`, ev: `Думка за 30 с («${ctx.C.topics[s.topic]}»): ${s.marks.length ? s.marks.map(labm).join(', ') : 'нічого з трьох'}`, raw: { topic: s.topic, marks: s.marks } };
    }
    return { p1, p2, single: ctx.g === '78' };
  },
  codes(s, ctx) {
    const out = [`R гість: ${s.guestMode === 'named' ? s.guest : 'без імені (Іскра)'}`];
    out.push(s.skip.p1 ? 'R1 пропущено' : `R1 відповіді ${s.answers.join(',') || '—'}; зустрічне питання — ${s.ask === 'yes' ? 'так' : s.ask === 'no' ? 'ні' : '—'}`);
    if (ctx.g === '910') out.push(s.skip.p2 ? 'R2 пропущено' : `R2 ${s.marks.map(id => CONFIG.codes.radioOpinion.items.find(i => i.id === id).label.toLowerCase().replace('є ', '')).join(', ') || '—'}`);
    return out;
  }
};
function guestName(s) { return s && s.guestMode === 'named' && s.guest ? s.guest : CONFIG.content.radio.hostIskra; }

/* ---------- Фінал: батарейки за навичками (лише оцінені, по черзі) ---------- */
ST.final = {
  init: (ctx, S) => ({ step: 'batteries', bi: 0, list: selfList(S) }),
  probeOf: () => null,
  canNext: s => s.step === 'batteries',
  next(S, s) {
    if (s.step !== 'batteries') return;
    if (s.bi < s.list.length - 1) { s.bi++; return; }
    s.step = 'crown'; s.done = true; s.t1 = Date.now();
    if (!S.items.includes(CONFIG.costume.final)) S.items.push(CONFIG.costume.final);
    fx(S, 'crown'); S.t.lessonEnd = S.t.lessonEnd || Date.now(); S.phase = 'report';
  },
  act: { self(S, s, n) { const k = s.list[s.bi]; if (!k) return false; const v = +n; S.self[k] = S.self[k] === v ? null : v; if (!S.self[k]) delete S.self[k]; } },
  score: () => null
};
// навички для самооцінки: станція пройдена й не пропущена, у порядку станцій
function selfList(S) { return SKILL_KEYS.filter(k => S.st[k] && S.st[k].done && !S.st[k].skipped); }

/* ---------- коди «Усіх відповідей» для Походу й Боба ---------- */
ST.hike.codes = (s, ctx) => {
  const C = ctx.C;
  if (ctx.g === '78') {
    const needN = s.pack.filter(id => C.items.find(i => i.id === id).need).length, r = C.routes.find(x => x.id === s.route);
    return [s.skip.p1 ? 'P1 пропущено' : `P1 потрібних ${needN}/6 (+${s.pack.length - needN} зайвих)`, s.skip.p2 ? 'P2 пропущено' : `P2 ${r ? r.name.toLowerCase() : '—'}`];
  }
  const v = x => (x ? `${x.v.length} поруш.${x.v.length ? ' (' + x.v.join(', ') + ')' : ''}` : '—');
  return [s.skip.p1 ? 'P1 пропущено' : `P1 ${v(s.plan1)}`, s.skip.p2 ? 'P2 пропущено' : `P2 ${v(s.plan2)}`];
};
ST.bob.codes = (s) => [
  s.skip.p1 ? 'B1 пропущено' : `B1 ${s.askedNeed ? 'спита{в|ла}, що потрібно' : s.hinted && s.via === 'offer' ? 'обмін після натяку' : s.left ? 'Боб пішов' : 'не з’ясува{в|ла}'} (${s.replies.join('→') || '—'})`,
  s.skip.p2 ? 'B2 пропущено' : `B2 ${s.result === 'fair' ? 'чесний обмін' : s.result === 'overpay' ? 'переплата' : 'без обміну'}${s.tries.length ? ' [' + s.tries.join(',') + ']' : ''}${s.haggle ? ', торг: ' + s.haggle : ''}`];

/* =====================================================================
   ДІЇ ПУЛЬТА (змінюють стан)
   ===================================================================== */
function curStation(S) { const key = S.cur; let s = S.st[key]; if (!s) { s = S.st[key] = ST[key].init(ctxOf(S, key), S); s.t0 = Date.now(); s.pt = {}; s.skipProbes = []; s.corr = 0; } return s; }
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
function lessonMinutesExact(S) { return S.t.lessonStart ? ((S.t.lessonEnd || Date.now()) - S.t.lessonStart) / 60000 : null; }
function lessonMinutes(S) { const m = lessonMinutesExact(S); return m === null ? null : Math.max(1, Math.round(m)); }
function stationMinutes(S, k) { const s = S.st[k]; return s && s.t0 && s.t1 ? Math.round((s.t1 - s.t0) / 6000) / 10 : null; }
// з яких 2 навичок почати на курсі і чому (спільне для звіту й таблиці)
// «На що ми звернемо особливу увагу на курсі»: лише «Прокидається» і «Росте» (ніколи «Сильна»).
// Спершу 1, потім 2; при рівності — де самооцінка вища за результат; далі за порядком станцій. Максимум 2.
function pickStart(S, L) {
  const ev = SKILL_KEYS.filter(k => L[k].level && L[k].level < 3);
  const over = k => (S.self[k] || 0) - L[k].level;
  return ev.sort((a, z) => L[a].level - L[z].level || over(z) - over(a) || SKILL_KEYS.indexOf(a) - SKILL_KEYS.indexOf(z)).slice(0, 2)
    .map(k => ({ k, level: L[k].level, why: fill(skillOf(k).focus[L[k].level], { name: S.setup.name || 'Дитина' }) }));
}
// усі оцінені навички — «Сильна»
function allStrong(L) { const ev = SKILL_KEYS.filter(k => L[k].level); return ev.length > 0 && ev.every(k => L[k].level === 3); }
function strongWeak(L) {
  const ev = SKILL_KEYS.filter(k => L[k].level); if (!ev.length) return { strong: [], weak: [], equal: true, ev };
  const lv = ev.map(k => L[k].level), max = Math.max(...lv), mn = Math.min(...lv);
  return { ev, equal: max === mn, strong: ev.filter(k => L[k].level === max), weak: max > mn ? ev.filter(k => L[k].level === mn) : [] };
}

/* ---------------- рядок для Google Таблиці (формат як у НМТ) ---------------- */
const CODE_PREFIX = { emotions: 'K', safe: 'S', money: 'C', hike: 'P', bob: 'B', playground: 'M', radio: 'R' };
function fmtDateTime(t) { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function lc(l) { return CONFIG.levelColors[l || 0]; }
function resultCell(S, k, r) {
  if (!r.level && (r.skipped || r.missing) && !r.p1 && !r.p2) return `${lc(0)} ${CONFIG.report.skippedStation}`;
  const pn = probeNames(k, S.setup.group), parts = [];
  [r.p1, r.single ? undefined : r.p2].forEach((p, i) => { if (p === undefined) return; parts.push(p ? `${lc(p.level)} ${pn[i]}: ${p.short}` : `${lc(0)} ${pn[i]}: ${k === 'safe' && i === 1 ? 'не оцінено' : 'пропущено'}`); });
  return `${lc(r.level)} ${r.level ? CONFIG.levelNames[r.level] : 'Не оцінено'} · ${parts.join('; ')}`;
}
function answersCell(S) {
  return SKILL_KEYS.flatMap(k => { const s = S.st[k];
    if (!s || !s.done || s.skipped) return [`${CODE_PREFIX[k]} пропущено`];
    return ST[k].codes(s, ctxOf(S, k)); }).map(x => tplG(x, S.setup.gender)).join(' | ');
}
function routeCell(S, L) {
  const sw = strongWeak(L), area = k => skillOf(k).area.toLowerCase(), lines = [];
  if (!sw.ev.length) return 'Недостатньо даних для висновку.';
  lines.push(sw.equal ? 'Рівний старт: усі оцінені навички на одному рівні.' : `Сильні: ${sw.strong.map(area).join(', ')}. Зони росту: ${sw.weak.map(area).join(', ')}.`);
  const pk = pickStart(S, L);
  pk.forEach((p, i) => lines.push(`${i + 1}) ${skillOf(p.k).area} — ${p.why}.`));
  if (!pk.length && allStrong(L)) lines.push(fill(CONFIG.report.allStrong, { name: S.setup.name || 'Дитина' }));
  return lines.join('\n');
}
function sheetRecord(S) {
  const L = scoreAll(S), sk = CONFIG.skills, g = S.setup.group, gen = S.setup.gender;
  const headers = ['Дата й час', 'Ім’я', 'Прізвище', 'Вік', 'Вікова група', 'Стать', 'МІК', 'Тривалість, хв',
    ...sk.flatMap(x => [`${x.area} — результат`, `${x.area} — що робити`]),
    'Самооцінка', 'Кількість 🟢', 'Кількість 🟡', 'Кількість 🔴', 'Усі відповіді', 'Загальний висновок / маршрут', 'PDF результату', 'id'];
  const probeLv = SKILL_KEYS.flatMap(k => [L[k].p1 && L[k].p1.level, L[k].p2 && L[k].p2.level]).filter(x => typeof x === 'number');
  const cnt = l => probeLv.filter(x => x === l).length, min = lessonMinutesExact(S);
  const row = [fmtDateTime(S.t.lessonStart || S.date), (S.setup.name || '').trim(), (S.setup.surname || '').trim(), S.setup.age || '',
    g ? CONFIG.groups[g].short : '', gen === 'f' ? 'дівчинка' : gen === 'm' ? 'хлопчик' : '', (S.setup.mik || '').trim(),
    min === null ? '' : Math.round(min * 10) / 10,
    ...sk.flatMap(x => { const r = L[x.key]; return [resultCell(S, x.key, r), r.level ? x.levels[r.level].home.slice(0, 2).map(h => tplG(h, gen)).join(' | ') : '']; }),
    sk.map(x => `${x.area} ${S.self[x.key] ? S.self[x.key] + '/3' : '—'}`).join(' | '),
    cnt(3), cnt(2), cnt(1), answersCell(S), tplG(routeCell(S, L), gen), '', S.id];
  return { headers, row, id: S.id, fileName: `${(S.setup.surname || '').trim()} ${(S.setup.name || '').trim()} — ${fmtDate(S.t.lessonStart || S.date)}.pdf` };
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
  load() { try { const x = JSON.parse(localStorage.getItem(CONFIG.storageKey)); if (x && x.v === 5) return x; } catch (e) { } return null; },
  ping() { this.post({ type: 'ping' }); try { localStorage.setItem(CONFIG.storageKey + '-ping', String(Date.now())); } catch (e) { } },
  hello() { this.post({ type: 'hello' }); try { localStorage.setItem(CONFIG.storageKey + '-hello', String(Date.now())); } catch (e) { } }
};

/* =====================================================================
   САМОТЕСТИ (pult.html?test=1)
   ===================================================================== */
function selfTest() {
  const R = [], eq = (name, got, exp) => R.push({ name, ok: JSON.stringify(got) === JSON.stringify(exp), got: JSON.stringify(got), exp: JSON.stringify(exp) });
  const G = 'green', Y = 'yellow', X = 'grey';
  const mk = (g, cur, gender = 'f') => { const S = freshState(false); Object.assign(S.setup, { name: 'Олеся', surname: 'Іваненко', mik: 'Марія', group: g, age: g === '78' ? 8 : 10, gender }); S.phase = 'lesson'; S.cur = cur; S.t.lessonStart = Date.now() - 27.44 * 60000; curStation(S); return S; };
  // Wordle
  eq('Wordle: усе на місці', wordle(['🍎', '🍌', '🍇'], ['🍎', '🍌', '🍇']), [G, G, G]);
  eq('Wordle: фрукт у середині', wordle(['🍓', '🍌', '🍒'], ['🍎', '🍌', '🍇']), [X, G, X]);
  eq('Wordle: повтор — лише один жовтий', wordle(['🍎', '🍎', '🍌'], ['🍌', '🍇', '🍎']), [Y, X, Y]);
  eq('Wordle: зелений має пріоритет', wordle(['🍎', '🍌', '🍎', '🍎'], ['🍇', '🍌', '🍎', '🍓']), [X, G, G, X]);
  // Кіностудія: нові пороги (частка балів)
  const E = (g, picks) => { const S = mk(g, 'emotions'), F = emFrames(ctxOf(S, 'emotions')); A.next(S);
    F.forEach((f, i) => { if (S.st.emotions.step === 'caseIntro') A.next(S); (picks(f, i) || []).forEach(p => A.act(S, 'pick', p)); A.next(S); });
    A.next(S); A.next(S); return { S, F, sc: ST.emotions.score(S.st.emotions, ctxOf(S, 'emotions')) }; };
  const e1 = E('78', f => [f.ok[0]]);
  eq('Кіно 7–8: 6 кадрів, усі прийнятні → 3', [e1.F.length, e1.sc.p1.level], [6, 3]);
  const e2 = E('78', (f, i) => (i < 4 ? [f.ok[0]] : [])), e3 = E('78', (f, i) => (i < 3 ? [f.ok[0]] : []));
  eq('Кіно 7–8: 4/6 (67%) → 2, 3/6 (50%) → 1', [e2.sc.p1.level, e3.sc.p1.level], [2, 1]);
  const e4 = E('910', f => [f.ok[0]]);
  eq('Кіно 9–10: розминка + 2 кейси = 6 кадрів, 5/6 (83%) → 3', [e4.F.length, th(5 / 6 + 1e-9, 0.83, 0.58), e4.sc.p1.level], [6, 3, 3]);
  eq('Кіно 9–10: перед кейсом-«маскою» є екран-пояснення, спершу «показує»', [e4.S.st.emotions.seen[1], e4.F[2].kind, e4.F[3].kind], [true, 'shows', 'feels']);
  eq('Кіно: актори без котика', [...new Set(e1.F.map(f => f.head).concat(e4.F.flatMap(f => f.heads)))].includes('cat'), false);
  eq('Кадр: бал за 1–2 вибори', [emoScore(['joy'], ['joy']), emoScore(['joy'], ['joy', 'sad']), emoScore(['joy'], ['sad'])], [1, 0.5, 0]);
  // Сейф: два замки, поріг 60 с
  const SF = mk('78', 'safe'), sf = SF.st.safe; A.next(SF);
  eq('Сейф: замок 1 (розминка) 7–8 — 2 місця з 3 фруктів, без таймера', [sf.step, sf.locks[0].code.length, sf.endsAt], ['warm', 2, null]);
  A.next(SF);
  eq('Сейф: замок 2 — 3 з 5, таймер 2,5 хв', [sf.step, sf.locks[1].code.length, Math.round((sf.endsAt - sf.startedAt) / 1000)], ['hard', 3, 150]);
  const code = sf.locks[1].code, other = CONFIG.content.safe['78'].hard.fruits.filter(f => !code.includes(f)), tryG = g => { g.forEach(f => A.act(SF, 'fruit', f)); A.act(SF, 'check'); };
  tryG([other[0], other[1], code[0]]); tryG([other[1], other[0], code[0]]); tryG([other[0], code[0], other[1]]);
  eq('Сейф: «застрягла» на замку 2', sf.locks[1].stuckAt !== null, true);
  A.act(SF, 'hint'); sf.startedAt = Date.now() - 50000; A.act(SF, 'stop');
  const ssf = ST.safe.score(sf, ctxOf(SF, 'safe'));
  eq('Сейф: зупинилась на 50 с (<60) → П1 = 1; застрягла + підказка → П2 = 3', [ssf.p1.level, ssf.p2.level], [1, 3]);
  const T = CONFIG.thresholds.safe, lk = o => Object.assign({ attempts: [1, 2, 3], opened: false, hint: null, stuckAt: null }, o);
  eq('Сейф П1: відкрито / до кінця часу / зупинка ≥60 / <60', [
    safeLevel({ end: 'opened', locks: [lk(), lk({ opened: true })] }, T), safeLevel({ end: 'time', locks: [lk(), lk()] }, T),
    safeLevel({ end: 'stopped', stoppedAt: 61, locks: [lk(), lk()] }, T), safeLevel({ end: 'stopped', stoppedAt: 59, locks: [lk(), lk()] }, T)], [3, 3, 2, 1]);
  eq('Сейф П2: не застрягала → null', safeHelpLevel({ end: 'opened', locks: [lk(), lk()] }), null);
  // Крамниця 7–8
  const M8 = mk('78', 'money'), m8 = M8.st.money; A.next(M8);
  ['sandwich', 'water'].forEach(id => A.act(M8, 'toggle', id));
  eq('Крамниця 7–8: бюджет не дає взяти іграшку', A.act(M8, 'toggle', 'toy'), 'fx');
  A.next(M8); A.next(M8);
  [[5, 2], [5, 2, 1], [5, 5, 2]].forEach(cs => { cs.forEach(c => A.act(M8, 'coin', c)); A.next(M8); });
  const sm8 = ST.money.score(m8, ctxOf(M8, 'money'));
  eq('Крамниця 7–8: їжа й вода → 3; без решти 2 з 3 → 2; товари в кошику', [sm8.p1.level, sm8.p2.level, m8.basket], [3, 2, ['🍪', '🎁']]);
  eq('Крамниця 7–8: три покупки — 7, 9, 12', CONFIG.content.money['78'].targets.map(t => t.sum), [7, 9, 12]);
  // Крамниця 9–10
  const M9 = mk('910', 'money'), m9 = M9.st.money; A.next(M9);
  ['baton', 'juice15'].forEach(id => A.act(M9, 'add', id));
  A.next(M9); A.act(M9, 'choose', 'b'); A.next(M9); A.act(M9, 'choose', 'a'); A.next(M9); A.act(M9, 'key', '3'); A.act(M9, 'key', '7'); A.next(M9);
  const sm9 = ST.money.score(m9, ctxOf(M9, 'money'));
  eq('Крамниця 9–10: батон + сік 1,5 л без акції = 4 → 3; вигода 3/3 з рештою 37 → 3', [sm9.p1.raw.points, sm9.p1.level, sm9.p2.level, m9.answers[2].answer], [4, 3, 3, 37]);
  eq('Крамниця 9–10: 3 сендвічі + 3 соки 0,5 + акція = 2 → 1', [picnic910Points({ sandwich: 3, juice05: 3, promo: 1 }), th(2, 3.5, 2.5)], [2, 1]);
  // Похід
  const HC = CONFIG.content.hike['910'];
  eq('Розклад: план без порушень / після зливи — порушення / перебудований', [hikeViolations({ first: 8, rest: 10, lunch: 12, peak: 13, down: 15 }, HC, false), hikeViolations({ first: 8, rest: 10, lunch: 12, peak: 13, down: 15 }, HC, true), hikeViolations({ first: 8, rest: 10, lunch: 12, peak: 15, down: 17 }, HC, true)], [[], ['rain'], []]);
  // Майданчик: «Чат класу»
  eq('Чат класу: 3 я + почуття → 3; 3 я коротко → 2; 2 я → 2; 1 я → 1', [chatLevel(['i', 'i', 'i'], 'feel'), chatLevel(['i', 'i', 'i'], 'short'), chatLevel(['i', 'blame', 'i'], 'feel'), chatLevel(['i', 'blame', 'blame'], 'feel')], [3, 2, 2, 1]);
  const P9 = mk('910', 'playground'), p9 = P9.st.playground; A.next(P9);
  eq('Майданчик 9–10: перша проба — Компроміс', p9.step, 'compromise');
  ['c1', 'c2', 'c3'].forEach(c => A.act(P9, 'card', c)); A.next(P9);
  eq('Чат: «Далі» вимкнене, поки йде чат', ST.playground.canNext(p9), false);
  ['i', 'i', 'i'].forEach(x => A.act(P9, 'reply', x)); A.act(P9, 'why', 'feel'); A.next(P9);
  const sp9 = ST.playground.score(p9, ctxOf(P9, 'playground'));
  eq('Майданчик 9–10: компроміс 3, чат 3', [sp9.p1.level, sp9.p2.level, p9.done], [3, 3, true]);
  const P8 = mk('78', 'playground'); A.next(P8);
  eq('Майданчик 7–8: спершу Правила, потім Суддя', [P8.st.playground.step, (A.next(P8), P8.st.playground.step)], ['rules', 'judge']);
  eq('Суддя: комбінації відміток', [judgeLevel(['twoPlus']), judgeLevel(['askBoth', 'one']), judgeLevel(['askBoth']), judgeLevel(['side'])], [3, 3, 2, 1]);
  // Радіо: «Таємний гість»
  const RD = mk('78', 'radio'), rd = RD.st.radio; A.next(RD);
  eq('Радіо: без імені «Далі» вимкнене', ST.radio.canNext(rd), false);
  A.act(RD, 'guest', 'Людина-павук і ще дуже-дуже довге ім’я героя');
  eq('Радіо: ім’я гостя обрізане до 30 символів, ведучий — гість', [rd.guest.length <= 30, guestName(rd).startsWith('Людина-павук'), rd.guestCape !== null], [true, true, true]);
  A.next(RD); [3, 2, 2].forEach(v => { A.act(RD, 'code', v); A.next(RD); }); A.act(RD, 'ask', 'yes'); A.next(RD);
  eq('Радіо: ім’я гостя в «Усіх відповідях»', ST.radio.codes(rd, ctxOf(RD, 'radio'))[0], 'R гість: ' + rd.guest);
  const RD2 = mk('910', 'radio'), rd2 = RD2.st.radio; A.next(RD2); A.act(RD2, 'noGuest');
  eq('Радіо: «Без імені» — ведуча Іскра', [ST.radio.canNext(rd2), guestName(rd2)], [true, 'Іскра']);
  const RT = CONFIG.thresholds.radio;
  eq('Радіо: середнє 9–10 з бонусом', [radioAvg([2, 2], 'yes', '910', RT), radioAvg([2, 2], 'yes', '78', RT)], [2.5, 2]);
  // Самооцінка лише для пройдених навичок
  const SS = mk('78', 'emotions'); A.skipStation(SS); A.next(SS); A.next(SS); A.next(SS);
  ['money', 'hike', 'bob', 'playground', 'radio'].forEach(() => { A.skipStation(SS); A.next(SS); });
  SS.st.safe.done = true; SS.st.safe.skipped = false;   // імітуємо пройдений сейф
  delete SS.st.final; SS.cur = 'final'; curStation(SS);
  eq('Самооцінка: лише пройдені навички (без пропущених станцій)', SS.st.final.list, ['safe']);
  A.act(SS, 'self', 2); A.next(SS);
  eq('Самооцінка: одна навичка → одразу корона', [SS.self.safe, SS.st.final.step, SS.phase], [2, 'crown', 'report']);
  // ceilAvg і костюм
  eq('ceilAvg з пропущеними пробами', [ceilAvgN(3, null), ceilAvgN(2, 3), ceilAvgN(null, null)], [3, 3, null]);
  const SI = mk('78', 'emotions'); A.skipStation(SI); A.next(SI); A.skipStation(SI); A.next(SI); A.skipStation(SI);
  eq('Костюм: пропущені станції однаково дають Маску, Щит, Пояс', SI.items, [0, 3, 1]);
  // Рядок таблиці
  const SR = mk('78', 'emotions'); SR.st.emotions = e1.S.st.emotions; SR.st.safe = sf; SR.st.money = m8; SR.st.playground = { done: true, skipped: true };
  SR.self.emotions = 2; SR.self.safe = 3; SR.t.lessonEnd = SR.t.lessonStart + 27.44 * 60000;
  const rec = sheetRecord(SR), col = h => rec.row[rec.headers.indexOf(h)];
  eq('Таблиця: 30 колонок у потрібному порядку', [rec.headers.length, rec.row.length, rec.headers.slice(0, 8), rec.headers[8], rec.headers[9], rec.headers[22], rec.headers.slice(-3)],
    [30, 30, ['Дата й час', 'Ім’я', 'Прізвище', 'Вік', 'Вікова група', 'Стать', 'МІК', 'Тривалість, хв'], 'Емоції — результат', 'Емоції — що робити', 'Самооцінка', ['Загальний висновок / маршрут', 'PDF результату', 'id']]);
  eq('Таблиця: дата дд.мм.рррр гг:хх:сс, ім’я, прізвище, група, тривалість з 1 знаком', [/^\d\d\.\d\d\.\d{4} \d\d:\d\d:\d\d$/.test(col('Дата й час')), col('Ім’я'), col('Прізвище'), col('Вікова група'), col('Тривалість, хв'), col('МІК')], [true, 'Олеся', 'Іваненко', '7–8', 27.4, 'Марія']);
  eq('Таблиця: колір навички й проби', [col('Емоції — результат') === '🟡 Росте · 🟢 Кадри: 6 з 6; 🔴 Способи заспокоїтися: 0', col('Вирішення суперечок — результат')], [true, '⚪ ' + CONFIG.report.skippedStation]);
  eq('Таблиця: «що робити» — 2 рекомендації через « | »', col('Емоції — що робити').split(' | ').length, 2);
  eq('Таблиця: самооцінка', col('Самооцінка').split(' | ').slice(0, 3), ['Емоції 2/3', 'Наполегливість 3/3', 'Гроші —']);
  const L = scoreAll(SR), lvls = SKILL_KEYS.flatMap(k => [L[k].p1 && L[k].p1.level, L[k].p2 && L[k].p2.level]).filter(x => typeof x === 'number');
  eq('Таблиця: лічильники 🟢🟡🔴 по пробах', [col('Кількість 🟢'), col('Кількість 🟡'), col('Кількість 🔴')], [3, 2, 1].map(l => lvls.filter(x => x === l).length));
  const ans = col('Усі відповіді');
  eq('Таблиця: «Усі відповіді» — коди проб', [ans.startsWith('K1 ✅ '), /\| K\* способів: \d/.test(ans), /\| S1 \d+ спр\./.test(ans), /\| S2 \d+ спр\., \d:\d\d, підказка/.test(ans), /\| C1 ✅ їжа ✅ вода/.test(ans), /C2 ✅ печиво в дорогу 7, ❌ квиток на човник 8 → 9/.test(ans), / \| M пропущено/.test(ans)], [true, true, true, true, true, true, true]);
  eq('Таблиця: маршрут — підсумок + 2 навички окремими рядками', col('Загальний висновок / маршрут').split('\n').length, 3);
  eq('Таблиця: назва PDF «Прізвище Ім’я — дата.pdf»', /^Іваненко Олеся — \d\d\.\d\d\.\d{4}\.pdf$/.test(rec.fileName), true);
  // Рекомендації: лише «Прокидається» і «Росте», спершу 1, при рівності — де самооцінка вища за результат
  const LV = o => Object.fromEntries(SKILL_KEYS.map(k => [k, { level: o[k] }]));
  const RS = { setup: { name: 'Оля' }, self: {} };
  const Lmix = LV({ emotions: 3, safe: 3, money: 3, hike: 3, bob: 3, playground: 2, radio: 3 });   // друга «найслабша» — Сильна
  eq('Рекомендації: «Сильна» не потрапляє в блок', pickStart(RS, Lmix).map(p => p.k), ['playground']);
  { const w = pickStart(RS, Lmix)[0].why; eq('Рекомендації: людський текст без шаблону «простір для росту»', [/простір для росту|Рівень «/.test(w), w.startsWith('Оля вже пробує домовлятися')], [false, true]); }
  const Lord = LV({ emotions: 2, safe: 1, money: 2, hike: 3, bob: 2, playground: 3, radio: 3 });
  eq('Рекомендації: спершу «Прокидається», потім «Росте» з вищою самооцінкою', pickStart({ setup: { name: 'Оля' }, self: { emotions: 2, money: 3, bob: 1 } }, Lord).map(p => p.k), ['safe', 'money']);
  const Lall = LV({ emotions: 3, safe: 3, money: 3, hike: 3, bob: 3, playground: 3, radio: 3 });
  eq('Рекомендації: усі «Сильна» — порожній список і текст про складніші завдання', [pickStart(RS, Lall).length, allStrong(Lall), /складніші завдання/.test(CONFIG.report.allStrong)], [0, true, true]);
  eq('Таймінг: разом 30 хв', CONFIG.order.reduce((a, k) => a + CONFIG.locations[k].minutes, 0), 30);
  eq('Рід: підстановка', [tplG('мрія{в|ла}', 'm'), tplG('мрія{в|ла}', 'f')], ['мріяв', 'мріяла']);

  const pass = R.filter(r => r.ok).length, fail = R.length - pass;
  console.log(`%c[САМОТЕСТИ] ${pass}/${R.length} пройдено${fail ? `, ${fail} провалено` : ''}`, `font-weight:bold;color:${fail ? '#c00' : '#1F9D63'}`);
  R.forEach(r => (r.ok ? console.log('  ✔ ' + r.name) : console.error(`  ✘ ${r.name}: отримано ${r.got}, очікувалось ${r.exp}`)));
  if (typeof window !== 'undefined') window.__selftest = { pass, fail, total: R.length, results: R };
  return { pass, fail, total: R.length, results: R };
}
