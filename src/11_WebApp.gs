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
