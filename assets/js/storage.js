const NS = 'quocphonganninh';

function readRoot() {
  try {
    const raw = localStorage.getItem(NS);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  };
};

function writeRoot(data) {
  try {
    localStorage.setItem(NS, JSON.stringify(data));
    return true;
  } catch {
    return false;
  };
};

function normalizeDeckId(deckId) {
  return deckId === 'qp2' ? 'qp2' : 'qp1';
};

function normalizeSettingsEntry(raw, deckId) {
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const count = Number(settings.count);
  return {
    deck: normalizeDeckId(deckId || settings.deck),
    count: Number.isInteger(count) && count > 0 ? count : 20,
    shuffleQ: !!settings.shuffleQ,
    shuffleA: settings.shuffleA !== false,
    startQuestion: Number.isInteger(Number(settings.startQuestion)) && Number(settings.startQuestion) > 0
      ? Number(settings.startQuestion)
      : 1,
    endQuestion: Number.isInteger(Number(settings.endQuestion)) && Number(settings.endQuestion) > 0
      ? Number(settings.endQuestion)
      : 0,
    timeLimit: Number.isInteger(Number(settings.timeLimit)) && Number(settings.timeLimit) >= 0
      ? Math.min(1440, Number(settings.timeLimit))
      : 0,
    practiceMode: settings.practiceMode === 'exam' ? 'exam' : 'practice'
  };
};

function readSettingsList(root) {
  const raw = root.settings;
  if (Array.isArray(raw)) {
    return raw
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => normalizeSettingsEntry(entry, entry.deck));
  };
  if (raw && typeof raw === 'object') {
    return [normalizeSettingsEntry(raw, raw.deck)];
  };
  return [];
};

export function getSettings(deckId) {
  const root = readRoot();
  const list = readSettingsList(root);
  const id = normalizeDeckId(deckId || root.activeDeck || 'qp1');
  const found = list.find((entry) => entry.deck === id);
  if (found) return { ...found };
  const legacy = list[0];
  if (legacy && !deckId) return { ...legacy, deck: id };
  return normalizeSettingsEntry({}, id);
};

export function saveSettings(settings) {
  const root = readRoot();
  const entry = normalizeSettingsEntry(settings, settings?.deck);
  const list = readSettingsList(root);
  const idx = list.findIndex((item) => item.deck === entry.deck);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  // Always keep qp1 + qp2 slots when possible
  for (const deck of ['qp1', 'qp2']) {
    if (!list.some((item) => item.deck === deck)) {
      list.push(normalizeSettingsEntry(deck === entry.deck ? entry : {}, deck));
    };
  };
  root.settings = list;
  root.activeDeck = entry.deck;
  return writeRoot(root);
};

export function getDeckProgress(deckId) {
  const root = readRoot();
  const decks = root.decks && typeof root.decks === 'object' ? root.decks : {};
  const d = decks[normalizeDeckId(deckId)] && typeof decks[normalizeDeckId(deckId)] === 'object'
    ? decks[normalizeDeckId(deckId)]
    : {};
  const completed = Array.isArray(d.completed)
    ? [...new Set(d.completed.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)
    : [];
  const wrongMap = {};
  if (d.wrongMap && typeof d.wrongMap === 'object' && !Array.isArray(d.wrongMap)) {
    for (const [key, value] of Object.entries(d.wrongMap)) {
      const index = Number(key);
      const count = Number(value);
      if (Number.isInteger(index) && index >= 0 && Number.isInteger(count) && count > 0) {
        wrongMap[String(index)] = count;
      };
    };
  };
  const cursor = Number(d.sequentialCursor);
  return {
    sequentialCursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    completed,
    wrongMap,
    practiceMap: d.practiceMap && typeof d.practiceMap === 'object' && !Array.isArray(d.practiceMap)
      ? Object.fromEntries(Object.entries(d.practiceMap).filter(([key, value]) => Number.isInteger(Number(key)) && Number(key) >= 0 && Number.isInteger(value) && value > 0))
      : {},
    bookmarks: Array.isArray(d.bookmarks)
      ? [...new Set(d.bookmarks.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)
      : [],
    dataFingerprint: typeof d.dataFingerprint === 'string' ? d.dataFingerprint : ''
  };
};

export function saveDeckProgress(deckId, progress) {
  const root = readRoot();
  if (!root.decks || typeof root.decks !== 'object' || Array.isArray(root.decks)) root.decks = {};
  root.decks[normalizeDeckId(deckId)] = {
    sequentialCursor: Number.isInteger(progress.sequentialCursor) ? Math.max(0, progress.sequentialCursor) : 0,
    completed: Array.isArray(progress.completed)
      ? [...new Set(progress.completed.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)
      : [],
    wrongMap: progress.wrongMap && typeof progress.wrongMap === 'object' && !Array.isArray(progress.wrongMap)
      ? progress.wrongMap
      : {},
    practiceMap: progress.practiceMap && typeof progress.practiceMap === 'object' && !Array.isArray(progress.practiceMap)
      ? progress.practiceMap
      : {},
    bookmarks: Array.isArray(progress.bookmarks)
      ? [...new Set(progress.bookmarks.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)
      : [],
    dataFingerprint: typeof progress.dataFingerprint === 'string' ? progress.dataFingerprint : ''
  };
  return writeRoot(root);
};

export function getSession() {
  const session = readRoot().session;
  return session && typeof session === 'object' && !Array.isArray(session) ? session : null;
};

export function saveSession(session) {
  const root = readRoot();
  root.session = session;
  return writeRoot(root);
};

export function clearSession() {
  const root = readRoot();
  delete root.session;
  return writeRoot(root);
};

export function resetDeckProgress(deckId) {
  const root = readRoot();
  if (!root.decks || typeof root.decks !== 'object' || Array.isArray(root.decks)) root.decks = {};
  delete root.decks[normalizeDeckId(deckId)];
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
  progress.completed = [...completed].sort((a, b) => a - b);
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
  return Object.keys(progress.wrongMap)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && progress.wrongMap[String(index)] > 0)
    .sort((a, b) => a - b);
};

export function getBookmarkedIndices(deckId) {
  return getDeckProgress(deckId).bookmarks;
};

export function toggleBookmark(deckId, originalIndex) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return null;
  const progress = getDeckProgress(deckId);
  const bookmarks = new Set(progress.bookmarks);
  const key = String(originalIndex);
  if (bookmarks.has(originalIndex)) bookmarks.delete(originalIndex);
  else bookmarks.add(originalIndex);
  progress.bookmarks = [...bookmarks].sort((a, b) => a - b);
  return saveDeckProgress(deckId, progress) ? bookmarks.has(originalIndex) : null;
};

export function exportBackup() {
  const root = readRoot();
  const list = readSettingsList(root);
  return JSON.stringify({
    format: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: list.length ? list : [],
    activeDeck: root.activeDeck || 'qp1',
    decks: root.decks || {}
  }, null, 2);
};

export function importBackup(raw) {
  let backup;
  try {
    backup = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return false;
  };
  if (!backup || backup.format !== 'backup' || backup.version !== 1 ||
      !backup.decks || typeof backup.decks !== 'object' || Array.isArray(backup.decks) ||
      !Object.keys(backup.decks).every((id) => ['qp1', 'qp2'].includes(id))) return false;

  let settingsList = [];
  if (Array.isArray(backup.settings)) {
    settingsList = backup.settings
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => normalizeSettingsEntry(entry, entry.deck));
  } else if (backup.settings && typeof backup.settings === 'object') {
    settingsList = [normalizeSettingsEntry(backup.settings, backup.settings.deck)];
  };
  for (const deck of ['qp1', 'qp2']) {
    if (!settingsList.some((entry) => entry.deck === deck)) {
      settingsList.push(normalizeSettingsEntry({}, deck));
    };
  };
  const normalized = {
    settings: settingsList,
    activeDeck: normalizeDeckId(backup.activeDeck || settingsList[0]?.deck || 'qp1'),
    decks: {}
  };

  for (const id of ['qp1', 'qp2']) {
    const d = backup.decks[id];
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    const wrongMap = {};
    if (d.wrongMap && typeof d.wrongMap === 'object' && !Array.isArray(d.wrongMap)) {
      for (const [key, value] of Object.entries(d.wrongMap)) {
        const index = Number(key);
        const count = Number(value);
        if (Number.isInteger(index) && index >= 0 && Number.isInteger(count) && count > 0) wrongMap[String(index)] = count;
      };
    };
    const practiceMap = {};
    if (d.practiceMap && typeof d.practiceMap === 'object' && !Array.isArray(d.practiceMap)) {
      for (const [key, value] of Object.entries(d.practiceMap)) {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && Number.isInteger(value) && value > 0) practiceMap[String(index)] = value;
      };
    };
    normalized.decks[id] = {
      sequentialCursor: Number.isInteger(d.sequentialCursor) && d.sequentialCursor >= 0 ? d.sequentialCursor : 0,
      completed: Array.isArray(d.completed) ? [...new Set(d.completed.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b) : [],
      wrongMap,
      practiceMap,
      bookmarks: Array.isArray(d.bookmarks) ? [...new Set(d.bookmarks.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b) : [],
      dataFingerprint: typeof d.dataFingerprint === 'string' ? d.dataFingerprint : ''
    };
  };
  return writeRoot(normalized);
};

export function storageAvailable() {
  try {
    const key = NS + ':probe';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  };
};