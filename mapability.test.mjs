import { mapability, districtSignature } from './cognitive.js';
import { DISTRICTS, districtParams, buildingStyle, pickFrom } from './districts.js';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.error(`NG ${n} ${e}`); } };

// 12 の型が、特徴として互いに区別できること（**これが「覚えられる」の前提**）
const sigs = Object.entries(DISTRICTS).map(([k, d]) => {
  const p = districtParams(k);
  // その型らしい建物を 60 棟ぶん作って特徴を取る
  const buildings = Array.from({ length: 60 }, (_, i) => {
    const st = buildingStyle(p, (i * 0.618) % 1, (i * 0.381) % 1);
    const w = p.town.minSize + ((i * 7) % 10) / 10 * (p.town.maxSize - p.town.minSize);
    return { w, d: w * (p.town.aspectRange[0] + ((i * 3) % 10) / 10 * (p.town.aspectRange[1] - p.town.aspectRange[0])), height: st.height };
  });
  const area = 300 * 300;
  return { k, sig: districtSignature({ buildings, trees: (p.greenery.gardenPer ?? 0) * 60 + (p.greenery.grassCount ?? 0) / 40, area, roofs: p.roofs, ground: p.ground, signage: p.signage, spacing: p.spacing, slope: p.slope }) };
});
let tooClose = [];
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
  let s = 0; for (let k = 0; k < sigs[i].sig.length; k++) s += (sigs[i].sig[k] - sigs[j].sig[k]) ** 2;
  const d = Math.sqrt(s / sigs[i].sig.length);
  if (d < 0.12) tooClose.push([sigs[i].k, sigs[j].k, d.toFixed(3)]);
}
ok('12 の型が互いに区別できる', tooClose.length === 0, JSON.stringify(tooClose));
ok('型はすべて引数を返す', Object.keys(DISTRICTS).every((k) => districtParams(k).town.minSize > 0));
ok('知らない型は例外', (() => { try { districtParams('nope'); return false; } catch { return true; } })());

// 階数と屋根が分布どおりに出る
{
  const p = districtParams('residential');
  const counts = {};
  for (let i = 0; i < 1000; i++) { const s = buildingStyle(p, i / 1000, ((i * 7) % 1000) / 1000); counts[s.levels] = (counts[s.levels] ?? 0) + 1; }
  ok('住宅街は 2 階建てが最多', Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) === 2, JSON.stringify(counts));
  const p2 = districtParams('office');
  const c2 = {}; for (let i = 0; i < 1000; i++) { const s = buildingStyle(p2, i / 1000, 0.5); c2[s.levels] = (c2[s.levels] ?? 0) + 1; }
  ok('オフィス街は 5 階以上だけ', Object.keys(c2).every((k) => Number(k) >= 5), JSON.stringify(c2));
  ok('高さは階数 × 3 m', buildingStyle(p, 0.1, 0.1).height === buildingStyle(p, 0.1, 0.1).levels * 3);
}
// M101: 同じ型を並べると警告が出る
{
  const mk = (id, kind, x, z) => ({ id, kind, x, z, w: 200, d: 200, area: 40000, trees: 40, roofs: DISTRICTS[kind].roofs,
    buildings: Array.from({ length: 30 }, () => ({ w: 12, d: 12, height: 6 })) });
  const same = mapability({ districts: [mk('a', 'residential', 0, 0), mk('b', 'residential', 210, 0), mk('c', 'residential', 0, 210)], landmarks: [] });
  ok('M101 同型が並ぶと指摘される', same.issues.some((i) => i.rule === 'M101'), JSON.stringify(same.issues.map((i) => i.rule)));
  const mixed = mapability({ districts: [mk('a', 'residential', 0, 0), mk('b', 'downtown', 210, 0), mk('c', 'factory', 0, 210)], landmarks: [] });
  ok('M101 型を混ぜれば指摘されない', !mixed.issues.some((i) => i.rule === 'M101'));
  ok('混ぜたほうが点が高い', mixed.score > same.score, `${mixed.score.toFixed(2)} vs ${same.score.toFixed(2)}`);
}
// M102: 目印が無いと指摘、増やすと消える
{
  const d = [{ id: 'a', kind: 'downtown', x: 0, z: 0, w: 600, d: 600, area: 360000, trees: 10, roofs: {}, buildings: [{ w: 20, d: 20, height: 20 }] }];
  const none = mapability({ districts: d, landmarks: [] });
  ok('M102 目印ゼロは指摘される', none.issues.some((i) => i.rule === 'M102'));
  const many = mapability({ districts: d, landmarks: [{ x: -200, z: -200, height: 40 }, { x: 200, z: 200, height: 40 }, { x: 0, z: 0, height: 60 }] });
  ok('M102 目印を撒けば消える', !many.issues.some((i) => i.rule === 'M102'), `coverage=${many.landmarkCoverage}`);
}
// M104: 境に川があると一致率が上がる
{
  const mk = (id, kind, x) => ({ id, kind, x, z: 0, w: 200, d: 200, area: 40000, trees: 20, roofs: {}, buildings: [{ w: 10, d: 10, height: 6 }] });
  const ds = [mk('a', 'residential', -105), mk('b', 'downtown', 105)];
  const noEdge = mapability({ districts: ds, landmarks: [{ x: 0, z: 0, height: 50 }], edges: [] });
  const withEdge = mapability({ districts: ds, landmarks: [{ x: 0, z: 0, height: 50 }], edges: [{ x0: 0, z0: -300, x1: 0, z1: 300 }] });
  ok('M104 境に川があると一致率が上がる', withEdge.edgeAlignment > noEdge.edgeAlignment, `${withEdge.edgeAlignment} vs ${noEdge.edgeAlignment}`);
}
// pickFrom
{
  ok('pickFrom は端で最後を返す', pickFrom({ a: 0.5, b: 0.5 }, 1) === 'b');
  ok('pickFrom は先頭を返す', pickFrom({ a: 0.5, b: 0.5 }, 0) === 'a');
}
console.log(`mapability: ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
