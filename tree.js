// 樹形。**木が同じ形で並ぶと、置いた人の手つきが見えてしまう。**
//
// 木は「幹から枝が出て、その枝からまた枝が出る」を繰り返した形をしている。
// 同じ規則を縮尺を変えて繰り返す ＝ フラクタル。地形と同じ原理だが、こちらは
// 連続した高さではなく、離散した枝分かれになる（L-system の骨だけ）。
//
// 木の種類の違いは、次の 5 つの数字でほぼ言い尽くせる。
//
//   分岐角   広葉樹は大きく開き（40〜60°）、針葉樹は水平に近く出る
//   子の数   2 本なら二又、3〜5 本なら傘状
//   縮み率   子の枝が親の何割の長さになるか。0.8 だと背が高く、0.6 だと寸詰まり
//   上向き   枝が上を向こうとする強さ（tropism）。杉は強く、枝垂れは負
//   幹の割合 幹が全高のどれだけを占めるか。松は低い所で分かれ、杉は上まで一本
//
// **描かない。** 枝の線分と葉の位置を返すだけ。太さと段数も付けるので、
// 呼ぶ側は円柱と球を並べるだけで木になる。
//
// 規則
//   B101 同じ seed・同じ種なら同じ木（決定論）
//   B102 枝は必ず親の先端から出る（浮いた枝を作らない）
//   B103 子の枝は親より短く細い（無限に育たない）
//   B104 葉は末端の枝にだけ付く
//   B105 種が違えば形が違う（樹形の特徴量が離れている）

function rnd(seed, i) {
  const x = Math.sin((seed * 57.31 + i * 173.7) * 0.83) * 43758.5453;
  return x - Math.floor(x);
}

/** 木の種。単位はメートル。 */
export const SPECIES = {
  broadleaf: { label: '広葉樹', angle: 48, children: 3, shrink: 0.72, tropism: 0.15, trunk: 0.34, depth: 4, height: 8, leafSize: 1.5, leafHue: 0.26, twist: 137 },
  cedar: { label: '杉', angle: 78, children: 5, shrink: 0.62, tropism: 0.55, trunk: 0.62, depth: 4, height: 14, leafSize: 1.1, leafHue: 0.32, twist: 72 },
  pine: { label: '松', angle: 62, children: 3, shrink: 0.68, tropism: -0.2, trunk: 0.22, depth: 4, height: 7, leafSize: 1.3, leafHue: 0.29, twist: 100 },
  zelkova: { label: '欅', angle: 32, children: 3, shrink: 0.78, tropism: 0.3, trunk: 0.42, depth: 5, height: 13, leafSize: 1.7, leafHue: 0.24, twist: 137 },
  street: { label: '街路樹', angle: 38, children: 3, shrink: 0.66, tropism: 0.35, trunk: 0.52, depth: 3, height: 6, leafSize: 1.6, leafHue: 0.27, twist: 120, pruned: true },
  willow: { label: '枝垂れ', angle: 55, children: 3, shrink: 0.76, tropism: -0.55, trunk: 0.4, depth: 4, height: 8, leafSize: 1.2, leafHue: 0.3, twist: 137 },
  palm: { label: '椰子', angle: 68, children: 7, shrink: 0.42, tropism: -0.35, trunk: 0.82, depth: 2, height: 9, leafSize: 2.2, leafHue: 0.3, twist: 51 },
  bamboo: { label: '竹', angle: 20, children: 2, shrink: 0.5, tropism: 0.7, trunk: 0.78, depth: 3, height: 11, leafSize: 0.9, leafHue: 0.34, twist: 180 },
  shrub: { label: '低木', angle: 58, children: 4, shrink: 0.6, tropism: 0.1, trunk: 0.12, depth: 3, height: 2.2, leafSize: 1.1, leafHue: 0.25, twist: 90 },
};

/**
 * 木の骨を作る。
 * @param {string|object} species SPECIES のキー、または同じ形の指定
 * @param {object} opts seed, height（上書き）, depth（上書き）
 * @returns {{ branches: Array, leaves: Array, height: number, species: string }}
 *   branches: {x0,y0,z0,x1,y1,z1,r0,r1,level}
 *   leaves:   {x,y,z,r}
 */
export function tree(species = 'broadleaf', { seed = 1, height = null, depth = null } = {}) {
  const S = typeof species === 'string' ? SPECIES[species] : species;
  if (!S) throw new Error(`知らない樹種: ${species}`);
  const H = height ?? S.height;
  const D = Math.max(1, depth ?? S.depth);
  const branches = [], leaves = [];

  // 幹。**根元から一本立てる。** ここが全部の親になる（B102）
  const trunkLen = H * S.trunk;
  const r0 = H * 0.035;
  grow({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, trunkLen, r0, 0, 0);

  function grow(from, dir, len, rad, level, idx) {
    const to = { x: from.x + dir.x * len, y: from.y + dir.y * len, z: from.z + dir.z * len };
    const rad2 = rad * (0.62 + rnd(seed, level * 31 + idx * 7) * 0.12);
    branches.push({ x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y, z1: to.z, r0: rad, r1: rad2, level });
    if (level >= D) {
      // B104 葉は末端にだけ。房を 1〜3 個、枝先の周りに散らす
      const n = S.pruned ? 3 : 1 + Math.floor(rnd(seed, idx * 13 + level) * 3);
      for (let k = 0; k < n; k++) {
        const rr = S.leafSize * (0.7 + rnd(seed, idx * 17 + k * 5) * 0.7) * (H / S.height);
        const off = rr * 0.45;
        leaves.push({
          x: to.x + (rnd(seed, idx * 19 + k) - 0.5) * off * 2,
          y: to.y + (rnd(seed, idx * 23 + k) - 0.5) * off,
          z: to.z + (rnd(seed, idx * 29 + k) - 0.5) * off * 2,
          r: rr,
        });
      }
      return;
    }
    const kids = S.children;
    for (let k = 0; k < kids; k++) {
      // 枝は親のまわりに黄金角で回して出す（同じ向きに重ならない）
      const az = ((idx * S.twist + k * (360 / kids)) * Math.PI) / 180 + rnd(seed, level * 41 + k) * 0.4;
      const el = ((S.angle * (0.75 + rnd(seed, level * 43 + k * 3) * 0.5)) * Math.PI) / 180;
      // 親の向きから el だけ倒し、az だけ回す
      let d2 = rotateFrom(dir, el, az);
      // 上向き（tropism）。正なら上へ、負なら垂れる
      d2 = normalize({ x: d2.x, y: d2.y + S.tropism * 0.6, z: d2.z });
      const len2 = len * S.shrink * (0.85 + rnd(seed, level * 47 + k * 11) * 0.3);   // B103
      grow(to, d2, len2, rad2, level + 1, idx * kids + k + 1);
    }
  }

  let top = 0; for (const b of branches) top = Math.max(top, b.y1);
  for (const l of leaves) top = Math.max(top, l.y + l.r);
  return { branches, leaves, height: top, species: typeof species === 'string' ? species : 'custom' };
}

function normalize(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }

// dir を基準に、el だけ倒して az だけ回した向き
function rotateFrom(dir, el, az) {
  const d = normalize(dir);
  // dir に直交する 2 本を作る
  const up = Math.abs(d.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const a = normalize(cross(d, up));
  const b = cross(d, a);
  const s = Math.sin(el), c = Math.cos(el);
  return normalize({
    x: d.x * c + (a.x * Math.cos(az) + b.x * Math.sin(az)) * s,
    y: d.y * c + (a.y * Math.cos(az) + b.y * Math.sin(az)) * s,
    z: d.z * c + (a.z * Math.cos(az) + b.z * Math.sin(az)) * s,
  });
}
function cross(u, v) { return { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }; }

/**
 * 樹形の特徴量。**種どうしが本当に違う形なのかを測る。**
 * @returns {number[]} 0..1 に正規化
 */
export function treeSignature(t) {
  const { branches, leaves, height } = t;
  const n = Math.max(1, branches.length);
  let spread = 0, up = 0, len = 0;
  for (const b of branches) {
    spread = Math.max(spread, Math.hypot(b.x1, b.z1));
    up += (b.y1 - b.y0) / Math.max(1e-6, Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
    len += Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  }
  const canopy = leaves.length ? leaves.reduce((a, l) => a + l.y, 0) / leaves.length / Math.max(1e-6, height) : 0;
  const leafR = leaves.length ? leaves.reduce((a, l) => a + l.r, 0) / leaves.length : 0;
  const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return [
    cl(spread / Math.max(1e-6, height)),        // 横への張り出し（樹冠の広さ）
    cl((up / n + 1) / 2),                        // 枝の上向き加減
    cl(len / Math.max(1e-6, height) / 12),       // 枝の総延長（密度）
    cl(canopy),                                  // 葉が高い所に集まっているか
    cl(leafR / 3),                               // 葉の房の大きさ
    cl(branches.length / 400),                   // 枝の数
  ];
}

/** 2 つの樹形がどれだけ違うか（0 = 同じ） */
export function treeDistance(a, b) {
  const x = treeSignature(a), y = treeSignature(b);
  let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] - y[i]) ** 2;
  return Math.sqrt(s / x.length);
}
