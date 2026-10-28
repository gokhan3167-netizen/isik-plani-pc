# Işık Planı – Bilgisayar (Windows / Mac) sürümü

İki yol var. Hemen kullanmak için **1. yol** yeterli; kurulum dosyası (.exe / .dmg) dağıtmak istersen **2. yol**.

## 1. yol: Tarayıcıdan kur (kod yok, 1 dakika)
Telefon için yüklediğin adresi (Netlify / GitHub Pages) bilgisayarda **Chrome** ya da **Edge**'de aç:
- Adres çubuğunun sağındaki **Yükle** simgesine tıkla (ya da menü › Uygulamayı yükle).
- Başlat menüsünde / masaüstünde "Işık Planı" simgesi oluşur, kendi penceresinde açılır, internetsiz çalışır.
- Mac'te Safari: Dosya › **Dock'a Ekle**.

## 2. yol: Gerçek masaüstü programı (.exe / .dmg)
Bu klasör **Electron** projesidir. Telefondaki programla aynı kod, ayrı bir masaüstü programına dönüşür.

### a) Kendi bilgisayarında derle
Bilgisayara **Node.js (LTS)** kur, bu klasörde terminal aç:
```
npm install
npm start            (programı dener)
npm run dist:win     (Windows'ta: dist klasöründe kurulum .exe dosyası)
npm run dist:mac     (Mac'te: dist klasöründe .dmg dosyası)
```
Windows kurulum dosyası Windows'ta, Mac dosyası Mac'te üretilir.

### b) Hiçbir şey kurmadan GitHub ile derle (önerilen)
1. Bu klasörü GitHub'da yeni bir depoya yükle (`.github` klasörü dahil; telefondan yüklüyorsan gizli klasörleri görmek için bilgisayar daha rahat).
2. Depoda **Actions** › **Masaüstü sürümünü derle** › **Run workflow**.
3. 5–10 dakika sonra aynı sayfanın altında **Windows (.exe)** ve **Mac (.dmg)** dosyaları indirilmeye hazır olur. İkisi de aynı anda, ücretsiz.

## İmza uyarıları (bilmen gerekenler)
- **Windows:** İmzasız program ilk açılışta "Windows bilgisayarınızı korudu" uyarısı verir › **Ek bilgi › Yine de çalıştır**. Uyarının tamamen kalkması için ücretli kod imzalama sertifikası gerekir; ekip içi kullanımda gerek yok.
- **Mac:** İmzasız programda "doğrulanamadı" uyarısı çıkar › programa **sağ tık › Aç › Aç** (ilk sefere mahsus). Uyarısız dağıtım için Apple Developer hesabıyla imzalama ve noter onayı gerekir (iPhone için açacağın hesap bunu da kapsar).

## Mağazalar
- **Microsoft Store:** Telefon için yüklediğin adresi pwabuilder.com'a verirsen Microsoft Store paketi üretir.
- **Mac App Store:** iPhone'daki Apple hesabıyla mümkün, ama ek ayar ister; gerekirse sonra yaparız.

## Masaüstüne özel
- Fare tekerleği ile yakınlaştırma, sağ tık menüsü, Shift ile çoklu seçim, klavye kısayolları:
  Ctrl/Cmd+Z geri al, Ctrl/Cmd+C/V/D kopyala/yapıştır/çoğalt, Ctrl/Cmd+A tümünü seç, R döndür, M ölçü, Delete sil, ok tuşları taşı (Shift ile 1 m).
- Dışa aktarınca **Farklı kaydet** penceresi açılır, dosyayı istediğin klasöre kaydedersin.
- Planlar bilgisayarda programın kendi klasöründe saklanır. Telefonla bilgisayar arasında taşımak için Aktar › **Projeyi kaydet (.json)** ve diğer cihazda **Proje aç**.
- Ekran büyük olduğu için sol panelde projektör listesi, sağda özellikler paneli hep açık durur.
