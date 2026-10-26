import {
  getSettings,
  saveSettings,
  getBankSettings,
  saveBankSettings,
  getDeckProgress,
  saveDeckProgress,
  getSession,
  saveSession,
  clearSession,
  resetDeckProgress,
  markWrong,
  markPracticed,
  addCompleted,
  setSequentialCursor,
  getWrongIndices,
  getRangeWrongIndices,
  addWrongIndicesForRange,
  getBookmarkedIndices,
  toggleBookmark,
  exportBackup,
  importBackup,
  storageAvailable,
  getQuestionHighlights,
  saveQuestionHighlights,
  resetDeckHighlights,
} from "./storage.js";
import { initEnhance } from "./enhance.js";
import {
  fingerprintQuestions,
  normalizeQuestions,
  createSessionItems,
  pickSequential,
  findNextUncompletedQuestion,
  pickRandom,
  pickWrong,
  isAnswerCorrect,
  displayedCorrectIndex,
} from "./quiz.js";

const DECKS = {
  quocphong1: {
    id: "quocphong1",
    label: "Quốc Phòng 1",
    file: "data/quocphong1.json",
  },
  quocphong2: {
    id: "quocphong2",
    label: "Quốc Phòng 2",
    file: "data/quocphong2.json",
  },
};

const state = {
  decks: { quocphong1: null, quocphong2: null },
  fingerprints: { quocphong1: "", quocphong2: "" },
  legacyFingerprintMatched: { quocphong1: false, quocphong2: false },
  loading: true,
  error: null,
  currentDeck: "quocphong1",
  bankDeck: "quocphong1",
  bankPracticeMode: "practice",
  mode: "setup",
  practiceMode: "practice",
  session: null,
  reviewMode: false,
  timerInterval: null,
  examFilter: "all",
  examSubmitting: false,
  reviewSelectedIndices: new Set(),
  reviewVirtual: null,
  _lastSummarySession: null,
  _lastSummaryWrongIndices: [],
  _lastSummaryRangeStart: null,
  _lastSummaryRangeEnd: null,
  _lastSummaryCount: null,
  highlightEditMode: false,
  lastTextSelection: null,
};

const REVIEW_VIRTUAL_OVERSCAN = 3;
const REVIEW_VIRTUAL_ESTIMATED_HEIGHT = 240;
const REVIEW_VIRTUAL_POOL_SIZE = 14;

const $ = (id) => document.getElementById(id);

function dataUrl(rel) {
  return new URL(rel, document.baseURI).href;
}

async function loadDeck(id) {
  const meta = DECKS[id];
  const url = dataUrl(meta.file);
  let res;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch {
    throw new Error(
      `Không thể tải ${meta.label}. Hãy kiểm tra kết nối mạng hoặc mở trang trực tuyến ít nhất một lần để lưu dữ liệu ngoại tuyến.`,
    );
  }
  if (!res.ok)
    throw new Error(
      `Không tải được ${meta.label} (${res.status}). Hãy kiểm tra vị trí tệp dữ liệu.`,
    );
  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new Error(`Tệp dữ liệu ${meta.file} không hợp lệ.`);
  }
  const questions = normalizeQuestions(raw);
  const fp = fingerprintQuestions(questions);
  state.decks[id] = questions;
  state.fingerprints[id] = fp;
  const progress = getDeckProgress(id);
  const first = questions[0]?.question?.trim().slice(0, 40) || "";
  const last =
    questions[questions.length - 1]?.question?.trim().slice(0, 40) || "";
  const legacyFingerprint = `${questions.length}|${first}|${last}`;
  if (progress.dataFingerprint && progress.dataFingerprint !== fp) {
    if (progress.dataFingerprint === legacyFingerprint) {
      state.legacyFingerprintMatched[id] = true;
      progress.dataFingerprint = fp;
      if (!saveDeckProgress(id, progress))
        toast("Không thể cập nhật phiên bản tiến độ trong trình duyệt.");
    } else {
      progress.completed = [];
      progress.sequentialCursor = 0;
      progress.wrongMap = {};
      progress.wrongRangeMap = {};
      progress.practiceMap = {};
      progress.bookmarks = [];
      progress.dataFingerprint = fp;
      if (!saveDeckProgress(id, progress))
        toast(
          "Không thể lưu tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.",
        );
      if (!resetDeckHighlights(id))
        toast(
          "Không thể xóa phần đánh dấu cũ vì bộ nhớ trình duyệt không ghi được.",
        );
    }
  } else if (!progress.dataFingerprint) {
    progress.dataFingerprint = fp;
    if (!saveDeckProgress(id, progress))
      toast("Không thể lưu dấu vân tay bộ đề vào trình duyệt.");
  }

  const progressBeforeSanitize = JSON.stringify(progress);
  const isValidIndex = (index) =>
    Number.isInteger(index) && index >= 0 && index < questions.length;
  progress.completed = progress.completed.filter(isValidIndex);
  progress.bookmarks = progress.bookmarks.filter(isValidIndex);
  progress.sequentialCursor = Math.min(
    progress.sequentialCursor,
    questions.length,
  );
  progress.wrongMap = Object.fromEntries(
    Object.entries(progress.wrongMap).filter(
      ([key, count]) =>
        isValidIndex(Number(key)) && Number.isInteger(count) && count > 0,
    ),
  );
  progress.practiceMap = Object.fromEntries(
    Object.entries(progress.practiceMap).filter(
      ([key, count]) =>
        isValidIndex(Number(key)) && Number.isInteger(count) && count > 0,
    ),
  );
  if (
    JSON.stringify(progress) !== progressBeforeSanitize &&
    !saveDeckProgress(id, progress)
  ) {
    toast("Không thể làm sạch tiến độ cũ trong trình duyệt.");
  }
  return questions;
}

async function loadAll() {
  state.loading = true;
  state.error = null;
  showScreen("loading");
  let stage = "tải dữ liệu";
  try {
    await Promise.all([loadDeck("quocphong1"), loadDeck("quocphong2")]);
    state.loading = false;
    stage = "khởi tạo giao diện";
    initUI();
  } catch (e) {
    state.loading = false;
    state.error = e?.message || String(e);
    console.error(`Lỗi khi ${stage}:`, e);
    showScreen("error");
    let errorMessage = $("error-message");
    if (!errorMessage) {
      const screen = $("screen-error");
      if (screen) {
        errorMessage = document.createElement("pre");
        errorMessage.id = "error-message";
        errorMessage.className = "error-message";
        screen.append(errorMessage);
      }
    }
    const isDataError = stage === "tải dữ liệu";
    const details = [
      isDataError
        ? state.error
        : `Không thể khởi tạo giao diện: ${state.error}`,
      isDataError
        ? "Nếu đang ngoại tuyến lần đầu, hãy kết nối mạng để tải bộ đề."
        : "Hãy tải lại trang. Nếu lỗi vẫn còn, mở Console để xem chi tiết.",
    ].join("\n\n");
    if (errorMessage) errorMessage.textContent = details;
    else window.alert(details);
  }
}

function showScreen(name) {
  for (const el of document.querySelectorAll(".screen")) {
    el.classList.remove("active");
    el.hidden = true;
  }
  const screen = $(`screen-${name}`);
  if (screen) {
    screen.hidden = false;
    screen.classList.add("active");
  }
  state.mode = name;
  document.body.dataset.screen = name;
  if (screen) {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    requestAnimationFrame(updateScrollTopButton);
  }
}

function updateScrollTopButton() {
  const btn = $("btn-scroll-top");
  if (!btn) return;
  const threshold = Math.max(360, Math.floor(window.innerHeight * 0.75));
  const show = window.scrollY > threshold;
  btn.hidden = false;
  btn.classList.toggle("is-visible", show);
  if (!show) {
    // keep in DOM but hide via class; also set hidden when near top for a11y
    btn.hidden = true;
  }
}

function scrollToPageTop() {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

function toast(message, durationMs = 2800) {
  const toastElement = $("toast");
  if (!toastElement) {
    console.warn("Không tìm thấy phần tử #toast:", message);
    return;
  }
  toastElement.textContent = message;
  toastElement.hidden = false;
  clearTimeout(toast._timeoutId);
  toast._timeoutId = setTimeout(() => {
    if (toastElement.isConnected) toastElement.hidden = true;
  }, durationMs);
}

function confirmModal(title, body) {
  return new Promise((resolve) => {
    $("modal-title").textContent = title;
    $("modal-body").textContent = body;
    $("modal").hidden = false;
    $("modal").classList.add("is-open");
    const ok = $("modal-ok");
    const cancel = $("modal-cancel");
    const cleanup = (val) => {
      $("modal").hidden = true;
      $("modal").classList.remove("is-open");
      ok.onclick = null;
      cancel.onclick = null;
      resolve(val);
    };
    const previousFocus = document.activeElement;
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanupWithFocus(false);
      }
    };
    const originalCleanup = cleanup;
    const cleanupWithFocus = (val) => {
      document.removeEventListener("keydown", onKeydown);
      originalCleanup(val);
      if (previousFocus instanceof HTMLElement)
        previousFocus.focus({ preventScroll: true });
    };
    ok.onclick = () => cleanupWithFocus(true);
    cancel.onclick = () => cleanupWithFocus(false);
    document.addEventListener("keydown", onKeydown);
    ok.focus();
  });
}

function currentQuestions() {
  return state.decks[state.currentDeck] || [];
}

function bankQuestions() {
  return state.decks[state.bankDeck] || [];
}

/** Tuỳ chọn khi đang làm bài: phiên từ ngân hàng dùng bankSettings, còn lại dùng settings thiết lập. */
function sessionPreferences(deckId) {
  if (state.session?.fromBank) return getBankSettings();
  return getSettings(deckId || state.session?.deckId || state.currentDeck);
}

function renderTextWithHighlights(
  element,
  text,
  deckId,
  originalIndex,
  target,
) {
  element.replaceChildren();
  element.dataset.highlightTarget = target;
  element.dataset.questionIndex = String(originalIndex);
  element.dataset.deckId = deckId;
  const ranges = getQuestionHighlights(deckId, originalIndex)
    .filter(
      (range) =>
        range.target === target && range.start < text.length && range.end > 0,
    )
    .map((range) => ({
      start: Math.max(0, range.start),
      end: Math.min(text.length, range.end),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor)
      element.appendChild(
        document.createTextNode(text.slice(cursor, range.start)),
      );
    const mark = document.createElement("span");
    mark.className = "text-highlight";
    mark.textContent = text.slice(range.start, range.end);
    element.appendChild(mark);
    cursor = range.end;
  }
  if (cursor < text.length)
    element.appendChild(document.createTextNode(text.slice(cursor)));
}

function toggleHighlightSelection(deckId, questionIndex, selection) {
  const saved = getQuestionHighlights(deckId, questionIndex);
  const selected = {
    target: selection.target,
    start: selection.start,
    end: selection.end,
  };
  const sameTarget = saved
    .filter((range) => range.target === selected.target)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start);
  let coveredUntil = selected.start;
  for (const range of sameTarget) {
    if (range.end <= coveredUntil) continue;
    if (range.start > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, range.end);
    if (coveredUntil >= selected.end) break;
  }
  const fullyHighlighted = coveredUntil >= selected.end;
  let updated;
  if (fullyHighlighted) {
    updated = [];
    for (const range of saved) {
      if (
        range.target !== selected.target ||
        range.end <= selected.start ||
        range.start >= selected.end
      ) {
        updated.push(range);
        continue;
      }
      if (range.start < selected.start)
        updated.push({ ...range, end: selected.start });
      if (range.end > selected.end)
        updated.push({ ...range, start: selected.end });
    }
  } else {
    updated = [...saved, selected];
  }
  if (!saveQuestionHighlights(deckId, questionIndex, updated)) {
    toast("Không thể lưu highlight. Bộ nhớ trình duyệt có thể đã đầy.");
    return false;
  }
  state.lastTextSelection = null;
  if (state.mode === "review") renderQuestionBank();
  else renderQuestion();
  toast(
    fullyHighlighted
      ? "Đã xóa highlight ở đoạn chọn."
      : "Đã highlight đoạn chọn.",
  );
  return true;
}

function captureHighlightSelection() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed)
    return false;

  let range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    state.lastTextSelection = null;
    return false;
  }

  const elementFor = (node) => {
    if (!node) return null;
    const element =
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest?.("[data-highlight-target]") || null;
  };

  const target = elementFor(range.startContainer);
  const endTarget = elementFor(range.endContainer);
  if (
    !target ||
    target !== endTarget ||
    !target.contains(range.startContainer) ||
    !target.contains(range.endContainer)
  ) {
    state.lastTextSelection = null;
    return false;
  }

  const getOffset = (container, offset) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(target);
    prefix.setEnd(container, offset);
    return prefix.toString().length;
  };

  try {
    const start = getOffset(range.startContainer, range.startOffset);
    const end = getOffset(range.endContainer, range.endOffset);
    const text = target.textContent || "";
    const selectedText = range.toString();
    const safeStart = Math.max(0, Math.min(start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(end, text.length));

    if (!selectedText.trim() || safeEnd <= safeStart) {
      state.lastTextSelection = null;
      return false;
    }

    state.lastTextSelection = {
      deckId: target.dataset.deckId || state.currentDeck,
      questionIndex: Number(target.dataset.questionIndex),
      target: target.dataset.highlightTarget,
      start: safeStart,
      end: safeEnd,
      selectedText,
    };
    return true;
  } catch {
    state.lastTextSelection = null;
    return false;
  }
}

function getFilteredBankQuestions() {
  const questions = bankQuestions();
  const form = readBankForm();
  // Ngân hàng luôn hiển thị toàn bộ câu của bộ đề đang chọn (không phụ thuộc vùng thiết lập)
  return { questions, form, filtered: questions };
}

function getReviewVirtualState() {
  if (!state.reviewVirtual) {
    state.reviewVirtual = {
      filtered: [],
      heights: [],
      positions: [],
      totalHeight: 0,
      pool: [],
      phantom: null,
      scrollBound: false,
      rangeStart: 0,
      rangeEnd: -1,
      measureRaf: 0,
      scrollRaf: 0,
    };
  }
  return state.reviewVirtual;
}

function rebuildReviewVirtualMetrics(vs) {
  const n = vs.filtered.length;
  if (vs.heights.length !== n) {
    vs.heights = Array.from(
      { length: n },
      (_, i) => vs.heights[i] || REVIEW_VIRTUAL_ESTIMATED_HEIGHT,
    );
  }
  vs.positions = new Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    vs.positions[i] = y;
    y += vs.heights[i];
  }
  vs.totalHeight = y;
  if (vs.phantom) vs.phantom.style.height = `${Math.max(y, 0)}px`;
}

function findReviewVirtualIndex(vs, offsetY) {
  const pos = vs.positions;
  if (!pos.length) return 0;
  let lo = 0;
  let hi = pos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pos[mid] <= offsetY) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function createReviewBankCard() {
  const card = document.createElement("article");
  card.className = "review-q-card review-vs-item";
  card.style.position = "absolute";
  card.style.left = "0";
  card.style.right = "0";
  card.style.top = "0";
  card.style.willChange = "transform";

  const selectLabel = document.createElement("label");
  selectLabel.className = "review-select-label";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  const selectSpan = document.createElement("span");
  selectSpan.textContent = "Chọn câu này";
  selectLabel.append(checkbox, selectSpan);

  const heading = document.createElement("h3");
  heading.className = "review-q-heading";

  const prompt = document.createElement("p");
  prompt.className = "review-q-text";

  const toolbar = document.createElement("div");
  toolbar.className = "highlight-toolbar";
  const hlBtn = document.createElement("button");
  hlBtn.type = "button";
  hlBtn.className = "btn btn-secondary btn-sm highlight-toggle-btn";
  hlBtn.dataset.icon = "underline";
  hlBtn.textContent = "Highlight";
  hlBtn.setAttribute(
    "aria-label",
    "Highlight hoặc bỏ highlight đoạn văn bản đã chọn",
  );
  hlBtn.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") event.preventDefault();
  });
  hlBtn.addEventListener("mousedown", (event) => event.preventDefault());
  hlBtn.addEventListener("click", () => {
    const qIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(qIndex)) return;
    captureHighlightSelection();
    const selection = state.lastTextSelection;
    if (
      !selection ||
      selection.questionIndex !== qIndex ||
      selection.deckId !== state.bankDeck
    ) {
      toast("Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.");
      return;
    }
    toggleHighlightSelection(selection.deckId, qIndex, selection);
  });
  toolbar.appendChild(hlBtn);

  const options = document.createElement("ol");
  options.className = "review-options";
  options.type = "A";

  const optionNodes = [];
  for (let i = 0; i < 6; i++) {
    const item = document.createElement("li");
    item.className = "review-option";
    item.hidden = true;
    const label = document.createElement("span");
    label.className = "review-option-label";
    const text = document.createElement("span");
    text.className = "review-option-text";
    const badge = document.createElement("span");
    badge.className = "review-correct-badge";
    badge.textContent = "Đáp án đúng";
    badge.hidden = true;
    item.append(label, text, badge);
    options.appendChild(item);
    optionNodes.push({ item, label, text, badge });
  }

  checkbox.addEventListener("change", () => {
    const qIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(qIndex)) return;
    if (checkbox.checked) state.reviewSelectedIndices.add(qIndex);
    else state.reviewSelectedIndices.delete(qIndex);
    const count = state.reviewSelectedIndices.size;
    $("btn-review-start-selected").textContent =
      `${state.bankPracticeMode === "exam" ? "Thi" : "Ôn"} ${count} câu đã chọn`;
    $("btn-review-start-selected").disabled = count === 0;
  });

  card.append(selectLabel, heading, prompt, toolbar, options);
  card._vs = {
    selectLabel,
    checkbox,
    heading,
    prompt,
    toolbar,
    options,
    optionNodes,
  };
  return card;
}

function bindReviewBankCard(card, question, listIndex) {
  const parts = card._vs;
  const labels = ["A", "B", "C", "D", "E", "F"];
  card.dataset.listIndex = String(listIndex);
  card.dataset.originalIndex = String(question.originalIndex);
  card.id = `review-question-${question.originalIndex + 1}`;
  parts.heading.textContent = `Câu ${question.originalIndex + 1}`;
  parts.checkbox.checked = state.reviewSelectedIndices.has(
    question.originalIndex,
  );
  parts.checkbox.setAttribute(
    "aria-label",
    `Chọn câu ${question.originalIndex + 1}`,
  );

  renderTextWithHighlights(
    parts.prompt,
    question.question,
    state.bankDeck,
    question.originalIndex,
    "question",
  );

  const optionCount = question.options.length;
  parts.optionNodes.forEach((node, index) => {
    if (index >= optionCount) {
      node.item.hidden = true;
      return;
    }
    node.item.hidden = false;
    const isCorrect = index === question.correct;
    node.item.className = isCorrect
      ? "review-option is-correct"
      : "review-option";
    node.label.textContent = labels[index] || String(index + 1);
    renderTextWithHighlights(
      node.text,
      question.options[index],
      state.bankDeck,
      question.originalIndex,
      `option:${index}`,
    );
    node.badge.hidden = !isCorrect;
  });
}

function ensureReviewVirtualPool(vs, list) {
  while (vs.pool.length < REVIEW_VIRTUAL_POOL_SIZE) {
    const card = createReviewBankCard();
    card.hidden = true;
    list.appendChild(card);
    vs.pool.push(card);
  }
}

function measureReviewVirtualVisible(vs) {
  for (const card of vs.pool) {
    if (card.hidden) continue;
    const idx = Number(card.dataset.listIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= vs.filtered.length)
      continue;
    const h = card.offsetHeight;
    // +12px khoảng cách giữa các card (thay cho grid gap)
    const withGap = h + 12;
    if (h > 0 && Math.abs((vs.heights[idx] || 0) - withGap) > 2) {
      vs.heights[idx] = withGap;
    }
  }
  rebuildReviewVirtualMetrics(vs);
}

function syncReviewVirtualWindow() {
  if (state.mode !== "review") return;
  const list = $("review-list");
  const vs = getReviewVirtualState();
  if (!list || !vs.filtered.length) return;

  const listTop = list.getBoundingClientRect().top + window.scrollY;
  const viewTop = Math.max(0, window.scrollY - listTop);
  const viewBottom = viewTop + window.innerHeight;

  let start = findReviewVirtualIndex(vs, viewTop);
  start = Math.max(0, start - REVIEW_VIRTUAL_OVERSCAN);
  let end = findReviewVirtualIndex(vs, viewBottom);
  end = Math.min(vs.filtered.length - 1, end + REVIEW_VIRTUAL_OVERSCAN);

  const needed = end - start + 1;
  while (vs.pool.length < needed) {
    const card = createReviewBankCard();
    card.hidden = true;
    list.appendChild(card);
    vs.pool.push(card);
  }

  const neededIndices = [];
  for (let i = start; i <= end; i++) neededIndices.push(i);

  const assigned = new Map(); // listIndex -> card
  const free = [];
  for (const card of vs.pool) {
    const idx = Number(card.dataset.listIndex);
    if (
      !card.hidden &&
      Number.isInteger(idx) &&
      idx >= start &&
      idx <= end &&
      !assigned.has(idx)
    ) {
      assigned.set(idx, card);
    } else {
      free.push(card);
    }
  }

  for (const i of neededIndices) {
    let card = assigned.get(i);
    if (!card) card = free.pop();
    if (!card) continue;
    assigned.set(i, card);
    const question = vs.filtered[i];
    if (
      Number(card.dataset.listIndex) !== i ||
      Number(card.dataset.originalIndex) !== question.originalIndex
    ) {
      bindReviewBankCard(card, question, i);
    } else {
      card._vs.checkbox.checked = state.reviewSelectedIndices.has(
        question.originalIndex,
      );
    }
    card.hidden = false;
    card.style.transform = `translateY(${vs.positions[i] || 0}px)`;
  }

  const used = new Set(assigned.values());
  for (const card of vs.pool) {
    if (!used.has(card)) {
      card.hidden = true;
      card.dataset.listIndex = "";
      card.dataset.originalIndex = "";
    }
  }
  vs.rangeStart = start;
  vs.rangeEnd = end;

  if (vs.measureRaf) cancelAnimationFrame(vs.measureRaf);
  vs.measureRaf = requestAnimationFrame(() => {
    vs.measureRaf = 0;
    const before = vs.totalHeight;
    measureReviewVirtualVisible(vs);
    if (Math.abs(before - vs.totalHeight) > 4) {
      for (const card of vs.pool) {
        if (card.hidden) continue;
        const idx = Number(card.dataset.listIndex);
        if (!Number.isInteger(idx)) continue;
        card.style.transform = `translateY(${vs.positions[idx] || 0}px)`;
      }
    }
  });
}

function onReviewVirtualScroll() {
  const vs = getReviewVirtualState();
  if (vs.scrollRaf) return;
  vs.scrollRaf = requestAnimationFrame(() => {
    vs.scrollRaf = 0;
    syncReviewVirtualWindow();
  });
}

function ensureReviewVirtualScrollBinding() {
  const vs = getReviewVirtualState();
  if (vs.scrollBound) return;
  window.addEventListener("scroll", onReviewVirtualScroll, { passive: true });
  window.addEventListener("resize", onReviewVirtualScroll, { passive: true });
  vs.scrollBound = true;
}

function scrollReviewToQuestionNumber(questionNumber) {
  const vs = getReviewVirtualState();
  const idx = vs.filtered.findIndex(
    (q) => q.originalIndex + 1 === questionNumber,
  );
  if (idx < 0) return false;
  const list = $("review-list");
  if (!list) return false;
  rebuildReviewVirtualMetrics(vs);
  const listTop = list.getBoundingClientRect().top + window.scrollY;
  const y = listTop + (vs.positions[idx] || 0) - 12;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({
    top: Math.max(0, y),
    behavior: reducedMotion ? "auto" : "smooth",
  });
  requestAnimationFrame(() => {
    syncReviewVirtualWindow();
    requestAnimationFrame(() => {
      const el = document.getElementById(`review-question-${questionNumber}`);
      el?.classList.add("review-q-highlight");
    });
  });
  return true;
}

function renderQuestionBank() {
  const { questions, filtered } = getFilteredBankQuestions();
  const gotoInput = $("input-review-goto");
  if (gotoInput) {
    gotoInput.min = "1";
    gotoInput.max = String(Math.max(1, questions.length));
    gotoInput.placeholder = `1–${questions.length}`;
    gotoInput.setAttribute(
      "aria-label",
      `Đi đến câu số từ 1 đến ${questions.length}`,
    );
  }
  const selectedCount = state.reviewSelectedIndices.size;
  const startSelectedButton = $("btn-review-start-selected");
  if (startSelectedButton) {
    startSelectedButton.textContent = `${state.bankPracticeMode === "exam" ? "Thi" : "Ôn"} ${selectedCount} câu đã chọn`;
    startSelectedButton.disabled = selectedCount === 0;
  }
  $("review-title").textContent =
    DECKS[state.bankDeck]?.label || "Ngân hàng câu hỏi";
  document.querySelectorAll("[data-bank-deck]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bankDeck === state.bankDeck);
  });
  if ($("bank-count-quocphong1")) {
    $("bank-count-quocphong1").textContent =
      `${state.decks.quocphong1?.length ?? 479} câu`;
    $("bank-count-quocphong2").textContent =
      `${state.decks.quocphong2?.length ?? 262} câu`;
  }

  const list = $("review-list");
  const vs = getReviewVirtualState();
  vs.filtered = filtered;
  vs.heights = filtered.map(
    (_, i) => vs.heights[i] || REVIEW_VIRTUAL_ESTIMATED_HEIGHT,
  );
  if (vs.heights.length > filtered.length) vs.heights.length = filtered.length;

  list.classList.add("review-list-virtual");
  // Keep pool nodes; rebuild shell
  const keep = new Set(vs.pool);
  if (vs.phantom) keep.add(vs.phantom);
  for (const child of [...list.children]) {
    if (!keep.has(child)) child.remove();
  }
  if (!vs.phantom) {
    vs.phantom = document.createElement("div");
    vs.phantom.className = "review-vs-phantom";
    vs.phantom.setAttribute("aria-hidden", "true");
  }
  if (!vs.phantom.parentNode) list.insertBefore(vs.phantom, list.firstChild);
  ensureReviewVirtualPool(vs, list);
  rebuildReviewVirtualMetrics(vs);

  if (!filtered.length) {
    for (const card of vs.pool) card.hidden = true;
    vs.phantom.style.height = "0px";
    let empty = list.querySelector(".review-empty");
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "card review-empty";
      list.appendChild(empty);
    }
    empty.textContent = "Không có câu hỏi trong vùng hiện tại.";
    empty.hidden = false;
    return;
  }
  const empty = list.querySelector(".review-empty");
  if (empty) empty.hidden = true;

  ensureReviewVirtualScrollBinding();
  syncReviewVirtualWindow();
}

function openQuestionBank() {
  state.reviewSelectedIndices.clear();
  const vs = getReviewVirtualState();
  vs.heights = [];
  vs.positions = [];
  vs.rangeStart = 0;
  vs.rangeEnd = -1;
  if ($("input-review-goto")) $("input-review-goto").value = "";
  const bank = getBankSettings();
  state.bankDeck = bank.deck === "quocphong2" ? "quocphong2" : "quocphong1";
  applyBankSettingsToForm(bank);
  renderQuestionBank();
  showScreen("review");
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0 });
    syncReviewVirtualWindow();
  });
}

function refreshSetupUI() {
  const qs = currentQuestions();
  const total = qs.length;
  $("count-quocphong1").textContent =
    `${state.decks.quocphong1?.length ?? "479"} câu`;
  $("count-quocphong2").textContent =
    `${state.decks.quocphong2?.length ?? "262"} câu`;

  document.querySelectorAll(".deck-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.deck === state.currentDeck);
  });

  const startInput = $("input-range-start");
  const endInput = $("input-range-end");
  startInput.max = String(Math.max(1, total));
  endInput.max = String(Math.max(1, total));
  let start = Number.parseInt(startInput.value, 10);
  let end = Number.parseInt(endInput.value, 10);
  if (!Number.isInteger(start)) start = 1;
  if (!Number.isInteger(end)) end = total;
  start = Math.max(1, Math.min(start, Math.max(1, total)));
  end = Math.max(start, Math.min(end, Math.max(1, total)));
  startInput.value = String(start);
  endInput.value = String(end);

  const rangeTotal = Math.max(0, end - start + 1);
  const input = $("input-count");
  input.max = String(Math.max(1, rangeTotal));
  if (Number(input.value) > rangeTotal) input.value = String(rangeTotal || 1);
  if (Number(input.value) < 1 || !Number.isFinite(Number(input.value)))
    input.value = "1";

  const progress = getDeckProgress(state.currentDeck);
  const completed = new Set(progress.completed);
  const remaining = qs.filter((q) => !completed.has(q.originalIndex)).length;
  const wrongs = getWrongIndices(state.currentDeck);
  $("stat-completed").textContent = String(completed.size);
  $("stat-remaining").textContent = String(remaining);
  $("stat-wrong").textContent = String(wrongs.length);
  $("stat-practice").textContent = String(
    Object.values(progress.practiceMap || {}).reduce(
      (sum, count) => sum + count,
      0,
    ),
  );
  $("stat-bookmarked").textContent = String(progress.bookmarks.length);
  if (progress.sequentialCursor >= total) {
    $("stat-cursor").textContent = "Đã hết (làm lại từ đầu)";
  } else {
    $("stat-cursor").textContent = String(progress.sequentialCursor + 1);
  }

  const btnWrong = $("btn-practice-wrong");
  const rangeWrongCount = getRangeWrongIndices(
    state.currentDeck,
    start,
    end,
  ).length;
  btnWrong.disabled = state.practiceMode === "exam" || rangeWrongCount === 0;
  btnWrong.textContent = `Ôn ${rangeWrongCount} câu sai trong vùng`;

  const allWrongCount = getWrongIndices(state.currentDeck).filter(
    (index) => index < total,
  ).length;
  const btnAllWrong = $("btn-practice-all-wrong");
  btnAllWrong.disabled = state.practiceMode === "exam" || allWrongCount === 0;
  btnAllWrong.textContent = `Ôn ${allWrongCount} câu sai của bộ đề`;

  const bookmarks = new Set(getBookmarkedIndices(state.currentDeck));
  const rangeBookmarkCount = qs.filter(
    (question) =>
      question.originalIndex >= start - 1 &&
      question.originalIndex < end &&
      bookmarks.has(question.originalIndex),
  ).length;
  const btnBookmarks = $("btn-practice-bookmarks");
  btnBookmarks.disabled =
    state.practiceMode === "exam" || rangeBookmarkCount === 0;
  btnBookmarks.textContent = `Ôn ${rangeBookmarkCount} câu đã đánh dấu`;

  const rangeQuestions = qs.filter(
    (question) =>
      question.originalIndex >= start - 1 && question.originalIndex < end,
  );
  const shuffleQ = $("chk-shuffle-q").checked;
  const btnContinue = $("btn-continue");
  const nextQuestion = findNextUncompletedQuestion(
    rangeQuestions,
    Math.max(progress.sequentialCursor, start - 1),
    completed,
  );
  const nextIndex = nextQuestion?.originalIndex ?? end;
  const canContinue =
    state.practiceMode !== "exam" && !shuffleQ && !!nextQuestion;
  btnContinue.hidden = !canContinue;
  if (canContinue) {
    const left = end - nextIndex;
    const n = Math.min(Number(input.value) || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự ${n} câu từ câu ${nextIndex + 1}`;
  }

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const n = Number(btn.dataset.count);
    btn.classList.toggle("is-active", Number(input.value) === n);
    btn.disabled = n > rangeTotal;
  });

  refreshResumeCard();
}

function refreshResumeCard() {
  const card = $("resume-card");
  if (!card) return;
  const saved = getSession(state.currentDeck);
  if (!saved || !Array.isArray(saved.items) || !saved.items.length) {
    card.hidden = true;
    return;
  }
  const answered = saved.items.filter((item) => item.userAnswer != null).length;
  const isExam = !!saved.examMode || saved.mode === "exam";
  const deckLabel = DECKS[saved.deckId]?.label || saved.deckId;
  card.hidden = false;
  $("resume-title").textContent = isExam
    ? saved.reviewMode
      ? "Có lượt thi đã chấm"
      : "Có lượt thi thử đang dở"
    : "Có lượt ôn đang dở";
  $("resume-hint").textContent = isExam
    ? `${deckLabel} · ${answered}/${saved.items.length} câu đã chọn${saved.reviewMode ? " · Đã chấm" : ""}`
    : `${deckLabel} · Câu ${(saved.viewIndex || 0) + 1}/${saved.items.length}`;
}

function readBankForm() {
  const total = Math.max(1, bankQuestions().length);
  const sharedSettings = getSettings(state.bankDeck);
  let count = Number.parseInt($("review-input-count")?.value, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > total) count = total;
  let timeLimit = Number.parseInt($("review-input-time-limit")?.value, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 0) timeLimit = 0;
  timeLimit = Math.min(1440, timeLimit);
  return {
    ...sharedSettings,
    deck: state.bankDeck === "quocphong2" ? "quocphong2" : "quocphong1",
    count,
    timeLimit,
    shuffleQ: !!$("review-chk-shuffle-q")?.checked,
    shuffleA: !!$("review-chk-shuffle-a")?.checked,
    practiceMode: state.bankPracticeMode === "exam" ? "exam" : "practice",
    autoCheck: !!$("review-chk-auto-check")?.checked,
    autoAdvance: !!$("review-chk-auto-advance")?.checked,
    soundEnabled: $("review-chk-sound")
      ? !!$("review-chk-sound").checked
      : true,
    vibrationEnabled: $("review-chk-vibration")
      ? !!$("review-chk-vibration").checked
      : true,
  };
}

function applyBankSettingsToForm(settings) {
  if (!settings || !$("review-input-count")) return;
  const total = Math.max(
    1,
    bankQuestions().length || settings.endQuestion || 1,
  );
  $("review-input-count").value = String(settings.count || 30);
  $("review-input-count").max = String(total);
  $("review-input-time-limit").value = String(
    Number.isInteger(settings.timeLimit) && settings.timeLimit >= 0
      ? Math.min(1440, settings.timeLimit)
      : 35,
  );
  $("review-chk-shuffle-q").checked = settings.shuffleQ !== false;
  $("review-chk-shuffle-a").checked = settings.shuffleA !== false;
  if ($("review-chk-auto-check")) {
    $("review-chk-auto-check").checked = settings.autoCheck === true;
    $("review-chk-auto-advance").checked = settings.autoAdvance === true;
    $("review-chk-sound").checked = settings.soundEnabled !== false;
    $("review-chk-vibration").checked = settings.vibrationEnabled !== false;
  }
  state.bankPracticeMode =
    settings.practiceMode === "exam" ? "exam" : "practice";
  state.practiceMode = state.bankPracticeMode;
  document.querySelectorAll("#screen-setup .mode-btn").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.mode === state.practiceMode,
    );
  });
  document.querySelectorAll("#screen-review .mode-btn").forEach((btn) => {
    btn.classList.toggle(
      "is-active",
      btn.dataset.mode === state.bankPracticeMode,
    );
  });
  document.querySelectorAll("[data-bank-deck]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bankDeck === state.bankDeck);
  });
}

function persistBankForm() {
  const form = readBankForm();
  const saved = saveBankSettings(form);
  if (!saved)
    toast(
      "Không thể lưu tuỳ chọn ngân hàng. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.",
    );
  return form;
}

function setBankPracticeMode(mode) {
  state.bankPracticeMode = mode === "exam" ? "exam" : "practice";
  state.practiceMode = state.bankPracticeMode;
  document.querySelectorAll("#screen-setup .mode-btn").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.mode === state.practiceMode,
    );
  });
  document.querySelectorAll("#screen-review .mode-btn").forEach((btn) => {
    btn.classList.toggle(
      "is-active",
      btn.dataset.mode === state.bankPracticeMode,
    );
  });
  persistBankForm();
  renderQuestionBank();
}

function setBankDeck(deckId) {
  const id = deckId === "quocphong2" ? "quocphong2" : "quocphong1";
  if (state.bankDeck === id) return;
  persistBankForm();
  state.bankDeck = id;
  state.reviewSelectedIndices.clear();
  const vs = getReviewVirtualState();
  vs.heights = [];
  vs.positions = [];
  const settings = getBankSettings();
  // giữ practiceMode/count đã lưu toàn cục ngân hàng nhưng gắn deck mới
  applyBankSettingsToForm({ ...settings, deck: id });
  persistBankForm();
  renderQuestionBank();
  if ($("bank-count-quocphong1")) {
    $("bank-count-quocphong1").textContent =
      `${state.decks.quocphong1?.length ?? 479} câu`;
    $("bank-count-quocphong2").textContent =
      `${state.decks.quocphong2?.length ?? 262} câu`;
  }
}

function startPracticeBookmarks() {
  const form = readSetupForm();
  persistSetupForm();
  const qs = selectedQuestions(form);
  const bookmarked = getBookmarkedIndices(state.currentDeck);
  const pool = pickWrong(qs, bookmarked, form.count, form.shuffleQ);
  if (!pool.length) {
    toast("Trong vùng câu hỏi đã chọn không có câu nào được đánh dấu.");
    return;
  }
  const practiceSaveFailed = pool.some(
    (question) =>
      markPracticed(state.currentDeck, question.originalIndex) === null,
  );
  if (practiceSaveFailed)
    toast("Không thể lưu thống kê ôn lại vào trình duyệt.");
  startSessionFromPool(pool, {
    mode: "practice-bookmarks",
    sequential: false,
    forceShuffleQ: form.shuffleQ,
    alreadyShuffled: true,
  });
}

function readSetupForm() {
  const total = currentQuestions().length;
  let startQuestion = Number.parseInt($("input-range-start").value, 10);
  let endQuestion = Number.parseInt($("input-range-end").value, 10);
  if (!Number.isInteger(startQuestion)) startQuestion = 1;
  if (!Number.isInteger(endQuestion)) endQuestion = total;
  startQuestion = Math.max(1, Math.min(startQuestion, Math.max(1, total)));
  endQuestion = Math.max(
    startQuestion,
    Math.min(endQuestion, Math.max(1, total)),
  );

  let count = Number.parseInt($("input-count").value, 10);
  const rangeCount = Math.max(1, endQuestion - startQuestion + 1);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > rangeCount) count = rangeCount;
  let timeLimit = Number.parseInt($("input-time-limit").value, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 0) timeLimit = 0;
  timeLimit = Math.min(1440, timeLimit);
  $("input-time-limit").value = String(timeLimit);
  const shuffleQ = $("chk-shuffle-q").checked;
  const shuffleA = $("chk-shuffle-a").checked;
  return { count, shuffleQ, shuffleA, startQuestion, endQuestion, timeLimit };
}

function persistSetupForm() {
  const form = readSetupForm();
  const saved = saveSettings({
    deck: state.currentDeck,
    count: form.count,
    shuffleQ: form.shuffleQ,
    shuffleA: form.shuffleA,
    startQuestion: form.startQuestion,
    endQuestion: form.endQuestion,
    timeLimit: form.timeLimit,
    practiceMode: state.practiceMode,
    autoCheck: $("chk-auto-check").checked,
    autoAdvance: $("chk-auto-advance").checked,
    soundEnabled: $("chk-sound").checked,
    vibrationEnabled: $("chk-vibration").checked,
  });
  if (!saved)
    toast(
      "Không thể lưu tùy chọn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.",
    );
}

function applySettingsToForm(settings) {
  if (!settings) return;
  const total = currentQuestions().length || settings.endQuestion || 1;
  $("input-count").value = String(settings.count || 30);
  $("input-time-limit").value = String(
    Number.isInteger(settings.timeLimit) && settings.timeLimit >= 0
      ? Math.min(1440, settings.timeLimit)
      : 35,
  );
  $("input-range-start").value = String(settings.startQuestion || 1);
  $("input-range-end").value = String(
    settings.endQuestion > 0 ? Math.min(settings.endQuestion, total) : total,
  );
  $("chk-shuffle-q").checked = !!settings.shuffleQ;
  $("chk-shuffle-a").checked = !!settings.shuffleA;
  $("chk-auto-check").checked = settings.autoCheck === true;
  $("chk-auto-advance").checked = settings.autoAdvance === true;
  $("chk-sound").checked = settings.soundEnabled !== false;
  $("chk-vibration").checked = settings.vibrationEnabled !== false;
  setPracticeMode(settings.practiceMode === "exam" ? "exam" : "practice");
}

function stopSessionTimer(freeze = true) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  const s = state.session;
  if (freeze && s && !s.finishedAt) {
    s.finishedAt = Date.now();
    persistSession();
  }
  updateTimerDisplay();
}

function selectedQuestions(form = readSetupForm()) {
  return currentQuestions().filter(
    (question) =>
      question.originalIndex >= form.startQuestion - 1 &&
      question.originalIndex < form.endQuestion,
  );
}
function startSessionFromPool(pool, meta) {
  const fromBank = !!meta.fromBank;
  const form = fromBank
    ? {
        ...readBankForm(),
        shuffleA:
          meta.shuffleA != null ? meta.shuffleA : readBankForm().shuffleA,
        timeLimit:
          meta.timeLimit != null ? meta.timeLimit : readBankForm().timeLimit,
      }
    : readSetupForm();
  const shuffleA = meta.shuffleA != null ? meta.shuffleA : form.shuffleA;
  const shuffleQ =
    meta.forceShuffleQ != null ? meta.forceShuffleQ : form.shuffleQ;
  const shouldShuffleQ = meta.alreadyShuffled ? false : !!shuffleQ;
  const timeLimit = meta.timeLimit != null ? meta.timeLimit : form.timeLimit;
  const items = createSessionItems(pool, {
    shuffleQ: shouldShuffleQ,
    shuffleA,
  });
  const session = {
    deckId: state.currentDeck,
    dataFingerprint: state.fingerprints[state.currentDeck],
    mode: meta.mode || "normal",
    rangeStart: meta.rangeStart ?? form.startQuestion,
    rangeEnd: meta.rangeEnd ?? form.endQuestion,
    requestedCount: meta.requestedCount ?? form.count,
    sequential: !!meta.sequential,
    startCursor: meta.startCursor ?? null,
    nextCursor: meta.nextCursor ?? null,
    shuffleQ,
    shuffleA,
    fromBank,
    pool: pool.map((q) => ({
      originalIndex: q.originalIndex,
      question: q.question,
      options: q.options.slice(),
      correct: q.correct,
    })),
    items,
    viewIndex: 0,
    reviewingPast: false,
    maxReached: 0,
    completedInSession: 0,
    practiceInitialCount: meta.mode === "practice-wrong" ? pool.length : 0,
    practiceCompletedIndices: [],
    practiceWrongHistory: [],
    firstTryCorrect: 0,
    totalWrongAttempts: 0,
    timeLimit,
    startedAt: Date.now(),
    deadlineAt: timeLimit > 0 ? Date.now() + timeLimit * 60000 : null,
    pausedAt: null,
    pausedDurationMs: 0,
    remainingMs: null,
    timeExpired: false,
  };
  const examRequested =
    meta.examMode != null
      ? !!meta.examMode
      : fromBank
        ? state.bankPracticeMode === "exam"
        : state.practiceMode === "exam";
  if (examRequested) {
    session.examMode = true;
    session.mode = session.mode === "normal" ? "exam" : session.mode;
  }
  state.session = session;
  state.reviewMode = false;
  state.examFilter = "all";
  state.examSubmitting = false;
  if (!saveSession(session))
    toast(
      "Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.",
    );
  if (session.examMode) {
    showScreen("exam");
    renderExam();
  } else {
    showScreen("quiz");
    renderQuestion();
  }
  startSessionTimer();
}

function startNormal(opts = {}) {
  const allQuestions = currentQuestions();
  if (!allQuestions.length) {
    toast("Bộ đề trống.");
    return;
  }
  const form = readSetupForm();
  const qs = selectedQuestions(form);
  if (!qs.length) {
    toast("Vùng câu hỏi đã chọn không có câu hợp lệ.");
    return;
  }
  persistSetupForm();
  const progress = getDeckProgress(state.currentDeck);
  const completedSet = new Set(progress.completed);
  const rangeStart = form.startQuestion - 1;
  const rangeEnd = form.endQuestion;

  if (opts.restart) {
    const { items, nextCursor } = pickSequential(qs, 0, form.count, new Set());
    const globalNextCursor =
      nextCursor > 0
        ? qs[Math.min(nextCursor, qs.length) - 1].originalIndex + 1
        : rangeStart;
    startSessionFromPool(items, {
      mode: "normal",
      sequential: true,
      startCursor: rangeStart,
      nextCursor: globalNextCursor,
      forceShuffleQ: false,
      alreadyShuffled: true,
    });
    return;
  }

  if (opts.sequential) {
    const nextQuestion = findNextUncompletedQuestion(
      qs,
      Math.max(progress.sequentialCursor, rangeStart),
      completedSet,
    );
    if (!nextQuestion) {
      toast("Đã hoàn thành toàn bộ câu trong vùng đã chọn.");
      return;
    }
    const cursor = nextQuestion.originalIndex;
    const scanQuestions = qs.filter(
      (question) => question.originalIndex >= cursor,
    );
    const { items, nextCursor, actualCount } = pickSequential(
      scanQuestions,
      0,
      form.count,
      completedSet,
    );
    if (!items.length) {
      toast("Không còn câu tuần tự trong vùng đã chọn.");
      return;
    }
    if (actualCount < form.count)
      toast(`Chỉ còn ${actualCount} câu theo thứ tự trong vùng đã chọn.`);
    const globalNextCursor =
      nextCursor > 0
        ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1]
            .originalIndex + 1
        : cursor;
    startSessionFromPool(items, {
      mode: "normal",
      sequential: true,
      startCursor: cursor,
      nextCursor: globalNextCursor,
      forceShuffleQ: false,
      alreadyShuffled: true,
    });
    return;
  }

  if (form.shuffleQ) {
    const remainingCount = qs.filter(
      (question) => !completedSet.has(question.originalIndex),
    ).length;
    const pool = pickRandom(qs, form.count, true, completedSet);
    if (!pool.length) {
      toast("Không lấy được câu hỏi trong vùng đã chọn.");
      return;
    }
    if (remainingCount === 0) {
      toast(
        "Bạn đã hoàn thành các câu trong vùng này; lượt này lấy ngẫu nhiên trong vùng đã chọn.",
      );
    } else if (remainingCount < form.count) {
      toast(
        `Chỉ còn ${remainingCount} câu chưa hoàn thành trong vùng; đã bổ sung câu đã làm để đủ ${pool.length} câu.`,
      );
    }
    startSessionFromPool(pool, {
      mode: "normal",
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true,
    });
    return;
  }

  const nextQuestion = findNextUncompletedQuestion(
    qs,
    Math.max(progress.sequentialCursor, rangeStart),
    completedSet,
  );
  const cursor = nextQuestion?.originalIndex ?? rangeEnd;
  const scanQuestions = qs.filter(
    (question) => question.originalIndex >= cursor,
  );
  const { items, nextCursor, actualCount } = pickSequential(
    scanQuestions,
    0,
    form.count,
    completedSet,
  );
  if (!items.length) {
    const pool = pickRandom(qs, form.count, false, completedSet);
    startSessionFromPool(pool, {
      mode: "normal",
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true,
    });
    toast(
      "Đã hết chuỗi tuần tự trong vùng, chuyển sang ngẫu nhiên trong vùng đã chọn.",
    );
    return;
  }
  if (actualCount < form.count)
    toast(`Lượt này có ${actualCount} câu trong vùng đã chọn.`);
  const globalNextCursor =
    nextCursor > 0
      ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1]
          .originalIndex + 1
      : cursor;
  startSessionFromPool(items, {
    mode: "normal",
    sequential: true,
    startCursor: cursor,
    nextCursor: globalNextCursor,
    forceShuffleQ: false,
    alreadyShuffled: true,
  });
}
function startPracticeWrong(options = {}) {
  const form = readSetupForm();
  persistSetupForm();
  const allDeck = options.allDeck === true;
  const qs = allDeck ? currentQuestions() : selectedQuestions(form);
  const rangeIndices = new Set(qs.map((question) => question.originalIndex));
  const sourceIndices = Array.isArray(options.indices)
    ? options.indices
    : allDeck
      ? getWrongIndices(state.currentDeck)
      : getRangeWrongIndices(
          state.currentDeck,
          form.startQuestion,
          form.endQuestion,
        );
  const wrongs = [...new Set(sourceIndices)].filter((index) =>
    rangeIndices.has(index),
  );
  if (!wrongs.length) {
    toast(
      allDeck
        ? "Bộ đề này chưa có câu sai để ôn."
        : "Trong vùng câu hỏi đã chọn không có câu sai để ôn.",
    );
    return;
  }
  const pool = pickWrong(
    qs,
    wrongs,
    allDeck ? wrongs.length : form.count,
    form.shuffleQ,
  );
  if (!pool.length) {
    toast(
      "Không tìm thấy câu sai hợp lệ trong bộ đề đã chọn. Hãy tải lại bộ đề.",
    );
    return;
  }
  const practiceSaveFailed = pool.some(
    (question) =>
      markPracticed(state.currentDeck, question.originalIndex) === null,
  );
  if (practiceSaveFailed)
    toast("Không thể lưu thống kê ôn lại vào trình duyệt.");
  startSessionFromPool(pool, {
    mode: "practice-wrong",
    sequential: false,
    forceShuffleQ: form.shuffleQ,
    alreadyShuffled: true,
    ...(allDeck
      ? { rangeStart: 1, rangeEnd: qs.length, requestedCount: pool.length }
      : {}),
  });
}
function recordWrongAnswer(session, originalIndex) {
  if (markWrong(session.deckId, originalIndex) === null) {
    toast("Không thể lưu lịch sử câu sai vào trình duyệt.");
  }
  if (
    Number.isInteger(session.rangeStart) &&
    Number.isInteger(session.rangeEnd) &&
    !addWrongIndicesForRange(
      session.deckId,
      session.rangeStart,
      session.rangeEnd,
      [originalIndex],
    )
  ) {
    toast("Không thể lưu câu sai riêng cho vùng câu hỏi này.");
  }
}

function currentItem() {
  const s = state.session;
  if (!s) return null;
  return s.items[s.viewIndex];
}

function currentQ() {
  const s = state.session;
  const item = currentItem();
  if (!s || !item) return null;
  return s.pool[item.poolIdx];
}

function renderQuestion() {
  const s = state.session;
  if (!s) return;
  const item = currentItem();
  const q = currentQ();
  if (!item || !q) return;

  const viewingHistory = s.viewIndex < s.maxReached;

  $("progress-label").textContent =
    `Câu ${s.viewIndex + 1} / ${s.items.length}`;
  const progressTotal =
    s.mode === "practice-wrong"
      ? s.practiceInitialCount || s.items.length
      : s.items.length;
  $("progress-score").textContent =
    `Điểm ${formatScore(s.firstTryCorrect || 0, progressTotal)} / 10`;
  updateTimerDisplay();
  const pct = progressTotal
    ? Math.round((s.completedInSession / progressTotal) * 100)
    : 0;
  $("progress-fill").style.width = `${pct}%`;
  $("progress-fill").parentElement.setAttribute("aria-valuenow", String(pct));

  $("q-badge").textContent =
    s.mode === "practice-wrong"
      ? `Ôn câu sai · Gốc #${q.originalIndex + 1}`
      : s.mode === "practice-bookmarks"
        ? `Ôn câu đã đánh dấu · Gốc #${q.originalIndex + 1}`
        : s.mode === "search"
          ? `Ôn kết quả tìm kiếm · Gốc #${q.originalIndex + 1}`
          : `Câu hỏi · Gốc #${q.originalIndex + 1}`;
  const bookmarkButton = $("btn-bookmark");
  const isBookmarked = getBookmarkedIndices(s.deckId).includes(q.originalIndex);
  bookmarkButton.textContent = isBookmarked ? "Đã đánh dấu" : "Đánh dấu";
  bookmarkButton.classList.toggle("is-bookmarked", isBookmarked);
  bookmarkButton.setAttribute("aria-pressed", String(isBookmarked));
  renderTextWithHighlights(
    $("q-text"),
    q.question,
    s.deckId,
    q.originalIndex,
    "question",
  );
  const highlightToolbar = $("quiz-highlight-toolbar");
  if (highlightToolbar) highlightToolbar.hidden = s.examMode === true;

  const optsEl = $("options");
  optsEl.replaceChildren();
  const labels = ["A", "B", "C", "D", "E", "F"];
  item.optionOrder.forEach((origIdx, displayIdx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.setAttribute("aria-pressed", String(item.userAnswer === displayIdx));
    btn.dataset.display = String(displayIdx);

    if (item.userAnswer === displayIdx) btn.classList.add("selected");
    if (
      item.checked &&
      item.status === "correct" &&
      displayIdx === item.userAnswer
    ) {
      btn.classList.add("correct", "answer-bounce");
    }
    if (
      item.checked &&
      item.status === "wrong" &&
      displayIdx === item.userAnswer
    ) {
      btn.classList.add("incorrect", "answer-shake");
    }
    const wrongOptions = Array.isArray(item.wrongOptions)
      ? item.wrongOptions
      : [];
    if (wrongOptions.includes(origIdx)) {
      btn.classList.add("incorrect", "locked");
      btn.disabled = true;
    }
    if (item.status === "correct") {
      btn.classList.add("locked");
      btn.disabled = true;
      if (displayIdx === displayedCorrectIndex(item, q))
        btn.classList.add("correct");
    } else if (viewingHistory) {
      btn.disabled = true;
      btn.classList.add("locked");
    }

    const key = document.createElement("span");
    key.className = "option-key";
    key.textContent = labels[displayIdx] || String(displayIdx + 1);
    const text = document.createElement("span");
    text.className = "option-text";
    renderTextWithHighlights(
      text,
      q.options[origIdx],
      s.deckId,
      q.originalIndex,
      `option:${origIdx}`,
    );
    btn.append(key, text);

    if (!btn.disabled) {
      btn.addEventListener("click", () => {
        const selection = window.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          selection.toString().trim()
        ) {
          const range = selection.getRangeAt(0);
          const startNode =
            range.startContainer.nodeType === Node.ELEMENT_NODE
              ? range.startContainer
              : range.startContainer.parentElement;
          const endNode =
            range.endContainer.nodeType === Node.ELEMENT_NODE
              ? range.endContainer
              : range.endContainer.parentElement;
          if (btn.contains(startNode) && btn.contains(endNode)) {
            captureHighlightSelection();
            return;
          }
        }
        onSelectOption(displayIdx);
      });
    }
    optsEl.appendChild(btn);
  });

  const feedback = $("feedback");
  if (item.checked && item.status === "correct") {
    feedback.hidden = false;
    feedback.className = "feedback ok";
    feedback.textContent = "Chính xác!";
  } else if (item.checked && item.status === "wrong") {
    feedback.hidden = false;
    feedback.className = "feedback bad";
    feedback.textContent = "Chưa đúng. Hãy chọn lại đáp án khác.";
  } else {
    feedback.hidden = true;
    feedback.textContent = "";
  }

  $("btn-prev").disabled = s.viewIndex <= 0;
  const nextButton = $("btn-next");
  if (viewingHistory) {
    nextButton.textContent = "Câu tiếp";
    nextButton.dataset.icon = "chevron-right";
    nextButton.disabled = s.viewIndex >= s.maxReached;
  } else if (item.status === "correct") {
    const isLastQuestion = s.viewIndex === s.items.length - 1;
    const shouldFinish = isLastQuestion && s.mode !== "practice-wrong";
    nextButton.textContent = shouldFinish ? "Kết thúc" : "Câu tiếp";
    nextButton.dataset.icon = shouldFinish ? "check" : "chevron-right";
    nextButton.disabled = false;
  } else if (
    s.mode === "practice-wrong" &&
    item.status === "wrong" &&
    item.checked
  ) {
    nextButton.textContent = "Câu tiếp";
    nextButton.dataset.icon = "chevron-right";
    nextButton.disabled = false;
  } else {
    nextButton.textContent = "Kiểm tra";
    nextButton.dataset.icon = "check";
    nextButton.disabled = item.userAnswer == null || item.checked;
  }
}

function setPracticeMode(mode) {
  state.practiceMode = mode === "exam" ? "exam" : "practice";
  document.querySelectorAll("#screen-setup .mode-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === state.practiceMode);
  });
  const startBtn = $("btn-start");
  if (startBtn) {
    startBtn.textContent =
      state.practiceMode === "exam" ? "Bắt đầu thi thử" : "Bắt đầu ôn luyện";
  }
  persistSetupForm();
  if (state.mode === "setup" && state.decks.quocphong1) refreshSetupUI();
}

function updateExamProgressHeader() {
  const s = state.session;
  if (!s || !s.examMode) return;
  const answered = s.items.filter((it) => it.userAnswer != null).length;
  const unanswered = s.items.length - answered;
  $("exam-progress-label").textContent = s.reviewMode
    ? `Kết quả · ${s.firstTryCorrect || 0}/${s.items.length} đúng`
    : `Đã chọn ${answered} / ${s.items.length}`;
  const pct = s.items.length
    ? Math.round((answered / s.items.length) * 100)
    : 0;
  const fill = $("exam-progress-fill");
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.parentElement?.setAttribute("aria-valuenow", String(pct));
  }
  updateTimerDisplay();
  const filterWrong = $("exam-filter-wrong");
  const filterCorrect = $("exam-filter-correct");
  if (filterWrong) filterWrong.hidden = !s.reviewMode;
  if (filterCorrect) filterCorrect.hidden = !s.reviewMode;
  const nextEmpty = $("btn-exam-next-empty");
  if (nextEmpty) {
    nextEmpty.hidden = s.reviewMode || unanswered === 0;
    nextEmpty.textContent = unanswered ? `Còn ${unanswered} câu` : "Đủ đáp án";
  }
  const pauseBtn = $("btn-exam-pause");
  if (pauseBtn) pauseBtn.hidden = !!s.reviewMode;
  const submitBtn = $("btn-exam-submit");
  if (submitBtn) {
    if (s.reviewMode) {
      submitBtn.textContent = "Xem tổng kết";
      submitBtn.dataset.icon = "list-check";
      submitBtn.disabled = false;
    } else {
      submitBtn.textContent = "Nộp bài";
      submitBtn.dataset.icon = "check";
      submitBtn.disabled = !!state.examSubmitting;
    }
  }
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle(
      "is-active",
      chip.dataset.filter === state.examFilter,
    );
  });
}

function applyExamFilter() {
  const s = state.session;
  if (!s?.examMode) return;
  const filter = state.examFilter || "all";
  s.items.forEach((item, idx) => {
    const card = $(`exam-q-${idx}`);
    if (!card) return;
    let show = true;
    if (filter === "unanswered") show = item.userAnswer == null;
    else if (filter === "wrong") show = item.status === "wrong";
    else if (filter === "correct") show = item.status === "correct";
    card.hidden = !show;
  });
}

function scrollToExamQuestion(idx) {
  const card = $(`exam-q-${idx}`);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function jumpToNextUnanswered(fromIdx = -1) {
  const s = state.session;
  if (!s?.examMode || s.reviewMode) return;
  const start = fromIdx + 1;
  let found = s.items.findIndex((it, i) => i >= start && it.userAnswer == null);
  if (found < 0) found = s.items.findIndex((it) => it.userAnswer == null);
  if (found >= 0) {
    state.examFilter = "all";
    applyExamFilter();
    updateExamProgressHeader();
    scrollToExamQuestion(found);
  } else {
    toast("Bạn đã chọn đủ đáp án.");
  }
}

function renderExam() {
  const s = state.session;
  if (!s || !s.examMode) return;
  const list = $("exam-list");
  const nav = $("exam-nav");
  if (!list || !nav) return;
  const scrollY = window.scrollY;
  list.replaceChildren();
  nav.replaceChildren();
  const labels = ["A", "B", "C", "D", "E", "F"];
  updateExamProgressHeader();

  s.items.forEach((item, idx) => {
    const q = s.pool[item.poolIdx];
    const card = document.createElement("article");
    card.className = "exam-q-card";
    card.id = `exam-q-${idx}`;
    if (item.userAnswer != null) card.classList.add("is-answered");
    if (s.reviewMode) {
      if (item.status === "correct") card.classList.add("is-correct");
      else if (item.status === "wrong") card.classList.add("is-wrong");
    }

    const head = document.createElement("div");
    head.className = "exam-q-head";
    const num = document.createElement("span");
    num.className = "exam-q-num";
    num.textContent = `Câu ${idx + 1} · Gốc #${q.originalIndex + 1}`;
    head.appendChild(num);
    if (s.reviewMode) {
      const badge = document.createElement("span");
      badge.className = `exam-status-badge ${item.status === "correct" ? "ok" : "bad"}`;
      badge.textContent =
        item.status === "correct"
          ? "Đúng"
          : item.userAnswer == null
            ? "Bỏ trống"
            : "Sai";
      head.appendChild(badge);
    }
    card.appendChild(head);

    const text = document.createElement("h3");
    text.className = "exam-q-text";
    text.textContent = q.question;
    card.appendChild(text);

    const opts = document.createElement("div");
    opts.className = "exam-options options";
    opts.setAttribute("role", "group");
    opts.setAttribute("aria-label", `Đáp án câu ${idx + 1}`);

    item.optionOrder.forEach((origIdx, displayIdx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.dataset.q = String(idx);
      btn.dataset.display = String(displayIdx);
      btn.setAttribute("aria-pressed", String(item.userAnswer === displayIdx));
      if (item.userAnswer === displayIdx) btn.classList.add("selected");
      if (s.reviewMode) {
        btn.disabled = true;
        const correctDisplay = item.optionOrder.indexOf(q.correct);
        if (displayIdx === correctDisplay) btn.classList.add("correct");
        if (item.userAnswer === displayIdx && item.status === "wrong")
          btn.classList.add("incorrect");
      }
      const label = document.createElement("span");
      label.className = "option-key";
      label.textContent = labels[displayIdx] || String(displayIdx + 1);
      const body = document.createElement("span");
      body.className = "option-text";
      body.textContent = q.options[origIdx];
      btn.append(label, body);
      if (!s.reviewMode) {
        btn.addEventListener("click", () => onExamSelect(idx, displayIdx));
      }
      opts.appendChild(btn);
    });
    card.appendChild(opts);
    list.appendChild(card);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "exam-nav-dot";
    dot.textContent = String(idx + 1);
    dot.title = `Câu ${idx + 1}`;
    dot.dataset.idx = String(idx);
    if (item.userAnswer != null) dot.classList.add("is-answered");
    if (s.reviewMode) {
      if (item.status === "correct") dot.classList.add("is-correct");
      else if (item.status === "wrong") dot.classList.add("is-wrong");
    }
    dot.addEventListener("click", () => scrollToExamQuestion(idx));
    nav.appendChild(dot);
  });

  applyExamFilter();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function patchExamQuestion(qIdx) {
  const s = state.session;
  if (!s?.examMode) return;
  const item = s.items[qIdx];
  const card = $(`exam-q-${qIdx}`);
  if (!item || !card) {
    renderExam();
    return;
  }
  card.classList.toggle("is-answered", item.userAnswer != null);
  card.querySelectorAll(".option").forEach((btn) => {
    const displayIdx = Number(btn.dataset.display);
    const selected = item.userAnswer === displayIdx;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  const dot = $("exam-nav")?.querySelector(`.exam-nav-dot[data-idx="${qIdx}"]`);
  if (dot) dot.classList.toggle("is-answered", item.userAnswer != null);
  updateExamProgressHeader();
  applyExamFilter();
}

function onExamSelect(qIdx, displayIdx) {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s || s.reviewMode || !s.examMode || state.examSubmitting) return;
  const item = s.items[qIdx];
  if (!item) return;
  item.userAnswer = displayIdx;
  item.checked = false;
  item.status = "pending";
  persistSession();
  patchExamQuestion(qIdx);
}

async function onExamSubmit() {
  if (state.examSubmitting) return;
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s || !s.examMode) return;
  if (s.reviewMode) {
    finishSession();
    return;
  }
  const unanswered = s.items.filter((it) => it.userAnswer == null).length;
  if (unanswered > 0) {
    const ok = await confirmModal(
      "Còn câu chưa chọn",
      `Bạn còn ${unanswered} câu chưa chọn đáp án. Vẫn nộp bài?`,
    );
    if (!ok) return;
  } else {
    const ok = await confirmModal(
      "Nộp bài thi?",
      `Bạn đã chọn đủ ${s.items.length} câu. Nộp bài để xem kết quả?`,
    );
    if (!ok) return;
  }

  // The deadline may expire while the confirmation dialog is open.
  if (enforceSessionDeadline() || state.session !== s || s.reviewMode) return;
  state.examSubmitting = true;
  updateExamProgressHeader();
  try {
    let firstTry = 0;
    let wrongAttempts = 0;
    const completedIdx = [];
    for (const item of s.items) {
      const q = s.pool[item.poolIdx];
      if (item.userAnswer == null) {
        item.status = "wrong";
        item.checked = true;
        item.wrongCount = 1;
        wrongAttempts += 1;
        recordWrongAnswer(s, q.originalIndex);
        continue;
      }
      const correct = isAnswerCorrect(item, q);
      item.checked = true;
      if (correct) {
        item.status = "correct";
        firstTry += 1;
        completedIdx.push(q.originalIndex);
      } else {
        item.status = "wrong";
        item.wrongCount = 1;
        wrongAttempts += 1;
        const wrongOriginalIndex = item.optionOrder[item.userAnswer];
        if (!item.wrongOptions) item.wrongOptions = [];
        if (!item.wrongOptions.includes(wrongOriginalIndex))
          item.wrongOptions.push(wrongOriginalIndex);
        recordWrongAnswer(s, q.originalIndex);
      }
    }
    if (completedIdx.length)
      addCompleted(s.deckId, completedIdx, state.fingerprints[s.deckId]);
    s.firstTryCorrect = firstTry;
    s.totalWrongAttempts = wrongAttempts;
    s.completedInSession = s.items.length;
    s.reviewMode = true;
    state.reviewMode = true;
    state.examFilter = "all";
    stopSessionTimer(true);
    persistSession();
    renderExam();
    toast(
      `Đã chấm bài: ${firstTry}/${s.items.length} đúng · Điểm ${formatScore(firstTry, s.items.length)}/10`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    state.examSubmitting = false;
    updateExamProgressHeader();
  }
}

function enforceSessionDeadline() {
  const session = state.session;
  if (
    !session ||
    !(session.timeLimit > 0) ||
    !session.deadlineAt ||
    Date.now() < session.deadlineAt
  )
    return false;
  session.timeExpired = true;
  if (session.examMode && !session.reviewMode) {
    session.reviewMode = true;
    state.reviewMode = true;
    let firstTry = 0;
    let wrongAttempts = 0;
    const completedIdx = [];
    for (const item of session.items) {
      const q = session.pool[item.poolIdx];
      item.checked = true;
      if (item.userAnswer != null && isAnswerCorrect(item, q)) {
        item.status = "correct";
        firstTry += 1;
        completedIdx.push(q.originalIndex);
      } else {
        item.status = "wrong";
        item.wrongCount = Math.max(1, item.wrongCount || 0);
        wrongAttempts += 1;
        recordWrongAnswer(session, q.originalIndex);
      }
    }
    if (completedIdx.length)
      addCompleted(
        session.deckId,
        completedIdx,
        state.fingerprints[session.deckId],
      );
    session.firstTryCorrect = firstTry;
    session.totalWrongAttempts = wrongAttempts;
    session.completedInSession = session.items.length;
    state.examFilter = "all";
    stopSessionTimer(true);
    persistSession();
    renderExam();
    toast("Hết giời.");
    return true;
  }
  finishSession();
  return true;
}

function onSelectOption(displayIdx) {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  const item = currentItem();
  if (!s || !item) return;
  if (item.status === "correct" || s.viewIndex < s.maxReached) return;
  const q = currentQ();
  if (
    !q ||
    (Array.isArray(item.wrongOptions) &&
      item.wrongOptions.includes(item.optionOrder[displayIdx]))
  )
    return;

  item.userAnswer = displayIdx;
  if (item.status === "wrong") {
    item.checked = false;
    item.status = "pending";
  }
  persistSession();
  renderQuestion();
  if (sessionPreferences(s.deckId).autoCheck) onCheck();
}

const answerSounds = {
  correct: new Audio(dataUrl("assets/sounds/correct.mp3")),
  incorrect: new Audio(dataUrl("assets/sounds/incorrect.mp3")),
};

for (const audio of Object.values(answerSounds)) {
  audio.preload = "auto";
  audio.load();
}

function playAnswerSound(isCorrect) {
  if (
    sessionPreferences(state.session?.deckId || state.currentDeck)
      .soundEnabled === false
  )
    return;
  const audio = answerSounds[isCorrect ? "correct" : "incorrect"];
  try {
    audio.pause();
    audio.currentTime = 0;
    const playback = audio.play();
    if (playback && typeof playback.catch === "function")
      playback.catch(() => {});
  } catch (error) {
    console.warn("Không thể phát âm thanh đáp án:", error);
  }
}

function onCheck() {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  const item = currentItem();
  const q = currentQ();
  if (!s || !item || !q || item.userAnswer == null) return;
  if (item.status === "correct" || item.checked || s.viewIndex < s.maxReached)
    return;

  item.checked = true;
  if (!Array.isArray(item.wrongOptions)) item.wrongOptions = [];
  const isCorrect = isAnswerCorrect(item, q);
  const preferences = sessionPreferences(s.deckId);
  const vibrate = (pattern) => {
    if (
      preferences.vibrationEnabled !== false &&
      typeof navigator.vibrate === "function"
    ) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  };
  if (isCorrect) {
    playAnswerSound(true);
    vibrate(18);
    const wasAlreadyCorrect = item.status === "correct";
    const firstTime = item.wrongCount === 0 && !wasAlreadyCorrect;
    item.status = "correct";
    if (!wasAlreadyCorrect) {
      if (s.mode === "practice-wrong") {
        if (!Array.isArray(s.practiceCompletedIndices))
          s.practiceCompletedIndices = [];
        const originalIndex = q.originalIndex;
        if (!s.practiceCompletedIndices.includes(originalIndex)) {
          s.practiceCompletedIndices.push(originalIndex);
          s.completedInSession = s.practiceCompletedIndices.length;
          if (firstTime) s.firstTryCorrect += 1;
        }
      } else {
        s.completedInSession += 1;
        if (firstTime) s.firstTryCorrect += 1;
      }
    }
    if (s.viewIndex >= s.maxReached) s.maxReached = s.viewIndex;
    s.reviewingPast = false;
  } else {
    playAnswerSound(false);
    vibrate([28, 45, 28]);
    item.status = "wrong";
    const wrongOriginalIndex = item.optionOrder[item.userAnswer];
    if (!item.wrongOptions.includes(wrongOriginalIndex))
      item.wrongOptions.push(wrongOriginalIndex);
    item.wrongCount += 1;
    s.totalWrongAttempts += 1;
    if (s.mode === "practice-wrong") {
      if (!Array.isArray(s.practiceWrongHistory)) s.practiceWrongHistory = [];
      const history = s.practiceWrongHistory.find(
        (entry) => entry.originalIndex === q.originalIndex,
      );
      if (history) history.wrongCount += 1;
      else
        s.practiceWrongHistory.push({
          originalIndex: q.originalIndex,
          question: q.question,
          wrongCount: 1,
        });
    }
    recordWrongAnswer(s, q.originalIndex);
  }
  persistSession();
  renderQuestion();
  if (
    isCorrect &&
    preferences.autoAdvance === true &&
    s.viewIndex < s.items.length - 1
  ) {
    setTimeout(
      () => {
        if (
          state.session === s &&
          currentItem() === item &&
          item.status === "correct" &&
          s.viewIndex < s.items.length - 1
        )
          onNext();
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350,
    );
  }
}

function onNext() {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s) return;
  const item = currentItem();
  if (!item) return;

  if (
    s.viewIndex >= s.maxReached &&
    item.status !== "correct" &&
    !(s.mode === "practice-wrong" && item.status === "wrong" && item.checked)
  ) {
    onCheck();
    return;
  }

  if (s.viewIndex < s.maxReached) {
    s.viewIndex += 1;
    s.reviewingPast = s.viewIndex < s.maxReached;
    persistSession();
    renderQuestion();
    return;
  }

  if (
    item.status !== "correct" &&
    !(s.mode === "practice-wrong" && item.status === "wrong")
  ) {
    toast("Hãy kiểm tra câu trả lời trước khi sang câu tiếp.");
    return;
  }

  if (s.viewIndex >= s.items.length - 1) {
    if (s.mode === "practice-wrong") {
      const unresolved = s.items.filter((entry) => entry.status !== "correct");
      if (!unresolved.length) {
        finishSession();
        return;
      }
      s.items = unresolved.map((entry) => ({
        ...entry,
        optionOrder: entry.optionOrder.slice(),
        userAnswer: null,
        status: "pending",
        checked: false,
      }));
      s.viewIndex = 0;
      s.maxReached = 0;
      s.reviewingPast = false;
      persistSession();
      renderQuestion();
      toast(
        `Còn ${s.items.length} câu chưa trả lời đúng. Tiếp tục ôn các câu này.`,
        3500,
      );
      return;
    }
    finishSession();
    return;
  }

  s.viewIndex += 1;
  if (s.viewIndex > s.maxReached) s.maxReached = s.viewIndex;
  s.reviewingPast = false;
  persistSession();
  renderQuestion();
}

function onPrev() {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s || s.viewIndex <= 0) return;
  s.viewIndex -= 1;
  s.reviewingPast = true;
  persistSession();
  renderQuestion();
}

function persistSession() {
  if (!state.session) return;
  if (!saveSession(state.session)) {
    toast(
      "Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.",
    );
  }
}

function pauseSession() {
  const session = state.session;
  if (!session || session.reviewMode || session.finishedAt || session.pausedAt)
    return;
  session.pausedAt = Date.now();
  session.remainingMs =
    session.timeLimit > 0 && session.deadlineAt
      ? Math.max(0, session.deadlineAt - session.pausedAt)
      : null;
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (!saveSession(session)) {
    session.pausedAt = null;
    session.remainingMs = null;
    startSessionTimer();
    toast("Không thể tạm dừng an toàn vì bộ nhớ trình duyệt không ghi được.");
    return;
  }
  state.session = null;
  state.reviewMode = false;
  showScreen("setup");
  refreshSetupUI();
  toast("Đã tạm dừng. Bạn có thể tiếp tục từ thẻ phiên đang dở.");
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatScore(correct, total) {
  if (!(total > 0)) return "0";
  const score = Math.round((Math.max(0, correct) / total) * 100) / 10;
  return score.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

function animateScore(target, displayStr, circumference) {
  const scoreBig = $("sum-score-big");
  const ringFg = $("score-ring-fg");
  if (!scoreBig || !ringFg) return;

  const duration = 1100;
  const start = performance.now();

  let color = "var(--primary)";
  if (target >= 8) color = "#22c55e";
  else if (target >= 5) color = "#eab308";
  else color = "#ef4444";

  ringFg.style.stroke = color;
  scoreBig.style.color = color;
  ringFg.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = target * eased;

    const shown = Math.round(current * 10) / 10;
    scoreBig.textContent = shown.toLocaleString("vi-VN", {
      maximumFractionDigits: 1,
    });

    const pct = Math.max(0, Math.min(1, current / 10));
    ringFg.style.strokeDashoffset = `${circumference * (1 - pct)}`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      scoreBig.textContent = displayStr;
      ringFg.style.strokeDashoffset = `${circumference * (1 - target / 10)}`;

      scoreBig.style.transition = "transform 0.25s ease";
      scoreBig.style.transform = "scale(1.08)";
      setTimeout(() => {
        scoreBig.style.transform = "scale(1)";
      }, 220);
    }
  }

  requestAnimationFrame(frame);
}

function getElapsedSeconds(session = state.session) {
  if (!session) return 0;
  const startedAt = Number(session.startedAt) || Date.now();
  let end = Date.now();
  if (session.finishedAt) end = Number(session.finishedAt);
  else if (session.pausedAt) end = Number(session.pausedAt);
  else if (session.timeExpired && session.deadlineAt)
    end = Number(session.deadlineAt);
  const pausedDuration = Math.max(0, Number(session.pausedDurationMs) || 0);
  return Math.max(0, Math.floor((end - startedAt - pausedDuration) / 1000));
}

function updateTimerDisplay() {
  const s = state.session;
  const el = s?.examMode ? $("exam-progress-time") : $("progress-time");
  if (!el) return;
  if (!s) {
    el.hidden = true;
    return;
  }
  const elapsed = getElapsedSeconds(s);
  const stopped = !!s.finishedAt || !!s.reviewMode || !!s.pausedAt;
  const hasLimit =
    Number(s.timeLimit) > 0 && Number(s.deadlineAt) > 0 && !stopped;
  const remaining = hasLimit
    ? Math.max(0, Math.ceil((s.deadlineAt - Date.now()) / 1000))
    : null;
  el.hidden = false;
  if (stopped) {
    el.textContent =
      s.pausedAt && !s.finishedAt && !s.reviewMode
        ? `Tạm dừng · ${formatTime(elapsed)}`
        : `Hoàn thành · ${formatTime(elapsed)}`;
    el.classList.remove("time-warning");
  } else {
    el.textContent = hasLimit
      ? `Thời gian ${formatTime(remaining)}`
      : `Thời gian ${formatTime(elapsed)}`;
    el.classList.toggle("time-warning", hasLimit && remaining <= 60);
  }
}

function startSessionTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (!state.session) {
    updateTimerDisplay();
    return;
  }
  if (
    state.session.finishedAt ||
    state.session.reviewMode ||
    state.session.pausedAt
  ) {
    updateTimerDisplay();
    return;
  }
  const tick = () => {
    const session = state.session;
    if (!session) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      return;
    }
    if (session.finishedAt || session.reviewMode || session.pausedAt) {
      stopSessionTimer(false);
      return;
    }
    updateTimerDisplay();
    if (
      session.timeLimit > 0 &&
      session.deadlineAt &&
      Date.now() >= session.deadlineAt
    ) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      enforceSessionDeadline();
    }
  };
  tick();
  if (state.session && !state.session.finishedAt && !state.session.reviewMode) {
    state.timerInterval = setInterval(tick, 1000);
  }
}

function finishSession() {
  const s = state.session;
  if (!s) return;
  stopSessionTimer(true);

  if (s.mode !== "practice-wrong") {
    const completedIdx = s.items
      .filter((it) => it.status === "correct")
      .map((it) => s.pool[it.poolIdx].originalIndex);
    const progressSaved = addCompleted(
      s.deckId,
      completedIdx,
      state.fingerprints[s.deckId],
    );
    if (!progressSaved) {
      toast(
        "Không thể lưu tiến độ hoàn thành. Hãy kiểm tra dung lượng bộ nhớ trình duyệt.",
      );
    } else if (
      s.sequential &&
      s.nextCursor != null &&
      !setSequentialCursor(s.deckId, s.nextCursor, state.fingerprints[s.deckId])
    ) {
      toast("Không thể lưu vị trí tuần tự của bộ đề.");
    }
  }

  const wrongInSession = [];
  const seen = new Set();
  if (s.mode === "practice-wrong" && Array.isArray(s.practiceWrongHistory)) {
    for (const entry of s.practiceWrongHistory) {
      if (!seen.has(entry.originalIndex)) {
        seen.add(entry.originalIndex);
        wrongInSession.push({ ...entry });
      }
    }
  } else {
    for (const it of s.items) {
      if (it.wrongCount > 0) {
        const oi = s.pool[it.poolIdx].originalIndex;
        if (!seen.has(oi)) {
          seen.add(oi);
          wrongInSession.push({
            originalIndex: oi,
            question: s.pool[it.poolIdx].question,
            wrongCount: it.wrongCount,
          });
        }
      }
    }
  }

  const scoreTotal =
    s.mode === "practice-wrong"
      ? s.practiceInitialCount || s.items.length
      : s.items.length;
  s.summary = {
    total: scoreTotal,
    score: formatScore(s.firstTryCorrect || 0, scoreTotal),
    elapsedSeconds: getElapsedSeconds(s),
    timeExpired: !!s.timeExpired,
    correct: s.firstTryCorrect || 0,
    wrongQuestions: wrongInSession.length,
    wrongAttempts: s.totalWrongAttempts,
    practiceQuestions:
      s.mode === "practice-wrong"
        ? s.practiceInitialCount || s.items.length
        : 0,
    firstTryRate: (
      s.mode === "practice-wrong" ? s.practiceInitialCount : s.items.length
    )
      ? Math.round(
          (s.firstTryCorrect /
            (s.mode === "practice-wrong"
              ? s.practiceInitialCount
              : s.items.length)) *
            100,
        )
      : 0,
    wrongList: wrongInSession,
    sequential: s.sequential,
    nextCursor: s.nextCursor,
    mode: s.mode,
  };

  if (
    Number.isInteger(s.rangeStart) &&
    Number.isInteger(s.rangeEnd) &&
    wrongInSession.length
  ) {
    if (
      !addWrongIndicesForRange(
        s.deckId,
        s.rangeStart,
        s.rangeEnd,
        wrongInSession.map((entry) => entry.originalIndex),
      )
    ) {
      toast("Không thể lưu câu sai riêng cho vùng câu hỏi này.");
    }
  }
  state._lastSummarySession = {
    deckId: s.deckId,
    mode: s.examMode || s.mode === "exam" ? "exam" : "practice",
    sourceMode: s.mode,
    indices: [...new Set(s.pool.map((question) => question.originalIndex))],
    rangeStart: Number.isInteger(s.rangeStart) ? s.rangeStart : 1,
    rangeEnd: Number.isInteger(s.rangeEnd)
      ? s.rangeEnd
      : (state.decks[s.deckId] || []).length,
    requestedCount: s.items.length,
    timeLimit: Number.isInteger(s.timeLimit) ? s.timeLimit : 0,
  };
  state._lastSummaryWrongIndices = wrongInSession.map(
    (entry) => entry.originalIndex,
  );
  state._lastSummaryRangeStart = Number.isInteger(s.rangeStart)
    ? s.rangeStart
    : null;
  state._lastSummaryRangeEnd = Number.isInteger(s.rangeEnd) ? s.rangeEnd : null;
  state._lastSummaryCount = Number.isInteger(s.requestedCount)
    ? s.requestedCount
    : s.items.length;

  const sessionCleared = clearSession(s.deckId);
  state.session = null;
  if (!sessionCleared)
    toast(
      "Không thể xóa phiên đã lưu. Nếu tải lại trang, phiên cũ có thể xuất hiện lại.",
    );
  showSummary(s.summary, s.deckId, s.mode);
}

function showSummary(summary, deckId, mode) {
  showScreen("summary");
  $("summary-title").textContent =
    mode === "practice-wrong"
      ? "Kết thúc ôn câu sai"
      : mode === "practice-bookmarks"
        ? "Hoàn thành ôn câu đã đánh dấu"
        : mode === "search"
          ? "Hoàn thành ôn kết quả tìm kiếm"
          : mode === "exam"
            ? "Kết quả thi thử"
            : "Hoàn thành lượt ôn";
  const scoreVal = summary.score ?? formatScore(summary.correct, summary.total);
  const scoreNum = Number(String(scoreVal).replace(",", ".")) || 0;

  $("sum-total").textContent = String(summary.total);
  $("sum-score").textContent = `${scoreVal} / 10`;

  const scoreBig = $("sum-score-big");
  const ringFg = $("score-ring-fg");
  const circumference = 2 * Math.PI * 52;

  if (ringFg) {
    ringFg.style.strokeDasharray = `${circumference}`;
    ringFg.style.strokeDashoffset = `${circumference}`;
    ringFg.style.transition = "none";
    ringFg.style.stroke = "var(--primary)";
  }
  if (scoreBig) {
    scoreBig.textContent = "0";
    scoreBig.style.transform = "scale(1)";
    scoreBig.style.color = "var(--primary)";
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      animateScore(scoreNum, scoreVal, circumference);
    });
  });
  $("sum-time").textContent = formatTime(summary.elapsedSeconds || 0);
  $("sum-correct").textContent = String(summary.correct);
  $("sum-wrong-q").textContent = String(summary.wrongQuestions);
  $("sum-wrong-times").textContent = String(summary.wrongAttempts);
  $("sum-practice").textContent = String(summary.practiceQuestions || 0);
  $("sum-first").textContent = `${summary.firstTryRate}%`;

  const totalQuestions = (state.decks[deckId] || []).length;
  const progressAfterSession = getDeckProgress(deckId);
  const completedAfterSession = new Set(progressAfterSession.completed).size;
  $("summary-note").textContent = summary.timeExpired
    ? "Đã hết giờ. Bài làm được tự động kết thúc."
    : completedAfterSession >= totalQuestions
      ? `Bạn đã hoàn thành toàn bộ bộ đề ${DECKS[deckId].label}.`
      : summary.wrongQuestions === 0
        ? "Xuất sắc! Bạn không mắc lỗi nào trong lượt này."
        : "Bạn có thể ôn lại các câu sai hoặc tiếp tục với những câu chưa hoàn thành.";

  const listCard = $("wrong-list-card");
  const list = $("wrong-list");
  list.replaceChildren();
  if (summary.wrongList.length) {
    listCard.hidden = false;
    for (const w of summary.wrongList) {
      const li = document.createElement("li");
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = `#${w.originalIndex + 1}`;
      li.append(idx, document.createTextNode(w.question));
      list.appendChild(li);
    }
  } else {
    listCard.hidden = true;
  }

  state.currentDeck = deckId;
  const retryButton = $("btn-sum-retry-session");
  retryButton.hidden = !["normal", "exam"].includes(mode);
  retryButton.textContent =
    mode === "exam" ? "Thi lại lượt thi này" : "Ôn lại lượt ôn này";

  const btnPractice = $("btn-sum-practice");
  const sessionWrong = [
    ...new Set(summary.wrongList.map((entry) => entry.originalIndex)),
  ];
  state._lastSummaryWrongIndices = sessionWrong;
  btnPractice.hidden = sessionWrong.length === 0;
  btnPractice.textContent = `Ôn lại ${sessionWrong.length} câu sai trong lượt này`;

  const progress = getDeckProgress(deckId);
  const btnContinue = $("btn-sum-continue");
  const form = readSetupForm();
  const rangeEnd = form.endQuestion;
  const nextIndex = Math.max(progress.sequentialCursor, form.startQuestion - 1);
  const canSeq = summary.sequential && nextIndex < rangeEnd;
  btnContinue.hidden = !canSeq;
  if (canSeq) {
    const left = rangeEnd - nextIndex;
    const settings = getSettings(deckId);
    const n = Math.min(settings.count || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự (${n} câu trong vùng)`;
  }

  state._lastSummaryDeck = deckId;
}

function restoreSessionIfAny() {
  const saved = getSession(state.currentDeck);
  if (!saved) return false;
  if (
    !["quocphong1", "quocphong2"].includes(saved.deckId) ||
    !Array.isArray(saved.items) ||
    !Array.isArray(saved.pool)
  ) {
    clearSession(state.currentDeck);
    return false;
  }
  if (!state.decks[saved.deckId]) {
    clearSession(state.currentDeck);
    return false;
  }
  const fp = state.fingerprints[saved.deckId];
  const legacyCompatible =
    !saved.dataFingerprint && state.legacyFingerprintMatched[saved.deckId];
  const validPool =
    saved.pool.length > 0 &&
    saved.pool.every(
      (question) =>
        question &&
        Number.isInteger(question.originalIndex) &&
        question.originalIndex >= 0 &&
        typeof question.question === "string" &&
        Array.isArray(question.options) &&
        question.options.length >= 2 &&
        Number.isInteger(question.correct) &&
        question.correct >= 0 &&
        question.correct < question.options.length,
    );
  const poolMatchesCurrentData = saved.pool.every((question) => {
    const current = state.decks[saved.deckId][question.originalIndex];
    return (
      current &&
      current.question === question.question &&
      current.correct === question.correct &&
      JSON.stringify(current.options) === JSON.stringify(question.options)
    );
  });
  const legacyPoolCompatible = !legacyCompatible || poolMatchesCurrentData;
  const validSession =
    validPool &&
    poolMatchesCurrentData &&
    legacyPoolCompatible &&
    saved.items.length > 0 &&
    Number.isInteger(saved.viewIndex) &&
    saved.viewIndex >= 0 &&
    saved.viewIndex < saved.items.length &&
    Number.isInteger(saved.maxReached) &&
    saved.maxReached >= 0 &&
    saved.maxReached < saved.items.length &&
    saved.viewIndex <= saved.maxReached &&
    saved.items.every((item, index) => {
      if (
        !item ||
        typeof item !== "object" ||
        !Number.isInteger(item.poolIdx) ||
        item.poolIdx < 0 ||
        item.poolIdx >= saved.pool.length
      )
        return false;
      const question = saved.pool[item.poolIdx];
      return (
        Array.isArray(item.optionOrder) &&
        item.optionOrder.length === question.options.length &&
        (item.wrongOptions == null ||
          (Array.isArray(item.wrongOptions) &&
            item.wrongOptions.every(
              (value) =>
                Number.isInteger(value) &&
                value >= 0 &&
                value < question.options.length,
            ))) &&
        new Set(item.optionOrder).size === question.options.length &&
        item.optionOrder.every(
          (index) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < question.options.length,
        ) &&
        ["pending", "wrong", "correct"].includes(item.status) &&
        (index >= saved.maxReached ||
          item.status === "correct" ||
          saved.mode === "practice-wrong") &&
        (item.userAnswer == null ||
          (Number.isInteger(item.userAnswer) &&
            item.userAnswer >= 0 &&
            item.userAnswer < item.optionOrder.length)) &&
        Number.isInteger(item.wrongCount) &&
        item.wrongCount >= 0
      );
    });
  if (!validSession || (saved.dataFingerprint !== fp && !legacyCompatible)) {
    clearSession(state.currentDeck);
    return false;
  }
  if (legacyCompatible) saved.dataFingerprint = fp;
  const progress = getDeckProgress(saved.deckId);
  if (
    progress.dataFingerprint &&
    progress.dataFingerprint !== fp &&
    !legacyCompatible
  ) {
    clearSession(state.currentDeck);
    return false;
  }
  saved.timeLimit =
    Number.isInteger(saved.timeLimit) && saved.timeLimit > 0
      ? Math.min(1440, saved.timeLimit)
      : 0;
  saved.pausedAt = Number.isFinite(saved.pausedAt) ? saved.pausedAt : null;
  saved.pausedDurationMs = Math.max(0, Number(saved.pausedDurationMs) || 0);
  saved.remainingMs = Number.isFinite(saved.remainingMs)
    ? Math.max(0, saved.remainingMs)
    : null;
  saved.startedAt =
    Number.isFinite(saved.startedAt) && saved.startedAt > 0
      ? saved.startedAt
      : Date.now();
  saved.deadlineAt =
    Number.isFinite(saved.deadlineAt) && saved.deadlineAt > 0
      ? saved.deadlineAt
      : saved.timeLimit > 0
        ? saved.startedAt + saved.timeLimit * 60000
        : null;
  if (saved.pausedAt) {
    const now = Date.now();
    saved.pausedDurationMs += Math.max(0, now - saved.pausedAt);
    if (saved.timeLimit > 0)
      saved.deadlineAt = now + Math.max(0, Number(saved.remainingMs) || 0);
    saved.pausedAt = null;
    saved.remainingMs = null;
    if (!saveSession(saved)) {
      toast("Không thể lưu trạng thái tiếp tục phiên.");
      return false;
    }
  }
  saved.timeExpired = !!saved.timeExpired;
  saved.practiceInitialCount =
    Number.isInteger(saved.practiceInitialCount) &&
    saved.practiceInitialCount > 0
      ? saved.practiceInitialCount
      : saved.mode === "practice-wrong"
        ? saved.items.length
        : 0;
  saved.practiceCompletedIndices = Array.isArray(saved.practiceCompletedIndices)
    ? [
        ...new Set(
          saved.practiceCompletedIndices.filter(
            (index) => Number.isInteger(index) && index >= 0,
          ),
        ),
      ]
    : [];
  saved.practiceWrongHistory = Array.isArray(saved.practiceWrongHistory)
    ? saved.practiceWrongHistory.filter(
        (entry) =>
          entry &&
          Number.isInteger(entry.originalIndex) &&
          entry.originalIndex >= 0 &&
          typeof entry.question === "string" &&
          Number.isInteger(entry.wrongCount) &&
          entry.wrongCount > 0,
      )
    : [];
  for (const item of saved.items) {
    if (!Array.isArray(item.wrongOptions)) item.wrongOptions = [];
  }
  saved.completedInSession =
    saved.mode === "practice-wrong"
      ? saved.practiceCompletedIndices.length
      : saved.items.filter((item) => item.status === "correct").length;
  saved.totalWrongAttempts = Math.max(
    Number.isInteger(saved.totalWrongAttempts) ? saved.totalWrongAttempts : 0,
    saved.items.reduce(
      (sum, item) => sum + Math.max(0, Number(item.wrongCount) || 0),
      0,
    ),
  );
  saved.firstTryCorrect = Number.isInteger(saved.firstTryCorrect)
    ? saved.firstTryCorrect
    : saved.items.filter(
        (item) => item.status === "correct" && item.wrongCount === 0,
      ).length;
  saved.maxReached = Math.max(
    0,
    Math.min(saved.items.length - 1, Number(saved.maxReached) || 0),
  );
  saved.examMode = !!saved.examMode || saved.mode === "exam";
  state.currentDeck = saved.deckId;
  state.session = saved;
  state.reviewMode = !!saved.reviewMode;
  state.examFilter = "all";
  state.examSubmitting = false;
  if (saved.examMode) {
    showScreen("exam");
    renderExam();
  } else {
    showScreen("quiz");
    renderQuestion();
  }
  startSessionTimer();
  toast(
    saved.examMode
      ? "Đã khôi phục bài thi thử đang làm."
      : "Đã khôi phục lượt ôn đang làm.",
  );
  return true;
}

function initUI() {
  document.addEventListener("selectionchange", captureHighlightSelection);
  const captureAfterSelectionGesture = () => {
    captureHighlightSelection();
    requestAnimationFrame(captureHighlightSelection);
  };
  document.addEventListener("pointerup", captureAfterSelectionGesture, true);
  document.addEventListener("mouseup", captureAfterSelectionGesture, true);
  document.addEventListener("touchend", captureAfterSelectionGesture, true);
  $("btn-highlight-toggle")?.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") event.preventDefault();
  });
  $("btn-highlight-toggle")?.addEventListener("mousedown", (event) =>
    event.preventDefault(),
  );
  $("btn-highlight-toggle")?.addEventListener("click", () => {
    captureHighlightSelection();
    const q = currentQ();
    const s = state.session;
    const selection = state.lastTextSelection;
    if (
      !q ||
      !s ||
      s.examMode ||
      !selection ||
      selection.questionIndex !== q.originalIndex ||
      selection.deckId !== s.deckId
    ) {
      toast("Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.");
      return;
    }
    toggleHighlightSelection(selection.deckId, q.originalIndex, selection);
  });
  const active = getSettings();
  state.currentDeck =
    active.deck === "quocphong2" ? "quocphong2" : "quocphong1";
  const settings = getSettings(state.currentDeck);
  applySettingsToForm(settings);
  const bank = getBankSettings();
  state.bankDeck = bank.deck === "quocphong2" ? "quocphong2" : "quocphong1";
  applyBankSettingsToForm(bank);
  showScreen("setup");
  refreshSetupUI();
}

function applyTheme() {
  document.documentElement.dataset.theme = "dark";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = "#111113";
}

function initTheme() {
  applyTheme();
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!$("modal").hidden) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;

    const quizActive = $("screen-quiz") && !$("screen-quiz").hidden;
    const examActive = $("screen-exam") && !$("screen-exam").hidden;

    if (examActive) {
      if (event.key === "Escape") {
        event.preventDefault();
        $("btn-exam-quit")?.click();
        return;
      }
      if (
        (event.key === "Enter" || event.key === "s") &&
        !state.session?.reviewMode
      ) {
        event.preventDefault();
        $("btn-exam-submit")?.click();
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        jumpToNextUnanswered();
      }
      return;
    }

    if (!quizActive) return;

    if (/^[1-6]$/.test(event.key)) {
      const option =
        $("options").querySelectorAll(".option")[Number(event.key) - 1];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      }
      return;
    }
    if (/^[a-f]$/i.test(event.key)) {
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      const option = $("options").querySelectorAll(".option")[index];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!$("btn-next").disabled) $("btn-next").click();
      return;
    }
    if (event.key === "ArrowLeft" && !$("btn-prev").disabled) {
      event.preventDefault();
      $("btn-prev").click();
    } else if (event.key === "ArrowRight" && !$("btn-next").disabled) {
      event.preventDefault();
      $("btn-next").click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      $("btn-quit").click();
    }
  });
}

function bindEvents() {
  bindKeyboardShortcuts();
  initEnhance({ onPrev, onNext });

  document.querySelectorAll(".deck-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.currentDeck === btn.dataset.deck) return;
      persistSetupForm();
      state.currentDeck = btn.dataset.deck;
      applySettingsToForm(getSettings(state.currentDeck));
      refreshSetupUI();
      persistSetupForm();
    });
  });

  $("btn-all").addEventListener("click", () => {
    const form = readSetupForm();
    $("input-count").value = String(
      Math.max(1, form.endQuestion - form.startQuestion + 1),
    );
    persistSetupForm();
    refreshSetupUI();
  });

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const form = readSetupForm();
      const max = Math.max(1, form.endQuestion - form.startQuestion + 1);
      const n = Math.min(Number(btn.dataset.count) || 20, max);
      $("input-count").value = String(n);
      persistSetupForm();
      refreshSetupUI();
    });
  });

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.examFilter = chip.dataset.filter || "all";
      applyExamFilter();
      updateExamProgressHeader();
    });
  });
  $("btn-exam-next-empty")?.addEventListener("click", () =>
    jumpToNextUnanswered(),
  );

  $("input-count").addEventListener("change", () => {
    persistSetupForm();
    refreshSetupUI();
  });

  $("input-time-limit").addEventListener("change", () => {
    const value = Number.parseInt($("input-time-limit").value, 10);
    $("input-time-limit").value = String(
      Number.isInteger(value) && value >= 0 ? Math.min(1440, value) : 0,
    );
    persistSetupForm();
  });

  for (const id of ["input-range-start", "input-range-end"]) {
    $(id).addEventListener("change", () => {
      const total = currentQuestions().length;
      let start = Number.parseInt($("input-range-start").value, 10);
      let end = Number.parseInt($("input-range-end").value, 10);
      if (!Number.isInteger(start)) start = 1;
      if (!Number.isInteger(end)) end = total;
      start = Math.max(1, Math.min(start, Math.max(1, total)));
      end = Math.max(start, Math.min(end, Math.max(1, total)));
      $("input-range-start").value = String(start);
      $("input-range-end").value = String(end);
      refreshSetupUI();
      persistSetupForm();
    });
  }

  $("chk-shuffle-q").addEventListener("change", () => {
    persistSetupForm();
    refreshSetupUI();
  });

  $("chk-shuffle-a").addEventListener("change", () => {
    $("chk-shuffle-a").dataset.userTouched = "1";
    persistSetupForm();
  });

  for (const id of [
    "chk-auto-check",
    "chk-auto-advance",
    "chk-sound",
    "chk-vibration",
  ]) {
    $(id).addEventListener("change", persistSetupForm);
  }

  document.querySelectorAll("#screen-setup .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setPracticeMode(btn.dataset.mode));
  });
  document.querySelectorAll("#screen-review .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setBankPracticeMode(btn.dataset.mode));
  });
  document.querySelectorAll("[data-bank-deck]").forEach((btn) => {
    btn.addEventListener("click", () => setBankDeck(btn.dataset.bankDeck));
  });

  $("btn-view-bank").addEventListener("click", openQuestionBank);

  const scrollTopBtn = $("btn-scroll-top");
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener("click", scrollToPageTop);
    window.addEventListener(
      "scroll",
      () => {
        if (state._scrollTopRaf) return;
        state._scrollTopRaf = requestAnimationFrame(() => {
          state._scrollTopRaf = 0;
          updateScrollTopButton();
        });
      },
      { passive: true },
    );
    window.addEventListener("resize", updateScrollTopButton, { passive: true });
    updateScrollTopButton();
  }

  $("btn-review-back").addEventListener("click", () => {
    applySettingsToForm(getSettings(state.currentDeck));
    showScreen("setup");
    refreshSetupUI();
  });

  $("btn-review-start-selected").addEventListener("click", () => {
    const form = persistBankForm();
    const selected = bankQuestions().filter((question) =>
      state.reviewSelectedIndices.has(question.originalIndex),
    );
    if (!selected.length) {
      toast("Hãy chọn ít nhất một câu hỏi.");
      return;
    }
    let pool = selected.slice();
    if (form.shuffleQ) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
    const take = Math.min(pool.length, Math.max(1, form.count));
    pool = pool.slice(0, take);
    const selectedIndices = pool.map((question) => question.originalIndex);
    state.reviewSelectedIndices.clear();
    // Use bank deck and options; do not touch setup settings
    state.currentDeck = state.bankDeck;
    startSessionFromPool(pool, {
      mode: "normal",
      sequential: false,
      rangeStart: Math.min(...selectedIndices) + 1,
      rangeEnd: Math.max(...selectedIndices) + 1,
      requestedCount: pool.length,
      examMode: form.practiceMode === "exam",
      forceShuffleQ: form.shuffleQ,
      alreadyShuffled: true,
      fromBank: true,
      timeLimit: form.timeLimit,
      shuffleA: form.shuffleA,
    });
  });
  $("btn-review-goto").addEventListener("click", () => {
    const n = Number.parseInt($("input-review-goto").value, 10);
    const total = bankQuestions().length;
    if (!Number.isInteger(n) || n < 1 || n > total) {
      toast(`Nhập số câu từ 1 đến ${total}.`);
      return;
    }
    if (!scrollReviewToQuestionNumber(n)) {
      toast(`Không tìm thấy câu ${n} trong danh sách hiện tại.`);
    }
  });
  $("input-review-goto").addEventListener("input", (event) => {
    const input = event.currentTarget;
    if (input.value === "") return;
    const total = bankQuestions().length;
    const value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value)) return;
    input.value = String(Math.min(Math.max(value, 1), Math.max(1, total)));
  });
  $("input-review-goto").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("btn-review-goto").click();
  });

  $("btn-start").addEventListener("click", () =>
    startNormal({ sequential: false }),
  );
  $("btn-continue").addEventListener("click", () =>
    startNormal({ sequential: true }),
  );
  $("btn-practice-wrong").addEventListener("click", () => {
    setPracticeMode("practice");
    startPracticeWrong();
  });
  $("btn-practice-all-wrong").addEventListener("click", () => {
    setPracticeMode("practice");
    startPracticeWrong({ allDeck: true });
  });
  $("btn-practice-bookmarks").addEventListener("click", () => {
    setPracticeMode("practice");
    startPracticeBookmarks();
  });

  // Question bank preferences share the main setup settings.
  for (const reviewId of [
    "review-input-count",
    "review-input-time-limit",
    "review-chk-shuffle-q",
    "review-chk-shuffle-a",
    "review-chk-auto-check",
    "review-chk-auto-advance",
    "review-chk-sound",
    "review-chk-vibration",
  ]) {
    const el = $(reviewId);
    if (!el) continue;
    const persist = () => {
      if (reviewId === "review-input-time-limit") {
        const value = Number.parseInt(el.value, 10);
        el.value = String(
          Number.isInteger(value) && value >= 0 ? Math.min(1440, value) : 0,
        );
      }
      persistBankForm();
      if (state.mode === "review") {
        // Cập nhật nhãn nút bắt đầu theo mode
        const count = state.reviewSelectedIndices.size;
        if ($("btn-review-start-selected")) {
          $("btn-review-start-selected").textContent =
            `${state.bankPracticeMode === "exam" ? "Thi" : "Ôn"} ${count} câu đã chọn`;
        }
      }
    };
    el.addEventListener("change", persist);
    if (el.type !== "checkbox") el.addEventListener("input", persist);
  }

  $("btn-exam-submit")?.addEventListener("click", () => onExamSubmit());
  $("btn-exam-pause")?.addEventListener("click", () => pauseSession());
  $("btn-quiz-pause")?.addEventListener("click", () => pauseSession());
  $("btn-resume-session")?.addEventListener("click", () => {
    if (!restoreSessionIfAny()) toast("Không còn phiên để tiếp tục.");
    else refreshSetupUI();
  });
  $("btn-discard-session")?.addEventListener("click", async () => {
    const ok = await confirmModal(
      "Bỏ phiên đang dở?",
      "Phiên làm bài hiện tại sẽ bị xóa. Tiến độ bộ đề đã lưu vẫn giữ nguyên.",
    );
    if (!ok) return;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    refreshResumeCard();
    toast("Đã bỏ phiên cũ.");
  });
  $("btn-exam-quit")?.addEventListener("click", async () => {
    const s = state.session;
    const reviewing = s?.reviewMode;
    const ok = await confirmModal(
      reviewing ? "Thoát kết quả thi?" : "Thoát bài thi?",
      reviewing
        ? "Bạn sẽ quay về màn hình thiết lập. Kết quả lần thi này không lưu lại phiên đang mở."
        : "Phiên thi hiện tại sẽ bị đóng. Tiến độ bộ đề (câu đã hoàn thành, câu sai) vẫn được giữ nếu bạn đã nộp bài.",
    );
    if (!ok) return;
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    showScreen("setup");
    refreshSetupUI();
  });

  $("btn-bookmark").addEventListener("click", () => {
    const q = currentQ();
    const s = state.session;
    if (!q || !s) return;
    const result = toggleBookmark(s.deckId, q.originalIndex);
    if (result == null) {
      toast(
        "Không thể lưu dấu trang. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.",
      );
      return;
    }
    renderQuestion();
    toast(result ? "Đã đánh dấu câu hỏi." : "Đã bỏ đánh dấu câu hỏi.");
  });

  $("btn-export-progress").addEventListener("click", () => {
    try {
      const content = exportBackup();
      const blob = new Blob([content], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `quocphonganninh-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Đã tạo tệp sao lưu tiến độ.");
    } catch {
      toast("Không thể tạo tệp sao lưu trên trình duyệt này.");
    }
  });

  $("btn-import-progress").addEventListener("click", () =>
    $("input-import-progress").click(),
  );
  $("input-import-progress").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("Tệp sao lưu quá lớn hoặc không hợp lệ.");
      return;
    }
    const ok = await confirmModal(
      "Khôi phục tiến độ?",
      "Tiến độ đang lưu trên thiết bị này sẽ được thay bằng dữ liệu trong tệp sao lưu. Hãy chắc chắn bạn đã sao lưu dữ liệu hiện tại nếu cần.",
    );
    if (!ok) return;
    let raw;
    try {
      raw = await file.text();
    } catch {
      toast("Không đọc được tệp đã chọn.");
      return;
    }
    if (!importBackup(raw)) {
      toast("Tệp sao lưu không hợp lệ hoặc không được hỗ trợ.");
      return;
    }
    await loadAll();
    if (!state.error) toast("Đã khôi phục tiến độ từ tệp sao lưu.");
  });

  $("btn-reset-progress").addEventListener("click", async () => {
    const ok = await confirmModal(
      "Xóa tiến độ?",
      `Xóa toàn bộ tiến độ, câu đã hoàn thành và lịch sử câu sai của bộ ${DECKS[state.currentDeck].label} trên trình duyệt này.`,
    );
    if (!ok) return;
    if (!resetDeckProgress(state.currentDeck)) {
      toast(
        "Không thể xóa tiến độ. Hãy kiểm tra quyền lưu trữ của trình duyệt.",
      );
      return;
    }
    toast("Đã xóa tiến độ bộ đề.");
    refreshSetupUI();
  });

  $("btn-next").addEventListener("click", onNext);
  $("btn-prev").addEventListener("click", onPrev);

  $("btn-quit").addEventListener("click", async () => {
    const ok = await confirmModal(
      "Thoát lượt ôn?",
      "Phiên ôn hiện tại sẽ bị đóng. Tiến độ các lượt đã hoàn thành và lịch sử câu sai vẫn được giữ trên trình duyệt.",
    );
    if (!ok) return;
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    const cleared = clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    if (!cleared)
      toast(
        "Không thể xóa phiên đã lưu; phiên này có thể xuất hiện lại khi tải trang.",
      );
    showScreen("setup");
    refreshSetupUI();
  });

  $("btn-sum-retry-session").addEventListener("click", () => {
    const previous = state._lastSummarySession;
    if (!previous || !state.decks[previous.deckId]) {
      toast("Không tìm thấy dữ liệu lượt vừa hoàn thành.");
      return;
    }
    state.currentDeck = previous.deckId;
    const byIndex = new Map(
      currentQuestions().map((question) => [question.originalIndex, question]),
    );
    const pool = previous.indices
      .map((index) => byIndex.get(index))
      .filter(Boolean);
    if (!pool.length) {
      toast("Không còn câu hỏi phù hợp để làm lại.");
      return;
    }
    $("input-range-start").value = String(previous.rangeStart);
    $("input-range-end").value = String(previous.rangeEnd);
    $("input-count").value = String(pool.length);
    $("input-time-limit").value = String(previous.timeLimit);
    $("chk-shuffle-q").checked = true;
    $("chk-shuffle-a").checked = true;
    setPracticeMode(previous.mode === "exam" ? "exam" : "practice");
    persistSetupForm();
    startSessionFromPool(pool, {
      mode: "normal",
      sequential: false,
      rangeStart: previous.rangeStart,
      rangeEnd: previous.rangeEnd,
      requestedCount: pool.length,
      examMode: previous.mode === "exam",
      forceShuffleQ: true,
      alreadyShuffled: false,
    });
  });

  $("btn-sum-home").addEventListener("click", () => {
    showScreen("setup");
    refreshSetupUI();
  });

  $("btn-sum-again").addEventListener("click", () => {
    showScreen("setup");
    refreshSetupUI();
    $("input-count").focus();
  });

  $("btn-sum-restart").addEventListener("click", async () => {
    const ok = await confirmModal(
      "Làm lại từ đầu?",
      "Tiến độ hoàn thành của bộ đề sẽ được đặt lại để bạn ôn tuần tự từ câu đầu. Lịch sử câu sai vẫn được giữ.",
    );
    if (!ok) return;
    const progress = getDeckProgress(state.currentDeck);
    progress.completed = [];
    progress.sequentialCursor = 0;
    if (!saveDeckProgress(state.currentDeck, progress)) {
      toast(
        "Không thể đặt lại tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.",
      );
      return;
    }
    $("chk-shuffle-q").checked = false;
    persistSetupForm();
    showScreen("setup");
    refreshSetupUI();
    startNormal({ restart: true });
  });

  $("btn-sum-continue").addEventListener("click", () => {
    showScreen("setup");
    refreshSetupUI();
    startNormal({ sequential: true });
  });

  $("btn-sum-random").addEventListener("click", () => {
    $("chk-shuffle-q").checked = true;
    persistSetupForm();
    showScreen("setup");
    refreshSetupUI();
    startNormal({ sequential: false });
  });

  $("btn-sum-practice").addEventListener("click", () => {
    if (state._lastSummaryDeck) state.currentDeck = state._lastSummaryDeck;
    if (
      Number.isInteger(state._lastSummaryRangeStart) &&
      Number.isInteger(state._lastSummaryRangeEnd)
    ) {
      $("input-range-start").value = String(state._lastSummaryRangeStart);
      $("input-range-end").value = String(state._lastSummaryRangeEnd);
    }
    if (
      Number.isInteger(state._lastSummaryCount) &&
      state._lastSummaryCount > 0
    ) {
      $("input-count").value = String(state._lastSummaryCount);
    }
    setPracticeMode("practice");
    showScreen("setup");
    refreshSetupUI();
    startPracticeWrong({ indices: state._lastSummaryWrongIndices });
  });

  $("btn-retry").addEventListener("click", () => {
    showScreen("setup");
    loadAll();
  });

  $("btn-update").addEventListener("click", async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting) {
      reloadAfterUpdate = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      location.reload();
    }
  });
}

let reloadAfterUpdate = false;

function registerSW() {
  if (!("serviceWorker" in navigator)) {
    toast("Trình duyệt này không hỗ trợ chế độ ngoại tuyến.");
    return;
  }
  const swUrl = new URL("sw.js", document.baseURI).href;
  const scope = new URL(".", document.baseURI).href;
  navigator.serviceWorker
    .register(swUrl, { scope })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller)
        $("update-banner").hidden = false;
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            $("update-banner").hidden = false;
          } else if (nw.state === "redundant") {
            toast(
              "Không thể cài bản ngoại tuyến mới. Hãy kiểm tra kết nối và tải lại trang khi có mạng.",
            );
          }
        });
      });
    })
    .catch(() => {
      toast("Không thể bật chế độ ngoại tuyến.");
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadAfterUpdate || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

function boot() {
  initTheme();
  if (!storageAvailable()) {
    toast("Trình duyệt hạn chế lưu trữ. Tiến độ có thể không được ghi nhớ.");
  }
  bindEvents();

  window.addEventListener("pagehide", () => {
    persistSession();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistSession();
      return;
    }
    if (!enforceSessionDeadline()) updateTimerDisplay();
  });

  window.addEventListener("pageshow", () => {
    if (state.session && !enforceSessionDeadline()) {
      updateTimerDisplay();
      persistSession();
    }
  });

  registerSW();
  loadAll();
}

boot();
