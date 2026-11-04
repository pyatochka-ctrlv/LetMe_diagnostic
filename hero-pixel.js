/* Піксельний герой «Майстерні суперсил».
   Використання: HeroPixel.render({ style:'b', head:'fox', cape:'#FF5A5F', items:3, scale:8, pop:2 }) → SVG-рядок.
   style: 'a' — герой у білому костюмі (32×42), 'b' — чібі-звірятко (24×30).
   items — кількість деталей костюма (0–7) у порядку ITEMS, або масив індексів. pop — індекс деталі з анімацією (клас "pop").
   HeroPixel.renderHead('fox', 4) → SVG-рядок лише з головою (для екрана вибору героя). */
(function (root) {
  const SIZES = { a:{ W:32, H:42, HX:8, HY:4 }, b:{ W:24, H:30, HX:4, HY:3 } };
  const PAL = {
    o:'#1E2A5A', k:'#1E2A5A', w:'#FFFFFF', p:'#FF8FB1', r:'#E8475B',
    F:'#FF8A3D', c:'#FFE7C7', B:'#33385A', M:'#D9822B', L:'#FFC65C',
    G:'#4CC46A', g:'#A6E8A0', P:'#9B6BFF', q:'#C8AEFF',
    R:'#FF7EB6', Y:'#FFC93C', y:'#E09E1A', T:'#2EC4B6',
    S:'#EEF1FF', u:'#FFE0F0', Z:'#CDD4F0', N:'#26305C', D:'#3A4372', E:'#FF7A59', e:'#CF5537', V:'#B8C1E6'
  };
  const ITEMS = ['Маска', 'Пояс', 'Черевики', 'Щит', 'Плащ', 'Зірка', 'Корона'];
  // Голови 16×14. Очі завжди в рядках 6–7, стовпцях 4–5 і 10–11 — тому маска лягає на будь-якого героя.
  const HEADS = {
    fox: { label:'Лисичка', body:{ main:'F', belly:'c', limb:'F' }, crownY:3, rows:[
      '..FF........FF..','..FFF......FFF..','..FcFF....FFcF..','..FccFFFFFFccF..',
      '..FFFFFFFFFFFF..','.FFFFFFFFFFFFFF.','.FFFkkFFFFkkFFF.','.FFFkwFFFFkwFFF.',
      '.FFFFFFFFFFFFFF.','.ccFFFFFFFFFFcc.','..ccccckkccccc..','...cccccccccc...',
      '....cccccccc....','.....cccccc.....'] },
    panda: { label:'Панда', body:{ main:'w', belly:'w', limb:'B' }, crownY:2, rows:[
      '..BB........BB..','.BBBB......BBBB.','.BBBwwwwwwwwBBB.','..wwwwwwwwwwww..',
      '.wwwwwwwwwwwwww.','.wwBBBwwwwBBBww.','.wBBkkBwwBkkBBw.','.wBBkwBwwBkwBBw.',
      '.wwwwwwwwwwwwww.','.wwwwwwBBwwwwww.','..wwwwkwwkwwww..','...wwwwkkwwwww..',
      '....wwwwwwww....','.....wwwwww.....'] },
    lion: { label:'Левеня', body:{ main:'L', belly:'c', limb:'L' }, crownY:0, rows:[
      '....MMMMMMMM....','..MMMMMMMMMMMM..','.MMMMMMMMMMMMMM.','MMMMLLLLLLLLMMMM',
      'MMMLLLLLLLLLLMMM','MMMLLLLLLLLLLMMM','MMMLkkLLLLkkLMMM','MMMLkwLLLLkwLMMM',
      'MMMLLLLLLLLLLMMM','MMMLLLLppLLLLMMM','.MMLLLkLLkLLLMM.','.MMMLLLkkLLLMMM.',
      '..MMMMMMMMMMMM..','....MMMMMMMM....'] },
    frog: { label:'Жабка', body:{ main:'G', belly:'g', limb:'G' }, crownY:2, rows:[
      '................','...GGG....GGG...','..GGGGG..GGGGG..','.GGGGGGGGGGGGGG.',
      '.GGGGGGGGGGGGGG.','GGGwwwGGGGwwwGGG','GGGwkkGGGGkkwGGG','GGGwkkGGGGkkwGGG',
      'GGGGGGGGGGGGGGGG','GGrrrrrrrrrrrrGG','.GgrrrrrrrrrrgG.','.GGggggggggggGG.',
      '..GGGGGGGGGGGG..','....GGGGGGGG....'] },
    octopus: { label:'Восьминіжка', body:{ main:'P', belly:'q', limb:'P' }, crownY:0, rows:[
      '.....PPPPPP.....','...PPPPPPPPPP...','..PPPPqqPPPPPP..','.PPPqqPPPPPPPPP.',
      '.PPPPPPPPPPPPPP.','PPPPPPPPPPPPPPPP','PPPPkkPPPPkkPPPP','PPPPkwPPPPkwPPPP',
      'PPPPPPPPPPPPPPPP','PPPPPPkPPkPPPPPP','.PPPPPPkkPPPPPP.','.PP.PPPPPPPP.PP.',
      '.P..PPPPPPPP..P.','.....PPPPPP.....'] },
    unicorn: { label:'Єдиноріг', body:{ main:'w', belly:'u', limb:'w' }, crownY:3, hornFront:true, rows:[
      '.......YY.......','......YYY.......','......YY........','..RR.wwwwww.....',
      '.RRYwwwwwwwww...','.RYwwwwwwwwwww..','RYTwkkwwwwkkwww.','RYTwkwwwwwkwwww.',
      'RYTwwwwwwwwwwww.','.YTwwwwwwwppwww.','.TTwwwwwwwwwww..','..Twwwwwwwwww...',
      '...wwwwwwwwww...','.....wwwwww.....'] }
  };
  const STAR = ['..YY..','YYYYYY','.YYYY.','.YYYY.','YY..YY'];
  const STAR_B = ['.YY.','YYYY','.YY.','Y..Y'];
  const CROWN = ['Y..YY..Y','YYYYYYYY','YYYrrYYY'];

  function mix(hex, to, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
    const ch = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
  }

  function grid(o) {
    const style = o.style === 'b' ? 'b' : 'a', { W, H, HX, HY } = SIZES[style];
    const g = Array.from({ length: H }, () => Array(W).fill(null));
    const layer = Array.from({ length: H }, () => Array(W).fill(-1)); // який предмет намалював піксель
    let cur = -1;
    const put = (x, y, ch) => { if (ch && ch !== '.' && x >= 0 && x < W && y >= 0 && y < H) { g[y][x] = ch; layer[y][x] = cur; } };
    const rect = (x, y, w, h, ch) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, ch); };
    const stamp = (x, y, rows) => rows.forEach((r, j) => [...r].forEach((ch, i) => put(x + i, y + j, ch)));
    const has = i => Array.isArray(o.items) ? o.items.includes(i) : (o.items || 0) > i;
    const head = HEADS[o.head] || HEADS.fox;

    if (style === 'a') {
    // плащ (позаду)
    if (has(4)) {
      cur = 4;
      for (let y = 18; y <= 36; y++) {
        const t = (y - 18) / 18, x0 = Math.round(10 - t * 7), x1 = Math.round(21 + t * 7);
        rect(x0, y, x1 - x0 + 1, 1, 'C'); put(x0, y, 'X'); put(x0 + 1, y, 'X'); put(x1, y, 'X'); put(x1 - 1, y, 'X');
      }
      rect(3, 36, 26, 1, 'Y');
    } else {
      cur = -1;
      for (let y = 18; y <= 28; y++) { const d = Math.round((y - 18) / 3); rect(10 - d, y, 12 + 2 * d, 1, 'C'); }
    }
    cur = -1;
    // тіло
    rect(11, 18, 10, 12, 'S'); rect(19, 19, 2, 11, 'Z'); rect(12, 18, 8, 1, 'o');
    rect(8, 19, 2, 7, 'S'); rect(22, 19, 2, 7, 'S'); rect(9, 19, 1, 7, 'Z'); rect(23, 19, 1, 7, 'Z');
    rect(8, 26, 2, 2, 'N'); rect(22, 26, 2, 2, 'N');
    rect(12, 30, 3, 6, 'S'); rect(17, 30, 3, 6, 'S'); rect(14, 30, 1, 6, 'Z'); rect(19, 30, 1, 6, 'Z');
    rect(12, 36, 3, 2, 'D'); rect(17, 36, 3, 2, 'D'); rect(11, 37, 1, 1, 'D'); rect(20, 37, 1, 1, 'D');
    // черевики
    if (has(2)) { cur = 2; rect(11, 33, 4, 5, 'E'); rect(17, 33, 4, 5, 'E'); rect(11, 33, 4, 1, 'e'); rect(17, 33, 4, 1, 'e'); rect(11, 37, 4, 1, 'e'); rect(17, 37, 4, 1, 'e'); }
    // пояс
    if (has(1)) { cur = 1; rect(11, 27, 10, 1, 'Y'); rect(11, 28, 10, 1, 'y'); rect(14, 27, 4, 2, 'w'); rect(15, 27, 2, 2, 'Y'); }
    // зірка
    if (has(5)) { cur = 5; stamp(13, 20, STAR); }
    // щит
    if (has(3)) {
      cur = 3;
      rect(23, 21, 7, 7, 'w'); rect(24, 28, 5, 1, 'w'); rect(25, 29, 3, 1, 'w'); put(26, 30, 'w');
      rect(26, 22, 1, 7, 'C'); rect(24, 24, 5, 1, 'C');
    }
    // проміжки між руками й тулубом — щоб автоконтур їх відділив
    for (let y = 18; y <= 27; y++) { g[y][10] = null; g[y][21] = null; }
    } else {
    const b = head.body;
    // плащ (позаду) або шарфик кольору плаща
    if (has(4)) {
      cur = 4;
      for (let y = 17; y <= 27; y++) {
        const t = (y - 17) / 10, x0 = Math.round(7 - t * 5), x1 = Math.round(16 + t * 5);
        rect(x0, y, x1 - x0 + 1, 1, 'C'); put(x0, y, 'X'); put(x1, y, 'X');
      }
      rect(2, 28, 20, 1, 'Y');
    }
    cur = -1;
    // тіло звірятка
    rect(7, 17, 10, 8, b.main); rect(9, 18, 6, 6, b.belly);
    rect(4, 18, 2, 6, b.limb); rect(18, 18, 2, 6, b.limb);
    rect(8, 25, 3, 3, b.limb); rect(13, 25, 3, 3, b.limb); put(7, 27, b.limb); put(16, 27, b.limb);
    if (!has(4)) { cur = -1; rect(8, 17, 8, 1, 'C'); put(9, 18, 'C'); }
    if (has(2)) { cur = 2; rect(7, 25, 4, 3, 'E'); rect(13, 25, 4, 3, 'E'); rect(7, 25, 4, 1, 'e'); rect(13, 25, 4, 1, 'e'); }
    if (has(1)) { cur = 1; rect(7, 23, 10, 1, 'Y'); rect(7, 24, 10, 1, 'y'); rect(10, 23, 4, 2, 'w'); rect(11, 23, 2, 2, 'Y'); }
    if (has(5)) { cur = 5; stamp(10, 19, STAR_B); }
    if (has(3)) {
      cur = 3;
      rect(18, 18, 5, 5, 'w'); rect(19, 23, 3, 1, 'w'); put(20, 24, 'w');
      rect(20, 19, 1, 4, 'C'); rect(19, 20, 3, 1, 'C');
    }
    for (let y = 17; y <= 24; y++) { g[y][6] = null; g[y][17] = null; }
    }
    // корона: у єдинорога позаду голови (ріг попереду), в інших — поверх
    if (has(6) && head.hornFront) { cur = 6; stamp(HX + 4, HY + head.crownY - 3, CROWN); }
    // голова
    cur = -1; stamp(HX, HY, head.rows);
    if (has(6) && !head.hornFront) { cur = 6; stamp(HX + 4, HY + head.crownY - 3, CROWN); }
    // маска
    if (has(0)) {
      cur = 0;
      rect(HX + 3, HY + 5, 10, 1, 'N'); rect(HX + 2, HY + 6, 12, 2, 'N');
      rect(HX + 4, HY + 6, 2, 2, 'w'); rect(HX + 10, HY + 6, 2, 2, 'w'); put(HX + 5, HY + 7, 'k'); put(HX + 10, HY + 7, 'k');
      put(HX + 14, HY + 7, 'N'); put(HX + 15, HY + 8, 'N');
    }
    // автоконтур
    cur = -1;
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x]) continue;
      const n = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx, dy]) => (g[y + dy] || [])[x + dx]).filter(Boolean);
      if (n.length) out.push([x, y]);
    }
    out.forEach(([x, y]) => { g[y][x] = 'o'; });
    return { g, layer, W, H };
  }

  function render(o = {}) {
    const cape = o.cape || '#FF5A5F', s = o.scale || 6, { g, layer, W, H } = grid(o);
    const col = ch => ch === 'C' ? cape : ch === 'X' ? mix(cape, '#1E2A5A', 0.28) : PAL[ch];
    const groups = { base: '' };
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const ch = g[y][x]; if (!ch) { x++; continue; }
        const L = o.pop !== undefined && layer[y][x] === o.pop ? 'pop' : 'base';
        let n = 1; while (x + n < W && g[y][x + n] === ch && (o.pop === undefined || (layer[y][x + n] === o.pop) === (L === 'pop'))) n++;
        groups[L] = (groups[L] || '') + `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${col(ch)}"/>`;
        x += n;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * s}" height="${H * s}" shape-rendering="crispEdges" role="img" aria-label="Герой">` +
      groups.base + (groups.pop ? `<g class="pop">${groups.pop}</g>` : '') + '</svg>';
  }

  // Лише голова (16×14 + контур) — для вибору героя
  function renderHead(name, s = 4) {
    const head = HEADS[name] || HEADS.fox, W = 18, H = 16;
    const g = Array.from({ length: H }, () => Array(W).fill(null));
    head.rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') g[j + 1][i + 1] = ch; }));
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x]) continue;
      if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => (g[y + dy] || [])[x + dx])) out.push([x, y]);
    }
    out.forEach(([x, y]) => { g[y][x] = 'o'; });
    let rects = '';
    for (let y = 0; y < H; y++) { let x = 0; while (x < W) { const ch = g[y][x]; if (!ch) { x++; continue; } let n = 1; while (x + n < W && g[y][x + n] === ch) n++; rects += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${PAL[ch]}"/>`; x += n; } }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * s}" height="${H * s}" shape-rendering="crispEdges" role="img" aria-label="${head.label}">${rects}</svg>`;
  }

  root.HeroPixel = { render, renderHead, HEADS, ITEMS, SIZES };
})(typeof window !== 'undefined' ? window : globalThis);
