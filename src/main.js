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

function buildFilter(defsId, filterId, w, h, radius, clampedBezel, glassThick, ior, scaleRatio, blurAmt, specOpacity, specSat, surfaceKey, specAngle) {
  const heightFn = SURFACE_FNS[surfaceKey || 'convex_squircle'];
  const profile = calculateRefractionProfile(glassThick, clampedBezel, heightFn, ior, 128);
  const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
  const dispUrl = generateDisplacementMap(w, h, radius, clampedBezel, profile, maxDisp);
  const specUrl = generateSpecularMap(w, h, radius, clampedBezel * 2.5, specAngle);
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
function scheduleRebuild() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(rebuildFilter, 30);
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
    document.body.style.background = `url('${url}') center/cover no-repeat`;
    thumbEls.forEach(t => t.el.classList.toggle('active', t.url === url));
    canvasBg.onload = () => allButtons.forEach(b => { b.buildDispMap(); b.render(); });
    canvasBg.src = url;
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

// ── Canvas glass buttons (works in all browsers including Safari) ─────────────
const canvasBg = new Image();
canvasBg.crossOrigin = 'anonymous';

const allButtons = [];

function createButton(bgImg, { elementId, W, H, R, label, initX, initY }) {
  const canvas = document.getElementById(elementId);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.style.left   = initX + 'px';
  canvas.style.top    = initY + 'px';
  ctx.scale(dpr, dpr);

  let dispMap = null;
  const edgeReflectDist = 8;

  function buildDispMap() {
    const PW = W * dpr, PH = H * dpr, PR = R * dpr;
    const bezel   = Math.min(26 * dpr, PR - 1);
    const S       = 128;
    const profile = calculateRefractionProfile(200, bezel, SURFACE_FNS.convex_squircle, 3.0, S);
    const maxD    = Math.max(...Array.from(profile).map(Math.abs)) || 1;
    const SCALE   = 56 * dpr;
    dispMap = new Float32Array(PW * PH * 2);
    for (let py = 0; py < PH; py++) {
      for (let px = 0; px < PW; px++) {
        const cx       = Math.max(PR, Math.min(PW - PR, px));
        const cy       = Math.max(PR, Math.min(PH - PR, py));
        const dx       = px - cx, dy = py - cy;
        const dist     = Math.sqrt(dx * dx + dy * dy);
        const fromEdge = PR - dist;
        if (fromEdge <= 0 || fromEdge > bezel || dist === 0) continue;
        const bi   = Math.min((fromEdge / bezel * S) | 0, S - 1);
        const disp = profile[bi] || 0;
        const cos  = dx / dist, sin = dy / dist;
        const mi = (py * PW + px) * 2;
        dispMap[mi]     = -cos * disp / maxD * SCALE;
        dispMap[mi + 1] = -sin * disp / maxD * SCALE;
      }
    }
  }

  function pillPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arc(x + w - r, y + r,     r, -Math.PI / 2, 0);
    c.lineTo(x + w, y + h - r);
    c.arc(x + w - r, y + h - r, r, 0,            Math.PI / 2);
    c.lineTo(x + r, y + h);
    c.arc(x + r,     y + h - r, r, Math.PI / 2,  Math.PI);
    c.lineTo(x, y + r);
    c.arc(x + r,     y + r,     r, Math.PI,      -Math.PI / 2);
    c.closePath();
  }

  function render(hoverT) {
    if (!bgImg.complete || !bgImg.naturalWidth || !dispMap) return;
    const rect  = canvas.getBoundingClientRect();
    const vW    = innerWidth, vH = innerHeight;
    const sc    = Math.max(vW / bgImg.naturalWidth, vH / bgImg.naturalHeight);
    const cropX = (bgImg.naturalWidth  * sc - vW) / 2;
    const cropY = (bgImg.naturalHeight * sc - vH) / 2;
    const PW = W * dpr, PH = H * dpr;
    const MAR    = 48;
    const MAR_PX = Math.round(MAR * dpr);
    const EW     = PW + 2 * MAR_PX;
    const EH     = PH + 2 * MAR_PX;
    const srcXe  = (rect.left - MAR + cropX) / sc;
    const srcYe  = (rect.top  - MAR + cropY) / sc;
    const srcWe  = (W + 2 * MAR) / sc;
    const srcHe  = (H + 2 * MAR) / sc;
    const tmp  = document.createElement('canvas');
    tmp.width  = EW; tmp.height = EH;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(bgImg, srcXe, srcYe, srcWe, srcHe, 0, 0, EW, EH);
    const srcPx = tCtx.getImageData(0, 0, EW, EH).data;
    const out  = document.createElement('canvas');
    out.width  = PW; out.height = PH;
    const oCtx = out.getContext('2d');
    const imgD = oCtx.createImageData(PW, PH);
    const dst  = imgD.data;
    for (let py = 0; py < PH; py++) {
      for (let px = 0; px < PW; px++) {
        const PR  = R * dpr;
        const cx  = Math.max(PR, Math.min(PW - PR, px));
        const cy2 = Math.max(PR, Math.min(PH - PR, py));
        const ddx = px - cx, ddy = py - cy2;
        if (ddx * ddx + ddy * ddy > (PR + 0.5) * (PR + 0.5)) continue;
        const mi = (py * PW + px) * 2;
        const sx = Math.round(Math.max(0, Math.min(EW - 1, px + MAR_PX + dispMap[mi])));
        const sy = Math.round(Math.max(0, Math.min(EH - 1, py + MAR_PX + dispMap[mi + 1])));
        const si = (sy * EW + sx) * 4;
        const di = (py * PW + px) * 4;
        dst[di]     = srcPx[si];
        dst[di + 1] = srcPx[si + 1];
        dst[di + 2] = srcPx[si + 2];
        dst[di + 3] = 255;
        const ddist      = Math.sqrt(ddx * ddx + ddy * ddy);
        const fromEdgePx = PR - ddist;
        if (ddist > 0 && fromEdgePx >= 0 && fromEdgePx < edgeReflectDist * dpr) {
          const reflT = 1.0 - fromEdgePx / (edgeReflectDist * dpr);
          const ncx   = ddx / ddist, ncy = ddy / ddist;
          const outX  = Math.round(Math.max(0, Math.min(EW - 1, cx  + ncx * (PR + 4 * dpr) + MAR_PX)));
          const outY  = Math.round(Math.max(0, Math.min(EH - 1, cy2 + ncy * (PR + 4 * dpr) + MAR_PX)));
          const rsi   = (outY * EW + outX) * 4;
          const alpha = reflT * 0.85;
          dst[di]     = dst[di]     * (1 - alpha) + srcPx[rsi]     * alpha;
          dst[di + 1] = dst[di + 1] * (1 - alpha) + srcPx[rsi + 1] * alpha;
          dst[di + 2] = dst[di + 2] * (1 - alpha) + srcPx[rsi + 2] * alpha;
        }
      }
    }
    oCtx.putImageData(imgD, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    pillPath(ctx, 0, 0, W, H, R);
    ctx.clip();
    ctx.drawImage(out, 0, 0, PW, PH, 0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, W, H);
    const sAngle = 3 * Math.PI / 4 - hoverT * (Math.PI / 2);
    const specC  = document.createElement('canvas');
    specC.width  = PW; specC.height = PH;
    const sCtx2  = specC.getContext('2d');
    const sImgD  = sCtx2.createImageData(PW, PH);
    const sd     = sImgD.data;
    const PR_sp  = R * dpr;
    const RIM    = 5 * dpr;
    const halfW  = (PW - 2 * PR_sp) / 2;
    const halfH  = (PH - 2 * PR_sp) / 2;
    const cxBtn  = PW / 2, cyBtn = PH / 2;
    for (let spy = 0; spy < PH; spy++) {
      for (let spx = 0; spx < PW; spx++) {
        const cxs = Math.max(PR_sp, Math.min(PW - PR_sp, spx));
        const cys = Math.max(PR_sp, Math.min(PH - PR_sp, spy));
        const dxs = spx - cxs, dys = spy - cys;
        const dSq = dxs * dxs + dys * dys;
        if (dSq < 1) continue;
        const ds       = Math.sqrt(dSq);
        const fromEdge = PR_sp - ds;
        if (fromEdge < 0 || fromEdge > RIM) continue;
        const t    = fromEdge / RIM;
        const edge = Math.sqrt(Math.max(0, 1 - t * t));
        const a   = Math.atan2(-(spy - cyBtn), spx - cxBtn);
        const dot = Math.abs(Math.cos(a - sAngle));
        let midFade = 1;
        if (dxs === 0 && halfW > 0) {
          const d = Math.min(spx - PR_sp, PW - PR_sp - spx) / halfW;
          midFade = Math.max(0, 1 - d);
        } else if (dys === 0 && halfH > 0) {
          const d = Math.min(spy - PR_sp, PH - PR_sp - spy) / halfH;
          midFade = Math.max(0, 1 - d);
        }
        const coeff = dot * edge * midFade;
        const col   = (180 * coeff) | 0;
        const si    = (spy * PW + spx) * 4;
        sd[si] = col; sd[si+1] = col; sd[si+2] = col;
        sd[si+3] = (col * coeff) | 0;
      }
    }
    sCtx2.putImageData(sImgD, 0, 0);
    ctx.save();
    ctx.filter = 'blur(1px)';
    ctx.drawImage(specC, 0, 0, PW, PH, 0, 0, W, H);
    ctx.restore();
    ctx.restore();
    ctx.save();
    pillPath(ctx, 0.5, 0.5, W - 1, H - 1, R - 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font          = `500 ${Math.round(H * 0.31)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle     = 'rgba(255,255,255,0.92)';
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.shadowColor   = 'rgba(0,0,0,0.3)';
    ctx.shadowOffsetY = 1.5;
    ctx.shadowBlur    = 2;
    ctx.fillText(label, W / 2, H / 2 + 0.5);
    ctx.restore();
  }

  let hoverT = 0, animId = null;
  function animateTo(target, dur) {
    cancelAnimationFrame(animId);
    const start = hoverT, diff = target - start;
    let t0 = null;
    (function tick(ts) {
      if (!t0) t0 = ts;
      const t = Math.min((ts - t0) / (dur || 400), 1);
      hoverT = start + diff * (t < 0.5 ? 2*t*t : -1+(4-2*t)*t);
      render(hoverT);
      if (t < 1) animId = requestAnimationFrame(tick);
    })(performance.now());
  }

  canvas.addEventListener('mouseenter', () => { if (!dragging) animateTo(1, 500); });
  canvas.addEventListener('mouseleave', () => animateTo(0, 400));

  let dragging = false, ox = 0, oy = 0;
  canvas.addEventListener('mousedown', e => {
    dragging = true;
    const b = canvas.getBoundingClientRect();
    ox = e.clientX - b.left; oy = e.clientY - b.top;
    canvas.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    canvas.style.left = (e.clientX - ox) + 'px';
    canvas.style.top  = (e.clientY - oy) + 'px';
    render(hoverT);
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
  });

  return { buildDispMap, render: () => render(hoverT) };
}

// Create buttons — positioned relative to viewport centre
{
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;

  allButtons.push(createButton(canvasBg, {
    elementId: 'generate-btn',
    W: 220, H: 220, R: 28, label: 'Generate',
    initX: cx - 110, initY: cy - 150,
  }));

  allButtons.push(createButton(canvasBg, {
    elementId: 'home-btn',
    W: 120, H: 48, R: 24, label: 'Home',
    initX: cx - 60, initY: cy + 90,
  }));

  canvasBg.onload = () => {
    allButtons.forEach(b => { b.buildDispMap(); b.render(); });
  };
  canvasBg.src = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2000&auto=format&fit=crop';
}
