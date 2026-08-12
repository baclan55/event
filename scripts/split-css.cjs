const fs = require('fs');
const sharp = require('sharp');

const source = fs.readFileSync('public/css/style.css', 'utf8');
const rules = [];
let start = 0;
let depth = 0;
let quote = '';
let inComment = false;

for (let i = 0; i < source.length; i += 1) {
  const char = source[i];
  const next = source[i + 1];

  if (inComment) {
    if (char === '*' && next === '/') {
      inComment = false;
      i += 1;
    }
    continue;
  }
  if (!quote && char === '/' && next === '*') {
    inComment = true;
    i += 1;
    continue;
  }
  if (quote) {
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === quote) quote = '';
    continue;
  }
  if (char === '"' || char === "'") {
    quote = char;
    continue;
  }
  if (char === '{') depth += 1;
  if (char === '}') {
    depth -= 1;
    if (depth === 0) {
      rules.push(source.slice(start, i + 1));
      start = i + 1;
    }
  }
}

if (start < source.length) rules.push(source.slice(start));

const chunks = [];
let current = '';
for (const rule of rules) {
  if (Buffer.byteLength(current + rule) > 14_000 && current.trim()) {
    chunks.push(current);
    current = '';
  }
  current += rule;
}
if (current.trim()) chunks.push(current);

for (const [index, chunk] of chunks.entries()) {
  const filename = `public/css/site-${index + 1}.css`;
  fs.writeFileSync(filename, chunk);
  console.log(`${filename}: ${Buffer.byteLength(chunk)} bytes`);
}

sharp('public/img/mountains-bg.jpg')
  .resize({ width: 700 })
  .jpeg({ quality: 20, mozjpeg: true })
  .toFile('public/img/mountains-bg-sm.jpg')
  .then((info) => {
    console.log(`public/img/mountains-bg-sm.jpg: ${info.size} bytes`);
  });
