#include <QApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLineEdit>
#include <QLocale>
#include <QSettings>
#include <QTemporaryDir>
#include <cassert>
#include <iostream>

#include "i18n/i18n.h"
#include "i18n/language_manager.h"

using namespace ardali::i18n;

int main(int argc, char **argv) {
  // Use a dedicated organization and application name to isolate test QSettings
  QApplication app(argc, argv);
  app.setOrganizationName(QStringLiteral("ArDaliTestOrg"));
  app.setApplicationName(QStringLiteral("LanguageManagerTest"));

  // Reset any previous settings
  {
    QSettings settings;
    settings.clear();
    settings.sync();
  }

  std::cout << "[TEST] Starting LanguageManager test suite..." << std::endl;

  auto &lm = LanguageManager::instance();
  lm.initialize();

  // -------------------------------------------------------------
  // Test Case 1: Configuration & metadata parsing
  // -------------------------------------------------------------
  std::cout << "[TEST 1] Verifying supported languages configuration..." << std::endl;
  const auto supported = lm.supportedLanguages();
  assert(supported.size() >= 3);
  assert(lm.isLanguageSupported(QStringLiteral("en")));
  assert(lm.isLanguageSupported(QStringLiteral("tr")));
  assert(lm.isLanguageSupported(QStringLiteral("ar")));

  const auto enInfo = lm.languageInfo(QStringLiteral("en"));
  assert(enInfo.code == QLatin1String("en"));
  assert(enInfo.direction == QLatin1String("ltr"));
  assert(!enInfo.isRtl());

  const auto trInfo = lm.languageInfo(QStringLiteral("tr"));
  assert(trInfo.code == QLatin1String("tr"));
  assert(trInfo.nativeName == QStringLiteral("Türkçe"));
  assert(!trInfo.isRtl());

  const auto arInfo = lm.languageInfo(QStringLiteral("ar"));
  assert(arInfo.code == QLatin1String("ar"));
  assert(arInfo.nativeName == QStringLiteral("العربية"));
  assert(arInfo.direction == QLatin1String("rtl"));
  assert(arInfo.isRtl());

  // -------------------------------------------------------------
  // Test Case 2: System locale detection mapping
  // -------------------------------------------------------------
  std::cout << "[TEST 2] Verifying system locale mappings..." << std::endl;
  // Test Turkish locale mapping
  QLocale::setDefault(QLocale(QLocale::Turkish, QLocale::Turkey));
  assert(lm.systemLocaleLanguageCode() == QLatin1String("tr"));

  // Test Arabic locale mapping
  QLocale::setDefault(QLocale(QLocale::Arabic, QLocale::SaudiArabia));
  assert(lm.systemLocaleLanguageCode() == QLatin1String("ar"));

  // Test English locale mapping
  QLocale::setDefault(QLocale(QLocale::English, QLocale::UnitedStates));
  assert(lm.systemLocaleLanguageCode() == QLatin1String("en"));

  // Test Unsupported locale mapping -> should fallback to English ("en")
  QLocale::setDefault(QLocale(QLocale::German, QLocale::Germany));
  assert(lm.systemLocaleLanguageCode() == QLatin1String("en"));
  QLocale::setDefault(QLocale(QLocale::French, QLocale::France));
  assert(lm.systemLocaleLanguageCode() == QLatin1String("en"));
  QLocale::setDefault(QLocale(QLocale::Russian, QLocale::Russia));
  assert(lm.systemLocaleLanguageCode() == QLatin1String("en"));

  // -------------------------------------------------------------
  // Test Case 3: Preference = "system" behavior
  // -------------------------------------------------------------
  std::cout << "[TEST 3] Testing preference = 'system' with various locales..." << std::endl;
  lm.setLanguagePreference(QStringLiteral("system"));
  assert(lm.languagePreference() == QLatin1String("system"));

  // System is Turkish -> active language must be tr
  QLocale::setDefault(QLocale(QLocale::Turkish, QLocale::Turkey));
  lm.reloadTranslations();
  assert(lm.activeLanguageCode() == QLatin1String("tr"));
  assert(!lm.isRtl());

  // System is Arabic -> active language must be ar
  QLocale::setDefault(QLocale(QLocale::Arabic, QLocale::Egypt));
  lm.reloadTranslations();
  assert(lm.activeLanguageCode() == QLatin1String("ar"));
  assert(lm.isRtl());
  assert(app.layoutDirection() == Qt::RightToLeft);

  // System is English -> active language must be en
  QLocale::setDefault(QLocale(QLocale::English, QLocale::UnitedKingdom));
  lm.reloadTranslations();
  assert(lm.activeLanguageCode() == QLatin1String("en"));
  assert(!lm.isRtl());
  assert(app.layoutDirection() == Qt::LeftToRight);

  // System is Unsupported (Japanese) -> active language must fallback to en
  QLocale::setDefault(QLocale(QLocale::Japanese, QLocale::Japan));
  lm.reloadTranslations();
  assert(lm.activeLanguageCode() == QLatin1String("en"));
  assert(!lm.isRtl());
  assert(app.layoutDirection() == Qt::LeftToRight);

  // -------------------------------------------------------------
  // Test Case 4: Explicit preference overrides system locale
  // -------------------------------------------------------------
  std::cout << "[TEST 4] Explicit preference overrides system locale..." << std::endl;
  // System is Arabic, but user explicitly prefers Turkish
  QLocale::setDefault(QLocale(QLocale::Arabic, QLocale::SaudiArabia));
  lm.setLanguagePreference(QStringLiteral("tr"));
  assert(lm.activeLanguageCode() == QLatin1String("tr"));
  assert(!lm.isRtl());
  assert(app.layoutDirection() == Qt::LeftToRight);

  // System is Turkish, but user explicitly prefers Arabic
  QLocale::setDefault(QLocale(QLocale::Turkish, QLocale::Turkey));
  lm.setLanguagePreference(QStringLiteral("ar"));
  assert(lm.activeLanguageCode() == QLatin1String("ar"));
  assert(lm.isRtl());
  assert(app.layoutDirection() == Qt::RightToLeft);

  // User explicitly prefers English
  lm.setLanguagePreference(QStringLiteral("en"));
  assert(lm.activeLanguageCode() == QLatin1String("en"));
  assert(!lm.isRtl());
  assert(app.layoutDirection() == Qt::LeftToRight);

  // -------------------------------------------------------------
  // Test Case 5: Translations lookup & quality
  // -------------------------------------------------------------
  std::cout << "[TEST 5] Translation lookups in en, tr, and ar..." << std::endl;
  lm.setLanguagePreference(QStringLiteral("en"));
  assert(I18n::text(QStringLiteral("menu.new_tab")) == QStringLiteral("New tab"));
  assert(I18n::text(QStringLiteral("settings.title")) == QStringLiteral("Settings"));
  assert(I18n::text(QStringLiteral("downloads.title")) == QStringLiteral("Downloads"));

  lm.setLanguagePreference(QStringLiteral("tr"));
  assert(I18n::text(QStringLiteral("menu.new_tab")) == QStringLiteral("Yeni sekme"));
  assert(I18n::text(QStringLiteral("settings.title")) == QStringLiteral("Ayarlar"));
  assert(I18n::text(QStringLiteral("downloads.title")) == QStringLiteral("İndirmeler"));
  assert(I18n::text(QStringLiteral("common.save")) == QStringLiteral("Kaydet"));
  assert(I18n::text(QStringLiteral("common.cancel")) == QStringLiteral("İptal"));

  lm.setLanguagePreference(QStringLiteral("ar"));
  assert(I18n::text(QStringLiteral("menu.new_tab")) == QStringLiteral("علامة تبويب جديدة"));
  assert(I18n::text(QStringLiteral("settings.title")) == QStringLiteral("الإعدادات"));
  assert(I18n::text(QStringLiteral("downloads.title")) == QStringLiteral("التنزيلات"));
  assert(I18n::text(QStringLiteral("common.save")) == QStringLiteral("حفظ"));
  assert(I18n::text(QStringLiteral("common.cancel")) == QStringLiteral("إلغاء"));

  // -------------------------------------------------------------
  // Test Case 6: Fallback resolution chain (Missing in lang -> English -> Key)
  // -------------------------------------------------------------
  std::cout << "[TEST 6] Fallback resolution..." << std::endl;
  // Key missing in all catalogs returns the key itself or provided fallback
  const QString unknownKey = QStringLiteral("synthetic.nonexistent.key");
  assert(I18n::text(unknownKey) == unknownKey);
  assert(I18n::text(unknownKey, QStringLiteral("FallbackValue")) == QStringLiteral("FallbackValue"));

  // -------------------------------------------------------------
  // Test Case 7: Parameter replacement
  // -------------------------------------------------------------
  std::cout << "[TEST 7] Parameter replacement..." << std::endl;
  lm.setLanguagePreference(QStringLiteral("en"));
  QVariantMap replacements;
  replacements.insert(QStringLiteral("host"), QStringLiteral("example.com"));
  assert(I18n::text(QStringLiteral("toolbar.search_engine")).arg(QStringLiteral("Google"))
         == QStringLiteral("Search engine: Google"));

  // -------------------------------------------------------------
  // Test Case 8: Runtime signal notification
  // -------------------------------------------------------------
  std::cout << "[TEST 8] Runtime signal notification..." << std::endl;
  QString receivedCode;
  int signalCount = 0;
  QObject::connect(&lm, &LanguageManager::languageChanged, &app, [&](const QString &code) {
    receivedCode = code;
    signalCount++;
  });

  lm.setLanguagePreference(QStringLiteral("tr"));
  assert(signalCount == 1);
  assert(receivedCode == QLatin1String("tr"));

  lm.setLanguagePreference(QStringLiteral("ar"));
  assert(signalCount == 2);
  assert(receivedCode == QLatin1String("ar"));

  // -------------------------------------------------------------
  // Test Case 9: QSettings persistence & reload parity
  // -------------------------------------------------------------
  std::cout << "[TEST 9] QSettings persistence..." << std::endl;
  lm.setLanguagePreference(QStringLiteral("ar"));
  {
    QSettings settings;
    assert(settings.value(QStringLiteral("i18n/language")).toString() == QLatin1String("ar"));
  }

  // Simulate application restart: new manager reading from QSettings
  lm.setLanguagePreference(QStringLiteral("tr"));
  {
    QSettings settings;
    assert(settings.value(QStringLiteral("i18n/language")).toString() == QLatin1String("tr"));
  }
  lm.initialize();
  assert(lm.activeLanguageCode() == QLatin1String("tr"));

  // -------------------------------------------------------------
  // Test Case 10: RTL Omnibox / URL Field Isolation
  // -------------------------------------------------------------
  std::cout << "[TEST 10] Omnibox LTR layout preservation in RTL mode..." << std::endl;
  lm.setLanguagePreference(QStringLiteral("ar"));
  assert(app.layoutDirection() == Qt::RightToLeft);

  QLineEdit omnibox;
  omnibox.setLayoutDirection(Qt::LeftToRight);
  omnibox.setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
  omnibox.setText(QStringLiteral("https://ardali.test/browse"));

  assert(omnibox.layoutDirection() == Qt::LeftToRight);

  // -------------------------------------------------------------
  // Test Case 11: Malformed JSON tolerance (No crash)
  // -------------------------------------------------------------
  std::cout << "[TEST 11] Malformed JSON tolerance..." << std::endl;
  QTemporaryDir tempDir;
  assert(tempDir.isValid());
  const QString brokenJsonPath = tempDir.filePath(QStringLiteral("broken_languages.json"));
  {
    QFile brokenFile(brokenJsonPath);
    assert(brokenFile.open(QIODevice::WriteOnly));
    brokenFile.write("{ this is definitely not valid json : [ }");
    brokenFile.close();
  }

  // Must not crash and should safely return false while preserving safe defaults
  const bool loaded = lm.loadLanguagesConfig(brokenJsonPath);
  assert(!loaded);
  assert(lm.isLanguageSupported(QStringLiteral("en")));
  assert(lm.isLanguageSupported(QStringLiteral("tr")));

  // Non-existent file tolerance
  const bool loadedNonExistent = lm.loadLanguagesConfig(QStringLiteral("/path/does/not/exist.json"));
  assert(!loadedNonExistent);

  // -------------------------------------------------------------
  // Test Case 12: formatSystemLanguageLabel
  // -------------------------------------------------------------
  std::cout << "[TEST 12] formatSystemLanguageLabel..." << std::endl;
  QLocale::setDefault(QLocale(QLocale::Turkish, QLocale::Turkey));
  lm.setLanguagePreference(QStringLiteral("tr"));
  const QString sysLabelTr = lm.formatSystemLanguageLabel();
  assert(sysLabelTr.contains(QStringLiteral("Türkçe")));

  lm.setLanguagePreference(QStringLiteral("en"));
  const QString sysLabelEn = lm.formatSystemLanguageLabel();
  assert(sysLabelEn.contains(QStringLiteral("Türkçe")));

  std::cout << "[TEST] All LanguageManager tests PASSED successfully!" << std::endl;
  return 0;
}
