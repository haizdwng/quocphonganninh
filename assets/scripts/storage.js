const STORAGE_KEY = 'quocphonganninh';
const STORAGE_VERSION = 1;

function emptyRoot() {
  return {
    version: STORAGE_VERSION,
    settings: null,
    activeDeck: 'quocphong1',
    decks: {},
    sessions: {},
    customDecks: {},
    highlights: {
      quocphong1: {},
      quocphong2: {}
    },
    notes: {
      quocphong1: {},
      quocphong2: {}
    },
    overrides: {
      quocphong1: {},
      quocphong2: {}
    },
    hidden: {
      quocphong1: [],
      quocphong2: []
    }
  };
};

function readRoot() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (!rawData) return emptyRoot();
    const data = JSON.parse(rawData);
    const valid = data && typeof data === 'object' && !Array.isArray(data) &&
      data.version === STORAGE_VERSION &&
      data.decks && typeof data.decks === 'object' && !Array.isArray(data.decks);
    if (valid) return data;
    localStorage.removeItem(STORAGE_KEY);
    return emptyRoot();
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {};
    return emptyRoot();
  };
};

function writeRoot(data) {
  try {
    const root = data && typeof data === 'object' && !Array.isArray(data) ? data : emptyRoot();
    root.version = STORAGE_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
    return true;
  } catch {
    return false;
  };
};

function normalizeDeckId(deckId) {
  if (typeof deckId === 'string' && deckId.startsWith('custom_')) return deckId;
  return deckId === 'quocphong2' ? 'quocphong2' : 'quocphong1';
};

function isCustomDeckId(deckId) {
  return typeof deckId === 'string' && deckId.startsWith('custom_');
};

function normalizeCustomQuestion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const questionText = typeof raw.questionText === 'string' ? raw.questionText.trim() : '';
  if (!questionText) return null;
  const answerOptions = Array.isArray(raw.answerOptions) ? raw.answerOptions.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean) : [];
  if (answerOptions.length < 2) return null;
  let correctAnswerIndex = Number(raw.correctAnswerIndex);
  if (!Number.isInteger(correctAnswerIndex) || correctAnswerIndex < 0 || correctAnswerIndex >= answerOptions.length) correctAnswerIndex = 0;
  const fixedAnswerIndices = Array.isArray(raw.fixedAnswerIndices) ? [...new Set(raw.fixedAnswerIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < answerOptions.length))].sort((a, b) => a - b) : [];
  return { questionText, answerOptions, correctAnswerIndex, fixedAnswerIndices };
};

function normalizeCustomDeck(raw, id) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const deckId = typeof id === 'string' && id.startsWith('custom_') ? id : (typeof raw.id === 'string' && raw.id.startsWith('custom_') ? raw.id : null);
  if (!deckId) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const questions = Array.isArray(raw.questions) ? raw.questions.map(normalizeCustomQuestion).filter(Boolean) : [];
  return {
    id: deckId,
    name,
    questions,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now()
  };
};

function normalizeSettingsEntry(rawData, deckId) {
  const settings = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? rawData : {};
  const count = Number(settings.count);
  return {
    deck: normalizeDeckId(deckId || settings.deck),
    count: Number.isInteger(count) && count > 0 ? count : 30,
    allQuestionsEnabled: settings.allQuestionsEnabled === true,
    shuffleQuestionOrder: settings.shuffleQuestionOrder !== false,
    shuffleAnswerOrder: settings.shuffleAnswerOrder !== false,
    firstQuestionNumber: Number.isInteger(Number(settings.firstQuestionNumber)) && Number(settings.firstQuestionNumber) > 0 ? Number(settings.firstQuestionNumber) : 1,
    lastQuestionNumber: Number.isInteger(Number(settings.lastQuestionNumber)) && Number(settings.lastQuestionNumber) > 0 ? Number(settings.lastQuestionNumber) : 0,
    timeLimit: Number.isInteger(Number(settings.timeLimit)) && Number(settings.timeLimit) >= 0 ? Math.min(1440, Number(settings.timeLimit)) : 35,
    unlimitedTimeEnabled: settings.unlimitedTimeEnabled === true,
    studyMode: settings.studyMode === 'exam' ? 'exam' : 'practice',
    automaticAnswerChecking: settings.automaticAnswerChecking === true,
    automaticAnswerCheckDelaySeconds: (() => {
      const delay = Number(settings.automaticAnswerCheckDelaySeconds);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    automaticQuestionAdvance: settings.automaticQuestionAdvance === true,
    vibrationEnabled: settings.vibrationEnabled === true,
    automaticQuestionAdvanceDelaySeconds: (() => {
      const delay = Number(settings.automaticQuestionAdvanceDelaySeconds);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    soundVolumePercentage: (() => {
      const volume = Number(settings.soundVolumePercentage);
      if (Number.isInteger(volume) && volume > 0) return Math.min(100, volume);
      return 1;
    })(),
    soundEnabled: (() => {
      if (settings.soundEnabled === true) return true;
      if (settings.soundEnabled === false) return false;
      const volume = Number(settings.soundVolumePercentage);
      return Number.isInteger(volume) && volume > 0;
    })()
  };
};

export function getSettings(deckId) {
  const root = readRoot();
  const activeDeck = normalizeDeckId(deckId || root.activeDeck || 'quocphong1');
  return normalizeSettingsEntry(root.settings, activeDeck);
};

export function saveSettings(settings) {
  const root = readRoot();
  const activeDeck = normalizeDeckId(settings?.deck || root.activeDeck);
  root.settings = normalizeSettingsEntry(settings, activeDeck);
  root.activeDeck = activeDeck;
  return writeRoot(root);
};

export function getDeckProgress(deckId) {
  const root = readRoot();
  const decks = root.decks && typeof root.decks === 'object' ? root.decks : {};
  const deckData = decks[normalizeDeckId(deckId)] && typeof decks[normalizeDeckId(deckId)] === 'object' ? decks[normalizeDeckId(deckId)] : {};
  const completedQuestionIndices = Array.isArray(deckData.completedQuestionIndices) ? [...new Set(deckData.completedQuestionIndices.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [];
  const incorrectAnswerCounts = {};
  if (deckData.incorrectAnswerCounts && typeof deckData.incorrectAnswerCounts === 'object' && !Array.isArray(deckData.incorrectAnswerCounts)) {
    for (const [key, value] of Object.entries(deckData.incorrectAnswerCounts)) {
      const index = Number(key);
      const count = Number(value);
      if (Number.isInteger(index) && index >= 0 && Number.isInteger(count) && count > 0) incorrectAnswerCounts[String(index)] = count;
    };
  };
  const cursor = Number(deckData.sequentialQuestionCursor);
  return {
    sequentialQuestionCursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    completedQuestionIndices,
    incorrectAnswerCounts,
    rangeIncorrectQuestionIndices: deckData.rangeIncorrectQuestionIndices && typeof deckData.rangeIncorrectQuestionIndices === 'object' && !Array.isArray(deckData.rangeIncorrectQuestionIndices) ? Object.fromEntries(Object.entries(deckData.rangeIncorrectQuestionIndices).filter(([range, indices]) => /^\d+-\d+$/.test(range) && Array.isArray(indices)).map(([range, indices]) => {
      const [start, end] = range.split('-').map(Number);
      return [
        range,
        [...new Set(indices.filter((index) => Number.isInteger(index) && index >= start - 1 && index < end))].sort((leftValue, rightValue) => leftValue - rightValue)
      ];
    })) : {},
    practiceQuestionCounts: deckData.practiceQuestionCounts && typeof deckData.practiceQuestionCounts === 'object' && !Array.isArray(deckData.practiceQuestionCounts) ? Object.fromEntries(Object.entries(deckData.practiceQuestionCounts).filter(([key, value]) => Number.isInteger(Number(key)) && Number(key) >= 0 && Number.isInteger(value) && value > 0)) : {},
    bookmarkedQuestionIndices: Array.isArray(deckData.bookmarkedQuestionIndices) ? [...new Set(deckData.bookmarkedQuestionIndices.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
    questionDataFingerprint: typeof deckData.questionDataFingerprint === 'string' ? deckData.questionDataFingerprint : ''
  };
};

export function saveDeckProgress(deckId, progress) {
  const root = readRoot();
  if (!root.decks || typeof root.decks !== 'object' || Array.isArray(root.decks)) root.decks = {};
  root.decks[normalizeDeckId(deckId)] = {
    sequentialQuestionCursor: Number.isInteger(progress.sequentialQuestionCursor) ? Math.max(0, progress.sequentialQuestionCursor) : 0,
    completedQuestionIndices: Array.isArray(progress.completedQuestionIndices) ? [...new Set(progress.completedQuestionIndices.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
    incorrectAnswerCounts: progress.incorrectAnswerCounts && typeof progress.incorrectAnswerCounts === 'object' && !Array.isArray(progress.incorrectAnswerCounts) ? progress.incorrectAnswerCounts : {},
    rangeIncorrectQuestionIndices: progress.rangeIncorrectQuestionIndices && typeof progress.rangeIncorrectQuestionIndices === 'object' && !Array.isArray(progress.rangeIncorrectQuestionIndices) ? Object.fromEntries(Object.entries(progress.rangeIncorrectQuestionIndices).filter(([range, indices]) => /^\d+-\d+$/.test(range) && Array.isArray(indices)).map(([range, indices]) => {
      const [start, end] = range.split('-').map(Number);
      return [
        range,
        [...new Set(indices.filter((index) => Number.isInteger(index) && index >= start - 1 && index < end))].sort((leftValue, rightValue) => leftValue - rightValue)
      ];
    })) : {},
    practiceQuestionCounts: progress.practiceQuestionCounts && typeof progress.practiceQuestionCounts === 'object' && !Array.isArray(progress.practiceQuestionCounts) ? progress.practiceQuestionCounts : {},
    bookmarkedQuestionIndices: Array.isArray(progress.bookmarkedQuestionIndices) ? [...new Set(progress.bookmarkedQuestionIndices.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
    questionDataFingerprint: typeof progress.questionDataFingerprint === 'string' ? progress.questionDataFingerprint : ''
  };
  return writeRoot(root);
};

export function getSession(deckId) {
  const root = readRoot();
  const deckIdentifier = normalizeDeckId(deckId || root.activeDeck || 'quocphong1');
  const sessions = root.sessions && typeof root.sessions === 'object' && !Array.isArray(root.sessions) ? root.sessions : {};
  const session = sessions[deckIdentifier] || (root.session?.deckId === deckIdentifier ? root.session : null);
  return session && typeof session === 'object' && !Array.isArray(session) ? session : null;
};

export function saveSession(session) {
  if (!session || !(session.deckId === 'quocphong1' || session.deckId === 'quocphong2' || isCustomDeckId(session.deckId))) return false;
  const root = readRoot();
  if (!root.sessions || typeof root.sessions !== 'object' || Array.isArray(root.sessions)) root.sessions = {};
  root.sessions[session.deckId] = session;
  if (root.session?.deckId === session.deckId) delete root.session;
  return writeRoot(root);
};

export function clearSession(deckId) {
  const root = readRoot();
  if (!root.sessions || typeof root.sessions !== 'object' || Array.isArray(root.sessions)) root.sessions = {};
  const deckIdentifier = normalizeDeckId(deckId || root.activeDeck || 'quocphong1');
  delete root.sessions[deckIdentifier];
  if (root.session?.deckId === deckIdentifier) delete root.session;
  return writeRoot(root);
};

export function resetDeckProgress(deckId) {
  const root = readRoot();
  if (!root.decks || typeof root.decks !== 'object' || Array.isArray(root.decks)) root.decks = {};
  delete root.decks[normalizeDeckId(deckId)];
  if (!root.sessions || typeof root.sessions !== 'object' || Array.isArray(root.sessions)) root.sessions = {};
  delete root.sessions[normalizeDeckId(deckId)];
  if (root.session?.deckId === normalizeDeckId(deckId)) delete root.session;
  return writeRoot(root);
};

export function markWrong(deckId, sourceQuestionIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(sourceQuestionIndex);
  progress.incorrectAnswerCounts[key] = (progress.incorrectAnswerCounts[key] || 0) + 1;
  return saveDeckProgress(deckId, progress) ? progress.incorrectAnswerCounts[key] : null;
};

export function markPracticed(deckId, sourceQuestionIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(sourceQuestionIndex);
  progress.practiceQuestionCounts[key] = (progress.practiceQuestionCounts[key] || 0) + 1;
  return saveDeckProgress(deckId, progress) ? progress.practiceQuestionCounts[key] : null;
};

export function addCompleted(deckId, indices, fingerprint) {
  const progress = getDeckProgress(deckId);
  const completedQuestionIndices = new Set(progress.completedQuestionIndices);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0) completedQuestionIndices.add(index);
  };
  progress.completedQuestionIndices = [...completedQuestionIndices].sort((leftValue, rightValue) => leftValue - rightValue);
  if (fingerprint) progress.questionDataFingerprint = fingerprint;
  return saveDeckProgress(deckId, progress) ? progress : null;
};

export function setSequentialCursor(deckId, cursor, fingerprint) {
  const progress = getDeckProgress(deckId);
  progress.sequentialQuestionCursor = Number.isInteger(cursor) ? Math.max(0, cursor) : 0;
  if (fingerprint) progress.questionDataFingerprint = fingerprint;
  return saveDeckProgress(deckId, progress);
};

export function getWrongIndices(deckId) {
  const progress = getDeckProgress(deckId);
  return Object.keys(progress.incorrectAnswerCounts).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && progress.incorrectAnswerCounts[String(index)] > 0).sort((leftValue, rightValue) => leftValue - rightValue);
};

export function clearWrongAnswers(deckId, sourceQuestionIndices = null) {
  const progress = getDeckProgress(deckId);
  if (sourceQuestionIndices == null) {
    progress.incorrectAnswerCounts = {};
    progress.rangeIncorrectQuestionIndices = {};
  } else {
    const indices = new Set(sourceQuestionIndices.filter((index) => Number.isInteger(index) && index >= 0));
    for (const index of indices) delete progress.incorrectAnswerCounts[String(index)];
    for (const [range, values] of Object.entries(progress.rangeIncorrectQuestionIndices)) {
      progress.rangeIncorrectQuestionIndices[range] = values.filter((index) => !indices.has(index));
    };
  };
  return saveDeckProgress(deckId, progress);
};

export function getRangeWrongIndices(deckId, firstQuestionNumber, lastQuestionNumber) {
  const start = Number(firstQuestionNumber);
  const end = Number(lastQuestionNumber);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return [];
  const progress = getDeckProgress(deckId);
  const key = start + '-' + end;
  if (!Object.prototype.hasOwnProperty.call(progress.rangeIncorrectQuestionIndices, key)) {
    progress.rangeIncorrectQuestionIndices[key] = Object.keys(progress.incorrectAnswerCounts).map(Number).filter((index) => index >= start - 1 && index < end && progress.incorrectAnswerCounts[String(index)] > 0).sort((leftValue, rightValue) => leftValue - rightValue);
    saveDeckProgress(deckId, progress);
  };
  return progress.rangeIncorrectQuestionIndices[key].filter((index) => index >= start - 1 && index < end);
};

export function addWrongIndicesForRange(deckId, firstQuestionNumber, lastQuestionNumber, indices) {
  const start = Number(firstQuestionNumber);
  const end = Number(lastQuestionNumber);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || !Array.isArray(indices)) return false;
  const progress = getDeckProgress(deckId);
  const key = start + '-' + end;
  const existing = new Set(progress.rangeIncorrectQuestionIndices[key] || []);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= start - 1 && index < end) existing.add(index);
  };
  progress.rangeIncorrectQuestionIndices[key] = [...existing].sort((leftValue, rightValue) => leftValue - rightValue);
  return saveDeckProgress(deckId, progress);
};

export function getBookmarkedIndices(deckId) {
  return getDeckProgress(deckId).bookmarkedQuestionIndices;
};

export function toggleBookmark(deckId, sourceQuestionIndex) {
  if (!Number.isInteger(sourceQuestionIndex) || sourceQuestionIndex < 0) return null;
  const progress = getDeckProgress(deckId);
  const bookmarkedQuestionIndices = new Set(progress.bookmarkedQuestionIndices);
  if (bookmarkedQuestionIndices.has(sourceQuestionIndex)) bookmarkedQuestionIndices.delete(sourceQuestionIndex);
  else bookmarkedQuestionIndices.add(sourceQuestionIndex);
  progress.bookmarkedQuestionIndices = [...bookmarkedQuestionIndices].sort((leftValue, rightValue) => leftValue - rightValue);
  return saveDeckProgress(deckId, progress) ? bookmarkedQuestionIndices.has(sourceQuestionIndex) : null;
};

export function clearBookmarks(deckId) {
  const progress = getDeckProgress(deckId);
  progress.bookmarkedQuestionIndices = [];
  return saveDeckProgress(deckId, progress);
};

function normalizeHighlightRanges(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((range) => range && typeof range === 'object' && (range.target === 'questionText' || /^option:\d+$/.test(range.target)) && Number.isInteger(range.start) && range.start >= 0 && Number.isInteger(range.end) && range.end > range.start).map((range) => ({
    target: range.target,
    start: range.start,
    end: range.end
  }));
};

export function getQuestionHighlights(deckId, sourceQuestionIndex) {
  const root = readRoot();
  const highlights = root.highlights && typeof root.highlights === 'object' ? root.highlights : {};
  const deck = highlights[normalizeDeckId(deckId)];
  return normalizeHighlightRanges(deck && deck[String(sourceQuestionIndex)]);
};

export function resetDeckHighlights(deckId) {
  const root = readRoot();
  if (!root.highlights || typeof root.highlights !== 'object' || Array.isArray(root.highlights)) root.highlights = {
    quocphong1: {},
    quocphong2: {}
  };
  root.highlights[normalizeDeckId(deckId)] = {};
  return writeRoot(root);
};

export function saveQuestionHighlights(deckId, sourceQuestionIndex, ranges) {
  if (!Number.isInteger(sourceQuestionIndex) || sourceQuestionIndex < 0) return false;
  const root = readRoot();
  if (!root.highlights || typeof root.highlights !== 'object' || Array.isArray(root.highlights)) root.highlights = {};
  const deckIdentifier = normalizeDeckId(deckId);
  if (!root.highlights[deckIdentifier] || typeof root.highlights[deckIdentifier] !== 'object' || Array.isArray(root.highlights[deckIdentifier])) root.highlights[deckIdentifier] = {};
  const normalized = normalizeHighlightRanges(ranges);
  if (normalized.length) root.highlights[deckIdentifier][String(sourceQuestionIndex)] = normalized;
  else delete root.highlights[deckIdentifier][String(sourceQuestionIndex)];
  return writeRoot(root);
};

function normalizeNoteText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, 2000);
};

export function getQuestionNote(deckId, sourceQuestionIndex) {
  if (!Number.isInteger(sourceQuestionIndex) || sourceQuestionIndex < 0) return '';
  const root = readRoot();
  const notes = root.notes && typeof root.notes === 'object' ? root.notes : {};
  const deck = notes[normalizeDeckId(deckId)];
  if (!deck || typeof deck !== 'object') return '';
  return normalizeNoteText(deck[String(sourceQuestionIndex)] || '');
};

export function saveQuestionNote(deckId, sourceQuestionIndex, text) {
  if (!Number.isInteger(sourceQuestionIndex) || sourceQuestionIndex < 0) return false;
  const root = readRoot();
  if (!root.notes || typeof root.notes !== 'object' || Array.isArray(root.notes)) root.notes = { quocphong1: {}, quocphong2: {} };
  const deckIdentifier = normalizeDeckId(deckId);
  if (!root.notes[deckIdentifier] || typeof root.notes[deckIdentifier] !== 'object' || Array.isArray(root.notes[deckIdentifier])) root.notes[deckIdentifier] = {};
  const normalized = normalizeNoteText(text);
  if (normalized) root.notes[deckIdentifier][String(sourceQuestionIndex)] = normalized;
  else delete root.notes[deckIdentifier][String(sourceQuestionIndex)];
  return writeRoot(root);
};

export function resetDeckNotes(deckId) {
  const root = readRoot();
  if (!root.notes || typeof root.notes !== 'object' || Array.isArray(root.notes)) root.notes = { quocphong1: {}, quocphong2: {} };
  root.notes[normalizeDeckId(deckId)] = {};
  return writeRoot(root);
};


function normalizeOverrideEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const questionText = typeof value.questionText === 'string' ? value.questionText.trim() : '';
  if (!questionText) return null;
  if (!Array.isArray(value.answerOptions) || value.answerOptions.length < 2) return null;
  const answerOptions = value.answerOptions.map((option) => typeof option === 'string' ? option.trim() : '').filter(Boolean);
  if (answerOptions.length < 2) return null;
  const correctAnswerIndex = Number(value.correctAnswerIndex);
  if (!Number.isInteger(correctAnswerIndex) || correctAnswerIndex < 0 || correctAnswerIndex >= answerOptions.length) return null;
  const fixedAnswerIndices = Array.isArray(value.fixedAnswerIndices) ? [...new Set(value.fixedAnswerIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < answerOptions.length))] : [];
  return { questionText, answerOptions, correctAnswerIndex, fixedAnswerIndices };
};

export function saveQuestionOverride(deckId, sourceQuestionIndex, payload) {
  if (!Number.isInteger(sourceQuestionIndex) || sourceQuestionIndex < 0) return false;
  const root = readRoot();
  if (!root.overrides || typeof root.overrides !== 'object' || Array.isArray(root.overrides)) root.overrides = { quocphong1: {}, quocphong2: {} };
  const deckIdentifier = normalizeDeckId(deckId);
  if (!root.overrides[deckIdentifier] || typeof root.overrides[deckIdentifier] !== 'object' || Array.isArray(root.overrides[deckIdentifier])) root.overrides[deckIdentifier] = {};
  if (payload === null) {
    delete root.overrides[deckIdentifier][String(sourceQuestionIndex)];
    return writeRoot(root);
  };
  const normalized = normalizeOverrideEntry(payload);
  if (!normalized) return false;
  root.overrides[deckIdentifier][String(sourceQuestionIndex)] = normalized;
  return writeRoot(root);
};

export function getDeckOverrides(deckId) {
  const root = readRoot();
  const overrides = root.overrides && typeof root.overrides === 'object' ? root.overrides : {};
  const deck = overrides[normalizeDeckId(deckId)];
  if (!deck || typeof deck !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(deck)) {
    const index = Number(key);
    const entry = normalizeOverrideEntry(value);
    if (Number.isInteger(index) && index >= 0 && entry) result[index] = entry;
  };
  return result;
};

export function getHiddenIndices(deckId) {
  const root = readRoot();
  const hidden = root.hidden && typeof root.hidden === 'object' ? root.hidden : {};
  const list = hidden[normalizeDeckId(deckId)];
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue);
};

export function toggleHiddenQuestion(deckId, sourceQuestionIndex) {
  if (!Number.isInteger(sourceQuestionIndex) || sourceQuestionIndex < 0) return null;
  const root = readRoot();
  if (!root.hidden || typeof root.hidden !== 'object' || Array.isArray(root.hidden)) root.hidden = { quocphong1: [], quocphong2: [] };
  const deckIdentifier = normalizeDeckId(deckId);
  const hiddenQuestionIndices = new Set(Array.isArray(root.hidden[deckIdentifier]) ? root.hidden[deckIdentifier].filter((value) => Number.isInteger(value) && value >= 0) : []);
  if (hiddenQuestionIndices.has(sourceQuestionIndex)) hiddenQuestionIndices.delete(sourceQuestionIndex);
  else hiddenQuestionIndices.add(sourceQuestionIndex);
  root.hidden[deckIdentifier] = [...hiddenQuestionIndices].sort((leftValue, rightValue) => leftValue - rightValue);
  if (!writeRoot(root)) return null;
  return hiddenQuestionIndices.has(sourceQuestionIndex);
};

export function isQuestionHidden(deckId, sourceQuestionIndex) {
  return getHiddenIndices(deckId).includes(sourceQuestionIndex);
};

export function exportBackup() {
  const root = readRoot();
  const activeDeck = normalizeDeckId(root.activeDeck || 'quocphong1');
  return JSON.stringify({
    format: 'defense-security-quiz',
    version: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: root.settings && typeof root.settings === 'object' ? root.settings : null,
    activeDeck: root.activeDeck || 'quocphong1',
    decks: root.decks || {},
    highlights: root.highlights || {
      quocphong1: {},
      quocphong2: {}
    },
    notes: root.notes || {
      quocphong1: {},
      quocphong2: {}
    },
    overrides: root.overrides || {
      quocphong1: {},
      quocphong2: {}
    },
    hidden: root.hidden || {
      quocphong1: [],
      quocphong2: []
    }
  }, null, 2);
};

export function importBackup(rawData) {
  let backup;
  try {
    backup = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    return false;
  };
  if (!backup || backup.format !== 'defense-security-quiz' || backup.version !== STORAGE_VERSION || !backup.decks || typeof backup.decks !== 'object' || Array.isArray(backup.decks) || !Object.keys(backup.decks).every((deckIdentifier) => ['quocphong1', 'quocphong2'].includes(deckIdentifier))) return false;
  const activeDeck = normalizeDeckId(backup.activeDeck || 'quocphong1');
  const importedSettings = normalizeSettingsEntry(backup.settings, activeDeck);
  const normalized = {
    settings: importedSettings,
    activeDeck,
    decks: {},
    sessions: {},
    highlights: {
      quocphong1: {},
      quocphong2: {}
    },
    notes: {
      quocphong1: {},
      quocphong2: {}
    },
    overrides: {
      quocphong1: {},
      quocphong2: {}
    },
    hidden: {
      quocphong1: [],
      quocphong2: []
    }
  };
  if (backup.highlights && typeof backup.highlights === 'object' && !Array.isArray(backup.highlights)) {
    for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
      const deck = backup.highlights[deckIdentifier];
      if (!deck || typeof deck !== 'object' || Array.isArray(deck)) continue;
      for (const [key, ranges] of Object.entries(deck)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0) continue;
        const valid = normalizeHighlightRanges(ranges);
        if (valid.length) normalized.highlights[deckIdentifier][String(index)] = valid;
      };
    };
  };
  if (backup.notes && typeof backup.notes === 'object' && !Array.isArray(backup.notes)) {
    for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
      const deck = backup.notes[deckIdentifier];
      if (!deck || typeof deck !== 'object' || Array.isArray(deck)) continue;
      for (const [key, value] of Object.entries(deck)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0) continue;
        const text = normalizeNoteText(value);
        if (text) normalized.notes[deckIdentifier][String(index)] = text;
      };
    };
  };
  normalized.overrides = { quocphong1: {}, quocphong2: {} };
  if (backup.overrides && typeof backup.overrides === 'object' && !Array.isArray(backup.overrides)) {
    for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
      const deck = backup.overrides[deckIdentifier];
      if (!deck || typeof deck !== 'object' || Array.isArray(deck)) continue;
      for (const [key, value] of Object.entries(deck)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0) continue;
        const entry = normalizeOverrideEntry(value);
        if (entry) normalized.overrides[deckIdentifier][String(index)] = entry;
      };
    };
  };
  normalized.hidden = { quocphong1: [], quocphong2: [] };
  if (backup.hidden && typeof backup.hidden === 'object' && !Array.isArray(backup.hidden)) {
    for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
      const list = backup.hidden[deckIdentifier];
      if (!Array.isArray(list)) continue;
      normalized.hidden[deckIdentifier] = [...new Set(list.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue);
    };
  };
  for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
    const deckData = backup.decks[deckIdentifier];
    if (!deckData || typeof deckData !== 'object' || Array.isArray(deckData)) continue;
    const incorrectAnswerCounts = {};
    if (deckData.incorrectAnswerCounts && typeof deckData.incorrectAnswerCounts === 'object' && !Array.isArray(deckData.incorrectAnswerCounts)) {
      for (const [key, value] of Object.entries(deckData.incorrectAnswerCounts)) {
        const index = Number(key);
        const count = Number(value);
        if (Number.isInteger(index) && index >= 0 && Number.isInteger(count) && count > 0) incorrectAnswerCounts[String(index)] = count;
      };
    };
    const practiceQuestionCounts = {};
    if (deckData.practiceQuestionCounts && typeof deckData.practiceQuestionCounts === 'object' && !Array.isArray(deckData.practiceQuestionCounts)) {
      for (const [key, value] of Object.entries(deckData.practiceQuestionCounts)) {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && Number.isInteger(value) && value > 0) practiceQuestionCounts[String(index)] = value;
      };
    };
    normalized.decks[deckIdentifier] = {
      sequentialQuestionCursor: Number.isInteger(deckData.sequentialQuestionCursor) && deckData.sequentialQuestionCursor >= 0 ? deckData.sequentialQuestionCursor : 0,
      completedQuestionIndices: Array.isArray(deckData.completedQuestionIndices) ? [...new Set(deckData.completedQuestionIndices.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
      incorrectAnswerCounts,
      rangeIncorrectQuestionIndices: deckData.rangeIncorrectQuestionIndices && typeof deckData.rangeIncorrectQuestionIndices === 'object' && !Array.isArray(deckData.rangeIncorrectQuestionIndices) ? Object.fromEntries(Object.entries(deckData.rangeIncorrectQuestionIndices).filter(([range, indices]) => /^\d+-\d+$/.test(range) && Array.isArray(indices)).map(([range, indices]) => {
        const [start, end] = range.split('-').map(Number);
        return [
          range,
          [...new Set(indices.filter((index) => Number.isInteger(index) && index >= start - 1 && index < end))].sort((leftValue, rightValue) => leftValue - rightValue)
        ];
      })) : {},
      practiceQuestionCounts,
      bookmarkedQuestionIndices: Array.isArray(deckData.bookmarkedQuestionIndices) ? [...new Set(deckData.bookmarkedQuestionIndices.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
      questionDataFingerprint: typeof deckData.questionDataFingerprint === 'string' ? deckData.questionDataFingerprint : ''
    };
  };
  return writeRoot(normalized);
};

export function getCustomDecks() {
  const root = readRoot();
  const custom = root.customDecks && typeof root.customDecks === 'object' && !Array.isArray(root.customDecks) ? root.customDecks : {};
  const list = [];
  for (const [id, raw] of Object.entries(custom)) {
    const deck = normalizeCustomDeck(raw, id);
    if (deck) list.push(deck);
  };
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list;
};

export function getCustomDeck(deckId) {
  if (!isCustomDeckId(deckId)) return null;
  const root = readRoot();
  const custom = root.customDecks && typeof root.customDecks === 'object' && !Array.isArray(root.customDecks) ? root.customDecks : {};
  return normalizeCustomDeck(custom[deckId], deckId);
};

export function saveCustomDeck(deck) {
  const normalized = normalizeCustomDeck(deck, deck?.id);
  if (!normalized) return false;
  const root = readRoot();
  if (!root.customDecks || typeof root.customDecks !== 'object' || Array.isArray(root.customDecks)) root.customDecks = {};
  normalized.updatedAt = Date.now();
  root.customDecks[normalized.id] = normalized;
  return writeRoot(root);
};

export function deleteCustomDeck(deckId) {
  if (!isCustomDeckId(deckId)) return false;
  const root = readRoot();
  if (!root.customDecks || typeof root.customDecks !== 'object') return true;
  delete root.customDecks[deckId];
  if (root.decks) delete root.decks[deckId];
  if (root.sessions) delete root.sessions[deckId];
  if (root.highlights) delete root.highlights[deckId];
  if (root.notes) delete root.notes[deckId];
  if (root.overrides) delete root.overrides[deckId];
  if (root.hidden) delete root.hidden[deckId];
  if (root.activeDeck === deckId) root.activeDeck = 'quocphong1';
  return writeRoot(root);
};

export function createCustomDeckId() {
  return 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
};

export { isCustomDeckId };

export function storageAvailable() {
  try {
    const key = STORAGE_KEY + ':availability-check';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  };
};