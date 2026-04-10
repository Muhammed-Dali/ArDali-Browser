
# Flatpak (Flathub) Hazirligi

Bu klasor, `com.aurivo.mediaplayer` uygulamasi icin Flatpak manifestini ve yardimci dosyalari icerir.

## Hizli Ozet

1. Lokal Flatpak build testi yap.
2. AppStream metadatasini dogrula.
3. `flathub/flathub` reposuna `new-pr` tabanli PR ac.
4. Review yorumlarina gore manifest izinlerini ve build adimlarini guncelle.

## Gereken Araclar

```bash
sudo pacman -S --needed flatpak flatpak-builder appstream
```

Runtime/Sdk:

```bash
flatpak install -y flathub org.freedesktop.Sdk//24.08 org.freedesktop.Platform//24.08
```

## Lokal Build Testi

Manifest mevcut haliyle `dist/linux-unpacked/aurivo` bekler. Bu nedenle once:

```bash
npm run build:linux
```

Ardindan:

```bash
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/com.aurivo.mediaplayer.yml
flatpak run com.aurivo.mediaplayer
```

## AppStream Dogrulama

```bash
appstreamcli validate packaging/appstream/com.aurivo.mediaplayer.metainfo.xml
```

## Flathub'a Gonderim

1. GitHub'da `flathub/flathub` reposunu forklayip clone et.
2. Forkta `new-pr/com.aurivo.mediaplayer` dali ac.
3. Asagidaki dosyalari `flathub` repo icinde `com.aurivo.mediaplayer/` klasorune koy:
   - `com.aurivo.mediaplayer.yml`
   - `com.aurivo.mediaplayer.metainfo.xml` (gerekirse ayni adla)
   - `com.aurivo.mediaplayer.desktop`
4. Flathub'a PR ac.
5. Bot ve reviewer geri bildirimlerini uygula.

## Onemli Not

- Mevcut manifest prebuilt `linux-unpacked` kullaniyor. Flathub review'da kaynaklardan uretim talep edilebilir.
- Izinleri minimum tutmak review hizini artirir.
