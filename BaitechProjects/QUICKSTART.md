# BaitechProjects (baitech_dashboard) — быстрый запуск

Flutter-дашборд проектов компании BaiTech: канбан задач, дедлайны, фото, комментарии, голосовое создание задач (Whisper + GPT), статистика. Бэкенд — Supabase. Статус: **рабочий** — `flutter analyze` без ошибок.

Стек: Flutter · Supabase (Postgres + Storage) · OpenAI · provider.

## Настройка (один раз)
```sh
cd BaitechProjects
copy lib\config\secrets.example.dart lib\config\secrets.dart   # вписать supabaseUrl + supabaseAnonKey
flutter pub get
```
> `lib/config/secrets.dart` в `.gitignore` — свои ключи Supabase держи только локально.

## Запуск
```sh
# web (PWA) в Chrome
flutter run -d chrome --dart-define=OPENAI_API_KEY=sk-...

# Android APK
flutter build apk --release --dart-define=OPENAI_API_KEY=sk-...

# web-сборка для деплоя (Netlify/Vercel/Railway)
flutter build web --release --dart-define=OPENAI_API_KEY=sk-...
```
Без `--dart-define=OPENAI_API_KEY` работает всё, кроме голосового ввода.

## База данных
Supabase, таблицы с префиксом `bt_` (`bt_members`, `bt_projects`, `bt_photos`, `bt_comments`, `bt_activity`) + бакет `bt-photos`. Миграция: `supabase/migrations/`.

## Деплой
Есть `Dockerfile`, `nginx.conf`, `railway.json` — билд web-сборки за nginx. Подробнее — в [README.md](./README.md).

> Примечание: этот проект также ведётся в отдельном репозитории `github.com/akhadtemir2/BaiTechPROJECTS`.
