/**************************************************************************************
 * Dereknet CLM — Inbox Processor v4.2
 * Fixes over v4.1:
 * [BUG-1]  Template: orphan 'ё' in signature block           → fixTemplateBugs_()
 * [BUG-2]  Template: '»' rendered as '>>>>'                  → fixTemplateBugs_()
 * [BUG-3]  Template: Latin B/c instead of Cyrillic В/с       → fixTemplateBugs_()
 * [BUG-4]  Grammar:  genitive case for disclosing party       → _GEN tokens + fixTemplateBugs_()
 * [BUG-5]  Grammar:  зарегистрированная must agree with form  → inferRegAgreementRu_()
 * [BUG-6]  Parsing:  parseDirector_ double-name (GULFAYR x2) → 4-word regex limit
 * [BUG-7]  Data:     RECEIVING_PARTY_TAX_ID had "БИН " prefix → now bare number
 * [BUG-8]  Data:     Russian address/name in English column   → transliteration tokens
 * [BUG-9]  Layout:   Signature image distorted (160×60 forced) → natural size, max 200pt
 * BONUS    Legal:    Receiving party preambula lacks rep clause → new tokens + fixTemplateBugs_()
 *
 * ⚠️  FIRST RUN: execute fixTemplateBugs_() ONCE from the CLM menu to patch the template.
 *    After that, all generated contracts will use the corrected token layout.
 **************************************************************************************/

const CFG = {
  INBOX_FOLDER_ID:      '1QnZiNAoQyB9n0C_htPmPxd_5QBEcx61D',
  PROCESSING_FOLDER_ID: '1t3Pp0TSGhlmF_vXogSd_swdXiNVfVxZ2',
  DONE_FOLDER_ID:       '1kP5CpzG9JsywZzNcAAiqdyzANhAqKgq1',
  REVIEW_FOLDER_ID:     '1TewoxfJXMrCqkD5hItB0nlEXVc64Gz2F',
  OUTPUT_FOLDER_ID:     '1DjBy5bRS5ctZ4MSvfKuukIaqkdxw-Qt5',
  LOG_SHEET_ID:         '12FRwhImBk7ReIEt38rcKVpeyGGOpEMHhNsNMisHOKOw',
  LOG_SHEET_NAME:       'CLM_Audit_Log',
  MANAGER_EMAIL:        '',
  MAX_FILES_PER_RUN:    5,
  TIME_BUDGET_MS:       50 * 1000,
  LOCK_WAIT_MS:         30 * 1000,
  OCR_LANGUAGE:         'ru',
  OPENAI_MODEL:         'gpt-4o-mini',
  OPENAI_MAX_RETRIES:   3,
  OPENAI_MAX_TOKENS:    500,
  MIN_OCR_CHARS:        40,
  MIN_OCR_LETTERS:      20,
  IMAGE_DOWNSIZE_BYTES: 1.5 * 1024 * 1024,
  DEDUP_HOURS:          24,
  BIN_CACHE_SECONDS:    6 * 60 * 60,
  VISION_ALLOWED_MIMES: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
};

// ═══════════════════════════════════════════════════════════════════════
//  DEREKNET DATA — Disclosing party (fixed)
// ═══════════════════════════════════════════════════════════════════════
var DEREKNET = {
  NAME_RU:             'ТОО «Dereknet»',
  NAME_EN:             'Dereknet LLP',
  BIN:                 '190440019884',
  CITY_RU:             'Атырау',
  ADDR_RU:             '060016, Республика Казахстан, г. Атырау, ул. Сатпаева 23А',
  ADDR_EN:             '060016, Kazakhstan, Atyrau city, Satpayev Street, 23A',
  PHONE:               '+7 702 672 45 07',
  EMAIL:               'info@dereknet.com',
  IIK:                 'KZ41601A141000897321',
  BIK:                 'HSBKKZKX',
  BANK_RU:             'АО «Народный банк Казахстана»',
  BANK_EN:             'JSC Halyk Bank',
  // Nominative — used in signature block label ("Директор / Кабдулов С.Ш.")
  REP_POSITION_RU:     'Директор',
  REP_POSITION_EN:     'Director',
  REP_NAME_RU:         'Кабдулов Саламат Шамарданович',
  REP_NAME_EN:         'Salamat Kabdulov',
  // [BUG-4] Genitive — used in preambula "в лице Директора Кабдулова…"
  REP_POSITION_RU_GEN: 'Директора',
  REP_NAME_RU_GEN:     'Кабдулова Саламата Шамардановича',
  BASIS_RU:            'Устава',
  BASIS_EN:            'Charter',
  // Backward-compat aliases
  get DIRECTOR() { return this.REP_POSITION_RU + 'а ' + this.REP_NAME_RU; },
  get REP_EN()   { return 'Authorized Representative'; },
  BANK:            'АО «Народный банк Казахстана»',
  ADDR:            'г. Атырау, Республика Казахстан',
  BASIS:           'Устава',
  NAME_EN_SHORT:   'Dereknet'
};

// ══════════════════════════════════════════════════════════════════════
//  IN-MEMORY CACHES
// ══════════════════════════════════════════════════════════════════════
var _folders  = {};
var _logSheet = null;
var _logBuffer = [];

function folder_(id) {
  if (!_folders[id]) _folders[id] = DriveApp.getFolderById(id);
  return _folders[id];
}

function getLogSheet_() {
  if (_logSheet) return _logSheet;
  const ss = SpreadsheetApp.openById(CFG.LOG_SHEET_ID);
  let sh = ss.getSheetByName(CFG.LOG_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CFG.LOG_SHEET_NAME);
    sh.appendRow([
      'Время', 'Статус', 'Исходный файл', 'Страна',
      'Партнёр', 'БИН', 'Ссылка на договор', 'Ошибка',
      'Статус контрагента', 'ОКЭД', 'Дата регистрации',
      'Длительность (с)', 'Токены OpenAI', 'Confidence'
    ]);
    sh.setFrozenRows(1);
    sh.getRange('1:1').setFontWeight('bold');
  }
  _logSheet = sh;
  return _logSheet;
}

// ══════════════════════════════════════════════════════════════════════
//  TEMPLATE FILL
// ══════════════════════════════════════════════════════════════════════
function fillTemplate_(body, data) {
  Object.keys(data).forEach(function(key) {
    const value = (data[key] === undefined || data[key] === null || data[key] === '')
                  ? '—'
                  : String(data[key]);
    body.replaceText('\\{\\{' + key + '\\}\\}', value);
  });
}

function fillKZ(body, d) { fillTemplate_(body, d); }

function fillUS(body, d) {
  const isUnilateral = (d.NDA_TYPE || '').indexOf('Unilateral') !== -1;
  body.replaceText('\\{\\{CHECK_UNILATERAL\\}\\}', isUnilateral ? '☑' : '☐');
  body.replaceText('\\{\\{CHECK_MUTUAL\\}\\}',     isUnilateral ? '☐' : '☑');
  const purposes = ['Employment','Contract Work','Business Partnership','Sale of a Business','Other'];
  purposes.forEach(function(p) {
    const key = 'CHECK_' + p.toUpperCase().replace(/ /g,'_');
    body.replaceText('\\{\\{' + key + '\\}\\}', d.PURPOSE === p ? '☑' : '☐');
  });
  fillTemplate_(body, d);
}

// ══════════════════════════════════════════════════════════════════════
//  LEGAL FORM HELPERS — [BUG-5] [BUG-9]
// ══════════════════════════════════════════════════════════════════════
function inferLegalFormRu_(name) {
  const n = String(name || '').toUpperCase();
  if (/^ТОО\b|^ТОВАРИЩЕСТВО/.test(n))  return 'товарищество с ограниченной ответственностью';
  if (/^АО\b|^АКЦИОНЕРНОЕ/.test(n))    return 'акционерное общество';
  if (/^ИП\b/.test(n))                  return 'индивидуальный предприниматель';
  if (/\bLLC\b/.test(n))                return 'компания с ограниченной ответственностью';
  if (/\bINC\b|\bCORP\b/.test(n))       return 'корпорация';
  if (/\bLTD\b/.test(n))                return 'компания с ограниченной ответственностью';
  return 'юридическое лицо';
}

function inferLegalFormEn_(name) {
  const n = String(name || '').toUpperCase();
  if (/^ТОО\b|^ТОВАРИЩЕСТВО/.test(n))  return 'a limited liability partnership';
  if (/^АО\b|^АКЦИОНЕРНОЕ/.test(n))    return 'a joint-stock company';
  if (/^ИП\b/.test(n))                  return 'an individual entrepreneur';
  if (/\bLLC\b/.test(n))                return 'a limited liability company';
  if (/\bINC\b|\bCORP\b/.test(n))       return 'a corporation';
  if (/\bLTD\b/.test(n))                return 'a limited company';
  return 'a legal entity';
}

// [BUG-5] Returns correct Russian agreement adjective for "зарегистрирован*"
// ТОО (товарищество) and АО (общество) are neuter → зарегистрированное
// ИП (предприниматель) is masculine → зарегистрированный
// компания / LLC / etc. are feminine → зарегистрированная
function inferRegAgreementRu_(name) {
  const n = String(name || '').toUpperCase();
  if (/^(ТОО|АО|ООО|ЗАО|ПАО|ОАО)\b/.test(n))  return 'зарегистрированное';
  if (/ТОВАРИЩЕСТВО|ОБЩЕСТВО/.test(n))            return 'зарегистрированное';
  if (/^ИП\b|ПРЕДПРИНИМАТЕЛЬ/.test(n))            return 'зарегистрированный';
  return 'зарегистрированная';
}

// [BONUS] Infer representative title for receiving party (nominative)
function inferRepPositionRu_(name) {
  const n = String(name || '').toUpperCase();
  if (/^АО\b/.test(n)) return 'Председатель Правления';
  if (/^ИП\b/.test(n)) return 'Индивидуальный предприниматель';
  return 'Директор';
}

function inferRepPositionEn_(name) {
  const n = String(name || '').toUpperCase();
  if (/^АО\b/.test(n)) return 'Chairman of the Management Board';
  if (/^ИП\b/.test(n)) return 'Individual Entrepreneur';
  return 'Director';
}

function transliterateRuToEn_(s) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    'қ':'q','ң':'ng','ғ':'g','ү':'u','ұ':'u','ө':'o','ә':'a','і':'i','һ':'h'
  };
  return String(s || '').split('').map(function(ch) {
    const lower = ch.toLowerCase();
    const tr = map[lower];
    if (tr === undefined) return ch;
    return ch === lower ? tr : (tr ? tr[0].toUpperCase() + tr.slice(1) : tr);
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════════════════════
function processInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_WAIT_MS)) {
    Logger.log('processInbox: предыдущий запуск ещё активен — пропускаю.');
    return;
  }
  try {
    _folders = {};
    _logSheet = null;
    _logBuffer = [];
    const started = Date.now();
    const inbox = folder_(CFG.INBOX_FOLDER_ID);
    if (!inbox.getFiles().hasNext()) return;
    const filesIter = inbox.getFiles();
    const snapshot  = [];
    while (filesIter.hasNext() && snapshot.length < CFG.MAX_FILES_PER_RUN) {
      snapshot.push(filesIter.next());
    }
    let count = 0;
    for (let i = 0; i < snapshot.length; i++) {
      if (Date.now() - started > CFG.TIME_BUDGET_MS) {
        Logger.log('processInbox: бюджет времени исчерпан.');
        break;
      }
      count++;
      handleOneFile_(snapshot[i]);
    }
    flushLogBuffer_();
    Logger.log('processInbox: обработано ' + count + ' файл(ов) за ' +
               ((Date.now() - started) / 1000).toFixed(1) + ' сек.');
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SINGLE FILE HANDLER
// ══════════════════════════════════════════════════════════════════════
function handleOneFile_(file) {
  const sourceName = file.getName();
  const startTime  = Date.now();
  let claimed     = null;
  let tokensUsed  = 0;
  let confidence  = '';
  try {
    claimed = file.moveTo(folder_(CFG.PROCESSING_FOLDER_ID));
    const parents = claimed.getParents();
    let stillOurs = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === CFG.PROCESSING_FOLDER_ID) { stillOurs = true; break; }
    }
    if (!stillOurs) {
      Logger.log('Race condition: файл уже забран другим запуском — ' + sourceName);
      return;
    }
    const extracted = extractFromFile_(claimed);
    const partner = extracted.data;
    tokensUsed = extracted.tokens || 0;
    confidence = partner._confidence || '';
    resolveCountry_(partner, sourceName);
    if (partner.COUNTRY !== 'USA') {
      enrichByBinLookup_(partner);
    }
    if (partner.BIN && isDuplicate_(partner.BIN)) {
      throw softError_('DUPLICATE',
        'БИН ' + partner.BIN + ' уже обрабатывался за последние ' + CFG.DEDUP_HOURS + ' ч');
    }
    if (confidence === 'low') {
      throw softError_('LOW_CONFIDENCE', 'OpenAI вернул confidence=low — нужна ручная проверка');
    }
    const missing = validateRequired_(partner);
    if (missing.length) {
      throw softError_('MISSING_FIELDS', 'Не хватает полей: ' + missing.join(', '));
    }
    if (!/\d/.test(partner.ADDRESS || '')) {
      throw softError_('BAD_ADDRESS', 'Адрес без номера дома: "' + partner.ADDRESS + '"');
    }
    const country = (partner.COUNTRY === 'USA') ? 'USA' : 'Kazakhstan';
    const fill    = buildFillData_(country, partner);
    const docUrl  = generateSignedContract_(country, fill, partner);
    claimed.moveTo(folder_(CFG.DONE_FOLDER_ID));
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    bufferLogRow_('✅ DONE', sourceName, country, partner, docUrl, '', duration, tokensUsed, confidence);
    Logger.log('Готово: ' + sourceName + ' → ' + docUrl + ' (' + duration + 'с)');
  } catch (err) {
    try {
      if (claimed) claimed.moveTo(folder_(CFG.REVIEW_FOLDER_ID));
    } catch (e) {
      Logger.log('Не смог перенести в Needs Review: ' + e);
    }
    const reason = (err && err.code) ? (err.code + ': ' + err.message) : String(err);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    bufferLogRow_('⚠️ NEEDS_REVIEW', sourceName, '', null, '', reason, duration, tokensUsed, confidence);
    notifyManager_(sourceName, reason);
    Logger.log('Карантин: ' + sourceName + ' | ' + reason);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DEDUPLICATION / COUNTRY / EXTRACTION
// ══════════════════════════════════════════════════════════════════════
function isDuplicate_(bin) {
  try {
    const sh = getLogSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return false;
    const startRow = Math.max(2, lastRow - 49);
    const numRows  = lastRow - startRow + 1;
    const data     = sh.getRange(startRow, 1, numRows, 6).getValues();
    const cutoffMs = Date.now() - CFG.DEDUP_HOURS * 60 * 60 * 1000;
    for (let i = 0; i < data.length; i++) {
      const rowTime   = data[i][0];
      const rowStatus = data[i][1];
      const rowBin    = String(data[i][5] || '');
      if (rowBin === bin &&
          rowStatus.indexOf('DONE') !== -1 &&
          rowTime instanceof Date &&
          rowTime.getTime() > cutoffMs) {
        return true;
      }
    }
    return false;
  } catch (e) {
    Logger.log('isDuplicate_ упал: ' + e);
    return false;
  }
}

function resolveCountry_(partner, sourceFileName) {
  const fname = String(sourceFileName || '').trim();
  if (/^(us|usa)[_\-\s.]/i.test(fname)) { partner.COUNTRY = 'USA'; return; }
  if (/^(kz|kazakhstan|kaz)[_\-\s.]/i.test(fname)) { partner.COUNTRY = 'Kazakhstan'; return; }
  if (partner.COUNTRY === 'USA') return;
  partner.COUNTRY = 'Kazakhstan';
}

function extractFromFile_(file) {
  const mime = file.getMimeType();
  if (mime.indexOf('image/') === 0) {
    if (CFG.VISION_ALLOWED_MIMES.indexOf(mime) === -1) {
      throw softError_('UNSUPPORTED_IMAGE',
        'Формат не поддерживается Vision: ' + mime + '. Пересохрани в JPEG/PNG.');
    }
    const blob = maybeDownsizeImage_(file);
    return extractPartnerDataFromImage_(blob);
  }
  if (mime === 'application/pdf') {
    const text = ocrPdfToText_(file);
    return extractFromPlainText_(text, 'PDF (OCR)');
  }
  if (mime === 'application/vnd.google-apps.document') {
    const text = DocumentApp.openById(file.getId()).getBody().getText();
    return extractFromPlainText_(text, 'Google Doc');
  }
  if (mime === 'text/plain') {
    const text = file.getBlob().getDataAsString('UTF-8');
    return extractFromPlainText_(text, 'текстовый файл');
  }
  throw softError_('UNSUPPORTED', 'Формат не поддерживается: ' + mime);
}

function maybeDownsizeImage_(file) {
  const blob  = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length < CFG.IMAGE_DOWNSIZE_BYTES) return blob;
  Logger.log('Большая картинка (' + (bytes.length / 1024 / 1024).toFixed(1) + ' МБ) — пробую thumbnail');
  try {
    if (typeof Drive !== 'undefined' && Drive.Files) {
      const meta = Drive.Files.get(file.getId(), { fields: 'thumbnailLink' });
      if (meta && meta.thumbnailLink) {
        const bigThumb = meta.thumbnailLink.replace(/=s\d+/, '=s1600');
        const small = UrlFetchApp.fetch(bigThumb, { muteHttpExceptions: true });
        if (small.getResponseCode() === 200) {
          return small.getBlob().setContentType(blob.getContentType());
        }
      }
    }
  } catch (e) { Logger.log('Downsize не получился, шлю оригинал: ' + e); }
  return blob;
}

function ocrPdfToText_(pdfFile) {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw softError_('NO_DRIVE_API', 'Drive API v2 не подключён.');
  }
  let tempDocId = null;
  try {
    const resource = {
      title:    'OCR_TMP_' + pdfFile.getName() + '_' + Date.now(),
      mimeType: 'application/vnd.google-apps.document'
    };
    const ocrFile = Drive.Files.insert(resource, pdfFile.getBlob(), {
      ocr: true, ocrLanguage: CFG.OCR_LANGUAGE
    });
    tempDocId = ocrFile.id;
    const text = DocumentApp.openById(tempDocId).getBody().getText();
    Logger.log('PDF OCR: ' + text.length + ' симв.');
    return text;
  } catch (e) {
    throw softError_('PDF_OCR_FAILED', 'Drive OCR упал: ' + e.message);
  } finally {
    if (tempDocId) {
      try { DriveApp.getFileById(tempDocId).setTrashed(true); }
      catch (e) { Logger.log('OCR-doc cleanup: ' + e); }
    }
  }
}

function extractFromPlainText_(text, sourceLabel) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw softError_('EMPTY_TEXT', sourceLabel + ' пустой.');
  const binMatch = trimmed.match(/\b(\d{12})\b/);
  if (binMatch && trimmed.length < 50) {
    Logger.log('Голый БИН: ' + binMatch[1]);
    return {
      data: {
        COUNTRY: '', PARTNER_NAME: '', BIN: binMatch[1], DIRECTOR: '',
        ADDRESS: '', IIK: '', BANK: '', BIK: '',
        NDA_TYPE: 'Mutual', PURPOSE: 'Business Partnership', EMAIL: ''
      },
      tokens: 0
    };
  }
  if (trimmed.length < CFG.MIN_OCR_CHARS) {
    throw softError_('TEXT_TOO_SHORT', sourceLabel + ' слишком короткий: ' + trimmed.length + ' симв.');
  }
  const letters = (trimmed.match(/[А-ЯЁA-Zа-яёa-z]/g) || []).length;
  if (letters < CFG.MIN_OCR_LETTERS) {
    throw softError_('TEXT_NO_LETTERS', sourceLabel + ' мало букв: ' + letters);
  }
  return extractPartnerData_(trimmed);
}

// ══════════════════════════════════════════════════════════════════════
//  OPENAI VISION / TEXT
// ══════════════════════════════════════════════════════════════════════
function extractPartnerDataFromImage_(blob) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) throw softError_('NO_API_KEY', 'OPENAI_API_KEY не задан.');
  const mimeType = blob.getContentType();
  const base64   = Utilities.base64Encode(blob.getBytes());
  const dataUrl  = 'data:' + mimeType + ';base64,' + base64;
  const system = 'Ты — помощник по извлечению реквизитов. Верни ТОЛЬКО валидный JSON без markdown. ' +
                 'Если поля нет — пустая строка "". НИЧЕГО НЕ ВЫДУМЫВАЙ.';
  const userText = buildExtractionPrompt_('image');
  const buildMessages = function(prevRaw) {
    const msgs = [
      { role: 'system', content: system },
      { role: 'user', content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]}
    ];
    if (prevRaw) {
      msgs.push({ role: 'assistant', content: prevRaw });
      msgs.push({ role: 'user', content: 'Невалидный JSON. Верни ТОЛЬКО объект { ... }.' });
    }
    return msgs;
  };
  return callOpenAIWithRetry_(apiKey, buildMessages);
}

function extractPartnerData_(text) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) throw softError_('NO_API_KEY', 'OPENAI_API_KEY не задан.');
  const system = 'Ты — помощник по извлечению реквизитов. Верни ТОЛЬКО валидный JSON без markdown. ' +
                 'Если поля нет — пустая строка "". НИЧЕГО НЕ ВЫДУМЫВАЙ.';
  const userPrompt = [
    'Извлеки реквизиты из текста:',
    '"""', text.slice(0, 6000), '"""', '',
    buildExtractionPrompt_('text')
  ].join('\n');
  const buildMessages = function(prevRaw) {
    const msgs = [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt }
    ];
    if (prevRaw) {
      msgs.push({ role: 'assistant', content: prevRaw });
      msgs.push({ role: 'user', content: 'Невалидный JSON. Верни ТОЛЬКО объект { ... }.' });
    }
    return msgs;
  };
  return callOpenAIWithRetry_(apiKey, buildMessages);
}

function buildExtractionPrompt_(mode) {
  const intro = (mode === 'image')
    ? 'Извлеки реквизиты контрагента с изображения. Верни JSON:'
    : 'Верни JSON:';
  return [
    intro,
    '{',
    '  "COUNTRY": "Kazakhstan, USA или \\"\\\" если непонятно. USA только при ЯВНЫХ признаках (адрес в США, $, EIN, штат, Inc/LLC).",',
    '  "PARTNER_NAME": "полное название (ТОО, АО, Inc, LLC) или ФИО",',
    '  "BIN": "12 цифр. Сохрани ведущие нули!",',
    '  "DIRECTOR": "ФИО руководителя",',
    '  "ADDRESS": "юридический адрес",',
    '  "IIK": "ИИК/IBAN/счёт",',
    '  "BANK": "банк",',
    '  "BIK": "БИК/SWIFT",',
    '  "NDA_TYPE": "Unilateral|Mutual (default Mutual)",',
    '  "PURPOSE": "Business Partnership|Contract Work|Employment|Sale of a Business|Other",',
    '  "EMAIL": "email",',
    '  "_confidence": "high|medium|low"',
    '}'
  ].join('\n');
}

function callOpenAIWithRetry_(apiKey, buildMessages) {
  let lastRaw = '';
  let totalTokens = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages = buildMessages(attempt === 2 ? lastRaw : null);
    const result   = callOpenAI_(apiKey, messages);
    lastRaw = result.content;
    totalTokens += result.tokens;
    try {
      const parsed = parseJsonLoose_(lastRaw);
      return { data: parsed, tokens: totalTokens };
    } catch (e) {
      if (attempt === 2) throw softError_('BAD_JSON', 'Невалидный JSON после 2 попыток: ' + e.message);
    }
  }
  throw softError_('EXTRACT_FAILED', 'Не удалось извлечь данные.');
}

function callOpenAI_(apiKey, messages) {
  const payload = JSON.stringify({
    model: CFG.OPENAI_MODEL, messages: messages,
    temperature: 0, max_tokens: CFG.OPENAI_MAX_TOKENS,
    response_format: { type: 'json_object' }
  });
  let waitMs = 1500;
  for (let i = 1; i <= CFG.OPENAI_MAX_RETRIES; i++) {
    const resp = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      payload: payload, muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code === 200) {
      const parsed = JSON.parse(body);
      if (!parsed.choices || !parsed.choices[0]) throw softError_('OPENAI_EMPTY', 'OpenAI пустой ответ.');
      return {
        content: parsed.choices[0].message.content.trim(),
        tokens:  (parsed.usage && parsed.usage.total_tokens) || 0
      };
    }
    if ((code === 429 || code >= 500) && i < CFG.OPENAI_MAX_RETRIES) {
      Utilities.sleep(waitMs); waitMs *= 2; continue;
    }
    throw softError_('OPENAI_HTTP_' + code, body.slice(0, 300));
  }
  throw softError_('OPENAI_NO_RESPONSE', 'OpenAI не ответил.');
}

function parseJsonLoose_(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = t.indexOf('{');
  const last  = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) throw new Error('JSON не найден: ' + t.slice(0, 100));
  return JSON.parse(t.slice(first, last + 1));
}

// ══════════════════════════════════════════════════════════════════════
//  BIN LOOKUP
// ══════════════════════════════════════════════════════════════════════
function enrichByBinLookup_(partner) {
  let bin = String(partner.BIN || '').replace(/\D/g, '');
  if (bin.length >= 8 && bin.length < 12) bin = ('000000000000' + bin).slice(-12);
  if (!/^\d{12}$/.test(bin)) return;
  partner.BIN = bin;
  if (nonEmpty_(partner.PARTNER_NAME) && nonEmpty_(partner.DIRECTOR) && nonEmpty_(partner.ADDRESS)) return;
  const data = fetchBinFromStatGov_(bin);
  if (!data) return;
  if (!nonEmpty_(partner.PARTNER_NAME) && data.name)     partner.PARTNER_NAME = data.name;
  if (!nonEmpty_(partner.DIRECTOR)     && data.director) partner.DIRECTOR     = data.director;
  if (!nonEmpty_(partner.ADDRESS)      && data.address)  partner.ADDRESS      = data.address;
  partner._STATUS  = data.status   || '';
  partner._OKED    = data.okedName || '';
  partner._REGDATE = data.regDate  || '';
  partner._TAXDEBT = data.taxDebt  || '';
  Logger.log('BIN ✅ ' + (data.name || '—') + ' | ' + (data.status || '—'));
}

function fetchBinFromStatGov_(bin) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'bin:' + bin;
  const cached   = cache.get(cacheKey);
  if (cached) { Logger.log('BIN ' + bin + ' из кэша'); return JSON.parse(cached); }
  try {
    const url = encodeURI('https://ba.prg.kz/000000000-unknown/' + String(bin).trim() + '-' + String(bin).trim() + '/');
    const resp = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true, followRedirects: true,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9'
      }
    });
    if (resp.getResponseCode() !== 200) { Logger.log('ba.prg.kz HTTP ' + resp.getResponseCode()); return null; }
    const raw    = resp.getContentText();
    const metaRaw = extractMetaContent_(raw, 'description') || extractMetaContent_(raw, 'og:description');
    if (!metaRaw) return null;
    const meta = decodeHtmlEntities_(metaRaw);
    if (meta.indexOf(bin) === -1) return null;
    const decodedHtml = decodeHtmlEntities_(raw);
    const result = {
      name:      parseName_(meta),
      director:  parseDirector_(meta),
      address:   parseLegalAddressFromPage_(decodedHtml) || parseAddressFromOgTags_(decodedHtml) || parseAddressFromMeta_(meta),
      status:    parseStatusFromPage_(decodedHtml),
      regDate:   parseRegistrationDate_(decodedHtml),
      taxDebt:   parseTaxDebt_(decodedHtml),
      phone:     parsePhone_(decodedHtml),
      sourceUrl: url
    };
    const oked = parseOked_(decodedHtml);
    result.okedCode = oked.code;
    result.okedName = oked.name;
    if (!result.name && !result.director && !result.address) return null;
    cache.put(cacheKey, JSON.stringify(result), CFG.BIN_CACHE_SECONDS);
    return result;
  } catch (e) { Logger.log('ba.prg.kz упал: ' + e); return null; }
}

function extractMetaContent_(html, metaName) {
  const escaped = String(metaName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp('<meta\\s+(?:name|property)=["\']' + escaped + '["\']\\s+content=["\']([^"\']+)["\']', 'i');
  const re2 = new RegExp('<meta\\s+content=["\']([^"\']+)["\']\\s+(?:name|property)=["\']' + escaped + '["\']', 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function decodeHtmlEntities_(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function parseName_(meta) {
  const m = meta.match(/^([^,]+(?:,[^,]*?)?)\s*,\s*БИН/);
  if (m) return m[1].trim();
  const parts = meta.split(',');
  return parts[0] ? parts[0].trim() : '';
}

// [BUG-6] Limit to 4 words max to prevent "GULFAYR GULFAYRUZ" double-name bug.
// Root cause: ba.prg.kz sometimes has abbreviated+full name in the meta description;
// the lazy regex was capturing both. A 4-word ceiling covers all standard Kazakh/Russian
// name formats (Фамилия Имя Отчество) with one slack word for compound surnames.
function parseDirector_(meta) {
  const cyrWord = '[А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәіA-Za-z][А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәіA-Za-z\\-]+';
  const pattern = new RegExp(
    'Руководитель:\\s*(' + cyrWord + '(?:\\s+' + cyrWord + '){0,3})'
  );
  const m = meta.match(pattern);
  if (!m) return '';
  return m[1].replace(/\s{2,}/g, ' ').replace(/[\.\s]+$/, '').trim();
}

function parseLegalAddressFromPage_(html) {
  const m = html.match(/Юридический\s+адрес[\s\S]{0,200}?Рус([^\n]+?)(?:\s*Проверено|\s*Қаз|\s*Источники|$)/i);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
}

function parseAddressFromOgTags_(html) {
  const locality = (html.match(/business:contact_data:locality[^>]+content=["']([^"']+)["']/i)       || [])[1];
  const street   = (html.match(/business:contact_data:street_address[^>]+content=["']([^"']+)["']/i) || [])[1];
  const postal   = (html.match(/business:contact_data:postal_code[^>]+content=["']([^"']+)["']/i)    || [])[1];
  if (!locality && !street) return '';
  return [postal, locality, street].filter(Boolean).join(', ');
}

function parseAddressFromMeta_(meta) {
  const m = meta.match(/Руководитель:[^,]+,\s*([\d][\d\s\.,\-\/А-ЯЁа-яёҚҢҒҮҰӨӘІқңғүұөәіA-Za-z]+?)(?:\s*\.\s*[✔☑]|$)/);
  if (!m) return '';
  return m[1].trim().replace(/[,\s]+$/, '');
}

function parseStatusFromPage_(html) {
  const flags = [];
  const checks = [
    { label: 'банкрот',        pattern: /признанных\s+банкротами[\s\S]{0,50}?(Нет|Да)/i },
    { label: 'лжепредприятие', pattern: /признанных\s+лжепредприятиями[\s\S]{0,50}?(Нет|Да)/i },
    { label: 'недействителен', pattern: /регистрация\s+которых\s+признана\s+недействительной[\s\S]{0,50}?(Нет|Да)/i },
    { label: 'бездействует',   pattern: /признанных\s+бездействующими[\s\S]{0,50}?(Нет|Да)/i },
    { label: 'нет по адресу',  pattern: /отсутствующих\s+по\s+юридическому\s+адресу[\s\S]{0,50}?(Нет|Да)/i }
  ];
  for (let i = 0; i < checks.length; i++) {
    const m = html.match(checks[i].pattern);
    if (m && m[1].toLowerCase() === 'да') flags.push(checks[i].label);
  }
  return flags.length ? ('РИСК: ' + flags.join(', ')) : 'действующая';
}

function parseRegistrationDate_(html) {
  const m = html.match(/Первичная\s+регистрация[\s\S]{0,100}?(\d{2}\.\d{2}\.\d{4})/i);
  return m ? m[1] : '';
}

function parseOked_(html) {
  const m = html.match(/Основной\s+ОКЭД[\s\S]{0,200}?(\d{4,5})\s+([^\n]+?)(?:\s*Проверено|$)/i);
  if (!m) return { code: '', name: '' };
  return { code: m[1].trim(), name: m[2].trim() };
}

function parseTaxDebt_(html) {
  const m = html.match(/задолженност[ьи][\s\S]{0,300}?(\d+(?:[.,]\d+)?)\s*₸/i);
  if (!m) return '';
  return m[1].replace(',', '.') + ' ₸';
}

function parsePhone_(html) {
  const m = html.match(/tel:(\+?[\d()\-\s]+)/);
  return m ? m[1].replace(/\s+/g, '') : '';
}

function validateRequired_(p) {
  const missing = [];
  const isUSA = (p.COUNTRY === 'USA');
  if (!nonEmpty_(p.PARTNER_NAME)) missing.push('PARTNER_NAME');
  if (!nonEmpty_(p.ADDRESS))      missing.push('ADDRESS');
  if (!isUSA) {
    let bin = String(p.BIN || '').replace(/\D/g, '');
    if (bin.length >= 8 && bin.length < 12) bin = ('000000000000' + bin).slice(-12);
    p.BIN = bin;
    if (!/^\d{12}$/.test(bin)) missing.push('BIN (12 цифр)');
    if (!nonEmpty_(p.DIRECTOR)) missing.push('DIRECTOR');
  }
  return missing;
}

function nonEmpty_(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }

// ══════════════════════════════════════════════════════════════════════
//  DATA MAPPING
// ══════════════════════════════════════════════════════════════════════
function buildFillData_(country, p) {
  const today    = new Date();
  const months   = ['января','февраля','марта','апреля','мая','июня',
                    'июля','августа','сентября','октября','ноября','декабря'];
  const monthsEn = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

  if (country === 'USA') {
    const isUnilateral = (p.NDA_TYPE || '').indexOf('Unilateral') !== -1;
    return {
      DATE:               Utilities.formatDate(today, 'America/New_York', 'MMMM d, yyyy'),
      PARTY1_NAME:        DEREKNET.NAME_EN,
      PARTY1_ADDRESS:     DEREKNET.ADDR_EN,
      PARTY1_PRINT:       DEREKNET.REP_EN,
      PARTY2_NAME:        p.PARTNER_NAME,
      PARTY2_ADDRESS:     p.ADDRESS || 'to be provided at signing',
      PARTY2_PRINT:       p.DIRECTOR || p.PARTNER_NAME,
      PARTY2_BIN:         p.BIN || '',
      STATE:              'New York',
      NDA_TYPE:           p.NDA_TYPE || 'Mutual',
      CHECK_UNILATERAL:   isUnilateral ? '☑' : '☐',
      CHECK_MUTUAL:       !isUnilateral ? '☑' : '☐',
      PURPOSE:            p.PURPOSE || 'Business Partnership',
      PURPOSE_OTHER:      ''
    };
  }

  // ── KZ branch ──────────────────────────────────────────────────────
  const bankRu = 'ИИК ' + DEREKNET.IIK + ', ' + DEREKNET.BANK_RU + ', БИК ' + DEREKNET.BIK + ', БИН ' + DEREKNET.BIN;
  const bankEn = 'IBAN ' + DEREKNET.IIK + ', ' + DEREKNET.BANK_EN + ', SWIFT ' + DEREKNET.BIK + ', BIN ' + DEREKNET.BIN;

  // Receiving-party signatory
  const partnerSigRu = p.DIRECTOR || p.PARTNER_NAME || '';
  const partnerSigEn = transliterateRuToEn_(partnerSigRu);

  return {
    // ── Legacy tokens (original KZ template) ──────────────────────
    CITY:             DEREKNET.CITY_RU,
    DATE_DAY:         today.getDate().toString(),
    DATE_MONTH:       months[today.getMonth()],
    DATE_YEAR:        today.getFullYear().toString(),
    EMPLOYER_NAME:    DEREKNET.NAME_RU,
    EMPLOYER_REP:     DEREKNET.DIRECTOR,
    BASIS:            DEREKNET.BASIS,
    BIN:              DEREKNET.BIN,
    EMPLOYER_ADDRESS: DEREKNET.ADDR_RU,
    IIK:              DEREKNET.IIK,
    BANK:             DEREKNET.BANK,
    BIK:              DEREKNET.BIK,
    EMPLOYEE_NAME:    p.DIRECTOR || p.PARTNER_NAME,
    PARTNER_NAME:     p.PARTNER_NAME,
    PARTNER_BIN:      p.BIN,
    ADDRESS_ACTUAL:   p.ADDRESS,
    ADDRESS_REG:      p.ADDRESS,
    PARTNER_IIK:      p.IIK  || '—',
    PARTNER_BANK:     p.BANK || '—',
    PARTNER_BIK:      p.BIK  || '—',
    CONF_INFO: 'техническая документация, коммерческая информация, финансовые данные ' +
               'и иная информация, связанная с деятельностью сторон',

    // ── Verumpraxis-template tokens ────────────────────────────────
    AGREEMENT_NUMBER: today.getFullYear().toString().slice(-2) +
                      ('0' + (today.getMonth()+1)).slice(-2) +
                      ('0' + today.getDate()).slice(-2) + '-' +
                      String(Math.floor(Math.random()*900+100)),
    DATE_MONTH_RU:  months[today.getMonth()],
    DATE_MONTH_EN:  monthsEn[today.getMonth()],

    // Disclosing party — RU nominative (signature block)
    DISCLOSING_PARTY_NAME_RU:         DEREKNET.NAME_RU,
    DISCLOSING_PARTY_NAME_EN:         DEREKNET.NAME_EN,
    DISCLOSING_PARTY_ADDRESS_RU:      DEREKNET.ADDR_RU,
    DISCLOSING_PARTY_ADDRESS_EN:      DEREKNET.ADDR_EN,
    DISCLOSING_PARTY_BANK_DETAILS_RU: bankRu,
    DISCLOSING_PARTY_BANK_DETAILS_EN: bankEn,
    DISCLOSING_PARTY_REP_POSITION_RU: DEREKNET.REP_POSITION_RU,   // nominative → signature block
    DISCLOSING_PARTY_REP_POSITION_EN: DEREKNET.REP_POSITION_EN,
    DISCLOSING_PARTY_REP_NAME_RU:     DEREKNET.REP_NAME_RU,        // nominative → signature block
    DISCLOSING_PARTY_REP_NAME_EN:     DEREKNET.REP_NAME_EN,
    DISCLOSING_PARTY_BASIS_RU:        DEREKNET.BASIS_RU,
    DISCLOSING_PARTY_BASIS_EN:        DEREKNET.BASIS_EN,

    // [BUG-4] Disclosing party — RU genitive (preambula "в лице")
    // Requires fixTemplateBugs_() to have been run to add _GEN placeholders.
    DISCLOSING_PARTY_REP_POSITION_RU_GEN: DEREKNET.REP_POSITION_RU_GEN,
    DISCLOSING_PARTY_REP_NAME_RU_GEN:     DEREKNET.REP_NAME_RU_GEN,

    APPENDIX_COMPANY_NAME_RU: DEREKNET.NAME_RU,
    APPENDIX_COMPANY_NAME_EN: DEREKNET.NAME_EN,

    // Receiving party
    RECEIVING_PARTY_NAME:    p.PARTNER_NAME,
    // [BUG-7] No "БИН " prefix — the template label already says
    //         "Налоговый идентификационный номер:" / "Tax Identification Number:"
    RECEIVING_PARTY_TAX_ID:    p.BIN,
    RECEIVING_PARTY_TAX_ID_EN: p.BIN,
    RECEIVING_PARTY_LEGAL_FORM_RU:   inferLegalFormRu_(p.PARTNER_NAME),
    RECEIVING_PARTY_LEGAL_FORM_EN:   inferLegalFormEn_(p.PARTNER_NAME),
    RECEIVING_PARTY_JURISDICTION_RU: 'Республики Казахстан',
    RECEIVING_PARTY_JURISDICTION_EN: 'Republic of Kazakhstan',
    // [BUG-8] Separate RU and EN address tokens so English column uses transliteration
    RECEIVING_PARTY_ADDRESS:    p.ADDRESS,
    RECEIVING_PARTY_ADDRESS_EN: transliterateRuToEn_(p.ADDRESS || ''),
    // [BUG-5] Gender-correct agreement for зарегистрирован*
    RECEIVING_PARTY_REG_AGREEMENT_RU: inferRegAgreementRu_(p.PARTNER_NAME),
    // [BONUS] Representative clause for receiving party preambula
    RECEIVING_PARTY_REP_POSITION_RU: inferRepPositionRu_(p.PARTNER_NAME),
    RECEIVING_PARTY_REP_NAME_RU:     p.DIRECTOR || '_______________',
    RECEIVING_PARTY_BASIS_RU:        'Устава',
    RECEIVING_PARTY_REP_POSITION_EN: inferRepPositionEn_(p.PARTNER_NAME),
    RECEIVING_PARTY_REP_NAME_EN:     partnerSigEn || '_______________',
    RECEIVING_PARTY_BASIS_EN:        'Charter',
    RECEIVING_PARTY_SIGNATORY_RU:    partnerSigRu,
    RECEIVING_PARTY_SIGNATORY_EN:    partnerSigEn
  };
}

// ══════════════════════════════════════════════════════════════════════
//  CONTRACT GENERATION + SIGNATURE
// ══════════════════════════════════════════════════════════════════════
function generateSignedContract_(country, fill, partner) {
  const props = PropertiesService.getScriptProperties();
  const templateId = props.getProperty('NDA_TEMPLATE_ID') || '1YqK11YyNBZFLiQyQ3xqDTjBYZ_eiciqS9rL2CSGG4og';
  const sigFileId  = props.getProperty('SIGNATURE_FILE_ID');
  if (!templateId) throw softError_('NO_TEMPLATE', 'Не задан единый шаблон NDA');

  const stamp = Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyyyMMdd_HHmm');
  const safe  = String(partner.PARTNER_NAME || 'partner')
                  .replace(/[^a-zA-Zа-яА-ЯёЁ0-9 ]/g, '')
                  .trim().replace(/ /g, '_').slice(0, 40);
  const fname     = 'NDA_' + (country === 'USA' ? 'US' : 'KZ') + '_' + safe + '_' + stamp;
  const outFolder = folder_(CFG.OUTPUT_FOLDER_ID);
  const docFile   = DriveApp.getFileById(templateId).makeCopy(fname, outFolder);
  const doc       = DocumentApp.openById(docFile.getId());
  const body      = doc.getBody();

  if (country === 'USA') fillUS(body, fill);
  else                   fillKZ(body, fill);

  insertBossSignature_(body, sigFileId);
  doc.saveAndClose();

  const pdfBlob = DriveApp.getFileById(docFile.getId())
                          .getAs('application/pdf')
                          .setName(fname + '.pdf');
  outFolder.createFile(pdfBlob);

  return 'https://docs.google.com/document/d/' + docFile.getId() + '/edit';
}

// [BUG-9] Insert signature at natural dimensions; scale proportionally only if wider
// than 200pt (~7 cm). The old code forced 160×60 which distorted non-4:3 aspect ratios.
function insertBossSignature_(body, sigFileId) {
  const found = body.findText('\\{\\{SIGNATURE_BOSS\\}\\}');
  if (!found) { Logger.log('{{SIGNATURE_BOSS}} не найден.'); return; }
  const par = found.getElement().getParent().asParagraph();
  par.clear();
  if (!sigFileId) { par.setText('_______________'); return; }
  try {
    const file = DriveApp.getFileById(sigFileId);
    const mime = file.getMimeType();
    if (['image/png', 'image/jpeg', 'image/gif'].indexOf(mime) === -1) {
      throw new Error('Неподдерживаемый MIME подписи: ' + mime);
    }
    const cleanBlob = Utilities.newBlob(file.getBlob().getBytes(), mime, 'signature');
    const img = par.appendInlineImage(cleanBlob);
    const nw  = img.getWidth();
    const nh  = img.getHeight();
    const maxW = 200;   // 200pt ≈ 7cm — a comfortable max for signature images
    if (nw > maxW) {
      img.setWidth(maxW).setHeight(Math.round(nh * maxW / nw));
    }
    // If nw <= maxW, natural size is kept without any ratio distortion
  } catch (e) {
    Logger.log('Подпись не вставилась: ' + e);
    par.setText('_______________');
  }
}

// ══════════════════════════════════════════════════════════════════════
//  ONE-TIME TEMPLATE REPAIR  ⚠️  Run ONCE after deploying v4.2
//
//  What this does to the Google Docs NDA template:
//   1. Removes orphan 'ё' from "Получающая сторона: ё"  [BUG-1]
//   2. Replaces '>>>>' with '»' (quote corruption)       [BUG-2]
//   3. Fixes Latin B/c lookalikes to Cyrillic В/с        [BUG-3]
//   4. Adds _GEN suffix tokens in the preambula "в лице" [BUG-4]
//   5. Adds {{RECEIVING_PARTY_REG_AGREEMENT_RU}} token   [BUG-5]
//   6. Adds {{RECEIVING_PARTY_ADDRESS_EN}} in EN column  [BUG-8]
//   7. Adds receiving-party representative clause        [BONUS]
// ══════════════════════════════════════════════════════════════════════
function fixTemplateBugs_() {
  const props      = PropertiesService.getScriptProperties();
  const templateId = props.getProperty('NDA_TEMPLATE_ID') || '1YqK11YyNBZFLiQyQ3xqDTjBYZ_eiciqS9rL2CSGG4og';
  const doc  = DocumentApp.openById(templateId);
  const body = doc.getBody();
  let fixes  = 0;

  function tryReplace(from, to, label) {
    try {
      const found = body.findText(from);
      if (found) {
        body.replaceText(from, to);
        Logger.log('✅ ' + label);
        fixes++;
      } else {
        Logger.log('⏭️  already fixed (not found): ' + label);
      }
    } catch (e) {
      Logger.log('❌ ' + label + ': ' + e.message);
    }
  }

  // ── [BUG-1] Remove orphan 'ё' in Russian signature block ──────────
  tryReplace(
    'Получающая сторона:\\s*ё',
    'Получающая сторона:',
    'BUG-1: orphan ё removed'
  );

  // ── [BUG-2] Fix quote corruption '>>>>' → '»' ─────────────────────
  tryReplace('>>>>', '»', 'BUG-2: >>>> → »');

  // ── [BUG-3] Latin lookalikes → correct Cyrillic ───────────────────
  // Capital Latin B (U+0042) appearing instead of Cyrillic В (U+0412)
  tryReplace('B лице',           'в лице',           'BUG-3a: Latin B → В in «в лице»');
  tryReplace('B соответствии c', 'в соответствии с', 'BUG-3b: Latin B/c → В/с');
  // TOO (Latin T+O+O) → ТОО (Cyrillic)
  tryReplace('TOO «', 'ТОО «', 'BUG-3c: Latin TOO → ТОО');

  // ── [BUG-4] Genitive in preambula — replace ONLY "в лице" line ────
  // Replaces the first occurrence (preambula intro) but NOT the
  // "(Ф.И.О., должность)" label or the signature block, which stay nominative.
  tryReplace(
    'в лице \\{\\{DISCLOSING_PARTY_REP_POSITION_RU\\}\\} \\{\\{DISCLOSING_PARTY_REP_NAME_RU\\}\\}',
    'в лице {{DISCLOSING_PARTY_REP_POSITION_RU_GEN}} {{DISCLOSING_PARTY_REP_NAME_RU_GEN}}',
    'BUG-4: preambula uses _GEN tokens for genitive case'
  );

  // ── [BUG-5] Gender-correct registration adjective ─────────────────
  tryReplace(
    'зарегистрированная в соответствии с законодательством \\{\\{RECEIVING_PARTY_JURISDICTION_RU\\}\\}',
    '{{RECEIVING_PARTY_REG_AGREEMENT_RU}} в соответствии с законодательством {{RECEIVING_PARTY_JURISDICTION_RU}}',
    'BUG-5: gender-agreement token for зарегистрирован*'
  );

  // ── [BUG-8] English column — transliterated address ───────────────
  // "Адрес:" is Russian column; "Address:" is English column — safe split
  tryReplace(
    'Address: \\{\\{RECEIVING_PARTY_ADDRESS\\}\\}',
    'Address: {{RECEIVING_PARTY_ADDRESS_EN}}',
    'BUG-8: English column uses transliterated address token'
  );
  // Tax ID in English column: use bare number (no "БИН " prefix)
  tryReplace(
    'Tax Identification Number: \\{\\{RECEIVING_PARTY_TAX_ID\\}\\}',
    'Tax Identification Number: {{RECEIVING_PARTY_TAX_ID_EN}}',
    'BUG-7: English Tax ID token (no prefix)'
  );

  // ── [BONUS] Add receiving-party representative clause (RU) ─────────
  // Before: "…{{RECEIVING_PARTY_LEGAL_FORM_RU}}, зарегистрированная… с другой стороны"
  // After:  "…{{RECEIVING_PARTY_LEGAL_FORM_RU}}, {{REG_AGREEMENT}}…, в лице Директора …, с другой стороны"
  tryReplace(
    '\\{\\{RECEIVING_PARTY_REG_AGREEMENT_RU\\}\\} в соответствии с законодательством \\{\\{RECEIVING_PARTY_JURISDICTION_RU\\}\\} с другой стороны',
    '{{RECEIVING_PARTY_REG_AGREEMENT_RU}} в соответствии с законодательством {{RECEIVING_PARTY_JURISDICTION_RU}}, в лице {{RECEIVING_PARTY_REP_POSITION_RU}} {{RECEIVING_PARTY_REP_NAME_RU}}, действующего/ей на основании {{RECEIVING_PARTY_BASIS_RU}}, с другой стороны',
    'BONUS: receiving party representative clause added (RU)'
  );
  // English column equivalent
  tryReplace(
    '\\{\\{RECEIVING_PARTY_LEGAL_FORM_EN\\}\\} organized and existing under the laws of the \\{\\{RECEIVING_PARTY_JURISDICTION_EN\\}\\}, on the other hand',
    '{{RECEIVING_PARTY_LEGAL_FORM_EN}} organized and existing under the laws of the {{RECEIVING_PARTY_JURISDICTION_EN}}, represented by its {{RECEIVING_PARTY_REP_POSITION_EN}} {{RECEIVING_PARTY_REP_NAME_EN}}, acting on the basis of the {{RECEIVING_PARTY_BASIS_EN}}, on the other hand',
    'BONUS: receiving party representative clause added (EN)'
  );

  doc.saveAndClose();

  const msg = fixes + ' fix(es) applied to the NDA template. ' +
              'Review the template to verify, then regenerate a test contract.';
  Logger.log('fixTemplateBugs_: ' + msg);
  try { SpreadsheetApp.getUi().alert('✅ Template patched\n\n' + msg); } catch (e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  LOG / NOTIFY / ERROR / TRIGGERS
// ══════════════════════════════════════════════════════════════════════
function bufferLogRow_(status, sourceName, country, partner, docUrl, error, duration, tokens, confidence) {
  _logBuffer.push([
    new Date(), status, sourceName, country || '',
    partner ? (partner.PARTNER_NAME || '') : '',
    partner ? (partner.BIN          || '') : '',
    docUrl || '', error || '',
    partner ? (partner._STATUS  || '') : '',
    partner ? (partner._OKED    || '') : '',
    partner ? (partner._REGDATE || '') : '',
    duration || '', tokens || 0, confidence || ''
  ]);
}

function flushLogBuffer_() {
  if (_logBuffer.length === 0) return;
  try {
    const sh = getLogSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, _logBuffer.length, _logBuffer[0].length).setValues(_logBuffer);
    _logBuffer = [];
  } catch (e) { Logger.log('flushLogBuffer упал: ' + e); }
}

function notifyManager_(sourceName, reason) {
  if (!CFG.MANAGER_EMAIL) return;
  try {
    MailApp.sendEmail({
      to:      CFG.MANAGER_EMAIL,
      subject: '[Dereknet CLM] Файл в карантине',
      body: [
        'Файл:    ' + sourceName,
        'Причина: ' + reason,
        '',
        'Needs Review: https://drive.google.com/drive/folders/' + CFG.REVIEW_FOLDER_ID,
        '',
        '— Dereknet CLM'
      ].join('\n')
    });
  } catch (e) { Logger.log('Email упал: ' + e); }
}

function softError_(code, message) { const e = new Error(message); e.code = code; return e; }

function cleanupProcessing() {
  try {
    const processing = DriveApp.getFolderById(CFG.PROCESSING_FOLDER_ID);
    const review     = DriveApp.getFolderById(CFG.REVIEW_FOLDER_ID);
    const files      = processing.getFiles();
    const hourAgo    = Date.now() - 60 * 60 * 1000;
    let moved = 0;
    while (files.hasNext()) {
      const f = files.next();
      if (f.getLastUpdated().getTime() < hourAgo) { f.moveTo(review); moved++; }
    }
    Logger.log('cleanupProcessing: перенесено ' + moved);
  } catch (e) { Logger.log('cleanupProcessing упал: ' + e); }
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['processInbox', 'cleanupProcessing'].indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('cleanupProcessing').timeBased().everyDays(1).atHour(3).create();
  Logger.log('✅ Триггеры установлены.');
}

// ══════════════════════════════════════════════════════════════════════
//  GOOGLE SHEET MENU
// ══════════════════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CLM')
    .addItem('▶️ Обработать INBOX сейчас', 'processInbox')
    .addItem('🔁 Перезапустить REVIEW',     'reprocessReview')
    .addSeparator()
    .addItem('📊 Статистика за 7 дней',    'showStats')
    .addItem('🧪 Проверить конфиг',         'testConfig')
    .addSeparator()
    .addItem('🔧 Исправить шаблон (один раз)', 'fixTemplateBugs_')
    .addItem('⚙️ Установить триггеры',     'installTrigger')
    .addToUi();
}

function reprocessReview() {
  const review = DriveApp.getFolderById(CFG.REVIEW_FOLDER_ID);
  const inbox  = DriveApp.getFolderById(CFG.INBOX_FOLDER_ID);
  const files  = review.getFiles();
  let moved = 0;
  while (files.hasNext()) { files.next().moveTo(inbox); moved++; }
  const msg = '🔁 Перенесено ' + moved + ' файл(ов) обратно в INBOX.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function showStats() {
  try {
    const sh = getLogSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) { SpreadsheetApp.getUi().alert('Лог пуст.'); return; }
    const data = sh.getRange(2, 1, lastRow - 1, 14).getValues();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let done = 0, review = 0, kzCount = 0, usaCount = 0;
    let totalDuration = 0, totalTokens = 0, processed = 0;
    for (let i = 0; i < data.length; i++) {
      const t = data[i][0];
      if (!(t instanceof Date) || t.getTime() < cutoff) continue;
      processed++;
      if (String(data[i][1]).indexOf('DONE') !== -1)         done++;
      if (String(data[i][1]).indexOf('NEEDS_REVIEW') !== -1) review++;
      if (data[i][3] === 'Kazakhstan') kzCount++;
      if (data[i][3] === 'USA')        usaCount++;
      totalDuration += parseFloat(data[i][11]) || 0;
      totalTokens   += parseInt(data[i][12])   || 0;
    }
    const avgDur = processed ? (totalDuration / processed).toFixed(1) : '0';
    const costUSD = (totalTokens / 1e6 * 0.5).toFixed(3);
    const msg = [
      '📊 Статистика за 7 дней', '',
      'Обработано:        ' + processed,
      '✅ DONE:            ' + done,
      '⚠️ NEEDS_REVIEW:    ' + review, '',
      '🇰🇿 Казахстан:     ' + kzCount,
      '🇺🇸 США:           ' + usaCount, '',
      '⏱️ Среднее время:   ' + avgDur + ' сек/файл',
      '🪙 Токены OpenAI:   ' + totalTokens.toLocaleString('ru-RU'),
      '💵 Примерно:        ~$' + costUSD
    ].join('\n');
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) { SpreadsheetApp.getUi().alert('Ошибка: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════
//  TESTS
// ══════════════════════════════════════════════════════════════════════
function testSingleFile(fileId) {
  _folders = {}; _logSheet = null; _logBuffer = [];
  handleOneFile_(DriveApp.getFileById(fileId));
  flushLogBuffer_();
}

function testBinLookup() {
  const bin = '190440019884';
  CacheService.getScriptCache().remove('bin:' + bin);
  const data = fetchBinFromStatGov_(bin);
  Logger.log(data ? JSON.stringify(data, null, 2) : '❌ не получено');
}

function testCountryResolution() {
  const cases = [
    { name: 'US_acme.pdf',  partner: { COUNTRY: '',           BIN: '' }, expected: 'USA'        },
    { name: 'USA_acme.jpg', partner: { COUNTRY: 'Kazakhstan', BIN: '' }, expected: 'USA'        },
    { name: 'KZ_too.pdf',   partner: { COUNTRY: 'USA',        BIN: '' }, expected: 'Kazakhstan' },
    { name: 'partner.jpg',  partner: { COUNTRY: 'USA',        BIN: '220140027733' }, expected: 'USA' },
    { name: 'partner.jpg',  partner: { COUNTRY: '',           BIN: '220140027733' }, expected: 'Kazakhstan' },
    { name: 'unknown.pdf',  partner: { COUNTRY: '',           BIN: '' }, expected: 'Kazakhstan' }
  ];
  cases.forEach(function(c) {
    resolveCountry_(c.partner, c.name);
    const ok = c.partner.COUNTRY === c.expected ? '✅' : '❌';
    Logger.log(ok + ' ' + c.name + ' → ' + c.partner.COUNTRY);
  });
}

// Test the new director name parser against the double-name bug scenario
function testParseDirector() {
  const cases = [
    { input: 'БИН 090740019001, Руководитель: Ахметова Гульфайруз Айткабыловна, Дата',
      expected: 'Ахметова Гульфайруз Айткабыловна' },
    { input: 'Руководитель: Иванов Иван Иванович, БИН',
      expected: 'Иванов Иван Иванович' },
    { input: 'Руководитель: Кабдулов Саламат Шамарданович✔',
      expected: 'Кабдулов Саламат Шамарданович' }
  ];
  cases.forEach(function(c) {
    const result = parseDirector_(c.input);
    const ok = result === c.expected ? '✅' : '❌';
    Logger.log(ok + ' got: "' + result + '" | expected: "' + c.expected + '"');
  });
}

const SIGNATURE_FOLDER_ID = '1Xlzi7qzFkBCaTbARYXIgbrG3NvNTUET2';

function setupSignature() {
  let folder;
  try { folder = DriveApp.getFolderById(SIGNATURE_FOLDER_ID); }
  catch (e) { Logger.log('❌ ' + e.message); return; }
  const candidates = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const mime = f.getMimeType();
    if (['image/png', 'image/jpeg', 'image/gif'].indexOf(mime) !== -1) {
      candidates.push({ id: f.getId(), name: f.getName(), mime: mime });
    }
  }
  if (candidates.length === 0) { Logger.log('❌ Нет PNG/JPEG/GIF.'); return; }
  if (candidates.length > 1) {
    Logger.log('⚠️ Найдено несколько — беру первый:');
    candidates.forEach((c, i) => Logger.log('   ' + (i + 1) + '. ' + c.name));
  }
  const chosen = candidates[0];
  PropertiesService.getScriptProperties().setProperty('SIGNATURE_FILE_ID', chosen.id);
  Logger.log('✅ SIGNATURE_FILE_ID = ' + chosen.id + ' (' + chosen.name + ')');
}

function testSignature() {
  const sigFileId = PropertiesService.getScriptProperties().getProperty('SIGNATURE_FILE_ID');
  if (!sigFileId) { Logger.log('❌ нет SIGNATURE_FILE_ID'); return; }
  try {
    const file = DriveApp.getFileById(sigFileId);
    if (['image/png', 'image/jpeg', 'image/gif'].indexOf(file.getMimeType()) === -1) {
      Logger.log('❌ MIME: ' + file.getMimeType()); return;
    }
    const tmpDoc = DocumentApp.create('TMP_SIG_' + Date.now());
    const body   = tmpDoc.getBody();
    body.appendParagraph('Тест подписи:');
    const cleanBlob = Utilities.newBlob(file.getBlob().getBytes(), file.getMimeType(), 'signature');
    const img = body.appendImage(cleanBlob);
    const nw  = img.getWidth();
    const nh  = img.getHeight();
    if (nw > 200) img.setWidth(200).setHeight(Math.round(nh * 200 / nw));
    tmpDoc.saveAndClose();
    Logger.log('✅ ' + tmpDoc.getUrl());
  } catch (e) { Logger.log('❌ ' + e.message); }
}

function testConfig() {
  const folderChecks = [
    ['INBOX',      CFG.INBOX_FOLDER_ID],
    ['PROCESSING', CFG.PROCESSING_FOLDER_ID],
    ['DONE',       CFG.DONE_FOLDER_ID],
    ['REVIEW',     CFG.REVIEW_FOLDER_ID],
    ['OUTPUT',     CFG.OUTPUT_FOLDER_ID]
  ];
  folderChecks.forEach(function(c) {
    try { const f = DriveApp.getFolderById(c[1]); Logger.log('✅ ' + c[0] + ': ' + f.getName()); }
    catch (e) { Logger.log('❌ ' + c[0] + ': ' + e.message); }
  });
  const props = PropertiesService.getScriptProperties();
  [
    ['NDA_TEMPLATE_ID',   'Единый шаблон NDA'],
    ['SIGNATURE_FILE_ID', 'Подпись']
  ].forEach(function(pair) {
    const id = props.getProperty(pair[0]) || (pair[0] === 'NDA_TEMPLATE_ID' ? '1YqK11YyNBZFLiQyQ3xqDTjBYZ_eiciqS9rL2CSGG4og' : null);
    if (!id) { Logger.log('❌ ' + pair[1] + ': НЕ ЗАДАН'); return; }
    try { const f = DriveApp.getFileById(id); Logger.log('✅ ' + pair[1] + ': ' + f.getName()); }
    catch (e) { Logger.log('❌ ' + pair[1] + ': ' + e.message); }
  });
  const apiKey = props.getProperty('OPENAI_API_KEY');
  Logger.log((apiKey ? '✅ ' : '❌ ') + 'OPENAI_API_KEY: ' + (apiKey ? 'задан' : 'НЕ ЗАДАН'));
  try { SpreadsheetApp.openById(CFG.LOG_SHEET_ID); Logger.log('✅ LOG_SHEET'); }
  catch (e) { Logger.log('❌ LOG_SHEET: ' + e.message); }
  Logger.log((typeof Drive !== 'undefined' && Drive.Files) ? '✅ Drive API v2' : '❌ Drive API v2 НЕ подключён!');
}
