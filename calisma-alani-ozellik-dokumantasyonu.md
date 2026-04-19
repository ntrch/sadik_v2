content = """# Özellik Gereksinim Dokümanı: Çalışma Alanı (Workspace)



\## 1. Genel Bakış

\*\*Özellik Adı:\*\* Çalışma Alanı (Workspace)  

\*\*Konum:\*\* Navigasyon Çubuğu (Navbar)  

\*\*Görsel Kimlik:\*\* Unique (benzersiz) ve renkli bir ikon.



Bu özellik, kullanıcının önceden tanımladığı eylemleri tek bir buton ("Run") ile toplu (bulk) bir şekilde gerçekleştirmesini sağlayan bir iş akışı otomasyonudur.



\## 2. Temel Fonksiyonlar ve Kullanıcı Deneyimi

Kullanıcı, kendi çalışma senaryosuna uygun özel alanlar oluşturabilir.



\### Örnek Senaryo (Yazılımcı Akışı):

Kullanıcı "Kodlama" isimli çalışma alanını çalıştırdığında şu işlemler otomatik olarak gerçekleşir:

\* \*\*Uygulama Başlatma:\*\* VSCode ve Terminal'in açılması.

\* \*\*Web Otomasyonu:\*\* Tarayıcıda GitHub sayfasının açılması.

\* \*\*Medya:\*\* Spotify'ın başlatılması.

\* \*\*Sistem Ayarları:\*\* Bilgisayarın "Gece Işığı" modunun aktif edilmesi.

\* \*\*Pencere Düzeni (Window Snapping):\*\* VSCode'un monitörün sağ yarısına, Terminal'in ise sol yarısına yerleştirilmesi.



\### Özelleştirme Seçenekleri:

\* \*\*Customization:\*\* Her çalışma alanı için özel isim, renk ve ikon atanabilir.

\* \*\*Yönetim:\*\* Mevcut çalışma alanları silinebilir veya düzenlenebilir.

\* \*\*Senkronizasyon:\*\* İstenilen preset veya custom modlar ile sync edilebilir. Çalışma alanı çalıştırıldığında, sistem otomatik olarak ilgili moda (Sadık modu vb.) geçiş yapar.



\## 3. Teknik Gereksinimler ve Uygulama Prensipleri

Özelliğin implementasyonu sırasında aşağıdaki kriterlere kesinlikle sadık kalınmalıdır:



\### Stabilite ve Geriye Dönük Uyumluluk:

\* Yeni özellik eklenirken mevcut çalışan hiçbir fonksiyon (animasyonlar, ses pipeline'ı (voice pipeline), mevcut modlar vb.) bozulmamalıdır.

\* Sistem bütünlüğü korunmalı, regresyon testleri planlı ve dikkatli şekilde yapılmalıdır.



\### Performans:

\* Özelliğin sistem performansı üzerinde olumsuz bir etkisi olmamalıdır.

\* Herhangi bir performans yükü oluşması durumunda, bu durum minimal düzeyde tutulmalı ve en optimize şekilde kurgulanmalıdır.



\---

\*Bu doküman kullanıcı tarafından iletilen bilgiler doğrultusunda, hiçbir veri değiştirilmeden oluşturulmuştur.\*

"""



with open("calisma-alani-ozellik-dokumantasyonu.md", "w", encoding="utf-8") as f:

&#x20;   f.write(content)



print("calisma-alani-ozellik-dokumantasyonu.md")

