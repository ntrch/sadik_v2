import React, { useState } from 'react';
import { settingsApi } from '../api/settings';
import { privacyApi } from '../api/privacy';
import { KVKK_NOTICE } from '../content/kvkkNotice';
import {
  ACTIVITIES,
  PRESET_MODE_POOL,
  type ActivityId,
  recommendModes,
  deriveDominantPersona,
} from '../lib/activityCatalog';

interface Props {
  onComplete: () => void;
}

type TierId = 'full' | 'hybrid' | 'local';

const TIERS: { id: TierId; title: string; short: string; bullets: string[] }[] = [
  {
    id: 'full',
    title: '🔓 Tam AI',
    short: 'Maksimum zeka — tüm veri + araçlar + davranış öğrenme',
    bullets: [
      'Takvim, görev, alışkanlık ve uygulama kullanım verisi Sadık\'ın cevaplarına dahil edilir',
      'Tüm sesli araçlar açık (liste, silme, ajanda, kullanım analizi)',
      'Davranış öğrenme ile kişiselleştirilmiş öneriler',
    ],
  },
  {
    id: 'hybrid',
    title: '⚖️ Dengeli',
    short: 'Okuma/silme araçları, davranış öğrenme kapalı',
    bullets: [
      'Sesli komutla görev/alışkanlık/ajanda yönetebilir',
      'Davranış öğrenme kapalı — Sadık geçmişini analiz etmez',
      'Uygulama kullanım analizi ve uzun vadeli hafıza araçları devre dışı',
    ],
  },
  {
    id: 'local',
    title: '🔒 Yerel-only',
    short: 'Sadık sadece sohbet eder; veriye erişmez',
    bullets: [
      'Verilerin (görev, ajanda, alışkanlık) OpenAI\'a hiç gönderilmez',
      'Sadık araç kullanamaz, "bugün ne yaptım" gibi sorulara cevap veremez',
      'STT + TTS için ses yine OpenAI\'a gider (kaçınılmaz)',
    ],
  },
];

// Toplam adım sayısı: 1=KVKK, 2=Aktiviteler, 3=Önerilen Modlar, 4=Tier, 5=Consent
const TOTAL_STEPS = 5;

export default function OnboardingPage({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [readChecked, setReadChecked] = useState(false);
  const [selectedTier, setSelectedTier] = useState<TierId>('hybrid');
  const [selectedActivities, setSelectedActivities] = useState<ActivityId[]>([]);
  // recommended 4 mode keys — user can toggle on/off
  const [selectedModeKeys, setSelectedModeKeys] = useState<string[]>([]);
  const [poolOpen, setPoolOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKvkkModal, setShowKvkkModal] = useState(false);

  const selectedMeta = TIERS.find((t) => t.id === selectedTier)!;

  function toggleActivity(id: ActivityId) {
    setSelectedActivities((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  function toggleModeKey(key: string) {
    setSelectedModeKeys((prev) =>
      prev.includes(key)
        ? prev.length > 1 ? prev.filter((k) => k !== key) : prev // en az 1 seçili kalsin
        : [...prev, key]
    );
  }

  function addModeFromPool(key: string) {
    if (!selectedModeKeys.includes(key)) {
      setSelectedModeKeys((prev) => [...prev, key]);
    }
    setPoolOpen(false);
  }

  function goToModeStep() {
    // Hesapla önerilen modları ve state'e set et
    const recommended = recommendModes(selectedActivities);
    setSelectedModeKeys(recommended);
    setStep(3);
  }

  async function handleFinish() {
    if (!consentChecked || saving) return;
    setSaving(true);
    try {
      await privacyApi.setTier(selectedTier);
      const persona = deriveDominantPersona(selectedActivities);
      await settingsApi.update({
        onboarding_completed: 'true',
        user_persona: persona,
        user_activities: selectedActivities.join(','),
        user_preset_modes: selectedModeKeys.join(','),
      });
      onComplete();
    } catch {
      setSaving(false);
    }
  }

  const poolModes = PRESET_MODE_POOL.filter((p) => !selectedModeKeys.includes(p.key));

  return (
    <div className="fixed inset-0 z-50 bg-bg/95 backdrop-blur flex items-center justify-center p-4">
      {showKvkkModal && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-card max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-border">
              <h2 className="text-text-primary font-semibold text-lg">KVKK Aydınlatma Metni</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {KVKK_NOTICE.map((section) => (
                <div key={section.title}>
                  <h4 className="text-sm font-semibold text-text-primary mb-2">{section.title}</h4>
                  {section.body.map((para, i) => (
                    <p key={i} className="text-sm text-text-secondary leading-relaxed whitespace-pre-line mb-2">{para}</p>
                  ))}
                </div>
              ))}
            </div>
            <div className="p-6 border-t border-border">
              <button
                onClick={() => setShowKvkkModal(false)}
                className="w-full px-4 py-2 rounded-card bg-accent-purple/20 text-accent-purple border border-accent-purple/30 text-sm font-semibold hover:bg-accent-purple/30 transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-bg-card border border-border rounded-card max-w-lg w-full flex flex-col gap-6 p-6 max-h-[90vh] overflow-y-auto">
        {/* Step indicators */}
        <div className="flex items-center justify-center gap-3">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <React.Fragment key={n}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border transition-colors ${
                  step === n
                    ? 'bg-accent-purple border-accent-purple text-white'
                    : step > n
                    ? 'bg-accent-purple/20 border-accent-purple/40 text-accent-purple'
                    : 'bg-bg-main border-border text-text-secondary'
                }`}
              >
                {n}
              </div>
              {n < TOTAL_STEPS && (
                <div className={`flex-1 h-px max-w-[32px] ${step > n ? 'bg-accent-purple/40' : 'bg-border'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* ── Step 1: KVKK ── */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-text-primary text-xl font-bold">Sadık'a Hoş Geldin</h1>
            <p className="text-text-secondary text-sm leading-relaxed">
              Sadık; görev takibi, alışkanlık yönetimi, takvim entegrasyonu ve sesli asistan özellikleriyle sana özel çalışan bir masaüstü yapay zeka asistanıdır.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">
              Verilerin (görev, takvim, Notion, ses sohbeti) varsayılan olarak yalnızca yerel cihazında saklanır. Bir sonraki adımda hangi verilerin yapay zekaya aktarılacağına sen karar vereceksin.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">
              KVKK kapsamında verilerini dilediğin zaman silebilir veya indirebilirsin.
            </p>
            <button
              onClick={() => setShowKvkkModal(true)}
              className="text-accent-purple text-sm underline text-left w-fit"
            >
              KVKK Aydınlatma Metni'nin Tamamını Oku
            </button>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={readChecked}
                onChange={(e) => setReadChecked(e.target.checked)}
                className="mt-0.5 accent-purple-500 w-4 h-4 flex-shrink-0"
              />
              <span className="text-text-secondary text-sm">Aydınlatma metnini okudum, anladım.</span>
            </label>
            <button
              disabled={!readChecked}
              onClick={() => setStep(2)}
              className="w-full py-2.5 rounded-card text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-accent-purple text-white hover:bg-accent-purple/90"
            >
              Devam Et
            </button>
          </div>
        )}

        {/* ── Step 2: Aktivite profili ── */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-lg font-bold">Bilgisayarda en çok ne yapıyorsun?</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              Birden fazla seçebilirsin. Sana özel modlar bunlara göre önerilecek.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {ACTIVITIES.map((a) => {
                const active = selectedActivities.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleActivity(a.id)}
                    className={`text-left p-2.5 rounded-card border transition-colors flex flex-col gap-1 ${
                      active
                        ? 'bg-accent-purple/10 border-accent-purple'
                        : 'bg-bg-main border-border hover:border-accent-purple/40'
                    }`}
                  >
                    <div className={`rounded-lg p-1.5 w-fit ${active ? 'bg-accent-purple/20' : 'bg-bg-input'}`}>
                      <a.icon size={18} className={active ? 'text-accent-purple' : 'text-text-muted'} />
                    </div>
                    <span className="text-xs font-semibold text-text-primary leading-tight">{a.label}</span>
                    <span className="text-[10px] text-text-muted leading-tight">{a.description}</span>
                    {active && (
                      <span className="text-[10px] font-bold text-accent-purple mt-0.5">✓ Seçildi</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-bg-main border border-border text-text-secondary hover:text-text-primary"
              >
                Geri
              </button>
              <button
                disabled={selectedActivities.length === 0}
                onClick={goToModeStep}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-accent-purple text-white hover:bg-accent-purple/90"
              >
                İleri
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Önerilen Modlar ── */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-lg font-bold">Önerilen Modlar</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              Seçtiğin aktivitelere göre 4 mod önerisi hazırladım. İstediğini kapatabilir veya havuzdan yenisini ekleyebilirsin.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {selectedModeKeys.map((key) => {
                const def = PRESET_MODE_POOL.find((p) => p.key === key);
                if (!def) return null;
                return (
                  <button
                    key={key}
                    onClick={() => toggleModeKey(key)}
                    className="text-left p-3 rounded-card border bg-accent-purple/10 border-accent-purple transition-colors hover:bg-accent-purple/5 flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-semibold text-text-primary">{def.label}</span>
                    <span className="text-[10px] font-mono text-text-muted">{def.oledText}</span>
                    <span className="text-[10px] text-accent-purple mt-1">✓ Aktif — kaldırmak için tıkla</span>
                  </button>
                );
              })}
            </div>

            {/* Havuzdan ekle */}
            {poolModes.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setPoolOpen((v) => !v)}
                  className="text-xs text-accent-purple underline"
                >
                  + Havuzdan mod ekle ({poolModes.length} seçenek)
                </button>
                {poolOpen && (
                  <div className="mt-2 bg-bg-main border border-border rounded-card overflow-hidden shadow-lg max-h-44 overflow-y-auto">
                    {poolModes.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => addModeFromPool(p.key)}
                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-accent-purple/10 transition-colors flex items-center justify-between"
                      >
                        <span>{p.label}</span>
                        <span className="text-[10px] font-mono text-text-muted">{p.oledText}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-bg-main border border-border text-text-secondary hover:text-text-primary"
              >
                Geri
              </button>
              <button
                disabled={selectedModeKeys.length === 0}
                onClick={() => setStep(4)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-accent-purple text-white hover:bg-accent-purple/90"
              >
                Onayla
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: AI Deneyim Modu (Tier) ── */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-lg font-bold">AI Deneyim Modu</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              Sadık'ın verilerinle ne kadar etkileşeceğini sen belirlersin. İstediğin zaman Ayarlar'dan değiştirebilirsin.
            </p>
            <div className="flex flex-col gap-2">
              {TIERS.map((t) => {
                const active = selectedTier === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTier(t.id)}
                    className={`text-left p-3 rounded-card border transition-colors ${
                      active
                        ? 'bg-accent-purple/10 border-accent-purple'
                        : 'bg-bg-main border-border hover:border-accent-purple/40'
                    }`}
                  >
                    <p className="text-sm font-semibold text-text-primary">{t.title}</p>
                    <p className="text-xs text-text-secondary mt-0.5">{t.short}</p>
                    {active && (
                      <ul className="mt-2 space-y-1">
                        {t.bullets.map((b) => (
                          <li key={b} className="text-[11px] text-text-muted leading-relaxed">• {b}</li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-bg-main border border-border text-text-secondary hover:text-text-primary"
              >
                Geri
              </button>
              <button
                onClick={() => setStep(5)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-accent-purple text-white hover:bg-accent-purple/90"
              >
                Devam Et
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Açık Rıza ── */}
        {step === 5 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-lg font-bold">Açık Rıza Onayı</h2>
            <div className="bg-bg-main border border-border rounded-card p-3 flex flex-col gap-1">
              <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">Seçilen Aktiviteler</span>
              <span className="text-text-primary text-sm">
                {selectedActivities.length > 0
                  ? selectedActivities.join(', ')
                  : '—'}
              </span>
            </div>
            <div className="bg-bg-main border border-border rounded-card p-3 flex flex-col gap-1">
              <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">Aktif Modlar</span>
              <span className="text-text-primary text-sm">
                {selectedModeKeys
                  .map((k) => PRESET_MODE_POOL.find((p) => p.key === k)?.label ?? k)
                  .join(', ')}
              </span>
            </div>
            <div className="bg-bg-main border border-border rounded-card p-3 flex flex-col gap-1">
              <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">Seçilen Mod</span>
              <span className="text-text-primary text-sm font-semibold">{selectedMeta.title}</span>
              <span className="text-text-secondary text-xs">{selectedMeta.short}</span>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 accent-purple-500 w-4 h-4 flex-shrink-0"
              />
              <span className="text-text-secondary text-sm leading-relaxed">
                Seçtiğim modu ve KVKK aydınlatma metnini kabul ediyor, kişisel verilerimin bu kapsamda işlenmesine açık rıza veriyorum.
              </span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(4)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-bg-main border border-border text-text-secondary hover:text-text-primary"
              >
                Geri
              </button>
              <button
                disabled={!consentChecked || saving}
                onClick={handleFinish}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-accent-purple text-white hover:bg-accent-purple/90"
              >
                {saving ? 'Kaydediliyor...' : "Sadık'ı Başlat"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
