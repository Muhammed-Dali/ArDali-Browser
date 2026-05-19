# Release Checklist

Bu dosya, ArDali Linux sürüm yayın akışını hızlıca doğrulamak içindir.

## Main Güncellemesi (Günlük Akış)

- [ ] Kod değişiklikleri `main` dalına pushlandı.
- [ ] `Build (Linux)` workflow'u `success`.
- [ ] `Build (Windows)` workflow'u (varsa) `success`.
- [ ] `Publish Pacman Repo` workflow'u `success`.
- [ ] Pacman repo testi:
  - [ ] `sudo pacman -Sy`
  - [ ] `sudo pacman -S ardali-bin`

## Sürüm Yayını (Tag/Release Akışı)

- [ ] `package.json` ve `package-lock.json` sürümü güncellendi.
- [ ] Gerekli packaging dosyaları (`PKGBUILD`, `.SRCINFO`) güncellendi.
- [ ] `main` pushlandı.
- [ ] `vX.Y.Z` tag pushlandı.
- [ ] `Release` workflow'u `success`.
- [ ] GitHub Release assetleri oluştu:
  - [ ] `ArDali-X.Y.Z-linux-x86_64.AppImage`
  - [ ] `latest-linux.yml`
- [ ] AUR (`ardali-bin`) güncellendi ve pushlandı.
- [ ] `Publish Pacman Repo` workflow'u `success`.

## Son Doğrulama

- [ ] README kurulum adımları güncel.
- [ ] AUR sayfasında yeni sürüm görünüyor.
- [ ] Pacman repo üzerinden güncelleme çalışıyor.
