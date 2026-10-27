const KEY = "quocphonganninh:study-tools:v1";
const DECKS = ["quocphong1", "quocphong2"];
const INTERVAL_DAYS = [1, 3, 7, 14, 30];

function readData() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function writeData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyDeck() {
  return { schedule: {}, notes: {}, categories: {} };
}

function getDeck(data, deckId) {
  if (!DECKS.includes(deckId)) return emptyDeck();
  const value = data.decks?.[deckId];
  return value && typeof value === "object" ? value : emptyDeck();
}

function validIndex(value) {
  return Number.isInteger(value) && value >= 0;
}

export function recordStudyAnswer(deckId, questionIndex, correct) {
  if (!DECKS.includes(deckId) || !validIndex(questionIndex)) return false;
  const data = readData();
  if (!data.decks || typeof data.decks !== "object") data.decks = {};
  const deck = getDeck(data, deckId);
  if (!deck.schedule || typeof deck.schedule !== "object") deck.schedule = {};
  const old = deck.schedule[questionIndex] || {};
  const repetitions = correct ? Math.min(30, (Number(old.repetitions) || 0) + 1) : 0;
  const dueAt = correct
    ? Date.now() + INTERVAL_DAYS[Math.min(repetitions - 1, INTERVAL_DAYS.length - 1)] * 86400000
    : Date.now() + 10 * 60000;
  deck.schedule[questionIndex] = {
    repetitions,
    dueAt,
    lastAnsweredAt: Date.now(),
    lastCorrect: !!correct,
    attempts: Math.max(0, Number(old.attempts) || 0) + 1,
  };
  data.decks[deckId] = deck;
  const today = dayKey();
  if (!data.activity || typeof data.activity !== "object") data.activity = {};
  data.activity[today] = Math.max(0, Number(data.activity[today]) || 0) + 1;
  const activityKeys = Object.keys(data.activity).sort();
  for (const key of activityKeys.slice(0, Math.max(0, activityKeys.length - 120))) delete data.activity[key];
  return writeData(data);
}

export function getDueQuestions(deckId, now = Date.now()) {
  const data = readData();
  const schedule = getDeck(data, deckId).schedule || {};
  return Object.entries(schedule)
    .filter(([key, value]) => validIndex(Number(key)) && value && Number(value.dueAt) <= now)
    .map(([key]) => Number(key))
    .sort((a, b) => {
      const left = schedule[a] || {};
      const right = schedule[b] || {};
      return (left.dueAt || 0) - (right.dueAt || 0);
    });
}

export function saveQuestionNote(deckId, questionIndex, note) {
  if (!DECKS.includes(deckId) || !validIndex(questionIndex)) return false;
  const data = readData();
  if (!data.decks || typeof data.decks !== "object") data.decks = {};
  const deck = getDeck(data, deckId);
  if (!deck.notes || typeof deck.notes !== "object") deck.notes = {};
  const value = String(note || "").slice(0, 4000);
  if (value.trim()) deck.notes[questionIndex] = value;
  else delete deck.notes[questionIndex];
  data.decks[deckId] = deck;
  return writeData(data);
}

export function saveQuestionCategory(deckId, questionIndex, category) {
  if (!DECKS.includes(deckId) || !validIndex(questionIndex)) return false;
  if (!["", "remember", "confusing", "important"].includes(category)) return false;
  const data = readData();
  if (!data.decks || typeof data.decks !== "object") data.decks = {};
  const deck = getDeck(data, deckId);
  if (!deck.categories || typeof deck.categories !== "object" || Array.isArray(deck.categories)) deck.categories = {};
  if (category) deck.categories[questionIndex] = category;
  else delete deck.categories[questionIndex];
  data.decks[deckId] = deck;
  return writeData(data);
}

export function getQuestionCategory(deckId, questionIndex) {
  const categories = getDeck(readData(), deckId).categories || {};
  return ["remember", "confusing", "important"].includes(categories[questionIndex]) ? categories[questionIndex] : "";
}

export function getQuestionNote(deckId, questionIndex) {
  const data = readData();
  const notes = getDeck(data, deckId).notes || {};
  return typeof notes[questionIndex] === "string" ? notes[questionIndex] : "";
}

export function getStudyToolSummary(now = new Date()) {
  const data = readData();
  const today = dayKey(now);
  const activity = data.activity || {};
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!activity[today]) cursor.setDate(cursor.getDate() - 1);
  while (activity[dayKey(cursor)] > 0 && streak < 366) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const dailyGoal = Math.max(1, Math.min(500, Number(data.dailyGoal) || 20));
  return {
    dailyGoal,
    todayCount: Math.max(0, Number(activity[today]) || 0),
    streak,
    notesCount: DECKS.reduce((sum, deckId) => sum + Object.keys(getDeck(data, deckId).notes || {}).length, 0),
    dueCount: DECKS.reduce((sum, deckId) => sum + getDueQuestions(deckId, now.getTime()).length, 0),
  };
}

export function setDailyGoal(value) {
  const data = readData();
  data.dailyGoal = Math.max(1, Math.min(500, Math.round(Number(value) || 20)));
  return writeData(data);
}

export function exportStudyTools() {
  return JSON.stringify({ format: "quocphonganninh-study-tools", version: 1, data: readData() }, null, 2);
}

export function importStudyTools(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { success: false, message: "Tệp JSON không hợp lệ." };
  }
  if (parsed?.format !== "quocphonganninh-study-tools" || parsed?.version !== 1 || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    return { success: false, message: "Tệp không đúng định dạng dữ liệu công cụ học tập." };
  }
  const data = parsed.data;
  if (data.decks != null && (typeof data.decks !== "object" || Array.isArray(data.decks))) {
    return { success: false, message: "Dữ liệu bộ đề trong tệp không hợp lệ." };
  }
  return writeData(data)
    ? { success: true, message: "Đã nhập dữ liệu công cụ học tập." }
    : { success: false, message: "Không đủ bộ nhớ để lưu dữ liệu." };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function renderSummary() {
  const summary = getStudyToolSummary();
  const goal = document.getElementById("study-daily-goal");
  const progress = document.getElementById("study-goal-progress");
  const streak = document.getElementById("study-streak");
  const due = document.getElementById("study-due-count");
  const notes = document.getElementById("study-notes-count");
  if (goal && document.activeElement !== goal) goal.value = String(summary.dailyGoal);
  if (progress) {
    const percent = Math.min(100, Math.round(summary.todayCount / summary.dailyGoal * 100));
    progress.textContent = `${summary.todayCount}/${summary.dailyGoal} câu hôm nay · ${percent}%`;
    progress.setAttribute("aria-valuenow", String(percent));
  }
  if (streak) streak.textContent = `${summary.streak} ngày`;
  if (due) due.textContent = String(summary.dueCount);
  if (notes) notes.textContent = String(summary.notesCount);
}

export function initStudyTools() {
  const root = document.getElementById("study-tools");
  if (!root || root.dataset.ready === "true") return;
  root.dataset.ready = "true";
  renderSummary();
  document.getElementById("study-daily-goal")?.addEventListener("change", (event) => {
    setDailyGoal(event.currentTarget.value);
    renderSummary();
  });
  document.getElementById("study-theme-toggle")?.addEventListener("click", () => {
    const light = !document.body.classList.contains("theme-light");
    document.body.classList.toggle("theme-light", light);
    try { localStorage.setItem("quocphonganninh:theme", light ? "light" : "dark"); } catch {}
    eventThemeLabel(light);
  });
  document.getElementById("study-note-load")?.addEventListener("click", () => {
    const deckId = document.getElementById("study-note-deck").value;
    const questionNumber = Number(document.getElementById("study-note-question").value);
    const textarea = document.getElementById("study-note-text");
    if (!Number.isInteger(questionNumber) || questionNumber < 1) {
      textarea.value = "";
      textarea.setCustomValidity("Nhập số câu từ 1 trở lên.");
      textarea.reportValidity();
      return;
    }
    textarea.setCustomValidity("");
    textarea.value = getQuestionNote(deckId, questionNumber - 1);
    document.getElementById("study-note-category").value = getQuestionCategory(deckId, questionNumber - 1);
    textarea.focus();
  });
  document.getElementById("study-note-save")?.addEventListener("click", () => {
    const deckId = document.getElementById("study-note-deck").value;
    const questionNumber = Number(document.getElementById("study-note-question").value);
    const textarea = document.getElementById("study-note-text");
    if (!Number.isInteger(questionNumber) || questionNumber < 1) {
      textarea.setCustomValidity("Nhập số câu từ 1 trở lên.");
      textarea.reportValidity();
      return;
    }
    textarea.setCustomValidity("");
    if (!saveQuestionNote(deckId, questionNumber - 1, textarea.value) || !saveQuestionCategory(deckId, questionNumber - 1, document.getElementById("study-note-category").value)) {
      alert("Không thể lưu ghi chú. Hãy kiểm tra bộ nhớ trình duyệt.");
      return;
    }
    renderSummary();
    const status = document.getElementById("study-note-status");
    if (status) status.textContent = textarea.value.trim() ? "Đã lưu ghi chú và phân loại." : "Đã lưu phân loại; ghi chú trống đã được xóa.";
  });
  document.getElementById("study-tools-export")?.addEventListener("click", () => {
    const blob = new Blob([exportStudyTools()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "quocphonganninh-study-tools.json";
    anchor.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("study-tools-import-file")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Tệp quá lớn (tối đa 2 MB).");
      event.currentTarget.value = "";
      return;
    }
    const result = importStudyTools(await file.text());
    alert(result.message);
    if (result.success) renderSummary();
    event.currentTarget.value = "";
  });
  document.getElementById("study-most-wrong")?.addEventListener("click", () => {
    const deckId = document.getElementById("study-note-deck").value;
    document.dispatchEvent(new CustomEvent("study-tools-wrong-review", { detail: { deckId } }));
  });
  document.getElementById("study-due-review")?.addEventListener("click", () => {
    const currentDeck = document.getElementById("study-note-deck").value;
    const indices = getDueQuestions(currentDeck);
    if (!indices.length) {
      alert("Chưa có câu đến hạn ôn trong bộ đề này.");
      return;
    }
    document.dispatchEvent(new CustomEvent("study-tools-review", { detail: { deckId: currentDeck, indices } }));
  });
  try {
    const theme = localStorage.getItem("quocphonganninh:theme");
    document.body.classList.toggle("theme-light", theme === "light");
    eventThemeLabel(theme === "light");
  } catch {}
  document.addEventListener("study-tools-answer-recorded", renderSummary);
}

function eventThemeLabel(light) {
  const button = document.getElementById("study-theme-toggle");
  if (button) button.textContent = light ? "Giao diện tối" : "Giao diện sáng";
}
