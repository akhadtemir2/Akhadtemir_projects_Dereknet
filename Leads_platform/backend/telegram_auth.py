#!/usr/bin/env python3
"""
BaiTech — Telegram авторизация (запустить один раз).

После выполнения создаётся tg_session.session — парсер будет использовать
её автоматически при каждом запуске без повторного ввода пароля.

Запуск:
    cd backend
    python telegram_auth.py
"""
import asyncio
import sys
from pathlib import Path

# Load .env from this directory
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path)
    except ImportError:
        pass

import os

API_ID   = os.getenv("TG_API_ID", "")
API_HASH = os.getenv("TG_API_HASH", "")
SESSION  = str(Path(__file__).parent / "tg_session")


def _check():
    errors = []
    if not API_ID:
        errors.append("TG_API_ID")
    if not API_HASH:
        errors.append("TG_API_HASH")
    if errors:
        print("\n❌ Не заполнены переменные в backend/.env:")
        for e in errors:
            print(f"   {e}=")
        print("\n📖 Как получить:")
        print("   1. Открой https://my.telegram.org")
        print("   2. Войди через номер телефона")
        print("   3. API development tools → Create application")
        print("   4. Скопируй App api_id и App api_hash")
        print("   5. Вставь в backend/.env и запусти снова\n")
        sys.exit(1)


async def main():
    _check()

    try:
        from telethon import TelegramClient
    except ImportError:
        print("\n❌ Telethon не установлен.")
        print("   Запусти: pip install telethon\n")
        sys.exit(1)

    print("\n🔐 BaiTech — авторизация Telegram парсера\n")
    print("   Telethon отправит код в Telegram на твой номер.")
    print("   Введи его когда попросит.\n")

    client = TelegramClient(SESSION, int(API_ID), API_HASH)

    try:
        await client.start()
        me = await client.get_me()
        uname = getattr(me, "username", None)
        display = f"{me.first_name}" + (f" (@{uname})" if uname else f" (id: {me.id})")
        print(f"\n✅ Успешно! Авторизован как: {display}")
        print(f"   Файл сессии: {SESSION}.session")
        print("\n   Теперь можно запустить Telegram парсер через интерфейс.\n")
    except Exception as e:
        print(f"\n❌ Ошибка: {e}\n")
        sys.exit(1)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
