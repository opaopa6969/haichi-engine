// zumen（ソフトウェア構造の可視化）との接続。
// zumen の ZIR（描画非依存の JSON）を haichi-engine の入力に変換し、
// 配置と品質測定を受け取る。zumen 側は座標を受け取るだけで、配置の判断は持たない。
//
// 依存の向きは zumen → haichi-engine の一方向。haichi は ZIR を知らないので、
// 「ZIR を読む」責務はこのファイルが持つ。
import { pack, treemap, measure, placeLabels } from '../index.js';

/** ZIR のノード列を、haichi の入れ子 items に畳む */
export function zirToItems(nodes, { rootId, kinds = ['component', 'unit'] } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of nodes) {
    if (!kinds.includes(n.kind)) continue;
    // unit は parent（module）ではなく component に帰属させる（zumen の §4.2）
    const p = n.kind === 'unit' ? (n.component ?? n.parent) : n.parent;
    (kids.get(p) ?? kids.set(p, []).get(p)).push(n);
  }
  const build = (id) => (kids.get(id) ?? []).map((n) => {
    const cs = build(n.id);
    return { id: n.id, value: Math.max(1, n.metrics?.loc ?? n.metrics?.nodes ?? 16), name: n.name, kind: n.kind, ...(cs.length ? { children: cs } : {}) };
  });
  return build(rootId ?? nodes.find((n) => n.kind === 'repository')?.id ?? null);
}

/** ZIR → 配置 + 測定。zumen の check-layout はこれを呼ぶだけでよい */
export function layoutZir(doc, { size = 1000, minFont = 9, engine = 'pack' } = {}) {
  const items = zirToItems(doc.nodes, { rootId: doc.id });
  const placed = engine === 'treemap' ? treemap(items, { w: size, h: size }) : pack(items, { size });
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const shapes = [...placed].map(([id, c]) => ({
    id, parent: c.parent, x: c.x, y: c.y, ...(c.r != null ? { r: c.r } : { w: c.w, h: c.h }),
    label: byId.get(id)?.name,
    // 図形の大きさから素直に決めた文字サイズ。読めなければ measure が落とす
    font: Math.max(4, Math.min(16, (c.r ?? Math.min(c.w, c.h) / 2) / 3)),
  }));
  // component をまたぐ呼び出しだけを辺にする（全部引くと読めない）
  const compOf = (id) => { const n = byId.get(id); if (!n) return null; if (n.component) return n.component; if (n.kind === 'member') return byId.get(n.parent)?.component ?? null; return n.id; };
  const agg = new Map();
  for (const e of doc.edges ?? []) {
    if (e.kind !== 'calls' && e.kind !== 'instantiates' && e.kind !== 'depends') continue;
    const a = compOf(e.from), b = compOf(e.to);
    if (!a || !b || a === b || !placed.has(a) || !placed.has(b)) continue;
    const k = `${a}|${b}`; agg.set(k, (agg.get(k) ?? 0) + (e.weight ?? 1));
  }
  const edges = [...agg].map(([k, w]) => { const [from, to] = k.split('|'); return { from, to, weight: w }; });
  return { placed, shapes, edges, labels: placeLabels(shapes, { minFont }), report: measure(shapes, edges, { minFont }) };
}
