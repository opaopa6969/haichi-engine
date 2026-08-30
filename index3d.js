// haichi-engine / 3D — 立体の配置と、その配置が「見えるか・歩けるか」の測定。
//
// 2D と同じ契約: 何であるかを知らない・描画しない・決定論的・依存ゼロ。
// three.js も WebGL も import しない。座標と測定値だけを返す。
//
// 3D で新しく問題になるのは 3 つで、2D の指標をそのまま持ち込んでも測れない。
//   1. **遮蔽** … 手前の物が奥の物を隠す。「置いてあるのに見えない」は 2D には無い
//   2. **通行** … 人が歩く（zumen は一人称歩行がある）。隙間が狭いと通れない
//   3. **距離による可読性** … ラベルの大きさは距離で決まる。遠い字は読めない
// 3 つとも視点を与えないと測れないので、measure3 は camera を取る。
//
//   import { blocks, relax3, project, visibleFrom, measure3 } from 'haichi-engine/3d';
import { treemap, placeLabels, measure, fitText, textWidth } from './index.js';

const sq = (x) => x * x;
export const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);

/**
 * 3D で形が違うものどうしの重なり量。2D の overlapOf と同じ理由で、
 * 球と直方体が混在すると直方体判定に落ちて誤る。
 * 球×直方体は、直方体上の最近点と中心の距離で測る。
 */
export function overlapOf3(a, b, gap = 0) {
  const aS = a.r != null, bS = b.r != null;
  if (aS && bS) return a.r + b.r + gap - dist3(a, b);
  if (!aS && !bS) return Math.min(
    (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x),
    (a.d + b.d) / 2 + gap - Math.abs(a.z - b.z),
  );
  const c = aS ? a : b, q = aS ? b : a;
  const nx = Math.max(q.x - q.w / 2, Math.min(c.x, q.x + q.w / 2));
  const nz = Math.max(q.z - q.d / 2, Math.min(c.z, q.z + q.d / 2));
  const qy = q.y ?? 0, qh = q.h ?? 0;
  const ny = Math.max(qy, Math.min(c.y ?? 0, qy + qh));
  return c.r + gap - Math.hypot(c.x - nx, (c.y ?? 0) - ny, c.z - nz);
}

/**
 * 街区に建物を建てる（CodeCity 方式）。
 * 平面（XZ）は treemap で区画に割り、高さ（Y）は別の量で決める。
 * items: [{ id, value（床面積）, height（高さの量）, children? }]
 * → Map<id, { x, y, z, w, d, h, depth, parent, district }>  x,z は中心・y は底面
 */
export function blocks(items, { w = 1000, d = 1000, padding = 6, heightScale = 1, minHeight = 4 } = {}) {
  const flat = treemap(items, { w, h: d, padding });
  const out = new Map();
  for (const [id, c] of flat) {
    const n = c.node ?? {};
    const isDistrict = !!(n.children && n.children.length);
    const h = Math.max(minHeight, (n.height ?? n.value ?? 1) * heightScale);
    out.set(id, { id, x: c.x, z: c.y, y: 0, w: c.w, d: c.h, h: isDistrict ? 0 : h, depth: c.depth, parent: c.parent, node: n, district: isDistrict });
  }
  return out;
}

/** 3D の重なり解消。球（r）でも直方体（w,d,h）でも受ける。y は既定で動かさない（地面に建つため） */
export function relax3(items, { gap = 2, iterations = 60, strength = 0.5, pinned = new Set(), moveY = false } = {}) {
  const a = items.map((it) => ({ ...it }));
  const overlapOf = (p, q) => {
    if (!moveY || p.r != null || q.r != null) return overlapOf3(p, q, gap);
    // y も動かす場合だけ、高さ方向の離れも「離れている」とみなす
    const oy = (p.h + q.h) / 2 + gap - Math.abs((p.y ?? 0) - (q.y ?? 0));
    return Math.min(overlapOf3(p, q, gap), oy);
  };
  for (let k = 0; k < iterations; k++) {
    let moved = 0;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const p = a[i], q = a[j];
      const ov = overlapOf(p, q);
      if (ov <= 0) continue;
      let dx = q.x - p.x, dy = moveY ? (q.y ?? 0) - (p.y ?? 0) : 0, dz = q.z - p.z;
      const dd = Math.hypot(dx, dy, dz) || 1e-6;
      dx /= dd; dy /= dd; dz /= dd;
      const push = (ov * strength) / 2;
      if (!pinned.has(p.id)) { p.x -= dx * push; p.z -= dz * push; if (moveY) p.y = (p.y ?? 0) - dy * push; moved += push; }
      if (!pinned.has(q.id)) { q.x += dx * push; q.z += dz * push; if (moveY) q.y = (q.y ?? 0) + dy * push; moved += push; }
    }
    if (moved < 0.01) break;
  }
  return new Map(a.map((it) => [it.id, it]));
}

/**
 * 透視投影。three.js を使わずに、視点から見た画面座標を出す。
 * camera: { x, y, z, target:{x,y,z}, up?, fov?（度）, width, height, near? }
 * → { x, y, depth（視点からの距離）, behind, scale（1 world unit が何 px か） }
 */
export function project(p, camera) {
  const cx = camera.x, cy = camera.y, cz = camera.z;
  const t = camera.target ?? { x: 0, y: 0, z: 0 };
  const up = camera.up ?? { x: 0, y: 1, z: 0 };
  const fov = ((camera.fov ?? 50) * Math.PI) / 180;
  const W = camera.width ?? 1600, H = camera.height ?? 900;
  let fx = t.x - cx, fy = t.y - cy, fz = t.z - cz;
  const fl = Math.hypot(fx, fy, fz) || 1e-6; fx /= fl; fy /= fl; fz /= fl;
  let rx = fy * up.z - fz * up.y, ry = fz * up.x - fx * up.z, rz = fx * up.y - fy * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1e-6; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const vx = p.x - cx, vy = (p.y ?? 0) - cy, vz = p.z - cz;
  const zc = vx * fx + vy * fy + vz * fz;
  const xc = vx * rx + vy * ry + vz * rz;
  const yc = vx * ux + vy * uy + vz * uz;
  const near = camera.near ?? 0.1;
  if (zc <= near) return { x: NaN, y: NaN, depth: zc, behind: true, scale: 0 };
  const f = H / 2 / Math.tan(fov / 2);
  return { x: W / 2 + (xc * f) / zc, y: H / 2 - (yc * f) / zc, depth: zc, behind: false, scale: f / zc };
}

/**
 * 視点から見えるものを返す。視錐台の外を落とし、手前の物に完全に隠れるものも落とす。
 * 遮蔽はバウンディング球を画面へ投影した円で近似する（正確さより速さ。
 * ゲームの階層 Z カリングと同じ発想で、迷ったら「見える」側へ倒す）。
 */
export function visibleFrom(objects, camera, { margin = 0 } = {}) {
  const W = camera.width ?? 1600, H = camera.height ?? 900;
  const rows = [];
  for (const o of objects) {
    const c = { x: o.x, y: (o.y ?? 0) + (o.h ?? 0) / 2, z: o.z };
    const p = project(c, camera);
    if (p.behind) continue;
    const rWorld = o.r ?? Math.hypot(o.w ?? 0, o.d ?? 0, o.h ?? 0) / 2;
    const rPx = rWorld * p.scale;
    if (p.x + rPx < -margin || p.x - rPx > W + margin || p.y + rPx < -margin || p.y - rPx > H + margin) continue;
    rows.push({ id: o.id, obj: o, sx: p.x, sy: p.y, depth: p.depth, rPx, scale: p.scale });
  }
  rows.sort((a, b) => a.depth - b.depth);
  const kept = [];
  const occluded = [];
  for (const r of rows) {
    const hidden = kept.some((k) => k.depth < r.depth - 1e-6 && Math.hypot(k.sx - r.sx, k.sy - r.sy) + r.rPx <= k.rPx);
    if (hidden) occluded.push(r); else kept.push(r);
  }
  return { visible: kept, occluded };
}

/**
 * 3D 配置の測定。視点を与えないと「見えるか」は測れないので camera が要る。
 * objects: [{ id, x, y, z, w, d, h }] か [{ id, x, y, z, r }]。label / labelHeight は任意
 */
export function measure3(objects, edges = [], camera = null, opts = {}) {
  const gap = opts.gap ?? 2, minFont = opts.minFont ?? 9, walkWidth = opts.walkWidth ?? 0, cw = opts.cw ?? 0.55;
  const problems = [];

  // V101 立体どうしの重なり（入れ子は重なりではないので parent が同じものだけ比べる）
  let overlaps = 0;
  const groups = new Map();
  for (const o of objects) { const k = o.parent ?? '__root__'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  for (const g of groups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const p = g[i], q = g[j];
    const ov = overlapOf3(p, q, gap);
    if (ov > 0.5) { overlaps++; if (problems.length < 300) problems.push({ code: 'V101', id: p.id, message: `${p.id} と ${q.id} が ${ov.toFixed(1)} 重なっている（必要な隙間 ${gap}）— relax3() で押し離す` }); }
  }

  // V102 通れない隙間。歩ける前提の街なら、建物の間に人が通る幅が要る
  let narrow = 0;
  if (walkWidth > 0) {
    const solid = objects.filter((o) => (o.h ?? 0) > 0 && !o.district);
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const p = solid[i], q = solid[j];
      const dx = Math.abs(p.x - q.x) - (p.w + q.w) / 2;
      const dz = Math.abs(p.z - q.z) - (p.d + q.d) / 2;
      const blocked = (dx < 0 && dz > 0 && dz < walkWidth) || (dz < 0 && dx > 0 && dx < walkWidth);
      if (blocked) { narrow++; if (problems.length < 300) problems.push({ code: 'V102', id: p.id, message: `${p.id} と ${q.id} の隙間が ${Math.max(dx, dz).toFixed(1)}（歩ける幅 ${walkWidth}）— 通り抜けられない。区画の padding を広げる` }); }
    }
  }

  let occluded = 0, tooSmall = 0, visibleRatio = 1;
  if (camera) {
    const seen = visibleFrom(objects, camera);
    occluded = seen.occluded.length;
    visibleRatio = objects.length ? seen.visible.length / objects.length : 1;
    if (occluded / Math.max(1, objects.length) > 0.3) {
      problems.push({ code: 'V103', id: '(全体)', message: `${occluded}/${objects.length} が手前の物に完全に隠れている（${(occluded / objects.length * 100).toFixed(0)}%、目安 30% 以下）— 視点を上げるか、高い建物を外側に置く` });
    }
    // V104〜V106 ラベルは画面へ投影してから 2D の道具で測る（同じ問題なので同じ道具を使う）
    const shapes = seen.visible.filter((v) => v.obj.label).map((v) => {
      const worldFont = v.obj.labelHeight ?? Math.max(2, (v.obj.h ?? v.obj.r ?? 4) * 0.25);
      return { id: v.id, x: v.sx, y: v.sy, r: Math.max(2, v.rPx), label: v.obj.label, font: worldFont * v.scale };
    });
    tooSmall = shapes.filter((s) => s.font < minFont).length;
    if (tooSmall) {
      const worst = Math.min(...shapes.map((s) => s.font));
      problems.push({ code: 'V104', id: '(全体)', message: `${tooSmall} 個のラベルがこの距離では ${worst.toFixed(1)}px（読める最小 ${minFont}px）— 距離でフェードさせるか、寄るまで出さない` });
    }
    const placed = placeLabels(shapes, { minFont, gap: 2, cw });
    let jammed = 0;
    for (const p of placed.values()) if (p.hidden && p.why && p.why.includes('埋まって')) jammed++;
    if (jammed) problems.push({ code: 'V105', id: '(全体)', message: `${jammed} 個のラベルが画面上で置き場所を失っている — 表示数に上限を設けるか、視点を引く` });
    for (const p of measure(shapes, [], { minFont, cw }).problems.filter((x) => x.code === 'H102').slice(0, 20)) problems.push({ ...p, code: 'V106' });
  }

  // V107 高さの落差が極端だと、低い建物が谷に埋もれて見えない
  const hs = objects.filter((o) => (o.h ?? 0) > 0).map((o) => o.h);
  const hMax = hs.length ? Math.max(...hs) : 0;
  const hMed = hs.length ? hs.slice().sort((a, b) => a - b)[Math.floor(hs.length / 2)] : 0;
  if (hMed > 0 && hMax / hMed > 40) {
    problems.push({ code: 'V107', id: '(全体)', message: `最も高い建物が中央値の ${(hMax / hMed).toFixed(0)} 倍（目安 40 倍以下）— 低い建物が谷に埋もれる。高さを対数にするか上限で頭打ちにする` });
  }

  return {
    problems,
    metrics: { objects: objects.length, overlaps, narrowGaps: narrow, occluded, visibleRatio, unreadableLabels: tooSmall, heightRatio: hMed ? hMax / hMed : null },
  };
}

/** 距離から LOD の段を返す。ゲームと同じで、遠いものに手をかけない */
export function lodFor(distance, { steps = [40, 120, 400] } = {}) {
  for (let i = 0; i < steps.length; i++) if (distance < steps[i]) return i;
  return steps.length;
}

/**
 * 意味の LOD。距離ではなく**画面に占める大きさ**で、どの深さまで開くかを決める。
 * 遠景は repository、寄ると component、さらに寄ると unit、という切り替え。
 * ヒステリシス（enter/exit で閾値を変える）を入れて、境界での点滅を防ぐ。
 */
export function semanticLod(objects, camera, { minPx = 24, hysteresis = 1.35, open = new Set() } = {}) {
  const show = [], collapse = [];
  for (const o of objects) {
    const p = project({ x: o.x, y: (o.y ?? 0) + (o.h ?? 0) / 2, z: o.z }, camera);
    if (p.behind) { collapse.push(o.id); continue; }
    const px = (o.r ?? Math.max(o.w ?? 0, o.d ?? 0) / 2) * 2 * p.scale;
    const wasOpen = open.has(o.id);
    const th = wasOpen ? minPx : minPx * hysteresis;   // 開いているものは閉じにくくする
    (px >= th ? show : collapse).push(o.id);
  }
  return { open: new Set(show), collapsed: collapse };
}

/**
 * 空間ハッシュ。「近くのものだけ」を引くための格子。
 * 総当たりが重くなる規模（数千）で relax3 や当たり判定・ラベル候補抽出の前段に使う。
 */
export function spatialHash(objects, { cell = 64 } = {}) {
  const map = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const o of objects) { const k = key(o.x, o.z); if (!map.has(k)) map.set(k, []); map.get(k).push(o); }
  return {
    cells: map.size,
    near(x, z, radius = cell) {
      const out = [];
      const r = Math.ceil(radius / cell);
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const g = map.get(`${cx + i},${cz + j}`); if (g) out.push(...g); }
      return out;
    },
  };
}
