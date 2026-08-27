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
