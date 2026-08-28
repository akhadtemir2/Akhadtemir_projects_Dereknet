# BaiTech Projects Dashboard

Мобильный дашборд проектов компании **BaiTech** во фирменном тёмном стиле
(`#242C3B`, `#37B6E9`, `#4B4CED`, `#353F54`, `#222834`).

Босс создаёт задания (текстом или **голосом** — ИИ сам разберёт «Задание для
Ахада, сделать X до пятницы»), назначает исполнителя (Akhad / Ruslan), ставит
дедлайн. Программисты видят задачи, меняют статусы, добавляют фото,
комментируют. Вся история изменений — в карточке проекта.

## Возможности

- **Канбан-вкладки**: Новые / В работе / Готово + поиск и фильтр по исполнителю
- **Индикаторы дедлайнов**: зелёный — времени много, жёлтый — завтра,
  красный пульсирующий — просрочен
- **Лента активности** в каждом проекте (кто, что и когда сделал)
- **Мини-чат** (комментарии) в карточке проекта
- **Фото проекта** — загрузка с телефона прямо в карточку (Supabase Storage)
- **Быстрый звонок** — тап по исполнителю запускает системный звонок
- **Голосовое создание задач** — Whisper + GPT (нужен `OPENAI_API_KEY`)
- **Статистика** — закрытые проекты по месяцам, нагрузка по программистам
- **Offline-режим** — данные кэшируются, приложение открывается без сети

## Стек

Flutter · Supabase (Postgres + Storage) · OpenAI (Whisper + gpt-4o-mini) ·
provider · fl_chart · url_launcher · record · image_picker

## Запуск

1. Скопируй `lib/config/secrets.example.dart` → `lib/config/secrets.dart`
   и подставь ключи Supabase (URL и anon key проекта).
2. Установи зависимости и запусти:

```sh
flutter pub get
# web (PWA)
flutter run -d chrome --dart-define=OPENAI_API_KEY=sk-...
# Android APK для Босса
flutter build apk --release --dart-define=OPENAI_API_KEY=sk-...
```

Без `--dart-define=OPENAI_API_KEY` всё работает, кроме голосового ввода.

## PWA (для iPhone)

```sh
flutter build web --release --dart-define=OPENAI_API_KEY=sk-...
```

Задеплой папку `build/web` на любой хостинг (Netlify / Vercel / GitHub Pages),
открой в Safari → «Поделиться» → «На экран Домой».

## База данных

Схема живёт в Supabase (таблицы с префиксом `bt_`): `bt_members`,
`bt_projects`, `bt_photos`, `bt_comments`, `bt_activity` + бакет `bt-photos`.
Миграция: `supabase/migrations/baitech_dashboard_schema.sql`.

## Фаза 2 (планы)

- GitHub Webhooks → автообновление статусов по коммитам/PR
- Push-уведомления о новых заданиях и дедлайнах
- Полноценный аккаунт-логин (Supabase Auth) вместо выбора профиля
