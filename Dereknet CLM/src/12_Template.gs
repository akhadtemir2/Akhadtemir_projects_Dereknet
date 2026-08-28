/**************************************************************************************
 * Dereknet CLM — 12_Template
 * ---------------------------------------------------------------------------------
 * Проверка и правка шаблона NDA.
 *
 * Часть ошибок живёт не в коде, а в самом Google Документе: в нём захардкожены
 * слова, которые должны меняться в зависимости от контрагента, и русские
 * плейсхолдеры стоят в английской колонке. Код такое исправить на лету не может —
 * он лишь подставляет значения в те места, которые в шаблоне есть.
 *
 * Здесь: `checkTemplate()` находит такие места, `fixTemplate()` правит их один раз.
 * Обе функции идемпотентны — повторный запуск ничего не портит.
 **************************************************************************************/

/**
 * Известные дефекты шаблона.
 *   find    — регулярное выражение (синтаксис RE2, фигурные скобки экранированы)
 *   replace — чем заменить
 *   what    — что не так, человеческим языком
 *   example — как это выглядит в готовом договоре
 */
var TEMPLATE_PATCHES = [
  {
    id: 'ПРЕАМБУЛА_ПАДЕЖ',
    find:    'в лице \\{\\{DISCLOSING_PARTY_REP_POSITION_RU\\}\\} \\{\\{DISCLOSING_PARTY_REP_NAME_RU\\}\\}',
    replace: 'в лице {{DISCLOSING_PARTY_REP_POSITION_RU_GEN}} {{DISCLOSING_PARTY_REP_NAME_RU_GEN}}',
    what:    'В преамбуле должность и ФИО стоят в именительном падеже вместо родительного',
    example: '«в лице Директор Кабдулов Саламат Шамарданович» вместо ' +
             '«в лице Директора Кабдулова Саламата Шамардановича»'
  },
  {
    id: 'РОД_ЗАРЕГИСТРИРОВАН',
    find:    '\\{\\{RECEIVING_PARTY_LEGAL_FORM_RU\\}\\}, зарегистрированная',
    replace: '{{RECEIVING_PARTY_LEGAL_FORM_RU}}, {{RECEIVING_PARTY_REG_AGREEMENT_RU}}',
    what:    'Слово «зарегистрированная» вписано в шаблон намертво и не согласуется с правовой формой',
    example: '«акционерное общество, зарегистрированная» вместо «…, зарегистрированное»'
  },
  {
    id: 'АДРЕС_В_АНГЛ_КОЛОНКЕ',
    find:    'Address: \\{\\{RECEIVING_PARTY_ADDRESS\\}\\}',
    replace: 'Address: {{RECEIVING_PARTY_ADDRESS_EN}}',
    what:    'В английской колонке стоит русский адрес',
    example: '«Address: ГОРОД АЛМАТЫ, ПР. АЛЬ-ФАРАБИ» вместо «Address: GOROD ALMATY, PR. AL-FARABI»'
  },
  {
    id: 'НАЗВАНИЕ_В_АНГЛ_КОЛОНКЕ',
    find:    'Tax Identification Number: \\{\\{RECEIVING_PARTY_TAX_ID\\}\\}',
    replace: 'Tax Identification Number: {{RECEIVING_PARTY_TAX_ID_EN}}',
    what:    'В английской колонке используется русский токен налогового номера',
    example: 'на вид одинаково, но при смене формата номера колонки разойдутся'
  }
];

/** Какие дефекты присутствуют в документе прямо сейчас. */
function templateIssues_(doc) {
  var body = doc.getBody();
  return TEMPLATE_PATCHES.filter(function (p) {
    try { return body.findText(p.find) !== null; }
    catch (e) { return false; }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  МЕНЮ
// ═══════════════════════════════════════════════════════════════════════════════════

/** Показать, что не так с шаблоном, ничего не меняя. */
function checkTemplate() {
  var ui = SpreadsheetApp.getUi();
  var id = prop_(PROP.KZ_TEMPLATE_ID);
  if (!id) {
    ui.alert('Шаблон не задан', 'Меню «CLM» → «🔍 Найти шаблоны и подпись»', ui.ButtonSet.OK);
    return;
  }

  var doc = DocumentApp.openById(id);
  var issues = templateIssues_(doc);

  if (!issues.length) {
    ui.alert('✅ Шаблон в порядке',
      'Известных дефектов не найдено.\n\n' +
      'Это не заменяет чтение готового договора глазами — ' +
      'проверяются только те ошибки, которые встречались раньше.',
      ui.ButtonSet.OK);
    return;
  }

  var text = ['В шаблоне «' + doc.getName() + '» найдено проблем: ' + issues.length, ''];
  issues.forEach(function (p, i) {
    text.push((i + 1) + '. ' + p.what);
    text.push('   Пример: ' + p.example);
    text.push('');
  });
  text.push('Исправить: меню «CLM» → «🛠» → «🔧 Исправить шаблон».');
  ui.alert('⚠️ Шаблон требует правки', text.join('\n'), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  РАЗМЕР ПОДПИСИ
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Задать ширину подписи в миллиметрах и сразу увидеть результат.
 *
 * Подбирать размер вслепую бессмысленно, поэтому функция создаёт временный
 * документ с образцом и даёт на него ссылку. Не понравилось — запустить снова
 * с другим числом.
 */
function menuSignatureSize() {
  var ui = SpreadsheetApp.getUi();
  var sigId = prop_(PROP.SIGNATURE_FILE_ID);
  if (!sigId) {
    ui.alert('Подпись не задана', 'Меню «CLM» → «🔍 Найти шаблоны и подпись»', ui.ButtonSet.OK);
    return;
  }

  var currentMm = Math.round(signatureWidthPt_() / CFG.PT_PER_MM);
  var resp = ui.prompt('Размер подписи',
    'Ширина подписи в договоре, в миллиметрах.\n\n' +
    'Сейчас: ' + currentMm + ' мм\n' +
    'Обычный размер росчерка в договоре: 35–45 мм\n' +
    'Допустимо: от 10 до 100 мм\n\n' +
    'Введите число:',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var mm = parseFloat(String(resp.getResponseText()).replace(',', '.'));
  if (!mm || isNaN(mm)) {
    ui.alert('Не число', 'Введите, например: 40', ui.ButtonSet.OK);
    return;
  }

  var pt = Math.round(mm * CFG.PT_PER_MM);
  if (pt < CFG.SIGNATURE_MIN_WIDTH_PT || pt > CFG.SIGNATURE_MAX_WIDTH_PT) {
    ui.alert('Вне допустимых границ', 'Нужно от 10 до 100 мм.', ui.ButtonSet.OK);
    return;
  }
  setProp_(PROP.SIGNATURE_WIDTH_PT, pt);

  var url = buildSignaturePreview_(sigId, pt, mm);
  ui.alert('Размер сохранён: ' + mm + ' мм',
    (url
      ? 'Образец для сравнения — откройте и посмотрите:\n\n' + url +
        '\n\nНе подошло — запустите этот пункт меню ещё раз с другим числом.\n' +
        'Временный документ можно удалить.'
      : 'Образец создать не удалось, но размер сохранён. Проверьте на пробном договоре.') +
    '\n\nНовый размер применится к договорам, созданным после этого момента. ' +
    'Уже созданные не меняются.',
    ui.ButtonSet.OK);
}

/** Временный документ с образцом подписи в блоке подписей. */
function buildSignaturePreview_(sigFileId, pt, mm) {
  try {
    var file = DriveApp.getFileById(sigFileId);
    var blob = Utilities.newBlob(file.getBlob().getBytes(), file.getMimeType(), 'signature');

    var doc = DocumentApp.create('ОБРАЗЕЦ подписи ' + mm + 'мм — можно удалить');
    var body = doc.getBody();

    body.appendParagraph('Так подпись будет выглядеть в договоре (' + mm + ' мм)')
        .setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendParagraph('Раскрывающая сторона:');
    body.appendParagraph(DEREKNET.NAME_RU);

    var par = body.appendParagraph('');
    var img = par.appendInlineImage(blob);
    var w = img.getWidth(), h = img.getHeight();
    if (w > 0) img.setWidth(pt).setHeight(Math.round(h * pt / w));

    body.appendParagraph(DEREKNET.REP_POSITION_RU + ', ' + DEREKNET.REP_NAME_RU);
    body.appendParagraph('(Ф.И.О., должность)').setItalic(true);

    if (w > 0 && w < pt) {
      body.appendParagraph('');
      body.appendParagraph(
        '⚠️ Исходная картинка уже (' + Math.round(w / CFG.PT_PER_MM) + ' мм), ' +
        'её пришлось растянуть — подпись может выглядеть размыто. ' +
        'Лучше пересохранить PNG с большим разрешением.'
      ).setItalic(true);
    }

    doc.saveAndClose();
    DriveApp.getFileById(doc.getId()).moveTo(DriveApp.getFolderById(prop_(PROP.TEMPLATE_FOLDER_ID)));
    return doc.getUrl();
  } catch (e) {
    Logger.log('Образец подписи не создался: ' + e);
    return '';
  }
}

/** Применить правки к шаблону. Спрашивает подтверждение и показывает отчёт. */
function fixTemplate() {
  var ui = SpreadsheetApp.getUi();
  var id = prop_(PROP.KZ_TEMPLATE_ID);
  if (!id) {
    ui.alert('Шаблон не задан', 'Меню «CLM» → «🔍 Найти шаблоны и подпись»', ui.ButtonSet.OK);
    return;
  }

  var doc = DocumentApp.openById(id);
  var issues = templateIssues_(doc);

  if (!issues.length) {
    ui.alert('Нечего исправлять', 'Известных дефектов в шаблоне нет.', ui.ButtonSet.OK);
    return;
  }

  var preview = issues.map(function (p, i) { return (i + 1) + '. ' + p.what; }).join('\n');
  var answer = ui.alert('Исправить шаблон?',
    'Будет изменён документ «' + doc.getName() + '».\n\n' + preview + '\n\n' +
    'Изменения затрагивают только служебные подстановки, текст договора не меняется.\n' +
    'Откатить можно через «Файл → История версий» в самом документе.\n\nПродолжить?',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  var body = doc.getBody();
  var applied = [];
  var failed = [];

  issues.forEach(function (p) {
    try {
      body.replaceText(p.find, p.replace);
      applied.push('✅ ' + p.what);
    } catch (e) {
      failed.push('❌ ' + p.id + ': ' + e.message);
    }
  });
  doc.saveAndClose();

  // Убеждаемся, что правки действительно легли
  var remaining = templateIssues_(DocumentApp.openById(id));

  var report = applied.concat(failed);
  if (remaining.length) {
    report.push('', '⚠️ Осталось неисправленным: ' + remaining.length +
                '. Возможно, текст в шаблоне отличается от ожидаемого — ' +
                'исправьте вручную или пришлите шаблон разработчику.');
  } else {
    report.push('', 'Готово. Проверьте результат: «CLM» → «🛠» → «🧪 Тест: собрать пробный договор», ' +
                'затем создайте один настоящий договор и прочитайте преамбулу.');
  }

  Logger.log(report.join('\n'));
  ui.alert('Правка шаблона', report.join('\n'), ui.ButtonSet.OK);
}
