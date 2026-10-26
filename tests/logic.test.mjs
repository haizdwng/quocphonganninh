import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fileSystem from "node:fs";

const values = new Map();
globalThis.localStorage = {
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  },
  clear() {
    values.clear();
  },
};

const quiz = await import("../assets/js/quiz.js");
const storage = await import("../assets/js/storage.js");

beforeEach(() => localStorage.clear());

const questions = Array.from(
  { length: 5 },
  (unusedQuestion, originalIndex) => ({
    originalIndex,
    question: `Câu ${originalIndex + 1}`,
    options: ["A", "B", "C", "D"],
    correct: 2,
    fixed: originalIndex === 0,
  }),
);

test("normalizeQuestions kiểm tra dữ liệu và giữ trường fixed", () => {
  const normalized = quiz.normalizeQuestions([
    {
      question: "Câu mẫu",
      options: ["A", "B", "C", "D"],
      correct: 2,
      fixed: true,
    },
  ]);
  assert.equal(normalized[0].fixed, true);
  assert.throws(() =>
    quiz.normalizeQuestions([{ question: "Sai", options: ["A"], correct: 0 }]),
  );
  assert.throws(() =>
    quiz.normalizeQuestions([
      { question: "Sai", options: ["A", "B"], correct: 2 },
    ]),
  );
});

test("khi đổi bộ đề, vùng đến câu theo max hoặc giữ số câu đã chọn", () => {
  assert.equal(quiz.getEndQuestionForDeckSwitch(479, 479, 262), 262);
  assert.equal(quiz.getEndQuestionForDeckSwitch(262, 262, 479), 479);
  assert.equal(quiz.getEndQuestionForDeckSwitch(173, 479, 262), 173);
  assert.equal(quiz.getEndQuestionForDeckSwitch(173, 262, 479), 173);
  assert.equal(quiz.getEndQuestionForDeckSwitch(400, 479, 262), 262);
});

test("câu fixed không bị đảo đáp án kể cả khi bật shuffle", () => {
  assert.deepEqual(quiz.buildOptionOrder(4, true, true), [0, 1, 2, 3]);
});

test("chấm đáp án theo vị trí gốc khi thứ tự hiển thị đã đảo", () => {
  const item = { optionOrder: [2, 0, 1, 3], userAnswer: 0 };
  assert.equal(quiz.isAnswerCorrect(item, questions[1]), true);
  item.userAnswer = 1;
  assert.equal(quiz.isAnswerCorrect(item, questions[1]), false);
});

test("lấy câu tuần tự bỏ qua câu đã hoàn thành và không vượt quá số lượng", () => {
  const result = quiz.pickSequential(questions, 0, 3, new Set([1, 2]));
  assert.deepEqual(
    result.items.map((question) => question.originalIndex),
    [0, 3, 4],
  );
  assert.equal(result.nextCursor, 5);
  assert.equal(result.exhausted, true);
});

test("lấy câu ngẫu nhiên ưu tiên câu chưa hoàn thành và không lặp câu", () => {
  const result = quiz.pickRandom(questions, 4, true, new Set([0, 1, 2]));
  assert.equal(result.length, 4);
  assert.equal(
    new Set(result.map((question) => question.originalIndex)).size,
    4,
  );
  assert.ok(result.some((question) => question.originalIndex === 3));
  assert.ok(result.some((question) => question.originalIndex === 4));
});

test("luyện câu sai giữ thứ tự gốc khi không bật đảo câu", () => {
  const result = quiz.pickWrong(questions, [4, 1, 3], 2, false);
  assert.deepEqual(
    result.map((question) => question.originalIndex),
    [1, 3],
  );
});

test("quiz settings are shared between both decks", () => {
  assert.equal(
    storage.saveSettings({
      deck: "quocphong1",
      count: 25,
      timeLimit: 0,
      shuffleQuestions: false,
      shuffleAnswers: true,
    }),
    true,
  );
  assert.equal(storage.getSettings("quocphong2").count, 25);
  assert.equal(storage.getSettings("quocphong2").timeLimit, 0);
  assert.equal(storage.getSettings("quocphong2").shuffleQuestions, false);

  assert.equal(
    storage.saveSettings({
      deck: "quocphong2",
      count: 40,
      timeLimit: 35,
      shuffleQuestions: true,
      shuffleAnswers: false,
    }),
    true,
  );
  assert.equal(storage.getSettings("quocphong1").count, 40);
  assert.equal(storage.getSettings("quocphong1").timeLimit, 35);
  assert.equal(storage.getSettings("quocphong1").shuffleAnswers, false);
});

test("experience settings are shared between both decks", () => {
  const defaults = storage.getSettings("quocphong1");
  assert.equal(defaults.autoCheck, false);
  assert.equal(defaults.autoAdvance, false);
  assert.equal(defaults.soundEnabled, true);
  assert.equal(defaults.vibrationEnabled, true);

  storage.saveSettings({
    deck: "quocphong1",
    autoCheck: true,
    autoAdvance: false,
    soundEnabled: false,
    vibrationEnabled: true,
  });
  assert.equal(storage.getSettings("quocphong2").autoCheck, true);
  assert.equal(storage.getSettings("quocphong2").autoAdvance, false);
  assert.equal(storage.getSettings("quocphong2").soundEnabled, false);
  assert.equal(storage.getSettings("quocphong2").vibrationEnabled, true);
});

test("question bank settings are independent from setup settings", () => {
  storage.saveSettings({
    deck: "quocphong1",
    count: 24,
    timeLimit: 12,
    practiceMode: "exam",
    shuffleQuestions: false,
    autoCheck: true,
  });
  assert.equal(storage.getBankSettings().count, 0);
  assert.equal(storage.getBankSettings().practiceMode, "practice");
  assert.equal(storage.getBankSettings().autoCheck, false);

  storage.saveBankSettings({
    deck: "quocphong2",
    count: 18,
    timeLimit: 0,
    practiceMode: "practice",
    shuffleQuestions: true,
    autoCheck: false,
  });
  assert.equal(storage.getSettings("quocphong1").count, 24);
  assert.equal(storage.getSettings("quocphong2").timeLimit, 12);
  assert.equal(storage.getSettings("quocphong1").practiceMode, "exam");
  assert.equal(storage.getSettings("quocphong1").autoCheck, true);
  assert.equal(storage.getBankSettings().count, 18);
  assert.equal(storage.getBankSettings().deck, "quocphong2");
  assert.equal(storage.getBankSettings().timeLimit, 0);
  assert.equal(storage.getBankSettings().autoCheck, false);
  assert.equal(storage.getSettings().deck, "quocphong1");
});

test("tiến độ, dấu trang và phiên làm bài được tách theo từng bộ đề", () => {
  assert.ok(
    storage.saveDeckProgress("quocphong1", {
      sequentialCursor: 2,
      completed: [0, 1],
      wrongMap: { 2: 1 },
      wrongRangeMap: {},
      practiceMap: {},
      bookmarks: [],
      dataFingerprint: "fp-1",
    }),
  );
  assert.equal(storage.getDeckProgress("quocphong2").completed.length, 0);
  assert.equal(storage.toggleBookmark("quocphong1", 3), true);
  assert.deepEqual(storage.getBookmarkedIndices("quocphong1"), [3]);
  assert.deepEqual(storage.getBookmarkedIndices("quocphong2"), []);
  assert.ok(storage.saveSession({ deckId: "quocphong1", marker: "one" }));
  assert.ok(storage.saveSession({ deckId: "quocphong2", marker: "two" }));
  assert.equal(storage.getSession("quocphong1").marker, "one");
  assert.equal(storage.getSession("quocphong2").marker, "two");
});

test("xóa dấu đánh dấu văn bản cũ theo bộ đề không ảnh hưởng bộ còn lại", () => {
  storage.saveQuestionHighlights("quocphong1", 0, [
    { target: "question", start: 0, end: 2 },
  ]);
  storage.saveQuestionHighlights("quocphong2", 0, [
    { target: "question", start: 1, end: 3 },
  ]);
  assert.ok(storage.resetDeckHighlights("quocphong1"));
  assert.deepEqual(storage.getQuestionHighlights("quocphong1", 0), []);
  assert.deepEqual(storage.getQuestionHighlights("quocphong2", 0), [
    { target: "question", start: 1, end: 3 },
  ]);
});

test("sao lưu và khôi phục giữ tùy chọn cùng tiến độ", () => {
  storage.saveSettings({
    deck: "quocphong1",
    count: 17,
    timeLimit: 0,
    shuffleQuestions: true,
    shuffleAnswers: false,
  });
  storage.saveDeckProgress("quocphong1", {
    sequentialCursor: 4,
    completed: [0, 3],
    wrongMap: {},
    wrongRangeMap: {},
    practiceMap: {},
    bookmarks: [2],
    dataFingerprint: "fp-backup",
  });
  storage.saveDeckProgress("quocphong2", {
    sequentialCursor: 2,
    completed: [1],
    wrongMap: { 3: 2 },
    wrongRangeMap: {},
    practiceMap: {},
    bookmarks: [4],
    dataFingerprint: "fp-backup-2",
  });
  storage.saveBankSettings({
    deck: "quocphong2",
    count: 17,
    timeLimit: 0,
  });
  const backup = storage.exportBackup();
  localStorage.clear();
  assert.equal(storage.importBackup(backup), true);
  assert.equal(storage.getSettings("quocphong1").count, 17);
  assert.equal(storage.getSettings("quocphong2").count, 17);
  assert.equal(storage.getSettings("quocphong1").timeLimit, 0);
  assert.equal(storage.getBankSettings().deck, "quocphong2");
  assert.deepEqual(storage.getDeckProgress("quocphong1").completed, [0, 3]);
  assert.deepEqual(storage.getBookmarkedIndices("quocphong1"), [2]);
  assert.deepEqual(storage.getDeckProgress("quocphong2").completed, [1]);
  assert.deepEqual(storage.getBookmarkedIndices("quocphong2"), [4]);
});

test("màn hình thiết lập dùng thẻ phiên đang dở thay cho lịch sử 10 phiên", () => {
  const html = fileSystem.readFileSync(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const app = fileSystem.readFileSync(
    new URL("../assets/js/app.js", import.meta.url),
    "utf8",
  );
  const css = fileSystem.readFileSync(
    new URL("../assets/css/style.css", import.meta.url),
    "utf8",
  );
  assert.match(html, /id=["']resume-card["']/);
  assert.match(app, /Có lượt ôn đang dở/);
  assert.doesNotMatch(html, /session-history|10 phiên gần nhất/);
  assert.match(app, /function refreshResumeCard\(\)/);
  assert.doesNotMatch(css, /session-history|history-item/);
});
