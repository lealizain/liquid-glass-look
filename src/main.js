import './style.css';

// ── Physics (archisvaze's exact code) ────────────────────────────────────────
const SURFACE_FNS = {
  convex_squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
  convex_circle:   (x) => Math.sqrt(1 - (1 - x) * (1 - x)),
  concave:         (x) => 1 - Math.sqrt(1 - (1 - x) * (1 - x)),
  lip: (x) => {
    const convex  = Math.pow(1 - Math.pow(1 - Math.min(x * 2, 1), 4), 0.25);
    const concave = 1 - Math.sqrt(1 - (1 - x) * (1 - x)) + 0.1;
    const t = 6*x**5 - 15*x**4 + 10*x**3;
    return convex * (1 - t) + concave * t;
  },
};

function calculateRefractionProfile(glassThickness, bezelWidth, heightFn, ior, samples) {
  samples = samples || 128;
  const eta = 1 / ior;
  function refract(nx, ny) {
    const dot = ny, k = 1 - eta*eta*(1 - dot*dot);
    if (k < 0) return null;
    const sq = Math.sqrt(k);
    return [-(eta*dot + sq)*nx, eta - (eta*dot + sq)*ny];
  }
  const profile = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = i / samples;
    const y = heightFn(x);
    const dx = x < 1 ? 0.0001 : -0.0001;
    const y2 = heightFn(x + dx);
    const deriv = (y2 - y) / dx;
    const mag = Math.sqrt(deriv*deriv + 1);
    const ref = refract(-deriv/mag, -1/mag);
    if (!ref) { profile[i] = 0; continue; }
    profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / ref[1]);
  }
  return profile;
}

function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i]=128; d[i+1]=128; d[i+2]=0; d[i+3]=255; }
  const r=radius, rSq=r*r, r1Sq=(r+1)**2;
  const rBSq = Math.max(r - bezelWidth, 0)**2;
  const wB=w-r*2, hB=h-r*2, S=profile.length;
  for (let y1=0; y1<h; y1++) {
    for (let x1=0; x1<w; x1++) {
      const x = x1<r ? x1-r : x1>=w-r ? x1-r-wB : 0;
      const y = y1<r ? y1-r : y1>=h-r ? y1-r-hB : 0;
      const dSq = x*x + y*y;
      if (dSq>r1Sq || dSq<rBSq) continue;
      const dist = Math.sqrt(dSq);
      const fromSide = r - dist;
      const op = dSq<rSq ? 1 : 1-(dist-Math.sqrt(rSq))/(Math.sqrt(r1Sq)-Math.sqrt(rSq));
      if (op<=0 || dist===0) continue;
      const cos=x/dist, sin=y/dist;
      const bi = Math.min(((fromSide/bezelWidth)*S)|0, S-1);
      const disp = profile[bi] || 0;
      const dX=(-cos*disp)/maxDisp, dY=(-sin*disp)/maxDisp;
      const idx=(y1*w+x1)*4;
      d[idx]   = (128 + dX*127*op + 0.5)|0;
      d[idx+1] = (128 + dY*127*op + 0.5)|0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function generateSpecularMap(w, h, radius, bezelWidth, angle) {
  angle = angle != null ? angle : Math.PI/3;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  d.fill(0);
  const r=radius, rSq=r*r, r1Sq=(r+1)**2;
  const rBSq = Math.max(r - bezelWidth, 0)**2;
  const wB=w-r*2, hB=h-r*2;
  const sv=[Math.cos(angle), Math.sin(angle)];
  for (let y1=0; y1<h; y1++) {
    for (let x1=0; x1<w; x1++) {
      const x = x1<r ? x1-r : x1>=w-r ? x1-r-wB : 0;
      const y = y1<r ? y1-r : y1>=h-r ? y1-r-hB : 0;
      const dSq = x*x + y*y;
      if (dSq>r1Sq || dSq<rBSq) continue;
      const dist = Math.sqrt(dSq);
      const fromSide = r - dist;
      const op = dSq<rSq ? 1 : 1-(dist-Math.sqrt(rSq))/(Math.sqrt(r1Sq)-Math.sqrt(rSq));
      if (op<=0 || dist===0) continue;
      const cos=x/dist, sin=-y/dist;
      const dot = Math.abs(cos*sv[0] + sin*sv[1]);
      const edge = Math.sqrt(Math.max(0, 1-(1-fromSide)**2));
      const coeff = dot * edge;
      const col = (255*coeff)|0;
      const alpha = (col*coeff*op)|0;
      const idx=(y1*w+x1)*4;
      d[idx]=col; d[idx+1]=col; d[idx+2]=col; d[idx+3]=alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function buildFilter(defsId, filterId, w, h, radius, clampedBezel, glassThick, ior, scaleRatio, blurAmt, specOpacity, specSat, surfaceKey) {
  const heightFn = SURFACE_FNS[surfaceKey || 'convex_squircle'];
  const profile = calculateRefractionProfile(glassThick, clampedBezel, heightFn, ior, 128);
  const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
  const dispUrl = generateDisplacementMap(w, h, radius, clampedBezel, profile, maxDisp);
  const specUrl = generateSpecularMap(w, h, radius, clampedBezel * 2.5);
  const scale = maxDisp * scaleRatio;
  document.getElementById(defsId).innerHTML = `
    <filter id="${filterId}" x="0%" y="0%" width="100%" height="100%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blurAmt}" result="blurred_source"/>
      <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp_map"/>
      <feDisplacementMap in="blurred_source" in2="disp_map"
        scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
      <feColorMatrix in="displaced" type="saturate" values="${specSat}" result="displaced_sat"/>
      <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="spec_layer"/>
      <feComposite in="displaced_sat" in2="spec_layer" operator="in" result="spec_masked"/>
      <feComponentTransfer in="spec_layer" result="spec_faded">
        <feFuncA type="linear" slope="${specOpacity}"/>
      </feComponentTransfer>
      <feBlend in="spec_masked" in2="displaced" mode="normal" result="with_sat"/>
      <feBlend in="spec_faded" in2="with_sat" mode="normal"/>
    </filter>`;
}

// ── Archisvaze glass panel ────────────────────────────────────────────────────
const glass = document.getElementById('glass');

function rebuildFilter() {
  const w = glass.offsetWidth, h = glass.offsetHeight;
  if (w < 2 || h < 2) return;
  const surfaceKey  = document.getElementById('surface-fn').value;
  const glassThick  = +document.getElementById('glass-thickness').value;
  const bezelW      = +document.getElementById('bezel-width').value;
  const ior         = +document.getElementById('refractive-index').value;
  const scaleRatio  = +document.getElementById('scale-ratio').value;
  const blurAmt     = +document.getElementById('blur-amount').value;
  const specOpacity = +document.getElementById('specular-opacity').value;
  const specSat     = +document.getElementById('specular-saturation').value;
  const radius      = +document.getElementById('border-radius').value;
  const clampedBezel = Math.min(bezelW, radius - 1, Math.min(w, h) / 2 - 1);
  buildFilter('svg-defs', 'liquid-glass-filter', w, h, radius, clampedBezel, glassThick, ior, scaleRatio, blurAmt, specOpacity, specSat, surfaceKey);
}

function hexToRgb(hex) {
  return `${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)}`;
}

function updateCSS() {
  const root = document.documentElement.style;
  const gs = glass.style;
  gs.width  = +document.getElementById('glass-width').value  + 'px';
  gs.height = +document.getElementById('glass-height').value + 'px';
  root.setProperty('--glass-radius', +document.getElementById('border-radius').value + 'px');
  root.setProperty('--shadow-color',  document.getElementById('shadow-color').value);
  root.setProperty('--shadow-blur',   +document.getElementById('shadow-blur').value  + 'px');
  root.setProperty('--shadow-spread', +document.getElementById('shadow-spread').value + 'px');
  root.setProperty('--tint-color',    hexToRgb(document.getElementById('tint-color').value));
  root.setProperty('--tint-opacity',  (+document.getElementById('tint-opacity').value / 100).toFixed(3));
  root.setProperty('--outer-shadow-blur', +document.getElementById('outer-shadow-blur').value + 'px');
}

const FILTER_CTRLS = [
  ['glass-thickness',    (v) => Math.round(v)],
  ['bezel-width',        (v) => Math.round(v)],
  ['refractive-index',   (v) => (+v).toFixed(2)],
  ['scale-ratio',        (v) => (+v).toFixed(2)],
  ['blur-amount',        (v) => (+v).toFixed(1)],
  ['specular-opacity',   (v) => (+v).toFixed(2)],
  ['specular-saturation',(v) => Math.round(v)],
];
const CSS_CTRLS = [
  ['glass-width',      (v) => Math.round(v)],
  ['glass-height',     (v) => Math.round(v)],
  ['border-radius',    (v) => Math.round(v)],
  ['shadow-blur',      (v) => Math.round(v)],
  ['shadow-spread',    (v) => Math.round(v)],
  ['tint-opacity',     (v) => Math.round(v) + '%'],
  ['outer-shadow-blur',(v) => Math.round(v)],
];
const REBUILD_ON_CSS = new Set(['glass-width', 'glass-height', 'border-radius']);

let filterTimer;
let rebuildGenerateFilter = null;
function scheduleRebuild() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    rebuildFilter();
    if (rebuildGenerateFilter) rebuildGenerateFilter();
  }, 30);
}

FILTER_CTRLS.forEach(([id, fmt]) => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    document.getElementById(id + '-val').textContent = fmt(el.value);
    scheduleRebuild();
  });
});
CSS_CTRLS.forEach(([id, fmt]) => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const valEl = document.getElementById(id + '-val');
    if (valEl) valEl.textContent = fmt(el.value);
    updateCSS();
    if (REBUILD_ON_CSS.has(id)) scheduleRebuild();
  });
});
['shadow-color', 'tint-color'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateCSS);
});
document.getElementById('surface-fn').addEventListener('change', scheduleRebuild);

window.addEventListener('DOMContentLoaded', () => {
  updateCSS();
  requestAnimationFrame(() => requestAnimationFrame(rebuildFilter));
});
window.addEventListener('resize', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(rebuildFilter, 150);
});

// Glass drag (archisvaze's exact drag code)
glass.style.left = innerWidth  / 2 - 150 + 'px';
glass.style.top  = innerHeight / 2 - 100 + 'px';
{
  let sx, sy;
  glass.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sx = e.clientX; sy = e.clientY;
    document.addEventListener('pointermove', onGlassMove);
    document.addEventListener('pointerup', () => document.removeEventListener('pointermove', onGlassMove), { once: true });
  });
  function onGlassMove(e) {
    e.preventDefault();
    glass.style.left = glass.offsetLeft + e.clientX - sx + 'px';
    glass.style.top  = glass.offsetTop  + e.clientY - sy + 'px';
    sx = e.clientX; sy = e.clientY;
  }
}

// Controls panel toggle
{
  const panel  = document.getElementById('controls');
  const toggle = document.getElementById('panel-toggle');
  const closeBtn = document.getElementById('panel-close');
  toggle.addEventListener('click',   () => { panel.classList.add('open');    toggle.classList.add('hidden'); });
  closeBtn.addEventListener('click', () => { panel.classList.remove('open'); toggle.classList.remove('hidden'); });
}

// ── Background picker ────────────────────────────────────────────────────────
{
  const DEFAULT_URL = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2000&auto=format&fit=crop';
  let currentUrl = DEFAULT_URL;
  const thumbEls = [];

  function applyBg(url) {
    currentUrl = url;
    document.body.style.background = `url('${url}') center/cover no-repeat`;
    thumbEls.forEach(t => t.el.classList.toggle('active', t.url === url));
  }

  const container = document.getElementById('bg-picker');
  if (container) {
    const grid = document.createElement('div');
    grid.className = 'bg-thumbs';

    const TEMPLATES = [
      { label: 'Interior', url: DEFAULT_URL },
    ];
    TEMPLATES.forEach(tmpl => {
      const img = document.createElement('img');
      img.className = 'bg-thumb';
      img.src = tmpl.url; img.alt = tmpl.label; img.draggable = false;
      img.addEventListener('click', () => applyBg(tmpl.url));
      img.addEventListener('error', () => { img.style.display = 'none'; });
      grid.appendChild(img);
      thumbEls.push({ el: img, url: tmpl.url });
    });
    container.appendChild(grid);

    const row = document.createElement('div');
    row.className = 'bg-url-row';
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'Paste image URL…';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'bg-btn'; loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => {
      const url = input.value.trim();
      if (url) { applyBg(url); input.value = ''; }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') loadBtn.click(); });
    const resetBtn = document.createElement('button');
    resetBtn.className = 'bg-btn reset'; resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => { applyBg(DEFAULT_URL); input.value = ''; });
    row.appendChild(input); row.appendChild(loadBtn); row.appendChild(resetBtn);
    container.appendChild(row);

    applyBg(DEFAULT_URL);
  }
}

// ── Generate button glass (same params as archisvaze glass panel) ────────────
{
  function buildGenerateFilter(btn) {
    const w = btn.offsetWidth, h = btn.offsetHeight;
    if (w < 2 || h < 2) return;
    const minDim = Math.min(w, h);
    const radius = Math.round(h / 2);
    // Same proportional bezel as archisvaze (60px bezel on 200px min-dim ≈ 30%)
    const bezelW = Math.round(minDim * 0.30);
    const clampedBezel = Math.min(bezelW, radius - 1, minDim / 2 - 1);
    // Read all appearance params from the shared controls panel
    const glassT     = +document.getElementById('glass-thickness').value;
    const ior        = +document.getElementById('refractive-index').value;
    const scaleRatio = +document.getElementById('scale-ratio').value;
    const blurAmt    = +document.getElementById('blur-amount').value;
    const specOp     = +document.getElementById('specular-opacity').value;
    const specSat    = +document.getElementById('specular-saturation').value;
    const surface    = document.getElementById('surface-fn').value;
    buildFilter('btn-defs', 'btn-glass-filter', w, h, radius, clampedBezel, glassT, ior, scaleRatio, blurAmt, specOp, specSat, surface);
  }

  const isChrome = navigator.userAgentData
    ? navigator.userAgentData.brands.some(b => b.brand === 'Google Chrome')
    : /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  if (isChrome) {
    const btn = document.querySelector('.button-wrap button');
    btn.classList.add('glass-main');
    rebuildGenerateFilter = () => buildGenerateFilter(btn);
    new ResizeObserver(rebuildGenerateFilter).observe(btn);
  }
}

// ── Generate button drag ──────────────────────────────────────────────────────
{
  const el = document.querySelector('.button-wrap');
  let cx = window.innerWidth * 0.5, cy = window.innerHeight * 0.6;
  el.style.left = cx + 'px'; el.style.top = cy + 'px';
  el.style.transform = 'translate(-50%, -50%)';

  let pid=-1, sx=0, sy=0, scx=0, scy=0, dragging=false;
  el.addEventListener('pointerdown', e => {
    pid=e.pointerId; sx=e.clientX; sy=e.clientY; scx=cx; scy=cy; dragging=false;
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId!==pid) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    if (!dragging) { if (Math.hypot(dx,dy)<6) return; dragging=true; el.setPointerCapture(pid); el.style.cursor='grabbing'; }
    const HW=el.offsetWidth/2, HH=el.offsetHeight/2;
    cx=Math.max(HW,Math.min(window.innerWidth-HW,scx+dx));
    cy=Math.max(HH,Math.min(window.innerHeight-HH,scy+dy));
    el.style.left=cx+'px'; el.style.top=cy+'px';
  });
  const onUp=e=>{if(e.pointerId!==pid)return;pid=-1;dragging=false;el.style.cursor='grab';};
  el.addEventListener('pointerup',onUp);
  el.addEventListener('pointercancel',onUp);
}
