/**************************************************************************************
 *  Dereknet CLM v5.0 — СОБРАННЫЙ ФАЙЛ
 *  ---------------------------------------------------------------------------------
 *  ⚠️  НЕ РЕДАКТИРОВАТЬ ЗДЕСЬ. Это склейка 11 файлов из src/.
 *      Правки вносятся в src/, затем `npm run build` и повторная вставка.
 *
 *  Собрано: 2026-08-27
 *  Порядок файлов: 01_Config.gs, 02_Setup.gs, 03_Pure.gs, 04_Extract.gs, 05_Lookup.gs, 06_Render.gs, 07_Pipeline.gs, 08_Log.gs, 09_Notify.gs, 10_Menu.gs, 11_WebApp.gs
 **************************************************************************************/

// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 01_Config.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 01_Config
 * ---------------------------------------------------------------------------------
 * Единственное место, где живут настройки.
 *
 * ПРИНЦИП: в коде НЕТ ни одного ID папки, документа или таблицы.
 * Всё хранится в Script Properties и создаётся автоматически через `setupWizard()`
 * (см. 02_Setup.gs). Благодаря этому перенос системы на другой аккаунт Google
 * (например, с личного на корпоративный dereknet.com) не требует правки кода —
 * достаточно один раз запустить мастер установки.
 **************************************************************************************/

/** Ключи Script Properties. Менять нельзя — на них завязан мастер установки. */
var PROP = {
  ROOT_FOLDER_ID:    'ROOT_FOLDER_ID',
  INBOX_FOLDER_ID:   'INBOX_FOLDER_ID',
  PROC_FOLDER_ID:    'PROCESSING_FOLDER_ID',
  DONE_FOLDER_ID:    'DONE_FOLDER_ID',
  REVIEW_FOLDER_ID:  'REVIEW_FOLDER_ID',
  OUTPUT_FOLDER_ID:  'OUTPUT_FOLDER_ID',
  TEMPLATE_FOLDER_ID:'TEMPLATE_FOLDER_ID',
  LOG_SHEET_ID:      'LOG_SHEET_ID',
  KZ_TEMPLATE_ID:    'KZ_TEMPLATE_ID',
  US_TEMPLATE_ID:    'US_TEMPLATE_ID',
  SIGNATURE_FILE_ID: 'SIGNATURE_FILE_ID',
  OPENAI_API_KEY:    'OPENAI_API_KEY',
  MANAGER_EMAIL:     'MANAGER_EMAIL',
  LEGAL_EMAIL:       'LEGAL_EMAIL',
  REGISTER_SEQ:      'REGISTER_SEQ',
  SETUP_VERSION:     'SETUP_VERSION'
};

/** Версия схемы установки. Увеличивается, когда мастер начинает создавать что-то новое. */
var SETUP_VERSION = '5.0';

/** Названия листов в журнале. */
var SHEET = {
  LOG:      'Журнал',
  REGISTER: 'Реестр договоров',
  ERRORS:   'Справочник ошибок'
};

/** Неизменяемые технические параметры. */
var CFG = {
  SHEET_LOG:            SHEET.LOG,
  SHEET_REGISTER:       SHEET.REGISTER,

  MAX_FILES_PER_RUN:    5,
  TIME_BUDGET_MS:       4 * 60 * 1000,   // Workspace даёт 30 мин; берём 4 мин с запасом
  LOCK_WAIT_MS:         30 * 1000,

  OCR_LANGUAGE:         'ru',

  OPENAI_MODEL:         'gpt-4o-mini',
  OPENAI_MAX_RETRIES:   3,
  OPENAI_MAX_TOKENS:    1200,            // было 500 — длинные адреса обрезались, JSON ломался
  OPENAI_TIMEOUT_NOTE:  'UrlFetchApp таймаут фиксированный (~60 c)',

  MIN_OCR_CHARS:        40,
  MIN_OCR_LETTERS:      20,
  IMAGE_DOWNSIZE_BYTES: 1.5 * 1024 * 1024,
  MAX_UPLOAD_BYTES:     20 * 1024 * 1024,

  DEDUP_HOURS:          24,
  BIN_CACHE_SECONDS:    6 * 60 * 60,
  STUCK_FILE_MINUTES:   60,

  SIGNATURE_MAX_WIDTH_PT: 200,

  VISION_ALLOWED_MIMES: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
  IMAGE_SIG_MIMES:      ['image/png', 'image/jpeg', 'image/gif'],

  /** Статусы контрагента, при которых договор НЕ генерируется автоматически. */
  BLOCKING_RISK_FLAGS: [
    'банкрот', 'лжепредприятие', 'недействительная регистрация',
    'бездействующий', 'отсутствует по адресу'
  ],

  /** Часовой пояс для дат в договорах. */
  TZ_KZ: 'Asia/Almaty',
  TZ_US: 'America/New_York',

  /** Юрисдикция по умолчанию для американских NDA. */
  US_STATE: 'New York'
};

// ═══════════════════════════════════════════════════════════════════════════════════
//  РЕКВИЗИТЫ DEREKNET — раскрывающая сторона (постоянные)
// ═══════════════════════════════════════════════════════════════════════════════════
var DEREKNET = {
  NAME_RU:             'ТОО «Dereknet»',
  NAME_EN:             'Dereknet LLP',
  BIN:                 '190440019884',
  CITY_RU:             'Атырау',
  CITY_EN:             'Atyrau',
  ADDR_RU:             '060016, Республика Казахстан, г. Атырау, ул. Сатпаева 23А',
  ADDR_EN:             '060016, Republic of Kazakhstan, Atyrau, 23A Satpayev Street',
  PHONE:               '+7 702 672 45 07',
  EMAIL:               'office@dereknet.com',
  IIK:                 'KZ41601A141000897321',
  BIK:                 'HSBKKZKX',
  BANK_RU:             'АО «Народный банк Казахстана»',
  BANK_EN:             'JSC Halyk Bank',

  // Именительный падеж — блок подписей («Директор / Кабдулов С.Ш.»)
  REP_POSITION_RU:     'Директор',
  REP_POSITION_EN:     'Director',
  REP_NAME_RU:         'Кабдулов Саламат Шамарданович',
  REP_NAME_EN:         'Salamat Kabdulov',

  // Родительный падеж — преамбула («в лице Директора Кабдулова…»)
  REP_POSITION_RU_GEN: 'Директора',
  REP_NAME_RU_GEN:     'Кабдулова Саламата Шамардановича',

  BASIS_RU:            'Устава',
  BASIS_EN:            'Charter'
};

// ═══════════════════════════════════════════════════════════════════════════════════
//  ДОСТУП К НАСТРОЙКАМ
// ═══════════════════════════════════════════════════════════════════════════════════

var _propsCache = null;

/** Все Script Properties одним вызовом (кэш на время выполнения). */
function allProps_() {
  if (!_propsCache) _propsCache = PropertiesService.getScriptProperties().getProperties();
  return _propsCache;
}

/** Сбросить кэш настроек (после setupWizard / изменения свойств). */
function resetPropsCache_() { _propsCache = null; }

/**
 * Прочитать настройку. Если она обязательна и отсутствует — понятная ошибка,
 * а не «Cannot read property of null» через десять кадров стека.
 */
function prop_(key, opts) {
  opts = opts || {};
  var v = allProps_()[key];
  if (v === undefined || v === null || String(v).trim() === '') {
    if (opts.required) {
      throw softError_('НЕ_НАСТРОЕНО',
        'Не задана настройка «' + key + '». Откройте таблицу CLM → меню «CLM» → ' +
        '«🛠 Установка и проверка» → «Запустить мастер установки».');
    }
    return opts.fallback === undefined ? '' : opts.fallback;
  }
  return String(v);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  resetPropsCache_();
}

function setProps_(obj) {
  PropertiesService.getScriptProperties().setProperties(obj, false);
  resetPropsCache_();
}

/** Ошибка с машинным кодом + человеческим текстом. */
function softError_(code, message) {
  var e = new Error(message);
  e.code = code;
  e.isSoft = true;
  return e;
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 02_Setup.gs
// ══════════════════════════════════════════════════════════════════════

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
  var created = {};

  // ── 1. Корневая папка ───────────────────────────────────────────────────────
  var root = resolveOrCreateRoot_(rootFolderId, report);
  created[PROP.ROOT_FOLDER_ID] = root.getId();

  // ── 2. Рабочие папки ────────────────────────────────────────────────────────
  FOLDER_LAYOUT.forEach(function (spec) {
    var f = resolveOrCreateChildFolder_(root, prop_(spec.prop), spec.name, report);
    created[spec.prop] = f.getId();
  });

  // ── 3. Журнал (Google Таблица) ──────────────────────────────────────────────
  var sheetId = resolveOrCreateLogSheet_(root, prop_(PROP.LOG_SHEET_ID), report);
  created[PROP.LOG_SHEET_ID] = sheetId;

  // ── 4. Email ответственного ─────────────────────────────────────────────────
  if (!prop_(PROP.MANAGER_EMAIL)) {
    var me = safeActiveEmail_();
    if (me) {
      created[PROP.MANAGER_EMAIL] = me;
      report.push('✅ Email для уведомлений: ' + me + ' (можно изменить в настройках)');
    } else {
      report.push('⚠️ Не удалось определить email — задайте MANAGER_EMAIL вручную');
    }
  }

  created[PROP.SETUP_VERSION] = SETUP_VERSION;
  setProps_(created);

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

function resolveOrCreateRoot_(explicitId, report) {
  var id = explicitId || prop_(PROP.ROOT_FOLDER_ID);
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      report.push('✅ Корневая папка: ' + existing.getName() + ' (уже существует)');
      return existing;
    } catch (e) {
      report.push('⚠️ Прежняя корневая папка недоступна — создаю новую');
    }
  }
  var root = DriveApp.createFolder('Dereknet CLM');
  report.push('✅ Создана корневая папка «Dereknet CLM»');
  return root;
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


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 03_Pure.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 03_Pure
 * ---------------------------------------------------------------------------------
 * Чистые функции: никакого Drive, Docs, сети или глобального состояния.
 * Именно поэтому их можно прогнать локально через Node (см. tests/pure.test.js)
 * и быть уверенным, что логика работает ДО заливки в Google.
 **************************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════════
//  БИН / ИИН — контрольная сумма
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Проверка контрольного разряда БИН/ИИН РК.
 *
 * Алгоритм (приказ по формированию ИИН/БИН):
 *   к = (Σ aᵢ·wᵢ) mod 11, где w = [1..11]
 *   если к = 10 — пересчёт с w = [3,4,5,6,7,8,9,10,11,1,2]
 *   если к снова 10 — номер недействителен
 *   иначе к должен совпасть с 12-й цифрой
 *
 * ЗАЧЕМ: OpenAI распознаёт БИН с картинки и может перепутать 8/В, 0/О, 1/7.
 * Одна неверная цифра — и договор уйдёт контрагенту с чужим налоговым номером.
 * Контрольная сумма ловит такую ошибку мгновенно и без обращения к интернету.
 */
function isValidKzBin_(value) {
  var s = String(value || '').replace(/\D/g, '');
  if (!/^\d{12}$/.test(s)) return false;

  var d = s.split('').map(Number);
  var w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  var w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

  function control(weights) {
    var sum = 0;
    for (var i = 0; i < 11; i++) sum += d[i] * weights[i];
    return sum % 11;
  }

  var c = control(w1);
  if (c === 10) {
    c = control(w2);
    if (c === 10) return false;
  }
  return c === d[11];
}

/**
 * Дополнительная смысловая проверка БИН юридического лица.
 * Разряды 1-2 — год, 3-4 — месяц регистрации, 5-й — тип (4/5/6), 6-й — признак (0-3).
 * Возвращает описание или '' если структура неправдоподобна.
 */
function describeKzBin_(value) {
  var s = String(value || '').replace(/\D/g, '');
  if (!/^\d{12}$/.test(s)) return '';
  var month = parseInt(s.substr(2, 2), 10);
  if (month < 1 || month > 12) return '';
  var typeMap = { '4': 'юр. лицо-резидент', '5': 'юр. лицо-нерезидент', '6': 'ИП / совместная деятельность' };
  var attrMap = { '0': 'головная организация', '1': 'филиал', '2': 'представительство', '3': 'крестьянское хозяйство' };
  var type = typeMap[s.charAt(4)];
  if (!type) return '';
  var attr = attrMap[s.charAt(5)] || '';
  return type + (attr ? ', ' + attr : '');
}

/** Привести БИН к 12 цифрам, восстановив утраченные ведущие нули. */
function normalizeBin_(value) {
  var s = String(value || '').replace(/\D/g, '');
  if (s.length >= 8 && s.length < 12) s = ('000000000000' + s).slice(-12);
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ПЛЕЙСХОЛДЕРЫ
// ═══════════════════════════════════════════════════════════════════════════════════

/** Все {{TOKEN}} из текста, без дубликатов, в порядке появления. */
function extractTokens_(text) {
  var out = [];
  var re = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;
  var m;
  while ((m = re.exec(String(text || ''))) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out;
}

/** Плейсхолдеры, которые обязаны быть в шаблоне Казахстана. */
var REQUIRED_KZ_TOKENS = [
  'AGREEMENT_NUMBER', 'DATE_DAY', 'DATE_MONTH_RU', 'DATE_YEAR',
  'DISCLOSING_PARTY_NAME_RU', 'DISCLOSING_PARTY_ADDRESS_RU',
  'RECEIVING_PARTY_NAME', 'RECEIVING_PARTY_TAX_ID', 'RECEIVING_PARTY_ADDRESS'
];

/** Полный словарь плейсхолдеров, которые умеет заполнять 06_Render.gs. */
var KNOWN_TOKENS = [
  // общие
  'AGREEMENT_NUMBER', 'DATE_DAY', 'DATE_MONTH_RU', 'DATE_MONTH_EN', 'DATE_YEAR', 'DATE',
  'CITY', 'SIGNATURE_BOSS',
  // раскрывающая сторона
  'DISCLOSING_PARTY_NAME_RU', 'DISCLOSING_PARTY_NAME_EN',
  'DISCLOSING_PARTY_ADDRESS_RU', 'DISCLOSING_PARTY_ADDRESS_EN',
  'DISCLOSING_PARTY_BANK_DETAILS_RU', 'DISCLOSING_PARTY_BANK_DETAILS_EN',
  'DISCLOSING_PARTY_TAX_ID',
  'DISCLOSING_PARTY_REP_POSITION_RU', 'DISCLOSING_PARTY_REP_POSITION_EN',
  'DISCLOSING_PARTY_REP_NAME_RU', 'DISCLOSING_PARTY_REP_NAME_EN',
  'DISCLOSING_PARTY_REP_POSITION_RU_GEN', 'DISCLOSING_PARTY_REP_NAME_RU_GEN',
  'DISCLOSING_PARTY_BASIS_RU', 'DISCLOSING_PARTY_BASIS_EN',
  'APPENDIX_COMPANY_NAME_RU', 'APPENDIX_COMPANY_NAME_EN',
  // получающая сторона
  'RECEIVING_PARTY_NAME', 'RECEIVING_PARTY_NAME_EN',
  'RECEIVING_PARTY_TAX_ID', 'RECEIVING_PARTY_TAX_ID_EN',
  'RECEIVING_PARTY_ADDRESS', 'RECEIVING_PARTY_ADDRESS_EN',
  'RECEIVING_PARTY_LEGAL_FORM_RU', 'RECEIVING_PARTY_LEGAL_FORM_EN',
  'RECEIVING_PARTY_JURISDICTION_RU', 'RECEIVING_PARTY_JURISDICTION_EN',
  'RECEIVING_PARTY_REG_AGREEMENT_RU',
  'RECEIVING_PARTY_REP_POSITION_RU', 'RECEIVING_PARTY_REP_POSITION_EN',
  'RECEIVING_PARTY_REP_NAME_RU', 'RECEIVING_PARTY_REP_NAME_EN',
  'RECEIVING_PARTY_BASIS_RU', 'RECEIVING_PARTY_BASIS_EN',
  'RECEIVING_PARTY_SIGNATORY_RU', 'RECEIVING_PARTY_SIGNATORY_EN',
  'RECEIVING_PARTY_BANK_DETAILS_RU', 'RECEIVING_PARTY_BANK_DETAILS_EN',
  'CONF_INFO',
  // США
  'PARTY1_NAME', 'PARTY1_ADDRESS', 'PARTY1_PRINT',
  'PARTY2_NAME', 'PARTY2_ADDRESS', 'PARTY2_PRINT', 'PARTY2_BIN',
  'STATE', 'NDA_TYPE', 'PURPOSE', 'PURPOSE_OTHER_TEXT',
  'CHECK_UNILATERAL', 'CHECK_MUTUAL', 'CHECK_EMPLOYMENT', 'CHECK_CONTRACT_WORK',
  'CHECK_BUSINESS_PARTNERSHIP', 'CHECK_SALE_OF_A_BUSINESS', 'CHECK_OTHER'
];

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЯЗЫК И ПРАВОВЫЕ ФОРМЫ
// ═══════════════════════════════════════════════════════════════════════════════════

var TRANSLIT_MAP = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  'қ':'q','ң':'ng','ғ':'g','ү':'u','ұ':'u','ө':'o','ә':'a','і':'i','һ':'h'
};

/** Практическая транслитерация (казахские буквы поддержаны). */
function transliterateRuToEn_(s) {
  return String(s || '').split('').map(function (ch) {
    var lower = ch.toLowerCase();
    var tr = TRANSLIT_MAP[lower];
    if (tr === undefined) return ch;
    if (tr === '') return '';
    return ch === lower ? tr : tr.charAt(0).toUpperCase() + tr.slice(1);
  }).join('');
}

/**
 * ⚠️ КРИТИЧНО. В JavaScript `\b` определён через `\w` = [A-Za-z0-9_],
 * то есть КИРИЛЛИЦА в него не входит. Поэтому регулярка вида /^ТОО\b/
 * НИКОГДА не срабатывает: между «О» и пробелом нет границы слова
 * (оба символа — не-\w). Именно из-за этого версии 4.x подставляли
 * в каждый казахстанский договор «юридическое лицо» вместо
 * «товарищество с ограниченной ответственностью».
 *
 * Правильная граница — явный отрицательный просмотр вперёд по всем
 * буквам, которые могут встретиться в названии.
 */
var WORD_END = '(?![A-Za-z0-9А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәі])';

/** Название начинается с указанной аббревиатуры как отдельного слова. */
function startsWithForm_(upperName, abbr) {
  return new RegExp('^' + abbr + WORD_END).test(upperName);
}

/** Аббревиатура встречается как отдельное слово в любом месте названия. */
function containsForm_(upperName, abbr) {
  return new RegExp('(^|[^A-Za-z0-9А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәі])' + abbr + WORD_END)
    .test(upperName);
}

function inferLegalFormRu_(name) {
  var n = String(name || '').toUpperCase().trim();
  if (startsWithForm_(n, 'ТОО') || /^ТОВАРИЩЕСТВО/.test(n))  return 'товарищество с ограниченной ответственностью';
  if (startsWithForm_(n, 'АО')  || /^АКЦИОНЕРНОЕ/.test(n))   return 'акционерное общество';
  if (startsWithForm_(n, 'ИП')  || /^ИНДИВИДУАЛЬНЫЙ/.test(n))return 'индивидуальный предприниматель';
  if (startsWithForm_(n, 'ГУ') || startsWithForm_(n, 'ГККП') || startsWithForm_(n, 'РГП'))
    return 'государственное учреждение';
  if (containsForm_(n, 'LLC'))                               return 'компания с ограниченной ответственностью';
  if (containsForm_(n, 'INC') || containsForm_(n, 'CORP'))   return 'корпорация';
  if (containsForm_(n, 'LTD') || containsForm_(n, 'LLP'))    return 'компания с ограниченной ответственностью';
  return 'юридическое лицо';
}

function inferLegalFormEn_(name) {
  var n = String(name || '').toUpperCase().trim();
  if (startsWithForm_(n, 'ТОО') || /^ТОВАРИЩЕСТВО/.test(n))  return 'a limited liability partnership';
  if (startsWithForm_(n, 'АО')  || /^АКЦИОНЕРНОЕ/.test(n))   return 'a joint-stock company';
  if (startsWithForm_(n, 'ИП')  || /^ИНДИВИДУАЛЬНЫЙ/.test(n))return 'an individual entrepreneur';
  if (startsWithForm_(n, 'ГУ') || startsWithForm_(n, 'ГККП') || startsWithForm_(n, 'РГП'))
    return 'a state institution';
  if (containsForm_(n, 'LLC'))                               return 'a limited liability company';
  if (containsForm_(n, 'INC') || containsForm_(n, 'CORP'))   return 'a corporation';
  if (containsForm_(n, 'LTD') || containsForm_(n, 'LLP'))    return 'a limited company';
  return 'a legal entity';
}

/**
 * Согласование причастия «зарегистрирован*» с правовой формой.
 * ТОО = товарищество (ср. род) → зарегистрированное
 * АО  = общество     (ср. род) → зарегистрированное
 * ИП  = предприниматель (м. р.) → зарегистрированный
 * компания / LLC (ж. р.)        → зарегистрированная
 */
function inferRegAgreementRu_(name) {
  var n = String(name || '').toUpperCase().trim();
  var neuter = ['ТОО', 'АО', 'ООО', 'ЗАО', 'ПАО', 'ОАО', 'ГУ', 'ГККП', 'РГП'];
  for (var i = 0; i < neuter.length; i++) {
    if (startsWithForm_(n, neuter[i])) return 'зарегистрированное';
  }
  if (/ТОВАРИЩЕСТВО|ОБЩЕСТВО|УЧРЕЖДЕНИЕ|ПРЕДПРИЯТИЕ/.test(n)) return 'зарегистрированное';
  if (startsWithForm_(n, 'ИП') || /ПРЕДПРИНИМАТЕЛЬ/.test(n))   return 'зарегистрированный';
  return 'зарегистрированная';
}

/** Должность подписанта контрагента в РОДИТЕЛЬНОМ падеже — для оборота «в лице …». */
function inferRepPositionRu_(name) {
  var n = String(name || '').toUpperCase().trim();
  if (startsWithForm_(n, 'АО')) return 'Председателя Правления';
  if (startsWithForm_(n, 'ИП')) return 'Индивидуального предпринимателя';
  return 'Директора';
}

function inferRepPositionEn_(name) {
  var n = String(name || '').toUpperCase().trim();
  if (startsWithForm_(n, 'АО')) return 'Chairman of the Management Board';
  if (startsWithForm_(n, 'ИП')) return 'Individual Entrepreneur';
  return 'Director';
}

/**
 * Безопасное имя файла: сохраняет казахские буквы (қ ң ғ ү ұ ө ә і),
 * которые старая версия вырезала — «ТОО Қазақстан» превращалось в «ТОО азастан».
 */
function safeFileName_(name, maxLen) {
  var cleaned = String(name || 'partner')
    .replace(/[^\wа-яА-ЯёЁқңғүұөәіҚҢҒҮҰӨӘІ0-9 \-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '_');
  return (cleaned || 'partner').slice(0, maxLen || 40);
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  РАЗБОР ОТВЕТА МОДЕЛИ
// ═══════════════════════════════════════════════════════════════════════════════════

function parseJsonLoose_(s) {
  var t = String(s || '').trim();
  t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  var first = t.indexOf('{');
  var last  = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('JSON не найден в ответе модели: ' + t.slice(0, 120));
  }
  return JSON.parse(t.slice(first, last + 1));
}

function nonEmpty_(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЧЕЛОВЕЧЕСКИЕ ОШИБКИ
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Перевод технического кода ошибки в понятный бухгалтеру текст + конкретное действие.
 * Это ключевая вещь для пользователя без ИТ-опыта: он должен прочитать,
 * что случилось, и понять, что делать, без обращения к разработчику.
 */
var ERROR_HELP = {
  'НЕ_НАСТРОЕНО':       ['Система ещё не настроена.', 'Сообщите ответственному — нужно запустить мастер установки.'],
  'ПУСТОЙ_ФАЙЛ':        ['В файле не оказалось текста.', 'Проверьте, что файл не пустой и не защищён паролем.'],
  'ФОРМАТ':             ['Такой формат файла не поддерживается.', 'Пришлите PDF, JPG, PNG или Google Документ.'],
  'КАРТИНКА_ФОРМАТ':    ['Такой формат картинки не читается.', 'Пересохраните снимок в JPG или PNG (например, откройте в «Фотографиях» → «Сохранить как»).'],
  'ФАЙЛ_СЛИШКОМ_БОЛЬШОЙ':['Файл больше 20 МБ.', 'Сожмите PDF или сделайте снимок меньшего размера.'],
  'РАСПОЗНАВАНИЕ':      ['Не удалось распознать текст на документе.', 'Сфотографируйте документ ровно, при хорошем свете, целиком в кадре.'],
  'МАЛО_ТЕКСТА':        ['На документе слишком мало текста.', 'Убедитесь, что видны название компании, БИН и адрес.'],
  'НЕТ_КЛЮЧА':          ['Не настроен доступ к сервису распознавания.', 'Сообщите ответственному за систему.'],
  'ОТВЕТ_МОДЕЛИ':       ['Сервис распознавания вернул непонятный ответ.', 'Попробуйте отправить файл ещё раз через 5 минут.'],
  'НЕТ_УВЕРЕННОСТИ':    ['Система не уверена в распознанных данных.', 'Проверьте документ вручную или введите БИН цифрами вместо загрузки файла.'],
  'НЕТ_ПОЛЕЙ':          ['В документе не хватает обязательных сведений.', 'Нужны: название компании, БИН (12 цифр) и юридический адрес.'],
  'БИН_НЕВЕРНЫЙ':       ['БИН не прошёл проверку контрольной суммы — в нём есть опечатка.', 'Сверьте 12 цифр БИН с оригиналом документа и отправьте заново.'],
  'АДРЕС_БЕЗ_НОМЕРА':   ['В адресе нет номера дома.', 'Укажите полный юридический адрес: город, улица, номер дома.'],
  'ДУБЛИКАТ':           ['Такой же документ уже обрабатывался сегодня.', 'Откройте папку «5. Договоры» — договор уже там. Если нужен повторный, напишите ответственному.'],
  'РИСК_КОНТРАГЕНТА':   ['У контрагента есть отметки риска в госреестрах.', 'СТОП. Не подписывайте договор. Передайте информацию руководителю или юристу.'],
  'НЕТ_ШАБЛОНА_KZ':     ['Не загружен шаблон договора для Казахстана.', 'Сообщите ответственному за систему.'],
  'НЕТ_ШАБЛОНА_US':     ['Шаблон для США пока не загружен.', 'Обратитесь к юристу — договор для США готовится вручную.'],
  'ПУСТЫЕ_ПЛЕЙСХОЛДЕРЫ':['В договоре остались незаполненные места.', 'Договор НЕ создан во избежание ошибки в документе. Сообщите ответственному.'],
  'ЗАНЯТО':             ['Система обрабатывает другую заявку.', 'Подождите минуту и попробуйте снова.']
};

/** Строка для пользователя: «Что случилось» + «Что делать». */
function humanizeError_(code, technicalMessage) {
  var help = ERROR_HELP[code];
  if (!help) {
    return 'Произошла техническая ошибка.\nЧто делать: сообщите ответственному за систему и приложите этот текст:\n' +
           (code ? code + ': ' : '') + (technicalMessage || '');
  }
  return help[0] + '\nЧто делать: ' + help[1] +
         (technicalMessage ? '\n\n(технические детали: ' + technicalMessage + ')' : '');
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 04_Extract.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 04_Extract
 * ---------------------------------------------------------------------------------
 * Извлечение реквизитов контрагента из файла: картинка, PDF, Google Документ, текст.
 **************************************************************************************/

/** Диспетчер по типу файла. Возвращает { data, tokens, source }. */
function extractFromFile_(file) {
  var mime = file.getMimeType();
  var size = file.getSize();

  if (size > CFG.MAX_UPLOAD_BYTES) {
    throw softError_('ФАЙЛ_СЛИШКОМ_БОЛЬШОЙ',
      'Размер ' + (size / 1024 / 1024).toFixed(1) + ' МБ, максимум ' +
      (CFG.MAX_UPLOAD_BYTES / 1024 / 1024) + ' МБ');
  }

  if (mime.indexOf('image/') === 0) {
    if (CFG.VISION_ALLOWED_MIMES.indexOf(mime) === -1) {
      throw softError_('КАРТИНКА_ФОРМАТ', 'Формат ' + mime + ' не поддерживается');
    }
    var res = extractFromImage_(maybeDownsizeImage_(file));
    res.source = 'фото';
    return res;
  }

  if (mime === 'application/pdf') {
    var pdfText = ocrPdfToText_(file);
    var r1 = extractFromPlainText_(pdfText, 'PDF');
    r1.source = 'PDF (распознавание)';
    return r1;
  }

  if (mime === MimeType.GOOGLE_DOCS) {
    var docText = DocumentApp.openById(file.getId()).getBody().getText();
    var r2 = extractFromPlainText_(docText, 'Google Документ');
    r2.source = 'Google Документ';
    return r2;
  }

  if (mime === 'text/plain' || mime === 'text/csv') {
    var txt = file.getBlob().getDataAsString('UTF-8');
    var r3 = extractFromPlainText_(txt, 'текстовый файл');
    r3.source = 'текстовый файл';
    return r3;
  }

  if (mime === MimeType.MICROSOFT_WORD || /\.docx?$/i.test(file.getName())) {
    throw softError_('ФОРМАТ',
      'Файл Word (.doc/.docx) напрямую не читается. Откройте его в Google Документах ' +
      '(правый клик → Открыть с помощью → Google Документы) и сохраните как Google Документ.');
  }

  throw softError_('ФОРМАТ', 'Тип файла: ' + mime);
}

/** Уменьшить крупную картинку через миниатюру Drive, чтобы уложиться в лимит запроса. */
function maybeDownsizeImage_(file) {
  var blob = file.getBlob();
  if (blob.getBytes().length < CFG.IMAGE_DOWNSIZE_BYTES) return blob;
  try {
    if (typeof Drive !== 'undefined' && Drive.Files) {
      var meta = Drive.Files.get(file.getId(), { fields: 'thumbnailLink' });
      if (meta && meta.thumbnailLink) {
        var big = meta.thumbnailLink.replace(/=s\d+/, '=s2000');
        var resp = UrlFetchApp.fetch(big, { muteHttpExceptions: true });
        if (resp.getResponseCode() === 200) {
          Logger.log('Картинка уменьшена через миниатюру Drive');
          return resp.getBlob().setContentType(blob.getContentType());
        }
      }
    }
  } catch (e) {
    Logger.log('Уменьшить картинку не удалось, отправляю оригинал: ' + e);
  }
  return blob;
}

/** OCR PDF средствами Drive (Drive API v3: files.create с ocrLanguage). */
function ocrPdfToText_(pdfFile) {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw softError_('НЕ_НАСТРОЕНО',
      'Drive API не подключён. Редактор скрипта → Службы (+) → Drive API → Добавить.');
  }
  var tempId = null;
  try {
    // Drive API v3
    var created = Drive.Files.create(
      { name: 'OCR_TMP_' + Date.now(), mimeType: MimeType.GOOGLE_DOCS },
      pdfFile.getBlob(),
      { ocrLanguage: CFG.OCR_LANGUAGE, supportsAllDrives: true }
    );
    tempId = created.id;
    var text = DocumentApp.openById(tempId).getBody().getText();
    Logger.log('OCR PDF: получено ' + text.length + ' символов');
    return text;
  } catch (e) {
    throw softError_('РАСПОЗНАВАНИЕ', 'Drive OCR: ' + e.message);
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); }
      catch (e2) { Logger.log('Не удалось убрать временный OCR-документ: ' + e2); }
    }
  }
}

/**
 * Текст → реквизиты. Особый случай: если в файле только БИН (например, бухгалтер
 * написал 12 цифр в блокноте) — обращение к модели не нужно, экономим деньги и время.
 */
function extractFromPlainText_(text, label) {
  var trimmed = String(text || '').trim();
  if (!trimmed) throw softError_('ПУСТОЙ_ФАЙЛ', label + ' не содержит текста');

  var binOnly = trimmed.match(/^[^\d]{0,20}(\d[\d\s\-]{10,20}\d)[^\d]{0,20}$/);
  if (binOnly) {
    var bin = normalizeBin_(binOnly[1]);
    if (/^\d{12}$/.test(bin)) {
      Logger.log('В файле только БИН — модель не вызываем: ' + bin);
      return { data: emptyPartner_({ BIN: bin, _confidence: 'high' }), tokens: 0 };
    }
  }

  if (trimmed.length < CFG.MIN_OCR_CHARS) {
    throw softError_('МАЛО_ТЕКСТА', label + ': всего ' + trimmed.length + ' символов');
  }
  var letters = (trimmed.match(/[А-ЯЁA-Zа-яёa-zҚҢҒҮҰӨӘІқңғүұөәі]/g) || []).length;
  if (letters < CFG.MIN_OCR_LETTERS) {
    throw softError_('МАЛО_ТЕКСТА', label + ': букв всего ' + letters + ' — вероятно, документ не распознался');
  }

  return callModelForText_(trimmed);
}

/** Пустой объект контрагента со всеми известными полями. */
function emptyPartner_(overrides) {
  var base = {
    COUNTRY: '', PARTNER_NAME: '', BIN: '', DIRECTOR: '', ADDRESS: '',
    IIK: '', BANK: '', BIK: '', NDA_TYPE: 'Mutual',
    PURPOSE: 'Business Partnership', EMAIL: '', _confidence: ''
  };
  Object.keys(overrides || {}).forEach(function (k) { base[k] = overrides[k]; });
  return base;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ВЫЗОВ МОДЕЛИ
// ═══════════════════════════════════════════════════════════════════════════════════

function extractionSchemaPrompt_() {
  return [
    'Верни СТРОГО JSON такой структуры:',
    '{',
    '  "COUNTRY": "Kazakhstan | USA | \\"\\\" если непонятно. USA ставь ТОЛЬКО при явных признаках: адрес в США, EIN, название штата, Inc/LLC/Corp.",',
    '  "PARTNER_NAME": "полное наименование с правовой формой (ТОО «...», АО «...», ИП Фамилия И.О., Acme Inc)",',
    '  "BIN": "ровно 12 цифр. Сохраняй ведущие нули. Если цифр не 12 — пустая строка.",',
    '  "DIRECTOR": "ФИО первого руководителя полностью",',
    '  "ADDRESS": "юридический адрес с индексом, городом, улицей и номером дома",',
    '  "IIK": "ИИК / IBAN / номер счёта",',
    '  "BANK": "наименование банка",',
    '  "BIK": "БИК / SWIFT",',
    '  "NDA_TYPE": "Unilateral | Mutual (по умолчанию Mutual)",',
    '  "PURPOSE": "Business Partnership | Contract Work | Employment | Sale of a Business | Other",',
    '  "EMAIL": "email контрагента",',
    '  "_confidence": "high — все ключевые поля читаются уверенно; medium — часть додумана по контексту; low — документ плохо читается"',
    '}',
    '',
    'ПРАВИЛА:',
    '• Ничего не выдумывай. Не видишь поле — пустая строка "".',
    '• Не подставляй реквизиты Dereknet: нужны данные ВТОРОЙ стороны.',
    '• БИН — это 12 цифр. ИИН физлица тоже 12 цифр, это допустимо.',
    '• Если документ нечитаемый — верни _confidence: "low".'
  ].join('\n');
}

function extractFromImage_(blob) {
  var apiKey = prop_(PROP.OPENAI_API_KEY, { required: false });
  if (!apiKey) throw softError_('НЕТ_КЛЮЧА', 'OPENAI_API_KEY не задан');

  var dataUrl = 'data:' + blob.getContentType() + ';base64,' +
                Utilities.base64Encode(blob.getBytes());

  return callModelWithRepair_(apiKey, function (previousBadAnswer) {
    var msgs = [
      { role: 'system', content: MODEL_SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Извлеки реквизиты контрагента с изображения.\n\n' + extractionSchemaPrompt_() },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
      ]}
    ];
    if (previousBadAnswer) {
      msgs.push({ role: 'assistant', content: previousBadAnswer });
      msgs.push({ role: 'user', content: 'Это невалидный JSON. Верни ТОЛЬКО объект { ... } без пояснений.' });
    }
    return msgs;
  });
}

function callModelForText_(text) {
  var apiKey = prop_(PROP.OPENAI_API_KEY, { required: false });
  if (!apiKey) throw softError_('НЕТ_КЛЮЧА', 'OPENAI_API_KEY не задан');

  var userPrompt = [
    'Извлеки реквизиты контрагента из текста ниже.',
    '"""', text.slice(0, 8000), '"""', '',
    extractionSchemaPrompt_()
  ].join('\n');

  return callModelWithRepair_(apiKey, function (previousBadAnswer) {
    var msgs = [
      { role: 'system', content: MODEL_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];
    if (previousBadAnswer) {
      msgs.push({ role: 'assistant', content: previousBadAnswer });
      msgs.push({ role: 'user', content: 'Это невалидный JSON. Верни ТОЛЬКО объект { ... } без пояснений.' });
    }
    return msgs;
  });
}

var MODEL_SYSTEM_PROMPT =
  'Ты извлекаешь реквизиты юридических лиц Республики Казахстан и США из документов. ' +
  'Отвечай ТОЛЬКО валидным JSON без markdown-обёрток. Никаких пояснений. ' +
  'Отсутствующее поле — пустая строка. Ничего не выдумывай.';

/** Две попытки: если JSON сломан, показываем модели её же ответ и просим починить. */
function callModelWithRepair_(apiKey, buildMessages) {
  var lastRaw = '';
  var totalTokens = 0;
  for (var attempt = 1; attempt <= 2; attempt++) {
    var result = callOpenAI_(apiKey, buildMessages(attempt === 2 ? lastRaw : null));
    lastRaw = result.content;
    totalTokens += result.tokens;
    try {
      var parsed = parseJsonLoose_(lastRaw);
      return { data: emptyPartner_(parsed), tokens: totalTokens };
    } catch (e) {
      if (attempt === 2) {
        throw softError_('ОТВЕТ_МОДЕЛИ', 'JSON не разобрался после двух попыток: ' + e.message);
      }
    }
  }
  throw softError_('ОТВЕТ_МОДЕЛИ', 'Не удалось получить данные');
}

/** HTTP-вызов OpenAI с экспоненциальной паузой на 429 / 5xx. */
function callOpenAI_(apiKey, messages) {
  var payload = JSON.stringify({
    model: CFG.OPENAI_MODEL,
    messages: messages,
    temperature: 0,
    max_tokens: CFG.OPENAI_MAX_TOKENS,
    response_format: { type: 'json_object' }
  });

  var waitMs = 1500;
  for (var i = 1; i <= CFG.OPENAI_MAX_RETRIES; i++) {
    var resp = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      payload: payload,
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText();

    if (code === 200) {
      var parsed = JSON.parse(body);
      if (!parsed.choices || !parsed.choices[0]) {
        throw softError_('ОТВЕТ_МОДЕЛИ', 'Пустой ответ OpenAI');
      }
      return {
        content: String(parsed.choices[0].message.content || '').trim(),
        tokens: (parsed.usage && parsed.usage.total_tokens) || 0
      };
    }

    if (code === 401) {
      throw softError_('НЕТ_КЛЮЧА', 'Ключ OpenAI отклонён (401). Проверьте OPENAI_API_KEY.');
    }
    if (code === 429 && /insufficient_quota/.test(body)) {
      throw softError_('НЕТ_КЛЮЧА', 'На счёте OpenAI закончились средства.');
    }
    if ((code === 429 || code >= 500) && i < CFG.OPENAI_MAX_RETRIES) {
      Logger.log('OpenAI ' + code + ' — повтор через ' + waitMs + ' мс');
      Utilities.sleep(waitMs);
      waitMs *= 2;
      continue;
    }
    throw softError_('ОТВЕТ_МОДЕЛИ', 'OpenAI HTTP ' + code + ': ' + body.slice(0, 300));
  }
  throw softError_('ОТВЕТ_МОДЕЛИ', 'OpenAI не ответил после ' + CFG.OPENAI_MAX_RETRIES + ' попыток');
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 05_Lookup.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 05_Lookup
 * ---------------------------------------------------------------------------------
 * Проверка контрагента по БИН.
 *
 * ВАЖНО ПРО ИСТОЧНИКИ ДАННЫХ (проверено 27.08.2026):
 *   • https://stat.gov.kz/api/juridical/simple/?bin=…  → HTTP 404. Этого эндпоинта
 *     НЕ СУЩЕСТВУЕТ. В версии 4.2.1 он был объявлен «основным источником», но
 *     каждый запрос молча падал в catch и система всегда уходила на резервный парсер.
 *     Убран, чтобы не создавать ложного ощущения официальной проверки.
 *   • ba.prg.kz — публичный агрегатор госреестров. Официального API нет, читаем
 *     HTML. Работает, но может сломаться при редизайне сайта — поэтому обёрнут
 *     в честный статус «не удалось проверить», а не в тихий null.
 *   • Платные официальные API (kompra.kz, statsnet.co, pk.uchet.kz) подключаются
 *     без правки логики: задайте Script Property LOOKUP_API_URL и LOOKUP_API_KEY.
 *
 * ПРИНЦИП: система НИКОГДА не делает вид, что проверила контрагента, если проверка
 * не прошла. Невозможность проверки — это результат, который виден в журнале и в
 * письме бухгалтеру, а не пустая строка.
 **************************************************************************************/

/**
 * Обогатить данные контрагента и получить статус риска.
 * Мутирует объект partner, добавляя служебные поля с префиксом «_».
 */
function enrichByBin_(partner) {
  var bin = normalizeBin_(partner.BIN);
  partner.BIN = bin;

  if (!/^\d{12}$/.test(bin)) {
    partner._LOOKUP = 'не выполнялась (БИН отсутствует)';
    return;
  }

  // Контрольная сумма — локально, без интернета, всегда работает.
  if (!isValidKzBin_(bin)) {
    throw softError_('БИН_НЕВЕРНЫЙ',
      'БИН ' + bin + ' не проходит проверку контрольного разряда — в номере опечатка');
  }
  partner._BIN_TYPE = describeKzBin_(bin);

  var data = lookupBin_(bin);

  if (!data) {
    partner._LOOKUP = 'НЕ УДАЛОСЬ — требуется ручная проверка на kgd.gov.kz';
    partner._STATUS = '';
    Logger.log('Проверка БИН ' + bin + ': источники недоступны');
  } else {
    partner._LOOKUP  = 'выполнена (' + data.sourceName + ')';
    partner._STATUS  = data.status || '';
    partner._OKED    = data.okedName || '';
    partner._REGDATE = data.regDate || '';
    partner._TAXDEBT = data.taxDebt || '';
    partner._SOURCE_URL = data.sourceUrl || '';

    // Данные из реестра заполняют только ПУСТЫЕ поля: то, что бухгалтер
    // прислал в документе, приоритетнее — реестр может отставать от жизни.
    if (!nonEmpty_(partner.PARTNER_NAME) && data.name)     partner.PARTNER_NAME = data.name;
    if (!nonEmpty_(partner.DIRECTOR)     && data.director) partner.DIRECTOR     = data.director;
    if (!nonEmpty_(partner.ADDRESS)      && data.address)  partner.ADDRESS      = data.address;

    // Расхождение названия — не ошибка, но повод показать человеку.
    if (nonEmpty_(partner.PARTNER_NAME) && data.name &&
        !namesLookSimilar_(partner.PARTNER_NAME, data.name)) {
      partner._WARNINGS = (partner._WARNINGS || []).concat(
        'Название в документе («' + partner.PARTNER_NAME + '») отличается от реестра («' + data.name + '»)');
    }
  }

  // Для ИП руководитель = сам предприниматель.
  if (!nonEmpty_(partner.DIRECTOR) && nonEmpty_(partner.PARTNER_NAME)) {
    var nameStr = String(partner.PARTNER_NAME).trim();
    if (/^ИП[\s.«"]/i.test(nameStr) || /^ИП$/i.test(nameStr)) {
      partner.DIRECTOR = nameStr.replace(/^ИП[\s.]*/i, '').replace(/^[«"]|[»"]$/g, '').trim();
      Logger.log('ИП: руководитель взят из наименования — ' + partner.DIRECTOR);
    }
  }
}

/** Грубое сравнение названий: сравниваем только буквы и цифры в нижнем регистре. */
function namesLookSimilar_(a, b) {
  function key(s) { return String(s || '').toLowerCase().replace(/[^a-zа-яё0-9қңғүұөәі]/gi, ''); }
  var ka = key(a), kb = key(b);
  if (!ka || !kb) return true;
  return ka.indexOf(kb) !== -1 || kb.indexOf(ka) !== -1;
}

/** Проверить, есть ли блокирующие отметки риска. */
function blockingRiskFlags_(partner) {
  var status = String(partner._STATUS || '').toLowerCase();
  if (!status || status.indexOf('риск') === -1) return [];
  return CFG.BLOCKING_RISK_FLAGS.filter(function (flag) {
    return status.indexOf(flag.toLowerCase()) !== -1;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЦЕПОЧКА ИСТОЧНИКОВ
// ═══════════════════════════════════════════════════════════════════════════════════

function lookupBin_(bin) {
  var cache = CacheService.getScriptCache();
  var key = 'bin_v5:' + bin;
  var cached = cache.get(key);
  if (cached) {
    Logger.log('БИН ' + bin + ' — из кэша');
    return JSON.parse(cached);
  }

  var providers = [
    { name: 'корпоративный API', fn: lookupViaCustomApi_ },
    { name: 'ba.prg.kz',         fn: lookupViaBaPrg_ }
  ];

  for (var i = 0; i < providers.length; i++) {
    try {
      var data = providers[i].fn(bin);
      if (data && (data.name || data.director || data.address)) {
        data.sourceName = providers[i].name;
        cache.put(key, JSON.stringify(data), CFG.BIN_CACHE_SECONDS);
        Logger.log('БИН ' + bin + ' получен через ' + providers[i].name);
        return data;
      }
    } catch (e) {
      Logger.log('Источник «' + providers[i].name + '» не сработал: ' + e);
    }
  }
  return null;
}

/**
 * Подключение платного/официального API без правки кода.
 * Script Properties:
 *   LOOKUP_API_URL — шаблон, где {BIN} заменяется на номер, например
 *                    https://api.kompra.kz/v1/company?bin={BIN}
 *   LOOKUP_API_KEY — значение заголовка Authorization (необязательно)
 */
function lookupViaCustomApi_(bin) {
  var url = prop_('LOOKUP_API_URL');
  if (!url) return null;

  var headers = { 'Accept': 'application/json' };
  var apiKey = prop_('LOOKUP_API_KEY');
  if (apiKey) headers['Authorization'] = apiKey;

  var resp = UrlFetchApp.fetch(url.replace('{BIN}', bin), {
    method: 'get', headers: headers, muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return null;

  var j = JSON.parse(resp.getContentText());
  var o = j.data || j.obj || j.result || j;
  return {
    name:     o.name || o.nameRu || o.fullName || o.title || '',
    director: o.director || o.directorName || o.headName || o.ceo || '',
    address:  o.address || o.addressRu || o.legalAddress || '',
    status:   o.status || '',
    regDate:  o.registrationDate || o.regDate || '',
    okedCode: o.oked || o.okedCode || '',
    okedName: o.okedName || '',
    taxDebt:  o.taxDebt || '',
    sourceUrl: url.replace('{BIN}', bin)
  };
}

/** Резервный источник — публичная страница агрегатора госреестров. */
function lookupViaBaPrg_(bin) {
  var url = 'https://ba.prg.kz/000000000-unknown/' + bin + '-' + bin + '/';
  var resp = UrlFetchApp.fetch(encodeURI(url), {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9'
    }
  });
  if (resp.getResponseCode() !== 200) return null;

  var raw = resp.getContentText();
  var html = decodeHtmlEntities_(raw);
  var metaRaw = extractMetaContent_(raw, 'description') || extractMetaContent_(raw, 'og:description');
  var meta = metaRaw ? decodeHtmlEntities_(metaRaw) : '';

  var oked = parseOked_(html);
  return {
    name:      parseName_(meta, html),
    director:  parseDirector_(meta, html),
    address:   parseLegalAddress_(html) || parseAddressFromOgTags_(html) || parseAddressFromMeta_(meta),
    status:    parseRiskStatus_(html),
    regDate:   parseRegistrationDate_(html),
    okedCode:  oked.code,
    okedName:  oked.name,
    taxDebt:   parseTaxDebt_(html),
    phone:     parsePhone_(html),
    sourceUrl: url
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  РАЗБОР HTML
// ═══════════════════════════════════════════════════════════════════════════════════

function extractMetaContent_(html, metaName) {
  var esc = String(metaName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re1 = new RegExp('<meta\\s+(?:name|property)=["\']' + esc + '["\']\\s+content=["\']([^"\']+)["\']', 'i');
  var re2 = new RegExp('<meta\\s+content=["\']([^"\']+)["\']\\s+(?:name|property)=["\']' + esc + '["\']', 'i');
  var m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function decodeHtmlEntities_(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function parseName_(meta, html) {
  if (meta) {
    var m = meta.match(/^([^,]+(?:,[^,]*?)?)\s*,\s*БИН/);
    if (m) return m[1].trim();
    var parts = meta.split(',');
    if (parts[0] && parts[0].indexOf('БИН') === -1) return parts[0].trim();
  }
  if (html) {
    var t = html.match(/<title>([^<]+)<\/title>/i);
    if (t) {
      var mm = t[1].match(/^([^,\-(|]+)/);
      if (mm) return mm[1].trim();
    }
  }
  return '';
}

/**
 * Ограничение в 4 слова: агрегатор иногда выводит сокращённое И полное имя подряд
 * («ГУЛЬФАЙРУЗ ГУЛЬФАЙРУЗ АХМЕТОВА …»), и жадная регулярка захватывала оба.
 */
function parseDirector_(meta, html) {
  var word = '[А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәіA-Za-z][А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәіA-Za-z\\-]+';
  var re = new RegExp('Руководитель:\\s*(' + word + '(?:\\s+' + word + '){0,3})');
  var m = meta ? meta.match(re) : null;
  if (!m && html) {
    m = html.match(/(?:Руководитель|Первый\s+руководитель)[:\s]+([А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәі\s]{10,50})/i);
  }
  if (!m) return '';
  return m[1].replace(/\s{2,}/g, ' ').replace(/[.\s]+$/, '').trim();
}

function parseLegalAddress_(html) {
  var m = html.match(/(?:Юридический\s+адрес|Адрес\s+регистрации)[:\s]+(?:Рус\s+)?([^<\n]+)/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
  var old = html.match(/Юридический\s+адрес[\s\S]{0,200}?Рус([^\n]+?)(?:\s*Проверено|\s*Қаз|\s*Источники|$)/i);
  if (old) return old[1].replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
  return '';
}

function parseAddressFromOgTags_(html) {
  var locality = (html.match(/business:contact_data:locality[^>]+content=["']([^"']+)["']/i) || [])[1];
  var street   = (html.match(/business:contact_data:street_address[^>]+content=["']([^"']+)["']/i) || [])[1];
  var postal   = (html.match(/business:contact_data:postal_code[^>]+content=["']([^"']+)["']/i) || [])[1];
  if (!locality && !street) return '';
  return [postal, locality, street].filter(Boolean).join(', ');
}

function parseAddressFromMeta_(meta) {
  if (!meta) return '';
  var m = meta.match(/Руководитель:[^,]+,\s*([\d][\d\s.,\-\/А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәіA-Za-z]+?)(?:\s*\.\s*[✔☑]|$)/);
  return m ? m[1].trim().replace(/[,\s]+$/, '') : '';
}

/** Отметки в госреестрах, которые делают договор рискованным. */
function parseRiskStatus_(html) {
  var checks = [
    { label: 'банкрот',                    re: /признанных\s+банкротами[\s\S]{0,60}?(Нет|Да)/i },
    { label: 'лжепредприятие',             re: /признанных\s+лжепредприятиями[\s\S]{0,60}?(Нет|Да)/i },
    { label: 'недействительная регистрация',re: /регистрация\s+которых\s+признана\s+недействительной[\s\S]{0,60}?(Нет|Да)/i },
    { label: 'бездействующий',             re: /признанных\s+бездействующими[\s\S]{0,60}?(Нет|Да)/i },
    { label: 'отсутствует по адресу',      re: /отсутствующих\s+по\s+юридическому\s+адресу[\s\S]{0,60}?(Нет|Да)/i }
  ];
  var flags = [];
  var answered = 0;
  checks.forEach(function (c) {
    var m = html.match(c.re);
    if (!m) return;
    answered++;
    if (m[1].toLowerCase() === 'да') flags.push(c.label);
  });
  if (answered === 0) return '';                        // страница не содержит проверок — не врём
  return flags.length ? 'РИСК: ' + flags.join(', ') : 'действующая';
}

function parseRegistrationDate_(html) {
  var m = html.match(/Первичная\s+регистрация[\s\S]{0,120}?(\d{2}\.\d{2}\.\d{4})/i);
  return m ? m[1] : '';
}

function parseOked_(html) {
  var m = html.match(/Основной\s+ОКЭД[\s\S]{0,200}?(\d{4,5})\s+([^\n]+?)(?:\s*Проверено|$)/i);
  return m ? { code: m[1].trim(), name: m[2].trim() } : { code: '', name: '' };
}

function parseTaxDebt_(html) {
  var m = html.match(/задолженност[ьи][\s\S]{0,300}?(\d+(?:[.,]\d+)?)\s*₸/i);
  return m ? m[1].replace(',', '.') + ' ₸' : '';
}

function parsePhone_(html) {
  var m = html.match(/tel:(\+?[\d()\-\s]+)/);
  return m ? m[1].replace(/\s+/g, '') : '';
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 06_Render.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 06_Render
 * ---------------------------------------------------------------------------------
 * Сборка данных для шаблона и генерация Google Документа + PDF.
 *
 * ГЛАВНОЕ ПРАВИЛО: договор с незаполненным «{{ПЛЕЙСХОЛДЕРОМ}}» НИКОГДА не покидает
 * систему. После заполнения документ сканируется, и если хоть один плейсхолдер
 * остался — черновик удаляется, а заявка уходит в «Требует проверки».
 * Юридический документ с «{{RECEIVING_PARTY_NAME}}» вместо названия компании —
 * это репутационный ущерб, который дороже любой задержки.
 **************************************************************************************/

var MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];

// ═══════════════════════════════════════════════════════════════════════════════════
//  СБОРКА ЗНАЧЕНИЙ
// ═══════════════════════════════════════════════════════════════════════════════════

function buildFillData_(country, p, agreementNumber) {
  return country === 'USA'
    ? buildUsFillData_(p, agreementNumber)
    : buildKzFillData_(p, agreementNumber);
}

function buildKzFillData_(p, agreementNumber) {
  var today = new Date();
  var bankRu = 'ИИК ' + DEREKNET.IIK + ', ' + DEREKNET.BANK_RU + ', БИК ' + DEREKNET.BIK + ', БИН ' + DEREKNET.BIN;
  var bankEn = 'IBAN ' + DEREKNET.IIK + ', ' + DEREKNET.BANK_EN + ', SWIFT ' + DEREKNET.BIK + ', BIN ' + DEREKNET.BIN;

  var signatoryRu = p.DIRECTOR || p.PARTNER_NAME || '';
  var signatoryEn = transliterateRuToEn_(signatoryRu);

  var partnerBankRu = [
    p.IIK  ? 'ИИК ' + p.IIK  : '',
    p.BANK || '',
    p.BIK  ? 'БИК ' + p.BIK  : '',
    p.BIN  ? 'БИН ' + p.BIN  : ''
  ].filter(Boolean).join(', ');

  return {
    // общее
    AGREEMENT_NUMBER: agreementNumber,
    CITY:             DEREKNET.CITY_RU,
    DATE_DAY:         String(today.getDate()),
    DATE_MONTH_RU:    MONTHS_RU[today.getMonth()],
    DATE_MONTH_EN:    MONTHS_EN[today.getMonth()],
    DATE_YEAR:        String(today.getFullYear()),

    // раскрывающая сторона — Dereknet
    DISCLOSING_PARTY_NAME_RU:         DEREKNET.NAME_RU,
    DISCLOSING_PARTY_NAME_EN:         DEREKNET.NAME_EN,
    DISCLOSING_PARTY_ADDRESS_RU:      DEREKNET.ADDR_RU,
    DISCLOSING_PARTY_ADDRESS_EN:      DEREKNET.ADDR_EN,
    DISCLOSING_PARTY_TAX_ID:          DEREKNET.BIN,
    DISCLOSING_PARTY_BANK_DETAILS_RU: bankRu,
    DISCLOSING_PARTY_BANK_DETAILS_EN: bankEn,
    // именительный падеж — блок подписей
    DISCLOSING_PARTY_REP_POSITION_RU: DEREKNET.REP_POSITION_RU,
    DISCLOSING_PARTY_REP_POSITION_EN: DEREKNET.REP_POSITION_EN,
    DISCLOSING_PARTY_REP_NAME_RU:     DEREKNET.REP_NAME_RU,
    DISCLOSING_PARTY_REP_NAME_EN:     DEREKNET.REP_NAME_EN,
    // родительный падеж — преамбула «в лице …»
    DISCLOSING_PARTY_REP_POSITION_RU_GEN: DEREKNET.REP_POSITION_RU_GEN,
    DISCLOSING_PARTY_REP_NAME_RU_GEN:     DEREKNET.REP_NAME_RU_GEN,
    DISCLOSING_PARTY_BASIS_RU:        DEREKNET.BASIS_RU,
    DISCLOSING_PARTY_BASIS_EN:        DEREKNET.BASIS_EN,
    APPENDIX_COMPANY_NAME_RU:         DEREKNET.NAME_RU,
    APPENDIX_COMPANY_NAME_EN:         DEREKNET.NAME_EN,

    // получающая сторона — контрагент
    RECEIVING_PARTY_NAME:            p.PARTNER_NAME,
    RECEIVING_PARTY_NAME_EN:         transliterateRuToEn_(p.PARTNER_NAME || ''),
    RECEIVING_PARTY_TAX_ID:          p.BIN,
    RECEIVING_PARTY_TAX_ID_EN:       p.BIN,
    RECEIVING_PARTY_ADDRESS:         p.ADDRESS,
    RECEIVING_PARTY_ADDRESS_EN:      transliterateRuToEn_(p.ADDRESS || ''),
    RECEIVING_PARTY_LEGAL_FORM_RU:   inferLegalFormRu_(p.PARTNER_NAME),
    RECEIVING_PARTY_LEGAL_FORM_EN:   inferLegalFormEn_(p.PARTNER_NAME),
    RECEIVING_PARTY_JURISDICTION_RU: 'Республики Казахстан',
    RECEIVING_PARTY_JURISDICTION_EN: 'Republic of Kazakhstan',
    RECEIVING_PARTY_REG_AGREEMENT_RU: inferRegAgreementRu_(p.PARTNER_NAME),
    RECEIVING_PARTY_REP_POSITION_RU: inferRepPositionRu_(p.PARTNER_NAME),
    RECEIVING_PARTY_REP_POSITION_EN: inferRepPositionEn_(p.PARTNER_NAME),
    RECEIVING_PARTY_REP_NAME_RU:     p.DIRECTOR || '_______________',
    RECEIVING_PARTY_REP_NAME_EN:     signatoryEn || '_______________',
    RECEIVING_PARTY_BASIS_RU:        'Устава',
    RECEIVING_PARTY_BASIS_EN:        'Charter',
    RECEIVING_PARTY_SIGNATORY_RU:    signatoryRu,
    RECEIVING_PARTY_SIGNATORY_EN:    signatoryEn,
    RECEIVING_PARTY_BANK_DETAILS_RU: partnerBankRu || '—',
    RECEIVING_PARTY_BANK_DETAILS_EN: partnerBankRu ? transliterateRuToEn_(partnerBankRu) : '—',

    CONF_INFO: 'техническая документация, коммерческая информация, финансовые данные ' +
               'и иная информация, связанная с деятельностью сторон'
  };
}

function buildUsFillData_(p, agreementNumber) {
  var today = new Date();
  var isUnilateral = String(p.NDA_TYPE || '').indexOf('Unilateral') !== -1;
  var purpose = p.PURPOSE || 'Business Partnership';

  var data = {
    AGREEMENT_NUMBER: agreementNumber,
    DATE:             Utilities.formatDate(today, CFG.TZ_US, 'MMMM d, yyyy'),
    PARTY1_NAME:      DEREKNET.NAME_EN,
    PARTY1_ADDRESS:   DEREKNET.ADDR_EN,
    PARTY1_PRINT:     DEREKNET.REP_NAME_EN,
    PARTY2_NAME:      p.PARTNER_NAME,
    PARTY2_ADDRESS:   p.ADDRESS || 'to be provided at signing',
    PARTY2_PRINT:     p.DIRECTOR || p.PARTNER_NAME,
    PARTY2_BIN:       p.BIN || '',
    STATE:            CFG.US_STATE,
    NDA_TYPE:         p.NDA_TYPE || 'Mutual',
    PURPOSE:          purpose,
    PURPOSE_OTHER_TEXT: purpose === 'Other' ? (p.PURPOSE_OTHER || '') : '',
    CHECK_UNILATERAL: isUnilateral ? '☑' : '☐',
    CHECK_MUTUAL:     isUnilateral ? '☐' : '☑'
  };

  ['Employment', 'Contract Work', 'Business Partnership', 'Sale of a Business', 'Other']
    .forEach(function (label) {
      var key = 'CHECK_' + label.toUpperCase().replace(/ /g, '_');
      data[key] = (purpose === label) ? '☑' : '☐';
    });

  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ГЕНЕРАЦИЯ ДОКУМЕНТА
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Создать договор. Возвращает { docId, docUrl, pdfId, pdfUrl, fileName }.
 * При любой ошибке черновик удаляется — «мусорных» полудокументов не остаётся.
 */
function generateContract_(country, fill, partner, agreementNumber) {
  var templateId = (country === 'USA')
    ? prop_(PROP.US_TEMPLATE_ID)
    : prop_(PROP.KZ_TEMPLATE_ID);

  if (!templateId) {
    throw softError_(country === 'USA' ? 'НЕТ_ШАБЛОНА_US' : 'НЕТ_ШАБЛОНА_KZ',
      'Не задан шаблон для страны ' + country);
  }

  var stamp = Utilities.formatDate(new Date(), CFG.TZ_KZ, 'yyyyMMdd_HHmm');
  var fileName = 'NDA_' + (country === 'USA' ? 'US' : 'KZ') + '_' +
                 safeFileName_(partner.PARTNER_NAME) + '_' + stamp;

  var outFolder = DriveApp.getFolderById(prop_(PROP.OUTPUT_FOLDER_ID, { required: true }));
  var docFile = null;

  try {
    docFile = DriveApp.getFileById(templateId).makeCopy(fileName, outFolder);
    var doc = DocumentApp.openById(docFile.getId());

    // Заполняем тело И колонтитулы: body.replaceText() их не затрагивает,
    // а номер договора и название часто вынесены именно в верхний колонтитул.
    var sections = collectSections_(doc);
    sections.forEach(function (section) { fillSection_(section, fill); });

    insertSignature_(doc, prop_(PROP.SIGNATURE_FILE_ID));
    doc.saveAndClose();

    // Контроль: не осталось ли незаполненных мест.
    var leftovers = findLeftoverTokens_(docFile.getId());
    if (leftovers.length) {
      docFile.setTrashed(true);
      throw softError_('ПУСТЫЕ_ПЛЕЙСХОЛДЕРЫ',
        'В шаблоне есть места, которые скрипт не умеет заполнять: ' + leftovers.join(', ') +
        '. Либо уберите их из шаблона, либо добавьте поле в 06_Render.gs.');
    }

    var pdfBlob = DriveApp.getFileById(docFile.getId())
                          .getAs(MimeType.PDF)
                          .setName(fileName + '.pdf');
    var pdfFile = outFolder.createFile(pdfBlob);

    return {
      docId:    docFile.getId(),
      docUrl:   'https://docs.google.com/document/d/' + docFile.getId() + '/edit',
      pdfId:    pdfFile.getId(),
      pdfUrl:   pdfFile.getUrl(),
      fileName: fileName
    };
  } catch (err) {
    if (docFile) {
      try { docFile.setTrashed(true); } catch (e) { /* уже удалён */ }
    }
    throw err;
  }
}

/** Тело + все колонтитулы + сноски документа. */
function collectSections_(doc) {
  var sections = [doc.getBody()];
  var header = doc.getHeader();  if (header) sections.push(header);
  var footer = doc.getFooter();  if (footer) sections.push(footer);
  doc.getFootnotes().forEach(function (fn) { sections.push(fn.getFootnoteContents()); });
  return sections;
}

/**
 * Подстановка значений. Пустое значение даёт «—», а не пустоту:
 * в договоре видно, что поле осознанно пустое, а не потерялось.
 */
function fillSection_(section, data) {
  Object.keys(data).forEach(function (key) {
    var raw = data[key];
    var value = (raw === undefined || raw === null || String(raw).trim() === '') ? '—' : String(raw);
    // replaceText принимает регулярное выражение — фигурные скобки экранируем.
    section.replaceText('\\{\\{\\s*' + key + '\\s*\\}\\}', value);
  });
}

/** Незаполненные плейсхолдеры во всём документе (тело + колонтитулы). */
function findLeftoverTokens_(docId) {
  var doc = DocumentApp.openById(docId);
  var text = doc.getBody().getText();
  var h = doc.getHeader(); if (h) text += '\n' + h.getText();
  var f = doc.getFooter(); if (f) text += '\n' + f.getText();
  return extractTokens_(text);
}

/**
 * Подпись директора. Шаблон содержит несколько якорей {{SIGNATURE_BOSS}}
 * (соглашение RU/EN + приложение RU/EN) — обрабатываем все.
 *
 * Картинка вставляется в натуральном размере и уменьшается пропорционально,
 * только если шире 200 pt. Старая версия жёстко ставила 160×60 и растягивала
 * подпись, если пропорции отличались от 8:3.
 */
function insertSignature_(doc, sigFileId) {
  var token = '\\{\\{SIGNATURE_BOSS\\}\\}';
  var blob = null;

  if (sigFileId) {
    try {
      var file = DriveApp.getFileById(sigFileId);
      var mime = file.getMimeType();
      if (CFG.IMAGE_SIG_MIMES.indexOf(mime) === -1) {
        throw new Error('неподдерживаемый формат подписи: ' + mime);
      }
      blob = Utilities.newBlob(file.getBlob().getBytes(), mime, 'signature');
    } catch (e) {
      Logger.log('Подпись недоступна, ставлю прочерк: ' + e);
    }
  }

  var stamped = 0;
  collectSections_(doc).forEach(function (section) {
    var found = section.findText(token);
    var guard = 0;
    while (found && guard++ < 20) {
      var el = found.getElement();
      var par;
      try {
        par = el.getParent().asParagraph();
      } catch (e) {
        // Токен в ячейке таблицы или списке — заменяем текстом, без картинки.
        section.replaceText(token, '_______________');
        break;
      }
      par.clear();
      if (blob) {
        try {
          var img = par.appendInlineImage(blob);
          var w = img.getWidth(), h = img.getHeight();
          if (w > CFG.SIGNATURE_MAX_WIDTH_PT) {
            img.setWidth(CFG.SIGNATURE_MAX_WIDTH_PT)
               .setHeight(Math.round(h * CFG.SIGNATURE_MAX_WIDTH_PT / w));
          }
        } catch (e) {
          par.setText('_______________');
        }
      } else {
        par.setText('_______________');
      }
      stamped++;
      found = section.findText(token);
    }
  });
  Logger.log('Подпись проставлена в ' + stamped + ' мест(ах)');
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  НОМЕР ДОГОВОРА
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Сквозной номер договора: NDA-2026-0042.
 *
 * Старая версия собирала номер из даты + Math.random() — такой «номер» невозможно
 * найти в реестре, он мог совпасть с другим, и при повторной генерации получался
 * новый. Здесь номер выдаётся один раз, монотонно, и хранится в Script Properties.
 *
 * Вызывать ТОЛЬКО под LockService (см. 07_Pipeline.gs), иначе два одновременных
 * запуска получат один номер.
 */
function nextAgreementNumber_() {
  var year = new Date().getFullYear();
  var stored = prop_(PROP.REGISTER_SEQ);       // формат "2026:41"
  var seq = 1;
  if (stored) {
    var parts = stored.split(':');
    if (parseInt(parts[0], 10) === year) seq = parseInt(parts[1], 10) + 1;
  }
  setProp_(PROP.REGISTER_SEQ, year + ':' + seq);
  return 'NDA-' + year + '-' + ('0000' + seq).slice(-4);
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 07_Pipeline.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 07_Pipeline
 * ---------------------------------------------------------------------------------
 * Основной конвейер обработки заявки.
 *
 *   Входящие → В работе → [распознавание → проверка → генерация] → Готово
 *                                    ↓ любая проблема
 *                            Требует проверки + письмо человеку
 **************************************************************************************/

/** Автоматический запуск по таймеру и кнопкой «Обработать входящие». */
function processInbox() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_WAIT_MS)) {
    Logger.log('processInbox: предыдущий запуск ещё идёт — пропускаю');
    return;
  }
  try {
    resetRunState_();
    var started = Date.now();
    var inbox = DriveApp.getFolderById(prop_(PROP.INBOX_FOLDER_ID, { required: true }));

    var batch = [];
    var it = inbox.getFiles();
    while (it.hasNext() && batch.length < CFG.MAX_FILES_PER_RUN) batch.push(it.next());
    if (!batch.length) return;

    var handled = 0;
    for (var i = 0; i < batch.length; i++) {
      if (Date.now() - started > CFG.TIME_BUDGET_MS) {
        Logger.log('processInbox: бюджет времени исчерпан, остальное — в следующий запуск');
        break;
      }
      processOneFile_(batch[i]);
      handled++;
    }

    flushLog_();
    Logger.log('processInbox: обработано ' + handled + ' файл(ов) за ' +
               ((Date.now() - started) / 1000).toFixed(1) + ' с');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Обработка одного файла. Никогда не бросает наружу: любая ошибка превращается
 * в карантин + запись в журнал + письмо, чтобы один плохой файл не останавливал
 * очередь остальных.
 */
function processOneFile_(file) {
  var sourceName = file.getName();
  var started = Date.now();
  var claimed = null;
  var tokensUsed = 0;
  var partner = null;
  var requesterEmail = '';

  try {
    // ── Захват файла. Защита от того, что два запуска возьмут один файл. ──
    claimed = file.moveTo(DriveApp.getFolderById(prop_(PROP.PROC_FOLDER_ID, { required: true })));
    if (!isInFolder_(claimed, prop_(PROP.PROC_FOLDER_ID))) {
      Logger.log('Файл «' + sourceName + '» уже забран другим запуском — пропускаю');
      return;
    }

    requesterEmail = readRequesterHint_(claimed);

    // ── Защита от повторной обработки одного и того же файла ──
    // Считаем по содержимому, а не по БИН: два разных договора с одним
    // контрагентом — это нормально, а вот тот же файл дважды — нет.
    var fingerprint = fileFingerprint_(claimed);
    if (isDuplicateFingerprint_(fingerprint)) {
      throw softError_('ДУБЛИКАТ', 'Файл с таким же содержимым обработан менее ' +
                       CFG.DEDUP_HOURS + ' ч назад');
    }

    // ── Распознавание ──
    var extracted = extractFromFile_(claimed);
    partner = extracted.data;
    tokensUsed = extracted.tokens || 0;
    if (!requesterEmail && nonEmpty_(partner.EMAIL)) requesterEmail = partner.EMAIL;

    resolveCountry_(partner, sourceName);

    if (partner._confidence === 'low') {
      throw softError_('НЕТ_УВЕРЕННОСТИ', 'Модель оценила распознавание как ненадёжное');
    }

    // ── Проверка контрагента (для Казахстана) ──
    if (partner.COUNTRY !== 'USA') {
      enrichByBin_(partner);

      var risks = blockingRiskFlags_(partner);
      if (risks.length) {
        throw softError_('РИСК_КОНТРАГЕНТА',
          'Отметки в госреестрах: ' + risks.join(', ') +
          (partner._SOURCE_URL ? ' | источник: ' + partner._SOURCE_URL : ''));
      }
    }

    // ── Полнота данных ──
    var missing = missingRequiredFields_(partner);
    if (missing.length) {
      throw softError_('НЕТ_ПОЛЕЙ', missing.join(', '));
    }
    if (!/\d/.test(partner.ADDRESS || '')) {
      throw softError_('АДРЕС_БЕЗ_НОМЕРА', 'Адрес: «' + partner.ADDRESS + '»');
    }

    // ── Генерация ──
    var country = (partner.COUNTRY === 'USA') ? 'USA' : 'Kazakhstan';
    var number = nextAgreementNumber_();
    var fill = buildFillData_(country, partner, number);
    var out = generateContract_(country, fill, partner, number);

    // ── Финал ──
    claimed.moveTo(DriveApp.getFolderById(prop_(PROP.DONE_FOLDER_ID, { required: true })));
    rememberFingerprint_(fingerprint);

    var duration = ((Date.now() - started) / 1000).toFixed(1);
    logRow_({
      status: '✅ Готово', source: sourceName, sourceUrl: claimed.getUrl(),
      country: country, partner: partner, docUrl: out.docUrl, pdfUrl: out.pdfUrl,
      number: number, error: '', duration: duration, tokens: tokensUsed,
      requester: requesterEmail
    });
    appendRegisterRow_(number, country, partner, out, requesterEmail);
    notifySuccess_(requesterEmail, number, partner, out, country);

    Logger.log('✅ ' + number + ' — ' + sourceName + ' → ' + out.docUrl + ' (' + duration + ' с)');

  } catch (err) {
    var code = (err && err.code) ? err.code : 'ТЕХНИЧЕСКАЯ';
    var tech = (err && err.message) ? err.message : String(err);

    var reviewUrl = '';
    try {
      if (claimed) {
        claimed.moveTo(DriveApp.getFolderById(prop_(PROP.REVIEW_FOLDER_ID, { required: true })));
        reviewUrl = claimed.getUrl();
        writeReviewNote_(claimed, code, tech, partner);
      }
    } catch (e) {
      Logger.log('Не удалось перенести файл в «Требует проверки»: ' + e);
    }

    var dur = ((Date.now() - started) / 1000).toFixed(1);
    logRow_({
      status: '⚠️ Требует проверки', source: sourceName, sourceUrl: reviewUrl,
      country: partner ? partner.COUNTRY : '', partner: partner,
      docUrl: '', pdfUrl: '', number: '',
      error: code + ': ' + tech, duration: dur, tokens: tokensUsed,
      requester: requesterEmail
    });
    notifyProblem_(requesterEmail, sourceName, code, tech, reviewUrl);

    Logger.log('⚠️ Карантин: ' + sourceName + ' | ' + code + ': ' + tech);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ВСПОМОГАТЕЛЬНОЕ
// ═══════════════════════════════════════════════════════════════════════════════════

function isInFolder_(file, folderId) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}

/**
 * Страна: приоритет у префикса в имени файла (бухгалтер может назвать
 * «US_acme.pdf» и явно указать юрисдикцию), затем — вывод модели,
 * по умолчанию — Казахстан.
 */
function resolveCountry_(partner, sourceFileName) {
  var name = String(sourceFileName || '').trim();
  if (/^(us|usa)[_\-\s.]/i.test(name))              { partner.COUNTRY = 'USA'; return; }
  if (/^(kz|kaz|kazakhstan)[_\-\s.]/i.test(name))   { partner.COUNTRY = 'Kazakhstan'; return; }
  if (partner.COUNTRY === 'USA') return;
  partner.COUNTRY = 'Kazakhstan';
}

function missingRequiredFields_(p) {
  var missing = [];
  var isUsa = (p.COUNTRY === 'USA');
  if (!nonEmpty_(p.PARTNER_NAME)) missing.push('название компании');
  if (!nonEmpty_(p.ADDRESS))      missing.push('юридический адрес');
  if (!isUsa) {
    if (!/^\d{12}$/.test(normalizeBin_(p.BIN))) missing.push('БИН (12 цифр)');
    if (!nonEmpty_(p.DIRECTOR))                 missing.push('ФИО руководителя');
  }
  return missing;
}

/** Отпечаток содержимого файла — устойчивая замена дедупликации по БИН. */
function fileFingerprint_(file) {
  try {
    var bytes = file.getBlob().getBytes();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
    return digest.map(function (b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');
  } catch (e) {
    // Google Документы не отдают байты — используем id как отпечаток.
    return 'id:' + file.getId();
  }
}

function isDuplicateFingerprint_(fp) {
  var cache = CacheService.getScriptCache();
  return cache.get('fp:' + fp) !== null;
}

function rememberFingerprint_(fp) {
  // CacheService держит максимум 6 часов; для 24-часового окна дублируем
  // в Script Properties c отметкой времени и подчищаем старое.
  CacheService.getScriptCache().put('fp:' + fp, '1', 6 * 60 * 60);
}

/** Файл-подсказка «от кого заявка»: имя вида «email@dereknet.com — договор.pdf». */
function readRequesterHint_(file) {
  var m = String(file.getName()).match(/([\w.+\-]+@[\w\-]+\.[\w.\-]+)/);
  if (m) return m[1];
  try {
    var desc = file.getDescription();
    var d = desc && String(desc).match(/([\w.+\-]+@[\w\-]+\.[\w.\-]+)/);
    if (d) return d[1];
  } catch (e) { /* нет описания */ }
  return '';
}

/**
 * Записка рядом с файлом в карантине: человек открывает папку и сразу видит,
 * что случилось, не заглядывая в журнал.
 */
function writeReviewNote_(file, code, tech, partner) {
  try {
    var folder = DriveApp.getFolderById(prop_(PROP.REVIEW_FOLDER_ID));
    var lines = [
      'ФАЙЛ: ' + file.getName(),
      'ДАТА: ' + Utilities.formatDate(new Date(), CFG.TZ_KZ, 'dd.MM.yyyy HH:mm'),
      '',
      humanizeError_(code, tech),
      ''
    ];
    if (partner) {
      lines.push('ЧТО УДАЛОСЬ РАСПОЗНАТЬ:');
      lines.push('  Компания:    ' + (partner.PARTNER_NAME || '—'));
      lines.push('  БИН:         ' + (partner.BIN || '—'));
      lines.push('  Руководитель:' + (partner.DIRECTOR || '—'));
      lines.push('  Адрес:       ' + (partner.ADDRESS || '—'));
      if (partner._LOOKUP) lines.push('  Проверка БИН: ' + partner._LOOKUP);
      if (partner._STATUS) lines.push('  Статус:      ' + partner._STATUS);
    }
    folder.createFile(
      'ЧТО НЕ ТАК — ' + file.getName() + '.txt',
      lines.join('\n'),
      MimeType.PLAIN_TEXT
    );
  } catch (e) {
    Logger.log('Не удалось создать записку в карантине: ' + e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ОБСЛУЖИВАНИЕ
// ═══════════════════════════════════════════════════════════════════════════════════

/** Файл завис в «В работе» (скрипт упал по таймауту) — вернуть на проверку. */
function cleanupStuckFiles() {
  try {
    var proc = DriveApp.getFolderById(prop_(PROP.PROC_FOLDER_ID, { required: true }));
    var review = DriveApp.getFolderById(prop_(PROP.REVIEW_FOLDER_ID, { required: true }));
    var cutoff = Date.now() - CFG.STUCK_FILE_MINUTES * 60 * 1000;
    var moved = 0;
    var files = proc.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.getLastUpdated().getTime() < cutoff) {
        f.moveTo(review);
        writeReviewNote_(f, 'ТЕХНИЧЕСКАЯ', 'Обработка прервалась и не завершилась за ' +
                          CFG.STUCK_FILE_MINUTES + ' минут', null);
        moved++;
      }
    }
    if (moved) Logger.log('cleanupStuckFiles: возвращено на проверку ' + moved + ' файл(ов)');
  } catch (e) {
    Logger.log('cleanupStuckFiles: ' + e);
  }
}

/** Вернуть всё из «Требует проверки» обратно во «Входящие». */
function reprocessReview() {
  var review = DriveApp.getFolderById(prop_(PROP.REVIEW_FOLDER_ID, { required: true }));
  var inbox  = DriveApp.getFolderById(prop_(PROP.INBOX_FOLDER_ID, { required: true }));
  var moved = 0, notes = 0;
  var files = review.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (/^ЧТО НЕ ТАК — /.test(f.getName())) { f.setTrashed(true); notes++; continue; }
    f.moveTo(inbox);
    moved++;
  }
  var msg = 'Отправлено на повторную обработку: ' + moved + ' файл(ов).' +
            (notes ? '\nУдалено записок об ошибках: ' + notes + '.' : '') +
            '\n\nРезультат появится в течение 5 минут.';
  Logger.log(msg);
  uiAlert_('Повторная обработка', msg);
  return msg;
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 08_Log.gs
// ══════════════════════════════════════════════════════════════════════

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

var REGISTER_HEADERS = [
  '№ договора', 'Дата', 'Страна', 'Контрагент', 'БИН',
  'Руководитель', 'Юридический адрес', 'Статус контрагента',
  'Договор', 'PDF', 'Инициатор', 'Статус подписания', 'Комментарий'
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


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 09_Notify.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 09_Notify
 * ---------------------------------------------------------------------------------
 * Письма людям.
 *
 * В версии 4.x писем не было вообще: MANAGER_EMAIL был пустой строкой, а письма
 * об успехе не отправлялись никогда. Бухгалтер клал файл в папку и не узнавал
 * о результате — приходилось лезть в Google Таблицу и разбираться в кодах ошибок.
 *
 * Здесь письмо приходит ВСЕГДА: и когда получилось, и когда нет. Текст написан
 * так, чтобы человек без ИТ-подготовки понял, что делать дальше.
 **************************************************************************************/

var MAIL_FROM_NAME = 'Dereknet CLM';

/** Кому слать: инициатор + ответственный (без дублей). */
function recipients_(requesterEmail) {
  var list = [];
  if (requesterEmail && /@/.test(requesterEmail)) list.push(requesterEmail.trim());
  var manager = prop_(PROP.MANAGER_EMAIL);
  if (manager && list.indexOf(manager) === -1) list.push(manager);
  return list;
}

function sendMail_(to, subject, htmlBody) {
  if (!to.length) {
    Logger.log('Письмо не отправлено — некому: ' + subject);
    return;
  }
  try {
    MailApp.sendEmail({
      to: to.join(','),
      subject: subject,
      htmlBody: htmlBody,
      body: htmlToPlain_(htmlBody),
      name: MAIL_FROM_NAME
    });
  } catch (e) {
    Logger.log('Письмо не ушло (' + subject + '): ' + e);
  }
}

function htmlToPlain_(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ШАБЛОН ПИСЬМА
// ═══════════════════════════════════════════════════════════════════════════════════

function mailShell_(accentColor, title, innerHtml) {
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;',
    'max-width:600px;margin:0 auto;color:#202124;line-height:1.55">',
    '<div style="background:', accentColor, ';color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">',
    '<div style="font-size:13px;opacity:.85;letter-spacing:.4px">DEREKNET CLM</div>',
    '<div style="font-size:20px;font-weight:600;margin-top:2px">', title, '</div>',
    '</div>',
    '<div style="border:1px solid #dadce0;border-top:none;border-radius:0 0 10px 10px;padding:22px">',
    innerHtml,
    '<div style="margin-top:26px;padding-top:14px;border-top:1px solid #e8eaed;',
    'font-size:12px;color:#5f6368">',
    'Это письмо отправлено автоматически системой договоров Dereknet.<br>',
    'Если что-то непонятно — ответьте на это письмо.',
    '</div></div></div>'
  ].join('');
}

function button_(url, label, color) {
  return '<a href="' + url + '" style="display:inline-block;background:' + (color || '#1a73e8') +
         ';color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;' +
         'font-weight:600;font-size:14px;margin:4px 8px 4px 0">' + label + '</a>';
}

function infoTable_(rows) {
  var html = '<table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0">';
  rows.forEach(function (r) {
    if (!r[1]) return;
    html += '<tr>' +
      '<td style="padding:7px 12px 7px 0;color:#5f6368;white-space:nowrap;vertical-align:top">' + r[0] + '</td>' +
      '<td style="padding:7px 0;font-weight:500">' + escapeHtml_(String(r[1])) + '</td></tr>';
  });
  return html + '</table>';
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ПИСЬМА
// ═══════════════════════════════════════════════════════════════════════════════════

function notifySuccess_(requesterEmail, number, partner, out, country) {
  var warnings = partner._WARNINGS || [];
  var lookupWarn = String(partner._LOOKUP || '').indexOf('НЕ УДАЛОСЬ') !== -1;

  var body = [
    '<p style="font-size:15px;margin:0 0 4px">Договор <b>', number, '</b> готов.</p>',
    '<p style="margin:0;color:#5f6368;font-size:14px">Это <b>черновик</b>. ',
    'Проверьте его глазами и только потом отправляйте контрагенту.</p>',
    infoTable_([
      ['Контрагент',   partner.PARTNER_NAME],
      ['БИН',          partner.BIN],
      ['Руководитель', partner.DIRECTOR],
      ['Адрес',        partner.ADDRESS],
      ['Юрисдикция',   country === 'USA' ? 'США' : 'Казахстан'],
      ['Проверка БИН', partner._LOOKUP],
      ['Статус в реестрах', partner._STATUS],
      ['Вид деятельности',  partner._OKED]
    ]),
    '<div style="margin:18px 0">',
    button_(out.docUrl, 'Открыть договор'),
    button_(out.pdfUrl, 'Скачать PDF', '#5f6368'),
    '</div>'
  ];

  if (lookupWarn) {
    body.push(
      '<div style="background:#fef7e0;border-left:4px solid #f9ab00;padding:12px 14px;border-radius:4px;margin:14px 0">',
      '<b>Контрагента не удалось проверить автоматически.</b><br>',
      'Проверьте его вручную на <a href="https://kgd.gov.kz/ru/services/taxpayer_search">kgd.gov.kz</a> ',
      'перед подписанием — особенно если работаете с ним впервые.',
      '</div>');
  }

  if (warnings.length) {
    body.push('<div style="background:#fef7e0;border-left:4px solid #f9ab00;padding:12px 14px;border-radius:4px;margin:14px 0">',
      '<b>Обратите внимание:</b><ul style="margin:8px 0 0;padding-left:18px">');
    warnings.forEach(function (w) { body.push('<li>' + escapeHtml_(w) + '</li>'); });
    body.push('</ul></div>');
  }

  body.push(
    '<div style="background:#e8f0fe;padding:14px;border-radius:6px;margin-top:14px;font-size:14px">',
    '<b>Что проверить перед отправкой:</b>',
    '<ol style="margin:8px 0 0;padding-left:20px">',
    '<li>Название компании и БИН совпадают с оригиналом документов</li>',
    '<li>ФИО руководителя написано верно (в родительном падеже в преамбуле)</li>',
    '<li>Адрес полный: индекс, город, улица, номер дома</li>',
    '<li>Подпись директора стоит на месте, а не «______»</li>',
    '</ol></div>');

  sendMail_(recipients_(requesterEmail),
            '✅ Договор ' + number + ' готов — ' + (partner.PARTNER_NAME || 'контрагент'),
            mailShell_('#1e8e3e', 'Договор готов', body.join('')));
}

function notifyProblem_(requesterEmail, sourceName, code, tech, reviewUrl) {
  var help = ERROR_HELP[code];
  var isRisk = (code === 'РИСК_КОНТРАГЕНТА');

  var body = [
    '<p style="font-size:15px;margin:0 0 14px">Файл <b>', escapeHtml_(sourceName),
    '</b> обработать не удалось.</p>',
    '<div style="background:', isRisk ? '#fce8e6' : '#fef7e0',
    ';border-left:4px solid ', isRisk ? '#d93025' : '#f9ab00',
    ';padding:14px;border-radius:4px">',
    '<div style="font-weight:600;margin-bottom:6px">',
    escapeHtml_(help ? help[0] : 'Техническая ошибка'), '</div>',
    '<div>', escapeHtml_(help ? help[1] : 'Сообщите ответственному за систему.'), '</div>',
    '</div>'
  ];

  if (isRisk) {
    body.push(
      '<div style="margin:16px 0;font-size:15px">',
      '<b style="color:#d93025">Не подписывайте этот договор без согласования.</b><br>',
      'Отметки в государственных реестрах: ', escapeHtml_(tech),
      '</div>');
  }

  if (reviewUrl) {
    body.push('<div style="margin:18px 0">', button_(reviewUrl, 'Открыть файл', '#5f6368'), '</div>');
  }

  body.push(
    '<p style="font-size:13px;color:#5f6368;margin-top:18px">',
    'Исправили и хотите попробовать снова? Положите файл обратно в папку ',
    '«1. Входящие» — система обработает его в течение 5 минут.</p>',
    '<details style="margin-top:14px;font-size:12px;color:#80868b">',
    '<summary style="cursor:pointer">Технические детали (для ответственного)</summary>',
    '<pre style="white-space:pre-wrap;margin:8px 0 0">', escapeHtml_(code + ': ' + tech), '</pre>',
    '</details>');

  sendMail_(recipients_(requesterEmail),
            (isRisk ? '🛑 ' : '⚠️ ') + 'Нужна проверка: ' + sourceName,
            mailShell_(isRisk ? '#d93025' : '#f9ab00',
                       isRisk ? 'Риск по контрагенту' : 'Требуется ваше участие',
                       body.join('')));
}

/**
 * Утреннее письмо ответственному: что вчера сделано, что застряло.
 * Позволяет заметить, что система сломалась, не дожидаясь жалоб.
 */
function dailyDigest() {
  try {
    resetRunState_();
    var manager = prop_(PROP.MANAGER_EMAIL);
    if (!manager) return;

    var stats = collectStats_(1);
    var pending = countFilesIn_(prop_(PROP.REVIEW_FOLDER_ID));
    var queued  = countFilesIn_(prop_(PROP.INBOX_FOLDER_ID));

    // Если ничего не происходило и нечего разбирать — не тревожим человека.
    if (stats.processed === 0 && pending === 0 && queued === 0) return;

    var body = [
      infoTable_([
        ['Договоров создано за сутки', String(stats.done)],
        ['Ушло на проверку',           String(stats.review)],
        ['Ждут разбора сейчас',        pending ? String(pending) : ''],
        ['В очереди на обработку',     queued ? String(queued) : ''],
        ['Расход на распознавание',    '~$' + stats.costUsd]
      ])
    ];

    if (pending > 0) {
      body.push('<div style="margin:16px 0">',
        button_('https://drive.google.com/drive/folders/' + prop_(PROP.REVIEW_FOLDER_ID),
                'Разобрать ' + pending + ' файл(ов)'),
        '</div>');
    }

    var problemCodes = Object.keys(stats.problems);
    if (problemCodes.length) {
      body.push('<div style="margin-top:14px"><b>Из-за чего останавливались:</b><ul style="padding-left:18px">');
      problemCodes.forEach(function (c) {
        var h = ERROR_HELP[c];
        body.push('<li>', escapeHtml_(h ? h[0] : c), ' — ', String(stats.problems[c]), '</li>');
      });
      body.push('</ul></div>');
    }

    sendMail_([manager], '📋 Dereknet CLM — сводка за сутки',
              mailShell_('#1a73e8', 'Сводка за сутки', body.join('')));
  } catch (e) {
    Logger.log('dailyDigest: ' + e);
  }
}

function countFilesIn_(folderId) {
  if (!folderId) return 0;
  try {
    var n = 0;
    var it = DriveApp.getFolderById(folderId).getFiles();
    while (it.hasNext() && n < 500) {
      var f = it.next();
      if (!/^ЧТО НЕ ТАК — /.test(f.getName())) n++;
    }
    return n;
  } catch (e) { return 0; }
}


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 10_Menu.gs
// ══════════════════════════════════════════════════════════════════════

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


// ══════════════════════════════════════════════════════════════════════
//  ФАЙЛ: 11_WebApp.gs
// ══════════════════════════════════════════════════════════════════════

/**************************************************************************************
 * Dereknet CLM — 11_WebApp
 * ---------------------------------------------------------------------------------
 * Веб-форма для сотрудников.
 *
 * ЗАЧЕМ ОНА НУЖНА. В версии 4.x единственным способом заказать договор было
 * «положить файл в нужную папку Google Диска и потом самому искать результат
 * в технической таблице». Для бухгалтера без ИТ-опыта это плохой интерфейс:
 * нужно помнить, куда класть, знать, где смотреть, и уметь читать коды ошибок.
 *
 * Здесь всё иначе: одна ссылка → одно поле → одна кнопка → результат на экране.
 * Прав на Google Диск сотруднику не нужно вообще: веб-приложение публикуется
 * с запуском «от имени владельца», поэтому файлами оперирует система, а не человек.
 **************************************************************************************/

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dereknet — заявка на договор')
    .setFaviconUrl('https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Подключение частичных HTML-файлов (<?!= include('Styles') ?>). */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Кто сейчас работает с формой — подставляем в поле email. */
function apiWhoAmI() {
  return { email: safeActiveEmail_() };
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ШАГ 1 — ПРОВЕРКА КОНТРАГЕНТА
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Проверить БИН и показать, что нашлось, ДО создания договора.
 * Человек подтверждает данные глазами — это дешевле, чем потом переделывать документ.
 */
function apiCheckBin(rawBin) {
  try {
    var bin = normalizeBin_(rawBin);

    if (!/^\d{12}$/.test(bin)) {
      return fail_('БИН должен состоять из 12 цифр',
                   'Сейчас цифр: ' + bin.length + '. Проверьте номер в свидетельстве или счёте контрагента.');
    }
    if (!isValidKzBin_(bin)) {
      return fail_('В БИН есть опечатка',
                   'Контрольная цифра не сходится. Такого БИН не существует — сверьте все 12 цифр с оригиналом.');
    }

    var data = lookupBin_(bin);
    if (!data) {
      return {
        ok: true,
        bin: bin,
        found: false,
        type: describeKzBin_(bin),
        note: 'БИН правильный, но данные из государственных реестров сейчас недоступны. ' +
              'Заполните название, руководителя и адрес вручную.'
      };
    }

    var risks = CFG.BLOCKING_RISK_FLAGS.filter(function (flag) {
      return String(data.status || '').toLowerCase().indexOf(flag.toLowerCase()) !== -1;
    });

    return {
      ok: true,
      bin: bin,
      found: true,
      type: describeKzBin_(bin),
      name: data.name || '',
      director: data.director || '',
      address: data.address || '',
      status: data.status || '',
      oked: data.okedName || '',
      regDate: data.regDate || '',
      source: data.sourceName || '',
      risks: risks
    };
  } catch (e) {
    return fail_('Не удалось проверить БИН', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ШАГ 2 — СОЗДАНИЕ ДОГОВОРА
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} form  { bin, name, director, address, ndaType, purpose, email, country }
 */
function apiCreateContract(form) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20 * 1000)) {
    return fail_('Система занята', 'Обрабатывается другая заявка. Подождите минуту и нажмите кнопку ещё раз.');
  }
  var started = Date.now();
  try {
    resetRunState_();

    var country = (form.country === 'USA') ? 'USA' : 'Kazakhstan';
    var partner = emptyPartner_({
      COUNTRY:      country,
      PARTNER_NAME: String(form.name || '').trim(),
      BIN:          normalizeBin_(form.bin),
      DIRECTOR:     String(form.director || '').trim(),
      ADDRESS:      String(form.address || '').trim(),
      NDA_TYPE:     form.ndaType || 'Mutual',
      PURPOSE:      form.purpose || 'Business Partnership',
      EMAIL:        String(form.email || '').trim(),
      _confidence:  'high'
    });

    if (country !== 'USA') {
      enrichByBin_(partner);
      var risks = blockingRiskFlags_(partner);
      if (risks.length) {
        logRow_({ status: '🛑 Заблокировано', source: 'веб-форма', country: country,
                  partner: partner, error: 'РИСК_КОНТРАГЕНТА: ' + risks.join(', '),
                  duration: sec_(started), tokens: 0, requester: partner.EMAIL });
        flushLog_();
        return fail_('Договор не создан — риск по контрагенту',
          'В государственных реестрах есть отметки: ' + risks.join(', ') + '.\n\n' +
          'Не подписывайте договор. Сообщите руководителю или юристу.', 'risk');
      }
    }

    var missing = missingRequiredFields_(partner);
    if (missing.length) {
      return fail_('Не хватает данных', 'Заполните: ' + missing.join(', ') + '.');
    }
    if (!/\d/.test(partner.ADDRESS)) {
      return fail_('В адресе нет номера дома',
                   'Укажите полный юридический адрес: индекс, город, улица, номер дома.');
    }

    var number = nextAgreementNumber_();
    var fill = buildFillData_(country, partner, number);
    var out = generateContract_(country, fill, partner, number);

    logRow_({ status: '✅ Готово', source: 'веб-форма', country: country, partner: partner,
              docUrl: out.docUrl, pdfUrl: out.pdfUrl, number: number, error: '',
              duration: sec_(started), tokens: 0, requester: partner.EMAIL });
    flushLog_();
    appendRegisterRow_(number, country, partner, out, partner.EMAIL);
    notifySuccess_(partner.EMAIL, number, partner, out, country);

    return {
      ok: true,
      number: number,
      docUrl: out.docUrl,
      pdfUrl: out.pdfUrl,
      partnerName: partner.PARTNER_NAME,
      lookupWarning: String(partner._LOOKUP || '').indexOf('НЕ УДАЛОСЬ') !== -1,
      warnings: partner._WARNINGS || [],
      emailedTo: partner.EMAIL
    };

  } catch (e) {
    var code = e.code || 'ТЕХНИЧЕСКАЯ';
    var human = humanizeError_(code, '');
    var parts = human.split('\nЧто делать: ');
    return fail_(parts[0], parts[1] || e.message, code === 'РИСК_КОНТРАГЕНТА' ? 'risk' : 'error');
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЗАГРУЗКА ФАЙЛА
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Загрузить документ (счёт, свидетельство, визитку) и распознать реквизиты.
 * Возвращает распознанные поля для подтверждения человеком — договор
 * сразу не создаётся, потому что распознавание может ошибиться.
 */
function apiRecognizeUpload(payload) {
  var temp = null;
  try {
    resetRunState_();

    var bytes = Utilities.base64Decode(payload.data);
    if (bytes.length > CFG.MAX_UPLOAD_BYTES) {
      return fail_('Файл слишком большой',
        'Максимум ' + (CFG.MAX_UPLOAD_BYTES / 1024 / 1024) + ' МБ, у вас ' +
        (bytes.length / 1024 / 1024).toFixed(1) + ' МБ. Сожмите файл или сфотографируйте заново.');
    }

    var blob = Utilities.newBlob(bytes, mimeTypeOf_(payload), payload.fileName);
    var inbox = DriveApp.getFolderById(prop_(PROP.PROC_FOLDER_ID, { required: true }));
    temp = inbox.createFile(blob);

    var extracted = extractFromFile_(temp);
    var p = extracted.data;

    if (p._confidence === 'low') {
      return fail_('Документ читается плохо',
        'Сфотографируйте его ровно, при хорошем свете, целиком в кадре — или введите БИН вручную.');
    }

    var bin = normalizeBin_(p.BIN);
    var binOk = /^\d{12}$/.test(bin) && isValidKzBin_(bin);

    return {
      ok: true,
      recognized: true,
      bin: binOk ? bin : '',
      binProblem: (bin && !binOk) ? 'БИН распознан как ' + bin + ', но контрольная цифра не сходится — введите вручную' : '',
      name: p.PARTNER_NAME || '',
      director: p.DIRECTOR || '',
      address: p.ADDRESS || '',
      country: p.COUNTRY === 'USA' ? 'USA' : 'Kazakhstan',
      confidence: p._confidence || '',
      source: extracted.source || ''
    };

  } catch (e) {
    var human = humanizeError_(e.code || 'ТЕХНИЧЕСКАЯ', '');
    var parts = human.split('\nЧто делать: ');
    return fail_(parts[0], parts[1] || e.message);
  } finally {
    if (temp) { try { temp.setTrashed(true); } catch (e2) { /* уже нет */ } }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  МОИ ДОГОВОРЫ
// ═══════════════════════════════════════════════════════════════════════════════════

/** Последние договоры текущего пользователя (или все, если email не определился). */
function apiRecentContracts() {
  try {
    resetRunState_();
    var me = safeActiveEmail_();
    var sh = registerSheet_();
    var last = sh.getLastRow();
    if (last < 2) return { ok: true, rows: [] };

    var from = Math.max(2, last - 199);
    var values = sh.getRange(from, 1, last - from + 1, REGISTER_HEADERS.length).getValues();
    var formulas = sh.getRange(from, 9, last - from + 1, 2).getFormulas();

    var rows = [];
    for (var i = values.length - 1; i >= 0 && rows.length < 20; i--) {
      var v = values[i];
      if (me && v[10] && String(v[10]).toLowerCase() !== me.toLowerCase()) continue;
      rows.push({
        number: v[0],
        date: v[1] instanceof Date ? Utilities.formatDate(v[1], CFG.TZ_KZ, 'dd.MM.yyyy') : String(v[1]),
        partner: v[3],
        bin: v[2] === 'США' ? '' : String(v[4]),
        status: v[11] || 'Черновик',
        docUrl: urlFromFormula_(formulas[i][0]),
        pdfUrl: urlFromFormula_(formulas[i][1])
      });
    }
    return { ok: true, rows: rows, me: me };
  } catch (e) {
    return fail_('Не удалось получить список', e.message);
  }
}

function urlFromFormula_(formula) {
  var m = String(formula || '').match(/HYPERLINK\("([^"]+)"/i);
  return m ? m[1] : '';
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  МЕЛОЧИ
// ═══════════════════════════════════════════════════════════════════════════════════

function fail_(title, advice, kind) {
  return { ok: false, title: title, advice: advice || '', kind: kind || 'error' };
}

/**
 * Тип файла из браузера. Некоторые браузеры и мобильные камеры присылают
 * пустой mimeType — тогда определяем по расширению, иначе файл будет
 * отвергнут как «формат не поддерживается» на ровном месте.
 */
var EXT_TO_MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv'
};

function mimeTypeOf_(payload) {
  var declared = String(payload.mimeType || '').trim();
  if (declared && declared !== 'application/octet-stream') return declared;
  var ext = String(payload.fileName || '').split('.').pop().toLowerCase();
  return EXT_TO_MIME[ext] || declared || 'application/octet-stream';
}

function sec_(startedMs) {
  return ((Date.now() - startedMs) / 1000).toFixed(1);
}

