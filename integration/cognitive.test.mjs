// 認知評価と並べ替えのテスト。
import assert from 'node:assert/strict';
import { cognitive, recommend, seriate, bandwidth, navigable, COGNITIVE } from '../cognitive.js';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

// 3 つの塊が弱く繋がったグラフ
function clustered(groups = 3, per = 12) {
  const ids = [], edges = [];
  for (let g = 0; g < groups; g++) for (let i = 0; i < per; i++) ids.push(`g${g}_${i}`);
  for (let g = 0; g < groups; g++) for (let i = 0; i < per; i++) for (let j = i + 1; j < per; j++)
    if ((i + j) % 3 === 0) edges.push({ from: `g${g}_${i}`, to: `g${g}_${j}`, weight: 3 });
  for (let g = 1; g < groups; g++) edges.push({ from: `g${g - 1}_0`, to: `g${g}_0`, weight: 1 });
  return { ids, edges };
}
const shuffle = (ids) => ids.map((id, i) => ({ id, k: (i * 7) % ids.length })).sort((a, b) => a.k - b.k).map((x) => x.id);

ok('少数なら何も言わない', () => {
  const r = cognitive({ kind: 'node-link', nodes: 10, edges: 12 });
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
  assert.equal(r.advice[0].to, 'node-link', '今のままでよいと言っていない');
});

ok('数十を超えたら並べ替えを勧める', () => {
  const r = cognitive({ kind: 'node-link', nodes: 28, edges: 40 });
  assert.ok(r.advice.some((a) => a.to === 'seriate'));
});

ok('数百は破綻と判定し、行列を勧める（C101/C102/C105）', () => {
  const r = cognitive({ kind: 'node-link', nodes: 600, edges: 1200 });
  const codes = r.problems.map((p) => p.code);
  for (const c of ['C101', 'C102', 'C105']) assert.ok(codes.includes(c), `${c} が出ていない`);
  assert.ok(r.advice.some((a) => a.to === 'matrix'), '行列を勧めていない');
  // メッセージに実測値と直し方が入っていること
  for (const p of r.problems) { assert.match(p.message, /\d/); assert.match(p.message, /—/); }
});

ok('辺が密すぎると C103', () => {
  const r = cognitive({ kind: 'node-link', nodes: 20, edges: 200 });
  assert.ok(r.problems.some((p) => p.code === 'C103'), `密度 10 を見逃した`);
});

ok('並べ替えていない行列は C104', () => {
  assert.ok(cognitive({ kind: 'matrix', nodes: 200, edges: 400, ordered: false }).problems.some((p) => p.code === 'C104'));
  assert.ok(!cognitive({ kind: 'matrix', nodes: 200, edges: 400, ordered: true }).problems.some((p) => p.code === 'C104'));
});

ok('集約か焦点があれば C105 は出ない', () => {
  assert.ok(cognitive({ kind: 'nested', nodes: 300, aggregated: true }).problems.every((p) => p.code !== 'C105'));
  assert.ok(cognitive({ kind: 'nested', nodes: 300, focus: true }).problems.every((p) => p.code !== 'C105'));
});

ok('入れ子が深すぎると C106', () => {
  assert.ok(cognitive({ kind: 'nested', nodes: 20, depth: 6 }).problems.some((p) => p.code === 'C106'));
  assert.ok(!cognitive({ kind: 'nested', nodes: 20, depth: 3 }).problems.some((p) => p.code === 'C106'));
});

ok('スクロール量を見積もって C107', () => {
  const r = cognitive({ kind: 'list', nodes: 400, ordered: true }, { perScreen: 30 });
  const p = r.problems.find((x) => x.code === 'C107');
  assert.ok(p, 'スクロール量を見ていない');
  assert.match(p.message, /13 画面/);
});

ok('recommend は規模で切り替わる', () => {
  assert.equal(recommend({ nodes: 8 })[0].to, 'node-link');
  assert.ok(recommend({ nodes: 25 }).some((a) => a.to === 'seriate'));
  const big = recommend({ nodes: 500, edges: 900 });
  assert.equal(big[0].to, 'aggregate', 'まず N を減らせと言っていない');
  assert.ok(big.some((a) => a.to === 'matrix'));
  assert.ok(big.some((a) => a.to === 'small-multiples'));
  // 辺が無いなら treemap（量を見せる）
  assert.ok(recommend({ nodes: 500, edges: 0 }).some((a) => a.to === 'treemap'));
});

ok('seriate は繋がりを対角へ寄せる', () => {
  const { ids, edges } = clustered();
  const sh = shuffle(ids);
  const before = bandwidth(sh, edges), after = bandwidth(seriate(sh, edges), edges);
  assert.ok(after.normalized < before.normalized * 0.5,
    `改善が足りない（${before.normalized.toFixed(3)} → ${after.normalized.toFixed(3)}）`);
});

ok('seriate は塊を隣り合わせる', () => {
  const { ids, edges } = clustered(3, 10);
  const order = seriate(shuffle(ids), edges);
  // 各群のメンバーが順序上で固まっていること（群の広がりが全体の半分未満）
  for (let g = 0; g < 3; g++) {
    const pos = order.map((id, i) => ({ id, i })).filter((x) => x.id.startsWith(`g${g}_`)).map((x) => x.i);
    const span = Math.max(...pos) - Math.min(...pos);
    assert.ok(span < order.length * 0.6, `g${g} が散らばった（広がり ${span}/${order.length}）`);
  }
});

ok('seriate は決定論的', () => {
  const { ids, edges } = clustered();
  const sh = shuffle(ids);
  assert.deepEqual(seriate(sh, edges), seriate(sh, edges));
});

ok('seriate は辺が無くても壊れない', () => {
  assert.equal(seriate(['a', 'b', 'c'], []).length, 3);
  assert.deepEqual(seriate(['a'], []), ['a']);
  assert.deepEqual(seriate([], []), []);
});

ok('bandwidth はランダム順で約 1/3 を返す', () => {
  // 一様分布の平均距離は N/3。目安として使えることを確かめる
  const ids = Array.from({ length: 60 }, (_, i) => `n${i}`);
  const edges = [];
  for (let i = 0; i < 300; i++) edges.push({ from: `n${(i * 17) % 60}`, to: `n${(i * 29 + 7) % 60}` });
  const b = bandwidth(ids, edges);
  assert.ok(b.normalized > 0.25 && b.normalized < 0.42, `${b.normalized.toFixed(3)}（0.33 前後のはず）`);
});

ok('閾値は上書きできる', () => {
  const strict = cognitive({ kind: 'node-link', nodes: 15, edges: 20 }, { limits: { ...COGNITIVE, scan: 10 } });
  assert.ok(strict.problems.some((p) => p.code === 'C101'), '閾値を厳しくしても黙った');
});


// --- 「眺められる」と「辿り着ける」は別（3D の街のブロック選択問題）

ok('入口が多すぎると C201', () => {
  const r = navigable({ total: 1024, entryPoints: 41, groups: 41, groupSize: 25, search: true });
  const p = r.problems.find((x) => x.code === 'C201');
  assert.ok(p, '41 個の入口を見逃した');
  assert.match(p.message, /12〜30/);
  assert.equal(r.metrics.idealEntry, 30);
});

ok('1 ブロックに詰め込みすぎると C202', () => {
  assert.ok(navigable({ total: 5000, entryPoints: 10, groups: 10, groupSize: 500, search: true })
    .problems.some((p) => p.code === 'C202'));
  assert.ok(!navigable({ total: 300, entryPoints: 20, groups: 20, groupSize: 15, search: true })
    .problems.some((p) => p.code === 'C202'));
});

ok('数百を超えて検索が無ければ C203', () => {
  // 「眺めて見つける」は数百で成立しなくなる
  assert.ok(navigable({ total: 1000, entryPoints: 20, search: false }).problems.some((p) => p.code === 'C203'));
  assert.ok(!navigable({ total: 1000, entryPoints: 20, search: true }).problems.some((p) => p.code === 'C203'));
});

ok('現在地を示すものが無ければ C205', () => {
  const bare = navigable({ total: 1000, entryPoints: 20, search: true });
  assert.ok(bare.problems.some((p) => p.code === 'C205'));
  for (const fix of [{ breadcrumb: true }, { minimap: true }]) {
    assert.ok(!navigable({ total: 1000, entryPoints: 20, search: true, ...fix }).problems.some((p) => p.code === 'C205'),
      `${JSON.stringify(fix)} で解消しない`);
  }
});

ok('必要な段数を見積もる', () => {
  assert.equal(navigable({ total: 20 }).metrics.depthNeeded, 1);
  assert.equal(navigable({ total: 800 }).metrics.depthNeeded, 2);
  assert.equal(navigable({ total: 26629 }).metrics.depthNeeded, 3);
});

ok('整った案内には文句を言わない', () => {
  const r = navigable({ total: 1024, entryPoints: 24, groups: 24, groupSize: 42,
    search: true, filter: true, breadcrumb: true, minimap: true });
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
  assert.equal(r.advice[0].to, 'ok');
});

console.error(`cognitive: ${n} pass`);
