# Leads_platform (BaiTech Lead Hub) — быстрый запуск

Платформа сбора лидов: парсит организации/контакты из **Instagram, Telegram, 2GIS**, оценивает их через AI (OpenAI), хранит в Supabase. Фронт — React/Vite, бэк — FastAPI. Статус: **рабочий** — бэкенд компилируется чисто, `npm run build` собирается без ошибок.

Стек: React + Vite + Tailwind · FastAPI · Supabase · OpenAI · Telethon · instagrapi.

## Настройка (один раз)
```sh
cd Leads_platform
# 1) секреты бэкенда
copy backend\.env.example backend\.env      # заполнить ключи Supabase/OpenAI/Telegram/2GIS
# 2) зависимости
npm install
pip install -r backend/requirements.txt
```
> `backend/.env`, `tg_session.session`, `ig_sessions/` — в `.gitignore`. Это доступы к аккаунтам, храни только локально.

## Запуск (dev)
```sh
# бэкенд → http://localhost:8000
cd backend && uvicorn main:app --reload --port 8000

# фронтенд (в отдельном терминале) → http://localhost:5173
npm run dev
```
На Windows можно просто запустить `start.bat` — поднимет оба сервера и откроет браузер.

## Сборка / деплой
```sh
npm run build          # статика фронта в dist/
```
Деплой настроен под Railway (`railway.toml` + `nixpacks.toml`) и Vercel (`vercel.json`); бэкенд стартует через `Procfile`: `uvicorn main:app`.

## Аккаунты для парсинга
- **Telegram**: `TG_API_ID` / `TG_API_HASH` с my.telegram.org; первую авторизацию Telethon сделать через `python backend/telegram_auth.py` (создаст сессию).
- **Instagram**: `python backend/instagram_auth.py` (спросит логин/пароль, сохранит сессию в `ig_sessions/`).

> Примечание: проект также ведётся в отдельном репозитории `github.com/akhadtemir2/BaiTechLeads`.
