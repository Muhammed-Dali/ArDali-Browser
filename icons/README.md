# icons/ Klasor Rehberi

Bu klasor, ikon kalabaligini azaltmak icin 3 kategoriye ayrildi.

## app/

Uygulama markasi, paketleme ikonlari ve ArDali alt uygulama logolari:

- `ardali.ico`
- `ardali.png`
- `ardali_24.png`
- `ardali_256.png`
- `ardali_512.png`
- `ardali_alt_boldA_1024.png`
- `ardali_alt_boldA_transparent_1024.png`
- `ardali_dawlod.png`
- `ardali_dawlod_menu.png`
- `ardali_logo.bmp`
- `ardali_readme_round.png`

## platforms/

Web platform logolari:

- `youtube_music.svg`
- `youtube_modern.svg`
- `deezer.svg`
- `soundcloud.svg`
- `facebook.svg`
- `instagram.svg`
- `tiktok.svg`
- `x.svg`
- `reddit.svg`
- `twitch.svg`
- `telegram.svg`
- `whatsapp.svg`

## ui/

Uygulama ici arac, navigasyon, fallback, tray ve README ozellik ikonlari:

- `advanced-*.svg`
- `download-*.svg`
- `fallback_*.svg`
- `nav_*.svg`
- `readme_*.svg`
- `settings-*.svg`
- `tray-*.png`
- `deliblock.svg`
- `video_tools_studio.svg`

## Notlar

- Inno Setup dosyasi ikon olmadigi icin `packaging/windows/setup_final.iss` altina tasindi.
- Yeni ikon eklerken once uygun kategoriye koy, sonra kullanim yerinde `icons/<kategori>/<dosya>` yolunu kullan.
- Kullanilmayan ikon kontrolu icin `npm run icons:unused` calistirilabilir.
