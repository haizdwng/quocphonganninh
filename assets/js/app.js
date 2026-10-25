import {
  getSettings,
  saveSettings,
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
  saveQuestionHighlights
} from './storage.js';
import {
  fingerprintQuestions,
  normalizeQuestions,
  createSessionItems,
  pickSequential,
  findNextUncompletedQuestion,
  pickRandom,
  pickWrong,
  isAnswerCorrect,
  displayedCorrectIndex
} from './quiz.js';

const DECKS = {
  quocphong1: { id: 'quocphong1', label: 'Quốc Phòng 1', file: 'data/quocphong1.json' },
  quocphong2: { id: 'quocphong2', label: 'Quốc Phòng 2', file: 'data/quocphong2.json' }
};

const state = {
  decks: { quocphong1: null, quocphong2: null },
  fingerprints: { quocphong1: '', quocphong2: '' },
  legacyFingerprintMatched: { quocphong1: false, quocphong2: false },
  loading: true,
  error: null,
  currentDeck: 'quocphong1',
  mode: 'setup',
  practiceMode: 'practice',
  session: null,
  reviewMode: false,
  searchResults: [],
  timerInterval: null,
  examFilter: 'all',
  examSubmitting: false,
  reviewSearch: '',
  reviewSelectMode: false,
  reviewSelectedIndices: new Set(),
  _lastSummarySession: null,
  _lastSummaryWrongIndices: [],
  _lastSummaryRangeStart: null,
  _lastSummaryRangeEnd: null,
  _lastSummaryCount: null,
  highlightEditMode: false,
  lastTextSelection: null,
  pendingHighlights: {}
};

const $ = (id) => document.getElementById(id);

function dataUrl(rel) {
  return new URL(rel, document.baseURI).href;
};

async function loadDeck(id) {
  const meta = DECKS[id];
  const url = dataUrl(meta.file);
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new Error(`Không thể tải ${meta.label}. Hãy kiểm tra kết nối mạng hoặc mở trang trực tuyến ít nhất một lần để lưu dữ liệu ngoại tuyến.`);
  };
  if (!res.ok) throw new Error(`Không tải được ${meta.label} (${res.status}). Hãy kiểm tra vị trí tệp dữ liệu.`);
  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new Error(`Tệp dữ liệu ${meta.file} không hợp lệ.`);
  };
  const questions = normalizeQuestions(raw);
  const fp = fingerprintQuestions(questions);
  state.decks[id] = questions;
  state.fingerprints[id] = fp;
  const progress = getDeckProgress(id);
  const first = questions[0]?.question?.trim().slice(0, 40) || '';
  const last = questions[questions.length - 1]?.question?.trim().slice(0, 40) || '';
  const legacyFingerprint = `${questions.length}|${first}|${last}`;
  if (progress.dataFingerprint && progress.dataFingerprint !== fp) {
    if (progress.dataFingerprint === legacyFingerprint) {
      state.legacyFingerprintMatched[id] = true;
      progress.dataFingerprint = fp;
      if (!saveDeckProgress(id, progress)) toast('Không thể cập nhật phiên bản tiến độ trong trình duyệt.');
    } else {
      progress.completed = [];
      progress.sequentialCursor = 0;
      progress.wrongMap = {};
      progress.wrongRangeMap = {};
      progress.practiceMap = {};
      progress.bookmarks = [];
      progress.dataFingerprint = fp;
      if (!saveDeckProgress(id, progress)) toast('Không thể lưu tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.');
    };
  } else if (!progress.dataFingerprint) {
    progress.dataFingerprint = fp;
    if (!saveDeckProgress(id, progress)) toast('Không thể lưu dấu vân tay bộ đề vào trình duyệt.');
  };

  const progressBeforeSanitize = JSON.stringify(progress);
  const isValidIndex = (index) => Number.isInteger(index) && index >= 0 && index < questions.length;
  progress.completed = progress.completed.filter(isValidIndex);
  progress.bookmarks = progress.bookmarks.filter(isValidIndex);
  progress.sequentialCursor = Math.min(progress.sequentialCursor, questions.length);
  progress.wrongMap = Object.fromEntries(Object.entries(progress.wrongMap)
    .filter(([key, count]) => isValidIndex(Number(key)) && Number.isInteger(count) && count > 0));
  progress.practiceMap = Object.fromEntries(Object.entries(progress.practiceMap)
    .filter(([key, count]) => isValidIndex(Number(key)) && Number.isInteger(count) && count > 0));
  if (JSON.stringify(progress) !== progressBeforeSanitize && !saveDeckProgress(id, progress)) {
    toast('Không thể làm sạch tiến độ cũ trong trình duyệt.');
  };
  return questions;
};

async function loadAll() {
  state.loading = true;
  state.error = null;
  showScreen('loading');
  try {
    await Promise.all([loadDeck('quocphong1'), loadDeck('quocphong2')]);
    state.loading = false;
    initUI();
  } catch (e) {
    state.loading = false;
    state.error = e.message || String(e);
    showScreen('error');
    const errorMessage = $('error-message');
    const details = state.error + '\n\nNếu bạn đang ngoại tuyến lần đầu, hãy kết nối mạng để tải bộ đề.';
    if (errorMessage) {
      errorMessage.textContent = details;
    } else {
      console.error('Không tìm thấy #error-message; lỗi khởi tạo ban đầu:', e);
      window.alert(details);
    }
    console.error('Lỗi khi khởi tạo ứng dụng:', e);
  };
};

function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.remove('active');
    el.hidden = true;
  };
  const screen = $(`screen-${name}`);
  if (screen) {
    screen.hidden = false;
    screen.classList.add('active');
  };
  state.mode = name;
  document.body.dataset.screen = name;
  if (screen) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  };
};

function toast(msg, ms = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
};

function confirmModal(title, body) {
  return new Promise((resolve) => {
    $('modal-title').textContent = title;
    $('modal-body').textContent = body;
    $('modal').hidden = false;
    $('modal').classList.add('is-open');
    const ok = $('modal-ok');
    const cancel = $('modal-cancel');
    const cleanup = (val) => {
      $('modal').hidden = true;
      $('modal').classList.remove('is-open');
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
  return state.decks[state.currentDeck] || [];
};

function highlightKey(deckId, originalIndex) {
  return `${deckId}:${originalIndex}`;
};

function getVisibleHighlights(deckId, originalIndex, includePending = false) {
  const saved = getQuestionHighlights(deckId, originalIndex);
  if (!includePending) return saved;
  return [...saved, ...(state.pendingHighlights[highlightKey(deckId, originalIndex)] || [])];
};

function renderTextWithHighlights(element, text, deckId, originalIndex, target, includePending = false) {
  element.replaceChildren();
  element.dataset.highlightTarget = target;
  element.dataset.questionIndex = String(originalIndex);
  element.dataset.deckId = deckId;
  const ranges = getVisibleHighlights(deckId, originalIndex, includePending)
    .filter((range) => range.target === target && range.start < text.length && range.end > 0)
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(text.length, range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
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
    mark.className = 'text-highlight';
    mark.textContent = text.slice(range.start, range.end);
    element.appendChild(mark);
    cursor = range.end;
  };
  if (cursor < text.length) element.appendChild(document.createTextNode(text.slice(cursor)));
};

function toggleHighlightSelection(deckId, questionIndex, selection) {
  const saved = getQuestionHighlights(deckId, questionIndex);
  const selected = { target: selection.target, start: selection.start, end: selection.end };
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
  } else {
    updated = [...saved, selected];
  };
  if (!saveQuestionHighlights(deckId, questionIndex, updated)) {
    toast('Không thể lưu highlight. Bộ nhớ trình duyệt có thể đã đầy.');
    return false;
  };
  delete state.pendingHighlights[highlightKey(deckId, questionIndex)];
  state.lastTextSelection = null;
  if (state.mode === 'review') renderQuestionBank();
  else renderQuestion();
  toast(fullyHighlighted ? 'Đã xóa highlight ở đoạn chọn.' : 'Đã highlight đoạn chọn.');
  return true;
};

function createHighlightToolbar(questionIndex, bankMode = false) {
  const toolbar = document.createElement('div');
  toolbar.className = 'highlight-toolbar';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-sm highlight-toggle-btn';
  button.dataset.icon = 'underline';
  button.textContent = 'Highlight';
  button.setAttribute('aria-label', 'Highlight hoặc bỏ highlight đoạn văn bản đã chọn');
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') event.preventDefault();
  });
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    captureHighlightSelection();
    const selection = state.lastTextSelection;
    const expectedDeck = bankMode ? state.currentDeck : state.session?.deckId;
    if (!selection || selection.questionIndex !== questionIndex || selection.deckId !== expectedDeck) {
      toast('Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.');
      return;
    };
    toggleHighlightSelection(selection.deckId, questionIndex, selection);
  });
  toolbar.appendChild(button);
  return toolbar;
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
  }

  const elementFor = (node) => {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest?.('[data-highlight-target]') || null;
  };

  const target = elementFor(range.startContainer);
  const endTarget = elementFor(range.endContainer);
  if (!target || target !== endTarget ||
      !target.contains(range.startContainer) ||
      !target.contains(range.endContainer)) {
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
    const text = target.textContent || '';
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
      selectedText
    };
    return true;
  } catch {
    state.lastTextSelection = null;
    return false;
  }
};

function commitPendingHighlights(deckId, originalIndex) {
  const key = highlightKey(deckId, originalIndex);
  const pending = state.pendingHighlights[key];
  if (!pending?.length) return;
  if (saveQuestionHighlights(deckId, originalIndex, [...getQuestionHighlights(deckId, originalIndex), ...pending])) {
    delete state.pendingHighlights[key];
  } else toast('Không thể lưu highlight. Bộ nhớ trình duyệt có thể đã đầy.');
};

function renderQuestionBank() {
  const questions = currentQuestions();
  const form = readSetupForm();
  const gotoInput = $('input-review-goto');
  gotoInput.min = '1';
  gotoInput.max = String(Math.max(1, questions.length));
  gotoInput.placeholder = `1–${questions.length}`;
  gotoInput.setAttribute('aria-label', `Đi đến câu số từ 1 đến ${questions.length}`);
  const query = normalizeSearchText(state.reviewSearch.trim());
  const inRange = state.reviewSelectMode
    ? questions.filter((question) => question.originalIndex >= form.startQuestion - 1 && question.originalIndex < form.endQuestion)
    : questions;
  const filtered = (query
    ? inRange.filter((question) => normalizeSearchText([question.question, ...question.options].join(' ')).includes(query))
    : inRange);
  const selectedCount = [...state.reviewSelectedIndices].filter((index) => index >= form.startQuestion - 1 && index < form.endQuestion).length;
  $('btn-review-select-mode').textContent = state.reviewSelectMode ? 'Thoát chọn câu' : 'Tự chọn câu';
  $('review-selection-tools').hidden = !state.reviewSelectMode;
  $('btn-review-start-selected').textContent = `Bắt đầu ${state.practiceMode === 'exam' ? 'thi' : 'ôn'} ${selectedCount} câu đã chọn`;
  $('btn-review-start-selected').disabled = selectedCount === 0;
  $('review-selection-count').textContent = state.reviewSelectMode
    ? `Đã chọn ${selectedCount} câu · Phạm vi câu gốc ${form.startQuestion}–${form.endQuestion}.`
    : '';
  const list = $('review-list');
  const fragment = document.createDocumentFragment();
  $('review-title').textContent = DECKS[state.currentDeck].label;
  $('review-description').textContent = `${questions.length} câu.`;
  $('review-count').textContent = state.reviewSelectMode
    ? `Hiển thị ${filtered.length} câu trong vùng đã chọn.`
    : query
      ? `Hiển thị ${filtered.length}/${questions.length} câu phù hợp.`
      : `Hiển thị toàn bộ ${questions.length} câu.`;

  for (const question of filtered) {
    const card = document.createElement('article');
    card.className = 'review-q-card';
    card.id = `review-question-${question.originalIndex + 1}`;
    const heading = document.createElement('h3');
    heading.className = 'review-q-heading';
    heading.textContent = `Câu ${question.originalIndex + 1}`;
    if (state.reviewSelectMode) {
      const selectLabel = document.createElement('label');
      selectLabel.className = 'review-select-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.reviewSelectedIndices.has(question.originalIndex);
      checkbox.setAttribute('aria-label', `Chọn câu ${question.originalIndex + 1}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.reviewSelectedIndices.add(question.originalIndex);
        else state.reviewSelectedIndices.delete(question.originalIndex);
        const currentForm = readSetupForm();
        const count = [...state.reviewSelectedIndices].filter((index) =>
          index >= currentForm.startQuestion - 1 && index < currentForm.endQuestion
        ).length;
        $('review-selection-count').textContent = `Đã chọn ${count} câu · Phạm vi câu gốc ${currentForm.startQuestion}–${currentForm.endQuestion}.`;
        $('btn-review-start-selected').textContent = `Bắt đầu ${state.practiceMode === 'exam' ? 'thi' : 'ôn'} ${count} câu đã chọn`;
        $('btn-review-start-selected').disabled = count === 0;
      });
      selectLabel.append(checkbox, document.createTextNode('Chọn câu này'));
      card.appendChild(selectLabel);
    };
    const prompt = document.createElement('p');
    prompt.className = 'review-q-text';
    renderTextWithHighlights(prompt, question.question, state.currentDeck, question.originalIndex, 'question');
    const highlightToolbar = createHighlightToolbar(question.originalIndex, true);
    const options = document.createElement('ol');
    options.className = 'review-options';
    options.type = 'A';
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    question.options.forEach((option, index) => {
      const item = document.createElement('li');
      item.className = index === question.correct ? 'review-option is-correct' : 'review-option';
      const label = document.createElement('span');
      label.className = 'review-option-label';
      label.textContent = labels[index] || String(index + 1);
      const text = document.createElement('span');
      text.className = 'review-option-text';
      renderTextWithHighlights(text, option, state.currentDeck, question.originalIndex, `option:${index}`);
      item.append(label, text);
      if (index === question.correct) {
        const badge = document.createElement('span');
        badge.className = 'review-correct-badge';
        badge.textContent = 'Đáp án đúng';
        item.appendChild(badge);
      };
      options.appendChild(item);
    });
    card.append(heading, prompt, highlightToolbar, options);
    fragment.appendChild(card);
  };
  list.replaceChildren(fragment);
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'card review-empty';
    empty.textContent = 'Không tìm thấy câu hỏi hoặc đáp án phù hợp.';
    list.appendChild(empty);
  };
};

function openQuestionBank() {
  state.reviewSelectedIndices.clear();
  state.reviewSearch = '';
  state.reviewSelectMode = false;
  $('input-review-search').value = '';
  $('input-review-goto').value = '';
  renderQuestionBank();
  showScreen('review');
};


function refreshSetupUI() {
  const qs = currentQuestions();
  const total = qs.length;
  $('count-quocphong1').textContent = `${state.decks.quocphong1?.length ?? '—'} câu`;
  $('count-quocphong2').textContent = `${state.decks.quocphong2?.length ?? '—'} câu`;

  document.querySelectorAll('.deck-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.deck === state.currentDeck);
  });

  const startInput = $('input-range-start');
  const endInput = $('input-range-end');
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
  $('hint-range').textContent = `Phạm vi câu gốc ${start}–${end} trong ${total} câu.`;

  const rangeTotal = Math.max(0, end - start + 1);
  const input = $('input-count');
  input.max = String(Math.max(1, rangeTotal));
  if (Number(input.value) > rangeTotal) input.value = String(rangeTotal || 1);
  if (Number(input.value) < 1 || !Number.isFinite(Number(input.value))) input.value = '1';
  $('hint-count').textContent = `Tối đa ${rangeTotal} câu trong vùng đã chọn.`;

  const progress = getDeckProgress(state.currentDeck);
  const completed = new Set(progress.completed);
  const remaining = qs.filter((q) => !completed.has(q.originalIndex)).length;
  const wrongs = getWrongIndices(state.currentDeck);
  $('stat-completed').textContent = String(completed.size);
  $('stat-remaining').textContent = String(remaining);
  $('stat-wrong').textContent = String(wrongs.length);
  $('stat-practice').textContent = String(Object.values(progress.practiceMap || {}).reduce((sum, count) => sum + count, 0));
  $('stat-bookmarked').textContent = String(progress.bookmarks.length);
  if (progress.sequentialCursor >= total) {
    $('stat-cursor').textContent = 'Đã hết (làm lại từ đầu)';
  } else {
    $('stat-cursor').textContent = String(progress.sequentialCursor + 1);
  };

  const btnWrong = $('btn-practice-wrong');
  const rangeWrongCount = getRangeWrongIndices(state.currentDeck, start, end).length;
  btnWrong.disabled = state.practiceMode === 'exam' || rangeWrongCount === 0;
  btnWrong.textContent = `Luyện câu sai trong vùng (${rangeWrongCount})`;

  const allWrongCount = getWrongIndices(state.currentDeck).filter((index) => index < total).length;
  const btnAllWrong = $('btn-practice-all-wrong');
  btnAllWrong.disabled = state.practiceMode === 'exam' || allWrongCount === 0;
  btnAllWrong.textContent = `Luyện toàn bộ câu sai (${allWrongCount})`;

  const bookmarks = new Set(getBookmarkedIndices(state.currentDeck));
  const rangeBookmarkCount = qs.filter((question) => question.originalIndex >= start - 1 && question.originalIndex < end && bookmarks.has(question.originalIndex)).length;
  const btnBookmarks = $('btn-practice-bookmarks');
  btnBookmarks.disabled = state.practiceMode === 'exam' || rangeBookmarkCount === 0;
  btnBookmarks.textContent = `Ôn câu đã đánh dấu (${rangeBookmarkCount})`;

  const rangeQuestions = qs.filter((question) => question.originalIndex >= start - 1 && question.originalIndex < end);
  const rangeRemaining = rangeQuestions.filter((question) => !completed.has(question.originalIndex)).length;
  refreshSearchUI();
  const shuffleQ = $('chk-shuffle-q').checked;
  const btnContinue = $('btn-continue');
  const nextQuestion = findNextUncompletedQuestion(
    rangeQuestions,
    Math.max(progress.sequentialCursor, start - 1),
    completed
  );
  const nextIndex = nextQuestion?.originalIndex ?? end;
  const canContinue = state.practiceMode !== 'exam' && !shuffleQ && !!nextQuestion;
  btnContinue.hidden = !canContinue;
  if (canContinue) {
    const left = end - nextIndex;
    const n = Math.min(Number(input.value) || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự (${n} câu từ vị trí ${nextIndex + 1})`;
  };

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    const n = Number(btn.dataset.count);
    btn.classList.toggle('is-active', Number(input.value) === n);
    btn.disabled = n > rangeTotal;
  });

  refreshResumeCard();
};

function refreshResumeCard() {
  const card = $('resume-card');
  if (!card) return;
  const saved = getSession(state.currentDeck);
  if (!saved || !Array.isArray(saved.items) || !saved.items.length) {
    card.hidden = true;
    return;
  };
  const answered = saved.items.filter((it) => it.userAnswer != null).length;
  const isExam = !!saved.examMode || saved.mode === 'exam';
  const deckLabel = DECKS[saved.deckId]?.label || saved.deckId;
  card.hidden = false;
  $('resume-title').textContent = isExam
    ? (saved.reviewMode ? 'Có bài thi đã chấm' : 'Có bài thi thử đang dở')
    : 'Có lượt ôn đang dở';
  $('resume-hint').textContent = isExam
    ? `${deckLabel} · ${answered}/${saved.items.length} câu đã chọn${saved.reviewMode ? ' · đã chấm' : ''}`
    : `${deckLabel} · câu ${(saved.viewIndex || 0) + 1}/${saved.items.length}`;
};

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (letter) => letter === 'Đ' ? 'D' : 'd')
    .toLocaleLowerCase('vi');
};

function refreshSearchUI() {
  const query = normalizeSearchText($('input-search').value.trim());
  const form = readSetupForm();
  const pool = selectedQuestions(form);
  state.searchResults = query
    ? pool.filter((question) => normalizeSearchText([question.question, ...question.options].join(' ')).includes(query))
    : [];
  const button = $('btn-search-practice');
  const hint = $('search-hint');
  button.disabled = state.searchResults.length === 0;
  button.textContent = state.searchResults.length
    ? `Ôn ${state.searchResults.length} câu tìm được`
    : 'Ôn kết quả tìm kiếm';
  hint.textContent = query
    ? state.searchResults.length
      ? `Tìm thấy ${state.searchResults.length} câu trong vùng ${form.startQuestion}–${form.endQuestion}.`
      : `Không tìm thấy câu phù hợp trong vùng ${form.startQuestion}–${form.endQuestion}.`
    : '';
};

function startSearchResults() {
  const form = readSetupForm();
  refreshSearchUI();
  const pool = state.searchResults.slice();
  if (!pool.length) {
    toast('Không có kết quả tìm kiếm để ôn.');
    return;
  };
  if (form.shuffleQ) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    };
  };
  persistSetupForm();
  startSessionFromPool(pool, {
    mode: 'search',
    sequential: false,
    forceShuffleQ: form.shuffleQ,
    alreadyShuffled: true
  });
};

function startPracticeBookmarks() {
  const form = readSetupForm();
  persistSetupForm();
  const qs = selectedQuestions(form);
  const bookmarked = getBookmarkedIndices(state.currentDeck);
  const pool = pickWrong(qs, bookmarked, form.count, form.shuffleQ);
  if (!pool.length) {
    toast('Trong vùng câu hỏi đã chọn không có câu nào được đánh dấu.');
    return;
  };
  const practiceSaveFailed = pool.some((question) => markPracticed(state.currentDeck, question.originalIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê luyện lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-bookmarks',
    sequential: false,
    forceShuffleQ: form.shuffleQ,
    alreadyShuffled: true
  });
};

function readSetupForm() {
  const total = currentQuestions().length;
  let startQuestion = Number.parseInt($('input-range-start').value, 10);
  let endQuestion = Number.parseInt($('input-range-end').value, 10);
  if (!Number.isInteger(startQuestion)) startQuestion = 1;
  if (!Number.isInteger(endQuestion)) endQuestion = total;
  startQuestion = Math.max(1, Math.min(startQuestion, Math.max(1, total)));
  endQuestion = Math.max(startQuestion, Math.min(endQuestion, Math.max(1, total)));

  let count = Number.parseInt($('input-count').value, 10);
  const rangeCount = Math.max(1, endQuestion - startQuestion + 1);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > rangeCount) count = rangeCount;
  let timeLimit = Number.parseInt($('input-time-limit').value, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 0) timeLimit = 0;
  timeLimit = Math.min(1440, timeLimit);
  $('input-time-limit').value = String(timeLimit);
  const shuffleQ = $('chk-shuffle-q').checked;
  const shuffleA = $('chk-shuffle-a').checked;
  return { count, shuffleQ, shuffleA, startQuestion, endQuestion, timeLimit };
};

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
    practiceMode: state.practiceMode
  });
  if (!saved) toast('Không thể lưu tùy chọn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
};

function applySettingsToForm(settings) {
  if (!settings) return;
  const total = currentQuestions().length || settings.endQuestion || 1;
  $('input-count').value = String(settings.count || 30);
  $('input-time-limit').value = String(settings.timeLimit || 35);
  $('input-range-start').value = String(settings.startQuestion || 1);
  $('input-range-end').value = String(settings.endQuestion > 0 ? Math.min(settings.endQuestion, total) : total);
  $('chk-shuffle-q').checked = !!settings.shuffleQ;
  $('chk-shuffle-a').checked = !!settings.shuffleA;
  setPracticeMode(settings.practiceMode === 'exam' ? 'exam' : 'practice');
};

function stopSessionTimer(freeze = true) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  const s = state.session;
  if (freeze && s && !s.finishedAt) {
    s.finishedAt = Date.now();
    persistSession();
  };
  updateTimerDisplay();
};

function selectedQuestions(form = readSetupForm()) {
  return currentQuestions().filter((question) =>
    question.originalIndex >= form.startQuestion - 1 &&
    question.originalIndex < form.endQuestion
  );
};
function startSessionFromPool(pool, meta) {
  const form = readSetupForm();
  const shuffleA = form.shuffleA;
  const shuffleQ = meta.forceShuffleQ != null ? meta.forceShuffleQ : form.shuffleQ;
  const shouldShuffleQ = meta.alreadyShuffled ? false : !!shuffleQ;
  const items = createSessionItems(pool, { shuffleQ: shouldShuffleQ, shuffleA });
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
    shuffleQ,
    shuffleA,
    pool: pool.map((q) => ({
      originalIndex: q.originalIndex,
      question: q.question,
      options: q.options.slice(),
      correct: q.correct
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
    timeLimit: form.timeLimit,
    startedAt: Date.now(),
    deadlineAt: form.timeLimit > 0 ? Date.now() + form.timeLimit * 60000 : null,
    timeExpired: false
  };
  if (meta.examMode || state.practiceMode === 'exam') {
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

function startNormal(opts = {}) {
  const allQuestions = currentQuestions();
  if (!allQuestions.length) {
    toast('Bộ đề trống.');
    return;
  };
  const form = readSetupForm();
  const qs = selectedQuestions(form);
  if (!qs.length) {
    toast('Vùng câu hỏi đã chọn không có câu hợp lệ.');
    return;
  };
  persistSetupForm();
  const progress = getDeckProgress(state.currentDeck);
  const completedSet = new Set(progress.completed);
  const rangeStart = form.startQuestion - 1;
  const rangeEnd = form.endQuestion;

  if (opts.restart) {
    const { items, nextCursor } = pickSequential(qs, 0, form.count, new Set());
    const globalNextCursor = nextCursor > 0 ? qs[Math.min(nextCursor, qs.length) - 1].originalIndex + 1 : rangeStart;
    startSessionFromPool(items, {
      mode: 'normal',
      sequential: true,
      startCursor: rangeStart,
      nextCursor: globalNextCursor,
      forceShuffleQ: false,
      alreadyShuffled: true
    });
    return;
  };

  if (opts.sequential) {
    const nextQuestion = findNextUncompletedQuestion(
      qs,
      Math.max(progress.sequentialCursor, rangeStart),
      completedSet
    );
    if (!nextQuestion) {
      toast('Đã hoàn thành toàn bộ câu trong vùng đã chọn.');
      return;
    };
    const cursor = nextQuestion.originalIndex;
    const scanQuestions = qs.filter((question) => question.originalIndex >= cursor);
    const { items, nextCursor, actualCount } = pickSequential(scanQuestions, 0, form.count, completedSet);
    if (!items.length) {
      toast('Không còn câu tuần tự trong vùng đã chọn.');
      return;
    };
    if (actualCount < form.count) toast(`Chỉ còn ${actualCount} câu theo thứ tự trong vùng đã chọn.`);
    const globalNextCursor = nextCursor > 0
      ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1].originalIndex + 1
      : cursor;
    startSessionFromPool(items, {
      mode: 'normal',
      sequential: true,
      startCursor: cursor,
      nextCursor: globalNextCursor,
      forceShuffleQ: false,
      alreadyShuffled: true
    });
    return;
  };

  if (form.shuffleQ) {
    const remainingCount = qs.filter((question) => !completedSet.has(question.originalIndex)).length;
    const pool = pickRandom(qs, form.count, true, completedSet);
    if (!pool.length) {
      toast('Không lấy được câu hỏi trong vùng đã chọn.');
      return;
    };
    if (remainingCount === 0) {
      toast('Bạn đã hoàn thành các câu trong vùng này; lượt này lấy ngẫu nhiên trong vùng đã chọn.');
    } else if (remainingCount < form.count) {
      toast(`Chỉ còn ${remainingCount} câu chưa hoàn thành trong vùng; đã bổ sung câu đã làm để đủ ${pool.length} câu.`);
    };
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true
    });
    return;
  };

  const nextQuestion = findNextUncompletedQuestion(
    qs,
    Math.max(progress.sequentialCursor, rangeStart),
    completedSet
  );
  const cursor = nextQuestion?.originalIndex ?? rangeEnd;
  const scanQuestions = qs.filter((question) => question.originalIndex >= cursor);
  const { items, nextCursor, actualCount } = pickSequential(scanQuestions, 0, form.count, completedSet);
  if (!items.length) {
    const pool = pickRandom(qs, form.count, false, completedSet);
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true
    });
    toast('Đã hết chuỗi tuần tự trong vùng, chuyển sang ngẫu nhiên trong vùng đã chọn.');
    return;
  };
  if (actualCount < form.count) toast(`Lượt này có ${actualCount} câu trong vùng đã chọn.`);
  const globalNextCursor = nextCursor > 0
    ? scanQuestions[Math.min(nextCursor, scanQuestions.length) - 1].originalIndex + 1
    : cursor;
  startSessionFromPool(items, {
    mode: 'normal',
    sequential: true,
    startCursor: cursor,
    nextCursor: globalNextCursor,
    forceShuffleQ: false,
    alreadyShuffled: true
  });
};
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
      : getRangeWrongIndices(state.currentDeck, form.startQuestion, form.endQuestion);
  const wrongs = [...new Set(sourceIndices)].filter((index) => rangeIndices.has(index));
  if (!wrongs.length) {
    toast(allDeck ? 'Bộ đề này chưa có câu sai để luyện.' : 'Trong vùng câu hỏi đã chọn không có câu sai để luyện.');
    return;
  };
  const pool = pickWrong(qs, wrongs, allDeck ? wrongs.length : form.count, form.shuffleQ);
  if (!pool.length) {
    toast('Không tìm thấy câu sai hợp lệ trong bộ đề đã chọn. Hãy tải lại bộ đề.');
    return;
  };
  const practiceSaveFailed = pool.some((question) => markPracticed(state.currentDeck, question.originalIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê luyện lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-wrong',
    sequential: false,
    forceShuffleQ: form.shuffleQ,
    alreadyShuffled: true,
    ...(allDeck ? { rangeStart: 1, rangeEnd: qs.length, requestedCount: pool.length } : {})
  });
};
function recordWrongAnswer(session, originalIndex) {
  if (markWrong(session.deckId, originalIndex) === null) {
    toast('Không thể lưu lịch sử câu sai vào trình duyệt.');
  };
  if (Number.isInteger(session.rangeStart) && Number.isInteger(session.rangeEnd) &&
      !addWrongIndicesForRange(session.deckId, session.rangeStart, session.rangeEnd, [originalIndex])) {
    toast('Không thể lưu câu sai riêng cho vùng câu hỏi này.');
  };
};

function currentItem() {
  const s = state.session;
  if (!s) return null;
  return s.items[s.viewIndex];
};

function currentQ() {
  const s = state.session;
  const item = currentItem();
  if (!s || !item) return null;
  return s.pool[item.poolIdx];
};

function renderQuestion() {
  const s = state.session;
  if (!s) return;
  const item = currentItem();
  const q = currentQ();
  if (!item || !q) return;

  const viewingHistory = s.viewIndex < s.maxReached;

  $('progress-label').textContent = s.mode === 'practice-wrong'
    ? `Câu ${s.viewIndex + 1} / ${s.items.length} · Còn ${s.items.filter((entry) => entry.status !== 'correct').length} câu cần đúng`
    : `Câu ${s.viewIndex + 1} / ${s.items.length}`;
  const progressTotal = s.mode === 'practice-wrong' ? (s.practiceInitialCount || s.items.length) : s.items.length;
  $('progress-score').textContent = `Điểm ${formatScore(s.firstTryCorrect || 0, progressTotal)} / 10`;
  updateTimerDisplay();
  const pct = progressTotal ? Math.round((s.completedInSession / progressTotal) * 100) : 0;
  $('progress-fill').style.width = `${pct}%`;
  $('progress-fill').parentElement.setAttribute('aria-valuenow', String(pct));

  $('q-badge').textContent =
    s.mode === 'practice-wrong'
      ? `Luyện câu sai · Gốc #${q.originalIndex + 1}`
      : s.mode === 'practice-bookmarks'
        ? `Câu đã đánh dấu · Gốc #${q.originalIndex + 1}`
        : s.mode === 'search'
          ? `Kết quả tìm kiếm · Gốc #${q.originalIndex + 1}`
          : `Câu hỏi · Gốc #${q.originalIndex + 1}`;
  const bookmarkButton = $('btn-bookmark');
  const isBookmarked = getBookmarkedIndices(s.deckId).includes(q.originalIndex);
  bookmarkButton.textContent = isBookmarked ? 'Đã đánh dấu' : 'Đánh dấu';
  bookmarkButton.classList.toggle('is-bookmarked', isBookmarked);
  bookmarkButton.setAttribute('aria-pressed', String(isBookmarked));
  renderTextWithHighlights($('q-text'), q.question, s.deckId, q.originalIndex, 'question', true);
  const highlightToolbar = $('quiz-highlight-toolbar');
  if (highlightToolbar) highlightToolbar.hidden = s.examMode === true;

  const optsEl = $('options');
  optsEl.replaceChildren();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  item.optionOrder.forEach((origIdx, displayIdx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.setAttribute('aria-pressed', String(item.userAnswer === displayIdx));
    btn.dataset.display = String(displayIdx);

    if (item.userAnswer === displayIdx) btn.classList.add('selected');
    if (item.checked && item.status === 'correct' && displayIdx === item.userAnswer) {
      btn.classList.add('correct');
    };
    if (item.checked && item.status === 'wrong' && displayIdx === item.userAnswer) {
      btn.classList.add('incorrect');
    };
    const wrongOptions = Array.isArray(item.wrongOptions) ? item.wrongOptions : [];
    if (wrongOptions.includes(origIdx)) {
      btn.classList.add('incorrect', 'locked');
      btn.disabled = true;
    };
    if (item.status === 'correct') {
      btn.classList.add('locked');
      btn.disabled = true;
      if (displayIdx === displayedCorrectIndex(item, q)) btn.classList.add('correct');
    } else if (viewingHistory) {
      btn.disabled = true;
      btn.classList.add('locked');
    };

    const key = document.createElement('span');
    key.className = 'option-key';
    key.textContent = labels[displayIdx] || String(displayIdx + 1);
    const text = document.createElement('span');
    text.className = 'option-text';
    renderTextWithHighlights(text, q.options[origIdx], s.deckId, q.originalIndex, `option:${origIdx}`, true);
    btn.append(key, text);

    if (!btn.disabled) {
      btn.addEventListener('click', () => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) {
          const range = selection.getRangeAt(0);
          const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
          const endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
          if (btn.contains(startNode) && btn.contains(endNode)) {
            captureHighlightSelection();
            return;
          };
        };
        onSelectOption(displayIdx);
      });
    };
    optsEl.appendChild(btn);
  });

  const feedback = $('feedback');
  if (item.checked && item.status === 'correct') {
    feedback.hidden = false;
    feedback.className = 'feedback ok';
    feedback.textContent = 'Chính xác!';
  } else if (item.checked && item.status === 'wrong') {
    feedback.hidden = false;
    feedback.className = 'feedback bad';
    feedback.textContent = 'Chưa đúng. Hãy chọn lại đáp án khác.';
  } else {
    feedback.hidden = true;
    feedback.textContent = '';
  };

  $('btn-prev').disabled = s.viewIndex <= 0;
  const nextButton = $('btn-next');
  if (viewingHistory) {
    nextButton.textContent = 'Câu tiếp';
    nextButton.dataset.icon = 'chevron-right';
    nextButton.disabled = s.viewIndex >= s.maxReached;
  } else if (item.status === 'correct') {
    const isLastQuestion = s.viewIndex === s.items.length - 1;
    const shouldFinish = isLastQuestion && s.mode !== 'practice-wrong';
    nextButton.textContent = shouldFinish ? 'Kết thúc' : 'Câu tiếp';
    nextButton.dataset.icon = shouldFinish ? 'check' : 'chevron-right';
    nextButton.disabled = false;
  } else if (s.mode === 'practice-wrong' && item.status === 'wrong' && item.checked) {
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
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === state.practiceMode);
  });
  const startBtn = $('btn-start');
  if (startBtn) {
    startBtn.textContent = state.practiceMode === 'exam' ? 'Bắt đầu thi thử' : 'Bắt đầu ôn';
  };
  const searchWrap = $('search-field-wrap');
  if (searchWrap) searchWrap.hidden = state.practiceMode === 'exam';
  const hint = $('hint-mode');
  if (hint) {
    hint.textContent = state.practiceMode === 'exam'
      ? 'Thi thử: hiện tất cả câu đã chọn, chọn đáp án rồi nộp bài một lần. Không hiện đáp án đúng trước khi nộp.'
      : 'Ôn luyện: làm từng câu, kiểm tra đáp án ngay sau mỗi câu.';
  };
  persistSetupForm();
  if (state.mode === 'setup' && state.decks.quocphong1) refreshSetupUI();
}

function updateExamProgressHeader() {
  const s = state.session;
  if (!s || !s.examMode) return;
  const answered = s.items.filter((it) => it.userAnswer != null).length;
  const unanswered = s.items.length - answered;
  $('exam-progress-label').textContent = s.reviewMode
    ? `Kết quả · ${s.firstTryCorrect || 0}/${s.items.length} đúng`
    : `Đã chọn ${answered} / ${s.items.length}${unanswered ? ` · còn ${unanswered}` : ''}`;
  const pct = s.items.length ? Math.round((answered / s.items.length) * 100) : 0;
  const fill = $('exam-progress-fill');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.parentElement?.setAttribute('aria-valuenow', String(pct));
  };
  updateTimerDisplay();
  const filterWrong = $('exam-filter-wrong');
  const filterCorrect = $('exam-filter-correct');
  if (filterWrong) filterWrong.hidden = !s.reviewMode;
  if (filterCorrect) filterCorrect.hidden = !s.reviewMode;
  const nextEmpty = $('btn-exam-next-empty');
  if (nextEmpty) {
    nextEmpty.hidden = s.reviewMode || unanswered === 0;
    nextEmpty.textContent = unanswered ? `Còn ${unanswered} câu` : 'Đủ đáp án';
  };
  const submitBtn = $('btn-exam-submit');
  if (submitBtn) {
    if (s.reviewMode) {
      submitBtn.textContent = 'Xem tổng kết';
      submitBtn.dataset.icon = 'list-check';
      submitBtn.disabled = false;
    } else {
      submitBtn.textContent = `Nộp bài (${answered}/${s.items.length})`;
      submitBtn.dataset.icon = 'check';
      submitBtn.disabled = !!state.examSubmitting;
    };
  };
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === state.examFilter);
  });
};

function applyExamFilter() {
  const s = state.session;
  if (!s?.examMode) return;
  const filter = state.examFilter || 'all';
  s.items.forEach((item, idx) => {
    const card = $(`exam-q-${idx}`);
    if (!card) return;
    let show = true;
    if (filter === 'unanswered') show = item.userAnswer == null;
    else if (filter === 'wrong') show = item.status === 'wrong';
    else if (filter === 'correct') show = item.status === 'correct';
    card.hidden = !show;
  });
};

function scrollToExamQuestion(idx) {
  const card = $(`exam-q-${idx}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function jumpToNextUnanswered(fromIdx = -1) {
  const s = state.session;
  if (!s?.examMode || s.reviewMode) return;
  const start = fromIdx + 1;
  let found = s.items.findIndex((it, i) => i >= start && it.userAnswer == null);
  if (found < 0) found = s.items.findIndex((it) => it.userAnswer == null);
  if (found >= 0) {
    state.examFilter = 'all';
    applyExamFilter();
    updateExamProgressHeader();
    scrollToExamQuestion(found);
  } else {
    toast('Bạn đã chọn đủ đáp án.');
  };
};

function renderExam() {
  const s = state.session;
  if (!s || !s.examMode) return;
  const list = $('exam-list');
  const nav = $('exam-nav');
  if (!list || !nav) return;
  const scrollY = window.scrollY;
  list.replaceChildren();
  nav.replaceChildren();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  updateExamProgressHeader();

  s.items.forEach((item, idx) => {
    const q = s.pool[item.poolIdx];
    const card = document.createElement('article');
    card.className = 'exam-q-card';
    card.id = `exam-q-${idx}`;
    if (item.userAnswer != null) card.classList.add('is-answered');
    if (s.reviewMode) {
      if (item.status === 'correct') card.classList.add('is-correct');
      else if (item.status === 'wrong') card.classList.add('is-wrong');
    };

    const head = document.createElement('div');
    head.className = 'exam-q-head';
    const num = document.createElement('span');
    num.className = 'exam-q-num';
    num.textContent = `Câu ${idx + 1} · Gốc #${q.originalIndex + 1}`;
    head.appendChild(num);
    if (s.reviewMode) {
      const badge = document.createElement('span');
      badge.className = `exam-status-badge ${item.status === 'correct' ? 'ok' : 'bad'}`;
      badge.textContent = item.status === 'correct' ? 'Đúng' : (item.userAnswer == null ? 'Bỏ trống' : 'Sai');
      head.appendChild(badge);
    };
    card.appendChild(head);

    const text = document.createElement('h3');
    text.className = 'exam-q-text';
    text.textContent = q.question;
    card.appendChild(text);

    const opts = document.createElement('div');
    opts.className = 'exam-options options';
    opts.setAttribute('role', 'group');
    opts.setAttribute('aria-label', `Đáp án câu ${idx + 1}`);

    item.optionOrder.forEach((origIdx, displayIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.dataset.q = String(idx);
      btn.dataset.display = String(displayIdx);
      btn.setAttribute('aria-pressed', String(item.userAnswer === displayIdx));
      if (item.userAnswer === displayIdx) btn.classList.add('selected');
      if (s.reviewMode) {
        btn.disabled = true;
        const correctDisplay = item.optionOrder.indexOf(q.correct);
        if (displayIdx === correctDisplay) btn.classList.add('correct');
        if (item.userAnswer === displayIdx && item.status === 'wrong') btn.classList.add('incorrect');
      };
      const label = document.createElement('span');
      label.className = 'option-key';
      label.textContent = labels[displayIdx] || String(displayIdx + 1);
      const body = document.createElement('span');
      body.className = 'option-text';
      body.textContent = q.options[origIdx];
      btn.append(label, body);
      if (!s.reviewMode) {
        btn.addEventListener('click', () => onExamSelect(idx, displayIdx));
      };
      opts.appendChild(btn);
    });
    card.appendChild(opts);
    list.appendChild(card);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'exam-nav-dot';
    dot.textContent = String(idx + 1);
    dot.title = `Câu ${idx + 1}`;
    dot.dataset.idx = String(idx);
    if (item.userAnswer != null) dot.classList.add('is-answered');
    if (s.reviewMode) {
      if (item.status === 'correct') dot.classList.add('is-correct');
      else if (item.status === 'wrong') dot.classList.add('is-wrong');
    };
    dot.addEventListener('click', () => scrollToExamQuestion(idx));
    nav.appendChild(dot);
  });

  applyExamFilter();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
};

function patchExamQuestion(qIdx) {
  const s = state.session;
  if (!s?.examMode) return;
  const item = s.items[qIdx];
  const card = $(`exam-q-${qIdx}`);
  if (!item || !card) {
    renderExam();
    return;
  };
  card.classList.toggle('is-answered', item.userAnswer != null);
  card.querySelectorAll('.option').forEach((btn) => {
    const displayIdx = Number(btn.dataset.display);
    const selected = item.userAnswer === displayIdx;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', String(selected));
  });
  const dot = $('exam-nav')?.querySelector(`.exam-nav-dot[data-idx="${qIdx}"]`);
  if (dot) dot.classList.toggle('is-answered', item.userAnswer != null);
  updateExamProgressHeader();
  applyExamFilter();
};

function onExamSelect(qIdx, displayIdx) {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s || s.reviewMode || !s.examMode || state.examSubmitting) return;
  const item = s.items[qIdx];
  if (!item) return;
  item.userAnswer = displayIdx;
  item.checked = false;
  item.status = 'pending';
  persistSession();
  patchExamQuestion(qIdx);
};

async function onExamSubmit() {
  if (state.examSubmitting) return;
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s || !s.examMode) return;
  if (s.reviewMode) {
    finishSession();
    return;
  };
  const unanswered = s.items.filter((it) => it.userAnswer == null).length;
  if (unanswered > 0) {
    const ok = await confirmModal(
      'Còn câu chưa chọn',
      `Bạn còn ${unanswered} câu chưa chọn đáp án. Vẫn nộp bài?`
    );
    if (!ok) return;
  } else {
    const ok = await confirmModal('Nộp bài thi?', `Bạn đã chọn đủ ${s.items.length} câu. Nộp bài để xem kết quả?`);
    if (!ok) return;
  };

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
        item.status = 'wrong';
        item.checked = true;
        item.wrongCount = 1;
        wrongAttempts += 1;
        recordWrongAnswer(s, q.originalIndex);
        continue;
      };
      const correct = isAnswerCorrect(item, q);
      item.checked = true;
      if (correct) {
        item.status = 'correct';
        firstTry += 1;
        completedIdx.push(q.originalIndex);
      } else {
        item.status = 'wrong';
        item.wrongCount = 1;
        wrongAttempts += 1;
        const wrongOriginalIndex = item.optionOrder[item.userAnswer];
        if (!item.wrongOptions) item.wrongOptions = [];
        if (!item.wrongOptions.includes(wrongOriginalIndex)) item.wrongOptions.push(wrongOriginalIndex);
        recordWrongAnswer(s, q.originalIndex);
      };
    };
    if (completedIdx.length) addCompleted(s.deckId, completedIdx, state.fingerprints[s.deckId]);
    s.firstTryCorrect = firstTry;
    s.totalWrongAttempts = wrongAttempts;
    s.completedInSession = s.items.length;
    s.reviewMode = true;
    state.reviewMode = true;
    state.examFilter = 'all';
    stopSessionTimer(true);
    persistSession();
    renderExam();
    toast(`Đã chấm bài: ${firstTry}/${s.items.length} đúng · Điểm ${formatScore(firstTry, s.items.length)}/10`);
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
      const q = session.pool[item.poolIdx];
      item.checked = true;
      if (item.userAnswer != null && isAnswerCorrect(item, q)) {
        item.status = 'correct';
        firstTry += 1;
        completedIdx.push(q.originalIndex);
      } else {
        item.status = 'wrong';
        item.wrongCount = Math.max(1, item.wrongCount || 0);
        wrongAttempts += 1;
        recordWrongAnswer(session, q.originalIndex);
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
    toast('Hết giờ — đã tự động nộp bài.');
    return true;
  };
  finishSession();
  return true;
};

function onSelectOption(displayIdx) {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  const item = currentItem();
  if (!s || !item) return;
  if (item.status === 'correct' || s.viewIndex < s.maxReached) return;
  const q = currentQ();
  if (!q || (Array.isArray(item.wrongOptions) && item.wrongOptions.includes(item.optionOrder[displayIdx]))) return;

  item.userAnswer = displayIdx;
  if (item.status === 'wrong') {
    item.checked = false;
    item.status = 'pending';
  };
  persistSession();
  renderQuestion();
};

const answerSounds = {
  correct: null,
  incorrect: null
};

function playAnswerSound(isCorrect) {
  const key = isCorrect ? 'correct' : 'incorrect';
  const path = dataUrl(`assets/sounds/${key}.mp3`);
  try {
    if (!answerSounds[key]) {
      answerSounds[key] = new Audio(path);
      answerSounds[key].preload = 'auto';
    }
    answerSounds[key].currentTime = 0;
    const playback = answerSounds[key].play();
    if (playback && typeof playback.catch === 'function') playback.catch(() => {});
  } catch (error) {
    console.warn('Không thể phát âm thanh đáp án:', error);
  }
}

function onCheck() {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  const item = currentItem();
  const q = currentQ();
  if (!s || !item || !q || item.userAnswer == null) return;
  if (item.status === 'correct' || item.checked || s.viewIndex < s.maxReached) return;

  item.checked = true;
  if (!Array.isArray(item.wrongOptions)) item.wrongOptions = [];
  if (isAnswerCorrect(item, q)) {
    playAnswerSound(true);
    const wasAlreadyCorrect = item.status === 'correct';
    const firstTime = item.wrongCount === 0 && !wasAlreadyCorrect;
    item.status = 'correct';
    if (!wasAlreadyCorrect) {
      if (s.mode === 'practice-wrong') {
        if (!Array.isArray(s.practiceCompletedIndices)) s.practiceCompletedIndices = [];
        const originalIndex = q.originalIndex;
        if (!s.practiceCompletedIndices.includes(originalIndex)) {
          s.practiceCompletedIndices.push(originalIndex);
          s.completedInSession = s.practiceCompletedIndices.length;
          if (firstTime) s.firstTryCorrect += 1;
        };
      } else {
        s.completedInSession += 1;
        if (firstTime) s.firstTryCorrect += 1;
      };
    };
    if (s.viewIndex >= s.maxReached) s.maxReached = s.viewIndex;
    s.reviewingPast = false;
  } else {
    playAnswerSound(false);
    item.status = 'wrong';
    const wrongOriginalIndex = item.optionOrder[item.userAnswer];
    if (!item.wrongOptions.includes(wrongOriginalIndex)) item.wrongOptions.push(wrongOriginalIndex);
    item.wrongCount += 1;
    s.totalWrongAttempts += 1;
    if (s.mode === 'practice-wrong') {
      if (!Array.isArray(s.practiceWrongHistory)) s.practiceWrongHistory = [];
      const history = s.practiceWrongHistory.find((entry) => entry.originalIndex === q.originalIndex);
      if (history) history.wrongCount += 1;
      else s.practiceWrongHistory.push({ originalIndex: q.originalIndex, question: q.question, wrongCount: 1 });
    };
    recordWrongAnswer(s, q.originalIndex);
  };
  persistSession();
  renderQuestion();

};

function onNext() {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s) return;
  const item = currentItem();
  if (!item) return;

  if (s.viewIndex >= s.maxReached && item.status !== 'correct' &&
      !(s.mode === 'practice-wrong' && item.status === 'wrong' && item.checked)) {
    onCheck();
    return;
  };

  if (s.viewIndex < s.maxReached) {
    s.viewIndex += 1;
    s.reviewingPast = s.viewIndex < s.maxReached;
    persistSession();
    renderQuestion();
    return;
  };

  if (item.status !== 'correct' && !(s.mode === 'practice-wrong' && item.status === 'wrong')) {
    toast('Hãy kiểm tra câu trả lời trước khi sang câu tiếp.');
    return;
  };

  if (s.viewIndex >= s.items.length - 1) {
    if (s.mode === 'practice-wrong') {
      const unresolved = s.items.filter((entry) => entry.status !== 'correct');
      if (!unresolved.length) {
        finishSession();
        return;
      };
      s.items = unresolved.map((entry) => ({
        ...entry,
        optionOrder: entry.optionOrder.slice(),
        userAnswer: null,
        status: 'pending',
        checked: false
      }));
      s.viewIndex = 0;
      s.maxReached = 0;
      s.reviewingPast = false;
      persistSession();
      renderQuestion();
      toast(`Còn ${s.items.length} câu chưa trả lời đúng. Tiếp tục luyện các câu này.`, 3500);
      return;
    };
    finishSession();
    return;
  };

  s.viewIndex += 1;
  if (s.viewIndex > s.maxReached) s.maxReached = s.viewIndex;
  s.reviewingPast = false;
  persistSession();
  renderQuestion();
};

function onPrev() {
  if (enforceSessionDeadline()) return;
  const s = state.session;
  if (!s || s.viewIndex <= 0) return;
  s.viewIndex -= 1;
  s.reviewingPast = true;
  persistSession();
  renderQuestion();
};

function persistSession() {
  if (state.session && !saveSession(state.session)) {
    toast('Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.');
  };
};

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

function formatScore(correct, total) {
  if (!(total > 0)) return '0';
  const score = Math.round((Math.max(0, correct) / total) * 100) / 10;
  return score.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
};

function animateScore(target, displayStr, circumference) {
  const scoreBig = $('sum-score-big');
  const ringFg = $('score-ring-fg');
  if (!scoreBig || !ringFg) return;

  const duration = 1100;
  const start = performance.now();

  let color = 'var(--primary)';
  if (target >= 8) color = '#22c55e';
  else if (target >= 5) color = '#eab308';
  else color = '#ef4444';

  ringFg.style.stroke = color;
  scoreBig.style.color = color;
  ringFg.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = target * eased;

    const shown = Math.round(current * 10) / 10;
    scoreBig.textContent = shown.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

    const pct = Math.max(0, Math.min(1, current / 10));
    ringFg.style.strokeDashoffset = `${circumference * (1 - pct)}`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      scoreBig.textContent = displayStr;
      ringFg.style.strokeDashoffset = `${circumference * (1 - target / 10)}`;

      scoreBig.style.transition = 'transform 0.25s ease';
      scoreBig.style.transform = 'scale(1.08)';
      setTimeout(() => {
        scoreBig.style.transform = 'scale(1)';
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
  else if (session.timeExpired && session.deadlineAt) end = Number(session.deadlineAt);
  return Math.max(0, Math.floor((end - startedAt) / 1000));
};

function updateTimerDisplay() {
  const s = state.session;
  const el = s?.examMode ? $('exam-progress-time') : $('progress-time');
  if (!el) return;
  if (!s) {
    el.hidden = true;
    return;
  };
  const elapsed = getElapsedSeconds(s);
  const stopped = !!s.finishedAt || !!s.reviewMode;
  const hasLimit = Number(s.timeLimit) > 0 && Number(s.deadlineAt) > 0 && !stopped;
  const remaining = hasLimit ? Math.max(0, Math.ceil((s.deadlineAt - Date.now()) / 1000)) : null;
  el.hidden = false;
  if (stopped) {
    el.textContent = `Hoàn thành · ${formatTime(elapsed)}`;
    el.classList.remove('time-warning');
  } else {
    el.textContent = hasLimit
      ? `Còn ${formatTime(remaining)} · Đã làm ${formatTime(elapsed)}`
      : `Đã làm ${formatTime(elapsed)}`;
    el.classList.toggle('time-warning', hasLimit && remaining <= 60);
  };
};

function startSessionTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (!state.session) {
    updateTimerDisplay();
    return;
  };
  if (state.session.finishedAt || state.session.reviewMode) {
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
    if (session.finishedAt || session.reviewMode) {
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
  if (state.session && !state.session.finishedAt && !state.session.reviewMode) {
    state.timerInterval = setInterval(tick, 1000);
  };
};

function finishSession() {
  const s = state.session;
  if (!s) return;
  stopSessionTimer(true);

  if (s.mode !== 'practice-wrong') {
    const completedIdx = s.items
      .filter((it) => it.status === 'correct')
      .map((it) => s.pool[it.poolIdx].originalIndex);
    const progressSaved = addCompleted(s.deckId, completedIdx, state.fingerprints[s.deckId]);
    if (!progressSaved) {
      toast('Không thể lưu tiến độ hoàn thành. Hãy kiểm tra dung lượng bộ nhớ trình duyệt.');
    } else if (s.sequential && s.nextCursor != null &&
      !setSequentialCursor(s.deckId, s.nextCursor, state.fingerprints[s.deckId])) {
      toast('Không thể lưu vị trí tuần tự của bộ đề.');
    };
  };

  const wrongInSession = [];
  const seen = new Set();
  if (s.mode === 'practice-wrong' && Array.isArray(s.practiceWrongHistory)) {
    for (const entry of s.practiceWrongHistory) {
      if (!seen.has(entry.originalIndex)) {
        seen.add(entry.originalIndex);
        wrongInSession.push({ ...entry });
      };
    };
  } else {
    for (const it of s.items) {
      if (it.wrongCount > 0) {
        const oi = s.pool[it.poolIdx].originalIndex;
        if (!seen.has(oi)) {
          seen.add(oi);
          wrongInSession.push({
            originalIndex: oi,
            question: s.pool[it.poolIdx].question,
            wrongCount: it.wrongCount
          });
        };
      };
    };
  };

  const scoreTotal = s.mode === 'practice-wrong' ? (s.practiceInitialCount || s.items.length) : s.items.length;
  s.summary = {
    total: scoreTotal,
    score: formatScore(s.firstTryCorrect || 0, scoreTotal),
    elapsedSeconds: getElapsedSeconds(s),
    timeExpired: !!s.timeExpired,
    correct: s.firstTryCorrect || 0,
    wrongQuestions: wrongInSession.length,
    wrongAttempts: s.totalWrongAttempts,
    practiceQuestions: s.mode === 'practice-wrong' ? (s.practiceInitialCount || s.items.length) : 0,
    firstTryRate: (s.mode === 'practice-wrong' ? s.practiceInitialCount : s.items.length)
      ? Math.round((s.firstTryCorrect / (s.mode === 'practice-wrong' ? s.practiceInitialCount : s.items.length)) * 100)
      : 0,
    wrongList: wrongInSession,
    sequential: s.sequential,
    nextCursor: s.nextCursor,
    mode: s.mode
  };

  if (Number.isInteger(s.rangeStart) && Number.isInteger(s.rangeEnd) && wrongInSession.length) {
    if (!addWrongIndicesForRange(s.deckId, s.rangeStart, s.rangeEnd, wrongInSession.map((entry) => entry.originalIndex))) {
      toast('Không thể lưu câu sai riêng cho vùng câu hỏi này.');
    };
  };
  state._lastSummarySession = {
    deckId: s.deckId,
    mode: s.examMode || s.mode === 'exam' ? 'exam' : 'practice',
    sourceMode: s.mode,
    indices: [...new Set(s.pool.map((question) => question.originalIndex))],
    rangeStart: Number.isInteger(s.rangeStart) ? s.rangeStart : 1,
    rangeEnd: Number.isInteger(s.rangeEnd) ? s.rangeEnd : (state.decks[s.deckId] || []).length,
    requestedCount: s.items.length,
    timeLimit: Number.isInteger(s.timeLimit) ? s.timeLimit : 0
  };
  state._lastSummaryWrongIndices = wrongInSession.map((entry) => entry.originalIndex);
  state._lastSummaryRangeStart = Number.isInteger(s.rangeStart) ? s.rangeStart : null;
  state._lastSummaryRangeEnd = Number.isInteger(s.rangeEnd) ? s.rangeEnd : null;
  state._lastSummaryCount = Number.isInteger(s.requestedCount) ? s.requestedCount : s.items.length;

  const sessionCleared = clearSession(s.deckId);
  state.session = null;
  if (!sessionCleared) toast('Không thể xóa phiên đã lưu. Nếu tải lại trang, phiên cũ có thể xuất hiện lại.');
  showSummary(s.summary, s.deckId, s.mode);
};

function showSummary(summary, deckId, mode) {
  showScreen('summary');
  $('summary-title').textContent =
    mode === 'practice-wrong'
      ? 'Kết thúc luyện câu sai'
      : mode === 'practice-bookmarks'
        ? 'Hoàn thành ôn câu đã đánh dấu'
        : mode === 'search'
          ? 'Hoàn thành ôn kết quả tìm kiếm'
          : mode === 'exam'
            ? 'Kết quả thi thử'
            : 'Hoàn thành lượt ôn';
  const scoreVal = summary.score ?? formatScore(summary.correct, summary.total);
  const scoreNum = Number(String(scoreVal).replace(',', '.')) || 0;

  $('sum-total').textContent = String(summary.total);
  $('sum-score').textContent = `${scoreVal} / 10`;

  const scoreBig = $('sum-score-big');
  const ringFg = $('score-ring-fg');
  const circumference = 2 * Math.PI * 52;

  if (ringFg) {
    ringFg.style.strokeDasharray = `${circumference}`;
    ringFg.style.strokeDashoffset = `${circumference}`;
    ringFg.style.transition = 'none';
    ringFg.style.stroke = 'var(--primary)';
  };
  if (scoreBig) {
    scoreBig.textContent = '0';
    scoreBig.style.transform = 'scale(1)';
    scoreBig.style.color = 'var(--primary)';
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      animateScore(scoreNum, scoreVal, circumference);
    });
  });
  $('sum-time').textContent = formatTime(summary.elapsedSeconds || 0);
  $('sum-correct').textContent = String(summary.correct);
  $('sum-wrong-q').textContent = String(summary.wrongQuestions);
  $('sum-wrong-times').textContent = String(summary.wrongAttempts);
  $('sum-practice').textContent = String(summary.practiceQuestions || 0);
  $('sum-first').textContent = `${summary.firstTryRate}%`;

  const totalQuestions = (state.decks[deckId] || []).length;
  const progressAfterSession = getDeckProgress(deckId);
  const completedAfterSession = new Set(progressAfterSession.completed).size;
  $('summary-note').textContent = summary.timeExpired
    ? 'Đã hết giờ. Bài làm được tự động kết thúc; câu chưa trả lời đúng không được tính điểm.'
    : completedAfterSession >= totalQuestions
      ? `Bạn đã hoàn thành toàn bộ bộ đề ${DECKS[deckId].label}.`
      : summary.wrongQuestions === 0
        ? 'Xuất sắc! Bạn không mắc lỗi nào trong lượt này.'
        : 'Bạn có thể luyện lại các câu sai hoặc tiếp tục với những câu chưa hoàn thành.';

  const listCard = $('wrong-list-card');
  const list = $('wrong-list');
  list.replaceChildren();
  if (summary.wrongList.length) {
    listCard.hidden = false;
    for (const w of summary.wrongList) {
      const li = document.createElement('li');
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = `#${w.originalIndex + 1}`;
      li.append(idx, document.createTextNode(w.question));
      list.appendChild(li);
    };
  } else {
    listCard.hidden = true;
  };

  state.currentDeck = deckId;
  const retryButton = $('btn-sum-retry-session');
  retryButton.hidden = !['normal', 'exam'].includes(mode);
  retryButton.textContent = mode === 'exam' ? 'Thi lại lượt thi này' : 'Ôn lại lượt ôn này';

  const btnPractice = $('btn-sum-practice');
  const sessionWrong = [...new Set(summary.wrongList.map((entry) => entry.originalIndex))];
  state._lastSummaryWrongIndices = sessionWrong;
  btnPractice.hidden = sessionWrong.length === 0;
  btnPractice.textContent = `Luyện lại câu sai trong lượt này (${sessionWrong.length})`;

  const progress = getDeckProgress(deckId);
  const totalQ = (state.decks[deckId] || []).length;
  const btnContinue = $('btn-sum-continue');
  const rangeEnd = form.endQuestion;
  const nextIndex = Math.max(progress.sequentialCursor, form.startQuestion - 1);
  const canSeq = summary.sequential && nextIndex < rangeEnd;
  btnContinue.hidden = !canSeq;
  if (canSeq) {
    const left = rangeEnd - nextIndex;
    const settings = getSettings(deckId);
    const n = Math.min(settings.count || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự (${n} câu trong vùng)`;
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
  if (!state.decks[saved.deckId]) {
    clearSession(state.currentDeck);
    return false;
  };
  const fp = state.fingerprints[saved.deckId];
  const legacyCompatible = !saved.dataFingerprint && state.legacyFingerprintMatched[saved.deckId];
  const validPool = saved.pool.length > 0 && saved.pool.every((question) =>
    question && Number.isInteger(question.originalIndex) && question.originalIndex >= 0 &&
    typeof question.question === 'string' && Array.isArray(question.options) && question.options.length >= 2 &&
    Number.isInteger(question.correct) && question.correct >= 0 && question.correct < question.options.length
  );
  const poolMatchesCurrentData = saved.pool.every((question) => {
    const current = state.decks[saved.deckId][question.originalIndex];
    return current && current.question === question.question &&
      current.correct === question.correct &&
      JSON.stringify(current.options) === JSON.stringify(question.options);
  });
  const legacyPoolCompatible = !legacyCompatible || poolMatchesCurrentData;
  const validSession = validPool && poolMatchesCurrentData && legacyPoolCompatible && saved.items.length > 0 &&
    Number.isInteger(saved.viewIndex) && saved.viewIndex >= 0 && saved.viewIndex < saved.items.length &&
    Number.isInteger(saved.maxReached) && saved.maxReached >= 0 && saved.maxReached < saved.items.length &&
    saved.viewIndex <= saved.maxReached &&
    saved.items.every((item, index) => {
      if (!item || typeof item !== 'object' || !Number.isInteger(item.poolIdx) ||
          item.poolIdx < 0 || item.poolIdx >= saved.pool.length) return false;
      const question = saved.pool[item.poolIdx];
      return Array.isArray(item.optionOrder) && item.optionOrder.length === question.options.length &&
        (item.wrongOptions == null || (Array.isArray(item.wrongOptions) && item.wrongOptions.every((value) => Number.isInteger(value) && value >= 0 && value < question.options.length))) &&
        new Set(item.optionOrder).size === question.options.length &&
        item.optionOrder.every((index) => Number.isInteger(index) && index >= 0 && index < question.options.length) &&
        ['pending', 'wrong', 'correct'].includes(item.status) &&
        (index >= saved.maxReached || item.status === 'correct' || saved.mode === 'practice-wrong') &&
        (item.userAnswer == null || (Number.isInteger(item.userAnswer) && item.userAnswer >= 0 && item.userAnswer < item.optionOrder.length)) &&
        Number.isInteger(item.wrongCount) && item.wrongCount >= 0;
    });
  if (!validSession || (saved.dataFingerprint !== fp && !legacyCompatible)) {
    clearSession(state.currentDeck);
    return false;
  };
  if (legacyCompatible) saved.dataFingerprint = fp;
  const progress = getDeckProgress(saved.deckId);
  if (progress.dataFingerprint && progress.dataFingerprint !== fp && !legacyCompatible) {
    clearSession(state.currentDeck);
    return false;
  };
  saved.timeLimit = Number.isInteger(saved.timeLimit) && saved.timeLimit > 0 ? Math.min(1440, saved.timeLimit) : 0;
  saved.startedAt = Number.isFinite(saved.startedAt) && saved.startedAt > 0 ? saved.startedAt : Date.now();
  saved.deadlineAt = Number.isFinite(saved.deadlineAt) && saved.deadlineAt > 0
    ? saved.deadlineAt
    : (saved.timeLimit > 0 ? saved.startedAt + saved.timeLimit * 60000 : null);
  saved.timeExpired = !!saved.timeExpired;
  saved.practiceInitialCount = Number.isInteger(saved.practiceInitialCount) && saved.practiceInitialCount > 0
    ? saved.practiceInitialCount
    : (saved.mode === 'practice-wrong' ? saved.items.length : 0);
  saved.practiceCompletedIndices = Array.isArray(saved.practiceCompletedIndices)
    ? [...new Set(saved.practiceCompletedIndices.filter((index) => Number.isInteger(index) && index >= 0))]
    : [];
  saved.practiceWrongHistory = Array.isArray(saved.practiceWrongHistory)
    ? saved.practiceWrongHistory.filter((entry) => entry && Number.isInteger(entry.originalIndex) && entry.originalIndex >= 0 && typeof entry.question === 'string' && Number.isInteger(entry.wrongCount) && entry.wrongCount > 0)
    : [];
  for (const item of saved.items) {
    if (!Array.isArray(item.wrongOptions)) item.wrongOptions = [];
  };
  saved.completedInSession = saved.mode === 'practice-wrong'
    ? saved.practiceCompletedIndices.length
    : saved.items.filter((item) => item.status === 'correct').length;
  saved.totalWrongAttempts = Math.max(
    Number.isInteger(saved.totalWrongAttempts) ? saved.totalWrongAttempts : 0,
    saved.items.reduce((sum, item) => sum + Math.max(0, Number(item.wrongCount) || 0), 0)
  );
  saved.firstTryCorrect = Number.isInteger(saved.firstTryCorrect)
    ? saved.firstTryCorrect
    : saved.items.filter((item) => item.status === 'correct' && item.wrongCount === 0).length;
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

function initUI() {
  document.addEventListener('selectionchange', captureHighlightSelection);
  const captureAfterSelectionGesture = () => {
    captureHighlightSelection();
    requestAnimationFrame(captureHighlightSelection);
  };
  document.addEventListener('pointerup', captureAfterSelectionGesture, true);
  document.addEventListener('mouseup', captureAfterSelectionGesture, true);
  document.addEventListener('touchend', captureAfterSelectionGesture, true);
  $('btn-highlight-toggle')?.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') event.preventDefault();
  });
  $('btn-highlight-toggle')?.addEventListener('mousedown', (event) => event.preventDefault());
  $('btn-highlight-toggle')?.addEventListener('click', () => {
    captureHighlightSelection();
    const q = currentQ();
    const s = state.session;
    const selection = state.lastTextSelection;
    if (!q || !s || s.examMode || !selection || selection.questionIndex !== q.originalIndex || selection.deckId !== s.deckId) {
      toast('Hãy bôi đen đoạn chữ trong câu hỏi hoặc đáp án trước.');
      return;
    };
    toggleHighlightSelection(selection.deckId, q.originalIndex, selection);
  });
  const active = getSettings();
  state.currentDeck = active.deck === 'quocphong2' ? 'quocphong2' : 'quocphong1';
  const settings = getSettings(state.currentDeck);
  applySettingsToForm(settings);
  showScreen('setup');
  refreshSetupUI();
};

function applyTheme() {
  document.documentElement.dataset.theme = 'dark';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = '#07111f';
};

function initTheme() {
  applyTheme();
};

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!$('modal').hidden) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const quizActive = $('screen-quiz') && !$('screen-quiz').hidden;
    const examActive = $('screen-exam') && !$('screen-exam').hidden;

    if (examActive) {
      if (event.key === 'Escape') {
        event.preventDefault();
        $('btn-exam-quit')?.click();
        return;
      };
      if ((event.key === 'Enter' || event.key === 's') && !state.session?.reviewMode) {
        event.preventDefault();
        $('btn-exam-submit')?.click();
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
      const option = $('options').querySelectorAll('.option')[Number(event.key) - 1];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      };
      return;
    };
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!$('btn-next').disabled) $('btn-next').click();
      return;
    };
    if (event.key === 'ArrowLeft' && !$('btn-prev').disabled) {
      event.preventDefault();
      $('btn-prev').click();
    } else if (event.key === 'ArrowRight' && !$('btn-next').disabled) {
      event.preventDefault();
      $('btn-next').click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      $('btn-quit').click();
    };
  });
};

function bindEvents() {
  bindKeyboardShortcuts();

  document.querySelectorAll('.deck-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.currentDeck === btn.dataset.deck) return;
      persistSetupForm();
      state.currentDeck = btn.dataset.deck;
      applySettingsToForm(getSettings(state.currentDeck));
      refreshSetupUI();
      persistSetupForm();
    });
  });

  $('btn-all').addEventListener('click', () => {
    const form = readSetupForm();
    $('input-count').value = String(Math.max(1, form.endQuestion - form.startQuestion + 1));
    persistSetupForm();
    refreshSetupUI();
  });

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = readSetupForm();
      const max = Math.max(1, form.endQuestion - form.startQuestion + 1);
      const n = Math.min(Number(btn.dataset.count) || 20, max);
      $('input-count').value = String(n);
      persistSetupForm();
      refreshSetupUI();
    });
  });

  $('btn-resume-session')?.addEventListener('click', () => {
    if (!restoreSessionIfAny()) toast('Không còn phiên để tiếp tục.');
    else refreshSetupUI();
  });
  $('btn-discard-session')?.addEventListener('click', async () => {
    const ok = await confirmModal('Bỏ phiên đang dở?', 'Phiên làm bài hiện tại sẽ bị xóa. Tiến độ bộ đề đã lưu vẫn giữ nguyên.');
    if (!ok) return;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    refreshResumeCard();
    toast('Đã bỏ phiên cũ.');
  });

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.examFilter = chip.dataset.filter || 'all';
      applyExamFilter();
      updateExamProgressHeader();
    });
  });
  $('btn-exam-next-empty')?.addEventListener('click', () => jumpToNextUnanswered());

  $('input-count').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
  });

  $('input-time-limit').addEventListener('change', () => {
    const value = Number.parseInt($('input-time-limit').value, 10);
    $('input-time-limit').value = String(Number.isInteger(value) && value >= 0 ? Math.min(1440, value) : 0);
    persistSetupForm();
  });

  for (const id of ['input-range-start', 'input-range-end']) {
    $(id).addEventListener('change', () => {
      const total = currentQuestions().length;
      let start = Number.parseInt($('input-range-start').value, 10);
      let end = Number.parseInt($('input-range-end').value, 10);
      if (!Number.isInteger(start)) start = 1;
      if (!Number.isInteger(end)) end = total;
      start = Math.max(1, Math.min(start, Math.max(1, total)));
      end = Math.max(start, Math.min(end, Math.max(1, total)));
      $('input-range-start').value = String(start);
      $('input-range-end').value = String(end);
      refreshSetupUI();
      persistSetupForm();
    });
  };

  $('chk-shuffle-q').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
  });

  $('chk-shuffle-a').addEventListener('change', () => {
    $('chk-shuffle-a').dataset.userTouched = '1';
    persistSetupForm();
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPracticeMode(btn.dataset.mode));
  });

  $('btn-view-bank').addEventListener('click', openQuestionBank);
  $('btn-review-back').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
  });
  $('input-review-search').addEventListener('input', () => {
    state.reviewSearch = $('input-review-search').value;
    renderQuestionBank();
  });
  $('btn-review-select-mode').addEventListener('click', () => {
    state.reviewSelectMode = !state.reviewSelectMode;
    renderQuestionBank();
  });
  $('btn-review-start-selected').addEventListener('click', () => {
    const form = readSetupForm();
    const selected = currentQuestions().filter((question) =>
      state.reviewSelectedIndices.has(question.originalIndex) &&
      question.originalIndex >= form.startQuestion - 1 &&
      question.originalIndex < form.endQuestion
    );
    if (!selected.length) {
      toast('Hãy chọn ít nhất một câu hỏi.');
      return;
    };
    $('input-count').value = String(selected.length);
    persistSetupForm();
    const selectedIndices = selected.map((question) => question.originalIndex);
    const pool = selected.slice();
    state.reviewSelectedIndices.clear();
    state.reviewSelectMode = false;
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      rangeStart: Math.min(...selectedIndices) + 1,
      rangeEnd: Math.max(...selectedIndices) + 1,
      requestedCount: selected.length,
      examMode: state.practiceMode === 'exam',
      forceShuffleQ: form.shuffleQ,
      alreadyShuffled: false
    });
  });
  $('btn-review-goto').addEventListener('click', () => {
    const n = Number.parseInt($('input-review-goto').value, 10);
    const total = currentQuestions().length;
    if (!Number.isInteger(n) || n < 1 || n > total) {
      toast(`Nhập số câu từ 1 đến ${total}.`);
      return;
    };
    if (state.reviewSelectMode) {
      const form = readSetupForm();
      if (n < form.startQuestion || n > form.endQuestion) {
        toast(`Câu này nằm ngoài vùng ${form.startQuestion}–${form.endQuestion} đang chọn.`);
        return;
      };
    };
    const target = `review-question-${n}`;
    if (!$(target)) {
      state.reviewSearch = '';
      $('input-review-search').value = '';
      renderQuestionBank();
    };
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById(target)?.classList.add('review-q-highlight');
  });
  $('input-review-goto').addEventListener('input', (event) => {
    const input = event.currentTarget;
    if (input.value === '') return;
    const total = currentQuestions().length;
    const value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value)) return;
    input.value = String(Math.min(Math.max(value, 1), Math.max(1, total)));
  });
  $('input-review-goto').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('btn-review-goto').click();
  });

  $('btn-start').addEventListener('click', () => startNormal({ sequential: false }));
  $('btn-continue').addEventListener('click', () => startNormal({ sequential: true }));
  $('btn-practice-wrong').addEventListener('click', () => {
    setPracticeMode('practice');
    startPracticeWrong();
  });
  $('btn-practice-all-wrong').addEventListener('click', () => {
    setPracticeMode('practice');
    startPracticeWrong({ allDeck: true });
  });
  $('btn-practice-bookmarks').addEventListener('click', () => {
    setPracticeMode('practice');
    startPracticeBookmarks();
  });
  $('btn-search-practice').addEventListener('click', () => {
    setPracticeMode('practice');
    startSearchResults();
  });
  $('input-search').addEventListener('input', () => refreshSearchUI());

  $('btn-exam-submit')?.addEventListener('click', () => onExamSubmit());
  $('btn-exam-quit')?.addEventListener('click', async () => {
    const s = state.session;
    const reviewing = s?.reviewMode;
    const ok = await confirmModal(
      reviewing ? 'Thoát kết quả thi?' : 'Thoát bài thi?',
      reviewing
        ? 'Bạn sẽ quay về màn hình thiết lập. Kết quả lần thi này không lưu lại phiên đang mở.'
        : 'Phiên thi hiện tại sẽ bị đóng. Tiến độ bộ đề (câu đã hoàn thành, câu sai) vẫn được giữ nếu bạn đã nộp bài.'
    );
    if (!ok) return;
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    clearSession(state.currentDeck);
    state.session = null;
    state.reviewMode = false;
    showScreen('setup');
    refreshSetupUI();
  });

  $('btn-bookmark').addEventListener('click', () => {
    const q = currentQ();
    const s = state.session;
    if (!q || !s) return;
    const result = toggleBookmark(s.deckId, q.originalIndex);
    if (result == null) {
      toast('Không thể lưu dấu trang. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
      return;
    };
    renderQuestion();
    toast(result ? 'Đã đánh dấu câu hỏi.' : 'Đã bỏ đánh dấu câu hỏi.');
  });

  $('btn-export-progress').addEventListener('click', () => {
    try {
      const content = exportBackup();
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `quocphonganninh-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Đã tạo tệp sao lưu tiến độ.');
    } catch {
      toast('Không thể tạo tệp sao lưu trên trình duyệt này.');
    };
  });

  $('btn-import-progress').addEventListener('click', () => $('input-import-progress').click());
  $('input-import-progress').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('Tệp sao lưu quá lớn hoặc không hợp lệ.');
      return;
    };
    const ok = await confirmModal(
      'Khôi phục tiến độ?',
      'Tiến độ đang lưu trên thiết bị này sẽ được thay bằng dữ liệu trong tệp sao lưu. Hãy chắc chắn bạn đã sao lưu dữ liệu hiện tại nếu cần.'
    );
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

  $('btn-reset-progress').addEventListener('click', async () => {
    const ok = await confirmModal(
      'Xóa tiến độ?',
      `Xóa toàn bộ tiến độ, câu đã hoàn thành và lịch sử câu sai của bộ ${DECKS[state.currentDeck].label} trên trình duyệt này.`
    );
    if (!ok) return;
    if (!resetDeckProgress(state.currentDeck)) {
      toast('Không thể xóa tiến độ. Hãy kiểm tra quyền lưu trữ của trình duyệt.');
      return;
    };
    toast('Đã xóa tiến độ bộ đề.');
    refreshSetupUI();
  });

  $('btn-next').addEventListener('click', onNext);
  $('btn-prev').addEventListener('click', onPrev);

  $('btn-quit').addEventListener('click', async () => {
    const ok = await confirmModal(
      'Thoát lượt ôn?',
      'Phiên ôn hiện tại sẽ bị đóng. Tiến độ các lượt đã hoàn thành và lịch sử câu sai vẫn được giữ trên trình duyệt.'
    );
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

  $('btn-sum-retry-session').addEventListener('click', () => {
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
    $('input-range-start').value = String(previous.rangeStart);
    $('input-range-end').value = String(previous.rangeEnd);
    $('input-count').value = String(pool.length);
    $('input-time-limit').value = String(previous.timeLimit);
    $('chk-shuffle-q').checked = true;
    $('chk-shuffle-a').checked = true;
    setPracticeMode(previous.mode === 'exam' ? 'exam' : 'practice');
    persistSetupForm();
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      rangeStart: previous.rangeStart,
      rangeEnd: previous.rangeEnd,
      requestedCount: pool.length,
      examMode: previous.mode === 'exam',
      forceShuffleQ: true,
      alreadyShuffled: false
    });
  });

  $('btn-sum-home').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
  });

  $('btn-sum-again').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
    $('input-count').focus();
  });

  $('btn-sum-restart').addEventListener('click', async () => {
    const ok = await confirmModal(
      'Làm lại từ đầu?',
      'Tiến độ hoàn thành của bộ đề sẽ được đặt lại để bạn ôn tuần tự từ câu đầu. Lịch sử câu sai vẫn được giữ.'
    );
    if (!ok) return;
    const progress = getDeckProgress(state.currentDeck);
    progress.completed = [];
    progress.sequentialCursor = 0;
    if (!saveDeckProgress(state.currentDeck, progress)) {
      toast('Không thể đặt lại tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.');
      return;
    };
    $('chk-shuffle-q').checked = false;
    persistSetupForm();
    showScreen('setup');
    refreshSetupUI();
    startNormal({ restart: true });
  });

  $('btn-sum-continue').addEventListener('click', () => {
    showScreen('setup');
    refreshSetupUI();
    startNormal({ sequential: true });
  });

  $('btn-sum-random').addEventListener('click', () => {
    $('chk-shuffle-q').checked = true;
    persistSetupForm();
    showScreen('setup');
    refreshSetupUI();
    startNormal({ sequential: false });
  });

  $('btn-sum-practice').addEventListener('click', () => {
    if (state._lastSummaryDeck) state.currentDeck = state._lastSummaryDeck;
    if (Number.isInteger(state._lastSummaryRangeStart) && Number.isInteger(state._lastSummaryRangeEnd)) {
      $('input-range-start').value = String(state._lastSummaryRangeStart);
      $('input-range-end').value = String(state._lastSummaryRangeEnd);
    };
    if (Number.isInteger(state._lastSummaryCount) && state._lastSummaryCount > 0) {
      $('input-count').value = String(state._lastSummaryCount);
    };
    setPracticeMode('practice');
    showScreen('setup');
    refreshSetupUI();
    startPracticeWrong({ indices: state._lastSummaryWrongIndices });
  });

  $('btn-retry').addEventListener('click', () => {
    showScreen('setup');
    loadAll();
  });

  $('btn-update').addEventListener('click', async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting) {
      reloadAfterUpdate = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      location.reload();
    };
  });
};

let reloadAfterUpdate = false;

function registerSW() {
  if (!('serviceWorker' in navigator)) {
    toast('Trình duyệt này không hỗ trợ chế độ ngoại tuyến.');
    return;
  };
  const swUrl = new URL('sw.js', document.baseURI).href;
  const scope = new URL('.', document.baseURI).href;
  navigator.serviceWorker
    .register(swUrl, { scope })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) $('update-banner').hidden = false;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            $('update-banner').hidden = false;
          } else if (nw.state === 'redundant') {
            toast('Không thể cài bản ngoại tuyến mới. Hãy kiểm tra kết nối và tải lại trang khi có mạng.');
          };
        });
      });
    })
    .catch(() => {
      toast('Không thể bật chế độ ngoại tuyến.');
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAfterUpdate || refreshing) return;
    refreshing = true;
    location.reload();
  });
};

function boot() {
  initTheme();
  if (!storageAvailable()) {
    toast('Trình duyệt hạn chế lưu trữ. Tiến độ có thể không được ghi nhớ.');
  };
  bindEvents();

  window.addEventListener('pagehide', () => {
    persistSession();
  });

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

  registerSW();
  loadAll();
};

boot();