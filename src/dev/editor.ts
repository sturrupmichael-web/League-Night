/**
 * Hole editor (dev only: ?editor). Place the tee, basket, polygons and trees on a grid,
 * paint hills, then export the hole JSON or test-play it straight away.
 * The draft is kept in localStorage so a test-play round trip loses nothing.
 */
import courseJson from '../content/courses/lantern-park.json';
import type { CourseJson, HoleJson } from '../game/hole';
import { parseHole } from '../game/hole';
import { type Camera, FieldRenderer, screenToWorld, worldToScreen } from '../render/field';
import { PAL } from '../render/palette';
import { makeTerrain } from '../sim/terrain';

export const DRAFT_KEY = 'leaguenight.editor.draft';

type Layer = 'bounds' | 'fairway' | 'green' | 'rough' | 'sand' | 'water' | 'ob';
type Tool = 'pan' | 'tee' | 'basket' | Layer | 'tree' | 'erase' | 'hill' | 'dig';

const LAYER_COLOR: Record<Layer, string> = {
  bounds: '#ffffff',
  fairway: '#8fd16a',
  green: '#b6f26a',
  rough: '#3b6a45',
  sand: '#c9a86a',
  water: '#4f8fb3',
  ob: '#e0533f',
};

const W = 360;
const H = 560;

export function blankHole(): HoleJson {
  return {
    id: 99,
    name: 'NEW HOLE',
    par: 3,
    lengthFt: 260,
    tee: [0, 0],
    basket: [0, 260],
    bounds: [[-120, -60], [120, -60], [120, 380], [-120, 380]],
    fairway: [[[-30, -20], [30, -20], [30, 280], [-30, 280]]],
    trees: [],
    windRange: [0, 10],
    note: '',
  };
}

export function loadDraft(): HoleJson | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as HoleJson) : null;
  } catch {
    return null;
  }
}

function storeDraft(h: HoleJson) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(h));
  } catch {
    /* storage blocked: the export box still works */
  }
}

export function mountEditor(root: HTMLElement) {
  const course = courseJson as CourseJson;
  let hole: HoleJson = loadDraft() ?? structuredClone(course.holes[0]);
  const undo: string[] = [];
  let tool: Tool = 'pan';
  let pending: [number, number][] = [];
  let snap = 5;
  let treeR = 9;
  let error = '';

  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
  root.innerHTML = '';
  const css = document.createElement('style');
  css.textContent = `
  #ed{display:flex;gap:12px;padding:10px;color:#f4e9cd;font:12px/1.4 ui-monospace,monospace;background:#14111c;min-height:100vh;flex-wrap:wrap}
  #ed canvas{image-rendering:pixelated;width:${W * 1.5}px;height:${H * 1.5}px;max-width:95vw;border:1px solid #5b4a6e;cursor:crosshair;touch-action:none}
  #ed .side{width:300px;display:flex;flex-direction:column;gap:6px}
  #ed button{font:inherit;background:#352b45;color:#f4e9cd;border:1px solid #5b4a6e;padding:4px 6px;cursor:pointer}
  #ed button.on{background:#f2b544;color:#14111c}
  #ed .tools{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
  #ed input,#ed select,#ed textarea{font:inherit;background:#221c2e;color:#f4e9cd;border:1px solid #5b4a6e;padding:3px}
  #ed textarea{width:100%;height:160px}
  #ed .err{color:#e0533f;min-height:1.4em}
  #ed h3{margin:6px 0 0;color:#f2b544;font-size:12px}
  #ed .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  `;
  document.head.appendChild(css);
  const ed = document.createElement('div');
  ed.id = 'ed';
  root.appendChild(ed);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  ed.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const side = document.createElement('div');
  side.className = 'side';
  ed.appendChild(side);

  const cam: Camera = { x: 0, y: 160, zoom: 1, ax: W / 2, ay: H / 2 };
  let field: FieldRenderer | null = null;
  let fieldCanvas = document.createElement('canvas');

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, parent: HTMLElement = side): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') e.style.cssText = String(v);
      else (e as unknown as Record<string, unknown>)[k] = v;
    }
    parent.appendChild(e);
    return e;
  }

  // ---- Side panel ----
  el('h3', { textContent: 'LEAGUE NIGHT · HOLE EDITOR' });
  const loadRow = el('div', { className: 'row' });
  const pick = el('select', {}, loadRow);
  el('option', { value: 'blank', textContent: 'NEW BLANK HOLE' }, pick);
  course.holes.forEach((h, i) => el('option', { value: String(i), textContent: `${i + 1}. ${h.name}` }, pick));
  el('button', { textContent: 'LOAD', onclick: () => {
    push();
    hole = pick.value === 'blank' ? blankHole() : structuredClone(course.holes[Number(pick.value)]);
    frame();
    changed();
  } }, loadRow);

  const meta = el('div', { className: 'row' });
  const name = el('input', { size: 18, placeholder: 'NAME' }, meta);
  const par = el('input', { type: 'number', min: '2', max: '6', style: 'width:44px' }, meta);
  const note = el('input', { placeholder: 'NOTE (E.G. WATER SHORT LEFT)', style: 'width:100%' });
  const windRow = el('div', { className: 'row' });
  el('span', { textContent: 'WIND MPH' }, windRow);
  const w0 = el('input', { type: 'number', style: 'width:44px' }, windRow);
  const w1 = el('input', { type: 'number', style: 'width:44px' }, windRow);
  for (const inp of [name, par, note, w0, w1]) {
    inp.onchange = () => {
      push();
      hole.name = name.value.toUpperCase() || 'NEW HOLE';
      hole.par = Number(par.value) || 3;
      hole.note = note.value.toUpperCase();
      hole.windRange = [Number(w0.value) || 0, Number(w1.value) || 0];
      changed();
    };
  }

  el('h3', { textContent: 'TOOLS' });
  const tools = el('div', { className: 'tools' });
  const toolList: [Tool, string][] = [
    ['pan', 'PAN'], ['tee', 'TEE'], ['basket', 'BASKET'], ['tree', 'TREE'],
    ['bounds', 'BOUNDS'], ['fairway', 'FAIRWAY'], ['green', 'GREEN'], ['rough', 'ROUGH'],
    ['sand', 'SAND'], ['water', 'WATER'], ['ob', 'OB'], ['erase', 'ERASE'],
    ['hill', 'HILL +'], ['dig', 'HILL -'],
  ];
  const toolButtons = toolList.map(([t, label]) => {
    const b = el('button', { textContent: label, onclick: () => setTool(t) }, tools);
    return { t, b };
  });
  const opts = el('div', { className: 'row' });
  el('span', { textContent: 'SNAP' }, opts);
  const snapIn = el('input', { type: 'number', value: String(snap), style: 'width:44px', onchange: () => (snap = Math.max(1, Number(snapIn.value) || 1)) }, opts);
  el('span', { textContent: 'TREE R' }, opts);
  const treeIn = el('input', { type: 'number', value: String(treeR), style: 'width:44px', onchange: () => (treeR = Math.max(2, Number(treeIn.value) || 9)) }, opts);
  const act = el('div', { className: 'row' });
  el('button', { textContent: 'FINISH SHAPE (ENTER)', onclick: () => finishPoly() }, act);
  el('button', { textContent: 'UNDO (Z)', onclick: () => doUndo() }, act);
  el('button', { textContent: 'FRAME', onclick: () => frame() }, act);
  const help = el('div', {
    innerHTML:
      'CLICK TO PLACE. SHAPES: CLICK EACH CORNER, THEN ENTER OR DOUBLE-CLICK. ERASE: CLICK A TREE OR INSIDE A SHAPE (TOPMOST FIRST). HILLS: CLICK OR DRAG. WHEEL ZOOMS, RIGHT-DRAG OR PAN TOOL MOVES.',
  });
  help.style.color = '#8d7aa0';
  const err = el('div', { className: 'err' });

  el('h3', { textContent: 'EXPORT' });
  const out = el('textarea', { readOnly: true });
  const exp = el('div', { className: 'row' });
  el('button', { textContent: 'COPY JSON', onclick: () => navigator.clipboard?.writeText(out.value) }, exp);
  el('button', {
    textContent: 'DOWNLOAD',
    onclick: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out.value], { type: 'application/json' }));
      a.download = `${(hole.name || 'hole').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
      a.click();
    },
  }, exp);
  el('button', {
    textContent: 'TEST PLAY',
    onclick: () => {
      if (error) return;
      storeDraft(hole);
      location.href = `${location.pathname}?testhole`;
    },
  }, exp);

  function setTool(t: Tool) {
    if (pending.length) finishPoly();
    tool = t;
    toolButtons.forEach(({ t: x, b }) => b.classList.toggle('on', x === t));
  }

  function push() {
    undo.push(JSON.stringify(hole));
    if (undo.length > 80) undo.shift();
  }
  function doUndo() {
    if (pending.length) {
      pending.pop();
      return draw();
    }
    const s = undo.pop();
    if (s) {
      hole = JSON.parse(s);
      changed();
    }
  }

  function changed() {
    name.value = hole.name;
    par.value = String(hole.par);
    note.value = hole.note ?? '';
    w0.value = String(hole.windRange?.[0] ?? 0);
    w1.value = String(hole.windRange?.[1] ?? 10);
    hole.lengthFt = Math.round(Math.hypot(hole.basket[0] - hole.tee[0], hole.basket[1] - hole.tee[1]));
    try {
      const def = parseHole(hole);
      error = '';
      const terrain = makeTerrain(def.terrain);
      const m = 60;
      field = new FieldRenderer(terrain, def.box.x0 - m, def.box.y0 - m, def.box.x1 + m, def.box.y1 + m, 2, W, H);
    } catch (e) {
      error = (e as Error).message;
    }
    err.textContent = error;
    out.value = JSON.stringify(hole, (_k, v) => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' ? `@@${JSON.stringify(v)}` : v), 2).replace(/"@@(\[[^\]]*\])"/g, '$1');
    storeDraft(hole);
    renderField();
  }

  function renderField() {
    if (!field) return draw();
    fieldCanvas = document.createElement('canvas');
    fieldCanvas.width = W;
    fieldCanvas.height = H;
    field.draw(fieldCanvas.getContext('2d')!, cam, 0);
    draw();
  }

  function frame() {
    const xs = hole.bounds.map((p) => p[0]);
    const ys = hole.bounds.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    cam.zoom = Math.min((W - 20) / (x1 - x0), (H - 20) / (y1 - y0));
    cam.x = (x0 + x1) / 2;
    cam.y = (y0 + y1) / 2;
    renderField();
  }

  const S = (p: [number, number]) => worldToScreen(cam, p[0], p[1]);

  function polyPath(poly: [number, number][]) {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const s = S(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
  }

  function draw() {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(fieldCanvas, 0, 0);
    // 50 ft grid.
    ctx.strokeStyle = 'rgba(244,233,205,0.08)';
    ctx.lineWidth = 1;
    const a = screenToWorld(cam, 0, H);
    const b = screenToWorld(cam, W, 0);
    for (let x = Math.ceil(a.x / 50) * 50; x < b.x; x += 50) {
      const s = worldToScreen(cam, x, 0);
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x) + 0.5, 0);
      ctx.lineTo(Math.round(s.x) + 0.5, H);
      ctx.stroke();
    }
    for (let y = Math.ceil(a.y / 50) * 50; y < b.y; y += 50) {
      const s = worldToScreen(cam, 0, y);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(s.y) + 0.5);
      ctx.lineTo(W, Math.round(s.y) + 0.5);
      ctx.stroke();
    }
    // Shape outlines.
    const layers: Layer[] = ['fairway', 'green', 'rough', 'sand', 'water', 'ob'];
    for (const l of layers) {
      for (const poly of (hole[l] as [number, number][][] | undefined) ?? []) {
        polyPath(poly);
        ctx.closePath();
        ctx.strokeStyle = LAYER_COLOR[l];
        ctx.stroke();
      }
    }
    polyPath(hole.bounds);
    ctx.closePath();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = LAYER_COLOR.bounds;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const t of hole.trees ?? []) {
      const s = worldToScreen(cam, t.x, t.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(2, t.r * cam.zoom), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,41,31,0.85)';
      ctx.fill();
      ctx.strokeStyle = '#2a4d33';
      ctx.stroke();
    }
    const tee = S(hole.tee);
    ctx.fillStyle = PAL.haze;
    ctx.fillRect(tee.x - 4, tee.y - 6, 8, 12);
    const bk = S(hole.basket);
    ctx.fillStyle = PAL.amber;
    ctx.beginPath();
    ctx.arc(bk.x, bk.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,233,205,0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(tee.x, tee.y);
    ctx.lineTo(bk.x, bk.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Shape in progress.
    if (pending.length && tool !== 'pan' && tool in LAYER_COLOR) {
      polyPath(pending);
      ctx.strokeStyle = LAYER_COLOR[tool as Layer];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      for (const p of pending) {
        const s = S(p);
        ctx.fillStyle = '#fff';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    }
    ctx.fillStyle = '#f4e9cd';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${hole.name} · PAR ${hole.par} · ${hole.lengthFt} FT · ${tool.toUpperCase()}`, 6, 14);
  }

  function snapPt(sx: number, sy: number): [number, number] {
    const w = screenToWorld(cam, sx, sy);
    return [Math.round(w.x / snap) * snap, Math.round(w.y / snap) * snap];
  }

  function finishPoly() {
    if (pending.length < 3 || !(tool in LAYER_COLOR)) {
      pending = [];
      return draw();
    }
    push();
    if (tool === 'bounds') hole.bounds = pending;
    else {
      const l = tool as Exclude<Layer, 'bounds'>;
      hole[l] = [...((hole[l] as [number, number][][] | undefined) ?? []), pending];
    }
    pending = [];
    changed();
  }

  function pointIn(x: number, y: number, poly: [number, number][]) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function erase(sx: number, sy: number) {
    const w = screenToWorld(cam, sx, sy);
    const trees = hole.trees ?? [];
    const ti = trees.findIndex((t) => Math.hypot(t.x - w.x, t.y - w.y) <= t.r + 2);
    push();
    if (ti >= 0) {
      trees.splice(ti, 1);
      return changed();
    }
    for (const l of ['ob', 'water', 'sand', 'rough', 'green', 'fairway'] as const) {
      const list = (hole[l] as [number, number][][] | undefined) ?? [];
      const pi = list.findIndex((p) => pointIn(w.x, w.y, p));
      if (pi >= 0) {
        list.splice(pi, 1);
        return changed();
      }
    }
    undo.pop();
  }

  /** Raise or lower the heightmap around a point, creating one over the bounds if needed. */
  function paintHill(sx: number, sy: number, dir: number) {
    const w = screenToWorld(cam, sx, sy);
    if (!hole.heightmap) {
      const xs = hole.bounds.map((p) => p[0]);
      const ys = hole.bounds.map((p) => p[1]);
      const cellFt = 20;
      const x0 = Math.min(...xs) - 40;
      const y0 = Math.min(...ys) - 40;
      const gw = Math.ceil((Math.max(...xs) + 40 - x0) / cellFt) + 1;
      const gh = Math.ceil((Math.max(...ys) + 40 - y0) / cellFt) + 1;
      hole.heightmap = { cellFt, w: gw, h: gh, data: new Array(gw * gh).fill(0), originX: x0, originY: y0 };
    }
    const hm = hole.heightmap;
    const ox = hm.originX ?? 0;
    const oy = hm.originY ?? 0;
    for (let j = 0; j < hm.h; j++) {
      for (let i = 0; i < hm.w; i++) {
        const d = Math.hypot(ox + i * hm.cellFt - w.x, oy + j * hm.cellFt - w.y);
        if (d < 50) hm.data[j * hm.w + i] = Math.round((hm.data[j * hm.w + i] + dir * 1.5 * (1 - d / 50)) * 10) / 10;
      }
    }
  }

  // ---- Pointer handling ----
  let drag: { x: number; y: number; pan: boolean } | null = null;
  const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    const pan = tool === 'pan' || e.button !== 0;
    drag = { ...p, pan };
    if (pan) return;
    if (tool === 'tee' || tool === 'basket') {
      push();
      hole[tool] = snapPt(p.x, p.y);
      changed();
    } else if (tool === 'tree') {
      const [x, y] = snapPt(p.x, p.y);
      push();
      hole.trees = [...(hole.trees ?? []), { x, y, r: treeR }];
      changed();
    } else if (tool === 'erase') erase(p.x, p.y);
    else if (tool === 'hill' || tool === 'dig') {
      push();
      paintHill(p.x, p.y, tool === 'hill' ? 1 : -1);
      changed();
    } else {
      pending.push(snapPt(p.x, p.y));
      draw();
    }
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    const p = local(e);
    if (drag.pan) {
      cam.x -= (p.x - drag.x) / cam.zoom;
      cam.y += (p.y - drag.y) / cam.zoom;
      drag.x = p.x;
      drag.y = p.y;
      renderField();
    } else if ((tool === 'hill' || tool === 'dig') && Math.hypot(p.x - drag.x, p.y - drag.y) > 8) {
      paintHill(p.x, p.y, tool === 'hill' ? 1 : -1);
      drag.x = p.x;
      drag.y = p.y;
      changed();
    }
  };
  canvas.onpointerup = () => (drag = null);
  canvas.ondblclick = () => finishPoly();
  canvas.onwheel = (e) => {
    e.preventDefault();
    const p = local(e);
    const before = screenToWorld(cam, p.x, p.y);
    cam.zoom = Math.min(8, Math.max(0.2, cam.zoom * (e.deltaY > 0 ? 0.9 : 1 / 0.9)));
    cam.x = before.x - (p.x - cam.ax) / cam.zoom;
    cam.y = before.y + (p.y - cam.ay) / cam.zoom;
    renderField();
  };
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Enter') finishPoly();
    if (e.key === 'Escape') {
      pending = [];
      draw();
    }
    if (e.key === 'z' || e.key === 'Z') doUndo();
  });

  setTool('pan');
  changed();
  frame();
}
