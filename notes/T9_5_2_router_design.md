# T9.5.2 — Pipeline Split / A-B Router Design

**Tarih:** 2026-05-14  
**Sprint:** 9.5 (Gemini Live integration)  
**Durum:** Araştırma tamamlandı, Strateji C uygulanabilir.

---

## 1. Strateji C Desteği — Live Input Transcription Durumu

**SONUÇ: TAM DESTEK MEVCUT.**

SDK kaynak incelemesi (`.venv/Lib/site-packages/google/genai/types.py` ve `tests/live/test_live.py`) aşağıdakileri doğruladı:

### Config Tarafı (Setup)
`LiveConnectConfig` içinde iki alan tanımlı:

```python
input_audio_transcription: Optional[AudioTranscriptionConfig]   # kullanıcı sesi → metin
output_audio_transcription: Optional[AudioTranscriptionConfig]  # model sesi → metin
```

`AudioTranscriptionConfig` yalnızca isteğe bağlı `language_codes: list[str]` içerir.
Etkinleştirmek için setup sırasında boş `{}` geçmek yeterli — T9.5.2'de ihtiyacımız olan alan `input_audio_transcription`.

Wire formatı (mldev): `inputAudioTranscription: {}` — SDK testi bunu `test_bidi_setup_to_api_with_input_transcription` ile doğrulmuş.

### Sunucu Yanıt Tarafı
`LiveServerContent` iki ek alan içeriyor:

```python
input_transcription:  Optional[Transcription]   # kullanıcı sesinin transkripsiyonu
output_transcription: Optional[Transcription]   # modelin yanıt transkripsiyonu
```

`Transcription` modeli:
```python
text:     Optional[str]   # kısmi veya tam transkript metni
finished: Optional[bool]  # bu segment tamamlandı mı?
```

Yanıtlar `session.receive()` döngüsünden gelir — mevcut `receive_audio()` metoduyla aynı kanal.
SDK testi (`test_live.py:533-548`) wire payload'ını doğrulayan şunu gösteriyor:
```json
{"serverContent": {"inputTranscription": {"text": "test_input", "finished": true}}}
```

Bu mesajlar `response.server_content.input_transcription.text` ile erişilir.

### Latency Profili
SDK dökümantasyonu (`input_transcription` field dokümantasyonu) şunu belirtiyor:
> "The transcription is **independent** to the model turn which means it doesn't imply any ordering between transcription and model turn."

Bu kritik bir detay: transkript, model audio response ile **bağımsız** akışta gelir.
`finished=False` olan chunk'lar incremental (kısmi) transkriptlerdir, `finished=True` ise turn sonunu işaret eder.
Yani B-router hem incremental (erken detection) hem de final (kesin detection) modunda çalışabilir.

---

## 2. Veri Akış Diyagramı

```
WAKE WORD ATEŞLENDI
        │
        ▼
┌───────────────────────────────────────────────┐
│  Gemini Live Session AÇILDI                    │
│  config: input_audio_transcription={}          │
│          response_modalities=["AUDIO"]          │
│          automatic_activity_detection=disabled  │
└───────────────────────────────────────────────┘
        │
        ▼
┌──────────────┐     PCM chunks     ┌──────────────────────┐
│  Mic / RMS   │ ─────────────────► │  send_audio()         │
│  Gate        │                    │  (activity_start ile) │
└──────────────┘                    └──────────────────────┘
                                              │
                          ┌───────────────────┴──────────────────┐
                          │      server.receive() döngüsü         │
                          └───────────────────┬──────────────────┘
                                              │
              ┌───────────────────────────────┼────────────────────────────┐
              │                               │                            │
              ▼                               ▼                            ▼
   server_content.data            server_content               server_content
   (PCM audio bytes)         .input_transcription.text     .turn_complete = True
              │                               │
              │                               ▼
              │                    ┌─────────────────────┐
              │                    │   B-ROUTER            │
              │                    │  (intent classifier)  │
              │                    └─────────────────────┘
              │                          │         │
              │                   tool?  │         │ sohbet?
              │                    YES   │         │ NO
              │                          ▼         ▼
              │              ┌──────────────┐   A-PATH
              │              │  B-PATH       │   audio buffer
              │              │  discard buf  │   → playback
              │              │  tool_loop    │
              │              │  MJPEG klip   │
              │              └──────────────┘
              │
         BUFFER
     (audio_buffer: deque)
     mute_flag ile kontrol
```

---

## 3. Fallback Strateji B (Strateji C desteklenmese idi)

Strateji C tam olarak desteklendiği için Strateji B'ye **gerek yok**.

Strateji B, Live session ile paralel olarak ayrı Whisper inferans çalıştırmayı gerektirirdi:
- Her konuşma için hem Gemini Live hem Whisper maliyeti (2x)
- Ekstra ~300-600ms latency (Whisper için)
- Ek kod karmaşıklığı (iki paralel audio stream)

**Plan B şimdilik arşive alınıyor.** Strateji C'nin üretimde davranışı (latency, `finished` flag güvenilirliği) doğrulandıktan sonra Plan B'ye dönme kararı verilebilir.

---

## 4. Intent Classifier — B-Router Yaklaşımı

### Seçenek A: Tek LLM çağrısı (önerilen)
Transcript `finished=True` geldiğinde mevcut `run_tool_loop` / `run_tool_loop_stream` doğrudan çağrılır.

- LLM `finish_reason == "tool_calls"` → B-path etkin
- LLM `finish_reason == "stop"` (text yanıt) → B-path gerekmedi, A-path audio çal

Bu yaklaşımın avantajları:
- `voice_tools.py` → `run_tool_loop_stream` **sıfır değişiklikle** yeniden kullanılabilir
- Tek LLM çağrısı hem intent detection hem tool execution
- Gereksiz hafif classifier katmanı yok (iki LLM çağrısı yerine bir)

### Seçenek B: Ayrı hafif intent classifier (önerilmez)
Regex tabanlı ya da küçük model ile "tool mu?" sorusunu önceden sormak.
Fazladan latency ve yanlış pozitif riski. Gereksiz.

### Karar: Seçenek A
`run_tool_loop_stream` çağrılır. İlk `finish_reason` değerlendirmesi router kararını verir.
Transcript metni `messages` listesinin `user` mesajı olarak eklenir.

---

## 5. Live Mute Stratejisi

### Problem
B-path açıldığında (tool intent tespit edildi) Gemini Live hâlâ audio stream göndermeye devam eder. Bu audio çalınmamalı.

### Seçenek 1: Client-side buffer discard (önerilen)
Audio chunk'lar buffer'a alınır (`asyncio.Queue` veya `deque`). `mute_flag = True` setlendiğinde buffer drain edilir, yeni gelen chunk'lar sessizce drop edilir. Session açık kalır.

- Avantaj: Session kapatılmıp açılmıyor (pahalı değil), model audio üretmeye devam edebilir (context açık)
- Dezavantaj: Gemini token yakmaya devam eder (B-path süresince model yanıtını üretir)
- Maliyet analizi: B-path ortalama 2-4 saniye → yaklaşık 2-4 saniye gereksiz audio token. Kabul edilebilir.

### Seçenek 2: Session kapat + yeniden aç
B-path tamamlanınca yeni session aç.
- Dezavantaj: Yeniden bağlanma latency (~300-800ms), context kaybı

### Seçenek 3: `activity_end` gönder, yeni turn başlatma
Live session'da turn boundary manipülasyonu.
- Belirsiz davranış, resmi interrupt API yok (SDK'da cancel/interrupt metodu yok)

### Seçenek 4: `LiveServerToolCallCancellation` pasif izleme
SDK'da `tool_call_cancellation` message tipi var ama bu server→client yönünde (model onu gönderir). Client-initiated cancel mekanizması mevcut değil.

### Karar: Seçenek 1 (buffer discard)
`mute_flag` asyncio Event olarak implement edilir. `receive_audio()` metodunda kontrol edilir. B-path tamamlandığında (`done` event) `mute_flag` sıfırlanır, session hayatta kalır.

---

## 6. Implementation Adımları

**Adım 1 — `gemini_live_service.py`: `input_audio_transcription` config ekle**
`LiveConnectConfig` setup'ına `input_audio_transcription=AudioTranscriptionConfig()` ekle.
`receive_audio()` metodunu `receive_messages()` olarak genişlet: hem audio data hem transcript event yield etsin.
Yeni yield formatı: `("audio", bytes)` veya `("transcript", text, finished_bool)`.

**Adım 2 — `gemini_live_service.py`: mute mekanizması**
`_mute: asyncio.Event` flag ekle. `receive_messages()` içinde audio yield yapmadan önce flag kontrol.
`mute()` / `unmute()` public metotları ekle. B-path router'ı bu metotları çağırır.

**Adım 3 — B-router modülü (yeni dosya: `live_router.py`)**
`route_transcript(text: str, finished: bool, session, db_session) -> None` async fonksiyon.
`finished=True` gelince `run_tool_loop_stream` çağır.
`finish_reason == "tool_calls"` → `session.mute()`, B-path execute, `session.unmute()`, MJPEG klip tetikle.
`finish_reason == "stop"` → A-path, audio buffer flush (zaten çalıyor).

**Adım 4 — `voice_service.py` / voice router: entegrasyon**
Live session açılışına `live_router.py` bağla. Her `receive_messages()` döngüsünde transcript event'ı router'a ilet.

**Adım 5 — `voice_tools.py`: messages adapter**
`run_tool_loop_stream` halihazırda OpenAI-compat mesaj listesi bekliyor.
Transcript → `{"role": "user", "content": transcript_text}` dönüşümü gerekiyor.
Mevcut `run_tool_loop_stream` signature değişmiyor, sadece çağırma tarafı yeni.

**Adım 6 — MJPEG klip tetikleme**
B-path `done` event aldığında tool_calls_used listesine bakarak uygun animasyon klibini tetikle.
Mevcut `ws_manager.broadcast({"type": "play_clip", ...})` pattern yeterli.

**Adım 7 — Test senaryosu**
Echo-test benzeri bir senaryo: text prompt gönder, hem audio hem transcript geldikten sonra B-router doğru dalı seçiyor mu kontrol et.
`mute_flag` doğru setlenip reset ediliyor mu logdan doğrula.

---

## 7. Risk + Açık Sorular

### Riskler

**R1 — `finished` flag güvenilirliği (YÜKSEK)**
SDK belgesi transkripsiyonun model turn'den bağımsız olduğunu söylüyor. `finished=True` bazen model response'tan önce, bazen sonra gelebilir. B-router kararı `finished=True` beklerse latency artar. Incremental (`finished=False`) kısmi metin üzerinde erken routing denenebilir ama yanlış pozitif riski var.
Öneri: Pilot'ta `finished=True` bekle, latency ölç. Eğer +500ms+ ekliyorsa partial routing denemesi.

**R2 — `gemini-3.1-flash-live-preview` modeli input transcription destekliyor mu? (ORTA)**
SDK types.py destekliyor, ancak model bazında feature availability farklı olabilir. `gemini-2.5-flash-native-audio` serisinde de transcript var. `gemini-3.1-flash-live-preview`'da gerçek transkript gelip gelmediği sadece live testle doğrulanabilir.
Öneri: Adım 1'den sonra echo-test ile transkript alınıp alınmadığını logla.

**R3 — Mute sırasında token israfı (DÜŞÜK)**
B-path süresince Gemini audio yanıt üretiyor ve token yakıyor. Ortalama 2-3 saniye. Günlük kullanımda ihmal edilebilir maliyet. T9.5.3 cost gating bunu izleyecek.

**R4 — Session açık tutma süresi (DÜŞÜK)**
B-path sırasında session açık tutulması Gemini'nin timeout'a düşmesine neden olabilir (idle timeout). Tool execution genellikle <5 saniye. Gemini Live default timeout süresi bilinmiyor. Uzun tool loop durumunda session'ın yaşayıp yaşamadığı test edilmeli.

### Açık Sorular

1. Incremental transcript (`finished=False`) kaç chunk'ta geliyor? Kelime bazında mı, cümle bazında mı? B-router'ın erken trigger eşiğini belirlemek için ölçülmeli.
2. `input_audio_transcription.language_codes=["tr"]` eklemek transkript kalitesini artırıyor mu? Türkçe konuşma recognition için denenebilir.
3. Live session context T9.5.3'te nasıl kısaltılacak? Bütçe aşıldığında session kapatılırken B-path ortada kalır mı?
4. B-path LLM modeli ne? Mevcut `run_tool_loop_stream` OpenAI client kullanıyor (voice_service.py). Gemini Live session'ı ayrı bir Gemini API çağrısıyla B-path yapılabilir mi yoksa OpenAI-compat endpoint mi tercih edilmeli? Sprint başında bu kararı sabitle.
