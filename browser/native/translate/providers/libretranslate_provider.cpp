#include "libretranslate_provider.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

namespace {
constexpr int kDefaultTimeoutMs = 12000;
}

LibreTranslateProvider::LibreTranslateProvider(QNetworkAccessManager *nam, const QUrl &endpoint, const QString &apiKey)
    : nam_(nam), endpoint_(endpoint), apiKey_(apiKey.trimmed()) {}

bool LibreTranslateProvider::isConfigured() const {
  return endpoint_.isValid() && !endpoint_.isEmpty();
}

void LibreTranslateProvider::translateBatch(
    const QStringList &texts,
    const QString &sourceLang,
    const QString &targetLang,
    ProviderCallback callback
) {
  if (!isConfigured()) {
    if (callback) {
      callback({false, {}, TranslationError::NotConfigured, QStringLiteral("LibreTranslate sunucu adresi yapılandırılmamış.")});
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

  const QString effectiveSrc = sourceLang.isEmpty() ? QStringLiteral("auto") : sourceLang;
  const QString effectiveTarget = targetLang.isEmpty() ? QStringLiteral("tr") : targetLang;

  QJsonObject payload;
  payload.insert(QStringLiteral("q"), QJsonArray::fromStringList(texts));
  payload.insert(QStringLiteral("source"), effectiveSrc);
  payload.insert(QStringLiteral("target"), effectiveTarget);
  payload.insert(QStringLiteral("format"), QStringLiteral("text"));
  if (!apiKey_.isEmpty()) {
    payload.insert(QStringLiteral("api_key"), apiKey_);
  }

  QNetworkRequest request(endpoint_);
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
      if (reply->error() == QNetworkReply::OperationCanceledError || reply->error() == QNetworkReply::TimeoutError) {
        errType = TranslationError::Timeout;
      } else if (httpCode == 401 || httpCode == 403) {
        errType = TranslationError::AuthenticationFailed;
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

    if (parseError.error != QJsonParseError::NoError) {
      if (callback) {
        callback({false, {}, TranslationError::InvalidResponse, QStringLiteral("LibreTranslate yanıtı geçerli JSON formatında değil.")});
      }
      return;
    }

    QStringList translatedList;

    if (doc.isObject()) {
      const QJsonObject obj = doc.object();
      if (obj.contains(QStringLiteral("error"))) {
        const QString err = obj.value(QStringLiteral("error")).toString();
        if (callback) {
          callback({false, {}, TranslationError::InvalidResponse, err});
        }
        return;
      }
      if (obj.contains(QStringLiteral("translatedText"))) {
        const QJsonValue val = obj.value(QStringLiteral("translatedText"));
        if (val.isArray()) {
          for (const QJsonValue &item : val.toArray()) translatedList.append(item.toString());
        } else {
          translatedList.append(val.toString());
        }
      }
    } else if (doc.isArray()) {
      for (const QJsonValue &item : doc.array()) {
        if (item.isObject()) {
          translatedList.append(item.toObject().value(QStringLiteral("translatedText")).toString());
        } else {
          translatedList.append(item.toString());
        }
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
