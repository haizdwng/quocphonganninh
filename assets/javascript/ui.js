// Lớp bổ trợ giao diện: phân loại toast, biến thể modal, màu theme.
// Không đụng tới logic của app.js — chỉ quan sát DOM và gắn thuộc tính để CSS xử lý.

const THEME_COLOR = '#0c0f14';
const $ = (id) => document.getElementById(id);

const themeMeta = document.querySelector('meta[name="theme-color"]');
if (themeMeta) themeMeta.content = THEME_COLOR;

/* ---------- Toast ---------- */

const TOAST_RULES = [
  ['error', /^(Không|Tệp|Cần |Hãy |Nhập |Câu hỏi không|Đáp án đúng không|Trình duyệt hạn)/],
  ['warning', /^(Hết giờ|Chỉ còn|Còn \d|Đã hết|Đã tạm dừng|Trình duyệt này)/],
  ['success', /^(Đã |Bạn đã chọn đủ)/]
];

function classifyToast(text) {
  for (const [type, pattern] of TOAST_RULES) if (pattern.test(text)) return type;
  return 'info';
}

const toastEl = $('toast');
if (toastEl) {
  toastEl.addEventListener('click', () => { toastEl.hidden = true; });
  new MutationObserver(() => {
    if (toastEl.hidden) return;
    toastEl.dataset.type = classifyToast((toastEl.textContent || '').trim());
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
  }).observe(toastEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

/* ---------- Modal ---------- */

const modal = $('modal');
if (modal) {
  const box = modal.querySelector('.modal-box');
  const title = $('modal-title');
  const ok = $('modal-ok');
  const icon = document.createElement('span');
  icon.className = 'modal-icon';
  icon.setAttribute('aria-hidden', 'true');
  box.prepend(icon);

  const VARIANTS = [
    ['danger', /^(Xóa|Bỏ phiên)/, 'trash'],
    ['warning', /^(Thoát|Làm lại|Khôi phục|Còn câu)/, 'alert-circle']
  ];

  const applyVariant = () => {
    const text = (title.textContent || '').trim();
    const match = VARIANTS.find(([, pattern]) => pattern.test(text));
    const variant = match ? match[0] : 'primary';
    box.dataset.variant = variant;
    icon.dataset.icon = match ? match[2] : 'check';
    ok.classList.toggle('btn-danger', variant === 'danger');
    ok.classList.toggle('btn-primary', variant !== 'danger');
  };

  new MutationObserver(() => { if (!modal.hidden) applyVariant(); })
    .observe(modal, { attributes: true, attributeFilter: ['hidden', 'class'] });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) $('modal-cancel')?.click();
  });
}
