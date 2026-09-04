#include "translate_service.h"

#include "providers/none_provider.h"
#include "providers/libretranslate_provider.h"
#include "providers/deepl_provider.h"
#include "providers/google_cloud_provider.h"
#include "providers/google_gtx_provider.h"

TranslateService::TranslateService(QObject *parent, QNetworkAccessManager *network, CredentialVaultManager *vaultManager)
    : QObject(parent), network_(network), ownsNetwork_(network == nullptr),
      providerId_(QStringLiteral("none")), secretStore_(vaultManager, this) {
  if (!network_) {
    network_ = new QNetworkAccessManager(this);
  }

  connect(&secretStore_, &TranslationSecretStore::secretChanged, this, [this](const QString &) {
    instantiateProvider();
  });
  connect(&secretStore_, &TranslationSecretStore::vaultLockStateChanged, this, [this](bool) {
    instantiateProvider();
  });

  instantiateProvider();
}

void TranslateService::setVaultManager(CredentialVaultManager *vaultManager) {
  secretStore_.setVaultManager(vaultManager);
  instantiateProvider();
}

void TranslateService::setEnabled(bool enabled) {
  enabled_ = enabled;
}

void TranslateService::setDefaultTargetLanguage(const QString &lang) {
  if (!lang.trimmed().isEmpty()) defaultTargetLanguage_ = lang.trimmed();
}

void TranslateService::setProvider(const QString &id) {
  const QString cleanId = id.trimmed().toLower();
  if (providerId_ != cleanId) {
    providerId_ = cleanId;
    instantiateProvider();
    emit providerChanged(providerId_);
  }
}

ITranslationProvider *TranslateService::currentProvider() const {
  return activeProvider_.get();
}

void TranslateService::setLibreTranslateEndpoint(const QUrl &url) {
  libreTranslateEndpoint_ = url;
  if (providerId_ == QLatin1String("libretranslate")) {
    instantiateProvider();
  }
}

void TranslateService::setDeepLIsPro(bool isPro) {
  deepLIsPro_ = isPro;
  if (providerId_ == QLatin1String("deepl")) {
    instantiateProvider();
  }
}

bool TranslateService::saveApiKey(const QString &providerId, const QString &apiKey) {
  const bool ok = secretStore_.saveSecret(providerId, apiKey);
  instantiateProvider();
  return ok;
}

QString TranslateService::loadApiKey(const QString &providerId) const {
  return secretStore_.loadSecret(providerId);
}

bool TranslateService::removeApiKey(const QString &providerId) {
  const bool ok = secretStore_.removeSecret(providerId);
  instantiateProvider();
  return ok;
}

void TranslateService::instantiateProvider() {
  if (providerId_ == QLatin1String("libretranslate")) {
    const QString key = secretStore_.loadSecret(QStringLiteral("libretranslate"));
    activeProvider_ = std::make_unique<LibreTranslateProvider>(network_, libreTranslateEndpoint_, key);
  } else if (providerId_ == QLatin1String("deepl")) {
    const QString key = secretStore_.loadSecret(QStringLiteral("deepl"));
    activeProvider_ = std::make_unique<DeepLProvider>(network_, key, deepLIsPro_);
  } else if (providerId_ == QLatin1String("google_cloud")) {
    const QString key = secretStore_.loadSecret(QStringLiteral("google_cloud"));
    activeProvider_ = std::make_unique<GoogleCloudProvider>(network_, key);
  } else if (providerId_ == QLatin1String("google_gtx")) {
    activeProvider_ = std::make_unique<GoogleGtxProvider>(network_);
  } else {
    activeProvider_ = std::make_unique<NoneProvider>();
  }
}

void TranslateService::clearCache() {
  cache_.clear();
}

void TranslateService::loadPreferences(QSettings &prefs) {
  enabled_ = prefs.value(QStringLiteral("translation/enabled"), true).toBool();
  defaultTargetLanguage_ = prefs.value(QStringLiteral("translation/targetLanguage"), QStringLiteral("tr")).toString();
  providerId_ = prefs.value(QStringLiteral("translation/provider"), QStringLiteral("none")).toString();

  libreTranslateEndpoint_ = QUrl(prefs.value(QStringLiteral("translation/libretranslateEndpoint")).toString());
  deepLIsPro_ = prefs.value(QStringLiteral("translation/deeplPlan"), QStringLiteral("free")).toString() == QLatin1String("pro");

  // Migrate legacy XOR/Base64 secrets to Credential Vault (if any exist)
  secretStore_.migrateLegacySecrets(prefs);

  instantiateProvider();
}

void TranslateService::savePreferences(QSettings &prefs) {
  // Only persist non-sensitive settings in QSettings
  prefs.setValue(QStringLiteral("translation/enabled"), enabled_);
  prefs.setValue(QStringLiteral("translation/targetLanguage"), defaultTargetLanguage_);
  prefs.setValue(QStringLiteral("translation/provider"), providerId_);

  if (libreTranslateEndpoint_.isValid()) {
    prefs.setValue(QStringLiteral("translation/libretranslateEndpoint"), libreTranslateEndpoint_.toString());
  } else {
    prefs.remove(QStringLiteral("translation/libretranslateEndpoint"));
  }

  prefs.setValue(QStringLiteral("translation/deeplPlan"), deepLIsPro_ ? QStringLiteral("pro") : QStringLiteral("free"));

  // Ensure no legacy secret keys remain in QSettings
  prefs.remove(QStringLiteral("translation/sec_lt"));
  prefs.remove(QStringLiteral("translation/sec_deepl"));
  prefs.remove(QStringLiteral("translation/sec_gcp"));
}

void TranslateService::testConnection(const QString &testProviderId, std::function<void(bool success, const QString &message)> callback) {
  std::unique_ptr<ITranslationProvider> testProvider;

  if (testProviderId == QLatin1String("libretranslate")) {
    const QString key = secretStore_.loadSecret(QStringLiteral("libretranslate"));
    testProvider = std::make_unique<LibreTranslateProvider>(network_, libreTranslateEndpoint_, key);
  } else if (testProviderId == QLatin1String("deepl")) {
    const QString key = secretStore_.loadSecret(QStringLiteral("deepl"));
    testProvider = std::make_unique<DeepLProvider>(network_, key, deepLIsPro_);
  } else if (testProviderId == QLatin1String("google_cloud")) {
    const QString key = secretStore_.loadSecret(QStringLiteral("google_cloud"));
    testProvider = std::make_unique<GoogleCloudProvider>(network_, key);
  } else if (testProviderId == QLatin1String("google_gtx")) {
    testProvider = std::make_unique<GoogleGtxProvider>(network_);
  } else {
    testProvider = std::make_unique<NoneProvider>();
  }

  if (testProvider->requiresApiKey() && !testProvider->isConfigured()) {
    if (secretStore_.isVaultLocked()) {
      if (callback) callback(false, QStringLiteral("⚠ Çeviri API anahtarına erişmek için güvenli kasanın kilidini açın."));
      return;
    }
    if (callback) callback(false, QStringLiteral("⚠ Sağlayıcı için API anahtarı girilmemiş."));
    return;
  }

  testProvider->translateBatch({QStringLiteral("Hello")}, QStringLiteral("en"), defaultTargetLanguage_, [callback](const TranslationResult &res) {
    if (!callback) return;
    if (res.success && !res.translatedTexts.isEmpty()) {
      callback(true, QStringLiteral("✓ Bağlantı başarılı (%1)").arg(res.translatedTexts.first()));
    } else {
      QString msg = res.errorMessage;
      switch (res.errorType) {
        case TranslationError::NotConfigured:
          msg = QStringLiteral("Sağlayıcı bilgileri eksik veya yapılandırılmamış.");
          break;
        case TranslationError::AuthenticationFailed:
          msg = QStringLiteral("API anahtarı geçersiz veya yetkisiz.");
          break;
        case TranslationError::RateLimited:
          msg = QStringLiteral("Çeviri kotası doldu veya istek sınırı aşıldı (Rate limit).");
          break;
        case TranslationError::Timeout:
          msg = QStringLiteral("Sunucu zaman aşımına uğradı (Timeout).");
          break;
        case TranslationError::NetworkError:
          msg = QStringLiteral("Sunucuya ulaşılamıyor. Lütfen adresi veya ağ bağlantısını kontrol edin.");
          break;
        default:
          if (msg.isEmpty()) msg = QStringLiteral("Çeviri testi başarısız oldu.");
          break;
      }
      callback(false, QStringLiteral("⚠ %1").arg(msg));
    }
  });
}

void TranslateService::translateBatch(const QStringList &texts, const QString &sourceLang, const QString &targetLang, TranslationCallback callback) {
  if (!enabled_) {
    if (callback) callback(false, {}, QStringLiteral("Sayfa çevirisi ayarlardan devre dışı bırakılmış."));
    return;
  }

  if (texts.isEmpty()) {
    if (callback) callback(true, {}, QString());
    return;
  }

  // Check in-memory cache
  QStringList uncachedTexts;
  QList<int> uncachedIndices;
  QStringList results;
  results.reserve(texts.size());

  const QString effectiveSrc = sourceLang.isEmpty() ? QStringLiteral("auto") : sourceLang;
  const QString effectiveTarget = targetLang.isEmpty() ? defaultTargetLanguage_ : targetLang;

  for (int i = 0; i < texts.size(); ++i) {
    const QString &text = texts.at(i);
    const QString cacheKey = effectiveSrc + QLatin1Char(':') + effectiveTarget + QLatin1Char(':') + text;
    if (cache_.contains(cacheKey)) {
      results.append(cache_.value(cacheKey));
    } else {
      results.append(QString()); // placeholder
      uncachedTexts.append(text);
      uncachedIndices.append(i);
    }
  }

  if (uncachedTexts.isEmpty()) {
    if (callback) callback(true, results, QString());
    return;
  }

  if (!activeProvider_) {
    instantiateProvider();
  }

  if (activeProvider_->requiresApiKey() && !activeProvider_->isConfigured()) {
    QString err;
    if (secretStore_.isVaultLocked()) {
      err = QStringLiteral("Çeviri API anahtarına erişmek için güvenli kasanın kilidini açın.");
    } else {
      err = QStringLiteral("Seçilen çeviri sağlayıcısı için API anahtarı yapılandırılmamış.");
    }
    emit translationFailed(err);
    if (callback) callback(false, {}, err);
    return;
  }

  activeProvider_->translateBatch(uncachedTexts, effectiveSrc, effectiveTarget, [this, results, uncachedIndices, uncachedTexts, effectiveSrc, effectiveTarget, callback](const TranslationResult &res) mutable {
    if (!res.success || res.translatedTexts.size() != uncachedTexts.size()) {
      QString err = res.errorMessage;
      if (err.isEmpty()) {
        err = QStringLiteral("Çeviri servisi hatası.");
      }
      emit translationFailed(err);
      if (callback) callback(false, {}, err);
      return;
    }

    for (int i = 0; i < uncachedIndices.size() && i < res.translatedTexts.size(); ++i) {
      const int targetIdx = uncachedIndices.at(i);
      const QString &translatedText = res.translatedTexts.at(i);
      results[targetIdx] = translatedText;
      const QString cacheKey = effectiveSrc + QLatin1Char(':') + effectiveTarget + QLatin1Char(':') + uncachedTexts.at(i);
      cache_.insert(cacheKey, translatedText);
    }

    if (callback) callback(true, results, QString());
  });
}
