/**************************************************************************************
 * Dereknet CLM — 10_Menu
 * ---------------------------------------------------------------------------------
 * Меню в Google Таблице. Разделено на два блока:
 *   «Работа»   — то, чем пользуется бухгалтер (2 пункта, оба безопасные)
 *   «Установка и проверка» — то, чем пользуется ответственный за систему
 *
 * Опасные операции спрятаны в подменю и требуют подтверждения: у пользователя
 * без ИТ-опыта не должно быть возможности сломать систему одним промахом мыши.
 **************************************************************************************/

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📄 CLM')
    .addItem('▶️ Обработать входящие сейчас', 'menuProcessNow')
    .addItem('🔗 Открыть форму заявки',       'menuShowWebAppLink')
    .addSeparator()
    .addItem('📊 Статистика за 7 дней',       'showStats')
    .addItem('🔁 Отправить на повтор всё из «Требует проверки»', 'menuReprocess')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠 Установка и проверка')
      .addItem('🩺 Проверить систему',          'healthCheck')
      .addItem('🚀 Запустить мастер установки', 'menuSetup')
      .addItem('🔍 Найти шаблоны и подпись',    'discoverTemplates')
      .addItem('🔎 Проверить шаблон',           'checkTemplate')
      .addItem('🔧 Исправить шаблон',           'fixTemplate')
      .addItem('✍️ Размер подписи',             'menuSignatureSize')
      .addItem('🔑 Указать ключ OpenAI',        'menuSetOpenAiKey')
      .addItem('📧 Указать email ответственного','menuSetManagerEmail')
      .addSeparator()
      .addItem('⏰ Включить автозапуск',        'menuInstallTriggers')
      .addItem('⏸ Выключить автозапуск',       'menuRemoveTriggers')
      .addSeparator()
      .addItem('🧪 Тест: проверить БИН',        'menuTestBin')
      .addItem('🧪 Тест: собрать пробный договор', 'menuDryRun'))
    .addToUi();
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  РАБОТА
// ═══════════════════════════════════════════════════════════════════════════════════

function menuProcessNow() {
  var ui = SpreadsheetApp.getUi();
  try {
    processInbox();
    ui.alert('Готово', 'Входящие обработаны.\n\nРезультат — в листе «' + SHEET.LOG + '».\n' +
             'Готовые договоры — в папке «5. Договоры».', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Не получилось', humanizeError_(e.code, e.message), ui.ButtonSet.OK);
  }
}

function menuReprocess() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Повторная обработка',
    'Все файлы из «4. Требует проверки» вернутся в «1. Входящие» и будут обработаны заново.\n\n' +
    'Убедитесь, что вы устранили причину — иначе они вернутся обратно.\n\nПродолжить?',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  reprocessReview();
}

function menuShowWebAppLink() {
  var ui = SpreadsheetApp.getUi();
  var url = prop_('WEBAPP_URL');
  if (!url) {
    ui.alert('Форма ещё не опубликована',
      'Чтобы включить веб-форму:\n\n' +
      '1. Редактор скрипта → «Начать развёртывание» → «Новое развёртывание»\n' +
      '2. Тип: «Веб-приложение»\n' +
      '3. Запуск от имени: «Я»\n' +
      '4. Доступ: «Все в организации Dereknet»\n' +
      '5. Скопируйте ссылку и вставьте её здесь.',
      ui.ButtonSet.OK);
    var resp = ui.prompt('Ссылка на форму', 'Вставьте URL веб-приложения:', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() === ui.Button.OK && resp.getResponseText().trim()) {
      setProp_('WEBAPP_URL', resp.getResponseText().trim());
      ui.alert('Сохранено', 'Теперь ссылка доступна через меню.', ui.ButtonSet.OK);
    }
    return;
  }
  ui.alert('Форма заявки',
    'Дайте эту ссылку сотрудникам:\n\n' + url +
    '\n\nСовет: попросите их добавить её в закладки браузера.', ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  НАСТРОЙКА
// ═══════════════════════════════════════════════════════════════════════════════════

function menuSetup() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Мастер установки',
    'Если у вас уже есть папка для CLM (например, на Общем диске Dereknet) — вставьте её ID.\n' +
    'Оставьте поле пустым, чтобы создать новую папку «Dereknet CLM» в Моём диске.\n\n' +
    'ID папки — это часть ссылки после /folders/',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  setupWizard(resp.getResponseText().trim() || null);
}

function menuSetOpenAiKey() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Ключ OpenAI',
    'Вставьте ключ (начинается на sk-...).\n\n' +
    'Где взять: platform.openai.com → API keys → Create new secret key.\n' +
    'Ключ хранится в настройках скрипта и в таблице не отображается.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = resp.getResponseText().trim();
  if (!key) return;
  if (!/^sk-/.test(key)) {
    ui.alert('Похоже, это не ключ', 'Ключ OpenAI начинается с «sk-». Проверьте и попробуйте снова.', ui.ButtonSet.OK);
    return;
  }
  setProp_(PROP.OPENAI_API_KEY, key);
  ui.alert('Сохранено', 'Ключ записан. Нажмите «Проверить систему», чтобы убедиться, что всё работает.', ui.ButtonSet.OK);
}

function menuSetManagerEmail() {
  var ui = SpreadsheetApp.getUi();
  var current = prop_(PROP.MANAGER_EMAIL);
  var resp = ui.prompt('Email ответственного',
    'На этот адрес приходят уведомления о проблемах и утренняя сводка.\n' +
    (current ? '\nСейчас: ' + current : ''),
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var email = resp.getResponseText().trim();
  if (!/^[\w.+\-]+@[\w\-]+\.[\w.\-]+$/.test(email)) {
    ui.alert('Неверный адрес', 'Проверьте написание email.', ui.ButtonSet.OK);
    return;
  }
  setProp_(PROP.MANAGER_EMAIL, email);
  ui.alert('Сохранено', 'Уведомления будут приходить на ' + email, ui.ButtonSet.OK);
}

function menuInstallTriggers() {
  installTriggers();
  uiAlert_('Автозапуск включён',
    'Система будет сама проверять папку «1. Входящие» каждые 5 минут.\n\n' +
    'Кроме того:\n• каждый час — возврат зависших файлов\n• в 09:00 — сводка на почту');
}

function menuRemoveTriggers() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.alert('Выключить автозапуск?',
    'Файлы из «1. Входящие» перестанут обрабатываться автоматически.\n' +
    'Запускать придётся вручную через меню.\n\nВыключить?', ui.ButtonSet.YES_NO);
  if (a !== ui.Button.YES) return;
  removeTriggers();
  ui.alert('Выключено', 'Автозапуск остановлен.', ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ТЕСТЫ
// ═══════════════════════════════════════════════════════════════════════════════════

function menuTestBin() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Проверка БИН', 'Введите 12 цифр БИН:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var bin = normalizeBin_(resp.getResponseText());
  if (!/^\d{12}$/.test(bin)) {
    ui.alert('Не БИН', 'Нужно ровно 12 цифр. Получено: ' + bin.length, ui.ButtonSet.OK);
    return;
  }
  if (!isValidKzBin_(bin)) {
    ui.alert('❌ БИН неверный',
      'Контрольный разряд не сходится — в номере опечатка.\nСверьте цифры с оригиналом документа.',
      ui.ButtonSet.OK);
    return;
  }

  CacheService.getScriptCache().remove('bin_v5:' + bin);
  var data = lookupBin_(bin);
  var lines = ['✅ Контрольная сумма верна', describeKzBin_(bin) || '', ''];
  if (!data) {
    lines.push('⚠️ Данные из реестров получить не удалось.',
               'Проверьте вручную: kgd.gov.kz → Поиск налогоплательщика');
  } else {
    lines.push('Источник:     ' + data.sourceName,
               'Наименование: ' + (data.name || '—'),
               'Руководитель: ' + (data.director || '—'),
               'Адрес:        ' + (data.address || '—'),
               'Статус:       ' + (data.status || '—'),
               'ОКЭД:         ' + (data.okedName || '—'),
               'Регистрация:  ' + (data.regDate || '—'));
  }
  ui.alert('Проверка БИН ' + bin, lines.join('\n'), ui.ButtonSet.OK);
}

/**
 * Пробная сборка договора на выдуманных данных. Проверяет самое хрупкое:
 * что все плейсхолдеры шаблона умеют заполняться. Документ сразу удаляется.
 */
function menuDryRun() {
  var ui = SpreadsheetApp.getUi();
  try {
    var partner = emptyPartner_({
      COUNTRY: 'Kazakhstan',
      PARTNER_NAME: 'ТОО «Тестовая компания»',
      BIN: '190440019884',
      DIRECTOR: 'Тестов Тест Тестович',
      ADDRESS: '050000, Республика Казахстан, г. Алматы, ул. Тестовая, 1',
      _confidence: 'high'
    });
    var fill = buildFillData_('Kazakhstan', partner, 'ТЕСТ-0000');
    var out = generateContract_('Kazakhstan', fill, partner, 'ТЕСТ-0000');

    DriveApp.getFileById(out.docId).setTrashed(true);
    DriveApp.getFileById(out.pdfId).setTrashed(true);

    ui.alert('✅ Шаблон исправен',
      'Пробный договор собрался без единого пустого места.\n' +
      'Файлы удалены — это была только проверка.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ Проблема с шаблоном', humanizeError_(e.code, e.message), ui.ButtonSet.OK);
  }
}
