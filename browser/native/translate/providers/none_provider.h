#pragma once

#include "translation_provider.h"

class NoneProvider final : public ITranslationProvider {
 public:
  NoneProvider() = default;
  ~NoneProvider() override = default;

  QString id() const override { return QStringLiteral("none"); }
  QString displayName() const override { return QStringLiteral("Yapılandırılmamış"); }
  bool requiresApiKey() const override { return false; }
  bool isConfigured() const override { return false; }

  void translateBatch(
      const QStringList &texts,
      const QString &sourceLang,
      const QString &targetLang,
      ProviderCallback callback
  ) override {
    Q_UNUSED(texts);
    Q_UNUSED(sourceLang);
    Q_UNUSED(targetLang);
    if (callback) {
      callback({false, {}, TranslationError::NotConfigured, QStringLiteral("Çeviri sağlayıcısı yapılandırılmamış.")});
    }
  }
};
