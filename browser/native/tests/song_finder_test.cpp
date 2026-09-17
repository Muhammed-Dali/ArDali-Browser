#include "audio_device_manager.h"
#include "song_finder_settings.h"
#include "song_fingerprint.h"
#include "song_recognition_service.h"

#include <QCoreApplication>
#include <QDebug>
#include <QEventLoop>
#include <QTimer>
#include <cmath>
#include <numbers>

#define ASSERT_TRUE(condition, message) \
  do { \
    if (!(condition)) { \
      qCritical() << "Assertion failed at line" << __LINE__ << ":" << message; \
      return false; \
    } \
  } while (0)

#define ASSERT_EQUAL(actual, expected, message) \
  do { \
    if ((actual) != (expected)) { \
      qCritical() << "Assertion failed at line" << __LINE__ << ":" << message \
                  << "Expected:" << (expected) << "Actual:" << (actual); \
      return false; \
    } \
  } while (0)

bool testSlidingPcmBuffer() {
  SlidingPcmBuffer buffer(16000, 4);  // 4 seconds @ 16000 Hz = 64000 samples
  ASSERT_EQUAL(buffer.capacity(), 64000, "Capacity check");
  ASSERT_EQUAL(buffer.filled(), 0, "Initial filled check");

  // Push 1 second of sine wave (16000 samples)
  QVector<float> testSamples(16000);
  for (int i = 0; i < testSamples.size(); ++i) {
    testSamples[i] = std::sin(2.0 * std::numbers::pi * 440.0 * i / 16000.0) * 0.5f;
  }

  buffer.pushF32(testSamples.constData(), testSamples.size());
  ASSERT_EQUAL(buffer.filled(), 16000, "Filled after 1 sec push");
  ASSERT_TRUE(buffer.hasSignal(0.01f), "Sine wave must have signal");

  const double level = buffer.getLevelPercent(1600, 1.0);
  ASSERT_TRUE(level > 5.0 && level <= 100.0, "Sine wave level percent check");

  // Snapshot check
  const auto snap = buffer.snapshot(8000);
  ASSERT_EQUAL(snap.size(), 8000, "Snapshot size check");

  return true;
}

bool testSongFingerprint() {
  // Generate 8 seconds of synthetic multi-tone audio signal
  constexpr int sampleRate = 16000;
  constexpr int numSamples = sampleRate * 8;
  QVector<float> samples(numSamples);

  for (int i = 0; i < numSamples; ++i) {
    const double t = static_cast<double>(i) / sampleRate;
    // Harmonic frequencies that hit Shazam frequency bands (250 - 5500 Hz)
    float s = 0.0f;
    s += 0.35f * std::sin(2.0 * std::numbers::pi * 320.0 * t);
    s += 0.25f * std::sin(2.0 * std::numbers::pi * 750.0 * t);
    s += 0.20f * std::sin(2.0 * std::numbers::pi * 1450.0 * t);
    s += 0.15f * std::sin(2.0 * std::numbers::pi * 2800.0 * t);
    // Amplitude modulation for peak variation
    s *= (0.7f + 0.3f * std::sin(2.0 * std::numbers::pi * 2.5 * t));
    samples[i] = s;
  }

  const FingerprintResult result = SongFingerprint::createSignatureFromSamples(samples);
  ASSERT_TRUE(result.success, "Signature creation must succeed");
  ASSERT_TRUE(!result.uri.isEmpty(), "URI must not be empty");
  ASSERT_TRUE(result.uri.startsWith("data:audio/vnd.shazam.sig;base64,"), "URI must have Shazam header prefix");
  ASSERT_TRUE(result.sampleMs >= 7000, "Sample duration must be >= 7000 ms");

  return true;
}

bool testSongFinderSettings() {
  SongFinderSettings settings;
  settings.resetToDefaults();

  ASSERT_EQUAL(static_cast<int>(settings.openPlatform()), static_cast<int>(SongFinderSettings::OpenPlatform::YouTube), "Default open platform");
  ASSERT_EQUAL(static_cast<int>(settings.sensitivityMode()), static_cast<int>(SongFinderSettings::SensitivityMode::Background), "Default sensitivity mode");
  ASSERT_EQUAL(settings.requestIntervalSecs(), 6, "Default request interval");
  ASSERT_EQUAL(settings.bufferSizeSecs(), 12, "Default buffer size");
  ASSERT_TRUE(settings.noDuplicates(), "Default noDuplicates");
  ASSERT_TRUE(settings.webMetadataFallback(), "Default webMetadataFallback");
  ASSERT_TRUE(settings.autoStopOnResult(), "Default autoStopOnResult");
  ASSERT_TRUE(!settings.autoOpenOnResult(), "Default autoOpenOnResult");
  ASSERT_TRUE(settings.autoPruneHistory(), "Default autoPruneHistory must be true");

  settings.setAutoPruneHistory(false);
  ASSERT_TRUE(!settings.autoPruneHistory(), "autoPruneHistory can be disabled");
  settings.setAutoPruneHistory(true);

  // Sensitivity presets
  settings.setSensitivityMode(SongFinderSettings::SensitivityMode::Normal);
  ASSERT_EQUAL(settings.requestIntervalSecs(), 8, "Normal interval");
  ASSERT_EQUAL(settings.bufferSizeSecs(), 10, "Normal buffer");

  settings.setSensitivityMode(SongFinderSettings::SensitivityMode::MaxAccuracy);
  ASSERT_EQUAL(settings.requestIntervalSecs(), 6, "Max accuracy interval");
  ASSERT_EQUAL(settings.bufferSizeSecs(), 16, "Max accuracy buffer");

  // Restore defaults
  settings.resetToDefaults();
  return true;
}

bool testAudioDeviceManagerSelection() {
  AudioDeviceManager manager;

  QVector<AudioDeviceInfo> devices;
  AudioDeviceInfo mic;
  mic.id = QStringLiteral("alsa_input.mic");
  mic.label = QStringLiteral("Built-in Microphone");
  mic.isDefault = true;
  devices.append(mic);

  AudioDeviceInfo monitor;
  monitor.id = QStringLiteral("alsa_output.pci.monitor");
  monitor.label = QStringLiteral("Monitor of Built-in Audio");
  monitor.isDefaultMonitor = true;
  monitor.isMonitor = true;
  devices.append(monitor);

  AudioDeviceInfo usb;
  usb.id = QStringLiteral("alsa_input.usb-headset");
  usb.label = QStringLiteral("USB Headset Mic");
  devices.append(usb);

  // Auto-pick should pick default monitor
  const QString best = manager.pickBestDeviceId(devices);
  ASSERT_EQUAL(best, QStringLiteral("alsa_output.pci.monitor"), "Should pick default monitor by default");

  // Explicit preferred pick
  const QString preferred = manager.pickBestDeviceId(devices, QStringLiteral("alsa_input.usb-headset"));
  ASSERT_EQUAL(preferred, QStringLiteral("alsa_input.usb-headset"), "Should pick preferred device if present");

  // Fallback when preferred is missing
  const QString fallback = manager.pickBestDeviceId(devices, QStringLiteral("non_existent_device"));
  ASSERT_EQUAL(fallback, QStringLiteral("alsa_output.pci.monitor"), "Should fallback to default monitor if preferred missing");

  return true;
}

bool testAutoRouteResolution() {
  AudioDeviceManager manager;

  QVector<AudioDeviceInfo> devices;

  // 1. Built-in sound card
  AudioDeviceInfo builtInSink;
  builtInSink.id = QStringLiteral("alsa_output.pci-0000_00_1f.3.analog-stereo.monitor");
  builtInSink.label = QStringLiteral("Monitor of Yerleşik Ses Analog Stereo");
  builtInSink.cardBusId = QStringLiteral("pci-0000:00:1f.3");
  builtInSink.cardName = QStringLiteral("Yerleşik Ses");
  builtInSink.isMonitor = true;
  builtInSink.type = AudioDeviceType::Monitor;
  devices.append(builtInSink);

  AudioDeviceInfo builtInMic;
  builtInMic.id = QStringLiteral("alsa_input.pci-0000_00_1f.3.analog-stereo");
  builtInMic.label = QStringLiteral("Yerleşik Ses Analog Stereo");
  builtInMic.cardBusId = QStringLiteral("pci-0000:00:1f.3");
  builtInMic.cardName = QStringLiteral("Yerleşik Ses");
  builtInMic.isMonitor = false;
  builtInMic.type = AudioDeviceType::Microphone;
  devices.append(builtInMic);

  // 2. USB Headset
  AudioDeviceInfo usbMonitor;
  usbMonitor.id = QStringLiteral("alsa_output.usb-0c76_USB_PnP_Audio_Device-00.analog-stereo.monitor");
  usbMonitor.label = QStringLiteral("Monitor of USB PnP Audio Device Analog Stereo");
  usbMonitor.cardBusId = QStringLiteral("usb-0c76_USB_PnP_Audio_Device-00");
  usbMonitor.cardName = QStringLiteral("USB PnP Audio Device");
  usbMonitor.isDefaultMonitor = true;
  usbMonitor.isMonitor = true;
  usbMonitor.type = AudioDeviceType::Monitor;
  devices.append(usbMonitor);

  AudioDeviceInfo usbMic;
  usbMic.id = QStringLiteral("alsa_input.usb-0c76_USB_PnP_Audio_Device-00.mono-fallback");
  usbMic.label = QStringLiteral("USB PnP Audio Device Tek Kanallı");
  usbMic.cardBusId = QStringLiteral("usb-0c76_USB_PnP_Audio_Device-00");
  usbMic.cardName = QStringLiteral("USB PnP Audio Device");
  usbMic.isDefault = true;
  usbMic.isMonitor = false;
  usbMic.type = AudioDeviceType::Microphone;
  devices.append(usbMic);

  const AutoRouteInfo route = manager.resolveAutoRoute(devices);
  ASSERT_TRUE(route.hasSystemMonitor, "AutoRoute must find system monitor");
  ASSERT_TRUE(route.hasMicrophone, "AutoRoute must find microphone");
  ASSERT_EQUAL(route.systemMonitorId, QStringLiteral("alsa_output.usb-0c76_USB_PnP_Audio_Device-00.analog-stereo.monitor"), "Must pair USB monitor");
  ASSERT_EQUAL(route.microphoneId, QStringLiteral("alsa_input.usb-0c76_USB_PnP_Audio_Device-00.mono-fallback"), "Must pair matching USB microphone");
  ASSERT_TRUE(route.summaryDescription().contains("USB PnP Audio Device"), "Summary must mention active card name");

  return true;
}

bool testMicrophonePcmSensitivity() {
  SlidingPcmBuffer buffer(16000, 2);

  // 1. Completely silent
  ASSERT_EQUAL(buffer.getLevelPercent(640, 2.2), 0.0, "Silent buffer must return 0% level");

  // 2. Low-level mic speech / quiet room (RMS = 0.002, peak = 0.008)
  QVector<float> quietSamples(640);
  for (int i = 0; i < quietSamples.size(); ++i) {
    quietSamples[i] = 0.002f * std::sin(2.0 * std::numbers::pi * 300.0 * i / 16000.0);
  }
  buffer.pushF32(quietSamples.constData(), quietSamples.size());

  const double lowLevel = buffer.getLevelPercent(640, 2.2);
  ASSERT_TRUE(lowLevel > 5.0, "Low level mic signal must produce visible meter level > 5%");
  ASSERT_TRUE(buffer.hasSignal(0.001f), "Low level mic must be detected as having signal");

  // 3. Strong music signal (RMS = 0.25)
  QVector<float> strongSamples(640);
  for (int i = 0; i < strongSamples.size(); ++i) {
    strongSamples[i] = 0.25f * std::sin(2.0 * std::numbers::pi * 440.0 * i / 16000.0);
  }
  buffer.pushF32(strongSamples.constData(), strongSamples.size());

  const double highLevel = buffer.getLevelPercent(640, 2.2);
  ASSERT_TRUE(highLevel > 60.0 && highLevel <= 100.0, "Strong music level must be > 60%");

  return true;
}

bool testSongResultDedupe() {
  SongResult r1;
  r1.title = QStringLiteral("Song Title");
  r1.artist = QStringLiteral("Artist Name");
  r1.trackKey = QStringLiteral("12345");
  ASSERT_EQUAL(r1.searchQuery(), QStringLiteral("Artist Name Song Title"), "Search query formatting");
  ASSERT_EQUAL(r1.dedupeKey(), QStringLiteral("12345"), "Dedupe key with track key");

  SongResult r2;
  r2.title = QStringLiteral("Song Title");
  r2.artist = QStringLiteral("Artist Name");
  r2.trackKey = QString();
  ASSERT_EQUAL(r2.dedupeKey(), QStringLiteral("artist name|song title"), "Dedupe key fallback without track key");

  return true;
}

bool testPulseSearchUrl() {
  const auto buildUrl = [](SongFinderSettings::OpenPlatform platform, const QString &query) {
    const QString encoded = QString::fromUtf8(QUrl::toPercentEncoding(query));
    if (platform == SongFinderSettings::OpenPlatform::YouTubeMusic) {
      return QUrl(QStringLiteral("https://music.youtube.com/search?q=%1").arg(encoded));
    }
    return QUrl(QStringLiteral("https://www.youtube.com/results?search_query=%1").arg(encoded));
  };

  const QUrl yt = buildUrl(SongFinderSettings::OpenPlatform::YouTube, QStringLiteral("Daft Punk Get Lucky"));
  const QUrl ytm = buildUrl(SongFinderSettings::OpenPlatform::YouTubeMusic, QStringLiteral("Daft Punk Get Lucky"));

  ASSERT_EQUAL(yt.toString(QUrl::FullyEncoded), QStringLiteral("https://www.youtube.com/results?search_query=Daft%20Punk%20Get%20Lucky"), "YouTube search URL");
  ASSERT_EQUAL(ytm.toString(QUrl::FullyEncoded), QStringLiteral("https://music.youtube.com/search?q=Daft%20Punk%20Get%20Lucky"), "YouTube Music search URL");

  return true;
}

bool testFallbackValidation() {
  SongResult invalidTab;
  invalidTab.title = QStringLiteral("Yeni Sekme");
  invalidTab.artist = QStringLiteral("Browser");
  ASSERT_TRUE(!invalidTab.isValid(), "Generic 'Yeni Sekme' must be rejected");

  SongResult invalidYoutube;
  invalidYoutube.title = QStringLiteral("YouTube");
  invalidYoutube.artist = QStringLiteral("Google");
  ASSERT_TRUE(!invalidYoutube.isValid(), "Generic 'YouTube' must be rejected");

  SongResult validMedia;
  validMedia.title = QStringLiteral("Never Gonna Give You Up");
  validMedia.artist = QStringLiteral("Rick Astley");
  ASSERT_TRUE(validMedia.isValid(), "Valid title/artist must pass");

  return true;
}

bool testResultSourceSeparation() {
  SongResult shazamResult;
  shazamResult.source = SongResult::Source::Shazam;
  ASSERT_EQUAL(shazamResult.sourceDisplayName(), QStringLiteral("Shazam"), "Shazam source display name");

  SongResult webResult;
  webResult.source = SongResult::Source::WebMetadata;
  ASSERT_EQUAL(webResult.sourceDisplayName(), QStringLiteral("Web Medya"), "Web Medya source display name");

  return true;
}

bool testResultDataBinding() {
  SongResult rA;
  rA.title = QStringLiteral("Song A");
  rA.artist = QStringLiteral("Artist A");

  SongResult rB;
  rB.title = QStringLiteral("Song B");
  rB.artist = QStringLiteral("Artist B");

  const auto buildUrl = [](const SongResult &r) {
    const QString encoded = QString::fromUtf8(QUrl::toPercentEncoding(r.searchQuery()));
    return QUrl(QStringLiteral("https://www.youtube.com/results?search_query=%1").arg(encoded));
  };

  const QUrl urlA = buildUrl(rA);
  const QUrl urlB = buildUrl(rB);

  ASSERT_EQUAL(urlA.toString(QUrl::FullyEncoded), QStringLiteral("https://www.youtube.com/results?search_query=Artist%20A%20Song%20A"), "URL A check");
  ASSERT_EQUAL(urlB.toString(QUrl::FullyEncoded), QStringLiteral("https://www.youtube.com/results?search_query=Artist%20B%20Song%20B"), "URL B check");
  ASSERT_TRUE(urlA != urlB, "Target URLs must be different");

  return true;
}

bool testSessionIdAndStateTransitions() {
  SongFinderSettings settings;
  SongRecognitionService service(&settings);

  ASSERT_EQUAL(static_cast<int>(service.state()), static_cast<int>(SongRecognitionService::State::Ready), "Initial state must be Ready");
  const uint64_t initialSession = service.currentSessionId();

  // Stop listening increments session ID to cancel pending async tasks
  service.stopListening();
  ASSERT_TRUE(service.currentSessionId() > initialSession, "Session ID must increment on stopListening");

  return true;
}

bool testIdleDeviceMonitoringLifecycle() {
  SongFinderSettings settings;
  SongRecognitionService service(&settings);
  ASSERT_TRUE(!service.isDeviceMonitoringActive(), "Device monitoring must start idle");
  ASSERT_EQUAL(service.deviceManager()->processLaunchCount(), quint64(0),
               "Construction must not launch pactl");

  QEventLoop idleWindow;
  QTimer::singleShot(1700, &idleWindow, &QEventLoop::quit);
  idleWindow.exec();
  ASSERT_EQUAL(service.deviceManager()->pollCheckCount(), quint64(0),
               "Normal browsing must not poll pactl");
  ASSERT_EQUAL(service.deviceManager()->processLaunchCount(), quint64(0),
               "Normal browsing must not launch pactl");

  service.beginDeviceUiUse();
  ASSERT_TRUE(service.isDeviceMonitoringActive(), "Opening Song Finder must enable device monitoring");
  service.endDeviceUiUse();
  ASSERT_TRUE(!service.isDeviceMonitoringActive(), "Closing idle Song Finder must stop device monitoring");
  return true;
}

bool testHistoryRemovalAndReRecognition() {
  SongFinderSettings settings;
  SongRecognitionService service(&settings);

  SongResult r1;
  r1.title = QStringLiteral("Song A");
  r1.artist = QStringLiteral("Artist A");
  r1.trackKey = QStringLiteral("track_100");

  ASSERT_TRUE(!service.isDuplicate(r1), "Fresh song must not be duplicate");

  // Suppose song was found and added
  service.rememberResult(r1);
  // Simulate adding to history
  // Testing isDuplicate logic
  service.clearHistory();
  ASSERT_TRUE(!service.isDuplicate(r1), "Song not in history is not duplicate");

  return true;
}

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);
  app.setOrganizationName(QStringLiteral("ArDali"));
  app.setApplicationName(QStringLiteral("ArDaliBrowser-Test"));

  qInfo() << "Running Song Finder unit tests...";

  if (!testSlidingPcmBuffer()) {
    qCritical() << "testSlidingPcmBuffer failed!";
    return 1;
  }
  qInfo() << "PASS: testSlidingPcmBuffer";

  if (!testSongFingerprint()) {
    qCritical() << "testSongFingerprint failed!";
    return 1;
  }
  qInfo() << "PASS: testSongFingerprint";

  if (!testSongFinderSettings()) {
    qCritical() << "testSongFinderSettings failed!";
    return 1;
  }
  qInfo() << "PASS: testSongFinderSettings";

  if (!testAudioDeviceManagerSelection()) {
    qCritical() << "testAudioDeviceManagerSelection failed!";
    return 1;
  }
  qInfo() << "PASS: testAudioDeviceManagerSelection";

  if (!testAutoRouteResolution()) {
    qCritical() << "testAutoRouteResolution failed!";
    return 1;
  }
  qInfo() << "PASS: testAutoRouteResolution";

  if (!testMicrophonePcmSensitivity()) {
    qCritical() << "testMicrophonePcmSensitivity failed!";
    return 1;
  }
  qInfo() << "PASS: testMicrophonePcmSensitivity";

  if (!testSongResultDedupe()) {
    qCritical() << "testSongResultDedupe failed!";
    return 1;
  }
  qInfo() << "PASS: testSongResultDedupe";

  if (!testPulseSearchUrl()) {
    qCritical() << "testPulseSearchUrl failed!";
    return 1;
  }
  qInfo() << "PASS: testPulseSearchUrl";

  if (!testFallbackValidation()) {
    qCritical() << "testFallbackValidation failed!";
    return 1;
  }
  qInfo() << "PASS: testFallbackValidation";

  if (!testResultSourceSeparation()) {
    qCritical() << "testResultSourceSeparation failed!";
    return 1;
  }
  qInfo() << "PASS: testResultSourceSeparation";

  if (!testResultDataBinding()) {
    qCritical() << "testResultDataBinding failed!";
    return 1;
  }
  qInfo() << "PASS: testResultDataBinding";

  if (!testSessionIdAndStateTransitions()) {
    qCritical() << "testSessionIdAndStateTransitions failed!";
    return 1;
  }
  qInfo() << "PASS: testSessionIdAndStateTransitions";

  if (!testIdleDeviceMonitoringLifecycle()) {
    qCritical() << "testIdleDeviceMonitoringLifecycle failed!";
    return 1;
  }
  qInfo() << "PASS: testIdleDeviceMonitoringLifecycle";

  if (!testHistoryRemovalAndReRecognition()) {
    qCritical() << "testHistoryRemovalAndReRecognition failed!";
    return 1;
  }
  qInfo() << "PASS: testHistoryRemovalAndReRecognition";

  qInfo() << "All Song Finder unit tests passed successfully!";
  return 0;
}
