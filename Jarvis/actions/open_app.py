"""
open_app — launch or focus a desktop application.

Design goals (fixes long-standing bugs):
  1. LAYOUT-INDEPENDENT.  Never type the app name via simulated keystrokes.
     pyautogui.write() sends physical scan-codes that pass through the CURRENT
     keyboard layout, so on a Russian/Kazakh layout "obsidian" became Cyrillic
     gibberish and nothing opened.  We now resolve a concrete launch target
     (Start-menu AUMID, .lnk shortcut, or executable on PATH) and start it
     directly — no typing, no active-layout dependency.
  2. FOCUS-IF-ALREADY-OPEN.  "Open Obsidian" when Obsidian is already running
     now brings the existing window to the front instead of doing nothing (or
     spawning a duplicate).  This is what the user actually means by "open".
  3. HONEST REPORTING.  The old code did `return True` unconditionally after the
     keystroke fallback, so JARVIS said "Opened, sir" when nothing happened.
     Every path now reports what really occurred: focused / opened / launching /
     not-found — never a blind success.
"""

import os
import re
import time
import shutil
import subprocess
import platform
from pathlib import Path

_SYSTEM = platform.system()

# Optional helpers — all confirmed available in the project's Python313, but we
# degrade gracefully if any is missing.
try:
    import psutil
    _PSUTIL = True
except Exception:
    _PSUTIL = False

try:
    import pygetwindow as _gw
    _PYGETWINDOW = True
except Exception:
    _PYGETWINDOW = False

if _SYSTEM == "Windows":
    _NO_WINDOW = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
else:
    _NO_WINDOW = {}


_APP_ALIASES: dict[str, dict[str, str]] = {

    "chrome":             {"Windows": "chrome",                  "Darwin": "Google Chrome",        "Linux": "google-chrome"},
    "google chrome":      {"Windows": "chrome",                  "Darwin": "Google Chrome",        "Linux": "google-chrome"},
    "firefox":            {"Windows": "firefox",                 "Darwin": "Firefox",              "Linux": "firefox"},
    "edge":               {"Windows": "msedge",                  "Darwin": "Microsoft Edge",       "Linux": "microsoft-edge"},
    "brave":              {"Windows": "brave",                   "Darwin": "Brave Browser",        "Linux": "brave-browser"},
    "safari":             {"Windows": "msedge",                  "Darwin": "Safari",               "Linux": "firefox"},
    "opera":              {"Windows": "opera",                   "Darwin": "Opera",                "Linux": "opera"},
    "whatsapp":           {"Windows": "WhatsApp",                "Darwin": "WhatsApp",             "Linux": "whatsapp"},
    "telegram":           {"Windows": "Telegram",                "Darwin": "Telegram",             "Linux": "telegram"},
    "discord":            {"Windows": "Discord",                 "Darwin": "Discord",              "Linux": "discord"},
    "slack":              {"Windows": "Slack",                   "Darwin": "Slack",                "Linux": "slack"},
    "zoom":               {"Windows": "Zoom",                    "Darwin": "zoom.us",              "Linux": "zoom"},
    "teams":              {"Windows": "msteams",                 "Darwin": "Microsoft Teams",      "Linux": "teams"},
    "skype":              {"Windows": "skype",                   "Darwin": "Skype",                "Linux": "skype"},
    "signal":             {"Windows": "signal",                  "Darwin": "Signal",               "Linux": "signal"},
    "spotify":            {"Windows": "Spotify",                 "Darwin": "Spotify",              "Linux": "spotify"},
    "vlc":                {"Windows": "vlc",                     "Darwin": "VLC",                  "Linux": "vlc"},
    "netflix":            {"Windows": "Netflix",                 "Darwin": "Netflix",              "Linux": "firefox"},
    "vscode":             {"Windows": "code",                    "Darwin": "Visual Studio Code",   "Linux": "code"},
    "visual studio code": {"Windows": "code",                    "Darwin": "Visual Studio Code",   "Linux": "code"},
    "code":               {"Windows": "code",                    "Darwin": "Visual Studio Code",   "Linux": "code"},
    "terminal":           {"Windows": "wt",                      "Darwin": "Terminal",             "Linux": "x-terminal-emulator"},
    "cmd":                {"Windows": "cmd.exe",                 "Darwin": "Terminal",             "Linux": "bash"},
    "powershell":         {"Windows": "powershell.exe",          "Darwin": "Terminal",             "Linux": "bash"},
    "postman":            {"Windows": "Postman",                 "Darwin": "Postman",              "Linux": "postman"},
    "git":                {"Windows": "git-bash",                "Darwin": "Terminal",             "Linux": "bash"},
    "figma":              {"Windows": "Figma",                   "Darwin": "Figma",                "Linux": "figma"},
    "blender":            {"Windows": "blender",                 "Darwin": "Blender",              "Linux": "blender"},
    "word":               {"Windows": "winword",                 "Darwin": "Microsoft Word",       "Linux": "libreoffice --writer"},
    "excel":              {"Windows": "excel",                   "Darwin": "Microsoft Excel",      "Linux": "libreoffice --calc"},
    "powerpoint":         {"Windows": "powerpnt",                "Darwin": "Microsoft PowerPoint", "Linux": "libreoffice --impress"},
    "libreoffice":        {"Windows": "soffice",                 "Darwin": "LibreOffice",          "Linux": "libreoffice"},
    "notepad":            {"Windows": "notepad.exe",             "Darwin": "TextEdit",             "Linux": "gedit"},
    "textedit":           {"Windows": "notepad.exe",             "Darwin": "TextEdit",             "Linux": "gedit"},
    "explorer":           {"Windows": "explorer.exe",            "Darwin": "Finder",               "Linux": "nautilus"},
    "file explorer":      {"Windows": "explorer.exe",            "Darwin": "Finder",               "Linux": "nautilus"},
    "finder":             {"Windows": "explorer.exe",            "Darwin": "Finder",               "Linux": "nautilus"},
    "task manager":       {"Windows": "taskmgr.exe",             "Darwin": "Activity Monitor",     "Linux": "gnome-system-monitor"},
    "settings":           {"Windows": "ms-settings:",            "Darwin": "System Preferences",   "Linux": "gnome-control-center"},
    "calculator":         {"Windows": "calc.exe",                "Darwin": "Calculator",           "Linux": "gnome-calculator"},
    "paint":              {"Windows": "mspaint.exe",             "Darwin": "Preview",              "Linux": "gimp"},
    "instagram":          {"Windows": "Instagram",               "Darwin": "Instagram",            "Linux": "firefox"},
    "tiktok":             {"Windows": "TikTok",                  "Darwin": "TikTok",               "Linux": "firefox"},
    "notion":             {"Windows": "Notion",                  "Darwin": "Notion",               "Linux": "notion"},
    "obsidian":           {"Windows": "Obsidian",                "Darwin": "Obsidian",             "Linux": "obsidian"},
    "capcut":             {"Windows": "CapCut",                  "Darwin": "CapCut",               "Linux": "capcut"},
    "steam":              {"Windows": "steam",                   "Darwin": "Steam",                "Linux": "steam"},
    "epic":               {"Windows": "EpicGamesLauncher",       "Darwin": "Epic Games Launcher",  "Linux": "legendary"},
    "epic games":         {"Windows": "EpicGamesLauncher",       "Darwin": "Epic Games Launcher",  "Linux": "legendary"},

    # ── Russian / Kazakh spoken names (JARVIS's user speaks RU/KZ) ──────────
    "проводник":          {"Windows": "explorer.exe",            "Darwin": "Finder",               "Linux": "nautilus"},
    "калькулятор":        {"Windows": "calc.exe",                "Darwin": "Calculator",           "Linux": "gnome-calculator"},
    "блокнот":            {"Windows": "notepad.exe",             "Darwin": "TextEdit",             "Linux": "gedit"},
    "настройки":          {"Windows": "ms-settings:",            "Darwin": "System Preferences",   "Linux": "gnome-control-center"},
    "параметры":          {"Windows": "ms-settings:",            "Darwin": "System Preferences",   "Linux": "gnome-control-center"},
    "параметрлер":        {"Windows": "ms-settings:",            "Darwin": "System Preferences",   "Linux": "gnome-control-center"},
    "диспетчер задач":    {"Windows": "taskmgr.exe",             "Darwin": "Activity Monitor",     "Linux": "gnome-system-monitor"},
    "панель управления":  {"Windows": "control.exe",             "Darwin": "System Preferences",   "Linux": "gnome-control-center"},
    "браузер":            {"Windows": "chrome",                  "Darwin": "Google Chrome",        "Linux": "google-chrome"},
    "камера":             {"Windows": "WindowsCamera",           "Darwin": "Photo Booth",          "Linux": "cheese"},
    "музыка":             {"Windows": "Spotify",                 "Darwin": "Music",                "Linux": "spotify"},
    "почта":              {"Windows": "outlookforwindows",       "Darwin": "Mail",                 "Linux": "thunderbird"},
    "ворд":               {"Windows": "winword",                 "Darwin": "Microsoft Word",       "Linux": "libreoffice --writer"},
    "эксель":             {"Windows": "excel",                   "Darwin": "Microsoft Excel",      "Linux": "libreoffice --calc"},
    "телеграм":           {"Windows": "Telegram",                "Darwin": "Telegram",             "Linux": "telegram"},
    "ватсап":             {"Windows": "WhatsApp",                "Darwin": "WhatsApp",             "Linux": "whatsapp"},
    # 1С — the launcher / thin client both live under the platform bin dir.
    "1c":                 {"Windows": "1cv8",                    "Darwin": "",                     "Linux": ""},
    "1с":                 {"Windows": "1cv8",                    "Darwin": "",                     "Linux": ""},
    "1c enterprise":      {"Windows": "1cv8",                    "Darwin": "",                     "Linux": ""},
    "1с предприятие":     {"Windows": "1cv8",                    "Darwin": "",                     "Linux": ""},
    "предприятие":        {"Windows": "1cv8",                    "Darwin": "",                     "Linux": ""},
    "one c":              {"Windows": "1cv8",                    "Darwin": "",                     "Linux": ""},
}

# Vendor / filler words that make bad window-title or process tokens.
_GENERIC_WORDS = {
    "desktop", "app", "the", "for", "microsoft", "google", "games", "launcher",
    "inc", "llp", "ltd", "and", "store", "preview", "beta",
}


def _normalize(raw: str) -> str:
    key = raw.lower().strip()
    if key in _APP_ALIASES:
        return _APP_ALIASES[key].get(_SYSTEM, raw)
    for alias_key, os_map in _APP_ALIASES.items():
        if alias_key in key or key in alias_key:
            return os_map.get(_SYSTEM, raw)
    return raw


def _match_tokens(app_name: str, normalized: str, canonical: str = "") -> list[str]:
    """FULL-name lowercase tokens used to recognise an app's window.

    Deliberately does NOT split names into sub-words: fragments like 'real' or
    'app' matched unrelated window titles and produced false "already open"
    focuses.  Only whole, specific names (the request and the canonical
    Start-menu name, e.g. 'Visual Studio Code') are used, min length 4 so short
    ambiguous substrings like 'git' can't match 'GitHub …'.
    """
    toks: list[str] = []
    for cand in (app_name, canonical):
        c = (cand or "").lower().strip().split(":")[0].strip()
        if c.endswith(".exe"):
            c = c[:-4]
        if len(c) >= 4 and c not in _GENERIC_WORDS and c not in toks:
            toks.append(c)
    return toks


# ── Windows: window focus (the "switch to already-open app" behaviour) ──────────

def _win_find_window(tokens: list[str]):
    """Return the first visible top-level window whose title matches a token."""
    if _PYGETWINDOW:
        try:
            for w in _gw.getAllWindows():
                title = (getattr(w, "title", "") or "").strip()
                if not title:
                    continue
                low = title.lower()
                if any(t in low for t in tokens):
                    return w
        except Exception:
            pass
    return None


def _win_process_running(tokens: list[str]) -> bool:
    if not _PSUTIL:
        return False
    try:
        for p in psutil.process_iter(["name"]):
            name = (p.info.get("name") or "").lower()
            if any(t in name for t in tokens):
                return True
    except Exception:
        pass
    return False


def _win_focus(tokens: list[str]) -> bool:
    """Bring an already-open window matching *tokens* to the foreground."""
    w = _win_find_window(tokens)
    if w is None:
        return False
    try:
        if getattr(w, "isMinimized", False):
            w.restore()
        else:
            w.activate()
        return True
    except Exception:
        # Foreground-lock workaround: a minimize→restore cycle reliably raises
        # the window without SetForegroundWindow's focus-stealing restrictions.
        try:
            w.minimize()
            time.sleep(0.12)
            w.restore()
            return True
        except Exception:
            return False


def _win_wait_appeared(tokens: list[str], timeout: float = 4.0) -> bool:
    """Poll (without stealing focus) until a matching window/process shows up."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _win_find_window(tokens) is not None or _win_process_running(tokens):
            return True
        time.sleep(0.25)
    return False


# ── Windows: resolve a concrete launch target (no typing) ───────────────────────

_startapps_cache: tuple[float, list[tuple[str, str]]] | None = None


def _win_start_apps() -> list[tuple[str, str]]:
    """(Name, AppID) for every Start-menu app — desktop AND Store/UWP.

    This is exactly the catalogue the Start menu itself launches from, so it is
    the most reliable, layout-independent way to start apps by name.
    """
    global _startapps_cache
    now = time.monotonic()
    if _startapps_cache and (now - _startapps_cache[0]) < 60:
        return _startapps_cache[1]

    apps: list[tuple[str, str]] = []
    try:
        ps = "Get-StartApps | Select-Object Name,AppID | ConvertTo-Csv -NoTypeInformation"
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, text=True, errors="replace", timeout=8, **_NO_WINDOW,
        )
        for line in (out.stdout or "").splitlines():
            line = line.strip()
            if not line or line.lower().startswith('"name"'):
                continue
            # CSV: "Name","AppID"  — split on the '","' seam
            if '","' in line:
                name, appid = line.split('","', 1)
                name = name.lstrip('"').strip()
                appid = appid.rstrip('"').strip()
                if name and appid:
                    apps.append((name, appid))
    except Exception as e:
        print(f"[open_app] Get-StartApps failed: {e}")

    _startapps_cache = (now, apps)
    return apps


def _win_match_appid(app_name: str, normalized: str, fuzzy: bool = False) -> tuple[str, str] | None:
    """Best (Name, AppID) match for the requested app, or None.

    With fuzzy=False (default) only exact and substring matches are returned —
    these are safe.  Fuzzy ratio matching is opt-in and guarded by a shared-prefix
    check, because a loose ratio once mapped 'calc.exe' → 'CapCut'.
    """
    apps = _win_start_apps()
    if not apps:
        return None

    cands = {c.lower().strip() for c in (app_name, normalized) if c and c.strip()}

    # 1. exact name match
    for name, appid in apps:
        if name.lower().strip() in cands:
            return (name, appid)
    # 2. substring either direction (min length 3 to avoid noise)
    for name, appid in apps:
        nl = name.lower().strip()
        if any((len(c) >= 3 and (c in nl or nl in c)) for c in cands):
            return (name, appid)

    if not fuzzy:
        return None

    # 3. fuzzy ratio — last resort, guarded so unrelated names can't win.
    import difflib
    query = (app_name or normalized or "").lower().strip()
    q4 = query[:4]
    best, best_ratio = None, 0.0
    for name, appid in apps:
        nl = name.lower()
        # guard: require a shared 4-char prefix in either direction
        if q4 and q4 not in nl and nl[:4] not in query:
            continue
        r = difflib.SequenceMatcher(None, query, nl).ratio()
        if r > best_ratio:
            best, best_ratio = (name, appid), r
    return best if best_ratio >= 0.72 else None


_START_MENU_DIRS = [
    Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft/Windows/Start Menu/Programs",
    Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
]


def _win_find_lnk(app_name: str, normalized: str) -> Path | None:
    cands = [c.lower().strip() for c in (app_name, normalized) if c and c.strip()]
    for root in _START_MENU_DIRS:
        if not root or not root.exists():
            continue
        try:
            for lnk in root.rglob("*.lnk"):
                stem = lnk.stem.lower()
                if any(c == stem or c in stem or stem in c for c in cands):
                    return lnk
        except Exception:
            continue
    return None


def _launch_aumid(appid: str) -> None:
    subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{appid}"], **_NO_WINDOW)


def _confirm(tokens: list[str], pretty: str, timeout: float = 4.0) -> tuple[str, str]:
    """After a launch command succeeded, report honestly based on what appears."""
    if _win_wait_appeared(tokens, timeout=timeout):
        _win_focus(tokens)
        return "opened", f"Opened {pretty}."
    # The launch command was issued without error but no window confirmed yet.
    return "launching", f"Launching {pretty} now."


def _launch_windows(app_name: str, normalized: str) -> tuple[str, str]:
    """Return (status, human_message).  status ∈ focused|opened|launching|failed."""
    # ── File Explorer special-case ──────────────────────────────────────────
    # explorer.exe is the always-running desktop shell, so the generic "is it
    # running?" confirmation is meaningless and bare `explorer.exe` under
    # CREATE_NO_WINDOW was unreliable. Open a real window straight to This PC.
    _low = f"{app_name} {normalized}".lower()
    if "explorer.exe" in _low or "проводник" in _low or "file explorer" in _low \
            or normalized.lower() == "explorer":
        try:
            os.startfile("shell:MyComputerFolder")  # type: ignore[attr-defined]
            return "opened", "Opened File Explorer."
        except Exception as e:
            print(f"[open_app] explorer open failed: {e}")
            # fall through to the generic path

    # ── 1С:Предприятие special-case ──────────────────────────────────────────
    # The platform registers in the Start menu under LATIN "1C Enterprise …"
    # while the user says CYRILLIC "1С" (Cyrillic 'с' ≠ Latin 'c'), and the real
    # exe is 1cv8t.exe / 1cv8.exe — never literally "1cv8". Generic name / AUMID /
    # .lnk matching therefore misses it and returns a false "not installed".
    # Delegate to onec_control's launcher, which locates the real exe via the
    # install dirs + registry (verified path: …\1cv8t\8.3.27.1508\bin\1cv8t.exe).
    _hay = f"{app_name} {normalized}".lower()
    if normalized == "1cv8" or "1cv8" in _hay or "предприят" in _hay \
            or app_name.strip().lower() in ("1c", "1с", "one c",
                                            "1c enterprise", "1с предприятие"):
        try:
            from actions.onec_control import _find_onec_exe
            exe = _find_onec_exe()
            if exe:
                subprocess.Popen([str(exe)], **_NO_WINDOW)
                # 1С process is 1cv8*.exe; window titles are "1С:Предприятие" /
                # "Бухгалтерия …" — feed _confirm real tokens so it detects the
                # launch instead of the empty-token list the generic path built.
                return _confirm(["1cv8", "предприят", "бухгалтер"],
                                "1С:Предприятие", timeout=6.0)
            print("[open_app] 1C requested but no 1cv8[t].exe found on disk")
        except Exception as e:
            print(f"[open_app] 1C delegate failed: {e}")
        # If delegation failed, fall through to the generic path (may still work).

    # Resolve the app's identity first (safe exact/substring match). The canonical
    # Start-menu name gives us the best window-title tokens AND the launch AUMID.
    match = _win_match_appid(app_name, normalized, fuzzy=False)
    canonical = match[0] if match else ""
    tokens = _match_tokens(app_name, normalized, canonical)
    pretty = (canonical or app_name).strip()

    # 1) Already open?  Bring it to the front — this is what "open X" means when X
    #    is running, and it never spawns a confusing duplicate.
    if _win_focus(tokens):
        return "focused", f"{pretty} is already open — I brought it to the front."

    # 2) Protocol / URI target (e.g. ms-settings:) — start directly.
    if ":" in normalized and not normalized.lower().endswith(".exe"):
        try:
            os.startfile(normalized)  # type: ignore[attr-defined]
            return "opened", f"Opened {pretty}."
        except Exception as e:
            print(f"[open_app] protocol start failed: {e}")

    # 3) Start-menu app (AUMID) — covers Store apps and most desktop apps.
    if match:
        try:
            _launch_aumid(match[1])
            return _confirm(tokens, pretty)
        except Exception as e:
            print(f"[open_app] AUMID launch failed ({match[1]}): {e}")

    # 4) Executable on PATH / system stub (notepad.exe, calc.exe, cmd.exe, code…).
    exe = shutil.which(normalized) or shutil.which(normalized.split(".")[0])
    if exe:
        try:
            subprocess.Popen([exe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **_NO_WINDOW)
            return _confirm(tokens, pretty, timeout=3.0)
        except Exception as e:
            print(f"[open_app] exe launch failed: {e}")

    # 5) Start-menu shortcut (.lnk) — os.startfile focuses single-instance apps.
    lnk = _win_find_lnk(app_name, normalized)
    if lnk:
        try:
            os.startfile(str(lnk))  # type: ignore[attr-defined]
            return _confirm(tokens, pretty)
        except Exception as e:
            print(f"[open_app] .lnk launch failed: {e}")

    # 6) Guarded fuzzy AUMID — last resort before giving up (never maps to junk).
    fmatch = _win_match_appid(app_name, normalized, fuzzy=True)
    if fmatch:
        try:
            _launch_aumid(fmatch[1])
            return _confirm(_match_tokens(app_name, normalized, fmatch[0]), fmatch[0].strip())
        except Exception as e:
            print(f"[open_app] fuzzy AUMID launch failed ({fmatch[1]}): {e}")

    # 7) Honest failure — no more fake "Opened, sir".
    return "failed", (
        f"I couldn't find {app_name.strip().title()} installed on this PC. "
        f"Tell me its exact name, or say 'search the web for {app_name.strip()}' to open it online."
    )


def _launch_macos(app_name: str) -> tuple[str, str]:
    pretty = app_name.strip()
    for target in (app_name, f"{app_name}.app"):
        try:
            result = subprocess.run(["open", "-a", target], capture_output=True, timeout=8)
            if result.returncode == 0:
                return "opened", f"Opened {pretty}."
        except Exception:
            pass
    binary = shutil.which(app_name) or shutil.which(app_name.lower())
    if binary:
        try:
            subprocess.Popen([binary], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return "opened", f"Opened {pretty}."
        except Exception:
            pass
    return "failed", f"I couldn't find {pretty} installed on this Mac."


_LINUX_TERMINAL_FALLBACKS = [
    "x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal",
    "xterm", "lxterminal", "mate-terminal", "tilix", "alacritty", "kitty",
]


def _launch_linux(app_name: str) -> tuple[str, str]:
    pretty = app_name.strip()
    if app_name in ("x-terminal-emulator", "gnome-terminal", "terminal"):
        for term in _LINUX_TERMINAL_FALLBACKS:
            if shutil.which(term):
                try:
                    subprocess.Popen([term], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return "opened", f"Opened {pretty}."
                except Exception:
                    continue
    binary = (
        shutil.which(app_name)
        or shutil.which(app_name.lower())
        or shutil.which(app_name.lower().replace(" ", "-"))
        or shutil.which(app_name.lower().replace(" ", "_"))
    )
    if binary:
        try:
            subprocess.Popen([binary], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return "opened", f"Opened {pretty}."
        except Exception:
            pass
    for desktop_name in [app_name.lower(), app_name.lower().replace(" ", "-"), app_name.lower().replace(" ", "")]:
        try:
            result = subprocess.run(["gtk-launch", desktop_name], capture_output=True, timeout=5)
            if result.returncode == 0:
                return "opened", f"Opened {pretty}."
        except Exception:
            pass
    try:
        subprocess.run(["xdg-open", app_name], capture_output=True, timeout=5)
        return "launching", f"Launching {pretty} now."
    except Exception:
        pass
    return "failed", f"I couldn't find {pretty} installed on this system."


# ── Close a named app's WINDOW(S) — targeted + verified ─────────────────────────
# Why this exists: "закрой проводник" used to send a blind Ctrl+W to whatever had
# focus (closing one Explorer TAB, not the window) and then report success even
# when nothing closed. This resolves the NAMED app to its real windows, closes
# them, and confirms they are gone before claiming success.

_EXPLORER_CLASSES = {"CabinetWClass", "ExploreWClass"}
_EXPLORER_WORDS   = ("explorer", "проводник", "file explorer", "finder", "жетекші")
_CLOSE_VERBS_RE   = re.compile(
    r"^\s*(close|quit|exit|shut\s*down|kill|закрой\w*|закрыть|жап\w*|жабу?)\s+",
    re.IGNORECASE,
)


def _win_enum_top_windows() -> list[tuple[int, str, str]]:
    """[(hwnd, title, class_name)] for every visible top-level window."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    user32.IsWindowVisible.argtypes    = [wintypes.HWND]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes     = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.argtypes      = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

    out: list[tuple[int, str, str]] = []
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def _cb(hwnd, _lparam):
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            n = user32.GetWindowTextLengthW(hwnd)
            tbuf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, tbuf, n + 1)
            cbuf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, cbuf, 256)
            out.append((int(hwnd), tbuf.value, cbuf.value))
        except Exception:
            pass
        return True

    user32.EnumWindows(WNDENUMPROC(_cb), 0)
    return out


def _win_post_close(hwnd: int) -> None:
    """Ask a window to close gracefully (WM_CLOSE) — never force-kills."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW(wintypes.HWND(hwnd), 0x0010, 0, 0)   # WM_CLOSE


def _win_close_by_name(app_name: str, normalized: str) -> tuple[str, str]:
    low = f"{app_name} {normalized}".lower()
    is_explorer = (any(w in low for w in _EXPLORER_WORDS)
                   or normalized.lower() in ("explorer", "explorer.exe"))
    tokens = [t for t in _match_tokens(app_name, normalized)
              if t not in ("close", "закрой")]
    pretty = "File Explorer" if is_explorer else (tokens[0].title() if tokens else app_name.strip())

    def _match(title: str, cls: str) -> bool:
        if is_explorer:
            return cls in _EXPLORER_CLASSES
        tl = (title or "").lower()
        return bool(title) and any(t in tl for t in tokens)

    wins = [(h, t, c) for (h, t, c) in _win_enum_top_windows() if _match(t, c)]
    if not wins:
        return "not_open", f"I don't see an open {pretty} window — nothing to close."

    for h, _t, _c in wins:
        try:
            _win_post_close(h)
        except Exception as e:
            print(f"[open_app] close post failed: {e}")

    # WM_CLOSE is asynchronous, and an app may raise a "save changes?" dialog and
    # refuse — so VERIFY the windows are actually gone before claiming success.
    remaining = wins
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and remaining:
        time.sleep(0.25)
        live = {h for (h, _t, _c) in _win_enum_top_windows()}
        remaining = [w for w in remaining if w[0] in live]

    if not remaining:
        n = len(wins)
        return "closed", f"Closed {pretty}{'' if n == 1 else f' — {n} windows'}."
    return "partial", (
        f"I asked {pretty} to close but {len(remaining)} window(s) stayed open — "
        f"it is probably waiting on a save/confirm prompt. I did not force-kill it."
    )


def close_app(app_name: str) -> str:
    """Close a NAMED application's window(s) and verify. Cross-platform."""
    name = _CLOSE_VERBS_RE.sub("", (app_name or "").strip()).strip() or (app_name or "").strip()
    if not name:
        return "No application name given to close."
    normalized = _normalize(name)

    if _SYSTEM == "Windows":
        try:
            return _win_close_by_name(name, normalized)[1]
        except Exception as e:
            print(f"[open_app] close_app error: {e}")
            return f"Could not close {name}: {e}"

    if _SYSTEM == "Darwin":
        try:
            r = subprocess.run(["osascript", "-e", f'tell application "{name}" to quit'],
                               capture_output=True, timeout=8)
            return f"Closed {name}." if r.returncode == 0 else f"Could not close {name}."
        except Exception as e:
            return f"Could not close {name}: {e}"

    try:
        r = subprocess.run(["wmctrl", "-c", name], capture_output=True, timeout=5)
        return f"Closed {name}." if r.returncode == 0 else f"Could not close {name}."
    except Exception as e:
        return f"Could not close {name}: {e}"


def open_app(
    parameters=None,
    response=None,
    player=None,
    session_memory=None,
) -> str:
    app_name = (parameters or {}).get("app_name", "").strip()
    if not app_name:
        return "No application name provided."

    normalized = _normalize(app_name)
    print(f"[open_app] Request: '{app_name}' → '{normalized}' ({_SYSTEM})")
    if player:
        player.write_log(f"[open_app] {app_name}")

    try:
        if _SYSTEM == "Windows":
            status, message = _launch_windows(app_name, normalized)
        elif _SYSTEM == "Darwin":
            status, message = _launch_macos(normalized)
            if status == "failed" and normalized.lower() != app_name.lower():
                status, message = _launch_macos(app_name)
        elif _SYSTEM == "Linux":
            status, message = _launch_linux(normalized)
            if status == "failed" and normalized.lower() != app_name.lower():
                status, message = _launch_linux(app_name)
        else:
            return f"Unsupported operating system: {_SYSTEM}"

        print(f"[open_app] → {status}: {message}")
        if player:
            player.write_log(f"[open_app] {status}")
        return message
    except Exception as e:
        print(f"[open_app] Error: {e}")
        return f"Failed to open {app_name}: {e}"
