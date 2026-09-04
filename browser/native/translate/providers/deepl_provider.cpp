#include "deepl_provider.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

namespace {
constexpr int kDefaultTimeoutMs = 12000;
const QString kDeepLFreeEndpoint = QStringLiteral("https://api-free.deepl.com/v2/translate");
const QString kDeepLProEndpoint = QStringLiteral("https://api.deepl.com/v2/translate");
}

DeepLProvider::DeepLProvider(QNetworkAccessManager *nam, const QString &apiKey, bool isPro)
    : nam_(nam), apiKey_(apiKey.trimmed()), isPro_(isPro) {}

bool DeepLProvider::isConfigured() const {
  return !apiKey_.isEmpty();
}

QUrl DeepLProvider::endpointUrl() const {
  // Auto-detect pro if key ends with :fx (free key) or based on isPro_ flag
  if (apiKey_.endsWith(QLatin1String(":fx"), Qt::CaseInsensitive)) {
    return QUrl(kDeepLFreeEndpoint);
  }
  return isPro_ ? QUrl(kDeepLProEndpoint) : QUrl(kDeepLFreeEndpoint);
}

void DeepLProvider::translateBatch(
    const QStringList &texts,
    const QString &sourceLang,
    const QString &targetLang,
    ProviderCallback callback
) {
  if (!isConfigured()) {
    if (callback) {
      callback({false, {}, TranslationError::NotConfigured, QStringLiteral("DeepL API anahtarı girilmemiş.")});
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

  QJsonObject payload;
  payload.insert(QStringLiteral("text"), QJsonArray::fromStringList(texts));
  if (!sourceLang.isEmpty() && sourceLang != QLatin1String("auto")) {
    payload.insert(QStringLiteral("source_lang"), sourceLang.toUpper());
  }
  const QString targetUpper = (targetLang.isEmpty() ? QStringLiteral("tr") : targetLang).toUpper();
  payload.insert(QStringLiteral("target_lang"), targetUpper);

  QNetworkRequest request(endpointUrl());
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setRawHeader("Authorization", QStringLiteral("DeepL-Auth-Key %1").arg(apiKey_).toUtf8());
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
        errMsg = QStringLiteral("DeepL istek zaman aşımına uğradı.");
      } else if (httpCode == 403 || httpCode == 401) {
        errType = TranslationError::AuthenticationFailed;
        errMsg = QStringLiteral("DeepL API anahtarı geçersiz veya yetkisiz.");
      } else if (httpCode == 456) {
        errType = TranslationError::RateLimited;
        errMsg = QStringLiteral("DeepL çeviri kotası doldu.");
      } else if (httpCode == 429) {
        errType = TranslationError::RateLimited;
        errMsg = QStringLiteral("Çok fazla istek (DeepL rate limit).");
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
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("DeepL yanıtı geçerli JSON formatında değil.")});
      }
      return;
    }

    const QJsonObject rootObj = doc.object();
    if (!rootObj.contains(QStringLiteral("translations"))) {
      if (callback) {
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("DeepL yanıtında çeviri alanı bulunamadı.")});
      }
      return;
    }

    const QJsonArray translations = rootObj.value(QStringLiteral("translations")).toArray();
    QStringList translatedList;
    translatedList.reserve(translations.size());

    for (const QJsonValue &val : translations) {
      if (val.isObject()) {
        translatedList.append(val.toObject().value(QStringLiteral("text")).toString());
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
