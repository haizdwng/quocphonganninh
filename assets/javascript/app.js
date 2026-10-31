import { initializeEnhancements } from './enhance.js';
import { fingerprintQuestions, normalizeQuestions, createSessionItems, pickSequential, findNextUncompletedQuestion, pickRandom, pickWrong, isAnswerCorrect, displayedCorrectIndex, getEndQuestionForDeckSwitch } from './quiz.js';
import { getSettings, saveSettings, getBankSettings, saveBankSettings, getDeckProgress, saveDeckProgress, getSession, saveSession, clearSession, resetDeckProgress, markWrong, markPracticed, addCompleted, setSequentialCursor, getWrongIndices, getRangeWrongIndices, addWrongIndicesForRange, getBookmarkedIndices, toggleBookmark, exportBackup, importBackup, storageAvailable, getQuestionHighlights, saveQuestionHighlights, resetDeckHighlights, getQuestionNote, saveQuestionNote, resetDeckNotes, saveQuestionOverride, getDeckOverrides, getHiddenIndices, toggleHiddenQuestion, isQuestionHidden } from './storage.js';

const DECKS = {
  quocphong1: {
    id: 'quocphong1',
    label: 'Quốc Phòng 1',
    file: 'data/quocphong1.json'
  },
  quocphong2: {
    id: 'quocphong2',
    label: 'Quốc Phòng 2',
    file: 'data/quocphong2.json'
  }
};

const state = {
  decks: {
    quocphong1: null,
    quocphong2: null
  },
  fingerprints: {
    quocphong1: '',
    quocphong2: ''
  },
  legacyFingerprintMatched: {
    quocphong1: false,
    quocphong2: false
  },
  loading: true,
  error: null,
  currentDeck: 'quocphong1',
  bankDeck: 'quocphong1',
  bankPracticeMode: 'practice',
  setupDeckBeforeBank: 'quocphong1',
  mode: 'setup',
  practiceMode: 'practice',
  session: null,
  reviewMode: false,
  timerInterval: null,
  examFilter: 'all',
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
  lastCountBeforeAll: null,
  lastTimeBeforeUnlimited: null,
  lastBankCountBeforeAll: null,
  lastBankTimeBeforeUnlimited: null,
  bankSearchQuery: '',
  bankSearchMatchIndex: -1,
  reviewFocusQuestionNumber: null,
  reviewEditingNoteIndex: null,
  reviewEditingNoteDraft: '',
  reviewEditingQuestionIndex: null
};

const REVIEW_VIRTUAL_OVERSCAN = 3;
const REVIEW_VIRTUAL_ESTIMATED_HEIGHT = 240;
const REVIEW_VIRTUAL_POOL_SIZE = 14;

const getElementById = (elementIdentifier) => document.getElementById(elementIdentifier);

function setToggleIcon(button, active, icons) {
  if (!button) return;
  const onIcon = icons?.on || button.dataset.iconOn;
  const offIcon = icons?.off || button.dataset.iconOff;
  if (onIcon && offIcon) button.dataset.icon = active ? onIcon : offIcon;
};

function createDataFileUrl(relativePath) {
  return new URL(relativePath, document.baseURI).href;
};

async function loadDeck(deckIdentifier) {
  const deckMetadata = DECKS[deckIdentifier];
  const dataFileUrl = createDataFileUrl(deckMetadata.file);
  let response;
  try {
    response = await fetch(dataFileUrl, { cache: 'no-cache' });
  } catch {
    throw new Error('Không thể tải ' + deckMetadata.label + '. Hãy kiểm tra kết nối mạng hoặc mở trang trực tuyến ít nhất một lần để lưu dữ liệu ngoại tuyến.');
  };
  if (!response.ok) throw new Error('Không tải được ' + deckMetadata.label + ' (' + response.status + '). Hãy kiểm tra vị trí tệp dữ liệu.');
  let rawData;
  try {
    rawData = await response.json();
  } catch {
    throw new Error('Tệp dữ liệu ' + deckMetadata.file + ' không hợp lệ.');
  };
  const questions = normalizeQuestions(rawData);
  const overrides = getDeckOverrides(deckIdentifier);
  for (const [key, entry] of Object.entries(overrides)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= questions.length || !entry) continue;
    questions[index] = {
      ...questions[index],
      question: entry.question,
      options: entry.options.slice(),
      correct: entry.correct,
      fixed: entry.fixed === true
    };
  }
  const fingerprint = fingerprintQuestions(questions);
  state.decks[deckIdentifier] = questions;
  state.fingerprints[deckIdentifier] = fingerprint;
  const progress = getDeckProgress(deckIdentifier);
  const first = questions[0]?.question?.trim().slice(0, 40) || '';
  const last = questions[questions.length - 1]?.question?.trim().slice(0, 40) || '';
  const legacyFingerprint = `${questions.length}|${first}|${last}`;
  if (progress.dataFingerprint && progress.dataFingerprint !== fingerprint) {
    if (progress.dataFingerprint === legacyFingerprint) {
      state.legacyFingerprintMatched[deckIdentifier] = true;
      progress.dataFingerprint = fingerprint;
      if (!saveDeckProgress(deckIdentifier, progress)) toast('Không thể cập nhật phiên bản tiến độ trong trình duyệt.');
    } else {
      progress.completed = [];
      progress.sequentialCursor = 0;
      progress.wrongMap = {};
      progress.wrongRangeMap = {};
      progress.practiceMap = {};
      progress.bookmarks = [];
      progress.dataFingerprint = fingerprint;
      if (!saveDeckProgress(deckIdentifier, progress)) toast('Không thể lưu tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.');
      if (!resetDeckHighlights(deckIdentifier)) toast('Không thể xóa phần đánh dấu cũ vì bộ nhớ trình duyệt không ghi được.');
      if (!resetDeckNotes(deckIdentifier)) toast('Không thể xóa ghi chú cũ vì bộ nhớ trình duyệt không ghi được.');
    };
  } else if (!progress.dataFingerprint) {
    progress.dataFingerprint = fingerprint;
    if (!saveDeckProgress(deckIdentifier, progress)) toast('Không thể lưu dấu vân tay bộ đề vào trình duyệt.');
  };

  const progressBeforeSanitize = JSON.stringify(progress);
  const isValidIndex = (index) => Number.isInteger(index) && index >= 0 && index < questions.length;
  progress.completed = progress.completed.filter(isValidIndex);
  progress.bookmarks = progress.bookmarks.filter(isValidIndex);
  progress.sequentialCursor = Math.min(progress.sequentialCursor, questions.length);
  progress.wrongMap = Object.fromEntries(Object.entries(progress.wrongMap).filter(([key, count]) => isValidIndex(Number(key)) && Number.isInteger(count) && count > 0));
  progress.practiceMap = Object.fromEntries(Object.entries(progress.practiceMap).filter(([key, count]) => isValidIndex(Number(key)) && Number.isInteger(count) && count > 0));
  if (JSON.stringify(progress) !== progressBeforeSanitize && !saveDeckProgress(deckIdentifier, progress)) toast('Không thể làm sạch tiến độ cũ trong trình duyệt.');
  return questions;
};

async function loadAll() {
  state.loading = true;
  state.error = null;
  showScreen('loading');
  let stage = 'tải dữ liệu';
  try {
    await Promise.all([loadDeck('quocphong1'), loadDeck('quocphong2')]);
    state.loading = false;
    stage = 'khởi tạo giao diện';
    initializeInterface();
  } catch (e) {
    state.loading = false;
    state.error = e?.message || String(e);
    console.error('Lỗi khi ' + stage + ':', e);
    showScreen('error');
    let errorMessage = getElementById('error-message');
    if (!errorMessage) {
      const screen = getElementById('screen-error');
      if (screen) {
        errorMessage = document.createElement('pre');
        errorMessage.id = 'error-message';
        
        screen.append(errorMessage);
      };
    };
    const isDataError = stage === 'tải dữ liệu';
    const details = [
      isDataError ? state.error : 'Không thể khởi tạo giao diện: ' + state.error,
      isDataError ? 'Nếu đang ngoại tuyến lần đầu, hãy kết nối mạng để tải bộ đề.' : 'Hãy tải lại trang. Nếu lỗi vẫn còn, mở Console để xem chi tiết.'
    ].join('\n\n');
    if (errorMessage) errorMessage.textContent = details;
    else window.alert(details);
  };
};

function showScreen(name) {
  for (const element of document.querySelectorAll('.screen')) {
    element.classList.remove('active');
    element.hidden = true;
  };
  const screen = getElementById('screen-' + name);
  if (screen) {
    screen.hidden = false;
    screen.classList.add('active');
  };
  state.mode = name;
  document.body.dataset.screen = name;
  if (name !== 'review') {
    state.reviewEditingNoteIndex = null;
    state.reviewEditingNoteDraft = '';
    updateBankSearchNavButtons();
  };
  if (screen) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    requestAnimationFrame(updateScrollTopButton);
  };
};

function updateScrollTopButton() {
  const button = getElementById('button-scroll-to-top');
  if (!button) return;
  const threshold = Math.max(360, Math.floor(window.innerHeight * 0.75));
  const show = window.scrollY > threshold;
  button.hidden = false;
  button.classList.toggle('is-visible', show);
  if (!show) button.hidden = true;
};

function scrollToPageTop() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
};

function toast(message, durationMs = 2800) {
  const toastElement = getElementById('toast');
  if (!toastElement) {
    console.warn('Không tìm thấy phần tử #toast:', message);
    return;
  };
  toastElement.textContent = message;
  toastElement.hidden = false;
  clearTimeout(toast._timeoutId);
  toast._timeoutId = setTimeout(() => {
    if (toastElement.isConnected) toastElement.hidden = true;
  }, durationMs);
};

function confirmModal(title, body) {
  return new Promise((resolve) => {
    getElementById('modal-title').textContent = title;
    getElementById('modal-body').textContent = body;
    getElementById('modal').hidden = false;
    getElementById('modal').classList.add('is-open');
    const ok = getElementById('modal-ok');
    const cancel = getElementById('modal-cancel');
    const cleanup = (val) => {
      getElementById('modal').hidden = true;
      getElementById('modal').classList.remove('is-open');
      ok.onclick = null;
      cancel.onclick = null;
      resolve(val);
    };
    const previousFocus = document.activeElement;
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanupWithFocus(false);
      };
    };
    const originalCleanup = cleanup;
    const cleanupWithFocus = (val) => {
      document.removeEventListener('keydown', onKeydown);
      originalCleanup(val);
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
    ok.onclick = () => cleanupWithFocus(true);
    cancel.onclick = () => cleanupWithFocus(false);
    document.addEventListener('keydown', onKeydown);
    ok.focus();
  });
};

function currentQuestions() {
  return visibleDeckQuestions(state.currentDeck);
};

function bankQuestions() {
  return state.decks[state.bankDeck] || [];
};

function allDeckQuestions(deckId) {
  return state.decks[deckId] || [];
};

function visibleDeckQuestions(deckId) {
  const questions = allDeckQuestions(deckId);
  const hidden = new Set(getHiddenIndices(deckId));
  if (!hidden.size) return questions;
  return questions.filter((question) => !hidden.has(question.originalIndex));
};

function formatDeckCountLabel(deckId) {
  const all = allDeckQuestions(deckId);
  const full = all.length;
  if (!full) return '0 câu';
  const visible = visibleDeckQuestions(deckId).length;
  const hidden = full - visible;
  if (hidden > 0) return visible + ' câu · ' + hidden + ' ẩn';
  return visible + ' câu';
};

function updateDeckCountLabels() {
  if (getElementById('count-quocphong1')) getElementById('count-quocphong1').textContent = formatDeckCountLabel('quocphong1');
  if (getElementById('count-quocphong2')) getElementById('count-quocphong2').textContent = formatDeckCountLabel('quocphong2');
  if (getElementById('bank-count-quocphong1')) getElementById('bank-count-quocphong1').textContent = formatDeckCountLabel('quocphong1');
  if (getElementById('bank-count-quocphong2')) getElementById('bank-count-quocphong2').textContent = formatDeckCountLabel('quocphong2');
};

function sessionPreferences(deckId) {
  if (state.session?.fromBank) return getBankSettings();
  return getSettings(deckId || state.session?.deckId || state.currentDeck);
};

function renderTextWithHighlights(element, text, deckId, originalIndex, target) {
  element.replaceChildren();
  element.dataset.highlightTarget = target;
  element.dataset.questionIndex = String(originalIndex);
  element.dataset.deckId = deckId;
  const ranges = getQuestionHighlights(deckId, originalIndex).filter((range) => range.target === target && range.start < text.length && range.end > 0).map((range) => ({
    start: Math.max(0, range.start),
    end: Math.min(text.length, range.end)
  })).sort((leftRange, rightRange) => leftRange.start - rightRange.start || leftRange.end - rightRange.end);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  };
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) element.appendChild(document.createTextNode(text.slice(cursor, range.start)));
    const mark = document.createElement('span');
    mark.className = 'highlighted-text';
    mark.textContent = text.slice(range.start, range.end);
    element.appendChild(mark);
    cursor = range.end;
  };
  if (cursor < text.length) element.appendChild(document.createTextNode(text.slice(cursor)));
};

function toggleHighlightSelection(deckId, questionIndex, selection) {
  const saved = getQuestionHighlights(deckId, questionIndex);
  const selected = {
    target: selection.target,
    start: selection.start,
    end: selection.end
  };
  const sameTarget = saved.filter((range) => range.target === selected.target).map((range) => ({ start: range.start, end: range.end })).sort((leftRange, rightRange) => leftRange.start - rightRange.start);
  let coveredUntil = selected.start;
  for (const range of sameTarget) {
    if (range.end <= coveredUntil) continue;
    if (range.start > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, range.end);
    if (coveredUntil >= selected.end) break;
  };
  const fullyHighlighted = coveredUntil >= selected.end;
  let updated;
  if (fullyHighlighted) {
    updated = [];
    for (const range of saved) {
      if (range.target !== selected.target || range.end <= selected.start || range.start >= selected.end) {
        updated.push(range);
        continue;
      };
      if (range.start < selected.start) updated.push({ ...range, end: selected.start });
      if (range.end > selected.end) updated.push({ ...range, start: selected.end });
    };
  } else updated = [...saved, selected];
  if (!saveQuestionHighlights(deckId, questionIndex, updated)) {
    toast('Không thể lưu highlight. Bộ nhớ trình duyệt có thể đã đầy.');
    return false;
  };
  state.lastTextSelection = null;
  if (state.mode === 'review') renderQuestionBank();
  else renderQuestion();
  toast(fullyHighlighted ? 'Đã xóa highlight ở đoạn chọn.' : 'Đã highlight đoạn chọn.');
  return true;
};

function captureHighlightSelection() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return false;

  let range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    state.lastTextSelection = null;
    return false;
  };

  const elementFor = (node) => {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest?.('[data-highlight-target]') || null;
  };

  const target = elementFor(range.startContainer);
  const endTarget = elementFor(range.endContainer);
  if (!target || target !== endTarget || !target.contains(range.startContainer) || !target.contains(range.endContainer)) {
    state.lastTextSelection = null;
    return false;
  };

  const getOffset = (container, offset) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(target);
    prefix.setEnd(container, offset);
    return prefix.toString().length;
  };

  try {
    const start = getOffset(range.startContainer, range.startOffset);
    const end = getOffset(range.endContainer, range.endOffset);
    const text = target.textContent || '';
    const selectedText = range.toString();
    const safeStart = Math.max(0, Math.min(start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(end, text.length));

    if (!selectedText.trim() || safeEnd <= safeStart) {
      state.lastTextSelection = null;
      return false;
    };

    state.lastTextSelection = {
      deckId: target.dataset.deckId || state.currentDeck,
      questionIndex: Number(target.dataset.questionIndex),
      target: target.dataset.highlightTarget,
      start: safeStart,
      end: safeEnd,
      selectedText
    };
    return true;
  } catch {
    state.lastTextSelection = null;
    return false;
  };
};

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
};

function questionMatchesSearch(question, query) {
  if (!query) return false;
  const haystack = normalizeSearchText([
    question.question || '',
    ...(Array.isArray(question.options) ? question.options : [])
  ].join(' '));
  return haystack.includes(query);
};

function getBankSearchMatches(questions = bankQuestions()) {
  const query = normalizeSearchText(state.bankSearchQuery);
  if (!query) return [];
  return questions.filter((question) => questionMatchesSearch(question, query));
};

function getFilteredBankQuestions() {
  const questions = bankQuestions();
  const form = readBankForm();
  const query = normalizeSearchText(state.bankSearchQuery);
  const matches = query ? questions.filter((question) => questionMatchesSearch(question, query)) : [];
  const filtered = query ? matches : questions;
  return { questions, form, filtered, query, matches };
};

function updateBankSearchHint(matchCount = getBankSearchMatches().length) {
  const hint = getElementById('review-search-hint');
  if (!hint) return;
  const query = normalizeSearchText(state.bankSearchQuery);
  if (!query) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  };
  hint.hidden = false;
  if (matchCount === 0) hint.textContent = 'Không tìm thấy câu hỏi phù hợp.';
  else if (state.bankSearchMatchIndex >= 0 && state.bankSearchMatchIndex < matchCount) hint.textContent = 'Kết quả ' + (state.bankSearchMatchIndex + 1) + ' / ' + matchCount;
  else hint.textContent = 'Tìm thấy ' + matchCount + ' câu.';
};

function updateBankSearchNavButtons() {
  const previousButton = getElementById('button-search-prev');
  const nextBtn = getElementById('button-search-next');
  if (!previousButton || !nextBtn) return;
  const matchCount = getBankSearchMatches().length;
  const showNav = state.mode === 'review' && matchCount >= 1;
  const showPrev = showNav && matchCount >= 2;

  if (showPrev) {
    previousButton.hidden = false;
    previousButton.classList.add('is-visible');
  } else {
    previousButton.classList.remove('is-visible');
    previousButton.hidden = true;
  };

  if (showNav) {
    nextBtn.hidden = false;
    nextBtn.classList.add('is-visible');
  } else {
    nextBtn.classList.remove('is-visible');
    nextBtn.hidden = true;
  };
};

function scrollToBankSearchMatch(direction) {
  const matches = getBankSearchMatches();
  if (!matches.length) return;
  let index = state.bankSearchMatchIndex;
  if (!Number.isInteger(index) || index < 0 || index >= matches.length) index = direction > 0 ? 0 : matches.length - 1;
  else index = (index + direction + matches.length) % matches.length;
  state.bankSearchMatchIndex = index;
  const questionNumber = matches[index].originalIndex + 1;
  scrollReviewToQuestionNumber(questionNumber);
  updateBankSearchHint(matches.length);
};

function updateReviewSearchClearButton() {
  const clearBtn = getElementById('button-review-search-clear');
  const input = getElementById('input-review-search');
  if (!clearBtn || !input) return;
  clearBtn.hidden = !String(input.value || '').length;
};

function applyBankSearch(options = {}) {
  const input = getElementById('input-review-search');
  const raw = input ? input.value : state.bankSearchQuery;
  state.bankSearchQuery = String(raw || '');
  state.bankSearchMatchIndex = -1;
  setReviewFocusQuestion(null);
  updateReviewSearchClearButton();
  const matches = getBankSearchMatches();
  updateBankSearchHint(matches.length);
  updateBankSearchNavButtons();
  if (options.scrollToFirst && matches.length >= 1) {
    state.bankSearchMatchIndex = 0;
    scrollReviewToQuestionNumber(matches[0].originalIndex + 1);
    updateBankSearchHint(matches.length);
  };
};

function getReviewVirtualState() {
  if (!state.reviewVirtual) state.reviewVirtual = {
    filtered: [],
    heights: [],
    positions: [],
    heightByOriginalIndex: new Map(),
    totalHeight: 0,
    pool: [],
    phantom: null,
    scrollBound: false,
    rangeStart: 0,
    rangeEnd: -1,
    measureRaf: 0,
    scrollRaf: 0,
    scrollTargetIndex: null,
    scrollTargetQuestionNumber: null
  };
  return state.reviewVirtual;
};

function averageReviewMeasuredHeight(virtualScrollState) {
  const map = virtualScrollState.heightByOriginalIndex;
  if (!map || map.size === 0) return REVIEW_VIRTUAL_ESTIMATED_HEIGHT;
  let sum = 0;
  for (const height of map.values()) sum += height;
  return Math.max(120, sum / map.size);
};

function syncReviewHeightsFromCache(virtualScrollState) {
  const n = virtualScrollState.filtered.length;
  const avg = averageReviewMeasuredHeight(virtualScrollState);
  const map = virtualScrollState.heightByOriginalIndex || new Map();
  virtualScrollState.heights = new Array(n);
  for (let i = 0; i < n; i++) {
    const originalIndex = virtualScrollState.filtered[i]?.originalIndex;
    const cached = Number.isInteger(originalIndex) ? map.get(originalIndex) : null;
    virtualScrollState.heights[i] = cached || avg;
  };
};

function rebuildReviewVirtualMetrics(virtualScrollState) {
  const n = virtualScrollState.filtered.length;
  if (virtualScrollState.heights.length !== n) syncReviewHeightsFromCache(virtualScrollState);
    const REVIEW_CARD_GAP = 12;
  virtualScrollState.positions = new Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    virtualScrollState.positions[i] = y;
    y += (virtualScrollState.heights[i] || REVIEW_VIRTUAL_ESTIMATED_HEIGHT) + REVIEW_CARD_GAP;
  };
  virtualScrollState.totalHeight = Math.max(0, y - (n ? REVIEW_CARD_GAP : 0));
  if (virtualScrollState.phantom) virtualScrollState.phantom.style.height = Math.max(y, 0) + 'px';
};

function findReviewVirtualIndex(virtualScrollState, offsetY) {
  const pos = virtualScrollState.positions;
  if (!pos.length) return 0;
  let lowerBound = 0;
  let upperBound = pos.length - 1;
  while (lowerBound < upperBound) {
    const mid = (lowerBound + upperBound + 1) >> 1;
    if (pos[mid] <= offsetY) lowerBound = mid;
    else upperBound = mid - 1;
  };
  return lowerBound;
};


function exitBankQuestionEdit(card) {
  const parts = card && card._vs;
  if (!parts || !parts.editBlock) return;
  parts.editBlock.hidden = true;
  parts.editBlock.innerHTML = '';
  parts.prompt.hidden = false;
  parts.options.hidden = false;
  state.reviewEditingQuestionIndex = null;
  if (parts.editQuestionButton) {
    parts.editQuestionButton.classList.remove('is-active');
    parts.editQuestionButton.setAttribute('aria-label', 'Chỉnh sửa câu hỏi và đáp án');
    parts.editQuestionButton.title = 'Chỉnh sửa';
  }
}

function enterBankQuestionEdit(card, questionIndex) {
  const parts = card._vs;
  if (!parts) return;
  const deck = state.decks[state.bankDeck] || [];
  const question = deck.find((item) => item.originalIndex === questionIndex) || deck[questionIndex];
  if (!question) return;

  if (Number.isInteger(state.reviewEditingQuestionIndex) && state.reviewEditingQuestionIndex !== questionIndex) {
    // close previous if still in pool
    for (const other of (getReviewVirtualState().pool || [])) {
      if (Number(other.dataset.originalIndex) === state.reviewEditingQuestionIndex) exitBankQuestionEdit(other);
    }
  }

  state.reviewEditingQuestionIndex = questionIndex;
  parts.prompt.hidden = true;
  parts.options.hidden = true;
  parts.editBlock.hidden = false;
  parts.editBlock.innerHTML = '';
  if (parts.editQuestionButton) {
    parts.editQuestionButton.classList.add('is-active');
    parts.editQuestionButton.setAttribute('aria-label', 'Đóng chỉnh sửa');
    parts.editQuestionButton.title = 'Đóng chỉnh sửa';
  }

  const qLabel = document.createElement('label');
  qLabel.className = 'review-edit-label';
  qLabel.textContent = 'Câu hỏi';
  const qInput = document.createElement('textarea');
  qInput.className = 'review-edit-question';
  qInput.rows = 3;
  qInput.value = question.question;

  const optLabel = document.createElement('div');
  optLabel.className = 'review-edit-label';
  optLabel.textContent = 'Đáp án — bấm chữ cái để chọn đáp án đúng';

  const answerOptionList = document.createElement('div');
  answerOptionList.className = 'review-edit-options';
  const optionInputs = [];
  const radios = [];
  const letterBtns = [];
  const optionCount = Math.max(4, question.options.length);
  for (let i = 0; i < optionCount; i++) {
    const row = document.createElement('div');
    row.className = 'review-edit-option-row';
    const letter = String.fromCharCode(65 + i);

    const letterBtn = document.createElement('button');
    letterBtn.type = 'button';
    letterBtn.className = 'review-edit-correct-btn';
    letterBtn.textContent = letter;
    letterBtn.setAttribute('aria-label', 'Chọn đáp án đúng ' + letter);
    letterBtn.title = 'Đáp án đúng: ' + letter;
    letterBtn.setAttribute('aria-pressed', String(question.correct === i));
    if (question.correct === i) letterBtn.classList.add('is-correct');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'bank-edit-correct-' + questionIndex;
    radio.value = String(i);
    radio.checked = question.correct === i;
    radio.className = 'screen-reader-only';
    radio.tabIndex = -1;
    radio.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'review-edit-option-input';
    input.placeholder = 'Đáp án ' + letter;
    input.value = question.options[i] || '';

    letterBtn.addEventListener('click', () => {
      radios.forEach((r, idx) => {
        r.checked = idx === i;
        letterBtns[idx].classList.toggle('is-correct', idx === i);
        letterBtns[idx].setAttribute('aria-pressed', String(idx === i));
      });
    });

    row.append(letterBtn, radio, input);
    answerOptionList.appendChild(row);
    optionInputs.push(input);
    radios.push(radio);
    letterBtns.push(letterBtn);
  }

  const actions = document.createElement('div');
  actions.className = 'review-edit-action-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'button button-primary button-icon-only';
  saveBtn.dataset.icon = 'device-floppy';
  saveBtn.setAttribute('aria-label', 'Lưu');
  saveBtn.title = 'Lưu';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'button button-ghost button-icon-only';
  resetBtn.dataset.icon = 'rotate-clockwise';
  resetBtn.setAttribute('aria-label', 'Khôi phục gốc');
  resetBtn.title = 'Khôi phục gốc';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'button button-ghost button-icon-only';
  cancelBtn.dataset.icon = 'x';
  cancelBtn.setAttribute('aria-label', 'Hủy');
  cancelBtn.title = 'Hủy';

  // fixed = giữ nguyên thứ tự đáp án (không xáo) khi làm bài
  let editFixed = question.fixed === true;
  const fixedQuestionButton = document.createElement('button');
  fixedQuestionButton.type = 'button';
  fixedQuestionButton.className = 'button button-ghost button-icon-only ';
  const syncFixedButton = () => {
    fixedQuestionButton.setAttribute('aria-pressed', String(editFixed));
    setToggleIcon(fixedQuestionButton, editFixed, { on: 'pin', off: 'pinned-off' });
    fixedQuestionButton.setAttribute('aria-label', editFixed ? 'Bỏ cố định đáp án (cho phép xáo)' : 'Cố định đáp án (không xáo)');
    fixedQuestionButton.title = editFixed ? 'Đáp án cố định — bấm để cho phép xáo' : 'Cố định đáp án — không xáo khi làm bài';
    fixedQuestionButton.classList.toggle('is-on', editFixed);
  };
  syncFixedButton();

  actions.append(saveBtn, resetBtn, cancelBtn, fixedQuestionButton);

  parts.editBlock.append(qLabel, qInput, optLabel, answerOptionList, actions);

  fixedQuestionButton.addEventListener('click', () => {
    editFixed = !editFixed;
    syncFixedButton();
  });

  cancelBtn.addEventListener('click', () => {
    exitBankQuestionEdit(card);
    bindReviewBankCard(card, question, Number(card.dataset.listIndex));
  });

  resetBtn.addEventListener('click', async () => {
    const ok = saveQuestionOverride(state.bankDeck, questionIndex, null);
    if (!ok) {
      toast('Không thể khôi phục. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    }
    try {
      await loadDeck(state.bankDeck);
    } catch {
      toast('Không thể tải lại dữ liệu gốc.');
      return;
    }
    toast('Đã khôi phục câu hỏi gốc.');
    state.reviewEditingQuestionIndex = null;
    renderQuestionBank();
  });

  saveBtn.addEventListener('click', () => {
    const questionText = qInput.value.trim();
    if (!questionText) {
      toast('Câu hỏi không được để trống.');
      return;
    }
    const options = optionInputs.map((el) => el.value.trim()).filter(Boolean);
    if (options.length < 2) {
      toast('Cần ít nhất 2 đáp án.');
      return;
    }
    let correct = radios.findIndex((r) => r.checked);
    // map radio index to filtered options: use non-empty only in order
    const filledIndices = [];
    optionInputs.forEach((el, i) => { if (el.value.trim()) filledIndices.push(i); });
    if (correct < 0 || !optionInputs[correct] || !optionInputs[correct].value.trim()) {
      toast('Hãy chọn đáp án đúng trong các đáp án đã nhập.');
      return;
    }
    correct = filledIndices.indexOf(correct);
    if (correct < 0) {
      toast('Đáp án đúng không hợp lệ.');
      return;
    }
    const payload = { question: questionText, options, correct, fixed: editFixed === true };
    const ok = saveQuestionOverride(state.bankDeck, questionIndex, payload);
    if (!ok) {
      toast('Không thể lưu chỉnh sửa. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    }
    const deck = state.decks[state.bankDeck];
    if (deck && deck[questionIndex]) {
      deck[questionIndex] = {
        ...deck[questionIndex],
        question: questionText,
        options: options.slice(),
        correct,
        fixed: editFixed === true
      };
      state.fingerprints[state.bankDeck] = fingerprintQuestions(deck);
    }
    toast('Đã lưu chỉnh sửa câu hỏi.');
    state.reviewEditingQuestionIndex = null;
    renderQuestionBank();
  });

  qInput.focus();
}

function createReviewBankCard() {
  const card = document.createElement('article');
  card.className = 'review-question-card review-virtual-scroll-entry';
  card.style.position = 'absolute';
  card.style.left = '0';
  card.style.right = '0';
  card.style.top = '0';
  card.style.willChange = 'transform';

  const heading = document.createElement('h3');
  heading.className = 'review-question-heading';

  const prompt = document.createElement('p');
  prompt.className = 'review-question-text';

  const toolbar = document.createElement('div');
  toolbar.className = 'question-tools-row review-tools-row';

  const bookmarkButton = document.createElement('button');
  bookmarkButton.type = 'button';
  bookmarkButton.className = 'button button-ghost button-icon-only ';
  bookmarkButton.dataset.icon = 'bookmark';
  bookmarkButton.setAttribute('aria-label', 'Đánh dấu');
  bookmarkButton.title = 'Đánh dấu';

  const editQuestionButton = document.createElement('button');
  editQuestionButton.type = 'button';
  editQuestionButton.className = 'button button-ghost button-icon-only ';
  editQuestionButton.dataset.icon = 'pencil';
  editQuestionButton.setAttribute('aria-label', 'Chỉnh sửa câu hỏi và đáp án');
  editQuestionButton.title = 'Chỉnh sửa';

  const hideQuestionButton = document.createElement('button');
  hideQuestionButton.type = 'button';
  hideQuestionButton.className = 'button button-ghost button-icon-only ';
  hideQuestionButton.dataset.icon = 'eye';
  hideQuestionButton.setAttribute('aria-label', 'Ẩn câu hỏi');
  hideQuestionButton.title = 'Ẩn câu hỏi';
  hideQuestionButton.setAttribute('aria-pressed', 'false');

  const noteEditBtn = document.createElement('button');
  noteEditBtn.type = 'button';
  noteEditBtn.className = 'button-icon-only';
  noteEditBtn.dataset.icon = 'note';
  noteEditBtn.setAttribute('aria-label', 'Sửa ghi chú');
  noteEditBtn.title = 'Sửa ghi chú';

  const highlightButton = document.createElement('button');
  highlightButton.type = 'button';
  highlightButton.className = 'button button-ghost button-icon-only';
  highlightButton.dataset.icon = 'highlight';
  highlightButton.setAttribute('aria-label', 'Highlight hoặc bỏ highlight đoạn văn bản đã chọn');
  highlightButton.title = 'Highlight';
  highlightButton.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') event.preventDefault();
  });
  highlightButton.addEventListener('mousedown', (event) => event.preventDefault());
  highlightButton.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    captureHighlightSelection();
    const selection = state.lastTextSelection;
    if (!selection || selection.questionIndex !== questionIndex || selection.deckId !== state.bankDeck) {
      toast('Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.');
      return;
    };
    toggleHighlightSelection(selection.deckId, questionIndex, selection);
  });

  bookmarkButton.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    const result = toggleBookmark(state.bankDeck, questionIndex);
    if (result === null) {
      toast('Không thể cập nhật đánh dấu. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    }
    bookmarkButton.classList.toggle('is-bookmarked', result);
    bookmarkButton.setAttribute('aria-pressed', String(result));
    setToggleIcon(bookmarkButton, result, { on: 'bookmark-off', off: 'bookmark' });
    bookmarkButton.setAttribute('aria-label', result ? 'Bỏ đánh dấu' : 'Đánh dấu');
    bookmarkButton.title = result ? 'Bỏ đánh dấu' : 'Đánh dấu';
    toast(result ? 'Đã đánh dấu câu hỏi.' : 'Đã bỏ đánh dấu câu hỏi.');
  });

  hideQuestionButton.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    const result = toggleHiddenQuestion(state.bankDeck, questionIndex);
    if (result === null) {
      toast('Không thể cập nhật trạng thái ẩn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    }
    card.classList.toggle('is-hidden-question', result);
    hideQuestionButton.classList.toggle('is-hidden-active', result);
    hideQuestionButton.setAttribute('aria-pressed', String(result));
    setToggleIcon(hideQuestionButton, result, { on: 'eye-off', off: 'eye' });
    hideQuestionButton.setAttribute('aria-label', result ? 'Hiện câu hỏi' : 'Ẩn câu hỏi');
    hideQuestionButton.title = result ? 'Hiện câu hỏi' : 'Ẩn câu hỏi';
    updateDeckCountLabels();
    toast(result ? 'Đã ẩn câu hỏi (làm mờ).' : 'Đã hiện lại câu hỏi.');
  });

  editQuestionButton.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    if (state.reviewEditingQuestionIndex === questionIndex) {
      exitBankQuestionEdit(card);
      return;
    }
    enterBankQuestionEdit(card, questionIndex);
  });

  toolbar.append(bookmarkButton, editQuestionButton, hideQuestionButton, noteEditBtn, highlightButton);

  const noteBlock = document.createElement('div');
  noteBlock.className = 'review-note-block is-empty';
  const noteText = document.createElement('p');
  noteText.className = 'review-note-text';
  const noteInputEl = document.createElement('textarea');
  noteInputEl.className = 'question-note-input';
  noteInputEl.rows = 3;
  noteInputEl.maxLength = 2000;
  noteInputEl.placeholder = 'Nhập ghi chú cho câu hỏi này…';
  noteInputEl.hidden = true;
  const noteActions = document.createElement('div');
  noteActions.className = 'review-note-action-buttons note-actions-icons';
  const noteSaveBtn = document.createElement('button');
  noteSaveBtn.type = 'button';
  noteSaveBtn.className = 'button button-primary button-icon-only';
  noteSaveBtn.dataset.icon = 'device-floppy';
  noteSaveBtn.setAttribute('aria-label', 'Lưu ghi chú');
  noteSaveBtn.title = 'Lưu';
  noteSaveBtn.hidden = true;
  const noteDeleteBtn = document.createElement('button');
  noteDeleteBtn.type = 'button';
  noteDeleteBtn.className = 'button button-ghost button-icon-only';
  noteDeleteBtn.dataset.icon = 'trash';
  noteDeleteBtn.setAttribute('aria-label', 'Xóa ghi chú');
  noteDeleteBtn.title = 'Xóa';
  noteDeleteBtn.hidden = true;
  const noteCancelBtn = document.createElement('button');
  noteCancelBtn.type = 'button';
  noteCancelBtn.className = 'button button-ghost button-icon-only';
  noteCancelBtn.dataset.icon = 'x';
  noteCancelBtn.setAttribute('aria-label', 'Hủy');
  noteCancelBtn.title = 'Hủy';
  noteCancelBtn.hidden = true;
  noteActions.append(noteSaveBtn, noteDeleteBtn, noteCancelBtn);
  noteBlock.append(noteText, noteInputEl, noteActions);

  function setReviewNoteViewMode(existing) {
    const questionIndex = Number(card.dataset.originalIndex);
    if (Number.isInteger(questionIndex) && state.reviewEditingNoteIndex === questionIndex) {
      state.reviewEditingNoteIndex = null;
      state.reviewEditingNoteDraft = '';
    };
    noteInputEl.hidden = true;
    noteSaveBtn.hidden = true;
    noteDeleteBtn.hidden = true;
    noteCancelBtn.hidden = true;
    noteEditBtn.hidden = false;
    noteEditBtn.classList.toggle('has-note', !!existing);
    if (existing) {
      noteText.textContent = existing;
      noteText.hidden = false;
      noteBlock.classList.remove('is-empty');
      noteBlock.hidden = false;
      noteEditBtn.setAttribute('aria-label', 'Sửa ghi chú');
      noteEditBtn.title = 'Sửa ghi chú';
    } else {
      noteText.textContent = '';
      noteText.hidden = true;
      noteBlock.classList.add('is-empty');
      noteBlock.hidden = true;
      noteEditBtn.setAttribute('aria-label', 'Thêm ghi chú');
      noteEditBtn.title = 'Thêm ghi chú';
    };
  };

  function setReviewNoteEditMode(questionIndex, draft) {
    state.reviewEditingNoteIndex = questionIndex;
    const value = typeof draft === 'string' ? draft : getQuestionNote(state.bankDeck, questionIndex);
    state.reviewEditingNoteDraft = value;
    noteInputEl.value = value;
    noteText.hidden = true;
    noteInputEl.hidden = false;
    noteSaveBtn.hidden = false;
    noteDeleteBtn.hidden = false;
    noteCancelBtn.hidden = false;
    noteBlock.classList.remove('is-empty');
    noteBlock.hidden = false;
    noteEditBtn.classList.add('has-note');
    noteInputEl.focus();
  };

  noteInputEl.addEventListener('input', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    if (state.reviewEditingNoteIndex === questionIndex) state.reviewEditingNoteDraft = noteInputEl.value;
  });

  noteEditBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    if (!noteInputEl.hidden) {
      setReviewNoteViewMode(getQuestionNote(state.bankDeck, questionIndex));
      return;
    };
    setReviewNoteEditMode(questionIndex);
  });

  noteCancelBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    setReviewNoteViewMode(getQuestionNote(state.bankDeck, questionIndex));
  });

  noteSaveBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    const ok = saveQuestionNote(state.bankDeck, questionIndex, noteInputEl.value);
    if (!ok) {
      toast('Không thể lưu ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    const existing = getQuestionNote(state.bankDeck, questionIndex);
    setReviewNoteViewMode(existing);
    toast(existing ? 'Đã lưu ghi chú.' : 'Đã xóa ghi chú.');
  });

  noteDeleteBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.originalIndex);
    if (!Number.isInteger(questionIndex)) return;
    const ok = saveQuestionNote(state.bankDeck, questionIndex, '');
    if (!ok) {
      toast('Không thể xóa ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    noteInputEl.value = '';
    setReviewNoteViewMode('');
    toast('Đã xóa ghi chú.');
  });

  const options = document.createElement('ol');
  options.className = 'review-options';
  options.type = 'A';

  const optionNodes = [];
  for (let i = 0; i < 6; i++) {
    const item = document.createElement('li');
    item.className = 'review-option';
    item.hidden = true;
    const label = document.createElement('span');
    label.className = 'review-option-label';
    const text = document.createElement('span');
    text.className = 'review-option-text';
    const badge = document.createElement('span');
    badge.className = 'review-correct-badge';
    badge.textContent = 'Đáp án đúng';
    badge.hidden = true;
    item.append(label, text, badge);
    options.appendChild(item);
    optionNodes.push({ item, label, text, badge });
  };


  const editBlock = document.createElement('div');
  editBlock.className = 'review-edit-block';
  editBlock.hidden = true;

  card.append(heading, prompt, toolbar, noteBlock, editBlock, options);
  card._vs = {
    heading,
    prompt,
    toolbar,
    bookmarkButton,
    editQuestionButton,
    hideQuestionButton,
    noteBlock,
    noteText,
    noteInput: noteInputEl,
    noteEditBtn,
    noteSaveBtn,
    noteDeleteBtn,
    noteCancelBtn,
    setReviewNoteViewMode,
    setReviewNoteEditMode,
    editBlock,
    options,
    optionNodes
  };
  return card;
};

function bindReviewBankCard(card, question, listIndex) {
  const parts = card._vs;
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  card.dataset.listIndex = String(listIndex);
  card.dataset.originalIndex = String(question.originalIndex);
  card.id = 'review-question-' + (question.originalIndex + 1);
  parts.heading.textContent = 'Câu ' + (question.originalIndex + 1);
  card.classList.toggle('review-question-highlight', state.reviewFocusQuestionNumber === question.originalIndex + 1);
  card.classList.toggle('is-answer-fixed', question.fixed === true);

  const isBookmarked = getBookmarkedIndices(state.bankDeck).includes(question.originalIndex);
  if (parts.bookmarkButton) {
    parts.bookmarkButton.classList.toggle('is-bookmarked', isBookmarked);
    parts.bookmarkButton.setAttribute('aria-pressed', String(isBookmarked));
    setToggleIcon(parts.bookmarkButton, isBookmarked, { on: 'bookmark-off', off: 'bookmark' });
    parts.bookmarkButton.setAttribute('aria-label', isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu');
    parts.bookmarkButton.title = isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu';
  }

  const hidden = isQuestionHidden(state.bankDeck, question.originalIndex);
  card.classList.toggle('is-hidden-question', hidden);
  if (parts.hideQuestionButton) {
    parts.hideQuestionButton.classList.toggle('is-hidden-active', hidden);
    parts.hideQuestionButton.setAttribute('aria-pressed', String(hidden));
    setToggleIcon(parts.hideQuestionButton, hidden, { on: 'eye-off', off: 'eye' });
    parts.hideQuestionButton.setAttribute('aria-label', hidden ? 'Hiện câu hỏi' : 'Ẩn câu hỏi');
    parts.hideQuestionButton.title = hidden ? 'Hiện câu hỏi' : 'Ẩn câu hỏi';
  }

  if (state.reviewEditingQuestionIndex === question.originalIndex) {
    if (parts.editBlock.hidden || !parts.editBlock.childElementCount) {
      enterBankQuestionEdit(card, question.originalIndex);
    } else {
      parts.prompt.hidden = true;
      parts.options.hidden = true;
      parts.editBlock.hidden = false;
    }
  } else {
    if (!parts.editBlock.hidden) exitBankQuestionEdit(card);
    parts.prompt.hidden = false;
    parts.options.hidden = false;
  }

  renderTextWithHighlights(parts.prompt, question.question, state.bankDeck, question.originalIndex, 'question');

  const existingNote = getQuestionNote(state.bankDeck, question.originalIndex);
  if (parts.noteBlock) {
    if (state.reviewEditingNoteIndex === question.originalIndex && typeof parts.setReviewNoteEditMode === 'function') parts.setReviewNoteEditMode(question.originalIndex, state.reviewEditingNoteDraft);
    else if (typeof parts.setReviewNoteViewMode === 'function') parts.setReviewNoteViewMode(existingNote);
  };

  const optionCount = question.options.length;
  parts.optionNodes.forEach((node, index) => {
    if (index >= optionCount) {
      node.item.hidden = true;
      return;
    };
    node.item.hidden = false;
    const isCorrect = index === question.correct;
    node.item.className = isCorrect ? 'review-option is-correct' : 'review-option';
    node.label.textContent = labels[index] || String(index + 1);
    renderTextWithHighlights(node.text, question.options[index], state.bankDeck, question.originalIndex, 'option:' + index);
    node.badge.hidden = !isCorrect;
  });
};

function ensureReviewVirtualPool(virtualScrollState, list) {
  while (virtualScrollState.pool.length < REVIEW_VIRTUAL_POOL_SIZE) {
    const card = createReviewBankCard();
    card.hidden = true;
    list.appendChild(card);
    virtualScrollState.pool.push(card);
  };
};

function measureReviewVirtualVisible(virtualScrollState) {
  let changed = false;
  if (!virtualScrollState.heightByOriginalIndex) virtualScrollState.heightByOriginalIndex = new Map();
  for (const card of virtualScrollState.pool) {
    if (card.hidden) continue;
    const index = Number(card.dataset.listIndex);
    if (!Number.isInteger(index) || index < 0 || index >= virtualScrollState.filtered.length) continue;
    const height = card.offsetHeight;
    if (!(height > 0)) continue;
    const withGap = height + 12;
    const originalIndex = virtualScrollState.filtered[index]?.originalIndex;
    if (Number.isInteger(originalIndex)) virtualScrollState.heightByOriginalIndex.set(originalIndex, withGap);
    if (Math.abs((virtualScrollState.heights[index] || 0) - withGap) > 2) {
      virtualScrollState.heights[index] = withGap;
      changed = true;
    };
  };
  if (changed) rebuildReviewVirtualMetrics(virtualScrollState);
  return changed;
};

function syncReviewVirtualWindow() {
  if (state.mode !== 'review') return;
  const list = getElementById('review-list');
  const virtualScrollState = getReviewVirtualState();
  if (!list || !virtualScrollState.filtered.length) return;

  const listTop = list.getBoundingClientRect().top + window.scrollY;
  const viewTop = Math.max(0, window.scrollY - listTop);
  const viewBottom = viewTop + window.innerHeight;

  let start = findReviewVirtualIndex(virtualScrollState, viewTop);
  start = Math.max(0, start - REVIEW_VIRTUAL_OVERSCAN);
  let end = findReviewVirtualIndex(virtualScrollState, viewBottom);
  end = Math.min(virtualScrollState.filtered.length - 1, end + REVIEW_VIRTUAL_OVERSCAN);

  const needed = end - start + 1;
  while (virtualScrollState.pool.length < needed) {
    const card = createReviewBankCard();
    card.hidden = true;
    list.appendChild(card);
    virtualScrollState.pool.push(card);
  };

  const neededIndices = [];
  for (let i = start; i <= end; i++) neededIndices.push(i);

  const assigned = new Map();
  const free = [];
  for (const card of virtualScrollState.pool) {
    const index = Number(card.dataset.listIndex);
    if (!card.hidden && Number.isInteger(index) && index >= start && index <= end && !assigned.has(index)) assigned.set(index, card);
    else free.push(card);
  };

  for (const i of neededIndices) {
    let card = assigned.get(i);
    if (!card) card = free.pop();
    if (!card) continue;
    assigned.set(i, card);
    const question = virtualScrollState.filtered[i];
    bindReviewBankCard(card, question, i);
    card.hidden = false;
    card.style.transform = 'translateY(' + (virtualScrollState.positions[i] || 0) + 'px)';
  };

  const used = new Set(assigned.values());
  for (const card of virtualScrollState.pool) {
    if (!used.has(card)) {
      card.hidden = true;
      card.dataset.listIndex = '';
      card.dataset.originalIndex = '';
    };
  };
  virtualScrollState.rangeStart = start;
  virtualScrollState.rangeEnd = end;

  if (virtualScrollState.measureRaf) cancelAnimationFrame(virtualScrollState.measureRaf);
  virtualScrollState.measureRaf = requestAnimationFrame(() => {
    virtualScrollState.measureRaf = 0;
    const before = virtualScrollState.totalHeight;
    measureReviewVirtualVisible(virtualScrollState);
    if (Math.abs(before - virtualScrollState.totalHeight) > 4) {
      for (const card of virtualScrollState.pool) {
        if (card.hidden) continue;
        const index = Number(card.dataset.listIndex);
        if (!Number.isInteger(index)) continue;
        card.style.transform = 'translateY(' + (virtualScrollState.positions[index] || 0) + 'px)';
      };
    };
  });
};

function onReviewVirtualScroll() {
  const virtualScrollState = getReviewVirtualState();
  if (virtualScrollState.scrollRaf) return;
  virtualScrollState.scrollRaf = requestAnimationFrame(() => {
    virtualScrollState.scrollRaf = 0;
    syncReviewVirtualWindow();
  });
};

function ensureReviewVirtualScrollBinding() {
  const virtualScrollState = getReviewVirtualState();
  if (virtualScrollState.scrollBound) return;
  window.addEventListener('scroll', onReviewVirtualScroll, { passive: true });
  window.addEventListener('resize', onReviewVirtualScroll, { passive: true });
  virtualScrollState.scrollBound = true;
};

function setReviewFocusQuestion(questionNumber) {
  state.reviewFocusQuestionNumber = Number.isInteger(questionNumber) && questionNumber > 0 ? questionNumber : null;
  const virtualScrollState = getReviewVirtualState();
  for (const card of virtualScrollState.pool || []) {
    const originalIndex = Number(card.dataset.originalIndex);
    const shouldHighlight = state.reviewFocusQuestionNumber != null && Number.isInteger(originalIndex) && state.reviewFocusQuestionNumber === originalIndex + 1;
    card.classList.toggle('review-question-highlight', shouldHighlight);
  };
  const list = getElementById('review-list');
  if (list) {
    list.querySelectorAll('.review-question-highlight').forEach((element) => {
      const originalIndex = Number(element.dataset.originalIndex);
      const shouldHighlight = state.reviewFocusQuestionNumber != null && Number.isInteger(originalIndex) && state.reviewFocusQuestionNumber === originalIndex + 1;
      if (!shouldHighlight) element.classList.remove('review-question-highlight');
    });
  };
};

function scrollReviewToListIndex(index, behavior = 'auto') {
  const virtualScrollState = getReviewVirtualState();
  const list = getElementById('review-list');
  if (!list || index < 0 || index >= virtualScrollState.filtered.length) return;
  rebuildReviewVirtualMetrics(virtualScrollState);
  const listTop = list.getBoundingClientRect().top + window.scrollY;
  const y = Math.max(0, listTop + (virtualScrollState.positions[index] || 0) - 12);
  window.scrollTo({ top: y, behavior });
};

function scrollReviewToQuestionNumber(questionNumber) {
  const virtualScrollState = getReviewVirtualState();
  const index = virtualScrollState.filtered.findIndex((question) => question.originalIndex + 1 === questionNumber);
  if (index < 0) return false;
  const list = getElementById('review-list');
  if (!list) return false;

  setReviewFocusQuestion(questionNumber);
  virtualScrollState.scrollTargetIndex = index;
  virtualScrollState.scrollTargetQuestionNumber = questionNumber;

  const maxPasses = 6;
  const runPass = (pass) => {
    if (virtualScrollState.scrollTargetQuestionNumber !== questionNumber) return;
    scrollReviewToListIndex(index, 'auto');
    syncReviewVirtualWindow();
    measureReviewVirtualVisible(virtualScrollState);
    const card = document.getElementById('review-question-' + questionNumber);
    if (card) {
      const listIndex = Number(card.dataset.listIndex);
      const height = card.offsetHeight;
      if (Number.isInteger(listIndex) && height > 0) {
        const withGap = height + 12;
        virtualScrollState.heights[listIndex] = withGap;
        const originalIndex = virtualScrollState.filtered[listIndex]?.originalIndex;
        if (Number.isInteger(originalIndex)) virtualScrollState.heightByOriginalIndex.set(originalIndex, withGap);
        rebuildReviewVirtualMetrics(virtualScrollState);
      };
      setReviewFocusQuestion(questionNumber);
      const listTop = list.getBoundingClientRect().top + window.scrollY;
      const targetY = Math.max(0, listTop + (virtualScrollState.positions[index] || 0) - 12);
      if (Math.abs(window.scrollY - targetY) > 2) {
        window.scrollTo({ top: targetY, behavior: 'auto' });
        syncReviewVirtualWindow();
      };
    };
    if (pass + 1 < maxPasses) requestAnimationFrame(() => runPass(pass + 1));
    else {
      virtualScrollState.scrollTargetIndex = null;
      virtualScrollState.scrollTargetQuestionNumber = null;
    };
  };
  runPass(0);
  return true;
};

function renderQuestionBank() {
  const { questions, filtered } = getFilteredBankQuestions();
  const gotoInput = getElementById('input-review-goto');
  if (gotoInput) {
    gotoInput.min = '1';
    gotoInput.max = String(Math.max(1, questions.length));
    gotoInput.placeholder = `1–${questions.length}`;
    gotoInput.setAttribute('aria-label', 'Đi đến câu số từ 1 đến ' + questions.length);
  };
  const searchInput = getElementById('input-review-search');
  if (searchInput && searchInput.value !== state.bankSearchQuery) searchInput.value = state.bankSearchQuery;
  getElementById('review-title').textContent = DECKS[state.bankDeck]?.label || 'Ngân hàng câu hỏi';
  document.querySelectorAll('[data-bank-deck]').forEach((button) => button.classList.toggle('active', button.dataset.bankDeck === state.bankDeck));
  updateDeckCountLabels();

  const list = getElementById('review-list');
  const virtualScrollState = getReviewVirtualState();
  virtualScrollState.filtered = filtered;
  syncReviewHeightsFromCache(virtualScrollState);

  list.classList.add('review-list-virtualized');
  const keep = new Set(virtualScrollState.pool);
  if (virtualScrollState.phantom) keep.add(virtualScrollState.phantom);
  for (const child of [...list.children]) {
    if (!keep.has(child)) child.remove();
  };
  if (!virtualScrollState.phantom) {
    virtualScrollState.phantom = document.createElement('div');
    virtualScrollState.phantom.className = 'review-virtual-scroll-placeholder';
    virtualScrollState.phantom.setAttribute('aria-hidden', 'true');
  };
  if (!virtualScrollState.phantom.parentNode) list.insertBefore(virtualScrollState.phantom, list.firstChild);
  ensureReviewVirtualPool(virtualScrollState, list);
  rebuildReviewVirtualMetrics(virtualScrollState);

  if (!filtered.length) {
    for (const card of virtualScrollState.pool) card.hidden = true;
    virtualScrollState.phantom.style.height = '0px';
    let empty = list.querySelector('.review-empty');
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'card review-empty';
      list.appendChild(empty);
    };
    empty.textContent = 'Không có câu hỏi trong vùng hiện tại.';
    empty.hidden = false;
    updateBankSearchHint();
    updateBankSearchNavButtons();
    return;
  };
  const empty = list.querySelector('.review-empty');
  if (empty) empty.hidden = true;

  ensureReviewVirtualScrollBinding();
  syncReviewVirtualWindow();
  updateBankSearchHint();
  updateBankSearchNavButtons();
};

function openQuestionBank() {
  state.setupDeckBeforeBank = state.currentDeck;
  persistSetupForm();
  state.reviewSelectedIndices.clear();
  state.bankSearchQuery = '';
  state.bankSearchMatchIndex = -1;
  state.reviewFocusQuestionNumber = null;
  if (getElementById('input-review-search')) getElementById('input-review-search').value = '';
  if (getElementById('button-review-search-clear')) getElementById('button-review-search-clear').hidden = true;
  if (getElementById('review-search-hint')) {
    getElementById('review-search-hint').hidden = true;
    getElementById('review-search-hint').textContent = '';
  };
  const virtualScrollState = getReviewVirtualState();
  virtualScrollState.heights = [];
  virtualScrollState.positions = [];
  virtualScrollState.rangeStart = 0;
  virtualScrollState.rangeEnd = -1;
  if (getElementById('input-review-goto')) getElementById('input-review-goto').value = '';
  const bank = getBankSettings();
  state.bankDeck = bank.deck === 'quocphong2' ? 'quocphong2' : 'quocphong1';
  applyBankSettingsToForm(bank);
  renderQuestionBank();
  showScreen('review');
  updateBankSearchNavButtons();
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0 });
    syncReviewVirtualWindow();
  });
};

function refreshSetupUI() {
  const questions = currentQuestions();
  const fullTotal = allDeckQuestions(state.currentDeck).length;
  const total = questions.length;
  updateDeckCountLabels();

  document.querySelectorAll('.deck-button').forEach((button) => button.classList.toggle('active', button.dataset.deck === state.currentDeck));

  const startInput = getElementById('input-range-start');
  const endInput = getElementById('input-range-end');
  // Vùng câu hỏi theo số gốc (1..fullTotal); câu ẩn bị loại khi tạo pool
  startInput.max = String(Math.max(1, fullTotal));
  endInput.max = String(Math.max(1, fullTotal));
  let start = Number.parseInt(startInput.value, 10);
  let end = Number.parseInt(endInput.value, 10);
  if (!Number.isInteger(start)) start = 1;
  if (!Number.isInteger(end)) end = fullTotal;
  start = Math.max(1, Math.min(start, Math.max(1, fullTotal)));
  end = Math.max(start, Math.min(end, Math.max(1, fullTotal)));
  startInput.value = String(start);
  endInput.value = String(end);

  const rangeTotal = Math.max(0, end - start + 1);
  const input = getElementById('input-count');
  input.max = String(Math.max(1, rangeTotal));
  const countFocused = document.activeElement === input;
  if (!countFocused) {
    if (Number(input.value) > rangeTotal) input.value = String(rangeTotal || 1);
    if (Number(input.value) < 1 || !Number.isFinite(Number(input.value))) input.value = '1';
  };

  const countNum = Number.parseInt(input.value, 10);
  const isAllCount = Number.isInteger(countNum) && countNum === rangeTotal && rangeTotal > 0;
  const selectAllButton = getElementById('button-select-all');
  if (selectAllButton) {
    selectAllButton.classList.toggle('is-active', isAllCount);
    selectAllButton.setAttribute('aria-pressed', isAllCount ? 'true' : 'false');
    setToggleIcon(selectAllButton, isAllCount, { on: 'deselect', off: 'select-all' });
    selectAllButton.title = isAllCount ? 'Bỏ chọn toàn bộ vùng' : 'Toàn bộ vùng';
    selectAllButton.setAttribute('aria-label', selectAllButton.title);
  };
  input.disabled = isAllCount && !countFocused;

  const timeInput = getElementById('input-time-limit');
  if (timeInput) {
    const timeFocused = document.activeElement === timeInput;
    let timeVal = Number.parseInt(timeInput.value, 10);
    if (!timeFocused) {
      if (!Number.isInteger(timeVal) || timeVal < 0) timeVal = 0;
      timeVal = Math.min(1440, timeVal);
      timeInput.value = String(timeVal);
    };
    const isUnlimited = Number.isInteger(timeVal) && timeVal === 0;
    const unlimitedTimeButton = getElementById('button-unlimited-time');
    if (unlimitedTimeButton) {
      unlimitedTimeButton.classList.toggle('is-active', isUnlimited);
      unlimitedTimeButton.setAttribute('aria-pressed', isUnlimited ? 'true' : 'false');
      setToggleIcon(unlimitedTimeButton, isUnlimited, { on: 'infinity-off', off: 'infinity' });
      unlimitedTimeButton.title = isUnlimited ? 'Bỏ không giới hạn thời gian' : 'Không giới hạn thời gian';
      unlimitedTimeButton.setAttribute('aria-label', unlimitedTimeButton.title);
    };
    timeInput.disabled = isUnlimited && !timeFocused;
  };

  const progress = getDeckProgress(state.currentDeck);
  const completed = new Set(progress.completed);
  const remaining = questions.filter((question) => !completed.has(question.originalIndex)).length;
  const wrongs = getWrongIndices(state.currentDeck);
  getElementById('statistics-completed').textContent = String(completed.size);
  getElementById('statistics-remaining').textContent = String(remaining);
  getElementById('statistics-wrong').textContent = String(wrongs.length);
  getElementById('statistics-practiced').textContent = String(Object.values(progress.practiceMap || {}).reduce((sum, count) => sum + count, 0));
  getElementById('statistics-bookmarked').textContent = String(progress.bookmarks.length);
  if (progress.sequentialCursor >= total) getElementById('statistics-sequential-cursor').textContent = 'Đã làm hết bộ đề';
  else getElementById('statistics-sequential-cursor').textContent = String(progress.sequentialCursor + 1);

  const hiddenSet = new Set(getHiddenIndices(state.currentDeck));
  const practiceWrongButton = getElementById('button-practice-wrong');
  const rangeWrongCount = getRangeWrongIndices(
    state.currentDeck,
    start,
    end
  ).filter((index) => !hiddenSet.has(index)).length;
  practiceWrongButton.disabled = state.practiceMode === 'exam' || rangeWrongCount === 0;
  practiceWrongButton.textContent = 'Ôn ' + rangeWrongCount + ' câu sai trong vùng';

  const allWrongCount = getWrongIndices(state.currentDeck).filter((index) => index < fullTotal && !hiddenSet.has(index)).length;
  const practiceAllWrongButton = getElementById('button-practice-all-wrong');
  practiceAllWrongButton.disabled = state.practiceMode === 'exam' || allWrongCount === 0;
  practiceAllWrongButton.textContent = 'Ôn ' + allWrongCount + ' câu sai của bộ đề';

  const bookmarks = new Set(getBookmarkedIndices(state.currentDeck));
  const rangeBookmarkCount = questions.filter((question) => question.originalIndex >= start - 1 && question.originalIndex < end && bookmarks.has(question.originalIndex) && !hiddenSet.has(question.originalIndex)).length;
  const practiceBookmarksButton = getElementById('button-practice-bookmarks');
  practiceBookmarksButton.disabled = state.practiceMode === 'exam' || rangeBookmarkCount === 0;
  practiceBookmarksButton.textContent = 'Ôn ' + rangeBookmarkCount + ' câu đã đánh dấu';

  const rangeQuestions = questions.filter((question) => question.originalIndex >= start - 1 && question.originalIndex < end);
  const shuffleQuestions = getElementById('checkbox-shuffle-questions').checked;
  const continueButton = getElementById('button-continue');
  const nextQuestion = findNextUncompletedQuestion(rangeQuestions, Math.max(progress.sequentialCursor, start - 1), completed);
  const nextIndex = nextQuestion?.originalIndex ?? end;
  const canContinue = state.practiceMode !== 'exam' && !shuffleQuestions && !!nextQuestion;
  continueButton.hidden = !canContinue;
  if (canContinue) {
    const left = end - nextIndex;
    const n = Math.min(Number(input.value) || 20, left);
    continueButton.textContent = 'Tiếp tục tuần tự ' + n + ' câu từ câu ' + (nextIndex + 1);
  };

  document.querySelectorAll('.preset-btn').forEach((button) => {
    const n = Number(button.dataset.count);
    button.classList.toggle('is-active', Number(input.value) === n);
    button.disabled = n > rangeTotal;
  });

  refreshResumeCard();
};

function refreshResumeCard() {
  const card = getElementById('resume-card');
  if (!card) return;
  const saved = getSession(state.currentDeck);
  if (!saved || !Array.isArray(saved.items) || !saved.items.length) {
    card.hidden = true;
    return;
  };
  const answered = saved.items.filter((item) => item.userAnswer != null).length;
  const isExam = !!saved.examMode || saved.mode === 'exam';
  const deckLabel = DECKS[saved.deckId]?.label || saved.deckId;
  card.hidden = false;
  getElementById('resume-title').textContent = isExam ? saved.reviewMode ? 'Có lượt thi đã chấm' : 'Có lượt thi thử đang dở' : 'Có lượt ôn đang dở';
  getElementById('resume-hint').textContent = isExam ? `${deckLabel} · ${answered} / ${saved.items.length} câu đã chọn${saved.reviewMode ? ' · Đã chấm' : ''}` : `${deckLabel} · Câu ${(saved.viewIndex || 0) + 1} / ${saved.items.length}`;
};

function updateBankCountButtonState() {
  const input = getElementById('review-input-count');
  const button = getElementById('review-button-select-all');
  if (!input || !button) return;
  const selectedCount = state.reviewSelectedIndices.size;
  const countFocused = document.activeElement === input;
  const value = Number.parseInt(input.value, 10);
  const isAll = selectedCount > 0 && Number.isInteger(value) && value === selectedCount;
  button.classList.toggle('is-active', isAll);
  button.setAttribute('aria-pressed', isAll ? 'true' : 'false');
  setToggleIcon(button, isAll, { on: 'deselect', off: 'select-all' });
  button.title = isAll ? 'Bỏ chọn toàn bộ đã chọn' : 'Toàn bộ đã chọn';
  button.setAttribute('aria-label', button.title);
  input.disabled = isAll && !countFocused;
};

function updateBankTimeButtonState() {
  const input = getElementById('review-input-time-limit');
  const button = getElementById('review-button-unlimited-time');
  if (!input || !button) return;
  const timeFocused = document.activeElement === input;
  const timeVal = Number.parseInt(input.value, 10);
  const isUnlimited = Number.isInteger(timeVal) && timeVal === 0;
  button.classList.toggle('is-active', isUnlimited);
  button.setAttribute('aria-pressed', isUnlimited ? 'true' : 'false');
  setToggleIcon(button, isUnlimited, { on: 'infinity-off', off: 'infinity' });
  button.title = isUnlimited ? 'Bỏ không giới hạn thời gian' : 'Không giới hạn thời gian';
  button.setAttribute('aria-label', button.title);
  input.disabled = isUnlimited && !timeFocused;
};

function syncBankCountInput() {
  const input = getElementById('review-input-count');
  if (!input) return;
  const selectedCount = state.reviewSelectedIndices.size;
  const countFocused = document.activeElement === input;
  input.min = selectedCount === 0 ? '0' : '1';
  input.max = String(selectedCount);
  if (selectedCount === 0) input.value = '0';
  else if (!countFocused) {
    const value = Number.parseInt(input.value, 10);
    if (!Number.isInteger(value) || value < 1) input.value = '1';
    else if (value > selectedCount) input.value = String(selectedCount);
  };
  updateBankCountButtonState();
  updateBankTimeButtonState();
};

function readBankForm() {
  const selectedCount = state.reviewSelectedIndices.size;
  let count = Number.parseInt(getElementById('review-input-count')?.value, 10);
  if (selectedCount === 0) count = 0;
  else if (!Number.isInteger(count) || count < 1) count = 1;
  if (count > selectedCount) count = selectedCount;
  let timeLimit = Number.parseInt(getElementById('review-input-time-limit')?.value, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 0) timeLimit = 0;
  timeLimit = Math.min(1440, timeLimit);
  return {
    deck: state.bankDeck === 'quocphong2' ? 'quocphong2' : 'quocphong1',
    count,
    timeLimit,
    shuffleQuestions: !!getElementById('review-checkbox-shuffle-questions')?.checked,
    shuffleAnswers: !!getElementById('review-checkbox-shuffle-answers')?.checked,
    practiceMode: state.bankPracticeMode === 'exam' ? 'exam' : 'practice',
    autoCheck: !!getElementById('review-checkbox-automatic-check')?.checked,
    autoAdvance: !!getElementById('review-checkbox-automatic-advance')?.checked,
    vibrationEnabled: !!getElementById('review-checkbox-vibration')?.checked,
    autoAdvanceDelay: (() => {
      const delay = Number.parseInt(getElementById('review-input-auto-advance-delay')?.value, 10);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    soundVolume: (() => {
      const input = getElementById('review-input-sound-volume');
      return normalizeSoundVolume(input?.dataset?.lastVolume || input?.value, 1);
    })(),
    soundEnabled: !!getElementById('review-checkbox-sound')?.checked
  };
};

function applyBankSettingsToForm(settings) {
  if (!settings || !getElementById('review-input-count')) return;
  const selectedCount = state.reviewSelectedIndices.size;
  const savedCount = Number(settings.count);
  getElementById('review-input-count').value = String(selectedCount === 0 ? 0 : Math.min(selectedCount, Number.isInteger(savedCount) && savedCount >= 1 ? savedCount : 1));
  getElementById('review-input-count').min = selectedCount === 0 ? '0' : '1';
  getElementById('review-input-count').max = String(selectedCount);
  getElementById('review-input-time-limit').value = String(Number.isInteger(settings.timeLimit) && settings.timeLimit >= 0 ? Math.min(1440, settings.timeLimit) : 35);
  getElementById('review-checkbox-shuffle-questions').checked = settings.shuffleQuestions !== false;
  getElementById('review-checkbox-shuffle-answers').checked = settings.shuffleAnswers !== false;
  if (getElementById('review-checkbox-automatic-check')) {
    getElementById('review-checkbox-automatic-check').checked = settings.autoCheck === true;
    getElementById('review-checkbox-automatic-advance').checked = settings.autoAdvance === true;
    getElementById('review-checkbox-vibration').checked = settings.vibrationEnabled === true;
  };
  if (getElementById('review-input-auto-advance-delay')) {
    const delay = Number.isInteger(settings.autoAdvanceDelay) && settings.autoAdvanceDelay >= 0 ? Math.min(10, settings.autoAdvanceDelay) : 0;
    getElementById('review-input-auto-advance-delay').value = String(delay);
    if (getElementById('review-label-auto-advance-delay')) getElementById('review-label-auto-advance-delay').textContent = delay + ' giây';
  };
  const volume = normalizeSoundVolume(settings.soundVolume, 1);
  if (getElementById('review-input-sound-volume')) {
    getElementById('review-input-sound-volume').value = String(volume);
    getElementById('review-input-sound-volume').dataset.lastVolume = String(volume);
    if (getElementById('review-label-sound-volume')) getElementById('review-label-sound-volume').textContent = volume + '%';
  };
  if (getElementById('review-checkbox-sound')) getElementById('review-checkbox-sound').checked = settings.soundEnabled !== false && (settings.soundEnabled === true || (Number(settings.soundVolume) || 0) > 0);
  updateBankExperienceControls();
  state.bankPracticeMode = settings.practiceMode === 'exam' ? 'exam' : 'practice';
  document.querySelectorAll('#screen-review .mode-button').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === state.bankPracticeMode));
  document.querySelectorAll('[data-bank-deck]').forEach((button) => button.classList.toggle('active', button.dataset.bankDeck === state.bankDeck));
  updateBankCountButtonState();
  updateBankTimeButtonState();
};

function persistBankForm() {
  const form = readBankForm();
  const saved = saveBankSettings(form);
  if (!saved) toast('Không thể lưu tuỳ chọn ngân hàng. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
  return form;
};

function normalizeSoundVolume(value, fallback = 1) {
  const volume = Number.parseInt(value, 10);
  if (!Number.isInteger(volume)) return fallback;
  return Math.min(100, Math.max(1, volume));
};

function syncExperienceToggleButton(buttonId, checkboxId, onIcon, offIcon, onLabel, offLabel) {
  const button = getElementById(buttonId);
  const checkbox = getElementById(checkboxId);
  if (!button || !checkbox) return;
  const on = !!checkbox.checked;
  button.classList.toggle('is-on', on);
  button.setAttribute('aria-pressed', String(on));
  button.dataset.icon = on ? onIcon : offIcon;
  button.setAttribute('aria-label', on ? offLabel : onLabel);
  button.title = on ? offLabel : onLabel;
};

function updateSetupExperienceControls() {
  const autoAdvanceOn = !!getElementById('checkbox-automatic-advance')?.checked;
  const delayInput = getElementById('input-auto-advance-delay');
  const delayField = getElementById('field-auto-advance-delay');
  if (delayInput) delayInput.disabled = !autoAdvanceOn;
  if (delayField) delayField.classList.toggle('is-disabled', !autoAdvanceOn);
  syncExperienceToggleButton('button-auto-advance', 'checkbox-automatic-advance', 'toggle-right', 'toggle-left', 'Bật tự sang câu tiếp', 'Tắt tự sang câu tiếp');

  const soundOn = !!getElementById('checkbox-sound')?.checked;
  const volumeInput = getElementById('input-sound-volume');
  const volumeField = getElementById('field-sound-volume');
  if (volumeInput) volumeInput.disabled = !soundOn;
  if (volumeField) volumeField.classList.toggle('is-disabled', !soundOn);
  syncExperienceToggleButton('button-sound', 'checkbox-sound', 'volume-off', 'volume', 'Bật âm thanh', 'Tắt âm thanh');
};

function updateBankExperienceControls() {
  const autoAdvanceOn = !!getElementById('review-checkbox-automatic-advance')?.checked;
  const delayInput = getElementById('review-input-auto-advance-delay');
  const delayField = getElementById('review-field-auto-advance-delay');
  if (delayInput) delayInput.disabled = !autoAdvanceOn;
  if (delayField) delayField.classList.toggle('is-disabled', !autoAdvanceOn);
  syncExperienceToggleButton('review-button-automatic-advance', 'review-checkbox-automatic-advance', 'toggle-right', 'toggle-left', 'Bật tự sang câu tiếp', 'Tắt tự sang câu tiếp');

  const soundOn = !!getElementById('review-checkbox-sound')?.checked;
  const volumeInput = getElementById('review-input-sound-volume');
  const volumeField = getElementById('review-field-sound-volume');
  if (volumeInput) volumeInput.disabled = !soundOn;
  if (volumeField) volumeField.classList.toggle('is-disabled', !soundOn);
  syncExperienceToggleButton('review-button-sound', 'review-checkbox-sound', 'volume-off', 'volume', 'Bật âm thanh', 'Tắt âm thanh');
};

function syncSoundFromVolume(volumeInputId, checkboxId, labelId) {
  const volumeInput = getElementById(volumeInputId);
  if (!volumeInput) return 1;
  const volume = normalizeSoundVolume(volumeInput.value, 1);
  volumeInput.value = String(volume);
  if (getElementById(labelId)) getElementById(labelId).textContent = volume + '%';
  volumeInput.dataset.lastVolume = String(volume);
  if (getElementById(checkboxId) && !getElementById(checkboxId).checked) getElementById(checkboxId).checked = true;
  return volume;
};

function syncVolumeFromSoundCheckbox(volumeInputId, checkboxId, labelId) {
  const checkbox = getElementById(checkboxId);
  const volumeInput = getElementById(volumeInputId);
  if (!checkbox || !volumeInput) return;
  if (checkbox.checked) {
    const restored = normalizeSoundVolume(volumeInput.dataset.lastVolume || volumeInput.value, 1);
    volumeInput.value = String(restored);
    volumeInput.dataset.lastVolume = String(restored);
    if (getElementById(labelId)) getElementById(labelId).textContent = restored + '%';
  } else {
    const current = normalizeSoundVolume(volumeInput.value, 1);
    volumeInput.dataset.lastVolume = String(current);
    if (getElementById(labelId)) getElementById(labelId).textContent = current + '%';
  };
};

function setBankPracticeMode(mode) {
  state.bankPracticeMode = mode === 'exam' ? 'exam' : 'practice';
  document.querySelectorAll('#screen-review .mode-button').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === state.bankPracticeMode));
  persistBankForm();
  renderQuestionBank();
};

function setBankDeck(deckId) {
  const id = deckId === 'quocphong2' ? 'quocphong2' : 'quocphong1';
  if (state.bankDeck === id) return;
  persistBankForm();
  state.bankDeck = id;
  state.reviewSelectedIndices.clear();
  state.bankSearchMatchIndex = -1;
  state.reviewEditingNoteIndex = null;
  state.reviewEditingNoteDraft = '';
  const virtualScrollState = getReviewVirtualState();
  virtualScrollState.heights = [];
  virtualScrollState.positions = [];
  const settings = getBankSettings();
  applyBankSettingsToForm({ ...settings, deck: id, count: 0 });
  persistBankForm();
  renderQuestionBank();
  if (getElementById('bank-count-quocphong1')) {
    getElementById('bank-count-quocphong1').textContent = (state.decks.quocphong1?.length ?? 479) + ' câu';
    getElementById('bank-count-quocphong2').textContent = (state.decks.quocphong2?.length ?? 262) + ' câu';
  };
  updateBankSearchHint();
  updateBankSearchNavButtons();
};

function startPracticeBookmarks() {
  const form = readSetupForm();
  persistSetupForm();
  const questions = selectedQuestions(form);
  const bookmarked = getBookmarkedIndices(state.currentDeck);
  const pool = pickWrong(questions, bookmarked, form.count, form.shuffleQuestions);
  if (!pool.length) {
    toast('Trong vùng câu hỏi đã chọn không có câu nào được đánh dấu.');
    return;
  };
  const practiceSaveFailed = pool.some((question) => markPracticed(state.currentDeck, question.originalIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê ôn lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-bookmarks',
    sequential: false,
    forceShuffleQuestions: form.shuffleQuestions,
    alreadyShuffled: true
  });
};

function readSetupForm() {
  const total = currentQuestions().length;
  let startQuestion = Number.parseInt(getElementById('input-range-start').value, 10);
  let endQuestion = Number.parseInt(getElementById('input-range-end').value, 10);
  if (!Number.isInteger(startQuestion)) startQuestion = 1;
  if (!Number.isInteger(endQuestion)) endQuestion = total;
  startQuestion = Math.max(1, Math.min(startQuestion, Math.max(1, total)));
  endQuestion = Math.max(startQuestion, Math.min(endQuestion, Math.max(1, total)));

  let count = Number.parseInt(getElementById('input-count').value, 10);
  const rangeCount = Math.max(1, endQuestion - startQuestion + 1);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > rangeCount) count = rangeCount;
  let timeLimit = Number.parseInt(getElementById('input-time-limit').value, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 0) timeLimit = 0;
  timeLimit = Math.min(1440, timeLimit);
  const shuffleQuestions = getElementById('checkbox-shuffle-questions').checked;
  const shuffleAnswers = getElementById('checkbox-shuffle-answers').checked;
  return {
    count,
    shuffleQuestions,
    shuffleAnswers,
    startQuestion,
    endQuestion,
    timeLimit
  };
};

function persistSetupForm() {
  const form = readSetupForm();
  const saved = saveSettings({
    deck: state.currentDeck,
    count: form.count,
    shuffleQuestions: form.shuffleQuestions,
    shuffleAnswers: form.shuffleAnswers,
    startQuestion: form.startQuestion,
    endQuestion: form.endQuestion,
    timeLimit: form.timeLimit,
    practiceMode: state.practiceMode,
    autoCheck: getElementById('checkbox-automatic-check').checked,
    autoAdvance: getElementById('checkbox-automatic-advance').checked,
    vibrationEnabled: getElementById('checkbox-vibration').checked,
    autoAdvanceDelay: (() => {
      const delay = Number.parseInt(getElementById('input-auto-advance-delay')?.value, 10);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    soundVolume: (() => {
      const input = getElementById('input-sound-volume');
      return normalizeSoundVolume(input?.dataset?.lastVolume || input?.value, 1);
    })(),
    soundEnabled: !!getElementById('checkbox-sound')?.checked
  });
  if (!saved) toast('Không thể lưu tùy chọn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
};

function applySettingsToForm(settings) {
  if (!settings) return;
  const total = currentQuestions().length || settings.endQuestion || 1;
  getElementById('input-count').value = String(settings.count || 30);
  getElementById('input-time-limit').value = String(Number.isInteger(settings.timeLimit) && settings.timeLimit >= 0 ? Math.min(1440, settings.timeLimit) : 35);
  getElementById('input-range-start').value = String(settings.startQuestion || 1);
  getElementById('input-range-end').value = String(settings.endQuestion > 0 ? Math.min(settings.endQuestion, total) : total);
  getElementById('checkbox-shuffle-questions').checked = !!settings.shuffleQuestions;
  getElementById('checkbox-shuffle-answers').checked = !!settings.shuffleAnswers;
  getElementById('checkbox-automatic-check').checked = settings.autoCheck === true;
  getElementById('checkbox-automatic-advance').checked = settings.autoAdvance === true;
  getElementById('checkbox-vibration').checked = settings.vibrationEnabled === true;
  if (getElementById('input-auto-advance-delay')) {
    const delay = Number.isInteger(settings.autoAdvanceDelay) && settings.autoAdvanceDelay >= 0 ? Math.min(10, settings.autoAdvanceDelay) : 5;
    getElementById('input-auto-advance-delay').value = String(delay);
    if (getElementById('label-auto-advance-delay')) getElementById('label-auto-advance-delay').textContent = delay + ' giây';
  };
  const volume = normalizeSoundVolume(settings.soundVolume, 1);
  if (getElementById('input-sound-volume')) {
    getElementById('input-sound-volume').value = String(volume);
    getElementById('input-sound-volume').dataset.lastVolume = String(volume);
    if (getElementById('label-sound-volume')) getElementById('label-sound-volume').textContent = volume + '%';
  };
  if (getElementById('checkbox-sound')) getElementById('checkbox-sound').checked = settings.soundEnabled !== false && (settings.soundEnabled === true || (Number(settings.soundVolume) || 0) > 0);
  updateSetupExperienceControls();
  setPracticeMode(settings.practiceMode === 'exam' ? 'exam' : 'practice');
};

function stopSessionTimer(freeze = true) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  const session = state.session;
  if (freeze && session && !session.finishedAt) {
    session.finishedAt = Date.now();
    persistSession();
  };
  updateTimerDisplay();
};

function selectedQuestions(form = readSetupForm()) {
  return currentQuestions().filter((question) => question.originalIndex >= form.startQuestion - 1 && question.originalIndex < form.endQuestion);
};

function startSessionFromPool(pool, meta) {
  const fromBank = !!meta.fromBank;
  const form = fromBank ? {
    ...readBankForm(),
    shuffleAnswers: meta.shuffleAnswers != null ? meta.shuffleAnswers : readBankForm().shuffleAnswers,
    timeLimit: meta.timeLimit != null ? meta.timeLimit : readBankForm().timeLimit
  } : readSetupForm();
  const shuffleAnswers = meta.shuffleAnswers != null ? meta.shuffleAnswers : form.shuffleAnswers;
  const shuffleQuestions = meta.forceShuffleQuestions != null ? meta.forceShuffleQuestions : form.shuffleQuestions;
  const shouldShuffleQuestions = meta.alreadyShuffled ? false : !!shuffleQuestions;
  const timeLimit = meta.timeLimit != null ? meta.timeLimit : form.timeLimit;
  const items = createSessionItems(pool, {
    shuffleQuestions: shouldShuffleQuestions,
    shuffleAnswers
  });
  const session = {
    deckId: state.currentDeck,
    dataFingerprint: state.fingerprints[state.currentDeck],
    mode: meta.mode || 'normal',
    rangeStart: meta.rangeStart ?? form.startQuestion,
    rangeEnd: meta.rangeEnd ?? form.endQuestion,
    requestedCount: meta.requestedCount ?? form.count,
    sequential: !!meta.sequential,
    startCursor: meta.startCursor ?? null,
    nextCursor: meta.nextCursor ?? null,
    shuffleQuestions,
    shuffleAnswers,
    fromBank,
    pool: pool.map((question) => ({
      originalIndex: question.originalIndex,
      question: question.question,
      options: question.options.slice(),
      correct: question.correct
    })),
    items,
    viewIndex: 0,
    reviewingPast: false,
    maxReached: 0,
    completedInSession: 0,
    practiceInitialCount: meta.mode === 'practice-wrong' ? pool.length : 0,
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
    timeExpired: false
  };
  const examRequested = meta.examMode != null ? !!meta.examMode : fromBank ? state.bankPracticeMode === 'exam' : state.practiceMode === 'exam';
  if (examRequested) {
    session.examMode = true;
    session.mode = session.mode === 'normal' ? 'exam' : session.mode;
  };
  state.session = session;
  state.reviewMode = false;
  state.examFilter = 'all';
  state.examSubmitting = false;
  if (!saveSession(session)) toast('Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.');
  if (session.examMode) {
    showScreen('exam');
    renderExam();
  } else {
    showScreen('quiz');
    renderQuestion();
  };
  startSessionTimer();
};

function startNormal(answerOptionsElement = {}) {
  const allQuestions = currentQuestions();
  if (!allQuestions.length) {
    toast('Bộ đề trống.');
    return;
  };
  const form = readSetupForm();
  const questions = selectedQuestions(form);
  if (!questions.length) {
    toast('Vùng câu hỏi đã chọn không có câu hợp lệ.');
    return;
  };
  persistSetupForm();
  const progress = getDeckProgress(state.currentDeck);
  const completedSet = new Set(progress.completed);
  const rangeStart = form.startQuestion - 1;
  const rangeEnd = form.endQuestion;

  if (answerOptionsElement.restart) {
    const { items, nextCursor } = pickSequential(questions, 0, form.count, new Set());
    const globalNextCursor = nextCursor > 0 ? questions[Math.min(nextCursor, questions.length) - 1].originalIndex + 1 : rangeStart;
    startSessionFromPool(items, {
      mode: 'normal',
      sequential: true,
      startCursor: rangeStart,
      nextCursor: globalNextCursor,
      forceShuffleQuestions: false,
      alreadyShuffled: true
    });
    return;
  };

  if (answerOptionsElement.sequential) {
    const nextQuestion = findNextUncompletedQuestion(questions, Math.max(progress.sequentialCursor, rangeStart), completedSet);
    if (!nextQuestion) {
      toast('Đã hoàn thành toàn bộ câu trong vùng đã chọn.');
      return;
    };
    const cursor = nextQuestion.originalIndex;
    const scanQuestions = questions.filter((question) => question.originalIndex >= cursor);
    const { items, nextCursor, actualCount } = pickSequential(scanQuestions, 0, form.count, completedSet);
    if (!items.length) {
      toast('Không còn câu tuần tự trong vùng đã chọn.');
      return;
    };
    if (actualCount < form.count) toast('Chỉ còn ' + actualCount + ' câu theo thứ tự trong vùng đã chọn.');
    const globalNextCursor = nextCursor > 0 ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1].originalIndex + 1 : cursor;
    startSessionFromPool(items, {
      mode: 'normal',
      sequential: true,
      startCursor: cursor,
      nextCursor: globalNextCursor,
      forceShuffleQuestions: false,
      alreadyShuffled: true
    });
    return;
  };

  if (form.shuffleQuestions) {
    const remainingCount = questions.filter((question) => !completedSet.has(question.originalIndex)).length;
    const pool = pickRandom(questions, form.count, true, completedSet);
    if (!pool.length) {
      toast('Không lấy được câu hỏi trong vùng đã chọn.');
      return;
    };
    if (remainingCount === 0) toast('Bạn đã hoàn thành các câu trong vùng này; lượt này lấy ngẫu nhiên trong vùng đã chọn.');
    else if (remainingCount < form.count) toast('Chỉ còn ' + remainingCount + ' câu chưa hoàn thành trong vùng; đã bổ sung câu đã làm để đủ ' + pool.length + ' câu.');
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQuestions: true,
      alreadyShuffled: true
    });
    return;
  };

  const nextQuestion = findNextUncompletedQuestion(questions, Math.max(progress.sequentialCursor, rangeStart), completedSet);
  const cursor = nextQuestion?.originalIndex ?? rangeEnd;
  const scanQuestions = questions.filter((question) => question.originalIndex >= cursor);
  const { items, nextCursor, actualCount } = pickSequential(scanQuestions, 0, form.count, completedSet);
  if (!items.length) {
    const pool = pickRandom(questions, form.count, false, completedSet);
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQuestions: true,
      alreadyShuffled: true
    });
    toast('Đã hết chuỗi tuần tự trong vùng, chuyển sang ngẫu nhiên trong vùng đã chọn.');
    return;
  };
  if (actualCount < form.count) toast('Lượt này có ' + actualCount + ' câu trong vùng đã chọn.');
  const globalNextCursor = nextCursor > 0 ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1].originalIndex + 1 : cursor;
  startSessionFromPool(items, {
    mode: 'normal',
    sequential: true,
    startCursor: cursor,
    nextCursor: globalNextCursor,
    forceShuffleQuestions: false,
    alreadyShuffled: true
  });
};

function startPracticeWrong(options = {}) {
  const form = readSetupForm();
  persistSetupForm();
  const allDeck = options.allDeck === true;
  const questions = allDeck ? currentQuestions() : selectedQuestions(form);
  const rangeIndices = new Set(questions.map((question) => question.originalIndex));
  const sourceIndices = Array.isArray(options.indices) ? options.indices : allDeck ? getWrongIndices(state.currentDeck) : getRangeWrongIndices(state.currentDeck, form.startQuestion, form.endQuestion);
  const wrongs = [...new Set(sourceIndices)].filter((index) => rangeIndices.has(index));
  if (!wrongs.length) {
    toast(allDeck ? 'Bộ đề này chưa có câu sai để ôn.' : 'Trong vùng câu hỏi đã chọn không có câu sai để ôn.');
    return;
  };
  const pool = pickWrong(questions, wrongs, allDeck ? wrongs.length : form.count, form.shuffleQuestions);
  if (!pool.length) {
    toast('Không tìm thấy câu sai hợp lệ trong bộ đề đã chọn. Hãy tải lại bộ đề.');
    return;
  };
  const practiceSaveFailed = pool.some((question) => markPracticed(state.currentDeck, question.originalIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê ôn lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-wrong',
    sequential: false,
    forceShuffleQuestions: form.shuffleQuestions,
    alreadyShuffled: true,
    ...(allDeck ? {
      rangeStart: 1,
      rangeEnd: questions.length,
      requestedCount: pool.length,
    } : {})
  });
};

function recordWrongAnswer(session, originalIndex) {
  if (markWrong(session.deckId, originalIndex) === null) toast('Không thể lưu lịch sử câu sai vào trình duyệt.');
  if (Number.isInteger(session.rangeStart) && Number.isInteger(session.rangeEnd) && !addWrongIndicesForRange(session.deckId, session.rangeStart, session.rangeEnd, [originalIndex])) toast('Không thể lưu câu sai riêng cho vùng câu hỏi này.');
};

function currentSessionItem() {
  const session = state.session;
  if (!session) return null;
  return session.items[session.viewIndex];
};

function currentQuestion() {
  const session = state.session;
  const item = currentSessionItem();
  if (!session || !item) return null;
  return session.pool[item.poolIndex];
};

function renderQuestion() {
  const session = state.session;
  if (!session) return;
  const item = currentSessionItem();
  const question = currentQuestion();
  if (!item || !question) return;

  const viewingHistory = session.viewIndex < session.maxReached;

  getElementById('progress-label').textContent = 'Câu ' + (session.viewIndex + 1) + ' / ' + session.items.length;
  const progressTotal = session.mode === 'practice-wrong' ? session.practiceInitialCount || session.items.length : session.items.length;
  getElementById('progress-score').textContent = 'Điểm ' + formatScore(session.firstTryCorrect || 0, progressTotal) + ' / 10';
  updateTimerDisplay();
  const percentage = progressTotal ? Math.round((session.completedInSession / progressTotal) * 100) : 0;
  getElementById('progress-fill').style.width = percentage + '%';
  getElementById('progress-fill').parentElement.setAttribute('aria-valuenow', String(percentage));

  getElementById('question-badge').textContent = session.mode === 'practice-wrong' ? 'Ôn câu sai · Gốc #' + (question.originalIndex + 1) : session.mode === 'practice-bookmarks' ? 'Ôn câu đã đánh dấu · Gốc #' + (question.originalIndex + 1) : 'Câu hỏi · Gốc #' + (question.originalIndex + 1);
  const bookmarkButton = getElementById('button-bookmark');
  const isBookmarked = getBookmarkedIndices(session.deckId).includes(question.originalIndex);
  bookmarkButton.classList.toggle('is-bookmarked', isBookmarked);
  bookmarkButton.setAttribute('aria-pressed', String(isBookmarked));
  setToggleIcon(bookmarkButton, isBookmarked, { on: 'bookmark-off', off: 'bookmark' });
  bookmarkButton.setAttribute('aria-label', isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu');
  bookmarkButton.title = isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu';
  const noteButton = getElementById('button-note');
  const existingNote = getQuestionNote(session.deckId, question.originalIndex);
  const noteDisplay = getElementById('question-note-display');
  const noteTextEl = getElementById('question-note-text');
  const notePanel = getElementById('question-note-panel');
  const noteInput = getElementById('question-note-input');
  const noteWrap = getElementById('question-note-wrap');
  const editingNote = notePanel && !notePanel.hidden;
  if (noteButton) {
    noteButton.classList.toggle('has-note', !!existingNote);
    noteButton.setAttribute('aria-pressed', String(!!existingNote || editingNote));
    noteButton.setAttribute('aria-label', existingNote || editingNote ? 'Sửa ghi chú' : 'Thêm ghi chú');
    noteButton.title = existingNote || editingNote ? 'Sửa ghi chú' : 'Thêm ghi chú';
  };
  if (noteWrap && session.examMode) {
    noteWrap.hidden = true;
    if (notePanel) notePanel.hidden = true;
    if (noteDisplay) noteDisplay.hidden = true;
  } else if (noteWrap) {
    noteWrap.hidden = false;
    if (editingNote && noteInput) {
      noteInput.value = existingNote;
      if (noteDisplay) noteDisplay.hidden = true;
    } else {
      if (notePanel) notePanel.hidden = true;
      if (noteDisplay && noteTextEl) {
        if (existingNote) {
          noteTextEl.textContent = existingNote;
          noteDisplay.hidden = false;
        } else {
          noteTextEl.textContent = '';
          noteDisplay.hidden = true;
        };
      };
    };
  };
  renderTextWithHighlights(getElementById('question-text'), question.question, session.deckId, question.originalIndex, 'question');
  const highlightToolbar = getElementById('quiz-highlight-toolbar');
  if (highlightToolbar) highlightToolbar.hidden = session.examMode === true;
  if (noteButton) noteButton.hidden = session.examMode === true;

  const answerOptionsElement = getElementById('options');
  answerOptionsElement.replaceChildren();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  item.optionOrder.forEach((origIdx, displayIdx) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer-option';
    button.setAttribute('aria-pressed', String(item.userAnswer === displayIdx));
    button.dataset.display = String(displayIdx);

    if (item.userAnswer === displayIdx) button.classList.add('selected');
    if (item.checked && item.status === 'correct' && displayIdx === item.userAnswer) button.classList.add('correct', 'answer-bounce');
    if (item.checked && item.status === 'wrong' && displayIdx === item.userAnswer) button.classList.add('incorrect', 'answer-shake');
    const wrongOptions = Array.isArray(item.wrongOptions) ? item.wrongOptions : [];
    if (wrongOptions.includes(origIdx)) {
      button.classList.add('incorrect', 'locked');
      button.disabled = true;
    };
    if (item.status === 'correct') {
      button.classList.add('locked');
      button.disabled = true;
      if (displayIdx === displayedCorrectIndex(item, question)) button.classList.add('correct');
    } else if (viewingHistory) {
      button.disabled = true;
      button.classList.add('locked');
    };

    const key = document.createElement('span');
    key.className = 'answer-option-key';
    key.textContent = labels[displayIdx] || String(displayIdx + 1);
    const text = document.createElement('span');
    text.className = 'answer-option-text';
    renderTextWithHighlights(text, question.options[origIdx], session.deckId, question.originalIndex, 'option:' + origIdx);
    button.append(key, text);

    if (!button.disabled) button.addEventListener('click', () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        const range = selection.getRangeAt(0);
        const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
        const endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
        if (button.contains(startNode) && button.contains(endNode)) {
          captureHighlightSelection();
          return;
        };
      };
      onSelectOption(displayIdx);
    });
    answerOptionsElement.appendChild(button);
  });

  const feedback = getElementById('feedback');
  if (item.checked && item.status === 'correct') {
    feedback.hidden = false;
    feedback.className = 'feedback is-correct-answer';
    feedback.textContent = 'Chính xác!';
  } else if (item.checked && item.status === 'wrong') {
    feedback.hidden = false;
    feedback.className = 'feedback is-incorrect-answer';
    feedback.textContent = 'Chưa đúng. Hãy chọn lại đáp án khác.';
  } else {
    feedback.hidden = true;
    feedback.textContent = '';
  };

  getElementById('button-prev').disabled = session.viewIndex <= 0;
  const nextButton = getElementById('button-next');
  if (viewingHistory) {
    nextButton.textContent = 'Câu tiếp';
    nextButton.dataset.icon = 'chevron-right';
    nextButton.disabled = session.viewIndex >= session.maxReached;
  } else if (item.status === 'correct') {
    const isLastQuestion = session.viewIndex === session.items.length - 1;
    let shouldFinish = isLastQuestion && session.mode !== 'practice-wrong';
    if (isLastQuestion && session.mode === 'practice-wrong') {
      const unresolved = session.items.filter((entry) => entry.status !== 'correct');
      shouldFinish = unresolved.length === 0;
    };
    nextButton.textContent = shouldFinish ? 'Kết thúc' : 'Câu tiếp';
    nextButton.dataset.icon = shouldFinish ? 'check' : 'chevron-right';
    nextButton.disabled = false;
  } else if (session.mode === 'practice-wrong' && item.status === 'wrong' && item.checked) {
    nextButton.textContent = 'Câu tiếp';
    nextButton.dataset.icon = 'chevron-right';
    nextButton.disabled = false;
  } else {
    nextButton.textContent = 'Kiểm tra';
    nextButton.dataset.icon = 'check';
    nextButton.disabled = item.userAnswer == null || item.checked;
  };
};

function setPracticeMode(mode) {
  state.practiceMode = mode === 'exam' ? 'exam' : 'practice';
  document.querySelectorAll('#screen-setup .mode-button').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === state.practiceMode));
  const startBtn = getElementById('button-start');
  if (startBtn) startBtn.textContent = state.practiceMode === 'exam' ? 'Bắt đầu thi thử' : 'Bắt đầu ôn luyện';
  persistSetupForm();
  if (state.mode === 'setup' && state.decks.quocphong1) refreshSetupUI();
};

function updateExamProgressHeader() {
  const session = state.session;
  if (!session || !session.examMode) return;
  const answered = session.items.filter((item) => item.userAnswer != null).length;
  const unanswered = session.items.length - answered;
  getElementById('exam-progress-label').textContent = session.reviewMode ? 'Kết quả · ' + (session.firstTryCorrect || 0) + ' / ' + session.items.length + ' câu đúng' : 'Đã chọn ' + answered + ' / ' + session.items.length + ' câu';
  const percentage = session.items.length ? Math.round((answered / session.items.length) * 100) : 0;
  const fill = getElementById('exam-progress-fill');
  if (fill) {
    fill.style.width = percentage + '%';
    fill.parentElement?.setAttribute('aria-valuenow', String(percentage));
  };
  updateTimerDisplay();
  const filterWrong = getElementById('exam-filter-wrong');
  const filterCorrect = getElementById('exam-filter-correct');
  if (filterWrong) filterWrong.hidden = !session.reviewMode;
  if (filterCorrect) filterCorrect.hidden = !session.reviewMode;
  const nextEmpty = getElementById('button-exam-next-empty');
  if (nextEmpty) {
    nextEmpty.hidden = session.reviewMode || unanswered === 0;
    nextEmpty.textContent = unanswered ? 'Còn ' + unanswered + ' câu' : 'Đủ đáp án';
  };
  const pauseBtn = getElementById('button-exam-pause');
  if (pauseBtn) pauseBtn.hidden = !!session.reviewMode;
  const submitBtn = getElementById('button-exam-submit');
  if (submitBtn) {
    if (session.reviewMode) {
      submitBtn.textContent = 'Xem tổng kết';
      submitBtn.dataset.icon = 'list-check';
      submitBtn.disabled = false;
    } else {
      submitBtn.textContent = 'Nộp bài';
      submitBtn.dataset.icon = 'check';
      submitBtn.disabled = !!state.examSubmitting;
    };
  };
  document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('is-active', chip.dataset.filter === state.examFilter));
};

function applyExamFilter() {
  const session = state.session;
  if (!session?.examMode) return;
  const filter = state.examFilter || 'all';
  session.items.forEach((item, index) => {
    const card = getElementById('exam-q-' + index);
    if (!card) return;
    let show = true;
    if (filter === 'unanswered') show = item.userAnswer == null;
    else if (filter === 'wrong') show = item.status === 'wrong';
    else if (filter === 'correct') show = item.status === 'correct';
    card.hidden = !show;
  });
};

function scrollToExamQuestion(index) {
  const card = getElementById('exam-q-' + index);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function jumpToNextUnanswered(fromIdx = -1) {
  const session = state.session;
  if (!session?.examMode || session.reviewMode) return;
  const start = fromIdx + 1;
  let found = session.items.findIndex((item, i) => i >= start && item.userAnswer == null);
  if (found < 0) found = session.items.findIndex((item) => item.userAnswer == null);
  if (found >= 0) {
    state.examFilter = 'all';
    applyExamFilter();
    updateExamProgressHeader();
    scrollToExamQuestion(found);
  } else toast('Bạn đã chọn đủ đáp án.');
};

function renderExam() {
  const session = state.session;
  if (!session || !session.examMode) return;
  const list = getElementById('exam-list');
  const nav = getElementById('exam-navigation');
  if (!list || !nav) return;
  const scrollY = window.scrollY;
  list.replaceChildren();
  nav.replaceChildren();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  updateExamProgressHeader();

  session.items.forEach((item, index) => {
    const question = session.pool[item.poolIndex];
    const card = document.createElement('article');
    card.className = 'exam-question-card';
    card.id = 'exam-q-' + index;
    if (item.userAnswer != null) card.classList.add('is-answered');
    if (session.reviewMode) {
      if (item.status === 'correct') card.classList.add('is-correct');
      else if (item.status === 'wrong') card.classList.add('is-wrong');
    };

    const head = document.createElement('div');
    head.className = 'exam-question-header';
    const num = document.createElement('span');
    num.className = 'exam-question-number';
    num.textContent = 'Câu ' + (index + 1) + ' · Gốc #' + (question.originalIndex + 1);
    head.appendChild(num);
    if (session.reviewMode) {
      const badge = document.createElement('span');
      badge.className = 'exam-status-badge ' + (item.status === 'correct' ? 'is-correct-answer' : 'is-incorrect-answer');
      badge.textContent = item.status === 'correct' ? 'Đúng' : item.userAnswer == null ? 'Bỏ trống' : 'Sai';
      head.appendChild(badge);
    };
    card.appendChild(head);

    const text = document.createElement('h3');
    text.className = 'exam-question-text';
    text.textContent = question.question;
    card.appendChild(text);

    const answerOptionsElement = document.createElement('div');
    answerOptionsElement.className = 'exam-options answer-options';
    answerOptionsElement.setAttribute('role', 'group');
    answerOptionsElement.setAttribute('aria-label', 'Đáp án câu ' + (index + 1));

    item.optionOrder.forEach((origIdx, displayIdx) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-option';
      button.dataset.q = String(index);
      button.dataset.display = String(displayIdx);
      button.setAttribute('aria-pressed', String(item.userAnswer === displayIdx));
      if (item.userAnswer === displayIdx) button.classList.add('selected');
      if (session.reviewMode) {
        button.disabled = true;
        const correctDisplay = item.optionOrder.indexOf(question.correct);
        if (displayIdx === correctDisplay) button.classList.add('correct');
        if (item.userAnswer === displayIdx && item.status === 'wrong') button.classList.add('incorrect');
      };
      const label = document.createElement('span');
      label.className = 'answer-option-key';
      label.textContent = labels[displayIdx] || String(displayIdx + 1);
      const body = document.createElement('span');
      body.className = 'answer-option-text';
      body.textContent = question.options[origIdx];
      button.append(label, body);
      if (!session.reviewMode) button.addEventListener('click', () => onExamSelect(index, displayIdx));
      answerOptionsElement.appendChild(button);
    });
    card.appendChild(answerOptionsElement);
    list.appendChild(card);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'exam-question-navigation-dot';
    dot.textContent = String(index + 1);
    dot.title = 'Câu ' + (index + 1);
    dot.dataset.index = String(index);
    if (item.userAnswer != null) dot.classList.add('is-answered');
    if (session.reviewMode) {
      if (item.status === 'correct') dot.classList.add('is-correct');
      else if (item.status === 'wrong') dot.classList.add('is-wrong');
    };
    dot.addEventListener('click', () => scrollToExamQuestion(index));
    nav.appendChild(dot);
  });

  applyExamFilter();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
};

function patchExamQuestion(questionIndex) {
  const session = state.session;
  if (!session?.examMode) return;
  const item = session.items[questionIndex];
  const card = getElementById('exam-q-' + questionIndex);
  if (!item || !card) {
    renderExam();
    return;
  };
  card.classList.toggle('is-answered', item.userAnswer != null);
  card.querySelectorAll('.answer-option').forEach((button) => {
    const displayIdx = Number(button.dataset.display);
    const selected = item.userAnswer === displayIdx;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const dot = getElementById('exam-navigation')?.querySelector('.exam-question-navigation-dot[data-index="' + questionIndex + '"]');
  if (dot) dot.classList.toggle('is-answered', item.userAnswer != null);
  updateExamProgressHeader();
  applyExamFilter();
};

function onExamSelect(questionIndex, displayIdx) {
  if (enforceSessionDeadline()) return;
  const session = state.session;
  if (!session || session.reviewMode || !session.examMode || state.examSubmitting) return;
  const item = session.items[questionIndex];
  if (!item) return;
  item.userAnswer = displayIdx;
  item.checked = false;
  item.status = 'pending';
  persistSession();
  patchExamQuestion(questionIndex);
};

async function onExamSubmit() {
  if (state.examSubmitting) return;
  if (enforceSessionDeadline()) return;
  const session = state.session;
  if (!session || !session.examMode) return;
  if (session.reviewMode) {
    finishSession();
    return;
  };
  const unanswered = session.items.filter((item) => item.userAnswer == null).length;
  if (unanswered > 0) {
    const ok = await confirmModal('Còn câu chưa chọn', 'Bạn còn ' + unanswered + ' câu chưa chọn đáp án. Vẫn nộp bài?');
    if (!ok) return;
  } else {
    const ok = await confirmModal('Nộp bài thi?', 'Bạn đã chọn đủ ' + session.items.length + ' câu. Nộp bài để xem kết quả?');
    if (!ok) return;
  };

  if (enforceSessionDeadline() || state.session !== session || session.reviewMode) return;
  state.examSubmitting = true;
  updateExamProgressHeader();
  try {
    let firstTry = 0;
    let wrongAttempts = 0;
    const completedIdx = [];
    for (const item of session.items) {
      const question = session.pool[item.poolIndex];
      if (item.userAnswer == null) {
        item.status = 'wrong';
        item.checked = true;
        item.wrongCount = 1;
        wrongAttempts += 1;
        recordWrongAnswer(session, question.originalIndex);
        continue;
      };
      const correct = isAnswerCorrect(item, question);
      item.checked = true;
      if (correct) {
        item.status = 'correct';
        firstTry += 1;
        completedIdx.push(question.originalIndex);
      } else {
        item.status = 'wrong';
        item.wrongCount = 1;
        wrongAttempts += 1;
        const wrongOriginalIndex = item.optionOrder[item.userAnswer];
        if (!item.wrongOptions) item.wrongOptions = [];
        if (!item.wrongOptions.includes(wrongOriginalIndex)) item.wrongOptions.push(wrongOriginalIndex);
        recordWrongAnswer(session, question.originalIndex);
      };
    };
    if (completedIdx.length) addCompleted(session.deckId, completedIdx, state.fingerprints[session.deckId]);
    session.firstTryCorrect = firstTry;
    session.totalWrongAttempts = wrongAttempts;
    session.completedInSession = session.items.length;
    session.reviewMode = true;
    state.reviewMode = true;
    state.examFilter = 'all';
    stopSessionTimer(true);
    persistSession();
    renderExam();
    toast('Đã chấm bài: ' + firstTry + ' / ' + session.items.length + ' đúng · Điểm ' + formatScore(firstTry, session.items.length) + ' / 10');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    state.examSubmitting = false;
    updateExamProgressHeader();
  };
};

function enforceSessionDeadline() {
  const session = state.session;
  if (!session || !(session.timeLimit > 0) || !session.deadlineAt || Date.now() < session.deadlineAt) return false;
  session.timeExpired = true;
  if (session.examMode && !session.reviewMode) {
    session.reviewMode = true;
    state.reviewMode = true;
    let firstTry = 0;
    let wrongAttempts = 0;
    const completedIdx = [];
    for (const item of session.items) {
      const question = session.pool[item.poolIndex];
      item.checked = true;
      if (item.userAnswer != null && isAnswerCorrect(item, question)) {
        item.status = 'correct';
        firstTry += 1;
        completedIdx.push(question.originalIndex);
      } else {
        item.status = 'wrong';
        item.wrongCount = Math.max(1, item.wrongCount || 0);
        wrongAttempts += 1;
        recordWrongAnswer(session, question.originalIndex);
      };
    };
    if (completedIdx.length) addCompleted(session.deckId, completedIdx, state.fingerprints[session.deckId]);
    session.firstTryCorrect = firstTry;
    session.totalWrongAttempts = wrongAttempts;
    session.completedInSession = session.items.length;
    state.examFilter = 'all';
    stopSessionTimer(true);
    persistSession();
    renderExam();
    toast('Hết giờ.');
    return true;
  };
  finishSession();
  return true;
};

function onSelectOption(displayIdx) {
  if (enforceSessionDeadline()) return;
  const session = state.session;
  const item = currentSessionItem();
  if (!session || !item) return;
  if (item.status === 'correct' || session.viewIndex < session.maxReached) return;
  const question = currentQuestion();
  if (!question || (Array.isArray(item.wrongOptions) && item.wrongOptions.includes(item.optionOrder[displayIdx]))) return;

  item.userAnswer = displayIdx;
  if (item.status === 'wrong') {
    item.checked = false;
    item.status = 'pending';
  };
  persistSession();
  renderQuestion();
  if (sessionPreferences(session.deckId).autoCheck) onCheck();
};

const answerSounds = {
  correct: new Audio(createDataFileUrl('assets/sounds/correct.mp3')),
  incorrect: new Audio(createDataFileUrl('assets/sounds/incorrect.mp3'))
};

for (const audio of Object.values(answerSounds)) {
  audio.preload = 'auto';
  audio.load();
};

function playAnswerSound(isCorrect) {
  const preferences = sessionPreferences(state.session?.deckId || state.currentDeck);
  if (preferences.soundEnabled === false) return;
  const volumePct = Number.isInteger(preferences.soundVolume) && preferences.soundVolume > 0 ? Math.min(100, preferences.soundVolume) : 1;
  const audio = answerSounds[isCorrect ? 'correct' : 'incorrect'];
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volumePct / 100;
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') playback.catch(() => {});
  } catch (error) {
    console.warn('Không thể phát âm thanh đáp án:', error);
  };
};

function onCheck() {
  if (enforceSessionDeadline()) return;
  const session = state.session;
  const item = currentSessionItem();
  const question = currentQuestion();
  if (!session || !item || !question || item.userAnswer == null) return;
  if (item.status === 'correct' || item.checked || session.viewIndex < session.maxReached) return;

  item.checked = true;
  if (!Array.isArray(item.wrongOptions)) item.wrongOptions = [];
  const isCorrect = isAnswerCorrect(item, question);
  const preferences = sessionPreferences(session.deckId);
  const vibrate = (pattern) => {
    if (preferences.vibrationEnabled === true && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {};
    };
  };
  if (isCorrect) {
    playAnswerSound(true);
    vibrate(18);
    const wasAlreadyCorrect = item.status === 'correct';
    const firstTime = item.wrongCount === 0 && !wasAlreadyCorrect;
    item.status = 'correct';
    if (!wasAlreadyCorrect) {
      if (session.mode === 'practice-wrong') {
        if (!Array.isArray(session.practiceCompletedIndices)) session.practiceCompletedIndices = [];
        const originalIndex = question.originalIndex;
        if (!session.practiceCompletedIndices.includes(originalIndex)) {
          session.practiceCompletedIndices.push(originalIndex);
          session.completedInSession = session.practiceCompletedIndices.length;
          if (firstTime) session.firstTryCorrect += 1;
        };
      } else {
        session.completedInSession += 1;
        if (firstTime) session.firstTryCorrect += 1;
      };
    };
    if (session.viewIndex >= session.maxReached) session.maxReached = session.viewIndex;
    session.reviewingPast = false;
  } else {
    playAnswerSound(false);
    vibrate([28, 45, 28]);
    item.status = 'wrong';
    const wrongOriginalIndex = item.optionOrder[item.userAnswer];
    if (!item.wrongOptions.includes(wrongOriginalIndex)) item.wrongOptions.push(wrongOriginalIndex);
    item.wrongCount += 1;
    session.totalWrongAttempts += 1;
    if (session.mode === 'practice-wrong') {
      if (!Array.isArray(session.practiceWrongHistory)) session.practiceWrongHistory = [];
      const history = session.practiceWrongHistory.find((entry) => entry.originalIndex === question.originalIndex);
      if (history) history.wrongCount += 1;
      else session.practiceWrongHistory.push({
        originalIndex: question.originalIndex,
        question: question.question,
        wrongCount: 1
      });
    };
    recordWrongAnswer(session, question.originalIndex);
  };
  persistSession();
  renderQuestion();
  if (isCorrect && preferences.autoAdvance === true && session.viewIndex < session.items.length - 1) {
    const delaySec = Number.isInteger(preferences.autoAdvanceDelay) && preferences.autoAdvanceDelay >= 0 ? Math.min(10, preferences.autoAdvanceDelay) : 0;
    const delayMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : delaySec * 1000;
    setTimeout(() => {
      if (state.session === session && currentSessionItem() === item && item.status === 'correct' && session.viewIndex < session.items.length - 1) onNext();
    }, delayMs);
  };
};

function onNext() {
  if (enforceSessionDeadline()) return;
  const session = state.session;
  if (!session) return;
  const item = currentSessionItem();
  if (!item) return;

  if (session.viewIndex >= session.maxReached && item.status !== 'correct' && !(session.mode === 'practice-wrong' && item.status === 'wrong' && item.checked)) {
    onCheck();
    return;
  };

  if (session.viewIndex < session.maxReached) {
    session.viewIndex += 1;
    session.reviewingPast = session.viewIndex < session.maxReached;
    persistSession();
    renderQuestion();
    return;
  };

  if (item.status !== 'correct' && !(session.mode === 'practice-wrong' && item.status === 'wrong')) {
    toast('Hãy kiểm tra câu trả lời trước khi sang câu tiếp.');
    return;
  };

  if (session.viewIndex >= session.items.length - 1) {
    if (session.mode === 'practice-wrong') {
      const unresolved = session.items.filter((entry) => entry.status !== 'correct');
      if (!unresolved.length) {
        finishSession();
        return;
      };
      session.items = unresolved.map((entry) => ({
        ...entry,
        optionOrder: entry.optionOrder.slice(),
        userAnswer: null,
        status: 'pending',
        checked: false
      }));
      session.viewIndex = 0;
      session.maxReached = 0;
      session.reviewingPast = false;
      persistSession();
      renderQuestion();
      toast('Còn ' + session.items.length + ' câu chưa trả lời đúng. Tiếp tục ôn các câu này.', 3500);
      return;
    };
    finishSession();
    return;
  };

  session.viewIndex += 1;
  if (session.viewIndex > session.maxReached) session.maxReached = session.viewIndex;
  session.reviewingPast = false;
  persistSession();
  renderQuestion();
};

function onPrev() {
  if (enforceSessionDeadline()) return;
  const session = state.session;
  if (!session || session.viewIndex <= 0) return;
  session.viewIndex -= 1;
  session.reviewingPast = true;
  persistSession();
  renderQuestion();
};

function persistSession() {
  if (!state.session) return;
  if (!saveSession(state.session)) toast('Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.');
};

async function pauseSession() {
  const session = state.session;
  if (!session || session.reviewMode || session.finishedAt || session.pausedAt) return;
  const isExam = !!session.examMode || session.mode === 'exam';
  const ok = await confirmModal('Tạm dừng?', isExam ? 'Bạn có thể tiếp tục bài thi sau từ thẻ phiên đang dở. Thời gian còn lại sẽ được giữ nguyên nếu có giới hạn thời gian.' : 'Bạn có thể tiếp tục ôn luyện sau từ thẻ phiên đang dở. Thời gian còn lại sẽ được giữ nguyên nếu có giới hạn thời gian.');
  if (!ok) return;
  if (!state.session || state.session !== session || session.finishedAt || session.pausedAt) return;
  session.pausedAt = Date.now();
  session.remainingMs = session.timeLimit > 0 && session.deadlineAt ? Math.max(0, session.deadlineAt - session.pausedAt) : null;
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (!saveSession(session)) {
    session.pausedAt = null;
    session.remainingMs = null;
    startSessionTimer();
    toast('Không thể tạm dừng an toàn vì bộ nhớ trình duyệt không ghi được.');
    return;
  };
  state.session = null;
  state.reviewMode = false;
  showScreen('setup');
  refreshSetupUI();
  toast('Đã tạm dừng. Bạn có thể tiếp tục từ thẻ phiên đang dở.');
};

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
};

function formatScore(correct, total) {
  if (!(total > 0)) return '0';
  const score = Math.round((Math.max(0, correct) / total) * 100) / 10;
  return score.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
};

function animateScore(target, displayStr, circumference) {
  const summaryScoreElement = getElementById('summary-score-large');
  const ringFg = getElementById('score-ring-fg');
  if (!summaryScoreElement || !ringFg) return;

  const duration = 1100;
  const start = performance.now();

  let color = 'var(--primary)';
  if (target >= 8) color = '#22c55e';
  else if (target >= 5) color = '#eab308';
  else color = '#ef4444';

  ringFg.style.stroke = color;
  summaryScoreElement.style.color = color;
  ringFg.style.transition = 'stroke-dashoffset ' + duration + 'ms cubic-bezier(0.22, 1, 0.36, 1)';

  function frame(now) {
    const progressRatio = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progressRatio, 3);
    const current = target * eased;

    const shown = Math.round(current * 10) / 10;
    summaryScoreElement.textContent = shown.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

    const percentage = Math.max(0, Math.min(1, current / 10));
    ringFg.style.strokeDashoffset = String(circumference * (1 - percentage));

    if (progressRatio < 1) requestAnimationFrame(frame);
    else {
      summaryScoreElement.textContent = displayStr;
      ringFg.style.strokeDashoffset = String(circumference * (1 - target / 10));

      summaryScoreElement.style.transition = 'transform 0.25s ease';
      summaryScoreElement.style.transform = 'scale(1.08)';
      setTimeout(() => {
        summaryScoreElement.style.transform = 'scale(1)';
      }, 220);
    };
  };

  requestAnimationFrame(frame);
};

function getElapsedSeconds(session = state.session) {
  if (!session) return 0;
  const startedAt = Number(session.startedAt) || Date.now();
  let end = Date.now();
  if (session.finishedAt) end = Number(session.finishedAt);
  else if (session.pausedAt) end = Number(session.pausedAt);
  else if (session.timeExpired && session.deadlineAt) end = Number(session.deadlineAt);
  const pausedDuration = Math.max(0, Number(session.pausedDurationMs) || 0);
  return Math.max(0, Math.floor((end - startedAt - pausedDuration) / 1000));
};

function updateTimerDisplay() {
  const session = state.session;
  const element = session?.examMode ? getElementById('exam-progress-time') : getElementById('progress-time');
  if (!element) return;
  if (!session) {
    element.hidden = true;
    return;
  };
  const elapsed = getElapsedSeconds(session);
  const stopped = !!session.finishedAt || !!session.reviewMode || !!session.pausedAt;
  const hasLimit = Number(session.timeLimit) > 0 && Number(session.deadlineAt) > 0 && !stopped;
  const remaining = hasLimit ? Math.max(0, Math.ceil((session.deadlineAt - Date.now()) / 1000)) : null;
  element.hidden = false;
  if (stopped) {
    element.textContent = session.pausedAt && !session.finishedAt && !session.reviewMode ? 'Tạm dừng · ' + formatTime(elapsed) : 'Hoàn thành · ' + formatTime(elapsed);
    element.classList.remove('time-warning');
  } else {
    element.textContent = hasLimit ? 'Thời gian ' + formatTime(remaining) : 'Thời gian ' + formatTime(elapsed);
    element.classList.toggle('time-warning', hasLimit && remaining <= 60);
  };
};

function startSessionTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (!state.session) {
    updateTimerDisplay();
    return;
  };
  if (state.session.finishedAt || state.session.reviewMode || state.session.pausedAt) {
    updateTimerDisplay();
    return;
  };
  const tick = () => {
    const session = state.session;
    if (!session) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      return;
    };
    if (session.finishedAt || session.reviewMode || session.pausedAt) {
      stopSessionTimer(false);
      return;
    };
    updateTimerDisplay();
    if (session.timeLimit > 0 && session.deadlineAt && Date.now() >= session.deadlineAt) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      enforceSessionDeadline();
    };
  };
  tick();
  if (state.session && !state.session.finishedAt && !state.session.reviewMode) state.timerInterval = setInterval(tick, 1000);
};

function finishSession() {
  const session = state.session;
  if (!session) return;
  stopSessionTimer(true);

  if (session.mode !== 'practice-wrong') {
    const completedIdx = session.items.filter((item) => item.status === 'correct').map((item) => session.pool[item.poolIndex].originalIndex);
    const progressSaved = addCompleted(session.deckId, completedIdx, state.fingerprints[session.deckId]);
    if (!progressSaved) toast('Không thể lưu tiến độ hoàn thành. Hãy kiểm tra dung lượng bộ nhớ trình duyệt.');
    else if (session.sequential && session.nextCursor != null && !setSequentialCursor(session.deckId, session.nextCursor, state.fingerprints[session.deckId])) toast('Không thể lưu vị trí tuần tự của bộ đề.');
  };

  const wrongInSession = [];
  const seen = new Set();
  if (session.mode === 'practice-wrong' && Array.isArray(session.practiceWrongHistory)) {
    for (const entry of session.practiceWrongHistory) {
      if (!seen.has(entry.originalIndex)) {
        seen.add(entry.originalIndex);
        wrongInSession.push({ ...entry });
      };
    };
  } else {
    for (const item of session.items) {
      if (item.wrongCount > 0) {
        const originalIndex = session.pool[item.poolIndex].originalIndex;
        if (!seen.has(originalIndex)) {
          seen.add(originalIndex);
          wrongInSession.push({
            originalIndex: originalIndex,
            question: session.pool[item.poolIndex].question,
            wrongCount: item.wrongCount
          });
        };
      };
    };
  };

  const scoreTotal = session.mode === 'practice-wrong' ? session.practiceInitialCount || session.items.length : session.items.length;
  session.summary = {
    total: scoreTotal,
    score: formatScore(session.firstTryCorrect || 0, scoreTotal),
    elapsedSeconds: getElapsedSeconds(session),
    timeExpired: !!session.timeExpired,
    correct: session.firstTryCorrect || 0,
    wrongQuestions: wrongInSession.length,
    wrongAttempts: session.totalWrongAttempts,
    practiceQuestions: session.mode === 'practice-wrong' ? session.practiceInitialCount || session.items.length : 0,
    firstTryRate: (session.mode === 'practice-wrong' ? session.practiceInitialCount : session.items.length) ? Math.round((session.firstTryCorrect / (session.mode === 'practice-wrong' ? session.practiceInitialCount : session.items.length)) * 100) : 0,
    wrongList: wrongInSession,
    sequential: session.sequential,
    nextCursor: session.nextCursor,
    mode: session.mode
  };

  if (Number.isInteger(session.rangeStart) && Number.isInteger(session.rangeEnd) && wrongInSession.length) {
    if (!addWrongIndicesForRange(session.deckId, session.rangeStart, session.rangeEnd, wrongInSession.map((entry) => entry.originalIndex))) toast('Không thể lưu câu sai riêng cho vùng câu hỏi này.');
  };
  state._lastSummarySession = {
    deckId: session.deckId,
    mode: session.examMode || session.mode === 'exam' ? 'exam' : 'practice',
    sourceMode: session.mode,
    indices: [...new Set(session.pool.map((question) => question.originalIndex))],
    rangeStart: Number.isInteger(session.rangeStart) ? session.rangeStart : 1,
    rangeEnd: Number.isInteger(session.rangeEnd) ? session.rangeEnd : (state.decks[session.deckId] || []).length,
    requestedCount: session.items.length,
    timeLimit: Number.isInteger(session.timeLimit) ? session.timeLimit : 0
  };
  state._lastSummaryWrongIndices = wrongInSession.map((entry) => entry.originalIndex);
  state._lastSummaryRangeStart = Number.isInteger(session.rangeStart) ? session.rangeStart : null;
  state._lastSummaryRangeEnd = Number.isInteger(session.rangeEnd) ? session.rangeEnd : null;
  state._lastSummaryCount = Number.isInteger(session.requestedCount) ? session.requestedCount : session.items.length;

  const sessionCleared = clearSession(session.deckId);
  state.session = null;
  if (!sessionCleared) toast('Không thể xóa phiên đã lưu. Nếu tải lại trang, phiên cũ có thể xuất hiện lại.');
  showSummary(session.summary, session.deckId, session.mode);
};

function showSummary(summary, deckId, mode) {
  showScreen('summary');
  getElementById('summary-title').textContent = mode === 'practice-wrong' ? 'Kết thúc ôn câu sai' : mode === 'practice-bookmarks' ? 'Hoàn thành ôn câu đã đánh dấu' : mode === 'exam' ? 'Kết quả thi thử' : 'Hoàn thành lượt ôn';
  const scoreVal = summary.score ?? formatScore(summary.correct, summary.total);
  const scoreNum = Number(String(scoreVal).replace(',', '.')) || 0;

  getElementById('summary-total').textContent = String(summary.total);
  getElementById('summary-score').textContent = scoreVal+ ' / 10';

  const summaryScoreElement = getElementById('summary-score-large');
  const ringFg = getElementById('score-ring-fg');
  const circumference = 2 * Math.PI * 52;

  if (ringFg) {
    ringFg.style.strokeDasharray = String(circumference);
    ringFg.style.strokeDashoffset = String(circumference);
    ringFg.style.transition = 'none';
    ringFg.style.stroke = 'var(--primary)';
  };
  if (summaryScoreElement) {
    summaryScoreElement.textContent = '0';
    summaryScoreElement.style.transform = 'scale(1)';
    summaryScoreElement.style.color = 'var(--primary)';
  };

  requestAnimationFrame(() => requestAnimationFrame(() => animateScore(scoreNum, scoreVal, circumference)));
  getElementById('summary-time').textContent = formatTime(summary.elapsedSeconds || 0);
  getElementById('summary-correct').textContent = String(summary.correct);
  getElementById('summary-wrong-question-count').textContent = String(summary.wrongQuestions);
  getElementById('summary-wrong-attempt-count').textContent = String(summary.wrongAttempts);
  getElementById('summary-practice-count').textContent = String(summary.practiceQuestions || 0);
  getElementById('summary-first-try-rate').textContent = summary.firstTryRate + '%';

  const totalQuestions = (state.decks[deckId] || []).length;
  const progressAfterSession = getDeckProgress(deckId);
  const completedAfterSession = new Set(progressAfterSession.completed).size;
  getElementById('summary-note').textContent = summary.timeExpired ? 'Đã hết giờ. Bài làm được tự động kết thúc.' : completedAfterSession >= totalQuestions ? 'Bạn đã hoàn thành toàn bộ bộ đề ' + DECKS[deckId].label + '.' : summary.wrongQuestions === 0 ? 'Xuất sắc! Bạn không mắc lỗi nào trong lượt này.' : 'Bạn có thể ôn lại các câu sai hoặc tiếp tục với những câu chưa hoàn thành.';

  const listCard = getElementById('wrong-list-card');
  const list = getElementById('wrong-list');
  list.replaceChildren();
  if (summary.wrongList.length) {
    listCard.hidden = false;
    for (const wrongQuestion of summary.wrongList) {
      const listItemElement = document.createElement('li');
      const index = document.createElement('span');
      index.className = 'question-index';
      index.textContent = `#${wrongQuestion.originalIndex + 1}`;
      listItemElement.append(index, document.createTextNode(wrongQuestion.question));
      list.appendChild(listItemElement);
    };
  } else {
    listCard.hidden = true;
  };

  state.currentDeck = deckId;
  const retryButton = getElementById('button-summary-retry-session');
  retryButton.hidden = !['normal', 'exam'].includes(mode);
  retryButton.textContent = mode === 'exam' ? 'Thi lại lượt thi này' : 'Ôn lại lượt ôn này';

  const btnPractice = getElementById('button-summary-practice');
  const sessionWrong = [...new Set(summary.wrongList.map((entry) => entry.originalIndex))];
  state._lastSummaryWrongIndices = sessionWrong;
  btnPractice.hidden = sessionWrong.length === 0;
  btnPractice.textContent ='Ôn lại ' + sessionWrong.length + ' câu sai trong lượt này';

  const progress = getDeckProgress(deckId);
  const continueButton = getElementById('button-summary-continue');
  const form = readSetupForm();
  const rangeEnd = form.endQuestion;
  const nextIndex = Math.max(progress.sequentialCursor, form.startQuestion - 1);
  const canSeq = summary.sequential && nextIndex < rangeEnd;
  continueButton.hidden = !canSeq;
  if (canSeq) {
    const left = rangeEnd - nextIndex;
    const settings = getSettings(deckId);
    const n = Math.min(settings.count || 20, left);
    continueButton.textContent = 'Tiếp tục tuần tự ' + n + ' câu trong vùng';
  };

  state._lastSummaryDeck = deckId;
};

function restoreSessionIfAny() {
  const saved = getSession(state.currentDeck);
  if (!saved) return false;
  if (!['quocphong1', 'quocphong2'].includes(saved.deckId) || !Array.isArray(saved.items) || !Array.isArray(saved.pool)) {
    clearSession(state.currentDeck);
    return false;
  };
  saved.items = saved.items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const { poolIdx: legacyPoolIndex, ...sessionItem } = item;
    return {
      ...sessionItem,
      poolIndex: Number.isInteger(item.poolIndex) ? item.poolIndex : legacyPoolIndex
    };
  });
  if (!state.decks[saved.deckId]) {
    clearSession(state.currentDeck);
    return false;
  };
  const fingerprint = state.fingerprints[saved.deckId];
  const legacyCompatible = !saved.dataFingerprint && state.legacyFingerprintMatched[saved.deckId];
  const validPool = saved.pool.length > 0 && saved.pool.every((question) => question && Number.isInteger(question.originalIndex) && question.originalIndex >= 0 && typeof question.question === 'string' && Array.isArray(question.options) && question.options.length >= 2 && Number.isInteger(question.correct) && question.correct >= 0 && question.correct < question.options.length);
  const poolMatchesCurrentData = saved.pool.every((question) => {
    const current = state.decks[saved.deckId][question.originalIndex];
    return (current && current.question === question.question && current.correct === question.correct && JSON.stringify(current.options) === JSON.stringify(question.options));
  });
  const legacyPoolCompatible = !legacyCompatible || poolMatchesCurrentData;
  const validSession = validPool && poolMatchesCurrentData && legacyPoolCompatible && saved.items.length > 0 && Number.isInteger(saved.viewIndex) && saved.viewIndex >= 0 && saved.viewIndex < saved.items.length && Number.isInteger(saved.maxReached) && saved.maxReached >= 0 && saved.maxReached < saved.items.length && saved.viewIndex <= saved.maxReached && saved.items.every((item, index) => {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.poolIndex) || item.poolIndex < 0 || item.poolIndex >= saved.pool.length) return false;
    const question = saved.pool[item.poolIndex];
    return (Array.isArray(item.optionOrder) && item.optionOrder.length === question.options.length && (item.wrongOptions == null || (Array.isArray(item.wrongOptions) && item.wrongOptions.every((value) => Number.isInteger(value) && value >= 0 && value < question.options.length))) && new Set(item.optionOrder).size === question.options.length && item.optionOrder.every((index) => Number.isInteger(index) && index >= 0 && index < question.options.length) && ['pending', 'wrong', 'correct'].includes(item.status) && (index >= saved.maxReached || item.status === 'correct' || saved.mode === 'practice-wrong') && (item.userAnswer == null || (Number.isInteger(item.userAnswer) && item.userAnswer >= 0 && item.userAnswer < item.optionOrder.length)) && Number.isInteger(item.wrongCount) && item.wrongCount >= 0);
  });
  if (!validSession || (saved.dataFingerprint !== fingerprint && !legacyCompatible)) {
    clearSession(state.currentDeck);
    return false;
  };
  if (legacyCompatible) saved.dataFingerprint = fingerprint;
  const progress = getDeckProgress(saved.deckId);
  if (progress.dataFingerprint && progress.dataFingerprint !== fingerprint && !legacyCompatible) {
    clearSession(state.currentDeck);
    return false;
  };
  saved.timeLimit = Number.isInteger(saved.timeLimit) && saved.timeLimit > 0 ? Math.min(1440, saved.timeLimit) : 0;
  saved.pausedAt = Number.isFinite(saved.pausedAt) ? saved.pausedAt : null;
  saved.pausedDurationMs = Math.max(0, Number(saved.pausedDurationMs) || 0);
  saved.remainingMs = Number.isFinite(saved.remainingMs) ? Math.max(0, saved.remainingMs) : null;
  saved.startedAt = Number.isFinite(saved.startedAt) && saved.startedAt > 0 ? saved.startedAt : Date.now();
  saved.deadlineAt = Number.isFinite(saved.deadlineAt) && saved.deadlineAt > 0 ? saved.deadlineAt : saved.timeLimit > 0 ? saved.startedAt + saved.timeLimit * 60000 : null;
  if (saved.pausedAt) {
    const now = Date.now();
    saved.pausedDurationMs += Math.max(0, now - saved.pausedAt);
    if (saved.timeLimit > 0) saved.deadlineAt = now + Math.max(0, Number(saved.remainingMs) || 0);
    saved.pausedAt = null;
    saved.remainingMs = null;
    if (!saveSession(saved)) {
      toast('Không thể lưu trạng thái tiếp tục phiên.');
      return false;
    };
  };
  saved.timeExpired = !!saved.timeExpired;
  saved.practiceInitialCount = Number.isInteger(saved.practiceInitialCount) && saved.practiceInitialCount > 0 ? saved.practiceInitialCount : saved.mode === 'practice-wrong' ? saved.items.length : 0;
  saved.practiceCompletedIndices = Array.isArray(saved.practiceCompletedIndices) ? [...new Set(saved.practiceCompletedIndices.filter((index) => Number.isInteger(index) && index >= 0))] : [];
  saved.practiceWrongHistory = Array.isArray(saved.practiceWrongHistory) ? saved.practiceWrongHistory.filter((entry) => entry && Number.isInteger(entry.originalIndex) && entry.originalIndex >= 0 && typeof entry.question === 'string' && Number.isInteger(entry.wrongCount) && entry.wrongCount > 0) : [];
  for (const item of saved.items) {
    if (!Array.isArray(item.wrongOptions)) item.wrongOptions = [];
  };
  saved.completedInSession = saved.mode === 'practice-wrong' ? saved.practiceCompletedIndices.length : saved.items.filter((item) => item.status === 'correct').length;
  saved.totalWrongAttempts = Math.max(Number.isInteger(saved.totalWrongAttempts) ? saved.totalWrongAttempts : 0, saved.items.reduce((sum, item) => sum + Math.max(0, Number(item.wrongCount) || 0), 0));
  saved.firstTryCorrect = Number.isInteger(saved.firstTryCorrect) ? saved.firstTryCorrect : saved.items.filter((item) => item.status === 'correct' && item.wrongCount === 0).length;
  saved.maxReached = Math.max(0, Math.min(saved.items.length - 1, Number(saved.maxReached) || 0));
  saved.examMode = !!saved.examMode || saved.mode === 'exam';
  state.currentDeck = saved.deckId;
  state.session = saved;
  state.reviewMode = !!saved.reviewMode;
  state.examFilter = 'all';
  state.examSubmitting = false;
  if (saved.examMode) {
    showScreen('exam');
    renderExam();
  } else {
    showScreen('quiz');
    renderQuestion();
  };
  startSessionTimer();
  toast(saved.examMode ? 'Đã khôi phục bài thi thử đang làm.' : 'Đã khôi phục lượt ôn đang làm.');
  return true;
};

function initializeInterface() {
  document.addEventListener('selectionchange', captureHighlightSelection);
  const captureAfterSelectionGesture = () => {
    captureHighlightSelection();
    requestAnimationFrame(captureHighlightSelection);
  };
  document.addEventListener('pointerup', captureAfterSelectionGesture, true);
  document.addEventListener('mouseup', captureAfterSelectionGesture, true);
  document.addEventListener('touchend', captureAfterSelectionGesture, true);
  getElementById('button-highlight-toggle')?.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') event.preventDefault();
  });
  getElementById('button-highlight-toggle')?.addEventListener('mousedown', (event) => event.preventDefault());
  getElementById('button-highlight-toggle')?.addEventListener('click', () => {
    captureHighlightSelection();
    const question = currentQuestion();
    const session = state.session;
    const selection = state.lastTextSelection;
    if (!question || !session || session.examMode || !selection || selection.questionIndex !== question.originalIndex || selection.deckId !== session.deckId) {
      toast('Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.');
      return;
    };
    toggleHighlightSelection(selection.deckId, question.originalIndex, selection);
  });
  const active = getSettings();
  state.currentDeck = active.deck === 'quocphong2' ? 'quocphong2' : 'quocphong1';
  const settings = getSettings(state.currentDeck);
  applySettingsToForm(settings);
  const bank = getBankSettings();
  state.bankDeck = bank.deck === 'quocphong2' ? 'quocphong2' : 'quocphong1';
  applyBankSettingsToForm(bank);
  showScreen('setup');
  refreshSetupUI();
};

function applyTheme() {
  document.documentElement.dataset.theme = 'dark';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = '#111113';
};

function initializeTheme() {
  applyTheme();
};

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!getElementById('modal').hidden) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const quizActive = getElementById('screen-quiz') && !getElementById('screen-quiz').hidden;
    const examActive = getElementById('screen-exam') && !getElementById('screen-exam').hidden;

    if (examActive) {
      if (event.key === 'Escape') {
        event.preventDefault();
        getElementById('button-exam-quit')?.click();
        return;
      };
      if ((event.key === 'Enter' || event.key === 's') && !state.session?.reviewMode) {
        event.preventDefault();
        getElementById('button-exam-submit')?.click();
        return;
      };
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        jumpToNextUnanswered();
      };
      return;
    };

    if (!quizActive) return;

    if (/^[1-6]$/.test(event.key)) {
      const option = getElementById('options').querySelectorAll('.answer-option')[Number(event.key) - 1];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      };
      return;
    };
    if (/^[a-f]$/i.test(event.key)) {
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      const option = getElementById('options').querySelectorAll('.answer-option')[index];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      };
      return;
    };
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!getElementById('button-next').disabled) getElementById('button-next').click();
      return;
    };
    if (event.key === 'ArrowLeft' && !getElementById('button-prev').disabled) {
      event.preventDefault();
      getElementById('button-prev').click();
    } else if (event.key === 'ArrowRight' && !getElementById('button-next').disabled) {
      event.preventDefault();
      getElementById('button-next').click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      getElementById('button-quit').click();
    };
  });
};

function bindEvents() {
  bindKeyboardShortcuts();
  initializeEnhancements({ onPrev, onNext });

  document.querySelectorAll('#screen-setup .deck-button[data-deck]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextDeck = button.dataset.deck === 'quocphong2' ? 'quocphong2' : 'quocphong1';
      if (state.currentDeck === nextDeck) return;
      const previousTotal = currentQuestions().length;
      const previousStart = Number.parseInt(getElementById('input-range-start').value, 10) || 1;
      const previousEnd = Number.parseInt(getElementById('input-range-end').value, 10);
      const previousRangeTotal = Math.max(1, (Number.isInteger(previousEnd) ? previousEnd : previousTotal) - previousStart + 1);
      const previousCount = Number.parseInt(getElementById('input-count').value, 10);
      const countWasMaximum = Number.isInteger(previousCount) && previousCount >= previousRangeTotal;
      persistSetupForm();
      state.currentDeck = nextDeck;
      const settings = getSettings(state.currentDeck);
      const currentTotal = currentQuestions().length;
      settings.endQuestion = getEndQuestionForDeckSwitch(previousEnd, previousTotal, currentTotal);
      if (countWasMaximum) {
        const newStart = settings.startQuestion || 1;
        const newEnd = settings.endQuestion > 0 ? Math.min(settings.endQuestion, currentTotal) : currentTotal;
        settings.count = Math.max(1, newEnd - newStart + 1);
      };
      applySettingsToForm(settings);
      refreshSetupUI();
      persistSetupForm();
    });
  });

  getElementById('button-select-all').addEventListener('click', () => {
    const form = readSetupForm();
    const rangeTotal = Math.max(1, form.endQuestion - form.startQuestion + 1);
    const input = getElementById('input-count');
    const current = Number.parseInt(input.value, 10);
    const isAll = current === rangeTotal;
    if (isAll) {
      const previousValue = state.lastCountBeforeAll;
      input.value = String(Number.isInteger(previousValue) && previousValue >= 1 ? Math.min(previousValue, rangeTotal) : Math.min(20, rangeTotal));
    } else {
      state.lastCountBeforeAll = Number.isInteger(current) && current >= 1 ? current : 20;
      input.value = String(rangeTotal);
    };
    persistSetupForm();
    refreshSetupUI();
  });

  getElementById('button-unlimited-time')?.addEventListener('click', () => {
    const timeInput = getElementById('input-time-limit');
    if (!timeInput) return;
    let current = Number.parseInt(timeInput.value, 10);
    if (!Number.isInteger(current) || current < 0) current = 0;
    current = Math.min(1440, current);
    const isUnlimited = current === 0;
    if (isUnlimited) {
      const previousValue = state.lastTimeBeforeUnlimited;
      timeInput.value = String(Number.isInteger(previousValue) && previousValue > 0 ? Math.min(1440, previousValue) : 50);
    } else {
      state.lastTimeBeforeUnlimited = current > 0 ? current : 50;
      timeInput.value = '0';
    };
    persistSetupForm();
    refreshSetupUI();
  });

  document.querySelectorAll('.preset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const form = readSetupForm();
      const max = Math.max(1, form.endQuestion - form.startQuestion + 1);
      const n = Math.min(Number(button.dataset.count) || 20, max);
      getElementById('input-count').value = String(n);
      persistSetupForm();
      refreshSetupUI();
    });
  });

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.examFilter = chip.dataset.filter || 'all';
      applyExamFilter();
      updateExamProgressHeader();
    });
  });

  getElementById('button-exam-next-empty')?.addEventListener('click', () => jumpToNextUnanswered());

  const updateCountButtonState = () => {
    const input = getElementById('input-count');
    const form = readSetupForm();
    const rangeTotal = Math.max(1, form.endQuestion - form.startQuestion + 1);
    const countNum = Number.parseInt(input.value, 10);
    const isAllCount = Number.isInteger(countNum) && countNum === rangeTotal;
    const selectAllButton = getElementById('button-select-all');
    if (selectAllButton) {
      selectAllButton.classList.toggle('is-active', isAllCount);
      selectAllButton.setAttribute('aria-pressed', isAllCount ? 'true' : 'false');
      setToggleIcon(selectAllButton, isAllCount, { on: 'deselect', off: 'select-all' });
      selectAllButton.title = isAllCount ? 'Bỏ chọn toàn bộ vùng' : 'Toàn bộ vùng';
      selectAllButton.setAttribute('aria-label', selectAllButton.title);
    };
  };
  getElementById('input-count').addEventListener('input', updateCountButtonState);
  getElementById('input-count').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
  });
  getElementById('input-count').addEventListener('blur', () => {
    persistSetupForm();
    refreshSetupUI();
  });

  const updateTimeButtonState = () => {
    const timeInput = getElementById('input-time-limit');
    const timeVal = Number.parseInt(timeInput.value, 10);
    const isUnlimited = Number.isInteger(timeVal) && timeVal === 0;
    const unlimitedTimeButton = getElementById('button-unlimited-time');
    if (unlimitedTimeButton) {
      unlimitedTimeButton.classList.toggle('is-active', isUnlimited);
      unlimitedTimeButton.setAttribute('aria-pressed', isUnlimited ? 'true' : 'false');
      setToggleIcon(unlimitedTimeButton, isUnlimited, { on: 'infinity-off', off: 'infinity' });
      unlimitedTimeButton.title = isUnlimited ? 'Bỏ không giới hạn thời gian' : 'Không giới hạn thời gian';
      unlimitedTimeButton.setAttribute('aria-label', unlimitedTimeButton.title);
    };
  };
  getElementById('input-time-limit').addEventListener('input', updateTimeButtonState);
  getElementById('input-time-limit').addEventListener('change', () => {
    const timeInput = getElementById('input-time-limit');
    const value = Number.parseInt(timeInput.value, 10);
    timeInput.value = String(Number.isInteger(value) && value >= 0 ? Math.min(1440, value) : 0);
    persistSetupForm();
    refreshSetupUI();
  });
  getElementById('input-time-limit').addEventListener('blur', () => {
    const timeInput = getElementById('input-time-limit');
    const value = Number.parseInt(timeInput.value, 10);
    timeInput.value = String(Number.isInteger(value) && value >= 0 ? Math.min(1440, value) : 0);
    persistSetupForm();
    refreshSetupUI();
  });

  for (const id of ['input-range-start', 'input-range-end']) getElementById(id).addEventListener('change', () => {
    const total = currentQuestions().length;
    let start = Number.parseInt(getElementById('input-range-start').value, 10);
    let end = Number.parseInt(getElementById('input-range-end').value, 10);
    if (!Number.isInteger(start)) start = 1;
    if (!Number.isInteger(end)) end = total;
    start = Math.max(1, Math.min(start, Math.max(1, total)));
    end = Math.max(start, Math.min(end, Math.max(1, total)));
    getElementById('input-range-start').value = String(start);
    getElementById('input-range-end').value = String(end);
    refreshSetupUI();
    persistSetupForm();
  });

  getElementById('checkbox-shuffle-questions').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
  });

  getElementById('checkbox-shuffle-answers').addEventListener('change', () => {
    getElementById('checkbox-shuffle-answers').dataset.userTouched = '1';
    persistSetupForm();
  });

  for (const id of ['checkbox-automatic-check', 'checkbox-vibration']) getElementById(id).addEventListener('change', persistSetupForm);
  getElementById('checkbox-automatic-advance')?.addEventListener('change', () => {
    updateSetupExperienceControls();
    persistSetupForm();
  });
  getElementById('button-auto-advance')?.addEventListener('click', () => {
    const checkbox = getElementById('checkbox-automatic-advance');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  getElementById('checkbox-sound')?.addEventListener('change', () => {
    syncVolumeFromSoundCheckbox('input-sound-volume', 'checkbox-sound', 'label-sound-volume');
    updateSetupExperienceControls();
    persistSetupForm();
  });
  getElementById('button-sound')?.addEventListener('click', () => {
    const checkbox = getElementById('checkbox-sound');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  getElementById('input-auto-advance-delay')?.addEventListener('input', () => {
    const delay = Number.parseInt(getElementById('input-auto-advance-delay').value, 10) || 0;
    if (getElementById('label-auto-advance-delay')) getElementById('label-auto-advance-delay').textContent = delay + ' giây';
  });
  getElementById('input-auto-advance-delay')?.addEventListener('change', persistSetupForm);
  getElementById('input-sound-volume')?.addEventListener('input', () => {
    syncSoundFromVolume('input-sound-volume', 'checkbox-sound', 'label-sound-volume');
  });
  getElementById('input-sound-volume')?.addEventListener('change', () => {
    syncSoundFromVolume('input-sound-volume', 'checkbox-sound', 'label-sound-volume');
    persistSetupForm();
  });

  document.querySelectorAll('#screen-setup .mode-button').forEach((button) => button.addEventListener('click', () => setPracticeMode(button.dataset.mode)));
  document.querySelectorAll('#screen-review .mode-button').forEach((button) => button.addEventListener('click', () => setBankPracticeMode(button.dataset.mode)));
  document.querySelectorAll('[data-bank-deck]').forEach((button) => button.addEventListener('click', () => setBankDeck(button.dataset.bankDeck)));

  getElementById('button-view-bank').addEventListener('click', openQuestionBank);

  const scrollTopBtn = getElementById('button-scroll-to-top');
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', scrollToPageTop);
    window.addEventListener('scroll', () => {
      if (state._scrollTopRaf) return;
      state._scrollTopRaf = requestAnimationFrame(() => {
        state._scrollTopRaf = 0;
        updateScrollTopButton();
      });
    }, { passive: true });
    window.addEventListener('resize', updateScrollTopButton, { passive: true });
    updateScrollTopButton();
  };

  const searchInput = getElementById('input-review-search');
  if (searchInput) {
    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
      updateReviewSearchClearButton();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyBankSearch(), 180);
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(searchTimer);
        applyBankSearch({ scrollToFirst: true });
      };
    });
    searchInput.addEventListener('search', () => {
      clearTimeout(searchTimer);
      applyBankSearch();
    });
  };
  getElementById('button-review-search-clear')?.addEventListener('click', () => {
    const input = getElementById('input-review-search');
    if (input) input.value = '';
    applyBankSearch();
    input?.focus();
  });
  updateReviewSearchClearButton();
  getElementById('button-search-prev')?.addEventListener('click', () => scrollToBankSearchMatch(-1));
  getElementById('button-search-next')?.addEventListener('click', () => scrollToBankSearchMatch(1));

  getElementById('button-review-back').addEventListener('click', () => {
    state.currentDeck = state.setupDeckBeforeBank;
    applySettingsToForm(getSettings(state.currentDeck));
    showScreen('setup');
    refreshSetupUI();
  });

  getElementById('button-review-goto').addEventListener('click', () => {
    const n = Number.parseInt(getElementById('input-review-goto').value, 10);
    const total = bankQuestions().length;
    if (!Number.isInteger(n) || n < 1 || n > total) {
      toast('Nhập số câu từ 1 đến ' + total + '.');
      return;
    };
    if (!scrollReviewToQuestionNumber(n)) toast('Không tìm thấy câu ' + n + ' trong danh sách hiện tại.');
  });
  getElementById('input-review-goto').addEventListener('input', (event) => {
    const input = event.currentTarget;
    if (input.value === '') return;
    const total = bankQuestions().length;
    const value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value)) return;
    input.value = String(Math.min(Math.max(value, 1), Math.max(1, total)));
  });
  getElementById('input-review-goto').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') getElementById('button-review-goto').click();
  });

  getElementById('button-start').addEventListener('click', () => startNormal({ sequential: false }));
  getElementById('button-continue').addEventListener('click', () => startNormal({ sequential: true }));
  getElementById('button-practice-wrong').addEventListener('click', () => {
    setPracticeMode('practice');
    startPracticeWrong();
  });
  getElementById('button-practice-all-wrong').addEventListener('click', () => {
    setPracticeMode('practice');
    startPracticeWrong({ allDeck: true });
  });
  getElementById('button-practice-bookmarks').addEventListener('click', () => {
    setPracticeMode('practice');
    startPracticeBookmarks();
  });

  const reviewCountInput = getElementById('review-input-count');
  const reviewTimeInput = getElementById('review-input-time-limit');

  if (reviewCountInput) {
    reviewCountInput.addEventListener('input', () => {
      updateBankCountButtonState();
    });
    reviewCountInput.addEventListener('change', () => {
      syncBankCountInput();
      persistBankForm();
      if (state.mode === 'review') {
        const count = state.reviewSelectedIndices.size;
        if (getElementById('review-button-start-selected')) getElementById('review-button-start-selected').textContent = state.bankPracticeMode === 'exam' ? 'Thi' : 'Ôn ' + count + ' câu đã chọn';
      };
    });
    reviewCountInput.addEventListener('blur', () => {
      syncBankCountInput();
      persistBankForm();
    });
  };

  if (reviewTimeInput) {
    reviewTimeInput.addEventListener('input', () => updateBankTimeButtonState());
    reviewTimeInput.addEventListener('change', () => {
      let value = Number.parseInt(reviewTimeInput.value, 10);
      if (!Number.isInteger(value) || value < 0) value = 0;
      reviewTimeInput.value = String(Math.min(1440, value));
      updateBankTimeButtonState();
      persistBankForm();
    });
    reviewTimeInput.addEventListener('blur', () => {
      let value = Number.parseInt(reviewTimeInput.value, 10);
      if (reviewTimeInput.value === '' || !Number.isInteger(value) || value < 0) value = 0;
      reviewTimeInput.value = String(Math.min(1440, value));
      updateBankTimeButtonState();
      persistBankForm();
    });
  };

  for (const reviewId of ['review-checkbox-shuffle-questions', 'review-checkbox-shuffle-answers', 'review-checkbox-automatic-check', 'review-checkbox-vibration']) {
    const element = getElementById(reviewId);
    if (!element) continue;
    element.addEventListener('change', () => {
      persistBankForm();
      if (state.mode === 'review') {
        const count = state.reviewSelectedIndices.size;
        if (getElementById('review-button-start-selected')) getElementById('review-button-start-selected').textContent = state.bankPracticeMode === 'exam' ? 'Thi' : 'Ôn ' + count + ' câu đã chọn';
      };
    });
  };
  getElementById('review-checkbox-automatic-advance')?.addEventListener('change', () => {
    updateBankExperienceControls();
    persistBankForm();
    if (state.mode === 'review') {
      const count = state.reviewSelectedIndices.size;
      if (getElementById('review-button-start-selected')) getElementById('review-button-start-selected').textContent = state.bankPracticeMode === 'exam' ? 'Thi' : 'Ôn ' + count + ' câu đã chọn';
    };
  });
  getElementById('review-button-automatic-advance')?.addEventListener('click', () => {
    const checkbox = getElementById('review-checkbox-automatic-advance');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  getElementById('review-checkbox-sound')?.addEventListener('change', () => {
    syncVolumeFromSoundCheckbox('review-input-sound-volume', 'review-checkbox-sound', 'review-label-sound-volume');
    updateBankExperienceControls();
    persistBankForm();
    if (state.mode === 'review') {
      const count = state.reviewSelectedIndices.size;
      if (getElementById('review-button-start-selected')) getElementById('review-button-start-selected').textContent = state.bankPracticeMode === 'exam' ? 'Thi' : 'Ôn ' + count + ' câu đã chọn';
    };
  });
  getElementById('review-button-sound')?.addEventListener('click', () => {
    const checkbox = getElementById('review-checkbox-sound');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  getElementById('review-input-auto-advance-delay')?.addEventListener('input', () => {
    const delay = Number.parseInt(getElementById('review-input-auto-advance-delay').value, 10) || 0;
    if (getElementById('review-label-auto-advance-delay')) getElementById('review-label-auto-advance-delay').textContent = delay + ' giây';
  });
  getElementById('review-input-auto-advance-delay')?.addEventListener('change', () => persistBankForm());
  getElementById('review-input-sound-volume')?.addEventListener('input', () => {
    syncSoundFromVolume('review-input-sound-volume', 'review-checkbox-sound', 'review-label-sound-volume');
  });
  getElementById('review-input-sound-volume')?.addEventListener('change', () => {
    syncSoundFromVolume('review-input-sound-volume', 'review-checkbox-sound', 'review-label-sound-volume');
    persistBankForm();
  });

  getElementById('review-button-select-all')?.addEventListener('click', () => {
    const input = getElementById('review-input-count');
    if (!input) return;
    const selectedCount = state.reviewSelectedIndices.size;
    if (selectedCount === 0) return;
    const current = Number.parseInt(input.value, 10);
    const isAll = Number.isInteger(current) && current === selectedCount;
    if (isAll) {
      const previousValue = state.lastBankCountBeforeAll;
      input.value = String(Number.isInteger(previousValue) && previousValue >= 1 ? Math.min(previousValue, selectedCount) : Math.min(30, selectedCount));
    } else {
      state.lastBankCountBeforeAll = Number.isInteger(current) && current >= 1 ? current : 30;
      input.value = String(selectedCount);
    };
    persistBankForm();
    syncBankCountInput();
  });

  getElementById('review-button-unlimited-time')?.addEventListener('click', () => {
    const timeInput = getElementById('review-input-time-limit');
    if (!timeInput) return;
    let current = Number.parseInt(timeInput.value, 10);
    if (!Number.isInteger(current) || current < 0) current = 0;
    current = Math.min(1440, current);
    const isUnlimited = current === 0;
    if (isUnlimited) {
      const previousValue = state.lastBankTimeBeforeUnlimited;
      timeInput.value = String(Number.isInteger(previousValue) && previousValue > 0 ? Math.min(1440, previousValue) : 35);
    } else {
      state.lastBankTimeBeforeUnlimited = current > 0 ? current : 35;
      timeInput.value = '0';
    };
    persistBankForm();
    updateBankTimeButtonState();
  });

  getElementById('button-exam-submit')?.addEventListener('click', () => onExamSubmit());
  getElementById('button-exam-pause')?.addEventListener('click', () => pauseSession());
  getElementById('button-quiz-pause')?.addEventListener('click', () => pauseSession());
  getElementById('button-resume-session')?.addEventListener('click', () => {
    if (!restoreSessionIfAny()) toast('Không còn phiên để tiếp tục.');
    else refreshSetupUI();
  });
  getElementById('button-discard-session')?.addEventListener('click', async () => {
    const ok = await confirmModal('Bỏ phiên đang dở?', 'Phiên làm bài hiện tại sẽ bị xóa. Tiến độ bộ đề đã lưu vẫn giữ nguyên.');
    if (!ok) return;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    refreshResumeCard();
    toast('Đã bỏ phiên cũ.');
  });
  getElementById('button-exam-quit')?.addEventListener('click', async () => {
    const session = state.session;
    const reviewing = session?.reviewMode;
    const ok = await confirmModal(reviewing ? 'Thoát kết quả thi?' : 'Thoát bài thi?', reviewing ? 'Bạn sẽ quay về màn hình thiết lập. Kết quả lần thi này không lưu lại phiên đang mở.' : 'Phiên thi hiện tại sẽ bị đóng. Tiến độ bộ đề (câu đã hoàn thành, câu sai) vẫn được giữ nếu bạn đã nộp bài.');
    if (!ok) return;
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    showScreen('setup');
    refreshSetupUI();
  });

  getElementById('button-bookmark').addEventListener('click', () => {
    const question = currentQuestion();
    const session = state.session;
    if (!question || !session) return;
    const result = toggleBookmark(session.deckId, question.originalIndex);
    if (result == null) {
      toast('Không thể lưu dấu trang. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    renderQuestion();
    toast(result ? 'Đã đánh dấu câu hỏi.' : 'Đã bỏ đánh dấu câu hỏi.');
  });

  const notePanel = getElementById('question-note-panel');
  const noteInput = getElementById('question-note-input');
  const noteButton = getElementById('button-note');
  const noteDisplay = getElementById('question-note-display');
  const noteTextEl = getElementById('question-note-text');

  function syncQuizNoteUI(note) {
    const has = !!note;
    if (noteButton) {
      noteButton.classList.toggle('has-note', has);
      noteButton.setAttribute('aria-pressed', String(has));
      noteButton.setAttribute('aria-label', has ? 'Sửa ghi chú' : 'Thêm ghi chú');
      noteButton.title = has ? 'Sửa ghi chú' : 'Thêm ghi chú';
    };
    if (notePanel) notePanel.hidden = true;
    if (noteDisplay && noteTextEl) {
      if (has) {
        noteTextEl.textContent = note;
        noteDisplay.hidden = false;
      } else {
        noteTextEl.textContent = '';
        noteDisplay.hidden = true;
      };
    };
  };

  function openNoteEditor() {
    const question = currentQuestion();
    const session = state.session;
    if (!question || !session || !notePanel || !noteInput) return;
    noteInput.value = getQuestionNote(session.deckId, question.originalIndex);
    if (noteDisplay) noteDisplay.hidden = true;
    notePanel.hidden = false;
    noteInput.focus();
  };

  function closeNoteEditor(refresh) {
    if (notePanel) notePanel.hidden = true;
    if (refresh !== false) {
      const question = currentQuestion();
      const session = state.session;
      const note = question && session ? getQuestionNote(session.deckId, question.originalIndex) : '';
      syncQuizNoteUI(note);
    };
  };

  noteButton?.addEventListener('click', () => {
    if (!notePanel) return;
    if (notePanel.hidden) openNoteEditor();
    else closeNoteEditor();
  });

  getElementById('button-note-save')?.addEventListener('click', () => {
    const question = currentQuestion();
    const session = state.session;
    if (!question || !session || !noteInput) return;
    const ok = saveQuestionNote(session.deckId, question.originalIndex, noteInput.value);
    if (!ok) {
      toast('Không thể lưu ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    const note = getQuestionNote(session.deckId, question.originalIndex);
    syncQuizNoteUI(note);
    toast(note ? 'Đã lưu ghi chú.' : 'Đã xóa ghi chú.');
  });

  getElementById('button-note-delete')?.addEventListener('click', () => {
    const question = currentQuestion();
    const session = state.session;
    if (!question || !session) return;
    const ok = saveQuestionNote(session.deckId, question.originalIndex, '');
    if (!ok) {
      toast('Không thể xóa ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    if (noteInput) noteInput.value = '';
    syncQuizNoteUI('');
    toast('Đã xóa ghi chú.');
  });

  getElementById('button-note-close')?.addEventListener('click', () => {
    closeNoteEditor();
  });

  getElementById('button-export-progress').addEventListener('click', () => {
    try {
      const content = exportBackup();
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'quocphonganninh-' + Date.now() + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Đã tạo tệp sao lưu tiến độ.');
    } catch {
      toast('Không thể tạo tệp sao lưu trên trình duyệt này.');
    };
  });

  getElementById('button-import-progress').addEventListener('click', () => getElementById('input-import-progress').click());
  getElementById('input-import-progress').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('Tệp sao lưu quá lớn hoặc không hợp lệ.');
      return;
    };
    const ok = await confirmModal('Khôi phục tiến độ?', 'Tiến độ đang lưu trên thiết bị này sẽ được thay bằng dữ liệu trong tệp sao lưu. Hãy chắc chắn bạn đã sao lưu dữ liệu hiện tại nếu cần.');
    if (!ok) return;
    let raw;
    try {
      raw = await file.text();
    } catch {
      toast('Không đọc được tệp đã chọn.');
      return;
    };
    if (!importBackup(raw)) {
      toast('Tệp sao lưu không hợp lệ hoặc không được hỗ trợ.');
      return;
    };
    await loadAll();
    if (!state.error) toast('Đã khôi phục tiến độ từ tệp sao lưu.');
  });

  getElementById('button-reset-progress').addEventListener('click', async () => {
    const ok = await confirmModal('Xóa tiến độ?', 'Xóa toàn bộ tiến độ, câu đã hoàn thành và lịch sử câu sai của bộ ' + DECKS[state.currentDeck].label + ' trên trình duyệt này.');
    if (!ok) return;
    if (!resetDeckProgress(state.currentDeck)) {
      toast('Không thể xóa tiến độ. Hãy kiểm tra quyền lưu trữ của trình duyệt.');
      return;
    };
    toast('Đã xóa tiến độ bộ đề.');
    refreshSetupUI();
  });

  getElementById('button-next').addEventListener('click', onNext);
  getElementById('button-prev').addEventListener('click', onPrev);

  getElementById('button-quit').addEventListener('click', async () => {
    const ok = await confirmModal('Thoát lượt ôn?', 'Phiên ôn hiện tại sẽ bị đóng. Tiến độ các lượt đã hoàn thành và lịch sử câu sai vẫn được giữ trên trình duyệt.');
    if (!ok) return;
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    const cleared = clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    if (!cleared) toast('Không thể xóa phiên đã lưu; phiên này có thể xuất hiện lại khi tải trang.');
    showScreen('setup');
    refreshSetupUI();
  });

  getElementById('button-summary-retry-session').addEventListener('click', () => {
    const previous = state._lastSummarySession;
    if (!previous || !state.decks[previous.deckId]) {
      toast('Không tìm thấy dữ liệu lượt vừa hoàn thành.');
      return;
    };
    state.currentDeck = previous.deckId;
    const byIndex = new Map(currentQuestions().map((question) => [question.originalIndex, question]));
    const pool = previous.indices.map((index) => byIndex.get(index)).filter(Boolean);
    if (!pool.length) {
      toast('Không còn câu hỏi phù hợp để làm lại.');
      return;
    };
    getElementById('input-range-start').value = String(previous.rangeStart);
    getElementById('input-range-end').value = String(previous.rangeEnd);
    getElementById('input-count').value = String(pool.length);
    getElementById('input-time-limit').value = String(previous.timeLimit);
    getElementById('checkbox-shuffle-questions').checked = true;
    getElementById('checkbox-shuffle-answers').checked = true;
    setPracticeMode(previous.mode === 'exam' ? 'exam' : 'practice');
    persistSetupForm();
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      rangeStart: previous.rangeStart,
      rangeEnd: previous.rangeEnd,
      requestedCount: pool.length,
      examMode: previous.mode === 'exam',
      forceShuffleQuestions: true,
      alreadyShuffled: false
    });
  });

  getElementById('button-summary-home').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
  });

  getElementById('button-summary-again').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
    getElementById('input-count').focus();
  });

  getElementById('button-summary-restart').addEventListener('click', async () => {
    const ok = await confirmModal('Làm lại từ đầu?', 'Tiến độ hoàn thành của bộ đề sẽ được đặt lại để bạn ôn tuần tự từ câu đầu. Lịch sử câu sai vẫn được giữ.');
    if (!ok) return;
    const progress = getDeckProgress(state.currentDeck);
    progress.completed = [];
    progress.sequentialCursor = 0;
    if (!saveDeckProgress(state.currentDeck, progress)) {
      toast('Không thể đặt lại tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.');
      return;
    };
    getElementById('checkbox-shuffle-questions').checked = false;
    persistSetupForm();
    showScreen('setup');
    refreshSetupUI();
    startNormal({ restart: true });
  });

  getElementById('button-summary-continue').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
    startNormal({ sequential: true });
  });

  getElementById('button-summary-random').addEventListener('click', () => {
    getElementById('checkbox-shuffle-questions').checked = true;
    persistSetupForm();
    showScreen('setup');
    refreshSetupUI();
    startNormal({ sequential: false });
  });

  getElementById('button-summary-practice').addEventListener('click', () => {
    if (state._lastSummaryDeck) state.currentDeck = state._lastSummaryDeck;
    if (Number.isInteger(state._lastSummaryRangeStart) && Number.isInteger(state._lastSummaryRangeEnd)) {
      getElementById('input-range-start').value = String(state._lastSummaryRangeStart);
      getElementById('input-range-end').value = String(state._lastSummaryRangeEnd);
    };
    if (Number.isInteger(state._lastSummaryCount) && state._lastSummaryCount > 0) getElementById('input-count').value = String(state._lastSummaryCount);
    setPracticeMode('practice');
    showScreen('setup');
    refreshSetupUI();
    startPracticeWrong({ indices: state._lastSummaryWrongIndices });
  });

  getElementById('button-retry').addEventListener('click', () => {
    showScreen('setup');
    loadAll();
  });

  getElementById('button-update').addEventListener('click', async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting) {
      reloadAfterUpdate = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else location.reload();
  });
};

let reloadAfterUpdate = false;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    toast('Trình duyệt này không hỗ trợ chế độ ngoại tuyến.');
    return;
  };
  const swUrl = new URL('sw.js', document.baseURI).href;
  const scope = new URL('.', document.baseURI).href;
  navigator.serviceWorker.register(swUrl, { scope }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) getElementById('update-banner').hidden = false;
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) getElementById('update-banner').hidden = false;
        else if (newWorker.state === 'redundant') toast('Không thể cài bản ngoại tuyến mới. Hãy kiểm tra kết nối và tải lại trang khi có mạng.');
      });
    });
  }).catch(() => {
    toast('Không thể bật chế độ ngoại tuyến.');
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAfterUpdate || refreshing) return;
    refreshing = true;
    location.reload();
  });
};


function classifyToast(text) {
  const rules = [
    ['error', /^(Không|Tệp|Cần |Hãy |Nhập |Câu hỏi không|Đáp án đúng không|Trình duyệt hạn)/],
    ['warning', /^(Hết giờ|Chỉ còn|Còn \d|Đã hết|Đã tạm dừng|Trình duyệt này)/],
    ['success', /^(Đã |Bạn đã chọn đủ)/]
  ];
  for (const [type, pattern] of rules) if (pattern.test(text)) return type;
  return 'info';
}

function initInterfaceEnhancements() {
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = '#0c0f14';

  const toastElement = getElementById('toast');
  if (toastElement) {
    toastElement.addEventListener('click', () => {
      toastElement.hidden = true;
    });
    new MutationObserver(() => {
      if (toastElement.hidden) return;
      toastElement.dataset.type = classifyToast((toastElement.textContent || '').trim());
      toastElement.style.animation = 'none';
      void toastElement.offsetWidth;
      toastElement.style.animation = '';
    }).observe(toastElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  const modal = getElementById('modal');
  if (!modal) return;
  const box = modal.querySelector('.modal-box');
  const title = getElementById('modal-title');
  const confirmButton = getElementById('modal-ok');
  if (!box || !title || !confirmButton) return;

  let icon = box.querySelector('.modal-icon');
  if (!icon) {
    icon = document.createElement('span');
    icon.className = 'modal-icon';
    icon.setAttribute('aria-hidden', 'true');
    box.prepend(icon);
  }

  const variants = [
    ['danger', /^(Xóa|Bỏ phiên)/, 'trash'],
    ['warning', /^(Thoát|Làm lại|Khôi phục|Còn câu|Tạm dừng)/, 'alert-circle']
  ];

  const applyVariant = () => {
    const modalTitle = (title.textContent || '').trim();
    const match = variants.find(([, pattern]) => pattern.test(modalTitle));
    const variant = match ? match[0] : 'primary';
    box.dataset.variant = variant;
    icon.dataset.icon = match ? match[2] : 'check';
    confirmButton.classList.toggle('button-danger', variant === 'danger');
    confirmButton.classList.toggle('button-primary', variant !== 'danger');
  };

  new MutationObserver(() => {
    if (!modal.hidden) applyVariant();
  }).observe(modal, {
    attributes: true,
    attributeFilter: ['hidden', 'class']
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) getElementById('modal-cancel')?.click();
  });
}

function boot() {
  initInterfaceEnhancements();
  initializeTheme();
  if (!storageAvailable()) toast('Trình duyệt hạn chế lưu trữ. Tiến độ có thể không được ghi nhớ.');
  bindEvents();

  window.addEventListener('pagehide', () => persistSession());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persistSession();
      return;
    };
    if (!enforceSessionDeadline()) updateTimerDisplay();
  });

  window.addEventListener('pageshow', () => {
    if (state.session && !enforceSessionDeadline()) {
      updateTimerDisplay();
      persistSession();
    };
  });

  registerServiceWorker();
  loadAll();
};

boot();