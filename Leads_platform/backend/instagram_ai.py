"""
Instagram AI helpers — analyze posts, generate comments and DM offers.
"""
import json
import os
import httpx

OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")


async def _chat(messages: list, max_tokens: int = 400) -> str | None:
    if not OPENAI_KEY:
        return None
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={"model": "gpt-4o-mini", "messages": messages, "temperature": 0.4, "max_tokens": max_tokens},
                timeout=20,
            )
        return res.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


async def analyze_post(caption: str) -> dict:
    result = await _chat([
        {"role": "system", "content": (
            "Анализируй посты Instagram из Казахстана. "
            "Это пост малого бизнеса (кафе, салон, магазин, клиника, автосервис, стройка и т.п.)? "
            "Верни ТОЛЬКО JSON: {\"is_target\": true/false, \"language\": \"ru\" или \"kz\", \"business_type\": \"тип или другое\"}. "
            "is_target=false: крупный бренд, личный блог без бизнеса, политика, мемы, новости."
        )},
        {"role": "user", "content": caption[:800]},
    ], max_tokens=100)
    if not result:
        return {"is_target": True, "language": "ru", "business_type": "другое"}
    try:
        data = json.loads(result)
        return {"is_target": bool(data.get("is_target", True)), "language": data.get("language", "ru"), "business_type": data.get("business_type", "другое")}
    except Exception:
        return {"is_target": True, "language": "ru", "business_type": "другое"}


async def generate_comment(caption: str, business_type: str, language: str, author: str) -> str:
    lang = "на казахском" if language == "kz" else "на русском"
    result = await _chat([
        {"role": "system", "content": (
            f"Пиши живой комментарий под пост малого бизнеса Instagram. Бизнес: {business_type}. Язык: {lang}. "
            "Правила: 1-2 предложения, не рекламный, без упоминания BaiTech, живой тон от обычного подписчика, один вопрос про их работу. "
            "Верни ТОЛЬКО текст комментария."
        )},
        {"role": "user", "content": f"Пост: {caption[:500]}"},
    ], max_tokens=100)
    return result or "Интересный подход! Как давно вы в этой сфере?"


async def generate_dm_offer(reply_text: str, post_caption: str, business_type: str, language: str, author: str) -> str:
    lang = "на казахском" if language == "kz" else "на русском"
    result = await _chat([
        {"role": "system", "content": (
            f"Ты менеджер BaiTech (Атырау, AI-боты для WhatsApp/Telegram/Instagram). Бизнес: {business_type}. Язык: {lang}. "
            "Напиши ЛС-оффер 3-4 предложения: поблагодари за ответ, кратко что делает BaiTech (боты 24/7), "
            "спроси про боль (теряют клиентов/не успевают отвечать), предложи бесплатную консультацию. "
            "НЕ упоминай Instagram. Тон человеческий. Верни ТОЛЬКО текст."
        )},
        {"role": "user", "content": f"Их ответ: {reply_text}\nПост: {post_caption[:300]}"},
    ], max_tokens=200)
    return result or "Привет! Спасибо за ответ. Мы в BaiTech помогаем бизнесам автоматизировать ответы клиентам через бота — работает 24/7. Есть 15 минут на бесплатную консультацию?"
