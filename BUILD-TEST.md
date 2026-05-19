# ArDali Build & Test (Production)

## Hedefler
1. Visualizer penceresi sol üstte ArDali logosunu göstermeli
2. Visualizer sadece ArDali'nun PCM çıkışını işlemeli (mikrofon YOK)

---

## Linux Build & Test

### 1. Build (AppImage)
```bash
npm run build:linux
```

Çıktı (örnek): `dist/ArDali-*-linux-x64.AppImage`

### 2. Kurulum & Test
```bash
# AppImage'i çalıştırılabilir yap
chmod +x dist/ArDali-*.AppImage

# Çalıştır
./dist/ArDali-*.AppImage
```

### 3. Visualizer Testi
> Not: `npm run build:linux` öncesi `native-dist/ardali-projectm-visualizer` dosyası mevcut olmalıdır (visualizer CMake build çıktısı).

**A) İkon Kontrolü:**
1. Uygulamayı aç
2. Herhangi bir müzik dosyası çal
3. "Görselleştirme" butonuna tıkla
4. ✅ Visualizer penceresi açılır ve **sol üst köşede ArDali ikonu** görünür

**B) Mikrofon Kontrolü (Ses Kaynağı):**
1. Uygulamada müzik ÇALMAYIN (durdur/pause)
2. Mikrofona konuşun (veya başka bir ses kaynağı kullanın)
3. ✅ Visualizer **hareket etmemeli** (silence/statik)
4. Şimdi uygulamada müzik çalın
5. ✅ Visualizer **sadece müzik çalarken hareket etmeli**

**C) Loglar (Terminal):**
AppImage'i terminalden çalıştırıp visualizer açtığınızda şu logları görmeli:
```
[Visualizer] starting: <path>
[Visualizer] ✓ Input source: ArDali PCM only (NO mic/capture)
...
[Audio] ✓ projectM input = ardali_pcm (stdin only, NO mic/capture)
```

---

## Windows Build & Test

### 1. Build (NSIS Installer)
```bash
npm run build:win
```

> Not: `build:win` komutu artık Windows native dosyalarını doğrular. Linux'ta yanlışlıkla Windows installer üretip (ELF) dağıtmayı engellemek için build öncesi `scripts/verify-win-artifacts.js` çalışır.

Çıktı:
- `dist/ArDali-1.0.0-win-x64.exe` (NSIS installer)
- `dist/ArDali-1.0.0-win-x64.zip` (portable)

### 2. Kurulum & Test
- NSIS installer'ı çalıştır
- Kurulum bitince masaüstünde "ArDali" kısayolu otomatik oluşur
- Uygulamayı aç

### 3. Visualizer Testi
Yukarıdaki Linux test adımlarını (A, B, C) uygula.

---

## Sorun Giderme

### Visualizer ikonu görünmüyor
```bash
# extraFiles doğru kopyalandı mı kontrol et
ls -la dist/linux-unpacked/resources/icons/ardali_logo.bmp
ls -la dist/linux-unpacked/resources/native-dist/ardali-projectm-visualizer
```

### Visualizer mikrofonu kullanıyor (hareket ediyor)
- Bu OLMAMALI. Kodda capture yok.
- PCM feed çalışıyor mu kontrol et: terminal loglarında `[DSP CALLBACK]` mesajları görünmeli

### Build Hataları
```bash
# Native modülleri yeniden derle
npm run rebuild-native
#
# Not: Bu komut `native/` içinde otomatik `npm ci` çalıştırır (node-addon-api vb. için).

# Visualizer'ı yeniden derle
rm -rf build-visualizer
cmake -S visualizer -B build-visualizer
cmake --build build-visualizer
cp build-visualizer/ardali-projectm-visualizer native-dist/
```

---

## Değişen Dosyalar (Son Commit)

### Resource Path & Icon
- [main.js](main.js): `getResourcePath()` helper (dev/prod path çözümlemesi)
- [main.js](main.js): Visualizer icon path `ARDALI_VISUALIZER_ICON` env
- [visualizer/main_imgui.cpp](visualizer/main_imgui.cpp): `SDL_SetWindowIcon()` eklendi

### Packaging
- [package.json](package.json): `extraFiles` visualizer binary + presets + icon
- [icons/ardali_logo.bmp](icons/ardali_logo.bmp): SDL_LoadBMP için BMP format

### Mikrofon Garantisi
- [visualizer/main_imgui.cpp](visualizer/main_imgui.cpp): Log "projectM input = ardali_pcm"
- [main.js](main.js): Log "Input source: ArDali PCM only"
- Kod zaten stdin-only; capture kodu yok

### CMake
- [visualizer/CMakeLists.txt](visualizer/CMakeLists.txt): SDL2_image opsiyonel link
