/**************************************************************************************
 * Dereknet CLM — 08_Log
 * ---------------------------------------------------------------------------------
 * Журнал (что происходило) и Реестр договоров (что подписано).
 *
 * Разделение осознанное: журнал — технический, его читает ответственный за систему;
 * реестр — юридический документ компании, его читают бухгалтерия и руководство.
 **************************************************************************************/

var _logSheet = null;
var _registerSheet = null;
var _logBuffer = [];

function resetRunState_() {
  _logSheet = null;
  _registerSheet = null;
  _logBuffer = [];
  resetPropsCache_();
}

var LOG_HEADERS = [
  'Дата и время', 'Статус', 'Номер договора', 'Кто отправил',
  'Исходный файл', 'Страна', 'Контрагент', 'БИН',
  'Статус контрагента', 'Проверка БИН', 'ОКЭД', 'Дата регистрации',
  'Договор (Google Docs)', 'PDF', 'Что пошло не так',
  'Время обработки, с', 'Токены', 'Уверенность'
];

// Порядок колонок менять осторожно: apiRecentContracts (11_WebApp.gs) читает
// их по номерам, а тест сверяет число заголовков с числом записываемых значений.
var REGISTER_HEADERS = [
  '№ договора', 'Дата', 'Страна', 'Контрагент', 'БИН',
  'Руководитель', 'Юридический адрес', 'Статус контрагента',
  'Договор', 'PDF', 'Инициатор', 'Статус подписания', 'Цель', 'Комментарий'
];

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЛИСТЫ
// ═══════════════════════════════════════════════════════════════════════════════════

function logSpreadsheet_() {
  return SpreadsheetApp.openById(prop_(PROP.LOG_SHEET_ID, { required: true }));
}

/** Создать/починить структуру листов. Вызывается мастером установки. */
function ensureLogSheets_() {
  var ss = logSpreadsheet_();
  ensureSheetWithHeaders_(ss, SHEET.LOG, LOG_HEADERS);
  ensureSheetWithHeaders_(ss, SHEET.REGISTER, REGISTER_HEADERS);
  buildErrorReference_(ss);

  // Убираем пустой лист по умолчанию, если он остался
  var def = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
}

function ensureSheetWithHeaders_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  }
  sh.setFrozenRows(1);
  var head = sh.getRange(1, 1, 1, headers.length);
  head.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setWrap(true);
  sh.setRowHeight(1, 40);
  for (var c = 1; c <= headers.length; c++) sh.setColumnWidth(c, 150);
  return sh;
}

/**
 * Лист-справочник: бухгалтер видит любую ошибку и сразу читает, что делать.
 * Это дешевле и надёжнее, чем «позвони программисту».
 */
function buildErrorReference_(ss) {
  var sh = ss.getSheetByName(SHEET.ERRORS);
  if (!sh) sh = ss.insertSheet(SHEET.ERRORS);
  sh.clear();
  sh.appendRow(['Код', 'Что случилось', 'Что делать']);
  Object.keys(ERROR_HELP).forEach(function (code) {
    sh.appendRow([code, ERROR_HELP[code][0], ERROR_HELP[code][1]]);
  });
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 380);
  sh.setColumnWidth(3, 520);
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 3).setWrap(true).setVerticalAlignment('top');
}

function logSheet_() {
  if (_logSheet) return _logSheet;
  var ss = logSpreadsheet_();
  var sh = ss.getSheetByName(SHEET.LOG);
  if (!sh) { ensureLogSheets_(); sh = ss.getSheetByName(SHEET.LOG); }
  _logSheet = sh;
  return sh;
}

function registerSheet_() {
  if (_registerSheet) return _registerSheet;
  var ss = logSpreadsheet_();
  var sh = ss.getSheetByName(SHEET.REGISTER);
  if (!sh) { ensureLogSheets_(); sh = ss.getSheetByName(SHEET.REGISTER); }
  _registerSheet = sh;
  return sh;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЗАПИСЬ
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Ссылка-формула для ячейки.
 * Apps Script всегда принимает формулы в англоязычном синтаксисе с запятой
 * и сам переводит их в локаль таблицы — поэтому «=HYPERLINK(...)» безопасен
 * и в русской, и в казахской, и в английской локали.
 */
function linkFormula_(url, label) {
  if (!url) return '';
  var safeLabel = String(label || 'открыть').replace(/"/g, "'");
  return '=HYPERLINK("' + url + '","' + safeLabel + '")';
}

/** Первая строка человеческого объяснения ошибки — чтобы было видно прямо в журнале. */
function shortErrorText_(errorString) {
  if (!errorString) return '';
  var code = String(errorString).split(':')[0].trim();
  var human = humanizeError_(code, '').split('\n')[0];
  return human + ' | ' + errorString;
}

/** Строки копятся в памяти и пишутся одним вызовом — так быстрее и надёжнее. */
function logRow_(e) {
  var p = e.partner || {};
  _logBuffer.push([
    new Date(),
    e.status,
    e.number || '',
    e.requester || '',
    e.sourceUrl ? linkFormula_(e.sourceUrl, e.source) : e.source,
    e.country || '',
    p.PARTNER_NAME || '',
    p.BIN || '',
    p._STATUS || '',
    p._LOOKUP || '',
    p._OKED || '',
    p._REGDATE || '',
    linkFormula_(e.docUrl, 'открыть'),
    linkFormula_(e.pdfUrl, 'PDF'),
    shortErrorText_(e.error),
    e.duration || '',
    e.tokens || 0,
    p._confidence || ''
  ]);
}

function flushLog_() {
  if (!_logBuffer.length) return;
  try {
    var sh = logSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, _logBuffer.length, _logBuffer[0].length)
      .setValues(_logBuffer);
    _logBuffer = [];
  } catch (e) {
    Logger.log('Не удалось записать журнал: ' + e);
  }
}

function appendRegisterRow_(number, country, p, out, requester) {
  try {
    registerSheet_().appendRow([
      number,
      Utilities.formatDate(new Date(), CFG.TZ_KZ, 'dd.MM.yyyy'),
      country === 'USA' ? 'США' : 'Казахстан',
      p.PARTNER_NAME || '',
      p.BIN || '',
      p.DIRECTOR || '',
      p.ADDRESS || '',
      p._STATUS || (p._LOOKUP || ''),
      linkFormula_(out.docUrl, 'договор'),
      linkFormula_(out.pdfUrl, 'PDF'),
      requester || '',
      'Черновик',
      purposeLabel_(p.PURPOSE),
      (p._WARNINGS || []).join('; ')
    ]);
  } catch (e) {
    Logger.log('Не удалось записать в реестр: ' + e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ОТЧЁТЫ
// ═══════════════════════════════════════════════════════════════════════════════════

/** Сводка за N дней. Используется в меню и в ежедневном письме. */
function collectStats_(days) {
  var sh = logSheet_();
  var lastRow = sh.getLastRow();
  var stats = { processed: 0, done: 0, review: 0, kz: 0, usa: 0,
                avgSeconds: 0, tokens: 0, costUsd: '0.00', problems: {} };
  if (lastRow < 2) return stats;

  var data = sh.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  var totalSeconds = 0;

  data.forEach(function (row) {
    var t = row[0];
    if (!(t instanceof Date) || t.getTime() < cutoff) return;
    stats.processed++;
    var status = String(row[1]);
    if (status.indexOf('Готово') !== -1) stats.done++;
    if (status.indexOf('проверки') !== -1) {
      stats.review++;
      var code = String(row[14] || '').split(':')[0].split('|')[0].trim() || 'прочее';
      stats.problems[code] = (stats.problems[code] || 0) + 1;
    }
    if (row[5] === 'Kazakhstan') stats.kz++;
    if (row[5] === 'USA') stats.usa++;
    totalSeconds += parseFloat(row[15]) || 0;
    stats.tokens += parseInt(row[16], 10) || 0;
  });

  stats.avgSeconds = stats.processed ? (totalSeconds / stats.processed).toFixed(1) : '0';
  // gpt-4o-mini: ~$0.15 за 1M входных и ~$0.60 за 1M выходных токенов.
  // Берём смешанную оценку $0.30/1M — для контроля расходов этого достаточно.
  stats.costUsd = (stats.tokens / 1e6 * 0.30).toFixed(2);
  return stats;
}

function formatStats_(stats, days) {
  var lines = [
    '📊 Статистика за ' + days + ' дн.',
    '',
    'Всего заявок:            ' + stats.processed,
    '✅ Договоров создано:     ' + stats.done,
    '⚠️ Ушло на проверку:      ' + stats.review,
    '',
    '🇰🇿 Казахстан: ' + stats.kz + '    🇺🇸 США: ' + stats.usa,
    '',
    '⏱ Среднее время:         ' + stats.avgSeconds + ' с на заявку',
    '💵 Расход на распознавание: ~$' + stats.costUsd
  ];
  var codes = Object.keys(stats.problems);
  if (codes.length) {
    lines.push('', 'Причины проверок:');
    codes.sort(function (a, b) { return stats.problems[b] - stats.problems[a]; })
         .forEach(function (c) {
           var help = ERROR_HELP[c];
           lines.push('  • ' + (help ? help[0] : c) + ' — ' + stats.problems[c]);
         });
  }
  return lines.join('\n');
}

function showStats() {
  try {
    var days = 7;
    var text = formatStats_(collectStats_(days), days);
    Logger.log(text);
    uiAlert_('Статистика', text);
    return text;
  } catch (e) {
    uiAlert_('Ошибка', 'Не удалось собрать статистику: ' + e.message);
  }
}
