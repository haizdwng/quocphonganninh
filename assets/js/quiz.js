function stableQuestionId(question) {
  const source = JSON.stringify({
    question: question.question.trim().replace(/\s+/g, " "),
    options: question.options.map((option) =>
      option.trim().replace(/\s+/g, " "),
    ),
    correct: question.correct,
    fixed: question.fixed === true,
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `q-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function findDuplicateQuestions(questions) {
  const groups = new Map();
  for (const question of Array.isArray(questions) ? questions : []) {
    const key = JSON.stringify({
      question: String(question.question || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase(),
      options: Array.isArray(question.options)
        ? question.options.map((option) =>
            String(option).trim().replace(/\s+/g, " ").toLocaleLowerCase(),
          )
        : [],
      correct: question.correct,
      fixed: question.fixed === true,
    });
    const list = groups.get(key) || [];
    list.push({ index: question.originalIndex, question: question.question });
    groups.set(key, list);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function remapQuestionProgress(progress, oldQuestionIds, newQuestions) {
  if (
    !Array.isArray(oldQuestionIds) ||
    !oldQuestionIds.length ||
    !Array.isArray(newQuestions)
  )
    return null;
  const nextIndexById = new Map(
    newQuestions.map((question, index) => [question.id, index]),
  );
  const remapIndex = (index) => {
    const oldId = oldQuestionIds[index];
    return typeof oldId === "string" && nextIndexById.has(oldId)
      ? nextIndexById.get(oldId)
      : null;
  };
  const remapIndices = (indices) =>
    [
      ...new Set(
        (Array.isArray(indices) ? indices : [])
          .map(remapIndex)
          .filter(Number.isInteger),
      ),
    ].sort((leftIndex, rightIndex) => leftIndex - rightIndex);
  const remapCounts = (source) => {
    const result = {};
    for (const [key, value] of Object.entries(
      source && typeof source === "object" ? source : {},
    )) {
      const nextIndex = remapIndex(Number(key));
      if (nextIndex == null || !Number.isInteger(value) || value <= 0) continue;
      result[nextIndex] = (result[nextIndex] || 0) + value;
    }
    return result;
  };
  const cursorId = oldQuestionIds[progress?.sequentialCursor];
  const cursorIndex =
    typeof cursorId === "string" && nextIndexById.has(cursorId)
      ? nextIndexById.get(cursorId)
      : 0;
  return {
    ...progress,
    completed: remapIndices(progress?.completed),
    bookmarks: remapIndices(progress?.bookmarks),
    wrongMap: remapCounts(progress?.wrongMap),
    practiceMap: remapCounts(progress?.practiceMap),
    wrongRangeMap: {},
    sequentialCursor: cursorIndex,
    questionIds: newQuestions.map((question) => question.id),
  };
}

export function findConflictingQuestions(questions) {
  const groups = new Map();
  for (const question of Array.isArray(questions) ? questions : []) {
    const prompt = String(question.question || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
    const list = groups.get(prompt) || [];
    list.push({
      index: question.originalIndex,
      question: question.question,
      options: question.options,
      correct: question.correct,
    });
    groups.set(prompt, list);
  }
  return [...groups.values()].filter((group) => {
    if (group.length < 2) return false;
    const variants = new Set(
      group.map((item) =>
        JSON.stringify({ options: item.options, correct: item.correct }),
      ),
    );
    return variants.size > 1;
  });
}

export function fingerprintQuestions(questions) {
  const source = JSON.stringify(
    questions.map((question) => ({
      question: question.question,
      options: question.options,
      correct: question.correct,
    })),
  );
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${questions.length}:${(hash >>> 0).toString(16)}`;
}

export function normalizeQuestions(raw) {
  if (!Array.isArray(raw))
    throw new Error("Dữ liệu bộ đề không phải mảng câu hỏi.");
  const normalized = [];
  const idCounts = new Map();
  for (let index = 0; index < raw.length; index++) {
    const question = raw[index];
    if (
      !question ||
      typeof question.question !== "string" ||
      !question.question.trim()
    ) {
      throw new Error(`Câu ${index + 1} thiếu nội dung câu hỏi.`);
    }
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`Câu ${index + 1} phải có ít nhất hai đáp án.`);
    }
    if (
      question.options.some(
        (option) => typeof option !== "string" || !option.trim(),
      )
    ) {
      throw new Error(`Câu ${index + 1} có đáp án trống hoặc không hợp lệ.`);
    }
    const options = question.options.slice();
    const correct = question.correct;
    if (
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct >= options.length
    ) {
      throw new Error(`Câu ${index + 1} có chỉ số đáp án đúng không hợp lệ.`);
    }
    const baseId =
      typeof question.id === "string" && question.id.trim()
        ? question.id.trim()
        : stableQuestionId({
            question: question.question,
            options,
            correct,
            fixed: question.fixed === true,
          });
    const occurrence = idCounts.get(baseId) || 0;
    idCounts.set(baseId, occurrence + 1);
    const id = occurrence ? `${baseId}-${occurrence + 1}` : baseId;
    normalized.push({
      originalIndex: index,
      id,
      question: question.question,
      options,
      correct,
      fixed: question.fixed === true,
      topic:
        typeof question.topic === "string"
          ? question.topic.trim()
          : typeof question.section === "string"
            ? question.section.trim()
            : "",
      explanation:
        typeof question.explanation === "string"
          ? question.explanation.trim()
          : typeof question.explain === "string"
            ? question.explain.trim()
            : "",
    });
  }
  if (!normalized.length)
    throw new Error("Không có câu hỏi hợp lệ trong bộ đề.");
  return normalized;
}

function shuffleInPlace(array) {
  for (let index = array.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temporary = array[index];
    array[index] = array[swapIndex];
    array[swapIndex] = temporary;
  }
  return array;
}

export function buildOptionOrder(optionCount, shuffleAnswers, fixed = false) {
  const order = Array.from(
    { length: optionCount },
    (unusedQuestion, index) => index,
  );
  if (shuffleAnswers && !fixed) shuffleInPlace(order);
  return order;
}

export function createSessionItems(pool, { shuffleQuestions, shuffleAnswers }) {
  const indices = pool.map((unusedQuestion, index) => index);
  if (shuffleQuestions) shuffleInPlace(indices);
  return indices.map((poolIndex) => {
    const question = pool[poolIndex];
    return {
      poolIndex: poolIndex,
      originalIndex: question.originalIndex,
      optionOrder: buildOptionOrder(
        question.options.length,
        shuffleAnswers,
        question.fixed,
      ),
      userAnswer: null,
      status: "pending",
      wrongCount: 0,
      checked: false,
      wrongOptions: [],
    };
  });
}

export function pickSequential(
  allQuestions,
  cursor,
  count,
  completedSet = new Set(),
) {
  const total = allQuestions.length;
  let nextCursor = Math.max(0, Math.min(Number(cursor) || 0, total));
  const items = [];
  while (nextCursor < total && items.length < count) {
    const question = allQuestions[nextCursor];
    nextCursor += 1;
    if (!completedSet.has(question.originalIndex)) items.push(question);
  }
  return {
    items,
    nextCursor,
    exhausted: nextCursor >= total,
    actualCount: items.length,
  };
}

export function findNextUncompletedQuestion(
  allQuestions,
  cursor,
  completedSet = new Set(),
) {
  const start = Math.max(0, Number.isInteger(cursor) ? cursor : 0);
  return (
    allQuestions.find(
      (question) =>
        question.originalIndex >= start &&
        !completedSet.has(question.originalIndex),
    ) ||
    allQuestions.find(
      (question) => !completedSet.has(question.originalIndex),
    ) ||
    null
  );
}

export function pickRandom(
  allQuestions,
  count,
  preferUncompleted,
  completedSet,
) {
  const uncompleted = [];
  const completed = [];
  for (const question of allQuestions) {
    if (completedSet.has(question.originalIndex)) completed.push(question);
    else uncompleted.push(question);
  }
  let pool = preferUncompleted ? uncompleted.slice() : allQuestions.slice();
  if (preferUncompleted && pool.length < count && completed.length) {
    const need = count - pool.length;
    const extra = completed.slice();
    shuffleInPlace(extra);
    pool = pool.concat(extra.slice(0, need));
  }
  shuffleInPlace(pool);
  return pool.slice(0, Math.min(count, pool.length));
}

export function pickWrong(allQuestions, wrongIndices, count, shuffleQuestions) {
  const indexSet = new Set(wrongIndices);
  let pool = allQuestions.filter((question) =>
    indexSet.has(question.originalIndex),
  );
  if (shuffleQuestions) shuffleInPlace(pool);
  if (count > 0 && count < pool.length) pool = pool.slice(0, count);
  return pool;
}

export function isAnswerCorrect(item, question) {
  if (item.userAnswer == null) return false;
  const originalOptionIndex = item.optionOrder[item.userAnswer];
  return originalOptionIndex === question.correct;
}

export function displayedCorrectIndex(item, question) {
  return item.optionOrder.indexOf(question.correct);
}

export function getEndQuestionForDeckSwitch(
  previousEnd,
  previousTotal,
  nextTotal,
) {
  if (previousEnd >= previousTotal) return nextTotal;
  return Math.min(Math.max(1, previousEnd), nextTotal);
}
