const frame = document.querySelector('#guidance-demo-frame');
const toggle = document.querySelector('#guidance-demo-toggle');
const status = document.querySelector('#guidance-demo-status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ready = false;
let playing = !reducedMotion.matches;
let elapsed = 0;
let last = 0;
const duration = 78;

function paint() {
  if (!ready || !frame.contentWindow?.renderDemo) return;
  const state = frame.contentWindow.renderDemo(0, elapsed);
  status.textContent = `${state?.agent || 'Codex'} · ${state?.phase || 'Getting started'}`;
  toggle.textContent = playing ? 'Pause demo' : elapsed >= duration ? 'Replay demo' : 'Play demo';
  toggle.setAttribute('aria-pressed', String(!playing));
}

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.data?.type !== 'minaco-demo-ready') return;
  ready = true;
  paint();
});

toggle.addEventListener('click', () => {
  if (elapsed >= duration) elapsed = 0;
  playing = !playing;
  paint();
});

reducedMotion.addEventListener('change', (event) => {
  if (event.matches) playing = false;
  paint();
});

function tick(now) {
  if (last && playing && ready && !document.hidden) {
    elapsed = Math.min(duration, elapsed + (now - last) / 1000);
    if (elapsed >= duration) playing = false;
    paint();
  }
  last = now;
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
