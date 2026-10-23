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
  storageAvailable
} from './storage.js';
import {
  fingerprintQuestions,
  normalizeQuestions,
  createSessionItems,
  pickSequential,
  pickRandom,
  pickWrong,
  isAnswerCorrect,
  displayedCorrectIndex
} from './quiz.js';

const DECKS = {
  qp1: { id: 'qp1', label: 'Quốc phòng 1', file: 'data/quocphong1.json' },
  qp2: { id: 'qp2', label: 'Quốc phòng 2', file: 'data/quocphong2.json' }
};

const state = {
  decks: { qp1: null, qp2: null },
  fingerprints: { qp1: '', qp2: '' },
  legacyFingerprintMatched: { qp1: false, qp2: false },
  loading: true,
  error: null,
  currentDeck: 'qp1',
  mode: 'setup',
  session: null,
  reviewMode: false
};

const $ = (id) => document.getElementById(id);

function dataUrl(rel) {
  return new URL(rel, document.baseURI).href;
}

async function loadDeck(id) {
  const meta = DECKS[id];
  const url = dataUrl(meta.file);
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new Error(`Không thể tải ${meta.label}. Hãy kiểm tra kết nối mạng hoặc mở website online ít nhất một lần để lưu dữ liệu offline.`);
  }
  if (!res.ok) throw new Error(`Không tải được ${meta.label} (HTTP ${res.status}). Hãy kiểm tra vị trí file JSON.`);
  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new Error(`File dữ liệu ${meta.file} không phải JSON hợp lệ.`);
  }
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
      progress.practiceMap = {};
      progress.dataFingerprint = fp;
      if (!saveDeckProgress(id, progress)) toast('Không thể lưu tiến độ vì bộ nhớ trình duyệt đã đầy hoặc bị chặn.');
    }
  } else if (!progress.dataFingerprint) {
    progress.dataFingerprint = fp;
    if (!saveDeckProgress(id, progress)) toast('Không thể lưu dấu vân tay bộ đề vào trình duyệt.');
  }
  return questions;
}

async function loadAll() {
  state.loading = true;
  state.error = null;
  try {
    await Promise.all([loadDeck('qp1'), loadDeck('qp2')]);
    state.loading = false;
    initUI();
  } catch (e) {
    state.loading = false;
    state.error = e.message || String(e);
    showScreen('error');
    $('error-message').textContent = state.error + '\n\nNếu bạn đang offline lần đầu, hãy kết nối mạng để tải bộ đề.';
  }
}

function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.remove('active');
    el.hidden = true;
  }
  const screen = $(`screen-${name}`);
  if (screen) {
    screen.hidden = false;
    screen.classList.add('active');
  }
  state.mode = name;
}

function toast(msg, ms = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

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
    ok.onclick = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
  });
}

function currentQuestions() {
  return state.decks[state.currentDeck] || [];
}

function refreshSetupUI() {
  const qs = currentQuestions();
  const total = qs.length;
  $('count-qp1').textContent = `${state.decks.qp1?.length ?? '—'} câu`;
  $('count-qp2').textContent = `${state.decks.qp2?.length ?? '—'} câu`;

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
  if (progress.sequentialCursor >= total) {
    $('stat-cursor').textContent = 'Đã hết (làm lại từ đầu)';
  } else {
    $('stat-cursor').textContent = String(progress.sequentialCursor + 1);
  }

  const btnWrong = $('btn-practice-wrong');
  const rangeWrongCount = wrongs.filter((index) => index >= start - 1 && index < end).length;
  btnWrong.disabled = rangeWrongCount === 0;
  btnWrong.textContent = `Luyện câu sai trong vùng (${rangeWrongCount})`;

  const rangeQuestions = qs.filter((question) => question.originalIndex >= start - 1 && question.originalIndex < end);
  const rangeRemaining = rangeQuestions.filter((question) => !completed.has(question.originalIndex)).length;
  const shuffleQ = $('chk-shuffle-q').checked;
  const btnContinue = $('btn-continue');
  const nextIndex = Math.max(progress.sequentialCursor, start - 1);
  const canContinue = !shuffleQ && nextIndex < end && rangeRemaining > 0;
  btnContinue.hidden = !canContinue;
  if (canContinue) {
    const left = end - nextIndex;
    const n = Math.min(Number(input.value) || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự (${n} câu từ vị trí ${nextIndex + 1})`;
  }
}

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
  const shuffleQ = $('chk-shuffle-q').checked;
  const shuffleA = $('chk-shuffle-a').checked;
  return { count, shuffleQ, shuffleA, startQuestion, endQuestion };
}

function persistSetupForm() {
  const form = readSetupForm();
  const saved = saveSettings({
    deck: state.currentDeck,
    count: form.count,
    shuffleQ: form.shuffleQ,
    shuffleA: form.shuffleA,
    startQuestion: form.startQuestion,
    endQuestion: form.endQuestion
  });
  if (!saved) toast('Không thể lưu tùy chọn. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
}

function selectedQuestions(form = readSetupForm()) {
  return currentQuestions().filter((question) =>
    question.originalIndex >= form.startQuestion - 1 &&
    question.originalIndex < form.endQuestion
  );
}
function startSessionFromPool(pool, meta) {
  const form = readSetupForm();
  const shuffleA = form.shuffleA;
  const shuffleQ = meta.forceShuffleQ != null ? meta.forceShuffleQ : form.shuffleQ;
  const items = createSessionItems(pool, { shuffleQ: false, shuffleA });
  const session = {
    deckId: state.currentDeck,
    dataFingerprint: state.fingerprints[state.currentDeck],
    mode: meta.mode || 'normal',
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
    totalWrongAttempts: 0
  };
  state.session = session;
  state.reviewMode = false;
  if (!saveSession(session)) toast('Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.');
  showScreen('quiz');
  renderQuestion();
}

function startNormal(opts = {}) {
  const allQuestions = currentQuestions();
  if (!allQuestions.length) {
    toast('Bộ đề trống.');
    return;
  }
  const form = readSetupForm();
  const qs = selectedQuestions(form);
  if (!qs.length) {
    toast('Vùng câu hỏi đã chọn không có câu hợp lệ.');
    return;
  }
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
  }

  if (opts.sequential) {
    const cursor = Math.max(progress.sequentialCursor, rangeStart);
    if (cursor >= rangeEnd) {
      toast('Đã hết câu tuần tự trong vùng đã chọn. Hãy đổi vùng hoặc làm lại từ đầu.');
      return;
    }
    const scanQuestions = qs.filter((question) => question.originalIndex >= cursor);
    const { items, nextCursor, actualCount } = pickSequential(scanQuestions, 0, form.count, completedSet);
    if (!items.length) {
      toast('Không còn câu tuần tự trong vùng đã chọn.');
      return;
    }
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
  }

  if (form.shuffleQ) {
    const remainingCount = qs.filter((question) => !completedSet.has(question.originalIndex)).length;
    const pool = pickRandom(qs, form.count, true, completedSet);
    if (!pool.length) {
      toast('Không lấy được câu hỏi trong vùng đã chọn.');
      return;
    }
    if (remainingCount === 0) {
      toast('Bạn đã hoàn thành các câu trong vùng này; lượt này lấy ngẫu nhiên trong vùng đã chọn.');
    } else if (remainingCount < form.count) {
      toast(`Chỉ còn ${remainingCount} câu chưa hoàn thành trong vùng; đã bổ sung câu đã làm để đủ ${pool.length} câu.`);
    }
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true
    });
    return;
  }

  const cursor = Math.max(progress.sequentialCursor, rangeStart);
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
  }
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
}
function startPracticeWrong() {
  const form = readSetupForm();
  persistSetupForm();
  const qs = selectedQuestions(form);
  const rangeIndices = new Set(qs.map((question) => question.originalIndex));
  const wrongs = getWrongIndices(state.currentDeck).filter((index) => rangeIndices.has(index));
  if (!wrongs.length) {
    toast('Trong vùng câu hỏi đã chọn không có câu sai để luyện.');
    return;
  }
  const pool = pickWrong(qs, wrongs, form.count, form.shuffleQ);
  if (!pool.length) {
    toast('Không tìm thấy câu sai hợp lệ trong vùng đã chọn. Hãy tải lại bộ đề.');
    return;
  }
  const practiceSaveFailed = pool.some((question) => markPracticed(state.currentDeck, question.originalIndex) === null);
  if (practiceSaveFailed) toast('Không thể lưu thống kê luyện lại vào trình duyệt.');
  startSessionFromPool(pool, {
    mode: 'practice-wrong',
    sequential: false,
    forceShuffleQ: form.shuffleQ,
    alreadyShuffled: true
  });
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

  $('progress-label').textContent = s.mode === 'practice-wrong'
    ? `Câu ${s.viewIndex + 1} / ${s.items.length} · Còn ${s.items.filter((entry) => entry.status !== 'correct').length} câu cần đúng`
    : `Câu ${s.viewIndex + 1} / ${s.items.length}`;
  $('progress-score').textContent = `Đúng ${s.completedInSession}`;
  const progressTotal = s.mode === 'practice-wrong' ? (s.practiceInitialCount || s.items.length) : s.items.length;
  const pct = progressTotal ? Math.round((s.completedInSession / progressTotal) * 100) : 0;
  $('progress-fill').style.width = `${pct}%`;
  $('progress-fill').parentElement.setAttribute('aria-valuenow', String(pct));

  $('q-badge').textContent =
    s.mode === 'practice-wrong'
      ? `Luyện câu sai · Gốc #${q.originalIndex + 1}`
      : `Câu hỏi · Gốc #${q.originalIndex + 1}`;
  $('q-text').textContent = q.question;

  const optsEl = $('options');
  optsEl.replaceChildren();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  item.optionOrder.forEach((origIdx, displayIdx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(item.userAnswer === displayIdx));
    btn.dataset.display = String(displayIdx);

    if (item.userAnswer === displayIdx) btn.classList.add('selected');
    if (item.checked && item.status === 'correct' && displayIdx === item.userAnswer) {
      btn.classList.add('correct');
    }
    if (item.checked && item.status === 'wrong' && displayIdx === item.userAnswer) {
      btn.classList.add('incorrect');
    }
    if (item.status === 'correct') {
      btn.classList.add('locked');
      btn.disabled = true;
      if (displayIdx === displayedCorrectIndex(item, q)) btn.classList.add('correct');
    } else if (viewingHistory) {
      btn.disabled = true;
      btn.classList.add('locked');
    }

    const key = document.createElement('span');
    key.className = 'option-key';
    key.textContent = labels[displayIdx] || String(displayIdx + 1);
    const text = document.createElement('span');
    text.className = 'option-text';
    text.textContent = q.options[origIdx];
    btn.append(key, text);

    if (!btn.disabled) {
      btn.addEventListener('click', () => onSelectOption(displayIdx));
    }
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
  }

  $('btn-prev').disabled = s.viewIndex <= 0;
  const canCheck = item.userAnswer != null && item.status !== 'correct' && !viewingHistory;
  $('btn-check').disabled = !canCheck;
  const canNext =
    item.status === 'correct' && s.viewIndex < s.items.length - 1
      ? true
      : item.status === 'correct' && s.viewIndex === s.items.length - 1
        ? true
        : viewingHistory && s.viewIndex < s.maxReached;
  if (viewingHistory) {
    $('btn-next').disabled = false;
    $('btn-check').disabled = true;
  } else {
    $('btn-next').disabled = item.status !== 'correct' &&
      !(s.mode === 'practice-wrong' && item.status === 'wrong');
  }
}

function onSelectOption(displayIdx) {
  const s = state.session;
  const item = currentItem();
  if (!s || !item) return;
  if (item.status === 'correct' || s.viewIndex < s.maxReached) return;

  item.userAnswer = displayIdx;
  if (item.status === 'wrong') {
    item.checked = false;
    item.status = 'pending';
  }
  persistSession();
  renderQuestion();
}

function onCheck() {
  const s = state.session;
  const item = currentItem();
  const q = currentQ();
  if (!s || !item || !q || item.userAnswer == null) return;
  if (item.status === 'correct' || s.viewIndex < s.maxReached) return;

  item.checked = true;
  if (isAnswerCorrect(item, q)) {
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
        }
      } else {
        s.completedInSession += 1;
        if (firstTime) s.firstTryCorrect += 1;
      }
    }
    if (s.viewIndex >= s.maxReached) s.maxReached = s.viewIndex;
    s.reviewingPast = false;
  } else {
    item.status = 'wrong';
    item.wrongCount += 1;
    s.totalWrongAttempts += 1;
    if (s.mode === 'practice-wrong') {
      if (!Array.isArray(s.practiceWrongHistory)) s.practiceWrongHistory = [];
      const history = s.practiceWrongHistory.find((entry) => entry.originalIndex === q.originalIndex);
      if (history) history.wrongCount += 1;
      else s.practiceWrongHistory.push({ originalIndex: q.originalIndex, question: q.question, wrongCount: 1 });
    }
    if (markWrong(s.deckId, q.originalIndex) === null) toast('Không thể lưu lịch sử câu sai vào trình duyệt.');
  }
  persistSession();
  renderQuestion();

  const roundComplete = s.items.every((entry) => entry.status === 'correct');
  if (item.status === 'correct' && roundComplete && s.mode !== 'practice-wrong') {
    setTimeout(() => finishSession(), 400);
  }
}

function onNext() {
  const s = state.session;
  if (!s) return;
  const item = currentItem();

  if (s.viewIndex < s.maxReached) {
    s.viewIndex += 1;
    s.reviewingPast = s.viewIndex < s.maxReached;
    persistSession();
    renderQuestion();
    return;
  }

  if (item.status !== 'correct' && !(s.mode === 'practice-wrong' && item.status === 'wrong')) {
    toast('Hãy kiểm tra câu trả lời trước khi sang câu tiếp.');
    return;
  }

  if (s.viewIndex >= s.items.length - 1) {
    if (s.mode === 'practice-wrong') {
      const unresolved = s.items.filter((entry) => entry.status !== 'correct');
      if (!unresolved.length) {
        finishSession();
        return;
      }
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
  const s = state.session;
  if (!s || s.viewIndex <= 0) return;
  s.viewIndex -= 1;
  s.reviewingPast = true;
  persistSession();
  renderQuestion();
}

function persistSession() {
  if (state.session && !saveSession(state.session)) {
    toast('Không thể lưu phiên ôn. Nếu tải lại trang, tiến độ hiện tại có thể mất.');
  }
}

function finishSession() {
  const s = state.session;
  if (!s) return;

  if (s.mode === 'normal') {
    const completedIdx = s.items
      .filter((it) => it.status === 'correct')
      .map((it) => s.pool[it.poolIdx].originalIndex);
    const progressSaved = addCompleted(s.deckId, completedIdx, state.fingerprints[s.deckId]);
    if (!progressSaved) {
      toast('Không thể lưu tiến độ hoàn thành. Hãy kiểm tra dung lượng bộ nhớ trình duyệt.');
    } else if (s.sequential && s.nextCursor != null &&
      !setSequentialCursor(s.deckId, s.nextCursor, state.fingerprints[s.deckId])) {
      toast('Không thể lưu vị trí tuần tự của bộ đề.');
    }
  }

  const wrongInSession = [];
  const seen = new Set();
  if (s.mode === 'practice-wrong' && Array.isArray(s.practiceWrongHistory)) {
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
            wrongCount: it.wrongCount
          });
        }
      }
    }
  }

  s.summary = {
    total: s.mode === 'practice-wrong' ? (s.practiceInitialCount || s.items.length) : s.items.length,
    correct: s.completedInSession,
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

  clearSession();
  state.session = null;
  showSummary(s.summary, s.deckId, s.mode);
}

function showSummary(summary, deckId, mode) {
  showScreen('summary');
  $('summary-title').textContent =
    mode === 'practice-wrong' ? 'Kết thúc luyện câu sai' : 'Hoàn thành lượt ôn';
  $('sum-total').textContent = String(summary.total);
  $('sum-correct').textContent = String(summary.correct);
  $('sum-wrong-q').textContent = String(summary.wrongQuestions);
  $('sum-wrong-times').textContent = String(summary.wrongAttempts);
  $('sum-practice').textContent = String(summary.practiceQuestions || 0);
  $('sum-first').textContent = `${summary.firstTryRate}%`;

  const totalQuestions = (state.decks[deckId] || []).length;
  const progressAfterSession = getDeckProgress(deckId);
  const completedAfterSession = new Set(progressAfterSession.completed).size;
  $('summary-note').textContent = completedAfterSession >= totalQuestions
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
    }
  } else {
    listCard.hidden = true;
  }

  const btnPractice = $('btn-sum-practice');
  const allWrong = getWrongIndices(deckId);
  btnPractice.hidden = allWrong.length === 0;
  btnPractice.textContent = `Luyện lại câu sai (${allWrong.length})`;

  const progress = getDeckProgress(deckId);
  const totalQ = (state.decks[deckId] || []).length;
  const btnContinue = $('btn-sum-continue');
  const canSeq = summary.sequential && progress.sequentialCursor < totalQ;
  btnContinue.hidden = !canSeq;
  if (canSeq) {
    const left = totalQ - progress.sequentialCursor;
    const settings = getSettings();
    const n = Math.min(settings.count || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự (${n} câu)`;
  }

  state._lastSummaryDeck = deckId;
}

function restoreSessionIfAny() {
  const saved = getSession();
  if (!saved || !['qp1', 'qp2'].includes(saved.deckId) || !Array.isArray(saved.items) || !Array.isArray(saved.pool)) return false;
  if (!state.decks[saved.deckId]) return false;
  const fp = state.fingerprints[saved.deckId];
  const legacyCompatible = !saved.dataFingerprint && state.legacyFingerprintMatched[saved.deckId];
  const validPool = saved.pool.length > 0 && saved.pool.every((question) =>
    question && Number.isInteger(question.originalIndex) && question.originalIndex >= 0 &&
    typeof question.question === 'string' && Array.isArray(question.options) && question.options.length >= 2 &&
    Number.isInteger(question.correct) && question.correct >= 0 && question.correct < question.options.length
  );
  const legacyPoolCompatible = !legacyCompatible || saved.pool.every((question) => {
    const current = state.decks[saved.deckId][question.originalIndex];
    return current && current.question.trim() === question.question.trim() &&
      current.correct === question.correct &&
      JSON.stringify(current.options) === JSON.stringify(question.options);
  });
  const validSession = validPool && legacyPoolCompatible && saved.items.length > 0 &&
    Number.isInteger(saved.viewIndex) && saved.viewIndex >= 0 && saved.viewIndex < saved.items.length &&
    Number.isInteger(saved.maxReached) && saved.maxReached >= 0 && saved.maxReached < saved.items.length &&
    saved.viewIndex <= saved.maxReached &&
    saved.items.every((item, index) => {
      if (!item || typeof item !== 'object' || !Number.isInteger(item.poolIdx) ||
          item.poolIdx < 0 || item.poolIdx >= saved.pool.length) return false;
      const question = saved.pool[item.poolIdx];
      return Array.isArray(item.optionOrder) && item.optionOrder.length === question.options.length &&
        new Set(item.optionOrder).size === question.options.length &&
        item.optionOrder.every((index) => Number.isInteger(index) && index >= 0 && index < question.options.length) &&
        ['pending', 'wrong', 'correct'].includes(item.status) &&
        (index >= saved.maxReached || item.status === 'correct' || saved.mode === 'practice-wrong') &&
        (item.userAnswer == null || (Number.isInteger(item.userAnswer) && item.userAnswer >= 0 && item.userAnswer < item.optionOrder.length)) &&
        Number.isInteger(item.wrongCount) && item.wrongCount >= 0;
    });
  if (!validSession || (saved.dataFingerprint !== fp && !legacyCompatible)) {
    clearSession();
    return false;
  }
  if (legacyCompatible) saved.dataFingerprint = fp;
  const progress = getDeckProgress(saved.deckId);
  if (progress.dataFingerprint && progress.dataFingerprint !== fp && !legacyCompatible) {
    clearSession();
    return false;
  }
  saved.practiceInitialCount = Number.isInteger(saved.practiceInitialCount) && saved.practiceInitialCount > 0
    ? saved.practiceInitialCount
    : (saved.mode === 'practice-wrong' ? saved.items.length : 0);
  saved.practiceCompletedIndices = Array.isArray(saved.practiceCompletedIndices)
    ? [...new Set(saved.practiceCompletedIndices.filter((index) => Number.isInteger(index) && index >= 0))]
    : [];
  saved.practiceWrongHistory = Array.isArray(saved.practiceWrongHistory)
    ? saved.practiceWrongHistory.filter((entry) => entry && Number.isInteger(entry.originalIndex) && entry.originalIndex >= 0 && typeof entry.question === 'string' && Number.isInteger(entry.wrongCount) && entry.wrongCount > 0)
    : [];
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
  state.currentDeck = saved.deckId;
  state.session = saved;
  showScreen('quiz');
  renderQuestion();
  toast('Đã khôi phục lượt ôn đang làm.');
  return true;
}

function initUI() {
  const settings = getSettings();
  state.currentDeck = settings.deck === 'qp2' ? 'qp2' : 'qp1';
  $('input-count').value = String(settings.count || 20);
  $('input-range-start').value = String(settings.startQuestion || 1);
  $('input-range-end').value = String(settings.endQuestion || state.decks[state.currentDeck]?.length || 1);
  $('chk-shuffle-q').checked = !!settings.shuffleQ;
  $('chk-shuffle-a').checked = settings.shuffleA !== false;

  if (restoreSessionIfAny()) return;

  showScreen('setup');
  refreshSetupUI();
}

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  const button = $('theme-toggle');
  if (button) {
    button.textContent = nextTheme === 'dark' ? '☀️ Giao diện sáng' : '🌙 Giao diện tối';
    button.setAttribute('aria-pressed', String(nextTheme === 'light'));
  }
  try {
    localStorage.setItem('qp-quiz-theme', nextTheme);
  } catch {}
}

function initTheme() {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('qp-quiz-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  applyTheme(theme);
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!$('screen-quiz') || $('screen-quiz').hidden || !$('modal').hidden) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, button, [contenteditable="true"]')) return;

    if (/^[1-6]$/.test(event.key)) {
      const option = $('options').querySelectorAll('.option')[Number(event.key) - 1];
      if (option && !option.disabled) {
        event.preventDefault();
        option.click();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!$('btn-check').disabled) $('btn-check').click();
      else if (!$('btn-next').disabled) $('btn-next').click();
      return;
    }
    if (event.key === 'ArrowLeft' && !$('btn-prev').disabled) {
      event.preventDefault();
      $('btn-prev').click();
    } else if (event.key === 'ArrowRight' && !$('btn-next').disabled) {
      event.preventDefault();
      $('btn-next').click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      $('btn-quit').click();
    }
  });
}

function bindEvents() {
  $('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  bindKeyboardShortcuts();

  document.querySelectorAll('.deck-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentDeck = btn.dataset.deck;
      persistSetupForm();
      refreshSetupUI();
    });
  });

  $('btn-all').addEventListener('click', () => {
    const form = readSetupForm();
    $('input-count').value = String(Math.max(1, form.endQuestion - form.startQuestion + 1));
    persistSetupForm();
    refreshSetupUI();
  });

  $('input-count').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
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
  }

  $('chk-shuffle-q').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
  });

  $('chk-shuffle-a').addEventListener('change', () => {
    $('chk-shuffle-a').dataset.userTouched = '1';
    persistSetupForm();
  });

  $('btn-start').addEventListener('click', () => startNormal({ sequential: false }));
  $('btn-continue').addEventListener('click', () => startNormal({ sequential: true }));
  $('btn-practice-wrong').addEventListener('click', () => startPracticeWrong());

  $('btn-reset-progress').addEventListener('click', async () => {
    const ok = await confirmModal(
      'Xóa tiến độ?',
      `Xóa toàn bộ tiến độ, câu đã hoàn thành và lịch sử câu sai của bộ ${DECKS[state.currentDeck].label} trên trình duyệt này.`
    );
    if (!ok) return;
    resetDeckProgress(state.currentDeck);
    toast('Đã xóa tiến độ bộ đề.');
    refreshSetupUI();
  });

  $('btn-check').addEventListener('click', onCheck);
  $('btn-next').addEventListener('click', onNext);
  $('btn-prev').addEventListener('click', onPrev);

  $('btn-quit').addEventListener('click', async () => {
    const ok = await confirmModal(
      'Thoát lượt ôn?',
      'Phiên ôn hiện tại sẽ bị đóng. Tiến độ các lượt đã hoàn thành và lịch sử câu sai vẫn được giữ trên trình duyệt.'
    );
    if (!ok) return;
    clearSession();
    state.session = null;
    showScreen('setup');
    refreshSetupUI();
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
    }
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
    showScreen('setup');
    refreshSetupUI();
    startPracticeWrong();
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
    }
  });
}

let reloadAfterUpdate = false;

function registerSW() {
  if (!('serviceWorker' in navigator)) {
    toast('Trình duyệt này không hỗ trợ Service Worker nên không thể dùng chế độ offline.');
    return;
  }
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
            toast('Không thể cài bản offline mới. Hãy kiểm tra kết nối và tải lại trang khi có mạng.');
          }
        });
      });
    })
    .catch(() => {
      toast('Không thể bật chế độ offline. Hãy mở website bằng HTTPS trên GitHub Pages.');
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAfterUpdate || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

function boot() {
  initTheme();
  if (!storageAvailable()) {
    toast('Trình duyệt hạn chế lưu trữ. Tiến độ có thể không được ghi nhớ.');
  }
  bindEvents();
  registerSW();
  loadAll();
}

boot();
