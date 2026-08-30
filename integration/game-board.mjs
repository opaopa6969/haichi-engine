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
export function roundTable(players, opts = {}) {
  const { radius = 200, seatRadius = 48, startAngle = -Math.PI / 2, cx = 0, cy = 0,
          clockwise = true, seatSize = null, faceCenter = true, gap = 4 } = opts;
  const n = players.length || 1;
  const seats = new Map();
  players.forEach((p, i) => {
    // **時計回りが既定**。麻雀の座順（自分→下家→対面→上家）は時計回りなので、
    // 反時計回りだと右の席が左に出る（netmahg の指摘）。
    // 画面座標は y が下向きなので、見た目の時計回りは**角度を減らす**方向になる。
    // ここを取り違えて 1 度実装をしくじった（テストで捕まえた）
    const dir = clockwise ? -1 : 1;
    const a = startAngle + dir * (i / n) * Math.PI * 2;
    const base = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, angle: a,
                   label: p.name ?? p.id, font: p.font ?? 14 };
    // 席は円とは限らない。細長いパネルを外接円で近似すると、空白ぶんで偽の重なりが出る
    const size = p.size ?? seatSize;
    const seat = size
      ? { ...base, w: size.w, h: size.h, rotation: faceCenter ? a + Math.PI / 2 : 0 }
      : { ...base, r: seatRadius };
    seats.set(p.id ?? String(i), seat);
  });
  const shapes = [...seats].map(([id, s2]) => ({ id, ...s2 }));
  return { seats, report: measure(shapes, [], { gap }) };
}

/**
 * すごろく等の「路に沿ってマスを並べる」配置。
 *
 * tetsugo での実測で分かった、最初の版が使えなかった理由:
 *   - 盤面が整数格子で、隣接は |dx|+|dy|===1（斜め禁止）という不変条件を持つのに、
 *     連続空間で等間隔に割っていたため全部壊していた
 *   - **駅間のマス数がゲームそのもの（サイコロの距離）なのに、
 *     「A 駅と B 駅の間に n マス」を表現する手段が無かった**（全体を index で等分するだけ）
 * そこで 2 つ足した。
 *   grid       … 整数格子に載せる（0 なら連続空間のまま）
 *   orthogonal … 直交のみで繋ぐ（斜めを作らない）。grid と併用する
 * さらに path を「区間の列」で渡せるようにした:
 *   path: [{x,y}...]                                そのまま等分（従来どおり）
 *   path: [{ from:{x,y}, to:{x,y}, cells: n }, ...]  区間ごとにマス数を指定
 */
export function alongPath(cells, path, opts = {}) {
  const { cellRadius = 22, gap = 6, loop = false, grid = 0, orthogonal = false } = opts;
  if (!path?.length) return { cells: new Map(), report: measure([], []) };

  const isSegments = path[0] && path[0].from && path[0].to;
  let pts = [];

  if (isSegments) {
    // 区間ごとに指定されたマス数だけ点を打つ。マス数が意味を持つ盤面はこちら
    for (const seg of path) {
      const n = Math.max(1, seg.cells ?? 1);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / n;   // 終点は次の区間の始点なので含めない
        pts.push({ x: seg.from.x + (seg.to.x - seg.from.x) * t, y: seg.from.y + (seg.to.y - seg.from.y) * t });
      }
    }
    const last = path.at(-1);
    if (!loop) pts.push({ x: last.to.x, y: last.to.y });
  } else {
    // 折れ線の全長を測り、等間隔の位置を取る（従来の動き）
    const segs = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); segs.push({ a: path[i - 1], b: path[i], d }); total += d; }
    if (loop && path.length > 2) { const d = Math.hypot(path[0].x - path.at(-1).x, path[0].y - path.at(-1).y); segs.push({ a: path.at(-1), b: path[0], d }); total += d; }
    const at = (t) => {
      let want = t * total;
      for (const sg of segs) { if (want <= sg.d || sg === segs.at(-1)) { const k = sg.d ? want / sg.d : 0; return { x: sg.a.x + (sg.b.x - sg.a.x) * k, y: sg.a.y + (sg.b.y - sg.a.y) * k }; } want -= sg.d; }
      return path.at(-1);
    };
    const n = cells.length || 1;
    pts = cells.map((_, i) => at(loop ? i / n : n === 1 ? 0 : i / (n - 1)));
  }

  // 格子に載せる。直交のみなら、斜めに飛んだところへ中継のマスを挟んで階段状にする
  if (grid > 0) {
    pts = pts.map((p) => ({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }));
    if (orthogonal) {
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = out.at(-1), b = pts[i];
        let cx = a.x, cy = a.y;
        while (cx !== b.x) { cx += Math.sign(b.x - cx) * grid; out.push({ x: cx, y: cy }); }
        while (cy !== b.y) { cy += Math.sign(b.y - cy) * grid; out.push({ x: cx, y: cy }); }
      }
      // 同じ座標に重なったものは畳む（階段の折返しで生じる）
      const seen = new Set();
      pts = out.filter((p) => { const k = `${p.x},${p.y}`; if (seen.has(k)) return false; seen.add(k); return true; });
    }
  }

  // orthogonal で階段状に中継マスを挟むと、点の数がマスの数より増える。
  // 先頭から順に取ると終点に届かない（2 マスを (0,0)→(64,64) に置くと (32,0) で終わっていた）。
  // マス数に合わせて等間隔に間引き、**終点は必ず最後のマスに割り当てる**
  const raw = cells.map((c, i) => {
    const n = cells.length;
    const idx = n <= 1 ? 0 : Math.round((i / (n - 1)) * (pts.length - 1));
    const p = pts[Math.min(idx, pts.length - 1)] ?? { x: 0, y: 0 };
    return { id: c.id ?? String(i), x: p.x, y: p.y, r: c.r ?? cellRadius, label: c.name ?? c.id, font: c.font ?? 11 };
  });
  // 格子に載せた配置は動かすと壊れるので、押し離しは連続空間のときだけ
  const placed = grid > 0 ? new Map(raw.map((r) => [r.id, r])) : relax(raw, { gap, iterations: 120 });
  const shapes = [...placed.values()];
  return { cells: placed, path: pts, labels: placeLabels(shapes, { minFont: 9, prefer: 'outside' }), report: measure(shapes, [], { gap }) };
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
