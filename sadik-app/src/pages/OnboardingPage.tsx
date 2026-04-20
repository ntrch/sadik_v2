import React, { useState } from 'react';
import { settingsApi } from '../api/settings';

interface Props {
  onComplete: () => void;
}

const TOGGLE_LABELS: Record<string, { title: string; desc: string }> = {
  privacy_behavioral_learning: {
    title: 'Davranış Öğrenme',
    desc: 'Sadık kullanım alışkanlıklarını öğrenir ve önerilerini kişiselleştirir.',
  },
  privacy_calendar_push: {
    title: 'Takvim Bilgisini LLM\'e Aktar',
    desc: 'Takvim etkinliklerin konuşma bağlamı olarak yapay zekaya gönderilir.',
  },
  privacy_notion_push: {
    title: 'Notion İçeriğini LLM\'e Aktar',
    desc: 'Notion sayfaların konuşma bağlamı olarak yapay zekaya gönderilir.',
  },
  privacy_voice_memory: {
    title: 'Ses Hafızası',
    desc: 'Sesli konuşmalar özetlenerek uzun vadeli hafızada saklanır.',
  },
};

const TOGGLE_KEYS = Object.keys(TOGGLE_LABELS);

export default function OnboardingPage({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [readChecked, setReadChecked] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(TOGGLE_KEYS.map((k) => [k, false]))
  );
  const [consentChecked, setConsentChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKvkkModal, setShowKvkkModal] = useState(false);

  const activeToggles = TOGGLE_KEYS.filter((k) => toggles[k]);

  async function handleFinish() {
    if (!consentChecked || saving) return;
    setSaving(true);
    try {
      const updates: Record<string, string> = { onboarding_completed: 'true' };
      for (const k of TOGGLE_KEYS) updates[k] = toggles[k] ? 'true' : 'false';
      await settingsApi.update(updates);
      onComplete();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg/95 backdrop-blur flex items-center justify-center p-4">
      {showKvkkModal && (
        <div className="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-card max-w-lg w-full p-6 flex flex-col gap-4">
            <h2 className="text-text-primary font-semibold text-lg">KVKK Aydınlatma Metni</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              Bu metin T2.6 sprint kapsamında doldurulacaktır. Kişisel verilerin işlenmesi, veri sorumlusu, aktarım ve haklarınız hakkında tam metin burada yer alacaktır.
            </p>
            <button
              onClick={() => setShowKvkkModal(false)}
              className="self-end px-4 py-2 rounded-card bg-accent-purple/20 text-accent-purple border border-accent-purple/30 text-sm font-semibold hover:bg-accent-purple/30 transition-colors"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      <div className="bg-bg-card border border-border rounded-card max-w-lg w-full flex flex-col gap-6 p-6">
        {/* Stepper */}
        <div className="flex items-center justify-center gap-3">
          {[1, 2, 3].map((n) => (
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
              {n < 3 && (
                <div className={`flex-1 h-px max-w-[40px] ${step > n ? 'bg-accent-purple/40' : 'bg-border'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-text-primary text-xl font-bold">Sadik'a Hos Geldin</h1>
            <p className="text-text-secondary text-sm leading-relaxed">
              Sadik, gunluk gorev takibi, aliskanlık yonetimi, takvim entegrasyonu ve sesli asistan ozellikleriyle sana ozel calisan bir masaustu yapay zeka asistanidir. Seni tanıdıkca daha iyi oneri sunar.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">
              Sadik; gorevlerini, takvim etkinliklerini, Notion iceriklerini ve ses konusmalarini isleyebilir. Bu veriler varsayilan olarak yalnizca yerel cihazinda saklanir. Bazi ozellikler icin ilgili toggle'i acman durumunda veri, yalnizca o ozelligin calistirilmasi amaciyla LLM'e gonderilebilir.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">
              KVKK kapsaminda verilerini diledigin zaman silebilir veya indirebilirsin. Tum hakların Settings → Gizlilik bolumunde listelidir.
            </p>
            <button
              onClick={() => setShowKvkkModal(true)}
              className="text-accent-purple text-sm underline text-left w-fit"
            >
              KVKK Aydinlatma Metni'nin Tamamini Oku
            </button>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={readChecked}
                onChange={(e) => setReadChecked(e.target.checked)}
                className="mt-0.5 accent-purple-500 w-4 h-4 flex-shrink-0"
              />
              <span className="text-text-secondary text-sm">
                Aydinlatma metnini okudum, anladim.
              </span>
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

        {/* Step 2 */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-lg font-bold">Gizlilik Tercihleri</h2>
            <div className="flex flex-col gap-3">
              {TOGGLE_KEYS.map((k) => {
                const { title, desc } = TOGGLE_LABELS[k];
                return (
                  <div key={k} className="flex items-start gap-3 bg-bg-main border border-border rounded-card p-3">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-text-primary text-sm font-medium">{title}</span>
                      <span className="text-text-secondary text-xs leading-relaxed">{desc}</span>
                    </div>
                    <button
                      role="switch"
                      aria-checked={toggles[k]}
                      onClick={() => setToggles((prev) => ({ ...prev, [k]: !prev[k] }))}
                      className={`relative flex-shrink-0 mt-0.5 w-10 h-5 rounded-full transition-colors ${
                        toggles[k] ? 'bg-accent-purple' : 'bg-border'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          toggles[k] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-text-secondary text-xs leading-relaxed">
              Bu ayarlari Settings → Gizlilik bolumunden her zaman degistirebilirsin. Tum anahtarlar kapali kalsa bile Sadik temel islevleriyle calisir.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-bg-main border border-border text-text-secondary hover:text-text-primary"
              >
                Geri
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-accent-purple text-white hover:bg-accent-purple/90"
              >
                Devam Et
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-text-primary text-lg font-bold">Acik Riza Onayi</h2>
            <div className="bg-bg-main border border-border rounded-card p-3 flex flex-col gap-1">
              <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">Sectiklerin</span>
              {activeToggles.length === 0 ? (
                <span className="text-text-secondary text-sm">Tum cloud paylasimi kapali</span>
              ) : (
                activeToggles.map((k) => (
                  <span key={k} className="text-text-primary text-sm">
                    • {TOGGLE_LABELS[k].title}
                  </span>
                ))
              )}
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 accent-purple-500 w-4 h-4 flex-shrink-0"
              />
              <span className="text-text-secondary text-sm leading-relaxed">
                Yukardaki tercihleri ve KVKK aydinlatma metnini kabul ediyor, kisisel verilerimin bu kapsamda islenmesine acik riza veriyorum.
              </span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors bg-bg-main border border-border text-text-secondary hover:text-text-primary"
              >
                Geri
              </button>
              <button
                disabled={!consentChecked || saving}
                onClick={handleFinish}
                className="flex-1 py-2.5 rounded-card text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-accent-purple text-white hover:bg-accent-purple/90"
              >
                {saving ? 'Kaydediliyor...' : "Sadik'i Baslat"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
