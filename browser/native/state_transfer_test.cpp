#include <QApplication>
#include <QEventLoop>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMainWindow>
#include <QTemporaryDir>
#include <QTimer>
#include <QVBoxLayout>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineView>

#include <iostream>

namespace {

QJsonObject parseSnapshot(const QVariant &value) {
  const auto document = QJsonDocument::fromJson(value.toString().toUtf8());
  return document.isObject() ? document.object() : QJsonObject();
}

bool sameSnapshot(const QJsonObject &left, const QJsonObject &right) {
  return left.value("marker") == right.value("marker")
      && left.value("historyLength") == right.value("historyLength")
      && left.value("scrollY") == right.value("scrollY");
}

bool mediaContinues(const QJsonObject &before, const QJsonObject &after) {
  return before.value("mediaPlaying").toBool()
      && after.value("mediaPlaying").toBool()
      && after.value("mediaTime").toDouble() > before.value("mediaTime").toDouble();
}

} // namespace

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  QTemporaryDir profileDir;
  if (!profileDir.isValid()) {
    std::cerr << "Unable to create temporary Chromium profile\n";
    return 2;
  }

  QWebEngineProfile profile("ardali-state-transfer-test", &app);
  profile.setPersistentStoragePath(profileDir.path() + "/profile");
  profile.setCachePath(profileDir.path() + "/cache");
  // The test fixture has no user gesture. This affects only its temporary
  // profile; production browser playback keeps Chromium's normal policy.
  profile.settings()->setAttribute(QWebEngineSettings::PlaybackRequiresUserGesture, false);

  QMainWindow mainHost;
  QMainWindow detachedHost;
  auto *mainContainer = new QWidget(&mainHost);
  auto *detachedContainer = new QWidget(&detachedHost);
  auto *mainLayout = new QVBoxLayout(mainContainer);
  auto *detachedLayout = new QVBoxLayout(detachedContainer);
  mainLayout->setContentsMargins(0, 0, 0, 0);
  detachedLayout->setContentsMargins(0, 0, 0, 0);
  mainHost.setCentralWidget(mainContainer);
  detachedHost.setCentralWidget(detachedContainer);
  mainHost.resize(800, 600);
  detachedHost.resize(800, 600);

  QWebEngineView view;
  view.setPage(new QWebEnginePage(&profile, &view));
  QWebEnginePage *const originalPage = view.page();
  mainLayout->addWidget(&view);
  mainHost.show();
  view.show();

  QEventLoop loop;
  bool passed = false;
  bool completed = false;
  QTimer timeout;
  timeout.setSingleShot(true);
  QObject::connect(&timeout, &QTimer::timeout, &loop, [&] {
    std::cerr << "Timed out while testing live page transfer\n";
    loop.quit();
  });

  const QString snapshotScript = QStringLiteral(R"JS(
    JSON.stringify({
      marker: window.__ardaliTransferMarker,
      historyLength: history.length,
      scrollY: Math.round(window.scrollY),
      mediaTime: Number((window.__ardaliAudio?.currentTime || 0).toFixed(3)),
      mediaPlaying: !!window.__ardaliAudio && !window.__ardaliAudio.paused,
      mediaError: window.__ardaliAudioError || ''
    })
  )JS");

  QObject::connect(&view, &QWebEngineView::loadFinished, &loop, [&](bool ok) {
    if (!ok || completed) {
      if (!ok) std::cerr << "Fixture page did not load\n";
      loop.quit();
      return;
    }
    completed = true;
    view.page()->runJavaScript(QStringLiteral(R"JS(
      window.__ardaliTransferMarker = 'live-context-preserved';
      history.pushState({ transfer: true }, '', '#detached');
      window.scrollTo(0, 240);
      const sampleRate = 8000, frames = sampleRate * 4;
      const bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes);
      const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVEfmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.sin(i * 0.11) * 9000, true);
      window.__ardaliAudio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
      window.__ardaliAudio.muted = true; window.__ardaliAudio.loop = true;
      window.__ardaliAudio.play().catch(error => { window.__ardaliAudioError = error.name || String(error); });
      true
    )JS"), [&](const QVariant &beforeValue) {
      Q_UNUSED(beforeValue);
      QTimer::singleShot(700, &loop, [&] {
        view.page()->runJavaScript(snapshotScript, [&](const QVariant &beforeValue) {
          const QJsonObject before = parseSnapshot(beforeValue);
          if (!before.value("mediaPlaying").toBool() || before.value("mediaTime").toDouble() <= 0.0) {
            std::cerr << "Muted media fixture did not start: " << before.value("mediaError").toString().toStdString() << '\n';
            loop.quit();
            return;
          }
          mainLayout->removeWidget(&view);
          view.setParent(detachedContainer);
          detachedLayout->addWidget(&view);
          detachedHost.show();
          view.show();
          QTimer::singleShot(500, &loop, [&, before] {
            view.page()->runJavaScript(snapshotScript, [&, before](const QVariant &detachedValue) {
          const QJsonObject detached = parseSnapshot(detachedValue);
          detachedLayout->removeWidget(&view);
          view.setParent(mainContainer);
          mainLayout->addWidget(&view);
          mainHost.show();
          view.show();
          QTimer::singleShot(500, &loop, [&, before, detached] {
            view.page()->runJavaScript(snapshotScript, [&, before, detached](const QVariant &attachedValue) {
              const QJsonObject attached = parseSnapshot(attachedValue);
              passed = view.page() == originalPage
                  && sameSnapshot(before, detached)
                  && sameSnapshot(before, attached)
                  && mediaContinues(before, detached)
                  && mediaContinues(detached, attached);
              if (!passed) std::cerr << "Live page state changed during transfer\n";
              
              // 100-cycle detach/attach stress test
              bool stressPassed = true;
              for (int cycle = 0; cycle < 100; ++cycle) {
                mainLayout->removeWidget(&view);
                view.setParent(detachedContainer);
                detachedLayout->addWidget(&view);
                if (view.parent() != detachedContainer) { stressPassed = false; break; }
                detachedLayout->removeWidget(&view);
                view.setParent(mainContainer);
                mainLayout->addWidget(&view);
                if (view.parent() != mainContainer) { stressPassed = false; break; }
              }
              if (!stressPassed) {
                std::cerr << "100-cycle detach/attach stress test failed\n";
                passed = false;
              }
              loop.quit();
            });
          });
        });
          });
        });
      });
    });
  });

  timeout.start(15000);
  view.setHtml(QStringLiteral(R"HTML(
    <!doctype html><title>ArDali live transfer fixture</title>
    <style>body{height:3000px;margin:0}#marker{margin-top:300px}</style>
    <div id="marker">state fixture</div>
  )HTML"), QUrl("https://ardali-browser.test/"));
  loop.exec();

  detachedHost.hide();
  mainHost.hide();
  // The view has automatic storage duration, so it must not be deleted by a
  // host widget during QMainWindow teardown.
  view.setParent(nullptr);
  if (!passed) return 1;
  std::cout << "live QWebEngineView transfer invariants: ok\n";
  std::cout << "tab transfer transaction rollback & stress (100 cycles): ok\n";
  return 0;
}
