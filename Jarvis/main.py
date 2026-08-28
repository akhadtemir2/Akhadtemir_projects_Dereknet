import platform as _platform
import subprocess as _subprocess

# ── Nuclear: force CREATE_NO_WINDOW on EVERY subprocess call on Windows ───────
# This patches Popen itself, so no per-file flag is needed anywhere.
if _platform.system() == "Windows":
    _OrigPopen = _subprocess.Popen

    class _Popen(_OrigPopen):
        def __init__(self, args, **kw):
            kw["creationflags"] = kw.get("creationflags", 0) | _subprocess.CREATE_NO_WINDOW
            kw.pop("startupinfo", None)   # drop any stale/shared STARTUPINFO
            # On a legacy Windows console (cp1251 / cp866) text-mode pipes decode
            # child output with the locale codec and CRASH on any byte it can't map
            # (e.g. 0x98) — killing subprocess reader threads across many actions.
            # Force UTF-8 + replace for every text-mode child so a stray byte can
            # never take a thread (or a feature) down. Binary Popen is untouched.
            if (kw.get("text") or kw.get("universal_newlines")) and not kw.get("encoding"):
                kw["encoding"] = "utf-8"
                kw.setdefault("errors", "replace")
            super().__init__(args, **kw)

    _subprocess.Popen = _Popen
# ─────────────────────────────────────────────────────────────────────────────

# ── Force UTF-8 stdout/stderr so the emoji-rich log lines never crash on a
#    legacy Windows console (cp1251 / cp1252).  Must run before any print().
try:
    import sys as _sys_boot
    _sys_boot.stdout.reconfigure(encoding="utf-8", errors="replace")
    _sys_boot.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ── Declare per-monitor DPI awareness BEFORE Qt / pyautogui / PIL load.
# The user's display runs at 125% scaling: without an explicit declaration the
# awareness state depends on WHICH library touches the screen first (Qt sets
# PerMonitorV2 at QApplication creation, Pillow's ImageGrab force-sets legacy
# system-aware on first screenshot), so pyautogui.size(), screenshots and
# SetCursorPos could disagree and clicks landed offset. Declaring PMv2 here
# makes every screen API physical-pixel-consistent for the whole process.
# (Qt6 detects the pre-set context and keeps rendering correctly.)
if _platform.system() == "Windows":
    try:
        import ctypes as _ctypes
        try:  # Win10 1703+ — same context Qt6 would set itself
            _ctypes.windll.user32.SetProcessDpiAwarenessContext(
                _ctypes.c_void_p(-4)  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            )
        except Exception:
            try:  # Win 8.1+ fallback
                _ctypes.windll.shcore.SetProcessDpiAwareness(2)
            except Exception:  # ancient fallback
                _ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

import asyncio
import re
import threading
import time
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path

# Arm the DNS fallback BEFORE any networking import — makes the whole process
# (Gemini Live websockets, requests, everything) immune to a dead router DNS.
try:
    from core import net_boot  # noqa: F401  (installs on import)
except Exception as _e:
    print(f"[NetBoot] disabled: {_e}")

# ── Pre-warm lazy imports a background websocket connect needs ────────────────
# The OpenAI Realtime socket runs on its OWN thread. websockets.connect() lazily
# imports `encodings.idna` (SNI hostname encoding) and parts of `ssl` on the
# FIRST connect. If another thread is mid-import at that instant (fastembed /
# onnxruntime pull in hundreds of modules on the brain indexer), the socket
# thread blocks on the CPython import lock and the connect hangs forever — the
# exact "opening websocket… never returns, even the timeout can't fire" stall
# that kept the OpenAI voice backend parked. Importing them once here, on the
# main thread at startup, means no connect ever needs the import lock again.
try:
    import encodings.idna  # noqa: F401
    import ssl             # noqa: F401
    import websockets      # noqa: F401
except Exception as _e:
    print(f"[Prewarm] optional import skipped: {_e}")

import sounddevice as sd
import numpy as np
from google import genai
from google.genai import types
from core.stt import OpenAITranscribeSTT, LocalWhisperSTT, STTUnavailableError
from core import intent_router
from ui import JarvisUI
from memory.memory_manager import (
    load_memory, update_memory, format_memory_for_prompt,
    save_session_summary, pop_last_session,
)

from actions.file_processor import file_processor
from actions.flight_finder     import flight_finder
from actions.open_app          import open_app
from actions.weather_report    import weather_action
from actions.send_message      import send_message
from actions.reminder          import reminder
from actions.computer_settings import computer_settings
from actions.screen_processor  import _capture_camera, _capture_screen
from actions.youtube_video     import youtube_video
from actions.desktop           import desktop_control
from actions.browser_control   import browser_control
from actions.file_controller   import file_controller
from actions.code_helper       import code_helper
from actions.dev_agent         import dev_agent
from actions.web_search        import web_search as web_search_action
from actions.computer_control  import computer_control
from actions.game_updater      import game_updater
from actions.system_monitor    import SystemMonitor, get_system_status
from actions.proactive         import ProactiveEngine
from actions.background_monitor import (
    add_monitor, remove_monitor, list_monitors, check_all as monitor_check_all,
)
from actions.web_search        import _news as _fetch_news_sync
from memory.config_manager     import (
    get_brief_enabled, get_news_enabled, save_news_enabled,
    get_preferred_language, save_preferred_language,
)
from actions.obsidian_note     import obsidian_note, mirror_session, open_in_obsidian
from actions.ambient_vision    import AmbientVision
from actions.deep_research     import deep_research as deep_research_action
from actions               import agent_task as agent_task_mod
from actions               import background_agent as background_agent_mod
from actions.system_control    import run_command as run_command_action, open_path as open_path_action
from actions.word_control      import word_control
from actions.office_control    import office_control
from actions.onec_control      import onec_control
from actions.desktop_agent     import gui_agent as gui_agent_action
from actions.desktop_agent     import _looks_like_demo as _gui_looks_like_demo
from core import model_router
from core import mcp_client
from memory import brain
from memory import mind
from memory import knowledge
from memory import work_style


def get_base_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


BASE_DIR        = get_base_dir()
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"
PROMPT_PATH     = BASE_DIR / "core" / "prompt.txt"
LIVE_MODEL          = "models/gemini-2.5-flash-native-audio-preview-12-2025"
# If Google retires the pinned model (it's a *preview*; this already happened to
# gemini-2.5-flash), the connect loop advances through these automatically.
LIVE_MODEL_FALLBACKS = [
    LIVE_MODEL,
    "models/gemini-2.5-flash-native-audio-latest",
    "models/gemini-2.5-flash-native-audio-preview-09-2025",
]
CHANNELS            = 1
SEND_SAMPLE_RATE    = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE          = 1024

def _get_api_key() -> str:
    with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["gemini_api_key"]


def _get_openai_key() -> str:
    """Best-effort read of the OpenAI key used for gpt-4o-transcribe (mic STT)."""
    try:
        return (_load_cfg().get("openai_api_key") or "").strip()
    except Exception:
        return ""


def _load_cfg() -> dict:
    """Best-effort read of the whole config (never raises)."""
    try:
        return json.loads(API_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _unattended_speech_on() -> bool:
    """May JARVIS start a paid conversation turn on its OWN initiative?

    Three background loops (proactive check-in, topic monitor, system-metric
    alerts) send a full turn to the live model with nobody in the room. On a
    metered backend that is real money: the session preamble alone is ~18k
    tokens (system prompt + 29 tool schemas) and it is re-billed on EVERY turn,
    plus the spoken answer is charged as audio output.

    Measured 2026-08-17: proactive mode fires after 15 min of silence and then
    every 20 min, i.e. ~3 turns/hour of idle time. Two days of an idle machine
    ≈ 144 turns ≈ $3.37 at cached rates — which is exactly the $3.31 that
    disappeared from the OpenAI account before the assistant had ever been
    demoed to anyone.

    Default OFF: unattended spending must be opted into, never inherited."""
    return bool(_load_cfg().get("unattended_speech_enabled", False))


# ── persistent MONTHLY spend cap ─────────────────────────────────────────────
# `session_budget_usd` only caps ONE run — it resets to zero on every restart,
# so "$5" could silently become "$5 every launch". The user's real limit is per
# CALENDAR MONTH, which must survive restarts. This tiny on-disk ledger records
# cumulative spend keyed by month; a new month auto-resets to zero. The dominant
# metered cost (the OpenAI Realtime voice model) flows through here via _on_spend.
_SPEND_LEDGER_PATH = BASE_DIR / "memory" / "spend_ledger.json"


def _current_month() -> str:
    return datetime.now().strftime("%Y-%m")


def _read_ledger() -> dict:
    try:
        d = json.loads(_SPEND_LEDGER_PATH.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _month_spent_usd() -> float:
    """USD spent so far in the CURRENT calendar month (0.0 on a fresh month).

    A new month is simply a key that isn't there yet → 0.0, so the cap resets
    on its own at the start of each month with no cron or cleanup."""
    rec = (_read_ledger().get("months") or {}).get(_current_month()) or {}
    try:
        return float(rec.get("spent_usd", 0.0) or 0.0)
    except Exception:
        return 0.0


def _ledger_add(delta_usd: float, turns: int = 0) -> float:
    """Add an INCREMENTAL cost to this month's tally; returns the new month total.
    Past months are kept (history / a monthly report), only the current one grows."""
    if delta_usd <= 0:
        return _month_spent_usd()
    d = _read_ledger()
    months = d.get("months")
    if not isinstance(months, dict):
        months = {}
    m = _current_month()
    rec = months.get(m) or {"spent_usd": 0.0, "turns": 0}
    rec["spent_usd"] = round(float(rec.get("spent_usd", 0.0) or 0.0) + float(delta_usd), 6)
    rec["turns"] = int(rec.get("turns", 0) or 0) + int(turns)
    months[m] = rec
    d["months"] = months
    d["updated"] = datetime.now().isoformat(timespec="seconds")
    try:
        _SPEND_LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        _SPEND_LEDGER_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
    except Exception as e:
        print(f"[Spend] ledger write failed: {e}")
    return rec["spent_usd"]


def _monthly_cap_usd() -> float:
    """The per-month hard cap in USD (0 = off)."""
    try:
        return float(_load_cfg().get("monthly_budget_usd", 0) or 0)
    except Exception:
        return 0.0


def _load_system_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8")
    except Exception:
        return (
            "You are JARVIS, Tony Stark's AI assistant. "
            "Be concise, direct, and always use the provided tools to complete tasks. "
            "Never simulate or guess results — always call the appropriate tool."
        )

# Tools where an identical repeat is legitimate — the world changed between
# calls, or the tool guards itself. Everything else is covered by the repeat
# guard in _execute_tool.
_REPEATABLE_TOOLS = {
    "screen_process",     # the screen moves
    "system_status",      # metrics move
    "computer_control",   # "click at x,y" twice is a real double action
    "computer_settings",  # "volume_down" twice is a real request
    "gui_agent",          # has its own busy latch
    "close_camera", "ambient_vision", "shutdown_jarvis",
}
_REPEAT_WINDOW_S = 90.0


def _exc_text(exc: BaseException, _depth: int = 0) -> str:
    """Flatten an exception — including ExceptionGroup members and __cause__ —
    into one searchable string.

    WHY: the live receive loop runs inside an asyncio TaskGroup, so every real
    failure reaches the reconnect handler wrapped in an ExceptionGroup. And
    `str(ExceptionGroup)` is only "unhandled errors in a TaskGroup (1
    sub-exception)" — the inner message is NOT included. The handler below
    classifies failures by substring ("1007", "audio content type",
    "API key not valid", "1008"), so with a plain str(e) every one of those
    checks silently tested the wrapper text and matched nothing.

    Measured on 2026-08-12: 14 × close-1007 in one session and the live-model
    fallback chain advanced ZERO times, because the branch that advances it
    could never see the "1007". Same blindness disabled the bad-key prompt and
    the geo-block backoff.
    """
    if _depth > 6 or exc is None:
        return ""
    parts = [f"{type(exc).__name__}: {exc}"]
    for sub in (getattr(exc, "exceptions", None) or ()):
        parts.append(_exc_text(sub, _depth + 1))
    for chained in (exc.__cause__, exc.__context__):
        if chained is not None and chained is not exc:
            parts.append(_exc_text(chained, _depth + 1))
    return " | ".join(p for p in parts if p)


# Connection-failure taxonomy. Each entry is (kind, matching substrings) tested
# against the LOWERCASED flattened text from _exc_text().
#
# WHY THIS IS A FUNCTION AND NOT INLINE `if` BRANCHES: on 2026-08-12 every error
# branch in the reconnect loop turned out to be dead code for weeks, and nothing
# caught it because logic buried inside a 200-line `except` block cannot be
# tested. On 2026-08-17 the same shape produced a worse failure — an OpenAI
# billing close (1013 insufficient_quota) matched NO branch, so the loop retried
# silently every 3 s forever and the app looked frozen. A pure function over a
# string is testable; see tests/test_connection_resilience.py.
_CONN_ERROR_SIGNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    # Gemini rejects the key outright.
    ("bad_gemini_key", ("api key not valid",)),
    # The account has no money. Never retryable — only a top-up or a failover
    # fixes it. Substrings are specific: a bare "1013" would also match a line
    # number or an unrelated id inside a flattened traceback message.
    ("billing", ("insufficient_quota", "credit_balance_exhausted",
                 "no credits remaining", "exceeded your current quota",
                 "1013 (try again later)", "billing_hard_limit_reached")),
    # The key itself was refused (OpenAI wording).
    ("auth", ("invalid_api_key", "incorrect api key", "http 401")),
    # Google retired/renamed the live model → switch to the next candidate now.
    ("permanent_model", ("no longer available", "not_found", "not found")),
    # The aging native-audio preview intermittently rejects the audio config.
    # NOT sticky, so reconnect the SAME model instead of abandoning the session.
    ("transient_live", ("1007", "audio content type",
                        "not supported for this model", "content_type_audio")),
    # Project/region denial — retrying fast is pointless.
    ("denied", ("denied access", "has been denied", "permission_denied", "1008")),
    # Transport-level trouble — worth an exponential backoff.
    ("network", ("timeouterror", "timed out", "getaddrinfo", "cancellederror",
                 "connectionrefusederror", "oserror", "cannot connect")),
)


def _conn_error_kinds(err_text: str) -> set[str]:
    """Classify a connection failure. Input MUST be _exc_text() output, not
    str(e) — see _exc_text for why. Returns every kind that matches; callers
    decide precedence."""
    low = (err_text or "").lower()
    return {kind for kind, needles in _CONN_ERROR_SIGNS
            if any(n in low for n in needles)}


_CTRL_RE = re.compile(r"<ctrl\d+>", re.IGNORECASE)

# Characters from scripts the user never speaks (Kazakh/Russian/English only).
# Used to scrub STT hallucinations — see _clean_transcript.
_FOREIGN_SCRIPT_RE = re.compile(
    "["
    "ᄀ-ᇿ"   # Hangul Jamo
    "぀-ヿ"   # Hiragana + Katakana
    "㄰-㆏"   # Hangul Compatibility Jamo
    "ㇰ-ㇿ"   # Katakana Phonetic Extensions
    "㐀-䶿"   # CJK Extension A
    "一-鿿"   # CJK Unified Ideographs
    "ꥠ-꥿"   # Hangul Jamo Extended-A
    "가-퟿"   # Hangul Syllables + Jamo Extended-B
    "豈-﫿"   # CJK Compatibility Ideographs
    "＀-￯"   # Halfwidth/Fullwidth forms
    "฀-๿"   # Thai
    "؀-ۿ"   # Arabic
    "֐-׿"   # Hebrew
    "ऀ-ॿ"   # Devanagari
    "]"
)

def _clean_transcript(text: str) -> str:
    text = _CTRL_RE.sub("", text)
    text = re.sub(r"[\x00-\x08\x0b-\x1f]", "", text)

    # Script guard. The user speaks only Kazakh, Russian and English — all of
    # which live in the Latin + Cyrillic (U+0400–04FF covers Kazakh's ә ғ қ ң ө
    # ұ ү һ і) scripts. gpt-4o-transcribe intermittently hallucinates Korean /
    # CJK / Japanese / Thai / Arabic on ambiguous or near-silent audio; those
    # characters are NEVER real input here, so strip them. If stripping leaves
    # no real letters, the whole utterance was a hallucination — discard it.
    if _FOREIGN_SCRIPT_RE.search(text):
        stripped = _FOREIGN_SCRIPT_RE.sub("", text)
        real_letters = re.sub(r"[^A-Za-zЀ-ӿ]", "", stripped)
        if len(real_letters) < 2:
            return ""
        text = stripped

    return text.strip()

TOOL_DECLARATIONS = [
    {
        "name": "open_app",
        "description": (
            "Launches a desktop APPLICATION installed on the computer "
            "(WhatsApp, Word, Spotify, Telegram, a game…). "
            "Use this whenever the user asks to open, launch, or start a program. "
            "NOT for websites — a site or URL always goes to open_path. "
            "Always call this tool — never just say you opened it."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "app_name": {
                    "type": "STRING",
                    "description": "Exact name of the application (e.g. 'WhatsApp', 'Chrome', 'Spotify')"
                }
            },
            "required": ["app_name"]
        }
    },
    {
        "name": "web_search",
        "description": (
            "Searches the web. Use for ANY question about current facts, events, prices, "
            "or topics — always prefer this over guessing. "
            "Modes: 'search' (default), 'news' (latest headlines on a topic), "
            "'research' (deep comprehensive answer), 'price' (product cost lookup), "
            "'compare' (side-by-side comparison of items)."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query":  {"type": "STRING", "description": "Search query or topic"},
                "mode":   {"type": "STRING", "description": "search | news | research | price | compare"},
                "items":  {"type": "ARRAY",  "items": {"type": "STRING"}, "description": "Items to compare (compare mode)"},
                "aspect": {"type": "STRING", "description": "Comparison aspect: price | specs | reviews | features"},
            },
            "required": ["query"]
        }
    },
    {
        "name": "system_status",
        "description": (
            "Returns real-time system metrics: CPU usage, RAM, GPU load, CPU temperature, "
            "uptime, and process count. Use when the user asks about computer performance, "
            "temperature, memory, or resource usage."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        }
    },
    {
        "name": "weather_report",
        "description": "Gives the weather report to user",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "city": {"type": "STRING", "description": "City name"}
            },
            "required": ["city"]
        }
    },
    {
        "name": "send_message",
        "description": "Sends a text message via WhatsApp, Telegram, or other messaging platform.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "receiver":     {"type": "STRING", "description": "Recipient contact name"},
                "message_text": {"type": "STRING", "description": "The message to send"},
                "platform":     {"type": "STRING", "description": "Platform: WhatsApp, Telegram, etc."}
            },
            "required": ["receiver", "message_text", "platform"]
        }
    },
    {
        "name": "reminder",
        "description": "Sets a timed reminder using Task Scheduler.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "date":    {"type": "STRING", "description": "Date in YYYY-MM-DD format"},
                "time":    {"type": "STRING", "description": "Time in HH:MM format (24h)"},
                "message": {"type": "STRING", "description": "Reminder message text"}
            },
            "required": ["date", "time", "message"]
        }
    },
    {
        "name": "youtube_video",
        "description": (
            "Acts on a SPECIFIC YouTube video the user named: play it, summarize "
            "its content, get its info, or show trending videos. "
            "Requires a concrete video, search query or URL from the user. "
            "Do NOT use this to merely open the YouTube site — «открой ютуб», "
            "«зайди на ютуб», 'open YouTube' with no video in mind is "
            "open_path(path='youtube.com')."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {"type": "STRING", "description": "play | summarize | get_info | trending (default: play)"},
                "query":  {"type": "STRING", "description": "Search query for play action"},
                "save":   {"type": "BOOLEAN", "description": "Save summary to Notepad (summarize only)"},
                "region": {"type": "STRING", "description": "Country code for trending e.g. TR, US"},
                "url":    {"type": "STRING", "description": "Video URL for get_info action"},
            },
            "required": []
        }
    },
    {
        "name": "screen_process",
        "description": (
            "Captures the screen or webcam image and lets you analyze it. "
            "MUST be called when user asks what is on screen, what you see, "
            "look at camera, analyze my screen, etc. "
            "You have NO visual ability without this tool. "
            "After the image is captured it is sent directly to you — describe what you see and answer the user's question. "
            "When using camera: the live view stays open until user says close it or calls close_camera."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "angle": {"type": "STRING", "description": "'screen' to capture display, 'camera' for webcam. Default: 'screen'"},
                "text":  {"type": "STRING", "description": "The question or instruction about the captured image"}
            },
            "required": ["text"]
        }
    },
    {
        "name": "close_camera",
        "description": (
            "Closes the live camera view shown on screen. "
            "Call when user says: close camera, stop camera, turn off camera, "
            "kamerayı kapat, kapat, creepy, etc."
        ),
        "parameters": {"type": "OBJECT", "properties": {}, "required": []}
    },
    {
        "name": "computer_settings",
        "description": (
            "Controls the computer: volume, brightness, window management, keyboard shortcuts, "
            "typing text on screen, closing apps, fullscreen, dark mode, WiFi, restart, shutdown, "
            "scrolling, tab management, zoom, screenshots, lock screen, refresh/reload page. "
            "Use for ANY single computer control command."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "Exact action name. Windows: close_app | close_window | close_tab | "
                        "minimize | maximize | show_desktop | switch_window | snap_left | snap_right | "
                        "volume_set | volume_up | volume_down | mute | unmute | "
                        "brightness_up | brightness_down | toggle_wifi | "
                        "lock_screen | sleep_display | shutdown | restart | "
                        "screenshot | dark_mode | fullscreen | zoom_in | zoom_out | zoom_reset | "
                        "new_tab | next_tab | prev_tab | refresh_page | scroll_up | scroll_down | "
                        "type_text | press_key | copy | paste | select_all | undo | redo | "
                        "task_manager | file_explorer | open_settings. "
                        "If unsure of the exact name, leave this EMPTY and describe the goal in "
                        "'description' instead — it will be resolved for you."
                    ),
                },
                "description": {"type": "STRING", "description": "Natural language description of what to do (used to resolve the action when 'action' is empty or not an exact name)"},
                "value":       {"type": "STRING", "description": "Optional value: volume level, text to type, etc."}
            },
            "required": []
        }
    },
    {
        "name": "browser_control",
        "description": (
            "Controls any web browser. Use for: opening websites, searching the web, "
            "clicking elements, filling forms, scrolling, screenshots, navigation, any web-based task. "
            "Simple open/search requests launch the user's own browser normally (their real profile "
            "and logged-in accounts); interactive actions (click, type, fill_form...) attach an "
            "automation browser. "
            "Always pass the 'browser' parameter when the user specifies a browser (e.g. 'open in Edge', "
            "'use Firefox', 'open Chrome'). Multiple browsers can run simultaneously."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "go_to | search | click | type | scroll | fill_form | smart_click | smart_type | get_text | get_url | press | new_tab | close_tab | screenshot | back | forward | reload | switch | list_browsers | close | close_all"},
                "browser":     {"type": "STRING", "description": "Target browser: chrome | edge | firefox | opera | operagx | brave | vivaldi | safari. Omit to use the currently active browser."},
                "url":         {"type": "STRING", "description": "URL for go_to / new_tab action"},
                "query":       {"type": "STRING", "description": "Search query for search action"},
                "engine":      {"type": "STRING", "description": "Search engine: google | bing | duckduckgo | yandex (default: google)"},
                "selector":    {"type": "STRING", "description": "CSS selector for click/type"},
                "text":        {"type": "STRING", "description": "Text to click or type"},
                "description": {"type": "STRING", "description": "Element description for smart_click/smart_type"},
                "direction":   {"type": "STRING", "description": "up | down for scroll"},
                "amount":      {"type": "INTEGER", "description": "Scroll amount in pixels (default: 500)"},
                "key":         {"type": "STRING", "description": "Key name for press action (e.g. Enter, Escape, F5)"},
                "path":        {"type": "STRING", "description": "Save path for screenshot"},
                "clear_first": {"type": "BOOLEAN", "description": "Clear field before typing (default: true)"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "file_controller",
        "description": "Manages files and folders: list, create, delete, move, copy, rename, read, write, find, disk usage.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "list | create_file | create_folder | delete | move | copy | rename | read | write | find | largest | disk_usage | organize_desktop | info"},
                "path":        {"type": "STRING", "description": "File/folder path or shortcut: desktop, downloads, documents, home"},
                "destination": {"type": "STRING", "description": "Destination path for move/copy"},
                "new_name":    {"type": "STRING", "description": "New name for rename"},
                "content":     {"type": "STRING", "description": "Content for create_file/write"},
                "name":        {"type": "STRING", "description": "File name to search for"},
                "extension":   {"type": "STRING", "description": "File extension to search (e.g. .pdf)"},
                "count":       {"type": "INTEGER", "description": "Number of results for largest"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "desktop_control",
        "description": "Controls the desktop: wallpaper, organize, clean, list, stats.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {"type": "STRING", "description": "wallpaper | wallpaper_url | organize | clean | list | stats | task"},
                "path":   {"type": "STRING", "description": "Image path for wallpaper"},
                "url":    {"type": "STRING", "description": "Image URL for wallpaper_url"},
                "mode":   {"type": "STRING", "description": "by_type or by_date for organize"},
                "task":   {"type": "STRING", "description": "Natural language desktop task"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "code_helper",
        "description": "Writes, edits, explains, runs, or builds code files.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "write | edit | explain | run | build | auto (default: auto)"},
                "description": {"type": "STRING", "description": "What the code should do or what change to make"},
                "language":    {"type": "STRING", "description": "Programming language (default: python)"},
                "output_path": {"type": "STRING", "description": "Where to save the file"},
                "file_path":   {"type": "STRING", "description": "Path to existing file for edit/explain/run/build"},
                "code":        {"type": "STRING", "description": "Raw code string for explain"},
                "args":        {"type": "STRING", "description": "CLI arguments for run/build"},
                "timeout":     {"type": "INTEGER", "description": "Execution timeout in seconds (default: 30)"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "dev_agent",
        "description": "Builds complete multi-file projects from scratch: plans, writes files, installs deps, opens VSCode, runs and fixes errors.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "description":  {"type": "STRING", "description": "What the project should do"},
                "language":     {"type": "STRING", "description": "Programming language (default: python)"},
                "project_name": {"type": "STRING", "description": "Optional project folder name"},
                "timeout":      {"type": "INTEGER", "description": "Run timeout in seconds (default: 30)"},
            },
            "required": ["description"]
        }
    },
    {
        "name": "computer_control",
        "description": "Direct computer control: type, click, hotkeys, scroll, move mouse, screenshots, find elements on screen.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "type | smart_type | click | double_click | right_click | hotkey | press | scroll | move | copy | paste | screenshot | wait | clear_field | focus_window | screen_find | screen_click | random_data | user_data"},
                "text":        {"type": "STRING", "description": "Text to type or paste"},
                "x":           {"type": "INTEGER", "description": "X coordinate"},
                "y":           {"type": "INTEGER", "description": "Y coordinate"},
                "keys":        {"type": "STRING", "description": "Key combination e.g. 'ctrl+c'"},
                "key":         {"type": "STRING", "description": "Single key e.g. 'enter'"},
                "direction":   {"type": "STRING", "description": "up | down | left | right"},
                "amount":      {"type": "INTEGER", "description": "Scroll amount (default: 3)"},
                "seconds":     {"type": "NUMBER",  "description": "Seconds to wait"},
                "title":       {"type": "STRING",  "description": "Window title for focus_window"},
                "description": {"type": "STRING",  "description": "Element description for screen_find/screen_click"},
                "type":        {"type": "STRING",  "description": "Data type for random_data"},
                "field":       {"type": "STRING",  "description": "Field for user_data: name|email|city"},
                "clear_first": {"type": "BOOLEAN", "description": "Clear field before typing (default: true)"},
                "path":        {"type": "STRING",  "description": "Save path for screenshot"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "game_updater",
        "description": (
            "THE ONLY tool for ANY Steam or Epic Games request. "
            "Use for: installing, downloading, updating games, listing installed games, "
            "checking download status, scheduling updates. "
            "ALWAYS call directly for any Steam/Epic/game request. "
            "NEVER use browser_control or web_search for Steam/Epic."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":    {"type": "STRING",  "description": "update | install | list | download_status | schedule | cancel_schedule | schedule_status (default: update)"},
                "platform":  {"type": "STRING",  "description": "steam | epic | both (default: both)"},
                "game_name": {"type": "STRING",  "description": "Game name (partial match supported)"},
                "app_id":    {"type": "STRING",  "description": "Steam AppID for install (optional)"},
                "hour":      {"type": "INTEGER", "description": "Hour for scheduled update 0-23 (default: 3)"},
                "minute":    {"type": "INTEGER", "description": "Minute for scheduled update 0-59 (default: 0)"},
                "shutdown_when_done": {"type": "BOOLEAN", "description": "Shut down PC when download finishes"},
            },
            "required": []
        }
    },
    {
        "name": "flight_finder",
        "description": "Searches Google Flights and speaks the best options.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "origin":      {"type": "STRING",  "description": "Departure city or airport code"},
                "destination": {"type": "STRING",  "description": "Arrival city or airport code"},
                "date":        {"type": "STRING",  "description": "Departure date (any format)"},
                "return_date": {"type": "STRING",  "description": "Return date for round trips"},
                "passengers":  {"type": "INTEGER", "description": "Number of passengers (default: 1)"},
                "cabin":       {"type": "STRING",  "description": "economy | premium | business | first"},
                "save":        {"type": "BOOLEAN", "description": "Save results to Notepad"},
            },
            "required": ["origin", "destination", "date"]
        }
    },
    {
        "name": "manage_monitor",
        "description": (
            "Add, remove, or list background monitoring topics. "
            "JARVIS checks these topics once a day and alerts the user when there is a new development. "
            "Use 'add' when the user says 'monitor X', 'track X', 'follow X'. "
            "Use 'remove' when the user says 'stop monitoring X'. "
            "Use 'list' when the user asks what is being monitored. "
            "Do NOT add crypto, financial, or trading topics."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type":        "STRING",
                    "description": "add | remove | list",
                },
                "topic": {
                    "type":        "STRING",
                    "description": "Topic to monitor or stop monitoring (e.g. 'space exploration', 'AI news')",
                },
            },
            "required": ["action"],
        },
    },
    {
        "name": "shutdown_jarvis",
        "description": (
            "Shuts down the assistant completely. "
            "Call this when the user expresses intent to end the conversation, "
            "close the assistant, say goodbye, or stop Jarvis. "
            "The user can say this in ANY language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        }
    },
    {
    "name": "file_processor",
    "description": (
        "Processes any file that the user has uploaded or dropped onto the interface. "
        "Use this when the user refers to an uploaded file and wants an action on it. "
        "Supports: images (describe/ocr/resize/compress/convert), "
        "PDFs (summarize/extract_text/to_word), "
        "Word docs & text files (summarize/fix/reformat/translate), "
        "CSV/Excel (analyze/stats/filter/sort/convert), "
        "JSON/XML (validate/format/analyze), "
        "code files (explain/review/fix/optimize/run/document/test), "
        "audio (transcribe/trim/convert/info), "
        "video (trim/extract_audio/extract_frame/compress/transcribe/info), "
        "archives (list/extract), "
        "presentations (summarize/extract_text). "
        "ALWAYS call this tool when a file has been uploaded and the user gives a command about it. "
        "If the user's command is ambiguous, pick the most logical action for that file type."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "file_path": {
                "type": "STRING",
                "description": "Full path to the uploaded file. Leave empty to use the currently uploaded file."
            },
            "action": {
                "type": "STRING",
                "description": (
                    "What to do with the file. Examples by type:\n"
                    "image: describe | ocr | resize | compress | convert | info\n"
                    "pdf: summarize | extract_text | to_word | info\n"
                    "docx/txt: summarize | fix | reformat | translate_hint | word_count | to_bullet\n"
                    "csv/excel: analyze | stats | filter | sort | convert | info\n"
                    "json: validate | format | analyze | to_csv\n"
                    "code: explain | review | fix | optimize | run | document | test\n"
                    "audio: transcribe | trim | convert | info\n"
                    "video: trim | extract_audio | extract_frame | compress | transcribe | info | convert\n"
                    "archive: list | extract\n"
                    "pptx: summarize | extract_text | analyze"
                )
            },
            "instruction": {
                "type": "STRING",
                "description": "Free-form instruction if action doesn't cover it. E.g. 'translate this to Turkish', 'find all email addresses'"
            },
            "format": {
                "type": "STRING",
                "description": "Target format for conversion. E.g. 'mp3', 'pdf', 'csv', 'png'"
            },
            "width":     {"type": "INTEGER", "description": "Target width for image resize"},
            "height":    {"type": "INTEGER", "description": "Target height for image resize"},
            "scale":     {"type": "NUMBER",  "description": "Scale factor for image resize (e.g. 0.5)"},
            "quality":   {"type": "INTEGER", "description": "Quality 1-100 for image/video compress"},
            "start":     {"type": "STRING",  "description": "Start time for trim: seconds or HH:MM:SS"},
            "end":       {"type": "STRING",  "description": "End time for trim: seconds or HH:MM:SS"},
            "timestamp": {"type": "STRING",  "description": "Timestamp for video frame extraction HH:MM:SS"},
            "column":    {"type": "STRING",  "description": "Column name for CSV filter/sort"},
            "value":     {"type": "STRING",  "description": "Filter value for CSV filter"},
            "condition": {"type": "STRING",  "description": "Filter condition: equals|contains|gt|lt"},
            "ascending": {"type": "BOOLEAN", "description": "Sort order for CSV sort (default: true)"},
            "save":      {"type": "BOOLEAN", "description": "Save result to file (default: true)"},
            "destination": {"type": "STRING", "description": "Output folder for archive extract"},
        },
        "required": []
    }
},
    {
        "name": "save_memory",
        "description": (
            "Save an important personal fact about the user to long-term memory. "
            "Call this silently whenever the user reveals something worth remembering: "
            "name, age, city, job, preferences, hobbies, relationships, projects, or future plans. "
            "Do NOT call for: weather, reminders, searches, or one-time commands. "
            "Do NOT announce that you are saving — just call it silently. "
            "Values must be in English regardless of the conversation language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {
                    "type": "STRING",
                    "description": (
                        "identity — name, age, birthday, city, job, language, nationality | "
                        "preferences — favorite food/color/music/film/game/sport, hobbies | "
                        "projects — active projects, goals, things being built | "
                        "relationships — friends, family, partner, colleagues | "
                        "wishes — future plans, things to buy, travel dreams | "
                        "notes — habits, schedule, anything else worth remembering"
                    )
                },
                "key":   {"type": "STRING", "description": "Short snake_case key (e.g. name, favorite_food, sister_name)"},
                "value": {"type": "STRING", "description": "Concise value in English (e.g. Fatih, pizza, older sister)"},
            },
            "required": ["category", "key", "value"]
        }
    },
    {
        "name": "obsidian_note",
        "description": (
            "Save notes, ideas, tasks, or knowledge to the user's Obsidian vault — their "
            "second brain. Writes SILENTLY in the background straight to the vault file: it "
            "never opens Obsidian, never switches windows, and never interrupts what the user "
            "is doing. Call this whenever the user says things like 'save this to Obsidian', "
            "'note this down', 'add to my vault', 'write this to my second brain', or dictates "
            "an idea to keep. Works in ANY language. After saving, confirm in ONE short sentence."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "capture — append an idea/note (DEFAULT) | "
                        "daily — add a line to today's daily note | "
                        "create — create or overwrite a whole note | "
                        "read — read a note back | "
                        "search — search the vault | "
                        "list — list a folder | "
                        "open — open Obsidian at a note (use path/title) | "
                        "delete — delete a note (path/title) or a whole folder (folder) — goes to Recycle Bin, recoverable | "
                        "move — move a note (path → destination) | "
                        "rename — rename a note (path + new_name). You have FULL control of the vault; just do it when asked."
                    ),
                },
                "content": {"type": "STRING", "description": "The text/markdown to save, written in the user's language."},
                "title":   {"type": "STRING", "description": "Optional note title/topic (becomes the note name, e.g. 'Startup idea')."},
                "path":    {"type": "STRING", "description": "Optional explicit vault path, e.g. 'Projects/Mark L.md'. Overrides title."},
                "heading": {"type": "STRING", "description": "Optional heading inside the note to append under."},
                "tags":    {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Optional tags, without the '#'."},
                "query":   {"type": "STRING", "description": "Search text when action='search'."},
                "folder":  {"type": "STRING", "description": "Folder to list (action='list') or to delete (action='delete')."},
                "destination": {"type": "STRING", "description": "Destination vault path for action='move'."},
                "new_name":    {"type": "STRING", "description": "New note name for action='rename'."},
            },
            "required": [],
        },
    },
    {
        "name": "ambient_vision",
        "description": (
            "Turn CONTINUOUS screen watching on or off. When ON, you see the user's screen "
            "live and continuously (a fresh frame every couple of seconds) with no one-off "
            "screenshots. Call action='on' when the user asks you to watch / monitor / keep an "
            "eye on their screen; action='off' to stop; action='status' to report state. "
            "This is separate from the one-shot 'screen_process' tool."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {"type": "STRING", "description": "on | off | status"},
            },
            "required": [],
        },
    },
    {
        "name": "deep_think",
        "description": (
            "Route a HARD question to a powerful reasoning model and return a deep, "
            "structured analysis. Use for: strategy, business decisions, difficult "
            "study concepts, planning, serious comparisons, 'what do you think about "
            "X' on complex topics. The reasoning model is MUCH smarter than you — "
            "prefer it whenever real thinking is required. Do NOT use for simple "
            "facts (web_search), the user's own past (recall_memory), or casual chat."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {"type": "STRING", "description": "The full question, including every detail the user gave"},
                "context":  {"type": "STRING", "description": "Optional relevant context from the current conversation"},
            },
            "required": ["question"],
        },
    },
    {
        "name": "deep_research",
        "description": (
            "Full research engine: searches the web from several angles, reads the "
            "top pages, and writes a CITED report saved into the user's Obsidian "
            "vault. Runs 1-2 minutes in the background and reports back "
            "automatically — call it ONCE per topic and never again for the same "
            "request. Use when the user asks to research / investigate / prepare a "
            "report or deep overview ('сделай ресёрч', 'изучи тему', 'research X', "
            "'зерттеп бер'). For a quick factual lookup use web_search instead."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Research topic or question, in the user's language"},
                "depth": {"type": "STRING", "description": "quick (~30s, few sources) | full (default, thorough)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "recall_memory",
        "description": (
            "Search your OWN long-term memory and the user's Obsidian vault (their second "
            "brain) by MEANING, in ANY language. Use this whenever a good answer depends on "
            "something the user told you before, saved, decided, wrote down, or worked on — "
            "e.g. 'what did I decide about X', 'remind me my plan for Y', 'what do I know "
            "about Z', or ANY question about their projects, notes, past sessions, people, "
            "ideas, or earlier conversations. This searches unlimited history (not just the "
            "short fact-sheet in your prompt). Prefer it over guessing, and over web_search "
            "when the question is about the user's OWN knowledge/history. Call it silently, "
            "then answer naturally using what comes back."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "What to recall, in natural language."},
                "scope": {"type": "STRING", "description": "all (default) | facts | sessions | notes — restrict which kind of memory to search."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "agent_task",
        "description": (
            "Build a whole STRUCTURED workspace in the user's Obsidian second brain "
            "in one shot, in the BACKGROUND (~10-30s), reporting back automatically. "
            "Two kinds: (1) kind='study' — a folder + overview + one Notion-style "
            "dashboard per sub-topic (objectives, key concepts, deadlines, resources, "
            "insights) for a study hub / subjects / knowledge base; (2) kind='project' "
            "— a project HUB (goal, status, milestones, next actions, risks) + a "
            "kanban Tasks board + a Meeting-notes template + a Decisions log + one note "
            "per work area, built from a spoken project brief ('создай проект для "
            "запуска X: нужно сделать A, B, C, дедлайн через месяц', 'set up a "
            "workspace for my startup launch'). Use it whenever the user asks to "
            "CREATE / ORGANISE / SET UP something multi-part in their vault. Call it "
            "ONCE, then say in ONE short sentence you're building it. Do NOT use it "
            "for a single quick note (obsidian_note) or pure reasoning (deep_think)."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "goal": {
                    "type": "STRING",
                    "description": (
                        "The FULL request in the user's own words, including every "
                        "sub-topic/subject/work-area they named and everything they "
                        "want tracked (tasks, deadlines, milestones, resources)."
                    ),
                },
                "kind": {
                    "type": "STRING",
                    "description": (
                        "study — subjects / learning / knowledge base | project — a "
                        "project with tasks, milestones, meetings and decisions. "
                        "Pick project when the user talks about launching/building "
                        "something, tasks, deadlines, a team or a business goal. "
                        "Omit to auto-detect."
                    ),
                },
                "folder": {
                    "type": "STRING",
                    "description": (
                        "The exact folder name the user wants, copied VERBATIM from "
                        "how they said it (e.g. if they say 'папка МТД' → 'МТД'). "
                        "Preserve their exact spelling/alphabet — never transliterate."
                    ),
                },
                "language": {
                    "type": "STRING",
                    "description": "English name of the user's language (e.g. Russian, Kazakh) so the workspace is written in it.",
                },
                "depth": {
                    "type": "STRING",
                    "description": "fast (default, ~seconds) | deep (richer content, slower).",
                },
            },
            "required": ["goal"],
        },
    },
    {
        "name": "delegate_task",
        "description": (
            "Hand JARVIS a whole open-ended task to DO ON ITS OWN in the background, "
            "then report back with a finished deliverable AND the decisions that need "
            "the user's input. Use when the user delegates real work and expects to "
            "walk away: 'разберись, как лучше сделать X, и набросай шаги', 'подготовь "
            "мне план/стратегию по …', 'займись … и потом расскажи', 'поработай над …', "
            "'research the options and draft a plan'. JARVIS plans it, researches the "
            "web if needed, reasons with a strong model that knows the user's projects "
            "and goals, writes the result into the vault (JARVIS/Tasks), and reports "
            "what needs deciding. Runs 10-40s in the BACKGROUND and reports "
            "automatically — call it ONCE, say in ONE sentence you're on it. Different "
            "from: deep_research (pure cited research report), agent_task (build a "
            "structured vault workspace), deep_think (answer a question now)."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "goal": {"type": "STRING", "description": "The full task in the user's own words, with every detail and constraint they gave."},
                "language": {"type": "STRING", "description": "English name of the user's language (e.g. Kazakh, Russian) so the deliverable is written in it."},
            },
            "required": ["goal"],
        },
    },
    {
        "name": "run_command",
        "description": (
            "Run a real command in the system shell (PowerShell on Windows) and read "
            "the result back. This is your general 'hands on the computer' power tool: "
            "check or change system state, manage files/processes/network, run python/"
            "git/pip, install things, query info — anything a terminal can do. Prefer "
            "the specific tool when one fits (open_app to launch an app, open_path to "
            "open a folder/file, file_controller for simple file ops, system_status "
            "for CPU/RAM), and use run_command for everything else or when the user "
            "explicitly asks to run a command. Dangerous, irreversible actions (disk "
            "format, wiping a drive/profile, registry deletion, disabling antivirus, "
            "shutting down) are blocked automatically — don't attempt them. After it "
            "runs, tell the user the outcome in their language; summarise output, don't "
            "read it all aloud."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "command": {"type": "STRING", "description": "The exact shell command to run (PowerShell syntax on Windows)."},
                "timeout": {"type": "INTEGER", "description": "Max seconds to wait (default 30, max 180)."},
                "cwd":     {"type": "STRING",  "description": "Optional working directory to run in."},
            },
            "required": ["command"],
        },
    },
    {
        "name": "open_path",
        "description": (
            "Open a FOLDER, FILE, URL, or a named system location in the right app — "
            "reliably, in the user's own words and alphabet. Use for: 'открой "
            "проводник / this pc', 'open my downloads/documents/desktop', 'открой "
            "корзину / настройки / панель управления', opening a specific folder or "
            "file path. "
            "THIS IS THE DEFAULT WAY TO OPEN ANY WEBSITE: a site named in plain "
            "speech becomes its domain — «открой ютуб» → path='youtube.com', "
            "«открой гугл» → path='google.com', «зайди на авито» → path='avito.ru'. "
            "Understands RU/KZ names (загрузки, "
            "документы, рабочий стол, корзина, параметры…). For launching an "
            "application by name use open_app instead; only when the user names a "
            "specific browser ('в едже', 'in Chrome') use browser_control."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Folder/file path, a URL, or a named location (downloads, this pc, recycle bin, settings, проводник, загрузки…)."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "office_control",
        "description": (
            "Real work with Microsoft OFFICE files — Word .docx AND Excel .xlsx. "
            "Set program='excel' for spreadsheets/tables/numbers, program='word' "
            "for documents/letters/reports in prose.\n"
            "  • EXCEL: create a workbook from headers+rows, append rows, write a "
            "cell or a formula, column stats (сумма/среднее/мин/макс), add a "
            "chart, export to PDF, open it on screen, read or save the workbook "
            "the user ALREADY has open. Say program='excel' for 'сделай таблицу', "
            "'отчёт в экселе', 'посчитай сумму по колонке', 'построй график'.\n"
            "  • WORD: create with title/content, read, append, replace text, add "
            "a table, export to PDF, print, open visibly, insert at the cursor of "
            "the running Word, search in the open document. Say program='word' for "
            "'создай отчёт в ворде', 'открой договор и добавь пункт', 'распечатай'.\n"
            "For simply LAUNCHING the app with no file use open_app; for AI "
            "summarize/reformat of an existing file use file_processor."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "program": {
                    "type": "STRING",
                    "description": (
                        "'excel' for spreadsheets/tables/numbers/charts, 'word' for "
                        "documents/letters/prose. If omitted it is inferred from the "
                        "file extension and the parameters, but SAY it when you know."
                    ),
                },
                "action": {
                    "type": "STRING",
                    "description": (
                        "BOTH: create | read | append | to_pdf | open | list_open | save\n"
                        "EXCEL only: write (a cell or formula, needs cell=) | stats "
                        "(sum/avg/min/max per column) | chart | read_active (read the "
                        "workbook already open on screen)\n"
                        "WORD only: replace (find/replace) | add_table | insert (at the "
                        "cursor of the open Word) | find (search the open document) | print"
                    ),
                },
                "path":        {"type": "STRING", "description": "Path or filename (accepts 'desktop/отчёт.xlsx', bare 'report.docx', or a full path). The extension also tells JARVIS which program you mean."},
                "sheet":       {"type": "STRING", "description": "EXCEL: sheet name (defaults to the first/active sheet)."},
                "headers":     {"type": "ARRAY",  "items": {"type": "STRING"}, "description": "EXCEL: column headers for create — they get a styled, frozen header row."},
                "cell":        {"type": "STRING", "description": "EXCEL: target cell for write, e.g. 'B4'."},
                "value":       {"type": "STRING", "description": "EXCEL: value for write. Start with '=' for a formula, e.g. '=SUM(B2:B10)'."},
                "chart_type":  {"type": "STRING", "description": "EXCEL: bar | line | pie (default bar)."},
                "title":       {"type": "STRING", "description": "Optional title/heading when creating a document, or the chart title."},
                "content":     {"type": "STRING", "description": "Body text for create/append/insert. Blank lines separate paragraphs; leading '# ' / '## ' → headings; '- ' → bullets."},
                "text":        {"type": "STRING", "description": "Alias for content (insert action prefers 'text')."},
                "heading":     {"type": "STRING", "description": "Optional heading text to add above the appended/inserted content."},
                "heading_level": {"type": "INTEGER", "description": "Heading level 1-9 (default 2)."},
                "find":        {"type": "STRING", "description": "Text to search for in replace / find actions."},
                "replace":     {"type": "STRING", "description": "Replacement text for the replace action."},
                "query":       {"type": "STRING", "description": "Text to search for in the currently-open Word (find action)."},
                "rows":        {"type": "ARRAY",  "items": {"type": "ARRAY", "items": {"type": "STRING"}}, "description": "Table rows — list of lists of cell strings. EXCEL: the data for create/append. WORD: the table for add_table."},
                "table_rows":  {"type": "ARRAY",  "items": {"type": "ARRAY", "items": {"type": "STRING"}}, "description": "Alias for rows."},
                "output":      {"type": "STRING", "description": "Destination path for to_pdf."},
                "destination": {"type": "STRING", "description": "save_as destination when saving the active document."},
                "save_as":     {"type": "STRING", "description": "Save active document under a new path."},
                "copies":      {"type": "INTEGER", "description": "Number of print copies (default 1)."},
                "limit":       {"type": "INTEGER", "description": "Max chars returned by read (default 4000)."},
            },
            "required": ["action"],
        },
    },
    {
        "name": "gui_agent",
        "description": (
            "HANDS-ON MODE: YOU take the mouse and keyboard and act on the app on "
            "screen yourself — watching, clicking, typing, verifying each step, "
            "narrating out loud. Runs in the BACKGROUND and reports progress "
            "automatically as [AGENT_PROGRESS]/[AGENT_TEACH]/[AGENT_DONE].\n"
            "  • mode='do' (DEFAULT, almost always the right one) — DO a concrete "
            "multi-step job in the interface: 'сам нажимай', 'у тебя полный "
            "контроль', 'заполни и проведи документ', 'создай накладную', "
            "'сформируй ОСВ и сохрани в файл', 'запусти закрытие месяца'. Knows "
            "1С deeply: разделы, горячие клавиши, как построить типовой отчёт и "
            "выгрузить его в xlsx, как провести документ.\n"
            "  • mode='demo' — a narrated beginner TOUR. RARE. Only when the user "
            "literally asks to be shown or taught the program ('представь что я "
            "ничего не знаю', 'проведи презентацию', 'объясни каждую кнопку', "
            "'научи пользоваться'). An accountant asking for figures, checks or "
            "documents does NOT want a tour — that is onec_control's job.\n"
            "IMPORTANT: for reading data out of 1С (задолженность, остатки, ОСВ, "
            "поиск ошибок, налоги) use onec_control — it is faster and exact. Use "
            "gui_agent only when the interface is genuinely required.\n"
            "This tool IS the action — CALL IT to actually take control. Just "
            "SAYING you're taking over, without calling gui_agent, does nothing "
            "and is the #1 mistake to avoid. Call it ONCE, then let it work; "
            "never call it twice for the same request. For a single one-off "
            "click/keypress use computer_control instead."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "goal": {
                    "type": "STRING",
                    "description": (
                        "For mode='do': the FULL job in the user's own words with "
                        "every detail (what app, what to create/fill/find, what "
                        "values). E.g. 'в 1С создать документ Поступление "
                        "товаров: контрагент Ромашка, склад Основной, товар "
                        "Бумага А4 10 шт по 1500'. For mode='demo': what to give "
                        "a tour of, e.g. 'провести экскурсию по 1С для новичка'. "
                        "Optional in demo mode (a sensible default is used)."
                    ),
                },
                "mode": {
                    "type": "STRING",
                    "description": (
                        "'do' (default, use this unless explicitly asked for a "
                        "tour) = perform a concrete task | 'demo' = narrated "
                        "beginner tour that explains each button and changes "
                        "nothing. Only pick 'demo' when the user asked to be "
                        "SHOWN or TAUGHT the program itself."
                    ),
                },
                "app": {"type": "STRING", "description": "Target application hint, e.g. '1С', 'Chrome', 'Excel'."},
                "language": {"type": "STRING", "description": "English name of the user's language (e.g. Russian, Kazakh) for narration."},
                "max_steps": {"type": "INTEGER", "description": "Max actions before giving up (default 20 do / 30 demo, cap 40)."},
            },
            "required": ["goal"],
        },
    },
    {
        "name": "onec_control",
        "description": (
            "THE ACCOUNTANT'S TOOL for 1С:Предприятие 8 — reads the working base "
            "directly and answers with real figures, no clicking. The user is a "
            "practising accountant: they want numbers, checks and calculations, "
            "NOT an explanation of the interface. Use it for ANY accounting "
            "question: 'сколько нам должны', 'дебиторка на конец марта', 'покажи "
            "ОСВ', 'что с деньгами', 'сколько продали за июнь', 'найди "
            "непроведённые', 'проверь базу перед закрытием', 'посчитай зарплату', "
            "'когда сдавать 300 форму', 'открой 1С'. It knows both the Kazakh "
            "(1010/1210/3310/6010) and Russian (50/62/60/90) charts of accounts "
            "and detects which one the base uses. It only READS — it never posts, "
            "changes or deletes anything. When no data channel is available it "
            "says exactly what to switch on; read that answer out instead of "
            "guessing. For work that truly needs the interface (проведение "
            "документа, закрытие месяца, печать) use gui_agent instead."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "ask — a question in the accountant's own words; picks the right report itself (DEFAULT, use when unsure) | "
                        "debts — задолженность по контрагентам (side='кредиторская' for payables) | "
                        "osv — оборотно-сальдовая ведомость за период | "
                        "balance — остатки по счетам (role='money'|'taxes_all'|'inventory'…) | "
                        "documents — журнал документов за период | "
                        "checkup — find mistakes: непроведённые, дубли, нулевые суммы, без контрагента, минусы по складу, реализации без счёта-фактуры | "
                        "close_month — checkup plus what must be done by hand before закрытие месяца | "
                        "payroll — зарплатные налоги РК: gross=оклад, или net=сумма на руки для обратного расчёта | "
                        "calendar — сроки сдачи и уплаты (month=1..12) | "
                        "capabilities — what you can do on 1С | "
                        "diagnose — which data channel works and what to switch on | "
                        "launch — start 1С on a base | list_bases | open_base | status | "
                        "sverka — ПОСТРОЧНАЯ сверка поступлений товара с ЭСФ: реквизиты (БИН/дата/номер/ед.изм.), арифметика (кол-во×цена=сумма, сумма×ставка=НДС), ставка и сумма НДС, дубликаты, накладная без ЭСФ и ЭСФ без поступления, и каждая строка по количеству/цене/сумме/НДС с нечётким сопоставлением наименований. Локально и детерминированно. Для 'сверь накладные и ЭСФ', 'проверь поступления', 'всё ли сходится с поставщиком' | "
                        "com_query — raw 1С query | odata_query | export_docs | compare_docs"
                    ),
                },
                "question":  {"type": "STRING", "description": "For action='ask': the accountant's question verbatim, including the period ('дебиторка на конец марта')."},
                "side":      {"type": "STRING", "description": "For action='debts': 'дебиторская' (default) or 'кредиторская'."},
                "role":      {"type": "STRING", "description": "For action='balance': money | taxes_all | inventory | ar_customers | ap_suppliers | payroll_liab | fixed_assets."},
                "gross":     {"type": "NUMBER", "description": "For action='payroll': начисленный оклад."},
                "net":       {"type": "NUMBER", "description": "For action='payroll': желаемая сумма на руки (обратный расчёт оклада)."},
                "regime":    {"type": "STRING", "description": "For action='payroll': 'ОУР' (default) or 'упрощенка'."},
                "month":     {"type": "INTEGER", "description": "For action='calendar': month number 1-12 (default — current)."},
                "base":       {"type": "STRING", "description": "Infobase name as registered in the 1С launcher or in config.onec.bases."},
                "infobase":   {"type": "STRING", "description": "Alias for base."},
                "client":     {"type": "STRING", "description": "thick (default, 1cv8.exe) | thin (1cv8c.exe)."},
                "query":      {"type": "STRING", "description": "1С query text (com_query). Written in 1С query language (Russian keywords)."},
                "params":     {"type": "OBJECT", "description": "Parameters for the 1С query as key→value map."},
                "resource":   {"type": "STRING", "description": "OData resource path, e.g. 'Catalog_Контрагенты?$top=10'."},
                "odata_params": {"type": "OBJECT", "description": "Extra OData query params ($filter, $top, $select…)."},
                "doc_type":   {"type": "STRING", "description": "Metadata name for export_docs (default 'ПоступлениеТоваровУслуг')."},
                "date_from":  {"type": "STRING", "description": "Period start YYYY-MM-DD (export_docs)."},
                "date_to":    {"type": "STRING", "description": "Period end YYYY-MM-DD (export_docs)."},
                "output":     {"type": "STRING", "description": "Output path. For export_docs/compare_docs a .json; for sverka an .xlsx — pass one whenever the user wants the discrepancies as a file or a list (e.g. 'desktop/Сверка.xlsx')."},
                "period_from": {"type": "STRING", "description": "For sverka: period start YYYY-MM-DD."},
                "period_to":   {"type": "STRING", "description": "For sverka: period end YYYY-MM-DD."},
                "left":       {"type": "STRING", "description": "First JSON file path for compare_docs (e.g. delivery notes)."},
                "right":      {"type": "STRING", "description": "Second JSON file path for compare_docs (e.g. e-invoices)."},
                "limit":      {"type": "INTEGER", "description": "Max rows returned by com_query (default 50)."},
            },
            "required": ["action"],
        },
    },
]

# ── Tool-surface tuning ───────────────────────────────────────────────────────
# The native-audio Live model routes best with FEWER, clearly-distinct tools —
# Google's own Live API guidance: "the model performs best on tasks with single
# function calls" and tools must state "under what conditions" to invoke them.
# 30 overlapping tools made it mis-route ("open проводник" / "manage files"
# stalled). These four are either fully subsumed by other tools or outside the
# user's actual use (business / studies / content), so we simply don't OFFER
# them to the model. Their handlers below stay intact — re-enable any tool by
# removing its name from this set (zero other changes needed).
#   • desktop_control  → subsumed by file_controller (+ open_path)
#   • dev_agent        → multi-file coding projects, not this user's use
#   • game_updater     → Steam/Epic management, not this user's use
#   • flight_finder    → flight search, not this user's use
#   • word_control     → REPLACED 2026-08-17 by `office_control`, which covers
#                        Word AND the new Excel module behind one `program`
#                        switch. Word work has started (the boss asked for
#                        "create files in Excel and Word freely"), but exposing
#                        two tools would have meant 31 offered — worse than the
#                        30 that measured as mis-routing — and would have paid
#                        for two near-identical schemas on EVERY turn. One tool
#                        keeps the surface at 30 and the token cost flat.
#   • onec_control     → UN-PARKED 2026-08-13: the 1С accounting demo is the
#                        boss deliverable, so the model MUST be able to route
#                        "открой базу Бухгалтерия" / "сверь накладные и ЭСЧФ" to
#                        the deterministic 1С module instead of blindly launching
#                        1cv8 via open_app. Offered surface is now 29 (< the 30
#                        that measured as causing mis-routing). Re-park after the
#                        accounting work if the surface needs trimming again.
_PARKED_TOOLS = {"desktop_control", "dev_agent", "game_updater", "flight_finder"}
TOOL_DECLARATIONS = [t for t in TOOL_DECLARATIONS if t.get("name") not in _PARKED_TOOLS]

# ── MCP: tools contributed by external servers (config/mcp_servers.json) ─────
# Connects once at import; a missing/disabled config is a no-op and a dead
# server is skipped, so this can never stop JARVIS from starting. The same
# "fewer, distinct tools" rule applies here — mcp_client enforces a hard budget
# so a chatty server can't flood the Live model's tool surface.
try:
    _MCP_REPORT = mcp_client.start()
    _MCP_TOOLS  = mcp_client.tool_declarations()
    if _MCP_TOOLS:
        TOOL_DECLARATIONS += _MCP_TOOLS
    print(f"[MCP] {_MCP_REPORT}")
except Exception as _e:                                    # never fatal
    _MCP_REPORT = f"MCP не запустился: {_e}"
    print(f"[MCP] {_MCP_REPORT}")

# --- Plugin system ---


class JarvisLive:

    def __init__(self, ui: JarvisUI):
        self.ui             = ui
        self._asst_name     = "JARVIS"   # updated each session from config
        self.session              = None
        self.audio_in_queue       = None
        self.out_queue            = None
        self._utterance_queue     = None   # finished mic utterances awaiting gpt-4o-transcribe
        self._loop                = None
        self._is_speaking         = False
        self._speaking_lock       = threading.Lock()
        self._phone_active        = False   # True while phone mic is streaming; pauses PC mic
        self._pending_vision       = None    # (img_bytes, mime_type, question, angle) to inject after tool response
        self._vision_cam_active    = False   # True if camera was opened for vision → auto-close after response
        self._vision_close_pending = False   # True after vision injected; next turn_complete closes camera
        self._vision_last_time     = 0.0     # monotonic time of last screen_process call (cooldown guard)
        self._vision_busy          = False   # True while a vision capture/inject cycle is in flight
        self._gui_agent_busy       = False   # True while the hands-on GUI agent owns mouse+keyboard
        self._recent_calls: dict    = {}     # (tool,args) -> (timestamp, result) — kills repeat loops
        self._interrupted          = False   # True while draining audio after user interrupt
        self._last_workspace       = ""      # index path of the last agent_task workspace (for "open it")
        self.ui.on_text_command   = self._on_text_command
        self.ui.on_remote_clicked = self._make_remote_key
        self.ui.on_interrupt      = self.interrupt
        self._turn_done_event: asyncio.Event | None = None
        self._dashboard     = None
        self._briefing_sent    = False          # morning briefing fires once per process
        self._live_model_idx   = 0              # index into live-model fallback chain
        self._live_fail_streak = 0              # consecutive failures on the CURRENT live model
        # Set when the configured voice backend proves unusable this run (e.g.
        # OpenAI credit exhausted) and we auto-fail-over to the other one. It
        # overrides config for the remainder of the process ONLY — the file is
        # never rewritten, so topping the account up + restarting restores it.
        self._voice_backend_override: str | None = None
        # Session-resumption handle — lets a dropped connection reconnect to the
        # SAME conversation instead of starting cold. Captured from the live
        # stream, replayed into the next connect. See _build_config / run().
        self._resume_handle      = None
        self._used_resume_handle = False
        self._sys_monitor      = SystemMonitor()  # persistent cooldown state
        self._proactive        = ProactiveEngine()
        self._last_user_speech = time.monotonic()  # updated on every user utterance
        self._session_log: list[str] = []          # conversation turns for end-of-session summary
        self._session_started = datetime.now()     # for the measured work-style profile

        # ── Continuous ("always watching") screen vision ────────────────────
        _cfg = _load_cfg()
        self._ambient_enabled          = bool(_cfg.get("ambient_vision_enabled", False))
        self._ambient_interval         = float(_cfg.get("ambient_vision_interval", 2.0))
        self._ambient_pause_speaking   = bool(_cfg.get("ambient_vision_pause_while_speaking", True))
        # Seconds after the user's last utterance during which ambient vision
        # yields the uplink to the voice channel (speed > watching mid-talk).
        self._ambient_convo_grace      = float(_cfg.get("ambient_vision_convo_grace", 4.0))
        self._ambient = AmbientVision(
            max_width    = int(_cfg.get("ambient_vision_max_width", 1024)),
            jpeg_quality = int(_cfg.get("ambient_vision_jpeg_quality", 55)),
            min_diff     = float(_cfg.get("ambient_vision_min_diff", 2.5)),
        )

        # ── Speech-to-text: mic audio is transcribed locally (gpt-4o-transcribe)
        # instead of being streamed to Gemini Live as raw audio — see
        # _listen_audio / _process_utterances. Missing key degrades to "no
        # voice input" rather than crashing startup; logged loudly since it's
        # the primary input channel.
        _openai_key = _get_openai_key()
        if _openai_key:
            try:
                self._stt = OpenAITranscribeSTT(api_key=_openai_key)
            except Exception as _e:
                self._stt = None
                print(f"[STT] Failed to initialize gpt-4o-transcribe: {_e}")
        else:
            self._stt = None
            print("[STT] openai_api_key missing in config/api_keys.json — voice input is disabled.")

    def _make_remote_key(self):
        """Called from Qt main thread when user presses Remote Control."""
        if self._dashboard is None:
            self.ui.write_log(
                "SYS: Dashboard unavailable. "
                "Run: pip install fastapi \"uvicorn[standard]\" cryptography"
            )
            return None
        key    = self._dashboard.new_key()
        url    = self._dashboard.get_url()
        manual = self._dashboard.get_manual_url()
        return url, key, f"{url}/auto-login?key={key}", manual

    def _on_text_command(self, text: str):
        if not self._loop or not self.session:
            # Dropping the message without a word is what made a failed connect
            # feel like a hang: the user types, sees their line echoed by the UI,
            # and nothing ever happens. Say that it was not delivered.
            self.ui.write_log(
                "SYS: Not connected yet — your message was NOT delivered. "
                "Waiting for the voice link to come up…"
            )
            return
        if self._budget_blocked():
            self.ui.write_log("SYS: session budget spent — message NOT sent. Voice is paused.")
            return

        async def _deliver():
            # Печатная команда идёт через тот же локальный маршрутизатор, что и
            # голосовая: набранное «сверь поступления» должно срабатывать так же
            # надёжно, как сказанное.
            if await self._try_route_locally(text):
                return
            await self.session.send_client_content(
                turns={"parts": [{"text": text}]}, turn_complete=True)

        asyncio.run_coroutine_threadsafe(_deliver(), self._loop)

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        elif not self.ui.muted:
            self.ui.set_state("LISTENING")

    def interrupt(self) -> None:
        """Stop JARVIS mid-speech: drain queued audio and open mic immediately."""
        self._interrupted = True
        q = self.audio_in_queue
        if q:
            drained = 0
            while True:
                try:
                    q.get_nowait()
                    drained += 1
                except Exception:
                    break
            if drained:
                print(f"[JARVIS] ✋ Interrupted — {drained} audio chunks discarded")
        self.set_speaking(False)
        if self._turn_done_event:
            self._turn_done_event.clear()
        self.ui.write_log("SYS: Interrupted — listening...")

    def speak(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    def speak_error(self, tool_name: str, error: str):
        short = str(error)[:120]
        self.ui.write_log(f"ERR: {tool_name} — {short}")
        self.speak(f"Sir, {tool_name} encountered an error. {short}")

    def _build_config(self) -> types.LiveConnectConfig:
        from datetime import datetime

        # Load customization from config
        try:
            _cfg = json.loads(open(API_CONFIG_PATH, encoding="utf-8").read())
            self._asst_name = (_cfg.get("assistant_name") or "JARVIS").strip()
            _user_name = (_cfg.get("user_name") or "").strip()
        except Exception:
            self._asst_name = "JARVIS"
            _user_name = ""

        memory     = load_memory()
        mem_str    = format_memory_for_prompt(memory)
        sys_prompt = _load_system_prompt()

        # Preferred language — config override wins, else remembered identity.language.
        _lang_entry = memory.get("identity", {}).get("language", {})
        _mem_lang   = (_lang_entry.get("value", "") if isinstance(_lang_entry, dict) else str(_lang_entry)).strip()
        _pref_lang  = get_preferred_language() or _mem_lang

        now      = datetime.now()
        time_str = now.strftime("%A, %B %d, %Y — %I:%M %p")
        time_ctx = (
            f"[CURRENT DATE & TIME]\n"
            f"Right now it is: {time_str}\n"
            f"Use this to calculate exact times for reminders.\n\n"
        )

        # Hard language lock — applies to EVERY turn (not just the briefing), so the
        # assistant never drifts back to English mid-session or between launches.
        lang_ctx = ""
        if _pref_lang:
            lang_ctx = (
                f"[LANGUAGE]\n"
                f"ALWAYS speak to the user in {_pref_lang}, in every single response, "
                f"unless the user explicitly switches language themselves. "
                f"Never default to English on your own.\n\n"
            )

        # Identity injection — overrides any hardcoded name in prompt.txt
        if _user_name:
            _addr = f"ADDRESS: Always call the user '{_user_name}'."
        else:
            _addr = (
                "ADDRESS: Address the user naturally in their own language "
                "(Turkish → 'efendim', English → 'sir'; Kazakh or Russian → no forced "
                "honorific). Never mix two languages inside one reply."
            )
        identity_ctx = (
            f"[IDENTITY]\n"
            f"Your name is {self._asst_name}. "
            f"Always refer to yourself as {self._asst_name}.\n"
            f"{_addr}\n\n"
        )

        parts = [time_ctx, identity_ctx]
        if lang_ctx:
            parts.append(lang_ctx)
        if mem_str:
            parts.append(mem_str)
        # Living Memory — JARVIS opens the session already knowing the user's
        # world (active projects, current focus, open loops). Best-effort.
        try:
            mind_ctx = mind.format_for_prompt()
            if mind_ctx:
                parts.append(mind_ctx)
        except Exception as _e:
            print(f"[Mind] context injection skipped: {_e}")
        # Work Style — measured, not guessed: when they work, how they phrase
        # things, what they actually use. Silent until the evidence is real.
        try:
            style_ctx = work_style.format_for_prompt()
            if style_ctx:
                parts.append(style_ctx)
        except Exception as _e:
            print(f"[WorkStyle] context injection skipped: {_e}")
        parts.append(sys_prompt)

        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription={},
            # No input_audio_transcription — mic audio is no longer streamed to
            # Gemini as realtime input; see _listen_audio / _process_utterances.
            system_instruction="\n".join(parts),
            tools=[{"function_declarations": TOOL_DECLARATIONS}],
            # Replay the resumption handle so a reconnect resumes THIS conversation
            # (handle=None on a cold start behaves exactly like a fresh session).
            session_resumption=types.SessionResumptionConfig(handle=self._resume_handle),
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Charon"
                    )
                )
            ),
        )

    async def _execute_tool(self, fc) -> types.FunctionResponse:
        name = fc.name
        args = dict(fc.args or {})

        print(f"[JARVIS] 🔧 {name}  {args}")
        self.ui.set_state("THINKING")
        # Which tools the user REALLY reaches for — counted in memory, flushed
        # at session end. Feeds the measured work-style profile.
        work_style.record_tool(name)

        # ── Repeat guard ────────────────────────────────────────────────────
        # Observed twice (2026-08-11 and again 2026-08-12 AFTER prompt.txt was
        # rewritten to forbid it): the model re-issues a byte-identical call
        # that just failed, gets the identical answer, and loops. A prompt rule
        # is not enforcement — this is. Repeating an identical call inside the
        # window cannot produce new information, so we answer from the cache
        # and tell the model plainly to change approach.
        _sig = f"{name}:{json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)}"
        _now = time.monotonic()
        if name not in _REPEATABLE_TOOLS:
            _prev = self._recent_calls.get(_sig)
            if _prev and (_now - _prev[0]) < _REPEAT_WINDOW_S:
                print(f"[JARVIS] ⛔ repeat of a call made {_now - _prev[0]:.0f}s ago — not re-running")
                if not self.ui.muted:
                    self.ui.set_state("LISTENING")
                return types.FunctionResponse(
                    id=fc.id, name=name,
                    response={"result": (
                        f"You ALREADY called {name} with these exact arguments moments ago "
                        f"and the result was: {str(_prev[1])[:400]}\n"
                        "Calling it again cannot change anything. Do something DIFFERENT: "
                        "fix the arguments using any names the previous result suggested, "
                        "try a different tool, or ask the user for the exact name/path."
                    )},
                )
            # Prune so the map can't grow without bound over a long session.
            if len(self._recent_calls) > 64:
                cutoff = _now - _REPEAT_WINDOW_S
                self._recent_calls = {k: v for k, v in self._recent_calls.items()
                                      if v[0] > cutoff}

        if name == "save_memory":
            category = args.get("category", "notes")
            key      = args.get("key", "")
            value    = args.get("value", "")
            if key and value:
                update_memory({category: {key: {"value": value}}})
                print(f"[Memory] 💾 save_memory: {category}/{key} = {value}")
                # Mirror into the semantic brain (fire-and-forget) so it's recallable forever.
                try:
                    asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: brain.remember(
                            f"{key.replace('_', ' ')}: {value}", "fact",
                            source="memory", ref=f"{category}/{key}",
                        ),
                    )
                except Exception:
                    pass
                # Mirror durable prefs to config so they survive the memory size-cap
                # trim and are applied deterministically at every startup.
                try:
                    if category == "identity" and key == "language":
                        save_preferred_language(value)
                    elif category == "preferences" and key in ("daily_news", "morning_news", "news"):
                        _off = str(value).strip().lower() in ("off", "no", "false", "0", "disable", "disabled", "stop", "none")
                        save_news_enabled(not _off)
                except Exception as _e:
                    print(f"[Config] pref mirror failed: {_e}")
            if not self.ui.muted:
                self.ui.set_state("LISTENING")
            return types.FunctionResponse(
                id=fc.id, name=name,
                response={"result": "ok", "silent": True}
            )

        loop   = asyncio.get_event_loop()
        result = "Done."

        try:
            if name == "open_app":
                r = await loop.run_in_executor(None, lambda: open_app(parameters=args, response=None, player=self.ui))
                result = r or f"Opened {args.get('app_name')}."

            elif name == "run_command":
                r = await loop.run_in_executor(None, lambda: run_command_action(parameters=args, player=self.ui))
                result = r or "Command finished."

            elif name == "open_path":
                r = await loop.run_in_executor(None, lambda: open_path_action(parameters=args, player=self.ui))
                result = r or f"Opened {args.get('path')}."

            elif name == "weather_report":
                r = await loop.run_in_executor(None, lambda: weather_action(parameters=args, player=self.ui))
                result = r or "Weather delivered."

            elif name == "browser_control":
                r = await loop.run_in_executor(None, lambda: browser_control(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "file_controller":
                r = await loop.run_in_executor(None, lambda: file_controller(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "send_message":
                r = await loop.run_in_executor(None, lambda: send_message(parameters=args, response=None, player=self.ui, session_memory=None))
                result = r or "I could not confirm the message was sent — please verify it was delivered."

            elif name == "reminder":
                r = await loop.run_in_executor(None, lambda: reminder(parameters=args, response=None, player=self.ui))
                result = r or "Reminder set."

            elif name == "youtube_video":
                r = await loop.run_in_executor(None, lambda: youtube_video(parameters=args, response=None, player=self.ui))
                result = r or "Done."

            elif name == "screen_process":
                import time as _t_mod
                _now = _t_mod.monotonic()
                _cooldown = 4.0  # seconds — covers echo window after speaking ends
                if self._vision_busy or (_now - self._vision_last_time) < _cooldown:
                    _wait = max(0, _cooldown - (_now - self._vision_last_time))
                    print(f"[Vision] ⏳ Cooldown active ({_wait:.1f}s remaining) — ignoring duplicate call")
                    result = "Vision is still processing the previous request. I will not call this again."
                else:
                    self._vision_busy      = True
                    self._vision_last_time = _now
                    angle     = args.get("angle", "screen").lower()
                    user_text = args.get("text", "What do you see?")
                    if angle == "camera":
                        img_b, mime_t = await loop.run_in_executor(None, _capture_camera)
                        self.ui.start_camera_stream()
                        self._vision_cam_active = True
                        print(f"[Vision] 📷 Camera: {len(img_b):,} bytes")
                        _stall = "camera"
                    else:
                        img_b, mime_t = await loop.run_in_executor(None, _capture_screen)
                        print(f"[Vision] 🖥️  Screen: {len(img_b):,} bytes")
                        _stall = "screen"
                    self._pending_vision = (img_b, mime_t, user_text, angle)
                    result = (
                        f"[VISION_ACTIVE] {_stall.capitalize()} captured. "
                        f"Immediately say ONE short natural sentence in the user's own language, "
                        f"telling them you are looking at their {_stall} right now. "
                        f"Do NOT describe or guess content — the actual image arrives in the NEXT message."
                    )

            elif name == "close_camera":
                self.ui.stop_camera_stream()
                result = "Camera closed."

            elif name == "computer_settings":
                r = await loop.run_in_executor(None, lambda: computer_settings(parameters=args, response=None, player=self.ui))
                result = r or "Done."

            elif name == "desktop_control":
                r = await loop.run_in_executor(None, lambda: desktop_control(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "code_helper":
                r = await loop.run_in_executor(None, lambda: code_helper(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Done."

            elif name == "dev_agent":
                r = await loop.run_in_executor(None, lambda: dev_agent(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Done."

            elif name == "web_search":
                r = await loop.run_in_executor(None, lambda: web_search_action(parameters=args, player=self.ui))
                result = r or "Done."
                # Mirror results to the on-screen content panel
                _mode = args.get("mode", "search")
                if r and not r.startswith("No results") and not r.startswith("Search failed"):
                    _query = args.get("query") or ", ".join(args.get("items", []))
                    _label = f"{_mode.upper()} — {_query[:38]}" if _query else _mode.upper()
                    self.ui.show_content(_label, r)
            elif name == "file_processor":
                if not args.get("file_path") and self.ui.current_file:
                    args["file_path"] = self.ui.current_file
                r = await loop.run_in_executor(
                    None,
                    lambda: file_processor(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "Done."

            elif name == "computer_control":
                r = await loop.run_in_executor(None, lambda: computer_control(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "game_updater":
                r = await loop.run_in_executor(None, lambda: game_updater(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Done."

            elif name == "flight_finder":
                r = await loop.run_in_executor(None, lambda: flight_finder(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "system_status":
                r = await loop.run_in_executor(None, get_system_status)
                result = str(r)

            elif name == "manage_monitor":
                action = args.get("action", "").lower().strip()
                topic  = args.get("topic", "").strip()
                if action == "add" and topic:
                    result = await asyncio.to_thread(add_monitor, topic)
                elif action == "remove" and topic:
                    result = await asyncio.to_thread(remove_monitor, topic)
                elif action == "list":
                    topics = await asyncio.to_thread(list_monitors)
                    result = ("Monitoring: " + ", ".join(topics)) if topics else "No topics are being monitored."
                else:
                    result = "Specify action (add/remove/list) and a topic."

            elif name == "obsidian_note":
                # Silent background write to the vault — never opens or focuses Obsidian.
                r = await loop.run_in_executor(
                    None, lambda: obsidian_note(parameters=args, player=self.ui)
                )
                result = r or "Saved to Obsidian."
                # Mirror the captured text into the semantic brain so it's recallable by meaning.
                _act = (args.get("action") or "capture").lower().strip()
                _content = (args.get("content") or args.get("text") or "").strip()
                if _content and _act in ("capture", "create", "daily", "new", "overwrite"):
                    _title = (args.get("title") or "").strip()
                    _txt = f"{_title}\n{_content}" if _title else _content
                    loop.run_in_executor(
                        None,
                        lambda: brain.remember(
                            _txt, "note", source="capture",
                            ref=f"obsidian:{_title or 'Inbox'}",
                        ),
                    )

            elif name == "ambient_vision":
                act = (args.get("action") or "status").lower().strip()
                if act in ("on", "start", "enable", "resume", "watch"):
                    self._ambient_enabled = True
                    self._ambient.reset()
                    result = "Continuous screen vision is on — I'm watching your screen now."
                elif act in ("off", "stop", "disable", "pause"):
                    self._ambient_enabled = False
                    result = "Continuous screen vision is off."
                else:
                    result = f"Continuous screen vision is currently {'on' if self._ambient_enabled else 'off'}."

            elif name == "deep_think":
                q   = (args.get("question") or "").strip()
                ctx = (args.get("context") or "").strip()
                if not q:
                    result = "deep_think needs a question."
                else:
                    def _think():
                        mem = ""
                        try:
                            if brain.is_available():
                                mem = brain.recall_as_text(q, 4) or ""
                        except Exception:
                            pass
                        who = ""
                        try:
                            who = mind.advisor_context()
                        except Exception:
                            pass
                        parts = [f"Question: {q}"]
                        if ctx:
                            parts.append(f"Context from the conversation: {ctx}")
                        if who:
                            parts.append(who)
                        if mem:
                            parts.append(f"Possibly relevant long-term memory:\n{mem}")
                        parts.append(
                            "Think it through and answer in the SAME language as the "
                            "question. Be a sharp PERSONAL advisor who knows this "
                            "specific person: tie the advice to their real projects, "
                            "goals and constraints above. Give a concrete "
                            "recommendation, the key trade-offs, and the real risks — "
                            "not generic textbook points. Structured but compact "
                            "(≤300 words unless more is genuinely needed)."
                        )
                        return model_router.generate(
                            "\n\n".join(parts),
                            system=("You are JARVIS's deep-reasoning core — the "
                                    "user's sharp, honest personal strategist. "
                                    "Specific, grounded in THEIR situation, never watery."),
                            tier="deep", max_tokens=2000,
                        )
                    try:
                        res = await loop.run_in_executor(None, _think)
                        self.ui.show_content(f"DEEP THINK — {q[:40]}", res.text)
                        result = (
                            f"[DEEP_ANALYSIS by {res.provider}]\n{res.text}\n\n"
                            "Deliver this analysis to the user naturally in their "
                            "language — the key points and recommendation, not a "
                            "word-for-word read-out. The full text is on screen."
                        )
                    except Exception as e:
                        result = (f"Deep reasoning backends unavailable ({e}). "
                                  "Answer from your own knowledge and honestly "
                                  "mention you couldn't run deep analysis.")

            elif name == "deep_research":
                q = (args.get("query") or "").strip()
                if not q:
                    result = "Ask the user what topic to research."
                else:
                    asyncio.create_task(self._run_deep_research(dict(args)))
                    result = (
                        f"Deep research on '{q}' started in the background. "
                        "Tell the user in ONE short sentence that you are on it and "
                        "will report in a minute or two. The findings arrive "
                        "automatically — do NOT call deep_research again for this."
                    )

            elif name == "agent_task":
                goal = (args.get("goal") or args.get("task") or "").strip()
                if not goal:
                    result = "What should I build in your vault?"
                else:
                    asyncio.create_task(self._run_agent_task(dict(args)))
                    folder = (args.get("folder") or "").strip()
                    where = f" '{folder}'" if folder else ""
                    result = (
                        f"Building the{where} workspace in the vault now. Tell the "
                        "user in ONE short, natural sentence that you're setting it "
                        "up and it'll be ready in a few seconds. It finishes "
                        "automatically and you'll report back — do NOT call "
                        "agent_task again for this request."
                    )

            elif name == "delegate_task":
                goal = (args.get("goal") or args.get("task") or "").strip()
                if not goal:
                    result = "What task should I take on?"
                else:
                    asyncio.create_task(self._run_delegate_task(dict(args)))
                    result = (
                        "Taking that on now — tell the user in ONE short natural "
                        "sentence that you're working on it and will report back "
                        "shortly. It finishes automatically; do NOT call "
                        "delegate_task again for this."
                    )

            elif name == "recall_memory":
                q     = (args.get("query") or "").strip()
                scope = (args.get("scope") or "all").lower().strip()
                _kinds = {
                    "facts": ["fact"], "fact": ["fact"],
                    "sessions": ["episode"], "session": ["episode"], "episodes": ["episode"],
                    "notes": ["note"], "note": ["note"], "vault": ["note"],
                }.get(scope)
                if not q:
                    result = "Tell me what to recall."
                else:
                    text = await loop.run_in_executor(
                        None, lambda: brain.recall_as_text(q, 6, _kinds)
                    )
                    if text:
                        result = text
                        self.ui.show_content(f"MEMORY — {q[:38]}", text)
                    else:
                        result = ("Nothing in long-term memory matches that yet. "
                                  "Answer from the current context or say you don't have it stored.")

            elif name == "gui_agent":
                goal = (args.get("goal") or "").strip()
                _mode = str(args.get("mode") or "do").strip().lower()
                _is_demo = _mode in ("demo", "tour", "teach", "presentation") or _gui_looks_like_demo(goal)
                if not goal and not _is_demo:
                    # A do-a-job run needs a concrete goal; a demo tour does not.
                    result = "What exactly should I do on screen? Ask the user for the concrete goal."
                elif self._gui_agent_busy:
                    # Observed live 2026-08-11: the Live model called gui_agent
                    # TWICE for one request despite the prompt saying "call once",
                    # putting two loops on the same mouse — they overwrite each
                    # other's clicks and both planners see a screen the other
                    # changed. Prompt rules are not enforcement; this is.
                    # (Same lesson as _vision_busy for screen_process.)
                    print("[Agent] ⛔ duplicate gui_agent call ignored — one is already running")
                    result = (
                        "You are ALREADY doing this on screen right now — a second "
                        "hands-on agent was NOT started. Do not call gui_agent again. "
                        "Stay quiet and wait for the [AGENT_PROGRESS]/[AGENT_DONE] "
                        "messages, which arrive on their own."
                    )
                else:
                    self._gui_agent_busy = True
                    asyncio.create_task(self._run_gui_agent(dict(args)))
                    if _is_demo:
                        result = (
                            "Guided-tour agent engaged — I am taking the mouse "
                            "now and will walk the user through the program "
                            "myself, explaining as I go. Tell the user in ONE "
                            "short natural sentence that you're starting the tour "
                            "and they should watch the screen. The explanations "
                            "then arrive on their own as [AGENT_TEACH] messages — "
                            "do NOT call gui_agent again, and do NOT pre-explain "
                            "the whole program yourself meanwhile."
                        )
                    else:
                        result = (
                            "Hands-on agent engaged — I am taking the mouse and "
                            "keyboard now. Tell the user in ONE short natural "
                            "sentence that you're doing it yourself right now and "
                            "they can watch. Progress and the final outcome arrive "
                            "automatically as [AGENT_PROGRESS]/[AGENT_DONE] — do "
                            "NOT call gui_agent again for this request, do NOT "
                            "guide the user manually meanwhile."
                        )

            elif name in ("office_control", "word_control", "excel_control"):
                # One handler for all three names: office_control routes to Word
                # or Excel, and the two legacy names still work if the model (or
                # an older prompt) reaches for them directly.
                _p = dict(args or {})
                if name == "word_control":
                    _p.setdefault("program", "word")
                elif name == "excel_control":
                    _p.setdefault("program", "excel")
                r = await loop.run_in_executor(None, lambda: office_control(parameters=_p, player=self.ui))
                result = r or "Done."

            elif name == "onec_control":
                r = await loop.run_in_executor(None, lambda: onec_control(parameters=args, player=self.ui))
                result = r or "Готово."

            elif name == "shutdown_jarvis":
                self.ui.write_log("SYS: Shutdown requested.")
                async def _do_shutdown():
                    await self._save_session_summary()
                    if self.session:
                        try:
                            await self.session.send_client_content(
                                turns={"parts": [{"text": "Say a brief natural goodbye to the user."}]},
                                turn_complete=True,
                            )
                        except Exception:
                            pass
                    await asyncio.sleep(1.5)
                    import os as _os
                    _os._exit(0)
                asyncio.create_task(_do_shutdown())

            elif mcp_client.is_mcp_tool(name):
                # Contributed by an external MCP server. Runs in an executor so
                # a slow server can never stall the live audio loop.
                r = await loop.run_in_executor(None, lambda: mcp_client.call(name, args))
                result = r or "Готово."

            else:
                result = f"Unknown tool: {name}"

        except Exception as e:
            result = f"Tool '{name}' failed: {e}"
            traceback.print_exc()
            self.speak_error(name, e)

        if not self.ui.muted:
            self.ui.set_state("LISTENING")

        print(f"[JARVIS] 📤 {name} → {str(result)[:80]}")
        if name not in _REPEATABLE_TOOLS:
            self._recent_calls[_sig] = (time.monotonic(), result)
        return types.FunctionResponse(
            id=fc.id, name=name,
            response={"result": result}
        )

    async def _run_deep_research(self, args: dict) -> None:
        """Run the research pipeline off the hot path and inject the result
        into the live session when it is ready (waiting for a quiet moment)."""
        loop = asyncio.get_event_loop()
        try:
            outcome = await loop.run_in_executor(
                None, lambda: deep_research_action(parameters=args, player=self.ui)
            )
        except Exception as e:
            traceback.print_exc()
            outcome = (f"Deep research failed: {e}. "
                       "Tell the user briefly in their language.")
        # Don't talk over an active exchange — wait for silence (max 60 s).
        for _ in range(60):
            with self._speaking_lock:
                speaking = self._is_speaking
            if not speaking:
                break
            await asyncio.sleep(1.0)
        if self.session:
            try:
                await self.session.send_client_content(
                    turns={"parts": [{"text": outcome}]},
                    turn_complete=True,
                )
                self.ui.write_log("SYS: Research report delivered.")
            except Exception as e:
                print(f"[Research] could not deliver result: {e}")

    async def _run_agent_task(self, args: dict) -> None:
        """Build a structured Obsidian workspace off the hot path, then report
        back into the live session and offer to open it. Mirrors the deep_research
        pattern so the slow live model never blocks on the build."""
        loop = asyncio.get_event_loop()
        goal   = (args.get("goal") or args.get("task") or "").strip()
        folder = (args.get("folder") or "").strip() or None
        lang   = (args.get("language") or "").strip() or None
        depth  = (args.get("depth") or "fast").strip()
        kind   = (args.get("kind") or "auto").strip()
        try:
            res = await loop.run_in_executor(
                None,
                lambda: agent_task_mod.run(goal, folder=folder, language=lang,
                                           depth=depth, kind=kind),
            )
        except Exception as e:
            traceback.print_exc()
            res = {"ok": False, "errors": [str(e)], "created": [], "count": 0,
                   "folder": folder or "", "index_path": ""}

        if res.get("ok"):
            # Remember the index so a follow-up "yes, open it" is unambiguous.
            self._last_workspace = res.get("index_path") or ""
            titles = [p.split("/")[-1] for p in res.get("created", [])
                      if "Overview" not in p]
            kind_word = "project workspace" if res.get("kind") == "project" else "workspace"
            outcome = (
                f"[WORKSPACE_READY] Built the '{res.get('folder')}' {kind_word} in the "
                f"vault: an overview note plus {len(titles)} notes "
                f"({', '.join(titles[:8])}). Tell the user in their language, in ONE "
                f"or two short natural sentences, that it's ready and what's inside, "
                f"then ASK if they'd like you to open it in Obsidian. Do NOT open it "
                f"yourself yet — wait for them to say yes. The index note path is "
                f"'{res.get('index_path')}'."
            )
        else:
            errs = "; ".join(res.get("errors", [])[:2]) or "unknown error"
            outcome = (
                f"[WORKSPACE_FAILED] I couldn't build the workspace ({errs}). Tell "
                f"the user briefly and naturally in their language, and offer to try "
                f"again or save a single note instead."
            )

        # Wait for a quiet moment so we don't talk over the user (max 60 s).
        for _ in range(60):
            with self._speaking_lock:
                speaking = self._is_speaking
            if not speaking:
                break
            await asyncio.sleep(1.0)
        if self.session:
            try:
                await self.session.send_client_content(
                    turns={"parts": [{"text": outcome}]},
                    turn_complete=True,
                )
                self.ui.write_log(f"SYS: Workspace '{res.get('folder','')}' delivered.")
            except Exception as e:
                print(f"[AgentTask] could not deliver result: {e}")

    async def _run_gui_agent(self, args: dict) -> None:
        """Run the hands-on GUI agent off the hot path. Milestone narration is
        injected live ([AGENT_PROGRESS]); the final outcome waits for a quiet
        moment ([AGENT_DONE]/[AGENT_FAILED]). Mirrors _run_delegate_task."""
        loop = asyncio.get_event_loop()
        _mode = str(args.get("mode") or "do").strip().lower()
        _is_demo = _mode in ("demo", "tour", "teach", "presentation") or _gui_looks_like_demo(args.get("goal") or "")

        def _notify(text: str) -> None:
            """Called from the worker thread on each narrated step — speak it live.
            In demo mode this is a teaching explanation (speak it in full); in
            do mode it's a milestone (one short sentence)."""
            if not self.session or not self._loop:
                return
            if _is_demo:
                msg = (
                    f"[AGENT_TEACH] {text} — say this to the user out loud in "
                    f"their language, clearly and warmly, like a teacher giving "
                    f"a hands-on tour (2-4 natural sentences, don't compress it "
                    f"to one line). Then stay quiet and keep watching the screen."
                )
            else:
                msg = (
                    f"[AGENT_PROGRESS] {text} — say this progress update out loud "
                    f"in ONE short sentence in the user's language, naturally, "
                    f"then stay quiet and keep waiting."
                )
            try:
                asyncio.run_coroutine_threadsafe(
                    self.session.send_client_content(
                        turns={"parts": [{"text": msg}]}, turn_complete=True),
                    self._loop,
                )
            except Exception as e:
                print(f"[Agent] notify failed: {e}")

        try:
            outcome_raw = await loop.run_in_executor(
                None, lambda: gui_agent_action(parameters=args, player=self.ui,
                                               notify=_notify))
        except Exception as e:
            traceback.print_exc()
            outcome_raw = f"[FAIL] Агент упал с ошибкой: {e}"
        finally:
            # Release the mouse claim on EVERY path (done / failed / crashed),
            # otherwise one bad run would block hands-on mode for the session.
            self._gui_agent_busy = False

        if outcome_raw.startswith("[DONE]"):
            outcome = (
                f"[AGENT_DONE] {outcome_raw[6:].strip()} Tell the user in their "
                f"language, briefly and naturally, what you accomplished."
            )
        elif outcome_raw.startswith("[ABORTED]"):
            outcome = (
                f"[AGENT_DONE] {outcome_raw} Acknowledge briefly that you "
                f"stopped because the user took over the mouse."
            )
        else:
            outcome = (
                f"[AGENT_FAILED] {outcome_raw} Tell the user honestly in their "
                f"language what stopped you and what you need from them to "
                f"continue (e.g. log into the base, open the right window)."
            )

        # Wait for a quiet moment so the report doesn't talk over the user.
        for _ in range(60):
            with self._speaking_lock:
                speaking = self._is_speaking
            if not speaking:
                break
            await asyncio.sleep(1.0)
        if self.session:
            try:
                await self.session.send_client_content(
                    turns={"parts": [{"text": outcome}]},
                    turn_complete=True,
                )
                self.ui.write_log("SYS: GUI agent finished.")
            except Exception as e:
                print(f"[Agent] could not deliver result: {e}")

    async def _run_delegate_task(self, args: dict) -> None:
        """Do a delegated open-ended task in the background (plan → research →
        reason → deliverable in the vault), then report what needs deciding.
        Mirrors _run_agent_task so the slow work never blocks the voice loop."""
        loop = asyncio.get_event_loop()
        goal = (args.get("goal") or args.get("task") or "").strip()
        lang = (args.get("language") or "").strip()
        try:
            res = await loop.run_in_executor(
                None, lambda: background_agent_mod.run(goal, language=lang))
        except Exception as e:
            traceback.print_exc()
            res = {"ok": False, "errors": [str(e)]}

        if res.get("ok"):
            self._last_workspace = res.get("path") or ""
            dps = res.get("decision_points") or []
            dp_txt = (" Decisions that need them: " + " | ".join(dps)) if dps else ""
            outcome = (
                f"[TASK_DONE] I finished the delegated task '{res.get('title')}'. "
                f"{res.get('summary','')} It's saved in the vault at "
                f"'{res.get('path')}'.{dp_txt} Tell the user in their language, "
                f"warmly and briefly, what you did and walk them through the "
                f"decisions they need to make, then offer to open it in Obsidian."
            )
        else:
            errs = "; ".join(res.get("errors", [])[:2]) or "unknown error"
            outcome = (f"[TASK_FAILED] I couldn't finish that task ({errs}). Tell the "
                       f"user briefly and honestly and offer to try a smaller piece.")

        for _ in range(90):              # wait for a quiet moment (bg work can be long)
            with self._speaking_lock:
                speaking = self._is_speaking
            if not speaking:
                break
            await asyncio.sleep(1.0)
        if self.session:
            try:
                await self.session.send_client_content(
                    turns={"parts": [{"text": outcome}]},
                    turn_complete=True,
                )
                self.ui.write_log(f"SYS: Delegated task '{res.get('title','')}' delivered.")
            except Exception as e:
                print(f"[Delegate] could not deliver result: {e}")

    async def _run_tool_calls(self, fcs: list) -> None:
        """Execute a batch of tool calls in PARALLEL, off the receive loop.

        Why: running tools inline in _receive_audio blocked all incoming
        audio/events until the tool finished — a slow tool froze the whole
        conversation. Now audio keeps flowing and the user can keep talking
        or interrupt while tools work.
        """
        try:
            frs = await asyncio.gather(*(self._execute_tool(fc) for fc in fcs))
            if self.session:
                await self.session.send_tool_response(function_responses=list(frs))
        except Exception as e:
            print(f"[JARVIS] ❌ tool batch failed: {e}")
            traceback.print_exc()

    async def _send_realtime(self):
        while True:
            msg = await self.out_queue.get()
            await self.session.send_realtime_input(media=msg)

    async def _listen_audio(self):
        """Capture mic audio and locally detect utterance boundaries (adaptive
        energy-based VAD). Finished utterances go to _utterance_queue for
        gpt-4o-transcribe — raw audio is no longer streamed to Gemini Live
        (that path, out_queue/_send_realtime, is now vision-frames-only)."""
        print("[JARVIS] 🎤 Mic started")
        loop = asyncio.get_event_loop()

        # VAD is tunable from config/api_keys.json (vad_*). Defaults below.
        _vcfg = _load_cfg()
        SPEECH_MULT   = float(_vcfg.get("vad_speech_mult",   3.0))    # trigger when RMS > noise_floor * this
        MIN_THRESHOLD = float(_vcfg.get("vad_min_threshold", 250.0))  # floor so a silent room can't false-trigger
        # Trailing silence before an utterance closes. 0.7 s cut the user off in
        # mid-sentence during natural thinking/breathing pauses; 1.1 s tolerates
        # them while still feeling responsive. Raise it if you still get clipped.
        HANGOVER_S    = float(_vcfg.get("vad_hangover_s",    1.1))
        MIN_UTTER_S   = float(_vcfg.get("vad_min_utter_s",   0.3))    # discard shorter blips (coughs, clicks)
        MAX_UTTER_S   = float(_vcfg.get("vad_max_utter_s",  20.0))    # hard cap so a stuck-open mic can't buffer forever

        state = {
            "buf": bytearray(),
            "in_speech": False,
            "silence_since": None,
            "noise_floor": 300.0,   # adaptive EMA of ambient RMS
            "speech_start": None,
        }

        def _rms(pcm: bytes) -> float:
            arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
            return float(np.sqrt(np.mean(arr * arr))) if arr.size else 0.0

        def callback(indata, frames, time_info, status):
            with self._speaking_lock:
                jarvis_speaking = self._is_speaking
            if jarvis_speaking or self.ui.muted or self._phone_active:
                # Not listening right now — drop any in-progress utterance cleanly.
                if state["in_speech"]:
                    state["buf"] = bytearray()
                    state["in_speech"] = False
                    state["silence_since"] = None
                return

            data  = indata.tobytes()
            level = _rms(data)
            now   = time.monotonic()
            threshold = max(state["noise_floor"] * SPEECH_MULT, MIN_THRESHOLD)

            if state["in_speech"]:
                state["buf"] += data
                if level > threshold:
                    state["silence_since"] = None
                else:
                    if state["silence_since"] is None:
                        state["silence_since"] = now
                    elif now - state["silence_since"] >= HANGOVER_S:
                        duration = now - state["speech_start"]
                        utter = bytes(state["buf"])
                        state["buf"] = bytearray()
                        state["in_speech"] = False
                        state["silence_since"] = None
                        if duration >= MIN_UTTER_S and self._utterance_queue is not None:
                            loop.call_soon_threadsafe(self._utterance_queue.put_nowait, utter)
                if state["in_speech"] and now - state["speech_start"] >= MAX_UTTER_S:
                    utter = bytes(state["buf"])
                    state["buf"] = bytearray()
                    state["silence_since"] = None
                    state["speech_start"] = now
                    if self._utterance_queue is not None:
                        loop.call_soon_threadsafe(self._utterance_queue.put_nowait, utter)
            else:
                state["noise_floor"] = 0.98 * state["noise_floor"] + 0.02 * level
                if level > threshold:
                    state["in_speech"]     = True
                    state["speech_start"]  = now
                    state["buf"]           = bytearray(data)
                    state["silence_since"] = None

        try:
            with sd.InputStream(
                samplerate=SEND_SAMPLE_RATE,
                channels=CHANNELS,
                dtype="int16",
                blocksize=CHUNK_SIZE,
                callback=callback,
            ):
                print("[JARVIS] 🎤 Mic stream open")
                while True:
                    await asyncio.sleep(0.1)
        except Exception as e:
            # No usable INPUT device (mic absent/busy, PortAudio/MME error).
            # Degrade gracefully — the assistant still runs via dashboard/text —
            # instead of tearing the whole TaskGroup down.
            print(f"[JARVIS] ❌ Mic: {e}")
            try:
                self.ui.write_log("SYS: Voice input disabled — no usable microphone.")
            except Exception:
                pass
            return

    async def _try_route_locally(self, text: str) -> bool:
        """Выполнить однозначную команду В КОДЕ, минуя решение модели.

        Замерено 2026-08-17: на байт-идентичном конфиге доля команд, дошедших до
        инструмента, гуляла 25%–94%. Модель то вызывает функцию, то просто
        говорит «начинаю сверку» — а один раз сообщила, что создала файл,
        которого нет. Промптом это не чинится: запрет на такое поведение лежит в
        prompt.txt с 2026-08-14 и нарушался в каждом прогоне.

        Здесь модель перестаёт РЕШАТЬ и начинает РАССКАЗЫВАТЬ: инструмент
        вызывает код (всегда), а модель получает готовый результат и озвучивает
        его своим голосом. Пересказать готовый факт она не проваливала ни разу.
        Побочно пропадает круг обращения к модели — команда срабатывает быстрее.

        Возвращает True, если фраза обработана здесь. False — обычный путь.
        """
        if not _load_cfg().get("intent_router_enabled", True):
            return False
        try:
            routed = intent_router.match(text)
        except Exception as e:
            print(f"[Router] сопоставление не удалось ({e}) — отдаю модели.")
            return False
        if routed is None:
            return False

        print(f"[Router] ⚡ {intent_router.describe(routed)}")
        self.ui.write_log(f"SYS: команда распознана локально → {routed.tool}")
        self.ui.set_state("THINKING")

        # Тот же путь, что и у вызова от модели: повторный guard, логи, парковка
        # инструментов — всё уже работает в _execute_tool, дублировать нельзя.
        class _Call:
            def __init__(self, name, args):
                self.name, self.args, self.id = name, args, f"router-{name}"

        try:
            fr = await self._execute_tool(_Call(routed.tool, routed.args))
            result = (getattr(fr, "response", None) or {}).get("result", "")
        except Exception as e:
            print(f"[Router] инструмент упал: {type(e).__name__}: {e}")
            self.ui.write_log(f"ERR: {routed.tool} — {e}")
            return False          # пусть модель попробует обычным путём

        if not self.session:
            return True           # выполнено; озвучивать некому

        # Модель уже НЕ решает — она пересказывает. Формулировка намеренно
        # запрещает обещания и требует конкретики, потому что именно обещания
        # («результат будет в файле») и были наблюдаемым провалом.
        #
        # БЕЗ квадратных маркеров в начале: замерено 2026-08-17 — с пометкой
        # «[ВЫПОЛНЕНО БЕЗ ТЕБЯ]» модель зачитывала её ВСЛУХ в 4 случаях из 10.
        # Пользователь слышал «выполнено без тебя», и это выглядело поломкой.
        # Служебный текст, попавший в реплику, — всегда риск быть озвученным.
        await self.session.send_client_content(
            turns={"parts": [{"text":
                f"Работа по запросу «{routed.phrase}» уже полностью выполнена "
                f"системой. Вот готовый результат:\n\n{result}\n\n"
                "Вызывать ничего не нужно. Просто расскажи пользователю итог "
                "своими словами на его языке, коротко: главные цифры и где лежит "
                "файл, если он создан. Говори как о сделанном, не обещай сделать. "
                "Служебный текст выше вслух не читай."
            }]},
            turn_complete=True,
        )
        return True

    async def _switch_to_local_stt(self) -> bool:
        """Replace the dead online STT with the offline faster-whisper model.

        Returns True when the mic keeps working. Loading takes a few seconds
        (model is read from the HF cache), so it runs in a thread and happens at
        most once per process."""
        if getattr(self, "_stt_local_tried", False):
            return isinstance(self._stt, LocalWhisperSTT)
        self._stt_local_tried = True
        self.ui.write_log("SYS: OpenAI speech-to-text unavailable — loading the offline model…")
        try:
            _size = (_load_cfg().get("local_whisper_model") or "base").strip()
            self._stt = await asyncio.to_thread(LocalWhisperSTT, _size)
        except Exception as e:
            self._stt = None
            print(f"[STT] local Whisper fallback failed: {e}")
            self.ui.write_log(
                "ERR: Voice input is DOWN — OpenAI has no credits and the offline "
                "model could not load. Type instead, or run: pip install faster-whisper"
            )
            return False
        self.ui.write_log("SYS: Voice input restored on the offline model (free, no internet).")
        return True

    async def _process_utterances(self):
        """Transcribe finished mic utterances and deliver them to the voice model
        as text turns — this is what actually fixes recognition accuracy, since
        the live model no longer hears raw audio for user input.

        Engine is gpt-4o-transcribe by default and falls back to the offline
        Whisper model when OpenAI is out of credit or has no key, so a dead
        account costs latency and accuracy but never the microphone itself."""
        _warned_no_stt = False
        while True:
            pcm = await self._utterance_queue.get()

            if self._stt is None:
                # No usable online engine (missing key, or it failed to init).
                # Try the offline model once before declaring voice input dead —
                # a missing OpenAI key should not cost the user their microphone.
                if not getattr(self, "_stt_local_tried", False):
                    if not await self._switch_to_local_stt():
                        continue
                elif not _warned_no_stt:
                    self.ui.write_log("SYS: Voice input disabled — no working speech-to-text engine.")
                    _warned_no_stt = True
                    continue
                else:
                    continue

            try:
                text = await asyncio.to_thread(self._stt.transcribe_pcm16, pcm, SEND_SAMPLE_RATE)
            except STTUnavailableError as e:
                # The online engine is out of credit / the key was rejected. It
                # used to return "" here, so the mic stayed "on" while every
                # word the user spoke was silently thrown away. Switch to the
                # offline model once, tell the user, and retranscribe THIS
                # utterance so nothing is lost.
                print(f"[STT] gpt-4o-transcribe unusable ({e}) — switching to local Whisper.")
                if not await self._switch_to_local_stt():
                    continue
                try:
                    text = await asyncio.to_thread(
                        self._stt.transcribe_pcm16, pcm, SEND_SAMPLE_RATE)
                except Exception as e2:
                    print(f"[STT] local transcription failed: {e2}")
                    continue
            except Exception as e:
                print(f"[STT] transcription failed: {e}")
                continue

            text = _clean_transcript(text or "")
            if not text:
                continue

            self._last_user_speech = time.monotonic()
            self.ui.write_log(f"You: {text}")
            self._session_log.append(f"User: {text}")
            if self._dashboard:
                asyncio.create_task(self._dashboard.broadcast({
                    "type": "log", "speaker": "user",
                    "text": text,
                    "ts": datetime.now().isoformat(),
                }))

            if not self.session:
                continue
            if self._budget_blocked():
                self.ui.write_log("SYS: heard you, but the session budget is spent — voice is paused.")
                continue

            # Однозначные команды выполняются кодом ДО модели — см.
            # _try_route_locally. Не подошло → обычный путь ниже.
            if await self._try_route_locally(text):
                continue

            self.ui.set_state("THINKING")
            try:
                await self.session.send_client_content(
                    turns={"parts": [{"text": text}]},
                    turn_complete=True,
                )
            except Exception as e:
                print(f"[JARVIS] ❌ failed to deliver transcript to Gemini: {e}")

    async def _receive_audio(self):
        print("[JARVIS] 👂 Recv started")
        out_buf = []

        try:
            while True:
                async for response in self.session.receive():

                    # Keep the latest session-resumption handle so a dropped link
                    # can reconnect to THIS conversation instead of a cold session.
                    _sru = getattr(response, "session_resumption_update", None)
                    if _sru is not None and getattr(_sru, "resumable", False) \
                            and getattr(_sru, "new_handle", None):
                        self._resume_handle = _sru.new_handle

                    if response.data:
                        if self._interrupted:
                            pass  # discard: interrupted
                        else:
                            if self._turn_done_event and self._turn_done_event.is_set():
                                self._turn_done_event.clear()
                            # Split into ~50 ms chunks so interrupt() stops audio within 50 ms
                            # (24000 Hz × 2 bytes/sample × 0.05 s = 2400 bytes per slice)
                            _audio_data = response.data
                            _SLICE = 2400
                            for _i in range(0, len(_audio_data), _SLICE):
                                self.audio_in_queue.put_nowait(_audio_data[_i : _i + _SLICE])

                    if response.server_content:
                        sc = response.server_content

                        if sc.output_transcription and sc.output_transcription.text:
                            txt = _clean_transcript(sc.output_transcription.text)
                            if txt and txt != (out_buf[-1] if out_buf else ""):
                                out_buf.append(txt)

                        if sc.turn_complete:
                            if self._turn_done_event:
                                self._turn_done_event.set()

                            # If this turn_complete ends an interrupted response, clear the
                            # flag and skip all further processing for that turn.
                            if self._interrupted:
                                self._interrupted = False
                                out_buf = []
                                continue

                            # User-side transcript is now logged in _process_utterances
                            # (gpt-4o-transcribe), not from Gemini's input_transcription.

                            full_out = " ".join(out_buf).strip()
                            if full_out:
                                self.ui.write_log(f"{self._asst_name}: {full_out}")
                                self._session_log.append(f"{self._asst_name}: {full_out}")
                                if self._dashboard:
                                    asyncio.create_task(self._dashboard.broadcast({
                                        "type": "log", "speaker": "jarvis",
                                        "text": full_out,
                                        "ts": datetime.now().isoformat(),
                                    }))
                            out_buf = []

                            # Vision injection: model finished tool-response turn → now send the image
                            if self._pending_vision and self.session:
                                import base64 as _b64
                                img_b, mime_t, question, angle = self._pending_vision
                                self._pending_vision = None
                                b64 = _b64.b64encode(img_b).decode("ascii")
                                print(f"[Vision] 📤 {len(img_b):,} bytes (angle={angle}) → main session")
                                await self.session.send_client_content(
                                    turns={"parts": [
                                        {"inline_data": {"mime_type": mime_t, "data": b64}},
                                        {"text": question},
                                    ]},
                                    turn_complete=True,
                                )
                                # Mark next turn_complete behaviour depending on angle
                                if self._vision_cam_active:
                                    # Camera: keep busy until JARVIS finishes speaking the answer
                                    self._vision_cam_active    = False
                                    self._vision_close_pending = True
                                else:
                                    # Screen-only: no camera to close; release busy flag now
                                    self._vision_busy = False
                            elif self._vision_close_pending:
                                # This turn_complete IS the vision answer — close camera + release busy flag
                                self._vision_close_pending = False
                                self._vision_busy = False
                                async def _cam_close():
                                    await asyncio.sleep(2.0)
                                    self.ui.stop_camera_stream()
                                asyncio.create_task(_cam_close())

                    if response.tool_call:
                        fcs = list(response.tool_call.function_calls)
                        for fc in fcs:
                            print(f"[JARVIS] 📞 {fc.name}")
                        # Off the receive loop: audio keeps flowing while tools run.
                        asyncio.create_task(self._run_tool_calls(fcs))
        except Exception as e:
            print(f"[JARVIS] ❌ Recv: {e}")
            traceback.print_exc()
            raise

    async def _play_audio(self):
        print("[JARVIS] 🔊 Play started")

        try:
            stream = sd.RawOutputStream(
                samplerate=RECEIVE_SAMPLE_RATE,
                channels=CHANNELS,
                dtype="int16",
                blocksize=CHUNK_SIZE,
            )
            stream.start()
        except Exception as e:
            # No usable audio OUTPUT device (e.g. PortAudio/MME error, no
            # speakers, device busy). Degrade gracefully instead of tearing the
            # whole TaskGroup down: keep the session (listening, tools, text,
            # dashboard) alive and just drop the spoken audio.
            print(f"[JARVIS] ⚠ Voice output disabled (no usable audio device): {e}")
            try:
                self.ui.write_log("SYS: Voice output disabled — no audio output device.")
            except Exception:
                pass
            await self._drain_audio_no_output()
            return

        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        self.audio_in_queue.get(),
                        timeout=0.1
                    )
                except asyncio.TimeoutError:
                    if (
                        self._turn_done_event
                        and self._turn_done_event.is_set()
                        and self.audio_in_queue.empty()
                    ):
                        self.set_speaking(False)
                        self._turn_done_event.clear()
                    continue

                self.set_speaking(True)

                # Batch all immediately-available chunks into one write to reduce
                # thread-pool round-trips (was one asyncio.to_thread per 50ms slice).
                # Cap at ~200 ms so interrupt() still stops audio within ~200 ms.
                batch = bytearray(chunk)
                while len(batch) < 9600:   # 9600 bytes ≈ 200 ms at 24 kHz / 16-bit mono
                    try:
                        batch.extend(self.audio_in_queue.get_nowait())
                    except asyncio.QueueEmpty:
                        break

                try:
                    await asyncio.to_thread(stream.write, bytes(batch))
                except (RuntimeError, asyncio.CancelledError):
                    break   # executor shutting down — exit cleanly
        except Exception as e:
            print(f"[JARVIS] ❌ Play: {e}")
            raise
        finally:
            self.set_speaking(False)
            stream.stop()
            stream.close()

    async def _drain_audio_no_output(self):
        """Consume and discard playback audio when there is no output device.

        Keeps audio_in_queue drained (so producers never block) and still honors
        turn-completion so speaking state stays consistent — just no sound."""
        while True:
            try:
                await asyncio.wait_for(self.audio_in_queue.get(), timeout=0.1)
            except asyncio.TimeoutError:
                if (
                    self._turn_done_event
                    and self._turn_done_event.is_set()
                    and self.audio_in_queue.empty()
                ):
                    self.set_speaking(False)
                    self._turn_done_event.clear()
                continue
            except (RuntimeError, asyncio.CancelledError):
                break
            # No output device — discard the chunk we can't play.

    # ── Morning briefing ────────────────────────────────────────────────────────

    async def _send_startup_briefing(self) -> None:
        """
        Two-phase briefing optimized for speed:
          Phase 1 — instant greeting (no tools) → speech starts in <1s
          Phase 2 — news pre-fetched in a background thread while Phase 1 plays,
                    delivered as ready text (no Gemini tool-call round-trip) and
                    shown on the UI content panel. Waits for turn_complete event
                    instead of a fixed sleep so there is no unnecessary gap.
        """
        memory   = load_memory()
        identity = memory.get("identity", {})

        def _val(k: str) -> str:
            e = identity.get(k, {})
            return (e.get("value", "") if isinstance(e, dict) else str(e)).strip()

        lang = get_preferred_language() or _val("language")
        name = _val("name")
        time_str = datetime.now().strftime("%H:%M")

        # Daily news is opt-out: if the user switched it off, the briefing stays a
        # plain greeting — no headlines are fetched or spoken.
        news_on = get_news_enabled()

        # Start fetching news immediately — runs in parallel while phase 1 plays
        loop = asyncio.get_event_loop()
        news_future = (
            loop.run_in_executor(None, _fetch_news_sync, "top world news today")
            if news_on else None
        )

        await asyncio.sleep(0.3)
        if not self.session:
            return

        # ── Phase 1: instant greeting ─────────────────────────────────────────
        lang_clause = f" Respond in {lang}." if lang else ""
        name_clause = f" Address the user as {name}." if name else ""

        # Inject last session context if available — pop removes it so it's never repeated
        last = await asyncio.to_thread(pop_last_session)
        session_clause = ""
        if last:
            try:
                _delta = (datetime.now() - datetime.strptime(last["date"], "%Y-%m-%d")).days
                _when  = "earlier today" if _delta == 0 else ("yesterday" if _delta == 1 else f"{_delta} days ago")
            except Exception:
                _when = "last time"
            session_clause = (
                f" Also briefly and naturally mention that {_when}: {last['summary']}"
            )

        # Proactive "here's how I can help right now" — surface the user's real
        # open loops from the living memory so they never face a blank canvas.
        # This is the cure for "I don't even know what to ask Jarvis for".
        help_clause = ""
        try:
            _ms = mind.load()
            _focus = (_ms.get("focus") or "").strip()
            _loops = [str(x).strip() for x in (_ms.get("open_loops") or []) if str(x).strip()][:3]
            if _loops or _focus:
                _bits = []
                if _focus:
                    _bits.append(f"they are currently focused on {_focus}")
                if _loops:
                    _bits.append("their open items are: " + "; ".join(_loops))
                help_clause = (
                    " Then, in ONE short natural sentence, proactively offer to help "
                    "move something forward today — you know that " + "; ".join(_bits) +
                    ". Suggest ONE concrete thing you can do for them right now "
                    "(research it, plan it, draft it, or organise it in their vault), "
                    "or ask which they want to tackle. Sound like a partner who "
                    "remembers their situation — not a menu, not a list."
                )
            else:
                help_clause = (
                    " Then, in ONE short warm sentence, invite them to tell you what "
                    "they're working on — studies, their project, or their day — so "
                    "you can actually help, and hint that you can plan, research, "
                    "draft, or organise things for them."
                )
        except Exception:
            pass

        if news_on:
            p1 = (
                f"Greet the user warmly, mention it is {time_str}, and say you are fetching today's news now.{session_clause} "
                f"Keep it to 2 short sentences max. Do not call any tools.{lang_clause}{name_clause}"
            )
        else:
            p1 = (
                f"Greet the user warmly and naturally, mention it is {time_str}.{session_clause}{help_clause} "
                f"Keep it to 2-3 short sentences. Do NOT mention news. Do not call any tools.{lang_clause}{name_clause}"
            )

        # Clear the turn-done event so we can wait for Phase 1 to finish
        if self._turn_done_event:
            self._turn_done_event.clear()

        await self.session.send_client_content(
            turns={"parts": [{"text": p1}]},
            turn_complete=True,
        )
        self.ui.write_log("SYS: Briefing phase 1 (greeting) sent.")

        # ── Phase 2: fire as soon as Phase 1 audio is done ───────────────────
        async def _deliver_news():
            try:
                lang_str = f" Respond in {lang}." if lang else ""

                # Wait for news fetch (already running) and Phase 1 turn-complete
                # in parallel — whichever takes longer determines the wait time
                news_done   = asyncio.wrap_future(news_future)
                turn_waited = False
                if self._turn_done_event:
                    try:
                        await asyncio.wait_for(self._turn_done_event.wait(), timeout=6.0)
                        turn_waited = True
                    except asyncio.TimeoutError:
                        pass

                # Extra buffer: turn_complete fires when Gemini finishes *generating*
                # Phase 1, but audio may still be playing.  Waiting a beat here
                # prevents Phase 2 audio from arriving while Phase 1 is mid-sentence
                # (which sounds like a "repeated first response" to the user).
                if turn_waited:
                    await asyncio.sleep(0.8)
                else:
                    await asyncio.sleep(1.0)

                try:
                    news_text = await asyncio.wait_for(news_done, timeout=4.0)
                except Exception:
                    news_text = ""

                if not self.session:
                    return

                if news_text and len(news_text) > 60:
                    # Show on UI content panel immediately
                    self.ui.show_content("NEWS — top world news today", news_text)

                    p2 = (
                        f"[BRIEFING] Here are today's top news headlines:\n{news_text}\n\n"
                        "Pick ONE headline, summarise it in one sentence, then say the full list "
                        f"is displayed on screen. Do not call any tools.{lang_str}"
                    )
                else:
                    p2 = (
                        "News headlines could not be fetched right now. "
                        f"Let the user know briefly.{lang_str}"
                    )

                await self.session.send_client_content(
                    turns={"parts": [{"text": p2}]},
                    turn_complete=True,
                )
                self.ui.write_log("SYS: Briefing phase 2 (news) sent.")
            except Exception as e:
                print(f"[Briefing] Phase 2 error: {e}")
                self.ui.write_log(f"SYS: Briefing phase 2 failed: {e}")

        if news_on:
            asyncio.create_task(_deliver_news())

    # ── Session memory ──────────────────────────────────────────────────────────

    async def _save_session_summary(self) -> None:
        """Summarise the current session in 1-2 sentences and save to long_term.json."""
        log = self._session_log
        if len(log) < 3:          # need at least one exchange to be worth saving
            return
        self._session_log = []    # reset immediately so the next session starts clean
        started = self._session_started
        self._session_started = datetime.now()

        memory = load_memory()
        lang_entry = memory.get("identity", {}).get("language", {})
        lang = (lang_entry.get("value", "") if isinstance(lang_entry, dict) else str(lang_entry)).strip()
        lang = lang or "English"

        convo = "\n".join(log[-40:])   # cap at last 40 turns to stay within token budget
        prompt = (
            f"Summarize this conversation in 1-2 sentences in {lang}. "
            "Focus on what the user accomplished or discussed. "
            "Output ONLY the summary text, nothing else:\n\n" + convo
        )
        try:
            res = await asyncio.to_thread(
                lambda: model_router.generate(prompt, tier="fast", max_tokens=200)
            )
            summary = res.text.strip()
            if summary:
                save_session_summary(summary, lang)
                # Mirror into the Obsidian vault as a dated journal entry (best-effort).
                if _load_cfg().get("obsidian_mirror_sessions", True):
                    await asyncio.to_thread(mirror_session, summary, lang)
                # Embed the summary into the semantic brain (the diary) — searchable forever.
                try:
                    await asyncio.to_thread(
                        brain.remember, summary, "episode",
                        source="session", ts=datetime.now().strftime("%Y-%m-%d"),
                    )
                except Exception:
                    pass
                # Living Memory — update JARVIS's evolving model of the user's
                # world from this session (best-effort, off the hot path).
                try:
                    await asyncio.to_thread(mind.reflect, convo, summary, lang)
                except Exception as _me:
                    print(f"[Mind] reflect skipped: {_me}")

            # Knowledge Layer — the summary above is a JOURNAL line ("what
            # happened"); this is the KNOWLEDGE line ("what is now true").
            # It runs on the raw conversation, not on the summary, because the
            # summary has already thrown the checkable details away. Facts land
            # in the real project notes with a source link; clicks, opinions
            # and empty phrases are rejected by memory/knowledge.py's gate.
            try:
                day = datetime.now().strftime("%Y-%m-%d")
                await asyncio.to_thread(
                    knowledge.ingest, convo,
                    source="session",
                    source_ref=f"JARVIS/Sessions/{day}",
                    language=lang,
                )
            except Exception as _ke:
                print(f"[Knowledge] session ingest skipped: {_ke}")
        except Exception as e:
            print(f"[Memory] ⚠️ Session summary failed: {e}")

        # Work-style counters — no model call, so this runs even if every
        # provider above failed.
        try:
            user_turns = [ln[6:] for ln in log if ln.startswith("User: ")]
            minutes = max((datetime.now() - started).total_seconds() / 60.0, 0.0)
            await asyncio.to_thread(
                work_style.record_session, user_turns,
                language=lang, minutes=minutes, started=started,
            )
            await asyncio.to_thread(work_style.render_vault)
        except Exception as _we:
            print(f"[WorkStyle] session record skipped: {_we}")

    # ── System monitor ──────────────────────────────────────────────────────────

    async def _run_system_monitor(self) -> None:
        """Background task: voice alerts when metrics exceed thresholds."""
        if not _unattended_speech_on():
            print("[Monitor] system-metric voice alerts disabled (unattended_speech_enabled=false).")
            return

        while True:
            await asyncio.sleep(10)
            alert = await asyncio.to_thread(self._sys_monitor.check)
            if not alert or not self.session:
                continue
            # Don't interrupt an active conversation
            with self._speaking_lock:
                speaking = self._is_speaking
            if speaking or (time.monotonic() - self._last_user_speech) < 10:
                continue
            try:
                await self.session.send_client_content(
                    turns={"parts": [{"text": alert}]},
                    turn_complete=True,
                )
            except Exception as e:
                print(f"[Monitor] ⚠️ Could not send alert: {e}")

    # ── Background monitor ──────────────────────────────────────────────────────

    async def _run_background_monitor(self) -> None:
        """Check user-configured topics once per day; speak alerts when new headlines appear."""
        if not _unattended_speech_on():
            print("[Monitor] background topic alerts disabled (unattended_speech_enabled=false).")
            return

        await asyncio.sleep(300)          # wait 5 min after startup before first check
        while True:
            if self.session:
                # Don't interrupt if user spoke recently or JARVIS is mid-sentence
                with self._speaking_lock:
                    speaking = self._is_speaking
                recent_speech = (time.monotonic() - self._last_user_speech) < 30
                if not speaking and not recent_speech:
                    try:
                        alerts = await asyncio.to_thread(monitor_check_all)
                        memory = load_memory()
                        lang_e = memory.get("identity", {}).get("language", {})
                        lang   = (lang_e.get("value", "") if isinstance(lang_e, dict) else str(lang_e)).strip() or "English"
                        for alert in alerts:
                            msg = (
                                f"{alert}\n\n"
                                f"Inform the user about this development naturally in {lang}. "
                                "One brief sentence only."
                            )
                            await self.session.send_client_content(
                                turns={"parts": [{"text": msg}]},
                                turn_complete=True,
                            )
                            self.ui.write_log(f"SYS: Monitor alert sent.")
                            await asyncio.sleep(6)   # gap between consecutive alerts
                    except Exception as e:
                        print(f"[Monitor] ⚠️ Background check error: {e}")
            await asyncio.sleep(1800)     # check every 30 minutes

    # ── Proactive mode ──────────────────────────────────────────────────────────

    async def _run_proactive_mode(self) -> None:
        """
        Background task: periodically checks if the user has been silent long enough,
        then hands time + memory context to Gemini so it can decide what (if anything)
        to say proactively. No hardcoded rules — Gemini makes the call.
        """
        if not _unattended_speech_on():
            print("[Proactive] disabled (unattended_speech_enabled=false) — no idle spending.")
            return

        while True:
            await asyncio.sleep(60)   # evaluate once per minute

            if not self.session:
                continue

            with self._speaking_lock:
                speaking = self._is_speaking
            if speaking:
                continue

            if not self._proactive.should_trigger(self._last_user_speech):
                continue

            self._proactive.mark_triggered()

            try:
                memory       = await asyncio.to_thread(load_memory)
                monitors     = await asyncio.to_thread(list_monitors)
                recent_turns = self._session_log[-8:] if self._session_log else []
                prompt = self._proactive.build_prompt(
                    memory       = memory,
                    monitors     = monitors or None,
                    recent_turns = recent_turns or None,
                )
                await self.session.send_client_content(
                    turns={"parts": [{"text": prompt}]},
                    turn_complete=True,
                )
                self.ui.write_log("SYS: Proactive check-in.")
            except Exception as e:
                print(f"[Proactive] ⚠️ {e}")

    # ── Semantic brain: keep the Obsidian vault indexed ─────────────────────────

    async def _run_brain_indexer(self) -> None:
        """Index the user's Obsidian vault into the local semantic brain.

        Runs shortly after startup, then refreshes periodically.  Incremental:
        unchanged notes are skipped (content-hash manifest), so repeat runs are
        cheap.  Fully best-effort — never touches the assistant's hot path.
        """
        try:
            if not brain.is_available():
                return
            await asyncio.sleep(20)          # let the session settle first
            first = True
            while True:
                try:
                    if _load_cfg().get("brain_index_vault", True):
                        msg = await asyncio.to_thread(brain.reindex_vault)
                        self.ui.write_log(f"SYS: Brain — {msg}")
                        if first:
                            st = await asyncio.to_thread(brain.stats)
                            print(f"[Brain] 📊 {st}")
                            first = False
                except Exception as e:
                    print(f"[Brain] indexer error: {e}")
                await asyncio.sleep(6 * 3600)  # refresh every 6 hours
        except Exception as e:
            print(f"[Brain] indexer task stopped: {e}")

    async def _run_mind_seed(self) -> None:
        """Seed the Living Memory from existing long-term memory on first run,
        so the very first session already knows the user's world. Best-effort,
        one-shot — after this the Mind updates itself at each session's end."""
        try:
            if not mind.is_available():
                return
            await asyncio.sleep(25)          # after the brain settles
            st = await asyncio.to_thread(mind.seed_if_empty)
            if st and (st.get("identity") or st.get("projects")):
                self.ui.write_log("SYS: Living memory ready.")
                print(f"[Mind] 📊 {mind.stats()}")
        except Exception as e:
            print(f"[Mind] seed task stopped: {e}")

    # ── Phone audio relay ────────────────────────────────────────────────────────

    def _ambient_conversation_busy(self) -> bool:
        """True while a live exchange is happening, so ambient vision steps
        aside and leaves the (narrow, KZ) uplink to the voice channel.

        A conversation is 'busy' when JARVIS is speaking OR the user spoke
        within the last `convo_grace` seconds (covers the user's turn plus the
        model's think-before-reply gap). In pure silence this is False, so the
        screen is watched at full cadence — exactly the "watch every change,
        but never slow a conversation" balance the user asked for.
        """
        with self._speaking_lock:
            if self._is_speaking:
                return True
        last = getattr(self, "_last_user_speech", 0.0) or 0.0
        return bool(last and (time.monotonic() - last) < self._ambient_convo_grace)

    async def _run_ambient_vision(self) -> None:
        """Stream the screen into the live session continuously (frame-diffed).

        This is what lets JARVIS *watch* instead of taking one-off screenshots:
        roughly every `ambient_vision_interval` seconds a downscaled frame is
        pushed as realtime video input — but only when the screen actually
        changed, so a static screen sends nothing and stays cheap/cool.
        Frames go through out_queue so `_send_realtime` stays the single writer.
        """
        if self._ambient is None or not self._ambient.available:
            return
        loop = asyncio.get_event_loop()
        await asyncio.sleep(3.0)          # let the session settle before first frame
        self._ambient.reset()
        force_next = True
        while True:
            interval = max(0.5, float(self._ambient_interval))
            try:
                active = (
                    self._ambient_enabled
                    and self.session is not None
                    and self.out_queue is not None
                    and not (self._ambient_pause_speaking and self._ambient_conversation_busy())
                )
                if active:
                    frame = await loop.run_in_executor(
                        None, lambda f=force_next: self._ambient.grab(force=f)
                    )
                    force_next = False
                    if frame is not None:
                        img_b, mime_t = frame
                        try:
                            self.out_queue.put_nowait({"data": img_b, "mime_type": mime_t})
                        except asyncio.QueueFull:
                            pass
                else:
                    force_next = True     # re-send a fresh frame once we resume
            except Exception as e:
                print(f"[Ambient] loop error: {e}")
            await asyncio.sleep(interval)

    async def _relay_phone_audio(self) -> None:
        """Forward phone mic PCM chunks from dashboard queue into the Gemini Live session."""
        q = self._dashboard._phone_audio_queue
        while True:
            try:
                chunk = await asyncio.wait_for(q.get(), timeout=1.0)
            except asyncio.TimeoutError:
                # No audio for 1 s → phone mic inactive, give PC mic back
                self._phone_active = False
                continue
            self._phone_active = True   # phone is streaming — silence PC mic
            with self._speaking_lock:
                speaking = self._is_speaking
            if not speaking and not self.ui.muted:
                try:
                    self.out_queue.put_nowait(chunk)
                except asyncio.QueueFull:
                    pass

    def _on_phone_connected(self) -> None:
        self.ui.write_log("SYS: Phone connected via Remote Dashboard.")
        self.ui.notify_phone_connected()

    # ── dashboard command relay ─────────────────────────────────────────────

    async def _process_dashboard_commands(self) -> None:
        while True:
            try:
                text = await asyncio.wait_for(
                    self._dashboard._command_queue.get(), timeout=0.5
                )
                if not text:
                    continue
                # Wait up to 8s for session to become ready after a wake
                for _ in range(80):
                    if self.session:
                        break
                    await asyncio.sleep(0.1)
                if self.session:
                    await self.session.send_client_content(
                        turns={"parts": [{"text": text}]},
                        turn_complete=True,
                    )
                    self.ui.write_log(f"[Web]: {text}")
                else:
                    print(f"[Dashboard] Dropped command (no session): {text}")
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                print(f"[Dashboard] Command error: {e}")
                await asyncio.sleep(0.5)

    # ── main loop ───────────────────────────────────────────────────────────

    async def _guard(self, factory, name: str, *, restart: bool = False,
                     delay: float = 2.0) -> None:
        """Run a NON-critical session task in isolation.

        A raw asyncio.TaskGroup cancels every sibling the moment one task raises.
        Peripheral subsystems (mic, speaker, monitors, vision, indexer, phone
        relay) must never take the whole assistant down with them, so we run
        them through this supervisor: log the failure, optionally restart with
        backoff, and keep the session alive. CancelledError still propagates so
        a real reconnect can cancel these cleanly.

        Connection-critical tasks (_send_realtime / _receive_audio) are NOT
        guarded — their failure SHOULD tear the session down so run() reconnects.
        """
        while True:
            try:
                await factory()
                return  # finished on its own
            except asyncio.CancelledError:
                raise
            except RuntimeError as e:
                # Interpreter/loop is tearing down (reconnect or app exit): a
                # to_thread / run_in_executor call can't schedule work on an
                # already-shut-down pool. This is a clean stop, not a fault —
                # returning here keeps it from bubbling up as an unhandled
                # TaskGroup sub-exception (the "cannot schedule new futures after
                # shutdown" crash seen in jarvis.log on 2026-08-12).
                _msg = str(e).lower()
                if ("cannot schedule new futures" in _msg
                        or "event loop is closed" in _msg
                        or "no running event loop" in _msg):
                    return
                print(f"[JARVIS] ⚠ subsystem '{name}' failed: {e}")
                self._log_subsystem_failure(name, e, restart)
                if not restart:
                    return
                await asyncio.sleep(delay)
                continue
            except Exception as e:
                print(f"[JARVIS] ⚠ subsystem '{name}' failed: {e}")
                self._log_subsystem_failure(name, e, restart)
                if not restart:
                    return
                await asyncio.sleep(delay)

    def _log_subsystem_failure(self, name: str, exc: BaseException, restart: bool) -> None:
        """Put the REASON on screen, not just the fact of failure.

        `SYS: subsystem 'dashboard-server' unavailable.` told the user nothing
        actionable and left the actual exception in a console that pythonw never
        shows. Name the error and say whether it will come back."""
        try:
            _reason = _exc_text(exc).strip().splitlines()[-1][:160] or type(exc).__name__
            _tail = "retrying…" if restart else "disabled for this session."
            self.ui.write_log(
                f"SYS: subsystem '{name}' unavailable — {type(exc).__name__}: {_reason} ({_tail})"
            )
        except Exception:
            pass

    def _budget_blocked(self) -> bool:
        """True when spending must stop, checked before anything that would create
        a new PAID turn so the cap actually caps instead of merely reporting.

        Consults the persistent MONTHLY ledger LIVE (not just the in-session latch)
        so that if the month's $5 was already spent in a previous run, the very
        first turn of a fresh launch is blocked too — the latch alone would let one
        turn through before it tripped."""
        if getattr(self, "_budget_hit", False):
            return True
        try:
            cap = _monthly_cap_usd()
            if cap > 0 and _month_spent_usd() >= cap:
                return True
            sess_cap = float(_load_cfg().get("session_budget_usd", 0) or 0)
            if sess_cap > 0 and getattr(self, "_spend_usd", 0.0) >= sess_cap:
                return True
        except Exception:
            pass
        return False

    def _on_spend(self, meter) -> None:
        """Show what the paid voice backend has cost so far, and stop before it
        empties the account.

        Called from the realtime socket thread after every completed turn, so it
        must stay cheap and must never raise. `session_budget_usd` (0 = no cap)
        makes the assistant fall silent instead of spending past a limit — the
        protection that did not exist when $3.31 vanished unnoticed."""
        try:
            self._spend_usd = meter.cost_usd
            # Persist the INCREMENTAL cost since the last callback into the monthly
            # ledger (meter.cost_usd is cumulative for THIS session; the delta is
            # what's new). This is what makes the cap survive restarts.
            prev = getattr(self, "_session_ledgered_usd", 0.0)
            delta = meter.cost_usd - prev
            if delta > 0:
                self._session_ledgered_usd = meter.cost_usd
                month_total = _ledger_add(delta, turns=1)
            else:
                month_total = _month_spent_usd()

            # One UI line per 10 turns, plus the first, so the log stays readable.
            if meter.turns == 1 or meter.turns % 10 == 0:
                self.ui.write_log(f"SYS: voice spend ≈ ${meter.cost_usd:.3f} this session · "
                                  f"${month_total:.2f} this month ({meter.turns} turns)")

            month_cap = _monthly_cap_usd()
            sess_cap = float(_load_cfg().get("session_budget_usd", 0) or 0)
            hit = None
            if month_cap > 0 and month_total >= month_cap:
                hit = (f"MONTHLY budget ${month_cap:.2f} reached "
                       f"(${month_total:.2f} spent this month)")
            elif sess_cap > 0 and meter.cost_usd >= sess_cap:
                hit = (f"session budget ${sess_cap:.2f} reached "
                       f"(${meter.cost_usd:.3f} this run)")
            if hit and not getattr(self, "_budget_hit", False):
                self._budget_hit = True
                self.ui.write_log(
                    f"ERR: {hit}. Voice is PAUSED — raise the cap in config or switch "
                    "voice_backend to gemini (free)."
                )
                print(f"[JARVIS] {hit} — pausing voice.")
        except Exception as e:
            print(f"[JARVIS] spend callback error: {e}")

    def _open_session(self, config):
        """Return the live-session context manager for the configured backend.

        `voice_backend: "openai"` in api_keys.json → OpenAI Realtime API (drop-in
        for the region-blocked Gemini Live). Anything else → Gemini (default).
        Both are async context managers exposing the same session interface, so
        run()'s body and every self.session.* call site stay unchanged."""
        backend = (self._voice_backend_override
                   or (_load_cfg().get("voice_backend") or "gemini")).strip().lower()

        if backend == "openai":
            from core.realtime_openai import (
                OpenAIRealtimeSession, DEFAULT_MODEL, DEFAULT_VOICE,
            )
            _oa = _load_cfg()
            print("[JARVIS] Voice backend: OpenAI Realtime")
            self.ui.write_log("SYS: Voice backend — OpenAI Realtime.")
            # Show where the month stands against the cap, every connect.
            _cap = _monthly_cap_usd()
            if _cap > 0:
                _spent = _month_spent_usd()
                _left = max(0.0, _cap - _spent)
                self.ui.write_log(
                    f"SYS: budget ${_spent:.2f}/${_cap:.2f} used this month "
                    f"(${_left:.2f} left)."
                    + ("  ⚠ CAP REACHED — voice paused until next month or a higher cap."
                       if _spent >= _cap else "")
                )
            return OpenAIRealtimeSession(
                api_key=_get_openai_key(),
                model=(_oa.get("openai_realtime_model") or DEFAULT_MODEL).strip(),
                voice=(_oa.get("openai_realtime_voice") or DEFAULT_VOICE).strip(),
                instructions=getattr(config, "system_instruction", "") or "",
                tool_declarations=TOOL_DECLARATIONS,
                prices=_oa.get("realtime_prices") or None,
                on_spend=self._on_spend,
            )

        # ── Gemini Live (default) ──────────────────────────────────────────
        # Fresh client on every reconnect — avoids stale HTTP session state.
        client = genai.Client(
            api_key=_get_api_key(),
            http_options={"api_version": "v1beta"},
        )
        # config "live_model" (if set) is tried first, then the fallbacks
        _cfg_live  = (_load_cfg().get("live_model") or "").strip()
        _live_cand = ([_cfg_live] if _cfg_live else []) + LIVE_MODEL_FALLBACKS
        live_model = _live_cand[min(self._live_model_idx, len(_live_cand) - 1)]
        if self._live_model_idx:
            print(f"[JARVIS] Using fallback live model: {live_model}")
        return client.aio.live.connect(model=live_model, config=config)

    async def run(self):
        self._loop = asyncio.get_event_loop()

        # Log which reasoning backends the model router can use this session.
        try:
            _st = model_router.status()
            print(f"[Router] {_st}")
            self.ui.write_log(f"SYS: {_st}")
        except Exception:
            pass

        # Start dashboard (optional — needs: pip install fastapi "uvicorn[standard]" cryptography)
        try:
            from dashboard.server import DashboardServer
            self._dashboard = DashboardServer()
            self._dashboard.set_connect_callback(self._on_phone_connected)
            # Guarded: a port conflict / bind failure disables the dashboard,
            # it must never crash the assistant.
            asyncio.create_task(self._guard(self._dashboard.serve, "dashboard-server"))
            # Runs for the whole lifetime, not just inside an active session
            asyncio.create_task(self._guard(self._process_dashboard_commands,
                                            "dashboard-commands", restart=True))
        except Exception as e:
            print(f"[Dashboard] Disabled: {e}")
            self._dashboard = None

        while True:
            try:
                print("[JARVIS] Connecting...")
                self.ui.set_state("THINKING")
                config = self._build_config()
                self._used_resume_handle = bool(self._resume_handle)
                session_cm = self._open_session(config)

                async with (
                    session_cm as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session          = session
                    self.audio_in_queue   = asyncio.Queue()
                    self.out_queue        = asyncio.Queue(maxsize=200)
                    self._utterance_queue = asyncio.Queue()
                    self._turn_done_event = asyncio.Event()

                    # Reset transient state that must not carry over from a previous session
                    self._pending_vision       = None
                    self._vision_cam_active    = False
                    self._vision_close_pending = False
                    self._vision_busy          = False
                    self._vision_last_time     = 0.0
                    self._interrupted          = False

                    print("[JARVIS] Connected.")
                    self._live_fail_streak = 0     # this model is working — reset failure count
                    self.ui.set_state("LISTENING")
                    self.ui.write_log("SYS: JARVIS online.")

                    if self._dashboard:
                        await self._dashboard.broadcast({"type": "status", "state": "active"})

                    # Connection-critical: their failure means the Gemini Live
                    # link dropped → let it tear down so run() reconnects.
                    tg.create_task(self._send_realtime())
                    tg.create_task(self._receive_audio())

                    # Peripheral subsystems: isolated so a device/monitor fault
                    # can never crash the whole assistant (see _guard).
                    tg.create_task(self._guard(self._listen_audio, "mic-input"))
                    tg.create_task(self._guard(self._process_utterances, "speech-to-text", restart=True))
                    tg.create_task(self._guard(self._play_audio, "audio-output"))
                    tg.create_task(self._guard(self._run_system_monitor, "system-monitor", restart=True))
                    tg.create_task(self._guard(self._run_background_monitor, "background-monitor", restart=True))
                    tg.create_task(self._guard(self._run_proactive_mode, "proactive-mode", restart=True))
                    tg.create_task(self._guard(self._run_ambient_vision, "ambient-vision", restart=True))
                    tg.create_task(self._guard(self._run_brain_indexer, "brain-indexer", restart=True))
                    tg.create_task(self._guard(self._run_mind_seed, "mind-seed"))
                    if self._dashboard:
                        tg.create_task(self._guard(self._relay_phone_audio, "phone-audio", restart=True))

                    # Morning briefing — fires once per process launch (if enabled)
                    if not self._briefing_sent and get_brief_enabled():
                        self._briefing_sent = True
                        tg.create_task(self._send_startup_briefing())

            except KeyboardInterrupt:
                raise
            except SystemExit:
                raise
            except BaseException as e:
                # Catches both Exception and BaseExceptionGroup (Python 3.11+
                # TaskGroup raises BaseExceptionGroup when tasks are cancelled
                # externally, which `except Exception` would miss, letting the
                # exception escape the while-loop and causing asyncio.run() to
                # start shutdown — resulting in "executor after shutdown" errors).
                # Must be the FLATTENED text: a bare str(e) on the TaskGroup
                # wrapper says only "unhandled errors in a TaskGroup", so every
                # substring check below matched nothing. See _exc_text().
                err_str = _exc_text(e)
                _kinds  = _conn_error_kinds(err_str)
                print(f"[JARVIS] Error ({type(e).__name__}) {sorted(_kinds)}: {err_str[:400]}")
                traceback.print_exc()

                # Invalid API key — stop hammering the API, prompt re-configuration.
                # NOTE: do NOT treat websocket close 1007 as a bad key — 1007 is
                # "invalid frame payload data" and here means the native-audio model
                # rejected the audio config ("audio content type not supported").
                # A genuine bad key surfaces as "API key not valid" / 403 / 1008.
                if "bad_gemini_key" in _kinds:
                    self.ui.write_log("ERR: API key invalid — please re-enter your key.")
                    self.ui.set_state("SLEEPING")
                    self.ui.prompt_reconfig()
                    while not self.ui._win._ready:
                        await asyncio.sleep(1)
                    print("[JARVIS] New API key saved — reconnecting...")
                    _conn_backoff = 3
                    continue

                # ── Voice backend is out of money / unauthorised ───────────────
                # OpenAI closes the Realtime websocket with 1013
                # "insufficient_quota.credit_balance_exhausted" the instant the
                # account balance hits zero. Nothing about that is retryable, so
                # the old code's unclassified 3s retry loop was an INVISIBLE
                # infinite reconnect — the app looked frozen (only the "Voice
                # backend — OpenAI Realtime" banner repeating) while the mic and
                # the voice were both dead. Fail over to the other backend once,
                # say so plainly, and never hammer a billing error.
                _billing_dead = "billing" in _kinds
                _auth_dead    = "auth" in _kinds
                _backend_now = (self._voice_backend_override
                                or (_load_cfg().get("voice_backend") or "gemini")
                                ).strip().lower()
                if (_billing_dead or _auth_dead) and _backend_now == "openai":
                    self._voice_backend_override = "gemini"
                    self._resume_handle = None      # handles don't cross backends
                    _why = ("OpenAI credits exhausted" if _billing_dead
                            else "OpenAI key rejected")
                    self.ui.write_log(
                        f"ERR: {_why} — voice switched to Gemini for this session. "
                        "Top up at platform.openai.com/settings/organization/billing "
                        "and restart to go back to the OpenAI voice."
                    )
                    print(f"[JARVIS] {_why} → falling back to the Gemini voice backend.")
                    self._conn_backoff = 2
                    continue
                if _billing_dead or _auth_dead:
                    # Already on the fallback and it is also refusing — do not
                    # spin. Back off hard and keep the reason on screen.
                    self._conn_backoff = 60
                    self.ui.write_log(
                        "ERR: Both voice backends refused the connection "
                        f"({'billing/quota' if _billing_dead else 'bad key'}). "
                        "Retrying in 60s — check your API keys and balance."
                    )
                    self.ui.set_state("SLEEPING")

                # Two very different failures used to be handled identically —
                # by switching the live model, which starts a NEW session and
                # loses the whole conversation. Separate them:
                #   • PERMANENT  — Google retired/renamed the model → switch now.
                #   • TRANSIENT  — the aging native-audio preview intermittently
                #     rejects the audio config (close 1007) or the link blips.
                #     1007 is NOT sticky ("some connects are clean"), so switching
                #     on the first one needlessly abandons the session. Reconnect
                #     the SAME model (resuming context) and only switch after it
                #     fails repeatedly, i.e. the model is genuinely down.
                _permanent_gone = "permanent_model" in _kinds
                _transient_live = "transient_live" in _kinds

                if _permanent_gone or _transient_live:
                    _cfg_live = (_load_cfg().get("live_model") or "").strip()
                    _n_cand   = (1 if _cfg_live else 0) + len(LIVE_MODEL_FALLBACKS)

                    # A stale resumption handle can itself get the connect rejected.
                    # If the just-failed attempt carried one, drop it and retry the
                    # SAME model cold before ever considering a model switch.
                    if self._used_resume_handle and self._resume_handle:
                        self._resume_handle = None
                        self.ui.write_log("SYS: Reconnecting to the same session…")
                        self._conn_backoff = 2
                        continue

                    self._live_fail_streak += 1
                    _switch = _permanent_gone or self._live_fail_streak >= 3

                    if _switch and self._live_model_idx < _n_cand - 1:
                        self._live_model_idx  += 1
                        self._live_fail_streak = 0
                        self._resume_handle    = None   # handles don't transfer across models
                        self.ui.write_log(
                            "SYS: Live model unavailable — switching to fallback model."
                        )
                        self._conn_backoff = 2
                        continue
                    if not _switch:
                        # Same model, quiet reconnect — keeps the conversation.
                        self.ui.write_log("SYS: Connection hiccup — reconnecting…")
                        self._conn_backoff = 2
                        continue

                # Project denied inference access — almost always a REGION geo-block
                # (the Gemini API isn't available in some countries without a VPN),
                # but can also be billing-off or a flagged project. Retrying fast is
                # pointless, so surface a clear fix and back off hard.
                denied = "denied" in _kinds
                if denied:
                    self._conn_backoff = 60
                    self.ui.write_log(
                        "ERR: Gemini denied this project inference access — usually a REGION "
                        "block. Turn on a VPN (US/EU) or use a key from a project with access. "
                        "Retrying in 60s."
                    )
                    self.ui.set_state("SLEEPING")
                    print(
                        "[JARVIS] Project denied access (403/1008) — likely a region geo-block.\n"
                        "         Fix: VPN to a supported region, or a Gemini key whose Google\n"
                        "         project has generative access + billing enabled."
                    )

                # Network / timeout errors — log clearly and back off
                is_net_err = "network" in _kinds
                if not denied and not (_billing_dead or _auth_dead) and is_net_err:
                    _conn_backoff = min(getattr(self, "_conn_backoff", 3) * 2, 60)
                    self._conn_backoff = _conn_backoff
                    self.ui.write_log(
                        f"NET: Connection failed — retrying in {_conn_backoff}s. "
                        "(a VPN may be required)"
                    )
                elif not denied and not (_billing_dead or _auth_dead):
                    # UNCLASSIFIED failure. This branch used to be silent: it set
                    # a 3s backoff and wrote NOTHING to the UI, so an endlessly
                    # failing connect showed only the backend banner repeating —
                    # indistinguishable from a hang, and the reason lived only in
                    # a console the user does not see (pythonw = no window).
                    # Any error we cannot name must still be shown.
                    self._conn_backoff = 3
                    _reason = err_str.strip().splitlines()[-1] if err_str.strip() else type(e).__name__
                    self.ui.write_log(f"ERR: {type(e).__name__} — {_reason[:180]}")
            finally:
                self.session = None
                # Only save if there was a real conversation (≥3 turns)
                if len(self._session_log) >= 3:
                    asyncio.create_task(self._save_session_summary())

            self.set_speaking(False)
            self.ui.set_state("SLEEPING")

            if self._dashboard:
                await self._dashboard.broadcast({"type": "status", "state": "sleeping"})

            delay = getattr(self, "_conn_backoff", 3)
            print(f"[JARVIS] Reconnecting in {delay}s...")
            await asyncio.sleep(delay)

def main():
    ui = JarvisUI("face.png")

    def runner():
        ui.wait_for_api_key()
        jarvis = JarvisLive(ui)
        try:
            asyncio.run(jarvis.run())
        except KeyboardInterrupt:
            print("\n🔴 Shutting down...")

    threading.Thread(target=runner, daemon=True).start()
    ui.root.mainloop()

if __name__ == "__main__":
    main()