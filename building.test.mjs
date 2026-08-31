import { massing, measureMassing, MASSING } from './building.js';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.error(`NG ${n} ${e}`); } };

const CASES = [
  { w: 6, d: 5, h: 3, levels: 1 },      // 小屋
  { w: 12, d: 9, h: 6, levels: 2 },     // 住宅
  { w: 24, d: 18, h: 21, levels: 7 },   // ビル
  { w: 50, d: 40, h: 30, levels: 10 },  // 大きいビル
  { w: 46, d: 12, h: 9, levels: 3 },    // 細長い倉庫
];
for (const kind of MASSING) {
  for (const c of CASES) {
    const m = massing({ ...c, kind, seed: 5 });
    const q = measureMassing(m, c);
    ok(`P101 ${kind} ${c.w}x${c.d} 敷地からはみ出さない`, q.outside === 0, `${q.outside} 個`);
    ok(`P102 ${kind} ${c.w}x${c.d} 浮いた塊が無い`, q.floating === 0, `${q.floating} 個`);
    ok(`P104 ${kind} ${c.w}x${c.d} 高さが合う`, Math.abs(q.top - c.h) < 0.6, `${q.top.toFixed(2)} / ${c.h}`);
    ok(`P103 ${kind} ${c.w}x${c.d} 痩せすぎない`, q.fill >= 0.35 && q.fill <= 1.001, `fill=${q.fill.toFixed(2)}`);
  }
}
// P105 決定論
{
  const a = massing({ w: 20, d: 16, h: 18, levels: 6, seed: 3 });
  const b = massing({ w: 20, d: 16, h: 18, levels: 6, seed: 3 });
  ok('P105 同じ入力なら同じ形', JSON.stringify(a) === JSON.stringify(b));
  ok('P105 seed が違えば違う形', JSON.stringify(a) !== JSON.stringify(massing({ w: 20, d: 16, h: 18, levels: 6, seed: 4 })));
}
// P106 型が違えば形が違う（部品の数か配置が違う）
{
  const c = { w: 30, d: 24, h: 24, levels: 8, seed: 2 };
  const shapes = MASSING.map((k) => JSON.stringify(massing({ ...c, kind: k }).parts));
  ok('P106 8 型がすべて違う形', new Set(shapes).size === MASSING.length, `${new Set(shapes).size}/${MASSING.length}`);
}
// 自動選択が大きさと階数を見ている
{
  const small = massing({ w: 7, d: 6, h: 3, levels: 1, seed: 1 });
  ok('小さい建物は単純な棟か L 字', ['bar', 'L'].includes(small.kind), small.kind);
  const tall = massing({ w: 26, d: 22, h: 30, levels: 10, seed: 1 });
  ok('高いビルは基壇か段状か棟', ['podium', 'ziggurat', 'bar'].includes(tall.kind), tall.kind);
}
// 付属物
{
  let withProps = 0, kinds = new Set();
  for (let i = 0; i < 60; i++) {
    const m = massing({ w: 24, d: 20, h: 27, levels: 9, seed: i });
    if (m.props.length) withProps++;
    for (const p of m.props) kinds.add(p.type);
  }
  ok('高いビルには上に何か載る', withProps > 50, `${withProps}/60`);
  ok('付属物が数種類出る', kinds.size >= 4, [...kinds].join(','));
  const low = massing({ w: 8, d: 7, h: 3, levels: 1, seed: 1 });
  ok('平屋に塔屋は載らない', !low.props.some((p) => p.type === 'penthouse'));
}
// 屋根は主棟に載る
{
  const m = massing({ w: 20, d: 16, h: 18, levels: 6, kind: 'L', roof: 'gable', seed: 1 });
  const top = Math.max(...m.parts.map((p) => p.y + p.h));
  ok('屋根はいちばん高い棟に載る', Math.abs((m.roof.on.y + m.roof.on.h) - top) < 1e-6);
  ok('屋根の形が伝わる', m.roof.shape === 'gable');
}
console.log(`building: ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
