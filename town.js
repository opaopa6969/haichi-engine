// 町の配置。**碁盤の目に等間隔で並べない。**
//
// treemap や grid は「面積を配る」ことは得意だが、出てくる絵は等間隔の格子になる。
// 実際の町がそう見えないのは、次のことが同時に起きているから：
//
//   1. 建物は通りに面して並ぶ（背中合わせの列＝街区がまずあって、その周りに道がある）
//   2. 間口はばらばらで、大きい建物と小さい建物が同じ通りに混じる
//   3. 壁面線は揃わない（セットバックが建物ごとに違う）
//   4. 街区の奥行きもばらばらで、通りは全部同じ幅ではない（大通りと路地）
//   5. ところどころ空き地がある（公園・広場・駐車場）
//
// この 5 つを入れるだけで、格子には見えなくなる。ここではそれだけをやる。
// **何が建つのかは知らない。** 大きさの希望値だけを受け取り、座標を返す。
//
// 規則
//   T101 建物の間口・奥行きは [minSize, maxSize] に収める
//   T102 建物どうしは gap 以上あける（同じ列でも、列をまたいでも）
//   T103 通りは幅 street 以上、大通りは太い
//   T104 壁面線は揃えない（セットバックを建物ごとに散らす）
//   T105 同じ入力・同じ seed なら同じ町になる（決定論）
//   T106 敷地に入りきらないぶんは奥へ伸ばす（切り捨てない）

// 決定論の擬似乱数。seed と添字から作る（Math.random は使わない）
function rnd(seed, i) {
  const x = Math.sin((seed * 127.1 + i * 311.7) * 0.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 町の配置を計算する。
 * @param {Array} items {id, value} の配列。value は面積の希望値（大きいほど大きい建物）
 * @param {object} opts
 *   w, d          敷地の幅・奥行き（奥行きは足りなければ超える。T106）
 *   minSize       間口・奥行きの下限（既定 5）
 *   maxSize       間口・奥行きの上限（既定 50）
 *   gap           建物どうしの最低距離（既定 5）
 *   street        通りの幅（既定 8）。数本に 1 本は大通りになる
 *   avenueEvery   何列ごとに大通りを入れるか（既定 4）
 *   emptyLotRate  空き地にする割合（既定 0.07）
 *   seed          乱数の種（既定 1）
 *   sizeOf        item から面積の希望値を取る関数
 * @returns {{ placed: Map, streets: Array, lots: Array, w: number, d: number, rows: number }}
 *   placed: id → {x, z, w, d, row, setback}（x,z は中心）
 *   streets: {x0, z0, x1, z1, w} の配列（横断する通り）
 *   lots: 空き地 {x, z, w, d}（公園や広場に使える）
 */
export function town(items, {
  w = 1000, d = 1000, minSize = 5, maxSize = 50, gap = 5, street = 8,
  avenueEvery = 4, emptyLotRate = 0.07, seed = 1, sizeOf = (it) => it.value ?? 1,
  mode = 'rows', aspectRange = [0.6, 1.7], setbackSigma = null, scatterGap = null, spine = null,
} = {}) {
  const list = [...items];
  if (!list.length) return { placed: new Map(), streets: [], lots: [], w, d, rows: 0 };

  // 1) 建物の寸法を決める。面積の希望値から辺を出し、上下限に収めて、正方形から崩す。
  //    **同じ通りに大小が混じるように、大きさ順には並べない。** 決定論的に混ぜる。
  const boxes = list.map((it, i) => {
    const area = Math.max(1, sizeOf(it));
    const side = Math.sqrt(area);
    // 間口と奥行きの比。0.6〜1.7 の範囲で散らす（真四角ばかりだと工場に見える）
    const a = aspectRange[0] + rnd(seed, i * 3 + 1) * (aspectRange[1] - aspectRange[0]);
    let bw = clamp(side * Math.sqrt(a), minSize, maxSize);
    let bd = clamp(side / Math.sqrt(a), minSize, maxSize);
    return { it, w: bw, d: bd, key: rnd(seed, i * 7 + 5) };
  });
  // 大きいものだけが端に固まらないよう、大きさ順 → 決定論的シャッフルで軽く混ぜる
  boxes.sort((p, q) => (q.w * q.d - p.w * p.d) || (p.key - q.key));
  const mixed = [];
  for (let i = 0; i < boxes.length; i++) {
    // 3 つに 1 つは後ろから取る（大小を混ぜる）
    mixed.push(i % 3 === 2 && boxes.length - 1 - (i >> 1) > i ? boxes[boxes.length - 1 - (i >> 1)] : boxes[i]);
  }
  const used = new Set(); const order = [];
  for (const b of mixed) { if (!used.has(b)) { used.add(b); order.push(b); } }
  for (const b of boxes) if (!used.has(b)) { used.add(b); order.push(b); }

  // 2) 並べる。mode で並び方が変わる。
  //    rows    … 街区に積む（市街地の基本形）
  //    ribbon  … 一本の街道の両側に連なる（宿場町・門前町）
  //    scatter … 道からも隣からも離れてまばらに建つ（田園・山間・高台）
  if (mode === 'ribbon') return ribbon(order, { w, d, gap, street, seed, minSize });
  if (mode === 'scatter') return scatter(order, { w, d, gap: scatterGap ?? gap * 6, street, seed });
  //    radial  … 広場を中心に環状道路＋放射道路（城下町・ヨーロッパの旧市街）
  //    organic … 曲がりくねった道に沿う（自然発生した町・スラム・山道）
  //    riverine… 川筋に沿って両岸に伸びる（河岸段丘の町）
  if (mode === 'radial') return alongCurves(order, radialCurves(w, d, seed), { w, d, gap, street, seed });
  if (mode === 'organic') return alongCurves(order, organicCurves(w, d, seed), { w, d, gap, street, seed });
  if (mode === 'riverine') return alongCurves(order, riverCurves(w, d, seed, spine), { w, d, gap, street, seed });

  const placed = new Map(); const streets = []; const lots = [];
  let z = street;           // いちばん手前に通りを 1 本
  let row = 0, idx = 0;
  streets.push({ x0: 0, z0: street / 2, x1: w, z1: street / 2, w: street });

  while (idx < order.length) {
    // この列に並ぶぶんを、幅が尽きるまで取る
    const rowItems = []; let x = gap; let rowD = 0; let lastWasLot = false;
    while (idx < order.length) {
      const b = order[idx];
      // 空き地（公園・広場）を挟む。**添字は必ず進める**か、進めないなら次は必ず建物にする。
      // 進めないまま空き地を作り続けると、同じ item を無限に見て固まる（実際に固まった）。
      const empty = !lastWasLot && rnd(seed, idx * 11 + row * 101 + 13) < emptyLotRate;
      if (empty) {
        const lw = Math.max(minSize * 2, b.w), ld = Math.max(minSize * 2, b.d);
        if (x + lw + gap > w && rowItems.length) break;
        lots.push({ x: x + lw / 2, z: 0, w: lw, d: ld, _row: row });
        x += lw + gap; rowD = Math.max(rowD, ld);
        lastWasLot = true;
        continue;   // item はこの列では使わず、次の枠へ
      }
      lastWasLot = false;
      if (x + b.w + gap > w && rowItems.length) break;
      rowItems.push({ b, x });
      x += b.w + gap + rnd(seed, idx * 17 + 3) * gap;   // 隣との間もばらつかせる（T102 は下限）
      rowD = Math.max(rowD, b.d);
      idx++;
    }
    if (!rowItems.length) { // 1 つも入らない（w が極端に狭い）→ 1 つだけ置いて進む
      const b = order[idx]; rowItems.push({ b, x: gap }); rowD = b.d; idx++;
    }
    // 3) 壁面線を揃えない。セットバックは 0〜gap の範囲で建物ごとに散らす（T104）
    //    列の奥行きは「いちばん深い建物 + セットバックの余地」
    const slack = setbackSigma ?? gap;
    const depth = rowD + slack;
    for (const { b, x: bx } of rowItems) {
      const i2 = placed.size;
      const setback = rnd(seed, i2 * 23 + 7) * slack;
      placed.set(b.it.id, {
        x: bx + b.w / 2, z: z + setback + b.d / 2,
        w: b.w, d: b.d, row, setback,
      });
    }
    for (const l of lots) if (l._row === row && !l.z) { l.z = z + l.d / 2; delete l._row; }
    z += depth;
    row++;
    // 4) 次の通り。数本に 1 本は大通り（T103）
    const wide = row % avenueEvery === 0 ? street * 2.2 : street * (0.85 + rnd(seed, row * 29) * 0.5);
    streets.push({ x0: 0, z0: z + wide / 2, x1: w, z1: z + wide / 2, w: wide });
    z += wide;
  }
  // 縦の通り（街区を貫く筋）。等間隔だと格子に見えるので幅も間隔も散らす
  for (let k = 1, x = 0; k < 40; k++) {
    x += w / 6 * (0.6 + rnd(seed, k * 37) * 0.9);
    if (x > w - street) break;
    streets.push({ x0: x, z0: 0, x1: x, z1: z, w: street * (0.7 + rnd(seed, k * 41) * 0.6) });
  }
  return { placed, streets, lots, w, d: Math.max(d, z), rows: row };
}

// 街道の両側に連なる（宿場町）。**間口が狭く、隣とほとんど隙間がない。**
// 通りは 1 本だけで、そこに全部が面する。奥へは伸びない。
function ribbon(order, { w, d, gap, street, seed, minSize }) {
  const placed = new Map(); const lots = [];
  const zc = d / 2;                                  // 街道の中心線
  const streets = [{ x0: 0, z0: zc, x1: Math.max(w, 1), z1: zc, w: street }];
  const sides = [[-1, 0], [1, 0]];
  const cursor = [gap, gap];                         // 手前側・奥側それぞれの x
  let maxX = 0;
  order.forEach((b, i) => {
    const s = i % 2;                                  // 交互に両側へ
    const [sgn] = sides[s];
    // 連棟の詰まり感。**それでも T102（gap 以上）は守る。**
    // 最初は gap を無視して詰めたが、それだと「最低 5 m」の約束が宿場町だけ破れる。
    // 詰まって見せるのは「gap ちょうどに寄せる」ことで表す（他のモードは gap + ばらつき）。
    const tight = rnd(seed, i * 13 + 5) * gap * 0.35;
    const x = cursor[s];
    const setback = street / 2 + gap * 0.4 + rnd(seed, i * 17 + 3) * gap * 0.5;
    placed.set(b.it.id, {
      x: x + b.w / 2, z: zc + sgn * (setback + b.d / 2),
      w: b.w, d: b.d, row: s, setback,
    });
    cursor[s] = x + b.w + gap + tight;
    maxX = Math.max(maxX, cursor[s]);
  });
  streets[0].x1 = maxX + gap;
  return { placed, streets, lots, w: maxX + gap, d, rows: 2 };
}

// まばらに建つ（田園・山間・高台）。**道に面していなくてよい。**
// 互いに gap 以上離れるよう、poisson 風に間引いて置く。
function scatter(order, { w, d, gap, street, seed }) {
  const placed = new Map(); const lots = [];
  const streets = [];
  // 曲がりくねった 1 本道（等間隔の格子にしない）
  const pts = [];
  for (let k = 0; k <= 10; k++) {
    const z = (d * k) / 10;
    pts.push({ x: w * (0.25 + rnd(seed, k * 29 + 3) * 0.5), z });
  }
  for (let k = 1; k < pts.length; k++)
    streets.push({ x0: pts[k - 1].x, z0: pts[k - 1].z, x1: pts[k].x, z1: pts[k].z, w: street });

  const put = [];
  const far = (x, z, bw, bd) => put.every((o) =>
    Math.max(Math.abs(o.x - x) - (o.w + bw) / 2, Math.abs(o.z - z) - (o.d + bd) / 2) >= gap);
  let dd = d;
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    let ok = false;
    for (let k = 0; k < 60 && !ok; k++) {
      const x = rnd(seed, i * 31 + k * 7 + 1) * w;
      const z = rnd(seed, i * 37 + k * 11 + 2) * dd;
      if (!far(x, z, b.w, b.d)) continue;
      const rec = { x, z, w: b.w, d: b.d, row: Math.floor(z / Math.max(1, gap * 3)), setback: 0 };
      put.push(rec); placed.set(b.it.id, rec); ok = true;
    }
    if (!ok) { dd += gap * 4; i--; }                  // 入らなければ奥へ伸ばす（T106）
    if (dd > d * 40) break;                           // 保険
  }
  return { placed, streets, lots, w, d: dd, rows: Math.ceil(dd / Math.max(1, gap * 3)) };
}

// ── 曲がった道に沿って建てる。
// **道を先に引き、その両側に軒を並べる。** 格子に置いてから曲げるのではなく、
// 曲線の接線方向に進みながら、法線方向へ寄せて置く。こうすると道なりに家が並び、
// 曲がり角で景色が変わる（＝覚えられる）。

// 曲線を等間隔に刻む。返すのは {x,z,tx,tz,nx,nz}（接線と法線つき）
function walkCurve(pts, step) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz); if (len < 1e-6) continue;
    const tx = dx / len, tz = dz / len;
    for (let s = carry; s < len; s += step) {
      out.push({ x: a.x + tx * s, z: a.z + tz * s, tx, tz, nx: -tz, nz: tx });
    }
    carry = (carry - len) % step; if (carry < 0) carry += step;
  }
  return out;
}

function alongCurves(order, curves, { w, d, gap, street, seed }) {
  const placed = new Map(); const lots = []; const streets = [];
  for (const c of curves) {
    for (let i = 1; i < c.pts.length; i++)
      streets.push({ x0: c.pts[i - 1].x, z0: c.pts[i - 1].z, x1: c.pts[i].x, z1: c.pts[i].z, w: c.w ?? street });
  }
  // 道ごとに、沿道の枠を作る
  const slots = [];
  for (const c of curves) {
    const cw = c.w ?? street;
    const walk = walkCurve(c.pts, gap * 1.4);
    for (const p of walk) for (const sgn of [-1, 1]) slots.push({ p, sgn, cw });
  }
  const put = [];
  const far = (x, z, bw, bd) => put.every((o) =>
    Math.max(Math.abs(o.x - x) - (o.w + bw) / 2, Math.abs(o.z - z) - (o.d + bd) / 2) >= gap);
  let si = 0, ring = 0;
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    let ok = false;
    for (let k = 0; k < slots.length && !ok; k++) {
      const s = slots[(si + k * 7 + 1) % slots.length];
      const setback = s.cw / 2 + gap * 0.6 + rnd(seed, i * 13 + k) * gap * 0.9 + ring;
      // **向きを決めてから当たりを見る。** 先に判定して後から間口と奥行きを
      // 入れ替えると、判定した形と置いた形が違い、最低距離が破れる（実測 -2.9 m）。
      const alongX = Math.abs(s.p.tx) > Math.abs(s.p.tz);
      const bw = alongX ? b.w : b.d, bd = alongX ? b.d : b.w;
      const half = Math.max(bw, bd) / 2;
      const x = s.p.x + s.p.nx * s.sgn * (setback + half);
      const z = s.p.z + s.p.nz * s.sgn * (setback + half);
      if (x < 0 || z < 0 || x > w * 1.6 || z > d * 1.6) continue;
      if (!far(x, z, bw, bd)) continue;
      const rec = { x, z, w: bw, d: bd, row: Math.floor(setback / Math.max(1, gap)), setback };
      put.push(rec); placed.set(b.it.id, rec); ok = true; si = (si + k + 3) % slots.length;
    }
    if (!ok) { ring += gap * 2.2; i--; }        // 沿道が埋まったら 1 列外へ（T106）
    if (ring > Math.max(w, d)) break;           // 保険
  }
  let maxD = d;
  for (const p of put) maxD = Math.max(maxD, p.z + p.d);
  return { placed, streets, lots, w, d: maxD, rows: 1 + Math.round(ring / Math.max(1, gap * 2.2)) };
}

// 広場を中心に、環状 + 放射
function radialCurves(w, d, seed) {
  const cx = w / 2, cz = d / 2;
  const curves = [];
  const rings = 4;
  for (let r = 1; r <= rings; r++) {
    const rad = (Math.min(w, d) / 2) * (r / (rings + 0.6));
    const pts = [];
    const n = 36 + r * 8;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      // 真円だとつまらないので、半径を少し揺らす
      const rr = rad * (0.92 + rnd(seed, r * 17 + i) * 0.16);
      pts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr });
    }
    curves.push({ pts, w: r === rings ? 18 : 10 });
  }
  const spokes = 7;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2 + rnd(seed, k * 29) * 0.2;
    const pts = [];
    for (let t = 0; t <= 10; t++) {
      const rad = (Math.min(w, d) / 2) * (t / 10);
      const wob = (rnd(seed, k * 31 + t) - 0.5) * 0.12;
      pts.push({ x: cx + Math.cos(a + wob) * rad, z: cz + Math.sin(a + wob) * rad });
    }
    curves.push({ pts, w: 14 });
  }
  return curves;
}

// 曲がりくねった道が枝分かれする（自然発生した町）
function organicCurves(w, d, seed) {
  const curves = [];
  const trunk = [];
  for (let t = 0; t <= 24; t++) {
    const u = t / 24;
    trunk.push({ x: w * (0.12 + u * 0.76) + Math.sin(u * 6.2 + seed) * w * 0.09,
                 z: d * (0.15 + u * 0.7) + Math.cos(u * 4.7 + seed * 1.7) * d * 0.11 });
  }
  curves.push({ pts: trunk, w: 14 });
  for (let b = 0; b < 6; b++) {
    const at = Math.floor((0.15 + rnd(seed, b * 13) * 0.7) * (trunk.length - 2)) + 1;
    const base = trunk[at];
    const dir = Math.atan2(trunk[at + 1].z - trunk[at - 1].z, trunk[at + 1].x - trunk[at - 1].x)
      + (b % 2 ? 1 : -1) * (0.8 + rnd(seed, b * 19) * 0.9);
    const pts = [base];
    let a = dir, x = base.x, z = base.z;
    const len = 6 + Math.floor(rnd(seed, b * 23) * 8);
    for (let t = 0; t < len; t++) {
      a += (rnd(seed, b * 31 + t) - 0.5) * 0.55;
      x += Math.cos(a) * Math.min(w, d) * 0.06; z += Math.sin(a) * Math.min(w, d) * 0.06;
      pts.push({ x, z });
    }
    curves.push({ pts, w: 8 });
  }
  return curves;
}

// 川筋に沿って両岸に伸びる。spine を渡せばその折れ線を川として使う
function riverCurves(w, d, seed, spine) {
  const pts = spine && spine.length > 1 ? spine : (() => {
    const p = [];
    for (let t = 0; t <= 20; t++) {
      const u = t / 20;
      p.push({ x: w * (0.5 + Math.sin(u * 5.1 + seed) * 0.22), z: d * u });
    }
    return p;
  })();
  // 川そのものは道ではないので、両岸に少し離した道を 2 本引く
  const off = 26;
  const bank = (sgn) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1;
    return { x: p.x + (-tz / l) * off * sgn, z: p.z + (tx / l) * off * sgn };
  });
  return [{ pts: bank(-1), w: 12 }, { pts: bank(1), w: 12 }];
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * 配置の検査。**言われた通りになっているかを数える。**
 * @returns {{ minGap, tooClose, overSize, underSize, frontLineVariance, ok }}
 */
export function measureTown(placed, { minSize = 5, maxSize = 50, gap = 5 } = {}) {
  const arr = [...placed.values()];
  let minGap = Infinity, tooClose = 0, overSize = 0, underSize = 0;
  for (const b of arr) {
    const mx = Math.max(b.w, b.d), mn = Math.min(b.w, b.d);
    if (mx > maxSize + 1e-6) overSize++;
    if (mn < minSize - 1e-6) underSize++;
  }
  // 近いものだけ調べる（総当たりは建物が数千だと重い）
  const cell = Math.max(1, maxSize + gap);
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const b of arr) { const k = key(b.x, b.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
  for (const b of arr) {
    const cx = Math.floor(b.x / cell), cz = Math.floor(b.z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const o of grid.get(`${cx + i},${cz + j}`) ?? []) {
        if (o === b) continue;
        const dx = Math.abs(o.x - b.x) - (o.w + b.w) / 2;
        const dz = Math.abs(o.z - b.z) - (o.d + b.d) / 2;
        const gapHere = Math.max(dx, dz);      // 矩形どうしの隙間（負なら重なり）
        if (gapHere < minGap) minGap = gapHere;
        if (gapHere < gap - 1e-6) tooClose++;
      }
    }
  }
  // 壁面線のばらつき。0 だと定規で引いたように揃っている＝不自然
  const byRow = new Map();
  for (const b of arr) { if (!byRow.has(b.row)) byRow.set(b.row, []); byRow.get(b.row).push(b.z - b.d / 2); }
  let varSum = 0, rows = 0;
  for (const fs of byRow.values()) {
    if (fs.length < 2) continue;
    const m = fs.reduce((a, v) => a + v, 0) / fs.length;
    varSum += Math.sqrt(fs.reduce((a, v) => a + (v - m) ** 2, 0) / fs.length); rows++;
  }
  return {
    minGap: arr.length > 1 ? minGap : Infinity,
    tooClose: tooClose / 2, overSize, underSize,
    frontLineVariance: rows ? varSum / rows : 0,
    ok: tooClose === 0 && overSize === 0 && underSize === 0,
  };
}
