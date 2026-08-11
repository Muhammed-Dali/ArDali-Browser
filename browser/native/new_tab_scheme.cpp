#include "new_tab_scheme.h"

#include <QBuffer>
#include <QFile>
#include <QFileInfo>
#include <QStringList>
#include <QUrlQuery>
#include <QWebEngineUrlRequestJob>
#include <QWebEngineUrlScheme>
#include <QWebEngineUrlSchemeHandler>

#include "new_tab_html.h"

namespace {

class NewTabSchemeHandler final : public QWebEngineUrlSchemeHandler {
 public:
  NewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                      const QString &managedThumbnailPath, QObject *parent)
      : QWebEngineUrlSchemeHandler(parent), assetsDirectory_(assetsDirectory),
        managedBackgroundPath_(managedBackgroundPath), managedThumbnailPath_(managedThumbnailPath) {}

  void requestStarted(QWebEngineUrlRequestJob *job) override {
    const QUrl url = job->requestUrl();
    if (url.host() != QLatin1String("newtab")) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
    const QString requested = url.path();
    if (requested.isEmpty() || requested == QLatin1String("/")) {
      QString engine = QUrlQuery(url).queryItemValue(QStringLiteral("engine"));
      if (engine != QLatin1String("Google") && engine != QLatin1String("DuckDuckGo")
          && engine != QLatin1String("Brave Search") && engine != QLatin1String("Bing")) {
        engine = QStringLiteral("Google");
      }
      auto *buffer = new QBuffer(job);
      buffer->setData(newTabHtml(engine).toUtf8());
      buffer->open(QIODevice::ReadOnly);
      job->reply("text/html; charset=utf-8", buffer);
      return;
    }
    // The handler is intentionally an allow-list: no path from an URL is ever
    // joined directly into the filesystem path.
    static const QStringList iconPaths{
        QStringLiteral("/icons/appearance.svg"), QStringLiteral("/icons/search.svg"),
        QStringLiteral("/icons/grid.svg"), QStringLiteral("/icons/clock.svg"),
        QStringLiteral("/icons/cards.svg"), QStringLiteral("/icons/close.svg")};
    const bool managedImage = requested == QLatin1String("/managed-background");
    const bool managedThumbnail = requested == QLatin1String("/managed-background-thumbnail");
    if ((managedImage || managedThumbnail)
        && (job->initiator().scheme() != QLatin1String("ardali") || job->initiator().host() != QLatin1String("newtab"))) {
      job->fail(QWebEngineUrlRequestJob::RequestDenied);
      return;
    }
    const QByteArray mimeType = (requested == QLatin1String("/ardali-flow-blue.png")
                                 || requested == QLatin1String("/ardali-browser.png")) ? "image/png"
        : (requested == QLatin1String("/google.ico") || requested == QLatin1String("/duckduckgo.ico")
           || requested == QLatin1String("/brave.ico") || requested == QLatin1String("/bing.ico"))
            ? "image/x-icon" : iconPaths.contains(requested) ? "image/svg+xml"
            : managedImage ? "image/png" : managedThumbnail ? "image/jpeg" : QByteArray{};
    if (mimeType.isEmpty()) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
    QFile file(managedImage ? managedBackgroundPath_ : managedThumbnail ? managedThumbnailPath_ : assetsDirectory_ + requested);
    if (!file.open(QIODevice::ReadOnly)) { job->fail(QWebEngineUrlRequestJob::UrlNotFound); return; }
    auto *buffer = new QBuffer(job);
    buffer->setData(file.readAll());
    buffer->open(QIODevice::ReadOnly);
    job->reply(mimeType, buffer);
  }

 private:
  QString assetsDirectory_;
  QString managedBackgroundPath_;
  QString managedThumbnailPath_;
};

}  // namespace

void registerArdaliUrlSchemes() {
  QWebEngineUrlScheme scheme("ardali");
  scheme.setSyntax(QWebEngineUrlScheme::Syntax::Host);
  scheme.setFlags(QWebEngineUrlScheme::SecureScheme | QWebEngineUrlScheme::LocalScheme
      | QWebEngineUrlScheme::LocalAccessAllowed);
  QWebEngineUrlScheme::registerScheme(scheme);
}

QWebEngineUrlSchemeHandler *createNewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                                                      const QString &managedThumbnailPath, QObject *parent) {
  return new NewTabSchemeHandler(assetsDirectory, managedBackgroundPath, managedThumbnailPath, parent);
}
