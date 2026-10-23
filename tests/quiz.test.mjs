import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  normalizeQuestions,
  fingerprintQuestions,
  createSessionItems,
  pickSequential,
  pickRandom,
  pickWrong,
  isAnswerCorrect,
  displayedCorrectIndex
} from '../assets/js/quiz.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('both published question banks retain their expected structure and counts', () => {
  const first = normalizeQuestions(JSON.parse(readFileSync(resolve(root, 'data/quocphong1.json'), 'utf8')));
  const second = normalizeQuestions(JSON.parse(readFileSync(resolve(root, 'data/quocphong2.json'), 'utf8')));

  assert.equal(first.length, 479);
  assert.equal(second.length, 262);

  for (const questions of [first, second]) {
    assert.equal(new Set(questions.map((question) => question.originalIndex)).size, questions.length);
    for (const question of questions) {
      assert.ok(question.question.trim());
      assert.ok(question.options.length >= 2);
      assert.ok(question.correct >= 0 && question.correct < question.options.length);
    }
  }
});

test('question normalization rejects malformed questions and answer indices', () => {
  assert.throws(() => normalizeQuestions({}), /mảng câu hỏi/);
  assert.throws(() => normalizeQuestions([{ question: '', options: ['A', 'B'], correct: 0 }]), /thiếu nội dung/);
  assert.throws(() => normalizeQuestions([{ question: 'Q', options: ['A'], correct: 0 }]), /ít nhất hai đáp án/);
  assert.throws(() => normalizeQuestions([{ question: 'Q', options: ['A', 'B'], correct: 2 }]), /không hợp lệ/);
});

test('shuffled answer orders still resolve the original correct answer', () => {
  const pool = normalizeQuestions([
    { question: 'Q1', options: ['A', 'B', 'C', 'D'], correct: 2 },
    { question: 'Q2', options: ['X', 'Y', 'Z'], correct: 0 }
  ]);
  for (let round = 0; round < 40; round++) {
    const items = createSessionItems(pool, { shuffleQ: true, shuffleA: true });
    assert.equal(new Set(items.map((item) => item.poolIdx)).size, pool.length);
    for (const item of items) {
      const question = pool[item.poolIdx];
      const correctDisplayed = displayedCorrectIndex(item, question);
      item.userAnswer = correctDisplayed;
      assert.equal(isAnswerCorrect(item, question), true);
      item.userAnswer = (correctDisplayed + 1) % item.optionOrder.length;
      assert.equal(isAnswerCorrect(item, question), false);
    }
  }
});

test('sequential selection skips completed questions without exceeding count', () => {
  const questions = normalizeQuestions(Array.from({ length: 8 }, (_, index) => ({
    question: `Q${index + 1}`,
    options: ['A', 'B'],
    correct: 0
  })));
  const result = pickSequential(questions, 1, 3, new Set([1, 3, 5]));
  assert.deepEqual(result.items.map((question) => question.originalIndex), [2, 4, 6]);
  assert.equal(result.actualCount, 3);
  assert.equal(result.nextCursor, 7);
});

test('random selection returns unique questions and prefers uncompleted ones', () => {
  const questions = normalizeQuestions(Array.from({ length: 10 }, (_, index) => ({
    question: `Q${index + 1}`,
    options: ['A', 'B'],
    correct: 0
  })));
  const completed = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
  const result = pickRandom(questions, 5, true, completed);
  assert.equal(result.length, 5);
  assert.equal(new Set(result.map((question) => question.originalIndex)).size, 5);
  assert.ok(result.filter((question) => !completed.has(question.originalIndex)).length >= 2);
});

test('wrong-question selection respects indices and requested count', () => {
  const questions = normalizeQuestions(Array.from({ length: 6 }, (_, index) => ({
    question: `Q${index + 1}`,
    options: ['A', 'B'],
    correct: 0
  })));
  const result = pickWrong(questions, [1, 3, 5], 2, false);
  assert.deepEqual(result.map((question) => question.originalIndex), [1, 3]);
  assert.deepEqual(pickWrong(questions, [99], 5, false), []);
});

test('question fingerprint changes when question data changes', () => {
  const first = normalizeQuestions([{ question: 'Q', options: ['A', 'B'], correct: 0 }]);
  const changed = normalizeQuestions([{ question: 'Q', options: ['A', 'B'], correct: 1 }]);
  assert.notEqual(fingerprintQuestions(first), fingerprintQuestions(changed));
});

test('answer shuffling is disabled for questions that reference option letters', () => {
  const questions = normalizeQuestions([{
    question: 'Phương án nào đúng? Cả A và B đều đúng.',
    options: ['Ý A', 'Ý B', 'Ý C', 'Ý D'],
    correct: 0
  }]);
  for (let round = 0; round < 20; round++) {
    const [item] = createSessionItems(questions, { shuffleQ: false, shuffleA: true });
    assert.deepEqual(item.optionOrder, [0, 1, 2, 3]);
    item.userAnswer = displayedCorrectIndex(item, questions[0]);
    assert.equal(isAnswerCorrect(item, questions[0]), true);
  }
});

test('answer shuffling is disabled for relative phrases such as all options above', () => {
  const questions = normalizeQuestions([{
    question: 'Phương án nào chính xác?',
    options: ['Phương án A', 'Phương án B', 'Tất cả các phương án trên', 'Không có phương án nào'],
    correct: 2
  }]);
  const [item] = createSessionItems(questions, { shuffleQ: false, shuffleA: true });
  assert.deepEqual(item.optionOrder, [0, 1, 2, 3]);
});
