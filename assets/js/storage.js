const NS = 'quocphongQuiz:v1';

function readRoot() {
  try {
    const raw = localStorage.getItem(NS);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeRoot(data) {
  try {
    localStorage.setItem(NS, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function normalizeDeckId(deckId) {
  return deckId === 'qp2' ? 'qp2' : 'qp1';
}

export function getSettings() {
  const root = readRoot();
  const settings = root.settings && typeof root.settings === 'object' ? root.settings : {};
  const count = Number(settings.count);
  return {
    deck: normalizeDeckId(settings.deck),
    count: Number.isInteger(count) && count > 0 ? count : 20,
    shuffleQ: !!settings.shuffleQ,
    shuffleA: settings.shuffleA !== false
  };
}

export function saveSettings(settings) {
  const root = readRoot();
  const count = Number(settings.count);
  root.settings = {
    deck: normalizeDeckId(settings.deck),
    count: Number.isInteger(count) && count > 0 ? count : 20,
    shuffleQ: !!settings.shuffleQ,
    shuffleA: settings.shuffleA !== false
  };
  return writeRoot(root);
}

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
      }
    }
  }
  const cursor = Number(d.sequentialCursor);
  return {
    sequentialCursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    completed,
    wrongMap,
    dataFingerprint: typeof d.dataFingerprint === 'string' ? d.dataFingerprint : ''
  };
}

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
    dataFingerprint: typeof progress.dataFingerprint === 'string' ? progress.dataFingerprint : ''
  };
  return writeRoot(root);
}

export function getSession() {
  const session = readRoot().session;
  return session && typeof session === 'object' && !Array.isArray(session) ? session : null;
}

export function saveSession(session) {
  const root = readRoot();
  root.session = session;
  return writeRoot(root);
}

export function clearSession() {
  const root = readRoot();
  delete root.session;
  return writeRoot(root);
}

export function resetDeckProgress(deckId) {
  const root = readRoot();
  if (!root.decks || typeof root.decks !== 'object' || Array.isArray(root.decks)) root.decks = {};
  delete root.decks[normalizeDeckId(deckId)];
  if (root.session?.deckId === normalizeDeckId(deckId)) delete root.session;
  return writeRoot(root);
}

export function markWrong(deckId, originalIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(originalIndex);
  progress.wrongMap[key] = (progress.wrongMap[key] || 0) + 1;
  saveDeckProgress(deckId, progress);
  return progress.wrongMap[key];
}

export function addCompleted(deckId, indices, fingerprint) {
  const progress = getDeckProgress(deckId);
  const completed = new Set(progress.completed);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0) completed.add(index);
  }
  progress.completed = [...completed].sort((a, b) => a - b);
  if (fingerprint) progress.dataFingerprint = fingerprint;
  saveDeckProgress(deckId, progress);
  return progress;
}

export function setSequentialCursor(deckId, cursor, fingerprint) {
  const progress = getDeckProgress(deckId);
  progress.sequentialCursor = Number.isInteger(cursor) ? Math.max(0, cursor) : 0;
  if (fingerprint) progress.dataFingerprint = fingerprint;
  saveDeckProgress(deckId, progress);
}

export function getWrongIndices(deckId) {
  const progress = getDeckProgress(deckId);
  return Object.keys(progress.wrongMap)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && progress.wrongMap[String(index)] > 0)
    .sort((a, b) => a - b);
}

export function storageAvailable() {
  try {
    const key = NS + ':probe';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
