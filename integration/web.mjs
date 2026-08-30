// Web との接続。**engine は DOM を知らない**ので、実測はここが受け持つ。
//
// 実地検証（design-catalog）の結論はこうだった:
//   engine 単体は HTML 品質検査器にならない。x,y が中心なのは変換で済む些事で、
//   真の壁は **CSS 文字列から rect を得られない**こと。Grid / Flex / clamp() /
//   コンテナクエリの後の実座標も、実フォントの幅も、日本語の折返し行数も、
//   ブラウザに測らせるしかない。
//
// そこで契約を分ける。
//   - このファイル … ブラウザで動き、getBoundingClientRect() と getComputedStyle() を集める
//   - engine 本体 … 集まった数値だけを見る（node でも動く）
// 間にあるのは素の JSON なので、測る側と判定する側を別のマシン・別の時点にできる。
//
//   // ブラウザ側
//   import { collect } from 'haichi-engine/web';
//   const snapshot = collect(document.querySelector('#app'));
//
//   // どこでも（node でも）
//   import { checkSnapshot } from 'haichi-engine/web';
//   const { problems, metrics } = checkSnapshot(snapshot, { minFont: 12 });
import { measure, contentWidth, wrapText, textWidth } from '../index.js';

/**
 * DOM から矩形と文字の情報を集める。**ブラウザでしか動かない。**
 * 返すのは素の JSON なので、そのまま保存して後で checkSnapshot に渡せる。
 *
 * root   … この配下を測る
 * select … 測る要素（既定: テキストを持つ要素と、位置指定されたもの）
 */
export function collect(root = document.body, opts = {}) {
  const {
    select = null,
    maxNodes = 2000,
    includeText = true,
  } = opts;
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    throw new Error('collect() はブラウザでのみ動く（node からは checkSnapshot を使う）');
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  const rootRect = root.getBoundingClientRect();
  const nodes = select ? [...root.querySelectorAll(select)] : candidates(root);
  const shapes = [];
  for (const el of nodes.slice(0, maxNodes)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    const bL = parseFloat(cs.borderLeftWidth) || 0, bR = parseFloat(cs.borderRightWidth) || 0;
    const bT = parseFloat(cs.borderTopWidth) || 0, bB = parseFloat(cs.borderBottomWidth) || 0;
    const own = includeText ? ownText(el) : '';
    shapes.push({
      id: idOf(el, shapes.length),
      // engine は中心で扱う。DOM の left/top からの変換はここでやる
      x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
      // **content box を実測で渡す。** w - 6 のような決め打ちをさせない
      contentW: Math.max(0, r.width - padL - padR - bL - bR),
      contentH: Math.max(0, r.height - padT - padB - bT - bB),
      font: parseFloat(cs.fontSize) || 12,
      lineHeight: parseFloat(cs.lineHeight) || null,
      label: own || undefined,
      wrap: cs.whiteSpace !== 'nowrap' && cs.whiteSpace !== 'pre',
      scrollX: el.scrollWidth > el.clientWidth + 1,
      scrollY: el.scrollHeight > el.clientHeight + 1,
      overflow: cs.overflow,
      tag: el.tagName.toLowerCase(),
      // 実測した文字幅。見積りではなくブラウザの答え
      measuredW: own ? measureText(own, cs) : null,
    });
  }
  return {
    viewport: { width: vw, height: vh },
    bounds: { x: rootRect.left + rootRect.width / 2, y: rootRect.top + rootRect.height / 2, w: rootRect.width, h: rootRect.height },
    at: new Date().toISOString(),
    shapes,
  };
}

function candidates(root) {
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if (ownText(c) || cs.position === 'absolute' || cs.position === 'fixed') out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}
/** 子要素のテキストを除いた、その要素自身の文字 */
function ownText(el) {
  let s = '';
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
  return s.trim();
}
function idOf(el, i) {
  if (el.id) return `#${el.id}`;
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}#${i}`;
}
let _canvas = null;
/** 実フォントで文字幅を測る（canvas。DOM を汚さない） */
function measureText(text, cs) {
  try {
    _canvas ??= document.createElement('canvas');
    const ctx = _canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
    return ctx.measureText(text).width;
  } catch { return null; }
}

/**
 * collect() の結果を検査する。**node でも動く**（DOM に触らない）。
 * 実測値があればそれを使い、無ければ engine の見積りに落ちる。
 */
export function checkSnapshot(snapshot, opts = {}) {
  const { minFont = 12, gap = 0, checkBounds = true, allowEllipsis = true } = opts;
  const shapes = snapshot.shapes.map((s) => ({ ...s }));
  const problems = [];

  // W201 実フォントで測ると 1 行に入らない（nowrap のとき）
  // W202 折り返すと箱の高さを超える
  // どちらも「ブラウザが測った幅」を使う。見積りでは判定できない
  let overflowX = 0, overflowY = 0;
  for (const s of shapes) {
    if (!s.label) continue;
    const inner = contentWidth(s);
    if (inner <= 0) continue;
    const need = s.measuredW ?? textWidth(s.label, s.font * 0.55);
    if (!s.wrap) {
      if (need > inner + 0.5 && !s.scrollX) {
        overflowX++;
        problems.push({ code: 'W201', id: s.id, message: `${s.id}「${clip(s.label)}」が 1 行に入らない（実測 ${need.toFixed(0)}px > 内寸 ${inner.toFixed(0)}px、${(need - inner).toFixed(0)}px 不足）— 幅を広げるか、文言を短くするか、折り返しを許す` });
      }
      continue;
    }
    const cw = (s.measuredW && s.label.length) ? s.measuredW / textWidth(s.label, 1) : s.font * 0.55;
    const wrapped = wrapText(s.label, inner, cw, { font: s.font, lineHeight: s.lineHeight });
    const boxH = s.contentH ?? s.h;
    // overflow:visible は「はみ出して見える」だけで、レイアウトとしては壊れている
    // （下の要素に重なる）。スクロールできるときだけ許す
    if (wrapped.height > boxH + 1 && !s.scrollY && s.overflow !== 'auto' && s.overflow !== 'scroll') {
      overflowY++;
      problems.push({ code: 'W202', id: s.id, message: `${s.id}「${clip(s.label)}」が ${wrapped.count} 行になり ${wrapped.height.toFixed(0)}px 必要（内寸 ${boxH.toFixed(0)}px、${(wrapped.height - boxH).toFixed(0)}px 溢れる）— 高さを増やすか、文言を短くする` });
    }
  }

  // W203 文字が小さすぎる（Web の既定は 12px。図の 9px より厳しくする）
  let tiny = 0;
  for (const s of shapes) {
    if (!s.label) continue;
    if (s.font < minFont) { tiny++; problems.push({ code: 'W203', id: s.id, message: `${s.id} の文字が ${s.font.toFixed(1)}px（読める最小 ${minFont}px）— 拡大するか、この画面幅では出さない` }); }
  }

  // W204 横スクロールが出ている（縦は普通だが、横は事故であることが多い）
  let hscroll = 0;
  for (const s of shapes) if (s.scrollX && s.overflow !== 'auto' && s.overflow !== 'scroll') {
    hscroll++;
    problems.push({ code: 'W204', id: s.id, message: `${s.id} に意図しない横スクロールが出ている（内容が内寸を超えている）— overflow を明示するか、内容を収める` });
  }

  // 幾何の検査は engine 本体に任せる（重なり・領域外）
  const geo = measure(shapes.filter((s) => s.tag !== 'html' && s.tag !== 'body'), [], {
    minFont, gap, allowEllipsis,
    bounds: checkBounds ? snapshot.bounds : null,
    scrollable: true,   // Web は縦に長いのが普通
  });
  for (const p of geo.problems) if (p.code === 'H110' || p.code === 'H103') problems.push(p);

  return {
    problems,
    metrics: {
      viewport: snapshot.viewport,
      shapes: shapes.length,
      overflowX, overflowY, tinyText: tiny, hscroll,
      outside: geo.metrics.outside,
    },
  };
}
const clip = (s) => (s.length > 24 ? `${s.slice(0, 23)}…` : s);

/**
 * 複数の画面幅で検査する。**断点で壊れる**のが Web の典型なので、
 * 1 つの幅だけ見ても意味がない。collect() を各幅で走らせた結果を渡す。
 *   checkResponsive([{ width: 375, snapshot }, { width: 1280, snapshot }])
 */
export function checkResponsive(runs, opts = {}) {
  const rows = runs.map(({ width, snapshot }) => ({ width, ...checkSnapshot(snapshot, opts) }));
  const byWidth = Object.fromEntries(rows.map((r) => [r.width, r.problems.length]));
  // どの幅で増えたかを出す。「1280 では平気、375 で崩れる」を一目で分かるように
  const worst = rows.reduce((a, b) => (b.problems.length > a.problems.length ? b : a), rows[0]);
  return { rows, byWidth, worst: worst && { width: worst.width, count: worst.problems.length } };
}
