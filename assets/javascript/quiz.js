export function fingerprintQuestions(questions) {
  const source = JSON.stringify(questions.map((question) => ({
    question: question.question,
    options: question.options,
    correct: question.correct
  })));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  };
  return questions.length + ':' + (hash >>> 0).toString(16);
};

export function normalizeQuestions(rawData) {
  if (!Array.isArray(rawData)) throw new Error('Dữ liệu bộ đề không phải mảng câu hỏi.');
  const normalized = [];
  for (let index = 0; index < rawData.length; index++) {
    const question = rawData[index];
    if (!question || typeof question.question !== 'string' || !question.question.trim()) throw new Error('Câu ' + (index + 1) + ' thiếu nội dung câu hỏi.');
    if (!Array.isArray(question.options) || question.options.length < 2) throw new Error('Câu ' + (index + 1) + ' phải có ít nhất hai đáp án.');
    if (question.options.some((option) => typeof option !== 'string' || !option.trim())) throw new Error('Câu ' + (index + 1) + ' có đáp án trống hoặc không hợp lệ.');
    const options = question.options.slice();
    const correct = question.correct;
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new Error('Câu ' + (index + 1) + ' có chỉ số đáp án đúng không hợp lệ.');
    normalized.push({
      originalIndex: index,
      question: question.question,
      options,
      correct,
      fixed: question.fixed === true
    });
  };
  if (!normalized.length) throw new Error('Không có câu hỏi hợp lệ trong bộ đề.');
  return normalized;
};

function shuffleInPlace(array) {
  for (let index = array.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temporary = array[index];
    array[index] = array[swapIndex];
    array[swapIndex] = temporary;
  };
  return array;
};

export function buildOptionOrder(optionCount, shuffleAnswers, fixed = false) {
  const order = Array.from({ length: optionCount }, (_unusedQuestion, optionIndex) => optionIndex);
  if (shuffleAnswers && !fixed) shuffleInPlace(order);
  return order;
};

export function createSessionItems(pool, { shuffleQuestions, shuffleAnswers }) {
  const indices = pool.map((_unusedQuestion, poolIndex) => poolIndex);
  if (shuffleQuestions) shuffleInPlace(indices);
  return indices.map((poolIndex) => {
    const question = pool[poolIndex];
    return {
      poolIndex: poolIndex,
      originalIndex: question.originalIndex,
      optionOrder: buildOptionOrder(question.options.length, shuffleAnswers, question.fixed),
      userAnswer: null,
      status: 'pending',
      wrongCount: 0,
      checked: false,
      wrongOptions: []
    };
  });
};

export function pickSequential(allQuestions, cursor, count, completedSet = new Set()) {
  const total = allQuestions.length;
  let nextCursor = Math.max(0, Math.min(Number(cursor) || 0, total));
  const items = [];
  while (nextCursor < total && items.length < count) {
    const question = allQuestions[nextCursor];
    nextCursor += 1;
    if (!completedSet.has(question.originalIndex)) items.push(question);
  };
  return {
    items,
    nextCursor,
    exhausted: nextCursor >= total,
    actualCount: items.length
  };
};

export function findNextUncompletedQuestion(allQuestions, cursor, completedSet = new Set()) {
  const start = Math.max(0, Number.isInteger(cursor) ? cursor : 0);
  return (allQuestions.find((question) => question.originalIndex >= start && !completedSet.has(question.originalIndex)) || allQuestions.find((question) => !completedSet.has(question.originalIndex)) || null);
};

export function pickRandom(allQuestions, count, preferUncompleted, completedSet) {
  const uncompleted = [];
  const completed = [];
  for (const question of allQuestions) {
    if (completedSet.has(question.originalIndex)) completed.push(question);
    else uncompleted.push(question);
  };
  let pool = preferUncompleted ? uncompleted.slice() : allQuestions.slice();
  if (preferUncompleted && pool.length < count && completed.length) {
    const need = count - pool.length;
    const extra = completed.slice();
    shuffleInPlace(extra);
    pool = pool.concat(extra.slice(0, need));
  };
  shuffleInPlace(pool);
  return pool.slice(0, Math.min(count, pool.length));
};

export function pickWrong(allQuestions, wrongIndices, count, shuffleQuestions) {
  const indexSet = new Set(wrongIndices);
  let pool = allQuestions.filter((question) => indexSet.has(question.originalIndex));
  if (shuffleQuestions) shuffleInPlace(pool);
  if (count > 0 && count < pool.length) pool = pool.slice(0, count);
  return pool;
};

export function isAnswerCorrect(item, question) {
  if (item.userAnswer == null) return false;
  const originalOptionIndex = item.optionOrder[item.userAnswer];
  return originalOptionIndex === question.correct;
};

export function displayedCorrectIndex(item, question) {
  return item.optionOrder.indexOf(question.correct);
};

export function getEndQuestionForDeckSwitch(previousEnd, previousTotal, nextTotal) {
  if (previousEnd >= previousTotal) return nextTotal;
  return Math.min(Math.max(1, previousEnd), nextTotal);
};