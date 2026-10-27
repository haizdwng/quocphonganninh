const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validIndices(values, total) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value) => Number.isInteger(value) && value >= 0 && value < total,
      ),
    ),
  ];
}

function countAttempts(map, total) {
  if (!isRecord(map)) return { questions: 0, attempts: 0 };
  let questions = 0;
  let attempts = 0;
  for (const [key, value] of Object.entries(map)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= total) continue;
    if (!Number.isInteger(value) || value <= 0) continue;
    questions += 1;
    attempts += value;
  }
  return { questions, attempts };
}

export function calculateStudyStatistics(totalQuestions, progress = {}) {
  const total =
    Number.isInteger(totalQuestions) && totalQuestions > 0 ? totalQuestions : 0;
  const completed = validIndices(progress.completed, total);
  const bookmarks = validIndices(progress.bookmarks, total);
  const wrong = countAttempts(progress.wrongMap, total);
  const practice = countAttempts(progress.practiceMap, total);
  const cursor =
    Number.isInteger(progress.sequentialCursor) &&
    progress.sequentialCursor >= 0
      ? progress.sequentialCursor
      : 0;
  return {
    total,
    completedCount: completed.length,
    remainingCount: Math.max(0, total - completed.length),
    completionPercent: total ? Math.round((completed.length / total) * 100) : 0,
    wrongQuestionCount: wrong.questions,
    wrongAttemptCount: wrong.attempts,
    practiceAttempts: practice.attempts,
    bookmarkedCount: bookmarks.length,
    nextQuestion: total && cursor < total ? cursor + 1 : 0,
  };
}
