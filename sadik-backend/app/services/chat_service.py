import logging
from typing import Optional
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# ── System prompts ─────────────────────────────────────────────────────────────

# Used for text-based chat — allows full responses but forbids emojis.
SYSTEM_PROMPT = (
    "Sen SADIK adında bir masaüstü asistanısın. Türkçe konuşuyorsun. "
    "Yardımsever, sıcak ve samimi bir kişiliğin var. Kısa ve öz cevaplar vermeyi tercih ediyorsun. "
    "Asla emoji kullanma. Yanıtlarında hiçbir emoji veya özel karakter olmasın."
)

# Used for voice-mode chat — enforces short, natural, speakable responses.
VOICE_SYSTEM_PROMPT = (
    "Sen SADIK adında bir masaüstü asistanısın. Türkçe konuşuyorsun. "
    "Bu bir sesli konuşma. Çok kısa ve doğal cevaplar ver. En fazla 2-3 cümle kullan. "
    "Emoji kullanma. Listelemeler yapma. Madde işaretleri kullanma. "
    "Doğal konuşma dili kullan. Düz metin yaz."
)


class ChatService:
    async def send_message(
        self,
        user_content: str,
        history: list[dict],
        api_key: str,
        model: str = "gpt-4o-mini",
        voice_mode: bool = False,
        user_name: str = "",
        greeting_style: str = "",
    ) -> Optional[str]:
        if not api_key:
            return "OpenAI API anahtarı ayarlanmamış. Lütfen ayarlardan API anahtarınızı girin."
        try:
            client = AsyncOpenAI(api_key=api_key)
            recent = history[-20:] if len(history) > 20 else history
            system = VOICE_SYSTEM_PROMPT if voice_mode else SYSTEM_PROMPT
            # Append personalization suffix only when values are configured.
            persona_parts = []
            if user_name:
                persona_parts.append(f"Kullanıcının adı {user_name}.")
            if greeting_style:
                persona_parts.append(f"Ona '{greeting_style}' diye hitap et.")
            if persona_parts:
                system = system + "\n\n" + " ".join(persona_parts)
            messages = [{"role": "system", "content": system}]
            messages.extend(recent)
            messages.append({"role": "user", "content": user_content})
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"OpenAI chat error: {e}")
            return f"Bir hata oluştu: {str(e)}"


chat_service = ChatService()
