<p align="center">
  <img src="icons/app/ardali_readme_round.png" width="120" height="120" alt="ArDali Medya Player"/>
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

# ArDali (v3.1.4)

Linux için medya oynatıcı, web ses motoru, müzik/video indirici, ekran kaydedici ve projectM görselleştirici tek bir optimize masaüstü uygulamasında birleşir. ArDali, Linux sistemler için geliştirilmiş; üstün optimizasyon ilkeleriyle tasarlanmış, Electron tabanlı gelişmiş bir multimedya ekosistemidir.

Uygulamanın kalbinde, web tabanlı ses akışlarını sıfır gecikmeyle işleyen ve tamamen bu projeye özel olarak derlenmiş bir teknoloji yatmaktadır.

---

## 🌳 Özellik Dal Haritası (Feature Tree)

Aşağıdaki özellik ağacından dilediğiniz modüle tıklayarak detaylarına ve ekran görüntülerine hızlıca ulaşabilirsiniz.

```mermaid
graph LR
    A((ArDali Medya Player))
    
    A --> B[🌐 Web Tarayıcı]
    A --> C[⬇️ Medya İndirici]
    A --> D[🎵 Dinleyerek Şarkı Bulma]
    A --> E[⏺️ Ekran Kaydedici]
    A --> F[🎬 Video Oynatıcı]
    A --> G[🎧 Müzik Çalar]
    A --> H[🖼️ Galeri]
    A --> I[🎛️ Ses Efektleri]
    A --> J[📊 Görselleştirici]
    A --> K[🛡️ Reklam Engelleme]

    click B "#web-tarayici"
    click C "#medya-indirici"
    click D "#dinleyerek-sarki-bulma"
    click E "#ekran-kaydedici"
    click F "#video-oynatici"
    click G "#muzik-calar"
    click H "#galeri"
    click I "#ses-efektleri"
    click J "#gorsellestirici"
    click K "#reklam-engelleme"
```

---

## Modüller ve Arayüzler

### <a id="web-tarayici"></a>🌐 Web Tarayıcı
![Web Arayüzü](assets/screenshots/web_browser.png)
YouTube, YouTube Music, SoundCloud, Deezer, sosyal platformlar ve genel web gezintisini tek masaüstü uygulamasında birleştirerek harici tarayıcı ihtiyacını ortadan kaldırır.

### <a id="medya-indirici"></a>⬇️ Medya İndirici
![İndirme Arayüzü](assets/screenshots/downloader.png)
Desteklenen popüler sosyal medya ve video platformlarından tek tıkla medya indirir. İndirilen içerikleri tamamen yerel kaynaklar üzerinden farklı ses ve video formatlarına dönüştürebilirsiniz.

### <a id="dinleyerek-sarki-bulma"></a>🎵 Dinleyerek Şarkı Bulma
![Dinleyerek Şarkı Bulma Arayüzü](assets/screenshots/song_recognition.png)
Ortamda veya sistemde çalan müzikleri gelişmiş akustik parmak izi teknolojisiyle dinleyerek anında tanımlar. Entegre ve hızlı bir Shazam benzeri deneyim sunar.

### <a id="ekran-kaydedici"></a>⏺️ Ekran Kaydedici
![Ekran Kaydedici Arayüzü](assets/screenshots/screen_recorder.png)
Özellikle YouTube içeriği üreten yazılımcılar ve eğitimciler için OBS Studio tarzında çalışan dahili ekran kaydetme altyapısı sunar. Kamera katmanınızı da videonun üzerine anında ekleyebilirsiniz.

### <a id="video-oynatici"></a>🎬 Video Oynatıcı
![Video Oynatıcı Arayüzü](assets/screenshots/video_player.png)
Geniş codec desteğiyle yerel videolarınızı modern, akıcı ve performanslı bir arayüzde oynatır. Hız, altyazı, uyku zamanlayıcı ve mini oynatıcı destekleri mevcuttur.

### <a id="muzik-calar"></a>🎧 Müzik Çalar
![Müzik Çalar Arayüzü](assets/screenshots/music_player.png)
Yerel müzik kütüphanenizi akıllı etiketleme, çalma listeleri, albüm sanatı ve gelişmiş oynatma kontrolleri eşliğinde profesyonelce yönetir.

### <a id="galeri"></a>🖼️ Galeri
![Galeri Arayüzü](assets/screenshots/gallery.png)
Fotoğrafları ve görselleri detaylı inceler. Yakınlaştırma, döndürme, ekrana sığdırma, slayt modları ve hızlı düzenleme araçlarıyla zengin bir ışık kutusu deneyimi sunar.

### <a id="ses-efektleri"></a>🎛️ Ses Efektleri
![Ses Efektleri Arayüzü](assets/screenshots/sound_effects.png)
Donanımsal düzeyde çalışan **32-bant ekolayzır (EQ)** ve sıfır gecikmeli (zero-latency) Dali Ses Motoru ile sesi anında manipüle edin. Web ve yerel müziklerde pürüzsüz uygulanır.

### <a id="gorsellestirici"></a>📊 Görselleştirici
![Görselleştirici Arayüzü](assets/screenshots/visualizer.png)
projectM entegrasyonu sayesinde çalan müziğin ritmine, frekansına ve enerjisine göre dinamik olarak şekillenen, donanım hızlandırmalı görsel şölenler üretir.

### <a id="reklam-engelleme"></a>🛡️ Reklam Engelleme
![Reklam Engelleme Arayüzü](assets/screenshots/adblocker.png)
Web tabanlı platformları kullanırken entegre DeliBlock katmanıyla riskli reklamları, izleyicileri ve rahatsız edici pop-up'ları arka planda otomatik olarak filtreler.

---

## Kurulum ve Destek

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

Pacman repo ile kurulum:

```ini
[ardali]
SigLevel = Optional TrustAll
Server = https://muhammed-dali.github.io/ArDali-WebMedia/x86_64
```

```bash
sudo pacman -Sy
sudo pacman -S ardali-bin
```

Daha fazla bilgi, hata bildirimi ve özellik talepleri için [Issues](https://github.com/Muhammed-Dali/ArDali-WebMedia/issues) sayfasını kullanabilirsiniz.

## Lisans

Bu proje GNU GPL v3 Lisansı ile sunulmaktadır. Detaylar için [LICENSE](LICENSE) dosyasına bakabilirsiniz.
