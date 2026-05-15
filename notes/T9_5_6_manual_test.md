# T9.5.6 Manual Test Checklist — Voice V2 Frontend

## Setup
- `npm run dev:electron` ile başlat
- Settings sayfası → `gemini_api_key` set et (Google AI Studio key)
- Mikrofon cihazı seç (Settings → Audio Input)

## Happy path — chat turn
- [ ] Wakeword "Sadık" söyle
- [ ] OLED/animasyon: waking → listening klip
- [ ] Konuş: "Merhaba nasılsın?"
- [ ] VAD sessizliği algılar → 800ms post-roll → `end_of_turn` gönderilir
- [ ] State: thinking (düşünüyor animasyonu)
- [ ] Gemini ses gelir → state: speaking (konuşuyor animasyonu)
- [ ] Ses biter → state: idle, wakeword tekrar aktif
- [ ] DevTools Network: `/api/voice/live` WS tek seferlik açıldı (bir wakeword başına)

## Happy path — tool turn
- [ ] Wakeword → "Bugünkü görevlerimi listele"
- [ ] VAD end_of_turn → state: thinking
- [ ] Backend tool path: ses gelmez (mute)
- [ ] `tool_result` event gelir, `status: "ok"` → `confirmation_success` event → confirming klip
- [ ] Kısa bekleme → state: idle

## Cost discipline — wakeword false positive
- [ ] Wakeword tetikle ama 2 saniye sessiz kal (konuşma)
- [ ] 2s grace timer tetiklenir → WS otomatik kapanır, state: idle
- [ ] DevTools: WS açıldı ve 2s sonra kapandı

## Continuous mode
- [ ] Settings → Sürekli Konuşma: ON
- [ ] Wakeword → 1. cümle → cevap gelir → state: listening (WS hâlâ açık)
- [ ] 2. cümle söyle → aynı session içinde 2. turn
- [ ] Konuşma biter (wakeword değil, cancel ile) → idle

## Error path
- [ ] Geçersiz gemini_api_key ile bağlan → error mesaj gösterilir, state: idle
- [ ] WS kapandıktan sonra otomatik reconnect YOK (yeni wakeword gerekli)

## Cancel
- [ ] Listening sırasında X butonuna bas → state: idle anında
- [ ] Thinking sırasında X → state: idle
- [ ] Speaking sırasında X → ses durur, state: idle
- [ ] Escape tuşu → herhangi aktif state'den idle'a

## Settings sayfası kontrol
- [ ] `voice_v2_enabled` toggle YOK
- [ ] ElevenLabs key alanı YOK
- [ ] TTS provider seçici YOK
- [ ] `gemini_api_key` alanı VAR

## DevTools console
- [ ] Zero error (sadece beklenen mesajlar: VAD warm-up, stream logs)
- [ ] WS logları: [VoiceLive] prefixli, trigger source görünür
- [ ] ScriptProcessor deprecation warning YOK (ScriptProcessor tamamen kaldırıldı)
- [ ] Mimari: tek AudioContext (VAD internal), tek mic stream tüketicisi
  - PCM: MicVAD.onFrameProcessed → 16kHz Float32 → Int16Array → voiceLiveService.pipeMicChunk

## Network tab
- [ ] `/api/voice/live` WS tek seferlik açılıyor
- [ ] `/api/voice/stt` endpoint isteği YOK (V1 dead)
- [ ] Audio chunks base64 JSON üzerinden gidiyor (binary değil)
