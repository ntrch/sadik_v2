export const KVKK_NOTICE_VERSION = '2026-04-20';

export interface KvkkSection {
  title: string;
  body: string[];
}

export const KVKK_NOTICE: KvkkSection[] = [
  {
    title: '1. Veri Sorumlusu',
    body: [
      'SADIK uygulaması, kişisel masaüstü verimlilik asistanı olarak yerel cihazınızda çalışır. Uygulama geliştiricisi veri sorumlusu sıfatıyla bu aydınlatma metnini 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında hazırlamıştır.',
    ],
  },
  {
    title: '2. İşlenen Kişisel Veriler',
    body: [
      'Uygulama şu verileri cihazınızda yerel olarak işleyebilir: görev ve alışkanlık listeleri, odaklanma geçmişi, uygulama kullanım istatistikleri, panoya kopyaladığınız metinler, sesli komut metinleri, yapay zeka sohbet geçmişi, entegrasyon bilgileri (Google Takvim, Notion) ve ayar tercihleri.',
      'Kayıtların büyük kısmı yalnızca cihazınızdaki yerel veritabanında tutulur.',
    ],
  },
  {
    title: '3. Verilerin İşlenme Amacı',
    body: [
      'Veriler; günlük planlama, hatırlatma, alışkanlık takibi, sesli asistan fonksiyonu, odak modu ve proaktif öneri üretimi amaçlarıyla işlenir.',
      'Yapay zeka cevabı üretmek için gerekli içerik, yalnızca siz o özelliği kullandığınızda OpenAI sunucularına gönderilir. Bu gönderim sırasında hassas bilgiler (e-posta adresi, telefon, IBAN, API anahtarı, kart numarası) otomatik olarak maskelenir.',
    ],
  },
  {
    title: '4. Verilerin Aktarılması',
    body: [
      'Veriler yalnızca aşağıdaki durumlarda üçüncü taraflara aktarılır:',
      '• OpenAI (yapay zeka cevabı ve sesli komut anlama): yalnızca siz sesli/yazılı etkileşim başlattığınızda. Redaction (maskeleme) katmanından geçer.',
      '• Google Takvim, Notion gibi entegrasyonlar: yalnızca ilgili entegrasyonu siz bağladığınızda ve yetkilendirme verdiğinizde kendi hesaplarınız arasında veri okunur.',
      'Gizlilik bölümündeki ilgili anahtarı kapattığınız sürece bu aktarım gerçekleşmez.',
    ],
  },
  {
    title: '5. Verilerin Saklanması',
    body: [
      'Tüm veriler yalnızca kullandığınız cihazdaki yerel SQLite veritabanında saklanır. Uygulama kendi sunucusunda kullanıcı verisi tutmaz.',
      'OpenAI ve entegrasyon sağlayıcılarının kendi veri saklama politikaları geçerlidir; bu hizmetlere gönderilen verilerin saklama süresi ilgili sağlayıcının koşullarına tabidir.',
    ],
  },
  {
    title: '6. Haklarınız (KVKK m.11)',
    body: [
      'Kişisel verilerinizle ilgili aşağıdaki haklara sahipsiniz:',
      '• İşlenen verileri öğrenme ve bunlara erişim: Ayarlar → Gizlilik → "Verimi İndir" butonu tek tık ile tüm verilerinizi JSON olarak indirir.',
      '• Verilerin silinmesini isteme: Ayarlar → Gizlilik → "Tüm Verimi Sil" butonu iki adımlı onay ile tüm kişisel verilerinizi ve ayarları siler.',
      '• Verilerin yanlış işlendiğini düşünüyorsanız ilgili anahtarı kapatarak işlemeyi durdurabilirsiniz.',
    ],
  },
  {
    title: '7. Rıza ve Geri Çekme',
    body: [
      'Gizlilik tercihleri varsayılan olarak kapalıdır. Her anahtar bilinçli açık rıza ile aktif edilir; dilediğiniz zaman Ayarlar → Gizlilik bölümünden kapatabilirsiniz. Kapatma, bundan sonraki işlemeler için geçerli olur; geçmişte maskelenmiş olarak üçüncü taraflara gönderilmiş verileri geri getirmez.',
    ],
  },
  {
    title: '8. İletişim',
    body: [
      'Bu aydınlatma metni veya kişisel verilerinizle ilgili sorularınız için uygulama geliştiricisi ile iletişime geçebilirsiniz. Beta sürecinde iletişim kanalı GitHub üzerinden sağlanmaktadır.',
    ],
  },
  {
    title: '9. Değişiklikler',
    body: [
      'Bu metin, yasal düzenlemeler veya ürün değişikliklerine bağlı olarak güncellenebilir. Güncel metin her zaman Ayarlar → Gizlilik bölümünden erişilebilir. Yürürlük tarihi: ' + KVKK_NOTICE_VERSION + '.',
    ],
  },
];
