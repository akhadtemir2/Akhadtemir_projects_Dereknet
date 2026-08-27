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

// ═══════════════════════════════════════════════════════════════════════════════════
//  ЭКСПОРТ ДЛЯ ЛОКАЛЬНЫХ ТЕСТОВ (в Apps Script этот блок игнорируется)
// ═══════════════════════════════════════════════════════════════════════════════════
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isValidKzBin_, describeKzBin_, normalizeBin_, extractTokens_,
    transliterateRuToEn_, inferLegalFormRu_, inferLegalFormEn_,
    inferRegAgreementRu_, inferRepPositionRu_, inferRepPositionEn_,
    safeFileName_, parseJsonLoose_, nonEmpty_, humanizeError_,
    KNOWN_TOKENS, REQUIRED_KZ_TOKENS, ERROR_HELP
  };
}
