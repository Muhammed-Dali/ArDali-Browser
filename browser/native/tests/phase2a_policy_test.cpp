#include "audio/audio_device_manager.h"
#include "audio/audio_platform_policy.h"
#include "core/browser_permission_policy.h"

#include <QCoreApplication>
#include <cassert>

int main(int argc, char *argv[]) {
  QCoreApplication app(argc, argv);

  using ardali::audio::isSupportedAudioPlatform;
  const QStringList accepted{
      QStringLiteral("https://youtube.com"),
      QStringLiteral("https://www.youtube.com"),
      QStringLiteral("https://music.youtube.com"),
      QStringLiteral("https://m.youtube.com"),
      QStringLiteral("https://youtu.be"),
      QStringLiteral("https://reddit.com"),
      QStringLiteral("https://old.reddit.com"),
      QStringLiteral("https://x.com"),
      QStringLiteral("https://mobile.x.com"),
      QStringLiteral("https://twitter.com"),
      QStringLiteral("https://www.facebook.com"),
      QStringLiteral("https://instagram.com"),
      QStringLiteral("https://www.tiktok.com"),
  };
  for (const QString &url : accepted) assert(isSupportedAudioPlatform(QUrl(url)));

  const QStringList rejected{
      QStringLiteral("https://notyoutube.com"),
      QStringLiteral("https://youtube.com.example.org"),
      QStringLiteral("https://notreddit.com"),
      QStringLiteral("https://x.com.example.org"),
      QStringLiteral("https://nottwitter.com"),
      QStringLiteral("https://notfacebook.com"),
      QStringLiteral("https://notinstagram.com"),
      QStringLiteral("https://nottiktok.com"),
      QStringLiteral("https://amazon.com"),
      QStringLiteral("https://walmart.com"),
      QStringLiteral("ardali://newtab/"),
      QStringLiteral("file:///tmp/video.html"),
  };
  for (const QString &url : rejected) assert(!isSupportedAudioPlatform(QUrl(url)));

  assert(!BrowserPermissionPolicy::legacyPermissionsAreAutoGranted());
  assert(BrowserPermissionPolicy::decisionForExplicitUserChoice(false)
         == BrowserPermissionPolicy::Decision::Deny);
  assert(BrowserPermissionPolicy::decisionForExplicitUserChoice(true)
         == BrowserPermissionPolicy::Decision::Grant);
  QT_WARNING_PUSH
  QT_WARNING_DISABLE_DEPRECATED
  const QWebEnginePage::Feature sensitiveFeatures[]{
      QWebEnginePage::Geolocation,
      QWebEnginePage::MediaAudioCapture,
      QWebEnginePage::MediaVideoCapture,
      QWebEnginePage::MediaAudioVideoCapture,
      QWebEnginePage::DesktopVideoCapture,
      QWebEnginePage::DesktopAudioVideoCapture,
      QWebEnginePage::Notifications,
      QWebEnginePage::ClipboardReadWrite,
  };
  for (const auto feature : sensitiveFeatures)
    assert(!BrowserPermissionPolicy::featureName(feature).isEmpty());
  QT_WARNING_POP

  AudioDeviceManager devices;
  assert(!devices.isMonitoring());
  assert(devices.pollCheckCount() == 0);
  assert(devices.processLaunchCount() == 0);
  devices.startMonitoring();
  assert(devices.isMonitoring());
  devices.stopMonitoring();
  assert(!devices.isMonitoring());
  assert(devices.pollCheckCount() == 0);
  assert(devices.processLaunchCount() == 0);

  return 0;
}
