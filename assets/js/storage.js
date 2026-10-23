const NS = 'quocphongQuiz:v1';

function safeParse(raw, fallback) {
  try {
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readRoot() {
  try {
    return safeParse(localStorage.getItem(NS), {});
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

export function getSettings() {
  const root = readRoot();
  return {
    deck: root.settings?.deck || 'qp1',
    count: root.settings?.count ?? 20,
    shuffleQ: !!root.settings?.shuffleQ,
    shuffleA: root.settings?.shuffleA !== false
  };
}

export function saveSettings(settings) {
  const root = readRoot();
  root.settings = {
    deck: settings.deck,
    count: settings.count,
    shuffleQ: !!settings.shuffleQ,
    shuffleA: !!settings.shuffleA
  };
  writeRoot(root);
}

function deckKey(deckId) {
  return deckId === 'qp2' ? 'qp2' : 'qp1';
}

export function getDeckProgress(deckId) {
  const root = readRoot();
  const d = root.decks?.[deckKey(deckId)] || {};
  return {
    sequentialCursor: Number.isFinite(d.sequentialCursor) ? d.sequentialCursor : 0,
    completed: Array.isArray(d.completed) ? d.completed : [],
    wrongMap: d.wrongMap && typeof d.wrongMap === 'object' ? d.wrongMap : {},
    dataFingerprint: d.dataFingerprint || ''
  };
}

export function saveDeckProgress(deckId, progress) {
  const root = readRoot();
  if (!root.decks) root.decks = {};
  root.decks[deckKey(deckId)] = {
    sequentialCursor: progress.sequentialCursor | 0,
    completed: Array.isArray(progress.completed) ? progress.completed : [],
    wrongMap: progress.wrongMap || {},
    dataFingerprint: progress.dataFingerprint || ''
  };
  writeRoot(root);
}

export function getSession() {
  const root = readRoot();
  return root.session || null;
}

export function saveSession(session) {
  const root = readRoot();
  root.session = session;
  writeRoot(root);
}

export function clearSession() {
  const root = readRoot();
  delete root.session;
  writeRoot(root);
}

export function resetDeckProgress(deckId) {
  const root = readRoot();
  if (!root.decks) root.decks = {};
  delete root.decks[deckKey(deckId)];
  if (root.session && root.session.deckId === deckId) {
    delete root.session;
  }
  writeRoot(root);
}

export function markWrong(deckId, originalIndex) {
  const p = getDeckProgress(deckId);
  const key = String(originalIndex);
  p.wrongMap[key] = (p.wrongMap[key] || 0) + 1;
  saveDeckProgress(deckId, p);
  return p.wrongMap[key];
}

export function addCompleted(deckId, indices, fingerprint) {
  const p = getDeckProgress(deckId);
  const set = new Set(p.completed);
  for (const i of indices) set.add(i);
  p.completed = Array.from(set).sort((a, b) => a - b);
  if (fingerprint) p.dataFingerprint = fingerprint;
  saveDeckProgress(deckId, p);
  return p;
}

export function setSequentialCursor(deckId, cursor, fingerprint) {
  const p = getDeckProgress(deckId);
  p.sequentialCursor = Math.max(0, cursor | 0);
  if (fingerprint) p.dataFingerprint = fingerprint;
  saveDeckProgress(deckId, p);
}

export function getWrongIndices(deckId) {
  const p = getDeckProgress(deckId);
  return Object.keys(p.wrongMap)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && p.wrongMap[String(n)] > 0)
    .sort((a, b) => a - b);
}

export function storageAvailable() {
  try {
    const k = NS + ':probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}
