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
  loading: true,
  error: null,
  currentDeck: 'qp1',
  mode: 'setup',
  session: null,
  reviewMode: false
};

const $ = (id) => document.getElementById(id);

function baseUrl() {
  const u = new URL('.', import.meta.url);
  u.pathname = u.pathname.replace(/assets\/js\/?$/, '');
  return u;
}

function dataUrl(rel) {
  return new URL(rel, document.baseURI || baseUrl()).href;
}

async function loadDeck(id) {
  const meta = DECKS[id];
  const url = dataUrl(meta.file);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Không tải được ${meta.label} (HTTP ${res.status}).`);
  const raw = await res.json();
  const questions = normalizeQuestions(raw);
  const fp = fingerprintQuestions(questions);
  state.decks[id] = questions;
  state.fingerprints[id] = fp;
  const progress = getDeckProgress(id);
  if (progress.dataFingerprint && progress.dataFingerprint !== fp) {
    progress.completed = [];
    progress.sequentialCursor = 0;
    progress.wrongMap = {};
    progress.dataFingerprint = fp;
    saveDeckProgress(id, progress);
  } else if (!progress.dataFingerprint) {
    progress.dataFingerprint = fp;
    saveDeckProgress(id, progress);
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

  const input = $('input-count');
  input.max = String(Math.max(1, total));
  if (Number(input.value) > total) input.value = String(total);
  if (Number(input.value) < 1) input.value = '1';
  $('hint-count').textContent = `Tối đa ${total} câu hợp lệ trong bộ đề.`;

  const progress = getDeckProgress(state.currentDeck);
  const completed = new Set(progress.completed);
  const remaining = qs.filter((q) => !completed.has(q.originalIndex)).length;
  const wrongs = getWrongIndices(state.currentDeck);
  $('stat-completed').textContent = String(completed.size);
  $('stat-remaining').textContent = String(remaining);
  $('stat-wrong').textContent = String(wrongs.length);
  $('stat-cursor').textContent = String(Math.min(progress.sequentialCursor + 1, total + (progress.sequentialCursor >= total ? 0 : 0)) || 1);
  if (progress.sequentialCursor >= total) {
    $('stat-cursor').textContent = 'Đã hết (làm lại từ đầu)';
  } else {
    $('stat-cursor').textContent = `${progress.sequentialCursor + 1}`;
  }

  const btnWrong = $('btn-practice-wrong');
  btnWrong.disabled = wrongs.length === 0;
  btnWrong.textContent = `Luyện câu sai (${wrongs.length})`;

  const shuffleQ = $('chk-shuffle-q').checked;
  const btnContinue = $('btn-continue');
  const canContinue =
    !shuffleQ &&
    progress.sequentialCursor < total &&
    remaining > 0;
  btnContinue.hidden = !canContinue;
  if (canContinue) {
    const left = total - progress.sequentialCursor;
    const n = Math.min(Number(input.value) || 20, left);
    btnContinue.textContent = `Tiếp tục tuần tự (${n} câu từ vị trí ${progress.sequentialCursor + 1})`;
  }
}

function readSetupForm() {
  let count = parseInt($('input-count').value, 10);
  const total = currentQuestions().length;
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > total) count = total;
  const shuffleQ = $('chk-shuffle-q').checked;
  const shuffleA = $('chk-shuffle-a').checked;
  return { count, shuffleQ, shuffleA };
}

function persistSetupForm() {
  const form = readSetupForm();
  saveSettings({
    deck: state.currentDeck,
    count: form.count,
    shuffleQ: form.shuffleQ,
    shuffleA: form.shuffleA
  });
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
    firstTryCorrect: 0,
    totalWrongAttempts: 0
  };
  state.session = session;
  state.reviewMode = false;
  saveSession(session);
  showScreen('quiz');
  renderQuestion();
}

function startNormal(opts = {}) {
  const qs = currentQuestions();
  if (!qs.length) {
    toast('Bộ đề trống.');
    return;
  }
  const form = readSetupForm();
  persistSetupForm();
  const progress = getDeckProgress(state.currentDeck);
  const completedSet = new Set(progress.completed);

  if (opts.sequential) {
    const cursor = progress.sequentialCursor;
    if (cursor >= qs.length) {
      toast('Đã hoàn thành toàn bộ theo thứ tự. Hãy làm lại từ đầu hoặc chọn ngẫu nhiên.');
      return;
    }
    const { items, nextCursor, actualCount } = pickSequential(qs, cursor, form.count, completedSet);
    if (!items.length) {
      toast('Không còn câu tuần tự.');
      return;
    }
    if (actualCount < form.count) {
      toast(`Chỉ còn ${actualCount} câu theo thứ tự.`);
    }
    startSessionFromPool(items, {
      mode: 'normal',
      sequential: true,
      startCursor: cursor,
      nextCursor,
      forceShuffleQ: false,
      alreadyShuffled: true
    });
    return;
  }

  if (form.shuffleQ) {
    const pool = pickRandom(qs, form.count, true, completedSet);
    if (!pool.length) {
      toast('Không lấy được câu hỏi.');
      return;
    }
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true
    });
    return;
  }

  const { items, nextCursor, actualCount } = pickSequential(qs, progress.sequentialCursor, form.count, completedSet);
  if (!items.length) {
    const pool = pickRandom(qs, form.count, false, completedSet);
    startSessionFromPool(pool, {
      mode: 'normal',
      sequential: false,
      forceShuffleQ: true,
      alreadyShuffled: true
    });
    toast('Đã hết chuỗi tuần tự, chuyển sang ngẫu nhiên.');
    return;
  }
  if (actualCount < form.count) toast(`Lượt này có ${actualCount} câu.`);
  startSessionFromPool(items, {
    mode: 'normal',
    sequential: true,
    startCursor: progress.sequentialCursor,
    nextCursor,
    forceShuffleQ: false,
    alreadyShuffled: true
  });
}

function startPracticeWrong() {
  const qs = currentQuestions();
  const wrongs = getWrongIndices(state.currentDeck);
  if (!wrongs.length) {
    toast('Không có câu sai để luyện.');
    return;
  }
  const form = readSetupForm();
  persistSetupForm();
  const pool = pickWrong(qs, wrongs, form.count, form.shuffleQ);
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

  $('progress-label').textContent = `Câu ${s.viewIndex + 1} / ${s.items.length}`;
  $('progress-score').textContent = `Đúng ${s.completedInSession}`;
  const pct = s.items.length ? Math.round((s.completedInSession / s.items.length) * 100) : 0;
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
    $('btn-next').disabled = item.status !== 'correct';
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
      s.completedInSession += 1;
      if (firstTime) s.firstTryCorrect += 1;
    }
    if (s.viewIndex >= s.maxReached) s.maxReached = s.viewIndex;
    s.reviewingPast = false;
  } else {
    item.status = 'wrong';
    item.wrongCount += 1;
    s.totalWrongAttempts += 1;
    markWrong(s.deckId, q.originalIndex);
  }
  persistSession();
  renderQuestion();

  if (item.status === 'correct' && s.completedInSession >= s.items.length) {
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

  if (item.status !== 'correct') {
    toast('Hãy trả lời đúng trước khi sang câu tiếp.');
    return;
  }

  if (s.viewIndex >= s.items.length - 1) {
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
  if (state.session) saveSession(state.session);
}

function finishSession() {
  const s = state.session;
  if (!s) return;

  const completedIdx = s.items
    .filter((it) => it.status === 'correct')
    .map((it) => s.pool[it.poolIdx].originalIndex);
  addCompleted(s.deckId, completedIdx, state.fingerprints[s.deckId]);

  if (s.sequential && s.nextCursor != null) {
    setSequentialCursor(s.deckId, s.nextCursor, state.fingerprints[s.deckId]);
  }

  const wrongInSession = [];
  const seen = new Set();
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

  s.summary = {
    total: s.items.length,
    correct: s.completedInSession,
    wrongQuestions: wrongInSession.length,
    wrongAttempts: s.totalWrongAttempts,
    firstTryRate: s.items.length ? Math.round((s.firstTryCorrect / s.items.length) * 100) : 0,
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
  $('sum-first').textContent = `${summary.firstTryRate}%`;

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
  const validSession = saved.items.length > 0 &&
    Number.isInteger(saved.viewIndex) && saved.viewIndex >= 0 && saved.viewIndex < saved.items.length &&
    saved.items.every((item) => Number.isInteger(item.poolIdx) && item.poolIdx >= 0 && item.poolIdx < saved.pool.length &&
      Array.isArray(item.optionOrder) && item.optionOrder.length === saved.pool[item.poolIdx].options?.length);
  if (!validSession || saved.dataFingerprint !== fp) {
    clearSession();
    return false;
  }
  const progress = getDeckProgress(saved.deckId);
  if (progress.dataFingerprint && progress.dataFingerprint !== fp) {
    clearSession();
    return false;
  }
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
  $('chk-shuffle-q').checked = !!settings.shuffleQ;
  $('chk-shuffle-a').checked = settings.shuffleA !== false;

  if (restoreSessionIfAny()) return;

  showScreen('setup');
  refreshSetupUI();
}

function bindEvents() {
  document.querySelectorAll('.deck-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentDeck = btn.dataset.deck;
      persistSetupForm();
      refreshSetupUI();
    });
  });

  $('btn-all').addEventListener('click', () => {
    const total = currentQuestions().length;
    $('input-count').value = String(total);
    persistSetupForm();
    refreshSetupUI();
  });

  $('input-count').addEventListener('change', () => {
    persistSetupForm();
    refreshSetupUI();
  });

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
      'Tiến độ lượt hiện tại vẫn được lưu và có thể khôi phục khi mở lại. Bạn có thể thoát về màn hình chính.'
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
    startNormal({ sequential: false });
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
  if (!('serviceWorker' in navigator)) return;
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
          }
        });
      });
    })
    .catch(() => {});

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAfterUpdate || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

function boot() {
  if (!storageAvailable()) {
    toast('Trình duyệt hạn chế lưu trữ. Tiến độ có thể không được ghi nhớ.');
  }
  bindEvents();
  registerSW();
  loadAll();
}

boot();
