#pragma once

#include "translation_provider.h"

#include <QNetworkAccessManager>
#include <QPointer>
#include <QUrl>

class LibreTranslateProvider final : public ITranslationProvider {
 public:
  explicit LibreTranslateProvider(QNetworkAccessManager *nam, const QUrl &endpoint = QUrl(), const QString &apiKey = QString());
  ~LibreTranslateProvider() override = default;

  QString id() const override { return QStringLiteral("libretranslate"); }
  QString displayName() const override { return QStringLiteral("LibreTranslate"); }
  bool requiresApiKey() const override { return false; }
  bool isConfigured() const override;

  QUrl endpoint() const { return endpoint_; }
  void setEndpoint(const QUrl &endpoint) { endpoint_ = endpoint; }

  QString apiKey() const { return apiKey_; }
  void setApiKey(const QString &apiKey) { apiKey_ = apiKey.trimmed(); }

  void translateBatch(
      const QStringList &texts,
      const QString &sourceLang,
      const QString &targetLang,
      ProviderCallback callback
  ) override;

 private:
  QPointer<QNetworkAccessManager> nam_;
  QUrl endpoint_;
  QString apiKey_;
};
