# Aurivo Flathub Submission Plan

Bu dokuman, Aurivo'yu Flathub'a gondermek icin net adimlari listeler.

## 1) Hazirlik

1. Kodun guncel oldugundan emin ol.
2. Flatpak araclarini kur:
```bash
sudo pacman -S --needed flatpak flatpak-builder appstream
```
3. Runtime/Sdk kur:
```bash
flatpak install -y flathub org.freedesktop.Sdk//24.08 org.freedesktop.Platform//24.08
```

## 2) Lokal Test

Manifest su an `dist/linux-unpacked` bekliyor:

```bash
npm run build:linux
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/com.aurivo.mediaplayer.yml
flatpak run com.aurivo.mediaplayer
```

## 3) Metadata Kontrol

```bash
appstreamcli validate packaging/appstream/com.aurivo.mediaplayer.metainfo.xml
```

## 3.1) Flathub Uyum Notlari (Guncel)

1. Flatpak wrapper'da `--no-sandbox` ve `--disable-setuid-sandbox` kullanilmaz.
2. Flatpak runtime icinde uygulama ici AUR/self-update akisi devre disidir.
3. Manifest izinleri daraltildi (`--device=all` ve `--socket=session-bus` kaldirildi).

## 4) Flathub PR Acma

0. Teslim klasorunu otomatik hazirla:
```bash
bash scripts/prepare-flathub-pr.sh
```
Uretim klasoru: `.dist/flathub-pr/com.aurivo.mediaplayer`

1. `flathub/flathub` reposunu forkla.
2. Fork icinde dal ac:
```bash
git checkout -b new-pr/com.aurivo.mediaplayer
```
3. Flathub repo icinde klasor olustur:
```bash
mkdir -p com.aurivo.mediaplayer
```
4. Dosyalari kopyala (otomatik uretim klasorunden):
```bash
cp /path/to/Aurivo-Medya-Player/.dist/flathub-pr/com.aurivo.mediaplayer/com.aurivo.mediaplayer.yml com.aurivo.mediaplayer/
cp /path/to/Aurivo-Medya-Player/.dist/flathub-pr/com.aurivo.mediaplayer/com.aurivo.mediaplayer.metainfo.xml com.aurivo.mediaplayer/
cp /path/to/Aurivo-Medya-Player/.dist/flathub-pr/com.aurivo.mediaplayer/com.aurivo.mediaplayer.desktop com.aurivo.mediaplayer/
```
5. Commit + push + PR:
```bash
git add com.aurivo.mediaplayer
git commit -m "Add com.aurivo.mediaplayer"
git push origin new-pr/com.aurivo.mediaplayer
```

## 5) Review Sonrasi

1. Flathub bot hatalarini duzelt.
2. Reviewer izin/manifest taleplerini uygula.
3. Merge sonrasi uygulama Flathub'da yayinlanir ve KDE Discover / GNOME Software'da gorunur.

## Bilinen Risk

Mevcut manifest prebuilt `linux-unpacked` kullaniyor. Flathub reviewer kaynak koddan build talep edebilir. Boyle bir geri donus gelirse manifest, Electron/Node kaynak build akisina tasinmalidir.
