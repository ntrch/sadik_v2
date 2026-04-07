import React, { useState, useEffect, useContext, useRef } from 'react';
import { Eye, EyeOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { settingsApi, Settings } from '../api/settings';
import { deviceApi, SerialPort } from '../api/device';
import { chatApi } from '../api/chat';
import { AppContext } from '../context/AppContext';

const DEFAULT_SETTINGS: Settings = {
  openai_api_key: '',
  llm_model: 'gpt-4o',
  connection_method: 'serial',
  serial_port: 'auto',
  serial_baudrate: '115200',
  wifi_device_ip: '',
  pomodoro_work_minutes: '25',
  pomodoro_break_minutes: '5',
  pomodoro_long_break_minutes: '15',
  pomodoro_sessions_before_long_break: '4',
  microphone_device: 'default',
  speaker_device: 'default',
  tts_provider: 'elevenlabs',
  tts_openai_voice: 'onyx',
  tts_voice: 'tr-TR-EmelNeural',
  elevenlabs_api_key: '',
  elevenlabs_voice_id: '',
  elevenlabs_model_id: 'eleven_v3',
  wake_word_enabled: 'true',
  user_name: '',
  greeting_style: 'dostum',
  close_to_tray: 'true',
};

const GREETING_PRESETS = [
  { value: 'dostum',   label: 'Dostum' },
  { value: 'patronum', label: 'Patronum' },
  { value: 'efendim',  label: 'Efendim' },
  { value: 'kankam',   label: 'Kankam' },
  { value: 'hocam',    label: 'Hocam' },
];

const OPENAI_VOICES = [
  { value: 'alloy',   label: 'Alloy — Nötr' },
  { value: 'echo',    label: 'Echo — Erkek' },
  { value: 'fable',   label: 'Fable — İngiliz Aksanı' },
  { value: 'onyx',    label: 'Onyx — Derin Erkek (önerilen)' },
  { value: 'nova',    label: 'Nova — Kadın' },
  { value: 'shimmer', label: 'Shimmer — Yumuşak Kadın' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ports, setPorts] = useState<SerialPort[]>([]);
  // Tracks the last-persisted personalization values so we can detect changes on save.
  const savedPersonalizationRef = useRef({ user_name: '', greeting_style: '' });
  const {
    showToast,
    wakeWordEnabled, toggleWakeWord,
    wakeWordSensitivity, setWakeWordSensitivity,
    continuousConversation, setContinuousConversation,
    oledSleepTimeoutMinutes, setOledSleepTimeout,
    audioInputDevices,
    audioOutputDevices,
    selectedAudioInputDeviceId,
    selectedAudioOutputDeviceId,
    setSelectedAudioInputDeviceId,
    setSelectedAudioOutputDeviceId,
    refreshAudioDevices,
    proactiveSuggestionsEnabled, setProactiveSuggestionsEnabled,
    proactiveQuietHoursStart,    setProactiveQuietHoursStart,
    proactiveQuietHoursEnd,      setProactiveQuietHoursEnd,
    proactiveDailyLimit,         setProactiveDailyLimit,
    proactiveCooldownMinutes,    setProactiveCooldownMinutes,
    spokenProactiveEnabled,      setSpokenProactiveEnabled,
    spokenProactiveDailyLimit,   setSpokenProactiveDailyLimit,
  } = useContext(AppContext);

  useEffect(() => {
    settingsApi.getAll().then((s) => {
      setSettings((prev) => ({ ...prev, ...s }));
      savedPersonalizationRef.current = {
        user_name:      s['user_name']      ?? '',
        greeting_style: s['greeting_style'] ?? '',
      };
    }).catch(() => {});
    deviceApi.listPorts().then(setPorts).catch(() => {});
  }, []);

  const set = (key: string, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.update(settings);

      const prevName  = savedPersonalizationRef.current.user_name;
      const prevStyle = savedPersonalizationRef.current.greeting_style;
      const personalizationChanged =
        (settings.user_name      ?? '') !== prevName ||
        (settings.greeting_style ?? '') !== prevStyle;

      if (personalizationChanged) {
        await chatApi.clearHistory();
        savedPersonalizationRef.current = {
          user_name:      settings.user_name      ?? '',
          greeting_style: settings.greeting_style ?? '',
        };
        showToast('Kişiselleştirme güncellendi, eski konuşma bağlamı sıfırlandı.', 'success');
      } else {
        showToast('Ayarlar kaydedildi', 'success');
      }
    } catch {
      showToast('Ayarlar kaydedilemedi', 'error');
    }
    setSaving(false);
  };

  const refreshPorts = async () => {
    const p = await deviceApi.listPorts().catch(() => []);
    setPorts(p);
  };

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-text-primary mb-6">Ayarlar</h1>

        {/* API key warning banner */}
        {!settings.openai_api_key && (
          <div className="flex items-start gap-3 bg-accent-yellow/10 border border-accent-yellow/30 rounded-card px-4 py-3 mb-4">
            <AlertTriangle size={15} className="text-accent-yellow flex-shrink-0 mt-0.5" />
            <p className="text-xs text-accent-yellow leading-relaxed">
              OpenAI API anahtarı ayarlanmamış. Sohbet ve sesli asistan özellikleri çalışmayacak.
              Lütfen aşağıdan API anahtarınızı girin ve kaydedin.
            </p>
          </div>
        )}

        {/* API Settings */}
        <Section title="API Ayarları">
          <Field label="OpenAI API Anahtarı">
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={settings.openai_api_key}
                onChange={(e) => set('openai_api_key', e.target.value)}
                placeholder="sk-..."
                className="input-field pr-10"
              />
              <button onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <Field label="Yapay zeka modeli">
            <select
              value={settings.llm_model}
              onChange={(e) => set('llm_model', e.target.value)}
              className="input-field"
            >
              <option value="gpt-4o">GPT-4o (önerilen)</option>
              <option value="gpt-4o-mini">GPT-4o Mini — Hızlı, ekonomik</option>
            </select>
            <p className="text-[11px] text-text-muted mt-1.5">
              Daha güçlü modeller daha iyi yanıt verir ancak daha maliyetli olabilir.
            </p>
          </Field>
        </Section>

        {/* Device */}
        <Section title="Cihaz Bağlantısı">
          <p className="text-xs text-text-muted leading-relaxed -mt-1 mb-1">
            Sadık cihazı çoğu durumda otomatik algılanır. Gerekirse portu manuel seçebilirsiniz.
          </p>
          <p className="text-xs text-text-muted leading-relaxed -mt-1 mb-1">
            OLED parlaklığı soldaki yan panelden ayarlanabilir.
          </p>
          <Field label="Ekran uyku süresi">
            <select
              value={String(oledSleepTimeoutMinutes)}
              onChange={(e) => setOledSleepTimeout(Number(e.target.value))}
              className="input-field"
            >
              <option value="0">Kapalı</option>
              <option value="5">5 dakika</option>
              <option value="10">10 dakika</option>
              <option value="15">15 dakika</option>
              <option value="30">30 dakika</option>
            </select>
            <p className="text-[11px] text-text-muted mt-1.5">
              OLED ekranı korumak için belirli bir süre işlem olmazsa ekran kapanır.
            </p>
          </Field>
          <Field label="Bağlantı Yöntemi">
            <div className="flex gap-4">
              {['serial', 'wifi'].map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="connection_method" value={m}
                    checked={settings.connection_method === m}
                    onChange={() => set('connection_method', m)}
                    className="accent-accent-blue" />
                  <span className="text-sm text-text-primary">{m === 'serial' ? 'USB Serial' : 'WiFi'}</span>
                </label>
              ))}
            </div>
          </Field>

          {settings.connection_method === 'serial' && (
            <>
              <Field label="Seri Port">
                <div className="flex gap-2">
                  <select value={settings.serial_port} onChange={(e) => set('serial_port', e.target.value)}
                    className="flex-1 input-field">
                    <option value="auto">Otomatik</option>
                    {ports.map((p) => (
                      <option key={p.port} value={p.port}>{p.port} — {p.description}</option>
                    ))}
                  </select>
                  <button onClick={refreshPorts}
                    className="p-2 bg-bg-input border border-border rounded-btn text-text-muted hover:text-text-primary transition-colors">
                    <RefreshCw size={15} />
                  </button>
                </div>
              </Field>
              <Field label="Baudrate">
                <input type="text" value={settings.serial_baudrate}
                  onChange={(e) => set('serial_baudrate', e.target.value)}
                  className="input-field" />
              </Field>
            </>
          )}

          {settings.connection_method === 'wifi' && (
            <Field label="WiFi IP Adresi">
              <input type="text" value={settings.wifi_device_ip}
                onChange={(e) => set('wifi_device_ip', e.target.value)}
                placeholder="192.168.1.x" className="input-field" />
            </Field>
          )}
        </Section>

        {/* Pomodoro */}
        <Section title="Pomodoro Ayarları">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Çalışma Süresi (dk)">
              <input type="number" value={settings.pomodoro_work_minutes}
                onChange={(e) => set('pomodoro_work_minutes', e.target.value)}
                className="input-field" min={1} max={120} />
            </Field>
            <Field label="Mola Süresi (dk)">
              <input type="number" value={settings.pomodoro_break_minutes}
                onChange={(e) => set('pomodoro_break_minutes', e.target.value)}
                className="input-field" min={1} max={60} />
            </Field>
            <Field label="Uzun Mola Süresi (dk)">
              <input type="number" value={settings.pomodoro_long_break_minutes}
                onChange={(e) => set('pomodoro_long_break_minutes', e.target.value)}
                className="input-field" min={1} max={60} />
            </Field>
            <Field label="Uzun Mola Öncesi Oturum">
              <input type="number" value={settings.pomodoro_sessions_before_long_break}
                onChange={(e) => set('pomodoro_sessions_before_long_break', e.target.value)}
                className="input-field" min={1} max={10} />
            </Field>
          </div>
        </Section>

        {/* Personalization */}
        <Section title="Kişiselleştirme">
          <Field label="Adınız">
            <input
              type="text"
              value={settings.user_name ?? ''}
              onChange={(e) => set('user_name', e.target.value)}
              placeholder="örn. Eren"
              className="input-field"
            />
          </Field>

          <Field label="Hitap şekli">
            <div className="flex flex-wrap gap-2 mb-2">
              {GREETING_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set('greeting_style', p.value)}
                  className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors
                    ${settings.greeting_style === p.value
                      ? 'bg-accent-blue text-white border border-accent-blue'
                      : 'bg-bg-input text-text-secondary border border-border hover:border-accent-blue/40 hover:text-text-primary'}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => set('greeting_style', '')}
                className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors
                  ${!GREETING_PRESETS.some((p) => p.value === settings.greeting_style)
                    ? 'bg-accent-purple text-white border border-accent-purple'
                    : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
              >
                Özel
              </button>
            </div>
            {!GREETING_PRESETS.some((p) => p.value === settings.greeting_style) && (
              <input
                type="text"
                value={settings.greeting_style ?? ''}
                onChange={(e) => set('greeting_style', e.target.value)}
                placeholder="örn. Üstat"
                className="input-field"
                autoFocus
              />
            )}
          </Field>
          <p className="text-[11px] text-text-muted -mt-1">
            Ad veya hitap değiştiğinde eski konuşma bağlamı sıfırlanır.
          </p>
        </Section>

        {/* Voice */}
        <Section title="Ses Ayarları">
          {/* TTS Provider */}
          <Field label="TTS Sağlayıcısı">
            <div className="flex flex-col gap-2">
              {[
                { value: 'elevenlabs', label: 'ElevenLabs', sublabel: 'Birincil — klonlanmış ses (API anahtarı gerekli)' },
                { value: 'openai',     label: 'OpenAI TTS', sublabel: 'Yedek 1 — doğal ses (API anahtarı gerekli)' },
                { value: 'edge',       label: 'Edge TTS',   sublabel: 'Yedek 2 — ücretsiz, robotik ses' },
              ].map(({ value, label, sublabel }) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="tts_provider"
                    value={value}
                    checked={settings.tts_provider === value}
                    onChange={() => set('tts_provider', value)}
                    className="accent-accent-blue mt-0.5"
                  />
                  <div>
                    <span className="text-sm text-text-primary block">{label}</span>
                    <span className="text-xs text-text-muted">{sublabel}</span>
                  </div>
                </label>
              ))}
            </div>
          </Field>

          {/* ElevenLabs fields */}
          {settings.tts_provider === 'elevenlabs' && (
            <>
              <Field label="ElevenLabs API Anahtarı">
                <div className="relative">
                  <input
                    type={showElevenLabsKey ? 'text' : 'password'}
                    value={settings.elevenlabs_api_key}
                    onChange={(e) => set('elevenlabs_api_key', e.target.value)}
                    placeholder="sk-..."
                    className="input-field pr-10"
                  />
                  <button
                    onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                  >
                    {showElevenLabsKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
              <Field label="ElevenLabs Voice ID">
                <input
                  type="text"
                  value={settings.elevenlabs_voice_id}
                  onChange={(e) => set('elevenlabs_voice_id', e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="input-field"
                />
              </Field>
              <Field label="ElevenLabs Modeli">
                <select
                  value={settings.elevenlabs_model_id}
                  onChange={(e) => set('elevenlabs_model_id', e.target.value)}
                  className="input-field"
                >
                  <option value="eleven_v3">eleven_v3 (V3 — Human-like, 70+ languages)</option>
                  <option value="eleven_multilingual_v2">eleven_multilingual_v2 (Türkçe için önerilen)</option>
                  <option value="eleven_turbo_v2_5">eleven_turbo_v2_5 (Hızlı, düşük gecikme)</option>
                  <option value="eleven_monolingual_v1">eleven_monolingual_v1 (İngilizce)</option>
                </select>
              </Field>
            </>
          )}

          {/* OpenAI voice selector */}
          {settings.tts_provider === 'openai' && (
            <Field label="OpenAI Sesi">
              <select
                value={settings.tts_openai_voice}
                onChange={(e) => set('tts_openai_voice', e.target.value)}
                className="input-field"
              >
                {OPENAI_VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </Field>
          )}

          {/* Edge TTS voice input */}
          {settings.tts_provider === 'edge' && (
            <Field label="Edge TTS Sesi">
              <input
                type="text"
                value={settings.tts_voice}
                onChange={(e) => set('tts_voice', e.target.value)}
                className="input-field"
                placeholder="tr-TR-EmelNeural"
              />
            </Field>
          )}

          <Field label="Uyandırma Kelimesi">
            <button
              onClick={toggleWakeWord}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                ${wakeWordEnabled ? 'bg-accent-blue' : 'bg-bg-input border border-border'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${wakeWordEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </Field>

          {wakeWordEnabled && (
            <Field label="Uyandırma Hassasiyeti">
              <select
                value={wakeWordSensitivity}
                onChange={(e) => setWakeWordSensitivity(e.target.value)}
                className="input-field"
              >
                <option value="very_high">Çok hassas — uzak mikrofon için</option>
                <option value="high">Hassas</option>
                <option value="normal">Normal (önerilen)</option>
                <option value="low">Düşük — gürültülü ortam için</option>
              </select>
            </Field>
          )}

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">Sürekli konuşma modu</p>
              <p className="text-xs text-text-muted leading-relaxed">
                Sadık cevap verdikten sonra otomatik olarak dinlemeye geçer. Konuşmayı bitirmek için X'e tıklayın.
              </p>
            </div>
            <button
              onClick={() => setContinuousConversation(!continuousConversation)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                ${continuousConversation ? 'bg-accent-blue' : 'bg-bg-input border border-border'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${continuousConversation ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </Section>

        {/* Audio Devices */}
        <Section title="Ses Aygıtları">
          <p className="text-xs text-text-muted leading-relaxed -mt-1 mb-1">
            Sadık için hangi mikrofon ve hoparlörün kullanılacağını seçin.
          </p>
          <Field label="Mikrofon">
            <div className="flex gap-2">
              <select
                value={selectedAudioInputDeviceId}
                onChange={(e) => setSelectedAudioInputDeviceId(e.target.value)}
                className="flex-1 input-field"
              >
                <option value="default">Sistem varsayılanı</option>
                {audioInputDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Mikrofon ${i + 1}`}
                  </option>
                ))}
              </select>
              <button
                onClick={() => refreshAudioDevices()}
                title="Aygıtları yenile"
                className="p-2 bg-bg-input border border-border rounded-btn text-text-muted hover:text-text-primary transition-colors"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </Field>
          <Field label="Hoparlör / Çıkış">
            <select
              value={selectedAudioOutputDeviceId}
              onChange={(e) => setSelectedAudioOutputDeviceId(e.target.value)}
              className="input-field"
            >
              <option value="default">Sistem varsayılanı</option>
              {audioOutputDevices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Çıkış ${i + 1}`}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* App Behavior */}
        <Section title="Uygulama">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">
                Kapatınca sistem tepsisine küçült
              </p>
              <p className="text-xs text-text-muted leading-relaxed">
                Bu ayar açıksa pencereyi kapatmak uygulamayı tamamen kapatmaz; Sadık arka planda
                çalışmaya devam eder. Sistem tepsisi simgesinden tekrar açabilir ya da çıkış yapabilirsiniz.
              </p>
            </div>
            <button
              onClick={() =>
                set('close_to_tray', settings['close_to_tray'] === 'false' ? 'true' : 'false')
              }
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                ${settings['close_to_tray'] !== 'false'
                  ? 'bg-accent-blue'
                  : 'bg-bg-input border border-border'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${settings['close_to_tray'] !== 'false' ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>
        </Section>

        {/* Proactive Suggestions */}
        <Section title="Proaktif Öneriler">
          <p className="text-xs text-text-muted leading-relaxed -mt-1 mb-1">
            Sadık kullanım alışkanlıklarınıza göre mola ve dikkat önerileri gösterebilir.
          </p>

          {/* Master toggle */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">Proaktif öneriler</p>
              <p className="text-xs text-text-muted leading-relaxed">
                Etkinleştirildiğinde Sadık günlük uygulama kullanımınıza göre mola önerisinde bulunur.
              </p>
            </div>
            <button
              onClick={() => setProactiveSuggestionsEnabled(!proactiveSuggestionsEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                ${proactiveSuggestionsEnabled ? 'bg-accent-blue' : 'bg-bg-input border border-border'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${proactiveSuggestionsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {proactiveSuggestionsEnabled && (
            <>
              {/* Quiet hours */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Sessiz saat başlangıcı">
                  <select
                    value={proactiveQuietHoursStart}
                    onChange={(e) => setProactiveQuietHoursStart(e.target.value)}
                    className="input-field"
                  >
                    {Array.from({ length: 24 }, (_, h) => {
                      const val = `${String(h).padStart(2, '0')}:00`;
                      return <option key={val} value={val}>{val}</option>;
                    })}
                  </select>
                </Field>
                <Field label="Sessiz saat bitişi">
                  <select
                    value={proactiveQuietHoursEnd}
                    onChange={(e) => setProactiveQuietHoursEnd(e.target.value)}
                    className="input-field"
                  >
                    {Array.from({ length: 24 }, (_, h) => {
                      const val = `${String(h).padStart(2, '0')}:00`;
                      return <option key={val} value={val}>{val}</option>;
                    })}
                  </select>
                </Field>
              </div>
              <p className="text-[11px] text-text-muted -mt-2">
                Bu saatler arasında bildirim gönderilmez. Gece geçişini destekler (ör. 23:00 → 08:00).
              </p>

              {/* Daily limit */}
              <Field label="Günlük maksimum öneri">
                <select
                  value={String(proactiveDailyLimit)}
                  onChange={(e) => setProactiveDailyLimit(Number(e.target.value))}
                  className="input-field"
                >
                  <option value="1">1 öneri</option>
                  <option value="2">2 öneri</option>
                  <option value="3">3 öneri (önerilen)</option>
                  <option value="5">5 öneri</option>
                </select>
              </Field>

              {/* Cooldown */}
              <Field label="Öneriler arası bekleme">
                <select
                  value={String(proactiveCooldownMinutes)}
                  onChange={(e) => setProactiveCooldownMinutes(Number(e.target.value))}
                  className="input-field"
                >
                  <option value="30">30 dakika</option>
                  <option value="60">60 dakika (önerilen)</option>
                  <option value="90">90 dakika</option>
                  <option value="120">120 dakika</option>
                </select>
              </Field>

              {/* Spoken proactive */}
              <div className="border-t border-border-subtle pt-4 mt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-primary font-medium">Sesli proaktif öneriler</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Sadık uygun durumlarda kısa sesli mola önerileri sunabilir.
                    </p>
                  </div>
                  <button
                    onClick={() => setSpokenProactiveEnabled(!spokenProactiveEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                      ${spokenProactiveEnabled ? 'bg-accent-blue' : 'bg-bg-input border border-border'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${spokenProactiveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {spokenProactiveEnabled && (
                  <div className="mt-3">
                    <Field label="Günlük sesli öneri sınırı">
                      <select
                        value={String(spokenProactiveDailyLimit)}
                        onChange={(e) => setSpokenProactiveDailyLimit(Number(e.target.value))}
                        className="input-field"
                      >
                        <option value="0">Kapalı</option>
                        <option value="1">1 öneri (önerilen)</option>
                        <option value="2">2 öneri</option>
                      </select>
                    </Field>
                  </div>
                )}
              </div>
            </>
          )}
        </Section>

        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-accent-blue hover:bg-accent-blue-hover text-white font-semibold rounded-btn transition-colors disabled:opacity-60 text-sm mt-2">
          {saving ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-card border border-border rounded-card p-5 mb-4">
      <h2 className="text-sm font-semibold text-text-primary mb-4 pb-3 border-b border-border">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
