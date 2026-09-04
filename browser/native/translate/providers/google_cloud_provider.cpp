#include "google_cloud_provider.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QUrlQuery>

namespace {
constexpr int kDefaultTimeoutMs = 12000;
const QString kGoogleCloudEndpoint = QStringLiteral("https://translation.googleapis.com/language/translate/v2");
}

GoogleCloudProvider::GoogleCloudProvider(QNetworkAccessManager *nam, const QString &apiKey)
    : nam_(nam), apiKey_(apiKey.trimmed()) {}

bool GoogleCloudProvider::isConfigured() const {
  return !apiKey_.isEmpty();
}

void GoogleCloudProvider::translateBatch(
    const QStringList &texts,
    const QString &sourceLang,
    const QString &targetLang,
    ProviderCallback callback
) {
  if (!isConfigured()) {
    if (callback) {
      callback({false, {}, TranslationError::NotConfigured, QStringLiteral("Google Cloud API anahtarı girilmemiş.")});
    }
    return;
  }

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

  QUrl url(kGoogleCloudEndpoint);
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("key"), apiKey_);
  url.setQuery(query);

  QJsonObject payload;
  payload.insert(QStringLiteral("q"), QJsonArray::fromStringList(texts));
  if (!sourceLang.isEmpty() && sourceLang != QLatin1String("auto")) {
    payload.insert(QStringLiteral("source"), sourceLang);
  }
  payload.insert(QStringLiteral("target"), targetLang.isEmpty() ? QStringLiteral("tr") : targetLang);
  payload.insert(QStringLiteral("format"), QStringLiteral("text"));

  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);

  QNetworkReply *reply = nam_->post(request, QJsonDocument(payload).toJson(QJsonDocument::Compact));

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
      QString errMsg = reply->errorString();

      if (reply->error() == QNetworkReply::OperationCanceledError || reply->error() == QNetworkReply::TimeoutError) {
        errType = TranslationError::Timeout;
        errMsg = QStringLiteral("Google Cloud istek zaman aşımına uğradı.");
      } else if (httpCode == 400 || httpCode == 403) {
        errType = TranslationError::AuthenticationFailed;
        errMsg = QStringLiteral("Google Cloud API anahtarı geçersiz veya Cloud Translation API etkinleştirilmemiş.");
      } else if (httpCode == 429) {
        errType = TranslationError::RateLimited;
        errMsg = QStringLiteral("Google Cloud çeviri kotası aşıldı.");
      }

      if (callback) {
        callback({false, {}, errType, errMsg});
      }
      return;
    }

    const QByteArray responseData = reply->readAll();
    QJsonParseError parseError;
    const QJsonDocument doc = QJsonDocument::fromJson(responseData, &parseError);

    if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
      if (callback) {
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("Google Cloud yanıtı geçerli JSON formatında değil.")});
      }
      return;
    }

    const QJsonObject rootObj = doc.object();
    const QJsonObject dataObj = rootObj.value(QStringLiteral("data")).toObject();
    const QJsonArray translations = dataObj.value(QStringLiteral("translations")).toArray();

    QStringList translatedList;
    translatedList.reserve(translations.size());

    for (const QJsonValue &val : translations) {
      if (val.isObject()) {
        translatedList.append(val.toObject().value(QStringLiteral("translatedText")).toString());
      }
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
