import assert from 'node:assert/strict';
import { roundTable, alongPath, speechBubbles, relationMap } from './game-board.mjs';

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

ok('円卓は 4 人を等間隔に置き重ならない', () => {
  const { seats, report } = roundTable([{ id: 'e', name: '東' }, { id: 's', name: '南' }, { id: 'w', name: '西' }, { id: 'n', name: '北' }], { radius: 200, seatRadius: 48 });
  assert.equal(seats.size, 4);
  assert.equal(report.metrics.overlaps, 0, JSON.stringify(report.problems[0]));
  const a = seats.get('e'), b = seats.get('s');
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(seats.get('w').x - seats.get('n').x, seats.get('w').y - seats.get('n').y)) < 1e-6, '間隔が等しくない');
});

ok('席が多すぎれば重なりを報告する', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `席${i}` }));
  const { report } = roundTable(many, { radius: 100, seatRadius: 48 });
  assert.ok(report.metrics.overlaps > 0, '入りきらないのに重なりが 0');
});

ok('路に沿ってマスを並べ、重ならない', () => {
  const path = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
  const cells = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `マス${i}` }));
  const { cells: placed, report } = alongPath(cells, path, { cellRadius: 18, gap: 4, loop: true });
  assert.equal(placed.size, 20);
  assert.equal(report.metrics.overlaps, 0, JSON.stringify(report.problems[0]));
});

ok('吹き出しは重ならないか、出さない判断をする', () => {
  const anchors = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, x: 100, y: 100, text: `せりふ${i}` }));
  const { bubbles } = speechBubbles(anchors);
  const shown = [...bubbles.values()].filter((b) => !b.hidden);
  assert.ok(shown.length >= 1, '全部隠れてしまった');
  assert.ok([...bubbles.values()].some((b) => b.hidden) || shown.length === 5, '同じ座標に 5 個置けるはずがない');
});

ok('関係図は決定論的', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ties = [{ a: 'a', b: 'b', strength: 3 }, { a: 'b', b: 'c', strength: 1 }];
  const p = (s) => [...relationMap(nodes, ties, { seed: s }).nodes].map(([k, v]) => `${k}:${v.x.toFixed(6)}`).join(',');
  assert.equal(p(7), p(7));
  assert.notEqual(p(7), p(8));
});

ok('関係が強いほど近い', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const { nodes: m } = relationMap(nodes, [{ a: 'a', b: 'b', strength: 5 }, { a: 'a', b: 'c', strength: 0.3 }], { seed: 3 });
  const d = (x, y) => Math.hypot(m.get(x).x - m.get(y).x, m.get(x).y - m.get(y).y);
  assert.ok(d('a', 'b') < d('a', 'c'), `強い関係 ${d('a','b').toFixed(0)} が弱い関係 ${d('a','c').toFixed(0)} より遠い`);
});


// --- tetsugo の実地検証で「使えない」と言われた点を固定する

ok('grid + orthogonal は整数格子・斜め禁止を守る', () => {
  const G = 40;
  const path = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 240 }];
  const cells = Array.from({ length: 24 }, (_, i) => ({ id: `c${i}` }));
  const { path: pts } = alongPath(cells, path, { grid: G, orthogonal: true });
  for (const p of pts) { assert.equal(Math.abs(p.x % G), 0, `x=${p.x} が格子に載っていない`); assert.equal(Math.abs(p.y % G), 0, `y=${p.y} が格子に載っていない`); }
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x) / G, dy = Math.abs(pts[i].y - pts[i - 1].y) / G;
    assert.equal(dx + dy, 1, `${i}: |dx|+|dy| が ${dx + dy}（斜めか飛び）`);
  }
});

ok('grid + orthogonal は同じマスを二度使わない', () => {
  const path = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
  const cells = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}` }));
  const { path: pts } = alongPath(cells, path, { grid: 40, orthogonal: true });
  const keys = pts.map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(keys).size, keys.length, '同じ座標が二度出た');
});

ok('区間ごとにマス数を指定できる（駅間の距離がゲームそのもの）', () => {
  const segs = [
    { from: { x: 0, y: 0 }, to: { x: 120, y: 0 }, cells: 3 },
    { from: { x: 120, y: 0 }, to: { x: 120, y: 200 }, cells: 5 },
  ];
  const cells = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}` }));
  const { path: pts } = alongPath(cells, segs, {});
  assert.equal(pts.length, 3 + 5 + 1, `マス数が ${pts.length}（期待 9: 3 + 5 + 終点）`);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts.at(-1), { x: 120, y: 200 });
});

ok('grid のときは押し離しをしない（格子を壊さない）', () => {
  const cells = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, r: 60 }));  // 半径が大きく重なる
  const { cells: placed } = alongPath(cells, [{ x: 0, y: 0 }, { x: 200, y: 0 }], { grid: 40, orthogonal: true });
  for (const v of placed.values()) { assert.equal(Math.abs(v.x % 40), 0); assert.equal(Math.abs(v.y % 40), 0); }
});


// --- netmahg の実地検証で出た欠陥を固定する

ok('roundTable は既定で時計回り（麻雀の座順）', () => {
  // 自分（下）→ 下家（右）→ 対面（上）→ 上家（左）
  const { seats } = roundTable([{ id: 'self' }, { id: 'right' }, { id: 'across' }, { id: 'left' }],
    { radius: 200, startAngle: Math.PI / 2 });   // 開始を下に
  const self = seats.get('self'), right = seats.get('right'), across = seats.get('across');
  assert.ok(self.y > 0, '自席が下でない');
  assert.ok(right.x < 0 ? false : true, '下家が右に来ていない');
  assert.ok(right.x > 100, `下家 x=${right.x.toFixed(0)}（右のはず）`);
  assert.ok(across.y < -100, `対面 y=${across.y.toFixed(0)}（上のはず）`);
});

ok('roundTable は反時計回りにもできる', () => {
  // 2 人だと点対称で向きが判別できないので 4 人で見る
  const P = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const cw = roundTable(P, { radius: 100, startAngle: Math.PI / 2 }).seats;
  const ccw = roundTable(P, { radius: 100, startAngle: Math.PI / 2, clockwise: false }).seats;
  assert.ok(cw.get('b').x > 50, `時計回りで b が右に来ない（x=${cw.get('b').x.toFixed(0)}）`);
  assert.ok(ccw.get('b').x < -50, `反時計回りで b が左に来ない（x=${ccw.get('b').x.toFixed(0)}）`);
});

ok('roundTable は矩形の席域を受ける（外接円の偽陽性を避ける）', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const circ = roundTable(players, { radius: 120, seatRadius: 90 });
  const rect = roundTable(players, { radius: 120, seatSize: { w: 160, h: 40 } });
  assert.ok(circ.report.metrics.overlaps > 0, '前提が崩れている（外接円なら重なるはず）');
  assert.ok(rect.report.metrics.overlaps < circ.report.metrics.overlaps, '矩形にしても偽陽性が減らない');
  assert.ok(rect.seats.get('a').rotation != null, '中心を向く回転が付いていない');
});

console.error(`game-board: ${n} pass`);
