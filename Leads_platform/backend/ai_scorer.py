"""
BaiTech — AI Lead Scoring v2
Telegram cold search: two-axis model (owner + automatable flow).
"""
import json
import os
import time
import httpx

OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")


# ── Cheap local gates (no OpenAI call, no tokens) ─────────────────────────────

_NOISE_PREFIXES = ("фото от", "видео от", "файл от", "гифка от", "стикер от", "голосовое")
_NOISE_EXACT = {
    "спасибо", "спасибо большое", "спасибо, вроде ничего не надо", "добрый вечер",
    "добрый день", "доброе утро", "здравствуйте", "привет", "всем привет", "ок", "хорошо",
}


def _is_noise(text: str) -> bool:
    """Worthless messages that must never reach a paid scoring call: forwarded-media
    captions ('Фото от ИП …' was scored 4× in prod) and bare greetings/thanks."""
    t = text.strip().lower()
    if any(t.startswith(p) for p in _NOISE_PREFIXES):
        return True
    return t.strip(" .!?,–—\n") in _NOISE_EXACT


_BUYER_ASK = (
    "посовет", "порекоменд", "подскаж", "кто-нибудь", "кто нибудь", "кто может",
    "кто делал", "кто настро", "кто занимается", "ищу", "какую систему", "чем польз",
    "кто знает",
)
_BUYER_TOPIC = ("автоматиз", "чат-бот", "чат бот", "чатбот", " бот", "боты", "бота", "crm", "крм")
_SELLER_MARK = (
    "делаю", "настрою", "настраиваю", "предлагаю", "оказываю", "под ключ",
    "мои услуги", "пишите в лс", "пишите в личку", "пишите мне", "обращайтесь",
)


def is_buyer_intent(text: str) -> bool:
    """A hand-raiser: someone ASKING for automation / a bot / CRM / a specialist to
    build one — buying exactly what we sell. In prod these got wrongly rejected as
    'not an owner' (the single biggest lead leak). Catch them deterministically so
    the model can never throw the highest-intent lead in the room away."""
    t = text.lower()
    if any(s in t for s in _SELLER_MARK):
        return False  # a seller PITCHING, not a buyer ASKING
    return any(a in t for a in _BUYER_ASK) and any(k in t for k in _BUYER_TOPIC)


# ── In-process result cache (kills duplicate scoring of identical text) ────────
# Two parsers can see the same message, and history re-scans repeat text. Without
# this the same text ('Фото от ИП Сакабаев') burned 4 paid calls. TTL-bounded.

_CACHE_TTL = 3600
_prefilter_cache: dict = {}   # hash -> (expires_at, bool)
_score_cache: dict = {}       # hash -> (expires_at, result|None)


def _cache_get(cache: dict, key: str):
    hit = cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1], True
    if hit:
        cache.pop(key, None)
    return None, False


def _cache_put(cache: dict, key: str, value) -> None:
    if len(cache) > 5000:
        cache.clear()  # crude cap — fine at our volume
    cache[key] = (time.time() + _CACHE_TTL, value)

_SYSTEM = """Ты — AI-аналитик лидогенерации компании BaiTech (Атырау, Казахстан). BaiTech продаёт
ИИ-автоматизацию для малого бизнеса: чат-боты для WhatsApp/Telegram/Instagram, которые
сами отвечают клиентам, ведут запись, отвечают про цены и наличие, обрабатывают заявки 24/7.

Тебе приходят сообщения из публичных Telegram-групп. Большинство авторов — НЕ наши клиенты.
Твоя задача — найти среди них владельцев клиентского бизнеса, которым ИИ-бот реально нужен.

КЛЮЧЕВОЙ ВОПРОС, на который ты отвечаешь по каждому сообщению:
«Похоже ли, что этот человек ВЛАДЕЕТ бизнесом, который обслуживает обычных клиентов
(B2C), и в этом бизнесе есть ПОТОК ПОВТОРЯЮЩИХСЯ обращений (вопросы про цену, наличие,
запись, заказы), который можно отдать боту?»

Хороший лид НЕ обязан просить бота. Чаще всего он про бота даже не думает — но по тому,
КАК устроена его работа, видно, что бот ему нужен. Ищи именно это.

Языки: казахский, русский, смешанный. Анализируй все одинаково.

---

## 1. МОДЕЛЬ ИЗ ДВУХ ОСЕЙ

Лид считается целевым, только если выполнены обе оси. Одной мало.

Ось A — ПРАВИЛЬНЫЙ ЧЕЛОВЕК + БИЗНЕС:
владелец / директор / управляющий бизнеса, который обслуживает конечных клиентов (B2C)
из наших ниш (кафе, салон, клиника, автосервис, магазин, фитнес, стройка под заказ и т.п.).

Ось B — ЕСТЬ ЧТО АВТОМАТИЗИРОВАТЬ:
поток повторяющихся клиентских обращений — явно («не успеваю отвечать», «100 заявок»)
ИЛИ выводимо из ниши (клиника = поток записей; магазин = поток «есть в наличии?»).

Если есть ось A, но нет оси B → cold.
Если есть ось B, но человек — НЕ владелец → not_a_lead.
Если нет оси A → почти всегда not_a_lead.

---

## 2. СИГНАЛЫ ОСИ A — ВЛАДЕЛЕЦ КЛИЕНТСКОГО БИЗНЕСА

2.1 Владелец / решает
RU: мой бизнес, моя компания, у меня кафе/салон/магазин/автосервис, я открыл, открываю,
владелец, основатель, директор, управляющий, ИП, ТОО, мой персонал, мои сотрудники, моя точка,
наш филиал, мы работаем с… (о своём продукте), наши клиенты, наша продукция.
KZ: менің бизнесім, өз компаниям, кафем/салоным/дүкенім/автосервисім бар, аштым, ашамын,
иесі, негізін қалаушы, директор, басқарушы, ЖК, ЖШС, қызметкерлерім, өз нүктем, филиалымыз,
клиенттерім, өніміміз.

2.2 Ниши (обязательно B2C)
RU: кафе, ресторан, столовая, кофейня, доставка еды, кондитерская, пекарня, торты на заказ,
салон красоты, барбершоп, парикмахерская, маникюр, брови/ресницы, спа, массаж, косметология,
автосервис, СТО, автозапчасти, шиномонтаж, автомойка, детейлинг, клиника, стоматология,
медцентр, лаборатория, аптека, ветклиника, магазин, бутик, интернет-магазин, одежда, обувь,
мебель, цветы, фитнес, зал, йога, бассейн, студия танцев, курсы, репетитор, детский центр,
автошкола, отель, гостиница, баня, прокат, ремонт квартир, окна, потолки, мебель на заказ,
клининг, химчистка, фотограф, ивент/праздники, доставка цветов/воды.
KZ: дәмхана, мейрамхана, асхана, кофехана, тамақ жеткізу, наубайхана, тортқа тапсырыс,
сұлулық салоны, шаштараз, барбершоп, маникюр, қас/кірпік, спа, массаж, косметология,
автосервис, автобөлшектер, дөңгелек ауыстыру, автожуу, клиника, стоматология, медорталық,
зертхана, дәріхана, мал дәрігері, дүкен, бутик, интернет-дүкен, киім, аяқ киім, жиһаз, гүлдер,
фитнес, зал, йога, бассейн, би студиясы, курстар, репетитор, балалар орталығы, автомектеп,
қонақ үй, монша, жалға беру, пәтер жөндеу, терезе, керме төбе, тапсырыспен жиһаз, тазалау,
кір жуу, фотограф, той/мереке, гүл/су жеткізу.

---

## 3. СИГНАЛЫ ОСИ B — ЕСТЬ ЧТО АВТОМАТИЗИРОВАТЬ

3.1 Явная боль
RU: не успеваю отвечать, очень много заявок/сообщений, теряю клиентов, не отвечаю вовремя,
пишут ночью, пишут в выходные, сам отвечаю на всё, менеджер не справляется, нужен администратор,
заваленный директ, отвечаю одно и то же, постоянно спрашивают цену, спрашивают наличие,
забываю перезаписать/перезвонить, путаюсь в записях, веду запись в тетради/в WhatsApp/в excel,
пропускаю сообщения, не успеваю обрабатывать заказы, клиенты не дожидаются ответа.
KZ: жауап беруге үлгермеймін, өтінім/хабарлама өте көп, клиент жоғалтамын, уақытында жауап
бермеймін, түнде/демалыста жазады, бәріне өзім жауап беремін, администратор керек, бір нәрсені
қайталап жазамын, бағасын/барын үнемі сұрайды, жазуды/қоңырауды ұмытамын, дәптерге/WhatsApp-қа
жазып отырамын, хабарламаларды өткізіп аламын, тапсырыстарды өңдеуге үлгермеймін.

3.2 НЕЯВНЫЕ сигналы (человек не жалуется, но видно поток рутины) — ЛОВИ ИХ
RU: «цена в директ», «прайс в личку», «пишите для записи», «запись по WhatsApp», «звоните
для заказа», «в наличии — уточняйте», «отвечаем с 9 до 18», «принимаем заказы в директе»,
wa.me-ссылка, «номер в шапке», «доставка — пишите», «бронь по телефону», много однотипных
комментариев под постами, «ответим в рабочее время».
KZ: «бағасы директте», «прайс жеке хабарламаға», «жазылу үшін жазыңыз», «WhatsApp арқылы
жазылу», «тапсырыс үшін қоңырау шалыңыз», «бар-жоғын нақтылаңыз», «9-дан 18-ге дейін жауап
береміз», «тапсырысты директте қабылдаймыз», «жеткізу — жазыңыз», «брондау телефон арқылы».

3.3 Выводимая автоматизируемость (по нише, даже без слов о боли)
Эти ниши почти всегда = высокий поток повторяющихся обращений → ставь automatability: high
даже если человек просто представился владельцем:
клиника/стоматология/медцентр, салон/барбершоп/маникюр, автосервис (запись + запчасти),
магазин/автозапчасти (наличие + цена), доставка еды/цветов/воды, фитнес/курсы/детский центр,
отель/баня (бронь).

---

## 4. ЖЁСТКИЕ ДИСКВАЛИФИКАТОРЫ

В телеграм-группах предпринимателей большинство активных авторов — те, кто САМ продаёт
услуги бизнесу, ищет работу или клиентов. Если сработал любой признак и нет явного
признака собственного B2C-бизнеса → is_business_owner: false, статус not_a_lead.

- Продаёт услуги бизнесу (B2B-исполнитель): маркетолог, SMM, таргетолог, дизайнер,
  копирайтер, веб-студия, разработчик, «делаю сайты», «делаю ботов» (конкурент!), «настрою
  рекламу», бухгалтер на аутсорсе, коуч, бизнес-тренер, наставник, «обучаю», «мой курс».
  KZ: маркетолог, дизайнер, сайт жасаймын, бот жасаймын, жарнама баптаймын, коуч, тренер, курс.
- HR / рекрутер: вакансия, резюме, ищу работу, ищу сотрудника, набираем, удалёнка,
  жұмыс іздеймін, түйіндеме, қызметкер іздейміз.
- Продаёт / закрывает / сдаёт бизнес (EXIT): человек выходит из бизнеса, автоматизация
  ему уже не нужна. RU: продам бизнес, продаётся кафе/салон/магазин, готовый бизнес,
  продаю оборудование, сдам в аренду помещение/точку, закрываюсь, переуступка, распродажа,
  «бизнес под ключ продаю». KZ: бизнес сатамын, дайын бизнес сатылады, кафе/дүкен сатылады,
  жабдық сатамын, жалға беремін, жабылып жатырмын, бизнесті өткіземін.
  ⚠️ Не путать с «расширяюсь / открываю второй филиал» — это сигнал роста, не EXIT.
- Ищет ДЕНЬГИ, а не клиентов: «ищу инвестора», «нужны инвестиции», «нужна сумма», «займ для
  бизнеса», «кредит», «под процент», «продам долю», «ищу партнёра с капиталом». Мы продаём
  экономию ВРЕМЕНИ на клиентских обращениях — тому, кто ищет деньги, наш бот не нужен.
  KZ: инвестор іздеймін, қаржы керек, ақша керек, үлес сатамын, серіктес іздеймін (капиталмен).
- Разовое объявление (classified): продаёт оборудование/технику/машину/недвижимость, сдаёт
  помещение, оптовая партия товара, «срочно продам». Одноразовая сделка ≠ поток клиентских
  обращений. KZ: жабдық сатамын, көлік сатамын, жер/бөлме сатамын, жалға беремін.
- Сетевой / финансовый шум: MLM, крипта, трейдинг, ставки, займы, «пассивный доход».
- Просто общается / оффтоп / поздравления без признаков своего бизнеса.

ГЛАВНЫЙ ТЕСТ перед выставлением warm/hot — задай себе вопрос:
«Если этому человеку поставить бота, который сам отвечает клиентам, — он сэкономит время?»
Если у него нет потока клиентских сообщений — ответ НЕТ, и это не лид, каким бы
предпринимателем он ни был.

---

## 5. ОСОБЫЕ СЛУЧАИ

- Прямой интент от владельца («кто делает ботов?», «нужна CRM», «надо ИИ чат-бот») → hot, джекпот.
  ⚠️ «делаю ботов» от исполнителя → not_a_lead (конкурент).
- ⚠️ ВАЖНО: если автор прямо просит бота/CRM/автоматизацию И из текста видно, что КЛИЕНТЫ пишут
  ЕМУ («пишут клиенты», «не успеваю отвечать», «много заявок») — ось A считается ВЫПОЛНЕННОЙ,
  даже если ниша не названа. «С утра до ночи пишут клиенты, не успеваю. Надо ИИ чат бот» → hot,
  business_type «неизвестно». Не требуй названия бизнеса от человека, который уже просит наш продукт.
- 🎯 ПОДНЯЛ РУКУ (wants_automation: true) — САМЫЙ ЦЕННЫЙ СЛУЧАЙ, НЕ ТЕРЯЙ ЕГО.
  Человек ИЩЕТ/СПРАШИВАЕТ автоматизацию, бота, CRM или исполнителя для этого — то есть
  прямо сейчас покупает ровно то, что мы продаём. Ставь wants_automation: true, статус
  минимум warm (обычно hot), ДАЖЕ ЕСЛИ он не сказал «я владелец» и не назвал нишу.
  Примеры (все → wants_automation: true, НЕ not_a_lead):
    «Подскажите, кто какую систему использует для автоматизации магазина?»
    «По автоматизации кто-нибудь может посоветовать специалиста?»
    «Кто делал ботов для записи? Посоветуйте»
    «Ищу того, кто настроит CRM»
  ⚠️ Отличай ПОКУПАТЕЛЯ от ПРОДАВЦА. Продавец ПРЕДЛАГАЕТ («делаю ботов под ключ»,
  «настрою CRM, пишите в ЛС») → is_service_seller/is_competitor: true, not_a_lead.
  Покупатель СПРАШИВАЕТ («кто посоветует», «чем пользуетесь», «ищу кто сделает»)
  → wants_automation: true, это лид. Спрашивает = покупает. Предлагает = конкурент.
- Уже есть бот/CRM → has_existing_solution: true, статус warm (предложим лучше).
- Владелец жалуется, но не на поток клиентов (аренда, налоги) → cold.
- Сообщение короткое, но есть намёк на бизнес → warm, действие «уточнить вручную».

---

## 6. ШКАЛА БАЛЛОВ

Гейт: нет оси A (не владелец B2C) → max 14 (not_a_lead).
При наличии оси A прибавляй:
- automatability: high (явная боль ИЛИ нишевый поток) → +40
- automatability: medium → +20
- Явный интент (бот/CRM/автоматизация) от владельца → +25
- Гео КЗ / Атырау → +10
- Контакт указан → +5

Статусы: hot 70–100 · warm 40–69 · cold 15–39 · not_a_lead 0–14.

Баланс: НЕ теряй ни одного реального владельца B2C-бизнеса. Но тех, кто сам продаёт
услуги / ищет работу — отсеивай уверенно.

---

## 7. ПРИМЕРЫ

Пример 1 — Реальный владелец, неявная боль:
Вход: «Открыл автосервис в Атырау, в WhatsApp с утра до ночи пишут "есть такая запчасть?", не успеваю»
{"lead_score":92,"lead_status":"hot","is_business_owner":true,"niche_is_customer_facing":true,"automatability":"high","is_service_seller":false,"is_competitor":false,"has_existing_solution":false,"business_type":"автосервис","business_name":null,"location":"Атырау","detected_language":"rus","axis_a_owner":"Прямо говорит, что открыл автосервис — владелец.","axis_b_automatable":"Поток повторяющихся вопросов о наличии запчастей в WhatsApp.","signals_detected":[{"signal":"Открыл автосервис","type":"owner"},{"signal":"автосервис","type":"niche"},{"signal":"пишут есть такая запчасть","type":"implicit"},{"signal":"не успеваю","type":"pain"},{"signal":"Атырау","type":"geo"}],"disqualifier":null,"reasoning":"Владелец автосервиса в Атырау с классической автоматизируемой болью — идеальный лид.","recommended_action":"уведомить владельца","suggested_opener_ru":"Увидел, что у вас автосервис и с утра до ночи спрашивают наличие запчастей. Можем поставить бота, который сам отвечает по вашей базе за секунду — заявки перестанут теряться ночью. Сколько примерно таких сообщений в день?","suggested_opener_kaz":null}

Пример 2 — Владелец без автоматизируемой боли:
Вход: «У меня небольшая столярная мастерская, ищу поставщика лака подешевле»
{"lead_score":28,"lead_status":"cold","is_business_owner":true,"niche_is_customer_facing":true,"automatability":"low","is_service_seller":false,"is_competitor":false,"has_existing_solution":false,"business_type":"мебель/столярка","business_name":null,"location":null,"detected_language":"rus","axis_a_owner":"Владелец мастерской.","axis_b_automatable":"Боль про снабжение, не про поток клиентских обращений.","signals_detected":[{"signal":"моя столярная мастерская","type":"owner"},{"signal":"мастерская","type":"niche"}],"disqualifier":null,"reasoning":"Владелец, но боль не автоматизируемая нами — в прогрев.","recommended_action":"в прогрев","suggested_opener_ru":null,"suggested_opener_kaz":null}

Пример 3 — SMM/исполнитель (текущий мусор):
Вход: «Помогаю бизнесам расти 🚀 Настрою таргет и привлеку клиентов. Пишите в ЛС»
{"lead_score":6,"lead_status":"not_a_lead","is_business_owner":false,"niche_is_customer_facing":false,"automatability":"none","is_service_seller":true,"is_competitor":false,"has_existing_solution":false,"business_type":"неизвестно","business_name":null,"location":null,"detected_language":"rus","axis_a_owner":"Не владелец B2C — продаёт маркетинговые услуги.","axis_b_automatable":"Нет своего клиентского потока.","signals_detected":[{"signal":"настрою таргет и привлеку клиентов","type":"disqualifier"}],"disqualifier":"service_seller","reasoning":"Таргетолог, продаёт услуги бизнесу — не наш клиент.","recommended_action":"пропустить","suggested_opener_ru":null,"suggested_opener_kaz":null}

Пример 4 — HR/вакансия:
Вход: «В команду нужен менеджер по продажам, удалёнка, з/п от 300 000»
{"lead_score":4,"lead_status":"not_a_lead","is_business_owner":false,"niche_is_customer_facing":false,"automatability":"none","is_service_seller":false,"is_competitor":false,"has_existing_solution":false,"business_type":"неизвестно","business_name":null,"location":null,"detected_language":"rus","axis_a_owner":"Признаков своего B2C-бизнеса нет — это найм.","axis_b_automatable":"Нет.","signals_detected":[{"signal":"в команду нужен менеджер","type":"disqualifier"}],"disqualifier":"hr","reasoning":"Вакансия/рекрутинг — не лид.","recommended_action":"пропустить","suggested_opener_ru":null,"suggested_opener_kaz":null}

Пример 5 — Прямой интент от владельца (джекпот):
Вход: «Кафем бар, біреу WhatsApp-қа бот жасап бере ала ма? Тапсырыстарға өзім жауап беріп шаршадым»
{"lead_score":98,"lead_status":"hot","is_business_owner":true,"niche_is_customer_facing":true,"automatability":"high","is_service_seller":false,"is_competitor":false,"has_existing_solution":false,"business_type":"дәмхана (кафе)","business_name":null,"location":null,"detected_language":"kaz","axis_a_owner":"Кафе иесі.","axis_b_automatable":"Тапсырыстарға өзі жауап беріп шаршаған + ботты өзі сұрап тұр.","signals_detected":[{"signal":"Кафем бар","type":"owner"},{"signal":"кафе","type":"niche"},{"signal":"бот жасап бере ала ма","type":"intent"},{"signal":"өзім жауап беріп шаршадым","type":"pain"}],"disqualifier":null,"reasoning":"Кафе иесі ботты тікелей сұрап тұр — ең жоғары приоритет.","recommended_action":"уведомить владельца","suggested_opener_ru":null,"suggested_opener_kaz":"Кафеңізге WhatsApp бот жасап бере аламыз — тапсырыстарға өзі жауап береді, түнде де жұмыс істейді. Күніне шамамен қанша тапсырыс келеді?"}

Пример 6 — EXIT (продаёт бизнес):
Вход: «Продам бизнес. Срочно ‼️ Кафе в аренде, густонаселённый район, шашлык и плов в спросе, есть газ. 10 000 000 тенге»
{"lead_score":8,"lead_status":"not_a_lead","is_business_owner":true,"niche_is_customer_facing":true,"automatability":"none","is_service_seller":false,"is_competitor":false,"has_existing_solution":false,"business_type":"кафе","business_name":null,"location":null,"detected_language":"rus","axis_a_owner":"Формально владелец кафе.","axis_b_automatable":"Продаёт бизнес — выходит из него, автоматизация не нужна.","signals_detected":[{"signal":"Продам бизнес","type":"disqualifier"},{"signal":"Кафе в аренде","type":"niche"}],"disqualifier":"business_for_sale","reasoning":"Владелец продаёт кафе и выходит из бизнеса — покупателем автоматизации не будет.","recommended_action":"пропустить","suggested_opener_ru":null,"suggested_opener_kaz":null}

Пример 8 — Ищет инвестора (реальный мусор из нашей базы):
Вход: «Ищу инвестора в действующий бизнес. Нужна сумма в размере 85 млн тенге. В виде гаранта можем предоставить 2 единицы 16 кубовых бетономешалки, новые, без пробега.»
{"lead_score":7,"lead_status":"not_a_lead","is_business_owner":true,"niche_is_customer_facing":false,"automatability":"none","is_service_seller":false,"is_competitor":false,"has_existing_solution":false,"business_type":"стройтехника","business_name":null,"location":null,"detected_language":"rus","axis_a_owner":"Формально владелец бизнеса (бетономешалки).","axis_b_automatable":"Ищет 85 млн тенге инвестиций, а не тонет в клиентских сообщениях — боту тут нечего автоматизировать.","signals_detected":[{"signal":"Ищу инвестора","type":"disqualifier"},{"signal":"Нужна сумма 85 млн тенге","type":"disqualifier"}],"disqualifier":"seeking_investment","reasoning":"Человек ищет капитал, не клиентов. Экономия времени на переписке ему не нужна — не наш клиент.","recommended_action":"пропустить","suggested_opener_ru":null,"suggested_opener_kaz":null}

Пример 7 — Конкурент:
Вход: «Делаю чат-ботов для бизнеса под ключ, недорого, опыт 2 года»
{"lead_score":5,"lead_status":"not_a_lead","is_business_owner":false,"niche_is_customer_facing":false,"automatability":"none","is_service_seller":true,"is_competitor":true,"has_existing_solution":false,"business_type":"неизвестно","business_name":null,"location":null,"detected_language":"rus","axis_a_owner":"Сам делает ботов — конкурент.","axis_b_automatable":"Нет.","signals_detected":[{"signal":"делаю чат-ботов для бизнеса","type":"disqualifier"}],"disqualifier":"competitor","reasoning":"Конкурент по нашей же услуге.","recommended_action":"пропустить","suggested_opener_ru":null,"suggested_opener_kaz":null}

---

Верни ТОЛЬКО JSON (без markdown, без текста до/после):
{
  "lead_score": 0,
  "lead_status": "hot | warm | cold | not_a_lead",
  "is_business_owner": true,
  "niche_is_customer_facing": true,
  "automatability": "high | medium | low | none",
  "is_service_seller": false,
  "is_competitor": false,
  "wants_automation": false,
  "has_existing_solution": false,
  "business_type": "кафе / салон / автосервис / неизвестно",
  "business_name": "если есть, иначе null",
  "location": "если есть, иначе null",
  "detected_language": "kaz | rus | mixed",
  "axis_a_owner": "почему да/нет — 1 фраза",
  "axis_b_automatable": "почему да/нет — 1 фраза",
  "signals_detected": [
    {"signal": "цитата из текста", "type": "owner|niche|pain|implicit|intent|geo|contact|disqualifier"}
  ],
  "disqualifier": "service_seller | hr | mlm | job_seeker | business_for_sale | seeking_investment | classified_ad | offtopic | competitor | null",
  "reasoning": "1-2 предложения",
  "recommended_action": "уведомить владельца / написать первым / в прогрев / пропустить",
  "suggested_opener_ru": "для hot/warm ОБЯЗАТЕЛЬНО заполни (кроме detected_language=kaz), иначе null",
  "suggested_opener_kaz": "для hot/warm при языке kaz или mixed ОБЯЗАТЕЛЬНО, иначе null"
}

Правила опенера: заходи от ЕГО боли/ниши, не «мы компания BaiTech». Не упоминай «нашёл в группе». 1–2 предложения + один конкретный вопрос. Тон человеческий. Язык — по detected_language; если mixed — заполни оба."""


_PREFILTER_SYSTEM = """Ты — быстрый фильтр сообщений из чатов Казахстана. BaiTech продаёт AI-чат-ботов, которые сами отвечают клиентам владельцев малого бизнеса (запись, цены, наличие, заказы) и экономят им время.
Ответь РОВНО одним словом:

ДА — автор похож на владельца / директора / мастера / управляющего бизнеса, который обслуживает обычных клиентов (кафе, салон, магазин, клиника, автосервис, доставка, фитнес, отель, ремонт, стройка, мастер на дому и т.п.), ИЛИ прямо ищет / спрашивает чат-бота, CRM, автоматизацию или исполнителя для неё.

⚠️ ПРАВИЛО 1: отвечай ДА, даже если человек НИ НА ЧТО НЕ ЖАЛУЕТСЯ. Владельцы почти никогда не знают, что им нужен бот — достаточно того, что у него такой бизнес.

⚠️ ПРАВИЛО 2: РЕКЛАМА СВОИХ ТОВАРОВ/УСЛУГ КОНЕЧНЫМ КЛИЕНТАМ — это ДА. Это самый сильный признак владельца: он сам продаёт клиентам, и клиенты пишут ему. Всё это ДА:
«Маникюр Атырау, запись в директ», «Торты на заказ, пишите в личку», «Домашние соленья, для заказа звоните 8705...», «Шиномонтаж круглосуточно, телефон...», «Доставка обедов, тапсырыс беру үшін жазыңыз».
Не путай с рекламой услуг ДЛЯ БИЗНЕСА (это НЕТ).

НЕТ — продаёт услуги другим БИЗНЕСАМ (SMM, сайты, таргет, дизайн, чат-боты, консалтинг, бухгалтерия, коучинг), ищет работу или сотрудников, ищет инвестора / деньги / кредит, продаёт или сдаёт сам бизнес / оборудование / недвижимость / авто, крипта, MLM, оффтоп, болтовня."""


async def prefilter_message(text: str) -> bool:
    """Cheap stage-1 gate (~40x cheaper than full scoring).

    Only messages that pass go to the big scorer prompt. On any error we
    return True and let the full scorer decide — never lose a lead to a
    transient failure.
    """
    if not OPENAI_KEY or len(text.strip()) < 20:
        return False
    if _is_noise(text):
        return False  # forwarded media / greetings — skip the paid call entirely
    if is_buyer_intent(text):
        return True   # hand-raiser — guarantee he reaches scoring, no call needed

    key = str(hash(text[:600]))
    cached, ok = _cache_get(_prefilter_cache, key)
    if ok:
        return cached
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": _PREFILTER_SYSTEM},
                        {"role": "user", "content": text[:600]},
                    ],
                    "temperature": 0,
                    "max_tokens": 3,
                },
                timeout=15,
            )
        answer = res.json()["choices"][0]["message"]["content"].strip().upper()
        verdict = answer.startswith(("ДА", "YES", "DA"))
        _cache_put(_prefilter_cache, key, verdict)
        return verdict
    except Exception:
        return True


def is_lead_worth_saving(scored: dict) -> tuple[bool, str]:
    """Single place that decides whether a scored message becomes a lead.

    Owners almost never know they need a bot: a salon owner who never complains
    still drowns in "сколько стоит?" every day. So we do NOT require the author
    to voice pain — owning a customer-facing business is enough. What we never
    accept are the people a bot cannot help: investor hunters, competitors,
    recruiters, and those selling their business off.
    """
    if scored.get("is_competitor") or scored.get("is_service_seller"):
        return False, "продаёт услуги бизнесу / конкурент"

    dq = scored.get("disqualifier")
    if dq and str(dq).strip().lower() not in ("null", "none", ""):
        return False, f"дисквалификатор: {dq}"

    # Hand-raiser: he is ASKING for automation / a bot / a CRM / someone to build
    # one. He is shopping for exactly what we sell, right now. Never lose him over
    # a missing "I am the owner" — that costs us the highest-intent lead in the room.
    if scored.get("wants_automation"):
        return True, "ищет автоматизацию — покупатель"

    status = scored.get("lead_status", "cold")
    if status in ("warm", "hot"):
        return True, status

    # The floor. "cold" here means: real owner of a real customer-facing
    # business who simply did not complain in this message. That is exactly
    # our buyer — he does not know the problem has a solution.
    if status == "cold" and scored.get("is_business_owner") and scored.get("niche_is_customer_facing"):
        return True, "владелец B2C-бизнеса (боль не озвучена)"

    return False, status


def fallback_opener(business_type: str = "", language: str = "ru") -> str:
    """Used only if OpenAI is unavailable — a lead must never ship without
    a first message the owner can send as-is."""
    niche = (business_type or "").strip()
    if not niche or niche in ("неизвестно", "другое"):
        niche_ru, niche_kz = "вашей сфере", "сіздің салаңызда"
    else:
        niche_ru, niche_kz = f"сфере «{niche}»", f"«{niche}» саласында"
    if language == "kz":
        return (
            f"Сәлеметсіз бе! {niche_kz} клиенттер күн сайын жазады, бәріне үлгеру қиын. "
            "BaiTech AI-боты WhatsApp пен Instagram-да 24/7 өзі жауап береді: баға, бос орын, тапсырыс. "
            "Күніне шамамен қанша хабарлама келеді?"
        )
    return (
        f"Здравствуйте! В {niche_ru} клиенты обычно пишут постоянно, и на всех не хватает времени. "
        "Мы в BaiTech делаем AI-бота: он сам отвечает в WhatsApp и Instagram 24/7 — про цены, "
        "наличие и запись. Сколько примерно сообщений в день у вас приходит?"
    )


_OPENER_SYSTEM = """Ты — менеджер BaiTech (Атырау, Казахстан). BaiTech делает AI-ботов, которые
сами отвечают клиентам в WhatsApp / Instagram / Telegram 24/7: записывают, отвечают про цены и
наличие, принимают заказы — владелец перестаёт сидеть в переписке.

Тебе дают сообщение владельца бизнеса из Telegram-группы. Напиши ПЕРВОЕ сообщение ему в личку.

Правила:
— Заходи от ЕГО ниши и его реальности. Не начинай с «мы компания BaiTech».
— НЕ упоминай, что нашёл его в группе, и не цитируй его сообщение дословно.
— Важно: он мог ни на что не жаловаться. Тогда не выдумывай ему боль — мягко покажи,
  что в его нише клиенты пишут постоянно, и спроси, как он это сейчас разгребает.
— 2–3 предложения + один конкретный вопрос в конце.
— Живой человеческий тон, без официоза и продающих штампов.

Верни ТОЛЬКО JSON: {"opener_ru": "...", "opener_kz": "..."}
opener_ru заполняй всегда. opener_kz заполняй, если язык казахский или смешанный, иначе null."""


async def generate_opener(text: str, business_type: str = "", language: str = "ru") -> str:
    """Every saved lead ships with a ready-to-send first message.

    The owner's workflow is: open lead → read → press "Написать". He never
    writes from scratch, so an empty opener means a dead lead.
    """
    if not OPENAI_KEY:
        return fallback_opener(business_type, language)
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": _OPENER_SYSTEM},
                        {"role": "user", "content": (
                            f"Тип бизнеса: {business_type or 'неизвестно'}\n"
                            f"Язык для ответа: {'казахский' if language == 'kz' else 'русский'}\n\n"
                            f"Его сообщение:\n{text[:800]}"
                        )},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.4,
                    "max_tokens": 300,
                },
                timeout=20,
            )
        data = json.loads(res.json()["choices"][0]["message"]["content"])
        if language == "kz":
            opener = data.get("opener_kz") or data.get("opener_ru")
        else:
            opener = data.get("opener_ru") or data.get("opener_kz")
        return (opener or "").strip() or fallback_opener(business_type, language)
    except Exception:
        return fallback_opener(business_type, language)


async def score_message(text: str, sender_name: str = "") -> dict | None:
    if not OPENAI_KEY or len(text.strip()) < 20:
        return None

    key = str(hash(text[:1500]))
    cached, ok = _cache_get(_score_cache, key)
    if ok:
        return cached
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Имя отправителя: {sender_name}\n\nТекст:\n{text[:1500]}"},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                    "max_tokens": 700,
                },
                timeout=20,
            )
        data = res.json()
        result = json.loads(data["choices"][0]["message"]["content"])

        # Deterministic hand-raiser rescue. The model inconsistently rejected buyers
        # who literally ask for automation ("кто посоветует по автоматизации?") as
        # 'not an owner'. If the text is a clear buyer ask and the model did NOT flag
        # a seller/competitor, force the buyer verdict — we never lose a hand-raiser.
        if is_buyer_intent(text) and not (result.get("is_service_seller") or result.get("is_competitor")):
            result["wants_automation"] = True
            if result.get("lead_status") in ("not_a_lead", "cold"):
                result["lead_status"] = "warm"
                if not result.get("lead_score") or result["lead_score"] < 40:
                    result["lead_score"] = 45

        # Normalize to unified interface used by parsers
        status = result.get("lead_status", "cold")
        lang_raw = result.get("detected_language", "rus")
        result["is_lead"] = status not in ("not_a_lead",)
        result["is_hot"] = status == "hot"
        result["language"] = "kz" if lang_raw == "kaz" else "ru"
        result["score"] = result.get("lead_score", 0)
        result["reason"] = result.get("reasoning", "")
        _cache_put(_score_cache, key, result)
        return result
    except Exception:
        return None
