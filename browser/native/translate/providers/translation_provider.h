#pragma once

#include <QString>
#include <QStringList>
#include <QUrl>
#include <functional>

enum class TranslationError {
  None,
  NotConfigured,
  NetworkError,
  Timeout,
  AuthenticationFailed,
  RateLimited,
  InvalidResponse,
  ProviderUnavailable,
  UnsupportedLanguage
};

struct TranslationResult {
  bool success = false;
  QStringList translatedTexts;
  TranslationError errorType = TranslationError::None;
  QString errorMessage;
};

using ProviderCallback = std::function<void(const TranslationResult &result)>;

class ITranslationProvider {
 public:
  virtual ~ITranslationProvider() = default;

  virtual QString id() const = 0;
  virtual QString displayName() const = 0;
  virtual bool requiresApiKey() const = 0;
  virtual bool isConfigured() const = 0;

  virtual void translateBatch(
      const QStringList &texts,
      const QString &sourceLang,
      const QString &targetLang,
      ProviderCallback callback
  ) = 0;
};
