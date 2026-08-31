import { town, measureTown } from './town.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error(`NG ${name} ${extra}`); } };

const items = (n, f = (i) => 20 + (i % 40) * 60) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, value: f(i) }));

// T101 上下限に収まる
for (const n of [1, 5, 60, 400]) {
  const r = town(items(n), { w: 600, d: 600, minSize: 5, maxSize: 50, gap: 5 });
  const m = measureTown(r.placed, { minSize: 5, maxSize: 50, gap: 5 });
  ok(`T101 n=${n} 上限超えなし`, m.overSize === 0, `over=${m.overSize}`);
  ok(`T101 n=${n} 下限割れなし`, m.underSize === 0, `under=${m.underSize}`);
  ok(`T102 n=${n} 最低距離を守る`, m.tooClose === 0, `tooClose=${m.tooClose} minGap=${m.minGap.toFixed(2)}`);
  ok(`n=${n} 全部置かれる`, r.placed.size === n, `${r.placed.size}/${n}`);
}
// 極端な希望値でも壊れない
{
  const r = town([{ id: 'a', value: 1e9 }, { id: 'b', value: 0 }, { id: 'c', value: -5 }], { w: 300, d: 300 });
  const m = measureTown(r.placed);
  ok('極端な値でも上下限を守る', m.overSize === 0 && m.underSize === 0, JSON.stringify(m));
}
// T103 通りが出る
{
  const r = town(items(120), { w: 800, d: 800, street: 8, avenueEvery: 4 });
  ok('T103 通りがある', r.streets.length > 4, `${r.streets.length}`);
  ok('T103 大通りがある', r.streets.some((s) => s.w > 8 * 1.8), `max=${Math.max(...r.streets.map((s) => s.w))}`);
}
// T104 壁面線が揃っていない
{
  const r = town(items(200), { w: 900, d: 900, gap: 5 });
  const m = measureTown(r.placed);
  ok('T104 壁面線が揃っていない', m.frontLineVariance > 0.5, `variance=${m.frontLineVariance.toFixed(2)}`);
}
// 格子に見えないこと: 建物の間口が 1 種類でない
{
  const r = town(items(200), { w: 900, d: 900 });
  const widths = new Set([...r.placed.values()].map((b) => b.w.toFixed(1)));
  ok('間口がばらついている', widths.size > 20, `種類=${widths.size}`);
}
// T105 決定論
{
  const a = town(items(80), { w: 500, d: 500, seed: 7 });
  const b = town(items(80), { w: 500, d: 500, seed: 7 });
  ok('T105 同じ seed なら同じ町', JSON.stringify([...a.placed]) === JSON.stringify([...b.placed]));
  const c = town(items(80), { w: 500, d: 500, seed: 8 });
  ok('T105 seed が違えば違う町', JSON.stringify([...a.placed]) !== JSON.stringify([...c.placed]));
}
// T106 入りきらなければ奥へ伸びる（切り捨てない）
{
  const r = town(items(300), { w: 200, d: 100, minSize: 5, maxSize: 50, gap: 5 });
  ok('T106 全部置かれる', r.placed.size === 300, `${r.placed.size}`);
  ok('T106 奥行きが伸びる', r.d > 100, `d=${r.d}`);
  ok('T106 それでも最低距離は守る', measureTown(r.placed).tooClose === 0);
}
// 空き地（公園）が出る
{
  const r = town(items(300), { w: 900, d: 900, emptyLotRate: 0.12 });
  ok('空き地が出る', r.lots.length > 5, `${r.lots.length}`);
  ok('空き地に座標がある', r.lots.every((l) => Number.isFinite(l.x) && Number.isFinite(l.z) && l.z > 0));
}
// 空
{
  const r = town([], { w: 100, d: 100 });
  ok('空でも壊れない', r.placed.size === 0 && r.streets.length === 0);
}

// ── T107 接道。**不変条件は「隙間」ではなく「どの建物にも道が届いていること」。**
// 日本の実測では建物の隙間は 0.3〜2 m しかないが、幅 4 m 以上の道が全戸に接している
// （建築基準法 43 条: 幅 4 m 以上の道路に 2 m 以上接すること）。
// なので隙間は用途で選び、接道はどちらのモードでも必ず守る。
for (const realism of ['walkable', 'real']) {
  for (const mode of ['rows', 'ribbon', 'scatter', 'radial', 'organic', 'riverine']) {
    const r = town(items(150), { w: 700, d: 700, mode, realism, minSize: 5, maxSize: 50, gap: 5, street: 8 });
    const m = measureTown(r.placed, { minSize: 5, maxSize: 50, gap: realism === 'real' ? 0.6 : 5, streets: r.streets, minRoad: 4 });
    ok(`T107 ${realism}/${mode} 全戸が道に接する`, m.noRoad === 0, `接道なし ${m.noRoad} 最遠 ${m.worstFrontage.toFixed(1)}`);
    ok(`T102 ${realism}/${mode} 最低距離を守る`, m.tooClose === 0, `近すぎ ${m.tooClose}`);
    ok(`T101 ${realism}/${mode} 上下限を守る`, m.overSize === 0 && m.underSize === 0);
    ok(`${realism}/${mode} 全部置かれる`, r.placed.size === 150, `${r.placed.size}`);
  }
}
// real は walkable より詰まっている（そこが違いの本体）
{
  const a = town(items(600), { w: 700, d: 700, realism: 'walkable', gap: 5 });
  const b = town(items(600), { w: 700, d: 700, realism: 'real', gap: 5 });
  const ma = measureTown(a.placed, { streets: a.streets, gap: 5 });
  const mb = measureTown(b.placed, { streets: b.streets, gap: 0.6 });
  ok('real のほうが詰まっている', mb.minGap < ma.minGap - 2, `${mb.minGap.toFixed(2)} vs ${ma.minGap.toFixed(2)}`);
  ok('real のほうが同じ敷地に多く入る', b.d < a.d, `奥行き real ${Math.round(b.d)} / walkable ${Math.round(a.d)}`);
}
// 道は minRoad を下回らせない
{
  const r = town(items(60), { w: 500, d: 500, street: 2, minRoad: 4 });
  ok('道幅は minRoad 以上', r.streets.every((s) => s.w >= 4), `最小 ${Math.min(...r.streets.map((s) => s.w))}`);
}

console.log(`town: ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
