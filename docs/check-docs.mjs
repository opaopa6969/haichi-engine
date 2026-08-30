// ドキュメントが実装から乖離していないかを検査する。
// 規則を実装に足して文書に書き忘れる、を止めるための番人。
//   node docs/check-docs.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { measure } from '../index.js';
import { measure3 } from '../index3d.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`NG ${name}: ${e.message}`); process.exitCode = 1; } };

ok('測定規則が実装と文書で一致する', () => {
  const src = read('index.js') + read('index3d.js');
  const impl = [...new Set([...src.matchAll(/code: '([HV]\d{3})'/g)].map((m) => m[1]))].sort();
  const doc = [...new Set([...read('docs/rules.ja.md').matchAll(/^### ([HV]\d{3})/gm)].map((m) => m[1]))].sort();
  assert.deepEqual(doc, impl, `文書に無い: ${impl.filter((c) => !doc.includes(c))} / 実装に無い: ${doc.filter((c) => !impl.includes(c))}`);
});

ok('公開 API が文書に載っている', () => {
  const api = [];
  for (const f of ['index.js', 'index3d.js', 'integration/game-board.mjs']) {
    for (const m of read(f).matchAll(/^export function (\w+)/gm)) api.push(m[1]);
  }
  const docs = read('README.ja.md') + read('docs/usage.ja.md') + read('docs/internals.ja.md') + read('docs/rules.ja.md');
  const missing = api.filter((name) => !docs.includes(name));
  assert.deepEqual(missing, [], `どこにも説明が無い API: ${missing.join(', ')}`);
});

ok('metrics のキーが文書に載っている', () => {
  // ソースを正規表現で舐めるとループ変数まで拾うので、**実際に呼んで返り値のキーを見る**
  const doc = read('docs/rules.ja.md');
  const missing = [];
  const shapes = [{ id: 'a', x: 0, y: 0, r: 20, label: 'あ', font: 12 }, { id: 'b', x: 50, y: 0, r: 20 }];
  const m2 = measure(shapes, [{ from: 'a', to: 'b' }], { bounds: { x: 0, y: 0, w: 200, h: 200 }, totalEdgeWeight: 2 });
  for (const k of Object.keys(m2.metrics)) if (!doc.includes(`\`${k}\``)) missing.push(`2D:${k}`);
  const objs = [{ id: 'a', x: 0, y: 0, z: 0, w: 10, d: 10, h: 10 }];
  const cam = { x: 0, y: 50, z: 100, target: { x: 0, y: 0, z: 0 }, fov: 50, width: 800, height: 600 };
  const m3 = measure3(objs, [], cam, { walkWidth: 4 });
  for (const k of Object.keys(m3.metrics)) if (!doc.includes(`\`${k}\``)) missing.push(`3D:${k}`);
  assert.deepEqual(missing, [], `rules.ja.md に無い metrics: ${missing.join(', ')}`);
});

ok('README から docs へのリンクが切れていない', () => {
  for (const f of ['README.ja.md', 'docs/usage.ja.md', 'docs/internals.ja.md', 'docs/rules.ja.md']) {
    for (const m of read(f).matchAll(/\]\((\.\.?\/[^)#]+)/g)) {
      const target = path.resolve(path.dirname(path.join(root, f)), m[1]);
      assert.ok(fs.existsSync(target), `${f} → ${m[1]} が無い`);
    }
  }
});

ok('バージョンが README と package.json で一致する', () => {
  const v = JSON.parse(read('package.json')).version;
  assert.ok(read('README.ja.md').includes(`v${v}`), `README に v${v} が無い`);
});

console.error(`check-docs: ${n} pass`);
