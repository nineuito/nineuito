/**
 * Збирає в'ювер: підставляє replay.json у шаблон.
 *   node --experimental-strip-types src/build-viewer.ts
 * Результат: viewer/index.html — відкривається подвійним кліком, без сервера.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const tpl = readFileSync(new URL('../viewer/page.html', import.meta.url), 'utf8');
const replay = readFileSync(new URL('../replay.json', import.meta.url), 'utf8');
const page = tpl.replace('__REPLAY_JSON__', replay);

// фрагмент (для публікації як Artifact — там <head>/<body> додаються самі)
writeFileSync(new URL('../viewer/artifact.html', import.meta.url), page);

// самодостатній файл для локального відкриття
writeFileSync(
  new URL('../viewer/index.html', import.meta.url),
  `<!doctype html>\n<html lang="uk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>*{box-sizing:border-box}body{margin:0}img{max-width:100%}</style>\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);

console.log('viewer/index.html та viewer/artifact.html зібрано');
