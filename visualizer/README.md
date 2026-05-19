# ArDali projectM Visualizer

Bu visualizer **kesinlikle sistem/mikrofon/monitor capture kullanmaz**.
Sadece ArDali Media Player'ın kendi audio pipeline'ından alınan **PCM tap** verisi ile (Electron → stdin) beslenir.

## Audio IPC (stdin)
Electron, visualizer process'inin `stdin`'ine float32 PCM yazar.

**Protokol v2 (little-endian):**

- Header: `[u32 channels][u32 framesPerChannel]`
- Payload: `float32 * (channels * framesPerChannel)`
  - Interleaved (stereo ise `LRLRLR...`)
  - Aralık: `-1..1`

Visualizer tarafında PCM akışı kesilirse/pause olursa:

- Son PCM zamanı takip edilir.
- ~150ms PCM gelmezse otomatik olarak **silence kabul edilir** ve projectM buffer'ı sıfırlanır.
- Electron'dan "silence packet" göndermek **zorunlu değildir**.
- CPU düşük kalsın diye idle durumda FPS ~30'a düşürülür.

## Debug
Debug kapalıyken ekranda hiçbir audio status yazısı çizilmez.

Açmak için:

- Arg: `--debug`
- Env: `ARDALI_VIS_DEBUG=1`

## Smoke test (Wayland/X11)
Presets path'i için örnek:

- Wayland:
  - `SDL_VIDEODRIVER=wayland PROJECTM_PRESETS_PATH=third_party/projectm/presets ./build-visualizer/ardali-projectm-visualizer --debug`
- X11:
  - `SDL_VIDEODRIVER=x11 PROJECTM_PRESETS_PATH=third_party/projectm/presets ./build-visualizer/ardali-projectm-visualizer --debug`

Not: Normal çalıştırmada visualizer Electron tarafından spawn edilir ve PCM otomatik pipe edilir.
