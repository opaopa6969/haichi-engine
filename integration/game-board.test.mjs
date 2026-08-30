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

console.error(`game-board: ${n} pass`);
