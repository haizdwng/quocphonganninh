import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSettings,
  saveSettings,
  getDeckProgress,
  saveDeckProgress,
  getRangeWrongIndices,
  addWrongIndicesForRange,
  getSession,
  saveSession,
  clearSession,
  toggleBookmark,
  exportBackup,
  importBackup,
  storageAvailable
} from '../assets/js/storage.js';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('settings, progress and bookmarks persist through localStorage', () => {
  globalThis.localStorage = new MemoryStorage();
  assert.equal(storageAvailable(), true);
  assert.equal(saveSettings({
    deck: 'qp2',
    count: 15,
    shuffleQ: true,
    shuffleA: false,
    startQuestion: 4,
    endQuestion: 30,
    timeLimit: 25
  }), true);
  assert.deepEqual(getSettings(), {
    deck: 'qp2',
    count: 15,
    shuffleQ: true,
    shuffleA: false,
    startQuestion: 4,
    endQuestion: 30,
    timeLimit: 25,
    practiceMode: 'practice'
  });

  assert.equal(saveDeckProgress('qp1', {
    sequentialCursor: 5,
    completed: [0, 2, 2, -1],
    wrongMap: { 1: 2 },
    practiceMap: { 2: 3 },
    bookmarks: [],
    dataFingerprint: 'test-fingerprint'
  }), true);
  assert.equal(toggleBookmark('qp1', 2), true);
  assert.equal(toggleBookmark('qp1', 2), false);
  assert.deepEqual(getDeckProgress('qp1').completed, [0, 2]);
  assert.deepEqual(getDeckProgress('qp1').bookmarks, []);
});

test('backup round-trip preserves settings and progress but excludes active sessions', () => {
  globalThis.localStorage = new MemoryStorage();
  saveSettings({ deck: 'qp1', count: 7, shuffleQ: false, shuffleA: true, startQuestion: 1, endQuestion: 20, timeLimit: 5 });
  saveDeckProgress('qp2', {
    sequentialCursor: 12,
    completed: [1, 3],
    wrongMap: { 2: 4 },
    practiceMap: { 3: 2 },
    bookmarks: [3, 8],
    dataFingerprint: 'qp2-fingerprint'
  });
  saveSession({ deckId: 'qp1', items: [] });

  const backup = exportBackup();
  assert.equal(JSON.parse(backup).format, 'backup');
  assert.equal(JSON.parse(backup).decks.qp2.bookmarks.length, 2);
  assert.equal('session' in JSON.parse(backup), false);

  globalThis.localStorage = new MemoryStorage();
  assert.equal(importBackup(backup), true);
  assert.equal(getSettings().count, 7);
  assert.equal(getSettings().timeLimit, 5);
  assert.deepEqual(getDeckProgress('qp2').completed, [1, 3]);
  assert.deepEqual(getDeckProgress('qp2').bookmarks, [3, 8]);
  assert.equal(getSession(), null);
});

test('invalid backups are rejected without replacing saved data', () => {
  globalThis.localStorage = new MemoryStorage();
  saveSettings({ deck: 'qp2', count: 9, shuffleQ: false, shuffleA: true, startQuestion: 1, endQuestion: 9 });
  assert.equal(importBackup('{not json'), false);
  assert.equal(importBackup({ format: 'wrong', version: 1, decks: {} }), false);
  assert.equal(importBackup({ format: 'backup', version: 1, decks: { qp3: {} } }), false);
  assert.equal(getSettings().count, 9);
});

test('session persistence can be cleared without resetting deck progress', () => {
  globalThis.localStorage = new MemoryStorage();
  saveDeckProgress('qp1', {
    sequentialCursor: 2,
    completed: [1],
    wrongMap: {},
    practiceMap: {},
    bookmarks: [],
    dataFingerprint: 'fingerprint'
  });
  saveSession({ deckId: 'qp1', items: [] });
  assert.ok(getSession());
  assert.equal(clearSession(), true);
  assert.equal(getSession(), null);
  assert.deepEqual(getDeckProgress('qp1').completed, [1]);
});


test('settings are isolated by deck and preserve the selected practice mode', () => {
  globalThis.localStorage = new MemoryStorage();
  saveSettings({ deck: 'qp1', count: 12, shuffleQ: false, shuffleA: true, startQuestion: 1, endQuestion: 40, timeLimit: 0, practiceMode: 'practice' });
  saveSettings({ deck: 'qp2', count: 30, shuffleQ: true, shuffleA: false, startQuestion: 5, endQuestion: 60, timeLimit: 45, practiceMode: 'exam' });

  assert.equal(getSettings('qp1').count, 12);
  assert.equal(getSettings('qp1').practiceMode, 'practice');
  assert.equal(getSettings('qp2').count, 30);
  assert.equal(getSettings('qp2').practiceMode, 'exam');
  assert.equal(getSettings().deck, 'qp2');
});


test('wrong-question history is stored separately for each exact range and survives backup', () => {
  globalThis.localStorage = new MemoryStorage();
  saveDeckProgress('qp1', {
    sequentialCursor: 0,
    completed: [],
    wrongMap: { 1: 1, 4: 2, 7: 1 },
    wrongRangeMap: {},
    practiceMap: {},
    bookmarks: [],
    dataFingerprint: 'range-test'
  });

  assert.deepEqual(getRangeWrongIndices('qp1', 1, 5), [1, 4]);
  assert.deepEqual(getRangeWrongIndices('qp1', 6, 10), [7]);
  assert.equal(addWrongIndicesForRange('qp1', 1, 5, [2, 4, 8]), true);
  assert.deepEqual(getRangeWrongIndices('qp1', 1, 5), [1, 2, 4]);
  assert.deepEqual(getRangeWrongIndices('qp1', 6, 10), [7]);

  const backup = exportBackup();
  globalThis.localStorage = new MemoryStorage();
  assert.equal(importBackup(backup), true);
  assert.deepEqual(getRangeWrongIndices('qp1', 1, 5), [1, 2, 4]);
  assert.deepEqual(getRangeWrongIndices('qp1', 6, 10), [7]);
});
