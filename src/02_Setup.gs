/**************************************************************************************
 * Dereknet CLM — 02_Setup
 * ---------------------------------------------------------------------------------
 * Мастер установки и диагностика.
 *
 * `setupWizard()` создаёт ВСЮ инфраструктуру с нуля и записывает ID в Script Properties:
 *   Dereknet CLM/
 *   ├── 1. Входящие          ← сюда бухгалтер кладёт файлы (или использует веб-форму)
 *   ├── 2. В работе          ← служебная, файл здесь = обрабатывается прямо сейчас
 *   ├── 3. Готово            ← исходники успешно обработанных заявок
 *   ├── 4. Требует проверки  ← карантин: что-то пошло не так, нужен человек
 *   ├── 5. Договоры          ← готовые Google Docs + PDF
 *   └── 6. Шаблоны           ← шаблоны NDA и картинка подписи
 *
 * Мастер идемпотентен: повторный запуск не создаёт дубликаты, а переиспользует
 * то, что уже записано в свойствах и реально существует.
 *
 * ЗАЧЕМ ЭТО НУЖНО: при переносе системы на аккаунт dereknet.com достаточно
 * скопировать код и нажать одну кнопку — ни одного ID руками менять не придётся.
 **************************************************************************************/

var FOLDER_LAYOUT = [
  { prop: PROP.INBOX_FOLDER_ID,    name: '1. Входящие' },
  { prop: PROP.PROC_FOLDER_ID,     name: '2. В работе' },
  { prop: PROP.DONE_FOLDER_ID,     name: '3. Готово' },
  { prop: PROP.REVIEW_FOLDER_ID,   name: '4. Требует проверки' },
  { prop: PROP.OUTPUT_FOLDER_ID,   name: '5. Договоры' },
  { prop: PROP.TEMPLATE_FOLDER_ID, name: '6. Шаблоны' }
];

/**
 * Главная точка входа установки. Запускается из меню или вручную из редактора.
 * @param {string=} rootFolderId  ID существующей папки (например, на Общем диске).
 *                                Если не указан — создаётся папка «Dereknet CLM» в Моём диске.
 */
function setupWizard(rootFolderId) {
  var report = [];

  // ВАЖНО: каждый созданный объект записывается в настройки СРАЗУ, а не пачкой
  // в конце. Иначе прерванный запуск (обрыв на экране авторизации, ошибка прав)
  // оставляет созданную папку «сиротой»: ID нигде не сохранён, и следующий
  // запуск создаёт вторую папку с тем же именем. Так и появлялись дубли.

  // ── 1. Корневая папка ───────────────────────────────────────────────────────
  var root = resolveOrCreateRoot_(rootFolderId, report);
  setProp_(PROP.ROOT_FOLDER_ID, root.getId());

  // ── 2. Рабочие папки ────────────────────────────────────────────────────────
  FOLDER_LAYOUT.forEach(function (spec) {
    var f = resolveOrCreateChildFolder_(root, prop_(spec.prop), spec.name, report);
    setProp_(spec.prop, f.getId());
  });

  // ── 3. Журнал (Google Таблица) ──────────────────────────────────────────────
  setProp_(PROP.LOG_SHEET_ID,
           resolveOrCreateLogSheet_(root, prop_(PROP.LOG_SHEET_ID), report));

  // ── 4. Email ответственного ─────────────────────────────────────────────────
  if (!prop_(PROP.MANAGER_EMAIL)) {
    var me = safeActiveEmail_();
    if (me) {
      setProp_(PROP.MANAGER_EMAIL, me);
      report.push('✅ Email для уведомлений: ' + me + ' (можно изменить в настройках)');
    } else {
      report.push('⚠️ Не удалось определить email — задайте MANAGER_EMAIL вручную');
    }
  }

  setProp_(PROP.SETUP_VERSION, SETUP_VERSION);

  // ── 5. Журнал: создать листы и справочник ошибок ────────────────────────────
  ensureLogSheets_();
  report.push('✅ Листы журнала готовы');

  // ── 6. Триггеры ─────────────────────────────────────────────────────────────
  installTriggers();
  report.push('✅ Автозапуск включён (проверка входящих каждые 5 минут)');

  // ── 7. Что ещё нужно сделать руками ─────────────────────────────────────────
  var todo = pendingManualSteps_();
  var text = report.join('\n') +
    (todo.length ? '\n\n📋 ОСТАЛОСЬ СДЕЛАТЬ ВРУЧНУЮ:\n' + todo.join('\n') : '\n\n🎉 Всё готово к работе!');

  Logger.log(text);
  uiAlert_('Мастер установки', text);
  return text;
}

/** Шаги, которые невозможно автоматизировать (загрузка шаблона, ключ OpenAI). */
function pendingManualSteps_() {
  var todo = [];
  if (!prop_(PROP.OPENAI_API_KEY)) {
    todo.push('• Указать ключ OpenAI: меню «CLM» → «🛠 Установка и проверка» → «Указать ключ OpenAI»');
  }
  if (!prop_(PROP.KZ_TEMPLATE_ID)) {
    todo.push('• Загрузить шаблон NDA (Казахстан) в папку «6. Шаблоны» как Google Документ,\n' +
              '  затем меню «CLM» → «🛠 Установка и проверка» → «Найти шаблоны и подпись»');
  }
  if (!prop_(PROP.SIGNATURE_FILE_ID)) {
    todo.push('• Положить PNG с подписью директора в папку «6. Шаблоны» и нажать\n' +
              '  «Найти шаблоны и подпись» (без неё в договоре будет прочерк «______»)');
  }
  return todo;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  СОЗДАНИЕ ОБЪЕКТОВ
// ═══════════════════════════════════════════════════════════════════════════════════

var ROOT_FOLDER_NAME = 'Dereknet CLM';

function resolveOrCreateRoot_(explicitId, report) {
  var id = explicitId || prop_(PROP.ROOT_FOLDER_ID);
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      report.push('✅ Корневая папка: ' + existing.getName() + ' (уже существует)');
      return existing;
    } catch (e) {
      report.push('⚠️ Прежняя корневая папка недоступна — ищу другую');
    }
  }

  // Прежде чем создавать новую — поискать по имени. Защита от дублей, если
  // предыдущий запуск оборвался до записи ID (см. комментарий в setupWizard).
  var candidates = [];
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  while (it.hasNext() && candidates.length < 10) candidates.push(it.next());

  if (candidates.length === 1) {
    report.push('✅ Найдена существующая папка «' + ROOT_FOLDER_NAME + '» — использую её');
    return candidates[0];
  }

  if (candidates.length > 1) {
    // Берём ту, где уже есть рабочие подпапки; при равенстве — самую старую.
    var best = candidates.filter(hasWorkSubfolders_)[0] ||
               candidates.sort(function (a, b) {
                 return a.getDateCreated().getTime() - b.getDateCreated().getTime();
               })[0];
    report.push('⚠️ В Диске несколько папок «' + ROOT_FOLDER_NAME + '» (' + candidates.length + ' шт.). ' +
                'Использую ту, где есть рабочие подпапки. Лишние можно удалить вручную — ' +
                'в них ничего нет.');
    return best;
  }

  var root = DriveApp.createFolder(ROOT_FOLDER_NAME);
  report.push('✅ Создана корневая папка «' + ROOT_FOLDER_NAME + '»');
  return root;
}

/** Похожа ли папка на рабочий корень CLM: есть ли внутри «1. Входящие». */
function hasWorkSubfolders_(folder) {
  try { return folder.getFoldersByName(FOLDER_LAYOUT[0].name).hasNext(); }
  catch (e) { return false; }
}

function resolveOrCreateChildFolder_(root, existingId, name, report) {
  if (existingId) {
    try {
      var f = DriveApp.getFolderById(existingId);
      report.push('✅ Папка «' + name + '» — на месте');
      return f;
    } catch (e) { /* пересоздадим ниже */ }
  }
  var it = root.getFoldersByName(name);
  if (it.hasNext()) {
    var found = it.next();
    report.push('✅ Папка «' + name + '» — найдена в Drive');
    return found;
  }
  var created = root.createFolder(name);
  report.push('✅ Создана папка «' + name + '»');
  return created;
}

function resolveOrCreateLogSheet_(root, existingId, report) {
  if (existingId) {
    try {
      SpreadsheetApp.openById(existingId);
      report.push('✅ Журнал — на месте');
      return existingId;
    } catch (e) { /* пересоздадим */ }
  }

  // Если скрипт привязан к таблице (обычный случай: Расширения → Apps Script
  // или `clasp create --type sheets`) — журналом становится она сама.
  // Отдельная вторая таблица только запутала бы: меню в одной, данные в другой.
  var bound = null;
  try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* standalone */ }
  if (bound) {
    report.push('✅ Журнал — эта же таблица «' + bound.getName() + '»');
    try {
      var boundFile = DriveApp.getFileById(bound.getId());
      if (!isChildOf_(boundFile, root)) {
        boundFile.moveTo(root);
        report.push('✅ Таблица перемещена в папку CLM');
      }
    } catch (e) {
      report.push('⚠️ Таблицу не удалось переместить в папку CLM — она останется там, где лежит');
    }
    return bound.getId();
  }

  var ss = SpreadsheetApp.create('Dereknet CLM — Журнал');
  DriveApp.getFileById(ss.getId()).moveTo(root);
  report.push('✅ Создан журнал «Dereknet CLM — Журнал»');
  return ss.getId();
}

function isChildOf_(file, folder) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) return true;
  }
  return false;
}

/**
 * Автопоиск шаблонов и подписи в папке «6. Шаблоны».
 * Правила именования (регистр не важен):
 *   • имя содержит "KZ" или "Казахстан"  → шаблон Казахстана
 *   • имя содержит "US" или "USA"        → шаблон США
 *   • картинка PNG/JPG/GIF               → подпись директора
 */
function discoverTemplates() {
  var folderId = prop_(PROP.TEMPLATE_FOLDER_ID, { required: true });
  var folder = DriveApp.getFolderById(folderId);
  var found = {};
  var report = [];

  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    var upper = name.toUpperCase();
    var mime = f.getMimeType();

    if (mime === MimeType.GOOGLE_DOCS) {
      if (/\bUS\b|\bUSA\b|АМЕРИК/i.test(upper)) {
        found[PROP.US_TEMPLATE_ID] = f.getId();
        report.push('✅ Шаблон США: ' + name);
      } else {
        found[PROP.KZ_TEMPLATE_ID] = f.getId();
        report.push('✅ Шаблон Казахстана: ' + name);
      }
    } else if (CFG.IMAGE_SIG_MIMES.indexOf(mime) !== -1) {
      found[PROP.SIGNATURE_FILE_ID] = f.getId();
      report.push('✅ Подпись директора: ' + name);
    } else if (mime === MimeType.MICROSOFT_WORD || /\.docx?$/i.test(name)) {
      report.push('⚠️ «' + name + '» — это файл Word. Откройте его и сохраните как ' +
                  'Google Документ (Файл → Сохранить как Google Документ), иначе скрипт его не увидит.');
    }
  }

  if (Object.keys(found).length) setProps_(found);

  if (!report.length) {
    report.push('❌ В папке «6. Шаблоны» ничего подходящего не найдено.\n' +
                'Положите туда шаблон NDA в формате Google Документа и PNG с подписью.');
  }
  var text = report.join('\n');
  Logger.log(text);
  uiAlert_('Поиск шаблонов', text);
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ДИАГНОСТИКА
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Полная проверка «здоровья» системы. Всё, что может сломаться, проверяется здесь,
 * и каждая ошибка сопровождается инструкцией «что нажать, чтобы починить».
 */
function healthCheck() {
  var lines = ['🩺 ПРОВЕРКА СИСТЕМЫ DEREKNET CLM', ''];
  var problems = 0;

  function ok(msg)   { lines.push('✅ ' + msg); }
  function bad(msg, fix) { lines.push('❌ ' + msg + (fix ? '\n   → ' + fix : '')); problems++; }
  function warn(msg, fix) { lines.push('⚠️ ' + msg + (fix ? '\n   → ' + fix : '')); }

  // Папки
  lines.push('— Папки —');
  FOLDER_LAYOUT.forEach(function (spec) {
    var id = prop_(spec.prop);
    if (!id) return bad('Папка «' + spec.name + '» не настроена', 'Запустите мастер установки');
    try {
      DriveApp.getFolderById(id);
      ok('Папка «' + spec.name + '»');
    } catch (e) {
      bad('Папка «' + spec.name + '» недоступна (удалена или нет прав)', 'Запустите мастер установки');
    }
  });

  // Дубли корневой папки — след прерванной установки
  try {
    var dupes = [];
    var dupIt = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
    while (dupIt.hasNext() && dupes.length < 10) dupes.push(dupIt.next());
    if (dupes.length > 1) {
      var liveRootId = prop_(PROP.ROOT_FOLDER_ID);
      var extra = dupes.filter(function (f) { return f.getId() !== liveRootId; })
                       .map(function (f) { return f.getUrl(); });
      warn('В Диске ' + dupes.length + ' папки с именем «' + ROOT_FOLDER_NAME + '»',
           'Рабочая — та, что используется системой. Лишние можно удалить, в них ничего нет:\n     ' +
           extra.join('\n     '));
    }
  } catch (e) { /* не критично */ }

  // Журнал
  lines.push('', '— Журнал —');
  try {
    SpreadsheetApp.openById(prop_(PROP.LOG_SHEET_ID, { required: true }));
    ok('Журнал открывается');
  } catch (e) {
    bad('Журнал недоступен: ' + e.message, 'Запустите мастер установки');
  }

  // Шаблоны
  lines.push('', '— Шаблоны —');
  var kzId = prop_(PROP.KZ_TEMPLATE_ID);
  if (!kzId) {
    bad('Шаблон Казахстана не задан', 'Меню «CLM» → «Найти шаблоны и подпись»');
  } else {
    try {
      var doc = DocumentApp.openById(kzId);
      var scan = scanTemplateTokens_(doc);
      ok('Шаблон Казахстана: ' + doc.getName() + ' (' + scan.tokens.length + ' плейсхолдеров)');
      var unknown = scan.tokens.filter(function (t) { return KNOWN_TOKENS.indexOf(t) === -1; });
      if (unknown.length) {
        warn('В шаблоне есть незнакомые плейсхолдеры: ' + unknown.join(', '),
             'Скрипт не сможет их заполнить — исправьте шаблон или добавьте поля в 06_Render.gs');
      }
      var missing = REQUIRED_KZ_TOKENS.filter(function (t) { return scan.tokens.indexOf(t) === -1; });
      if (missing.length) {
        warn('В шаблоне НЕТ обязательных плейсхолдеров: ' + missing.join(', '),
             'Договор получится неполным. Добавьте их в шаблон.');
      }
      var defects = templateIssues_(doc);
      if (defects.length) {
        bad('В шаблоне ' + defects.length + ' известных дефекта(ов): ' +
            defects.map(function (p) { return p.what; }).join('; '),
            'Меню «CLM» → «🛠» → «🔧 Исправить шаблон»');
      }
    } catch (e) {
      bad('Шаблон Казахстана не открывается: ' + e.message,
          'Убедитесь, что это Google Документ, а не файл .docx');
    }
  }

  var usId = prop_(PROP.US_TEMPLATE_ID);
  if (!usId) {
    warn('Шаблон США не задан', 'Американские заявки будут уходить в «Требует проверки». ' +
         'Это нормально, если США пока не нужны.');
  } else {
    try { DocumentApp.openById(usId); ok('Шаблон США на месте'); }
    catch (e) { bad('Шаблон США не открывается: ' + e.message); }
  }

  // Подпись
  lines.push('', '— Подпись директора —');
  var sigId = prop_(PROP.SIGNATURE_FILE_ID);
  if (!sigId) {
    warn('Подпись не задана', 'В договорах будет прочерк «______» вместо подписи');
  } else {
    try {
      var sf = DriveApp.getFileById(sigId);
      if (CFG.IMAGE_SIG_MIMES.indexOf(sf.getMimeType()) === -1) {
        bad('Файл подписи не картинка (' + sf.getMimeType() + ')', 'Нужен PNG, JPEG или GIF');
      } else {
        ok('Подпись: ' + sf.getName());
      }
    } catch (e) { bad('Файл подписи недоступен: ' + e.message); }
  }

  // Внешние сервисы
  lines.push('', '— Внешние сервисы —');
  prop_(PROP.OPENAI_API_KEY)
    ? ok('Ключ OpenAI задан')
    : bad('Ключ OpenAI не задан', 'Меню «CLM» → «Указать ключ OpenAI». Без него распознавание не работает.');

  try {
    if (typeof Drive !== 'undefined' && Drive.Files) ok('Drive API подключён (нужен для распознавания PDF)');
    else bad('Drive API не подключён', 'Редактор скрипта → Службы (+) → Drive API → Добавить');
  } catch (e) {
    bad('Drive API не подключён', 'Редактор скрипта → Службы (+) → Drive API → Добавить');
  }

  // Триггеры
  lines.push('', '— Автозапуск —');
  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  handlers.indexOf('processInbox') !== -1
    ? ok('Автообработка входящих включена')
    : bad('Автообработка выключена', 'Меню «CLM» → «Включить автозапуск»');

  // Почта
  lines.push('', '— Уведомления —');
  var mgr = prop_(PROP.MANAGER_EMAIL);
  mgr ? ok('Уведомления уходят на ' + mgr)
      : warn('Email ответственного не задан', 'Никто не узнает о проблемах. Задайте MANAGER_EMAIL.');
  try {
    ok('Остаток писем на сегодня: ' + MailApp.getRemainingDailyQuota());
  } catch (e) { /* не критично */ }

  lines.push('', problems === 0
    ? '🎉 Проблем не найдено — система готова к работе.'
    : '⚠️ Найдено проблем: ' + problems + '. Исправьте пункты с ❌.');

  var text = lines.join('\n');
  Logger.log(text);
  uiAlert_('Проверка системы', text);
  return text;
}

/** Собрать все {{ПЛЕЙСХОЛДЕРЫ}} из документа, включая колонтитулы. */
function scanTemplateTokens_(doc) {
  var text = '';
  text += doc.getBody().getText();
  var h = doc.getHeader(); if (h) text += '\n' + h.getText();
  var f = doc.getFooter(); if (f) text += '\n' + f.getText();
  return { tokens: extractTokens_(text) };
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ТРИГГЕРЫ
// ═══════════════════════════════════════════════════════════════════════════════════

function installTriggers() {
  var managed = ['processInbox', 'cleanupStuckFiles', 'dailyDigest'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (managed.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  // Раз в 5 минут вместо раза в минуту: 288 запусков в сутки вместо 1440.
  // Экономит суточную квоту времени выполнения примерно в пять раз,
  // а задержка в 5 минут для договоров несущественна.
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('cleanupStuckFiles').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().everyDays(1).atHour(9).create();
  Logger.log('✅ Триггеры установлены: processInbox (5 мин), cleanupStuckFiles (1 ч), dailyDigest (09:00)');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Все триггеры удалены.');
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  МЕЛОЧИ
// ═══════════════════════════════════════════════════════════════════════════════════

function safeActiveEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function uiAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* запущено не из таблицы — молча пропускаем */ }
}
