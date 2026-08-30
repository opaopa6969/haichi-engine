// docs/usage.ja.md に載せたコードを実際に走らせる。
// **ドキュメントが嘘をつかないための番人**。README の例が動かないのは、無いより悪い。
//   node docs/examples.mjs
import assert from 'node:assert/strict';
import { pack, treemap, relax, grid, placeLabels, measure } from '../index.js';
import { blocks, measure3, semanticLod } from '../index3d.js';
import { roundTable, alongPath, speechBubbles, relationMap } from '../integration/game-board.mjs';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

ok('1. 入れ子の構造を円で見せる', () => {
  const items = [
    { id: 'core', children: [{ id: 'Engine', value: 300 }, { id: 'util', value: 40 }] },
    { id: 'io', children: [{ id: 'read', value: 60 }] },
  ];
  const placed = pack(items, { size: 600, padding: (depth) => (depth === 0 ? 12 : 4) });
  assert.equal(placed.size, 5);
  const p = placed.get('core'), c = placed.get('Engine');
  assert.ok(Math.hypot(c.x - p.x, c.y - p.y) + c.r <= p.r + 1e-6, '子が親からはみ出した');
  assert.equal(c.parent, 'core');
});

ok('2. 領域を隙間なく矩形に割る', () => {
  const cells = treemap([{ id: 'a', value: 5 }, { id: 'b', value: 3 }, { id: 'c', value: 2 }],
    { x: 0, y: 0, w: 800, h: 400, padding: 4 });
  const c = cells.get('a');
  assert.ok(c.w > 0 && c.h > 0);
  // README が書いている DOM への直し方が成り立つこと
  assert.ok(c.x - c.w / 2 >= -1, '左端が領域の外');
});

ok('3. 重なりを解消する', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, x: 400 + i, y: 300, r: 20 }));
  const settled = relax(items, {
    gap: 4, maxMove: 30, axis: 'x',
    bounds: { x: 400, y: 300, w: 800, h: 600 },
    grid: 0, pinned: new Set(['s0']),
  });
  assert.equal(settled.get('s0').x, 400, 'pinned が動いた');
  for (const v of settled.values()) assert.ok(Math.abs(v.x - 400) + v.r <= 400 + 0.01, 'bounds の外へ出た');
});

ok('4. 順番が意味を持つものを並べる', () => {
  const tiles = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, w: 36, h: 52 }));
  tiles[12].gapAfter = 20;
  const { items, rows, width, overflow } = grid(tiles, { x: 0, y: 0, gap: 4, bounds: { w: 355, h: 200 }, align: 'center' });
  assert.equal(items.size, 14);
  assert.ok(rows >= 2, `355px に 14 枚が 1 行で入ってしまった（rows=${rows}）`);
  assert.equal(typeof overflow, 'number');
  assert.ok(items.get('t13').x - items.get('t12').x !== 0);
});

ok('5. ラベルを置く', () => {
  const stations = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, x: i * 70, y: 0, r: 6, label: `駅${i}`, font: 12 }));
  stations[0].priority = 10;
  const labels = placeLabels(stations, { minFont: 9, prefer: 'outside', dirOrder: [[0, 1], [0, -1], [1, 0], [-1, 0]] });
  const shown = [...labels.values()].filter((l) => !l.hidden);
  assert.ok(shown.length >= 6, `${shown.length}/8 しか置けていない`);
  assert.ok(shown.every((l) => l.text && l.text !== '…'), '「…」だけのラベルが出た');
  assert.ok(shown.every((l) => l.at === 'outside'), 'prefer:outside が効いていない');
});

ok('6. 配置が読めるか測る', () => {
  // 半径 8 の円に長い名前 = 「…」しか入らない（切り詰めても情報が残らない）
  const shapes = [{ id: 'hokkaido', x: 0, y: 0, r: 8, label: '北海道地方全域', font: 12 }];
  const { problems, metrics } = measure(shapes, [], { minFont: 9, bounds: { x: 0, y: 0, w: 800, h: 600 } });
  assert.ok(problems.some((p) => p.code === 'H102'), 'はみ出しを検出していない');
  const msg = problems.find((p) => p.code === 'H102').message;
  assert.ok(/px/.test(msg) && /—/.test(msg), 'メッセージに実測値と直し方が無い');
  assert.equal(typeof metrics.outside, 'number');
  assert.equal(typeof metrics.truncated, 'number');
});

ok('6b. labelBox で外置きラベルを測る', () => {
  const r = measure([
    { id: 'a', x: 0, y: 0, r: 5, label: '積丹岬', font: 12, labelBox: { x: 0, y: -20, w: 60, h: 14 } },
    { id: 'b', x: 40, y: 0, r: 5, label: '神威岬', font: 12, labelBox: { x: 30, y: -20, w: 60, h: 14 } },
  ], [], { gap: 0 });
  assert.ok(r.problems.some((p) => p.code === 'H101'), '外置きラベルの重なりを見ていない');
});

ok('7. 立体を建てて、見えるか測る', () => {
  const items = [
    { id: 'core', value: 400, children: [{ id: 'a', value: 200, height: 30, name: 'Engine' }, { id: 'b', value: 60, height: 8, name: 'util' }] },
    { id: 'io', value: 120, children: [{ id: 'c', value: 120, height: 12, name: 'read' }] },
  ];
  const city = blocks(items, { w: 1000, d: 1000, padding: 6, heightScale: 6 });
  const objs = [...city.values()].map((b) => ({ ...b, label: b.node?.name }));
  const camera = { x: -400, y: 700, z: 1500, target: { x: 500, y: 0, z: 500 }, fov: 50, width: 1600, height: 900 };
  const { metrics } = measure3(objs, [], camera, { walkWidth: 6, minFont: 9 });
  for (const k of ['objects', 'overlaps', 'narrowGaps', 'occluded', 'visibleRatio', 'unreadableLabels', 'heightRatio'])
    assert.ok(k in metrics, `metrics に ${k} が無い`);
  let open = new Set();
  ({ open } = semanticLod(objs, camera, { minPx: 24, hysteresis: 1.35, open }));
  assert.ok(open instanceof Set);
});

ok('8. 円卓', () => {
  const { seats, report } = roundTable(
    [{ id: 'self' }, { id: 'right' }, { id: 'across' }, { id: 'left' }],
    { radius: 200, startAngle: Math.PI / 2, seatSize: { w: 160, h: 40 } });
  assert.equal(seats.size, 4);
  assert.ok(seats.get('self').y > 0 && seats.get('right').x > 100, '座順が時計回りでない');
  assert.ok(report.metrics);
});

ok('8b. すごろくの盤面', () => {
  const squares = Array.from({ length: 15 }, (_, i) => ({ id: `sq${i}` }));
  const { cells, path } = alongPath(squares,
    [{ from: { x: 0, y: 0 }, to: { x: 400, y: 0 }, cells: 8 },
     { from: { x: 400, y: 0 }, to: { x: 400, y: 320 }, cells: 6 }],
    { grid: 40, orthogonal: true });
  assert.equal(cells.size, 15);
  for (const p of path) { assert.equal(Math.abs(p.x % 40), 0); assert.equal(Math.abs(p.y % 40), 0); }
  const last = cells.get('sq14');
  assert.equal(last.x, 400); assert.equal(last.y, 320);
});

ok('8c. 吹き出しと関係図', () => {
  const { bubbles } = speechBubbles([{ id: 'a', x: 0, y: 0, text: 'こんにちは' }], { maxWidth: 220 });
  assert.ok(bubbles.get('a'));
  const { nodes } = relationMap([{ id: 'p' }, { id: 'q' }], [{ a: 'p', b: 'q', strength: 3 }], { seed: 7 });
  assert.equal(nodes.size, 2);
});

console.error(`examples: ${n} pass`);
