// 集約 — **何を 1 つと数えるか**を決める。
//
// 配置（index.js）の前段。数百を数百のまま置く方法は無いので、置く前に数を減らす。
// 閾値は cognitive.js の COGNITIVE と同じ根拠から来る（探せるのは 30 まで、
// 300 を超えると模様としてしか読めない）。**同じ根拠のものを別 repo に置くと
// 定数を二重管理することになる**ので、ここに同居させている。
//
// 契約は他と同じ: 何であるかを知らない・描画しない・決定論的・依存ゼロ。
// 「名前で束ねる」「役割で束ねる」のような**意味の判断は呼ぶ側が戦略として渡す**。
// engine が持つのは「順に試して、うまく割れたものを採る」というメカニズムだけ。
import { COGNITIVE, seriate } from './cognitive.js';

/** 部分木に含まれる葉の数 */
export function leafCount(n) {
  if (!n.children?.length) return 1;
  let s = 0;
  for (const c of n.children) s += leafCount(c);
  return s;
}

/**
 * 入口が収まるまで、大きすぎる塊を割る。
 *
 * 実データ（zumen の 174 リポジトリ）で測ったら、想像と逆のことが起きていた。
 *   建物 2,650 / 入口 4 / 最大ブロック 2,044
 * 入口が多すぎるのではなく、**入口が少なすぎて 1 つ選んでも中がまた数百**だった。
 *
 * children: [{ id, children?, ... }]
 * → 割ったあとの children（同じ形）
 *
 * opts.split(node) … 節点を割る方法を返す。省略時は「子の枝をそのまま繰り上げる」。
 *   葉が平置きされている塊は枝が無いので割れない。そこは groupBy を渡して束ねる
 *   （下の splitTree が既定で組み合わせている）
 */
export function splitBySize(children, opts = {}) {
  const {
    maxEntry = COGNITIVE.scan,        // 入口の上限（探せるのは 30 まで）
    maxBlock = 120,                   // 1 塊に入れてよい葉の数
    split = null,                     // 独自の割り方
    guard = 40,
  } = opts;
  let out = [...children];
  const skip = new Set();             // これ以上割れないもの。1 つで諦めず次に大きいものを試す
  for (let k = 0; k < guard; k++) {
    if (out.length >= maxEntry) break;
    const sizes = out.map((c) => (skip.has(c.id) ? -1 : leafCount(c)));
    const worst = sizes.indexOf(Math.max(...sizes));
    if (worst < 0 || sizes[worst] <= maxBlock) break;
    const target = out[worst];
    const room = maxEntry - out.length + 1;
    const parts = split ? split(target, { room, maxBlock }) : defaultSplit(target, { room, maxBlock, ...opts });
    if (!parts || parts.length < 2) { skip.add(target.id); continue; }
    out = [...out.slice(0, worst), ...parts, ...out.slice(worst + 1)];
  }
  return out;
}

/** 既定の割り方: 子の枝を繰り上げる。枝が無ければ groupBy で葉を束ねる */
function defaultSplit(target, { room, maxBlock, strategies = null, name = defaultName }) {
  const kids = target.children ?? [];
  const subs = kids.filter((c) => c.children?.length);
  const leaves = kids.filter((c) => !c.children?.length);
  if (subs.length >= 2 && subs.length <= room) {
    const parts = subs.map((s) => ({ ...s, name: name(target, s) }));
    if (leaves.length) parts.push({ ...target, children: leaves });   // 直下の葉は行き場を失わせない
    return parts;
  }
  if (leaves.length > maxBlock && strategies) {
    const groups = groupBy(leaves, { strategies, room });
    return groups.map((g) => ({
      id: `${target.id}#${g.key}`,
      key: g.key,
      name: name(target, { name: g.key }),
      children: g.items,
    }));
  }
  return null;
}
const defaultName = (parent, child) => `${parent.name ?? parent.id ?? ''} / ${child.name ?? child.key ?? ''}`;

/**
 * 束ね方を順に試す。**偏ったら次の戦略へ**。
 *
 * 「同じディレクトリに全部ある」repo では接頭辞が 1 種類しか無く割れない
 * （zumen の Tools 228 棟、kamishibai の Tools 637 棟が実際にこれだった）。
 * 1 つの戦略に賭けず、順に落ちる。
 *
 * strategies … [(item) => key | null]。**意味の判断は呼ぶ側が持つ**
 * → [{ key, items }]（大きい順。多すぎるものは「その他」に寄せる）
 */
export function groupBy(items, opts = {}) {
  const { strategies = [], room = COGNITIVE.scan, maxSkew = 0.9, otherKey = 'その他' } = opts;
  for (const key of strategies) {
    const groups = new Map();
    for (const it of items) {
      const k = key(it);
      const kk = k == null || k === '' ? '?' : String(k);
      (groups.get(kk) ?? groups.set(kk, []).get(kk)).push(it);
    }
    let list = [...groups].map(([k, v]) => ({ key: k, items: v })).sort((a, b) => b.items.length - a.items.length || String(a.key).localeCompare(String(b.key)));
    // 2 束以上に割れて、最大の束が全体の maxSkew 未満なら採用（1 束に偏るなら次の手へ）
    if (list.length < 2 || list[0].items.length >= items.length * maxSkew) continue;
    const cap = Math.max(2, Math.min(room, COGNITIVE.scan));
    if (list.length > cap) {
      const keep = list.slice(0, cap - 1);
      const rest = list.slice(cap - 1).flatMap((x) => x.items);
      list = [...keep, { key: otherKey, items: rest }];
    }
    return list;
  }
  return [];
}

/**
 * 依存の強さで群を作る。**木が無い／木が意味を持たない**場合はこちら。
 *
 * seriate で 1 次元に並べてから、繋がりの弱いところで切る。
 * 全対の距離を測る本格的なクラスタリングではないが、依存ゼロで決定論的、
 * かつ「隣同士が関係している」という並べ替えの性質をそのまま使えるのが利点。
 *
 * → [{ key, ids }]
 */
export function cluster(ids, edges, opts = {}) {
  const { k = null, maxSize = 120, minSize = 2 } = opts;
  if (ids.length <= minSize) return ids.length ? [{ key: '0', ids: [...ids] }] : [];
  const order = seriate(ids, edges);
  const pos = new Map(order.map((id, i) => [id, i]));
  // 隣り合う位置をまたぐ辺の重みを数える。少ないところが切れ目
  const cut = new Float64Array(Math.max(0, order.length - 1));
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (a == null || b == null || a === b) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let i = lo; i < hi; i++) cut[i] += (e.weight ?? 1);
  }
  // 切る本数: k が指定されればそれ、無ければ maxSize に収まる最小の数
  const want = k != null ? Math.max(0, k - 1) : Math.max(0, Math.ceil(order.length / maxSize) - 1);
  const cand = [...cut.keys()].map((i) => ({ i, w: cut[i] })).sort((a, b) => a.w - b.w || a.i - b.i);
  const cuts = new Set();
  for (const c of cand) {
    if (cuts.size >= want) break;
    // 細切れを避ける: 既存の切れ目から minSize 以上離れていること
    if ([...cuts].some((x) => Math.abs(x - c.i) < minSize)) continue;
    cuts.add(c.i);
  }
  const out = []; let cur = [];
  for (let i = 0; i < order.length; i++) {
    cur.push(order[i]);
    if (cuts.has(i)) { out.push({ key: String(out.length), ids: cur }); cur = []; }
  }
  if (cur.length) out.push({ key: String(out.length), ids: cur });
  return out;
}

/**
 * 群の要約。代表を出すのは「群を 1 個として描く」ために要る。
 * 何であるかを知らないので、数え方は呼ぶ側が渡す。
 */
export function summarize(items, opts = {}) {
  const { size = () => 1, tag = null, name = null } = opts;
  const total = items.reduce((a, it) => a + (size(it) ?? 1), 0);
  const tags = new Map();
  if (tag) for (const it of items) { const t = tag(it); if (t != null) tags.set(t, (tags.get(t) ?? 0) + 1); }
  const top = [...tags].sort((a, b) => b[1] - a[1]);
  return {
    count: items.length,
    total,
    // 最も多い性質。群の色や名前に使う
    dominant: top[0]?.[0] ?? null,
    tags: Object.fromEntries(top),
    label: name ? name(items) : `${items.length} 個`,
  };
}
