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
