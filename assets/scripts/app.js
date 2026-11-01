import { initializeEnhancements } from './enhance.js';
import { fingerprintQuestions, normalizeQuestions, createSessionItems, pickSequential, findNextUncompletedQuestion, pickRandom, pickWrong, isAnswerCorrect, displayedCorrectIndex, getEndQuestionForDeckSwitch } from './quiz.js';
import { getSettings, saveSettings, getDeckProgress, saveDeckProgress, getSession, saveSession, clearSession, resetDeckProgress, clearWrongAnswers, markWrong, markPracticed, addCompleted, setSequentialCursor, getWrongIndices, getRangeWrongIndices, addWrongIndicesForRange, getBookmarkedIndices, toggleBookmark, clearBookmarks, exportBackup, importBackup, storageAvailable, getQuestionHighlights, saveQuestionHighlights, resetDeckHighlights, getQuestionNote, saveQuestionNote, resetDeckNotes, saveQuestionOverride, getDeckOverrides, getHiddenIndices, toggleHiddenQuestion, isQuestionHidden } from './storage.js';

const DECKS = {
  quocphonganninh1: {
    id: 'quocphonganninh1',
    label: 'QUỐC PHÒNG 1',
    file: 'data/quocphonganninh1.json'
  },
  quocphonganninh2: {
    id: 'quocphonganninh2',
    label: 'QUỐC PHÒNG 2',
    file: 'data/quocphonganninh2.json'
  }
};

const state = {
  decks: {
    quocphonganninh1: null,
    quocphonganninh2: null
  },
  fingerprints: {
    quocphonganninh1: '',
    quocphonganninh2: ''
  },
  legacyFingerprintMatched: {
    quocphonganninh1: false,
    quocphonganninh2: false
  },
  loading: true,
  error: null,
  currentDeck: 'quocphonganninh1',
  bankDeck: 'quocphonganninh1',
  setupDeckBeforeBank: 'quocphonganninh1',
  mode: 'setup',
  studyMode: 'practice',
  session: null,
  reviewMode: false,
  timerInterval: null,
  examFilter: 'all',
  examSubmitting: false,
  reviewVirtual: null,
  _lastSummarySession: null,
  _lastSummaryWrongIndices: [],
  _lastSummaryRangeStart: null,
  _lastSummaryRangeEnd: null,
  _lastSummaryCount: null,
  highlightEditMode: false,
  lastTextSelection: null,
  bankSearchQuery: '',
  bankSearchMatchIndex: -1,
  reviewFocusQuestionNumber: null,
  reviewEditingNoteIndex: null,
  reviewEditingNoteDraft: '',
  reviewEditingQuestionIndex: null,
  allQuestionsEnabled: false,
  unlimitedTimeEnabled: false,
  visibleQuestionCount: null
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
      questionText: entry.questionText,
      answerOptions: entry.answerOptions.slice(),
      correctAnswerIndex: entry.correctAnswerIndex,
      fixedAnswerIndices: Array.isArray(entry.fixedAnswerIndices) ? entry.fixedAnswerIndices.slice() : []
    };
  };
  const fingerprint = fingerprintQuestions(questions);
  state.decks[deckIdentifier] = questions;
  state.fingerprints[deckIdentifier] = fingerprint;
  const progress = getDeckProgress(deckIdentifier);
  const first = questions[0]?.questionText?.trim().slice(0, 40) || '';
  const last = questions[questions.length - 1]?.questionText?.trim().slice(0, 40) || '';
  const legacyFingerprint = questions.length + '|' + first + '|' + last;
  if (progress.questionDataFingerprint && progress.questionDataFingerprint !== fingerprint) {
    if (progress.questionDataFingerprint === legacyFingerprint) {
      state.legacyFingerprintMatched[deckIdentifier] = true;
      progress.questionDataFingerprint = fingerprint;
      if (!saveDeckProgress(deckIdentifier, progress)) toast('Không thể cập nhật phiên bản tiến độ trong trình duyệt.');
    } else {
      progress.completedQuestionIndices = [];
      progress.sequentialQuestionCursor = 0;
      progress.incorrectAnswerCounts = {};
      progress.rangeIncorrectQuestionIndices = {};
      progress.practiceQuestionCounts = {};
      progress.bookmarkedQuestionIndices = [];
      progress.questionDataFingerprint = fingerprint;
      if (!saveDeckProgress(deckIdentifier, progress)) toast('Không thể lưu tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.');
      if (!resetDeckHighlights(deckIdentifier)) toast('Không thể xóa phần đánh dấu cũ vì bộ nhớ trình duyệt không ghi được.');
      if (!resetDeckNotes(deckIdentifier)) toast('Không thể xóa ghi chú cũ vì bộ nhớ trình duyệt không ghi được.');
    };
  } else if (!progress.questionDataFingerprint) {
    progress.questionDataFingerprint = fingerprint;
    if (!saveDeckProgress(deckIdentifier, progress)) toast('Không thể lưu dấu vân tay bộ đề vào trình duyệt.');
  };

  const progressBeforeSanitize = JSON.stringify(progress);
  const isValidIndex = (index) => Number.isInteger(index) && index >= 0 && index < questions.length;
  progress.completedQuestionIndices = progress.completedQuestionIndices.filter(isValidIndex);
  progress.bookmarkedQuestionIndices = progress.bookmarkedQuestionIndices.filter(isValidIndex);
  progress.sequentialQuestionCursor = Math.min(progress.sequentialQuestionCursor, questions.length);
  progress.incorrectAnswerCounts = Object.fromEntries(Object.entries(progress.incorrectAnswerCounts).filter(([key, count]) => isValidIndex(Number(key)) && Number.isInteger(count) && count > 0));
  progress.practiceQuestionCounts = Object.fromEntries(Object.entries(progress.practiceQuestionCounts).filter(([key, count]) => isValidIndex(Number(key)) && Number.isInteger(count) && count > 0));
  if (JSON.stringify(progress) !== progressBeforeSanitize && !saveDeckProgress(deckIdentifier, progress)) toast('Không thể làm sạch tiến độ cũ trong trình duyệt.');
  return questions;
};

async function loadAll() {
  state.loading = true;
  state.error = null;
  showScreen('loading');
  let stage = 'tải dữ liệu';
  try {
    await Promise.all([loadDeck('quocphonganninh1'), loadDeck('quocphonganninh2')]);
    state.loading = false;
    stage = 'khởi tạo giao diện';
    initializeInterface();
  } catch (error) {
    state.loading = false;
    state.error = error?.message || String(error);
    console.error('Lỗi khi ' + stage + ':', error);
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
  return questions.filter((questionText) => !hidden.has(questionText.sourceQuestionIndex));
};

function formatDeckCountLabel(deckId) {
  return visibleDeckQuestions(deckId).length + ' CÂU';
};

function formatBankDeckCountLabel(deckId) {
  return allDeckQuestions(deckId).length + ' CÂU';
};

function updateDeckCountLabels() {
  if (getElementById('count-quocphonganninh1')) getElementById('count-quocphonganninh1').textContent = formatDeckCountLabel('quocphonganninh1');
  if (getElementById('count-quocphonganninh2')) getElementById('count-quocphonganninh2').textContent = formatDeckCountLabel('quocphonganninh2');
  if (getElementById('bank-count-quocphonganninh1')) getElementById('bank-count-quocphonganninh1').textContent = formatBankDeckCountLabel('quocphonganninh1');
  if (getElementById('bank-count-quocphonganninh2')) getElementById('bank-count-quocphonganninh2').textContent = formatBankDeckCountLabel('quocphonganninh2');
};

function sessionPreferences(deckId) {
  return getSettings(deckId || state.session?.deckId || state.currentDeck);
};

function renderTextWithHighlights(element, text, deckId, sourceQuestionIndex, target) {
  element.replaceChildren();
  element.dataset.highlightTarget = target;
  element.dataset.questionIndex = String(sourceQuestionIndex);
  element.dataset.deckId = deckId;
  const ranges = getQuestionHighlights(deckId, sourceQuestionIndex).filter((range) => range.target === target && range.start < text.length && range.end > 0).map((range) => ({
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

function questionMatchesSearch(questionText, query) {
  if (!query) return false;
  const haystack = normalizeSearchText([
    questionText.questionText || '',
    ...(Array.isArray(questionText.answerOptions) ? questionText.answerOptions : [])
  ].join(' '));
  return haystack.includes(query);
};

function getBankSearchMatches(questions = bankQuestions()) {
  const query = normalizeSearchText(state.bankSearchQuery);
  if (!query) return [];
  return questions.filter((questionText) => questionMatchesSearch(questionText, query));
};

function getFilteredBankQuestions() {
  const questions = bankQuestions();
    const query = normalizeSearchText(state.bankSearchQuery);
  const matches = query ? questions.filter((questionText) => questionMatchesSearch(questionText, query)) : [];
  const filtered = query ? matches : questions;
  return { questions, filtered, query, matches };
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
  const questionNumber = matches[index].sourceQuestionIndex + 1;
  scrollReviewToQuestionNumber(questionNumber);
  updateBankSearchHint(matches.length);
};

function updateReviewSearchClearButton() {
  const clearBtn = getElementById('button-review-search-clear');
  const input = getElementById('input-review-search');
  if (!clearBtn || !input) return;
  clearBtn.hidden = !String(input.value || '').length;
};

function applyBankSearch(answerOptions = {}) {
  const input = getElementById('input-review-search');
  const raw = input ? input.value : state.bankSearchQuery;
  state.bankSearchQuery = String(raw || '');
  state.bankSearchMatchIndex = -1;
  setReviewFocusQuestion(null);
  updateReviewSearchClearButton();
  const matches = getBankSearchMatches();
  updateBankSearchHint(matches.length);
  updateBankSearchNavButtons();
  if (answerOptions.scrollToFirst && matches.length >= 1) {
    state.bankSearchMatchIndex = 0;
    scrollReviewToQuestionNumber(matches[0].sourceQuestionIndex + 1);
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
  const filteredQuestionCount = virtualScrollState.filtered.length;
  const avg = averageReviewMeasuredHeight(virtualScrollState);
  const map = virtualScrollState.heightByOriginalIndex || new Map();
  virtualScrollState.heights = new Array(filteredQuestionCount);
  for (let questionIndex = 0; questionIndex < filteredQuestionCount; questionIndex++) {
    const sourceQuestionIndex = virtualScrollState.filtered[questionIndex]?.sourceQuestionIndex;
    const cached = Number.isInteger(sourceQuestionIndex) ? map.get(sourceQuestionIndex) : null;
    virtualScrollState.heights[questionIndex] = cached || avg;
  };
};

function rebuildReviewVirtualMetrics(virtualScrollState) {
  const filteredQuestionCount = virtualScrollState.filtered.length;
  if (virtualScrollState.heights.length !== filteredQuestionCount) syncReviewHeightsFromCache(virtualScrollState);
    const REVIEW_CARD_GAP = 12;
  virtualScrollState.positions = new Array(filteredQuestionCount);
  let verticalOffset = 0;
  for (let questionIndex = 0; questionIndex < filteredQuestionCount; questionIndex++) {
    virtualScrollState.positions[questionIndex] = verticalOffset;
    verticalOffset += (virtualScrollState.heights[questionIndex] || REVIEW_VIRTUAL_ESTIMATED_HEIGHT) + REVIEW_CARD_GAP;
  };
  virtualScrollState.totalHeight = Math.max(0, verticalOffset - (filteredQuestionCount ? REVIEW_CARD_GAP : 0));
  if (virtualScrollState.phantom) virtualScrollState.phantom.style.height = Math.max(verticalOffset, 0) + 'px';
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
  const questionIndex = Number(card.dataset.sourceQuestionIndex);
  const isEdited = Number.isInteger(questionIndex) && !!getDeckOverrides(state.bankDeck)[questionIndex];
  parts.editBlock.hidden = true;
  parts.editBlock.innerHTML = '';
  parts.prompt.hidden = false;
  parts.answerOptions.hidden = false;
  state.reviewEditingQuestionIndex = null;
  if (parts.syncReviewActionState) parts.syncReviewActionState();
  if (parts.editQuestionButton) {
    parts.editQuestionButton.classList.toggle('is-active', isEdited);
    parts.editQuestionButton.setAttribute('aria-label', isEdited ? 'Mở trình sửa câu hỏi đã chỉnh sửa' : 'Chỉnh sửa câu hỏi và đáp án');
    parts.editQuestionButton.title = isEdited ? 'Mở trình sửa câu hỏi đã chỉnh sửa' : 'Mở trình chỉnh sửa';
  };
  refreshReviewVirtualLayout();
};

function enterBankQuestionEdit(card, questionIndex) {
  const parts = card._vs;
  if (!parts) return;
  const deck = state.decks[state.bankDeck] || [];
  const questionText = deck.find((item) => item.sourceQuestionIndex === questionIndex) || deck[questionIndex];
  if (!questionText) return;

  if (Number.isInteger(state.reviewEditingNoteIndex)) {
    const activeCard = (getReviewVirtualState().pool || []).find((item) => Number(item.dataset.sourceQuestionIndex) === state.reviewEditingNoteIndex);
    if (activeCard?._vs?.setReviewNoteViewMode) activeCard._vs.setReviewNoteViewMode(getQuestionNote(state.bankDeck, state.reviewEditingNoteIndex));
    else {
      state.reviewEditingNoteIndex = null;
      state.reviewEditingNoteDraft = '';
    };
  };

  if (Number.isInteger(state.reviewEditingQuestionIndex) && state.reviewEditingQuestionIndex !== questionIndex) {
    for (const other of (getReviewVirtualState().pool || [])) {
      if (Number(other.dataset.sourceQuestionIndex) === state.reviewEditingQuestionIndex) exitBankQuestionEdit(other);
    };
  };

  state.reviewEditingQuestionIndex = questionIndex;
  if (parts.syncReviewActionState) parts.syncReviewActionState();
  parts.prompt.hidden = true;
  parts.answerOptions.hidden = true;
  parts.editBlock.hidden = false;
  parts.editBlock.innerHTML = '';
  if (parts.editQuestionButton) {
    parts.editQuestionButton.classList.add('is-active');
    parts.editQuestionButton.setAttribute('aria-label', 'Đóng trình chỉnh sửa');
    parts.editQuestionButton.title = 'Đóng trình chỉnh sửa';
  };
  const questionLabel = document.createElement('label');
  questionLabel.className = 'review-edit-label';
  questionLabel.textContent = 'CÂU HỎI';
  const questionInput = document.createElement('textarea');
  questionInput.className = 'review-edit-question';
  questionInput.rows = 3;
  questionInput.value = questionText.questionText;

  const answerLabel = document.createElement('div');
  answerLabel.className = 'review-edit-label';
  answerLabel.textContent = 'ĐÁP ÁN';

  const answerOptionList = document.createElement('div');
  answerOptionList.className = 'review-edit-options';
  const optionInputs = [];
  const radios = [];
  const answerLetterButtons = [];
  const optionCount = Math.max(4, questionText.answerOptions.length);
  for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
    const row = document.createElement('div');
    row.className = 'review-edit-option-row';
    const letter = String.fromCharCode(65 + optionIndex);

    const answerLetterButton = document.createElement('button');
    answerLetterButton.type = 'button';
    answerLetterButton.className = 'review-edit-correct-btn';
    answerLetterButton.textContent = letter;
    answerLetterButton.setAttribute('aria-label', 'Chọn đáp án đúng ' + letter);
    answerLetterButton.title = 'Đáp án đúng: ' + letter;
    answerLetterButton.setAttribute('aria-pressed', String(questionText.correctAnswerIndex === optionIndex));
    if (questionText.correctAnswerIndex === optionIndex) answerLetterButton.classList.add('is-correct');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'bank-edit-correct-' + questionIndex;
    radio.value = String(optionIndex);
    radio.checked = questionText.correctAnswerIndex === optionIndex;
    radio.className = 'screen-reader-only';
    radio.tabIndex = -1;
    radio.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'review-edit-option-input';
    input.placeholder = 'Đáp án ' + letter;
    input.value = questionText.answerOptions[optionIndex] || '';

    answerLetterButton.addEventListener('click', () => {
      radios.forEach((radioButton, buttonIndex) => {
        radioButton.checked = buttonIndex === optionIndex;
        answerLetterButtons[buttonIndex].classList.toggle('is-correct', buttonIndex === optionIndex);
        answerLetterButtons[buttonIndex].setAttribute('aria-pressed', String(buttonIndex === optionIndex));
      });
    });

    row.append(answerLetterButton, radio, input);
    answerOptionList.appendChild(row);
    optionInputs.push(input);
    radios.push(radio);
    answerLetterButtons.push(answerLetterButton);
  };

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
  resetBtn.setAttribute('aria-label', 'Khôi phục');
  resetBtn.title = 'Khôi phục';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'button button-ghost button-icon-only';
  cancelBtn.dataset.icon = 'x';
  cancelBtn.setAttribute('aria-label', 'Hủy');
  cancelBtn.title = 'Hủy';

  const fixedAnswerIndices = new Set(Array.isArray(questionText.fixedAnswerIndices) ? questionText.fixedAnswerIndices : []);
  answerOptionList.querySelectorAll('.review-edit-option-row').forEach((row, index) => {
    const fixedButton = document.createElement('button');
    fixedButton.type = 'button';
    fixedButton.className = 'button button-ghost button-icon-only review-edit-fixed-btn';
    fixedButton.dataset.icon = fixedAnswerIndices.has(index) ? 'pinned-off' : 'pinned';
    fixedButton.setAttribute('aria-pressed', String(fixedAnswerIndices.has(index)));
    fixedButton.setAttribute('aria-label', fixedAnswerIndices.has(index) ? 'Bỏ cố định đáp án ' + String.fromCharCode(65 + index) : 'Cố định đáp án ' + String.fromCharCode(65 + index));
    fixedButton.title = fixedAnswerIndices.has(index) ? 'Bỏ cố định đáp án' : 'Cố định đáp án';
    fixedButton.classList.toggle('is-on', fixedAnswerIndices.has(index));
    fixedButton.addEventListener('click', () => {
      const active = !fixedAnswerIndices.has(index);
      if (active) fixedAnswerIndices.add(index);
      else fixedAnswerIndices.delete(index);
      fixedButton.dataset.icon = active ? 'pinned-off' : 'pinned';
      fixedButton.setAttribute('aria-pressed', String(active));
      fixedButton.setAttribute('aria-label', active ? 'Bỏ cố định đáp án ' + String.fromCharCode(65 + index) : 'Cố định đáp án ' + String.fromCharCode(65 + index));
      fixedButton.title = active ? 'Bỏ cố định đáp án' : 'Cố định đáp án';
      fixedButton.classList.toggle('is-on', active);
    });
    row.appendChild(fixedButton);
  });

  actions.append(saveBtn, resetBtn, cancelBtn);

  parts.editBlock.append(questionLabel, questionInput, answerLabel, answerOptionList, actions);
  refreshReviewVirtualLayout();

  cancelBtn.addEventListener('click', () => {
    exitBankQuestionEdit(card);
    bindReviewBankCard(card, questionText, Number(card.dataset.listIndex));
  });

  resetBtn.addEventListener('click', async () => {
    const ok = saveQuestionOverride(state.bankDeck, questionIndex, null);
    if (!ok) {
      toast('Không thể khôi phục. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    try {
      await loadDeck(state.bankDeck);
    } catch {
      toast('Không thể tải lại dữ liệu gốc.');
      return;
    };
    toast('Đã khôi phục câu hỏi gốc.');
    state.reviewEditingQuestionIndex = null;
    renderQuestionBank();
  });

  saveBtn.addEventListener('click', () => {
    const questionText = questionInput.value.trim();
    if (!questionText) {
      toast('Câu hỏi không được để trống.');
      return;
    };
    const answerOptions = optionInputs.map((optionInput) => optionInput.value.trim()).filter(Boolean);
    if (answerOptions.length < 2) {
      toast('Cần ít nhất 2 đáp án.');
      return;
    };
    let correctAnswerIndex = radios.findIndex((radioButton) => radioButton.checked);
    const filledIndices = [];
    optionInputs.forEach((optionInput, optionIndex) => { if (optionInput.value.trim()) filledIndices.push(optionIndex); });
    if (correctAnswerIndex < 0 || !optionInputs[correctAnswerIndex] || !optionInputs[correctAnswerIndex].value.trim()) {
      toast('Hãy chọn đáp án đúng trong các đáp án đã nhập.');
      return;
    };
    correctAnswerIndex = filledIndices.indexOf(correctAnswerIndex);
    if (correctAnswerIndex < 0) {
      toast('Đáp án đúng không hợp lệ.');
      return;
    };
    const payload = {
      questionText: questionText,
      answerOptions,
      correctAnswerIndex,
      fixedAnswerIndices: [...fixedAnswerIndices].filter((index) => filledIndices.includes(index)).map((index) => filledIndices.indexOf(index))
    };
    const ok = saveQuestionOverride(state.bankDeck, questionIndex, payload);
    if (!ok) {
      toast('Không thể lưu chỉnh sửa. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    const deck = state.decks[state.bankDeck];
    if (deck && deck[questionIndex]) {
      deck[questionIndex] = {
        ...deck[questionIndex],
        questionText: questionText,
        answerOptions: answerOptions.slice(),
        correctAnswerIndex,
        fixedAnswerIndices: payload.fixedAnswerIndices.slice()
      };
      state.fingerprints[state.bankDeck] = fingerprintQuestions(deck);
    };
    toast('Đã lưu chỉnh sửa câu hỏi.');
    state.reviewEditingQuestionIndex = null;
    renderQuestionBank();
  });

  questionInput.focus();
};

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
  editQuestionButton.title = 'Mở trình chỉnh sửa';

  const hideQuestionButton = document.createElement('button');
  hideQuestionButton.type = 'button';
  hideQuestionButton.className = 'button button-ghost button-icon-only ';
  hideQuestionButton.dataset.icon = 'eye';
  hideQuestionButton.setAttribute('aria-label', 'Ẩn câu hỏi');
  hideQuestionButton.title = 'Ẩn câu hỏi';
  hideQuestionButton.setAttribute('aria-pressed', 'false');

  const noteEditBtn = document.createElement('button');
  noteEditBtn.type = 'button';
  noteEditBtn.className = 'button button-ghost button-icon-only';
  noteEditBtn.dataset.icon = 'notebook';
  noteEditBtn.setAttribute('aria-label', 'Mở trình sửa ghi chú');
  noteEditBtn.title = 'Mở trình sửa ghi chú';

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
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
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
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    const result = toggleBookmark(state.bankDeck, questionIndex);
    if (result === null) {
      toast('Không thể cập nhật đánh dấu. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    bookmarkButton.classList.toggle('is-bookmarked', result);
    bookmarkButton.setAttribute('aria-pressed', String(result));
    setToggleIcon(bookmarkButton, result, { on: 'bookmark-off', off: 'bookmark' });
    bookmarkButton.setAttribute('aria-label', result ? 'Bỏ đánh dấu' : 'Đánh dấu');
    bookmarkButton.title = result ? 'Bỏ đánh dấu' : 'Đánh dấu';
    toast(result ? 'Đã đánh dấu câu hỏi.' : 'Đã bỏ đánh dấu câu hỏi.');
  });

  hideQuestionButton.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    const result = toggleHiddenQuestion(state.bankDeck, questionIndex);
    if (result === null) {
      toast('Không thể cập nhật trạng thái ẩn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    card.classList.toggle('is-hidden-questionText', result);
    hideQuestionButton.classList.toggle('is-hidden-active', result);
    hideQuestionButton.setAttribute('aria-pressed', String(result));
    setToggleIcon(hideQuestionButton, result, { on: 'eye-off', off: 'eye' });
    hideQuestionButton.setAttribute('aria-label', result ? 'Hiện câu hỏi' : 'Ẩn câu hỏi');
    hideQuestionButton.title = result ? 'Hiện câu hỏi' : 'Ẩn câu hỏi';
    updateDeckCountLabels();
    toast(result ? 'Đã ẩn câu hỏi.' : 'Đã hiện lại câu hỏi.');
  });

  editQuestionButton.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    if (state.reviewEditingQuestionIndex === questionIndex) {
      exitBankQuestionEdit(card);
      return;
    };
    enterBankQuestionEdit(card, questionIndex);
  });

  toolbar.append(bookmarkButton, editQuestionButton, hideQuestionButton, noteEditBtn, highlightButton);

  const noteBlock = document.createElement('div');
  noteBlock.className = 'review-note-block is-empty';
  const noteText = document.createElement('p');
  noteText.className = 'review-note-text';
  const noteInputElement = document.createElement('textarea');
  noteInputElement.className = 'question-note-input';
  noteInputElement.rows = 3;
  noteInputElement.maxLength = 2000;
  noteInputElement.placeholder = 'Nhập ghi chú cho câu hỏi này…';
  noteInputElement.hidden = true;
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
  noteBlock.append(noteText, noteInputElement, noteActions);

  function setReviewNoteViewMode(existing) {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (Number.isInteger(questionIndex) && state.reviewEditingNoteIndex === questionIndex) {
      state.reviewEditingNoteIndex = null;
      state.reviewEditingNoteDraft = '';
    };
    noteInputElement.hidden = true;
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
      noteEditBtn.setAttribute('aria-label', 'Mở trình sửa ghi chú');
      noteEditBtn.title = 'Mở trình sửa ghi chú';
    } else {
      noteText.textContent = '';
      noteText.hidden = true;
      noteBlock.classList.add('is-empty');
      noteBlock.hidden = true;
      noteEditBtn.setAttribute('aria-label', 'Mở trình thêm ghi chú');
      noteEditBtn.title = 'Mở trình thêm ghi chú';
    };
    syncReviewActionState();
    refreshReviewVirtualLayout();
  };

  function setReviewNoteEditMode(questionIndex, draft) {
    state.reviewEditingNoteIndex = questionIndex;
    const existingNote = getQuestionNote(state.bankDeck, questionIndex);
    const value = typeof draft === 'string' ? draft : existingNote;
    state.reviewEditingNoteDraft = value;
    noteInputElement.value = value;
    noteText.hidden = true;
    noteInputElement.hidden = false;
    noteSaveBtn.hidden = false;
    noteDeleteBtn.hidden = false;
    noteCancelBtn.hidden = false;
    noteBlock.classList.remove('is-empty');
    noteBlock.hidden = false;
    noteEditBtn.classList.add('has-note');
    noteEditBtn.setAttribute('aria-label', existingNote ? 'Đóng trình sửa ghi chú' : 'Đóng trình thêm ghi chú');
    noteEditBtn.title = existingNote ? 'Đóng trình sửa ghi chú' : 'Đóng trình thêm ghi chú';
    syncReviewActionState();
    refreshReviewVirtualLayout();
    noteInputElement.focus();
  };

  noteInputElement.addEventListener('input', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    if (state.reviewEditingNoteIndex === questionIndex) state.reviewEditingNoteDraft = noteInputElement.value;
  });

  noteEditBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    if (Number.isInteger(state.reviewEditingQuestionIndex)) {
      const activeCard = (getReviewVirtualState().pool || []).find((item) => Number(item.dataset.sourceQuestionIndex) === state.reviewEditingQuestionIndex);
      if (!activeCard?._vs?.editBlock || activeCard._vs.editBlock.hidden) {
        state.reviewEditingQuestionIndex = null;
        syncReviewActionState();
      };
    };
    if (Number.isInteger(state.reviewEditingQuestionIndex)) {
      toast('Hãy lưu hoặc đóng chỉnh sửa câu hỏi trước khi ghi chú.');
      return;
    };
    if (!noteInputElement.hidden) {
      setReviewNoteViewMode(getQuestionNote(state.bankDeck, questionIndex));
      return;
    };
    setReviewNoteEditMode(questionIndex);
  });

  noteCancelBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    setReviewNoteViewMode(getQuestionNote(state.bankDeck, questionIndex));
  });

  noteSaveBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    const ok = saveQuestionNote(state.bankDeck, questionIndex, noteInputElement.value);
    if (!ok) {
      toast('Không thể lưu ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    const existing = getQuestionNote(state.bankDeck, questionIndex);
    setReviewNoteViewMode(existing);
    toast(existing ? 'Đã lưu ghi chú.' : 'Đã xóa ghi chú.');
  });

  noteDeleteBtn.addEventListener('click', () => {
    const questionIndex = Number(card.dataset.sourceQuestionIndex);
    if (!Number.isInteger(questionIndex)) return;
    const ok = saveQuestionNote(state.bankDeck, questionIndex, '');
    if (!ok) {
      toast('Không thể xóa ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    noteInputElement.value = '';
    setReviewNoteViewMode('');
    toast('Đã xóa ghi chú.');
  });

  const syncReviewActionState = () => {
    const editingQuestion = Number.isInteger(state.reviewEditingQuestionIndex);
    const editingNote = Number.isInteger(state.reviewEditingNoteIndex);
    const hasNote = !!getQuestionNote(state.bankDeck, Number(card.dataset.sourceQuestionIndex));
    editQuestionButton.disabled = editingNote;
    noteEditBtn.disabled = editingQuestion;
    const editBlockedLabel = hasNote ? 'Hãy đóng trình sửa ghi chú trước' : 'Hãy đóng trình thêm ghi chú trước';
    editQuestionButton.title = editingNote ? editBlockedLabel : 'Mở trình chỉnh sửa';
    editQuestionButton.setAttribute('aria-label', editingNote ? editBlockedLabel : 'Mở trình chỉnh sửa');
    if (editingQuestion) {
      noteEditBtn.title = 'Hãy đóng trình chỉnh sửa trước';
      noteEditBtn.setAttribute('aria-label', noteEditBtn.title);
    } else if (editingNote) {
      noteEditBtn.title = hasNote ? 'Đóng trình sửa ghi chú' : 'Đóng trình thêm ghi chú';
      noteEditBtn.setAttribute('aria-label', noteEditBtn.title);
    } else {
      noteEditBtn.title = hasNote ? 'Mở trình sửa ghi chú' : 'Mở trình thêm ghi chú';
      noteEditBtn.setAttribute('aria-label', noteEditBtn.title);
    };
  };
  const answerOptions = document.createElement('ol');
  answerOptions.className = 'review-options';
  answerOptions.type = 'A';

  const optionNodes = [];
  for (let optionIndex = 0; optionIndex < 6; optionIndex++) {
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
    answerOptions.appendChild(item);
    optionNodes.push({ item, label, text, badge });
  };


  const editBlock = document.createElement('div');
  editBlock.className = 'review-edit-block';
  editBlock.hidden = true;

  card.append(heading, prompt, toolbar, noteBlock, editBlock, answerOptions);
  card._vs = {
    heading,
    prompt,
    toolbar,
    bookmarkButton,
    editQuestionButton,
    hideQuestionButton,
    noteBlock,
    noteText,
    noteInput: noteInputElement,
    noteEditBtn,
    syncReviewActionState,
    noteSaveBtn,
    noteDeleteBtn,
    noteCancelBtn,
    setReviewNoteViewMode,
    setReviewNoteEditMode,
    editBlock,
    answerOptions,
    optionNodes
  };
  return card;
};

function bindReviewBankCard(card, questionText, listIndex) {
  const parts = card._vs;
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  card.dataset.listIndex = String(listIndex);
  card.dataset.sourceQuestionIndex = String(questionText.sourceQuestionIndex);
  card.id = 'review-question-' + (questionText.sourceQuestionIndex + 1);
  parts.heading.textContent = 'CÂU ' + (questionText.sourceQuestionIndex + 1);
  card.classList.toggle('review-question-highlight', state.reviewFocusQuestionNumber === questionText.sourceQuestionIndex + 1);
  card.classList.toggle('is-answer-fixed', Array.isArray(questionText.fixedAnswerIndices) && questionText.fixedAnswerIndices.length > 0);
  const isEdited = !!getDeckOverrides(state.bankDeck)[questionText.sourceQuestionIndex];
  parts.editQuestionButton.classList.toggle('is-active', isEdited);
  if (state.reviewEditingQuestionIndex !== questionText.sourceQuestionIndex) {
    parts.editQuestionButton.setAttribute('aria-label', isEdited ? 'Mở trình sửa câu hỏi đã chỉnh sửa' : 'Chỉnh sửa câu hỏi và đáp án');
    parts.editQuestionButton.title = isEdited ? 'Mở trình sửa câu hỏi đã chỉnh sửa' : 'Mở trình chỉnh sửa';
  };

  const isBookmarked = getBookmarkedIndices(state.bankDeck).includes(questionText.sourceQuestionIndex);
  if (parts.bookmarkButton) {
    parts.bookmarkButton.classList.toggle('is-bookmarked', isBookmarked);
    parts.bookmarkButton.setAttribute('aria-pressed', String(isBookmarked));
    setToggleIcon(parts.bookmarkButton, isBookmarked, { on: 'bookmark-off', off: 'bookmark' });
    parts.bookmarkButton.setAttribute('aria-label', isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu');
    parts.bookmarkButton.title = isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu';
  };

  const hidden = isQuestionHidden(state.bankDeck, questionText.sourceQuestionIndex);
  card.classList.toggle('is-hidden-questionText', hidden);
  if (parts.hideQuestionButton) {
    parts.hideQuestionButton.classList.toggle('is-hidden-active', hidden);
    parts.hideQuestionButton.setAttribute('aria-pressed', String(hidden));
    setToggleIcon(parts.hideQuestionButton, hidden, { on: 'eye-off', off: 'eye' });
    parts.hideQuestionButton.setAttribute('aria-label', hidden ? 'Hiện câu hỏi' : 'Ẩn câu hỏi');
    parts.hideQuestionButton.title = hidden ? 'Hiện câu hỏi' : 'Ẩn câu hỏi';
  };

  if (state.reviewEditingQuestionIndex === questionText.sourceQuestionIndex) {
    if (parts.editBlock.hidden || !parts.editBlock.childElementCount) {
      enterBankQuestionEdit(card, questionText.sourceQuestionIndex);
    } else {
      parts.prompt.hidden = true;
      parts.answerOptions.hidden = true;
      parts.editBlock.hidden = false;
    };
  } else {
    if (!parts.editBlock.hidden) exitBankQuestionEdit(card);
    parts.prompt.hidden = false;
    parts.answerOptions.hidden = false;
  };

  renderTextWithHighlights(parts.prompt, questionText.questionText, state.bankDeck, questionText.sourceQuestionIndex, 'questionText');

  const existingNote = getQuestionNote(state.bankDeck, questionText.sourceQuestionIndex);
  if (parts.noteBlock) {
    if (state.reviewEditingNoteIndex === questionText.sourceQuestionIndex && typeof parts.setReviewNoteEditMode === 'function') parts.setReviewNoteEditMode(questionText.sourceQuestionIndex, state.reviewEditingNoteDraft);
    else if (typeof parts.setReviewNoteViewMode === 'function') parts.setReviewNoteViewMode(existingNote);
  };

  const optionCount = questionText.answerOptions.length;
  parts.optionNodes.forEach((node, index) => {
    if (index >= optionCount) {
      node.item.hidden = true;
      return;
    };
    node.item.hidden = false;
    const isCorrect = index === questionText.correctAnswerIndex;
    node.item.className = isCorrect ? 'review-option is-correct' : 'review-option';
    node.label.textContent = labels[index] || String(index + 1);
    renderTextWithHighlights(node.text, questionText.answerOptions[index], state.bankDeck, questionText.sourceQuestionIndex, 'option:' + index);
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
    const sourceQuestionIndex = virtualScrollState.filtered[index]?.sourceQuestionIndex;
    if (Number.isInteger(sourceQuestionIndex)) virtualScrollState.heightByOriginalIndex.set(sourceQuestionIndex, withGap);
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
  for (let listIndex = start; listIndex <= end; listIndex++) neededIndices.push(listIndex);

  const assigned = new Map();
  const free = [];
  for (const card of virtualScrollState.pool) {
    const index = Number(card.dataset.listIndex);
    if (!card.hidden && Number.isInteger(index) && index >= start && index <= end && !assigned.has(index)) assigned.set(index, card);
    else free.push(card);
  };

  for (const listIndex of neededIndices) {
    let card = assigned.get(listIndex);
    if (!card) card = free.pop();
    if (!card) continue;
    assigned.set(listIndex, card);
    const questionText = virtualScrollState.filtered[listIndex];
    bindReviewBankCard(card, questionText, listIndex);
    card.hidden = false;
    card.style.transform = 'translateY(' + (virtualScrollState.positions[listIndex] || 0) + 'px)';
  };

  const used = new Set(assigned.values());
  for (const card of virtualScrollState.pool) {
    if (!used.has(card)) {
      card.hidden = true;
      card.dataset.listIndex = '';
      card.dataset.sourceQuestionIndex = '';
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

function refreshReviewVirtualLayout() {
  if (state.mode !== 'review') return;
  const virtualScrollState = getReviewVirtualState();
  if (!getElementById('review-list')) return;
  requestAnimationFrame(() => {
    measureReviewVirtualVisible(virtualScrollState);
    rebuildReviewVirtualMetrics(virtualScrollState);
    for (const card of virtualScrollState.pool || []) {
      if (card.hidden) continue;
      const index = Number(card.dataset.listIndex);
      if (Number.isInteger(index)) card.style.transform = 'translateY(' + (virtualScrollState.positions[index] || 0) + 'px)';
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
    const sourceQuestionIndex = Number(card.dataset.sourceQuestionIndex);
    const shouldHighlight = state.reviewFocusQuestionNumber != null && Number.isInteger(sourceQuestionIndex) && state.reviewFocusQuestionNumber === sourceQuestionIndex + 1;
    card.classList.toggle('review-question-highlight', shouldHighlight);
  };
  const list = getElementById('review-list');
  if (list) {
    list.querySelectorAll('.review-question-highlight').forEach((element) => {
      const sourceQuestionIndex = Number(element.dataset.sourceQuestionIndex);
      const shouldHighlight = state.reviewFocusQuestionNumber != null && Number.isInteger(sourceQuestionIndex) && state.reviewFocusQuestionNumber === sourceQuestionIndex + 1;
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
  const index = virtualScrollState.filtered.findIndex((questionText) => questionText.sourceQuestionIndex + 1 === questionNumber);
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
        const sourceQuestionIndex = virtualScrollState.filtered[listIndex]?.sourceQuestionIndex;
        if (Number.isInteger(sourceQuestionIndex)) virtualScrollState.heightByOriginalIndex.set(sourceQuestionIndex, withGap);
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
    gotoInput.placeholder = '1–' + questions.length;
    gotoInput.setAttribute('aria-label', 'Đến một câu trong khoảng từ câu 1 đến câu ' + questions.length);
  };
  const searchInput = getElementById('input-review-search');
  if (searchInput && searchInput.value !== state.bankSearchQuery) searchInput.value = state.bankSearchQuery;
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
  state.bankDeck = state.currentDeck;
  
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
  const fullTotal = questions.length;
  const total = questions.length;
  updateDeckCountLabels();

  document.querySelectorAll('.deck-button').forEach((button) => button.classList.toggle('active', button.dataset.deck === state.currentDeck));

  const startInput = getElementById('input-range-start');
  const endInput = getElementById('input-range-end');
  startInput.max = String(Math.max(1, fullTotal));
  endInput.max = String(Math.max(1, fullTotal));
  let start = Number.parseInt(startInput.value, 10);
  let end = Number.parseInt(endInput.value, 10);
  const previousVisibleTotal = state.visibleQuestionCount;
  const endWasAtPreviousTotal = Number.isInteger(previousVisibleTotal) && end === previousVisibleTotal;
  if (!Number.isInteger(start)) start = 1;
  if (!Number.isInteger(end)) end = fullTotal;
  if (endWasAtPreviousTotal) end = fullTotal;
  start = Math.max(1, Math.min(start, Math.max(1, fullTotal)));
  end = Math.max(start, Math.min(end, Math.max(1, fullTotal)));
  startInput.value = String(start);
  endInput.value = String(end);
  state.visibleQuestionCount = fullTotal;

  const rangeTotal = Math.max(0, end - start + 1);
  const input = getElementById('input-count');
  input.max = String(Math.max(1, rangeTotal));
  const countFocused = document.activeElement === input;
  if (!countFocused && !state.allQuestionsEnabled) {
    if (Number(input.value) > rangeTotal) input.value = String(rangeTotal || 1);
    if (Number(input.value) < 1 || !Number.isFinite(Number(input.value))) input.value = '1';
  };

  const isAllCount = state.allQuestionsEnabled;
  const selectAllButton = getElementById('button-select-all');
  if (selectAllButton) {
    selectAllButton.classList.toggle('is-active', isAllCount);
    selectAllButton.setAttribute('aria-pressed', isAllCount ? 'true' : 'false');
    setToggleIcon(selectAllButton, isAllCount, { on: 'deselect', off: 'select-all' });
    selectAllButton.title = isAllCount ? 'Bỏ chọn toàn bộ vùng' : 'Chọn toàn bộ vùng';
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
    const isUnlimited = state.unlimitedTimeEnabled;
    const unlimitedTimeButton = getElementById('button-unlimited-time');
    if (unlimitedTimeButton) {
      unlimitedTimeButton.classList.toggle('is-active', isUnlimited);
      unlimitedTimeButton.setAttribute('aria-pressed', isUnlimited ? 'true' : 'false');
      setToggleIcon(unlimitedTimeButton, isUnlimited, { on: 'infinity-off', off: 'infinity' });
      unlimitedTimeButton.title = isUnlimited ? 'Tắt không giới hạn thời gian' : 'Bật không giới hạn thời gian';
      unlimitedTimeButton.setAttribute('aria-label', unlimitedTimeButton.title);
    };
    timeInput.disabled = isUnlimited && !timeFocused;
  };

  const progress = getDeckProgress(state.currentDeck);
  const completedQuestionIndices = new Set(progress.completedQuestionIndices);
  const remaining = questions.filter((questionText) => !completedQuestionIndices.has(questionText.sourceQuestionIndex)).length;
  const wrongs = getWrongIndices(state.currentDeck);
  getElementById('statistics-completed').textContent = String(completedQuestionIndices.size);
  getElementById('statistics-remaining').textContent = String(remaining);
  getElementById('statistics-wrong').textContent = String(wrongs.length);
  getElementById('statistics-practiced').textContent = String(Object.values(progress.practiceQuestionCounts || {}).reduce((sum, count) => sum + count, 0));
  getElementById('statistics-bookmarked').textContent = String(progress.bookmarkedQuestionIndices.length);
  if (progress.sequentialQuestionCursor >= total) getElementById('statistics-sequential-cursor').textContent = 'Đã làm hết bộ đề';
  else getElementById('statistics-sequential-cursor').textContent = String(progress.sequentialQuestionCursor + 1);

  const hiddenSet = new Set(getHiddenIndices(state.currentDeck));
  const practiceWrongButton = getElementById('button-practice-wrong');
  const rangeWrongCount = getRangeWrongIndices(
    state.currentDeck,
    start,
    end
  ).filter((index) => !hiddenSet.has(index)).length;
  practiceWrongButton.disabled = state.studyMode === 'exam' || rangeWrongCount === 0;
  practiceWrongButton.textContent = 'ÔN ' + rangeWrongCount + ' CÂU SAI TRONG VÙNG';
  const clearPracticeWrongButton = getElementById('button-clear-practice-wrong');
  if (clearPracticeWrongButton) clearPracticeWrongButton.disabled = rangeWrongCount === 0;

  const allWrongCount = getWrongIndices(state.currentDeck).filter((index) => index < fullTotal && !hiddenSet.has(index)).length;
  const practiceAllWrongButton = getElementById('button-practice-all-wrong');
  practiceAllWrongButton.disabled = state.studyMode === 'exam' || allWrongCount === 0;
  practiceAllWrongButton.textContent = 'ÔN ' + allWrongCount + ' CÂU SAI CỦA BỘ ĐỀ';
  const clearAllWrongButton = getElementById('button-clear-all-wrong');
  if (clearAllWrongButton) clearAllWrongButton.disabled = allWrongCount === 0;

  const bookmarkedQuestionIndices = new Set(getBookmarkedIndices(state.currentDeck));
  const rangeBookmarkCount = [...bookmarkedQuestionIndices].filter((questionIndex) => questionIndex >= start - 1 && questionIndex < end && questionIndex < fullTotal && !isQuestionHidden(state.currentDeck, questionIndex)).length;
  const practiceBookmarksButton = getElementById('button-practice-bookmarks');
  practiceBookmarksButton.disabled = state.studyMode === 'exam' || rangeBookmarkCount === 0;
  practiceBookmarksButton.textContent = 'ÔN ' + rangeBookmarkCount + ' CÂU ĐÃ ĐÁNH DẤU';
  const clearBookmarksButton = getElementById('button-clear-bookmarks');
  if (clearBookmarksButton) clearBookmarksButton.disabled = rangeBookmarkCount === 0;

  const rangeQuestions = questions.slice(start - 1, end);
  const shuffleQuestionOrder = getElementById('checkbox-shuffle-questions').checked;
  const continueButton = getElementById('button-continue');
  const rangeStartSourceIndex = rangeQuestions[0]?.sourceQuestionIndex ?? 0;
  const nextQuestion = findNextUncompletedQuestion(rangeQuestions, Math.max(progress.sequentialQuestionCursor, rangeStartSourceIndex), completedQuestionIndices);
  const nextIndex = nextQuestion?.sourceQuestionIndex ?? end;
  const canContinue = state.studyMode !== 'exam' && !shuffleQuestionOrder && !!nextQuestion;
  continueButton.hidden = !canContinue;
  if (canContinue) {
    const left = rangeQuestions.filter((questionText) => questionText.sourceQuestionIndex >= nextIndex).length;
    const availableQuestionCount = Math.min(state.allQuestionsEnabled ? rangeTotal : (Number(input.value) || 20), left);
    continueButton.textContent = 'TIẾP TỤC TUẦN TỰ ' + availableQuestionCount + ' CÂU TỪ CÂU ' + (nextIndex + 1);
  };

  document.querySelectorAll('.preset-btn').forEach((button) => {
    const presetQuestionCount = Number(button.dataset.count);
    button.classList.toggle('is-active', Number(input.value) === presetQuestionCount);
    button.disabled = presetQuestionCount > rangeTotal;
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
  const answered = saved.items.filter((item) => item.selectedAnswerIndex != null).length;
  const isExam = !!saved.examMode || saved.mode === 'exam';
  const deckLabel = DECKS[saved.deckId]?.label || saved.deckId;
  card.hidden = false;
  getElementById('resume-title').textContent = isExam ? saved.reviewMode ? 'CÓ LƯỢT THI ĐÃ CHẤM' : 'CÓ LƯỢT THI THỬ ĐANG DỞ' : 'CÓ LƯỢT ÔN ĐANG DỞ';
  getElementById('resume-hint').textContent = isExam ? deckLabel + ' · ' + answered + ' / ' + saved.items.length + ' CÂU ĐÃ CHỌN' + (saved.reviewMode ? ' · ĐÃ CHẤM' : '') : deckLabel + ' · CÂU ' + ((saved.viewIndex || 0) + 1) + ' / ' + saved.items.length;
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
  const autoCheckOn = !!getElementById('checkbox-automatic-check')?.checked;
  const autoCheckDelayInput = getElementById('input-auto-check-delay');
  const autoCheckDelayField = getElementById('field-auto-check-delay');
  if (autoCheckDelayInput) autoCheckDelayInput.disabled = !autoCheckOn;
  if (autoCheckDelayField) autoCheckDelayField.classList.toggle('is-disabled', !autoCheckOn);
  syncExperienceToggleButton('button-auto-check', 'checkbox-automatic-check', 'toggle-right', 'toggle-left', 'Bật tự kiểm tra', 'Tắt tự kiểm tra');

  const autoAdvanceOn = !!getElementById('checkbox-automatic-advance')?.checked;
  const delayInput = getElementById('input-auto-advance-delay');
  const delayField = getElementById('field-auto-advance-delay');
  if (delayInput) delayInput.disabled = !autoAdvanceOn;
  if (delayField) delayField.classList.toggle('is-disabled', !autoAdvanceOn);
  syncExperienceToggleButton('button-auto-advance', 'checkbox-automatic-advance', 'toggle-right', 'toggle-left', 'Bật tự chuyển câu', 'Tắt tự chuyển câu');

  const soundOn = !!getElementById('checkbox-sound')?.checked;
  const volumeInput = getElementById('input-sound-volume');
  const volumeField = getElementById('field-sound-volume');
  if (volumeInput) volumeInput.disabled = !soundOn;
  if (volumeField) volumeField.classList.toggle('is-disabled', !soundOn);
  syncExperienceToggleButton('button-sound', 'checkbox-sound', 'volume-off', 'volume', 'Bật âm thanh', 'Tắt âm thanh');
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

function setBankDeck(deckId) {
  const id = deckId === 'quocphonganninh2' ? 'quocphonganninh2' : 'quocphonganninh1';
  if (state.bankDeck === id) return;
  
  state.bankDeck = id;

  
  state.bankSearchMatchIndex = -1;
  state.reviewEditingNoteIndex = null;
  state.reviewEditingNoteDraft = '';
  const virtualScrollState = getReviewVirtualState();
  virtualScrollState.heights = [];
  virtualScrollState.positions = [];
  
  renderQuestionBank();
  if (getElementById('bank-count-quocphonganninh1')) {
    getElementById('bank-count-quocphonganninh1').textContent = formatBankDeckCountLabel('quocphonganninh1');
    getElementById('bank-count-quocphonganninh2').textContent = formatBankDeckCountLabel('quocphonganninh2');
  };
  updateBankSearchHint();
  updateBankSearchNavButtons();
};

function startPracticeBookmarks() {
  const form = readSetupForm();
  persistSetupForm();
  const questions = selectedQuestions(form);
  const bookmarked = getBookmarkedIndices(state.currentDeck).filter((questionIndex) => !isQuestionHidden(state.currentDeck, questionIndex));
  const pool = pickWrong(questions, bookmarked, form.count, form.shuffleQuestionOrder);
  if (!pool.length) {
    toast('Trong vùng câu hỏi đã chọn không có câu nào được đánh dấu.');
    return;
  };
  const practiceSaveFailed = pool.some((questionText) => markPracticed(state.currentDeck, questionText.sourceQuestionIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê ôn lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-bookmarks',
    sequential: false,
    forceShuffleQuestions: form.shuffleQuestionOrder,
    alreadyShuffled: true
  });
};

function readSetupForm() {
  const total = currentQuestions().length;
  let firstQuestionNumber = Number.parseInt(getElementById('input-range-start').value, 10);
  let lastQuestionNumber = Number.parseInt(getElementById('input-range-end').value, 10);
  if (!Number.isInteger(firstQuestionNumber)) firstQuestionNumber = 1;
  if (!Number.isInteger(lastQuestionNumber)) lastQuestionNumber = total;
  firstQuestionNumber = Math.max(1, Math.min(firstQuestionNumber, Math.max(1, total)));
  lastQuestionNumber = Math.max(firstQuestionNumber, Math.min(lastQuestionNumber, Math.max(1, total)));

  let count = Number.parseInt(getElementById('input-count').value, 10);
  const rangeCount = Math.max(1, lastQuestionNumber - firstQuestionNumber + 1);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > rangeCount) count = rangeCount;
  const storedCount = count;
  let timeLimit = Number.parseInt(getElementById('input-time-limit').value, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 0) timeLimit = 0;
  timeLimit = Math.min(1440, timeLimit);
  const storedTimeLimit = timeLimit;
  const shuffleQuestionOrder = getElementById('checkbox-shuffle-questions').checked;
  const shuffleAnswerOrder = getElementById('checkbox-shuffle-answers').checked;
  return {
    count: state.allQuestionsEnabled ? rangeCount : count,
    storedCount,
    shuffleQuestionOrder,
    shuffleAnswerOrder,
    firstQuestionNumber,
    lastQuestionNumber,
    timeLimit: state.unlimitedTimeEnabled ? 0 : timeLimit,
    storedTimeLimit,
    allQuestionsEnabled: state.allQuestionsEnabled,
    unlimitedTimeEnabled: state.unlimitedTimeEnabled
  };
};

function persistSetupForm() {
  const form = readSetupForm();
  const saved = saveSettings({
    deck: state.currentDeck,
    count: form.storedCount,
    allQuestionsEnabled: form.allQuestionsEnabled,
    shuffleQuestionOrder: form.shuffleQuestionOrder,
    shuffleAnswerOrder: form.shuffleAnswerOrder,
    firstQuestionNumber: form.firstQuestionNumber,
    lastQuestionNumber: form.lastQuestionNumber,
    timeLimit: form.storedTimeLimit,
    unlimitedTimeEnabled: form.unlimitedTimeEnabled,
    studyMode: state.studyMode,
    automaticAnswerChecking: getElementById('checkbox-automatic-check').checked,
    automaticAnswerCheckDelaySeconds: (() => {
      const delay = Number.parseInt(getElementById('input-auto-check-delay')?.value, 10);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    automaticQuestionAdvance: getElementById('checkbox-automatic-advance').checked,
    vibrationEnabled: getElementById('checkbox-vibration').checked,
    automaticQuestionAdvanceDelaySeconds: (() => {
      const delay = Number.parseInt(getElementById('input-auto-advance-delay')?.value, 10);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    soundVolumePercentage: (() => {
      const input = getElementById('input-sound-volume');
      return normalizeSoundVolume(input?.dataset?.lastVolume || input?.value, 1);
    })(),
    soundEnabled: !!getElementById('checkbox-sound')?.checked
  });
  if (!saved) toast('Không thể lưu tùy chọn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
};

function applySettingsToForm(settings) {
  if (!settings) return;
  const total = currentQuestions().length || settings.lastQuestionNumber || 1;
  state.allQuestionsEnabled = settings.allQuestionsEnabled === true;
  state.unlimitedTimeEnabled = settings.unlimitedTimeEnabled === true;
  getElementById('input-count').value = String(settings.count || 30);
  getElementById('input-time-limit').value = String(Number.isInteger(settings.timeLimit) && settings.timeLimit >= 0 ? Math.min(1440, settings.timeLimit) : 35);
  getElementById('input-range-start').value = String(settings.firstQuestionNumber || 1);
  getElementById('input-range-end').value = String(settings.lastQuestionNumber > 0 ? Math.min(settings.lastQuestionNumber, total) : total);
  getElementById('checkbox-shuffle-questions').checked = !!settings.shuffleQuestionOrder;
  getElementById('checkbox-shuffle-answers').checked = !!settings.shuffleAnswerOrder;
  getElementById('checkbox-automatic-check').checked = settings.automaticAnswerChecking === true;
  getElementById('checkbox-automatic-advance').checked = settings.automaticQuestionAdvance === true;
  if (getElementById('input-auto-check-delay')) {
    const delay = Number.isInteger(settings.automaticAnswerCheckDelaySeconds) && settings.automaticAnswerCheckDelaySeconds >= 0 ? Math.min(10, settings.automaticAnswerCheckDelaySeconds) : 0;
    getElementById('input-auto-check-delay').value = String(delay);
    if (getElementById('label-auto-check-delay')) getElementById('label-auto-check-delay').textContent = delay + ' GIÂY';
  };
  getElementById('checkbox-vibration').checked = settings.vibrationEnabled === true;
  if (getElementById('input-auto-advance-delay')) {
    const delay = Number.isInteger(settings.automaticQuestionAdvanceDelaySeconds) && settings.automaticQuestionAdvanceDelaySeconds >= 0 ? Math.min(10, settings.automaticQuestionAdvanceDelaySeconds) : 5;
    getElementById('input-auto-advance-delay').value = String(delay);
    if (getElementById('label-auto-advance-delay')) getElementById('label-auto-advance-delay').textContent = delay + ' GIÂY';
  };
  const volume = normalizeSoundVolume(settings.soundVolumePercentage, 1);
  if (getElementById('input-sound-volume')) {
    getElementById('input-sound-volume').value = String(volume);
    getElementById('input-sound-volume').dataset.lastVolume = String(volume);
    if (getElementById('label-sound-volume')) getElementById('label-sound-volume').textContent = volume + '%';
  };
  if (getElementById('checkbox-sound')) getElementById('checkbox-sound').checked = settings.soundEnabled !== false && (settings.soundEnabled === true || (Number(settings.soundVolumePercentage) || 0) > 0);
  updateSetupExperienceControls();
  setPracticeMode(settings.studyMode === 'exam' ? 'exam' : 'practice');
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
  return currentQuestions().slice(form.firstQuestionNumber - 1, form.lastQuestionNumber);
};

function startSessionFromPool(pool, metadata) {
  const fromBank = !!metadata.fromBank;
  const form = readSetupForm();
  const shuffleAnswerOrder = metadata.shuffleAnswerOrder != null ? metadata.shuffleAnswerOrder : form.shuffleAnswerOrder;
  const shuffleQuestionOrder = metadata.forceShuffleQuestions != null ? metadata.forceShuffleQuestions : form.shuffleQuestionOrder;
  const shouldShuffleQuestions = metadata.alreadyShuffled ? false : !!shuffleQuestionOrder;
  const timeLimit = metadata.timeLimit != null ? metadata.timeLimit : form.timeLimit;
  const items = createSessionItems(pool, {
    shuffleQuestionOrder: shouldShuffleQuestions,
    shuffleAnswerOrder
  });
  const session = {
    deckId: state.currentDeck,
    questionDataFingerprint: state.fingerprints[state.currentDeck],
    mode: metadata.mode || 'normal',
    rangeStart: metadata.rangeStart ?? form.firstQuestionNumber,
    rangeEnd: metadata.rangeEnd ?? form.lastQuestionNumber,
    requestedCount: metadata.requestedCount ?? form.count,
    sequential: !!metadata.sequential,
    startCursor: metadata.startCursor ?? null,
    nextCursor: metadata.nextCursor ?? null,
    shuffleQuestionOrder,
    shuffleAnswerOrder,
    fromBank,
    pool: pool.map((questionText) => ({
      sourceQuestionIndex: questionText.sourceQuestionIndex,
      questionText: questionText.questionText,
      answerOptions: questionText.answerOptions.slice(),
      correctAnswerIndex: questionText.correctAnswerIndex
    })),
    items,
    viewIndex: 0,
    reviewingPast: false,
    maxReached: 0,
    completedInSession: 0,
    practiceInitialCount: metadata.mode === 'practice-wrong' ? pool.length : 0,
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
  const examRequested = metadata.examMode != null ? !!metadata.examMode : state.studyMode === 'exam';
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
  const completedSet = new Set(progress.completedQuestionIndices);
  const rangeStart = questions[0]?.sourceQuestionIndex ?? 0;
  const rangeEnd = questions.length ? questions[questions.length - 1].sourceQuestionIndex + 1 : 0;

  if (answerOptionsElement.restart) {
    const { items, nextCursor } = pickSequential(questions, 0, form.count, new Set());
    const globalNextCursor = nextCursor > 0 ? questions[Math.min(nextCursor, questions.length) - 1].sourceQuestionIndex + 1 : rangeStart;
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
    const nextQuestion = findNextUncompletedQuestion(questions, Math.max(progress.sequentialQuestionCursor, rangeStart), completedSet);
    if (!nextQuestion) {
      toast('Đã hoàn thành toàn bộ câu trong vùng đã chọn.');
      return;
    };
    const cursor = nextQuestion.sourceQuestionIndex;
    const scanQuestions = questions.filter((questionText) => questionText.sourceQuestionIndex >= cursor);
    const { items, nextCursor, actualCount } = pickSequential(scanQuestions, 0, form.count, completedSet);
    if (!items.length) {
      toast('Không còn câu tuần tự trong vùng đã chọn.');
      return;
    };
    if (actualCount < form.count) toast('Chỉ còn ' + actualCount + ' câu theo thứ tự trong vùng đã chọn.');
    const globalNextCursor = nextCursor > 0 ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1].sourceQuestionIndex + 1 : cursor;
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

  if (form.shuffleQuestionOrder) {
    const remainingCount = questions.filter((questionText) => !completedSet.has(questionText.sourceQuestionIndex)).length;
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

  const nextQuestion = findNextUncompletedQuestion(questions, Math.max(progress.sequentialQuestionCursor, rangeStart), completedSet);
  const cursor = nextQuestion?.sourceQuestionIndex ?? rangeEnd;
  const scanQuestions = questions.filter((questionText) => questionText.sourceQuestionIndex >= cursor);
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
  const globalNextCursor = nextCursor > 0 ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1].sourceQuestionIndex + 1 : cursor;
  startSessionFromPool(items, {
    mode: 'normal',
    sequential: true,
    startCursor: cursor,
    nextCursor: globalNextCursor,
    forceShuffleQuestions: false,
    alreadyShuffled: true
  });
};

function startPracticeWrong(answerOptions = {}) {
  const form = readSetupForm();
  persistSetupForm();
  const allDeck = answerOptions.allDeck === true;
  const questions = allDeck ? currentQuestions() : selectedQuestions(form);
  const rangeIndices = new Set(questions.map((questionText) => questionText.sourceQuestionIndex));
  const sourceIndices = Array.isArray(answerOptions.indices) ? answerOptions.indices : getWrongIndices(state.currentDeck);
  const wrongs = [...new Set(sourceIndices)].filter((index) => rangeIndices.has(index));
  if (!wrongs.length) {
    toast(allDeck ? 'Bộ đề này chưa có câu sai để ôn.' : 'Trong vùng câu hỏi đã chọn không có câu sai để ôn.');
    return;
  };
  const pool = pickWrong(questions, wrongs, allDeck ? wrongs.length : form.count, form.shuffleQuestionOrder);
  if (!pool.length) {
    toast('Không tìm thấy câu sai hợp lệ trong bộ đề đã chọn. Hãy tải lại bộ đề.');
    return;
  };
  const practiceSaveFailed = pool.some((questionText) => markPracticed(state.currentDeck, questionText.sourceQuestionIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê ôn lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-wrong',
    sequential: false,
    forceShuffleQuestions: form.shuffleQuestionOrder,
    alreadyShuffled: true,
    ...(allDeck ? {
      rangeStart: 1,
      rangeEnd: questions.length,
      requestedCount: pool.length,
    } : {})
  });
};

function recordWrongAnswer(session, sourceQuestionIndex) {
  if (markWrong(session.deckId, sourceQuestionIndex) === null) toast('Không thể lưu lịch sử câu sai vào trình duyệt.');
  if (Number.isInteger(session.rangeStart) && Number.isInteger(session.rangeEnd) && !addWrongIndicesForRange(session.deckId, session.rangeStart, session.rangeEnd, [sourceQuestionIndex])) toast('Không thể lưu câu sai riêng cho vùng câu hỏi này.');
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
  return session.pool[item.questionPoolIndex];
};

function renderQuestion() {
  const session = state.session;
  if (!session) return;
  const item = currentSessionItem();
  const questionText = currentQuestion();
  if (!item || !questionText) return;

  const viewingHistory = session.viewIndex < session.maxReached;

  getElementById('progress-label').textContent = 'CÂU ' + (session.viewIndex + 1) + ' / ' + session.items.length;
  const progressTotal = session.mode === 'practice-wrong' ? session.practiceInitialCount || session.items.length : session.items.length;
  getElementById('progress-score').textContent = 'ĐIỂM ' + formatScore(session.firstTryCorrect || 0, progressTotal) + ' / 10';
  updateTimerDisplay();
  const percentage = progressTotal ? Math.round((session.completedInSession / progressTotal) * 100) : 0;
  getElementById('progress-fill').style.width = percentage + '%';
  getElementById('progress-fill').parentElement.setAttribute('aria-valuenow', String(percentage));

  getElementById('question-badge').textContent = session.mode === 'practice-wrong' ? 'ÔN CÂU SAI · GỐC #' + (questionText.sourceQuestionIndex + 1) : session.mode === 'practice-bookmarks' ? 'ÔN CÂU ĐÁNH DẤU · GỐC #' + (questionText.sourceQuestionIndex + 1) : 'CÂU HỎI · GỐC #' + (questionText.sourceQuestionIndex + 1);
  const bookmarkButton = getElementById('button-bookmark');
  const isBookmarked = getBookmarkedIndices(session.deckId).includes(questionText.sourceQuestionIndex);
  bookmarkButton.classList.toggle('is-bookmarked', isBookmarked);
  bookmarkButton.setAttribute('aria-pressed', String(isBookmarked));
  setToggleIcon(bookmarkButton, isBookmarked, { on: 'bookmark-off', off: 'bookmark' });
  bookmarkButton.setAttribute('aria-label', isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu');
  bookmarkButton.title = isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu';
  const noteButton = getElementById('button-note');
  const existingNote = getQuestionNote(session.deckId, questionText.sourceQuestionIndex);
  const noteDisplay = getElementById('question-note-display');
  const noteTextEl = getElementById('question-note-text');
  const notePanel = getElementById('question-note-panel');
  const noteInput = getElementById('question-note-input');
  const noteWrap = getElementById('question-note-wrap');
  const editingNote = notePanel && !notePanel.hidden;
  if (noteButton) {
    noteButton.classList.toggle('has-note', !!existingNote);
    noteButton.setAttribute('aria-pressed', String(!!existingNote || editingNote));
    const noteEditorLabel = existingNote ? 'trình sửa ghi chú' : 'trình thêm ghi chú';
    noteButton.setAttribute('aria-label', editingNote ? 'Đóng ' + noteEditorLabel : 'Mở ' + noteEditorLabel);
    noteButton.title = editingNote ? 'Đóng ' + noteEditorLabel : 'Mở ' + noteEditorLabel;
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
  renderTextWithHighlights(getElementById('question-text'), questionText.questionText, session.deckId, questionText.sourceQuestionIndex, 'questionText');
  const highlightToolbar = getElementById('quiz-highlight-toolbar');
  if (highlightToolbar) highlightToolbar.hidden = session.examMode === true;
  if (noteButton) noteButton.hidden = session.examMode === true;

  const answerOptionsElement = getElementById('options');
  answerOptionsElement.replaceChildren();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  item.displayedAnswerOrder.forEach((origIdx, displayIdx) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer-option';
    button.setAttribute('aria-pressed', String(item.selectedAnswerIndex === displayIdx));
    button.dataset.display = String(displayIdx);

    if (item.selectedAnswerIndex === displayIdx) button.classList.add('selected');
    if (item.checked && item.status === 'correct' && displayIdx === item.selectedAnswerIndex) button.classList.add('correct', 'answer-bounce');
    if (item.checked && item.status === 'wrong' && displayIdx === item.selectedAnswerIndex) button.classList.add('incorrect', 'answer-shake');
    const incorrectAnswerIndices = Array.isArray(item.incorrectAnswerIndices) ? item.incorrectAnswerIndices : [];
    if (incorrectAnswerIndices.includes(origIdx)) {
      button.classList.add('incorrect', 'locked');
      button.disabled = true;
    };
    if (item.status === 'correct') {
      button.classList.add('locked');
      button.disabled = true;
      if (displayIdx === displayedCorrectIndex(item, questionText)) button.classList.add('correct');
    } else if (viewingHistory) {
      button.disabled = true;
      button.classList.add('locked');
    };

    const key = document.createElement('span');
    key.className = 'answer-option-key';
    key.textContent = labels[displayIdx] || String(displayIdx + 1);
    const text = document.createElement('span');
    text.className = 'answer-option-text';
    renderTextWithHighlights(text, questionText.answerOptions[origIdx], session.deckId, questionText.sourceQuestionIndex, 'option:' + origIdx);
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
    nextButton.textContent = 'CÂU TIẾP';
    nextButton.dataset.icon = 'chevron-right';
    nextButton.disabled = session.viewIndex >= session.maxReached;
  } else if (item.status === 'correct') {
    const isLastQuestion = session.viewIndex === session.items.length - 1;
    let shouldFinish = isLastQuestion && session.mode !== 'practice-wrong';
    if (isLastQuestion && session.mode === 'practice-wrong') {
      const unresolved = session.items.filter((entry) => entry.status !== 'correct');
      shouldFinish = unresolved.length === 0;
    };
    nextButton.textContent = shouldFinish ? 'KẾT THÚC' : 'CÂU TIẾP';
    nextButton.dataset.icon = shouldFinish ? 'check' : 'chevron-right';
    nextButton.disabled = false;
  } else if (session.mode === 'practice-wrong' && item.status === 'wrong' && item.checked) {
    nextButton.textContent = 'CÂU TIẾP';
    nextButton.dataset.icon = 'chevron-right';
    nextButton.disabled = false;
  } else {
    nextButton.textContent = 'KIỂM TRA';
    nextButton.dataset.icon = 'check';
    nextButton.disabled = item.selectedAnswerIndex == null || item.checked;
  };
};

function setPracticeMode(mode) {
  state.studyMode = mode === 'exam' ? 'exam' : 'practice';
  document.querySelectorAll('#screen-setup .mode-button').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === state.studyMode));
  const experienceCard = getElementById('practice-experience-card');
  if (experienceCard) experienceCard.hidden = state.studyMode === 'exam';
  const startBtn = getElementById('button-start');
  if (startBtn) startBtn.textContent = state.studyMode === 'exam' ? 'BẮT ĐẦU THI THỬ' : 'BẮT ĐẦU ÔN LUYỆN';
  persistSetupForm();
  if (state.mode === 'setup' && state.decks.quocphonganninh1) refreshSetupUI();
};

function updateExamProgressHeader() {
  const session = state.session;
  if (!session || !session.examMode) return;
  const answered = session.items.filter((item) => item.selectedAnswerIndex != null).length;
  const unanswered = session.items.length - answered;
  getElementById('exam-progress-label').textContent = session.reviewMode ? 'KẾT QUẢ · ' + (session.firstTryCorrect || 0) + ' / ' + session.items.length + ' CÂU ĐÚNG' : 'ĐÃ CHỌN ' + answered + ' / ' + session.items.length + ' CÂU';
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
    const nextEmptyLabel = unanswered ? 'Còn ' + unanswered + ' câu chưa chọn' : 'Đủ đáp án';
    nextEmpty.setAttribute('aria-label', nextEmptyLabel);
    nextEmpty.title = nextEmptyLabel;
  };
  const pauseBtn = getElementById('button-exam-pause');
  if (pauseBtn) pauseBtn.hidden = !!session.reviewMode;
  const examActionsRow = document.querySelector('.exam-actions-row');
  if (examActionsRow) examActionsRow.classList.toggle('is-reviewing', !!session.reviewMode);
  const submitBtn = getElementById('button-exam-submit');
  if (submitBtn) {
    if (session.reviewMode) {
      submitBtn.textContent = 'XEM TỔNG KẾT';
      submitBtn.dataset.icon = 'list-check';
      submitBtn.disabled = false;
    } else {
      submitBtn.textContent = 'NỘP BÀI';
      submitBtn.dataset.icon = 'check';
      submitBtn.disabled = !!state.examSubmitting;
    };
  };
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    const isActive = chip.dataset.filter === state.examFilter;
    chip.classList.toggle('is-active', isActive);
    const labels = {
      all: 'Tất cả câu hỏi',
      unanswered: 'Câu chưa chọn',
      answered: 'Câu đã chọn',
      correct: 'Câu đúng',
      wrong: 'Câu sai'
    };
    const label = labels[chip.dataset.filter] || 'Lọc câu hỏi';
    chip.setAttribute('aria-label', label);
    chip.title = label;
  });
};

function applyExamFilter() {
  const session = state.session;
  if (!session?.examMode) return;
  const filter = state.examFilter || 'all';
  session.items.forEach((item, index) => {
    const card = getElementById('exam-q-' + index);
    if (!card) return;
    let show = true;
    if (filter === 'unanswered') show = item.selectedAnswerIndex == null;
    else if (filter === 'answered') show = item.selectedAnswerIndex != null;
    else if (filter === 'wrong') show = item.status === 'wrong';
    else if (filter === 'correct') show = item.status === 'correct';
    card.hidden = !show;
  });
};

function scrollToExamQuestion(index) {
  const card = getElementById('exam-q-' + index);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function jumpToNextUnanswered(startingIndex = -1) {
  const session = state.session;
  if (!session?.examMode || session.reviewMode) return;
  const start = startingIndex + 1;
  let found = session.items.findIndex((item, itemIndex) => itemIndex >= start && item.selectedAnswerIndex == null);
  if (found < 0) found = session.items.findIndex((item) => item.selectedAnswerIndex == null);
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
    const questionText = session.pool[item.questionPoolIndex];
    const card = document.createElement('article');
    card.className = 'exam-question-card';
    card.id = 'exam-q-' + index;
    if (item.selectedAnswerIndex != null) card.classList.add('is-answered');
    if (session.reviewMode) {
      if (item.status === 'correct') card.classList.add('is-correct');
      else if (item.status === 'wrong') card.classList.add('is-wrong');
    };

    const head = document.createElement('div');
    head.className = 'exam-question-header';
    const questionNumberElement = document.createElement('span');
    questionNumberElement.className = 'exam-question-number';
    questionNumberElement.textContent = 'CÂU ' + (index + 1) + ' · GỐC #' + (questionText.sourceQuestionIndex + 1);
    head.appendChild(questionNumberElement);
    if (session.reviewMode) {
      const badge = document.createElement('span');
      badge.className = 'exam-status-badge ' + (item.status === 'correct' ? 'is-correct-answer' : item.status === 'unanswered' ? 'is-unanswered' : 'is-incorrect-answer');
      badge.textContent = item.status === 'correct' ? 'ĐÚNG' : item.status === 'unanswered' ? 'BỎ TRỐNG' : 'SAI';
      head.appendChild(badge);
    };
    card.appendChild(head);

    const text = document.createElement('h3');
    text.className = 'exam-question-text';
    text.textContent = questionText.questionText;
    card.appendChild(text);

    const answerOptionsElement = document.createElement('div');
    answerOptionsElement.className = 'exam-options answer-options';
    answerOptionsElement.setAttribute('role', 'group');
    answerOptionsElement.setAttribute('aria-label', 'Đáp án câu ' + (index + 1));

    item.displayedAnswerOrder.forEach((origIdx, displayIdx) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-option';
      button.dataset.q = String(index);
      button.dataset.display = String(displayIdx);
      button.setAttribute('aria-pressed', String(item.selectedAnswerIndex === displayIdx));
      if (item.selectedAnswerIndex === displayIdx) button.classList.add('selected');
      if (session.reviewMode) {
        button.disabled = true;
        const correctDisplay = item.displayedAnswerOrder.indexOf(questionText.correctAnswerIndex);
        if (displayIdx === correctDisplay) button.classList.add('correct');
        if (item.selectedAnswerIndex === displayIdx && item.status === 'wrong') button.classList.add('incorrect');
      };
      const label = document.createElement('span');
      label.className = 'answer-option-key';
      label.textContent = labels[displayIdx] || String(displayIdx + 1);
      const body = document.createElement('span');
      body.className = 'answer-option-text';
      body.textContent = questionText.answerOptions[origIdx];
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
    dot.title = 'CÂU ' + (index + 1);
    dot.dataset.index = String(index);
    if (item.selectedAnswerIndex != null) dot.classList.add('is-answered');
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
  card.classList.toggle('is-answered', item.selectedAnswerIndex != null);
  card.querySelectorAll('.answer-option').forEach((button) => {
    const displayIdx = Number(button.dataset.display);
    const selected = item.selectedAnswerIndex === displayIdx;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const dot = getElementById('exam-navigation')?.querySelector('.exam-question-navigation-dot[data-index="' + questionIndex + '"]');
  if (dot) dot.classList.toggle('is-answered', item.selectedAnswerIndex != null);
  updateExamProgressHeader();
  applyExamFilter();
};

function onExamSelect(questionIndex, displayIdx) {
  if (enforceSessionDeadline()) return;
  const session = state.session;
  if (!session || session.reviewMode || !session.examMode || state.examSubmitting) return;
  const item = session.items[questionIndex];
  if (!item) return;
  item.selectedAnswerIndex = displayIdx;
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
  const unanswered = session.items.filter((item) => item.selectedAnswerIndex == null).length;
  if (unanswered > 0) {
    const ok = await confirmModal('CÒN CÂU CHƯA CHỌN', 'Bạn còn ' + unanswered + ' câu chưa chọn đáp án. Vẫn nộp bài?');
    if (!ok) return;
  } else {
    const ok = await confirmModal('NỘP BÀI THI', 'Bạn đã chọn đủ ' + session.items.length + ' câu. Nộp bài để xem kết quả?');
    if (!ok) return;
  };

  if (enforceSessionDeadline() || state.session !== session || session.reviewMode) return;
  state.examSubmitting = true;
  updateExamProgressHeader();
  try {
    let firstTry = 0;
    let wrongAttempts = 0;
    for (const item of session.items) {
      const questionText = session.pool[item.questionPoolIndex];
      if (item.selectedAnswerIndex == null) {
        item.status = 'unanswered';
        item.checked = true;
        item.incorrectAttemptCount = 0;
        continue;
      };
      const correctAnswerIndex = isAnswerCorrect(item, questionText);
      item.checked = true;
      if (correctAnswerIndex) {
        item.status = 'correct';
        firstTry += 1;
      } else {
        item.status = 'wrong';
        item.incorrectAttemptCount = 1;
        wrongAttempts += 1;
        const wrongOriginalIndex = item.displayedAnswerOrder[item.selectedAnswerIndex];
        if (!item.incorrectAnswerIndices) item.incorrectAnswerIndices = [];
        if (!item.incorrectAnswerIndices.includes(wrongOriginalIndex)) item.incorrectAnswerIndices.push(wrongOriginalIndex);
      };
    };
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
    for (const item of session.items) {
      const questionText = session.pool[item.questionPoolIndex];
      item.checked = true;
      if (item.selectedAnswerIndex != null && isAnswerCorrect(item, questionText)) {
        item.status = 'correct';
        firstTry += 1;
      } else if (item.selectedAnswerIndex == null) {
        item.status = 'unanswered';
        item.incorrectAttemptCount = 0;
      } else {
        item.status = 'wrong';
        item.incorrectAttemptCount = Math.max(1, item.incorrectAttemptCount || 0);
        wrongAttempts += 1;
      };
    };
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
  const questionText = currentQuestion();
  if (!questionText || (Array.isArray(item.incorrectAnswerIndices) && item.incorrectAnswerIndices.includes(item.displayedAnswerOrder[displayIdx]))) return;

  item.selectedAnswerIndex = displayIdx;
  if (item.status === 'wrong') {
    item.checked = false;
    item.status = 'pending';
  };
  persistSession();
  renderQuestion();
  const preferences = sessionPreferences(session.deckId);
  if (!session.examMode && preferences.automaticAnswerChecking) {
    const delay = Number.isInteger(preferences.automaticAnswerCheckDelaySeconds) ? Math.min(10, Math.max(0, preferences.automaticAnswerCheckDelaySeconds)) : 0;
    if (delay === 0) onCheck();
    else setTimeout(() => {
      if (state.session === session && currentSessionItem() === item && item.selectedAnswerIndex === displayIdx && item.status !== 'correct') onCheck();
    }, delay * 1000);
  };
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
  const volumePct = Number.isInteger(preferences.soundVolumePercentage) && preferences.soundVolumePercentage > 0 ? Math.min(100, preferences.soundVolumePercentage) : 1;
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
  const questionText = currentQuestion();
  if (!session || !item || !questionText || item.selectedAnswerIndex == null) return;
  if (item.status === 'correct' || item.checked || session.viewIndex < session.maxReached) return;

  item.checked = true;
  if (!Array.isArray(item.incorrectAnswerIndices)) item.incorrectAnswerIndices = [];
  const isCorrect = isAnswerCorrect(item, questionText);
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
    const firstTime = item.incorrectAttemptCount === 0 && !wasAlreadyCorrect;
    item.status = 'correct';
    if (!wasAlreadyCorrect) {
      if (session.mode === 'practice-wrong') {
        if (!Array.isArray(session.practiceCompletedIndices)) session.practiceCompletedIndices = [];
        const sourceQuestionIndex = questionText.sourceQuestionIndex;
        if (!session.practiceCompletedIndices.includes(sourceQuestionIndex)) {
          session.practiceCompletedIndices.push(sourceQuestionIndex);
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
    const wrongOriginalIndex = item.displayedAnswerOrder[item.selectedAnswerIndex];
    if (!item.incorrectAnswerIndices.includes(wrongOriginalIndex)) item.incorrectAnswerIndices.push(wrongOriginalIndex);
    item.incorrectAttemptCount += 1;
    session.totalWrongAttempts += 1;
    if (session.mode === 'practice-wrong') {
      if (!Array.isArray(session.practiceWrongHistory)) session.practiceWrongHistory = [];
      const history = session.practiceWrongHistory.find((entry) => entry.sourceQuestionIndex === questionText.sourceQuestionIndex);
      if (history) history.incorrectAttemptCount += 1;
      else session.practiceWrongHistory.push({
        sourceQuestionIndex: questionText.sourceQuestionIndex,
        questionText: questionText.questionText,
        incorrectAttemptCount: 1
      });
    };
    recordWrongAnswer(session, questionText.sourceQuestionIndex);
  };
  persistSession();
  renderQuestion();
  if (!session.examMode && isCorrect && preferences.automaticQuestionAdvance === true && session.viewIndex < session.items.length - 1) {
    const delaySec = Number.isInteger(preferences.automaticQuestionAdvanceDelaySeconds) && preferences.automaticQuestionAdvanceDelaySeconds >= 0 ? Math.min(10, preferences.automaticQuestionAdvanceDelaySeconds) : 0;
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
        displayedAnswerOrder: entry.displayedAnswerOrder.slice(),
        selectedAnswerIndex: null,
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
  const ok = await confirmModal('TẠM DỪNG PHIÊN', isExam ? 'Bạn có thể tiếp tục bài thi sau từ thẻ phiên đang dở. Thời gian còn lại sẽ được giữ nguyên nếu có giới hạn thời gian.' : 'Bạn có thể tiếp tục ôn luyện sau từ thẻ phiên đang dở. Thời gian còn lại sẽ được giữ nguyên nếu có giới hạn thời gian.');
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

function formatScore(correctAnswerIndex, total) {
  if (!(total > 0)) return '0';
  const score = Math.round((Math.max(0, correctAnswerIndex) / total) * 100) / 10;
  return score.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
};

function animateScore(target, displayStr, circumference) {
  const summaryScoreElement = getElementById('summary-score-large');
  const ringFg = getElementById('score-ring-fg');
  if (!summaryScoreElement || !ringFg) return;

  const duration = 1100;
  const start = performance.now();

  let color = 'var(--primary)';
  if (target >= 8) color = 'var(--green)';
  else if (target >= 5) color = 'var(--warn)';
  else color = 'var(--red)';

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
    element.textContent = session.pausedAt && !session.finishedAt && !session.reviewMode ? 'TẠM DỪNG · ' + formatTime(elapsed) : 'HOÀN THÀNH · ' + formatTime(elapsed);
    element.classList.remove('time-warning');
  } else {
    element.textContent = hasLimit ? 'THỜI GIAN ' + formatTime(remaining) : 'THỜI GIAN ' + formatTime(elapsed);
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

  if (session.mode !== 'practice-wrong' && !session.examMode) {
    const completedIdx = session.items.filter((item) => item.status === 'correct').map((item) => session.pool[item.questionPoolIndex].sourceQuestionIndex);
    const progressSaved = addCompleted(session.deckId, completedIdx, state.fingerprints[session.deckId]);
    if (!progressSaved) toast('Không thể lưu tiến độ hoàn thành. Hãy kiểm tra dung lượng bộ nhớ trình duyệt.');
    else if (session.sequential && session.nextCursor != null && !setSequentialCursor(session.deckId, session.nextCursor, state.fingerprints[session.deckId])) toast('Không thể lưu vị trí tuần tự của bộ đề.');
  };

  const wrongInSession = [];
  const seen = new Set();
  if (session.mode === 'practice-wrong' && Array.isArray(session.practiceWrongHistory)) {
    for (const entry of session.practiceWrongHistory) {
      if (!seen.has(entry.sourceQuestionIndex)) {
        seen.add(entry.sourceQuestionIndex);
        wrongInSession.push({ ...entry });
      };
    };
  } else {
    for (const item of session.items) {
      if (session.examMode && item.selectedAnswerIndex == null) continue;
      if (item.incorrectAttemptCount > 0) {
        const sourceQuestionIndex = session.pool[item.questionPoolIndex].sourceQuestionIndex;
        if (!seen.has(sourceQuestionIndex)) {
          seen.add(sourceQuestionIndex);
          wrongInSession.push({
            sourceQuestionIndex: sourceQuestionIndex,
            questionText: session.pool[item.questionPoolIndex].questionText,
            incorrectAttemptCount: item.incorrectAttemptCount
          });
        };
      };
    };
  };

  const scoreTotal = session.mode === 'practice-wrong' ? session.practiceInitialCount || session.items.length : session.items.length;
  const unansweredQuestions = session.examMode
    ? session.items.filter((item) => item.selectedAnswerIndex == null).length
    : 0;
  session.summary = {
    total: scoreTotal,
    score: formatScore(session.firstTryCorrect || 0, scoreTotal),
    elapsedSeconds: getElapsedSeconds(session),
    timeExpired: !!session.timeExpired,
    correctAnswerIndex: session.firstTryCorrect || 0,
    wrongQuestions: wrongInSession.length,
    wrongAttempts: session.examMode ? 0 : session.totalWrongAttempts,
    unansweredQuestions,
    practiceQuestions: session.mode === 'practice-wrong' ? session.practiceInitialCount || session.items.length : 0,
    firstTryRate: (session.mode === 'practice-wrong' ? session.practiceInitialCount : session.items.length) ? Math.round((session.firstTryCorrect / (session.mode === 'practice-wrong' ? session.practiceInitialCount : session.items.length)) * 100) : 0,
    wrongList: wrongInSession,
    sequential: session.sequential,
    nextCursor: session.nextCursor,
    mode: session.mode
  };

  if (!session.examMode && Number.isInteger(session.rangeStart) && Number.isInteger(session.rangeEnd) && wrongInSession.length) {
    if (!addWrongIndicesForRange(session.deckId, session.rangeStart, session.rangeEnd, wrongInSession.map((entry) => entry.sourceQuestionIndex))) toast('Không thể lưu câu sai riêng cho vùng câu hỏi này.');
  };
  state._lastSummarySession = {
    deckId: session.deckId,
    mode: session.examMode || session.mode === 'exam' ? 'exam' : 'practice',
    sourceMode: session.mode,
    indices: [...new Set(session.pool.map((questionText) => questionText.sourceQuestionIndex))],
    rangeStart: Number.isInteger(session.rangeStart) ? session.rangeStart : 1,
    rangeEnd: Number.isInteger(session.rangeEnd) ? session.rangeEnd : (state.decks[session.deckId] || []).length,
    requestedCount: session.items.length,
    timeLimit: Number.isInteger(session.timeLimit) ? session.timeLimit : 0
  };
  state._lastSummaryWrongIndices = wrongInSession.map((entry) => entry.sourceQuestionIndex);
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
  const isExamResult = mode === 'exam';
  getElementById('summary-title').textContent = mode === 'practice-wrong' ? 'KẾT THÚC ÔN CÂU SAI' : mode === 'practice-bookmarks' ? 'KẾT THÚC ÔN CÂU ĐÁNH DẤU' : isExamResult ? 'KẾT QUẢ THI THỬ' : 'KẾT THÚC ÔN LUYỆN';
  const scoreVal = summary.score ?? formatScore(summary.correctAnswerIndex, summary.total);
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
  getElementById('summary-correct').textContent = String(summary.correctAnswerIndex);
  getElementById('summary-wrong-question-count').textContent = String(summary.wrongQuestions);
  const answeredCount = isExamResult
    ? summary.total - (summary.unansweredQuestions || 0)
    : summary.total;
  const accuracy = answeredCount > 0 ? Math.round((summary.correctAnswerIndex / answeredCount) * 100) : 0;
  getElementById('summary-unanswered').textContent = String(summary.unansweredQuestions || 0);
  getElementById('summary-accuracy').textContent = accuracy + '%';
  getElementById('summary-wrong-attempt-count').textContent = String(summary.wrongAttempts || 0);
  getElementById('summary-first-try-rate').textContent = summary.firstTryRate + '%';
  const summaryCorrectLabel = getElementById('summary-correct-label');
  if (summaryCorrectLabel) summaryCorrectLabel.textContent = isExamResult ? 'SỐ CÂU ĐÚNG' : 'SỐ CÂU ĐÚNG NGAY LẦN ĐẦU';
  const summaryUnansweredRow = getElementById('summary-unanswered-row');
  if (summaryUnansweredRow) summaryUnansweredRow.hidden = !isExamResult;
  const summaryAccuracyRow = getElementById('summary-accuracy-row');
  if (summaryAccuracyRow) summaryAccuracyRow.hidden = !isExamResult;
  const summaryWrongAttemptRow = getElementById('summary-wrong-attempt-row');
  if (summaryWrongAttemptRow) summaryWrongAttemptRow.hidden = isExamResult;
  const summaryFirstTryRateRow = getElementById('summary-first-try-rate-row');
  if (summaryFirstTryRateRow) summaryFirstTryRateRow.hidden = isExamResult;

  const totalQuestions = (state.decks[deckId] || []).length;
  const progressAfterSession = getDeckProgress(deckId);
  const completedAfterSession = new Set(progressAfterSession.completedQuestionIndices).size;
  getElementById('summary-note').textContent = summary.timeExpired
    ? 'Đã hết giờ. Bài làm được tự động kết thúc.'
    : isExamResult
      ? 'Đây là kết quả riêng của lượt thi thử; không thay đổi tiến độ ôn luyện bộ đề.'
      : completedAfterSession >= totalQuestions
        ? 'Bạn đã hoàn thành toàn bộ bộ đề ' + DECKS[deckId].label + '.'
        : summary.wrongQuestions === 0
          ? 'Xuất sắc! Bạn không mắc lỗi nào trong lượt này.'
          : 'Bạn có thể ôn lại các câu sai hoặc tiếp tục với những câu chưa hoàn thành.';

  const listCard = getElementById('wrong-list-card');
  const list = getElementById('wrong-list');
  list.replaceChildren();
  if (summary.wrongList.length) {
    listCard.hidden = false;
    for (const wrongQuestion of summary.wrongList) {
      const listItemElement = document.createElement('li');
      const index = document.createElement('span');
      index.className = 'question-index';
      index.textContent = '#' + (wrongQuestion.sourceQuestionIndex + 1);
      listItemElement.append(index, document.createTextNode(wrongQuestion.questionText));
      list.appendChild(listItemElement);
    };
  } else {
    listCard.hidden = true;
  };

  state.currentDeck = deckId;
  const retryButton = getElementById('button-summary-retry-session');
  retryButton.hidden = !['normal', 'exam'].includes(mode);
  retryButton.textContent = mode === 'exam' ? 'THI LẠI LƯỢT THI NÀY' : 'ÔN LẠI LƯỢT ÔN NÀY';

  const btnPractice = getElementById('button-summary-practice');
  const sessionWrong = [...new Set(summary.wrongList.map((entry) => entry.sourceQuestionIndex))];
  state._lastSummaryWrongIndices = sessionWrong;
  btnPractice.hidden = isExamResult || sessionWrong.length === 0;
  btnPractice.textContent ='ÔN LẠI ' + sessionWrong.length + ' CÂU SAI TRONG LƯỢT NÀY';

  const progress = getDeckProgress(deckId);
  const continueButton = getElementById('button-summary-continue');
  const form = readSetupForm();
  const rangeEnd = form.lastQuestionNumber;
  const nextIndex = Math.max(progress.sequentialQuestionCursor, form.firstQuestionNumber - 1);
  const canSeq = summary.sequential && nextIndex < rangeEnd;
  continueButton.hidden = isExamResult || !canSeq;
  if (canSeq) {
    const left = rangeEnd - nextIndex;
    const settings = getSettings(deckId);
    const availableQuestionCount = Math.min(settings.allQuestionsEnabled ? left : (settings.count || 20), left);
    continueButton.textContent = 'TIẾP TỤC TUẦN TỰ ' + availableQuestionCount + ' CÂU TRONG VÙNG';
  };

  state._lastSummaryDeck = deckId;
  getElementById('button-summary-random').hidden = isExamResult;
  getElementById('button-summary-restart').hidden = isExamResult;
  getElementById('button-summary-again').textContent = isExamResult ? 'THI THỬ LƯỢT MỚI' : 'THIẾT LẬP LƯỢT ÔN MỚI';
};

function restoreSessionIfAny() {
  const saved = getSession(state.currentDeck);
  if (!saved) return false;
  if (!['quocphonganninh1', 'quocphonganninh2'].includes(saved.deckId) || !Array.isArray(saved.items) || !Array.isArray(saved.pool)) {
    clearSession(state.currentDeck);
    return false;
  };
  saved.items = saved.items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const { poolIdx: legacyPoolIndex, ...sessionItem } = item;
    return {
      ...sessionItem,
      questionPoolIndex: Number.isInteger(item.questionPoolIndex) ? item.questionPoolIndex : legacyPoolIndex
    };
  });
  if (!state.decks[saved.deckId]) {
    clearSession(state.currentDeck);
    return false;
  };
  const fingerprint = state.fingerprints[saved.deckId];
  const legacyCompatible = !saved.questionDataFingerprint && state.legacyFingerprintMatched[saved.deckId];
  const validPool = saved.pool.length > 0 && saved.pool.every((questionText) => questionText && Number.isInteger(questionText.sourceQuestionIndex) && questionText.sourceQuestionIndex >= 0 && typeof questionText.questionText === 'string' && Array.isArray(questionText.answerOptions) && questionText.answerOptions.length >= 2 && Number.isInteger(questionText.correctAnswerIndex) && questionText.correctAnswerIndex >= 0 && questionText.correctAnswerIndex < questionText.answerOptions.length);
  const poolMatchesCurrentData = saved.pool.every((questionText) => {
    const current = state.decks[saved.deckId][questionText.sourceQuestionIndex];
    return (current && current.questionText === questionText.questionText && current.correctAnswerIndex === questionText.correctAnswerIndex && JSON.stringify(current.answerOptions) === JSON.stringify(questionText.answerOptions));
  });
  const legacyPoolCompatible = !legacyCompatible || poolMatchesCurrentData;
  const validSession = validPool && poolMatchesCurrentData && legacyPoolCompatible && saved.items.length > 0 && Number.isInteger(saved.viewIndex) && saved.viewIndex >= 0 && saved.viewIndex < saved.items.length && Number.isInteger(saved.maxReached) && saved.maxReached >= 0 && saved.maxReached < saved.items.length && saved.viewIndex <= saved.maxReached && saved.items.every((item, index) => {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.questionPoolIndex) || item.questionPoolIndex < 0 || item.questionPoolIndex >= saved.pool.length) return false;
    const questionText = saved.pool[item.questionPoolIndex];
    return (Array.isArray(item.displayedAnswerOrder) && item.displayedAnswerOrder.length === questionText.answerOptions.length && (item.incorrectAnswerIndices == null || (Array.isArray(item.incorrectAnswerIndices) && item.incorrectAnswerIndices.every((value) => Number.isInteger(value) && value >= 0 && value < questionText.answerOptions.length))) && new Set(item.displayedAnswerOrder).size === questionText.answerOptions.length && item.displayedAnswerOrder.every((index) => Number.isInteger(index) && index >= 0 && index < questionText.answerOptions.length) && ['pending', 'wrong', 'correct', 'unanswered'].includes(item.status) && (index >= saved.maxReached || item.status === 'correct' || saved.mode === 'practice-wrong') && (item.selectedAnswerIndex == null || (Number.isInteger(item.selectedAnswerIndex) && item.selectedAnswerIndex >= 0 && item.selectedAnswerIndex < item.displayedAnswerOrder.length)) && Number.isInteger(item.incorrectAttemptCount) && item.incorrectAttemptCount >= 0);
  });
  if (!validSession || (saved.questionDataFingerprint !== fingerprint && !legacyCompatible)) {
    clearSession(state.currentDeck);
    return false;
  };
  if (legacyCompatible) saved.questionDataFingerprint = fingerprint;
  const progress = getDeckProgress(saved.deckId);
  if (progress.questionDataFingerprint && progress.questionDataFingerprint !== fingerprint && !legacyCompatible) {
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
  saved.practiceWrongHistory = Array.isArray(saved.practiceWrongHistory) ? saved.practiceWrongHistory.filter((entry) => entry && Number.isInteger(entry.sourceQuestionIndex) && entry.sourceQuestionIndex >= 0 && typeof entry.questionText === 'string' && Number.isInteger(entry.incorrectAttemptCount) && entry.incorrectAttemptCount > 0) : [];
  for (const item of saved.items) {
    if (!Array.isArray(item.incorrectAnswerIndices)) item.incorrectAnswerIndices = [];
  };
  saved.completedInSession = saved.mode === 'practice-wrong' ? saved.practiceCompletedIndices.length : saved.items.filter((item) => item.status === 'correct').length;
  saved.totalWrongAttempts = Math.max(Number.isInteger(saved.totalWrongAttempts) ? saved.totalWrongAttempts : 0, saved.items.reduce((sum, item) => sum + Math.max(0, Number(item.incorrectAttemptCount) || 0), 0));
  saved.firstTryCorrect = Number.isInteger(saved.firstTryCorrect) ? saved.firstTryCorrect : saved.items.filter((item) => item.status === 'correct' && item.incorrectAttemptCount === 0).length;
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
    const questionText = currentQuestion();
    const session = state.session;
    const selection = state.lastTextSelection;
    if (!questionText || !session || session.examMode || !selection || selection.questionIndex !== questionText.sourceQuestionIndex || selection.deckId !== session.deckId) {
      toast('Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.');
      return;
    };
    toggleHighlightSelection(selection.deckId, questionText.sourceQuestionIndex, selection);
  });
  const active = getSettings();
  state.currentDeck = active.deck === 'quocphonganninh2' ? 'quocphonganninh2' : 'quocphonganninh1';
  const settings = getSettings(state.currentDeck);
  applySettingsToForm(settings);
  state.bankDeck = state.currentDeck;
  
  showScreen('setup');
  refreshSetupUI();
};

function applyTheme(theme) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selectedTheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = selectedTheme === 'light' ? '#f2efe7' : '#131210';
  const button = getElementById('button-theme-toggle');
  if (button) {
    button.dataset.icon = selectedTheme === 'dark' ? 'sun' : 'moon';
    button.setAttribute('aria-label', selectedTheme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
    button.title = selectedTheme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối';
    button.setAttribute('aria-pressed', String(selectedTheme === 'light'));
  };
  try { localStorage.setItem('quocphonganninh:theme', selectedTheme); } catch {};
};

function initializeTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('quocphonganninh:theme') || 'dark'; } catch {};
  applyTheme(theme);
  getElementById('button-theme-toggle')?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
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
      const nextDeck = button.dataset.deck === 'quocphonganninh2' ? 'quocphonganninh2' : 'quocphonganninh1';
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
      settings.lastQuestionNumber = getEndQuestionForDeckSwitch(previousEnd, previousTotal, currentTotal);
      if (settings.allQuestionsEnabled || countWasMaximum) {
        const newStart = settings.firstQuestionNumber || 1;
        const newEnd = settings.lastQuestionNumber > 0 ? Math.min(settings.lastQuestionNumber, currentTotal) : currentTotal;
        settings.count = Math.max(1, newEnd - newStart + 1);
      };
      applySettingsToForm(settings);
      refreshSetupUI();
      persistSetupForm();
    });
  });

  getElementById('button-select-all').addEventListener('click', () => {
    state.allQuestionsEnabled = !state.allQuestionsEnabled;
    persistSetupForm();
    refreshSetupUI();
  });

  getElementById('button-unlimited-time')?.addEventListener('click', () => {
    const timeInput = getElementById('input-time-limit');
    if (!timeInput) return;
    state.unlimitedTimeEnabled = !state.unlimitedTimeEnabled;
    persistSetupForm();
    refreshSetupUI();
  });

  document.querySelectorAll('.preset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const form = readSetupForm();
      const max = Math.max(1, form.lastQuestionNumber - form.firstQuestionNumber + 1);
      const presetQuestionCount = Math.min(Number(button.dataset.count) || 20, max);
      getElementById('input-count').value = String(presetQuestionCount);
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
    const rangeTotal = Math.max(1, form.lastQuestionNumber - form.firstQuestionNumber + 1);
    const isAllCount = state.allQuestionsEnabled;
    const selectAllButton = getElementById('button-select-all');
    if (selectAllButton) {
      selectAllButton.classList.toggle('is-active', isAllCount);
      selectAllButton.setAttribute('aria-pressed', isAllCount ? 'true' : 'false');
      setToggleIcon(selectAllButton, isAllCount, { on: 'deselect', off: 'select-all' });
      selectAllButton.title = isAllCount ? 'Bỏ chọn toàn bộ vùng' : 'Chọn toàn bộ vùng';
      selectAllButton.setAttribute('aria-label', selectAllButton.title);
    };
  };
  getElementById('input-count').addEventListener('input', () => {
    const form = readSetupForm();
    const rangeTotal = Math.max(1, form.lastQuestionNumber - form.firstQuestionNumber + 1);
    const count = Number.parseInt(getElementById('input-count').value, 10);
    updateCountButtonState();
    persistSetupForm();
  });
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
    const isUnlimited = state.unlimitedTimeEnabled;
    const unlimitedTimeButton = getElementById('button-unlimited-time');
    if (unlimitedTimeButton) {
      unlimitedTimeButton.classList.toggle('is-active', isUnlimited);
      unlimitedTimeButton.setAttribute('aria-pressed', isUnlimited ? 'true' : 'false');
      setToggleIcon(unlimitedTimeButton, isUnlimited, { on: 'infinity-off', off: 'infinity' });
      unlimitedTimeButton.title = isUnlimited ? 'Tắt không giới hạn thời gian' : 'Bật không giới hạn thời gian';
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

  getElementById('checkbox-automatic-check')?.addEventListener('change', () => {
    updateSetupExperienceControls();
    persistSetupForm();
  });
  getElementById('button-auto-check')?.addEventListener('click', () => {
    const checkbox = getElementById('checkbox-automatic-check');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  getElementById('checkbox-vibration')?.addEventListener('change', persistSetupForm);
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
  getElementById('input-count')?.addEventListener('input', persistSetupForm);
  getElementById('input-count')?.addEventListener('change', persistSetupForm);
  getElementById('input-time-limit')?.addEventListener('input', persistSetupForm);
  getElementById('input-time-limit')?.addEventListener('change', persistSetupForm);
  getElementById('input-auto-advance-delay')?.addEventListener('input', () => {
    const delay = Number.parseInt(getElementById('input-auto-advance-delay').value, 10) || 0;
    if (getElementById('label-auto-advance-delay')) getElementById('label-auto-advance-delay').textContent = delay + ' GIÂY';
    persistSetupForm();
  });
  getElementById('input-auto-advance-delay')?.addEventListener('change', persistSetupForm);
  getElementById('input-auto-check-delay')?.addEventListener('input', () => {
    const delay = Number.parseInt(getElementById('input-auto-check-delay').value, 10) || 0;
    if (getElementById('label-auto-check-delay')) getElementById('label-auto-check-delay').textContent = delay + ' GIÂY';
    persistSetupForm();
  });
  getElementById('input-auto-check-delay')?.addEventListener('change', persistSetupForm);
  getElementById('input-sound-volume')?.addEventListener('input', () => {
    syncSoundFromVolume('input-sound-volume', 'checkbox-sound', 'label-sound-volume');
    persistSetupForm();
  });
  getElementById('input-sound-volume')?.addEventListener('change', () => {
    syncSoundFromVolume('input-sound-volume', 'checkbox-sound', 'label-sound-volume');
    persistSetupForm();
  });

  document.querySelectorAll('#screen-setup .mode-button').forEach((button) => button.addEventListener('click', () => setPracticeMode(button.dataset.mode)));
  
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
    const questionNumber = Number.parseInt(getElementById('input-review-goto').value, 10);
    const total = bankQuestions().length;
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > total) {
      toast('Nhập số câu từ 1 đến ' + total + '.');
      return;
    };
    if (!scrollReviewToQuestionNumber(questionNumber)) toast('Không tìm thấy câu ' + questionNumber + ' trong danh sách hiện tại.');
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
  getElementById('button-clear-practice-wrong')?.addEventListener('click', async () => {
    const form = readSetupForm();
    const indices = selectedQuestions(form).map((questionText) => questionText.sourceQuestionIndex);
    const ok = await confirmModal('XÓA TOÀN BỘ CÂU SAI TRONG VÙNG', 'Lịch sử sai của toàn bộ câu trong vùng hiện tại sẽ bị xóa.');
    if (!ok) return;
    if (!clearWrongAnswers(state.currentDeck, indices)) {
      toast('Không thể xóa toàn bộ câu sai trong vùng.');
      return;
    };
    refreshSetupUI();
    toast('Đã xóa toàn bộ câu sai trong vùng.');
  });
  getElementById('button-clear-all-wrong')?.addEventListener('click', async () => {
    const ok = await confirmModal('XÓA TOÀN BỘ CÂU SAI CỦA BỘ ĐỀ', 'Toàn bộ lịch sử câu sai của bộ đề sẽ bị xóa.');
    if (!ok) return;
    if (!clearWrongAnswers(state.currentDeck)) {
      toast('Không thể xóa toàn bộ câu sai của bộ đề.');
      return;
    };
    refreshSetupUI();
    toast('Đã xóa toàn bộ câu sai của bộ đề.');
  });
  getElementById('button-clear-bookmarks')?.addEventListener('click', async () => {
    const ok = await confirmModal('XÓA TOÀN BỘ CÂU ĐÃ ĐÁNH DẤU?', 'Toàn bộ câu hỏi đã đánh dấu của bộ đề sẽ bị xóa.');
    if (!ok) return;
    if (!clearBookmarks(state.currentDeck)) {
      toast('Không thể xóa toàn bộ câu đã đánh dấu.');
      return;
    };
    refreshSetupUI();
    toast('Đã xóa toàn bộ câu đã đánh dấu.');
  });

  getElementById('button-exam-submit')?.addEventListener('click', () => onExamSubmit());
  getElementById('button-exam-pause')?.addEventListener('click', () => pauseSession());
  getElementById('button-quiz-pause')?.addEventListener('click', () => pauseSession());
  getElementById('button-resume-session')?.addEventListener('click', () => {
    if (!restoreSessionIfAny()) toast('Không còn phiên để tiếp tục.');
    else refreshSetupUI();
  });
  getElementById('button-discard-session')?.addEventListener('click', async () => {
    const ok = await confirmModal('XÓA PHIÊN ĐANG DỞ?', 'Phiên làm bài hiện tại sẽ bị xóa. Tiến độ bộ đề đã lưu vẫn giữ nguyên.');
    if (!ok) return;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    refreshResumeCard();
    toast('Đã bỏ phiên đang dở.');
  });
  getElementById('button-exam-quit')?.addEventListener('click', async () => {
    const session = state.session;
    const reviewing = session?.reviewMode;
    const ok = await confirmModal(reviewing ? 'XÓA KẾT QUẢ THI?' : 'XÓA BÀI THI?', reviewing ? 'Bạn sẽ quay về màn hình thiết lập. Kết quả lần thi này không lưu lại phiên đang mở.' : 'Phiên thi hiện tại sẽ bị đóng. Tiến độ bộ đề vẫn được giữ nếu bạn đã nộp bài.');
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
    const questionText = currentQuestion();
    const session = state.session;
    if (!questionText || !session) return;
    const result = toggleBookmark(session.deckId, questionText.sourceQuestionIndex);
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
      noteButton.setAttribute('aria-label', has ? 'Mở trình sửa ghi chú' : 'Mở trình thêm ghi chú');
      noteButton.title = has ? 'Mở trình sửa ghi chú' : 'Mở trình thêm ghi chú';
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
    const questionText = currentQuestion();
    const session = state.session;
    if (!questionText || !session || !notePanel || !noteInput) return;
    const note = getQuestionNote(session.deckId, questionText.sourceQuestionIndex);
    noteInput.value = note;
    if (noteDisplay) noteDisplay.hidden = true;
    notePanel.hidden = false;
    const label = note ? 'Đóng trình sửa ghi chú' : 'Đóng trình thêm ghi chú';
    noteButton?.setAttribute('aria-label', label);
    if (noteButton) noteButton.title = label;
    noteInput.focus();
  };

  function closeNoteEditor(refresh) {
    if (notePanel) notePanel.hidden = true;
    if (refresh !== false) {
      const questionText = currentQuestion();
      const session = state.session;
      const note = questionText && session ? getQuestionNote(session.deckId, questionText.sourceQuestionIndex) : '';
      syncQuizNoteUI(note);
    };
  };

  noteButton?.addEventListener('click', () => {
    if (!notePanel) return;
    if (notePanel.hidden) openNoteEditor();
    else closeNoteEditor();
  });

  getElementById('button-note-save')?.addEventListener('click', () => {
    const questionText = currentQuestion();
    const session = state.session;
    if (!questionText || !session || !noteInput) return;
    const ok = saveQuestionNote(session.deckId, questionText.sourceQuestionIndex, noteInput.value);
    if (!ok) {
      toast('Không thể lưu ghi chú. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    const note = getQuestionNote(session.deckId, questionText.sourceQuestionIndex);
    syncQuizNoteUI(note);
    toast(note ? 'Đã lưu ghi chú.' : 'Đã xóa ghi chú.');
  });

  getElementById('button-note-delete')?.addEventListener('click', () => {
    const questionText = currentQuestion();
    const session = state.session;
    if (!questionText || !session) return;
    const ok = saveQuestionNote(session.deckId, questionText.sourceQuestionIndex, '');
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
  getElementById('button-prev').setAttribute('aria-label', 'Câu trước');
  getElementById('button-prev').title = 'Câu trước';
  getElementById('button-prev').addEventListener('click', onPrev);

  getElementById('button-quit').addEventListener('click', async () => {
    const ok = await confirmModal('XÓA PHIÊN ÔN', 'Phiên ôn hiện tại sẽ bị đóng. Tiến độ các lượt đã hoàn thành và lịch sử câu sai vẫn được giữ trên trình duyệt.');
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
    const byIndex = new Map(currentQuestions().map((questionText) => [questionText.sourceQuestionIndex, questionText]));
    const pool = previous.indices.map((index) => byIndex.get(index)).filter(Boolean);
    if (!pool.length) {
      toast('Không còn câu hỏi phù hợp để làm lại.');
      return;
    };
    getElementById('input-range-start').value = String(previous.rangeStart);
    getElementById('input-range-end').value = String(previous.rangeEnd);
    getElementById('input-count').value = String(pool.length);
    getElementById('input-time-limit').value = String(previous.timeLimit);
    state.allQuestionsEnabled = false;
    state.unlimitedTimeEnabled = false;
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
    progress.completedQuestionIndices = [];
    progress.sequentialQuestionCursor = 0;
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
};

function initializeInterfaceEnhancements() {
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = '#131210';

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
  };

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
  };

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
};

function boot() {
  initializeInterfaceEnhancements();
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