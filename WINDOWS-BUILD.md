# WINDOWS BUILD

## Gerekli Bilesenler
- Node.js (LTS)
- Visual Studio Build Tools (C++ Desktop)
- CMake
- MSYS2 (mingw64)
- Git

## Ortam
- MSYS2 PATH: C:\msys64\mingw64\bin
  - Not: `npm run prepare:win:resources` ve `npm run build:win` artık `AURIVO_VISUALIZER_DLL_DIR` verilmemişse
    varsayılan olarak `C:\msys64\mingw64\bin` / `C:\msys2\mingw64\bin` yollarını dener.
  - İsterseniz açıkça ayarlayın: `setx AURIVO_VISUALIZER_DLL_DIR "C:\msys64\mingw64\bin"`

## Adimlar
1. npm ci
2. cd native; npm ci; cd ..
3. Visualizer:
   - cmake -S visualizer -B build-visualizer
   - cmake --build build-visualizer --config Release
   - Copy-Item build-visualizer\aurivo-projectm-visualizer.exe native-dist\aurivo-projectm-visualizer.exe -Force
4. Kaynak kopyalama:
   - npm run prepare:win:resources
5. Build:
   - npm run build:win

## Sorun Giderme
- app.asar silinemiyor: uygulama veya electron process kapali olmali.
- ffmpeg.exe placeholder: gercek ffmpeg.exe ile degistir.
- Visualizer acilip kapanirsa: gerekli DLL'ler native-dist icinde olmali.

## (Opsiyonel) Arch Linux'ta hızlı Windows Visualizer build + Wine testi
> Not: Bu adım sadece `aurivo-projectm-visualizer.exe` içindir. Tam Windows kurulum çıktısı için yine Windows/MSYS2 veya GitHub Actions önerilir.

- `scripts/build-visualizer-win-mingw.sh --clean --run-wine`
