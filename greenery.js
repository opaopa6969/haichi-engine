// 草木の配置。**どこに生えているかで、木の意味が違う。**
//
// 一様乱数で散らすと、道の真ん中に木が立ち、建物にめり込み、密度がどこも同じになる。
// 実際の町では木は次の 4 通りの生え方をしていて、それぞれ規則が違う。
//
//   庭   … 建物の敷地の余白。**建物ごとに数本**、壁から少し離れて、不揃い
//   街路樹 … 大きな通りの脇。**等間隔に整然と**並ぶ。道の両側
//   公園 … 空き地にまとまって。密度が高く、間隔は不揃い。下草も濃い
//   山林 … 斜面。**標高が上がるほど密**、ただし森林限界より上は生えない。傾斜が急すぎる所も薄い
//
// 草は木より広く、道路と建物の上を除いた地面すべてに、公園と河川敷を濃くして撒く。
//
// **描かない。** 位置・大きさ・種別を返すだけ。
//
// 規則
//   G101 建物の上・道路の上には生やさない
//   G102 街路樹は道に沿って等間隔（ばらつきは幹の太さと高さだけ）
//   G103 庭木は建物ごとに、壁から clearance 以上離す
//   G104 山林の密度は標高に比例し、森林限界より上と急斜面では減る
//   G105 同じ入力なら同じ植生（決定論）

function rnd(seed, i) {
  const x = Math.sin((seed * 91.7 + i * 217.3) * 0.61) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 草木を置く。
 * @param {object} src
 *   buildings  [{x, z, w, d}]（町の建物。庭木の親になる）
 *   streets    [{x0, z0, x1, z1, w}]（通り。街路樹の親になる）
 *   lots       [{x, z, w, d}]（空き地＝公園）
 *   terrain    { heightAt(x,z), span, maxHeight }（山林用。無ければ山林は作らない）
 *   flat       {x0,z0,x1,z1} 町の敷地（この中は山林にしない）
 * @param {object} opts
 *   seed, gardenPer（庭木の本数/建物）, avenueMin（街路樹を植える通りの幅）,
 *   streetSpacing（街路樹の間隔）, clearance（壁からの離れ）,
 *   parkDensity（公園の木/面積）, forestLine（森林限界の高さの割合 0..1）,
 *   grassCount（草の本数）
 * @returns {{ trees: Array, grass: Array, counts: object }}
 *   trees: {x, z, y, s, kind}  kind = garden | street | park | forest
 *   grass: {x, z, y, s, r, kind}  kind = lawn | park | bank
 */
export function greenery({ buildings = [], streets = [], lots = [], terrain = null, flat = null } = {}, {
  seed = 1, gardenPer = 2, avenueMin = 12, streetSpacing = 18, clearance = 2.5,
  parkDensity = 1 / 90, forestLine = 0.72, grassCount = 4000, treeCap = 4000,
} = {}) {
  const trees = []; const grass = [];
  const blocked = boxIndex(buildings, streets);

  // 1) 庭木。**建物ごとに**、敷地の余白に。壁からは clearance 以上離す（G103）
  let k = 0;
  for (const b of buildings) {
    const n = Math.round(gardenPer * (0.4 + rnd(seed, k * 3 + 1) * 1.2));
    for (let i = 0; i < n; i++) {
      const side = Math.floor(rnd(seed, k * 13 + i * 7 + 2) * 4);
      const t = 0.15 + rnd(seed, k * 19 + i * 11 + 3) * 0.7;
      const off = clearance + rnd(seed, k * 23 + i * 5 + 4) * clearance * 1.6;
      let x, z;
      if (side === 0) { x = b.x - b.w / 2 + b.w * t; z = b.z - b.d / 2 - off; }
      else if (side === 1) { x = b.x - b.w / 2 + b.w * t; z = b.z + b.d / 2 + off; }
      else if (side === 2) { x = b.x - b.w / 2 - off; z = b.z - b.d / 2 + b.d * t; }
      else { x = b.x + b.w / 2 + off; z = b.z - b.d / 2 + b.d * t; }
      if (blocked.hit(x, z, clearance * 0.96)) continue;     // G101/G103（隣家の壁も見る）
      trees.push({ x, z, y: 0, s: 0.55 + rnd(seed, k * 29 + i) * 0.5, kind: 'garden' });
      k++;
    }
    k++;
  }

  // 2) 街路樹。**大きな通りだけ**、道の両側に等間隔（G102）
  let s = 0;
  for (const st of streets) {
    if (st.w < avenueMin) continue;
    const dx = st.x1 - st.x0, dz = st.z1 - st.z0;
    const len = Math.hypot(dx, dz); if (len < streetSpacing * 2) continue;
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;                                  // 道に直交する向き
    const off = st.w / 2 + 1.6;                               // 歩道の位置
    const n = Math.floor(len / streetSpacing);
    for (let i = 1; i < n; i++) {
      const t = (i * streetSpacing) / len;
      for (const sgn of [-1, 1]) {
        const x = st.x0 + dx * t + nx * off * sgn;
        const z = st.z0 + dz * t + nz * off * sgn;
        if (blocked.hit(x, z)) continue;
        // 整然と並ぶので位置は散らさない。散らすのは幹の太さと高さだけ
        trees.push({ x, z, y: 0, s: 0.9 + rnd(seed, s * 7 + i) * 0.25, kind: 'street' });
        s++;
      }
    }
  }

  // 3) 公園。空き地にまとまって、間隔は不揃い
  let p = 0;
  for (const lot of lots) {
    const area = lot.w * lot.d;
    const n = Math.max(3, Math.round(area * parkDensity));
    for (let i = 0; i < n; i++) {
      const x = lot.x - lot.w / 2 + rnd(seed, p * 11 + i * 3 + 5) * lot.w;
      const z = lot.z - lot.d / 2 + rnd(seed, p * 17 + i * 5 + 9) * lot.d;
      if (blocked.hit(x, z, 1.5)) continue;
      trees.push({ x, z, y: 0, s: 0.8 + rnd(seed, p * 23 + i) * 0.8, kind: 'park' });
      p++;
    }
    // 公園の下草
    for (let i = 0; i < Math.round(area / 12); i++) {
      const x = lot.x - lot.w / 2 + rnd(seed, p * 31 + i * 7 + 1) * lot.w;
      const z = lot.z - lot.d / 2 + rnd(seed, p * 37 + i * 3 + 2) * lot.d;
      if (blocked.hit(x, z)) continue;
      grass.push({ x, z, y: 0, s: 0.8 + rnd(seed, i * 13) * 0.8, r: rnd(seed, i * 19) * Math.PI, kind: 'park' });
    }
  }

  // 4) 山林。標高に比例、森林限界より上と急斜面では減る（G104）
  if (terrain) {
    const { heightAt, span, maxHeight } = terrain;
    const limit = maxHeight * forestLine;
    const tries = Math.min(treeCap * 4, 24000);
    for (let i = 0; i < tries && trees.length < treeCap; i++) {
      const x = (rnd(seed, i * 3 + 71) - 0.5) * span;
      const z = (rnd(seed, i * 5 + 97) - 0.5) * span;
      if (flat && x > flat.x0 && x < flat.x1 && z > flat.z0 && z < flat.z1) continue;  // 町は山林にしない
      const h = heightAt(x, z);
      if (h < 4) continue;                                   // 平野・水面には生やさない
      // 標高が高いほど密。ただし森林限界を超えると急に減る
      let dens = Math.min(1, h / Math.max(1, limit));
      if (h > limit) dens = Math.max(0, 1 - (h - limit) / Math.max(1, maxHeight - limit)) * 0.6;
      // 傾斜: 急すぎる所は薄い
      const gx = heightAt(x + 12, z) - heightAt(x - 12, z), gz = heightAt(x, z + 12) - heightAt(x, z - 12);
      const slope = Math.hypot(gx, gz) / 24;
      dens *= Math.max(0.12, 1 - slope * 0.9);
      if (rnd(seed, i * 7 + 11) > dens) continue;
      trees.push({ x, z, y: h, s: 0.7 + rnd(seed, i * 11) * 0.7, kind: 'forest' });
    }
  }

  // 5) 草。地面のうち建物と道路を除いた所へ。河川敷は濃く
  const span = terrain?.span ?? (flat ? Math.max(flat.x1 - flat.x0, flat.z1 - flat.z0) * 1.4 : 2000);
  for (let i = 0; i < grassCount * 3 && grass.length < grassCount; i++) {
    const x = (rnd(seed, i * 13 + 3) - 0.5) * span;
    const z = (rnd(seed, i * 17 + 7) - 0.5) * span;
    if (blocked.hit(x, z)) continue;
    const y = terrain ? terrain.heightAt(x, z) : 0;
    if (y < -1) continue;                                    // 水の中には生やさない
    const bank = y > -1 && y < 3;                            // 低い所＝河川敷
    grass.push({ x, z, y, s: (bank ? 1.0 : 0.6) + rnd(seed, i * 23) * 0.8, r: rnd(seed, i * 29) * Math.PI, kind: bank ? 'bank' : 'lawn' });
  }

  const counts = {};
  for (const t of trees) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
  for (const g of grass) counts[`grass:${g.kind}`] = (counts[`grass:${g.kind}`] ?? 0) + 1;
  return { trees, grass, counts };
}

// 建物と道路の占有。格子に登録して O(1) で当たりを見る
function boxIndex(buildings, streets, cell = 40) {
  const map = new Map();
  const put = (b) => {
    const x0 = Math.floor((b.x - b.w / 2) / cell), x1 = Math.floor((b.x + b.w / 2) / cell);
    const z0 = Math.floor((b.z - b.d / 2) / cell), z1 = Math.floor((b.z + b.d / 2) / cell);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const k = `${x},${z}`; if (!map.has(k)) map.set(k, []); map.get(k).push(b);
    }
  };
  for (const b of buildings) put(b);
  for (const st of streets) {
    // 道路は線分。矩形に直して登録する
    const cx = (st.x0 + st.x1) / 2, cz = (st.z0 + st.z1) / 2;
    put({ x: cx, z: cz, w: Math.abs(st.x1 - st.x0) + st.w, d: Math.abs(st.z1 - st.z0) + st.w });
  }
  return {
    // margin を渡すと、その距離まで近づいたものも「当たり」にする。
    // **隣家の壁も見る。** 自分の建物からだけ離しても、隣の壁にめり込む（実測 57/312）。
    hit(x, z, margin = 0) {
      const r = Math.ceil(margin / cell);
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        for (const b of map.get(`${cx + i},${cz + j}`) ?? []) {
          if (Math.abs(x - b.x) <= b.w / 2 + margin && Math.abs(z - b.z) <= b.d / 2 + margin) return true;
        }
      }
      return false;
    },
  };
}

/**
 * 植生の検査。**言われた場所に生えているかを数える。**
 */
export function measureGreenery({ trees, grass }, { buildings = [], streets = [], avenueMin = 12, streetSpacing = 18 } = {}) {
  const blocked = boxIndex(buildings, streets);
  let onBlocked = 0;
  for (const t of trees) if (blocked.hit(t.x, t.z)) onBlocked++;
  for (const g of grass) if (blocked.hit(g.x, g.z)) onBlocked++;
  // 街路樹が等間隔か: 隣との距離のばらつき
  const st = trees.filter((t) => t.kind === 'street').sort((a, b) => a.x - b.x || a.z - b.z);
  let spacingSd = 0;
  if (st.length > 4) {
    const ds = [];
    for (let i = 1; i < st.length; i++) {
      const d = Math.hypot(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z);
      if (d < streetSpacing * 2.5) ds.push(d);
    }
    if (ds.length > 2) {
      const m = ds.reduce((a, v) => a + v, 0) / ds.length;
      spacingSd = Math.sqrt(ds.reduce((a, v) => a + (v - m) ** 2, 0) / ds.length);
    }
  }
  const kinds = {};
  for (const t of trees) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
  return { onBlocked, streetSpacingSd: spacingSd, kinds, trees: trees.length, grass: grass.length };
}
