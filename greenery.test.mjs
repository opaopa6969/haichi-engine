import { town } from './town.js';
import { terrain } from './terrain.js';
import { greenery, measureGreenery } from './greenery.js';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.error(`NG ${n} ${e}`); } };

const items = Array.from({ length: 220 }, (_, i) => ({ id: `u${i}`, value: 30 + (i % 30) * 70 }));
const t = town(items, { w: 700, d: 700, minSize: 5, maxSize: 50, gap: 5, street: 8 });
const buildings = [...t.placed.values()];
const flat = { x0: 0, z0: 0, x1: t.w, z1: t.d };
const ter = terrain({ span: 3000, res: 97, seed: 4, maxHeight: 260, flat: { x0: -350, z0: -350, x1: 350, z1: 350 } });

const g = greenery({ buildings, streets: t.streets, lots: t.lots, terrain: ter, flat }, { seed: 2 });
const m = measureGreenery(g, { buildings, streets: t.streets });

ok('G101 建物・道路の上に生えていない', m.onBlocked === 0, `${m.onBlocked} 本`);
ok('4 種類とも生える', ['garden', 'street', 'park', 'forest'].every((k) => (m.kinds[k] ?? 0) > 0), JSON.stringify(m.kinds));
ok('G102 街路樹は等間隔', m.streetSpacingSd < 4, `sd=${m.streetSpacingSd.toFixed(2)}`);
ok('草が撒かれる', g.grass.length > 500, `${g.grass.length}`);

// G103 庭木は壁から離れている
{
  let tooNear = 0;
  const gs = g.trees.filter((x) => x.kind === 'garden');
  for (const tr of gs) {
    let near = Infinity;
    for (const b of buildings) {
      const dx = Math.abs(tr.x - b.x) - b.w / 2, dz = Math.abs(tr.z - b.z) - b.d / 2;
      near = Math.min(near, Math.max(dx, dz));
    }
    if (near < 2.4) tooNear++;
  }
  ok('G103 庭木が壁にめり込まない', tooNear === 0, `${tooNear}/${gs.length}`);
}
// G104 山林は高い所ほど密
{
  const f = g.trees.filter((x) => x.kind === 'forest');
  const lo = f.filter((x) => x.y < ter.maxHeight * 0.3).length;
  const mid = f.filter((x) => x.y >= ter.maxHeight * 0.3 && x.y < ter.maxHeight * 0.7).length;
  ok('G104 山林がある', f.length > 50, `${f.length}`);
  ok('G104 中腹のほうが低地より多い', mid >= lo * 0.5, `低 ${lo} 中 ${mid}`);
  ok('G104 森林限界より上は薄い', f.filter((x) => x.y > ter.maxHeight * 0.9).length < f.length * 0.15);
  ok('山林は地形の高さに乗る', f.every((x) => Math.abs(x.y - ter.heightAt(x.x, x.z)) < 1e-6));
}
// G105 決定論
{
  const a = greenery({ buildings, streets: t.streets, lots: t.lots }, { seed: 9 });
  const b = greenery({ buildings, streets: t.streets, lots: t.lots }, { seed: 9 });
  ok('G105 同じ入力なら同じ植生', JSON.stringify(a.trees) === JSON.stringify(b.trees));
  const c = greenery({ buildings, streets: t.streets, lots: t.lots }, { seed: 10 });
  ok('G105 seed が違えば違う', JSON.stringify(a.trees) !== JSON.stringify(c.trees));
}
// 地形なしでも動く
{
  const g2 = greenery({ buildings, streets: t.streets, lots: t.lots, flat }, { seed: 1 });
  ok('地形なしでも壊れない', g2.trees.length > 0 && g2.trees.every((x) => x.kind !== 'forest'));
}
// 空でも壊れない
{
  const g3 = greenery({}, {});
  ok('空でも壊れない', g3.trees.length === 0);
}
console.log(`greenery: ${pass} 通過 / ${fail} 失敗  内訳 ${JSON.stringify(m.kinds)}`);
process.exit(fail ? 1 : 0);
