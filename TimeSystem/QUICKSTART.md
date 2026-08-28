# TimeSystem — быстрый запуск

Система учёта посещаемости по распознаванию лиц: веб-сервер (регистрация/отметка по лицу) + Telegram-бот (отметка по геолокации). Статус: **рабочий** — все модули компилируются без ошибок. Стек: Python 3.11, DeepFace/TensorFlow, python-telegram-bot.

## Компоненты
- `attendance_face_only.py` — веб-сервер на порту `8000` (панель админа, распознавание лиц)
- `bot.py` — Telegram-бот (отметка прихода/ухода по геолокации офиса)
- `preload_model.py` — заранее скачивает модель DeepFace

## Локальный запуск
```bash
cd TimeSystem
pip install -r requirements.txt
python preload_model.py        # один раз — скачать модель
python attendance_face_only.py # веб-сервер → http://localhost:8000
python bot.py                  # в отдельном терминале — Telegram-бот
```
Либо оба сразу: `bash start.sh`

## Деплой (Railway / Docker)
```bash
docker build -t timesystem .
docker run -p 8000:8000 timesystem
```
Railway использует `railway.toml` (билд из `Dockerfile`, старт `bash start.sh`, healthcheck `/api/status`).

## ⚠️ Безопасность — обязательно
- **Токен Telegram-бота захардкожен** в `bot.py` и теперь опубликован. **Отзови и перевыпусти** его у [@BotFather](https://t.me/BotFather) (`/revoke`), новый вставь в `bot.py` (или лучше — вынеси в переменную окружения `BOT_TOKEN`).
- **Пароль админа** `admin123` в `attendance_face_only.py` — смени на свой.
- `faces_data.pkl` (биометрия сотрудников) и `attendance.json` в репозиторий не включены — это данные людей, храни их только локально.
