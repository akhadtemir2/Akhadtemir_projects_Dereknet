/**
 * Сборка src/*.gs в один файл для ручной установки через браузер.
 *
 * ЗАЧЕМ. Копировать 11 файлов по одному в редактор Apps Script — долго и легко
 * ошибиться (перепутать порядок, забыть файл). Здесь всё склеивается в
 * build/Code.gs в правильном алфавитном порядке — вставить нужно один раз.
 *
 * Исходником остаётся src/: правки вносим туда, потом `npm run build`.
 * Файл build/Code.gs редактировать руками нельзя — его перезапишет следующая сборка.
 *
 * Запуск:  npm run build
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'build');

const STRIP_START = '/* build:strip-start */';
const STRIP_END = '/* build:strip-end */';

/** Убрать блоки, нужные только локальным тестам (module.exports и т.п.). */
function stripBuildOnly(code) {
  let out = code;
  for (;;) {
    const a = out.indexOf(STRIP_START);
    if (a === -1) break;
    const b = out.indexOf(STRIP_END, a);
    if (b === -1) throw new Error('Незакрытый ' + STRIP_START);
    out = out.slice(0, a) + out.slice(b + STRIP_END.length);
  }
  return out.replace(/\n{3,}$/, '\n');
}

function buildCode() {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();

  const header = [
    '/**************************************************************************************',
    ' *  Dereknet CLM v5.0 — СОБРАННЫЙ ФАЙЛ',
    ' *  ---------------------------------------------------------------------------------',
    ' *  ⚠️  НЕ РЕДАКТИРОВАТЬ ЗДЕСЬ. Это склейка ' + files.length + ' файлов из src/.',
    ' *      Правки вносятся в src/, затем `npm run build` и повторная вставка.',
    ' *',
    ' *  Собрано: ' + new Date().toISOString().slice(0, 10),
    ' *  Порядок файлов: ' + files.join(', '),
    ' **************************************************************************************/',
    ''
  ].join('\n');

  const body = files.map(f => {
    const code = stripBuildOnly(fs.readFileSync(path.join(SRC, f), 'utf8'));
    const bar = '═'.repeat(70);
    return [
      '',
      '// ' + bar,
      '//  ФАЙЛ: ' + f,
      '// ' + bar,
      '',
      code.trimEnd(),
      ''
    ].join('\n');
  }).join('\n');

  return header + body + '\n';
}

function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

  const code = buildCode();
  fs.writeFileSync(path.join(OUT, 'Code.gs'), code, 'utf8');
  fs.copyFileSync(path.join(SRC, 'Index.html'), path.join(OUT, 'Index.html'));
  fs.copyFileSync(path.join(SRC, 'appsscript.json'), path.join(OUT, 'appsscript.json'));

  const lines = code.split('\n').length;
  console.log('Собрано в build/:');
  console.log('  Code.gs          ' + lines + ' строк (склейка ' +
              fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).length + ' файлов)');
  console.log('  Index.html       без изменений');
  console.log('  appsscript.json  без изменений');
}

module.exports = { buildCode };

if (require.main === module) main();
