const STORAGE_NAMESPACE = "quocphonganninh";
const STORAGE_VERSION = 2;
const RECOVERY_KEY = `${STORAGE_NAMESPACE}:recovery-backup`;

function emptyRoot() {
  return {
    version: STORAGE_VERSION,
    settings: [],
    sharedSettings: null,
    activeDeck: "quocphong1",
    bankSettings: null,
    decks: {},
    sessions: {},
    highlights: { quocphong1: {}, quocphong2: {} },
  };
}

function preserveInvalidRoot(raw, reason) {
  if (typeof raw !== "string" || !raw) return false;
  try {
    if (localStorage.getItem(RECOVERY_KEY)) return true;
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({
      format: "quocphonganninh-storage-recovery",
      version: 1,
      createdAt: new Date().toISOString(),
      reason,
      raw,
    }));
    return true;
  } catch {
    return false;
  }
}

export function getRecoveryBackup() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const backup = JSON.parse(raw);
    return backup?.format === "quocphonganninh-storage-recovery" && typeof backup.raw === "string"
      ? backup
      : null;
  } catch {
    return null;
  }
}

function readRoot() {
  try {
    const raw = localStorage.getItem(STORAGE_NAMESPACE);
    if (!raw) return emptyRoot();

    const data = JSON.parse(raw);
    const valid =
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      data.version === STORAGE_VERSION &&
      Array.isArray(data.settings) &&
      data.decks &&
      typeof data.decks === "object" &&
      !Array.isArray(data.decks) &&
      ["quocphong1", "quocphong2"].every(
        (id) =>
          !Object.prototype.hasOwnProperty.call(data.decks, id) ||
          (data.decks[id] &&
            typeof data.decks[id] === "object" &&
            !Array.isArray(data.decks[id])),
      ) &&
      (!data.sessions ||
        (typeof data.sessions === "object" && !Array.isArray(data.sessions))) &&
      (!data.highlights ||
        (typeof data.highlights === "object" &&
          !Array.isArray(data.highlights)));

    if (valid) return data;

    preserveInvalidRoot(raw, "Dữ liệu lưu trữ không đúng cấu trúc hoặc khác phiên bản.");
    return emptyRoot();
  } catch {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_NAMESPACE); } catch {}
    preserveInvalidRoot(raw, "Không thể phân tích dữ liệu lưu trữ thành JSON.");
    return emptyRoot();
  }
}

function writeRoot(data) {
  try {
    const root =
      data && typeof data === "object" && !Array.isArray(data)
        ? data
        : emptyRoot();
    root.version = STORAGE_VERSION;
    localStorage.setItem(STORAGE_NAMESPACE, JSON.stringify(root));
    return true;
  } catch {
    return false;
  }
}

function normalizeDeckId(deckId) {
  if (deckId === "custom") return "custom";
  return deckId === "quocphong2" ? "quocphong2" : "quocphong1";
}

function normalizeSettingsEntry(raw, deckId) {
  const settings =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const count = Number(settings.count);
  return {
    deck: normalizeDeckId(deckId || settings.deck),
    count: Number.isInteger(count) && count > 0 ? count : 30,
    shuffleQuestions:
      settings.shuffleQuestions !== false && settings.shuffleQ !== false,
    shuffleAnswers:
      settings.shuffleAnswers !== false && settings.shuffleA !== false,
    startQuestion:
      Number.isInteger(Number(settings.startQuestion)) &&
      Number(settings.startQuestion) > 0
        ? Number(settings.startQuestion)
        : 1,
    endQuestion:
      Number.isInteger(Number(settings.endQuestion)) &&
      Number(settings.endQuestion) > 0
        ? Number(settings.endQuestion)
        : 0,
    timeLimit:
      Number.isInteger(Number(settings.timeLimit)) &&
      Number(settings.timeLimit) >= 0
        ? Math.min(1440, Number(settings.timeLimit))
        : 35,
    practiceMode: settings.practiceMode === "exam" ? "exam" : "practice",
    autoCheck: settings.autoCheck === true,
    autoAdvance: settings.autoAdvance === true,
    soundEnabled: settings.soundEnabled !== false,
    vibrationEnabled: settings.vibrationEnabled !== false,
  };
}

function readSettingsList(root) {
  const raw = root.settings;
  if (Array.isArray(raw)) {
    return raw
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => normalizeSettingsEntry(entry, entry.deck));
  }
  if (raw && typeof raw === "object") {
    return [normalizeSettingsEntry(raw, raw.deck)];
  }
  return [];
}

export function getSettings(deckId) {
  const root = readRoot();
  const settingsList = readSettingsList(root);
  const activeDeck = normalizeDeckId(deckId || root.activeDeck || "quocphong1");
  const sharedSettings =
    root.sharedSettings && typeof root.sharedSettings === "object"
      ? root.sharedSettings
      : settingsList.find((entry) => entry.deck === activeDeck) ||
        settingsList[0] ||
        {};
  return normalizeSettingsEntry(sharedSettings, activeDeck);
}

export function saveSettings(settings) {
  const root = readRoot();
  const activeDeck = normalizeDeckId(settings?.deck || root.activeDeck);
  const sharedSettings = normalizeSettingsEntry(settings, activeDeck);
  root.sharedSettings = sharedSettings;
  root.settings = ["quocphong1", "quocphong2"].map((deck) => ({
    ...sharedSettings,
    deck,
  }));
  root.activeDeck = activeDeck;
  return writeRoot(root);
}

export function getBankSettings() {
  const root = readRoot();
  const rawSettings =
    root.bankSettings &&
    typeof root.bankSettings === "object" &&
    !Array.isArray(root.bankSettings)
      ? root.bankSettings
      : {};
  const deck = normalizeDeckId(rawSettings.deck || root.activeDeck);
  const settings = normalizeSettingsEntry(rawSettings, deck);
  const count = Number(rawSettings.count);
  return {
    ...settings,
    count: Number.isInteger(count) && count >= 0 ? count : 0,
    deck,
  };
}

export function saveBankSettings(settings) {
  const root = readRoot();
  const deck = normalizeDeckId(
    settings?.deck || root.bankSettings?.deck || root.activeDeck,
  );
  const normalizedSettings = normalizeSettingsEntry(settings, deck);
  const count = Number(settings?.count);
  root.bankSettings = {
    ...normalizedSettings,
    count: Number.isInteger(count) && count >= 0 ? count : 0,
    deck,
  };
  return writeRoot(root);
}

export function getDeckProgress(deckId) {
  const root = readRoot();
  const decks = root.decks && typeof root.decks === "object" ? root.decks : {};
  const deckData =
    decks[normalizeDeckId(deckId)] &&
    typeof decks[normalizeDeckId(deckId)] === "object"
      ? decks[normalizeDeckId(deckId)]
      : {};
  const completed = Array.isArray(deckData.completed)
    ? [
        ...new Set(
          deckData.completed.filter(
            (value) => Number.isInteger(value) && value >= 0,
          ),
        ),
      ].sort((leftValue, rightValue) => leftValue - rightValue)
    : [];
  const wrongMap = {};
  if (
    deckData.wrongMap &&
    typeof deckData.wrongMap === "object" &&
    !Array.isArray(deckData.wrongMap)
  ) {
    for (const [key, value] of Object.entries(deckData.wrongMap)) {
      const index = Number(key);
      const count = Number(value);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        Number.isInteger(count) &&
        count > 0
      ) {
        wrongMap[String(index)] = count;
      }
    }
  }
  const cursor = Number(deckData.sequentialCursor);
  return {
    sequentialCursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    completed,
    wrongMap,
    wrongRangeMap:
      deckData.wrongRangeMap &&
      typeof deckData.wrongRangeMap === "object" &&
      !Array.isArray(deckData.wrongRangeMap)
        ? Object.fromEntries(
            Object.entries(deckData.wrongRangeMap)
              .filter(
                ([range, indices]) =>
                  /^\d+-\d+$/.test(range) && Array.isArray(indices),
              )
              .map(([range, indices]) => {
                const [start, end] = range.split("-").map(Number);
                return [
                  range,
                  [
                    ...new Set(
                      indices.filter(
                        (index) =>
                          Number.isInteger(index) &&
                          index >= start - 1 &&
                          index < end,
                      ),
                    ),
                  ].sort((leftValue, rightValue) => leftValue - rightValue),
                ];
              }),
          )
        : {},
    practiceMap:
      deckData.practiceMap &&
      typeof deckData.practiceMap === "object" &&
      !Array.isArray(deckData.practiceMap)
        ? Object.fromEntries(
            Object.entries(deckData.practiceMap).filter(
              ([key, value]) =>
                Number.isInteger(Number(key)) &&
                Number(key) >= 0 &&
                Number.isInteger(value) &&
                value > 0,
            ),
          )
        : {},
    bookmarks: Array.isArray(deckData.bookmarks)
      ? [
          ...new Set(
            deckData.bookmarks.filter(
              (value) => Number.isInteger(value) && value >= 0,
            ),
          ),
        ].sort((leftValue, rightValue) => leftValue - rightValue)
      : [],
    dataFingerprint:
      typeof deckData.dataFingerprint === "string"
        ? deckData.dataFingerprint
        : "",
    questionIds: Array.isArray(deckData.questionIds)
      ? deckData.questionIds.filter((value) => typeof value === "string")
      : [],
  };
}

export function saveDeckProgress(deckId, progress) {
  const root = readRoot();
  if (
    !root.decks ||
    typeof root.decks !== "object" ||
    Array.isArray(root.decks)
  )
    root.decks = {};
  root.decks[normalizeDeckId(deckId)] = {
    sequentialCursor: Number.isInteger(progress.sequentialCursor)
      ? Math.max(0, progress.sequentialCursor)
      : 0,
    completed: Array.isArray(progress.completed)
      ? [
          ...new Set(
            progress.completed.filter(
              (value) => Number.isInteger(value) && value >= 0,
            ),
          ),
        ].sort((leftValue, rightValue) => leftValue - rightValue)
      : [],
    wrongMap:
      progress.wrongMap &&
      typeof progress.wrongMap === "object" &&
      !Array.isArray(progress.wrongMap)
        ? progress.wrongMap
        : {},
    wrongRangeMap:
      progress.wrongRangeMap &&
      typeof progress.wrongRangeMap === "object" &&
      !Array.isArray(progress.wrongRangeMap)
        ? Object.fromEntries(
            Object.entries(progress.wrongRangeMap)
              .filter(
                ([range, indices]) =>
                  /^\d+-\d+$/.test(range) && Array.isArray(indices),
              )
              .map(([range, indices]) => {
                const [start, end] = range.split("-").map(Number);
                return [
                  range,
                  [
                    ...new Set(
                      indices.filter(
                        (index) =>
                          Number.isInteger(index) &&
                          index >= start - 1 &&
                          index < end,
                      ),
                    ),
                  ].sort((leftValue, rightValue) => leftValue - rightValue),
                ];
              }),
          )
        : {},
    practiceMap:
      progress.practiceMap &&
      typeof progress.practiceMap === "object" &&
      !Array.isArray(progress.practiceMap)
        ? progress.practiceMap
        : {},
    bookmarks: Array.isArray(progress.bookmarks)
      ? [
          ...new Set(
            progress.bookmarks.filter(
              (value) => Number.isInteger(value) && value >= 0,
            ),
          ),
        ].sort((leftValue, rightValue) => leftValue - rightValue)
      : [],
    dataFingerprint:
      typeof progress.dataFingerprint === "string"
        ? progress.dataFingerprint
        : "",
    questionIds: Array.isArray(progress.questionIds)
      ? progress.questionIds.filter((value) => typeof value === "string")
      : [],
  };
  return writeRoot(root);
}

export function getSession(deckId) {
  const root = readRoot();
  const id = normalizeDeckId(deckId || root.activeDeck || "quocphong1");
  const sessions =
    root.sessions &&
    typeof root.sessions === "object" &&
    !Array.isArray(root.sessions)
      ? root.sessions
      : {};
  const session =
    sessions[id] || (root.session?.deckId === id ? root.session : null);
  return session && typeof session === "object" && !Array.isArray(session)
    ? session
    : null;
}

export function saveSession(session) {
  if (!session || !["quocphong1", "quocphong2", "custom"].includes(session.deckId))
    return false;
  const root = readRoot();
  if (
    !root.sessions ||
    typeof root.sessions !== "object" ||
    Array.isArray(root.sessions)
  )
    root.sessions = {};
  root.sessions[session.deckId] = session;
  if (root.session?.deckId === session.deckId) delete root.session;
  return writeRoot(root);
}

export function clearSession(deckId) {
  const root = readRoot();
  if (
    !root.sessions ||
    typeof root.sessions !== "object" ||
    Array.isArray(root.sessions)
  )
    root.sessions = {};
  const id = normalizeDeckId(deckId || root.activeDeck || "quocphong1");
  delete root.sessions[id];
  if (root.session?.deckId === id) delete root.session;
  return writeRoot(root);
}

export function resetDeckProgress(deckId) {
  const root = readRoot();
  if (
    !root.decks ||
    typeof root.decks !== "object" ||
    Array.isArray(root.decks)
  )
    root.decks = {};
  delete root.decks[normalizeDeckId(deckId)];
  if (
    !root.sessions ||
    typeof root.sessions !== "object" ||
    Array.isArray(root.sessions)
  )
    root.sessions = {};
  delete root.sessions[normalizeDeckId(deckId)];
  if (root.session?.deckId === normalizeDeckId(deckId)) delete root.session;
  return writeRoot(root);
}

export function markWrong(deckId, originalIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(originalIndex);
  progress.wrongMap[key] = (progress.wrongMap[key] || 0) + 1;
  return saveDeckProgress(deckId, progress) ? progress.wrongMap[key] : null;
}

export function markPracticed(deckId, originalIndex) {
  const progress = getDeckProgress(deckId);
  const key = String(originalIndex);
  progress.practiceMap[key] = (progress.practiceMap[key] || 0) + 1;
  return saveDeckProgress(deckId, progress) ? progress.practiceMap[key] : null;
}

export function addCompleted(deckId, indices, fingerprint) {
  const progress = getDeckProgress(deckId);
  const completed = new Set(progress.completed);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0) completed.add(index);
  }
  progress.completed = [...completed].sort(
    (leftValue, rightValue) => leftValue - rightValue,
  );
  if (fingerprint) progress.dataFingerprint = fingerprint;
  return saveDeckProgress(deckId, progress) ? progress : null;
}

export function setSequentialCursor(deckId, cursor, fingerprint) {
  const progress = getDeckProgress(deckId);
  progress.sequentialCursor = Number.isInteger(cursor)
    ? Math.max(0, cursor)
    : 0;
  if (fingerprint) progress.dataFingerprint = fingerprint;
  return saveDeckProgress(deckId, progress);
}

export function getWrongIndices(deckId) {
  const progress = getDeckProgress(deckId);
  return Object.keys(progress.wrongMap)
    .map(Number)
    .filter(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        progress.wrongMap[String(index)] > 0,
    )
    .sort((leftValue, rightValue) => leftValue - rightValue);
}

export function getRangeWrongIndices(deckId, startQuestion, endQuestion) {
  const start = Number(startQuestion);
  const end = Number(endQuestion);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start
  )
    return [];
  const progress = getDeckProgress(deckId);
  const key = `${start}-${end}`;
  if (!Object.prototype.hasOwnProperty.call(progress.wrongRangeMap, key)) {
    // Migrate old per-question wrong history into this range the first time it is opened.
    progress.wrongRangeMap[key] = Object.keys(progress.wrongMap)
      .map(Number)
      .filter(
        (index) =>
          index >= start - 1 &&
          index < end &&
          progress.wrongMap[String(index)] > 0,
      )
      .sort((leftValue, rightValue) => leftValue - rightValue);
    saveDeckProgress(deckId, progress);
  }
  return progress.wrongRangeMap[key].filter(
    (index) => index >= start - 1 && index < end,
  );
}

export function addWrongIndicesForRange(
  deckId,
  startQuestion,
  endQuestion,
  indices,
) {
  const start = Number(startQuestion);
  const end = Number(endQuestion);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    !Array.isArray(indices)
  )
    return false;
  const progress = getDeckProgress(deckId);
  const key = `${start}-${end}`;
  const existing = new Set(progress.wrongRangeMap[key] || []);
  for (const index of indices) {
    if (Number.isInteger(index) && index >= start - 1 && index < end)
      existing.add(index);
  }
  progress.wrongRangeMap[key] = [...existing].sort(
    (leftValue, rightValue) => leftValue - rightValue,
  );
  return saveDeckProgress(deckId, progress);
}

export function getBookmarkedIndices(deckId) {
  return getDeckProgress(deckId).bookmarks;
}

export function toggleBookmark(deckId, originalIndex) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return null;
  const progress = getDeckProgress(deckId);
  const bookmarks = new Set(progress.bookmarks);
  if (bookmarks.has(originalIndex)) bookmarks.delete(originalIndex);
  else bookmarks.add(originalIndex);
  progress.bookmarks = [...bookmarks].sort(
    (leftValue, rightValue) => leftValue - rightValue,
  );
  return saveDeckProgress(deckId, progress)
    ? bookmarks.has(originalIndex)
    : null;
}

function normalizeHighlightRanges(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (range) =>
        range &&
        typeof range === "object" &&
        (range.target === "question" || /^option:\d+$/.test(range.target)) &&
        Number.isInteger(range.start) &&
        range.start >= 0 &&
        Number.isInteger(range.end) &&
        range.end > range.start,
    )
    .map((range) => ({
      target: range.target,
      start: range.start,
      end: range.end,
    }));
}

export function getQuestionHighlights(deckId, originalIndex) {
  const root = readRoot();
  const highlights =
    root.highlights && typeof root.highlights === "object"
      ? root.highlights
      : {};
  const deck = highlights[normalizeDeckId(deckId)];
  return normalizeHighlightRanges(deck && deck[String(originalIndex)]);
}

export function resetDeckHighlights(deckId) {
  const root = readRoot();
  if (
    !root.highlights ||
    typeof root.highlights !== "object" ||
    Array.isArray(root.highlights)
  ) {
    root.highlights = { quocphong1: {}, quocphong2: {} };
  }
  root.highlights[normalizeDeckId(deckId)] = {};
  return writeRoot(root);
}

export function saveQuestionHighlights(deckId, originalIndex, ranges) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return false;
  const root = readRoot();
  if (
    !root.highlights ||
    typeof root.highlights !== "object" ||
    Array.isArray(root.highlights)
  )
    root.highlights = {};
  const id = normalizeDeckId(deckId);
  if (
    !root.highlights[id] ||
    typeof root.highlights[id] !== "object" ||
    Array.isArray(root.highlights[id])
  )
    root.highlights[id] = {};
  const normalized = normalizeHighlightRanges(ranges);
  if (normalized.length)
    root.highlights[id][String(originalIndex)] = normalized;
  else delete root.highlights[id][String(originalIndex)];
  return writeRoot(root);
}

export function exportBackup() {
  const root = readRoot();
  const list = readSettingsList(root);
  return JSON.stringify(
    {
      format: "backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: list.length ? list : [],
      sharedSettings:
        root.sharedSettings ||
        list.find((entry) => entry.deck === root.activeDeck) ||
        list[0] ||
        null,
      bankSettings: root.bankSettings || null,
      bankDeck: root.bankSettings?.deck || root.activeDeck || "quocphong1",
      activeDeck: root.activeDeck || "quocphong1",
      decks: root.decks || {},
      highlights: root.highlights || { quocphong1: {}, quocphong2: {} },
    },
    null,
    2,
  );
}

export function importBackup(raw) {
  let backup;
  try {
    backup = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return false;
  }
  if (
    !backup ||
    backup.format !== "backup" ||
    backup.version !== 1 ||
    !backup.decks ||
    typeof backup.decks !== "object" ||
    Array.isArray(backup.decks) ||
    !Object.keys(backup.decks).every((id) =>
      ["quocphong1", "quocphong2"].includes(id),
    )
  )
    return false;

  let settingsList = [];
  if (Array.isArray(backup.settings)) {
    settingsList = backup.settings
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => normalizeSettingsEntry(entry, entry.deck));
  } else if (backup.settings && typeof backup.settings === "object") {
    settingsList = [
      normalizeSettingsEntry(backup.settings, backup.settings.deck),
    ];
  }
  for (const deck of ["quocphong1", "quocphong2"]) {
    if (!settingsList.some((entry) => entry.deck === deck)) {
      settingsList.push(normalizeSettingsEntry({}, deck));
    }
  }
  const activeDeck = normalizeDeckId(
    backup.activeDeck || settingsList[0]?.deck || "quocphong1",
  );
  const importedSharedSettings = normalizeSettingsEntry(
    backup.sharedSettings && typeof backup.sharedSettings === "object"
      ? backup.sharedSettings
      : settingsList.find((entry) => entry.deck === activeDeck) ||
          settingsList[0] ||
          {},
    activeDeck,
  );
  const normalized = {
    settings: ["quocphong1", "quocphong2"].map((deck) => ({
      ...importedSharedSettings,
      deck,
    })),
    sharedSettings: importedSharedSettings,
    activeDeck,
    bankSettings: (() => {
      const rawBankSettings =
        backup.bankSettings && typeof backup.bankSettings === "object"
          ? backup.bankSettings
          : { deck: backup.bankDeck || activeDeck };
      const bankDeck = normalizeDeckId(
        rawBankSettings.deck || backup.bankDeck || activeDeck,
      );
      const normalizedBankSettings = normalizeSettingsEntry(
        rawBankSettings,
        bankDeck,
      );
      const bankCount = Number(rawBankSettings.count);
      return {
        ...normalizedBankSettings,
        count: Number.isInteger(bankCount) && bankCount >= 0 ? bankCount : 0,
        deck: bankDeck,
      };
    })(),
    decks: {},
    sessions: {},
    highlights: { quocphong1: {}, quocphong2: {} },
  };

  if (
    backup.highlights &&
    typeof backup.highlights === "object" &&
    !Array.isArray(backup.highlights)
  ) {
    for (const id of ["quocphong1", "quocphong2"]) {
      const deck = backup.highlights[id];
      if (!deck || typeof deck !== "object" || Array.isArray(deck)) continue;
      for (const [key, ranges] of Object.entries(deck)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0) continue;
        const valid = normalizeHighlightRanges(ranges);
        if (valid.length) normalized.highlights[id][String(index)] = valid;
      }
    }
  }

  for (const id of ["quocphong1", "quocphong2"]) {
    const deckData = backup.decks[id];
    if (!deckData || typeof deckData !== "object" || Array.isArray(deckData))
      continue;
    const wrongMap = {};
    if (
      deckData.wrongMap &&
      typeof deckData.wrongMap === "object" &&
      !Array.isArray(deckData.wrongMap)
    ) {
      for (const [key, value] of Object.entries(deckData.wrongMap)) {
        const index = Number(key);
        const count = Number(value);
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          Number.isInteger(count) &&
          count > 0
        )
          wrongMap[String(index)] = count;
      }
    }
    const practiceMap = {};
    if (
      deckData.practiceMap &&
      typeof deckData.practiceMap === "object" &&
      !Array.isArray(deckData.practiceMap)
    ) {
      for (const [key, value] of Object.entries(deckData.practiceMap)) {
        const index = Number(key);
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          Number.isInteger(value) &&
          value > 0
        )
          practiceMap[String(index)] = value;
      }
    }
    normalized.decks[id] = {
      sequentialCursor:
        Number.isInteger(deckData.sequentialCursor) &&
        deckData.sequentialCursor >= 0
          ? deckData.sequentialCursor
          : 0,
      completed: Array.isArray(deckData.completed)
        ? [
            ...new Set(
              deckData.completed.filter(
                (value) => Number.isInteger(value) && value >= 0,
              ),
            ),
          ].sort((leftValue, rightValue) => leftValue - rightValue)
        : [],
      wrongMap,
      wrongRangeMap:
        deckData.wrongRangeMap &&
        typeof deckData.wrongRangeMap === "object" &&
        !Array.isArray(deckData.wrongRangeMap)
          ? Object.fromEntries(
              Object.entries(deckData.wrongRangeMap)
                .filter(
                  ([range, indices]) =>
                    /^\d+-\d+$/.test(range) && Array.isArray(indices),
                )
                .map(([range, indices]) => {
                  const [start, end] = range.split("-").map(Number);
                  return [
                    range,
                    [
                      ...new Set(
                        indices.filter(
                          (index) =>
                            Number.isInteger(index) &&
                            index >= start - 1 &&
                            index < end,
                        ),
                      ),
                    ].sort((leftValue, rightValue) => leftValue - rightValue),
                  ];
                }),
            )
          : {},
      practiceMap,
      bookmarks: Array.isArray(deckData.bookmarks)
        ? [
            ...new Set(
              deckData.bookmarks.filter(
                (value) => Number.isInteger(value) && value >= 0,
              ),
            ),
          ].sort((leftValue, rightValue) => leftValue - rightValue)
        : [],
      dataFingerprint:
        typeof deckData.dataFingerprint === "string"
          ? deckData.dataFingerprint
          : "",
      questionIds: Array.isArray(deckData.questionIds)
        ? deckData.questionIds.filter((value) => typeof value === "string")
        : [],
    };
  }
  return writeRoot(normalized);
}

export function storageAvailable() {
  try {
    const key = STORAGE_NAMESPACE + ":probe";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
