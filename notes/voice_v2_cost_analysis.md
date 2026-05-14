# Voice V2 — Gemini Live Maliyet Analizi

Sprint 9.5 T9.5.1 | Tarih: 2026-05-14

---

## Gemini Live API Pricing (kaynak: Google AI pricing sayfası, Mayıs 2026)

Model: `gemini-2.0-flash-live-001` (ya da `gemini-live-2.5-flash` — aynı tier)

| Kalem | Fiyat |
|---|---|
| Ses giriş (kullanıcı mikrofonu) | **$0.70 / 1M token** |
| Ses çıkış (model yanıt sesi) | **$2.00 / 1M token** |
| Metin giriş | $0.10 / 1M token |
| Metin çıkış | $0.40 / 1M token |

**Token çevirme (ses):** 1 saniyelik ses ≈ 25 token (giriş ve çıkış aynı oran).

> Not: Google, ses için "audio token" birimi kullanır. 1s ≈ 25 token kabul edilen
> pratik değerdir (Gemini dokümantasyonunda belirtilmemiş; community ölçümlerine
> ve API token sayacına dayanır — gerçek maliyet %20 oynayabilir).

---

## Tipik Session Senaryoları

### Senaryo A: 1 dakika konuşma (30s kullanıcı + 30s Gemini yanıtı)

```
Kullanıcı sesi (giriş): 30s × 25 token/s = 750 token
Gemini sesi (çıkış):    30s × 25 token/s = 750 token

Giriş maliyeti: 750 / 1_000_000 × $0.70 = $0.000525
Çıkış maliyeti: 750 / 1_000_000 × $2.00 = $0.001500
─────────────────────────────────────────────────────
1 dakika session toplam ≈ $0.00203  (~0.2 cent)
```

### Senaryo B: 5 dakika konuşma (150s kullanıcı + 150s Gemini)

```
Kullanıcı sesi (giriş): 150s × 25 = 3,750 token
Gemini sesi (çıkış):    150s × 25 = 3,750 token

Giriş maliyeti: 3750 / 1_000_000 × $0.70 = $0.002625
Çıkış maliyeti: 3750 / 1_000_000 × $2.00 = $0.007500
─────────────────────────────────────────────────────
5 dakika session toplam ≈ $0.01013  (~1 cent)
```

### Senaryo C: Aylık kullanıcı tahmini (aktif beta kullanıcısı)

Varsayım: 5 session/gün × 2 dakika/session × 30 gün = 300 dakika/ay

```
300 dakika × $0.00203/dk ≈ $0.61/ay/kullanıcı
```

100 kullanıcıda → ~$61/ay (backend sunucu maliyeti hariç).

---

## V1 ile Karşılaştırma

| | V1 (Whisper + GPT-4o-mini + TTS) | V2 (Gemini Live) |
|---|---|---|
| Ortalama latency | ~28s | <1s hedef |
| 1 dk session maliyeti | ~$0.015 (Whisper $0.006 + LLM $0.004 + ElevenLabs $0.005) | ~$0.002 |
| TTS bağımlılığı | ElevenLabs / OpenAI / edge-tts | Yok (Live audio-out) |
| Türkçe kalite | Whisper native → çok iyi | Gemini Live TR → test gerekli |

**Sonuç: V2 hem daha ucuz hem daha hızlı.** Ana risk Türkçe ses kalitesi ve
Gemini Live'ın kesintisiz servisi (SLA).

---

## Sprint 9.5 Maliyet Gating Planı (T9.5.3)

- **Per-turn cap:** 30s/turn audio çıkış → max $0.0015/turn Gemini maliyeti.
- **Session timeout:** 8s sessizlik → kapat. Açık boş session birikmez.
- **Günlük limit (T9.5.3):** Beta'da isteğe bağlı config — aşılırsa V1'e fall back.
- **Monitoring:** `voice_turn_events` tablosuna Gemini session süresi yazılır (T9.5.3).

---

## Kaynaklar

- https://ai.google.dev/gemini-api/docs/live
- https://ai.google.dev/pricing (erişim tarihi: 2026-05-14)
- google-genai SDK: https://pypi.org/project/google-genai/
