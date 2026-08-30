// 認知の評価 — 「その見せ方は破綻していないか」を測る。
//
// 幾何の検査（measure）は「重なっているか・読めるか」を見る。こちらは一段上で、
// **人が把握できる量に収まっているか**を見る。
//
// 出発点は身も蓋もない事実で、数百を数百のまま見せる方法は存在しない。手は 3 つしかない。
//   1. N を減らす（集約する）
//   2. 記号の意味を変える（1 個の点が 1 クラスであることをやめる）
//   3. 焦点と文脈を分ける（全部を同じ解像度で見るのをやめる）
// どれも取らずに 500 個を並べたものを「破綻」と呼び、どれを取るべきかを返す。
//
// 閾値は zumen の 174 リポジトリの実測から決めた（unit 数の中央値 49、
// 上位 25% で 114、最大 2,650）。用途が違えば opts で変えること。
import { measure } from './index.js';

/** 一度に見比べられる数の上限。Miller の 7±2 は記憶の話なので、視覚探索の実務値を取る */
export const COGNITIVE = {
  compare: 12,      // 「見比べる」ができる上限
  scan: 30,         // 「ざっと眺めて目当てを探す」ができる上限
  texture: 300,     // ここを超えると個は消え、模様としてしか読めない
  hairball: 40,     // node-link で辺を追える節点数の上限（これ以上は行列へ）
};

/**
 * 認知的に破綻していないかを測る。
 *
 * view: { kind, nodes, edges, depth, ordered, focus, aggregated }
 *   kind       … 'node-link' | 'matrix' | 'treemap' | 'list' | 'nested'
 *   nodes      … 一度に画面へ出す数
 *   edges      … 同、辺の数
 *   depth      … 入れ子の深さ（nested のとき）
 *   ordered    … 並べ替え済みか（true / false）。行列とリストでは決定的
 *   focus      … 焦点+文脈の仕組みがあるか
 *   aggregated … 集約して N を減らしてあるか
 *
 * → { problems, metrics, advice }
 */
export function cognitive(view, opts = {}) {
  const T = { ...COGNITIVE, ...(opts.limits ?? {}) };
  const { kind = 'node-link', nodes = 0, edges = 0, depth = 1, ordered = false, focus = false, aggregated = false } = view;
  const problems = [];
  const advice = [];

  // C101 一度に出す数が「見比べられる」上限を超えている
  if (nodes > T.scan) {
    const sev = nodes > T.texture ? '模様としてしか読めない' : 'ざっと眺めるのが限界';
    problems.push({ code: 'C101', message: `一度に ${nodes} 個を出している（見比べられるのは ${T.compare} まで、探せるのは ${T.scan} まで）— ${sev}。集約して N を減らすか、記号の意味を変える` });
  }

  // C102 node-link で辺が追えない（毛玉）
  if (kind === 'node-link' && nodes > T.hairball) {
    problems.push({ code: 'C102', message: `node-link に ${nodes} 節点（辺を追えるのは ${T.hairball} まで）— 20 頂点を超えると隣接行列の方が読める（経路をたどる用途を除く）。matrix に切り替える` });
    advice.push({ to: 'matrix', why: `${nodes} 節点は node-link の限界を超えている。行列なら密度・対称性・循環が面として読める` });
  }

  // C103 辺が節点より多すぎて、線が図を埋める
  const density = nodes ? edges / nodes : 0;
  if (kind === 'node-link' && nodes > 8 && density > 3) {
    problems.push({ code: 'C103', message: `節点 1 個あたり辺が ${density.toFixed(1)} 本（目安 3 本以下）— 線が図を埋める。重みで間引くか、束ねるか、行列にする` });
  }

  // C104 並べ替えていない。行列とリストでは**並べ替えが品質そのもの**
  if (!ordered && (kind === 'matrix' || kind === 'list') && nodes > T.compare) {
    problems.push({ code: 'C104', message: `${kind} を並べ替えずに ${nodes} 個出している — ランダム順の行列はただのノイズ。クラスタ順・依存順に並べ替えて初めて模様が現れる` });
    advice.push({ to: 'seriate', why: '並べ替えは新しい描画を足さずに既存の図が読みやすくなる。費用対効果が最も高い' });
  }

  // C105 集約も焦点も無いまま大量に出している
  if (nodes > T.scan && !aggregated && !focus) {
    problems.push({ code: 'C105', message: `${nodes} 個を、集約も焦点+文脈も無しに出している — 全体を眺めれば個は米粒、個を見ればスクロールで疲れる。3 つの手（集約 / 記号を変える / 焦点と文脈を分ける）のどれかを取る` });
  }

  // C106 入れ子が深すぎて、どこにいるか分からなくなる
  if (depth > 4) {
    problems.push({ code: 'C106', message: `入れ子が ${depth} 段（目安 4 段以下）— 現在地を見失う。段を畳むか、パンくずと概観を付ける` });
  }

  // C107 1 画面あたりの情報量から、必要なスクロール量を見積もる
  const perScreen = opts.perScreen ?? T.scan;
  const screens = nodes / perScreen;
  if (screens > 5 && !focus) {
    problems.push({ code: 'C107', message: `全部見るのに ${screens.toFixed(0)} 画面ぶんスクロールが要る（目安 5 画面以下）— 概観+詳細か魚眼を付けないと、見ている間に前を忘れる` });
  }

  return {
    problems,
    advice: advice.length ? advice : recommend(view, T),
    metrics: { nodes, edges, density, depth, screens, kind, ordered, focus, aggregated },
  };
}

/**
 * その規模で何を選ぶべきかを返す。「数百を数百のまま見せる方法は無い」ので、
 * 必ず「N を減らす / 記号を変える / 焦点と文脈を分ける」のどれかになる。
 */
export function recommend(view, limits = COGNITIVE) {
  const T = limits;
  const n = view.nodes ?? 0;
  const hasEdges = (view.edges ?? 0) > 0;
  const out = [];
  if (n <= T.compare) return [{ to: view.kind ?? 'node-link', why: `${n} 個なら見比べられる。今の見せ方でよい` }];
  if (n <= T.scan) {
    out.push({ to: 'node-link', why: `${n} 個は探せる範囲。ただし並べ替えると格段に読みやすくなる` });
    out.push({ to: 'seriate', why: '順序が意味を持つよう並べ替える' });
    return out;
  }
  // ここから先は N を減らすのが第一手
  out.push({ to: 'aggregate', why: `${n} 個は一度に出せない。${Math.max(T.compare, Math.round(Math.sqrt(n)))} 個程度の群に畳んで、群を 1 個として描く` });
  if (hasEdges && n > T.hairball) out.push({ to: 'matrix', why: '関係を見せたいなら行列。数百を数百のまま「模様」として読める唯一の方法（並べ替えが前提）' });
  if (!hasEdges) out.push({ to: 'treemap', why: '関係ではなく量を見せたいなら treemap。辺を捨てれば数千でも読める' });
  out.push({ to: 'small-multiples', why: `1 枚の大きな図をやめ、小さな図を ${Math.ceil(n / T.compare)} 枚並べる。総面積が同じでも各図が単純だから読める` });
  out.push({ to: 'focus+context', why: '概観+詳細（ミニマップ）か魚眼。位置が保たれるので迷子にならない' });
  return out;
}

/**
 * 並べ替え（seriation）。行列・リストの品質はここで決まる。
 * ランダム順の行列はただのノイズで、クラスタ順に並べて初めて模様が現れる。
 *
 * 重み付き隣接から、繋がりの強いものを隣同士にする。
 * スペクトル法（Fiedler ベクトルの順）を使う。反復は決定論的。
 */
export function seriate(ids, edges, { iterations = 64, seed = 1 } = {}) {
  const n = ids.length;
  if (n < 3) return [...ids];
  const idx = new Map(ids.map((id, i) => [id, i]));
  // 対称な重み行列（無向として扱う。向きは順序に効かない）
  const W = Array.from({ length: n }, () => new Float64Array(n));
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null || a === b) continue;
    const w = e.weight ?? 1;
    W[a][b] += w; W[b][a] += w;
  }
  const deg = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) deg[i] += W[i][j];
  // Fiedler ベクトルを冪乗法で近似する。L = D - W の 2 番目に小さい固有ベクトル。
  // ここでは (dI - L) = W + (d - deg) I の最大固有ベクトルを、全 1 成分を抜きながら求める
  const dmax = Math.max(1, ...deg);
  let v = new Float64Array(n);
  // 乱数ではなく id から決める（同じ入力なら同じ順序になる）
  for (let i = 0; i < n; i++) { let h = seed; const s = String(ids[i]); for (let k = 0; k < s.length; k++) { h = (Math.imul(h, 31) + s.charCodeAt(k)) | 0; } v[i] = ((h >>> 0) / 4294967296) - 0.5; }
  const orth = (x) => { let m = 0; for (let i = 0; i < n; i++) m += x[i]; m /= n; for (let i = 0; i < n; i++) x[i] -= m; };
  const norm = (x) => { let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < n; i++) x[i] /= s; };
  orth(v); norm(v);
  const t = new Float64Array(n);
  for (let k = 0; k < iterations; k++) {
    for (let i = 0; i < n; i++) {
      let s = (dmax - deg[i]) * v[i];
      const Wi = W[i];
      for (let j = 0; j < n; j++) s += Wi[j] * v[j];
      t[i] = s;
    }
    v.set(t); orth(v); norm(v);
  }
  // 固有ベクトルの値で並べる。同値は元の順で安定させる
  return ids.map((id, i) => ({ id, v: v[i], i })).sort((a, b) => a.v - b.v || a.i - b.i).map((x) => x.id);
}

/**
 * 並べ替えの良さを測る。**帯域幅**（辺が対角からどれだけ離れているか）で見る。
 * 小さいほど「繋がっているものが隣にいる」＝模様が出る。
 */
export function bandwidth(order, edges) {
  const idx = new Map(order.map((id, i) => [id, i]));
  let sum = 0, max = 0, n = 0, weight = 0;
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null) continue;
    const d = Math.abs(a - b), w = e.weight ?? 1;
    sum += d * w; weight += w; max = Math.max(max, d); n++;
  }
  const N = order.length || 1;
  return {
    mean: weight ? sum / weight : 0,        // 重み付き平均距離
    max,                                    // 最大帯域幅
    edges: n,
    // 0〜1。ランダム順なら約 0.33（一様分布の平均距離 N/3）、小さいほど良い
    normalized: weight ? (sum / weight) / N : 0,
  };
}

/**
 * 「目当てのものに辿り着けるか」を測る。
 *
 * 3D の街は全体を眺めるには良いが、**建物が数千あるとき、どのブロックを見たいか
 * を選ぶ手段が無い**と使えない。眺められることと、行けることは別の問題。
 *
 * nav: { total, entryPoints, search, breadcrumb, minimap, filter, groups, groupSize }
 *   total       … 全部の数
 *   entryPoints … 最初の画面から直接選べる数（＝ブロックの数）
 *   groups      … 群の数、groupSize … 1 群あたりの数
 *   search      … 名前で探せるか
 *   filter      … 種類・役割で絞れるか
 *   breadcrumb  … 現在地が分かるか
 *   minimap     … 概観が常時見えるか
 */
export function navigable(nav, opts = {}) {
  const T = { ...COGNITIVE, ...(opts.limits ?? {}) };
  const { total = 0, entryPoints = 0, groups = 0, groupSize = 0,
          search = false, filter = false, breadcrumb = false, minimap = false } = nav;
  const problems = [];
  const advice = [];

  // C201 入口が多すぎて、どこから入ればいいか分からない
  if (entryPoints > T.scan) {
    problems.push({ code: 'C201', message: `最初の画面から ${entryPoints} 個のブロックを選ばせている（探せるのは ${T.scan} まで）— 群にまとめて入口を ${T.compare}〜${T.scan} 個に減らす` });
  }
  // C202 入口が少なすぎて、1 段降りた先が爆発する
  if (groups > 0 && groupSize > T.texture) {
    problems.push({ code: 'C202', message: `1 ブロックに ${groupSize} 個入っている（模様としてしか読めないのは ${T.texture} 超）— 段を 1 つ増やして 1 ブロック ${Math.round(Math.sqrt(groupSize))} 個程度にする` });
  }
  // C203 探す手段が無い。**大規模では「眺める」だけでは辿り着けない**
  if (total > T.texture && !search) {
    problems.push({ code: 'C203', message: `${total} 個あるのに名前で探せない — 数百を超えたら、目で探すのは成立しない。検索を入口にする` });
    advice.push({ to: 'search', why: '大規模では「眺めて見つける」は成立しない。名前・種類で絞ってから空間へ降りる' });
  }
  // C204 絞り込みが無い
  if (total > T.scan && !filter) {
    problems.push({ code: 'C204', message: `${total} 個あるのに種類・役割で絞れない — 全部を同時に見せる必要はまず無い` });
  }
  // C205 現在地が分からない
  if (total > T.texture && !breadcrumb && !minimap) {
    problems.push({ code: 'C205', message: `${total} 個の中を移動するのに、現在地を示すもの（パンくず・ミニマップ）が無い — 迷子になる` });
    advice.push({ to: 'minimap', why: '概観を常時出す。位置が保たれるので、詳細を見ていても全体の中の場所を失わない' });
  }

  // 何段必要かを見積もる。1 画面 scan 個として、total を収めるのに要る深さ
  const depthNeeded = total > 0 ? Math.max(1, Math.ceil(Math.log(total) / Math.log(T.scan))) : 1;
  return {
    problems,
    advice: advice.length ? advice : [{ to: 'ok', why: `${total} 個は ${depthNeeded} 段で辿れる` }],
    metrics: { total, entryPoints, groups, groupSize, depthNeeded,
               idealEntry: Math.min(T.scan, Math.max(T.compare, Math.round(Math.sqrt(total)))) },
  };
}
