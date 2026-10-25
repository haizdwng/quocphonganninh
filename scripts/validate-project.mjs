import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => errors.push(message);

const html = read('index.html');
const app = read('assets/js/app.js');
const sw = read('sw.js');

const ids = [...html.matchAll(/\bid=['"]([^'"]+)['"]/g)].map((match) => match[1]);
const seenIds = new Set();
for (const id of ids) {
  if (seenIds.has(id)) fail(`index.html: ID bị trùng "${id}".`);
  seenIds.add(id);
}

for (const match of app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
  if (!seenIds.has(match[1])) fail(`assets/js/app.js: không tìm thấy phần tử ID "${match[1]}" trong index.html.`);
}

for (const match of sw.matchAll(/['"](\.\/[^'"]+)['"]/g)) {
  const asset = match[1];
  if (asset === './') continue;
  const file = asset.slice(2);
  if (!exists(file)) fail(`sw.js: tài nguyên cache không tồn tại: ${file}`);
}

for (const file of ['data/quocphong1.json', 'data/quocphong2.json']) {
  let questions;
  try {
    questions = JSON.parse(read(file));
  } catch (error) {
    fail(`${file}: JSON không hợp lệ (${error.message}).`);
    continue;
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    fail(`${file}: dữ liệu phải là mảng câu hỏi không rỗng.`);
    continue;
  }
  questions.forEach((question, index) => {
    const label = `${file}: câu ${index + 1}`;
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      fail(`${label}: phải là object.`);
      return;
    }
    if (typeof question.question !== 'string' || !question.question.trim()) {
      fail(`${label}: thiếu nội dung câu hỏi.`);
    }
    if (!Array.isArray(question.options) || question.options.length < 2) {
      fail(`${label}: phải có ít nhất hai đáp án.`);
    } else {
      question.options.forEach((option, optionIndex) => {
        if (typeof option !== 'string' || !option.trim()) {
          fail(`${label}: đáp án ${optionIndex + 1} trống hoặc không phải chuỗi.`);
        }
      });
      if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct >= question.options.length) {
        fail(`${label}: chỉ số đáp án đúng không hợp lệ.`);
      }
    }
    if (Object.hasOwn(question, 'fixed') && typeof question.fixed !== 'boolean') {
      fail(`${label}: trường fixed phải là boolean.`);
    }
  });
}

for (const file of [
  'assets/js/app.js',
  'assets/js/quiz.js',
  'assets/js/storage.js',
  'assets/css/style.css',
  'sw.js',
  'manifest.webmanifest'
]) {
  if (!exists(file)) fail(`Thiếu tệp bắt buộc: ${file}`);
}

if (errors.length) {
  console.error('Kiểm tra dự án thất bại:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Kiểm tra dự án thành công: ID HTML, tài nguyên ngoại tuyến, JSON và schema câu hỏi đều hợp lệ.');
}
