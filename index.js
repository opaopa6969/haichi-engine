// haichi-engine — 配置エンジン。
//
// 設計契約:
//   - 入力は「大きさを持つもの」と「つながり」だけ。**何であるかを知らない**。
//     クラスでも、すごろくのマスでも、UI パネルでも、麻雀卓の席でも同じに扱う。
//   - 出力は座標と、その配置が読めるかどうかの**測定値**。描画はしない（DOM も canvas も触らない）。
//   - 決定論的。同じ入力からは必ず同じ座標が出る。乱数を使う関数は seed を必ず取る。
//   - 依存ゼロ。
//
// 「配置」と「読めるか」を分けているのが要点。座標を出す道具は世に多いが、
// **出した配置が読めるかを測る**道具は少なく、そこが実際に事故を生む。
//
//   import { pack, tree, treemap, relax, placeLabels, measure } from 'haichi-engine';

// ---------------------------------------------------------------- 共通

/** 決定論的な擬似乱数（mulberry32）。seed を渡さない関数は作らない */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sq = (x) => x * x;
/** 円どうしの重なり量（正なら重なっている） */
export const circleOverlap = (a, b, gap = 0) => a.r + b.r + gap - Math.hypot(a.x - b.x, a.y - b.y);
/** 矩形どうしの重なり量（x,y は中心）。負なら離れている */
export const rectOverlap = (a, b, gap = 0) =>
  Math.min((a.w + b.w) / 2 + gap - Math.abs(a.x - b.x), (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y));

/**
 * 形が違うものどうしの重なり量。円は「幅も高さも 2r の矩形」ではないので、
 * 混在すると矩形判定に落ちて誤る（同心の r=10 円と 20x20 矩形を「重なり 0」と答えていた）。
 * 円×矩形は、矩形上の最近点と中心の距離で測る。
 */
export function overlapOf(a, b, gap = 0) {
  const aC = a.r != null, bC = b.r != null;
  if (aC && bC) return circleOverlap(a, b, gap);
  if (!aC && !bC) return rectOverlap(a, b, gap);
  const c = aC ? a : b, q = aC ? b : a;
  const nx = Math.max(q.x - q.w / 2, Math.min(c.x, q.x + q.w / 2));
  const ny = Math.max(q.y - q.h / 2, Math.min(c.y, q.y + q.h / 2));
  return c.r + gap - Math.hypot(c.x - nx, c.y - ny);
}

/** 全角を 1.75 文字ぶんで数える文字幅（等幅でない前提の粗い見積り） */
export function textWidth(str, cw) {
  let acc = 0;
  for (const ch of String(str ?? '')) acc += ch.charCodeAt(0) > 255 ? cw * 1.75 : cw;
  return acc;
}
/** 幅に収まるところまで切り、入らなければ末尾を削って「…」のぶんを空ける */
export function fitText(str, width, cw) {
  const w = (ch) => (ch.charCodeAt(0) > 255 ? cw * 1.75 : cw);
  const ELL = cw * 1.75;
  let acc = 0, out = '';
  for (const ch of String(str ?? '')) {
    if (acc + w(ch) > width) {
      while (out && acc + ELL > width) { acc -= w(out[out.length - 1]); out = out.slice(0, -1); }
      // 「…」1 文字すら入らない幅なら、何も返さない（1 文字だけ出しても意味がない）
      return acc + ELL <= width ? out + '…' : '';
    }
    acc += w(ch); out += ch;
  }
  return out;
}

// ---------------------------------------------------------------- 配置

/**
 * 円詰め。入れ子（children）を再帰的に詰める。
 * items: [{ id, value?, children?[] }]  value は面積の重み（省略は 1）
 * → Map<id, { x, y, r, depth, parent }>
 * d3-hierarchy の pack と違い、依存を持たず、決定論的で、入れ子の padding を関数で変えられる。
 */
export function pack(items, { size = 1000, padding = () => 4, seed = 1 } = {}) {
  const out = new Map();
  const rand = rng(seed);
  const radiusOf = (n) => Math.sqrt(Math.max(1, n.value ?? 1));

  const layoutGroup = (nodes, depth) => {
    // 子を先に詰めて自分の半径を決める（葉から親へ）
    const laid = nodes.map((n) => {
      const g = n.children?.length ? layoutGroup(n.children, depth + 1) : null;
      const r = g ? g.r + padding(depth) : radiusOf(n);
      return { n, r, kids: g?.map ?? null };
    });
    // 大きい順に、既存の円に接するよう外周へ配置する（front-chain の簡易版）
    laid.sort((a, b) => b.r - a.r);
    const placed = [];
    for (const it of laid) {
      if (!placed.length) { it.x = 0; it.y = 0; placed.push(it); continue; }
      if (placed.length === 1) { it.x = placed[0].r + it.r + padding(depth); it.y = 0; placed.push(it); continue; }
      // 既存の 2 円に外接する点を候補にし、他と重ならず中心に最も近いものを選ぶ
      let best = null;
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
        for (const p of tangentPoints(placed[i], placed[j], it.r, padding(depth))) {
          if (placed.some((q) => circleOverlap({ ...p, r: it.r }, q, padding(depth) * 0.5) > 1e-6)) continue;
          const d = Math.hypot(p.x, p.y);
          if (!best || d < best.d) best = { ...p, d };
        }
      }
      if (!best) { // 見つからなければ外周に逃がす（決定論的に角度を進める）
        const a = rand() * Math.PI * 2;
        const R = Math.max(...placed.map((q) => Math.hypot(q.x, q.y) + q.r)) + it.r + padding(depth);
        best = { x: Math.cos(a) * R, y: Math.sin(a) * R };
      }
      it.x = best.x; it.y = best.y; placed.push(it);
    }
    // 全体を包む半径
    const R = Math.max(1e-6, ...placed.map((p) => Math.hypot(p.x, p.y) + p.r));
    // **局所の Map を返す**。共有の out を返すと、子を親の座標へ平行移動する処理が
    // すでに置いた全ノードに掛かり、parent も全部同じ id で上書きされる
    const map = new Map();
    for (const it of placed) {
      map.set(it.n.id, { x: it.x, y: it.y, r: it.r, depth, parent: null, node: it.n });
      if (it.kids) for (const [id, c] of it.kids) map.set(id, { ...c, x: c.x + it.x, y: c.y + it.y, parent: c.parent ?? it.n.id });
    }
    return { r: R, map };
  };

  const root = layoutGroup(items, 0);
  for (const [id, c] of root.map) out.set(id, c);
  // 中心を size/2 に寄せて正の座標にする
  const k = root.r > 0 ? (size / 2 - 8) / root.r : 1;
  for (const [id, c] of out) out.set(id, { ...c, x: c.x * k + size / 2, y: c.y * k + size / 2, r: c.r * k });
  return out;
}

/** 2 円それぞれに外接する半径 r の円の中心（0〜2 点） */
function tangentPoints(a, b, r, gap) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const ra = a.r + r + gap, rb = b.r + r + gap;
  if (d > ra + rb || d < Math.abs(ra - rb) || d === 0) return [];
  const t = (sq(d) + sq(ra) - sq(rb)) / (2 * d);
  const h2 = sq(ra) - sq(t);
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const mx = a.x + ux * t, my = a.y + uy * t;
  return [{ x: mx - uy * h, y: my + ux * h }, { x: mx + uy * h, y: my - ux * h }];
}

/**
 * 階層レイアウト（Reingold-Tilford の簡易版）。親を子の中央に置く。
 * → Map<id, { x, y, depth, parent }>
 */
export function tree(items, { nodeGap = 60, levelGap = 120 } = {}) {
  const out = new Map();
  let cursor = 0;
  const walk = (n, depth, parent) => {
    let x;
    if (n.children?.length) {
      const xs = n.children.map((c) => walk(c, depth + 1, n.id));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    } else { x = cursor; cursor += nodeGap; }
    out.set(n.id, { x, y: depth * levelGap, depth, parent, node: n });
    return x;
  };
  for (const it of items) { walk(it, 0, null); cursor += nodeGap; }
  return out;
}

/**
 * squarified treemap。街区を作る用途（zumen の CodeCity、すごろくの盤面など）。
 * → Map<id, { x, y, w, h, depth, parent }>（x,y は中心）
 */
export function treemap(items, { x = 0, y = 0, w = 1000, h = 1000, padding = 4, depth = 0, parent = null } = {}) {
  const out = new Map();
  const total = items.reduce((a, n) => a + Math.max(1e-9, n.value ?? 1), 0);
  if (!items.length || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  const rest = items.map((n) => ({ n, a: Math.max(1e-9, n.value ?? 1) * scale })).sort((p, q) => q.a - p.a);
  let X = x, Y = y, W = w, H = h;
  while (rest.length) {
    const vertical = W >= H;
    const side = vertical ? H : W;
    const row = [];
    let sum = 0, best = Infinity;
    while (rest.length) {
      const next = sum + rest[0].a;
      const ratio = worst([...row.map((r) => r.a), rest[0].a], next, side);
      if (row.length && ratio > best) break;
      best = ratio; sum = next; row.push(rest.shift());
    }
    const thick = sum / side;
    let off = vertical ? Y : X;
    for (const r of row) {
      const len = r.a / thick;
      const bx = vertical ? X : off, by = vertical ? off : Y;
      const bw = vertical ? thick : len, bh = vertical ? len : thick;
      out.set(r.n.id, { x: bx + bw / 2, y: by + bh / 2, w: Math.max(0, bw - padding), h: Math.max(0, bh - padding), depth, parent, node: r.n });
      if (r.n.children?.length) for (const [id, c] of treemap(r.n.children, { x: bx + padding, y: by + padding, w: bw - padding * 2, h: bh - padding * 2, padding: padding * 0.6, depth: depth + 1, parent: r.n.id })) out.set(id, c);
      off += len;
    }
    if (vertical) { X += thick; W -= thick; } else { Y += thick; H -= thick; }
  }
  return out;
}
const worst = (areas, sum, side) => {
  const t = sq(sum / side);
  return Math.max(...areas.map((a) => Math.max((t * a) / sq(sum) * side * side / a / a * a, a / t)));
};

/**
 * 重なり解消（緩和）。ゲームの broad phase と同じで、重なった対を押し離すだけ。
 * items: [{ id, x, y, r }] か [{ id, x, y, w, h }]
 * 位置を動かしたくないものは pinned に id を入れる。
 */
export function relax(items, opts = {}) {
  const { gap = 2, iterations = 60, strength = 0.5, pinned = new Set(), axis = 'xy', maxMove = Infinity, grid = 0, bounds = null } = opts;
  const a = items.map((it) => ({ ...it, _ox: it.x, _oy: it.y }));
  for (let k = 0; k < iterations; k++) {
    let moved = 0;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const p = a[i], q = a[j];
      const ov = overlapOf(p, q, gap);
      if (ov <= 0) continue;
      let dx = q.x - p.x, dy = q.y - p.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-9) {
        // **完全に同じ位置**だと方向が決まらず、何度回しても動かない（netmahg の指摘）。
        // id から決まる角度に逃がす。乱数ではないので同じ入力なら同じ結果になる
        const a = hashAngle(`${p.id}|${q.id}`);
        dx = Math.cos(a); dy = Math.sin(a); d = 1;
      }
      dx /= d; dy /= d;
      const push = (ov * strength) / 2;
      // axis で動かせる向きを制限する（3D 側に moveY があるのに 2D に軸ロックが
      // 無いのは非対称だという指摘）。maxMove は元位置からの距離を縛る
      const kx = axis === 'y' ? 0 : 1, ky = axis === 'x' ? 0 : 1;
      if (!pinned.has(p.id)) { p.x -= dx * push * kx; p.y -= dy * push * ky; moved += push; }
      if (!pinned.has(q.id)) { q.x += dx * push * kx; q.y += dy * push * ky; moved += push; }
      if (bounds) for (const it of [p, q]) clampToBounds(it, bounds);
      if (maxMove < Infinity) for (const it of [p, q]) {
        const d2 = Math.hypot(it.x - it._ox, it.y - it._oy);
        if (d2 > maxMove) { const k = maxMove / d2; it.x = it._ox + (it.x - it._ox) * k; it.y = it._oy + (it.y - it._oy) * k; }
      }
    }
    if (moved < 0.01) break;
  }
  // 領域の外へ押し出して重なりを消す、という解は解決ではない（netmahg の指摘）。
  // bounds を渡されたら毎回引き戻す。入りきらないなら重なったまま残り、measure が報告する
  if (grid > 0) for (const it of a) { it.x = Math.round(it.x / grid) * grid; it.y = Math.round(it.y / grid) * grid; }
  for (const it of a) { delete it._ox; delete it._oy; }
  return new Map(a.map((it) => [it.id, it]));
}

/**
 * ラベル配置。図形の中に入るなら中、入らないなら周囲 8 方向のうち他と重ならない場所へ。
 * どこにも置けなければ hidden: true を返す（**出さない判断も配置の一部**）。
 * shapes: [{ id, x, y, r? , w?, h?, label, font }]
 */
export function placeLabels(shapes, opts = {}) {
  const { minFont = 9, gap = 2, cw = 0.55, prefer = 'auto', allowInside = true, dirOrder = null } = opts;
  const out = new Map();
  const taken = [];
  // 方向の優先順。ゲームによっては「下→上→右→左」のような決まりがあるので差し替えられる
  const DIRS = dirOrder ?? [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  // 大きいものから置く。priority があればそちらを優先する（重要なラベルを先に確保する）
  const order = [...shapes].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.r ?? Math.max(b.w, b.h) / 2) - (a.r ?? Math.max(a.w, a.h) / 2));
  for (const s of order) {
    const font = s.font ?? 12;
    if (font < minFont) { out.set(s.id, { hidden: true, why: `font ${font.toFixed(1)}px < ${minFont}px` }); continue; }
    const inner = s.r != null ? s.r * 2 - 6 : s.w - 6;
    // **内に入るかは「切り詰める前の全長」で決める。**
    // 切り詰めた文字で判定すると、fitText が返した「…」が常に内に収まってしまい、
    // 外周 8 方向を一度も試さなくなる（tetsugo の 616 駅が全部「…」になった）
    const fullW = textWidth(s.label, font * cw);
    const fitsInside = allowInside && prefer !== 'outside' && fullW <= inner;
    const th = font * 1.2;
    const ext = s.r != null ? s.r : Math.max(s.w, s.h) / 2;
    const cands = [];
    if (fitsInside) cands.push({ dx: 0, dy: 0, text: s.label, tw: fullW, at: 'inside' });
    for (const [dx, dy] of DIRS) cands.push({ dx, dy, text: s.label, tw: fullW, at: 'outside' });
    let placed = null;
    for (const c of cands) {
      const x = s.x + c.dx * (ext + c.tw / 2 + gap), y = s.y + c.dy * (ext + th / 2 + gap);
      const box = { x, y, w: c.tw, h: th };
      if (taken.some((t) => rectOverlap(box, t, gap) > 0)) continue;
      placed = { ...box, text: c.text, font, at: c.at };
      break;
    }
    if (!placed) { out.set(s.id, { hidden: true, why: `${cands.length} 方向すべてが埋まっている` }); continue; }
    taken.push(placed);
    out.set(s.id, placed);
  }
  return out;
}

// ---------------------------------------------------------------- 測定

/**
 * 配置が読めるかを測る。**メッセージには必ず実測値・閾値・直し方を入れる**
 * （読むのは人か LLM で、メッセージだけを見て直せないと意味がない）。
 * shapes: [{ id, x, y, r?|w,h, label?, font? }]  edges: [{ from, to }]
 * → { problems: [{ code, id, message }], metrics: {...} }
 */
export function measure(shapes, edges = [], opts = {}) {
  const { minFont = 9, gap = 2, cw = 0.55 } = opts;
  const problems = [];
  const by = new Map(shapes.map((s) => [s.id, s]));
  const ext = (s) => (s.r != null ? s.r : Math.max(s.w, s.h) / 2);

  // H101 図形の重なり。**入れ子は重なりではない**（親の中に子がいるのは正しい姿）ので、
  // parent が同じ図形どうしだけを比べる。parent を渡さない使い方なら全対を比べる。
  let overlaps = 0;
  const groups = new Map();
  for (const s of shapes) { const k = s.parent ?? '\u0000'; (groups.get(k) ?? groups.set(k, []).get(k)).push(s); }
  for (const [, g] of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i], b = g[j];
    const ov = overlapOf(a, b, gap);
    if (ov > 0.5) { overlaps++; if (problems.length < 500) problems.push({ code: 'H101', id: a.id, message: `${a.id} と ${b.id} が ${ov.toFixed(1)}px 重なっている（必要な隙間 ${gap}px）— どちらかを小さくするか relax() で押し離す` }); }
  }

  // H102 ラベルがはみ出す / H103 文字が小さすぎる
  // **labelBox を渡されたら、そのラベルは図形の外に置かれている**とみなす。
  // 外置きは「はみ出す」概念が無いので H102 は見ず、H101（ラベル同士の重なり）と
  // H108（辺が横切る）の対象にする。これが無いと、外にラベルを置く現実の配置を
  // 影の図形に変換しないと測れなかった（tetsugo の指摘）。
  let unreadable = 0, overflow = 0, truncated = 0;
  for (const s of shapes) {
    if (!s.label) continue;
    const font = s.font ?? 12;
    if (font < minFont) { unreadable++; problems.push({ code: 'H103', id: s.id, message: `${s.id} のラベルが ${font.toFixed(1)}px（読める最小 ${minFont}px）— 図形を大きくするか、この深さでは出さない` }); continue; }
    if (s.labelBox) continue;   // 外置きは、はみ出しようがない
    const inner = s.r != null ? s.r * 2 - 6 : s.w - 6;
    const cut = fitText(s.label, inner, font * cw);
    const full = textWidth(s.label, font * cw);
    // 「…」だけ残っても情報はゼロ。合格にすると「駅名が全部…になった図」を
    // 問題なしと報告することになる（tetsugo で実際に起きた）
    if (!cut || cut === '…') {
      // 切り詰めても「…」すら入らない＝この大きさでは名前を出せない。
      // 「はみ出す」ではなく「出せない」なので別の直し方になる
      overflow++;
      problems.push({ code: 'H102', id: s.id, message: `${s.id} のラベル「${s.label}」は使える幅 ${inner.toFixed(0)}px に 1 文字も入らない（必要 ${full.toFixed(0)}px）— 図形を広げるか、placeLabels() で外に出すか、この深さでは名前を出さない` });
      continue;
    }
    if (cut !== s.label) truncated++;   // 読める形には収まったが、情報は落ちている
    const tw = textWidth(cut, font * cw);
    if (tw > inner + 0.5) { overflow++; problems.push({ code: 'H102', id: s.id, message: `${s.id} のラベル「${s.label}」が ${(tw - inner).toFixed(1)}px はみ出す（文字 ${tw.toFixed(0)}px > 使える幅 ${inner.toFixed(0)}px）— fitText() を通すか図形を広げる` }); }
  }

  // H111 ラベルの大半が切り詰められている。1〜2 個なら普通のことだが、
  // 過半が「…」付きなら、その深さで名前を出す設計自体が合っていない
  const labeled = shapes.filter((s) => s.label && (s.font ?? 12) >= minFont).length;
  if (labeled >= 4 && truncated / labeled > 0.5) {
    problems.push({ code: 'H111', id: '(全体)', message: `${truncated}/${labeled} のラベルが切り詰められている（${Math.round(truncated / labeled * 100)}%、目安 50% 以下）— 図形を大きくするか、placeLabels() で外に出すか、この深さでは名前を出さない` });
  }

  // H104 辺の交差（多いほど追えない）
  const segs = edges.map((e) => { const a = by.get(e.from), b = by.get(e.to); return a && b ? { a, b, w: e.weight ?? 1 } : null; }).filter(Boolean);
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (segs[i].a === segs[j].a || segs[i].a === segs[j].b || segs[i].b === segs[j].a || segs[i].b === segs[j].b) continue;
    if (segsCross(segs[i].a, segs[i].b, segs[j].a, segs[j].b)) crossings++;
  }
  const maxCross = Math.max(1, (segs.length * (segs.length - 1)) / 2);
  if (segs.length > 4 && crossings / maxCross > 0.15) problems.push({ code: 'H104', id: '(全体)', message: `辺の交差が ${crossings} 本（全対の ${(crossings / maxCross * 100).toFixed(0)}%、目安 15% 以下）— 階層レイアウトにするか辺を間引く` });

  // H105 辺が無関係な図形を貫く
  let pierces = 0;
  const ancestors = (s) => { const out = new Set(); let cur = s?.parent; let guard = 0; while (cur && guard++ < 32) { out.add(cur); cur = by.get(cur)?.parent; } return out; };
  for (const { a, b } of segs) { const skip = new Set([a.id, b.id, ...ancestors(a), ...ancestors(b)]);
  for (const s of shapes) {
    if (skip.has(s.id)) continue;
    if (segCircleHit(a, b, s, ext(s))) { pierces++; break; }
  } }
  if (pierces) problems.push({ code: 'H105', id: '(全体)', message: `${pierces} 本の辺が無関係な図形を貫いている — 直交ルーティングにするか図形を動かす` });

  // H106 極端な縦横比
  const xs = shapes.map((s) => s.x), ys = shapes.map((s) => s.y);
  const W = Math.max(...xs) - Math.min(...xs) || 1, H = Math.max(...ys) - Math.min(...ys) || 1;
  const ar = W / H;
  // 手牌やツールバーのように「一列に並べてスクロールさせる」のが正しい用途もあるので、
  // scrollable を渡されたら責めない（netmahg の指摘: 正しい一列手牌に 522:1 と警告した）
  if (!opts.scrollable && shapes.length > 3 && (ar > 6 || ar < 1 / 6)) problems.push({ code: 'H106', id: '(全体)', message: `縦横比が ${ar.toFixed(1)}:1 で極端 — 画面に収めると読めなくなる。段組みにするか、意図した一列なら scrollable:true を渡す` });

  // H107 浅い角度の交差。Purchase らの実験では、交差の「数」より
  // 「角度」が読みやすさを左右する。直角に近い交差は目で追えるが、浅い交差は線が分岐して見える。
  let shallow = 0, minAngle = 180;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
    if (!segsCross(A.a, A.b, B.a, B.b)) continue;
    const ang = crossAngle(A.a, A.b, B.a, B.b);
    minAngle = Math.min(minAngle, ang);
    if (ang < 20) shallow++;
  }
  if (shallow) problems.push({ code: 'H107', id: '(全体)', message: `${shallow} 組の辺が ${minAngle.toFixed(0)}° という浅い角度で交差している（目安 20° 以上）— 交差の数より角度の方が効く。端点をずらすか経路を曲げる` });

  // H108 辺がラベルを横切る。ラベルは読ませたいものなので、線が乗ると台無しになる
  let labelHits = 0;
  const labelBoxes = shapes.filter((s) => s.label && (s.font ?? 12) >= minFont).map((s) => {
    const font = s.font ?? 12;
    if (s.labelBox) return { id: s.id, x: s.labelBox.x, y: s.labelBox.y, w: s.labelBox.w, h: s.labelBox.h, outside: true };
    const inner = s.r != null ? s.r * 2 - 6 : s.w - 6;
    const tw = textWidth(fitText(s.label, inner, font * cw), font * cw);
    return { id: s.id, x: s.x, y: s.y, w: tw, h: font * 1.2 };
  });
  // 外に置いたラベル同士の重なり（図形は離れていてもラベルはぶつかる）
  const outs = labelBoxes.filter((b) => b.outside);
  let labelOverlaps = 0;
  for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) {
    const ov = rectOverlap(outs[i], outs[j], gap);
    if (ov > 0.5) { labelOverlaps++; if (problems.length < 500) problems.push({ code: 'H101', id: outs[i].id, message: `${outs[i].id} と ${outs[j].id} のラベルが ${ov.toFixed(1)}px 重なっている（必要な隙間 ${gap}px）— placeLabels() で逃がす` }); }
  }
  overlaps += labelOverlaps;
  for (const { a, b } of segs) for (const L of labelBoxes) {
    if (L.id === a.id || L.id === b.id) continue;
    if (segRectHit(a, b, L)) { labelHits++; break; }
  }
  if (labelHits) problems.push({ code: 'H108', id: '(全体)', message: `${labelHits} 本の辺がラベルの上を通っている — ラベルを placeLabels() で逃がすか、辺に白フチを付ける` });

  // H109 辺の間引きすぎ。**辺を捨てれば交差も貫通も減るので、指標だけは良くなる**。
  // 捨てた辺の重みを渡してもらい、「見えている割合」を測って歯止めにする。
  const shownW = segs.reduce((a, s) => a + (s.w ?? 1), 0);
  const totalW = opts.totalEdgeWeight ?? shownW;
  const visibleRatio = totalW > 0 ? shownW / totalW : 1;
  if (opts.totalEdgeWeight != null && visibleRatio < 0.5) {
    problems.push({ code: 'H109', id: '(全体)', message: `辺の重みの ${(visibleRatio * 100).toFixed(0)}% しか描かれていない（目安 50% 以上）— 交差や貫通の指標は辺を捨てるほど良くなるので、間引きで解いたことにしない` });
  }

  // 辺の長さの均一性（ばらつきが大きいほど読みにくい）と応力（近さの保存）
  const lens = segs.map(({ a, b }) => Math.hypot(a.x - b.x, a.y - b.y));
  const mean = lens.length ? lens.reduce((x, y) => x + y, 0) / lens.length : 0;
  const cv = mean ? Math.sqrt(lens.reduce((x, l) => x + sq(l - mean), 0) / lens.length) / mean : 0;

  // H110 領域からのはみ出し。押し出して重なりを消す解を成功扱いしないための歯止め
  let outside = 0;
  if (opts.bounds) {
    const b = opts.bounds;
    for (const s of shapes) {
      const hw = s.r != null ? s.r : (s.w ?? 0) / 2, hh = s.r != null ? s.r : (s.h ?? 0) / 2;
      const dx = Math.max(0, Math.abs(s.x - b.x) + hw - b.w / 2);
      const dy = Math.max(0, Math.abs(s.y - b.y) + hh - b.h / 2);
      if (dx > 0.5 || dy > 0.5) { outside++; if (problems.length < 500) problems.push({ code: 'H110', id: s.id, message: `${s.id} が領域から ${Math.max(dx, dy).toFixed(1)}px はみ出している（領域 ${b.w}x${b.h}）— 押し出して重なりを消すのは解決ではない。数を減らすか折り返す` }); }
    }
  }

  return {
    problems,
    metrics: {
      shapes: shapes.length, edges: segs.length, overlaps, overflow, unreadable, truncated, outside,
      crossings, crossingRatio: crossings / maxCross, minCrossAngle: segs.length ? minAngle : null, shallowCrossings: shallow,
      pierces, labelHits, aspect: ar, visibleEdgeWeightRatio: visibleRatio,
      edgeLengthCV: cv,
    },
  };
}

/** 2 直線の交差角（0〜90 度）。浅いほど読みにくい */
function crossAngle(p1, p2, p3, p4) {
  const a1 = Math.atan2(p2.y - p1.y, p2.x - p1.x), a2 = Math.atan2(p4.y - p3.y, p4.x - p3.x);
  let d = Math.abs((a1 - a2) * 180 / Math.PI) % 180;
  return d > 90 ? 180 - d : d;
}
/** 線分が矩形（中心 x,y・幅 w・高さ h）に触れるか */
function segRectHit(a, b, r) {
  const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2;
  if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) return false;
  const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  if (inside(a) || inside(b)) return true;
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  for (let i = 0; i < 4; i++) if (segsCross(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}

const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segsCross = (p1, p2, p3, p4) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
function segCircleHit(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = sq(dx) + sq(dy) || 1e-9;
  let t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y) < r - 1;
}

/** id から決まる角度（0〜2π）。完全同位置の分離方向を、乱数を使わず決定論的に決めるため */
function hashAngle(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}
/** 領域 { x, y, w, h }（x,y は中心）の内側へ引き戻す */
function clampToBounds(it, b) {
  const hw = it.r != null ? it.r : (it.w ?? 0) / 2;
  const hh = it.r != null ? it.r : (it.h ?? 0) / 2;
  const x0 = b.x - b.w / 2 + hw, x1 = b.x + b.w / 2 - hw;
  const y0 = b.y - b.h / 2 + hh, y1 = b.y + b.h / 2 - hh;
  if (x0 <= x1) it.x = Math.min(x1, Math.max(x0, it.x));
  if (y0 <= y1) it.y = Math.min(y1, Math.max(y0, it.y));
}

/**
 * 順序を保った並べ方（row / column / grid）。
 * 手牌・河・ツールバーのように「順番が意味を持つ」ものは、押し離しでは並べられない。
 * 領域に入りきらないときは overflow に「はみ出した量」を返す（**勝手に縮めない**）。
 *   items: [{ id, w, h, gapAfter? }]
 */
export function grid(items, opts = {}) {
  const { x = 0, y = 0, cols = 0, gap = 4, rowGap = null, align = 'start', bounds = null } = opts;
  const rg = rowGap ?? gap;
  const out = new Map();
  const rows = [];
  let row = [], rowW = 0;
  for (const it of items) {
    const w = it.w ?? (it.r ?? 8) * 2;
    const wouldW = rowW + (row.length ? gap : 0) + w;
    const overCols = cols > 0 && row.length >= cols;
    const overW = bounds && !cols && wouldW > bounds.w;
    if (row.length && (overCols || overW)) { rows.push({ row, rowW }); row = []; rowW = 0; }
    row.push(it); rowW += (row.length > 1 ? gap : 0) + w + (it.gapAfter ?? 0);
  }
  if (row.length) rows.push({ row, rowW });
  let cy = y;
  let maxW = 0;
  for (const { row: r, rowW: rw } of rows) {
    maxW = Math.max(maxW, rw);
    const h = Math.max(...r.map((it) => it.h ?? (it.r ?? 8) * 2));
    let cx = align === 'center' ? x - rw / 2 : x;
    for (const it of r) {
      const w = it.w ?? (it.r ?? 8) * 2, ih = it.h ?? (it.r ?? 8) * 2;
      out.set(it.id, { id: it.id, x: cx + w / 2, y: cy + h / 2, w, h: ih, node: it });
      cx += w + gap + (it.gapAfter ?? 0);
    }
    cy += h + rg;
  }
  const overflow = bounds ? Math.max(0, maxW - bounds.w) : 0;
  return { items: out, rows: rows.length, width: maxW, height: cy - y - rg, overflow };
}
