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

// ── 認知地図の作りやすさ（M ルール）
//
// **見た目の話ではない。** 街を歩いて「頭の中に地図ができるか」の話。
// どこも同じ間隔で同じような建物が並んでいると、後で思い出せない。
// 覚えられる街には、Lynch が挙げた 5 つの手掛かりがある。
//
//   path（道）      通る筋がある
//   edge（縁）      川・線路・崖など、地区を分ける切れ目がある
//   district（地区） 場所ごとに「らしさ」が違う
//   node（結節点）  交差点や広場など、立ち止まる点がある
//   landmark（目印） 遠くから見えて、位置を教えてくれるもの
//
// ここでは、そのうち **機械が数えられる 3 つ**（district の違い・landmark の見え方・
// edge の一致）を測る。同じ型の地区が並んでいたら、それは覚えられない街だと言う。
//
//   M101 隣り合う地区は違う型であること（同型が隣接すると区別できない）
//   M102 どこに立っても目印が 1 つは見えること
//   M103 地区の特徴が互いに離れていること（似すぎた組を数える）
//   M104 地区の境が、川や大通りといった切れ目と一致していること

/**
 * 地区の「特徴ベクトル」。似ている地区は覚え分けられない。
 * @param {object} d {buildings:[{w,d,height}], trees:number, area:number, roofs:{...}}
 * @returns {number[]} 0..1 に正規化した特徴
 */
export function districtSignature(d) {
  const bs = d.buildings ?? [];
  const n = Math.max(1, bs.length);
  const med = (xs) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };
  const hs = bs.map((b) => b.height ?? 0);
  const foot = bs.map((b) => (b.w ?? 0) * (b.d ?? 0));
  const area = Math.max(1, d.area ?? 1);
  const built = foot.reduce((a, v) => a + v, 0) / area;              // 建蔽率
  const green = (d.trees ?? 0) / (area / 1000);                       // 木の密度
  const aspect = bs.length ? bs.reduce((a, b) => a + Math.min(b.w, b.d) / Math.max(1e-6, Math.max(b.w, b.d)), 0) / n : 1;
  const roofs = d.roofs ?? {};
  // 大きさのばらつき。**同じ大きさの箱が並ぶ町は覚えられない**（変動係数）
  const mw = foot.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(foot.reduce((a, v) => a + (v - mw) ** 2, 0) / n);
  const spread = mw ? sd / mw : 0;
  // まばらさ。建物の大きさに対して、どれだけ離れて建っているか
  const sparse = (d.spacing ?? 0) / Math.max(1, Math.sqrt(mw));
  // 地面と看板は「見た目の話」ではなく、**そこがどこかを思い出す手掛かり**そのもの。
  // 砂の道・石畳・ネオン・のれん は、高さや密度と同じくらい強い記憶の鍵になる。
  const GROUND = { asphalt: 0.0, concrete: 0.25, stone: 0.5, soil: 0.75, sand: 1.0 };
  const SIGN = { none: 0.0, plate: 0.3, banner: 0.6, scrawl: 0.8, neon: 1.0 };
  return [
    clamp01(med(hs) / 30),          // 高さ（10 階 = 30 m を上限に）
    clamp01(built * 2.2),           // 建蔽率
    clamp01(green / 12),            // 緑の多さ
    clamp01(aspect),                // 真四角さ（1 に近いほど正方形）
    clamp01(roofs.flat ?? 0),       // 陸屋根の割合
    clamp01((roofs.gable ?? 0) + (roofs.hip ?? 0)), // 勾配屋根の割合
    clamp01((roofs.shed ?? 0) + (roofs.saw ?? 0)),  // 片流れ・鋸屋根の割合
    clamp01(spread),                // 大きさのばらつき
    clamp01(sparse / 3),            // まばらさ
    GROUND[d.ground] ?? 0,          // 地面
    SIGN[d.signage] ?? 0,           // 看板
    // **坂かどうかは強い手掛かり。** 「坂の上の家」と「平地の家」は、
    // 建物が同じでも別の場所として覚えられる。
    d.slope ? 1 : 0,
  ];
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0; }

function sigDist(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

/**
 * 認知地図の作りやすさを測る。
 * @param {object} city
 *   districts [{id, kind, x, z, w, d, buildings, trees, area, roofs}]
 *   adjacency [[idA, idB], ...]（隣接。無ければ矩形の近さから作る）
 *   landmarks [{x, z, height}]（尖塔・塔・大きな建物など、遠くから見えるもの）
 *   edges     [{x0,z0,x1,z1}]（川・線路・大通りなど、地区を分ける切れ目）
 * @param {object} opts sameKindMax（同型隣接の許容割合）, sightRange（目印が見える距離）,
 *                      minSigDist（地区が別物と言える特徴の距離）, samples（立ってみる点の数）
 * @returns {{ sameKindAdj, twinPairs, landmarkCoverage, edgeAlignment, score, issues }}
 */
export function mapability(city, opts = {}) {
  const { sameKindMax = 0.25, sightRange = 400, minSigDist = 0.18, samples = 200 } = opts;
  const ds = city.districts ?? [];
  const issues = [];

  // M101 隣り合う地区が同じ型か
  let adj = city.adjacency;
  if (!adj) {
    adj = [];
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j];
      const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
      const gz = Math.abs(a.z - b.z) - (a.d + b.d) / 2;
      if (Math.max(gx, gz) < Math.max(a.w, a.d) * 0.35) adj.push([a.id, b.id]);
    }
  }
  const byId = new Map(ds.map((d) => [d.id, d]));
  let same = 0;
  for (const [x, y] of adj) if (byId.get(x)?.kind && byId.get(x).kind === byId.get(y)?.kind) same++;
  const sameKindAdj = adj.length ? same / adj.length : 0;
  if (sameKindAdj > sameKindMax) issues.push({ rule: 'M101', msg: `同じ型の地区が隣り合いすぎ（${(sameKindAdj * 100).toFixed(0)}%）。歩いて景色が変わらないので覚えられない`, value: sameKindAdj });

  // M103 似すぎた地区の組
  const sigs = ds.map((d) => ({ id: d.id, sig: districtSignature(d) }));
  const twins = [];
  for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
    const dd = sigDist(sigs[i].sig, sigs[j].sig);
    if (dd < minSigDist) twins.push([sigs[i].id, sigs[j].id, Number(dd.toFixed(3))]);
  }
  if (twins.length) issues.push({ rule: 'M103', msg: `見分けのつかない地区の組が ${twins.length} 組。高さ・密度・緑・屋根のどれかを変える`, value: twins.length });

  // M102 目印の見え方。街の上に点を撒いて、そこから見える目印を数える
  const lm = city.landmarks ?? [];
  let covered = 0, sum = 0;
  const bb = bounds(ds);
  for (let i = 0; i < samples; i++) {
    const t1 = frac(i * 0.7548776662), t2 = frac(i * 0.5698402909);
    const x = bb.x0 + t1 * (bb.x1 - bb.x0), z = bb.z0 + t2 * (bb.z1 - bb.z0);
    let seen = 0;
    for (const l of lm) {
      const dist = Math.hypot(l.x - x, l.z - z);
      // 高いものほど遠くから見える
      if (dist < sightRange * (0.5 + (l.height ?? 10) / 30)) seen++;
    }
    sum += seen; if (seen > 0) covered++;
  }
  const landmarkCoverage = samples ? covered / samples : 0;
  if (landmarkCoverage < 0.85) issues.push({ rule: 'M102', msg: `目印が見えない場所が ${((1 - landmarkCoverage) * 100).toFixed(0)}%。塔・尖塔など遠くから見えるものを増やす`, value: landmarkCoverage });

  // M104 地区の境が切れ目と一致しているか
  const eds = city.edges ?? [];
  let aligned = 0, borders = 0;
  for (const [x, y] of adj) {
    const a = byId.get(x), b = byId.get(y); if (!a || !b) continue;
    borders++;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    for (const e of eds) {
      if (pointToSeg(mx, mz, e) < Math.max(a.w, a.d) * 0.3) { aligned++; break; }
    }
  }
  const edgeAlignment = borders ? aligned / borders : 0;
  if (eds.length && edgeAlignment < 0.4) issues.push({ rule: 'M104', msg: `地区の境に川や大通りが無い（${(edgeAlignment * 100).toFixed(0)}%）。切れ目が無いと境目を覚えられない`, value: edgeAlignment });

  const score = clamp01(
    (1 - sameKindAdj) * 0.3 + landmarkCoverage * 0.35
    + clamp01(1 - twins.length / Math.max(1, ds.length)) * 0.2 + edgeAlignment * 0.15,
  );
  return { sameKindAdj, twinPairs: twins, landmarkCoverage, avgLandmarksInSight: samples ? sum / samples : 0, edgeAlignment, score, issues };
}

function frac(v) { return v - Math.floor(v); }
function bounds(ds) {
  if (!ds.length) return { x0: 0, z0: 0, x1: 1, z1: 1 };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const d of ds) {
    x0 = Math.min(x0, d.x - d.w / 2); x1 = Math.max(x1, d.x + d.w / 2);
    z0 = Math.min(z0, d.z - d.d / 2); z1 = Math.max(z1, d.z + d.d / 2);
  }
  return { x0, z0, x1, z1 };
}
function pointToSeg(x, z, e) {
  const vx = e.x1 - e.x0, vz = e.z1 - e.z0;
  const l2 = vx * vx + vz * vz;
  let t = l2 ? ((x - e.x0) * vx + (z - e.z0) * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (e.x0 + vx * t), z - (e.z0 + vz * t));
}
