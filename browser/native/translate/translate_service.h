#pragma once

#include <QHash>
#include <QNetworkAccessManager>
#include <QObject>
#include <QSettings>
#include <QStringList>
#include <QUrl>
#include <memory>
#include <functional>

#include "providers/translation_provider.h"
#include "translation_secret_store.h"

class CredentialVaultManager;

class TranslateService : public QObject {
  Q_OBJECT

 public:
  explicit TranslateService(QObject *parent = nullptr, QNetworkAccessManager *network = nullptr, CredentialVaultManager *vaultManager = nullptr);
  ~TranslateService() override = default;

  using TranslationCallback = std::function<void(bool success, const QStringList &translatedTexts, const QString &error)>;

  void translateBatch(const QStringList &texts, const QString &sourceLang, const QString &targetLang, TranslationCallback callback);

  bool isEnabled() const { return enabled_; }
  void setEnabled(bool enabled);

  QString defaultTargetLanguage() const { return defaultTargetLanguage_; }
  void setDefaultTargetLanguage(const QString &lang);

  QString providerId() const { return providerId_; }
  void setProvider(const QString &id);

  ITranslationProvider *currentProvider() const;

  void setVaultManager(CredentialVaultManager *vaultManager);
  TranslationSecretStore *secretStore() { return &secretStore_; }
  const TranslationSecretStore *secretStore() const { return &secretStore_; }

  QUrl libreTranslateEndpoint() const { return libreTranslateEndpoint_; }
  void setLibreTranslateEndpoint(const QUrl &url);

  bool deepLIsPro() const { return deepLIsPro_; }
  void setDeepLIsPro(bool isPro);

  bool saveApiKey(const QString &providerId, const QString &apiKey);
  QString loadApiKey(const QString &providerId) const;
  bool removeApiKey(const QString &providerId);

  void testConnection(const QString &providerId, std::function<void(bool success, const QString &message)> callback);

  void clearCache();

  void loadPreferences(QSettings &prefs);
  void savePreferences(QSettings &prefs);

 signals:
  void translationFailed(const QString &error);
  void providerChanged(const QString &newProviderId);

 private:
  void instantiateProvider();

  QNetworkAccessManager *network_ = nullptr;
  bool ownsNetwork_ = false;

  bool enabled_ = true;
  QString defaultTargetLanguage_ = QStringLiteral("tr");
  QString providerId_ = QStringLiteral("none");

  QUrl libreTranslateEndpoint_;
  bool deepLIsPro_ = false;

  TranslationSecretStore secretStore_;
  std::unique_ptr<ITranslationProvider> activeProvider_;
  QHash<QString, QString> cache_;
};
