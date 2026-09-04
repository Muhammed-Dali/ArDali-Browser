#pragma once

#include "translation_provider.h"

#include <QNetworkAccessManager>
#include <QPointer>
#include <QUrl>

class GoogleGtxProvider final : public ITranslationProvider {
 public:
  explicit GoogleGtxProvider(QNetworkAccessManager *nam);
  ~GoogleGtxProvider() override = default;

  QString id() const override { return QStringLiteral("google_gtx"); }
  QString displayName() const override { return QStringLiteral("Google Translate (Experimental / Unofficial)"); }
  bool requiresApiKey() const override { return false; }
  bool isConfigured() const override { return true; }

  void translateBatch(
      const QStringList &texts,
      const QString &sourceLang,
      const QString &targetLang,
      ProviderCallback callback
  ) override;

 private:
  QPointer<QNetworkAccessManager> nam_;
};
