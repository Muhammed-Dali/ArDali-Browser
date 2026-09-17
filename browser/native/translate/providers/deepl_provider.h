#pragma once

#include "translation_provider.h"

#include <QNetworkAccessManager>
#include <QPointer>
#include <QUrl>

class DeepLProvider final : public ITranslationProvider {
 public:
  explicit DeepLProvider(QNetworkAccessManager *nam, const QString &apiKey = QString(), bool isPro = false);
  ~DeepLProvider() override = default;

  QString id() const override { return QStringLiteral("deepl"); }
  QString displayName() const override { return QStringLiteral("DeepL"); }
  bool requiresApiKey() const override { return true; }
  bool isConfigured() const override;

  QString apiKey() const { return apiKey_; }
  void setApiKey(const QString &apiKey) { apiKey_ = apiKey.trimmed(); }

  bool isPro() const { return isPro_; }
  void setIsPro(bool isPro) { isPro_ = isPro; }

  void translateBatch(
      const QStringList &texts,
      const QString &sourceLang,
      const QString &targetLang,
      ProviderCallback callback
  ) override;

 private:
  QUrl endpointUrl() const;

  QPointer<QNetworkAccessManager> nam_;
  QString apiKey_;
  bool isPro_ = false;
};
