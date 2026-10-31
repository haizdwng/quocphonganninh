let touchStartCoordinates = null;

function syncFixedBarHeights() {
  const targets = [
    ['#screen-quiz .progress-wrap', '--quiz-top-height'],
    ['#screen-exam .progress-wrap', '--exam-top-height']
  ];
  const root = document.documentElement;
  for (const [selector, property] of targets) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const update = () => {
      const height = element.offsetHeight;
      if (height > 0) root.style.setProperty(property, height + 'px');
    };
    update();
    if ('ResizeObserver' in window) new ResizeObserver(update).observe(element);
    else window.addEventListener('resize', update);
  };
};

export function initializeEnhancements({ onPrev, onNext }) {
  syncFixedBarHeights();
  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || document.body.dataset.screen !== 'quiz') {
      touchStartCoordinates = null;
      return;
    };
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('button:not(.answer-option), input, textarea, select, a, .highlight-toolbar')) {
      touchStartCoordinates = null;
      return;
    };
    const touch = event.touches[0];
    touchStartCoordinates = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (!touchStartCoordinates || document.body.dataset.screen !== 'quiz' || event.changedTouches.length !== 1) {
      touchStartCoordinates = null;
      return;
    };
    const start = touchStartCoordinates;
    touchStartCoordinates = null;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    if (Date.now() - start.time > 800 || Math.abs(deltaX) < 65 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    event.preventDefault();
    if (deltaX < 0) onNext();
    else onPrev();
  }, { passive: false });

  document.addEventListener('touchcancel', () => {
    touchStartCoordinates = null;
  }, { passive: true });
};