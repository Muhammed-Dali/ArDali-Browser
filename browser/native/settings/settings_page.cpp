#include "search_suggestion_service.h"
#include "settings_page.h"

#include "browser_profile_service.h"
#include "dalinira_blocker_service.h"
#include "song_finder_settings.h"
#include "tab_performance_manager.h"
#include "system_memory_pressure_monitor.h"
#include "desktop_tabs/tab_appearance.h"
#include "translate/translate_service.h"
#include "translate/language_detector.h"
#include "glow_toggle_switch.h"
#include "i18n/i18n.h"
#include "i18n/language_manager.h"

#include <QAbstractButton>
#include <QApplication>
#include <QButtonGroup>
#include <QCheckBox>
#include <QComboBox>
#include <QDesktopServices>
#include <QDialog>
#include <QFileDialog>
#include <QFrame>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenu>
#include <QMessageBox>
#include <QMouseEvent>
#include <QPointer>
#include <QPushButton>
#include <QRadioButton>
#include <QStyle>
#include <QRegularExpression>
#include <QScrollArea>
#include <QScrollBar>
#include <QSettings>
#include <QSignalBlocker>
#include <QSlider>
#include <QSpinBox>
#include <QStackedWidget>
#include <QClipboard>
#include <QStandardPaths>
#include <QTreeWidget>
#include <QHeaderView>
#include <QInputDialog>
#include <QVBoxLayout>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif
#include <QWebEngineProfile>

#include <algorithm>
#include <memory>

#include "settings_ui_helpers.h"

using namespace dalinira::settings_ui;


SettingsPage::SettingsPage(BrowserProfileService *profileService, Hooks hooks, QWidget *parent)
    : QWidget(parent), profileService_(profileService), hooks_(std::move(hooks)) {
  setObjectName(QStringLiteral("settings-page"));
  auto *root = new QVBoxLayout(this);
  root->setContentsMargins(0, 0, 0, 0);
  root->setSpacing(0);

  auto *header = new QWidget(this);
  header->setObjectName(QStringLiteral("settings-header"));
  auto *headerLayout = new QHBoxLayout(header);
  headerLayout->setContentsMargins(24, 14, 28, 14);
  headerLayout->setSpacing(20);

  auto *title = new QLabel(QStringLiteral("Ayarlar"), header);
  title->setObjectName(QStringLiteral("settings-title"));
  headerLayout->addWidget(title);
  headerLayout->addStretch(1);

  search_ = new QLineEdit(header);
  search_->setObjectName(QStringLiteral("settings-search"));
  search_->setPlaceholderText(QStringLiteral("Ayarlarda ara"));
  search_->setAccessibleName(QStringLiteral("Ayarlarda ara"));
  search_->setClearButtonEnabled(true);
  search_->setMaximumWidth(460);
  search_->addAction(BrowserIcons::icon(BrowserIcon::Search), QLineEdit::LeadingPosition);
  headerLayout->addWidget(search_, 1);
  root->addWidget(header);

  auto *body = new QWidget(this);
  auto *bodyLayout = new QHBoxLayout(body);
  bodyLayout->setContentsMargins(0, 0, 0, 0);
  bodyLayout->setSpacing(0);

  sidebar_ = new QListWidget(body);
  sidebar_->setObjectName(QStringLiteral("settings-sidebar"));
  sidebar_->setAccessibleName(QStringLiteral("Ayar kategorileri"));
  sidebar_->setIconSize(QSize(18, 18));
  sidebar_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  sidebar_->setTextElideMode(Qt::ElideRight);
  sidebar_->setMinimumWidth(196);
  sidebar_->setMaximumWidth(226);
  sidebar_->setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Expanding);

  content_ = new QStackedWidget(body);
  content_->setObjectName(QStringLiteral("settings-content"));
  bodyLayout->addWidget(sidebar_);
  bodyLayout->addWidget(content_, 1);
  root->addWidget(body, 1);

  addCategory(Category::Startup, BrowserIcon::Startup, QStringLiteral("Başlangıç"), QStringLiteral("sekme geri yükle kaldığım yer"), createStartupSection());
  addCategory(Category::Appearance, BrowserIcon::Appearance, QStringLiteral("Görünüm"), QStringLiteral("yeni sekme sık ziyaret panel ikon saydamlık sekme tarzı kavisli kapsül chrome brave floating"), createAppearanceSection());
  addCategory(Category::Performance, BrowserIcon::Performance, QStringLiteral("Performans"), QStringLiteral("performans bellek RAM sekme tasarruf arka plan site istisna"), createPerformanceSection());
  addCategory(Category::Content, BrowserIcon::Content, QStringLiteral("İçerik"), QStringLiteral("site ayarları JavaScript resim medya popup"), createContentSection());
  addCategory(Category::Privacy, BrowserIcon::Privacy, QStringLiteral("Gizlilik ve güvenlik"), QStringLiteral("çerez cache önbellek izleme izin URL"), createPrivacySection());
  addCategory(Category::Blocker, BrowserIcon::Privacy, QStringLiteral("DaliNira Blocker"), QStringLiteral("dalinira blocker reklam engelleyici filtreleme kalkan kurallar"), createBlockerSection());
  addCategory(Category::Search, BrowserIcon::Search, QStringLiteral("Arama motoru"), QStringLiteral("öneri Google DuckDuckGo Startpage Mojeek"), createSearchSection());
  addSidebarSeparator();
  addCategory(Category::Passwords, BrowserIcon::Password, QStringLiteral("Şifreler ve otomatik doldurma"), QStringLiteral("password manager parola yakında"), createPasswordsSection());
  addCategory(Category::Languages, BrowserIcon::Language, QStringLiteral("Diller"), QStringLiteral("dil language lisan dil seçimi arayüz dili uygulama dili Türkçe İngilizce Arapça yazım denetimi spellcheck çeviri translate"), createLanguagesSection());
  addCategory(Category::Downloads, BrowserIcon::Download, QStringLiteral("İndirilenler"), QStringLiteral("klasör konum dosya DALI"), createDownloadsSection());
  addCategory(Category::Bookmarks, BrowserIcon::Bookmark, QStringLiteral("Yer işaretleri"), QStringLiteral("yer imi kaydedilmiş sayfa"), createBookmarksSection());
  addCategory(Category::History, BrowserIcon::History, QStringLiteral("Geçmiş"), QStringLiteral("ziyaret tarih saat temizle"), createHistorySection());
  addCategory(Category::Accessibility, BrowserIcon::Accessibility, QStringLiteral("Erişilebilirlik"), QStringLiteral("klavye odak kontrast"), createAccessibilitySection());
  addSidebarSeparator();
  addCategory(Category::System, BrowserIcon::Settings, QStringLiteral("Sistem"), QStringLiteral("Chromium profil runtime"), createSystemSection());
  addCategory(Category::Listening, BrowserIcon::Tools, QStringLiteral("Pulse"), QStringLiteral("dalinira pulse şarkı bul shazam pulse dinle ses mikrofon müzik tanıma"), createListeningSection());
  addCategory(Category::Reset, BrowserIcon::Reset, QStringLiteral("Ayarları sıfırla"), QStringLiteral("varsayılan görünüm sık ziyaret"), createResetSection());
  addSidebarSeparator();
  addCategory(Category::About, BrowserIcon::Info, QStringLiteral("DaliNiraBrowser hakkında"), QStringLiteral("sürüm version build Qt WebEngine Chromium"), createAboutSection());

  setStyleSheet(settingsStyleSheet());
  connect(sidebar_, &QListWidget::currentRowChanged, this, &SettingsPage::selectCategory);
  connect(sidebar_, &QListWidget::itemClicked, this, [this](QListWidgetItem *item) {
    if (item) selectCategory(sidebar_->row(item));
  });
  connect(search_, &QLineEdit::textChanged, this, &SettingsPage::applyFilter);
  connect(&dalinira::i18n::LanguageManager::instance(), &dalinira::i18n::LanguageManager::languageChanged,
          this, [this] { retranslateUi(); });
  if (profileService_) {
    connect(profileService_, &BrowserProfileService::historyChanged, this, [this] {
      if (refreshHistory_) refreshHistory_();
    });
    connect(profileService_, &BrowserProfileService::bookmarksChanged, this, [this] {
      if (refreshBookmarks_) refreshBookmarks_();
    });
  }
  setTabOrder(search_, sidebar_);
  setCategory(Category::Startup);
  retranslateUi();
}

void SettingsPage::addCategory(Category category, BrowserIcon icon, const QString &name,
                               const QString &keywords, QWidget *section) {
  auto *scroll = new QScrollArea(content_);
  scroll->setObjectName(QStringLiteral("settings-scroll"));
  scroll->setAccessibleName(name);
  scroll->setWidgetResizable(true);
  scroll->setFrameShape(QFrame::NoFrame);
  scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  scroll->setWidget(section);
  const int contentIndex = content_->addWidget(scroll);
  auto *item = new QListWidgetItem(BrowserIcons::icon(icon), name, sidebar_);
  item->setData(Qt::UserRole, contentIndex);
  item->setToolTip(name);
  const int sidebarRow = sidebar_->row(item);
  categoryIndexes_.insert(category, sidebarRow);
  contentSidebarRows_.insert(contentIndex, sidebarRow);
  searchKeywords_.insert(contentIndex, name + QLatin1Char(' ') + keywords);
}

void SettingsPage::retranslateUi() {
  const auto updateItem = [this](Category cat, const QString &textKey, const QString &fallback) {
    const int row = categoryIndexes_.value(cat, -1);
    if (row >= 0 && row < sidebar_->count()) {
      auto *item = sidebar_->item(row);
      if (item) {
        const QString txt = I18n::text(textKey, fallback);
        item->setText(txt);
        item->setToolTip(txt);
      }
    }
  };

  updateItem(Category::Startup, QStringLiteral("settings.category.startup"), QStringLiteral("Başlangıç"));
  updateItem(Category::Appearance, QStringLiteral("settings.category.appearance"), QStringLiteral("Görünüm"));
  updateItem(Category::Performance, QStringLiteral("settings.category.performance"), QStringLiteral("Performans"));
  updateItem(Category::Content, QStringLiteral("settings.category.content"), QStringLiteral("İçerik"));
  updateItem(Category::Privacy, QStringLiteral("settings.category.privacy"), QStringLiteral("Gizlilik ve güvenlik"));
  updateItem(Category::Blocker, QStringLiteral("settings.category.blocker"), QStringLiteral("DaliNira Blocker"));
  updateItem(Category::Search, QStringLiteral("settings.category.search"), QStringLiteral("Arama motoru"));
  updateItem(Category::Passwords, QStringLiteral("settings.category.passwords"), QStringLiteral("Şifreler ve otomatik doldurma"));
  updateItem(Category::Bookmarks, QStringLiteral("settings.category.bookmarks"), QStringLiteral("Yer işaretleri"));
  updateItem(Category::History, QStringLiteral("settings.category.history"), QStringLiteral("Geçmiş"));
  updateItem(Category::Downloads, QStringLiteral("settings.category.downloads"), QStringLiteral("İndirilenler"));
  updateItem(Category::Languages, QStringLiteral("settings.category.languages"), QStringLiteral("Diller"));
  updateItem(Category::Accessibility, QStringLiteral("settings.category.accessibility"), QStringLiteral("Erişilebilirlik"));
  updateItem(Category::System, QStringLiteral("settings.category.system"), QStringLiteral("Sistem"));
  updateItem(Category::Listening, QStringLiteral("settings.category.listening"), QStringLiteral("Pulse"));
  updateItem(Category::Reset, QStringLiteral("settings.category.reset"), QStringLiteral("Ayarları sıfırla"));
  updateItem(Category::About, QStringLiteral("settings.category.about"), QStringLiteral("DaliNiraBrowser hakkında"));

  if (search_) {
    search_->setPlaceholderText(I18n::text(QStringLiteral("settings.search_placeholder"), QStringLiteral("Ayarlarda ara")));
  }

  if (uiLangCombo_) {
    uiLangCombo_->setItemText(0, dalinira::i18n::LanguageManager::instance().formatSystemLanguageLabel());
  }
}

void SettingsPage::addSidebarSeparator() {
  auto *item = new QListWidgetItem(sidebar_);
  item->setFlags(Qt::NoItemFlags);
  item->setSizeHint(QSize(0, 8));
}

void SettingsPage::setCategory(Category category) {
  const int row = categoryIndexes_.value(category, -1);
  if (row >= 0) {
    if (!search_->text().isEmpty()) search_->clear();
    sidebar_->setCurrentRow(row);
    if (category == Category::Privacy && privacyStack_) {
      privacyStack_->setCurrentIndex(0);
      if (updatePrivacySubtitles_) updatePrivacySubtitles_();
    }
  }
}

void SettingsPage::refreshPreferences() {
  QSettings settings;
  if (auto *frequent = findChild<QCheckBox *>(QStringLiteral("settings-frequent-sites"))) {
    const QSignalBlocker blocker(frequent);
    frequent->setChecked(settings.value(QStringLiteral("browser/showFrequentSites"), true).toBool());
  }
  if (auto *panel = findChild<QSlider *>(QStringLiteral("settings-frequent-panel-opacity"))) {
    const QSignalBlocker blocker(panel);
    panel->setValue(std::clamp(settings.value(QStringLiteral("browser/frequentSitesPanelOpacity"), 72).toInt(), 0, 100));
  }
  if (auto *icons = findChild<QSlider *>(QStringLiteral("settings-frequent-icon-opacity"))) {
    const QSignalBlocker blocker(icons);
    icons->setValue(std::clamp(settings.value(QStringLiteral("browser/frequentSitesIconOpacity"), 82).toInt(), 0, 100));
  }
  if (auto *restore = findChild<QPushButton *>(QStringLiteral("settings-restore-frequent-sites")))
    restore->setEnabled(!settings.value(QStringLiteral("browser/hiddenFrequentSites")).toStringList().isEmpty());
  if (auto *engine = findChild<QComboBox *>(QStringLiteral("settings-search-engine"))) {
    const QSignalBlocker blocker(engine);
    engine->setCurrentText(settings.value(QStringLiteral("browser/searchEngine"), QStringLiteral("DuckDuckGo")).toString());
  }
  if (auto *suggestions = findChild<QCheckBox *>(QStringLiteral("settings-search-suggestions"))) {
    const QSignalBlocker blocker(suggestions);
    suggestions->setChecked(profileService_ ? profileService_->searchSuggestions()->isEnabled() : settings.value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool());
  }
  if (auto *discardToggle = findChild<QCheckBox *>(QStringLiteral("settings-discard-toggle"))) {
    const QSignalBlocker blocker(discardToggle);
    auto *pm = hooks_.performanceManager ? hooks_.performanceManager() : nullptr;
    discardToggle->setChecked(pm ? pm->isDiscardEnabled() : settings.value(QStringLiteral("performance/discardEnabled"), true).toBool());
  }
}

void SettingsPage::selectCategory(int row) {
  if (row < 0 || row >= sidebar_->count()) return;
  const QVariant contentIndex = sidebar_->item(row)->data(Qt::UserRole);
  if (contentIndex.isValid()) {
    content_->setCurrentIndex(contentIndex.toInt());
    if (privacyStack_ && row == categoryIndexes_.value(Category::Privacy, -1)) {
      privacyStack_->setCurrentIndex(0);
      if (updatePrivacySubtitles_) updatePrivacySubtitles_();
    }
    if (row == categoryIndexes_.value(Category::History, -1)) {
      if (refreshHistory_) refreshHistory_();
    }
    if (row == categoryIndexes_.value(Category::Bookmarks, -1)) {
      if (refreshBookmarks_) refreshBookmarks_();
    }
  }
}

QWidget *SettingsPage::createStartupSection() {
  Section section = makeSection(QStringLiteral("Başlangıç"), QStringLiteral("DaliNiraBrowser açıldığında kaldığınız yerden devam edip etmeyeceğinizi seçin."));
  auto *card = makeCard(section.page, QStringLiteral("BAŞLANGIÇ DAVRANIŞI"));
  auto *restore = new QCheckBox(card); restore->setAccessibleName(QStringLiteral("Başlangıçta son sekmeleri geri yükle"));
  restore->setChecked(QSettings().value(QStringLiteral("browser/restoreSession"), true).toBool());
  addRow(card, settingRow(card, QStringLiteral("Son sekmeleri geri yükle"), QStringLiteral("Tarayıcı açıldığında önceki oturumdaki web sekmelerini yeniden açar."), restore, BrowserIcon::Startup, true));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(restore, &QCheckBox::toggled, this, [](bool value) { QSettings().setValue(QStringLiteral("browser/restoreSession"), value); });
  return section.page;
}

QWidget *SettingsPage::createAppearanceSection() {
  Section section = makeSection(QStringLiteral("Görünüm"), QStringLiteral("Sekme tarzları, yeni sekme sayfası ve arayüz tercihlerini düzenleyin."));

  // --------------------------------------------------------------------------
  // Card 1: SEKME GÖRÜNÜMÜ VE TARZLARI (Tab Styles)
  // --------------------------------------------------------------------------
  auto *tabStyleCard = makeCard(section.page, QStringLiteral("SEKME GÖRÜNÜMÜ VE TARZLARI"));
  auto *tabStyleContainer = new QWidget(tabStyleCard);
  tabStyleContainer->setObjectName(QStringLiteral("settings-tab-style-container"));
  auto *tabStyleLayout = new QVBoxLayout(tabStyleContainer);
  tabStyleLayout->setContentsMargins(18, 14, 18, 14);
  tabStyleLayout->setSpacing(10);

  struct TabStyleInfo {
    QString id;
    QString title;
    QString badge;
    QString description;
  };

  const std::vector<TabStyleInfo> tabStyles = {
    { QStringLiteral("chrome_curved"),
      QStringLiteral("Standart"),
      QString(),
      QStringLiteral("Klasik kavisli sekme yapısı ve araç çubuğuyla bütünleşen standart görünüm.") },
    { QStringLiteral("dalinira_signature"),
      QStringLiteral("DaliNira Kavisli (İmza Tasarım)"),
      QStringLiteral("Önerilen"),
      QStringLiteral("Chrome sekme yapısı üzerine eklenmiş özel DaliNira mavi ışıltısı.") },
    { QStringLiteral("floating_pill"),
      QStringLiteral("Modern Kapsül (Yüzen Sekme)"),
      QStringLiteral("Modern"),
      QStringLiteral("Alt çubuğa bitişik olmak yerine hafif boşlukla yüzen, dört köşesi yuvarlatılmış modern kapsül görünümü.") },
    { QStringLiteral("dalinira_connected"),
      QStringLiteral("DaliNira Bağlantılı"),
      QStringLiteral("Varsayılan"),
      QStringLiteral("Aktif sekmenin kavisli sağ ucunu tarayıcı yüzeyine bağlayan özgün DaliNira tasarımı.") }
  };

  QSettings preferences;
  const QString currentStyleStr = dalinira::desktop_tabs::tabStylePreferenceValue(
      dalinira::desktop_tabs::tabStyleFromPreference(
          preferences.value(QStringLiteral("browser/tabStyle"),
                            QStringLiteral("dalinira_connected")).toString()));

  QVector<QFrame *> styleFrameWidgets;
  QVector<QRadioButton *> styleRadioButtons;
  auto *styleBtnGroup = new QButtonGroup(tabStyleContainer);

  for (size_t i = 0; i < tabStyles.size(); ++i) {
    const auto &info = tabStyles[i];
    auto *frame = new ClickableFrame(tabStyleContainer);
    frame->setObjectName(QStringLiteral("settings-mode-card"));
    const bool isSelected = (info.id == currentStyleStr);
    frame->setProperty("selected", isSelected);
    frame->setCursor(Qt::PointingHandCursor);

    auto *fLayout = new QHBoxLayout(frame);
    fLayout->setContentsMargins(16, 12, 16, 12);
    fLayout->setSpacing(12);

    auto *radio = new QRadioButton(frame);
    radio->setChecked(isSelected);
    radio->setAccessibleName(info.title);
    radio->setAccessibleDescription(info.description);
    styleBtnGroup->addButton(radio, static_cast<int>(i));
    radio->setObjectName(QStringLiteral("settings-tab-style-%1").arg(info.id));
    styleRadioButtons.push_back(radio);
    frame->clicked = [radio] { radio->click(); };

    auto *textBox = new QWidget(frame);
    auto *tLayout = new QVBoxLayout(textBox);
    tLayout->setContentsMargins(0, 0, 0, 0);
    tLayout->setSpacing(2);

    auto *titleRow = new QWidget(textBox);
    auto *trLayout = new QHBoxLayout(titleRow);
    trLayout->setContentsMargins(0, 0, 0, 0);
    trLayout->setSpacing(8);

    auto *titleLabel = new QLabel(info.title, titleRow);
    titleLabel->setObjectName(QStringLiteral("settings-mode-title"));
    trLayout->addWidget(titleLabel);

    if (!info.badge.isEmpty()) {
      auto *badgeLabel = new QLabel(info.badge, titleRow);
      badgeLabel->setObjectName(QStringLiteral("settings-mode-badge"));
      trLayout->addWidget(badgeLabel);
    }
    trLayout->addStretch(1);

    auto *descLabel = new QLabel(info.description, textBox);
    descLabel->setObjectName(QStringLiteral("settings-mode-desc"));
    descLabel->setWordWrap(true);

    tLayout->addWidget(titleRow);
    tLayout->addWidget(descLabel);

    fLayout->addWidget(radio, 0, Qt::AlignVCenter);
    fLayout->addWidget(textBox, 1, Qt::AlignVCenter);

    tabStyleLayout->addWidget(frame);
    styleFrameWidgets.push_back(frame);
  }

  auto updateTabStyleSelection = [this, tabStyles, styleFrameWidgets, styleRadioButtons](int index) {
    if (index < 0 || index >= static_cast<int>(tabStyles.size())) return;
    const QString selectedId = tabStyles[index].id;
    for (int i = 0; i < static_cast<int>(styleFrameWidgets.size()); ++i) {
      const bool isSelected = (i == index);
      styleFrameWidgets[i]->setProperty("selected", isSelected);
      styleFrameWidgets[i]->style()->unpolish(styleFrameWidgets[i]);
      styleFrameWidgets[i]->style()->polish(styleFrameWidgets[i]);
      if (styleRadioButtons[i]->isChecked() != isSelected) {
        styleRadioButtons[i]->setChecked(isSelected);
      }
    }
    QSettings settings;
    settings.setValue(QStringLiteral("browser/tabStyle"), selectedId);
    settings.sync();
    if (hooks_.refreshTabStyle) hooks_.refreshTabStyle();
  };

  connect(styleBtnGroup, &QButtonGroup::idClicked, this, updateTabStyleSelection);

  addRow(tabStyleCard, tabStyleContainer);
  section.layout->addWidget(tabStyleCard);

  // --------------------------------------------------------------------------
  // Card 2: YENİ SEKME (New Tab)
  // --------------------------------------------------------------------------
  auto *card = makeCard(section.page, QStringLiteral("YENİ SEKME"));
  auto *frequent = new QCheckBox(card); frequent->setObjectName(QStringLiteral("settings-frequent-sites")); frequent->setAccessibleName(QStringLiteral("Sık ziyaret edilenleri göster"));
  frequent->setChecked(preferences.value(QStringLiteral("browser/showFrequentSites"), true).toBool());
  addRow(card, settingRow(card, QStringLiteral("Sık ziyaret edilenleri göster"), QStringLiteral("Yeni sekmede en sık ziyaret ettiğiniz siteleri gösterir."), frequent, BrowserIcon::Content, true));
  QSlider *panel = nullptr; QLabel *panelValue = nullptr;
  QWidget *panelControl = sliderControl(&panel, &panelValue, std::clamp(preferences.value(QStringLiteral("browser/frequentSitesPanelOpacity"), 72).toInt(), 0, 100), card);
  panel->setAccessibleName(QStringLiteral("Panel saydamlığı"));
  panel->setObjectName(QStringLiteral("settings-frequent-panel-opacity"));
  addRow(card, settingRow(card, QStringLiteral("Panel saydamlığı"), QStringLiteral("Sık ziyaret edilenler panelinin arka plan yoğunluğu."), panelControl));
  QSlider *icons = nullptr; QLabel *iconValue = nullptr;
  QWidget *iconControl = sliderControl(&icons, &iconValue, std::clamp(preferences.value(QStringLiteral("browser/frequentSitesIconOpacity"), 82).toInt(), 0, 100), card);
  icons->setAccessibleName(QStringLiteral("İkon saydamlığı"));
  icons->setObjectName(QStringLiteral("settings-frequent-icon-opacity"));
  addRow(card, settingRow(card, QStringLiteral("İkon saydamlığı"), QStringLiteral("Site ikonlarının arka plan yoğunluğu."), iconControl));
  auto *restore = new QPushButton(QStringLiteral("Geri getir"), card); restore->setObjectName(QStringLiteral("settings-restore-frequent-sites")); restore->setAccessibleName(QStringLiteral("Kaldırılan siteleri geri getir"));
  restore->setEnabled(!preferences.value(QStringLiteral("browser/hiddenFrequentSites")).toStringList().isEmpty());
  addRow(card, settingRow(card, QStringLiteral("Kaldırılan siteler"), QStringLiteral("Yeni sekmeden gizlediğiniz sık ziyaret edilen siteleri yeniden gösterir."), restore, BrowserIcon::Reset, true));

  const bool legacyCards = preferences.value(QStringLiteral("browser/cards"), true).toBool();
  const bool showDownloadsVal = preferences.value(QStringLiteral("browser/showDownloadsCard"), legacyCards).toBool();
  const bool showBlockedVal = preferences.value(QStringLiteral("browser/showBlockedCard"), legacyCards).toBool();
  const QString blockedCounterVal = preferences.value(QStringLiteral("browser/blockedCounterMode"), QStringLiteral("all_time")).toString();

  auto *showDownloads = new QCheckBox(card);
  showDownloads->setObjectName(QStringLiteral("settings-show-downloads-card"));
  showDownloads->setAccessibleName(QStringLiteral("İndirme kartını göster"));
  showDownloads->setChecked(showDownloadsVal);
  addRow(card, settingRow(card, QStringLiteral("İndirme kartını göster"), QStringLiteral("Yeni sekmede son indirilen dosyaların sayısını gösteren kartı görüntüler."), showDownloads, BrowserIcon::Download, true));

  auto *showBlocked = new QCheckBox(card);
  showBlocked->setObjectName(QStringLiteral("settings-show-blocked-card"));
  showBlocked->setAccessibleName(QStringLiteral("Engellenen öğeler kartını göster"));
  showBlocked->setChecked(showBlockedVal);
  addRow(card, settingRow(card, QStringLiteral("Engellenen öğeler kartını göster"), QStringLiteral("Yeni sekmede engellenen izleyici ve reklamların sayısını gösteren kartı görüntüler."), showBlocked, BrowserIcon::Privacy, true));

  auto *blockedCounter = new QComboBox(card);
  blockedCounter->setObjectName(QStringLiteral("settings-blocked-counter-mode"));
  blockedCounter->setAccessibleName(QStringLiteral("Engellenen öğe sayacı"));
  blockedCounter->addItem(QStringLiteral("Oturum boyunca"), QStringLiteral("session"));
  blockedCounter->addItem(QStringLiteral("Tüm zamanlar"), QStringLiteral("all_time"));
  blockedCounter->setCurrentIndex(blockedCounterVal == QLatin1String("session") ? 0 : 1);
  addRow(card, settingRow(card, QStringLiteral("Engellenen öğe sayacı"), QStringLiteral("Engellenen öğeler kartında gösterilecek sayacın kapsamını belirler."), blockedCounter, BrowserIcon::Privacy, true));

  auto *reset = new QPushButton(QStringLiteral("Sıfırla"), card); reset->setProperty("danger", true); reset->setAccessibleName(QStringLiteral("Yeni sekme ayarlarını sıfırla"));
  addRow(card, settingRow(card, QStringLiteral("Yeni sekme görünümünü sıfırla"), QStringLiteral("Yalnız yeni sekme görünüm tercihlerini varsayılan değerlere döndürür."), reset));
  section.layout->addWidget(card); section.layout->addStretch();
  const auto save = [this, frequent, panel, icons, showDownloads, showBlocked, blockedCounter] {
    QSettings settings;
    settings.setValue(QStringLiteral("browser/showFrequentSites"), frequent->isChecked());
    settings.setValue(QStringLiteral("browser/frequentSitesPanelOpacity"), panel->value());
    settings.setValue(QStringLiteral("browser/frequentSitesIconOpacity"), icons->value());
    settings.setValue(QStringLiteral("browser/showDownloadsCard"), showDownloads->isChecked());
    settings.setValue(QStringLiteral("browser/showBlockedCard"), showBlocked->isChecked());
    settings.setValue(QStringLiteral("browser/blockedCounterMode"), blockedCounter->currentData().toString());
    settings.setValue(QStringLiteral("browser/cards"), showDownloads->isChecked() || showBlocked->isChecked());
    if (hooks_.syncNewTabs) hooks_.syncNewTabs();
  };
  connect(panel, &QSlider::valueChanged, panelValue, [panelValue](int value) { panelValue->setText(QStringLiteral("%1%").arg(value)); });
  connect(icons, &QSlider::valueChanged, iconValue, [iconValue](int value) { iconValue->setText(QStringLiteral("%1%").arg(value)); });
  connect(frequent, &QCheckBox::toggled, this, [save](bool) { save(); });
  connect(panel, &QSlider::sliderReleased, this, save);
  connect(icons, &QSlider::sliderReleased, this, save);
  connect(showDownloads, &QCheckBox::toggled, this, [save](bool) { save(); });
  connect(showBlocked, &QCheckBox::toggled, this, [save](bool) { save(); });
  connect(blockedCounter, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [save](int) { save(); });
  connect(restore, &QPushButton::clicked, this, [this, restore] { QSettings().remove(QStringLiteral("browser/hiddenFrequentSites")); restore->setEnabled(false); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
  const auto resetAppearance = [save, frequent, panel, icons, restore, showDownloads, showBlocked, blockedCounter] {
    QSettings().remove(QStringLiteral("browser/hiddenFrequentSites"));
    frequent->setChecked(true);
    panel->setValue(72);
    icons->setValue(82);
    restore->setEnabled(false);
    showDownloads->setChecked(true);
    showBlocked->setChecked(true);
    blockedCounter->setCurrentIndex(1);
    save();
  };
  connect(reset, &QPushButton::clicked, this, resetAppearance); connect(this, &SettingsPage::appearanceResetRequested, this, resetAppearance);
  return section.page;
}


QWidget *SettingsPage::createSearchSection() {
  Section section = makeSection(QStringLiteral("Arama motoru"), QStringLiteral("Adres çubuğu ve yeni sekmede kullanılan web aramasını yönetin."));
  auto *card = makeCard(section.page, QStringLiteral("ARAMA"));
  auto *engine = new QComboBox(card); engine->setObjectName(QStringLiteral("settings-search-engine")); engine->setAccessibleName(QStringLiteral("Varsayılan arama motoru")); engine->addItems({QStringLiteral("Google"), QStringLiteral("DuckDuckGo"), QStringLiteral("Startpage"), QStringLiteral("Mojeek")});
  if (profileService_) for (const auto &custom : profileService_->customSearchEngines()) engine->addItem(custom.name);
  engine->setCurrentText(hooks_.searchEngine ? hooks_.searchEngine() : QStringLiteral("DuckDuckGo"));
  addRow(card, settingRow(card, QStringLiteral("Varsayılan arama motoru"), QStringLiteral("Adres çubuğuna yazılan arama sorgularında kullanılacak servis."), engine, BrowserIcon::Search, true));
  auto *suggestions = new QCheckBox(card); suggestions->setObjectName(QStringLiteral("settings-search-suggestions")); suggestions->setAccessibleName(QStringLiteral("Arama önerilerini etkinleştir")); suggestions->setChecked(profileService_ ? profileService_->searchSuggestions()->isEnabled() : QSettings().value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool()); suggestions->setEnabled(!profileService_ || !profileService_->profile()->isOffTheRecord());
  addRow(card, settingRow(card, QStringLiteral("Arama önerileri"), QStringLiteral("Etkinleştirildiğinde yazdığınız sorgu seçili arama motorunun öneri servisine gönderilebilir."), suggestions));
  auto *clearSearches = new QPushButton(QStringLiteral("Temizle"), card); clearSearches->setProperty("danger", true); clearSearches->setAccessibleName(QStringLiteral("Arama geçmişini temizle")); clearSearches->setEnabled(profileService_ && !profileService_->profile()->isOffTheRecord());
  addRow(card, settingRow(card, QStringLiteral("Arama geçmişi"), QStringLiteral("Adres çubuğu ve yeni sekmede otomatik tamamlamada kullanılan kayıtlı aramaları siler."), clearSearches, BrowserIcon::History, true));
  section.layout->addWidget(card);

  auto *customCard = makeCard(section.page, QStringLiteral("ÖZEL ARAMA MOTORLARI"));
  auto *customList = new QListWidget(customCard);
  customList->setObjectName(QStringLiteral("custom-search-engine-list"));
  customList->setMinimumHeight(120);
  auto *buttons = new QWidget(customCard);
  auto *buttonsLayout = new QHBoxLayout(buttons);
  buttonsLayout->setContentsMargins(0, 0, 0, 0);
  auto *addCustom = new QPushButton(QStringLiteral("Ekle"), buttons);
  auto *editCustom = new QPushButton(QStringLiteral("Düzenle"), buttons);
  auto *removeCustom = new QPushButton(QStringLiteral("Sil"), buttons);
  buttonsLayout->addWidget(addCustom);
  buttonsLayout->addWidget(editCustom);
  buttonsLayout->addWidget(removeCustom);
  buttonsLayout->addStretch();
  auto *customBox = new QWidget(customCard);
  auto *customLayout = new QVBoxLayout(customBox);
  customLayout->setContentsMargins(18, 10, 18, 14);
  customLayout->addWidget(customList);
  customLayout->addWidget(buttons);
  addRow(customCard, customBox);
  section.layout->addWidget(customCard);
  section.layout->addStretch();

  const auto refreshCustom = [this, customList, engine] {
    const QString selected = engine->currentText();
    customList->clear();
    while (engine->count() > 4) engine->removeItem(4);
    if (profileService_) {
      for (const auto &custom : profileService_->customSearchEngines()) {
        auto *item = new QListWidgetItem(QStringLiteral("%1\n%2").arg(custom.name, custom.urlTemplate), customList);
        item->setData(Qt::UserRole, custom.name);
        item->setData(Qt::UserRole + 1, custom.urlTemplate);
        engine->addItem(custom.name);
      }
    }
    const int index = engine->findText(selected);
    engine->setCurrentIndex(index >= 0 ? index : 0);
  };
  refreshCustom();

  const auto editEngine = [this, customList, refreshCustom](bool editing) {
    if (!profileService_) return;
    QListWidgetItem *selected = customList->currentItem();
    if (editing && !selected) return;
    const QString oldName = editing ? selected->data(Qt::UserRole).toString() : QString{};
    bool ok = false;
    const QString name = QInputDialog::getText(this, QStringLiteral("Özel Arama Motoru"),
        QStringLiteral("Ad:"), QLineEdit::Normal, oldName, &ok).trimmed();
    if (!ok || name.isEmpty()) return;
    const QString oldTemplate = editing ? selected->data(Qt::UserRole + 1).toString() : QStringLiteral("https://example.com/search?q=%s");
    const QString urlTemplate = QInputDialog::getText(this, QStringLiteral("Özel Arama Motoru"),
        QStringLiteral("Arama URL'si (%s sorgu yer tutucusudur):"), QLineEdit::Normal, oldTemplate, &ok).trimmed();
    if (!ok) return;
    if (!profileService_->saveCustomSearchEngine(name, urlTemplate, oldName)) {
      QMessageBox::warning(this, QStringLiteral("Geçersiz Arama Motoru"),
          QStringLiteral("HTTPS/HTTP URL'si tam olarak bir %s yer tutucusu içermelidir; kullanıcı bilgisi içeremez."));
      return;
    }
    refreshCustom();
    if (hooks_.syncNewTabs) hooks_.syncNewTabs();
  };
  connect(engine, &QComboBox::currentTextChanged, this, [this](const QString &value) { QSettings().setValue(QStringLiteral("browser/searchEngine"), value); if (hooks_.setSearchEngine) hooks_.setSearchEngine(value); });
  connect(suggestions, &QCheckBox::toggled, this, [this](bool value) { if (profileService_) profileService_->setSearchSuggestionsEnabled(value); else QSettings().setValue(QStringLiteral("browser/searchSuggestionsEnabled"), value); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
  connect(clearSearches, &QPushButton::clicked, this, [this] { if (profileService_) profileService_->clearSearchHistory(); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
  connect(addCustom, &QPushButton::clicked, this, [editEngine] { editEngine(false); });
  connect(editCustom, &QPushButton::clicked, this, [editEngine] { editEngine(true); });
  connect(removeCustom, &QPushButton::clicked, this, [this, customList, refreshCustom] {
    if (!profileService_ || !customList->currentItem()) return;
    profileService_->removeCustomSearchEngine(customList->currentItem()->data(Qt::UserRole).toString());
    refreshCustom();
    if (hooks_.syncNewTabs) hooks_.syncNewTabs();
  });
  return section.page;
}

QWidget *SettingsPage::createPasswordsSection() {
  Section section = makeSection(QStringLiteral("Şifreler ve otomatik doldurma"), QStringLiteral("Yerel şifre kasasını ve otomatik doldurma güvenlik politikasını yönetin."));
  auto *card = makeCard(section.page, QStringLiteral("ŞİFRE YÖNETİCİSİ"));
  auto *open = new QPushButton(QStringLiteral("Şifre Yöneticisini Aç"), card);
  addRow(card, settingRow(card, QStringLiteral("Yerel şifre kasası"), QStringLiteral("Kimlik bilgileri yalnızca şifreli kasada tutulur; kasa her başlangıçta kilitlidir."), open, BrowserIcon::Password, true));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(open, &QPushButton::clicked, this, [this] { emit navigateRequested(QUrl(QStringLiteral("dalinira://passwords"))); });
  return section.page;
}

QWidget *SettingsPage::createDownloadsSection() {
  Section section = makeSection(QStringLiteral("İndirilenler"), QStringLiteral("İndirme hedefini, onay davranışını ve bu oturumdaki işlemleri yönetin."));
  auto *card = makeCard(section.page, QStringLiteral("İNDİRME TERCİHLERİ"));
  auto *folder = new QLineEdit(card); folder->setAccessibleName(QStringLiteral("İndirme klasörü")); folder->setReadOnly(true); folder->setMinimumWidth(190); folder->setMaximumWidth(360); folder->setText(profileService_->configuredDownloadDirectory()); folder->setPlaceholderText(QStandardPaths::writableLocation(QStandardPaths::DownloadLocation));
  auto *choose = new QPushButton(QStringLiteral("Değiştir"), card); choose->setAccessibleName(QStringLiteral("İndirme klasörünü değiştir"));
  auto *folderControl = new QWidget(card); auto *folderLayout = new QHBoxLayout(folderControl); folderLayout->setContentsMargins(0,0,0,0); folderLayout->setSpacing(8); folderLayout->addWidget(folder, 1); folderLayout->addWidget(choose);
  addRow(card, settingRow(card, QStringLiteral("İndirme konumu"), QStringLiteral("Dosyaların varsayılan olarak kaydedileceği klasör."), folderControl, BrowserIcon::Folder, true));
  auto *ask = new QCheckBox(card); ask->setAccessibleName(QStringLiteral("Her indirmede konumu sor")); ask->setChecked(profileService_->asksDownloadLocation());
  addRow(card, settingRow(card, QStringLiteral("Her indirmede konumu sor"), QStringLiteral("Her dosya için kaydetme konumunu seçmenizi ister."), ask));
  section.layout->addWidget(card);
  auto *activity = makeCard(section.page, QStringLiteral("BU OTURUMDAKİ İNDİRMELER"));
  auto *list = new QListWidget(activity); list->setObjectName(QStringLiteral("settings-data-list")); list->setAccessibleName(QStringLiteral("Bu oturumdaki indirmeler")); list->setMinimumHeight(180);
  auto *container = new QWidget(activity); auto *containerLayout = new QVBoxLayout(container); containerLayout->setContentsMargins(18, 10, 18, 8); containerLayout->addWidget(list);
  addRow(activity, container);
  auto *policy = new QLabel(QStringLiteral("İndirme istekleri DALI politikasına göre kullanıcı onayı gerektirir."), activity); policy->setObjectName(QStringLiteral("settings-row-description")); policy->setWordWrap(true); policy->setContentsMargins(18, 0, 18, 14); cardLayout(activity)->addWidget(policy);
  section.layout->addWidget(activity); section.layout->addStretch();
  const auto refresh = [this, list] { list->clear(); for (const BrowserDownloadEntry &entry : profileService_->recentDownloads()) { auto *item = new QListWidgetItem(BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("%1\n%2").arg(entry.fileName, entry.state), list); item->setToolTip(entry.path); item->setSizeHint(QSize(0, 52)); } if (!list->count()) { auto *item = new QListWidgetItem(QStringLiteral("Henüz indirme yok"), list); item->setFlags(Qt::NoItemFlags); } }; refresh();
  connect(profileService_, &BrowserProfileService::downloadsChanged, this, refresh);
  connect(choose, &QPushButton::clicked, this, [this, folder] { const QString selected = QFileDialog::getExistingDirectory(this, QStringLiteral("İndirme klasörünü seç"), folder->text()); if (!selected.isEmpty()) { folder->setText(selected); profileService_->setDownloadDirectory(selected); } });
  connect(ask, &QCheckBox::toggled, this, [this](bool value) { profileService_->setAsksDownloadLocation(value); });
  return section.page;
}

QWidget *SettingsPage::createBookmarksSection() {
  Section section = makeSection(QStringLiteral("Yer işaretleri"), QStringLiteral("Kaydettiğiniz sayfaları açın veya yer işaretleri çubuğu görünümünü yönetin."));

  auto *barCard = makeCard(section.page, QStringLiteral("YER İŞARETLERİ ÇUBUĞU"));
  auto *visibilityCombo = new QComboBox(barCard);
  visibilityCombo->setObjectName(QStringLiteral("settings-bookmark-bar-visibility"));
  visibilityCombo->addItem(QStringLiteral("Sadece yeni sekmede göster (Brave stili - önerilen)"), QStringLiteral("new_tab"));
  visibilityCombo->addItem(QStringLiteral("Her zaman göster"), QStringLiteral("always"));
  visibilityCombo->addItem(QStringLiteral("Hiçbir zaman gösterme"), QStringLiteral("never"));

  const QString curBmMode = QSettings().value(QStringLiteral("browser/bookmarkBarVisibility"), QStringLiteral("new_tab")).toString();
  int bmIdx = visibilityCombo->findData(curBmMode);
  if (bmIdx >= 0) visibilityCombo->setCurrentIndex(bmIdx);

  connect(visibilityCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this, visibilityCombo](int idx) {
    const QString mode = visibilityCombo->itemData(idx).toString();
    QSettings settings;
    settings.setValue(QStringLiteral("browser/bookmarkBarVisibility"), mode);
    settings.sync();
    if (hooks_.refreshBookmarkBarVisibility) hooks_.refreshBookmarkBarVisibility();
  });

  addRow(barCard, settingRow(
      barCard,
      QStringLiteral("Yer işaretleri çubuğunu göster"),
      QStringLiteral("Web sitelerini gezerken yer işaretleri çubuğunun gizlenip yalnızca yeni sekmede gösterilmesini veya her zaman görünmesini seçin (Ctrl+Shift+B)."),
      visibilityCombo,
      BrowserIcon::Bookmark,
      true));
  section.layout->addWidget(barCard);

  auto *card = makeCard(section.page, QStringLiteral("KAYDEDİLMİŞ SAYFALAR VE KLASÖRLER"));
  auto *tree = new QTreeWidget(card);
  tree->setObjectName(QStringLiteral("settings-bookmark-tree"));
  tree->setColumnCount(2);
  tree->setHeaderLabels({QStringLiteral("Yer İşareti / Klasör"), QStringLiteral("URL / Konum")});
  tree->header()->setSectionResizeMode(0, QHeaderView::Stretch);
  tree->header()->setSectionResizeMode(1, QHeaderView::Stretch);
  tree->setMinimumHeight(280);

  auto *addFolderBtn = new QPushButton(QStringLiteral("Yeni Klasör..."), card);
  auto *addBmBtn = new QPushButton(QStringLiteral("Yeni Yer İmi..."), card);
  auto *moveToFolderBtn = new QPushButton(QStringLiteral("Klasöre Taşı..."), card);
  auto *remove = new QPushButton(QStringLiteral("Seçiliyi Sil"), card);
  remove->setProperty("danger", true);
  auto *importBtn = new QPushButton(QStringLiteral("HTML İçe Aktar..."), card);
  auto *exportBtn = new QPushButton(QStringLiteral("HTML Dışa Aktar..."), card);

  auto *btnLayout = new QHBoxLayout;
  btnLayout->setContentsMargins(0, 0, 0, 0);
  btnLayout->setSpacing(8);
  btnLayout->addWidget(addFolderBtn);
  btnLayout->addWidget(addBmBtn);
  btnLayout->addWidget(moveToFolderBtn);
  btnLayout->addWidget(remove);
  btnLayout->addWidget(importBtn);
  btnLayout->addWidget(exportBtn);
  btnLayout->addStretch();

  auto *container = new QWidget(card);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(18, 10, 18, 14);
  layout->setSpacing(10);
  layout->addWidget(tree);
  layout->addLayout(btnLayout);
  addRow(card, container);
  section.layout->addWidget(card);
  section.layout->addStretch();

  const auto refresh = [this, tree] {
    tree->clear();
    if (!profileService_) return;

    const QStringList folders = profileService_->bookmarkFolders();
    const auto items = profileService_->bookmarkItems();

    QHash<QString, QTreeWidgetItem *> folderTreeItems;
    for (const QString &folderName : folders) {
      auto *folderItem = new QTreeWidgetItem(tree);
      folderItem->setText(0, folderName);
      folderItem->setText(1, QStringLiteral("(Klasör)"));
      folderItem->setIcon(0, BrowserIcons::icon(BrowserIcon::Folder));
      folderItem->setData(0, Qt::UserRole, folderName);
      folderItem->setData(0, Qt::UserRole + 2, true); // isFolder = true
      folderTreeItems.insert(folderName, folderItem);
    }

    for (const auto &item : items) {
      QTreeWidgetItem *parent = item.folder.isEmpty() ? nullptr : folderTreeItems.value(item.folder, nullptr);
      auto *bmItem = parent ? new QTreeWidgetItem(parent) : new QTreeWidgetItem(tree);
      const QString title = item.title.isEmpty() ? item.url.host() : item.title;
      bmItem->setText(0, title);
      bmItem->setText(1, item.url.toDisplayString());
      bmItem->setIcon(0, BrowserIcons::icon(BrowserIcon::Bookmark));
      bmItem->setData(0, Qt::UserRole, item.url);
      bmItem->setData(0, Qt::UserRole + 1, item.folder);
      bmItem->setData(0, Qt::UserRole + 2, false); // isFolder = false
      bmItem->setToolTip(0, item.url.toDisplayString());
      bmItem->setToolTip(1, item.url.toDisplayString());
    }

    tree->expandAll();
  };
  refreshBookmarks_ = refresh;
  refresh();

  connect(tree, &QTreeWidget::itemActivated, this, [this](QTreeWidgetItem *item) {
    if (!item) return;
    const bool isFolder = item->data(0, Qt::UserRole + 2).toBool();
    if (isFolder) {
      item->setExpanded(!item->isExpanded());
    } else {
      const QUrl url = item->data(0, Qt::UserRole).toUrl();
      if (url.isValid()) emit navigateRequested(url);
    }
  });

  connect(addFolderBtn, &QPushButton::clicked, this, [this, refresh] {
    bool ok = false;
    const QString name = QInputDialog::getText(this, QStringLiteral("Yeni Klasör"), QStringLiteral("Klasör Adı:"), QLineEdit::Normal, QString(), &ok);
    if (ok && !name.trimmed().isEmpty() && profileService_) {
      profileService_->createBookmarkFolder(name.trimmed());
      refresh();
      if (hooks_.refreshBookmarks) hooks_.refreshBookmarks();
    }
  });

  connect(addBmBtn, &QPushButton::clicked, this, [this, refresh] {
    if (!profileService_) return;
    bool ok = false;
    const QString urlStr = QInputDialog::getText(this, QStringLiteral("Yer İmi Ekle"), QStringLiteral("URL:"), QLineEdit::Normal, QStringLiteral("https://"), &ok);
    if (!ok || urlStr.trimmed().isEmpty()) return;
    const QUrl url = QUrl::fromUserInput(urlStr.trimmed());
    if (!url.isValid()) return;

    QStringList folders = {QStringLiteral("(Kök Dizin)")};
    folders.append(profileService_->bookmarkFolders());
    const QString chosen = QInputDialog::getItem(this, QStringLiteral("Klasör Seçin"), QStringLiteral("Hedef Klasör:"), folders, 0, false, &ok);
    const QString folder = (ok && chosen != QStringLiteral("(Kök Dizin)")) ? chosen : QString();

    profileService_->addBookmark(url, url.host(), folder);
    refresh();
    if (hooks_.refreshBookmarks) hooks_.refreshBookmarks();
  });

  connect(moveToFolderBtn, &QPushButton::clicked, this, [this, tree, refresh] {
    auto *item = tree->currentItem();
    if (!item || !profileService_) return;
    const bool isFolder = item->data(0, Qt::UserRole + 2).toBool();
    if (isFolder) return;
    const QUrl url = item->data(0, Qt::UserRole).toUrl();
    if (!url.isValid()) return;

    QStringList folders = {QStringLiteral("(Kök Dizin)")};
    folders.append(profileService_->bookmarkFolders());
    bool ok = false;
    const QString chosen = QInputDialog::getItem(this, QStringLiteral("Klasöre Taşı"), QStringLiteral("Hedef Klasör:"), folders, 0, false, &ok);
    if (ok) {
      const QString folder = (chosen == QStringLiteral("(Kök Dizin)")) ? QString() : chosen;
      profileService_->moveBookmarkToFolder(url, folder);
      refresh();
      if (hooks_.refreshBookmarks) hooks_.refreshBookmarks();
    }
  });

  connect(remove, &QPushButton::clicked, this, [this, tree, refresh] {
    auto *item = tree->currentItem();
    if (!item || !profileService_) return;
    const bool isFolder = item->data(0, Qt::UserRole + 2).toBool();
    if (isFolder) {
      const QString folderName = item->data(0, Qt::UserRole).toString();
      profileService_->removeBookmarkFolder(folderName, true);
    } else {
      const QUrl url = item->data(0, Qt::UserRole).toUrl();
      if (url.isValid()) profileService_->removeBookmark(url);
    }
    refresh();
    if (hooks_.refreshBookmarks) hooks_.refreshBookmarks();
  });

  connect(importBtn, &QPushButton::clicked, this, [this, refresh] {
    const QString filePath = QFileDialog::getOpenFileName(this, QStringLiteral("Yer İşaretlerini İçe Aktar"), QDir::homePath(), QStringLiteral("HTML Dosyaları (*.html *.htm)"));
    if (filePath.isEmpty() || !profileService_) return;
    QFile file(filePath);
    if (file.open(QIODevice::ReadOnly | QIODevice::Text)) {
      profileService_->importBookmarksFromHtml(QString::fromUtf8(file.readAll()));
      refresh();
      if (hooks_.refreshBookmarks) hooks_.refreshBookmarks();
    }
  });

  connect(exportBtn, &QPushButton::clicked, this, [this] {
    if (!profileService_) return;
    const QString filePath = QFileDialog::getSaveFileName(this, QStringLiteral("Yer İşaretlerini Dışa Aktar"), QDir::homePath() + QStringLiteral("/bookmarks.html"), QStringLiteral("HTML Dosyaları (*.html *.htm)"));
    if (filePath.isEmpty()) return;
    QFile file(filePath);
    if (file.open(QIODevice::WriteOnly | QIODevice::Text)) {
      file.write(profileService_->exportBookmarksToHtml().toUtf8());
    }
  });

  return section.page;
}

QWidget *SettingsPage::createHistorySection() {
  Section section = makeSection(QStringLiteral("Geçmiş"), QStringLiteral("Son ziyaret edilen sayfaları açın, arayın veya tarama geçmişini temizleyin."));
  auto *card = makeCard(section.page, QStringLiteral("SON ZİYARETLER"));

  auto *searchEdit = new QLineEdit(card);
  searchEdit->setObjectName(QStringLiteral("history-search-input"));
  searchEdit->setPlaceholderText(QStringLiteral("Geçmişte ara..."));
  searchEdit->setClearButtonEnabled(true);

  auto *list = new QListWidget(card);
  list->setObjectName(QStringLiteral("history-list-widget"));
  list->setAccessibleName(QStringLiteral("Tarama geçmişi"));
  list->setMinimumHeight(280);
  list->setContextMenuPolicy(Qt::CustomContextMenu);

  auto *removeSelected = new QPushButton(QStringLiteral("Seçili kaydı sil"), card);
  removeSelected->setObjectName(QStringLiteral("history-delete-selected-button"));
  removeSelected->setProperty("danger", true);
  auto *clear = new QPushButton(QStringLiteral("Geçmişi temizle"), card);
  clear->setObjectName(QStringLiteral("history-clear-all-button"));
  clear->setProperty("danger", true);

  auto *btnLayout = new QHBoxLayout;
  btnLayout->setContentsMargins(0, 0, 0, 0);
  btnLayout->setSpacing(8);
  btnLayout->addWidget(removeSelected);
  btnLayout->addWidget(clear);
  btnLayout->addStretch();

  auto *container = new QWidget(card);
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(18, 10, 18, 14);
  layout->setSpacing(10);
  layout->addWidget(searchEdit);
  layout->addWidget(list);
  layout->addLayout(btnLayout);
  addRow(card, container);
  section.layout->addWidget(card);
  section.layout->addStretch();

  const auto refresh = [this, list, searchEdit] {
    list->clear();
    if (!profileService_) return;
    const QString q = searchEdit->text().trimmed();
    const auto entries = q.isEmpty() ? profileService_->recentHistory() : profileService_->searchHistory(q);
    for (const BrowserHistoryEntry &entry : entries) {
      const QString title = entry.title.isEmpty() ? entry.url.host() : entry.title;
      const QString timeStr = entry.visitedAt.isValid()
          ? entry.visitedAt.toLocalTime().toString(QStringLiteral("dd.MM.yyyy HH:mm"))
          : QStringLiteral("-");
      auto *item = new QListWidgetItem(BrowserIcons::icon(BrowserIcon::History),
          QStringLiteral("%1\n%2  ·  %3").arg(title, entry.url.toDisplayString(), timeStr), list);
      item->setData(Qt::UserRole, entry.url);
      item->setData(Qt::UserRole + 1, entry.visitedAt);
      item->setToolTip(entry.url.toDisplayString());
      item->setSizeHint(QSize(0, 56));
    }
    if (!list->count()) {
      auto *item = new QListWidgetItem(q.isEmpty() ? QStringLiteral("Geçmiş henüz boş") : QStringLiteral("Aramayla eşleşen geçmiş bulunamadı"), list);
      item->setFlags(Qt::NoItemFlags);
    }
  };
  refreshHistory_ = refresh;
  refresh();

  connect(searchEdit, &QLineEdit::textChanged, this, [refresh] { refresh(); });
  connect(list, &QListWidget::itemActivated, this, [this](QListWidgetItem *item) {
    if (!item) return;
    const QUrl url = item->data(Qt::UserRole).toUrl();
    if (url.isValid()) emit navigateRequested(url);
  });

  const auto deleteCurrentItem = [this, list, refresh] {
    auto *item = list->currentItem();
    if (!item || !profileService_) return;
    const QUrl url = item->data(Qt::UserRole).toUrl();
    const QDateTime dt = item->data(Qt::UserRole + 1).toDateTime();
    if (url.isValid()) {
      profileService_->removeHistoryEntry(url, dt);
      refresh();
      if (hooks_.syncNewTabs) hooks_.syncNewTabs();
    }
  };

  connect(removeSelected, &QPushButton::clicked, this, deleteCurrentItem);
  connect(clear, &QPushButton::clicked, this, [this, refresh] {
    if (!profileService_) return;
    profileService_->clearHistory();
    refresh();
    if (hooks_.syncNewTabs) hooks_.syncNewTabs();
  });

  connect(list, &QListWidget::customContextMenuRequested, this, [this, list, deleteCurrentItem](const QPoint &pos) {
    auto *item = list->itemAt(pos);
    if (!item) return;
    const QUrl url = item->data(Qt::UserRole).toUrl();
    if (!url.isValid()) return;

    QMenu menu(this);
    menu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:6px;padding:4px;} QMenu::item{padding:4px 20px;} QMenu::item:selected{background:#2a3644;}"));
    QAction *openAct = menu.addAction(QStringLiteral("Aç"));
    QAction *copyAct = menu.addAction(QStringLiteral("Bağlantı Adresini Kopyala"));
    menu.addSeparator();
    QAction *deleteAct = menu.addAction(BrowserIcons::icon(BrowserIcon::Close), QStringLiteral("Geçmişten Kaldır"));

    QAction *chosen = menu.exec(list->mapToGlobal(pos));
    if (chosen == openAct) {
      emit navigateRequested(url);
    } else if (chosen == copyAct) {
      QGuiApplication::clipboard()->setText(url.toDisplayString());
    } else if (chosen == deleteAct) {
      list->setCurrentItem(item);
      deleteCurrentItem();
    }
  });

  return section.page;
}

QWidget *SettingsPage::createAccessibilitySection() {
  Section section = makeSection(QStringLiteral("Erişilebilirlik"), QStringLiteral("Klavye, odak ve okunabilirlik seçenekleri için ayrılmış alan."));
  section.layout->addWidget(placeholderPanel(section.page, BrowserIcon::Accessibility, QStringLiteral("Erişilebilirlik seçenekleri hazırlanıyor"), QStringLiteral("Ayrı bir accessibility backend’i henüz bulunmuyor. Settings arayüzü klavye odağı, accessible names ve yüksek kontrastlı focus durumları kullanır.")));
  section.layout->addStretch(); return section.page;
}

QWidget *SettingsPage::createSystemSection() {
  Section section = makeSection(QStringLiteral("Sistem"), QStringLiteral("Tarayıcı motoru ve profil çalışma bilgileri."));
  auto *card = makeCard(section.page, QStringLiteral("ÇALIŞMA ORTAMI"));
  addRow(card, settingRow(card, QStringLiteral("Chromium profili"), QStringLiteral("Kalıcı çerezler, disk önbelleği ve site izinleri DaliNiraBrowser profilinde saklanır."), nullptr, BrowserIcon::Settings, true));
  addRow(card, settingRow(card, QStringLiteral("Güvenlik politikası"), QStringLiteral("HTTP/HTTPS navigation ve DALI capability kontrolleri etkindir."), nullptr));
  section.layout->addWidget(card); section.layout->addStretch(); return section.page;
}

QWidget *SettingsPage::createResetSection() {
  Section section = makeSection(QStringLiteral("Ayarları sıfırla"), QStringLiteral("Yalnız desteklenen görünüm ve performans tercihlerini anlaşılır kapsamda sıfırlayın."));
  auto *card = makeCard(section.page, QStringLiteral("YENİ SEKME"));
  auto *reset = new QPushButton(QStringLiteral("Yeni sekme ayarlarını sıfırla"), card); reset->setProperty("danger", true);
  addRow(card, settingRow(card, QStringLiteral("Yeni sekme görünümünü sıfırla"), QStringLiteral("Panel ve ikon saydamlığını varsayılan değerlere getirir; gizlenen sık ziyaret edilen siteleri geri yükler."), reset, BrowserIcon::Reset, true));
  section.layout->addWidget(card);

  auto *perfCard = makeCard(section.page, QStringLiteral("PERFORMANS"));
  auto *resetPerf = new QPushButton(QStringLiteral("Performans ayarlarını sıfırla"), perfCard);
  resetPerf->setProperty("danger", true);
  addRow(perfCard, settingRow(
      perfCard,
      QStringLiteral("Performans tercihlerini sıfırla"),
      QStringLiteral("Performans modunu Dengeli'ye getirir, bellek tasarrufunu etkinleştirir ve site istisnalarını temizler."),
      resetPerf,
      BrowserIcon::Performance,
      true));
  section.layout->addWidget(perfCard);
  section.layout->addStretch();

  connect(reset, &QPushButton::clicked, this, &SettingsPage::appearanceResetRequested);
  connect(resetPerf, &QPushButton::clicked, this, [this] {
    auto *pm = hooks_.performanceManager ? hooks_.performanceManager() : nullptr;
    if (pm) {
      pm->setPolicyMode(dalinira::PerformancePolicyMode::Balanced);
      pm->setDiscardEnabled(true);
      pm->setSiteAllowlist({});
    } else {
      QSettings s;
      s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("balanced"));
      s.setValue(QStringLiteral("performance/discardEnabled"), true);
      s.remove(QStringLiteral("performance/siteAllowlist"));
    }
    refreshPreferences();
  });
  return section.page;
}

QWidget *SettingsPage::createListeningSection() {
  Section section = makeSection(QStringLiteral("DaliNira Pulse Ayarları"), QStringLiteral("Shazam tabanlı müzik bulucu, ses yakalama ve hedef platform arama tercihleri."));

  auto *settings = new SongFinderSettings(section.page);

  // Card 1: Platform & Hassasiyet
  auto *card1 = makeCard(section.page, QStringLiteral("HEDEF PLATFORM VE HASSASİYET"));

  auto *platformCombo = new QComboBox(card1);
  platformCombo->setObjectName(QStringLiteral("settings-listen-platform"));
  platformCombo->addItem(QStringLiteral("YouTube"), QStringLiteral("youtube"));
  platformCombo->addItem(QStringLiteral("YouTube Music"), QStringLiteral("ytmusic"));
  platformCombo->setCurrentIndex(settings->openPlatform() == SongFinderSettings::OpenPlatform::YouTubeMusic ? 1 : 0);
  connect(platformCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [settings](int idx) {
    settings->setOpenPlatform(idx == 1 ? SongFinderSettings::OpenPlatform::YouTubeMusic : SongFinderSettings::OpenPlatform::YouTube);
    settings->save();
  });
  addRow(card1, settingRow(card1, QStringLiteral("Bulunan şarkıyı aç"), QStringLiteral("Şarkı bulunduğunda aramanın yapılacağı hedef platform."), platformCombo));

  auto *sensitivityCombo = new QComboBox(card1);
  sensitivityCombo->setObjectName(QStringLiteral("settings-listen-sensitivity"));
  sensitivityCombo->addItem(QStringLiteral("Normal Dinleme"), QStringLiteral("normal"));
  sensitivityCombo->addItem(QStringLiteral("Fon müzik odaklı"), QStringLiteral("background"));
  sensitivityCombo->addItem(QStringLiteral("Maksimum doğruluk"), QStringLiteral("max"));
  sensitivityCombo->addItem(QStringLiteral("Özel"), QStringLiteral("custom"));
  int sIdx = 1;
  switch (settings->sensitivityMode()) {
    case SongFinderSettings::SensitivityMode::Normal: sIdx = 0; break;
    case SongFinderSettings::SensitivityMode::Background: sIdx = 1; break;
    case SongFinderSettings::SensitivityMode::MaxAccuracy: sIdx = 2; break;
    case SongFinderSettings::SensitivityMode::Custom: sIdx = 3; break;
  }
  sensitivityCombo->setCurrentIndex(sIdx);

  auto *intervalSpin = new QSpinBox(card1);
  intervalSpin->setObjectName(QStringLiteral("settings-listen-interval"));
  intervalSpin->setRange(1, 120);
  intervalSpin->setSuffix(QStringLiteral(" sn"));
  intervalSpin->setValue(settings->requestIntervalSecs());

  auto *bufferSpin = new QSpinBox(card1);
  bufferSpin->setObjectName(QStringLiteral("settings-listen-buffer"));
  bufferSpin->setRange(4, 30);
  bufferSpin->setSuffix(QStringLiteral(" sn"));
  bufferSpin->setValue(settings->bufferSizeSecs());

  connect(sensitivityCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [settings, intervalSpin, bufferSpin](int idx) {
    SongFinderSettings::SensitivityMode mode = SongFinderSettings::SensitivityMode::Custom;
    if (idx == 0) { mode = SongFinderSettings::SensitivityMode::Normal; intervalSpin->setValue(8); bufferSpin->setValue(10); }
    else if (idx == 1) { mode = SongFinderSettings::SensitivityMode::Background; intervalSpin->setValue(6); bufferSpin->setValue(12); }
    else if (idx == 2) { mode = SongFinderSettings::SensitivityMode::MaxAccuracy; intervalSpin->setValue(6); bufferSpin->setValue(16); }
    settings->setSensitivityMode(mode);
    settings->save();
  });

  connect(intervalSpin, QOverload<int>::of(&QSpinBox::valueChanged), this, [settings](int val) {
    settings->setRequestIntervalSecs(val);
    settings->save();
  });

  connect(bufferSpin, QOverload<int>::of(&QSpinBox::valueChanged), this, [settings](int val) {
    settings->setBufferSizeSecs(val);
    settings->save();
  });

  addRow(card1, settingRow(card1, QStringLiteral("Tanıma hassasiyeti"), QStringLiteral("Hız, örnek süresi ve eşleşme aralığı için hazır profili seçer."), sensitivityCombo));
  addRow(card1, settingRow(card1, QStringLiteral("Shazam istek aralığı"), QStringLiteral("Tanıma istekleri arasında beklenecek süre (saniye)."), intervalSpin));
  addRow(card1, settingRow(card1, QStringLiteral("Shazam arabellek boyutu"), QStringLiteral("Tanıma için hafızada tutulacak canlı ses süresi (saniye)."), bufferSpin));
  section.layout->addWidget(card1);

  // Card 2: Davranışlar
  auto *card2 = makeCard(section.page, QStringLiteral("DAVRANIŞLAR VE ENTEGRASYON"));

  auto *noDuplicatesCheck = new QCheckBox(card2);
  noDuplicatesCheck->setObjectName(QStringLiteral("settings-listen-noduplicates"));
  noDuplicatesCheck->setChecked(settings->noDuplicates());
  connect(noDuplicatesCheck, &QCheckBox::toggled, this, [settings](bool checked) {
    settings->setNoDuplicates(checked);
    settings->save();
  });
  addRow(card2, settingRow(card2, QStringLiteral("Aynı şarkıyı tekrar listeleme"), QStringLiteral("Kısa aralıklarla aynı parçanın tekrar listeye eklenmesini engeller."), noDuplicatesCheck));

  auto *webFallbackCheck = new QCheckBox(card2);
  webFallbackCheck->setObjectName(QStringLiteral("settings-listen-webfallback"));
  webFallbackCheck->setChecked(settings->webMetadataFallback());
  connect(webFallbackCheck, &QCheckBox::toggled, this, [settings](bool checked) {
    settings->setWebMetadataFallback(checked);
    settings->save();
  });
  addRow(card2, settingRow(card2, QStringLiteral("Web sekmesi fallback desteği"), QStringLiteral("Shazam parça bulamadığında aktif web sekmesindeki medya başlığını kullanır."), webFallbackCheck));

  auto *autoStopCheck = new QCheckBox(card2);
  autoStopCheck->setObjectName(QStringLiteral("settings-listen-autostop"));
  autoStopCheck->setChecked(settings->autoStopOnResult());
  connect(autoStopCheck, &QCheckBox::toggled, this, [settings](bool checked) {
    settings->setAutoStopOnResult(checked);
    settings->save();
  });
  addRow(card2, settingRow(card2, QStringLiteral("Şarkı bulununca dinlemeyi durdur"), QStringLiteral("Başarılı bir eşleşme sağlandığında dinleme sürecini otomatik sonlandırır."), autoStopCheck));

  auto *autoOpenCheck = new QCheckBox(card2);
  autoOpenCheck->setObjectName(QStringLiteral("settings-listen-autoopen"));
  autoOpenCheck->setChecked(settings->autoOpenOnResult());
  connect(autoOpenCheck, &QCheckBox::toggled, this, [settings](bool checked) {
    settings->setAutoOpenOnResult(checked);
    settings->save();
  });
  addRow(card2, settingRow(card2, QStringLiteral("Şarkı bulununca otomatik ara"), QStringLiteral("Şarkı tespit edildiğinde doğrudan yeni sekmede arama platformunu açar."), autoOpenCheck));

  auto *rememberDeviceCheck = new QCheckBox(card2);
  rememberDeviceCheck->setObjectName(QStringLiteral("settings-listen-rememberdevice"));
  rememberDeviceCheck->setChecked(settings->rememberAudioDevice());
  connect(rememberDeviceCheck, &QCheckBox::toggled, this, [settings](bool checked) {
    settings->setRememberAudioDevice(checked);
    settings->save();
  });
  addRow(card2, settingRow(card2, QStringLiteral("Seçili ses kaynağını hatırla"), QStringLiteral("Seçilen ses giriş cihazını bir sonraki oturum için kaydeder."), rememberDeviceCheck));

  auto *autoPruneCheck = new QCheckBox(card2);
  autoPruneCheck->setObjectName(QStringLiteral("settings-listen-autoprune"));
  autoPruneCheck->setChecked(settings->autoPruneHistory());
  connect(autoPruneCheck, &QCheckBox::toggled, this, [settings](bool checked) {
    settings->setAutoPruneHistory(checked);
    settings->save();
  });
  addRow(card2, settingRow(card2, QStringLiteral("Geçmişi 10 sonuç ile sınırla"), QStringLiteral("10 sonuçtan sonra en eski şarkıları listeden otomatik temizler (kapatılırsa liste sınırsız uzar)."), autoPruneCheck));

  section.layout->addWidget(card2);
  section.layout->addStretch();
  return section.page;
}

QWidget *SettingsPage::createAboutSection() {
  Section section = makeSection(QStringLiteral("DaliNiraBrowser hakkında"), QStringLiteral("Sürüm, geliştirici ve çalışma ortamı bilgileri."));
  auto *card = makeCard(section.page);
  auto *about = new QWidget(card);
  auto *layout = new QHBoxLayout(about);
  layout->setContentsMargins(24, 22, 24, 22);
  layout->setSpacing(20);

  auto *logo = new QLabel(about);
  logo->setPixmap(qApp->windowIcon().pixmap(72, 72));
  logo->setFixedSize(76, 76);
  logo->setAccessibleName(QStringLiteral("DaliNiraBrowser logosu"));

  QString engine = QStringLiteral("Qt WebEngine (Chromium tabanlı)");
  if (profileService_ && profileService_->profile()) {
    const QRegularExpressionMatch match = QRegularExpression(QStringLiteral("Chrome/([0-9.]+)")).match(profileService_->profile()->httpUserAgent());
    if (match.hasMatch()) engine = QStringLiteral("Chromium %1").arg(match.captured(1));
  }

  auto *details = new QLabel(
      QStringLiteral("<h2>DaliNiraBrowser</h2>"
                     "<p style='line-height: 1.6; font-size: 13px;'>"
                     "<b>Sürüm:</b> %1<br>"
                     "<b>Tarayıcı motoru:</b> %2<br>"
                     "<b>Qt sürümü:</b> %3<br>"
                     "<b>Geliştirici:</b> Muhammed Dali<br>"
                     "<b>GitHub:</b> <a style='color: #58a6ff; text-decoration: none; font-weight: 600;' href='https://github.com/Muhammed-Dali'>github.com/Muhammed-Dali</a><br>"
                     "<b>Proje Kaynak Kodu:</b> <a style='color: #58a6ff; text-decoration: none; font-weight: 600;' href='https://github.com/Muhammed-Dali/DaliNira-Browser'>github.com/Muhammed-Dali/DaliNira-Browser</a>"
                     "</p>")
          .arg(QStringLiteral(DALINIRA_BROWSER_VERSION), engine, QString::fromLatin1(qVersion())),
      about);
  details->setObjectName(QStringLiteral("settings-heading"));
  details->setWordWrap(true);
  details->setTextInteractionFlags(Qt::TextBrowserInteraction);
  details->setOpenExternalLinks(true);

  layout->addWidget(logo, 0, Qt::AlignTop);
  layout->addWidget(details, 1);
  addRow(card, about);
  section.layout->addWidget(card);

  // GitHub Hızlı Bağlantılar Kartı
  auto *linksCard = makeCard(section.page, QStringLiteral("GELİŞTİRİCİ & AÇIK KAYNAK"));
  auto *btnContainer = new QWidget(linksCard);
  auto *btnLayout = new QHBoxLayout(btnContainer);
  btnLayout->setContentsMargins(18, 12, 18, 14);
  btnLayout->setSpacing(12);

  auto *profileBtn = new QPushButton(QStringLiteral("  Muhammed Dali (GitHub Profili)"), linksCard);
  profileBtn->setIcon(BrowserIcons::icon(BrowserIcon::Privacy));
  profileBtn->setCursor(Qt::PointingHandCursor);
  profileBtn->setStyleSheet(QStringLiteral(
      "QPushButton {"
      "  background-color: #21262d;"
      "  color: #c9d1d9;"
      "  border: 1px solid #30363d;"
      "  border-radius: 8px;"
      "  padding: 8px 16px;"
      "  font-weight: 600;"
      "  font-size: 13px;"
      "}"
      "QPushButton:hover {"
      "  background-color: #30363d;"
      "  color: #ffffff;"
      "  border-color: #8b949e;"
      "}"));
  connect(profileBtn, &QPushButton::clicked, this, [] {
    QDesktopServices::openUrl(QUrl(QStringLiteral("https://github.com/Muhammed-Dali")));
  });

  auto *repoBtn = new QPushButton(QStringLiteral("  DaliNira-Browser GitHub Deposu"), linksCard);
  repoBtn->setIcon(BrowserIcons::icon(BrowserIcon::Save));
  repoBtn->setCursor(Qt::PointingHandCursor);
  repoBtn->setStyleSheet(QStringLiteral(
      "QPushButton {"
      "  background-color: #1f6feb;"
      "  color: #ffffff;"
      "  border: 1px solid #388bfd;"
      "  border-radius: 8px;"
      "  padding: 8px 16px;"
      "  font-weight: 600;"
      "  font-size: 13px;"
      "}"
      "QPushButton:hover {"
      "  background-color: #388bfd;"
      "}"));
  connect(repoBtn, &QPushButton::clicked, this, [] {
    QDesktopServices::openUrl(QUrl(QStringLiteral("https://github.com/Muhammed-Dali/DaliNira-Browser")));
  });

  btnLayout->addWidget(profileBtn);
  btnLayout->addWidget(repoBtn);
  btnLayout->addStretch();
  addRow(linksCard, btnContainer);

  section.layout->addWidget(linksCard);
  section.layout->addStretch();
  return section.page;
}

void SettingsPage::applyFilter(const QString &query) {
  const QString term = query.trimmed().toCaseFolded();
  int firstMatchRow = -1;
  for (int contentIndex = 0; contentIndex < content_->count(); ++contentIndex) {
    QString searchable = searchKeywords_.value(contentIndex);
    QWidget *page = content_->widget(contentIndex);
    for (const QLabel *label : page->findChildren<QLabel *>()) searchable += QLatin1Char(' ') + label->text();
    for (const QAbstractButton *button : page->findChildren<QAbstractButton *>()) searchable += QLatin1Char(' ') + button->text();
    for (const QComboBox *box : page->findChildren<QComboBox *>()) for (int option = 0; option < box->count(); ++option) searchable += QLatin1Char(' ') + box->itemText(option);
    for (const QLineEdit *edit : page->findChildren<QLineEdit *>()) searchable += QLatin1Char(' ') + edit->placeholderText() + QLatin1Char(' ') + edit->text();
    const int sidebarRow = contentSidebarRows_.value(contentIndex, -1);
    const bool match = term.isEmpty() || searchable.toCaseFolded().contains(term);
    if (sidebarRow >= 0) sidebar_->item(sidebarRow)->setHidden(!match);
    if (match && firstMatchRow < 0) firstMatchRow = sidebarRow;
  }
  if (!term.isEmpty() && firstMatchRow >= 0) sidebar_->setCurrentRow(firstMatchRow);
}
