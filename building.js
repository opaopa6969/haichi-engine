import { clamp } from 'kazu';
// 建物の塊り（マッシング）。**箱を 1 つ置くのをやめる。**
//
// 街が「置いた箱」に見えるのは、建物が直方体 1 個だからで、実際の建物は
// 敷地の形と法規と用途から、いくつかの塊が組み合わさった形をしている。
//
//   L 字・コの字   敷地の角を取って中庭や駐車場を残すとこうなる。日本の建物に非常に多い
//   雁行           斜めの敷地に合わせて少しずつずらして建てる
//   基壇＋塔       低層が商業で張り出し、その上に細い塔が乗る（駅前のビル）
//   段状           上に行くほど細る。斜線制限（日本）やセットバック（NY）の結果
//   ロの字         中庭を囲む。学校・団地・旧市街
//
// その上に、**上にあるものが街の輪郭を作る**。塔屋（階段室）、給水塔、
// 換気塔、煙突、非常階段、袖看板。これが無いビルは模型に見える。
//
// **描かない。** 直方体の並びと屋根と付属物を返すだけ。
//
// 規則
//   P101 部品はすべて敷地 w×d の中に収まる
//   P102 部品はどれかと接している（浮いた塊を作らない）
//   P103 総体積は同じ敷地の直方体の 35〜100%（痩せすぎない）
//   P104 いちばん高い所が指定の高さになる
//   P105 同じ入力なら同じ形（決定論）
//   P106 型が違えば形が違う

function rnd(seed, i) {
  const x = Math.sin((seed * 45.13 + i * 91.7) * 0.77) * 43758.5453;
  return x - Math.floor(x);
}

/** 塊りの型。用途と階数から選ばれる */
export const MASSING = [
  'bar',          // 単純な棟。小さい建物・住宅
  'L',            // L 字。角地・敷地の隅を残す
  'U',            // コの字。中庭や駐車場を抱える
  'court',        // ロの字。中庭を囲む
  'step',         // 雁行。ずらして建てる
  'podium',       // 基壇＋塔
  'ziggurat',     // 段状に細る
  'wing',         // 主棟＋低い翼屋
];

/**
 * 塊りを作る。
 * @param {object} o
 *   w, d       敷地の間口・奥行き（m）
 *   h          いちばん高い所（m）
 *   levels     階数（付属物の数に効く）
 *   kind       MASSING のどれか。省略時は大きさと階数から選ぶ
 *   roof       屋根の形（flat/gable/hip/shed/saw）。塊りの主棟に載る
 *   seed       乱数の種
 * @returns {{ kind, parts, roof, props, bbox }}
 *   parts: {x, y, z, w, h, d}（x,z は中心、y は下端）
 *   props: {type, x, y, z, w, h, d}  type = penthouse|tank|stack|vent|stair|sign|balcony
 */
export function massing({ w = 12, d = 10, h = 9, levels = 3, kind = null, roof = 'flat', seed = 1 } = {}) {
  const K = kind ?? pickKind(w, d, h, levels, seed);
  const parts = [];
  const props = [];
  const floor = h / Math.max(1, levels);

  // 塊りごとの作り分け。**どれも敷地からはみ出さない**（P101）
  if (K === 'bar') {
    parts.push({ x: 0, y: 0, z: 0, w, h, d });
  } else if (K === 'L') {
    // 長辺に沿った棟と、片端から直交して伸びる棟
    const armW = w * (0.34 + rnd(seed, 1) * 0.2);
    const armD = d * (0.36 + rnd(seed, 2) * 0.22);
    parts.push({ x: 0, y: 0, z: -(d - armD) / 2, w, h, d: armD });
    parts.push({ x: -(w - armW) / 2, y: 0, z: armD / 2, w: armW, h: h * (0.66 + rnd(seed, 3) * 0.3), d: d - armD });
  } else if (K === 'U') {
    const armW = w * (0.26 + rnd(seed, 4) * 0.12);
    const backD = d * (0.32 + rnd(seed, 5) * 0.16);
    parts.push({ x: 0, y: 0, z: -(d - backD) / 2, w, h, d: backD });
    for (const s of [-1, 1])
      parts.push({ x: s * (w - armW) / 2, y: 0, z: backD / 2, w: armW, h: h * (0.72 + rnd(seed, 6 + s) * 0.24), d: d - backD });
  } else if (K === 'court') {
    const t = Math.max(3, Math.min(w, d) * (0.2 + rnd(seed, 7) * 0.1));   // 廊下の幅
    parts.push({ x: 0, y: 0, z: -(d - t) / 2, w, h, d: t });
    parts.push({ x: 0, y: 0, z: (d - t) / 2, w, h: h * 0.92, d: t });
    parts.push({ x: -(w - t) / 2, y: 0, z: 0, w: t, h: h * 0.86, d: d - t * 2 });
    parts.push({ x: (w - t) / 2, y: 0, z: 0, w: t, h: h * 0.86, d: d - t * 2 });
  } else if (K === 'step') {
    // 雁行。3 つに割ってずらす
    const n = 3, pw = w / n;
    // **隣とは隙間を空けない。** 0.96 倍にして隙間を作ると、大きい建物では
    // その隙間が 0.5m を超えて「浮いた塊」になる（P102 違反。実測 3 個）。
    // 雁行は前後のずれで見せるものなので、幅は詰めたままでよい。
    const tallest = Math.floor(rnd(seed, 25) * n);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * (d * 0.14);
      const dd = d * (0.62 + rnd(seed, 10 + i) * 0.2);
      // **1 つは必ず指定の高さにし、他はそれ以下にする**（P104）
      const hh = i === tallest ? h : h * (0.72 + rnd(seed, 20 + i) * 0.22);
      parts.push({ x: -w / 2 + pw * (i + 0.5), y: 0, z: clamp(off, -(d - dd) / 2, (d - dd) / 2), w: pw, h: hh, d: dd });
    }
  } else if (K === 'podium') {
    const pod = Math.min(h * 0.34, floor * 2.4);
    parts.push({ x: 0, y: 0, z: 0, w, h: pod, d });                       // 基壇
    const tw = w * (0.5 + rnd(seed, 8) * 0.22), td = d * (0.5 + rnd(seed, 9) * 0.22);
    const ox = (rnd(seed, 11) - 0.5) * (w - tw) * 0.6, oz = (rnd(seed, 12) - 0.5) * (d - td) * 0.6;
    parts.push({ x: ox, y: pod, z: oz, w: tw, h: h - pod, d: td });       // 塔
  } else if (K === 'ziggurat') {
    const n = Math.max(2, Math.min(4, Math.round(levels / 3)));
    let cw = w, cd = d, y = 0;
    for (let i = 0; i < n; i++) {
      const seg = (h / n) * (i === 0 ? 1.25 : 1) / (1 + 0.25 / n);
      parts.push({ x: 0, y, z: 0, w: cw, h: seg, d: cd });
      y += seg; cw *= 0.72 + rnd(seed, 30 + i) * 0.1; cd *= 0.72 + rnd(seed, 40 + i) * 0.1;
    }
    // 高さを合わせる（P104）
    const top = parts[parts.length - 1];
    top.h += h - (y);
  } else { // wing
    const mainW = w * (0.62 + rnd(seed, 13) * 0.16);
    parts.push({ x: -(w - mainW) / 2, y: 0, z: 0, w: mainW, h, d });
    parts.push({ x: mainW / 2 + (w - mainW) / 2 - (w - mainW) / 2, y: 0, z: 0, w: w - mainW, h: h * (0.42 + rnd(seed, 14) * 0.22), d: d * (0.72 + rnd(seed, 15) * 0.24) });
    parts[1].x = (w - (w - mainW)) / 2;
  }

  // 主棟 = いちばん高い部品。屋根はここに載せる
  let main = parts[0];
  for (const p of parts) if (p.y + p.h > main.y + main.h) main = p;
  const roofOn = { ...main };

  // ── 上に載るもの。**これが街の輪郭を作る。**
  const tall = h >= 12;
  if (tall) {
    // 塔屋（階段・エレベータ機械室）。陸屋根の建物にはほぼ必ずある
    if (roof === 'flat' || roof === 'saw') {
      const pw = Math.max(2.5, main.w * (0.2 + rnd(seed, 50) * 0.14));
      const pd = Math.max(2.5, main.d * (0.2 + rnd(seed, 51) * 0.14));
      props.push({ type: 'penthouse', x: main.x + (rnd(seed, 52) - 0.5) * (main.w - pw) * 0.6, y: main.y + main.h,
        z: main.z + (rnd(seed, 53) - 0.5) * (main.d - pd) * 0.6, w: pw, h: Math.min(4, floor * 1.1), d: pd });
    }
    if (rnd(seed, 54) < 0.4) {   // 給水塔
      props.push({ type: 'tank', x: main.x + (rnd(seed, 55) - 0.5) * main.w * 0.5, y: main.y + main.h,
        z: main.z + (rnd(seed, 56) - 0.5) * main.d * 0.5, w: 2.6, h: 3.4, d: 2.6 });
    }
    if (rnd(seed, 57) < 0.32) {  // 換気塔・室外機の島
      props.push({ type: 'vent', x: main.x + (rnd(seed, 58) - 0.5) * main.w * 0.55, y: main.y + main.h,
        z: main.z + (rnd(seed, 59) - 0.5) * main.d * 0.55, w: 3.2, h: 1.4, d: 2.2 });
    }
  }
  if (rnd(seed, 60) < 0.22 && h >= 8) {  // 煙突（工場・銭湯）
    props.push({ type: 'stack', x: main.x + main.w * 0.36, y: 0, z: main.z + main.d * 0.36, w: 1.4, h: h * 1.5, d: 1.4 });
  }
  if (levels >= 3 && rnd(seed, 61) < 0.45) {  // 外階段（非常階段）
    props.push({ type: 'stair', x: main.x, y: 0, z: main.z + main.d / 2 + 0.7, w: Math.min(3.2, main.w * 0.4), h, d: 1.4 });
  }
  if (levels >= 2 && rnd(seed, 62) < 0.5) {   // 袖看板（正面に縦に出る）
    props.push({ type: 'sign', x: main.x + main.w / 2 + 0.5, y: h * 0.45, z: main.z + main.d / 2 - 1.2, w: 0.8, h: h * 0.4, d: 2.2 });
  }
  if (levels >= 2 && rnd(seed, 63) < 0.4) {   // ベランダ（住宅）
    for (let i = 1; i < levels; i++)
      props.push({ type: 'balcony', x: main.x, y: main.y + floor * i, z: main.z + main.d / 2 + 0.5, w: main.w * 0.86, h: 0.9, d: 1.0 });
  }

  const bbox = bboxOf(parts);
  return { kind: K, parts, roof: { shape: roof, on: roofOn }, props, bbox };
}

function pickKind(w, d, h, levels, seed) {
  const area = w * d, r = rnd(seed, 99);
  // 小さい建物は素直な棟。大きく低いものは L 字やコの字、高いものは基壇＋塔や段状
  if (area < 90) return r < 0.72 ? 'bar' : 'L';
  if (levels >= 7) return r < 0.4 ? 'podium' : r < 0.72 ? 'ziggurat' : 'bar';
  if (area > 700) return r < 0.3 ? 'court' : r < 0.6 ? 'U' : r < 0.82 ? 'step' : 'wing';
  return r < 0.34 ? 'L' : r < 0.54 ? 'bar' : r < 0.72 ? 'wing' : r < 0.88 ? 'step' : 'U';
}


function bboxOf(parts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  for (const p of parts) {
    x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2);
    z0 = Math.min(z0, p.z - p.d / 2); z1 = Math.max(z1, p.z + p.d / 2);
    y1 = Math.max(y1, p.y + p.h);
  }
  return { x0, x1, z0, z1, h: y1, w: x1 - x0, d: z1 - z0 };
}

/**
 * 塊りの検査。
 * @returns {{ outside, floating, fill, top, parts }}
 */
export function measureMassing(m, { w, d, h }) {
  const eps = 1e-6;
  let outside = 0;
  for (const p of m.parts) {
    if (p.x - p.w / 2 < -w / 2 - eps || p.x + p.w / 2 > w / 2 + eps
      || p.z - p.d / 2 < -d / 2 - eps || p.z + p.d / 2 > d / 2 + eps) outside++;
  }
  // P102 どれかと接している（1 部品なら自明）
  let floating = 0;
  if (m.parts.length > 1) {
    for (let i = 0; i < m.parts.length; i++) {
      const a = m.parts[i];
      let touch = false;
      for (let j = 0; j < m.parts.length && !touch; j++) {
        if (i === j) continue;
        const b = m.parts[j];
        const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
        const gz = Math.abs(a.z - b.z) - (a.d + b.d) / 2;
        const gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
        if (gx <= 0.5 && gz <= 0.5 && gy <= 0.5) touch = true;
      }
      if (!touch) floating++;
    }
  }
  const vol = m.parts.reduce((a, p) => a + p.w * p.h * p.d, 0);
  return { outside, floating, fill: vol / Math.max(1e-6, w * d * h), top: m.bbox.h, parts: m.parts.length };
}
