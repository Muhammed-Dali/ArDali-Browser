#include "language_manager.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QLoggingCategory>

namespace ardali::i18n {

namespace {
Q_LOGGING_CATEGORY(lcI18n, "ardali.i18n")
}

LanguageManager &LanguageManager::instance() {
  static LanguageManager manager;
  return manager;
}

LanguageManager::LanguageManager(QObject *parent) : QObject(parent) {
  populateDefaultFallbackLanguages();
}

void LanguageManager::populateDefaultFallbackLanguages() {
  languages_.clear();
  defaultLanguageCode_ = QStringLiteral("en");

  languages_.append({QStringLiteral("en"), QStringLiteral("English"),
                     QStringLiteral("English"), QStringLiteral("ltr")});
  languages_.append({QStringLiteral("tr"), QStringLiteral("Turkish"),
                     QStringLiteral("Türkçe"), QStringLiteral("ltr")});
  languages_.append({QStringLiteral("ar"), QStringLiteral("Arabic"),
                     QStringLiteral("العربية"), QStringLiteral("rtl")});
}

QString LanguageManager::resolveFilePath(const QString &preferredPath,
                                        const QString &fallbackSubPath) const {
  if (!preferredPath.isEmpty()) {
    return preferredPath;
  }

  // 1. Try Qt resource path
  const QString qrcPath = QStringLiteral(":/i18n/") + fallbackSubPath;
  if (QFile::exists(qrcPath)) {
    return qrcPath;
  }

  // 2. Try application binary directory
  if (qApp) {
    const QString appDirPath =
        QCoreApplication::applicationDirPath() + QStringLiteral("/i18n/") + fallbackSubPath;
    if (QFile::exists(appDirPath)) {
      return appDirPath;
    }
  }

  // 3. Try current working directory
  const QString cwdPath = QStringLiteral("i18n/") + fallbackSubPath;
  if (QFile::exists(cwdPath)) {
    return cwdPath;
  }

  return QStringLiteral(":/i18n/") + fallbackSubPath;
}

void LanguageManager::initialize(const QString &languagesJsonPath,
                                const QString &translationsDir) {
  QWriteLocker locker(&lock_);
  configPath_ = languagesJsonPath;
  translationsDir_ = translationsDir;

  locker.unlock();
  loadLanguagesConfig(configPath_);

  determineAndApplyActiveLanguage(/*notify=*/false);

  QWriteLocker locker2(&lock_);
  initialized_ = true;
}

bool LanguageManager::loadLanguagesConfig(const QString &jsonPath) {
  const QString path = resolveFilePath(jsonPath, QStringLiteral("languages.json"));

  QFile file(path);
  if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
    qCWarning(lcI18n) << "Could not open languages config at" << path
                      << "- using fallback definitions.";
    QWriteLocker locker(&lock_);
    if (languages_.isEmpty()) {
      populateDefaultFallbackLanguages();
    }
    return false;
  }

  QJsonParseError parseError;
  const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &parseError);
  file.close();

  if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
    qCWarning(lcI18n) << "Failed to parse languages JSON:" << parseError.errorString()
                      << "at" << path;
    QWriteLocker locker(&lock_);
    if (languages_.isEmpty()) {
      populateDefaultFallbackLanguages();
    }
    return false;
  }

  const QJsonObject root = doc.object();
  const QString defaultCode = root.value(QStringLiteral("default")).toString().trimmed();
  const QJsonArray langsArray = root.value(QStringLiteral("languages")).toArray();

  QList<LanguageInfo> parsedList;
  QSet<QString> seenCodes;

  for (const QJsonValue &val : langsArray) {
    if (!val.isObject()) continue;
    const QJsonObject obj = val.toObject();
    const QString code = obj.value(QStringLiteral("code")).toString().trimmed().toLower();
    const QString name = obj.value(QStringLiteral("name")).toString().trimmed();
    const QString nativeName = obj.value(QStringLiteral("nativeName")).toString().trimmed();
    QString direction = obj.value(QStringLiteral("direction")).toString().trimmed().toLower();

    if (code.isEmpty() || seenCodes.contains(code)) continue;
    if (direction != QLatin1String("rtl") && direction != QLatin1String("ltr")) {
      direction = QStringLiteral("ltr");
    }

    LanguageInfo info;
    info.code = code;
    info.name = name.isEmpty() ? code : name;
    info.nativeName = nativeName.isEmpty() ? info.name : nativeName;
    info.direction = direction;

    parsedList.append(info);
    seenCodes.insert(code);
  }

  if (parsedList.isEmpty()) {
    qCWarning(lcI18n) << "No valid languages found in" << path;
    return false;
  }

  QWriteLocker locker(&lock_);
  languages_ = parsedList;
  if (!defaultCode.isEmpty() && seenCodes.contains(defaultCode)) {
    defaultLanguageCode_ = defaultCode;
  } else {
    defaultLanguageCode_ = parsedList.first().code;
  }

  return true;
}

bool LanguageManager::loadCatalog(const QString &code,
                                  QHash<QString, QString> &outCatalog) const {
  outCatalog.clear();
  const QString filename = code + QStringLiteral(".json");
  const QString subPath = QStringLiteral("translations/") + filename;

  QString targetPath;
  if (!translationsDir_.isEmpty()) {
    targetPath = translationsDir_ + QStringLiteral("/") + filename;
  }
  targetPath = resolveFilePath(targetPath, subPath);

  QFile file(targetPath);
  if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
    qCWarning(lcI18n) << "Could not open translation catalog for" << code << "at" << targetPath;
    return false;
  }

  QJsonParseError parseError;
  const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &parseError);
  file.close();

  if (parseError.error != QJsonParseError::NoError) {
    qCWarning(lcI18n) << "Failed to parse translation catalog for" << code
                      << ":" << parseError.errorString();
    return false;
  }

  if (doc.isObject()) {
    const QJsonObject obj = doc.object();
    for (auto it = obj.begin(); it != obj.end(); ++it) {
      if (it.value().isString()) {
        outCatalog.insert(it.key(), it.value().toString());
      }
    }
    return true;
  }

  // Handle array of translated entries (Helium format parity)
  if (doc.isArray()) {
    const QJsonArray arr = doc.array();
    for (const QJsonValue &val : arr) {
      if (!val.isObject()) continue;
      const QJsonObject entry = val.toObject();
      const QString name = entry.value(QStringLiteral("name")).toString();
      const QString message = entry.value(QStringLiteral("message")).toString();
      if (!name.isEmpty() && !message.isEmpty()) {
        outCatalog.insert(name, message);
      }
    }
    return true;
  }

  return false;
}

QList<LanguageInfo> LanguageManager::supportedLanguages() const {
  QReadLocker locker(&lock_);
  return languages_;
}

QString LanguageManager::defaultLanguageCode() const {
  QReadLocker locker(&lock_);
  return defaultLanguageCode_;
}

bool LanguageManager::isLanguageSupported(const QString &code) const {
  QReadLocker locker(&lock_);
  for (const auto &info : languages_) {
    if (info.code.compare(code, Qt::CaseInsensitive) == 0) return true;
  }
  return false;
}

LanguageInfo LanguageManager::languageInfo(const QString &code) const {
  QReadLocker locker(&lock_);
  for (const auto &info : languages_) {
    if (info.code.compare(code, Qt::CaseInsensitive) == 0) return info;
  }
  return {};
}

QString LanguageManager::systemLocaleLanguageCode() const {
  const QLocale sys;
  const QString name = sys.name().toLower();
  const auto lang = sys.language();

  if (lang == QLocale::Turkish || name.startsWith(QLatin1String("tr"))) {
    return QStringLiteral("tr");
  }
  if (lang == QLocale::Arabic || name.startsWith(QLatin1String("ar"))) {
    return QStringLiteral("ar");
  }
  if (lang == QLocale::English || name.startsWith(QLatin1String("en"))) {
    return QStringLiteral("en");
  }

  QReadLocker locker(&lock_);
  return defaultLanguageCode_.isEmpty() ? QStringLiteral("en") : defaultLanguageCode_;
}

QString LanguageManager::languagePreference() const {
  QSettings settings;
  const QString pref =
      settings.value(QStringLiteral("i18n/language"), QStringLiteral("system")).toString().trimmed().toLower();
  if (pref.isEmpty()) {
    return QStringLiteral("system");
  }
  return pref;
}

void LanguageManager::setLanguagePreference(const QString &preference) {
  const QString cleanPref = preference.trimmed().toLower();
  {
    QSettings settings;
    settings.setValue(QStringLiteral("i18n/language"), cleanPref);
    settings.sync();
  }
  determineAndApplyActiveLanguage(/*notify=*/true);
}

void LanguageManager::determineAndApplyActiveLanguage(bool notify) {
  QString chosenCode;
  const QString pref = languagePreference();

  if (pref == QLatin1String("system") || pref.isEmpty()) {
    chosenCode = systemLocaleLanguageCode();
  } else if (isLanguageSupported(pref)) {
    chosenCode = pref;
  } else {
    chosenCode = defaultLanguageCode();
  }

  if (chosenCode.isEmpty()) {
    chosenCode = QStringLiteral("en");
  }

  QHash<QString, QString> newCatalog;
  loadCatalog(chosenCode, newCatalog);

  QHash<QString, QString> enCatalog;
  if (chosenCode == QStringLiteral("en")) {
    enCatalog = newCatalog;
  } else {
    loadCatalog(QStringLiteral("en"), enCatalog);
  }

  {
    QWriteLocker locker(&lock_);
    activeLanguageCode_ = chosenCode;
    currentCatalog_ = std::move(newCatalog);
    fallbackCatalog_ = std::move(enCatalog);
  }

  applyLayoutDirection();

  if (notify) {
    emit languageChanged(chosenCode);
  }
}

QString LanguageManager::activeLanguageCode() const {
  QReadLocker locker(&lock_);
  return activeLanguageCode_;
}

LanguageInfo LanguageManager::activeLanguage() const {
  QReadLocker locker(&lock_);
  for (const auto &info : languages_) {
    if (info.code == activeLanguageCode_) return info;
  }
  return {activeLanguageCode_, activeLanguageCode_, activeLanguageCode_, QStringLiteral("ltr")};
}

bool LanguageManager::isRtl() const {
  return activeLanguage().isRtl();
}

Qt::LayoutDirection LanguageManager::layoutDirection() const {
  return isRtl() ? Qt::RightToLeft : Qt::LeftToRight;
}

void LanguageManager::applyLayoutDirection() {
  if (qApp) {
    qApp->setLayoutDirection(layoutDirection());
  }
}

void LanguageManager::reloadTranslations() {
  determineAndApplyActiveLanguage(/*notify=*/true);
}

QString LanguageManager::translate(const QString &key, const QString &fallback) const {
  if (key.isEmpty()) return {};

  QReadLocker locker(&lock_);
  auto it = currentCatalog_.constFind(key);
  if (it != currentCatalog_.constEnd() && !it.value().isEmpty()) {
    return it.value();
  }

  auto itFb = fallbackCatalog_.constFind(key);
  if (itFb != fallbackCatalog_.constEnd() && !itFb.value().isEmpty()) {
    return itFb.value();
  }

  if (!fallback.isEmpty()) {
    return fallback;
  }

  return key;
}

QString LanguageManager::translate(const QString &key,
                                   const QVariantMap &replacements) const {
  QString text = translate(key);
  for (auto it = replacements.constBegin(); it != replacements.constEnd(); ++it) {
    const QString placeholder1 = QStringLiteral("{%1}").arg(it.key());
    const QString placeholder2 = QStringLiteral("{{%1}}").arg(it.key());
    const QString val = it.value().toString();
    text.replace(placeholder1, val);
    text.replace(placeholder2, val);
  }
  return text;
}

QString LanguageManager::formatSystemLanguageLabel() const {
  const QString sysCode = systemLocaleLanguageCode();
  const LanguageInfo sysInfo = languageInfo(sysCode);
  const QString name = !sysInfo.nativeName.isEmpty() ? sysInfo.nativeName : sysCode;
  return translate(QStringLiteral("settings.language.system_default_format")).arg(name);
}

QHash<QString, QString> LanguageManager::currentCatalog() const {
  QReadLocker locker(&lock_);
  return currentCatalog_;
}

QHash<QString, QString> LanguageManager::fallbackCatalog() const {
  QReadLocker locker(&lock_);
  return fallbackCatalog_;
}

}  // namespace ardali::i18n
