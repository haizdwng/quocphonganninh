import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [html, css, application, enhancements, quiz, storage, serviceWorker, firstDeckText, secondDeckText, manifestText] = await Promise.all([
  read('index.html'),
  read('assets/css/style.css'),
  read('assets/javascript/app.js'),
  read('assets/javascript/enhance.js'),
  read('assets/javascript/quiz.js'),
  read('assets/javascript/storage.js'),
  read('sw.js'),
  read('data/quocphong1.json'),
  read('data/quocphong2.json'),
  read('manifest.webmanifest')
]);

const htmlIdentifiers = [...html.matchAll(/\bid=['"]([^'"]+)['"]/g)].map((match) => match[1]);
assert.equal(new Set(htmlIdentifiers).size, htmlIdentifiers.length, 'HTML identifiers must be unique');

const allJavaScript = [application, enhancements, quiz, storage, serviceWorker].join('\n');
const referencedIdentifiers = new Set([...allJavaScript.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]));
for (const identifier of referencedIdentifiers) {
  assert.ok(htmlIdentifiers.includes(identifier), 'JavaScript references a missing HTML identifier: ' + identifier);
}

const styleClasses = new Set([...css.matchAll(/\.([a-zA-Z_-][\w-]*)/g)].map((match) => match[1]));
const htmlClasses = [...html.matchAll(/\bclass=['"]([^'"]+)['"]/g)].flatMap((match) => match[1].split(/\s+/).filter(Boolean));
for (const className of htmlClasses) {
  assert.ok(styleClasses.has(className), 'HTML class has no CSS rule: ' + className);
}

const javascriptClasses = [...allJavaScript.matchAll(/(?:className\s*=\s*|classList\.(?:add|remove|toggle)\()\s*['"]([^'"]+)['"]/g)]
  .flatMap((match) => match[1].split(/\s+/).filter(Boolean));
for (const className of javascriptClasses) {
  assert.ok(styleClasses.has(className), 'JavaScript assigns a class with no CSS rule: ' + className);
}

const declaredProperties = new Set([...css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map((match) => match[1]));
const referencedProperties = new Set([...css.matchAll(/var\((--[a-zA-Z0-9_-]+)/g)].map((match) => match[1]));
const dynamicallyAssignedProperties = new Set([...enhancements.matchAll(/['"](--[a-zA-Z0-9_-]+)['"]/g)].map((match) => match[1]));
for (const property of referencedProperties) {
  assert.ok(declaredProperties.has(property) || dynamicallyAssignedProperties.has(property), 'CSS custom property has no definition: ' + property);
}

const firstDeck = JSON.parse(firstDeckText);
const secondDeck = JSON.parse(secondDeckText);
const manifest = JSON.parse(manifestText);
assert.equal(firstDeck.length, 479, 'The first question set must contain 479 questions');
assert.equal(secondDeck.length, 262, 'The second question set must contain 262 questions');
for (const [deckName, questions] of [['first question set', firstDeck], ['second question set', secondDeck]]) {
  for (const [index, question] of questions.entries()) {
    assert.equal(typeof question.question, 'string', deckName + ', question ' + (index + 1) + ': question text must be a string');
    assert.ok(question.question.trim(), deckName + ', question ' + (index + 1) + ': question text must not be empty');
    assert.ok(Array.isArray(question.options) && question.options.length >= 2, deckName + ', question ' + (index + 1) + ': at least two answers are required');
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < question.options.length, deckName + ', question ' + (index + 1) + ': correct answer index is invalid');
    if (Object.hasOwn(question, 'fixed')) assert.equal(typeof question.fixed, 'boolean', deckName + ', question ' + (index + 1) + ': fixed must be boolean');
  }
}
assert.ok(manifest.name && manifest.start_url, 'The web app manifest must contain its name and start URL');
assert.ok(application.includes('initializeEnhancements'), 'The application must initialize its enhancement module');

process.stdout.write('Project validation passed.\n');
