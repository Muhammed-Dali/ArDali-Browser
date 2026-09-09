<p align="center">
  <img src="docs/images/ardali-icon.png" width="128" height="128" alt="ArDali Browser Logo">
</p>

<h1 align="center">ArDali Browser</h1>

<p align="center">
  <strong>Gizlilik odaklı, yüksek performanslı ve entegre odyofil ses motoruna sahip modern Qt 6 / C++20 masaüstü web tarayıcısı</strong>
</p>

<p align="center">
  <a href="https://github.com/Muhammed-Dali/ArDali-Browser/releases/tag/v7.0.0"><img src="https://img.shields.io/badge/release-v7.0.0-007ACC.svg?style=flat-square" alt="Sürüm v7.0.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-success.svg?style=flat-square" alt="Lisans GPL-3.0"></a>
  <img src="https://img.shields.io/badge/C%2B%2B-20-00599C.svg?style=flat-square&logo=c%2B%2B" alt="C++20">
  <img src="https://img.shields.io/badge/Qt-6.4+-41CD52.svg?style=flat-square&logo=qt" alt="Qt 6">
  <img src="https://img.shields.io/badge/Platform-Linux-FCC624.svg?style=flat-square&logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/Tests-27%2F27%20Passed-brightgreen.svg?style=flat-square" alt="Test Durumu">
  <img src="https://img.shields.io/badge/AutoEQ%20Presets-1757-9cf.svg?style=flat-square" alt="AutoEQ">
</p>

---

### Hızlı İndirme ve Kurulum Seçenekleri

| Kurulum Yöntemi | Komut / Kaynak | Açıklama |
|---|---|---|
| **AUR (Binary)** | `yay -S ardali-bin` | Arch Linux / Manjaro için hızlı ikili kurulum |
| **AUR (Kaynak Kod)** | `yay -S ardali` | Yerel derleme ile sisteminize optimize paket |
| **ArDali Pacman Deposu** | `sudo pacman -Sy ardali` | Doğrudan resmi pacman repository kurulumu *(repo tanımı gerektirir)* |
| **GitHub Releases** | [Releases Sayfası](https://github.com/Muhammed-Dali/ArDali-Browser/releases) | Precompiled `.tar.zst` arşivleri ve kaynak kod paketleri |

---

<p align="center">
  <img src="docs/images/ardali-browser.png" width="100%" alt="ArDali Browser Ana Arayüzü">
</p>

---

## Proje Hakkında

**ArDali Browser**, modern web standartlarını yerel masaüstü performansı, sıkı kullanıcı gizliliği ve stüdyo kalitesinde ses işleme yetenekleriyle birleştiren bağımsız bir Qt 6 / C++20 masaüstü web tarayıcısıdır.

Chromium tabanlı modern **Qt WebEngine** çekirdeği üzerine inşa edilen ArDali Browser; harici eklentilere veya üçüncü taraf bulut servislerine bağımlı kalmadan tam donanımlı bir internet deneyimi sunar. Yerleşik reklam/takip engelleyicisi, adaptif parçalı indirme motoru, yerel şifrelenmiş parola kasası, anlık müzik tanıma teknolojisi ve 1.750'den fazla kulaklık için kalibre edilmiş AutoEQ profillerine sahip 32-bant stüdyo ekolayzırı tek bir entegre mimaride buluşur.

---

## Öne Çıkan Özellikler ve Avantajlar

- **Yerel Qt 6 & C++20 Mimarisi:** Web tabanlı arayüz hantallığı olmadan, düşük bellek tüketimi ve anında tepki veren Fusion karanlık tema tasarımı.
- **Donanım Hızlandırmalı Web Çekirdeği:** Sıfır kopyalı GPU video kod çözümü, alt süreç bellek politikası ve bellek baskısı izleyicisi ile optimize kaynak yönetimi.
- **GeneralDownloadManager (Adaptif Çoklu Bağlantı):** İndirme hızını katlayan 1 → 2 → 4 → 8 adaptif paralel bağlantı motoru, iş çalma (work stealing), dinamik parça tahsisi ve otomatik hata kurtarma.
- **Akıllı Omnibox & Çoklu Arama:** Geçmiş, yer imleri ve sık ziyaret edilen siteleri anında puanlayan akıllı adres çubuğu; DuckDuckGo, Google, Brave ve Bing arama önerileri.
- **ArDali Blocker & Gizlilik Kalkanı:** Temel, İdeal ve Kapsamlı modlarıyla ağ istek filtreleme, DOM kozmetik filtreleme, YouTube scriptlet izolasyonu ve izleme parametresi temizliği.
- **Sıfır-Bulut Parola Yöneticisi:** PBKDF2-HMAC-SHA256 ve AES-256-GCM ile tamamen cihazınızda şifrelenen yerel kasa; otomatik form doldurma ve kayıt baloncuğu.
- **Hassas İzin Yönetimi (Site Controls):** Kamera, mikrofon, konum, bildirimler ve açılır pencereler için alan adı bazlı anlık izin denetimi ve otomatik izin sıfırlama.
- **DALI Web Audio & 1.757 AutoEQ Profili:** 32-bant peaking ekolayzır, BASS FX Reverb, Dynamic Compressor, Limiter, Stereo Widener ve popüler kulaklıklar için fabrikasyon kalibrasyon profilleri.
- **ArDali Pulse (Müzik Tanıma):** Tarayıcıda veya sistemde çalan şarkıları doğrudan mikrofon veya sistem çıkışından tanıyan yerleşik ses analiz aracı.
- **Kusursuz Linux Entegrasyonu:** XDG `.desktop` uyumluluğu, 16px'ten 1024px'e hicolor simge seti ve Wayland/X11 tam desteği.

---

## Ekran Görüntüleri ve Detaylı Özellik İncelemesi

### 1. Modern Ana Arayüz ve Akıllı Yeni Sekme Deneyimi

![ArDali Browser Ana Arayüz](docs/images/ardali-browser.png)

> **Ana Tarayıcı Penceresi & Yeni Sekme Sayfası (`ardali://newtab`)**
>
> ArDali Browser, odaklanmayı kolaylaştıran modern bir karanlık arayüz sunar. Özelleştirilebilir yeni sekme ekranında dijital saat, hızlı arama çubuğu, tek tıkla erişilebilen sık kullanılan siteler, aktif indirme durumu ve izleme parametresi koruma kartları yer alır. Üst araç çubuğunda sekmelerin anlık bellek tüketimini gösteren akıllı sekme kartları, donanım ivmeli throbber animasyonları ve yer imleri çubuğu bulunur.

---

### 2. ArDali Blocker — Yerleşik Reklam ve Takip Koruması

![ArDali Blocker](docs/images/ardali-blocker.png)

> **ArDali Blocker Denetim Merkezi (`ardali://blocker`)**
>
> Kullanıcı gizliliğini en üst düzeyde korumak için tasarlanan ArDali Blocker; **Temel (%35 - Hafif)**, **İdeal (%65 - Dengeli)** ve **Kapsamlı (%95 - Güçlü)** olmak üzere 3 farklı filtreleme kademesi sunar. EasyList, EasyPrivacy, Peter Lowe ve özel Türkçe filtre kurallarını yerel olarak işler. Web sayfalarındaki reklam alanlarını DOM üzerinden temizleyen kozmetik filtreler, istenmeyen açılır pencereleri kapatan koruma mekanizmaları ve katı alan adı engelleme desteği mevcuttur.

---

### 3. Şifre Yöneticisi — Yerel Şifrelenmiş Güvenli Kasa

![Şifre Yöneticisi](docs/images/password-manager.png)

> **Güvenli Kimlik Bilgisi Kasası (`ardali://passwords`)**
>
> Kullanıcı parolalarınız hiçbir bulut sunucusuna gönderilmez ve cihazlar arasında paylaşılmaz. ArDali Güvenli Kasa, **PBKDF2** anahtar türetimi ve **AES-256-GCM** kriptografik şifreleme ile verilerinizi yerel diskte izole biçimde muhafaza eder. Oturum açma alanları tespit edildiğinde güvenli otomatik doldurma (autofill) sunulur ve yeni şifreler ana parolayla kilitlenen kasaya tek tıkla kaydedilebilir.

---

### 4. ArDali Pulse — Entegre Şarkı ve Ses Tanıma

![ArDali Pulse](docs/images/ardali-pulse.png)

> **Şarkı Bulucu & Frekans Analizörü (`ardali://song-finder`)**
>
> Web'de gezinirken veya masaüstünüzdeki herhangi bir uygulamada çalan müziği merak ettiğinizde harici eklenti aramanıza gerek kalmaz. ArDali Pulse; sistem ses çıkışını veya mikrofonu dinleyerek çalan parçayı saniyeler içinde analiz eder, şarkı adı, sanatçı ve albüm bilgilerini geçmiş listenize kaydeder.

---

### 5. Gelişmiş İndirme Yöneticisi ve Adaptif İndirme Motoru

![İndirme Yöneticisi](docs/images/downloads.png)

> **İndirmeler Merkezi (`ardali://downloads`) ve Toolbar İndirme Açılır Penceresi**
>
> Tarayıcının çekirdeğinde yer alan **GeneralDownloadManager**, indirme bağlantılarını analiz ederek sunucu `Range` başlığını destekliyorsa dosyayı otomatik olarak parçalara böler. Ağ durumuna göre bağlantı sayısını dinamik olarak **1 → 2 → 4 → 8** akışına yükseltir. Sunucu kısıtlamalarında geriye dönük hız adaptasyonu yapar, kesilen indirmeleri kaldığı bayttan devam ettirir ve parça düzeyinde otomatik yeniden deneme (part-level retry) uygular.

---

### 6. 32-Bant Profesyonel Ekolayzır & 1.757 AutoEQ Profili

![Ses Efektleri ve Ekolayzır](docs/images/audio-effects.png)

> **DALI Web Audio Ses İşleme Laboratuvarı (`ardali://audio-effects` & `ardali://eq-presets`)**
>
> Odyofiller ve müzikseverler için geliştirilen ses motoru, web üzerindeki tüm medya oynatımlarını yüksek çözünürlüklü 32-bant peaking filtreleri ile işler. Sistemde **BASS FX Reverb, Dinamik Kompresör, Brickwall Limiter, True Peak Limiter, Parametrik EQ, Dynamic EQ, Netleştirici (Exciter), De-esser, Akıllı Noise Gate, Stereo Widener v2 ve Echo** modülleri yer alır. Ayrıca Sony, Sennheiser, AKG, Beyerdynamic, Apple, Bose ve Audio-Technica gibi markaların binlerce kulaklığı için hazırlanmış **1.757 adet AutoEQ frekans düzeltme profili** pakete dahil olarak gelir.

---

## Kurulum Yöntemleri

### 1. Arch Linux / Manjaro (AUR)

ArDali Browser, Arch User Repository (AUR) üzerinde resmi olarak paketlenmiştir:

**Hazır derlenmiş ikili (binary) paket:**
```bash
yay -S ardali-bin
```

**Kaynak koddan derlenen AUR paketi:**
```bash
yay -S ardali
```

---

### 2. ArDali Pacman Deposu ile Kurulum

ArDali pacman deposunu kullanarak doğrudan sistem güncelleme kanalına dahil edebilirsiniz.

`/etc/pacman.conf` dosyanızın sonuna aşağıdaki satırları ekleyin:

```ini
[ardali]
SigLevel = Optional TrustAll
Server = https://github.com/Muhammed-Dali/ArDali-Browser/releases/download/pacman-repo
```

Ardından paket veritabanını güncelleyip tarayıcıyı yükleyin:

```bash
sudo pacman -Sy ardali
```

---

### 3. GitHub Releases Üzerinden Kurulum

Doğrudan derlenmiş arşiv ile kurulum yapmak için:

1. [GitHub Releases](https://github.com/Muhammed-Dali/ArDali-Browser/releases) sayfasından en son `ardali-browser-7.0.0-linux-x86_64.tar.zst` arşivini indirin.
2. Arşivi açıp sistem kök dizinine kopyalayın:

```bash
tar -I zstd -xvf ardali-browser-7.0.0-linux-x86_64.tar.zst
sudo cp -r usr/* /usr/
```

---

## Kaynak Koddan Derleme (Source Build)

### 1. Sistem Bağımlılıkları

ArDali Browser'ı derlemek için C++20 destekli bir derleyici, CMake, Ninja ve Qt 6 geliştirme kütüphaneleri gereklidir:

**Arch Linux / Manjaro:**
```bash
sudo pacman -S --needed base-devel cmake ninja git nodejs \
  qt6-base qt6-webengine qt6-svg qt6-imageformats \
  openssl libpsl ffmpeg
```

**Ubuntu 24.04+ / Debian 13+:**
```bash
sudo apt update
sudo apt install build-essential cmake ninja-build git nodejs \
  qt6-base-dev qt6-webengine-dev libqt6svg6-dev libqt6webenginewidgets6 \
  libssl-dev libpsl-dev ffmpeg
```

**Fedora 39+:**
```bash
sudo dnf install gcc-c++ cmake ninja-build git nodejs \
  qt6-qtbase-devel qt6-qtwebengine-devel qt6-qtsvg-devel \
  openssl-devel libpsl-devel ffmpeg-free
```

---

### 2. Derleme Adımları

```bash
# Depoyu klonlayın
git clone https://github.com/Muhammed-Dali/ArDali-Browser.git
cd ArDali-Browser

# CMake ile Release konfigürasyonunu oluşturun
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release

# Çoklu çekirdekle derleyin
cmake --build build -j$(nproc)
```

### 3. Çalıştırma ve Test

Derleme tamamlandıktan sonra tarayıcıyı doğrudan derleme dizininden çalıştırabilirsiniz:

```bash
./build/ardali-browser
```

Tüm otomatik test süitini (27 test) çalıştırmak için:

```bash
ctest --test-dir build --output-on-failure
```

Sisteme kurmak için:

```bash
sudo cmake --install build
```

---

## Geliştirici Bölümü (Development)

ArDali Browser modüler ve temiz bir C++ mimarisine sahiptir:

- **`browser/native/core/`**: Profil yönetimi, akıllı adres çözümleyici, arama önerileri ve donanım hızlandırma ayarları.
- **`browser/native/desktop_tabs/`**: Sekme şeridi, sürükle-bırak denetleyicisi, hover kartları ve bellek baskı monitörü.
- **`browser/native/downloads/`**: `GeneralDownloadManager` adaptif paralel indirme motoru, UI modeli ve platform kayıt defteri.
- **`browser/native/blocker/`**: `ArDaliBlockerEngine`, kural seti yöneticisi, kozmetik runtime ve kalkan butonu.
- **`browser/native/passwords/`**: Şifrelenmiş `CredentialVault`, otomatik doldurma denetleyicisi ve kilit açma diyalogları.
- **`browser/native/audio/` & `browser/native/eq/`**: Web Audio DSP entegrasyonu, 32-bant PEQ ve 1.757 AutoEQ JSON deposu.
- **`browser/resources/`**: AdBlock kuralları, hazır AutoEQ JSON dosyaları ve Linux `.desktop` şablonu.
- **`packaging/`**: Arch Linux PKGBUILD, AUR tanımları ve pacman repo konfigürasyonları.

---

## Lisans ve Telif Hakları

- **ArDali Browser**: [GNU General Public License v3.0](LICENSE) kapsamında lisanslanmıştır.
- **AdBlock Kural Setleri & Filtreler**: EasyList, EasyPrivacy, Peter Lowe ve topluluk filtreleri kendi lisanslarına tabidir. Detaylı telif bildirimleri için [NOTICE.txt](browser/resources/adblock/NOTICE.txt) dosyasını inceleyebilirsiniz.
- **AutoEQ Veritabanı**: Jaakko Pasanen ve AutoEQ topluluğu tarafından sunulan açık kaynaklı kulaklık düzeltme eğrilerine dayanır.
