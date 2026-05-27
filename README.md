<p align="center">
  <img src="icons/app/ardali_readme_round.png" width="120" height="120" alt="ArDali Medya Player"/>
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#turkce">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/Muhammed-Dali/ArDali-WebMedia/releases/latest">
    <img alt="release" src="https://img.shields.io/github/v/release/Muhammed-Dali/ArDali-WebMedia?display_name=tag&sort=semver&style=for-the-badge&labelColor=0b1220&color=22c55e"/>
  </a>
  <a href="https://github.com/Muhammed-Dali/ArDali-WebMedia/releases">
    <img alt="downloads" src="https://img.shields.io/github/downloads/Muhammed-Dali/ArDali-WebMedia/total?style=for-the-badge&labelColor=0b1220&color=06b6d4"/>
  </a>
  <a href="https://github.com/Muhammed-Dali/ArDali-WebMedia/actions/workflows/build-linux.yml">
    <img alt="build" src="https://img.shields.io/github/actions/workflow/status/Muhammed-Dali/ArDali-WebMedia/build-linux.yml?branch=main&label=build&style=for-the-badge&labelColor=0b1220"/>
  </a>
  <a href="https://github.com/Muhammed-Dali/ArDali-WebMedia/blob/main/LICENSE">
    <img alt="license" src="https://img.shields.io/badge/license-GPL--3.0-6366f1?style=for-the-badge&labelColor=0b1220"/>
  </a>
</p>

<p align="center">
  <a href="https://github.com/Muhammed-Dali/ArDali-WebMedia/releases/latest">
    <img alt="Download AppImage" src="https://img.shields.io/badge/Download-AppImage-14b8a6?style=for-the-badge&logo=linux&logoColor=ffffff&labelColor=0b1220"/>
  </a>
  <a href="https://github.com/Muhammed-Dali/ArDali-WebMedia/releases/tag/pacman-repo">
    <img alt="Pacman Repo" src="https://img.shields.io/badge/Pacman-Repo-1793d1?style=for-the-badge&logo=archlinux&logoColor=ffffff&labelColor=0b1220"/>
  </a>
  <a href="https://aur.archlinux.org/packages/ardali-bin">
    <img alt="AUR package" src="https://img.shields.io/badge/AUR-ardali--bin-f59e0b?style=for-the-badge&logo=archlinux&logoColor=ffffff&labelColor=0b1220"/>
  </a>
</p>

<p align="center">
  <img src="screenshots/aber/shot-00.png" alt="ArDali Hero Screenshot" width="1000"/>
</p>

## English

### ArDali (v3.1.4)

Linux media player, web audio engine, music/video downloader, screen recorder, and projectM visualizer in one optimized desktop application.

ArDali is an advanced Electron-based multimedia ecosystem for Linux, designed around strong optimization principles. After 2 years of continuous and intensive development, its infrastructure and architecture have been fully renewed with the v3.1.4 release.

At the heart of the application is a custom-built technology layer that processes web-based audio streams with zero-latency behavior.

Keywords: Linux media player, Linux music player, Linux video player, Electron media player, YouTube downloader for Linux, audio equalizer, 32-band EQ, Shazam-like song recognition, screen recorder for Linux, OBS-style recorder, projectM visualizer, web audio engine, ad blocker browser, AppImage media player, Pacman repo, AUR package.

## Feature Map

<table>
  <tr>
    <th width="72">Icon</th>
    <th>Feature</th>
    <th>What it does</th>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/nav_video.svg" width="34" alt="Video playback icon"/></td>
    <td><strong>Video playback</strong></td>
    <td>Play local videos with a modern player, mini player, fullscreen controls, speed, subtitles, sleep timer, and smooth progress handling.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/video_tools_studio.svg" width="34" alt="Recorder icon"/></td>
    <td><strong>Recorder</strong></td>
    <td>Record the screen with a creator-focused workflow for tutorials, demos, and content production.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_music.svg" width="34" alt="Music playback icon"/></td>
    <td><strong>Music playback</strong></td>
    <td>Manage and play local music with playlists, metadata, album art, rich controls, equalizer, and audio effects.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_gallery.svg" width="34" alt="Gallery icon"/></td>
    <td><strong>Gallery</strong></td>
    <td>Browse images, open a lightbox, zoom, rotate, fit to screen, run slideshows, and apply quick photo adjustments.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/nav_internet.svg" width="34" alt="Web icon"/></td>
    <td><strong>Web</strong></td>
    <td>Use YouTube, YouTube Music, SoundCloud, Deezer, social platforms, and general web browsing inside one desktop app.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/deliblock.svg" width="34" alt="Ad blocker icon"/></td>
    <td><strong>Ad blocking</strong></td>
    <td>Filter ads, pop-ups, trackers, and noisy web elements through the integrated DeliBlock protection layer.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/app/ardali_dawlod.png" width="34" alt="Downloader icon"/></td>
    <td><strong>Downloader</strong></td>
    <td>Download media from supported platforms and save video or audio with local conversion options.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_pulse.svg" width="34" alt="Song recognition icon"/></td>
    <td><strong>Song recognition by listening</strong></td>
    <td>Listen to system or ambient audio and identify songs with an integrated acoustic fingerprinting workflow.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_projectm.svg" width="34" alt="projectM visualizer icon"/></td>
    <td><strong>projectM visualization</strong></td>
    <td>Render hardware-accelerated music visuals that react to rhythm, frequency, and energy.</td>
  </tr>
</table>

## AI Audit Statement

This project was developed with active AI assistance.

> **Although all code was generated with AI support, every line was personally reviewed before release and validated with security and performance testing.**

In line with Linux community standards, all technical and legal responsibility for this project belongs to the developer, Muhammed.

## Advanced Highlights

### 1. Custom Dali Audio Engine & `dali-lang` Core Engine

This is the most demanding and innovative part of the project. ArDali includes a built-in web audio engine powered by **`dali-lang`**, a custom programming language developed and compiled specifically for this project.

- Captures audio streams from web resources using `.dali` and `.dl` formats in real time.
- Provides hardware-level **32-band equalizer (EQ)** support for instant sound manipulation.
- Its most critical feature is **zero-latency** audio processing.

### 2. High System Optimization

ArDali challenges the common idea that Electron applications must consume heavy system resources.

- Intensive code optimizations keep the application lightweight while idle or during music playback.
- Even during high-quality video playback, memory usage is designed to stay around a **maximum of 700 MB RAM**.

### 3. Smart Song Recognition by Listening

ArDali can identify music playing in the environment or on the system through advanced acoustic fingerprinting, similar to an integrated Shazam-like workflow.

### 4. Advanced Media Downloader & Converter for Linux

ArDali can download video and music from popular social and media platforms, including YouTube and others, with a focused one-click workflow.

- Downloaded content can be converted locally into different audio and video formats at high speed.

### 5. Secure Ad Blocker Browser Experience

While using web-based platforms or browsing social media, ArDali automatically filters risky ads, trackers, and pop-ups that can harm the user experience or security.

### 6. projectM Visualization Integration

ArDali offers hardware-accelerated visual effects that dynamically react to the rhythm, frequency, and energy of the currently playing music.

### 7. OBS-Style Linux Screen Recorder & Broadcaster Mode

ArDali includes built-in screen recording infrastructure for developers, educators, and content creators who produce YouTube or tutorial content.

- Captures the screen while optionally overlaying an integrated webcam layer.
- Works with an OBS Studio-like scene/source model, optimized for quickly recording and saving content.

### 8. Social Platform & Web Integration

Popular social media and video platforms are brought together under a single fluid interface, reducing the need to switch to an external browser.

### 9. Advanced Linux Music Player

Manage local music libraries with smart metadata handling, playlists, album art, and rich playback controls.

### 10. Linux Video Player

Play local videos in a modern, smooth, and performance-focused interface with broad codec support.

## Binary Provenance & Integrity

This repository includes a limited set of native shared libraries (`.so` / `.so.*`) used by runtime and packaging.

- Provenance list: `THIRD_PARTY_BINARIES.md`
- Pinned hash manifest: `third_party/binary-manifest.json`
- Integrity check: `npm run verify:binary:manifest`

Release artifact checksum/signature flow is documented in `RELEASE-SIGNING.md`.

## Screenshots

<details>
  <summary>View screenshots</summary>
  <br/>
  <table>
    <tr>
      <td><img src="screenshots/aber/shot-00.png" alt="ArDali Screenshot 00"/></td>
      <td><img src="screenshots/aber/shot-01.png" alt="ArDali Screenshot 01"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-02.png" alt="ArDali Screenshot 02"/></td>
      <td><img src="screenshots/aber/shot-03.png" alt="ArDali Screenshot 03"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-04.png" alt="ArDali Screenshot 04"/></td>
      <td><img src="screenshots/aber/shot-05.png" alt="ArDali Screenshot 05"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-06.png" alt="ArDali Screenshot 06"/></td>
      <td><img src="screenshots/aber/shot-07.png" alt="ArDali Screenshot 07"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-08.png" alt="ArDali Screenshot 08"/></td>
      <td></td>
    </tr>
  </table>
</details>

## Installation

To clone and run the project locally:

```bash
git clone https://github.com/Muhammed-Dali/ArDali-WebMedia.git
cd ArDali-WebMedia
npm install
npm start
```

Primary installation instruction for Arch-based Linux systems:

```bash
yay -S ardali-bin
```

If ArDali is useful to you, you can quietly support it by voting on the [AUR package page](https://aur.archlinux.org/packages/ardali-bin).

Pacman repo installation:

```ini
[ardali]
SigLevel = Optional TrustAll
Server = https://muhammed-dali.github.io/ArDali-WebMedia/x86_64
```

```bash
sudo pacman -Sy
sudo pacman -S ardali
```

For other distributions, follow the latest packages and releases on the GitHub release page.

## Packages and Support

- Linux packages: `AppImage`, `Pacman repo`, `AUR` (see [latest releases](https://github.com/Muhammed-Dali/ArDali-WebMedia/releases/latest))
- Bug reports and feature requests: [Issues](https://github.com/Muhammed-Dali/ArDali-WebMedia/issues)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## Known Behavior

On some USB/headset audio devices, disconnecting the device may switch the system output route and pause playback. Playback can continue by pressing play again.

## License

This project is released under the GNU GPL v3 License. See [LICENSE](LICENSE) for details.

---

## Turkce

### ArDali (v3.1.4)

Linux için medya oynatıcı, web ses motoru, müzik/video indirici, ekran kaydedici ve projectM görselleştirici tek bir optimize masaüstü uygulamasında birleşir.

ArDali, Linux sistemler için geliştirilmiş; üstün optimizasyon ilkeleriyle tasarlanmış, Electron tabanlı gelişmiş bir multimedya ekosistemidir. 2 yıllık kesintisiz ve yoğun bir geliştirme sürecinin ardından, tüm altyapısı ve mimarisi v3.1.4 sürümüyle tamamen yenilenmiştir.

Uygulamanın kalbinde, web tabanlı ses akışlarını sıfır gecikmeyle işleyen ve tamamen bu projeye özel olarak derlenmiş bir teknoloji yatmaktadır.

Anahtar kelimeler: Linux medya oynatıcı, Linux müzik çalar, Linux video oynatıcı, YouTube indirici, şarkı bulma, Shazam benzeri müzik tanıma, ekran kaydedici, OBS tarzı kayıt stüdyosu, 32 bant ekolayzır, ses motoru, reklam engelleyici, projectM görselleştirici, AppImage, Pacman repo, AUR paketi.

## Özellik Haritası

<table>
  <tr>
    <th width="72">İkon</th>
    <th>Özellik</th>
    <th>Ne işe yarar</th>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/nav_video.svg" width="34" alt="Video oynatma ikonu"/></td>
    <td><strong>Video oynatma</strong></td>
    <td>Yerel videoları modern oynatıcı, mini oynatıcı, tam ekran kontrolleri, hız, altyazı, uyku zamanlayıcı ve akıcı ilerleme desteğiyle oynatır.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/video_tools_studio.svg" width="34" alt="Kaydedici ikonu"/></td>
    <td><strong>Kaydedici</strong></td>
    <td>Eğitim, tanıtım ve içerik üretimi için ekran kaydı odaklı yerleşik bir çalışma alanı sunar.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_music.svg" width="34" alt="Müzik oynatma ikonu"/></td>
    <td><strong>Müzik oynatma</strong></td>
    <td>Yerel müzikleri çalma listeleri, etiket bilgileri, albüm kapağı, gelişmiş kontroller, ekolayzır ve ses efektleriyle yönetir.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_gallery.svg" width="34" alt="Galeri ikonu"/></td>
    <td><strong>Galeri</strong></td>
    <td>Fotoğrafları görüntüler; ışık kutusu, yakınlaştırma, döndürme, ekrana sığdırma, slayt ve hızlı düzenleme araçları sağlar.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/nav_internet.svg" width="34" alt="Web ikonu"/></td>
    <td><strong>Web</strong></td>
    <td>YouTube, YouTube Music, SoundCloud, Deezer, sosyal platformlar ve genel web gezintisini tek masaüstü uygulamasında birleştirir.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/deliblock.svg" width="34" alt="Reklam engelleme ikonu"/></td>
    <td><strong>Reklam engelleme</strong></td>
    <td>Entegre DeliBlock katmanıyla reklamları, pop-up'ları, izleyicileri ve rahatsız edici web öğelerini filtreler.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/app/ardali_dawlod.png" width="34" alt="İndirme ikonu"/></td>
    <td><strong>İndirme</strong></td>
    <td>Desteklenen platformlardan medya indirir; video veya ses olarak kaydetme ve yerel dönüştürme seçenekleri sunar.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_pulse.svg" width="34" alt="Dinleyerek şarkı bulma ikonu"/></td>
    <td><strong>Dinleyerek şarkı bulma</strong></td>
    <td>Sistemden veya ortamdan gelen sesi dinleyerek şarkıları akustik parmak izi yöntemiyle tanımlar.</td>
  </tr>
  <tr>
    <td align="center"><img src="icons/ui/readme_projectm.svg" width="34" alt="projectM görselleştirme ikonu"/></td>
    <td><strong>projectM görselleştirme</strong></td>
    <td>Çalan müziğin ritmine, frekansına ve enerjisine tepki veren donanım hızlandırmalı görseller üretir.</td>
  </tr>
</table>

## AI Denetim Beyanı

Bu projenin geliştirilme sürecinde yapay zekadan aktif olarak destek alınmıştır.

> **Tüm kodlar AI desteğiyle üretilmiş olsa da, yayınlanmadan önce bizzat tarafımdan satır satır denetlenmiş, güvenlik ve performans testlerinden geçirilmiştir.**

Linux topluluğu standartlarına uygun şekilde, projeye ilişkin teknik ve yasal tüm sorumluluk geliştirici olarak tarafıma (Muhammed) aittir.

## Öne Çıkan Gelişmiş Özellikler

### 1. Özel Dali Ses Motoru & `dali-lang` Core Engine

Projenin en çok çaba sarf edilen ve en yenilikçi alanıdır. Sıfırdan derlenip geliştirilen **`dali-lang`** programlama dili ile güçlendirilmiş yerleşik bir web ses motoru barındırır.

- `.dali` ve `.dl` formatlarındaki web kaynaklarından gelen ses akışlarını anlık olarak yakalar.
- Donanımsal düzeyde **32-bant ekolayzır (EQ)** desteği sunar ve sesi anında manipüle etmenizi sağlar.
- En kritik özelliği ise ses işleme sürecinde **sıfır gecikme (zero-latency)** ile çalışmasıdır.

### 2. Üstün Sistem Optimizasyonu

Electron tabanlı uygulamaların yüksek kaynak tüketimi algısını kırmayı hedefler.

- Yoğun kod optimizasyonları sayesinde uygulama boştayken veya müzik çalarken minimum kaynak tüketir.
- En yüksek kalitede video oynatıldığında bile bellek tüketimi **maksimum 700 MB RAM** sınırında kalacak şekilde tasarlanmıştır.

### 3. Akıllı Dinleyerek Şarkı Bulma

Ortamda veya sistemde çalan müzikleri gelişmiş akustik parmak izi teknolojisiyle dinleyerek anında tanımlar. Shazam benzeri entegre bir sistem sunar.

### 4. Linux İçin Gelişmiş Medya İndirme & Dönüştürme Motoru

Popüler sosyal ve medya platformlarından, YouTube ve diğerleri dahil, tek tıkla video ve müzik indirmenizi sağlar.

- İndirilen içerikleri tamamen yerel kaynaklar üzerinden farklı ses ve video formatlarına yüksek hızla dönüştürebilir.

### 5. Güvenli Reklam Engelleyici Web Deneyimi

Web tabanlı platformları kullanırken veya sosyal mecralarda gezinirken kullanıcı güvenliğini tehdit eden riskli reklamları, izleyicileri ve pop-up'ları otomatik olarak filtreler.

### 6. projectM Görselleştirme Entegrasyonu

Çalan müziğin ritmine, frekansına ve enerjisine göre dinamik olarak şekillenen, donanım hızlandırmalı görsel efektler sunar.

### 7. OBS Tarzı Linux Ekran Kaydedici & Yayıncı Modu

Özellikle YouTube içeriği üreten yazılımcılar, eğitimciler ve yayıncılar için harici bir yazılıma ihtiyaç bırakmayan dahili ekran kaydetme altyapısı sunar.

- Ekran görüntüsünü yakalarken eşzamanlı olarak entegre kamera katmanınızı video üzerine eklemenizi sağlar.
- OBS Studio mantığıyla çalışan bu mod, içerik üreticilerinin hızlıca video çekip kaydetmesi için optimize edilmiştir.

### 8. Sosyal Platform & Web Entegrasyonu

Popüler sosyal medya ve video platformlarını tek bir akıcı arayüz altında birleştirerek harici tarayıcı ihtiyacını azaltır.

### 9. Linux İçin Gelişmiş Müzik Çalar

Yerel müzik kütüphanenizi akıllı etiketleme, çalma listeleri ve albüm sanatı desteğiyle yönetir.

### 10. Linux Video Oynatıcı

Geniş codec desteğiyle yerel videolarınızı modern, akıcı ve performanslı bir arayüzde oynatır.

## Ekran Görüntüleri

<details>
  <summary>Ekran görüntülerini göster</summary>
  <br/>
  <table>
    <tr>
      <td><img src="screenshots/aber/shot-00.png" alt="ArDali Ekran Görüntüsü 00"/></td>
      <td><img src="screenshots/aber/shot-01.png" alt="ArDali Ekran Görüntüsü 01"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-02.png" alt="ArDali Ekran Görüntüsü 02"/></td>
      <td><img src="screenshots/aber/shot-03.png" alt="ArDali Ekran Görüntüsü 03"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-04.png" alt="ArDali Ekran Görüntüsü 04"/></td>
      <td><img src="screenshots/aber/shot-05.png" alt="ArDali Ekran Görüntüsü 05"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-06.png" alt="ArDali Ekran Görüntüsü 06"/></td>
      <td><img src="screenshots/aber/shot-07.png" alt="ArDali Ekran Görüntüsü 07"/></td>
    </tr>
    <tr>
      <td><img src="screenshots/aber/shot-08.png" alt="ArDali Ekran Görüntüsü 08"/></td>
      <td></td>
    </tr>
  </table>
</details>

## Kurulum

Projeyi yerel bilgisayarınızda klonlayıp çalıştırmak için:

```bash
git clone https://github.com/Muhammed-Dali/ArDali-WebMedia.git
cd ArDali-WebMedia
npm install
npm start
```

Arch tabanlı Linux sistemler için birincil kurulum talimatı:

```bash
yay -S ardali-bin
```

ArDali işinize yarıyorsa [AUR paket sayfasında](https://aur.archlinux.org/packages/ardali-bin) oy vererek sessizce destek olabilirsiniz.

Pacman repo ile kurulum:

```ini
[ardali]
SigLevel = Optional TrustAll
Server = https://muhammed-dali.github.io/ArDali-WebMedia/x86_64
```

```bash
sudo pacman -Sy
sudo pacman -S ardali
```

Diğer dağıtımlar için güncel paketler ve sürümler yayın sayfasından takip edilebilir.

## Paketler ve Destek

- Linux paketleri: `AppImage`, `Pacman repo`, `AUR` ([son sürümler](https://github.com/Muhammed-Dali/ArDali-WebMedia/releases/latest))
- Hata ve özellik talepleri: [Issues](https://github.com/Muhammed-Dali/ArDali-WebMedia/issues)
- Katkı rehberi: [CONTRIBUTING.md](CONTRIBUTING.md)

## Bilinen Davranış

Bazı USB/kulaklık ses cihazlarında bağlantı kesildiğinde sistem ses çıkış rotası değişebilir ve oynatma durabilir. Oynatma, tekrar play ile devam ettirilebilir.

## Lisans

Bu proje GNU GPL v3 Lisansı ile sunulmaktadır. Detaylar için [LICENSE](LICENSE) dosyasına bakabilirsiniz.
