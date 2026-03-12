
# Flatpak (Flathub) hazirligi

Bu klasor, `com.aurivo.mediaplayer` icin Flathub odakli baslangic manifestini icerir.

## 1) Gereken araclar

```bash
sudo pacman -S --needed flatpak flatpak-builder python-pip
pip install --user flatpak-node-generator
```

## 2) Node kaynak kilidini uret

Proje kokunde:

```bash
cd /home/muhammet-dali/Aurivo-Medya-Player-Linux-main
~/.local/bin/flatpak-node-generator npm package-lock.json --output packaging/flatpak/generated-sources.json
```

Bu adim Flathub icin zorunludur (build sirasinda internet kapali oldugu icin).

Build oncesi runtime kurulumu:

```bash
flatpak install -y flathub org.freedesktop.Sdk//24.08 org.freedesktop.Platform//24.08
```

## 3) Lokal Flatpak build testi

Flatpak paketlemeden once host sistemde `linux-unpacked` cikisi uret:

```bash
cd /home/muhammet-dali/Aurivo-Medya-Player-Linux-main
npm run build:linux
```

Ardindan Flatpak paketle:

```bash
cd /home/muhammet-dali/Aurivo-Medya-Player-Linux-main
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/com.aurivo.mediaplayer.yml
flatpak run com.aurivo.mediaplayer
```

## 4) Flathub yayini (Discover icin)

1. `flathub/com.aurivo.mediaplayer` reposu olustur.
2. Su dosyalari Flathub reposuna koy:
   - `com.aurivo.mediaplayer.yml`
   - `generated-sources.json`
3. Flathub'a PR ac.
4. Onaydan sonra KDE Discover / GNOME Software'da gorunur.

## Notlar

- Manifest su an Electron `linux-unpacked` cikisini Flatpak icine yerlestirir.
- Manifest, `dist/linux-unpacked` hostta hazir oldugunu varsayar.
- Bu surumde `Electron2.BaseApp` zorunlulugu kaldirildi; uygulama kendi Electron binary'si ile calisir.
- `StartupWMClass=aurivo` secimi, Linux'ta pencere gruplamasini iyilestirmek icin ayarlanmistir.
