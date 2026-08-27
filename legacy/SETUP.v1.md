# BaiTech CLM — Setup Guide (Beta Demo)

## Что нужно сделать (по шагам)

---

### ШАГ 1 — Создать папку в Google Drive

1. Открой [drive.google.com](https://drive.google.com)
2. Создай папку: `BaiTech CLM`
3. Внутри неё создай две подпапки: `Templates` и `Contracts`
4. Скопируй ID папки `Contracts` из URL (часть после `/folders/`)
   - Пример URL: `https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74`
   - ID = `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74`

---

### ШАГ 2 — Создать шаблоны Google Docs

#### Шаблон USA NDA:
1. Создай новый Google Doc в папке `Templates`
2. Назови: `Template_US_NDA`
3. Скопируй содержимое файла `US_NDA_Template.txt` в этот документ
4. Скопируй ID документа из URL
   - Пример URL: `https://docs.google.com/document/d/1ABC.../edit`
   - ID = `1ABC...`

#### Шаблон KZ NDA:
1. Создай новый Google Doc в папке `Templates`
2. Назови: `Template_KZ_NDA`
3. Скопируй содержимое файла `KZ_NDA_Template.txt` в этот документ
4. Скопируй ID документа из URL

---

### ШАГ 3 — Создать Google Form

1. Перейди на [forms.google.com](https://forms.google.com) → Новая форма
2. Назови форму: `BaiTech CLM — Contract Request`
3. Добавь вопросы в ТОЧНО таком порядке и с ТОЧНО такими названиями:

| Вопрос | Тип | Варианты |
|--------|-----|----------|
| `Страна / Country` | Раскрывающийся список | USA, Kazakhstan |
| `Тип NDA / NDA Type` | Раскрывающийся список | Unilateral (Односторонний), Mutual (Взаимный) |
| `Цель / Purpose` | Раскрывающийся список | Employment, Contract Work, Business Partnership, Sale of a Business, Other |
| `Название / ФИО второй стороны` | Краткий ответ | — |
| `Адрес второй стороны / Address` | Краткий ответ | — |
| `Доп. информация / Additional Details` | Абзац | (необязательный) |
| `Ваш email / Your Email` | Краткий ответ | — |

4. В настройках формы → "Собирать адреса электронной почты" — **выключить** (email мы берём из поля формы)

---

### ШАГ 4 — Создать Apps Script

1. В Google Drive → Новый → Google Apps Script
2. Назови проект: `BaiTech CLM`
3. Удали весь дефолтный код
4. Скопируй весь код из файла `Code.gs` и вставь в редактор
5. Нажми **Сохранить** (Ctrl+S)

---

### ШАГ 5 — Настроить Script Properties (ключи и IDs)

В редакторе Apps Script:
1. Нажми шестерёнку ⚙️ (Project Settings) → вкладка **Script Properties**
2. Добавь следующие свойства:

| Имя | Значение |
|-----|----------|
| `OPENAI_API_KEY` | твой OpenAI API ключ |
| `US_NDA_TEMPLATE_ID` | ID Google Doc шаблона USA (из Шага 2) |
| `KZ_NDA_TEMPLATE_ID` | ID Google Doc шаблона KZ (из Шага 2) |
| `OUTPUT_FOLDER_ID` | ID папки `Contracts` (из Шага 1) |

---

### ШАГ 6 — Обновить данные BaiTech в коде

В файле `Code.gs` (строки ~8-20) найди блок `var BAITECH = {...}` и замени на реальные данные BaiTech:
- `NAME_EN` — название на английском
- `NAME_RU` — название на русском (например `ТОО «BaiTech»`)
- `BIN` — реальный БИН компании
- `DIRECTOR` — ФИО директора
- `IIK`, `BANK`, `BIK` — банковские реквизиты

---

### ШАГ 7 — Привязать форму к скрипту (триггер)

1. В редакторе Apps Script → слева нажми **Триггеры** (иконка будильника)
2. Нажми **+ Добавить триггер**
3. Настройки:
   - Функция: `onFormSubmit`
   - Развертывание: Head
   - Источник событий: Из таблицы (Google Sheets) — **НЕТ**, нужно выбрать **Из формы**
   - Тип события: При отправке формы
4. Нажми **Сохранить**
5. Разрешить доступ (авторизация Google — нажать "Allow")

**Важно:** Форму нужно связать со скриптом через меню формы:
- Открой Google Form → три точки (⋮) → **Script editor** — если такой опции нет, создай Таблицу ответов (Responses → Link to Sheets), затем в этой таблице → Расширения → Apps Script → вставь код туда.

---

### ШАГ 8 — Протестировать

1. В редакторе Apps Script выбери функцию `testKazakhstan` из выпадающего списка
2. Нажми ▶️ Run
3. Посмотри логи (View → Logs)
4. Проверь папку `Contracts` в Drive — должен появиться новый документ и PDF

---

## Структура папок в Drive

```
BaiTech CLM/
├── Templates/
│   ├── Template_US_NDA     (Google Doc)
│   └── Template_KZ_NDA    (Google Doc)
└── Contracts/              ← сюда попадают готовые черновики
    ├── NDA_US_Acme_Corp_20250618_1430.gdoc
    ├── NDA_US_Acme_Corp_20250618_1430.pdf
    ├── NDA_KZ_Иванов_20250618_1435.gdoc
    └── NDA_KZ_Иванов_20250618_1435.pdf
```

---

## Как работает система (для презентации боссу)

```
Бухгалтер заполняет Google Form
        ↓
Apps Script получает ответ (автоматически)
        ↓
OpenAI API форматирует данные и заполняет пропуски
        ↓
Скрипт выбирает нужный шаблон (KZ или USA)
        ↓
Копирует шаблон, вставляет все данные
        ↓
Сохраняет Google Doc + PDF в Drive
        ↓
Отправляет email бухгалтеру со ссылкой
        ↓
Человек проверяет черновик ✓
```

---

## Плейсхолдеры в шаблонах

Все плейсхолдеры имеют формат `{{НАЗВАНИЕ}}`. Скрипт автоматически заменяет их на реальные данные.

### USA NDA:
`{{DATE}}`, `{{PARTY1_NAME}}`, `{{PARTY1_ADDRESS}}`, `{{PARTY2_NAME}}`, `{{PARTY2_ADDRESS}}`,
`{{CHECK_UNILATERAL}}`, `{{CHECK_MUTUAL}}`, `{{CHECK_EMPLOYMENT}}`, `{{CHECK_CONTRACT_WORK}}`,
`{{CHECK_BUSINESS_PARTNERSHIP}}`, `{{CHECK_SALE_OF_BUSINESS}}`, `{{CHECK_OTHER}}`,
`{{PURPOSE_OTHER_TEXT}}`, `{{STATE}}`, `{{PARTY1_PRINT}}`, `{{PARTY2_PRINT}}`

### KZ NDA:
`{{CITY}}`, `{{DATE_DAY}}`, `{{DATE_MONTH}}`, `{{DATE_YEAR}}`, `{{EMPLOYER_NAME}}`,
`{{EMPLOYER_REP}}`, `{{BASIS}}`, `{{REG_NUMBER}}`, `{{REG_DATE}}`, `{{BIN}}`,
`{{EMPLOYER_ADDRESS}}`, `{{IIK}}`, `{{BANK}}`, `{{BIK}}`, `{{EMPLOYEE_NAME}}`,
`{{ID_DOC}}`, `{{IIN}}`, `{{ADDRESS_ACTUAL}}`, `{{ADDRESS_REG}}`, `{{CONF_INFO}}`
