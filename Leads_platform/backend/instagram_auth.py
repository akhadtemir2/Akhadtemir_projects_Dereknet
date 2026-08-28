"""
Run this LOCALLY to create/refresh the Instagram session.
Paste the printed string into the site: Агенты → Instagram → «Или вставь строку сессии».

Usage (любой из вариантов):
  python instagram_auth.py                      # спросит логин/пароль
  python instagram_auth.py <логин> <пароль>     # без вопросов
  IG_USERNAME=... IG_PASSWORD=... python instagram_auth.py
"""
import asyncio
import os
import sys
from getpass import getpass
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")


def _ask(prompt: str, secret: bool = False) -> str:
    """input() explodes with EOFError when stdin is not a real terminal
    (IDE consoles, piped shells). Fail with a clear instruction instead."""
    if not sys.stdin or not sys.stdin.isatty():
        print(
            f"\nНе могу спросить «{prompt}» — этот терминал не принимает ввод.\n"
            "Передай логин и пароль прямо в команде:\n"
            "    python backend\\instagram_auth.py ТВОЙ_ЛОГИН ТВОЙ_ПАРОЛЬ\n"
        )
        sys.exit(1)
    return (getpass(f"{prompt}: ") if secret else input(f"{prompt}: ")).strip()


async def main():
    try:
        from instagrapi import Client
    except ImportError:
        print("instagrapi не установлен. Выполни: pip install instagrapi")
        return

    args = [a for a in sys.argv[1:] if a.strip()]
    username = (args[0] if len(args) > 0 else os.getenv("IG_USERNAME", "")).strip().lstrip("@")
    password = (args[1] if len(args) > 1 else os.getenv("IG_PASSWORD", "")).strip()

    if not username:
        username = _ask("Instagram username").lstrip("@")
    if not password:
        password = _ask("Instagram password", secret=True)

    if not username or not password:
        print("Нужны и логин, и пароль.")
        return

    sessions_dir = Path(__file__).parent / "ig_sessions"
    sessions_dir.mkdir(exist_ok=True)
    session_file = sessions_dir / f"{username}.json"

    def kz_fingerprint(c):
        """Bake KZ locale/country/timezone into the session — Instagram then
        tolerates the server IP change much better."""
        c.set_locale("ru_RU")
        c.set_country("KZ")
        c.set_country_code(7)
        c.set_timezone_offset(5 * 3600)  # Kazakhstan = UTC+5

    cl = Client()
    cl.delay_range = [3, 7]

    if session_file.exists():
        print(f"Загружаю сохранённую сессию...")
        try:
            cl.load_settings(session_file)
            kz_fingerprint(cl)
            cl.login(username, password)
            cl.dump_settings(session_file)
            print(f"Сессия обновлена как @{username}")
        except Exception as e:
            print(f"Сессия устарела, создаю новую (сохраняю устройство): {e}")
            # Keep the same device UUIDs — Instagram sees the same phone again
            try:
                old_uuids = cl.get_settings().get("uuids", {})
                cl.set_settings({})
                if old_uuids:
                    cl.set_uuids(old_uuids)
            except Exception:
                cl = Client()
                cl.delay_range = [3, 7]
            kz_fingerprint(cl)
            cl.login(username, password)
            cl.dump_settings(session_file)
            print(f"Новая сессия создана как @{username}")
    else:
        print("Выполняю вход...")
        kz_fingerprint(cl)
        cl.login(username, password)
        cl.dump_settings(session_file)
        print(f"Сессия сохранена как @{username}")

    import base64, gzip
    data = session_file.read_bytes()
    encoded = base64.b64encode(gzip.compress(data, 9)).decode()

    print(f"\n{'='*70}")
    print("Скопируй строку ниже и вставь на сайте: Агенты → Instagram →")
    print("«Или вставь строку сессии» → Применить. Без редеплоя.")
    print(f"{'='*70}")
    print(encoded)
    print(f"{'='*70}")
    print("Если Instagram пришлёт уведомление «подозрительный вход» —")
    print("подтверди в приложении: «Это был(а) я».")


asyncio.run(main())
