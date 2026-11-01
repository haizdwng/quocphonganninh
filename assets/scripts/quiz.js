export function fingerprintQuestions(questions) {
  const source = JSON.stringify(questions.map((questionText) => ({
    questionText: questionText.questionText,
    answerOptions: questionText.answerOptions,
    correctAnswerIndex: questionText.correctAnswerIndex
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
    const questionText = rawData[index];
    if (!questionText || typeof questionText.questionText !== 'string' || !questionText.questionText.trim()) throw new Error('Câu ' + (index + 1) + ' thiếu nội dung câu hỏi.');
    if (!Array.isArray(questionText.answerOptions) || questionText.answerOptions.length < 2) throw new Error('Câu ' + (index + 1) + ' phải có ít nhất hai đáp án.');
    if (questionText.answerOptions.some((option) => typeof option !== 'string' || !option.trim())) throw new Error('Câu ' + (index + 1) + ' có đáp án trống hoặc không hợp lệ.');
    const answerOptions = questionText.answerOptions.slice();
    const correctAnswerIndex = questionText.correctAnswerIndex;
    if (!Number.isInteger(correctAnswerIndex) || correctAnswerIndex < 0 || correctAnswerIndex >= answerOptions.length) throw new Error('Câu ' + (index + 1) + ' có chỉ số đáp án đúng không hợp lệ.');
    const fixedAnswerIndices = Array.isArray(questionText.fixedAnswerIndices) ? [...new Set(questionText.fixedAnswerIndices.filter((value) => Number.isInteger(value) && value >= 0 && value < answerOptions.length))] : [];
    normalized.push({
      sourceQuestionIndex: index,
      questionText: questionText.questionText,
      answerOptions,
      correctAnswerIndex,
      fixedAnswerIndices
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

export function buildOptionOrder(optionCount, shuffleAnswerOrder, fixedAnswerIndices = []) {
  const order = Array.from({ length: optionCount }, (_unusedQuestion, optionIndex) => optionIndex);
  if (!shuffleAnswerOrder) return order;
  const fixedSet = new Set(fixedAnswerIndices);
  const fixedPositions = order.filter((optionIndex) => fixedSet.has(optionIndex));
  const movablePositions = order.filter((optionIndex) => !fixedSet.has(optionIndex));
  const fixedValues = fixedPositions.slice();
  const movableValues = movablePositions.slice();
  shuffleInPlace(fixedValues);
  shuffleInPlace(movableValues);
  fixedPositions.forEach((position, index) => { order[position] = fixedValues[index]; });
  movablePositions.forEach((position, index) => { order[position] = movableValues[index]; });
  return order;
};

export function createSessionItems(pool, { shuffleQuestionOrder, shuffleAnswerOrder }) {
  const indices = pool.map((_unusedQuestion, questionPoolIndex) => questionPoolIndex);
  if (shuffleQuestionOrder) shuffleInPlace(indices);
  return indices.map((questionPoolIndex) => {
    const questionText = pool[questionPoolIndex];
    return {
      questionPoolIndex: questionPoolIndex,
      sourceQuestionIndex: questionText.sourceQuestionIndex,
      displayedAnswerOrder: buildOptionOrder(questionText.answerOptions.length, shuffleAnswerOrder, questionText.fixedAnswerIndices),
      selectedAnswerIndex: null,
      status: 'pending',
      incorrectAttemptCount: 0,
      checked: false,
      incorrectAnswerIndices: []
    };
  });
};

export function pickSequential(allQuestions, cursor, count, completedSet = new Set()) {
  const total = allQuestions.length;
  let nextCursor = Math.max(0, Math.min(Number(cursor) || 0, total));
  const items = [];
  while (nextCursor < total && items.length < count) {
    const questionText = allQuestions[nextCursor];
    nextCursor += 1;
    if (!completedSet.has(questionText.sourceQuestionIndex)) items.push(questionText);
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
  return (allQuestions.find((questionText) => questionText.sourceQuestionIndex >= start && !completedSet.has(questionText.sourceQuestionIndex)) || allQuestions.find((questionText) => !completedSet.has(questionText.sourceQuestionIndex)) || null);
};

export function pickRandom(allQuestions, count, preferUncompleted, completedSet) {
  const uncompleted = [];
  const completedQuestionIndices = [];
  for (const questionText of allQuestions) {
    if (completedSet.has(questionText.sourceQuestionIndex)) completedQuestionIndices.push(questionText);
    else uncompleted.push(questionText);
  };
  let pool = preferUncompleted ? uncompleted.slice() : allQuestions.slice();
  if (preferUncompleted && pool.length < count && completedQuestionIndices.length) {
    const need = count - pool.length;
    const extra = completedQuestionIndices.slice();
    shuffleInPlace(extra);
    pool = pool.concat(extra.slice(0, need));
  };
  shuffleInPlace(pool);
  return pool.slice(0, Math.min(count, pool.length));
};

export function pickWrong(allQuestions, wrongIndices, count, shuffleQuestionOrder) {
  const indexSet = new Set(wrongIndices);
  let pool = allQuestions.filter((questionText) => indexSet.has(questionText.sourceQuestionIndex));
  if (shuffleQuestionOrder) shuffleInPlace(pool);
  if (count > 0 && count < pool.length) pool = pool.slice(0, count);
  return pool;
};

export function isAnswerCorrect(item, questionText) {
  if (item.selectedAnswerIndex == null) return false;
  const originalOptionIndex = item.displayedAnswerOrder[item.selectedAnswerIndex];
  return originalOptionIndex === questionText.correctAnswerIndex;
};

export function displayedCorrectIndex(item, questionText) {
  return item.displayedAnswerOrder.indexOf(questionText.correctAnswerIndex);
};

export function getEndQuestionForDeckSwitch(previousEnd, previousTotal, nextTotal) {
  if (previousEnd >= previousTotal) return nextTotal;
  return Math.min(Math.max(1, previousEnd), nextTotal);
};