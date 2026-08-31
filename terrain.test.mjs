import { terrain, measureTerrain, fbm, distToPath } from './terrain.js';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.error(`NG ${n} ${e}`); } };

const flat = { x0: -1400, z0: -1400, x1: 1400, z1: 1400 };
const t = terrain({ span: 6000, res: 129, seed: 3, maxHeight: 320, flat, flatFeather: 500 });
const m = measureTerrain(t, { flat });

ok('R103 町の敷地が平ら', m.flatInside < 1, `起伏 ${m.flatInside.toFixed(2)}`);
ok('外に起伏がある', m.relief > 100, `relief ${m.relief.toFixed(0)}`);
ok('のっぺりしていない（稜線がある）', m.ridgeRatio > 0.25, `ridge ${m.ridgeRatio.toFixed(3)}`);
ok('R104 川が端から端まで通る', m.riverCrosses);
ok('R102 格子の外でも連続', m.continuous);

// R105 川が敷地を通らない
{
  let inside = 0;
  for (const p of t.river) if (p.x > flat.x0 && p.x < flat.x1 && p.z > flat.z0 && p.z < flat.z1) inside++;
  ok('R105 川が町を割らない', inside === 0, `敷地内の川筋点 ${inside}`);
}
// R101 決定論
{
  const a = terrain({ span: 2000, res: 65, seed: 5 });
  const b = terrain({ span: 2000, res: 65, seed: 5 });
  ok('R101 同じ seed なら同じ地形', a.height.every((v, i) => v === b.height[i]));
  const c = terrain({ span: 2000, res: 65, seed: 6 });
  ok('R101 seed が違えば違う地形', !a.height.every((v, i) => v === c.height[i]));
}
// heightAt が格子と一致する
{
  const t2 = terrain({ span: 1000, res: 33, seed: 2, river: false });
  const i = 10, j = 7;
  const x = -500 + i * t2.step, z = -500 + j * t2.step;
  ok('heightAt が格子の値と一致', Math.abs(t2.heightAt(x, z) - t2.height[j * 33 + i]) < 1e-3);
}
// fbm の性質
{
  const vs = []; for (let i = 0; i < 200; i++) vs.push(fbm(1, i * 0.37, i * 0.11, { octaves: 5 }));
  ok('fbm は 0..1 に収まる', vs.every((v) => v >= 0 && v <= 1));
  ok('fbm は定数でない', new Set(vs.map((v) => v.toFixed(3))).size > 100);
  const r = []; for (let i = 0; i < 200; i++) r.push(fbm(1, i * 0.37, i * 0.11, { octaves: 5, ridged: true }));
  ok('ridged のほうが尖る', Math.max(...r) - Math.min(...r) >= Math.max(...vs) - Math.min(...vs) - 0.2);
}
// 折れ線までの距離
{
  const p = [{ x: 0, z: -10 }, { x: 0, z: 10 }];
  ok('線分上は 0', distToPath(p, 0, 0) < 1e-9);
  ok('横に 5 なら 5', Math.abs(distToPath(p, 5, 0) - 5) < 1e-9);
  ok('端の外は端点まで', Math.abs(distToPath(p, 0, 20) - 10) < 1e-9);
}
// 川が谷になっている（掘れている）
{
  const t3 = terrain({ span: 4000, res: 129, seed: 9, maxHeight: 200, river: true, riverDepth: 30 });
  const mid = t3.river[Math.floor(t3.river.length / 2)];
  const onRiver = t3.heightAt(mid.x, mid.z);
  const offRiver = t3.heightAt(mid.x + 300, mid.z);
  ok('川筋は周りより低い', onRiver < offRiver, `${onRiver.toFixed(1)} vs ${offRiver.toFixed(1)}`);
}
console.log(`terrain: ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
