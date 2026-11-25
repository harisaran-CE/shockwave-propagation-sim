(() => {
  'use strict';
  const landing = document.getElementById('flowlineLanding');
  const app = document.getElementById('flowlineApp');
  if (!landing || !app) return;

  const enterBtns = ['landingEnter', 'landingLaunch', 'landingEnterBottom', 'landingDockEnter']
    .map((id) => document.getElementById(id)).filter(Boolean);
  const clock = document.getElementById('landingClock');
  const diagState = document.getElementById('landingDiagState');

  function showApp(pushHash) {
    landing.hidden = true;
    landing.setAttribute('aria-hidden', 'true');
    app.hidden = false;
    app.removeAttribute('aria-hidden');
    document.body.classList.add('workstation-active');
    if (pushHash) {
      try { history.replaceState(null, '', '#workstation'); } catch (_) { location.hash = '#workstation'; }
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      window.flowline3d?.syncToPanelVisibility?.();
    });
  }

  function showLanding() {
    app.hidden = true;
    app.setAttribute('aria-hidden', 'true');
    landing.hidden = false;
    landing.removeAttribute('aria-hidden');
    document.body.classList.remove('workstation-active');
  }

  enterBtns.forEach((btn) => btn.addEventListener('click', () => showApp(true)));
  document.querySelectorAll('[data-landing-top]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); landing.scrollTo({ top: 0, behavior: 'smooth' }); });
  });

  if (location.hash === '#workstation') showApp(false);
  else showLanding();

  function tickClock() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    if (clock) clock.textContent = `SYS ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} LOCAL`;
  }
  tickClock();
  setInterval(tickClock, 1000);
  if (diagState) diagState.textContent = 'READY';

  // Subtle canvas plume/grid accent, self-contained (no ThreeUI dependency).
  const canvas = document.getElementById('landingPlume');
  const ctx = canvas?.getContext('2d', { alpha: true });
  if (!canvas || !ctx) return;
  let w = 0, h = 0, dpr = 1, raf = 0, t0 = performance.now();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function draw(now) {
    resize();
    ctx.clearRect(0, 0, w, h);
    const t = (now - t0) / 1000;
    ctx.save();
    ctx.globalAlpha = 0.9;
    // faint horizon lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1 * dpr;
    for (let i = 0; i < 8; i++) {
      const y = h * (0.52 + i * 0.055);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // plume
    const cx = w * 0.72, baseY = h * 0.85;
    for (let i = 0; i < 42; i++) {
      const p = i / 41;
      const amp = (1 - p) * w * 0.11;
      const y = baseY - p * h * 0.42;
      const x = cx + Math.sin(p * 5.2 + t * 0.7) * amp * 0.35 + Math.sin(t * 0.22) * 10 * dpr;
      const r = (1 - p) * 90 * dpr + 20 * dpr;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,90,16,${0.055 * (1 - p)})`);
      g.addColorStop(0.5, `rgba(255,140,60,${0.02 * (1 - p)})`);
      g.addColorStop(1, 'rgba(255,90,16,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (!reduced && !landing.hidden) raf = requestAnimationFrame(draw);
  }
  function start() { cancelAnimationFrame(raf); resize(); draw(performance.now()); }
  start();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !landing.hidden) start(); });
  window.addEventListener('resize', () => { if (!landing.hidden) draw(performance.now()); }, { passive: true });
})();
