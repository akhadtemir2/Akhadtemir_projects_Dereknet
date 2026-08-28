"""
Telegram parser using Telethon.
Scans public groups for business owner leads and saves them to Supabase via the API.

Setup: run telegram_auth.py once to create the session file.
"""
import asyncio
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pathlib import Path as _Path
from dotenv import load_dotenv as _load_dotenv
_load_dotenv(_Path(__file__).parent / ".env")

try:
    from telethon import TelegramClient, events
    from telethon.tl.types import User
    from telethon.tl.functions.channels import JoinChannelRequest
    from telethon.errors import FloodWaitError, ChannelPrivateError, UsernameNotOccupiedError
    TELETHON_OK = True
except ImportError:
    TELETHON_OK = False

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

logger = logging.getLogger("tg_parser")

_DIR = Path(__file__).parent
SESSION_PATH = str(_DIR / "tg_session")
BACKEND = f"http://127.0.0.1:{os.getenv('PORT', '8000')}"

# Keywords from CLAUDE.md — any match triggers AI analysis
_KEYWORDS = [
    # Бизнес / владелец
    "бизнес", "предприниматель", " ип ", " жк ", "тоо", " жшс ", "владелец", "открыл", "открываю",
    # Боль / поток
    "продажи", "клиент", "заявк", "не успева", "теряю", "пропуска", "много сообщ", "много заявок",
    "отвечаю сам", "пишут ночью", "пишут в выходные", "не дожидаются",
    # Автоматизация
    "автоматиз", "чат-бот", "чат бот", "чатбот", "ии бот", "ai бот", "chatbot",
    "бот", "запис", "crm", "крм", "whatsapp", "вотсап", "инстаграм",
    # Ниши RU
    "магазин", "салон", "ресторан", "кафе", "автосервис", "автомой", "шиномонтаж", "детейлинг",
    "стоматолог", "клиника", "медцентр", "аптека", "ветклин", "барбершоп", "парикмахер",
    "маникюр", "косметолог", "массаж", "спа", "фитнес", "зал", "йога", "бассейн",
    "строй", "ремонт", "окна", "потолки", "клининг", "химчистк",
    "доставк", "курьер", "фотограф", "студия", "праздник", "отель", "гостиниц", "баня",
    "детский центр", "автошкол", "репетитор",
    # Ниши KZ
    "кәсіпкер", "тұтынушы", "сатылым", "дүкен", "дәмхана", "мейрамхана", "салон", "автожуу",
    "дәріхана", "стоматолог", "медорталық", "жиһаз", "гүлдер",
    # Менеджмент
    "менеджер", "администратор", "сотрудник",
]

_state: dict = {
    "running": False,
    "task": None,
    "client": None,
    "groups": [],
    # seen = every message we actually read. scanned = passed the keyword gate.
    # Without `seen` a silent parser and a parser whose filter rejects
    # everything look identical (both show scanned=0) — that cost us 2 days.
    "stats": {"seen": 0, "scanned": 0, "found": 0, "hot": 0, "errors": 0},
    "last_error": None,
    "limits": {"leads_per_day": 50},
    "day_counts": {"date": "", "leads": 0},
    "last_activity": None,  # heartbeat — proves the parser is alive 24/7
    "joined": 0,            # groups the account is actually a member of
}

# In-memory duplicate cache (profile_url → True) to avoid repeated DB calls
_seen_profiles: set = set()


def _touch():
    _state["last_activity"] = datetime.now(timezone.utc).isoformat()


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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in _KEYWORDS)


async def _call(method: str, path: str, **kwargs):
    try:
        async with httpx.AsyncClient() as c:
            r = await getattr(c, method)(f"{BACKEND}{path}", timeout=8, **kwargs)
            return r.json() if r.status_code < 400 else None
    except Exception:
        return None


async def _is_duplicate(profile_url: str) -> bool:
    if profile_url in _seen_profiles:
        return True
    # Pinpoint check — no longer pulls 500 leads per message (broke past 500 rows)
    data = await _call("get", "/leads/exists", params={"profile_url": profile_url})
    if data and data.get("exists"):
        _seen_profiles.add(profile_url)
        return True
    return False


async def _save(payload: dict):
    # Claim the slot in cache BEFORE the async save to prevent race conditions
    profile_url = payload.get("profile_url", "")
    if profile_url:
        _seen_profiles.add(profile_url)
    return await _call("post", "/leads", json=payload)


async def _log(action: str, target: str = "", result: str = ""):
    await _call("post", "/agent-logs", json={
        "channel": "telegram", "action": action,
        "target": target, "result": result,
    })


# ── Message processing ────────────────────────────────────────────────────────

async def _process(message, group_title: str):
    _touch()
    text = (message.text or "").strip()
    if text:
        _state["stats"]["seen"] += 1  # honest: counts every message we read
    if len(text) < 25 or not _relevant(text):
        return

    sender = await message.get_sender()
    if not isinstance(sender, User) or sender.bot:
        return

    _state["stats"]["scanned"] += 1

    uid = getattr(sender, "username", None)
    profile_url = f"https://t.me/{uid}" if uid else f"tg://openmessage?user_id={sender.id}"

    if await _is_duplicate(profile_url):
        return

    name = f"{sender.first_name or ''} {sender.last_name or ''}".strip() or "Неизвестно"
    phone = getattr(sender, "phone", "") or ""

    # Stage 1 — cheap prefilter (~40x cheaper than the full scorer).
    # Cuts OpenAI cost dramatically: only real candidates reach stage 2.
    if not await prefilter_message(text):
        return

    # Stage 2 — full scoring
    scored = await score_message(text, name)
    if scored is None:
        # One retry — a transient AI hiccup shouldn't cost a real lead
        await asyncio.sleep(2)
        scored = await score_message(text, name)
    if scored is None:
        # No AI verdict → no lead. Keyword match alone produces garbage
        # (investor seekers, ads) — never save unscored messages.
        _state["stats"]["errors"] += 1
        logger.warning("AI-скоринг недоступен — сообщение пропущено без сохранения")
        return

    # A B2C owner is a lead even if he never voiced a problem — he is exactly
    # the person who does not know a bot would save him hours. Only the people
    # a bot cannot help (investors, competitors, recruiters) are rejected.
    status = scored.get("lead_status", "cold")
    accepted, why = is_lead_worth_saving(scored)

    # Verdict log — owner sees WHY each candidate was taken or rejected
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

    # Every lead ships with a ready-to-send first message. The owner approves
    # and sends — he never writes from scratch, so an empty opener = dead lead.
    opener = scored.get("suggested_opener_ru") or scored.get("suggested_opener_kaz") or ""
    if not opener:
        opener = await generate_opener(text, btype, lang)
    opener_line = f"\nopener: {opener}" if opener else ""
    notes  = f"Группа: {group_title} · {status} ({scored.get('score', 0)}pts)\n{scored.get('reason', '')}{opener_line}"

    lead = {
        "channel":       "telegram",
        "name":          name,
        "profile_url":   profile_url,
        "phone":         phone,
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

    saved = await _save(lead)
    if saved:
        _state["day_counts"]["leads"] += 1
        _state["stats"]["found"] += 1
        if hot:
            _state["stats"]["hot"] += 1
        await _log("lead_found", profile_url, f"{name} | {btype} | {group_title}")
        logger.info(f"Lead: {name} | {btype} | hot={hot}")

    await asyncio.sleep(random.uniform(0.5, 2.0))


# ── Group scanning ────────────────────────────────────────────────────────────

# Bumped to v2 when the "owner without stated pain is still a lead" rule
# landed: history must be re-read once under the new, less strict filter,
# otherwise every owner the old filter threw away stays lost forever.
_SCANNED_KEY = "tg_scanned_groups_v2"


async def _get_scanned_groups() -> set:
    """Groups whose history was already scanned — persisted so server
    restarts don't re-score the same 300 messages (token burn)."""
    data = await _call("get", "/settings")
    raw = (data or {}).get(_SCANNED_KEY, "")
    return {g.strip() for g in raw.split(",") if g.strip()}


async def _mark_scanned(group: str, scanned: set):
    scanned.add(group)
    await _call("put", f"/settings/{_SCANNED_KEY}", json={"value": ",".join(sorted(scanned))})


async def _ensure_joined(client, groups: list[str]) -> int:
    """Join every group — the single most important step in this file.

    Telegram pushes realtime updates ONLY for chats the account is a member of.
    Reading history works without joining, which is why the parser could sit
    "running" with a healthy heartbeat for days and still see zero messages.
    """
    joined = 0
    for g in groups:
        if not _state["running"]:
            break
        try:
            entity = await client.get_entity(g)
            try:
                await client(JoinChannelRequest(entity))
            except Exception as e:
                # Already a participant is a success, not a failure
                if "already" not in str(e).lower() and "participant" not in str(e).lower():
                    raise
            joined += 1
            await asyncio.sleep(random.uniform(2, 5))  # look human
        except FloodWaitError as e:
            logger.warning(f"FloodWait {e.seconds}s on join {g}")
            await asyncio.sleep(min(e.seconds, 60))
        except Exception as e:
            logger.warning(f"Не удалось вступить в {g}: {e}")
            await _log("join_failed", g, str(e)[:120])
    _state["joined"] = joined
    logger.info(f"Состоим в {joined}/{len(groups)} группах")
    await _log("groups_joined", "", f"{joined} из {len(groups)}")
    return joined


async def _scan_history(client, group: str, limit: int = 300):
    try:
        entity = await client.get_entity(group)
        title = getattr(entity, "title", group)
        count = 0
        async for msg in client.iter_messages(entity, limit=limit):
            if not _state["running"]:
                break
            try:
                await _process(msg, title)
            except Exception as e:
                _state["stats"]["errors"] += 1
                logger.debug(f"msg error: {e}")
            count += 1
            if count % 25 == 0:
                await asyncio.sleep(random.uniform(1, 3))
        await _log("scan_history", group, f"{count} сообщений")
        logger.info(f"Scanned {count} messages in {group}")
    except FloodWaitError as e:
        logger.warning(f"FloodWait {e.seconds}s for {group}")
        await asyncio.sleep(e.seconds)
    except (ChannelPrivateError, UsernameNotOccupiedError):
        await _log("scan_skip", group, "private or not found")
        logger.warning(f"Skipped {group}: private or not found")
    except Exception as e:
        _state["stats"]["errors"] += 1
        _state["last_error"] = str(e)
        logger.error(f"Scan error {group}: {e}")


# ── Main parser task ──────────────────────────────────────────────────────────

def _read_env_direct() -> tuple[str, str]:
    """Read TG_API_ID and TG_API_HASH directly from .env file — bulletproof fallback."""
    api_id = os.getenv("TG_API_ID", "").strip()
    api_hash = os.getenv("TG_API_HASH", "").strip()
    if api_id and api_hash:
        return api_id, api_hash
    env_path = _Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if "=" not in line or line.startswith("#"):
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if key == "TG_API_ID":
                api_id = val
            elif key == "TG_API_HASH":
                api_hash = val
    return api_id, api_hash


async def _run(groups: list[str]):
    api_id, api_hash = _state.get("_api_id", ""), _state.get("_api_hash", "")
    if not api_id or not api_hash:
        api_id, api_hash = _read_env_direct()

    if not api_id or not api_hash:
        _state["last_error"] = "TG_API_ID / TG_API_HASH не заполнены в backend/.env"
        _state["running"] = False
        return

    client = TelegramClient(SESSION_PATH, int(api_id), api_hash)
    _state["client"] = client

    retry_delay = 30
    handler_added = False  # NewMessage handler survives reconnects — register once,
    # otherwise every reconnect adds a duplicate and each message is scored twice
    while _state["running"]:
        try:
            await client.connect()

            if not await client.is_user_authorized():
                _state["last_error"] = "Сессия не найдена — запусти: python telegram_auth.py"
                _state["running"] = False
                break

            me = await client.get_me()
            uname = getattr(me, "username", str(me.id))
            _state["last_error"] = None  # connected fine — drop stale errors
            logger.info(f"Parser started as @{uname}")
            await _log("parser_start", uname, f"Groups: {', '.join(groups)}")

            # Phase 0 — JOIN. Without membership Telegram sends us no realtime
            # updates at all, and the parser silently reads nothing forever.
            await _ensure_joined(client, groups)

            # Phase 1 — scan history (once per group, ever)
            scanned_groups = await _get_scanned_groups()
            for g in groups:
                if not _state["running"]:
                    break
                if g in scanned_groups:
                    logger.info(f"История {g} уже просканирована — только realtime")
                    continue
                await _scan_history(client, g)
                await _mark_scanned(g, scanned_groups)
                await asyncio.sleep(random.uniform(3, 6))

            if not _state["running"]:
                break

            # Phase 2 — real-time
            entities = []
            for g in groups:
                try:
                    entities.append(await client.get_entity(g))
                except Exception:
                    pass

            if not entities:
                # All groups failed to resolve — back off instead of hammering
                # Telegram with instant reconnects
                _state["last_error"] = "Ни одна группа не найдена — проверь ссылки/юзернеймы"
                await asyncio.sleep(60)
                continue

            if not handler_added:
                @client.on(events.NewMessage(chats=entities))
                async def _on_new(event):
                    if not _state["running"]:
                        return
                    try:
                        await _process(event.message, getattr(event.chat, "title", ""))
                    except Exception as e:
                        logger.debug(f"realtime: {e}")
                handler_added = True

            logger.info("Real-time monitoring active")
            beat = 0
            while _state["running"]:
                _touch()
                await asyncio.sleep(5)
                beat += 1
                # Keepalive: ping Telegram once a minute to detect silent
                # disconnects (every 5s was ~17k pointless calls/day)
                if beat % 12 == 0:
                    try:
                        await client.get_me()
                    except Exception:
                        logger.warning("Telegram connection lost, reconnecting...")
                        break

        except asyncio.CancelledError:
            break
        except Exception as e:
            _state["last_error"] = str(e)
            logger.error(f"Parser error: {e}, retrying in {retry_delay}s")
            if _state["running"]:
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 300)  # exponential backoff, max 5 min
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass

    _state["running"] = False
    _state["client"] = None
    await _log("parser_stop", "", f"Найдено: {_state['stats']['found']}")


# ── Public API ────────────────────────────────────────────────────────────────

def status() -> dict:
    return {
        "available":  TELETHON_OK,
        "running":    _state["running"],
        "groups":     _state["groups"],
        "stats":      _state["stats"].copy(),
        "last_error": _state["last_error"],
        "limits":     _state["limits"].copy(),
        "leads_today": _state["limits"]["leads_per_day"] - _day_quota_left(),
        "last_activity": _state["last_activity"],
        "joined":     _state["joined"],
    }


async def start(groups: list[str]) -> tuple[bool, str]:
    if not TELETHON_OK:
        return False, "Telethon не установлен. Запусти: pip install telethon"
    if _state["running"]:
        return False, "Парсер уже запущен"
    if not groups:
        return False, "Укажи хотя бы одну группу"

    # Read credentials NOW in the endpoint context (guaranteed to have env loaded)
    api_id, api_hash = _read_env_direct()
    if not api_id or not api_hash:
        return False, "TG_API_ID / TG_API_HASH не заполнены в backend/.env"

    _state.update({
        "running": True,
        "groups": groups,
        "stats": {"seen": 0, "scanned": 0, "found": 0, "hot": 0, "errors": 0},
        "last_error": None,
        "joined": 0,
        "_api_id": api_id,
        "_api_hash": api_hash,
    })
    _state["task"] = asyncio.create_task(_run(groups))
    return True, "Парсер запущен"


async def stop() -> bool:
    _state["running"] = False
    if t := _state.get("task"):
        t.cancel()
        _state["task"] = None
    if c := _state.get("client"):
        try:
            await c.disconnect()
        except Exception:
            pass
        _state["client"] = None
    return True


async def send_dm(profile_url: str, text: str) -> tuple[bool, str]:
    """Send a DM to a lead via Telethon. Works whether parser is running or not."""
    if not TELETHON_OK:
        return False, "Telethon не установлен"
    if not text.strip():
        return False, "Текст сообщения пустой"

    api_id, api_hash = _read_env_direct()
    if not api_id or not api_hash:
        return False, "TG_API_ID / TG_API_HASH не заполнены"

    # Extract username or user_id from profile_url
    entity = None
    if "t.me/" in profile_url:
        username = profile_url.split("t.me/")[-1].strip("/")
        entity = username
    elif "user_id=" in profile_url:
        try:
            entity = int(profile_url.split("user_id=")[-1])
        except ValueError:
            return False, "Не удалось распознать профиль лида"
    else:
        return False, "Нет Telegram-ссылки на лида"

    # Reuse running client or connect temporarily
    client = _state.get("client")
    owns_client = False
    try:
        if client is None:
            client = TelegramClient(SESSION_PATH, int(api_id), api_hash)
            await client.connect()
            owns_client = True

        if not await client.is_user_authorized():
            return False, "Сессия Telethon не авторизована"

        await client.send_message(entity, text)
        await _log("dm_sent", str(entity), text[:100])
        return True, "Отправлено"
    except FloodWaitError as e:
        return False, f"Flood wait {e.seconds}с — попробуй позже"
    except Exception as e:
        return False, str(e)
    finally:
        if owns_client and client:
            try:
                await client.disconnect()
            except Exception:
                pass
