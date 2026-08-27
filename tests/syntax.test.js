/**
 * Синтаксическая проверка всех файлов проекта.
 *
 * Apps Script не показывает ошибку синтаксиса до попытки запуска, а собранный
 * из 11 файлов проект склеивается в одну область видимости — одна опечатка
 * ломает вообще всё. Здесь мы ловим это локально, за секунду.
 *
 * Дополнительно проверяем, что нет дублирующихся имён функций между файлами:
 * в Apps Script второе объявление молча перекрывает первое.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
let errors = 0;

function report(ok, label, detail) {
  if (ok) { console.log('  ✓ ' + label); }
  else { errors++; console.log('  ✗ ' + label + '\n      ' + detail); }
}

// ── 1. Синтаксис .gs ────────────────────────────────────────────────
console.log('\nСинтаксис Apps Script (.gs)');
const gsFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
const sources = {};

gsFiles.forEach(file => {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  sources[file] = code;
  try {
    new vm.Script(code, { filename: file });
    report(true, file);
  } catch (e) {
    report(false, file, e.message);
  }
});

// ── 2. Дублирующиеся объявления функций ─────────────────────────────
console.log('\nДублирующиеся имена функций между файлами');
const declaredIn = {};
const duplicates = [];
gsFiles.forEach(file => {
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(sources[file])) !== null) {
    const name = m[1];
    if (declaredIn[name] && declaredIn[name] !== file) {
      duplicates.push(`${name}: ${declaredIn[name]} и ${file}`);
    } else {
      declaredIn[name] = file;
    }
  }
});
report(duplicates.length === 0, 'уникальность имён функций', duplicates.join('\n      '));

// ── 3. Дублирующиеся глобальные переменные ──────────────────────────
console.log('\nДублирующиеся глобальные var между файлами');
const varIn = {};
const varDupes = [];
gsFiles.forEach(file => {
  const re = /^var\s+([A-Za-z_$][\w$]*)\s*=/gm;
  let m;
  while ((m = re.exec(sources[file])) !== null) {
    const name = m[1];
    if (varIn[name] && varIn[name] !== file) varDupes.push(`${name}: ${varIn[name]} и ${file}`);
    else varIn[name] = file;
  }
});
report(varDupes.length === 0, 'уникальность глобальных переменных', varDupes.join('\n      '));

// ── 4. Синтаксис браузерного кода в Index.html ──────────────────────
console.log('\nБраузерный JavaScript в Index.html');
const html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
report(scripts.length > 0, 'блок <script> найден', 'скриптов в файле нет');
scripts.forEach((code, i) => {
  try {
    new vm.Script(code, { filename: `Index.html#script${i + 1}` });
    report(true, `<script> #${i + 1}`);
  } catch (e) {
    report(false, `<script> #${i + 1}`, e.message);
  }
});

// ── 5. Серверные функции, вызываемые из браузера, должны существовать ──
console.log('\nСвязь браузер → сервер (google.script.run)');
const allServerCode = Object.values(sources).join('\n');
const calledApis = [...html.matchAll(/\.\s*(api[A-Z][\w]*)\s*\(/g)].map(m => m[1]);
const uniqueApis = [...new Set(calledApis)];
report(uniqueApis.length > 0, 'вызовы api* найдены (' + uniqueApis.length + ')', 'ни одного вызова');
uniqueApis.forEach(fn => {
  const exists = new RegExp('^function\\s+' + fn + '\\s*\\(', 'm').test(allServerCode);
  report(exists, fn + '() есть на сервере', 'функция вызывается из Index.html, но не объявлена ни в одном .gs');
});

// ── 6. Ключи PROP не должны расходиться с использованием ────────────
console.log('\nЦелостность ключей настроек');
const propKeys = [...sources['01_Config.gs'].matchAll(/^\s{2}([A-Z_]+):\s*'([A-Z_]+)'/gm)].map(m => m[1]);
const usedProps = [...new Set([...allServerCode.matchAll(/PROP\.([A-Z_]+)/g)].map(m => m[1]))];
const unknownProps = usedProps.filter(k => propKeys.indexOf(k) === -1);
report(unknownProps.length === 0, 'все PROP.* объявлены', 'нет в PROP: ' + unknownProps.join(', '));

// ── 7. Все токены, используемые в 06_Render, объявлены в KNOWN_TOKENS ──
console.log('\nСловарь плейсхолдеров');
const renderKeys = [...new Set(
  [...sources['06_Render.gs'].matchAll(/^\s{4}([A-Z][A-Z0-9_]+):/gm)].map(m => m[1])
)];
const knownBlock = sources['03_Pure.gs'].match(/var KNOWN_TOKENS = \[([\s\S]*?)\];/);
const known = knownBlock ? [...knownBlock[1].matchAll(/'([A-Z0-9_]+)'/g)].map(m => m[1]) : [];
const notDeclared = renderKeys.filter(k => known.indexOf(k) === -1);
report(notDeclared.length === 0,
  'все поля 06_Render есть в KNOWN_TOKENS (' + renderKeys.length + ' полей)',
  'не хватает в KNOWN_TOKENS: ' + notDeclared.join(', '));

// ── 8. Ширина строк журнала должна совпадать с числом заголовков ──────
// Если добавить колонку в заголовки и забыть про logRow_ — setValues()
// упадёт с «number of columns does not match» уже в бою, на живой заявке.
console.log('\nСовпадение ширины строк и заголовков');

/**
 * Считает элементы верхнего уровня в массиве после `marker`.
 * Учитывает вложенность и — важно — строковые литералы: запятая внутри
 * 'Время обработки, с' не является разделителем элементов.
 */
function countArrayItems(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) return -1;
  const open = source.indexOf('[', start);
  let depth = 0, items = 1, quote = null;

  for (let i = open; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === '\\') i++;                 // экранированный символ
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') {           // строчный комментарий
      i = source.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }

    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') { depth--; if (depth === 0) break; }
    else if (ch === ',' && depth === 1) items++;
  }
  return items;
}

const logHeaders = countArrayItems(sources['08_Log.gs'], 'var LOG_HEADERS =');
const logRowCols = countArrayItems(sources['08_Log.gs'], '_logBuffer.push(');
report(logHeaders === logRowCols,
  `Журнал: ${logHeaders} заголовков = ${logRowCols} колонок в строке`,
  'logRow_() пишет не столько колонок, сколько объявлено в LOG_HEADERS');

const regHeaders = countArrayItems(sources['08_Log.gs'], 'var REGISTER_HEADERS =');
const regRowCols = countArrayItems(sources['08_Log.gs'], 'registerSheet_().appendRow(');
report(regHeaders === regRowCols,
  `Реестр: ${regHeaders} заголовков = ${regRowCols} колонок в строке`,
  'appendRegisterRow_() пишет не столько колонок, сколько объявлено в REGISTER_HEADERS');

// ── 9. Каждый код ошибки, который бросает код, должен быть в ERROR_HELP ──
console.log('\nПокрытие кодов ошибок справочником');
const thrownCodes = [...new Set(
  [...allServerCode.matchAll(/softError_\(\s*'([А-ЯЁA-Z_]+)'/g)].map(m => m[1])
)];
const helpBlock = sources['03_Pure.gs'].match(/var ERROR_HELP = \{([\s\S]*?)\n\};/);
const helpCodes = helpBlock ? [...helpBlock[1].matchAll(/'([А-ЯЁA-Z_]+)':/g)].map(m => m[1]) : [];
const uncovered = thrownCodes.filter(c => helpCodes.indexOf(c) === -1);
report(uncovered.length === 0,
  `все ${thrownCodes.length} кодов ошибок объяснены пользователю`,
  'нет объяснения для: ' + uncovered.join(', '));

// ── 10. build/ должен соответствовать src/ ──────────────────────────
// Из build/Code.gs код вставляют в Apps Script руками. Если он отстал
// от src/, в бой уедет старая версия — молча и незаметно.
console.log('\nАктуальность собранного файла');
const { buildCode } = require(path.join(__dirname, '..', 'tools', 'build.js'));
const buildPath = path.join(__dirname, '..', 'build', 'Code.gs');

if (!fs.existsSync(buildPath)) {
  report(false, 'build/Code.gs существует', 'запустите: npm run build');
} else {
  // Дата сборки в шапке меняется каждый день — сравниваем без неё.
  const normalize = s => s.replace(/^ \* {2}Собрано: .*$/m, '').replace(/\r\n/g, '\n');
  const same = normalize(fs.readFileSync(buildPath, 'utf8')) === normalize(buildCode());
  report(same, 'build/Code.gs совпадает с src/', 'src/ изменился — запустите: npm run build');
}

['Index.html', 'appsscript.json'].forEach(name => {
  const a = path.join(__dirname, '..', 'build', name);
  const b = path.join(SRC, name);
  if (!fs.existsSync(a)) return report(false, 'build/' + name, 'запустите: npm run build');
  const same = fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  report(same, 'build/' + name + ' совпадает с src/', 'запустите: npm run build');
});

console.log('\n' + '─'.repeat(60));
console.log(errors ? `Ошибок: ${errors}` : 'Все проверки пройдены.');
process.exit(errors ? 1 : 0);
