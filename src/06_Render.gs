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

/** Заданная ширина подписи в пунктах, с проверкой границ. */
function signatureWidthPt_() {
  var raw = parseFloat(prop_(PROP.SIGNATURE_WIDTH_PT));
  if (!raw || isNaN(raw)) return CFG.SIGNATURE_DEFAULT_WIDTH_PT;
  return Math.min(CFG.SIGNATURE_MAX_WIDTH_PT, Math.max(CFG.SIGNATURE_MIN_WIDTH_PT, raw));
}

/**
 * Подпись директора. Шаблон содержит несколько якорей {{SIGNATURE_BOSS}}
 * (соглашение RU/EN + приложение RU/EN) — обрабатываем все.
 *
 * Картинка приводится к заданной ширине с сохранением пропорций, одинаково
 * во всех местах и во всех договорах. Раньше размер зависел от разрешения
 * исходного PNG и мог занимать до 7 см — половину строки подписей.
 */
function insertSignature_(doc, sigFileId) {
  var token = '\\{\\{SIGNATURE_BOSS\\}\\}';
  var targetW = signatureWidthPt_();
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
          if (w > 0) img.setWidth(targetW).setHeight(Math.round(h * targetW / w));
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
