#pragma once

#include "translation_provider.h"

#include <QNetworkAccessManager>
#include <QPointer>
#include <QUrl>

class GoogleCloudProvider final : public ITranslationProvider {
 public:
  explicit GoogleCloudProvider(QNetworkAccessManager *nam, const QString &apiKey = QString());
  ~GoogleCloudProvider() override = default;

  QString id() const override { return QStringLiteral("google_cloud"); }
  QString displayName() const override { return QStringLiteral("Google Cloud Translation"); }
  bool requiresApiKey() const override { return true; }
  bool isConfigured() const override;

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
  QString apiKey_;
};
