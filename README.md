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

## 🌳 Feature Tree

Click on any module icon in the feature tree below to quickly navigate to its details and screenshots.

```mermaid
graph LR
    A["<img src='icons/app/ardali_readme_round.png' width='48' />"]
    
    A --> B["<img src='icons/ui/nav_internet.svg' width='32' />"]
    A --> C["<img src='icons/app/ardali_dawlod.png' width='32' />"]
    A --> D["<img src='icons/ui/readme_pulse.svg' width='32' />"]
    A --> E["<img src='icons/ui/video_tools_studio.svg' width='32' />"]
    A --> F["<img src='icons/ui/nav_video.svg' width='32' />"]
    A --> G["<img src='icons/ui/readme_music.svg' width='32' />"]
    A --> H["<img src='icons/ui/readme_gallery.svg' width='32' />"]
    A --> I["<img src='icons/ui/sound-effects.svg' width='32' />"]
    A --> J["<img src='icons/ui/readme_projectm.svg' width='32' />"]
    A --> K["<img src='icons/ui/deliblock.svg' width='32' />"]

    click B "#web-browser" "Web Browser"
    click C "#media-downloader" "Media Downloader"
    click D "#song-recognition" "Song Recognition"
    click E "#screen-recorder" "Screen Recorder"
    click F "#video-player" "Video Player"
    click G "#music-player" "Music Player"
    click H "#gallery" "Gallery"
    click I "#sound-effects" "Sound Effects"
    click J "#visualizer" "Visualizer"
    click K "#ad-blocker" "Ad Blocker"
```

---

## Modules and Interfaces

### <a id="web-browser"></a>🌐 Web Browser
![Web Browser Interface](assets/screenshots/web_browser.png)
Combines YouTube, YouTube Music, SoundCloud, Deezer, social platforms, and general web browsing into a single desktop application, eliminating the need for an external browser.

### <a id="media-downloader"></a>⬇️ Media Downloader
![Downloader Interface](assets/screenshots/downloader.png)
Downloads media with a single click from supported popular social media and video platforms. Downloaded content can be converted entirely through local resources into various audio and video formats.

### <a id="song-recognition"></a>🎵 Song Recognition
![Song Recognition Interface](assets/screenshots/song_recognition.png)
Instantly identifies music playing in your environment or on your system using advanced acoustic fingerprinting technology. Offers an integrated, fast, Shazam-like experience.

### <a id="screen-recorder"></a>⏺️ Screen Recorder
![Screen Recorder Interface](assets/screenshots/screen_recorder.png)
Provides an OBS Studio-style built-in screen recording infrastructure, particularly for developers and educators producing YouTube content. You can instantly overlay your camera layer onto the video.

### <a id="video-player"></a>🎬 Video Player
![Video Player Interface](assets/screenshots/video_player.png)
Plays your local videos with extensive codec support in a modern, fluid, and high-performance interface. Features include speed control, subtitles, a sleep timer, and mini-player support.

### <a id="music-player"></a>🎧 Music Player
![Music Player Interface](assets/screenshots/music_player.png)
Professionally manages your local music library with smart tagging, playlists, album art, and advanced playback controls.

### <a id="gallery"></a>🖼️ Gallery
![Gallery Interface](assets/screenshots/gallery.png)
Offers detailed inspection of photos and images. Provides a rich lightbox experience with zooming, rotating, fitting to screen, slideshow modes, and quick editing tools.

### <a id="sound-effects"></a>🎛️ Sound Effects
![Sound Effects Interface](assets/screenshots/sound_effects.png)
Instantly manipulate audio using the hardware-level **32-band equalizer (EQ)** and zero-latency Dali Audio Engine. Applies smoothly to both web and local music.

### <a id="visualizer"></a>📊 Visualizer
![Visualizer Interface](assets/screenshots/visualizer.png)
Produces hardware-accelerated visual spectacles that dynamically shape according to the rhythm, frequency, and energy of the playing music, thanks to projectM integration.

### <a id="ad-blocker"></a>🛡️ Ad Blocker
![Ad Blocker Interface](assets/screenshots/adblocker.png)
Automatically filters risky advertisements, trackers, and annoying pop-ups in the background with the integrated DeliBlock layer while using web-based platforms.

---

## Installation and Support

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

Installation with Pacman repo:

```ini
[ardali]
SigLevel = Optional TrustAll
Server = https://muhammed-dali.github.io/ArDali-WebMedia/x86_64
```

```bash
sudo pacman -Sy
sudo pacman -S ardali-bin
```

For more information, bug reports, and feature requests, you can use the [Issues](https://github.com/Muhammed-Dali/ArDali-WebMedia/issues) page.

## License

This project is released under the GNU GPL v3 License. See the [LICENSE](LICENSE) file for details.
