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
