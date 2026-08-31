// 地形。**山も丘も川も、乱数を「重ねる」ことでできている。**
//
// 山が山に見えるのは、大きなうねりの上に中くらいのうねりが乗り、その上に細かい
// でこぼこが乗っているから。同じ形が縮尺を変えて何度も出てくる ＝ フラクタル。
// 実装は「振幅を半分・周期を半分にしながら足す」だけ（fBm: fractional Brownian motion）。
//
// もう一つ、山を山らしくするのは **稜線** で、これは値の絶対値を折り返すと出る
// （ridged noise）。丘は折り返さない素の fBm。
//
// 川は逆に「削る」。地形の上に川筋を引き、その線からの距離で谷を掘る。
// 川が谷底を流れるのは、水が低い所を選ぶからで、生成でも同じ順番にする
// （先に地形 → 川筋 → 谷を掘る → 掘った跡が谷）。
//
// **描かない。** 高さの配列と、川筋の折れ線を返すだけ。
//
// 規則
//   R101 同じ seed・同じ大きさなら同じ地形（決定論）
//   R102 heightAt(x,z) は格子の外でも連続した値を返す（街の外に行っても崖が出ない）
//   R103 街の敷地（flat 領域）は平らにする。町を斜面に建てない
//   R104 川は必ず端から端まで通る（途中で消える川は不自然）
//   R105 川筋は町の敷地を避けて通す（建物の下を川が流れない）

// 決定論の 2D 値ノイズ。格子点でハッシュ → 双三次っぽく補間
function hash2(seed, ix, iz) {
  const h = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(seed, x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(seed, ix, iz), b = hash2(seed, ix + 1, iz);
  const c = hash2(seed, ix, iz + 1), d = hash2(seed, ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * 重ねノイズ（fBm）。ridged=true にすると稜線の立った山になる。
 * @param {number} octaves 重ねる枚数。多いほど細かいでこぼこが乗る
 */
export function fbm(seed, x, z, { octaves = 5, lacunarity = 2.0, gain = 0.5, ridged = false } = {}) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let v = valueNoise(seed + o * 17, x * freq, z * freq);
    if (ridged) v = 1 - Math.abs(v * 2 - 1);   // 折り返すと稜線が立つ
    sum += v * amp; norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * 地形を作る。
 * @param {object} opts
 *   span        地形の一辺（世界座標）
 *   res         格子の解像度（res×res の高さ配列）
 *   seed        乱数の種
 *   maxHeight   いちばん高い所の高さ
 *   flat        平らにしておく矩形 {x0,z0,x1,z1}（町の敷地）。R103
 *   flatFeather 平地から山へなじませる幅
 *   river       川を通すか。R104/R105
 *   riverWidth  川幅
 *   riverDepth  掘る深さ
 * @returns {{ height: Float32Array, res, span, heightAt(x,z), river: Array, maxHeight }}
 */
export function terrain({
  span = 4000, res = 129, seed = 1, maxHeight = 300,
  flat = null, flatFeather = 400,
  river = true, riverWidth = 40, riverDepth = 26,
} = {}) {
  const height = new Float32Array(res * res);
  const step = span / (res - 1);
  const wx = (i) => -span / 2 + i * step;
  // 敷地の外へ 1 格子ぶんはみ出して平らにする幅。**平らにする側と掘る側で同じ幅を使う。**
  // 別々にすると、平らにした縁を川が掘って、境界の補間が負の値を拾う（実測: 敷地内 -23.5）。
  const pad = step * 1.5;

  // 1) 遠くほど高い。町の周りは平野、外縁に山（実際の盆地の町がこの形）
  //    中心からの距離を 0..1 にして、外側で立ち上げる
  const half = span / 2;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = wx(i), z = wx(j);
    const r = Math.max(Math.abs(x), Math.abs(z)) / half;      // 正方形の距離（街の外周に沿って山が並ぶ）
    const rise = Math.max(0, (r - 0.42) / 0.58) ** 1.8;        // 0.42 より内側は平野
    const hills = fbm(seed, x / 700, z / 700, { octaves: 4, gain: 0.55 });          // なだらかな丘
    const mount = fbm(seed + 91, x / 950, z / 950, { octaves: 6, gain: 0.5, ridged: true }); // 稜線のある山
    const detail = fbm(seed + 7, x / 140, z / 140, { octaves: 3, gain: 0.45 }) - 0.5;
    const h = (hills * 0.35 + mount * rise * 1.25) * maxHeight + detail * 12 * (0.2 + rise);
    height[j * res + i] = h;
  }

  // 2) 町の敷地は平ら（R103）。境目は feather でなじませる
  if (flat) {
    const fx0 = flat.x0 - pad, fx1 = flat.x1 + pad, fz0 = flat.z0 - pad, fz1 = flat.z1 + pad;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = wx(i), z = wx(j);
      const dx = Math.max(fx0 - x, 0, x - fx1);
      const dz = Math.max(fz0 - z, 0, z - fz1);
      const dist = Math.hypot(dx, dz);
      if (dist >= flatFeather) continue;
      const t = smooth(dist / flatFeather);       // 0 = 敷地の中 → 完全に平ら
      height[j * res + i] *= t;
    }
  }

  // 3) 川。町の敷地を避けて端から端まで通し（R104/R105）、線に沿って谷を掘る
  const path = [];
  if (river) {
    // 上から下へ。x はノイズで蛇行させ、敷地に入りそうなら外へ押し出す
    const bankW = riverWidth * 2.6;
    const steps = 48;
    for (let k = 0; k <= steps; k++) {
      const z = -half + (span * k) / steps;
      let x = (fbm(seed + 313, z / 900, 0.5, { octaves: 3, gain: 0.55 }) - 0.5) * span * 0.55;
      if (flat) {
        const cx = (flat.x0 + flat.x1) / 2;
        const inZ = z > flat.z0 - riverWidth && z < flat.z1 + riverWidth;
        if (inZ) {
          // 敷地の左右どちらか近い側へ寄せる（町を割らない）
          const side = x < cx ? -1 : 1;
          // **岸まで含めて敷地の外に出す。** 川筋だけ外に出しても、掘る幅（岸）が
          // 敷地に食い込んで町が平らでなくなる（実測: 敷地内の起伏 24.5）。
          const edge = side < 0 ? flat.x0 - bankW - riverWidth : flat.x1 + bankW + riverWidth;
          x = edge;
        }
      }
      path.push({ x, z });
    }
    // 掘る。川筋からの距離で断面を作る（真ん中が深く、岸へなだらかに）
    const bank = bankW;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = wx(i), z = wx(j);
      // 敷地の中は掘らない（R103 を掘削より優先する）
      if (flat && x > flat.x0 - pad && x < flat.x1 + pad && z > flat.z0 - pad && z < flat.z1 + pad) continue;
      const dist = distToPath(path, x, z);
      if (dist > bank) continue;
      const t = dist / bank;
      const cut = riverDepth * (1 - smooth(t)) ** 1.4;
      height[j * res + i] -= cut;
    }
  }

  const heightAt = (x, z) => {
    // R102: 格子の外は端の値を使う（崖にしない）
    const fi = Math.min(res - 1, Math.max(0, (x + half) / step));
    const fj = Math.min(res - 1, Math.max(0, (z + half) / step));
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const i1 = Math.min(res - 1, i0 + 1), j1 = Math.min(res - 1, j0 + 1);
    const tx = fi - i0, tz = fj - j0;
    const a = height[j0 * res + i0], b = height[j0 * res + i1];
    const c = height[j1 * res + i0], d = height[j1 * res + i1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  let mh = 0; for (const h of height) if (h > mh) mh = h;
  return { height, res, span, step, heightAt, river: path, riverWidth, maxHeight: mh };
}

// 折れ線までの距離（線分ごとに測って最小）
function distToPath(path, x, z) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const vx = b.x - a.x, vz = b.z - a.z;
    const l2 = vx * vx + vz * vz;
    let t = l2 ? ((x - a.x) * vx + (z - a.z) * vz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + vx * t), dz = z - (a.z + vz * t);
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  return best;
}
export { distToPath };

/**
 * 地形の検査。**山に見えるかを数える。**
 * @returns {{ flatInside, relief, ridgeRatio, riverCrosses, continuous }}
 */
export function measureTerrain(t, { flat = null } = {}) {
  const { height, res, heightAt, span } = t;
  let max = -Infinity, min = Infinity;
  for (const h of height) { if (h > max) max = h; if (h < min) min = h; }
  // 敷地の中が平らか（R103）
  let flatInside = 0;
  if (flat) {
    let mx = -Infinity, mn = Infinity;
    for (let z = flat.z0; z <= flat.z1; z += (flat.z1 - flat.z0) / 12)
      for (let x = flat.x0; x <= flat.x1; x += (flat.x1 - flat.x0) / 12) {
        const h = heightAt(x, z); if (h > mx) mx = h; if (h < mn) mn = h;
      }
    flatInside = mx - mn;
  }
  // 稜線らしさ: 隣との差が大きい格子の割合（のっぺりだと 0 に近い）
  let steep = 0, n = 0;
  for (let j = 1; j < res - 1; j++) for (let i = 1; i < res - 1; i++) {
    const h = height[j * res + i];
    const g = Math.max(Math.abs(h - height[j * res + i - 1]), Math.abs(h - height[(j - 1) * res + i]));
    n++; if (g > (max - min) * 0.02) steep++;
  }
  // 川が端から端まで通っているか（R104）
  const zs = t.river.map((p) => p.z);
  const riverCrosses = t.river.length > 1 && Math.min(...zs) <= -span / 2 + 1 && Math.max(...zs) >= span / 2 - 1;
  // 外挿が連続か（R102）: 境界のすぐ外と内で値が飛ばない
  const e = heightAt(span / 2 + 500, 0), i2 = heightAt(span / 2 - 1, 0);
  return {
    flatInside, relief: max - min, ridgeRatio: steep / n, riverCrosses,
    continuous: Math.abs(e - i2) < (max - min) * 0.05,
  };
}
