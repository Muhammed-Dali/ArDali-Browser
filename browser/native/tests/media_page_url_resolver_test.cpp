#include "media_page_url_resolver.h"

#include <QApplication>
#include <QEventLoop>
#include <QTimer>
#include <QWebEnginePage>
#include <QWebEngineScript>
#include <QWebEngineView>

#include <cassert>
#include <iostream>

namespace {

QVariant resolveHtml(QWebEngineView *view, const QString &html, const QUrl &baseUrl) {
  bool loaded = false;
  QEventLoop loadLoop;
  QTimer loadTimeout;
  loadTimeout.setSingleShot(true);
  QObject::connect(&loadTimeout, &QTimer::timeout, &loadLoop, &QEventLoop::quit);
  const QMetaObject::Connection loadedConnection = QObject::connect(
      view, &QWebEngineView::loadFinished, &loadLoop, [&](bool ok) {
        loaded = ok;
        loadLoop.quit();
      });
  view->setHtml(html, baseUrl);
  loadTimeout.start(8000);
  loadLoop.exec();
  QObject::disconnect(loadedConnection);
  assert(loaded);

  QVariant result;
  bool completed = false;
  QEventLoop scriptLoop;
  QTimer scriptTimeout;
  scriptTimeout.setSingleShot(true);
  QObject::connect(&scriptTimeout, &QTimer::timeout, &scriptLoop, &QEventLoop::quit);
  view->page()->runJavaScript(
      MediaPageUrlResolver::extractionScript(), QWebEngineScript::ApplicationWorld,
      [&](const QVariant &value) {
        result = value;
        completed = true;
        scriptLoop.quit();
      });
  scriptTimeout.start(8000);
  scriptLoop.exec();
  assert(completed);
  return result;
}

}  // namespace

int main(int argc, char **argv) {
  qputenv("QT_QPA_PLATFORM", QByteArrayLiteral("offscreen"));
  QApplication app(argc, argv);

  QWebEngineView view;
  view.resize(900, 700);
  view.show();

  const QUrl feedUrl(QStringLiteral("https://www.tiktok.com/tr-TR/"));
  const QString feedHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <article data-e2e="feed-video" style="display:none">
        <a href="/@hidden/video/111"><video style="width:200px;height:200px"></video></a>
      </article>
      <article data-e2e="feed-video" style="position:absolute;left:200px;top:20px;width:480px;height:620px">
        <a href="https://attacker.example/@fake/video/9999999999">lookalike link</a>
        <a href="https://www.tiktok.com/@visible/video/9876543210">
          <video style="width:480px;height:620px"></video>
        </a>
      </article>
    </body></html>)HTML");
  const QVariant tiktokResult = resolveHtml(&view, feedHtml, feedUrl);
  assert(MediaPageUrlResolver::validatedResult(tiktokResult, feedUrl)
      == QUrl(QStringLiteral("https://www.tiktok.com/@visible/video/9876543210")));

  // TikTok's real virtual feed uses a blob video, keeps the item id in the
  // player wrapper, and only renders a creator profile link in the media card.
  const QString virtualTikTokFeedHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <article data-e2e="recommend-list-item-container">
        <section data-e2e="feed-video" style="width:600px;height:650px">
          <div id="xgwrapper-0-7641315014590123272" style="width:500px;height:600px">
            <div><video src="blob:https://www.tiktok.com/test" style="width:500px;height:600px"></video></div>
          </div>
          <a href="https://www.tiktok.com/tag/video/999999999999">unrelated</a>
        </section>
        <aside><a href="https://www.tiktok.com/@real_creator">creator outside media section</a></aside>
      </article>
    </body></html>)HTML");
  const QVariant virtualTikTokResult = resolveHtml(&view, virtualTikTokFeedHtml, feedUrl);
  assert(MediaPageUrlResolver::validatedResult(virtualTikTokResult, feedUrl)
      == QUrl(QStringLiteral("https://www.tiktok.com/@real_creator/video/7641315014590123272")));

  const QUrl instagramFeed(QStringLiteral("https://www.instagram.com/"));
  const QString instagramHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <article style="width:600px;height:600px">
        <video style="width:600px;height:600px"></video>
        <a href="/reel/CODE123/">Open reel</a>
      </article>
    </body></html>)HTML");
  const QVariant instagramResult = resolveHtml(&view, instagramHtml, instagramFeed);
  assert(MediaPageUrlResolver::validatedResult(instagramResult, instagramFeed)
      == QUrl(QStringLiteral("https://www.instagram.com/reel/CODE123/")));

  // Modern TikTok feed item with div[data-e2e="feed-item"] and direct post link
  const QString modernTikTokFeedHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <div data-e2e="feed-item" class="css-DivItemContainer" style="width:500px;height:700px">
        <div class="DivVideoWrapper" style="width:500px;height:650px">
          <video src="blob:https://www.tiktok.com/modern-blob" style="width:500px;height:650px"></video>
        </div>
        <a href="https://www.tiktok.com/@moderntok/video/7398765432109876543">Caption link</a>
      </div>
    </body></html>)HTML");
  const QVariant modernTikTokResult = resolveHtml(&view, modernTikTokFeedHtml, feedUrl);
  assert(MediaPageUrlResolver::validatedResult(modernTikTokResult, feedUrl)
      == QUrl(QStringLiteral("https://www.tiktok.com/@moderntok/video/7398765432109876543")));

  // TikTok photo slideshow post (/photo/)
  const QString photoTikTokHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <div data-e2e="feed-item" style="width:500px;height:700px">
        <div data-e2e="photo-player-container" style="width:500px;height:650px">
          <img src="https://example.com/slide1.jpg" style="width:500px;height:650px">
        </div>
        <a href="/@slidecreator/photo/7387654321098765432">Slideshow post</a>
      </div>
    </body></html>)HTML");
  const QVariant photoTikTokResult = resolveHtml(&view, photoTikTokHtml, feedUrl);
  assert(MediaPageUrlResolver::validatedResult(photoTikTokResult, feedUrl)
      == QUrl(QStringLiteral("https://www.tiktok.com/@slidecreator/photo/7387654321098765432")));

  // TikTok player ID with suffix (e.g. xgplayer-...-container)
  const QString playerSuffixTikTokHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <div data-e2e="feed-item" style="width:500px;height:700px">
        <div id="xgplayer-7376543210987654321-container" style="width:500px;height:650px">
          <video src="blob:https://www.tiktok.com/blob2" style="width:500px;height:650px"></video>
        </div>
        <a href="/@playercreator?is_from_webapp=1">Author</a>
      </div>
    </body></html>)HTML");
  const QVariant playerSuffixResult = resolveHtml(&view, playerSuffixTikTokHtml, feedUrl);
  assert(MediaPageUrlResolver::validatedResult(playerSuffixResult, feedUrl)
      == QUrl(QStringLiteral("https://www.tiktok.com/@playercreator/video/7376543210987654321")));

  // Direct watch page where base/location is already a TikTok permalink
  const QUrl directWatchUrl(QStringLiteral("https://www.tiktok.com/@directuser/video/7365432109876543210"));
  const QString directWatchHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <div><video src="blob:https://www.tiktok.com/direct" style="width:500px;height:650px"></video></div>
    </body></html>)HTML");
  const QVariant directWatchResult = resolveHtml(&view, directWatchHtml, directWatchUrl);
  assert(MediaPageUrlResolver::validatedResult(directWatchResult, directWatchUrl)
      == directWatchUrl);

  // TikTok rehydration JSON extraction
  const QString rehydrateHtml = QStringLiteral(R"HTML(
    <!doctype html><html><body style="margin:0">
      <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
        {"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"id":"7354321098765432109","author":{"uniqueId":"rehydrateuser"}}}}}}
      </script>
      <div data-e2e="feed-item" style="width:500px;height:700px">
        <video src="blob:https://www.tiktok.com/blob3" style="width:500px;height:650px"></video>
      </div>
    </body></html>)HTML");
  const QVariant rehydrateResult = resolveHtml(&view, rehydrateHtml, feedUrl);
  assert(MediaPageUrlResolver::validatedResult(rehydrateResult, feedUrl)
      == QUrl(QStringLiteral("https://www.tiktok.com/@rehydrateuser/video/7354321098765432109")));

  const QVariant noVideoResult = resolveHtml(
      &view, QStringLiteral("<html><body><a href='/@wrong/video/1'>not active</a></body></html>"),
      feedUrl);
  assert(MediaPageUrlResolver::validatedResult(noVideoResult, feedUrl) == feedUrl);

  assert(MediaPageUrlResolver::validatedResult(QStringLiteral("javascript:alert(1)"), feedUrl)
      == feedUrl);
  assert(MediaPageUrlResolver::validatedResult(QStringLiteral("https://user:pass@example.com/video"),
                                                feedUrl) == feedUrl);
  assert(MediaPageUrlResolver::validatedResult(QStringLiteral("https://normal.example/video"), feedUrl)
      == QUrl(QStringLiteral("https://normal.example/video")));

  std::cout << "active media permalink resolution and validation: ok\n";
  return 0;
}
