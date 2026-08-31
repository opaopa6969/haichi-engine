// 地区の型。**同じ町でも、場所によって並び方の規則が違う。**
//
// 繁華街と住宅街と工場地帯は、建物の大きさも隙間も屋根の形も違う。
// その違いは「好み」ではなく、そこで行われていることから決まっている。
//
//   繁華街   間口が狭く奥が深い（間口税と地価）。隙間なし。看板で埋まる
//   住宅街   小さい家に庭。区画は整然、道は狭い
//   オフィス街 大きく高く、真四角。前庭が広く壁面線が揃う（総合設計の見返り）
//   田園都市 家はまばら、間は田畑。屋敷林が家を囲む
//   港湾     大きく低い倉庫。道は広い（大型車）。緑はほぼ無い
//   工場地帯 港湾より更に大きく、真四角。陸屋根と鋸屋根
//   山岳     斜面にぽつぽつ。道は曲がる。森が主役
//   海辺     低い家が海岸線に並ぶ。松林
//   宿場町   一本の街道の両側に、間口の狭い家が連なる。奥へ広がらない
//   スラム   極小の小屋が隙間なく詰まる。道は細く不規則。屋根は片流れのトタン
//   高級住宅街 大きな家が大きな敷地に。塀と生垣、庭木が多い
//   高台     斜面の等高線に沿って、海を向いて建つ
//
// ここが返すのは **town() / greenery() / terrain() にそのまま渡せる引数** だけ。
// 何をその地区に割り当てるかは呼ぶ側が決める（このエンジンは意味を知らない）。
//
// 単位はメートル。
//
// ## 数字の出どころ（2026-09 実測）
// OSM と PLATEAU から実際の日本の町を測った（千代田区神田 1.00km²/2,551 棟、
// 高松市中心部 3.05km²/4,933 棟、徳島県阿波市 4.08km²/513 棟）。
//
//   底面積の中央値      82.8 / 77.4 / 97.9 m²（長辺 12.4 短辺 6.9 m）
//   アスペクト比 中央値  1.71 / 1.59 / 1.50 ← **真四角は 16〜21% しかない**
//   最近傍の建物まで     0.68 / 0.32 / 1.99 m ← 都市部はほぼ接している
//   5 m 以上あく割合     1.3% / 5.3% / 19.9%
//   街路への整列         91.9% / 95.7% / 57.3% が最寄り車道と 10° 以内
//   交差点の間隔         39.6 / 36.0 / 80.7 m
//   街区の面積           1,143 / 1,998 / 12,920 m²、1 街区の建物数 6 / 3 / 0
//   車道の幅             4.6 m（中央値）
//   緑地＋駐車場の面積率  1.93% / 11.50% / 0.84%
//   建物の高さ（PLATEAU 千代田 2,473 棟）中央値 21.4 m、最大 164.6 m
//
// **アスペクト比と整列率はそのまま採った。** 真四角の箱を等間隔に並べると
// 日本の町に見えないのは、この 2 つが実際と違うからだった。
//
// **隙間だけは実測を採らない。** 実際の都市部は 0.3〜0.7 m しかあかず、
// そのまま作ると歩いて通れない（measure3 の V102 が跳ね上がる）。
// ここは「歩ける街」を優先して 5 m を下限にする。実物の約 10 倍で、意図的な嘘。
//
// 屋根の形は PLATEAU の b3dm に属性が無く判別できなかったので、割合は推定のまま。

/** 屋根の形の割合。合計 1。flat=陸屋根 gable=切妻 hip=寄棟 shed=片流れ saw=鋸屋根 */
const ROOFS = {
  urban: { flat: 0.82, gable: 0.06, hip: 0.06, shed: 0.06 },
  house: { flat: 0.10, gable: 0.46, hip: 0.34, shed: 0.10 },
  old: { flat: 0.02, gable: 0.72, hip: 0.22, shed: 0.04 },
  farm: { flat: 0.02, gable: 0.40, hip: 0.52, shed: 0.06 },     // 田園の母屋は寄棟が多い
  coast: { flat: 0.06, gable: 0.30, hip: 0.28, shed: 0.36 },    // 海辺は風で片流れが増える
  dock: { flat: 0.30, gable: 0.10, hip: 0.02, shed: 0.18, saw: 0.40 }, // 上屋は鋸屋根
  shack: { flat: 0.10, gable: 0.18, hip: 0.02, shed: 0.70 },
  works: { flat: 0.55, gable: 0.18, hip: 0.02, shed: 0.10, saw: 0.15 },
};

export const DISTRICTS = {
  downtown: {
    label: '繁華街',
    spacing: 5,
    town: { minSize: 6, maxSize: 34, gap: 5, street: 9, avenueEvery: 3, emptyLotRate: 0.03, aspectRange: [0.28, 0.72], setbackSigma: 2.0 },
    greenery: { gardenPer: 0, avenueMin: 18, streetSpacing: 14, parkDensity: 1 / 60, grassCount: 400 },
    // 千代田の実測（2 階 15% / 5 階 14% / 8 階 11% / 9 階 10% / 7 階 10% / 6 階 9%）を 10 階までに畳んだもの
    levels: { 2: 0.15, 3: 0.09, 4: 0.08, 5: 0.14, 6: 0.09, 7: 0.10, 8: 0.11, 9: 0.10, 10: 0.14 },
    roofs: ROOFS.urban, signage: 'neon', ground: 'asphalt',
  },
  residential: {
    label: '住宅街',
    spacing: 7,
    town: { minSize: 5, maxSize: 14, gap: 5, street: 7, avenueEvery: 5, emptyLotRate: 0.1, aspectRange: [0.38, 0.85], setbackSigma: 4.3 },
    greenery: { gardenPer: 3, avenueMin: 12, streetSpacing: 16, parkDensity: 1 / 70, grassCount: 3000 },
    levels: { 1: 0.34, 2: 0.52, 3: 0.14 },
    roofs: ROOFS.house, signage: 'none', ground: 'asphalt',
  },
  office: {
    label: 'オフィスビル街',
    spacing: 16,
    town: { minSize: 18, maxSize: 50, gap: 12, street: 18, avenueEvery: 2, emptyLotRate: 0.08, aspectRange: [0.62, 1.05], setbackSigma: 0.6 },
    greenery: { gardenPer: 1, avenueMin: 16, streetSpacing: 15, parkDensity: 1 / 55, grassCount: 1200 },
    levels: { 5: 0.12, 6: 0.14, 7: 0.16, 8: 0.2, 9: 0.18, 10: 0.2 },
    roofs: ROOFS.urban, signage: 'plate', ground: 'stone',
  },
  garden_city: {
    label: '田園都市',
    spacing: 40,
    town: { mode: 'scatter', minSize: 6, maxSize: 20, gap: 5, scatterGap: 38, street: 7, emptyLotRate: 0.3, aspectRange: [0.4, 0.9] },
    greenery: { gardenPer: 5, avenueMin: 6, streetSpacing: 22, parkDensity: 1 / 40, grassCount: 9000, clearance: 3.5 },
    levels: { 1: 0.56, 2: 0.4, 3: 0.04 },
    roofs: ROOFS.farm, signage: 'none', ground: 'soil',
  },
  port: {
    label: '港湾地区',
    spacing: 12,
    town: { minSize: 16, maxSize: 50, gap: 10, street: 22, avenueEvery: 3, emptyLotRate: 0.14, aspectRange: [0.4, 2.2], setbackSigma: 1.0 },
    greenery: { gardenPer: 0, avenueMin: 20, streetSpacing: 26, parkDensity: 1 / 200, grassCount: 300 },
    levels: { 1: 0.42, 2: 0.34, 3: 0.16, 4: 0.08 },
    roofs: ROOFS.dock, signage: 'banner', ground: 'stone', water: 'sea',
  },
  factory: {
    label: '工場地帯',
    spacing: 11,
    town: { minSize: 20, maxSize: 50, gap: 9, street: 20, avenueEvery: 3, emptyLotRate: 0.1, aspectRange: [0.5, 2.0], setbackSigma: 0.8 },
    greenery: { gardenPer: 0, avenueMin: 18, streetSpacing: 24, parkDensity: 1 / 260, grassCount: 500 },
    levels: { 1: 0.5, 2: 0.3, 3: 0.14, 4: 0.06 },
    roofs: ROOFS.works, signage: 'plate', ground: 'concrete',
  },
  mountain: {
    label: '山岳地帯',
    spacing: 58,
    town: { mode: 'scatter', minSize: 5, maxSize: 16, gap: 5, scatterGap: 55, street: 6, aspectRange: [0.55, 1.0] },
    greenery: { gardenPer: 2, avenueMin: 6, streetSpacing: 26, parkDensity: 1 / 40, grassCount: 6000, forestLine: 0.8, treeCap: 6000 },
    levels: { 1: 0.82, 2: 0.18 },
    roofs: ROOFS.old, signage: 'none', ground: 'stone',
    slope: true,
    terrain: { maxHeight: 520, flatFeather: 260 },
  },
  seaside: {
    label: '海辺の地区',
    spacing: 9,
    town: { minSize: 5, maxSize: 18, gap: 6, street: 9, avenueEvery: 4, emptyLotRate: 0.16, aspectRange: [0.6, 1.6], setbackSigma: 2.0 },
    greenery: { gardenPer: 2, avenueMin: 12, streetSpacing: 20, parkDensity: 1 / 60, grassCount: 4000 },
    levels: { 1: 0.62, 2: 0.34, 3: 0.04 },
    roofs: ROOFS.coast, signage: 'plate', ground: 'sand', water: 'sea',
    terrain: { maxHeight: 90 },
  },
  post_town: {
    label: '山間の宿場町',
    spacing: 5,
    town: { mode: 'ribbon', minSize: 5, maxSize: 16, gap: 5, street: 9, aspectRange: [0.3, 0.7] },
    greenery: { gardenPer: 1, avenueMin: 8, streetSpacing: 15, parkDensity: 1 / 50, grassCount: 5000, forestLine: 0.78, treeCap: 5000 },
    levels: { 1: 0.36, 2: 0.62, 3: 0.02 },
    roofs: ROOFS.old, signage: 'banner', ground: 'stone',
    slope: true,
    terrain: { maxHeight: 430, flatFeather: 200 },
  },
  slum: {
    label: 'スラム街',
    spacing: 5,
    town: { minSize: 5, maxSize: 9, gap: 5, street: 6, avenueEvery: 8, emptyLotRate: 0.05, aspectRange: [0.5, 1.8], setbackSigma: 3.2 },
    greenery: { gardenPer: 0, avenueMin: 10, streetSpacing: 18, parkDensity: 1 / 300, grassCount: 900 },
    levels: { 1: 0.72, 2: 0.26, 3: 0.02 },
    roofs: ROOFS.shack, signage: 'scrawl', ground: 'soil',
  },
  affluent: {
    label: '高級住宅街',
    spacing: 20,
    town: { minSize: 14, maxSize: 34, gap: 16, street: 12, avenueEvery: 4, emptyLotRate: 0.16, aspectRange: [0.7, 1.4], setbackSigma: 5.0 },
    greenery: { gardenPer: 8, avenueMin: 11, streetSpacing: 14, parkDensity: 1 / 45, grassCount: 7000, clearance: 4 },
    levels: { 1: 0.24, 2: 0.56, 3: 0.2 },
    roofs: ROOFS.house, signage: 'none', ground: 'stone',
  },
  hilltop: {
    label: '海を見渡せる高台の家',
    spacing: 32,
    town: { mode: 'scatter', minSize: 10, maxSize: 30, gap: 5, scatterGap: 30, street: 8, aspectRange: [0.6, 1.8] },
    greenery: { gardenPer: 6, avenueMin: 8, streetSpacing: 18, parkDensity: 1 / 50, grassCount: 5000, forestLine: 0.7, clearance: 3 },
    levels: { 2: 0.44, 3: 0.46, 4: 0.1 },
    roofs: ROOFS.house, signage: 'none', ground: 'stone', water: 'sea',
    terrain: { maxHeight: 260, flatFeather: 160 }, slope: true, faceView: true,
  },
};

/**
 * 型の名前から、town()/greenery()/terrain() の引数一式を作る。
 * 上書きしたい値は over で渡す。
 */
export function districtParams(kind, over = {}) {
  const d = DISTRICTS[kind];
  if (!d) throw new Error(`知らない地区の型: ${kind}`);
  return {
    label: d.label,
    town: { ...d.town, ...(over.town ?? {}) },
    greenery: { ...d.greenery, ...(over.greenery ?? {}) },
    terrain: { ...(d.terrain ?? {}), ...(over.terrain ?? {}) },
    levels: d.levels, roofs: d.roofs,
    signage: d.signage, ground: d.ground, water: d.water ?? null,
    slope: !!d.slope, faceView: !!d.faceView, spacing: d.spacing ?? 8,
  };
}

/** 分布から 1 つ選ぶ（決定論。t は 0..1） */
export function pickFrom(dist, t) {
  const keys = Object.keys(dist);
  let acc = 0;
  for (const k of keys) { acc += dist[k]; if (t <= acc) return k; }
  return keys[keys.length - 1];
}

/** その建物の階数と屋根を決める（決定論） */
export function buildingStyle(params, seedT1, seedT2) {
  const levels = Number(pickFrom(params.levels, seedT1));
  const roof = pickFrom(params.roofs, seedT2);
  return { levels, roof, height: levels * 3 };   // 1 階 3 m
}
