export function fingerprintQuestions(questions) {
  const source = JSON.stringify(questions.map((q) => ({
    question: q.question,
    options: q.options,
    correct: q.correct
  })));
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  };
  return `${questions.length}:${(hash >>> 0).toString(16)}`;
};

export function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('Dữ liệu bộ đề không phải mảng câu hỏi.');
  };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i];
    if (!q || typeof q.question !== 'string' || !q.question.trim()) {
      throw new Error(`Câu ${i + 1} thiếu nội dung câu hỏi.`);
    };
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Câu ${i + 1} phải có ít nhất hai đáp án.`);
    };
    if (q.options.some((option) => typeof option !== 'string' || !option.trim())) {
      throw new Error(`Câu ${i + 1} có đáp án trống hoặc không hợp lệ.`);
    };
    const options = q.options.slice();
    const correct = q.correct;
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      throw new Error(`Câu ${i + 1} có chỉ số đáp án đúng không hợp lệ.`);
    };
    out.push({
      originalIndex: i,
      question: q.question,
      options,
      correct
    });
  };
  if (!out.length) {
    throw new Error('Không có câu hỏi hợp lệ trong bộ đề.');
  };
  return out;
};

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  };
  return arr;
};

export function buildOptionOrder(optionCount, shuffleA) {
  const order = Array.from({ length: optionCount }, (_, i) => i);
  if (shuffleA) shuffleInPlace(order);
  return order;
};

export function createSessionItems(pool, { shuffleQ, shuffleA }) {
  const indices = pool.map((_, i) => i);
  if (shuffleQ) shuffleInPlace(indices);
  return indices.map((poolIdx) => {
    const q = pool[poolIdx];
    return {
      poolIdx,
      originalIndex: q.originalIndex,
      optionOrder: buildOptionOrder(q.options.length, shuffleA),
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

export function pickRandom(allQuestions, count, preferUncompleted, completedSet) {
  const uncompleted = [];
  const completed = [];
  for (const q of allQuestions) {
    if (completedSet.has(q.originalIndex)) completed.push(q);
    else uncompleted.push(q);
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

export function pickWrong(allQuestions, wrongIndices, count, shuffleQ) {
  const set = new Set(wrongIndices);
  let pool = allQuestions.filter((q) => set.has(q.originalIndex));
  if (shuffleQ) shuffleInPlace(pool);
  if (count > 0 && count < pool.length) {
    if (!shuffleQ) {
      pool = pool.slice(0, count);
    } else {
      pool = pool.slice(0, count);
    };
  };
  return pool;
};

export function isAnswerCorrect(item, question) {
  if (item.userAnswer == null) return false;
  const originalOptIdx = item.optionOrder[item.userAnswer];
  return originalOptIdx === question.correct;
};

export function displayedCorrectIndex(item, question) {
  return item.optionOrder.indexOf(question.correct);
};
