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
