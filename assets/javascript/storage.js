const STORAGE_KEY = 'quocphonganninh';
const VERSION = 2;

function emptyRoot() {
  return {
    version: VERSION,
    settings: null,
    activeDeck: 'quocphong1',
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
};

function readRoot() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (!rawData) return emptyRoot();

    const data = JSON.parse(rawData);
    const valid = data && typeof data === 'object' && !Array.isArray(data) && data.version === VERSION && data.decks && typeof data.decks === 'object' && !Array.isArray(data.decks) && ['quocphong1', 'quocphong2'].every((deckIdentifier) => !Object.prototype.hasOwnProperty.call(data.decks, deckIdentifier) || (data.decks[deckIdentifier] && typeof data.decks[deckIdentifier] === 'object' && !Array.isArray(data.decks[deckIdentifier]))) && (!data.sessions || (typeof data.sessions === 'object' && !Array.isArray(data.sessions))) && (!data.highlights || (typeof data.highlights === 'object' && !Array.isArray(data.highlights))) && (!data.notes || (typeof data.notes === 'object' && !Array.isArray(data.notes)));
    if (valid) {
      const legacySettings = data.sharedSettings && typeof data.sharedSettings === 'object' && !Array.isArray(data.sharedSettings) ? data.sharedSettings : null;
      if (Array.isArray(data.settings)) {
        const entries = data.settings.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
        data.settings = entries.find((entry) => normalizeDeckId(entry.deck) === normalizeDeckId(data.activeDeck)) || entries[0] || null;
      } else if ((!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) && legacySettings) {
        data.settings = legacySettings;
      };
      const requiresMigration = Object.prototype.hasOwnProperty.call(data, 'sharedSettings') || Object.prototype.hasOwnProperty.call(data, 'bankSettings');
      delete data.sharedSettings;
      delete data.bankSettings;
      if (requiresMigration) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return data;
    };

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
    root.version = VERSION;
    if (!root.settings || typeof root.settings !== 'object' || Array.isArray(root.settings)) {
      root.settings = root.sharedSettings && typeof root.sharedSettings === 'object' ? root.sharedSettings : null;
    };
    delete root.sharedSettings;
    delete root.bankSettings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
    return true;
  } catch {
    return false;
  };
};

function normalizeDeckId(deckId) {
  return deckId === 'quocphong2' ? 'quocphong2' : 'quocphong1';
};

function normalizeSettingsEntry(rawData, deckId) {
  const settings = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? rawData : {};
  const count = Number(settings.count);
  return {
    deck: normalizeDeckId(deckId || settings.deck),
    count: Number.isInteger(count) && count > 0 ? count : 30,
    shuffleQuestions: settings.shuffleQuestions !== false && settings.shuffleQ !== false,
    shuffleAnswers: settings.shuffleAnswers !== false && settings.shuffleA !== false,
    startQuestion: Number.isInteger(Number(settings.startQuestion)) && Number(settings.startQuestion) > 0 ? Number(settings.startQuestion) : 1,
    endQuestion: Number.isInteger(Number(settings.endQuestion)) && Number(settings.endQuestion) > 0 ? Number(settings.endQuestion) : 0,
    timeLimit: Number.isInteger(Number(settings.timeLimit)) && Number(settings.timeLimit) >= 0 ? Math.min(1440, Number(settings.timeLimit)) : 35,
    practiceMode: settings.practiceMode === 'exam' ? 'exam' : 'practice',
    autoCheck: settings.autoCheck === true,
    autoAdvance: settings.autoAdvance === true,
    vibrationEnabled: settings.vibrationEnabled === true,
    autoAdvanceDelay: (() => {
      const delay = Number(settings.autoAdvanceDelay);
      return Number.isInteger(delay) && delay >= 0 ? Math.min(10, delay) : 0;
    })(),
    soundVolume: (() => {
      const volume = Number(settings.soundVolume);
      if (Number.isInteger(volume) && volume > 0) return Math.min(100, volume);
      return 1;
    })(),
    soundEnabled: (() => {
      if (settings.soundEnabled === true) return true;
      if (settings.soundEnabled === false) return false;
      const volume = Number(settings.soundVolume);
      return Number.isInteger(volume) && volume > 0;
    })()
  };
};

function legacySettingsFallback(root, activeDeck) {
  const rawData = root.sharedSettings;
  if (Array.isArray(rawData)) {
    const list = rawData.filter((entry) => entry && typeof entry === 'object');
    return list.find((entry) => normalizeDeckId(entry.deck) === activeDeck) || list[0] || {};
  };
  if (rawData && typeof rawData === 'object') return rawData;
  return {};
};

export function getSettings(deckId) {
  const root = readRoot();
  const activeDeck = normalizeDeckId(deckId || root.activeDeck || 'quocphong1');
  const settings = root.settings && typeof root.settings === 'object' ? root.settings : legacySettingsFallback(root, activeDeck);
  return normalizeSettingsEntry(settings, activeDeck);
};

export function saveSettings(settings) {
  const root = readRoot();
  const activeDeck = normalizeDeckId(settings?.deck || root.activeDeck);
  root.settings = normalizeSettingsEntry(settings, activeDeck);
  delete root.sharedSettings;
  delete root.bankSettings;
  root.activeDeck = activeDeck;
  return writeRoot(root);
};

export function getDeckProgress(deckId) {
  const root = readRoot();
  const decks = root.decks && typeof root.decks === 'object' ? root.decks : {};
  const deckData = decks[normalizeDeckId(deckId)] && typeof decks[normalizeDeckId(deckId)] === 'object' ? decks[normalizeDeckId(deckId)] : {};
  const completed = Array.isArray(deckData.completed) ? [...new Set(deckData.completed.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [];
  const wrongMap = {};
  if (deckData.wrongMap && typeof deckData.wrongMap === 'object' && !Array.isArray(deckData.wrongMap)) {
    for (const [key, value] of Object.entries(deckData.wrongMap)) {
      const index = Number(key);
      const count = Number(value);
      if (Number.isInteger(index) && index >= 0 && Number.isInteger(count) && count > 0) wrongMap[String(index)] = count;
    };
  };
  const cursor = Number(deckData.sequentialCursor);
  return {
    sequentialCursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    completed,
    wrongMap,
    wrongRangeMap: deckData.wrongRangeMap && typeof deckData.wrongRangeMap === 'object' && !Array.isArray(deckData.wrongRangeMap) ? Object.fromEntries(Object.entries(deckData.wrongRangeMap).filter(([range, indices]) => /^\d+-\d+$/.test(range) && Array.isArray(indices)).map(([range, indices]) => {
      const [start, end] = range.split('-').map(Number);
      return [
        range,
        [...new Set(indices.filter((index) => Number.isInteger(index) && index >= start - 1 && index < end))].sort((leftValue, rightValue) => leftValue - rightValue)
      ];
    })) : {},
    practiceMap: deckData.practiceMap && typeof deckData.practiceMap === 'object' && !Array.isArray(deckData.practiceMap) ? Object.fromEntries(Object.entries(deckData.practiceMap).filter(([key, value]) => Number.isInteger(Number(key)) && Number(key) >= 0 && Number.isInteger(value) && value > 0)) : {},
    bookmarks: Array.isArray(deckData.bookmarks) ? [...new Set(deckData.bookmarks.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
    dataFingerprint: typeof deckData.dataFingerprint === 'string' ? deckData.dataFingerprint : ''
  };
};

export function saveDeckProgress(deckId, progress) {
  const root = readRoot();
  if (!root.decks || typeof root.decks !== 'object' || Array.isArray(root.decks)) root.decks = {};
  root.decks[normalizeDeckId(deckId)] = {
    sequentialCursor: Number.isInteger(progress.sequentialCursor) ? Math.max(0, progress.sequentialCursor) : 0,
    completed: Array.isArray(progress.completed) ? [...new Set(progress.completed.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
    wrongMap: progress.wrongMap && typeof progress.wrongMap === 'object' && !Array.isArray(progress.wrongMap) ? progress.wrongMap : {},
    wrongRangeMap: progress.wrongRangeMap && typeof progress.wrongRangeMap === 'object' && !Array.isArray(progress.wrongRangeMap) ? Object.fromEntries(Object.entries(progress.wrongRangeMap).filter(([range, indices]) => /^\d+-\d+$/.test(range) && Array.isArray(indices)).map(([range, indices]) => {
      const [start, end] = range.split('-').map(Number);
      return [
        range,
        [...new Set(indices.filter((index) => Number.isInteger(index) && index >= start - 1 && index < end))].sort((leftValue, rightValue) => leftValue - rightValue)
      ];
    })) : {},
    practiceMap: progress.practiceMap && typeof progress.practiceMap === 'object' && !Array.isArray(progress.practiceMap) ? progress.practiceMap : {},
    bookmarks: Array.isArray(progress.bookmarks) ? [...new Set(progress.bookmarks.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
    dataFingerprint: typeof progress.dataFingerprint === 'string' ? progress.dataFingerprint : ''
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
  if (!session || !['quocphong1', 'quocphong2'].includes(session.deckId)) return false;
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

export function markWrong(deckId, originalIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(originalIndex);
  progress.wrongMap[key] = (progress.wrongMap[key] || 0) + 1;
  return saveDeckProgress(deckId, progress) ? progress.wrongMap[key] : null;
};

export function markPracticed(deckId, originalIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(originalIndex);
  progress.practiceMap[key] = (progress.practiceMap[key] || 0) + 1;
  return saveDeckProgress(deckId, progress) ? progress.practiceMap[key] : null;
};

export function addCompleted(deckId, indices, fingerprint) {
  const progress = getDeckProgress(deckId);
  const completed = new Set(progress.completed);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0) completed.add(index);
  };
  progress.completed = [...completed].sort((leftValue, rightValue) => leftValue - rightValue);
  if (fingerprint) progress.dataFingerprint = fingerprint;
  return saveDeckProgress(deckId, progress) ? progress : null;
};

export function setSequentialCursor(deckId, cursor, fingerprint) {
  const progress = getDeckProgress(deckId);
  progress.sequentialCursor = Number.isInteger(cursor) ? Math.max(0, cursor) : 0;
  if (fingerprint) progress.dataFingerprint = fingerprint;
  return saveDeckProgress(deckId, progress);
};

export function getWrongIndices(deckId) {
  const progress = getDeckProgress(deckId);
  return Object.keys(progress.wrongMap).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && progress.wrongMap[String(index)] > 0).sort((leftValue, rightValue) => leftValue - rightValue);
};

export function getRangeWrongIndices(deckId, startQuestion, endQuestion) {
  const start = Number(startQuestion);
  const end = Number(endQuestion);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return [];
  const progress = getDeckProgress(deckId);
  const key = start + '-' + end;
  if (!Object.prototype.hasOwnProperty.call(progress.wrongRangeMap, key)) {
    progress.wrongRangeMap[key] = Object.keys(progress.wrongMap).map(Number).filter((index) => index >= start - 1 && index < end && progress.wrongMap[String(index)] > 0).sort((leftValue, rightValue) => leftValue - rightValue);
    saveDeckProgress(deckId, progress);
  };
  return progress.wrongRangeMap[key].filter((index) => index >= start - 1 && index < end);
};

export function addWrongIndicesForRange(deckId, startQuestion, endQuestion, indices) {
  const start = Number(startQuestion);
  const end = Number(endQuestion);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || !Array.isArray(indices)) return false;
  const progress = getDeckProgress(deckId);
  const key = start + '-' + end;
  const existing = new Set(progress.wrongRangeMap[key] || []);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= start - 1 && index < end) existing.add(index);
  };
  progress.wrongRangeMap[key] = [...existing].sort((leftValue, rightValue) => leftValue - rightValue);
  return saveDeckProgress(deckId, progress);
};

export function getBookmarkedIndices(deckId) {
  return getDeckProgress(deckId).bookmarks;
};

export function toggleBookmark(deckId, originalIndex) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return null;
  const progress = getDeckProgress(deckId);
  const bookmarks = new Set(progress.bookmarks);
  if (bookmarks.has(originalIndex)) bookmarks.delete(originalIndex);
  else bookmarks.add(originalIndex);
  progress.bookmarks = [...bookmarks].sort((leftValue, rightValue) => leftValue - rightValue);
  return saveDeckProgress(deckId, progress) ? bookmarks.has(originalIndex) : null;
};

function normalizeHighlightRanges(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((range) => range && typeof range === 'object' && (range.target === 'question' || /^option:\d+$/.test(range.target)) && Number.isInteger(range.start) && range.start >= 0 && Number.isInteger(range.end) && range.end > range.start).map((range) => ({
    target: range.target,
    start: range.start,
    end: range.end
  }));
};

export function getQuestionHighlights(deckId, originalIndex) {
  const root = readRoot();
  const highlights = root.highlights && typeof root.highlights === 'object' ? root.highlights : {};
  const deck = highlights[normalizeDeckId(deckId)];
  return normalizeHighlightRanges(deck && deck[String(originalIndex)]);
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

export function saveQuestionHighlights(deckId, originalIndex, ranges) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return false;
  const root = readRoot();
  if (!root.highlights || typeof root.highlights !== 'object' || Array.isArray(root.highlights)) root.highlights = {};
  const deckIdentifier = normalizeDeckId(deckId);
  if (!root.highlights[deckIdentifier] || typeof root.highlights[deckIdentifier] !== 'object' || Array.isArray(root.highlights[deckIdentifier])) root.highlights[deckIdentifier] = {};
  const normalized = normalizeHighlightRanges(ranges);
  if (normalized.length) root.highlights[deckIdentifier][String(originalIndex)] = normalized;
  else delete root.highlights[deckIdentifier][String(originalIndex)];
  return writeRoot(root);
};

function normalizeNoteText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, 2000);
};

export function getQuestionNote(deckId, originalIndex) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return '';
  const root = readRoot();
  const notes = root.notes && typeof root.notes === 'object' ? root.notes : {};
  const deck = notes[normalizeDeckId(deckId)];
  if (!deck || typeof deck !== 'object') return '';
  return normalizeNoteText(deck[String(originalIndex)] || '');
};

export function saveQuestionNote(deckId, originalIndex, text) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return false;
  const root = readRoot();
  if (!root.notes || typeof root.notes !== 'object' || Array.isArray(root.notes)) root.notes = { quocphong1: {}, quocphong2: {} };
  const deckIdentifier = normalizeDeckId(deckId);
  if (!root.notes[deckIdentifier] || typeof root.notes[deckIdentifier] !== 'object' || Array.isArray(root.notes[deckIdentifier])) root.notes[deckIdentifier] = {};
  const normalized = normalizeNoteText(text);
  if (normalized) root.notes[deckIdentifier][String(originalIndex)] = normalized;
  else delete root.notes[deckIdentifier][String(originalIndex)];
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
  const question = typeof value.question === 'string' ? value.question.trim() : '';
  if (!question) return null;
  if (!Array.isArray(value.options) || value.options.length < 2) return null;
  const options = value.options.map((option) => typeof option === 'string' ? option.trim() : '').filter(Boolean);
  if (options.length < 2) return null;
  const correct = Number(value.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
  return { question, options, correct, fixed: value.fixed === true };
}

export function saveQuestionOverride(deckId, originalIndex, payload) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return false;
  const root = readRoot();
  if (!root.overrides || typeof root.overrides !== 'object' || Array.isArray(root.overrides)) root.overrides = { quocphong1: {}, quocphong2: {} };
  const deckIdentifier = normalizeDeckId(deckId);
  if (!root.overrides[deckIdentifier] || typeof root.overrides[deckIdentifier] !== 'object' || Array.isArray(root.overrides[deckIdentifier])) root.overrides[deckIdentifier] = {};
  if (payload === null) {
    delete root.overrides[deckIdentifier][String(originalIndex)];
    return writeRoot(root);
  }
  const normalized = normalizeOverrideEntry(payload);
  if (!normalized) return false;
  root.overrides[deckIdentifier][String(originalIndex)] = normalized;
  return writeRoot(root);
}

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
  }
  return result;
}

export function getHiddenIndices(deckId) {
  const root = readRoot();
  const hidden = root.hidden && typeof root.hidden === 'object' ? root.hidden : {};
  const list = hidden[normalizeDeckId(deckId)];
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b);
}

export function toggleHiddenQuestion(deckId, originalIndex) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return null;
  const root = readRoot();
  if (!root.hidden || typeof root.hidden !== 'object' || Array.isArray(root.hidden)) root.hidden = { quocphong1: [], quocphong2: [] };
  const deckIdentifier = normalizeDeckId(deckId);
  const set = new Set(Array.isArray(root.hidden[deckIdentifier]) ? root.hidden[deckIdentifier].filter((v) => Number.isInteger(v) && v >= 0) : []);
  if (set.has(originalIndex)) set.delete(originalIndex);
  else set.add(originalIndex);
  root.hidden[deckIdentifier] = [...set].sort((a, b) => a - b);
  if (!writeRoot(root)) return null;
  return set.has(originalIndex);
}

export function isQuestionHidden(deckId, originalIndex) {
  return getHiddenIndices(deckId).includes(originalIndex);
}

export function exportBackup() {
  const root = readRoot();
  const activeDeck = normalizeDeckId(root.activeDeck || 'quocphong1');
  const settings = root.settings && typeof root.settings === 'object' ? root.settings : legacySettingsFallback(root, activeDeck);
  return JSON.stringify({
    format: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings && typeof settings === 'object' ? settings : null,
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
  if (!backup || backup.format !== 'backup' || backup.version !== 1 || !backup.decks || typeof backup.decks !== 'object' || Array.isArray(backup.decks) || !Object.keys(backup.decks).every((deckIdentifier) => ['quocphong1', 'quocphong2'].includes(deckIdentifier))) return false;

  const activeDeck = normalizeDeckId(backup.activeDeck || 'quocphong1');
  let legacyFromBackup = {};
  if (Array.isArray(backup.settings)) {
    const list = backup.settings.filter((entry) => entry && typeof entry === 'object');
    legacyFromBackup = list.find((entry) => normalizeDeckId(entry.deck) === activeDeck) || list[0] || {};
  } else if (backup.settings && typeof backup.settings === 'object') legacyFromBackup = backup.settings;
  const importedSettings = normalizeSettingsEntry(
    backup.settings && typeof backup.settings === 'object' ? backup.settings : backup.sharedSettings && typeof backup.sharedSettings === 'object' ? backup.sharedSettings : legacyFromBackup,
    activeDeck
  );
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
      }
    }
  }

  normalized.hidden = { quocphong1: [], quocphong2: [] };
  if (backup.hidden && typeof backup.hidden === 'object' && !Array.isArray(backup.hidden)) {
    for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
      const list = backup.hidden[deckIdentifier];
      if (!Array.isArray(list)) continue;
      normalized.hidden[deckIdentifier] = [...new Set(list.filter((v) => Number.isInteger(v) && v >= 0))].sort((a, b) => a - b);
    }
  }

  for (const deckIdentifier of ['quocphong1', 'quocphong2']) {
    const deckData = backup.decks[deckIdentifier];
    if (!deckData || typeof deckData !== 'object' || Array.isArray(deckData)) continue;
    const wrongMap = {};
    if (deckData.wrongMap && typeof deckData.wrongMap === 'object' && !Array.isArray(deckData.wrongMap)) {
      for (const [key, value] of Object.entries(deckData.wrongMap)) {
        const index = Number(key);
        const count = Number(value);
        if (Number.isInteger(index) && index >= 0 && Number.isInteger(count) && count > 0) wrongMap[String(index)] = count;
      };
    };
    const practiceMap = {};
    if (deckData.practiceMap && typeof deckData.practiceMap === 'object' && !Array.isArray(deckData.practiceMap)) {
      for (const [key, value] of Object.entries(deckData.practiceMap)) {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && Number.isInteger(value) && value > 0) practiceMap[String(index)] = value;
      };
    };
    normalized.decks[deckIdentifier] = {
      sequentialCursor: Number.isInteger(deckData.sequentialCursor) && deckData.sequentialCursor >= 0 ? deckData.sequentialCursor : 0,
      completed: Array.isArray(deckData.completed) ? [...new Set(deckData.completed.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
      wrongMap,
      wrongRangeMap: deckData.wrongRangeMap && typeof deckData.wrongRangeMap === 'object' && !Array.isArray(deckData.wrongRangeMap) ? Object.fromEntries(Object.entries(deckData.wrongRangeMap).filter(([range, indices]) => /^\d+-\d+$/.test(range) && Array.isArray(indices)).map(([range, indices]) => {
        const [start, end] = range.split('-').map(Number);
        return [
          range,
          [...new Set(indices.filter((index) => Number.isInteger(index) && index >= start - 1 && index < end))].sort((leftValue, rightValue) => leftValue - rightValue)
        ];
      })) : {},
      practiceMap,
      bookmarks: Array.isArray(deckData.bookmarks) ? [...new Set(deckData.bookmarks.filter((value) => Number.isInteger(value) && value >= 0))].sort((leftValue, rightValue) => leftValue - rightValue) : [],
      dataFingerprint: typeof deckData.dataFingerprint === 'string' ? deckData.dataFingerprint : ''
    };
  };
  return writeRoot(normalized);
};

export function storageAvailable() {
  try {
    const key = STORAGE_KEY + ':probe';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  };
};