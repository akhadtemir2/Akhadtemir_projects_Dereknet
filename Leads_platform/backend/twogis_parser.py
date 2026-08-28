"""
2GIS Parser — BaiTech Lead Hub

Finds small businesses in KZ with 1-2.5★ rating.
AI reads their reviews to detect "slow response / no reply" pain — our ICP signal.
Extracts phone numbers → saves to leads DB.

Setup:
  TWOGIS_API_KEY  — register free at https://dev.2gis.ru/account (catalog API)
  OPENAI_API_KEY  — for review analysis
"""
import asyncio
import json
import logging
import os
import random
from datetime import datetime

import httpx

logger = logging.getLogger("twogis_parser")

BACKEND = f"http://127.0.0.1:{os.getenv('PORT', '8000')}"
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
TWOGIS_KEY = os.getenv("TWOGIS_API_KEY", "")  # dev.2gis.ru/account → Каталог API

CATALOG_URL = "https://catalog.api.2gis.com/3.0/items"
REVIEWS_URL = "https://public-api.reviews.2gis.com/2.0/reviews"

# KZ cities (lon, lat)
CITIES = [
    {"id": "atyrau",   "name": "Атырау",   "lon": 51.8833, "lat": 47.1167},
    {"id": "almaty",   "name": "Алматы",   "lon": 76.8512, "lat": 43.2220},
    {"id": "astana",   "name": "Астана",   "lon": 71.4460, "lat": 51.1801},
    {"id": "aktobe",   "name": "Актобе",   "lon": 57.2062, "lat": 50.2797},
    {"id": "shymkent", "name": "Шымкент",  "lon": 69.5960, "lat": 42.3167},
]

BUSINESS_TYPES = [
    "кафе", "ресторан", "столовая", "доставка еды",
    "салон красоты", "барбершоп", "парикмахерская", "маникюр",
    "автосервис", "шиномонтаж", "автомойка",
    "стоматология", "клиника", "медицинский центр",
    "магазин", "аптека",
    "фитнес клуб", "учебный центр", "детский центр",
]

_state: dict = {
    "running": False,
    "task": None,
    "stats": {"scanned": 0, "leads_found": 0, "errors": 0, "pages": 0},
    "last_error": None,
    "last_run": None,
    "dedup_cache": set(),
}


# ── 2GIS Catalog API ──────────────────────────────────────────────────────────

async def _search_businesses(
    client: httpx.AsyncClient,
    query: str,
    lon: float,
    lat: float,
    page: int = 1,
    max_rating: float = 2.5,
) -> list[dict]:
    params = {
        "q": query,
        "location": f"{lon},{lat}",
        "radius": 30000,
        "key": TWOGIS_KEY,
        "page_size": 40,
        "page": page,
        "sort": "rating",
        "sort_dir": "asc",
        "fields": "items.point,items.contact_groups,items.reviews,items.org,items.rubrics,items.address",
        "locale": "ru_KZ",
        "type": "branch",
    }
    try:
        res = await client.get(CATALOG_URL, params=params, timeout=15)
        data = res.json()
        items = data.get("result", {}).get("items", [])
        filtered = []
        for item in items:
            rev = item.get("reviews") or {}
            rating = rev.get("general_rating") or 0
            count = rev.get("general_review_count") or 0
            if rating and 1.0 <= float(rating) <= max_rating and int(count) >= 3:
                filtered.append(item)
        return filtered
    except Exception as e:
        logger.error(f"2GIS search error [{query}]: {e}")
        _state["stats"]["errors"] += 1
        return []


async def _fetch_reviews(
    client: httpx.AsyncClient,
    org_id: str,
    limit: int = 15,
) -> list[dict]:
    try:
        res = await client.get(
            REVIEWS_URL,
            params={
                "object_id": org_id,
                "locale": "ru_KZ",
                "key": TWOGIS_KEY,
                "limit": limit,
                "sort": "date_edited",
                "order": "desc",
            },
            timeout=15,
        )
        return res.json().get("reviews", [])
    except Exception as e:
        logger.error(f"Reviews fetch error [{org_id}]: {e}")
        return []


def _extract_phone(item: dict) -> str | None:
    try:
        for group in item.get("contact_groups", []):
            for contact in group.get("contacts", []):
                if contact.get("type") == "phone":
                    v = contact.get("value", "").strip()
                    if v:
                        return v
    except Exception:
        pass
    return None


def _build_profile_url(item: dict) -> str | None:
    org_id = item.get("id", "")
    if not org_id:
        return None
    # City-less firm URL — 2GIS redirects to the right city itself
    # (was hardcoded /almaty/ and showed Almaty for Atyrau leads)
    return f"https://2gis.kz/firm/{org_id}"


# ── AI: review analysis ────────────────────────────────────────────────────────

_REVIEW_PROMPT = """Ты — аналитик BaiTech. BaiTech продаёт AI-чат-боты малому бизнесу КЗ.

Тебе дают название бизнеса и его отзывы из 2GIS. Задача:
Определить, являются ли ОСНОВНЫЕ жалобы связаны с ПЛОХОЙ КОММУНИКАЦИЕЙ:
— не отвечают / долго отвечают на звонки/сообщения
— недоступны по телефону
— игнорируют WhatsApp/Instagram/директ
— администратор не реагирует
— "позвонил — не взяли", "писал — тишина", "жду ответа несколько дней"
— плохой сервис приёма заявок

Верни ТОЛЬКО JSON (без markdown):
{
  "has_response_pain": true/false,
  "pain_score": 0-100,
  "pain_signals": ["цитата 1", "цитата 2"],
  "business_type": "тип бизнеса на русском",
  "detected_language": "ru / kz / mixed",
  "reasoning": "1 предложение"
}"""


async def _analyze_reviews(reviews: list[dict], biz_name: str) -> dict | None:
    if not OPENAI_KEY or not reviews:
        return None

    texts = []
    for r in reviews[:12]:
        rating = r.get("rating", "?")
        text = (r.get("text") or "").strip()
        if text:
            texts.append(f"[{rating}★] {text[:400]}")

    if not texts:
        return None

    user_msg = f"Бизнес: {biz_name}\n\nОтзывы:\n" + "\n\n".join(texts)

    try:
        async with httpx.AsyncClient() as c:
            res = await c.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": _REVIEW_PROMPT},
                        {"role": "user", "content": user_msg[:3500]},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                    "max_tokens": 350,
                },
                timeout=20,
            )
        return json.loads(res.json()["choices"][0]["message"]["content"])
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        return None


_OPENER_PROMPT = """Ты — менеджер BaiTech (Казахстан). BaiTech делает AI-чат-боты: бот сам отвечает клиентам в WhatsApp/Instagram 24/7.

Тебе дают: название бизнеса, тип бизнеса, 1-2 цитаты из отзывов про плохую связь.
Напиши ПЕРВОЕ сообщение в WhatsApp (холодный контакт):
— Зайди от ПОНЯТНОЙ боли в их сфере (не упоминай 2GIS и отзывы!)
— Максимум 2-3 предложения + 1 вопрос
— Живой тон, без официоза

Верни JSON: {"opener_ru": "...", "opener_kz": "..."}"""


async def _generate_opener(biz_name: str, biz_type: str, signals: list[str]) -> tuple[str, str]:
    if not OPENAI_KEY:
        ru = f"Здравствуйте! Знаю, что в сфере {biz_type} часто не успевают отвечать клиентам. BaiTech делает AI-бот, который сам отвечает 24/7. Сколько примерно сообщений в день приходит?"
        kz = f"Сәлеметсіз бе! {biz_type} саласында клиенттерге жауап беруге үлгермеу жиі кездеседі. BaiTech AI-боты 24/7 өзі жауап береді. Күніне шамамен қанша хабарлама келеді?"
        return ru, kz

    signals_text = " | ".join(signals[:2]) if signals else ""
    user_msg = f"Бизнес: {biz_name}\nТип: {biz_type}\nЦитаты из отзывов: {signals_text}"

    try:
        async with httpx.AsyncClient() as c:
            res = await c.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": _OPENER_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.3,
                    "max_tokens": 300,
                },
                timeout=15,
            )
        result = json.loads(res.json()["choices"][0]["message"]["content"])
        return result.get("opener_ru", ""), result.get("opener_kz", "")
    except Exception:
        return "", ""


async def _load_existing_ids() -> set:
    """Seed dedup cache from the DB so restarts never re-save the same orgs."""
    ids: set = set()
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{BACKEND}/leads?channel=2gis&limit=1000", timeout=10)
            leads = r.json().get("leads", [])
        for l in leads:
            pu = (l.get("profile_url") or "").rstrip("/")
            if "/firm/" in pu:
                ids.add(pu.split("/")[-1])  # org_id is the last path segment
            if l.get("phone"):
                ids.add(l["phone"])
    except Exception as e:
        logger.warning(f"Dedup preload failed: {e}")
    return ids


# ── Lead saver ─────────────────────────────────────────────────────────────────

async def _save_lead(item: dict, ai: dict, opener_ru: str, opener_kz: str, city_name: str):
    name = item.get("name", "Неизвестно")
    phone = _extract_phone(item)
    org_id = item.get("id", "")
    rev = item.get("reviews") or {}
    rating = rev.get("general_rating", 0)
    review_count = rev.get("general_review_count", 0)
    address = item.get("address_name", "") or item.get("address", {}).get("name", "")

    # Phone-level dedup: the same business can appear in several rubrics
    if phone and phone in _state["dedup_cache"]:
        return
    if phone:
        _state["dedup_cache"].add(phone)

    pain_score = ai.get("pain_score", 0)
    is_hot = ai.get("has_response_pain") and pain_score >= 60

    signals = ai.get("pain_signals", [])
    signals_str = " | ".join(signals[:2]) if signals else "—"

    notes_parts = [
        f"2GIS рейтинг: {rating}★ ({review_count} отзывов)",
        f"Город: {city_name}",
        f"Адрес: {address}" if address else None,
        f"Боль (из отзывов): {signals_str}",
        f"AI боль-скор: {pain_score}/100",
        f"opener:{opener_ru}" if opener_ru else None,
        f"opener_kz:{opener_kz}" if opener_kz else None,
    ]
    notes = "\n".join(p for p in notes_parts if p)

    lead_data = {
        "channel": "2gis",
        "name": name,
        "phone": phone,
        "profile_url": _build_profile_url(item),
        "business_type": ai.get("business_type", "неизвестно"),
        "language": "kz" if ai.get("detected_language") == "kz" else "ru",
        "status": "found",
        "source": "outbound",
        "last_message": signals_str[:200],
        "notes": notes,
        "is_hot": bool(is_hot),
        "notify": False,  # bulk scan → one summary at the end, not a per-lead storm
    }

    try:
        async with httpx.AsyncClient() as c:
            res = await c.post(f"{BACKEND}/leads", json=lead_data, timeout=10)
        if res.status_code == 201:
            _state["stats"]["leads_found"] += 1
            logger.info(f"✅ Lead: {name} | {rating}★ | pain={pain_score} | hot={is_hot} | {phone or '—'}")
        else:
            logger.warning(f"Lead save failed [{res.status_code}]: {name}")
    except Exception as e:
        logger.error(f"Lead save error [{name}]: {e}")
        _state["stats"]["errors"] += 1


# ── Scan loop ──────────────────────────────────────────────────────────────────

async def _scan_loop(
    cities: list[dict],
    business_types: list[str],
    min_reviews: int,
    max_rating: float,
    min_pain_score: int,
):
    _state["stats"] = {"scanned": 0, "leads_found": 0, "errors": 0, "pages": 0}
    try:
        await _do_scan(cities, business_types, min_reviews, max_rating, min_pain_score)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        # An unexpected crash must never leave running=True forever —
        # otherwise the UI shows "Сканирует" and start() refuses to restart
        _state["last_error"] = str(e)
        _state["stats"]["errors"] += 1
        logger.error(f"2GIS scan crashed: {e}")
    finally:
        _state["running"] = False
        _state["last_run"] = datetime.now().isoformat()
        found = _state["stats"]["leads_found"]
        logger.info(f"2GIS scan done | {_state['stats']}")
        # One summary notification instead of one-per-lead (which hit Telegram 429)
        if found:
            try:
                async with httpx.AsyncClient() as c:
                    await c.post(
                        f"{BACKEND}/telegram/notify",
                        params={"message": f"📍 2GIS: скан завершён — новых лидов: {found}. Смотри в CRM."},
                        timeout=10,
                    )
            except Exception:
                pass


async def _do_scan(
    cities: list[dict],
    business_types: list[str],
    min_reviews: int,
    max_rating: float,
    min_pain_score: int,
):
    _state["dedup_cache"] |= await _load_existing_ids()
    logger.info(f"2GIS scan started | cities={[c['name'] for c in cities]} | types={len(business_types)} | max_rating={max_rating}★ | dedup={len(_state['dedup_cache'])}")

    async with httpx.AsyncClient(
        headers={"User-Agent": "Mozilla/5.0 (compatible; BaiTechBot/1.0)"},
        follow_redirects=True,
    ) as client:
        for city in cities:
            if not _state["running"]:
                break
            for btype in business_types:
                if not _state["running"]:
                    break

                for page in range(1, 4):
                    if not _state["running"]:
                        break

                    businesses = await _search_businesses(
                        client, btype, city["lon"], city["lat"],
                        page=page, max_rating=max_rating,
                    )
                    _state["stats"]["pages"] += 1

                    if not businesses:
                        break  # no more pages

                    for biz in businesses:
                        if not _state["running"]:
                            break

                        org_id = biz.get("id", "")
                        if not org_id or org_id in _state["dedup_cache"]:
                            continue

                        _state["dedup_cache"].add(org_id)
                        _state["stats"]["scanned"] += 1

                        reviews = await _fetch_reviews(client, org_id)
                        await asyncio.sleep(random.uniform(0.5, 1.2))

                        if len(reviews) < min_reviews:
                            continue

                        ai = await _analyze_reviews(reviews, biz.get("name", ""))
                        if not ai:
                            continue

                        pain_score = ai.get("pain_score", 0)
                        if ai.get("has_response_pain") and pain_score >= min_pain_score:
                            signals = ai.get("pain_signals", [])
                            opener_ru, opener_kz = await _generate_opener(
                                biz.get("name", ""), ai.get("business_type", ""), signals
                            )
                            await _save_lead(biz, ai, opener_ru, opener_kz, city["name"])

                        await asyncio.sleep(random.uniform(1.5, 3.5))

                    await asyncio.sleep(random.uniform(2.0, 5.0))


# ── Public API ─────────────────────────────────────────────────────────────────

def status() -> dict:
    return {
        "running": _state["running"],
        "stats": _state["stats"],
        "last_error": _state["last_error"],
        "last_run": _state["last_run"],
        "api_key_set": bool(TWOGIS_KEY),
        "dedup_cache_size": len(_state["dedup_cache"]),
    }


async def start(
    city_ids: list[str] | None = None,
    business_types: list[str] | None = None,
    min_reviews: int = 3,
    max_rating: float = 2.5,
    min_pain_score: int = 40,
) -> tuple[bool, str]:
    if _state["running"]:
        return False, "Сканирование уже идёт"
    if not TWOGIS_KEY:
        return False, "TWOGIS_API_KEY не задан. Получите ключ на https://dev.2gis.ru/account (бесплатно, раздел «Каталог API»)"

    cities = [c for c in CITIES if not city_ids or c["id"] in city_ids]
    if not cities:
        cities = [CITIES[0]]  # Atyrau by default

    btypes = business_types or BUSINESS_TYPES

    _state["running"] = True
    _state["last_error"] = None
    _state["task"] = asyncio.create_task(
        _scan_loop(cities, btypes, min_reviews, max_rating, min_pain_score)
    )
    return True, (
        f"Запущено: {', '.join(c['name'] for c in cities)} | "
        f"{len(btypes)} типов бизнеса | max_rating={max_rating}★ | min_pain={min_pain_score}"
    )


async def stop() -> bool:
    _state["running"] = False
    t = _state.get("task")
    if t and not t.done():
        t.cancel()
    return True


async def scan_one(org_id: str) -> dict | None:
    """Test: analyze a single org by ID. Returns lead data or None."""
    async with httpx.AsyncClient() as client:
        reviews = await _fetch_reviews(client, org_id, limit=20)
    if not reviews:
        return {"error": "no reviews found"}
    ai = await _analyze_reviews(reviews, org_id)
    if not ai:
        return {"error": "AI analysis failed"}
    signals = ai.get("pain_signals", [])
    opener_ru, opener_kz = await _generate_opener(org_id, ai.get("business_type", ""), signals)
    return {**ai, "opener_ru": opener_ru, "opener_kz": opener_kz, "reviews_count": len(reviews)}
