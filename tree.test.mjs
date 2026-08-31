import { tree, SPECIES, treeSignature, treeDistance } from './tree.js';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.error(`NG ${n} ${e}`); } };

// B101 決定論
{
  const a = tree('broadleaf', { seed: 4 }), b = tree('broadleaf', { seed: 4 });
  ok('B101 同じ seed なら同じ木', JSON.stringify(a) === JSON.stringify(b));
  ok('B101 seed が違えば違う木', JSON.stringify(a) !== JSON.stringify(tree('broadleaf', { seed: 5 })));
}
// B102 枝は親の先端から出る（浮いた枝が無い）
for (const sp of Object.keys(SPECIES)) {
  const t = tree(sp, { seed: 3 });
  const ends = new Set(t.branches.map((b) => `${b.x1.toFixed(4)},${b.y1.toFixed(4)},${b.z1.toFixed(4)}`));
  ends.add('0.0000,0.0000,0.0000');
  const orphan = t.branches.filter((b) => !ends.has(`${b.x0.toFixed(4)},${b.y0.toFixed(4)},${b.z0.toFixed(4)}`)).length;
  ok(`B102 ${sp} 浮いた枝が無い`, orphan === 0, `${orphan} 本`);
  ok(`B104 ${sp} 葉がある`, t.leaves.length > 0);
  ok(`${sp} 高さが正`, t.height > 0.5, `${t.height}`);
  ok(`${sp} 枝が有限`, t.branches.length < 5000, `${t.branches.length}`);
}
// B103 子は親より短い
{
  const t = tree('zelkova', { seed: 2 });
  const byLevel = new Map();
  for (const b of t.branches) {
    const l = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    if (!byLevel.has(b.level)) byLevel.set(b.level, []);
    byLevel.get(b.level).push(l);
  }
  const avg = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.reduce((a, x) => a + x, 0) / v.length);
  let mono = true; for (let i = 1; i < avg.length; i++) if (avg[i] >= avg[i - 1]) mono = false;
  ok('B103 段が下るほど枝が短い', mono, avg.map((v) => v.toFixed(2)).join(' > '));
  const rad = [...t.branches].sort((a, b) => a.level - b.level);
  ok('B103 段が下るほど細い', rad[0].r0 > rad[rad.length - 1].r0);
}
// B105 種が違えば形が違う
{
  const ts = Object.keys(SPECIES).map((k) => [k, tree(k, { seed: 7 })]);
  const close = [];
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const d = treeDistance(ts[i][1], ts[j][1]);
    if (d < 0.06) close.push([ts[i][0], ts[j][0], d.toFixed(3)]);
  }
  ok('B105 9 種が互いに区別できる', close.length === 0, JSON.stringify(close));
  ok('特徴量は 0..1', ts.every(([, t]) => treeSignature(t).every((v) => v >= 0 && v <= 1)));
}
// 高さの上書きが効く
{
  const a = tree('cedar', { seed: 1 }), b = tree('cedar', { seed: 1, height: 28 });
  ok('高さの上書きが効く', b.height > a.height * 1.6, `${a.height.toFixed(1)} → ${b.height.toFixed(1)}`);
}
// 段数を上げると枝が増える
{
  const a = tree('broadleaf', { seed: 1, depth: 3 }), b = tree('broadleaf', { seed: 1, depth: 5 });
  ok('段数で枝が増える', b.branches.length > a.branches.length * 3, `${a.branches.length} → ${b.branches.length}`);
}
// 知らない種は例外
ok('知らない樹種は例外', (() => { try { tree('nope'); return false; } catch { return true; } })());
console.log(`tree: ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
