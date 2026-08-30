// game-engine-suite との接続。
// ゲーム側で「ものをどこに置くか」が要る場面は、可視化と同じ問題に帰着する。
//   - すごろくの盤面（tetsugo）… マスを路線に沿って並べ、駅名が重ならないようにする
//   - 卓の席順（janshin）……… 円卓に n 人を等間隔で置き、手牌の表示域を確保する
//   - 台詞の吹き出し（drama-engine）… 話者の近くに置き、他の吹き出しと重ねない
//   - 関係図（relation-engine）… 人物の距離を「関係の強さ」で決める
// いずれも「大きさを持つものを重ねずに置き、ラベルが読めるかを測る」だけなので、
// haichi-engine がそのまま使える。ゲーム側の語彙をここで吸収する。
import { relax, placeLabels, measure, rng, textWidth } from '../index.js';

/**
 * 円卓の席。n 人を等間隔に置き、各席の表示域（手牌・立ち絵）が重ならないかを測る。
 * → { seats: Map<id,{x,y,r,angle}>, report }
 */
export function roundTable(players, { radius = 200, seatRadius = 48, startAngle = -Math.PI / 2, cx = 0, cy = 0 } = {}) {
  const n = players.length || 1;
  const seats = new Map();
  players.forEach((p, i) => {
    const a = startAngle + (i / n) * Math.PI * 2;
    seats.set(p.id ?? String(i), { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, r: seatRadius, angle: a, label: p.name ?? p.id, font: p.font ?? 14 });
  });
  const shapes = [...seats].map(([id, s]) => ({ id, ...s }));
  return { seats, report: measure(shapes, [], { gap: 4 }) };
}

/**
 * すごろく等の「路に沿ってマスを並べる」配置。
 * path: [{x,y}...] を等間隔で分割し、マスを置く。マスが重なるなら relax で押し離す。
 */
export function alongPath(cells, path, { cellRadius = 22, gap = 6, loop = false } = {}) {
  if (!path.length) return { cells: new Map(), report: measure([], []) };
  // 折れ線の全長を測り、等間隔の位置を取る
  const segs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); segs.push({ a: path[i - 1], b: path[i], d }); total += d; }
  if (loop && path.length > 2) { const d = Math.hypot(path[0].x - path.at(-1).x, path[0].y - path.at(-1).y); segs.push({ a: path.at(-1), b: path[0], d }); total += d; }
  const at = (t) => {
    let want = t * total;
    for (const s of segs) { if (want <= s.d || s === segs.at(-1)) { const k = s.d ? want / s.d : 0; return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k }; } want -= s.d; }
    return path.at(-1);
  };
  const n = cells.length || 1;
  const raw = cells.map((c, i) => ({ id: c.id ?? String(i), ...at(loop ? i / n : n === 1 ? 0 : i / (n - 1)), r: c.r ?? cellRadius, label: c.name ?? c.id, font: c.font ?? 11 }));
  const placed = relax(raw, { gap, iterations: 120 });
  const shapes = [...placed.values()];
  return { cells: placed, labels: placeLabels(shapes, { minFont: 9 }), report: measure(shapes, [], { gap }) };
}

/**
 * 吹き出し・注釈の配置。話者の近くに置きたいが、重ねたくない。
 * anchors: [{ id, x, y, text, font, w?, h? }]
 * 置けなかったものは hidden: true が返る（**出さない判断も配置の一部**）。
 */
export function speechBubbles(anchors, { gap = 6, minFont = 10, cw = 0.55, maxWidth = 220 } = {}) {
  const shapes = anchors.map((a) => {
    const font = a.font ?? 13;
    const w = Math.min(maxWidth, a.w ?? textWidth(a.text, font * cw) + 16);
    const h = a.h ?? font * 1.6 + 10;
    return { id: a.id, x: a.x, y: a.y - h, w, h, label: a.text, font };
  });
  return { bubbles: placeLabels(shapes, { minFont, gap, cw }), report: measure(shapes, [], { gap }) };
}

/**
 * 関係の強さで距離を決める配置（力学緩和の簡易版）。
 * nodes: [{ id, r }] ties: [{ a, b, strength }]（strength が大きいほど近づく）
 * 乱数は seed 固定なので、同じ入力からは必ず同じ絵になる。
 */
export function relationMap(nodes, ties, { size = 600, iterations = 300, seed = 1, gap = 6 } = {}) {
  const rand = rng(seed);
  const pos = nodes.map((n) => ({ id: n.id, r: n.r ?? 18, label: n.name ?? n.id, font: n.font ?? 12, x: (rand() - 0.5) * size, y: (rand() - 0.5) * size }));
  const by = new Map(pos.map((p) => [p.id, p]));
  for (let k = 0; k < iterations; k++) {
    const t = 1 - k / iterations;
    // 引き合い: 強い関係ほど近づく
    for (const e of ties) {
      const a = by.get(e.a), b = by.get(e.b); if (!a || !b) continue;
      const want = 60 + 120 / Math.max(0.2, e.strength ?? 1);
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1e-6;
      const f = ((d - want) / d) * 0.08 * t;
      a.x += dx * f; a.y += dy * f; b.x -= dx * f; b.y -= dy * f;
    }
    // 反発: 近すぎるものを離す
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i], b = pos[j];
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1e-6;
      if (d > 260) continue;
      const f = (260 - d) / d * 0.012 * t;
      a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f;
    }
  }
  const settled = relax(pos, { gap, iterations: 120 });
  const shapes = [...settled.values()];
  return { nodes: settled, labels: placeLabels(shapes, { minFont: 9 }), report: measure(shapes, ties.map((t) => ({ from: t.a, to: t.b })), { gap }) };
}
