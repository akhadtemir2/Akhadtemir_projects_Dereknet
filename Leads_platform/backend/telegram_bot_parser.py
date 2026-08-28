"""
Telegram Bot API parser — monitors groups where the bot is a member.

Requirements:
  1. Bot is added to the group (as member or admin)
  2. Privacy Mode is DISABLED via @BotFather:
     /mybots → Bot Settings → Group Privacy → Turn off

This uses long-polling (getUpdates) — no webhook needed for local dev.
"""
import asyncio
import logging
import os
import random
from datetime import datetime, timezone

import httpx

try:
    from ai_scorer import (
        score_message, prefilter_message, is_lead_worth_saving, generate_opener,
    )
except ImportError:
    async def score_message(*a, **kw):
        return None
    async def prefilter_message(*a, **kw):
        return True
    def is_lead_worth_saving(scored):
        return False, "ai_scorer недоступен"
    async def generate_opener(*a, **kw):
        return ""

logger = logging.getLogger("tg_bot_parser")

BACKEND = f"http://127.0.0.1:{os.getenv('PORT', '8000')}"

_KEYWORDS = [
    "бизнес", "продажи", "клиент", "заявк", "не успева", "автоматиз",
    "чат-бот", "чат бот", "чатбот", "ии бот", "ai бот", "chatbot", "бот", "запис",
    "предприниматель", " ип ", "тоо",
    "магазин", "салон", "ресторан", "кафе", "автосервис", "стоматолог",
    "клиника", "строй", "ремонт", "whatsapp", "вотсап", "инстаграм",
    "менеджер", "crm", "крм", "кәсіпкер", "тұтынушы", "сатылым",
]

_state: dict = {
    "running":    False,
    "task":       None,
    "offset":     None,
    "groups":     {},        # chat_id → title
    # seen = every message the bot received. scanned = passed the keyword gate.
    "stats":      {"seen": 0, "scanned": 0, "found": 0, "hot": 0, "errors": 0},
    "last_error": None,
    "limits":     {"leads_per_day": 50},
    "day_counts": {"date": "", "leads": 0},
    "last_activity": None,  # heartbeat — proves polling is alive 24/7
}

# Telegram API returns these sporadically — retry, don't surface as a fatal error
_TRANSIENT_ERRORS = ("bad gateway", "gateway timeout", "too many requests", "internal server error")

# In-memory duplicate cache (profile_url → True). The Telethon parser had one but
# this one didn't — two fast messages from the same author could create two leads.
_seen_profiles: set = set()


def set_limits(leads_per_day: int = None) -> dict:
    if leads_per_day:
        _state["limits"]["leads_per_day"] = max(1, min(int(leads_per_day), 500))
    return _state["limits"].copy()


def _day_quota_left() -> int:
    from datetime import date
    today = date.today().isoformat()
    if _state["day_counts"]["date"] != today:
        _state["day_counts"] = {"date": today, "leads": 0}
    return _state["limits"]["leads_per_day"] - _state["day_counts"]["leads"]


def _count_lead():
    _day_quota_left()  # ensures date rollover
    _state["day_counts"]["leads"] += 1


# ── Helpers ───────────────────────────────────────────────────────────────────

def _token() -> str:
    return os.getenv("TELEGRAM_BOT_TOKEN", "")


def _relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in _KEYWORDS)


async def _api_call(method: str, path: str, **kwargs):
    try:
        async with httpx.AsyncClient() as c:
            r = await getattr(c, method)(f"{BACKEND}{path}", timeout=8, **kwargs)
            return r.json() if r.status_code < 400 else None
    except Exception:
        return None


async def _tg(endpoint: str, **params):
    token = _token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(
                f"https://api.telegram.org/bot{token}/{endpoint}",
                params=params,
                timeout=35,
            )
            return r.json()
    except Exception as e:
        logger.debug(f"TG API error: {e}")
        return None


async def _is_duplicate(profile_url: str) -> bool:
    if profile_url in _seen_profiles:
        return True
    data = await _api_call("get", "/leads/exists", params={"profile_url": profile_url})
    if data and data.get("exists"):
        _seen_profiles.add(profile_url)
        return True
    return False


async def _save_lead(payload: dict):
    # Claim the slot in cache BEFORE the async save to close the race window
    profile_url = payload.get("profile_url", "")
    if profile_url:
        _seen_profiles.add(profile_url)
    return await _api_call("post", "/leads", json=payload)


async def _log(action: str, target: str = "", result: str = ""):
    await _api_call("post", "/agent-logs", json={
        "channel": "telegram", "action": action,
        "target": target, "result": result,
    })


# ── Message processing ────────────────────────────────────────────────────────

async def _process(update: dict):
    msg = update.get("message") or update.get("channel_post")
    if not msg:
        return

    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    chat_title = chat.get("title", str(chat_id))

    # Register the group on ANY message, before any filtering. Doing this after
    # the keyword gate made an empty group list ambiguous: "bot is in no groups"
    # and "no keyword matched yet" looked identical.
    if chat_id and chat.get("type") in ("group", "supergroup", "channel"):
        _state["groups"][chat_id] = chat_title

    text = (msg.get("text") or "").strip()
    if text:
        _state["stats"]["seen"] += 1  # honest: counts every message we receive
    if len(text) < 25 or not _relevant(text):
        return

    sender = msg.get("from") or {}
    if sender.get("is_bot"):
        return

    _state["stats"]["scanned"] += 1

    uid = sender.get("username")
    user_id = sender.get("id")
    profile_url = f"https://t.me/{uid}" if uid else f"tg://openmessage?user_id={user_id}"

    if await _is_duplicate(profile_url):
        return

    first = sender.get("first_name", "")
    last  = sender.get("last_name", "")
    name  = f"{first} {last}".strip() or "Неизвестно"

    # Stage 1 — cheap prefilter (~40x cheaper than the full scorer)
    if not await prefilter_message(text):
        return

    # Stage 2 — full scoring
    scored = await score_message(text, name)
    if scored is None:
        await asyncio.sleep(2)
        scored = await score_message(text, name)
    if scored is None:
        # No AI verdict → no lead. Keyword match alone produces garbage.
        _state["stats"]["errors"] += 1
        logger.warning("AI-скоринг недоступен — сообщение пропущено без сохранения")
        return

    # Same rule as Telethon: a B2C owner is a lead even without stated pain.
    status = scored.get("lead_status", "cold")
    accepted, why = is_lead_worth_saving(scored)
    verdict = "ПРИНЯТ" if accepted else "ОТКЛОНЁН"
    await _log(
        "ai_verdict",
        profile_url,
        f"{verdict} · {status} {scored.get('score', 0)}pts · {why} · {scored.get('reason', '')[:100]} · «{text[:100]}»",
    )
    if not accepted:
        return

    btype  = scored.get("business_type", "другое")
    lang   = scored.get("language", "ru")
    hot    = bool(scored.get("is_hot", False))

    # Every lead ships with a ready-to-send first message
    opener = scored.get("suggested_opener_ru") or scored.get("suggested_opener_kaz") or ""
    if not opener:
        opener = await generate_opener(text, btype, lang)
    opener_line = f"\nopener: {opener}" if opener else ""
    notes  = f"Группа: {chat_title} · {status} ({scored.get('score', 0)}pts)\n{scored.get('reason', '')}{opener_line}"

    lead = {
        "channel":       "telegram",
        "name":          name,
        "profile_url":   profile_url,
        "phone":         "",
        "business_type": btype,
        "language":      lang,
        "status":        "found",
        "source":        "outbound",
        "last_message":  text[:500],
        "notes":         notes,
        "is_hot":        hot,
    }

    if _day_quota_left() <= 0:
        logger.info(f"Daily lead limit reached ({_state['limits']['leads_per_day']}) — skipping {name}")
        return

    saved = await _save_lead(lead)
    if saved:
        _count_lead()
        _state["stats"]["found"] += 1
        if hot:
            _state["stats"]["hot"] += 1
        await _log("lead_found", profile_url, f"{name} | {btype} | {chat_title}")
        logger.info(f"Lead: {name} | {btype} | hot={hot} | {chat_title}")

    await asyncio.sleep(random.uniform(0.2, 0.8))


# ── Polling loop ──────────────────────────────────────────────────────────────

async def _poll():
    logger.info("Bot API polling started")

    # Remove webhook if active — conflicts with getUpdates
    await _tg("deleteWebhook", drop_pending_updates=False)

    await _log("parser_start", "", "Bot API polling")

    # Drop accumulated updates so we only process new ones from now
    skip = await _tg("getUpdates", offset=-1, timeout=1)
    if skip and skip.get("result"):
        _state["offset"] = skip["result"][-1]["update_id"] + 1

    while _state["running"]:
        try:
            params = {
                "timeout":          25,
                "allowed_updates":  '["message","channel_post"]',
            }
            if _state["offset"]:
                params["offset"] = _state["offset"]

            data = await _tg("getUpdates", **params)

            if data is None:
                await asyncio.sleep(5)
                continue

            if not data.get("ok"):
                err = data.get("description", "unknown")
                if any(t in err.lower() for t in _TRANSIENT_ERRORS):
                    # Temporary Telegram-side hiccup — just retry quietly
                    logger.warning(f"getUpdates transient error: {err}")
                    await asyncio.sleep(5)
                elif data.get("error_code") == 409:
                    _state["last_error"] = "Конфликт: этот бот уже опрашивается другим сервером (409). Останови второй инстанс."
                    logger.error(f"getUpdates conflict: {err}")
                    await asyncio.sleep(30)
                else:
                    _state["last_error"] = err
                    logger.error(f"getUpdates error: {err}")
                    await asyncio.sleep(10)
                continue

            # Successful poll — heartbeat + clear stale errors
            _state["last_activity"] = datetime.now(timezone.utc).isoformat()
            if _state["last_error"]:
                _state["last_error"] = None

            for update in data.get("result", []):
                _state["offset"] = update["update_id"] + 1
                try:
                    await _process(update)
                except Exception as e:
                    _state["stats"]["errors"] += 1
                    logger.debug(f"process error: {e}")

        except asyncio.CancelledError:
            break
        except Exception as e:
            _state["last_error"] = str(e)
            logger.error(f"Poll error: {e}")
            await asyncio.sleep(10)

    _state["running"] = False
    await _log("parser_stop", "", f"Найдено лидов: {_state['stats']['found']}")
    logger.info("Bot API polling stopped")


# ── Public API ────────────────────────────────────────────────────────────────

def status() -> dict:
    return {
        "running":    _state["running"],
        "mode":       "bot_api",
        "groups":     _state["groups"],
        "stats":      _state["stats"].copy(),
        "last_error": _state["last_error"],
        "limits":     _state["limits"].copy(),
        "leads_today": _state["limits"]["leads_per_day"] - _day_quota_left(),
        "last_activity": _state["last_activity"],
    }


async def start() -> tuple[bool, str]:
    if not _token():
        return False, "TELEGRAM_BOT_TOKEN не настроен в .env"
    if _state["running"]:
        return False, "Парсер уже запущен"

    _state.update({
        "running":    True,
        "offset":     None,
        "stats":      {"seen": 0, "scanned": 0, "found": 0, "hot": 0, "errors": 0},
        "last_error": None,
    })
    _state["task"] = asyncio.create_task(_poll())
    return True, "Bot API парсер запущен"


async def stop() -> bool:
    _state["running"] = False
    if t := _state.get("task"):
        t.cancel()
        _state["task"] = None
    return True
