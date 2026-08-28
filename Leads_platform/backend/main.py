from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from supabase import create_client, Client
import httpx
import os
import base64
from dotenv import load_dotenv

from pathlib import Path as _Path
load_dotenv(_Path(__file__).parent / ".env")

# Restore Telethon session file from env var (Railway deployment)
# Value may be plain base64 or gzip-compressed base64 (starts with H4sI)
_session_b64 = os.getenv("TG_SESSION_B64", "")
if _session_b64:
    import gzip as _gzip
    _session_path = _Path(__file__).parent / "tg_session.session"
    if not _session_path.exists():
        _raw = base64.b64decode(_session_b64)
        _session_path.write_bytes(_gzip.decompress(_raw) if _raw[:2] == b'\x1f\x8b' else _raw)

def _write_ig_session(username: str, session_b64: str):
    """Decode (optionally gzipped) base64 session and write it to ig_sessions/."""
    import gzip as _gzip
    _dir = _Path(__file__).parent / "ig_sessions"
    _dir.mkdir(exist_ok=True)
    _raw = base64.b64decode(session_b64.strip())
    (_dir / f"{username}.json").write_bytes(
        _gzip.decompress(_raw) if _raw[:2] == b'\x1f\x8b' else _raw
    )


# Restore Instagram session file from env var (Railway deployment).
# Env var always wins over any leftover file — a stale file must never
# shadow a freshly rotated IG_SESSION_B64.
_ig_session_b64 = os.getenv("IG_SESSION_B64", "")
_ig_username_env = os.getenv("IG_USERNAME", "")
if _ig_session_b64 and _ig_username_env:
    try:
        _write_ig_session(_ig_username_env, _ig_session_b64)
    except Exception as _e:
        print(f"IG_SESSION_B64 restore failed: {_e}")

import telegram_parser
import telegram_bot_parser
import instagram_parser
import twogis_parser

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TG_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TG_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

db: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

from datetime import datetime, timezone
SERVER_STARTED = datetime.now(timezone.utc)

app = FastAPI(title="BaiTech Lead Hub API", version="1.0.0")


def _setting(key: str, default: str = "") -> str:
    try:
        res = db.table("settings").select("value").eq("key", key).execute()
        return res.data[0]["value"] if res.data else default
    except Exception:
        return default


def _set_setting(key: str, value: str):
    try:
        db.table("settings").upsert({"key": key, "value": value}).execute()
    except Exception:
        pass


def _ig_proxy() -> str:
    """KZ proxy for Instagram — sessions made at home die on datacenter IPs."""
    return _setting("ig_proxy") or os.getenv("IG_PROXY", "")


@app.on_event("startup")
async def _auto_start_parsers():
    """Auto-restart parsers on server startup using saved settings from DB.

    Each parser has a persisted running flag — a parser the owner stopped
    manually stays stopped after a redeploy.
    """
    import asyncio
    import logging
    _log = logging.getLogger("main")
    await asyncio.sleep(5)  # wait for DB connection to stabilise

    # Apply saved limits before anything starts
    try:
        tg_leads = int(_setting("tg_leads_per_day", "50"))
        telegram_parser.set_limits(leads_per_day=tg_leads)
        telegram_bot_parser.set_limits(leads_per_day=tg_leads)
        instagram_parser.set_limits(
            comments_per_day=int(_setting("ig_comments_per_day", "25")),
            dms_per_day=int(_setting("ig_dms_per_day", "10")),
            delay_min=int(_setting("ig_delay_min", "15")),
            delay_max=int(_setting("ig_delay_max", "35")),
        )
    except Exception as e:
        _log.warning(f"Applying saved limits failed: {e}")

    # Telegram (Telethon) auto-start
    try:
        if _setting("tg_parser_running", "true") == "true":
            groups = [g.strip() for g in _setting("tg_parser_groups").split(",") if g.strip()]
            if groups:
                ok, msg = await telegram_parser.start(groups)
                _log.info(f"Auto-start Telethon: {msg}")
    except Exception as e:
        _log.warning(f"Auto-start Telegram failed: {e}")

    # Telegram Bot API auto-start
    try:
        if _setting("tg_bot_parser_running", "false") == "true":
            ok, msg = await telegram_bot_parser.start()
            _log.info(f"Auto-start Bot API: {msg}")
    except Exception as e:
        _log.warning(f"Auto-start Bot API failed: {e}")

    # Instagram auto-start. Session sources, freshest first:
    # 1) ig_session_b64 in settings (applied via UI) → 2) IG_SESSION_B64 env (written at import)
    ig_username = _setting("ig_username") or os.getenv("IG_USERNAME", "")
    if ig_username and _setting("ig_parser_running", "true") == "true":
        saved_b64 = _setting("ig_session_b64")
        if saved_b64:
            try:
                _write_ig_session(ig_username, saved_b64)
            except Exception as e:
                _log.warning(f"ig_session_b64 restore from settings failed: {e}")
        ig_session_file = _Path(__file__).parent / "ig_sessions" / f"{ig_username}.json"
        if ig_session_file.exists():
            try:
                ok, msg = await instagram_parser.login_from_session(ig_username, proxy=_ig_proxy())
                _log.info(f"Auto-start Instagram: {msg}")
                if ok:
                    human_review = _setting("ig_human_review", "true") == "true"
                    await instagram_parser.start(human_review=human_review)
            except Exception as e:
                _log.warning(f"Auto-start Instagram failed: {e}")

    # Self-heal: every 6h try to revive a dead Instagram session without the owner
    asyncio.create_task(_ig_self_heal())


async def _ig_self_heal():
    import asyncio
    import logging
    _log = logging.getLogger("main")
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            if _setting("ig_parser_running", "true") != "true":
                continue
            if instagram_parser.status()["logged_in"]:
                continue
            username = _setting("ig_username") or os.getenv("IG_USERNAME", "")
            if not username:
                continue

            ok = False
            # 1) Retry the saved session — IG's temporary flags often clear in hours
            saved = _setting("ig_session_b64") or os.getenv("IG_SESSION_B64", "")
            if saved:
                try:
                    _write_ig_session(username, saved)
                    ok, msg = await instagram_parser.login_from_session(username, proxy=_ig_proxy())
                    _log.info(f"IG self-heal (session): {msg}")
                except Exception as e:
                    _log.warning(f"IG self-heal session error: {e}")

            # 2) Fall back to relogin with saved password (same device UUIDs)
            if not ok:
                pwd = _setting("ig_password")
                if pwd:
                    ok, msg = await instagram_parser.login(username, pwd, proxy=_ig_proxy())
                    _log.info(f"IG self-heal (relogin): {msg}")
                    if ok:
                        try:
                            import gzip as _gzip
                            sf = _Path(__file__).parent / "ig_sessions" / f"{username}.json"
                            if sf.exists():
                                _set_setting("ig_session_b64", base64.b64encode(_gzip.compress(sf.read_bytes(), 9)).decode())
                        except Exception:
                            pass

            if ok:
                await instagram_parser.start(human_review=_setting("ig_human_review", "true") == "true")
                await tg_send("✅ *Instagram восстановлен*\n\nСессия ожила, парсер снова работает автоматически.")
        except Exception as e:
            _log.warning(f"IG self-heal failed: {e}")

_allowed_origins = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
]
_frontend_url = os.getenv("FRONTEND_URL", "")
if _frontend_url:
    _allowed_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Telegram ────────────────────────────────────────────────────────────────

async def tg_send(text: str, chat_id: str = None):
    cid = chat_id or TG_CHAT_ID
    if not TG_TOKEN or not cid:
        return False
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": cid, "text": text, "parse_mode": "Markdown"},
                timeout=10,
            )
            data = res.json()
            if not data.get("ok") and "parse" in str(data.get("description", "")).lower():
                # Lead names can break Markdown — retry as plain text
                res = await client.post(
                    f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                    json={"chat_id": cid, "text": text},
                    timeout=10,
                )
                data = res.json()
        return data.get("ok", False)
    except Exception:
        return False


@app.post("/telegram/test")
async def telegram_test(chat_id: Optional[str] = None):
    ok = await tg_send(
        "✅ *BaiTech Lead Hub* подключён!\n\nБэкенд работает. Уведомления активны.\n\n📍 Атырау · baitech.kz",
        chat_id,
    )
    if not ok:
        raise HTTPException(500, "Не удалось отправить сообщение")
    return {"ok": True}


@app.post("/telegram/notify")
async def telegram_notify(message: str, chat_id: Optional[str] = None):
    ok = await tg_send(message, chat_id)
    return {"ok": ok}


# ── Leads ────────────────────────────────────────────────────────────────────

class LeadCreate(BaseModel):
    channel: Optional[str] = None
    name: Optional[str] = None
    profile_url: Optional[str] = None
    phone: Optional[str] = None
    business_type: Optional[str] = None
    language: Optional[str] = None
    status: Optional[str] = "found"
    source: Optional[str] = "inbound"
    last_message: Optional[str] = None
    notes: Optional[str] = None
    is_hot: Optional[bool] = False
    notify: Optional[bool] = True  # bulk sources (2GIS) set False to avoid a Telegram 429 storm


class LeadUpdate(BaseModel):
    channel: Optional[str] = None
    name: Optional[str] = None
    profile_url: Optional[str] = None
    phone: Optional[str] = None
    business_type: Optional[str] = None
    language: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    last_message: Optional[str] = None
    notes: Optional[str] = None
    is_hot: Optional[bool] = None


@app.get("/leads")
async def get_leads(
    status: Optional[str] = None,
    channel: Optional[str] = None,
    is_hot: Optional[bool] = None,
    limit: int = Query(50, le=1000),
    offset: int = 0,
):
    try:
        q = db.table("leads").select("*").order("created_at", desc=True).range(offset, offset + limit - 1)
        if status:
            q = q.eq("status", status)
        if channel:
            q = q.eq("channel", channel)
        if is_hot is not None:
            q = q.eq("is_hot", is_hot)
        res = q.execute()
        return {"leads": res.data, "count": len(res.data)}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/leads/exists")
async def lead_exists(profile_url: str = Query(...)):
    """Pinpoint duplicate check. Parsers used to pull /leads?limit=500 for every
    candidate — wasteful and broken once the base grows past 500 rows."""
    try:
        res = db.table("leads").select("id", count="exact").eq("profile_url", profile_url).limit(1).execute()
        return {"exists": (res.count or 0) > 0}
    except Exception:
        return {"exists": False}


@app.get("/leads/{lead_id}")
async def get_lead(lead_id: int):
    try:
        res = db.table("leads").select("*").eq("id", lead_id).single().execute()
        return res.data
    except Exception as e:
        raise HTTPException(404, "Лид не найден")


@app.post("/leads", status_code=201)
async def create_lead(lead: LeadCreate):
    try:
        payload = lead.model_dump(exclude_none=True)
        notify = payload.pop("notify", True)  # not a DB column
        res = db.table("leads").insert(payload).execute()
        created = res.data[0]
        if not notify:
            return created
        hot = created.get("is_hot")
        profile = created.get("profile_url", "")
        channel = created.get("channel", "—")
        link_line = f"\n🔗 [Написать]({profile})" if profile else ""
        msg_preview = (created.get("last_message") or "")[:200]
        label = "🔥 *Горячий лид!*" if hot else "📥 *Новый лид*"
        notes = created.get("notes") or ""
        opener_match = next((l for l in notes.split("\n") if l.startswith("opener:")), None)
        opener_line = f"\n\n✍️ *Открывашка:*\n_{opener_match[7:].strip()}_" if opener_match else ""
        await tg_send(
            f"{label}\n\n"
            f"👤 {created.get('name', 'Неизвестно')}\n"
            f"🏢 {created.get('business_type', '—')}\n"
            f"📡 {channel} · {created.get('language', 'ru').upper()}"
            f"{link_line}\n\n"
            f"💬 _{msg_preview}_"
            f"{opener_line}"
        )
        return created
    except Exception as e:
        raise HTTPException(500, str(e))


@app.patch("/leads/{lead_id}")
async def update_lead(lead_id: int, lead: LeadUpdate):
    try:
        data = lead.model_dump(exclude_none=True)
        res = db.table("leads").update(data).eq("id", lead_id).execute()
        updated = res.data[0]
        if data.get("status") == "interested":
            await tg_send(
                f"⚡ *Лид заинтересован!*\n\n"
                f"👤 {updated.get('name', 'Неизвестно')}\n"
                f"📱 {updated.get('phone', '—')}\n"
                f"🏢 {updated.get('business_type', '—')}"
            )
        return updated
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/leads/{lead_id}")
async def delete_lead(lead_id: int):
    try:
        db.table("leads").delete().eq("id", lead_id).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Messages ──────────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    direction: str  # in / out
    text: str
    approved_by_human: Optional[bool] = False


@app.get("/leads/{lead_id}/messages")
async def get_messages(lead_id: int):
    try:
        res = db.table("messages").select("*").eq("lead_id", lead_id).order("created_at").execute()
        return {"messages": res.data}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/leads/{lead_id}/messages", status_code=201)
async def add_message(lead_id: int, msg: MessageCreate):
    try:
        data = msg.model_dump()
        data["lead_id"] = lead_id
        res = db.table("messages").insert(data).execute()
        db.table("leads").update({"last_message": msg.text}).eq("id", lead_id).execute()
        return res.data[0]
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Send DM ───────────────────────────────────────────────────────────────────

class SendDmBody(BaseModel):
    text: Optional[str] = None  # if None, use opener from notes


@app.post("/leads/{lead_id}/send-dm")
async def send_dm_to_lead(lead_id: int, body: SendDmBody = SendDmBody()):
    try:
        res = db.table("leads").select("*").eq("id", lead_id).single().execute()
        lead = res.data
    except Exception:
        raise HTTPException(404, "Лид не найден")

    profile_url = lead.get("profile_url", "")
    channel = lead.get("channel", "")

    if channel != "telegram" or not profile_url:
        raise HTTPException(400, "Отправка DM доступна только для Telegram-лидов с профилем")

    # Use provided text or extract opener from notes
    text = body.text
    if not text:
        notes = lead.get("notes") or ""
        opener_line = next((l for l in notes.split("\n") if l.startswith("opener:")), None)
        text = opener_line[7:].strip() if opener_line else None

    if not text:
        raise HTTPException(400, "Нет текста сообщения. Укажи opener в заметках или передай text в теле запроса")

    ok, msg = await telegram_parser.send_dm(profile_url, text)
    if not ok:
        raise HTTPException(500, msg)

    # Save outgoing message + update lead status
    db.table("messages").insert({
        "lead_id": lead_id, "direction": "out",
        "text": text, "approved_by_human": True,
    }).execute()
    db.table("leads").update({"status": "messaged", "last_message": text}).eq("id", lead_id).execute()

    return {"ok": True, "sent": text}


# ── Agent Logs ────────────────────────────────────────────────────────────────

class LogCreate(BaseModel):
    channel: str
    action: str
    target: Optional[str] = None
    result: Optional[str] = None


@app.get("/agent-logs")
async def get_logs(channel: Optional[str] = None, limit: int = 100):
    try:
        q = db.table("agent_logs").select("*").order("created_at", desc=True).limit(limit)
        if channel:
            q = q.eq("channel", channel)
        res = q.execute()
        return {"logs": res.data}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/agent-logs", status_code=201)
async def create_log(log: LogCreate):
    try:
        res = db.table("agent_logs").insert(log.model_dump()).execute()
        return res.data[0]
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Settings ──────────────────────────────────────────────────────────────────

# Never returned by GET /settings — the API has no auth yet, so anything secret
# here would leak to anyone who knows the URL. This already burned us once:
# openai_key and tg_bot_token were being served in plaintext (token drain risk).
# Redact by explicit key OR by any secret-ish substring, so a new secret setting
# can never accidentally leak just because someone forgot to add it to the list.
_SECRET_SETTING_KEYS = {"ig_password", "ig_session_b64", "openai_key", "tg_bot_token"}
_SECRET_SUBSTRINGS = ("password", "token", "secret", "session", "api_key", "apikey", "_key")


def _is_secret_setting(key: str) -> bool:
    k = key.lower()
    return k in _SECRET_SETTING_KEYS or any(s in k for s in _SECRET_SUBSTRINGS)


@app.get("/settings")
async def get_settings():
    try:
        res = db.table("settings").select("*").execute()
        return {row["key"]: row["value"] for row in res.data if not _is_secret_setting(row["key"])}
    except Exception as e:
        raise HTTPException(500, str(e))


class SettingBody(BaseModel):
    value: str


@app.put("/settings/{key}")
async def upsert_setting(key: str, body: SettingBody):
    try:
        db.table("settings").upsert({"key": key, "value": body.value}).execute()
        return {"key": key, "value": body.value}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Stats ──────────────────────────────────────────────────────────────────────

def _count(**filters) -> int:
    """Exact row count without pulling rows. The old /stats loaded every lead
    on each Dashboard poll and silently undercounted past Supabase's 1000-row cap."""
    q = db.table("leads").select("id", count="exact").limit(1)
    for k, v in filters.items():
        q = q.eq(k, v)
    return q.execute().count or 0


@app.get("/stats")
async def get_stats():
    try:
        total = _count()
        new = _count(status="found")
        hot = _count(is_hot=True)
        converted = _count(status="converted")
        replied = (
            _count(status="replied") + _count(status="interested") + _count(status="converted")
        )
        conversion = round(converted / total * 100, 1) if total else 0
        return {
            "total": total,
            "new": new,
            "replied": replied,
            "hot": hot,
            "conversion": conversion,
        }
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Telegram Parser ───────────────────────────────────────────────────────────

class ParserStartBody(BaseModel):
    groups: List[str]


@app.get("/parser/telegram/status")
async def parser_status():
    return telegram_parser.status()


@app.post("/parser/telegram/start")
async def parser_start(body: ParserStartBody):
    # Persist groups + running flag so the parser survives redeploys
    _set_setting("tg_parser_groups", ",".join(body.groups))
    ok, msg = await telegram_parser.start(body.groups)
    if not ok:
        raise HTTPException(400, msg)
    _set_setting("tg_parser_running", "true")
    return {"ok": True, "message": msg}


@app.post("/parser/telegram/stop")
async def parser_stop():
    await telegram_parser.stop()
    _set_setting("tg_parser_running", "false")
    return {"ok": True}


class TgLimitsBody(BaseModel):
    leads_per_day: int


@app.post("/parser/telegram/limits")
async def parser_set_limits(body: TgLimitsBody):
    leads = max(1, min(body.leads_per_day, 500))
    _set_setting("tg_leads_per_day", str(leads))
    telegram_parser.set_limits(leads_per_day=leads)
    telegram_bot_parser.set_limits(leads_per_day=leads)
    return {"ok": True, "leads_per_day": leads}


@app.get("/parser/telegram/groups")
async def parser_get_groups():
    try:
        res = db.table("settings").select("value").eq("key", "tg_parser_groups").execute()
        raw = res.data[0]["value"] if res.data else ""
        groups = [g.strip() for g in raw.split(",") if g.strip()]
    except Exception:
        groups = []
    return {"groups": groups}


# ── Telegram Bot API Parser ───────────────────────────────────────────────────

@app.get("/parser/telegram-bot/status")
async def bot_parser_status():
    return telegram_bot_parser.status()


@app.post("/parser/telegram-bot/start")
async def bot_parser_start():
    ok, msg = await telegram_bot_parser.start()
    if not ok:
        raise HTTPException(400, msg)
    _set_setting("tg_bot_parser_running", "true")
    return {"ok": True, "message": msg}


@app.post("/parser/telegram-bot/stop")
async def bot_parser_stop():
    await telegram_bot_parser.stop()
    _set_setting("tg_bot_parser_running", "false")
    return {"ok": True}


# ── Instagram Parser ──────────────────────────────────────────────────────────

class IgLoginBody(BaseModel):
    username: str
    password: str
    remember: Optional[bool] = False  # store password for automatic session recovery


class IgStartBody(BaseModel):
    human_review: Optional[bool] = True


class IgApproveCommentBody(BaseModel):
    post_shortcode: str
    comment_text: str
    action_id: Optional[int] = None


class IgApproveDmBody(BaseModel):
    action_id: int
    author_id: str
    author_username: str
    dm_text: str
    business_type: Optional[str] = "другое"
    language: Optional[str] = "ru"


class IgActionCreate(BaseModel):
    post_shortcode: Optional[str] = None
    post_url: Optional[str] = None
    post_author_username: Optional[str] = None
    post_author_id: Optional[str] = None
    post_author_full_name: Optional[str] = None
    post_caption: Optional[str] = None
    post_likes: Optional[int] = 0
    comment_id: Optional[str] = None
    comment_text: Optional[str] = None
    comment_posted_at: Optional[str] = None
    author_replied: Optional[bool] = False
    reply_text: Optional[str] = None
    dm_sent: Optional[bool] = False
    dm_text: Optional[str] = None
    language: Optional[str] = "ru"
    business_type: Optional[str] = "другое"
    status: Optional[str] = "pending_review"
    lead_id: Optional[int] = None


class IgActionUpdate(BaseModel):
    comment_id: Optional[str] = None
    comment_text: Optional[str] = None
    comment_posted_at: Optional[str] = None
    author_replied: Optional[bool] = None
    reply_text: Optional[str] = None
    dm_sent: Optional[bool] = None
    dm_text: Optional[str] = None
    status: Optional[str] = None
    lead_id: Optional[int] = None


class IgSessionBody(BaseModel):
    username: str
    session_b64: str


@app.post("/instagram/session")
async def ig_apply_session(body: IgSessionBody):
    """Apply a session produced by instagram_auth.py — no redeploy needed.

    Paste the IG_SESSION_B64 string straight into the UI; the file is written
    and the session validated immediately.
    """
    username = body.username.strip().lstrip("@")
    if not username or not body.session_b64.strip():
        raise HTTPException(400, "Укажи логин и строку сессии")
    try:
        _write_ig_session(username, body.session_b64)
    except Exception as e:
        raise HTTPException(400, f"Не удалось распаковать строку сессии: {e}")

    ok, msg = await instagram_parser.login_from_session(username, proxy=_ig_proxy())
    if not ok:
        raise HTTPException(400, msg)
    # Persist in DB — survives redeploys even without IG_SESSION_B64 env var
    _set_setting("ig_username", username)
    _set_setting("ig_session_b64", body.session_b64.strip())
    return {"ok": True, "message": msg}


@app.post("/instagram/login")
async def ig_login(body: IgLoginBody):
    ok, msg = await instagram_parser.login(body.username, body.password, proxy=_ig_proxy())
    if not ok:
        raise HTTPException(400, msg)
    # Save username + dumped session to settings so the login survives redeploys
    _set_setting("ig_username", body.username)
    if body.remember:
        _set_setting("ig_password", body.password)  # opt-in: enables 6h self-heal relogin
    try:
        import gzip as _gzip
        sf = _Path(__file__).parent / "ig_sessions" / f"{body.username}.json"
        if sf.exists():
            _set_setting("ig_session_b64", base64.b64encode(_gzip.compress(sf.read_bytes(), 9)).decode())
    except Exception:
        pass
    return {"ok": True, "message": msg}


def _action_to_pending_comment(a: dict) -> dict:
    return {
        "id": a["id"],
        "post_shortcode": a.get("post_shortcode"),
        "post_url": a.get("post_url"),
        "author": a.get("post_author_username"),
        "caption": (a.get("post_caption") or "")[:300],
        "comment_text": a.get("comment_text"),
        "language": a.get("language", "ru"),
        "business_type": a.get("business_type", "другое"),
    }


def _action_to_pending_dm(a: dict) -> dict:
    return {
        "id": f"dm_{a['id']}",
        "action_id": a["id"],
        "author": a.get("post_author_username"),
        "author_id": a.get("post_author_id"),
        "reply_text": a.get("reply_text"),
        "dm_text": a.get("dm_text"),
        "language": a.get("language", "ru"),
        "business_type": a.get("business_type", "другое"),
    }


@app.get("/instagram/status")
async def ig_status():
    st = instagram_parser.status()
    # Pending queues live in the DB so they survive restarts
    try:
        res = db.table("instagram_actions").select("*").eq("status", "pending_review").order("created_at", desc=True).limit(100).execute()
        st["pending_comments"] = [_action_to_pending_comment(a) for a in res.data]
        cnt = db.table("instagram_actions").select("id", count="exact").eq("status", "pending_review").execute()
        st["pending_comments_total"] = cnt.count or len(res.data)
    except Exception:
        pass  # fall back to in-memory queue from status()
    try:
        res = db.table("instagram_actions").select("*").eq("status", "reply_received").order("created_at", desc=True).limit(50).execute()
        st["pending_dms"] = [_action_to_pending_dm(a) for a in res.data]
    except Exception:
        pass
    return st


@app.post("/instagram/start")
async def ig_start(body: IgStartBody):
    ok, msg = await instagram_parser.start(human_review=body.human_review)
    if not ok:
        raise HTTPException(400, msg)
    _set_setting("ig_parser_running", "true")
    _set_setting("ig_human_review", "true" if body.human_review else "false")
    return {"ok": True, "message": msg}


@app.post("/instagram/stop")
async def ig_stop():
    await instagram_parser.stop()
    _set_setting("ig_parser_running", "false")
    return {"ok": True}


class IgLimitsBody(BaseModel):
    comments_per_day: Optional[int] = None
    dms_per_day: Optional[int] = None
    delay_min: Optional[int] = None
    delay_max: Optional[int] = None


@app.post("/instagram/limits")
async def ig_set_limits(body: IgLimitsBody):
    limits = instagram_parser.set_limits(
        comments_per_day=body.comments_per_day,
        dms_per_day=body.dms_per_day,
        delay_min=body.delay_min,
        delay_max=body.delay_max,
    )
    for k, v in limits.items():
        _set_setting(f"ig_{k}", str(v))
    return {"ok": True, "limits": limits}


@app.post("/instagram/actions/reject-all")
async def ig_reject_all_pending():
    """Bulk-reject every comment waiting for review (memory + DB)."""
    try:
        res = db.table("instagram_actions").update({"status": "skipped"}).eq("status", "pending_review").execute()
        rejected = len(res.data or [])
    except Exception as e:
        raise HTTPException(500, str(e))
    instagram_parser.clear_pending_comments()
    return {"ok": True, "rejected": rejected}


# Instagram actions (DB)

@app.post("/instagram/actions", status_code=201)
async def ig_create_action(action: IgActionCreate):
    try:
        data = action.model_dump(exclude_none=True)
        res = db.table("instagram_actions").insert(data).execute()
        return res.data[0]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/instagram/actions")
async def ig_get_actions(status: Optional[str] = None, limit: int = 50):
    try:
        q = db.table("instagram_actions").select("*").order("created_at", desc=True).limit(limit)
        if status:
            q = q.eq("status", status)
        res = q.execute()
        return {"actions": res.data, "count": len(res.data)}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/instagram/actions/check/{shortcode}")
async def ig_check_action(shortcode: str):
    try:
        res = db.table("instagram_actions").select("id").eq("post_shortcode", shortcode).execute()
        return {"exists": len(res.data) > 0}
    except Exception:
        return {"exists": False}


@app.patch("/instagram/actions/{action_id}")
async def ig_update_action(action_id: int, action: IgActionUpdate):
    try:
        data = action.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(400, "No fields to update")
        res = db.table("instagram_actions").update(data).eq("id", action_id).execute()
        return res.data[0]
    except Exception as e:
        raise HTTPException(500, str(e))


# Review Gate endpoints

@app.post("/instagram/approve-comment/{action_id}")
async def ig_approve_comment(action_id: int, body: IgApproveCommentBody):
    ok, msg = await instagram_parser.approve_comment(
        pending_id=action_id,
        post_shortcode=body.post_shortcode,
        comment_text=body.comment_text,
        action_id=action_id,
    )
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}


@app.post("/instagram/reject-comment/{action_id}")
async def ig_reject_comment(action_id: int):
    await instagram_parser.reject_comment(action_id)
    return {"ok": True}


@app.post("/instagram/approve-dm/{action_id}")
async def ig_approve_dm(action_id: int, body: IgApproveDmBody):
    ok, msg = await instagram_parser.approve_dm(
        action_id=action_id,
        author_id=body.author_id,
        author_username=body.author_username,
        dm_text=body.dm_text,
        business_type=body.business_type,
        language=body.language,
    )
    if not ok:
        raise HTTPException(400, msg)
    # Notify owner
    await tg_send(
        f"✅ *DM отправлен!*\n\n"
        f"👤 @{body.author_username}\n"
        f"🏢 {body.business_type}\n\n"
        f"💬 _{body.dm_text[:200]}_"
    )
    return {"ok": True, "message": msg}


@app.post("/instagram/reject-dm/{action_id}")
async def ig_reject_dm(action_id: int):
    await instagram_parser.reject_dm(action_id)
    return {"ok": True}


# ── 2GIS Parser ───────────────────────────────────────────────────────────────

class TwogisStartBody(BaseModel):
    city_ids: Optional[List[str]] = None
    business_types: Optional[List[str]] = None
    min_reviews: int = 3
    max_rating: float = 2.5
    min_pain_score: int = 40


@app.get("/parser/twogis/status")
async def twogis_status():
    return twogis_parser.status()


@app.post("/parser/twogis/start")
async def twogis_start(body: TwogisStartBody):
    ok, msg = await twogis_parser.start(
        city_ids=body.city_ids,
        business_types=body.business_types,
        min_reviews=body.min_reviews,
        max_rating=body.max_rating,
        min_pain_score=body.min_pain_score,
    )
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}


@app.post("/parser/twogis/stop")
async def twogis_stop():
    await twogis_parser.stop()
    return {"ok": True}


@app.get("/parser/twogis/test/{org_id}")
async def twogis_test_org(org_id: str):
    """Test: analyze a single 2GIS org by ID."""
    result = await twogis_parser.scan_one(org_id)
    if not result:
        raise HTTPException(404, "Не удалось получить данные")
    return result


# ── Agents: start / stop everything with one button ──────────────────────────

@app.get("/agents/status")
async def agents_status():
    tg = telegram_parser.status()
    bot = telegram_bot_parser.status()
    ig = instagram_parser.status()
    return {
        "any_running": tg["running"] or bot["running"] or ig["running"],
        "telegram": tg["running"],
        "telegram_bot": bot["running"],
        "instagram": ig["running"],
        "server_started_at": SERVER_STARTED.isoformat(),
        "uptime_seconds": int((datetime.now(timezone.utc) - SERVER_STARTED).total_seconds()),
    }


@app.post("/agents/start-all")
async def agents_start_all():
    results = {}

    groups = [g.strip() for g in _setting("tg_parser_groups").split(",") if g.strip()]
    if groups:
        ok, msg = await telegram_parser.start(groups)
        if ok or telegram_parser.status()["running"]:
            _set_setting("tg_parser_running", "true")
        results["telegram"] = msg
    else:
        results["telegram"] = "Нет сохранённых групп — запусти Telethon один раз вручную"

    ok, msg = await telegram_bot_parser.start()
    if ok or telegram_bot_parser.status()["running"]:
        _set_setting("tg_bot_parser_running", "true")
    results["telegram_bot"] = msg

    if instagram_parser.status()["logged_in"]:
        human_review = _setting("ig_human_review", "true") == "true"
        ok, msg = await instagram_parser.start(human_review=human_review)
        if ok or instagram_parser.status()["running"]:
            _set_setting("ig_parser_running", "true")
        results["instagram"] = msg
    else:
        results["instagram"] = "Instagram не авторизован"

    return {"ok": True, "results": results}


@app.post("/agents/stop-all")
async def agents_stop_all():
    await telegram_parser.stop()
    await telegram_bot_parser.stop()
    await instagram_parser.stop()
    _set_setting("tg_parser_running", "false")
    _set_setting("tg_bot_parser_running", "false")
    _set_setting("ig_parser_running", "false")
    return {"ok": True}


# ── Serve React frontend (production) ─────────────────────────────────────────

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

_dist = _Path(__file__).parent.parent / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=str(_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(str(_dist / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
