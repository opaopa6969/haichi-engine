// デモ。ビルドしていない — ブラウザが ../index.js をそのまま読んでいる。
import { pack, treemap, grid, relax, placeLabels, measure, fitText, textWidth } from '../index.js';
import { blocks, project, visibleFrom, measure3 } from '../index3d.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ns = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text = null) => {
  const n = document.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const clear = (svg) => { while (svg.firstChild) svg.removeChild(svg.firstChild); };

// ---------------------------------------------------------------- 1. バグの再現

// 駅のような「小さい丸 + 外に置く名前」。tetsugo で 616 駅が全部「…」になった形
const STATIONS = [
  ['稚内', 60, 60], ['宗谷岬', 170, 45], ['旭川', 120, 130], ['富良野', 230, 115],
  ['札幌', 70, 200], ['小樽', 180, 215], ['函館', 300, 190], ['室蘭', 250, 255],
  ['帯広', 350, 120], ['釧路', 400, 235], ['網走', 330, 55], ['知床', 415, 90],
  // 半径 12 は tetsugo の実寸に近い。ここが小さすぎると「…」すら入らず空文字になり、
  // 「切り詰めた『…』が内側に居座る」という当時の症状が再現しない
].map(([name, x, y]) => ({ id: name, x, y, r: 12, label: name, font: 13 }));

// 壊れていた版: 内外を「切り詰めた後の文字」で決める（＝常に内側に収まってしまう）
function placeLabelsBuggy(shapes, { minFont = 9, gap = 2, cw = 0.55 } = {}) {
  const out = new Map(); const taken = [];
  const dirs = [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  for (const s of [...shapes].sort((a, b) => b.r - a.r)) {
    const font = s.font ?? 12;
    if (font < minFont) { out.set(s.id, { hidden: true }); continue; }
    const inner = s.r * 2 - 6;
    const text = fitText(s.label, inner, font * cw) || '…';   // ← ここが元凶
    const tw = textWidth(text, font * cw), th = font * 1.2;
    let placed = null;
    for (const [dx, dy] of dirs) {
      const x = s.x + dx * (s.r + tw / 2 + gap), y = s.y + dy * (s.r + th / 2 + gap);
      const box = { x, y, w: tw, h: th };
      if (taken.some((t) => Math.min((box.w + t.w) / 2 + gap - Math.abs(box.x - t.x), (box.h + t.h) / 2 + gap - Math.abs(box.y - t.y)) > 0)) continue;
      placed = { ...box, text, font, at: dx === 0 && dy === 0 ? 'inside' : 'outside' };
      break;
    }
    if (placed) { taken.push(placed); out.set(s.id, placed); } else out.set(s.id, { hidden: true });
  }
  return out;
}

function drawStations(svg, labels, shapes) {
  clear(svg);
  for (const s of shapes) svg.appendChild(el('circle', { cx: s.x, cy: s.y, r: s.r, class: 'station' }));
  for (const s of shapes) {
    const l = labels.get(s.id);
    if (!l || l.hidden) continue;
    svg.appendChild(el('text', { x: l.x, y: l.y + l.font * 0.35, 'text-anchor': 'middle', 'font-size': l.font, class: `label ${l.at}` }, l.text));
  }
}

function section1() {
  const before = placeLabelsBuggy(STATIONS);
  const after = placeLabels(STATIONS, { minFont: 9 });
  drawStations($('bug-before'), before, STATIONS);
  drawStations($('bug-after'), after, STATIONS);
  const count = (m) => {
    const v = [...m.values()].filter((x) => !x.hidden);
    return { inside: v.filter((x) => x.at === 'inside').length, outside: v.filter((x) => x.at === 'outside').length,
             cut: v.filter((x) => x.text !== undefined && x.text.includes('…')).length, hidden: [...m.values()].length - v.length };
  };
  const b = count(before), a = count(after);
  $('bug-before-v').textContent = `内側 ${b.inside} / 外側 ${b.outside} / 切り詰め ${b.cut} — 名前が読めない`;
  $('bug-after-v').textContent = `内側 ${a.inside} / 外側 ${a.outside} / 切り詰め ${a.cut} — 全部読める`;
}

// ---------------------------------------------------------------- 2. 壊してみる

const CARDS = [
  { id: 'a', label: '既存の手順を大きく変えずに導入できます' },
  { id: 'b', label: '配置と測定' },
  { id: 'c', label: '読めるかを測る' },
  { id: 'd', label: '依存ゼロ・決定論的' },
];

function section2() {
  const W = Number($('w').value), F = Number($('f').value), strict = $('ellipsis').checked;
  $('w-out').textContent = `${W}px`;
  $('f-out').textContent = `${F}px`;
  const cw = 2, ch = 2;                       // 2 列 2 行
  const bw = (W - 30) / cw, bh = 110;
  const shapes = CARDS.map((c, i) => ({
    ...c, x: 15 + (i % cw) * bw + bw / 2, y: 25 + Math.floor(i / cw) * (bh + 10) + bh / 2,
    w: bw - 10, h: bh, font: F,
  }));
  const bounds = { x: 230, y: 150, w: 460, h: 300 };
  const r = measure(shapes, [], { minFont: 9, bounds, allowEllipsis: !strict });

  const svg = $('live'); clear(svg);
  svg.appendChild(el('rect', { x: 0.5, y: 0.5, width: 459, height: 299, class: 'bounds' }));
  const bad = new Set(r.problems.map((p) => p.id));
  for (const s of shapes) {
    svg.appendChild(el('rect', { x: s.x - s.w / 2, y: s.y - s.h / 2, width: s.w, height: s.h, rx: 6,
      class: `card${bad.has(s.id) ? ' bad' : ''}` }));
    const t = fitText(s.label, s.w - 6, s.font * 0.55);
    svg.appendChild(el('text', { x: s.x, y: s.y + s.font * 0.35, 'text-anchor': 'middle', 'font-size': s.font, class: 'label' }, t));
  }
  renderProblems($('live-problems'), r, ['shapes', 'overflow', 'unreadable', 'truncated', 'outside', 'overlaps']);
}

function renderProblems(box, r, keys) {
  const m = keys.map((k) => `<span><b>${k}</b> ${typeof r.metrics[k] === 'number' ? (Number.isInteger(r.metrics[k]) ? r.metrics[k] : r.metrics[k].toFixed(2)) : '—'}</span>`).join('');
  const list = r.problems.length
    ? r.problems.map((p) => `<li><code>${p.code}</code> ${esc(p.message)}</li>`).join('')
    : '<li class="ok">指摘なし</li>';
  box.innerHTML = `<div class="metrics">${m}</div><ul>${list}</ul>`;
}

// ---------------------------------------------------------------- 3. 配置

const TREE = [
  { id: 'core', children: [{ id: 'Engine', value: 300 }, { id: 'util', value: 60 }, { id: 'Rng', value: 40 }] },
  { id: 'io', children: [{ id: 'read', value: 120 }, { id: 'write', value: 80 }] },
  { id: 'ui', children: [{ id: 'View', value: 160 }] },
];

function section3() {
  // pack
  const sp = $('lay-pack'); clear(sp);
  for (const [id, c] of pack(TREE, { size: 300, padding: (d) => (d === 0 ? 10 : 4) })) {
    sp.appendChild(el('circle', { cx: c.x, cy: c.y, r: c.r, class: c.parent ? 'leaf' : 'group' }));
    if (c.r > 26) sp.appendChild(el('text', { x: c.x, y: c.y + 4, 'text-anchor': 'middle', 'font-size': Math.min(13, c.r / 3), class: 'label' }, fitText(id, c.r * 2 - 6, Math.min(13, c.r / 3) * 0.55)));
  }
  // treemap
  const st = $('lay-tree'); clear(st);
  for (const [id, c] of treemap(TREE, { w: 300, h: 300, padding: 3 })) {
    st.appendChild(el('rect', { x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h, class: c.parent ? 'leaf' : 'group' }));
    if (c.w > 44 && c.h > 16) st.appendChild(el('text', { x: c.x, y: c.y + 4, 'text-anchor': 'middle', 'font-size': 11, class: 'label' }, fitText(id, c.w - 6, 11 * 0.55)));
  }
  // grid
  const sg = $('lay-grid'); clear(sg);
  const items = TREE.flatMap((g) => g.children.map((c) => ({ id: c.id, w: 62, h: 34 })));
  const { items: placed } = grid(items, { x: 10, y: 20, gap: 6, bounds: { w: 280, h: 300 } });
  for (const [id, c] of placed) {
    sg.appendChild(el('rect', { x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h, rx: 4, class: 'leaf' }));
    sg.appendChild(el('text', { x: c.x, y: c.y + 4, 'text-anchor': 'middle', 'font-size': 11, class: 'label' }, fitText(id, c.w - 6, 11 * 0.55)));
  }
}

// ---------------------------------------------------------------- 4. bounds

function section4() {
  const bounds = { x: 230, y: 130, w: 300, h: 200 };
  const seed = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, x: 230 + (i % 3) * 6, y: 130 + Math.floor(i / 3) * 6, w: 96, h: 62 }));
  const no = relax(seed, { gap: 4, iterations: 300 });
  const yes = relax(seed, { gap: 4, iterations: 300, bounds });
  for (const [svgId, vId, m] of [['relax-no', 'relax-no-v', no], ['relax-yes', 'relax-yes-v', yes]]) {
    const svg = $(svgId); clear(svg);
    svg.appendChild(el('rect', { x: bounds.x - bounds.w / 2, y: bounds.y - bounds.h / 2, width: bounds.w, height: bounds.h, class: 'bounds' }));
    const r = measure([...m.values()], [], { bounds, gap: 4 });
    const bad = new Set(r.problems.filter((p) => p.code === 'H110').map((p) => p.id));
    for (const c of m.values()) svg.appendChild(el('rect', { x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h, rx: 4, class: `card${bad.has(c.id) ? ' bad' : ''}` }));
    $(vId).textContent = `重なり ${r.metrics.overlaps} / 領域外 ${r.metrics.outside}`;
  }
}

// ---------------------------------------------------------------- 5. 3D

const CITY = [
  { id: 'core', value: 420, name: 'core', children: [
      { id: 'Engine', value: 240, height: 46, name: 'Engine' }, { id: 'util', value: 90, height: 14, name: 'util' },
      { id: 'Rng', value: 50, height: 10, name: 'Rng' }, { id: 'Spring', value: 40, height: 8, name: 'Spring' } ] },
  { id: 'io', value: 200, name: 'io', children: [
      { id: 'read', value: 110, height: 26, name: 'read' }, { id: 'write', value: 90, height: 20, name: 'write' } ] },
  { id: 'ui', value: 160, name: 'ui', children: [
      { id: 'View', value: 100, height: 34, name: 'View' }, { id: 'Panel', value: 60, height: 12, name: 'Panel' } ] },
];

function section5() {
  const camY = Number($('cam-y').value), camZ = Number($('cam-z').value);
  $('cam-y-out').textContent = camY;
  $('cam-z-out').textContent = camZ;
  const city = blocks(CITY, { w: 1000, d: 1000, padding: 24, heightScale: 6 });
  const objs = [...city.values()].map((b) => ({ ...b, label: b.node?.name }));
  const camera = { x: 200, y: camY, z: camZ, target: { x: 500, y: 0, z: 500 }, fov: 50, width: 640, height: 420 };

  const svg = $('city'); clear(svg);
  const { visible } = visibleFrom(objs, camera);
  // 奥から手前へ描く
  const rows = [...visible].sort((a, b) => b.depth - a.depth);
  for (const v of rows) {
    const o = v.obj;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: o.x + (sx * o.w) / 2, z: o.z + (sz * o.d) / 2 }));
    const base = corners.map((c) => project({ x: c.x, y: 0, z: c.z }, camera));
    const top = corners.map((c) => project({ x: c.x, y: o.h, z: c.z }, camera));
    if (base.some((p) => p.behind) || top.some((p) => p.behind)) continue;
    if (o.district) {
      svg.appendChild(el('polygon', { points: base.map((p) => `${p.x},${p.y}`).join(' '), class: 'district' }));
      continue;
    }
    // 側面 4 枚 + 屋根
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      svg.appendChild(el('polygon', { points: `${base[i].x},${base[i].y} ${base[j].x},${base[j].y} ${top[j].x},${top[j].y} ${top[i].x},${top[i].y}`, class: 'wall' }));
    }
    svg.appendChild(el('polygon', { points: top.map((p) => `${p.x},${p.y}`).join(' '), class: 'roof' }));
    // ラベルは「読める大きさで出せる」ときだけ
    const c = project({ x: o.x, y: o.h, z: o.z }, camera);
    const font = Math.max(2, o.h * 0.25) * c.scale;
    if (font >= 9 && o.label) svg.appendChild(el('text', { x: c.x, y: c.y - 6, 'text-anchor': 'middle', 'font-size': Math.min(font, 18), class: 'label3d' }, o.label));
  }
  const r = measure3(objs, [], camera, { walkWidth: 20, minFont: 9 });
  renderProblems($('city-problems'), r, ['objects', 'overlaps', 'narrowGaps', 'occluded', 'visibleRatio', 'unreadableLabels', 'heightRatio']);
}

// ---------------------------------------------------------------- 起動

section1(); section3(); section4();
for (const id of ['w', 'f', 'ellipsis']) $(id).addEventListener('input', section2);
for (const id of ['cam-y', 'cam-z']) $(id).addEventListener('input', section5);
section2(); section5();
