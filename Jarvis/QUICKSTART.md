# Jarvis (MARK L) — быстрый запуск

Голосовой AI-ассистент на PyQt6 (Gemini Live / OpenAI Realtime). Статус: **рабочий** — `main.py` и `ui.py` компилируются без ошибок, есть успешный лог запуска.

## Требования
- Windows (проверено), Python **3.13**
- VPN (US/EU) — Gemini API заблокирован по региону
- Ключи API: Gemini (обязательно), OpenAI (для распознавания речи)

## Установка (один раз)
```bash
cd Jarvis
python setup.py          # ставит зависимости из requirements.txt + браузеры Playwright
```

## Настройка ключей (один раз)
```bash
# скопировать шаблон и вписать свои ключи
copy config\api_keys.example.json config\api_keys.json
```
Открой `config/api_keys.json` и заполни как минимум:
- `gemini_api_key` — ключ Gemini
- `openai_api_key` — ключ OpenAI (речь → текст); при пустом идёт офлайн-фолбэк

> `config/api_keys.json` и TLS-сертификаты в репозиторий **не** попадают (в `.gitignore`) — их создаёшь локально. Сертификаты для дашборда генерируются автоматически при первом запуске.

## Запуск
```bash
python main.py
```
или двойной клик по `run.bat` (в исходной папке проекта).
Включи VPN. Если увидишь «denied access» — значит VPN выключен.

## Подробнее
Полное описание возможностей — в [`readme.md`](./readme.md).
