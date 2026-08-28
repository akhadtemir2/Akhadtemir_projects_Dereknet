"""
Instagram outbound parser using Instagrapi.

Flow:
  1. Login once (session saved to file)
  2. Background scan: search hashtags → filter business posts → AI comment
  3. Human Review Gate: comments queued for owner approval → then posted
  4. Reply monitor: every 30 min check if authors replied → AI DM offer → queued → sent

Requirements: pip install instagrapi
"""
import asyncio
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import httpx

try:
    from instagram_ai import analyze_post, generate_comment, generate_dm_offer
except ImportError:
    async def analyze_post(*a, **kw): return {"language": "ru", "business_type": "другое", "is_target": True}
    async def generate_comment(*a, **kw): return "Отличная работа! Как давно занимаетесь этим? 🙌"
    async def generate_dm_offer(*a, **kw): return "Привет! Я из BaiTech. Есть идея для вашего бизнеса."

logger = logging.getLogger("ig_parser")

BACKEND = f"http://127.0.0.1:{os.getenv('PORT', '8000')}"
SESSIONS_DIR = Path(__file__).parent / "ig_sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# Kazakhstan SMB hashtags — ordered by relevance
HASHTAGS_KZ = [
    "атырауbusiness", "бизнесатырау", "кафеатырау",
    "салонатырау", "автосервисатырау", "магазинатырау",
    "стоматологатырау", "клиникаатырау",
    "атырау", "atyrau",
    "бизнесказахстан", "кәсіпкер", "шағынбизнес",
    "предпринимательказахстан", "малыйбизнескз",
    "алматыbusiness", "астанаbusiness",
]

_state: dict = {
    "running": False,
    "logged_in": False,
    "username": None,
    "scan_task": None,
    "monitor_task": None,
    "cl": None,
    "human_review": True,
    "stats": {"scanned": 0, "commented": 0, "replies": 0, "dms_sent": 0, "errors": 0},
    "pending_comments": [],  # [{id, post_shortcode, post_url, author, caption, comment_text, language, business_type}]
    "pending_dms": [],       # [{id, author, author_id, reply_text, dm_text, language, business_type, action_id}]
    "last_error": None,
    "limits": {"comments_per_day": 25, "dms_per_day": 10, "delay_min": 15, "delay_max": 35},
    "day_counts": {"date": "", "comments": 0, "dms": 0},
}

# Stop generating new comments while this many are still waiting for review
PENDING_QUEUE_CAP = 30

SESSION_EXPIRED_MSG = "Сессия Instagram истекла (login_required). Войди заново через форму или обнови IG_SESSION_B64 (python instagram_auth.py)"


def set_limits(comments_per_day=None, dms_per_day=None, delay_min=None, delay_max=None) -> dict:
    lim = _state["limits"]
    if comments_per_day:
        lim["comments_per_day"] = max(1, min(int(comments_per_day), 200))
    if dms_per_day:
        lim["dms_per_day"] = max(1, min(int(dms_per_day), 100))
    if delay_min:
        lim["delay_min"] = max(5, min(int(delay_min), 600))
    if delay_max:
        lim["delay_max"] = max(lim["delay_min"], min(int(delay_max), 900))
    return lim.copy()


def _day_counts() -> dict:
    from datetime import date
    today = date.today().isoformat()
    if _state["day_counts"]["date"] != today:
        _state["day_counts"] = {"date": today, "comments": 0, "dms": 0}
    return _state["day_counts"]


def _action_delay() -> float:
    return random.uniform(_state["limits"]["delay_min"], _state["limits"]["delay_max"])


def _is_login_error(e: Exception) -> bool:
    name = type(e).__name__.lower()
    text = str(e).lower()
    return "loginrequired" in name or "login_required" in text or "challenge" in name


def _handle_login_expired():
    """Session died — flag it clearly and stop hammering Instagram."""
    _state["logged_in"] = False
    _state["last_error"] = SESSION_EXPIRED_MSG
    logger.error("Instagram session expired (login_required)")


def clear_pending_comments():
    _state["pending_comments"] = []


# ── Instagrapi helpers ────────────────────────────────────────────────────────

def _get_ig_client():
    try:
        from instagrapi import Client
        return Client
    except ImportError:
        return None


def _session_file(username: str) -> Path:
    return SESSIONS_DIR / f"{username}.json"


def _apply_kz_fingerprint(cl):
    """Make the client look like a Kazakhstan device regardless of server IP.

    Instagram tolerates an IP change far better when locale/country/timezone
    stay consistent with where the session was born (instagrapi best practices).
    """
    try:
        cl.set_locale("ru_RU")
        cl.set_country("KZ")
        cl.set_country_code(7)
        cl.set_timezone_offset(5 * 3600)  # Kazakhstan = UTC+5
    except Exception:
        pass


# ── Backend API helpers ───────────────────────────────────────────────────────

async def _api(method: str, path: str, **kwargs):
    try:
        async with httpx.AsyncClient() as c:
            r = await getattr(c, method)(f"{BACKEND}{path}", timeout=10, **kwargs)
            return r.json() if r.status_code < 400 else None
    except Exception:
        return None


async def _save_action(data: dict):
    return await _api("post", "/instagram/actions", json=data)


async def _update_action(action_id: int, data: dict):
    return await _api("patch", f"/instagram/actions/{action_id}", json=data)


async def _save_lead(payload: dict):
    return await _api("post", "/leads", json=payload)


async def _log(action: str, target: str = "", result: str = ""):
    await _api("post", "/agent-logs", json={
        "channel": "instagram", "action": action,
        "target": target, "result": result,
    })


async def _already_processed(shortcode: str) -> bool:
    data = await _api("get", f"/instagram/actions/check/{shortcode}")
    return bool(data and data.get("exists"))


# ── Scan loop ─────────────────────────────────────────────────────────────────

async def _scan_hashtags():
    """Main scan loop: search posts → analyze → generate comments → queue."""
    cl = _state["cl"]
    if cl is None:
        return

    # Small random subset per cycle — steady trickle looks human,
    # a 17-hashtag sweep looks like a scraper and burns the session
    hashtags = random.sample(HASHTAGS_KZ, min(5, len(HASHTAGS_KZ)))

    for tag in hashtags:
        if not _state["running"]:
            break
        try:
            # Don't flood the review queue — wait until owner processes it
            if _state["human_review"]:
                pending = await _api("get", "/instagram/actions?status=pending_review&limit=50")
                if pending and len(pending.get("actions", [])) >= PENDING_QUEUE_CAP:
                    logger.info(f"Review queue full ({PENDING_QUEUE_CAP}+) — pausing scan for 10 min")
                    await asyncio.sleep(600)
                    continue

            await asyncio.sleep(random.uniform(8, 18))

            medias = await asyncio.to_thread(cl.hashtag_medias_recent, tag, amount=8)
            logger.info(f"#{tag}: {len(medias)} posts")

            for media in medias:
                if not _state["running"]:
                    break

                shortcode = media.code
                if await _already_processed(shortcode):
                    continue

                caption = media.caption_text or ""
                if len(caption) < 30:
                    continue

                _state["stats"]["scanned"] += 1

                # Analyze post
                analysis = await analyze_post(caption)
                if not analysis.get("is_target", True):
                    await _save_action({
                        "post_shortcode": shortcode,
                        "post_url": f"https://www.instagram.com/p/{shortcode}/",
                        "post_author_username": str(media.user.username),
                        "post_author_id": str(media.user.pk),
                        "post_caption": caption[:1000],
                        "language": analysis.get("language", "ru"),
                        "business_type": analysis.get("business_type", "другое"),
                        "status": "skipped",
                    })
                    continue

                language = analysis.get("language", "ru")
                business_type = analysis.get("business_type", "другое")
                author = str(media.user.username)
                author_id = str(media.user.pk)

                # Generate comment
                comment_text = await generate_comment(caption, business_type, language, author)

                action_data = {
                    "post_shortcode": shortcode,
                    "post_url": f"https://www.instagram.com/p/{shortcode}/",
                    "post_author_username": author,
                    "post_author_id": author_id,
                    "post_author_full_name": str(media.user.full_name or ""),
                    "post_caption": caption[:1000],
                    "post_likes": media.like_count or 0,
                    "comment_text": comment_text,
                    "language": language,
                    "business_type": business_type,
                    "status": "pending_review" if _state["human_review"] else "ready_to_post",
                }
                saved = await _save_action(action_data)

                if _state["human_review"]:
                    # Queue for human approval
                    _state["pending_comments"].append({
                        "id": saved["id"] if saved else None,
                        "post_shortcode": shortcode,
                        "post_url": action_data["post_url"],
                        "author": author,
                        "caption": caption[:300],
                        "comment_text": comment_text,
                        "language": language,
                        "business_type": business_type,
                    })
                    logger.info(f"Queued comment for review: @{author} | {business_type}")
                else:
                    # Auto-post
                    await _post_comment_direct(shortcode, comment_text, saved["id"] if saved else None)

                await asyncio.sleep(_action_delay())

        except asyncio.CancelledError:
            break
        except Exception as e:
            _state["stats"]["errors"] += 1
            if _is_login_error(e):
                _handle_login_expired()
                _state["running"] = False
                break
            _state["last_error"] = str(e)
            logger.error(f"Scan error #{tag}: {e}")
            await asyncio.sleep(30)

    logger.info("Hashtag scan cycle complete")


async def _post_comment_direct(shortcode: str, comment_text: str, action_id=None) -> tuple[bool, str]:
    """Actually post the comment to Instagram. Returns (ok, reason)."""
    cl = _state["cl"]
    if cl is None or not _state["logged_in"]:
        return False, SESSION_EXPIRED_MSG

    counts = _day_counts()
    if counts["comments"] >= _state["limits"]["comments_per_day"]:
        return False, f"Лимит комментариев на сегодня исчерпан ({_state['limits']['comments_per_day']}/день)"

    try:
        media_id = await asyncio.to_thread(cl.media_id, shortcode)
        comment = await asyncio.to_thread(cl.media_comment, media_id, comment_text)
        comment_id = str(comment.pk)

        if action_id:
            await _update_action(action_id, {
                "status": "monitoring",
                "comment_id": comment_id,
                "comment_posted_at": datetime.now(timezone.utc).isoformat(),
            })

        counts["comments"] += 1
        _state["stats"]["commented"] += 1
        await _log("comment_posted", shortcode, comment_text[:100])
        logger.info(f"Comment posted on {shortcode}: {comment_text[:60]}...")
        return True, "OK"
    except Exception as e:
        _state["stats"]["errors"] += 1
        logger.error(f"Post comment error {shortcode}: {e}")
        if _is_login_error(e):
            _handle_login_expired()
            return False, SESSION_EXPIRED_MSG
        if action_id:
            await _update_action(action_id, {"status": "skipped"})
        return False, str(e)


# ── Reply monitor loop ────────────────────────────────────────────────────────

async def _monitor_replies():
    """
    Every 30 min: check all 'monitoring' actions for author replies.
    If author replied → generate DM offer → queue for approval.
    """
    while _state["running"]:
        try:
            await asyncio.sleep(30 * 60)  # wait 30 min between checks
            if not _state["running"]:
                break

            logger.info("Checking replies on commented posts...")
            data = await _api("get", "/instagram/actions?status=monitoring&limit=100")
            if not data:
                continue

            for action in data.get("actions", []):
                if not _state["running"]:
                    break
                await _check_reply(action)
                await asyncio.sleep(random.uniform(5, 12))

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Monitor error: {e}")
            await asyncio.sleep(60)


async def _check_reply(action: dict):
    """Check if post author replied to our comment."""
    cl = _state["cl"]
    if cl is None:
        return

    shortcode = action.get("post_shortcode")
    our_comment_id = action.get("comment_id")
    author_username = action.get("post_author_username")
    if not shortcode or not our_comment_id:
        return

    try:
        media_id = await asyncio.to_thread(cl.media_id, shortcode)
        comments = await asyncio.to_thread(cl.media_comments, media_id, amount=50)

        for c in comments:
            # Check if it's a reply to our comment from the post author
            if (str(c.user.username) == author_username and
                    hasattr(c, "replied_to_comment_id") and
                    str(c.replied_to_comment_id) == str(our_comment_id)):

                reply_text = c.text
                _state["stats"]["replies"] += 1

                # Generate DM offer
                dm_text = await generate_dm_offer(
                    reply_text=reply_text,
                    post_caption=action.get("post_caption", ""),
                    business_type=action.get("business_type", "другое"),
                    language=action.get("language", "ru"),
                    author=author_username,
                )

                await _update_action(action["id"], {
                    "status": "reply_received",
                    "author_replied": True,
                    "reply_text": reply_text,
                    "dm_text": dm_text,
                })

                if _state["human_review"]:
                    _state["pending_dms"].append({
                        "id": f"dm_{action['id']}",
                        "action_id": action["id"],
                        "author": author_username,
                        "author_id": action.get("post_author_id"),
                        "reply_text": reply_text,
                        "dm_text": dm_text,
                        "language": action.get("language", "ru"),
                        "business_type": action.get("business_type", "другое"),
                    })
                    logger.info(f"Reply from @{author_username} — DM queued for review")
                else:
                    await _send_dm_direct(
                        action["id"],
                        action.get("post_author_id"),
                        author_username,
                        dm_text,
                        action.get("business_type", "другое"),
                        action.get("language", "ru"),
                    )
                break

    except Exception as e:
        if _is_login_error(e):
            _handle_login_expired()
        logger.debug(f"Check reply error {shortcode}: {e}")


async def _send_dm_direct(action_id, author_id, author_username, dm_text, business_type, language) -> tuple[bool, str]:
    """Actually send the DM. Returns (ok, reason)."""
    cl = _state["cl"]
    if cl is None or not _state["logged_in"]:
        return False, SESSION_EXPIRED_MSG

    counts = _day_counts()
    if counts["dms"] >= _state["limits"]["dms_per_day"]:
        return False, f"Лимит DM на сегодня исчерпан ({_state['limits']['dms_per_day']}/день)"

    try:
        await asyncio.to_thread(cl.direct_send, dm_text, [int(author_id)])
        counts["dms"] += 1
        _state["stats"]["dms_sent"] += 1

        await _update_action(action_id, {"status": "dm_sent", "dm_sent": True})

        # Save as lead
        lead = {
            "channel": "instagram",
            "name": author_username,
            "profile_url": f"https://www.instagram.com/{author_username}/",
            "business_type": business_type,
            "language": language,
            "status": "messaged",
            "source": "outbound",
            "notes": f"Instagram: ответил на комментарий. DM отправлен.",
            "is_hot": False,
        }
        await _save_lead(lead)
        await _log("dm_sent", author_username, dm_text[:100])
        logger.info(f"DM sent to @{author_username}")
        return True, "OK"
    except Exception as e:
        logger.error(f"DM error @{author_username}: {e}")
        if _is_login_error(e):
            _handle_login_expired()
            return False, SESSION_EXPIRED_MSG
        return False, str(e)


# ── Main scan wrapper ─────────────────────────────────────────────────────────

async def _run_scan_loop():
    """Continuously run hashtag scans with pause between cycles."""
    await _log("parser_start", "", "Instagram outbound parser started")
    # Warm-up: a real person doesn't start mass-browsing the second they log in
    try:
        await asyncio.sleep(random.uniform(60, 180))
    except asyncio.CancelledError:
        return
    while _state["running"]:
        try:
            await _scan_hashtags()
            if _state["running"]:
                pause = random.uniform(900, 1800)  # 15–30 min between full cycles
                logger.info(f"Scan cycle done. Waiting {int(pause/60)} min...")
                await asyncio.sleep(pause)
        except asyncio.CancelledError:
            break
        except Exception as e:
            _state["last_error"] = str(e)
            logger.error(f"Scan loop error: {e}")
            await asyncio.sleep(120)

    _state["running"] = False
    await _log("parser_stop", "", f"Лидов: {_state['stats']['dms_sent']} DM отправлено")


# ── Public API ────────────────────────────────────────────────────────────────

async def login_from_session(username: str, proxy: str = "") -> tuple[bool, str]:
    """Restore Instagram session from saved file — no password needed. Used for Railway auto-start."""
    ClientClass = _get_ig_client()
    if ClientClass is None:
        return False, "instagrapi не установлен"

    sf = _session_file(username)
    if not sf.exists():
        return False, f"Файл сессии не найден: {sf}"

    def _do_restore():
        cl = ClientClass()
        cl.delay_range = [3, 7]
        if proxy:
            cl.set_proxy(proxy)
        cl.load_settings(sf)
        _apply_kz_fingerprint(cl)
        cl.get_timeline_feed()  # lightweight check that session is still valid
        return cl

    try:
        cl = await asyncio.to_thread(_do_restore)
        _state["cl"] = cl
        _state["logged_in"] = True
        _state["username"] = username
        _state["last_error"] = None
        logger.info(f"Instagram: сессия восстановлена как @{username}")
        return True, f"Сессия восстановлена как @{username}"
    except Exception as e:
        _state["last_error"] = str(e)
        logger.warning(f"Session restore failed for @{username}: {e}")
        return False, f"Сессия устарела — запусти instagram_auth.py локально: {e}"


async def login(username: str, password: str, proxy: str = "") -> tuple[bool, str]:
    """Login to Instagram. Call once — session saved to disk."""
    ClientClass = _get_ig_client()
    if ClientClass is None:
        return False, "instagrapi не установлен. Выполни: pip install instagrapi"

    def _do_login():
        cl = ClientClass()
        cl.delay_range = [3, 7]
        if proxy:
            cl.set_proxy(proxy)
        sf = _session_file(username)
        if sf.exists():
            try:
                cl.load_settings(sf)
                _apply_kz_fingerprint(cl)
                cl.login(username, password)
                cl.dump_settings(sf)
                return cl, "Сессия восстановлена"
            except Exception:
                # Official instagrapi recovery: keep the device UUIDs so
                # Instagram sees the SAME phone logging back in, not a new one
                try:
                    old_uuids = cl.get_settings().get("uuids", {})
                    cl.set_settings({})
                    if old_uuids:
                        cl.set_uuids(old_uuids)
                except Exception:
                    pass
        _apply_kz_fingerprint(cl)
        cl.login(username, password)
        cl.dump_settings(sf)
        return cl, f"Вход выполнен как @{username}"

    try:
        cl, msg = await asyncio.to_thread(_do_login)
        _state["cl"] = cl
        _state["logged_in"] = True
        _state["username"] = username
        _state["last_error"] = None
        logger.info(f"Instagram: {msg}")
        return True, msg
    except Exception as e:
        _state["last_error"] = str(e)
        return False, f"Ошибка входа: {e}"


async def start(human_review: bool = True) -> tuple[bool, str]:
    """Start the Instagram parser (must be logged in first)."""
    if not _state["logged_in"] or _state["cl"] is None:
        return False, "Сначала войдите в Instagram (POST /instagram/login)"
    if _state["running"]:
        return False, "Парсер уже запущен"

    _state.update({
        "running": True,
        "human_review": human_review,
        "last_error": None,
        "stats": {"scanned": 0, "commented": 0, "replies": 0, "dms_sent": 0, "errors": 0},
    })
    _state["scan_task"] = asyncio.create_task(_run_scan_loop())
    _state["monitor_task"] = asyncio.create_task(_monitor_replies())
    return True, "Instagram парсер запущен"


async def stop() -> bool:
    _state["running"] = False
    for task_key in ("scan_task", "monitor_task"):
        if t := _state.get(task_key):
            t.cancel()
            _state[task_key] = None
    return True


async def approve_comment(pending_id, post_shortcode: str, comment_text: str, action_id=None) -> tuple[bool, str]:
    """Human approved a comment — post it now."""
    ok, reason = await _post_comment_direct(post_shortcode, comment_text, action_id)
    if ok:
        # Remove from pending queue only on success — keep it reviewable on failure
        _state["pending_comments"] = [
            c for c in _state["pending_comments"] if c.get("id") != action_id
        ]
        return True, "Комментарий опубликован"
    return False, reason


async def reject_comment(action_id) -> bool:
    _state["pending_comments"] = [
        c for c in _state["pending_comments"] if c.get("id") != action_id
    ]
    if action_id:
        await _update_action(action_id, {"status": "skipped"})
    return True


async def approve_dm(action_id, author_id: str, author_username: str, dm_text: str, business_type: str, language: str) -> tuple[bool, str]:
    """Human approved a DM — send it now."""
    ok, reason = await _send_dm_direct(action_id, author_id, author_username, dm_text, business_type, language)
    if ok:
        _state["pending_dms"] = [
            d for d in _state["pending_dms"] if d.get("action_id") != action_id
        ]
        return True, f"DM отправлен @{author_username}"
    return False, reason


async def reject_dm(action_id) -> bool:
    _state["pending_dms"] = [
        d for d in _state["pending_dms"] if d.get("action_id") != action_id
    ]
    if action_id:
        await _update_action(action_id, {"status": "skipped"})
    return True


def status() -> dict:
    counts = _day_counts()
    return {
        "running": _state["running"],
        "logged_in": _state["logged_in"],
        "username": _state["username"],
        "human_review": _state["human_review"],
        "stats": _state["stats"].copy(),
        "pending_comments": _state["pending_comments"],
        "pending_dms": _state["pending_dms"],
        "last_error": _state["last_error"],
        "limits": _state["limits"].copy(),
        "today": {"comments": counts["comments"], "dms": counts["dms"]},
    }
