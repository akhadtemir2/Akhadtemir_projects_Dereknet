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
  EMAIL:               'info@dereknet.com',
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
