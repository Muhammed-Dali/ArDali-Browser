<p align="center">
  <img src="icons/aurivo_readme_round.png" width="120" height="120" alt="Aurivo Medya Player"/>
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#turkce">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux">
    <img alt="release" src="https://img.shields.io/github/v/release/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux?display_name=tag&sort=semver&style=for-the-badge&labelColor=0b1220&color=22c55e"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux">
    <img alt="downloads" src="https://img.shields.io/github/downloads/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/total?style=for-the-badge&labelColor=0b1220&color=06b6d4"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/actions">
    <img alt="build" src="https://img.shields.io/github/actions/workflow/status/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/release.yml?branch=main&label=build&style=for-the-badge&labelColor=0b1220"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/blob/main/LICENSE">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-6366f1?style=for-the-badge&labelColor=0b1220"/>
  </a>
</p>

<p align="center">
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download AppImage" src="https://img.shields.io/badge/Download-AppImage-14b8a6?style=for-the-badge&logo=linux&logoColor=ffffff&labelColor=0b1220"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download .deb" src="https://img.shields.io/badge/Download-.deb-0ea5e9?style=for-the-badge&logo=debian&logoColor=ffffff&labelColor=0b1220"/>
  </a>
  <a href="https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest">
    <img alt="Download .rpm" src="https://img.shields.io/badge/Download-.rpm-8b5cf6?style=for-the-badge&logo=fedora&logoColor=ffffff&labelColor=0b1220"/>
  </a>
</p>

<p align="center">
  <img src="screenshots/aber/shot-00.png" alt="Aurivo Hero Screenshot" width="1000"/>
</p>

## English

### Aurivo Media Player (Linux)

Aurivo Media Player is a modern and lightweight player built for Linux.

## AI Audit Statement

This project was developed with active AI assistance.

> **Although all code was generated with AI support, every line was personally reviewed before release and validated with security and performance testing.**

In line with Linux community standards, all technical and legal responsibility for this project belongs to the developer, Muhammed.

## Binary Provenance & Integrity

This repository includes a limited set of native shared libraries (`.so` / `.so.*`) used by runtime and packaging.

- Provenance list: `THIRD_PARTY_BINARIES.md`
- Pinned hash manifest: `third_party/binary-manifest.json`
- Integrity check: `npm run verify:binary:manifest`

Release artifact checksum/signature flow is documented in `RELEASE-SIGNING.md`.

## Features

- Built-in web platform mode for media-focused browsing
- Web audio effects for online media playback
- Video player with dedicated video audio effects
- Music player with dedicated music audio effects
- YouTube content downloader
- Song recognition by listening
- Real-time visualization support
- Multi-language UI support (users can choose their preferred language)

## Screenshots

<details>
  <summary>View screenshots</summary>
  <br/>
  <table>
    <tr>
      <td><img src="screenshots/aber/shot-00.png" alt="Aurivo Screenshot 00"/></td>
      <td><img src="screenshots/aber/shot-01.png" alt="Aurivo Screenshot 01"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-02.png" alt="Aurivo Screenshot 02"/></td>
      <td><img src="screenshots/aber/shot-03.png" alt="Aurivo Screenshot 03"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-04.png" alt="Aurivo Screenshot 04"/></td>
      <td><img src="screenshots/aber/shot-05.png" alt="Aurivo Screenshot 05"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-06.png" alt="Aurivo Screenshot 06"/></td>
      <td></td>
    </tr>
  </table>
</details>

## Installation

Primary installation instruction for Arch-based Linux systems:

```bash
yay -S aurivo-bin
```

For other distributions, follow the latest packages and releases on the GitHub release page.

## Packages and Support

- Linux packages: `AppImage`, `.deb`, `.rpm` (see [latest releases](https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest))
- Bug reports and feature requests: [Issues](https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/issues)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## Known Behavior

On some USB/headset audio devices, disconnecting the device may switch the system output route and pause playback. Playback can continue by pressing play again.

## License

This project is released under the MIT License. See [LICENSE](LICENSE) for details.

---

## Turkce

### Aurivo Medya Player (Linux)

Aurivo Medya Player, Linux için geliştirilmiş modern ve hafif bir oynatıcıdır.

## AI Denetim Beyanı

Bu projenin geliştirilme sürecinde yapay zekadan aktif olarak destek alınmıştır.

> **Tüm kodlar AI desteğiyle üretilmiş olsa da, yayınlanmadan önce bizzat tarafımdan satır satır denetlenmiş, güvenlik ve performans testlerinden geçirilmiştir.**

Linux topluluğu standartlarına uygun şekilde, projeye ilişkin teknik ve yasal tüm sorumluluk geliştirici olarak tarafıma (Muhammed) aittir.

## Özellikler

- Medya odaklı kullanım için dahili web platform modu
- Web içerikleri için web ses efektleri
- Video oynatıcıda videoya özel ses efektleri
- Müzik çalarda müziğe özel ses efektleri
- YouTube içerik indirici
- Dinleyerek şarkı bulma
- Gerçek zamanlı görselleştirme desteği
- Çoklu dil desteği (kullanıcı istediği dilde kullanabilir)

## Ekran Görüntüleri

<details>
  <summary>Ekran görüntülerini göster</summary>
  <br/>
  <table>
    <tr>
      <td><img src="screenshots/aber/shot-00.png" alt="Aurivo Ekran Görüntüsü 00"/></td>
      <td><img src="screenshots/aber/shot-01.png" alt="Aurivo Ekran Görüntüsü 01"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-02.png" alt="Aurivo Ekran Görüntüsü 02"/></td>
      <td><img src="screenshots/aber/shot-03.png" alt="Aurivo Ekran Görüntüsü 03"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-04.png" alt="Aurivo Ekran Görüntüsü 04"/></td>
      <td><img src="screenshots/aber/shot-05.png" alt="Aurivo Ekran Görüntüsü 05"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-06.png" alt="Aurivo Ekran Görüntüsü 06"/></td>
      <td></td>
    </tr>
  </table>
</details>

## Kurulum

Arch tabanlı Linux sistemler için birincil kurulum talimatı:

```bash
yay -S aurivo-bin
```

Diğer dağıtımlar için güncel paketler ve sürümler yayın sayfasından takip edilebilir.

## Paketler ve Destek

- Linux paketleri: `AppImage`, `.deb`, `.rpm` ([son sürümler](https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/releases/latest))
- Hata ve özellik talepleri: [Issues](https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/issues)
- Katkı rehberi: [CONTRIBUTING.md](CONTRIBUTING.md)

## Bilinen Davranış

Bazı USB/kulaklık ses cihazlarında bağlantı kesildiğinde sistem ses çıkış rotası değişebilir ve oynatma durabilir. Oynatma, tekrar play ile devam ettirilebilir.

## Lisans

Bu proje MIT Lisansı ile sunulmaktadır. Detaylar için [LICENSE](LICENSE) dosyasına bakabilirsiniz.
