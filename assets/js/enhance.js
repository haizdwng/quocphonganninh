let touchStart = null;

export function initEnhance({ onPrev, onNext }) {
  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || document.body.dataset.screen !== 'quiz') {
      touchStart = null;
      return;
    };
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('button:not(.option), input, textarea, select, a, .highlight-toolbar')) {
      touchStart = null;
      return;
    };
    const touch = event.touches[0];
    touchStart = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (!touchStart || document.body.dataset.screen !== 'quiz' || event.changedTouches.length !== 1) {
      touchStart = null;
      return;
    };
    const start = touchStart;
    touchStart = null;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    if (Date.now() - start.time > 800 || Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    event.preventDefault();
    if (dx < 0) onNext();
    else onPrev();
  }, { passive: false });

  document.addEventListener('touchcancel', () => {
    touchStart = null;
  }, { passive: true });
};
