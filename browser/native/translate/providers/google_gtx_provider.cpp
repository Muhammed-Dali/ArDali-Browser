#include "google_gtx_provider.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QUrlQuery>

namespace {
constexpr int kDefaultTimeoutMs = 12000;
const QString kGoogleGtxEndpoint = QStringLiteral("https://translate.googleapis.com/translate_a/single");
const QString kSplitToken = QStringLiteral("___ARDALI_SPLIT___");
}

GoogleGtxProvider::GoogleGtxProvider(QNetworkAccessManager *nam)
    : nam_(nam) {}

void GoogleGtxProvider::translateBatch(
    const QStringList &texts,
    const QString &sourceLang,
    const QString &targetLang,
    ProviderCallback callback
) {
  if (!nam_) {
    if (callback) {
      callback({false, {}, TranslationError::ProviderUnavailable, QStringLiteral("Ağ yöneticisi kullanılamıyor.")});
    }
    return;
  }

  if (texts.isEmpty()) {
    if (callback) callback({true, {}, TranslationError::None, QString()});
    return;
  }

  const QString effectiveSrc = sourceLang.isEmpty() ? QStringLiteral("auto") : sourceLang;
  const QString effectiveTarget = targetLang.isEmpty() ? QStringLiteral("tr") : targetLang;

  QUrl url(kGoogleGtxEndpoint);
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("client"), QStringLiteral("dict-chrome-ex"));
  query.addQueryItem(QStringLiteral("sl"), effectiveSrc);
  query.addQueryItem(QStringLiteral("tl"), effectiveTarget);
  query.addQueryItem(QStringLiteral("dt"), QStringLiteral("t"));
  url.setQuery(query);

  const QString joinedQuery = texts.join(QLatin1String("\n") + kSplitToken + QLatin1String("\n"));
  QUrlQuery postQuery;
  postQuery.addQueryItem(QStringLiteral("q"), joinedQuery);
  const QByteArray body = postQuery.toString(QUrl::FullyEncoded).toUtf8();

  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/x-www-form-urlencoded; charset=UTF-8"));
  request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"));
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);

  QNetworkReply *reply = nam_->post(request, body);

  auto *timer = new QTimer(reply);
  timer->setSingleShot(true);
  timer->setInterval(kDefaultTimeoutMs);
  QObject::connect(timer, &QTimer::timeout, reply, [reply] {
    if (reply->isRunning()) reply->abort();
  });
  timer->start();

  const int expectedCount = texts.size();

  QObject::connect(reply, &QNetworkReply::finished, [reply, timer, expectedCount, callback]() {
    timer->stop();
    reply->deleteLater();

    if (reply->error() != QNetworkReply::NoError) {
      TranslationError errType = TranslationError::NetworkError;
      const int httpCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      if (reply->error() == QNetworkReply::OperationCanceledError || reply->error() == QNetworkReply::TimeoutError) {
        errType = TranslationError::Timeout;
      } else if (httpCode == 429) {
        errType = TranslationError::RateLimited;
      }

      if (callback) {
        callback({false, {}, errType, reply->errorString()});
      }
      return;
    }

    const QByteArray responseData = reply->readAll();
    QJsonParseError parseError;
    const QJsonDocument doc = QJsonDocument::fromJson(responseData, &parseError);

    if (parseError.error != QJsonParseError::NoError || !doc.isArray() || doc.array().isEmpty()) {
      if (callback) {
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("Google GTX çeviri yanıtı ayrıştırılamadı.")});
      }
      return;
    }

    QString fullTranslatedText;
    const QJsonArray outer = doc.array();
    if (outer.at(0).isArray()) {
      const QJsonArray segments = outer.at(0).toArray();
      for (const QJsonValue &segVal : segments) {
        if (segVal.isArray() && !segVal.toArray().isEmpty()) {
          fullTranslatedText.append(segVal.toArray().at(0).toString());
        }
      }
    }

    if (fullTranslatedText.isEmpty()) {
      if (callback) {
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("Google GTX boş yanıt döndürdü.")});
      }
      return;
    }

    QStringList translatedList = fullTranslatedText.split(kSplitToken);
    for (int i = 0; i < translatedList.size(); ++i) {
      QString item = translatedList.at(i);
      while (item.startsWith(QLatin1Char('\n')) || item.startsWith(QLatin1Char(' '))) item.remove(0, 1);
      while (item.endsWith(QLatin1Char('\n')) || item.endsWith(QLatin1Char(' '))) item.chop(1);
      translatedList[i] = item;
    }

    if (translatedList.size() != expectedCount) {
      if (callback) {
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("Çeviri sonucu beklenen metin sayısıyla eşleşmedi.")});
      }
      return;
    }

    if (callback) {
      callback({true, translatedList, TranslationError::None, QString()});
    }
  });
}
