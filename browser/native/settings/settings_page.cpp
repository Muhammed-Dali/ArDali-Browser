#include "settings_page.h"

#include "browser_profile_service.h"
#include "ardali_blocker_service.h"
#include "song_finder_settings.h"

#include <QAbstractButton>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QFileDialog>
#include <QFrame>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPointer>
#include <QPushButton>
#include <QRegularExpression>
#include <QScrollArea>
#include <QSettings>
#include <QSignalBlocker>
#include <QSlider>
#include <QSpinBox>
#include <QStackedWidget>
#include <QStandardPaths>
#include <QVBoxLayout>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif
#include <QWebEngineProfile>

#include <algorithm>

namespace {
constexpr int kContentMaxWidth = 920;

struct Section {
  QWidget *page = nullptr;
  QVBoxLayout *layout = nullptr;
};

Section makeSection(const QString &title, const QString &description) {
  auto *page = new QWidget;
  page->setObjectName(QStringLiteral("settings-section"));
  auto *outer = new QHBoxLayout(page);
  outer->setContentsMargins(22, 20, 22, 32);
  outer->addStretch(1);
  auto *column = new QWidget(page);
  column->setMaximumWidth(kContentMaxWidth);
  column->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
  auto *layout = new QVBoxLayout(column);
  layout->setContentsMargins(0, 0, 0, 0);
  layout->setSpacing(18);
  auto *heading = new QLabel(QStringLiteral("<h2>%1</h2><p>%2</p>").arg(title, description), column);
  heading->setWordWrap(true);
  heading->setObjectName(QStringLiteral("settings-heading"));
  layout->addWidget(heading);
  outer->addWidget(column, 2);
  outer->addStretch(1);
  return {page, layout};
}

QFrame *makeCard(QWidget *parent, const QString &title = {}) {
  auto *card = new QFrame(parent);
  card->setObjectName(QStringLiteral("settings-card"));
  auto *layout = new QVBoxLayout(card);
  layout->setContentsMargins(0, 0, 0, 0);
  layout->setSpacing(0);
  if (!title.isEmpty()) {
    auto *label = new QLabel(title, card);
    label->setObjectName(QStringLiteral("settings-card-title"));
    layout->addWidget(label);
  }
  return card;
}

QVBoxLayout *cardLayout(QFrame *card) { return qobject_cast<QVBoxLayout *>(card->layout()); }

QWidget *settingRow(QWidget *parent, const QString &title, const QString &description,
                    QWidget *control, BrowserIcon icon = BrowserIcon::Info, bool showIcon = false) {
  auto *row = new QWidget(parent);
  row->setObjectName(QStringLiteral("settings-row"));
  auto *layout = new QHBoxLayout(row);
  layout->setContentsMargins(18, 14, 18, 14);
  layout->setSpacing(14);
  if (showIcon) {
    auto *iconLabel = new QLabel(row);
    iconLabel->setPixmap(BrowserIcons::icon(icon).pixmap(18, 18));
    iconLabel->setFixedSize(20, 20);
    iconLabel->setAccessibleName(title);
    layout->addWidget(iconLabel, 0, Qt::AlignTop);
  }
  auto *text = new QWidget(row);
  auto *textLayout = new QVBoxLayout(text);
  textLayout->setContentsMargins(0, 0, 0, 0);
  textLayout->setSpacing(3);
  auto *titleLabel = new QLabel(title, text);
  titleLabel->setObjectName(QStringLiteral("settings-row-title"));
  titleLabel->setWordWrap(true);
  textLayout->addWidget(titleLabel);
  if (!description.isEmpty()) {
    auto *descriptionLabel = new QLabel(description, text);
    descriptionLabel->setObjectName(QStringLiteral("settings-row-description"));
    descriptionLabel->setWordWrap(true);
    textLayout->addWidget(descriptionLabel);
  }
  layout->addWidget(text, 1);
  if (control) {
    control->setParent(row);
    layout->addWidget(control, 0, Qt::AlignVCenter);
  }
  return row;
}

void addRow(QFrame *card, QWidget *row) {
  QVBoxLayout *layout = cardLayout(card);
  if (layout->count() > 0) {
    auto *separator = new QFrame(card);
    separator->setObjectName(QStringLiteral("settings-row-separator"));
    separator->setFrameShape(QFrame::HLine);
    layout->addWidget(separator);
  }
  layout->addWidget(row);
}

QWidget *sliderControl(QSlider **sliderOut, QLabel **valueOut, int value, QWidget *parent) {
  auto *container = new QWidget(parent);
  auto *layout = new QHBoxLayout(container);
  layout->setContentsMargins(0, 0, 0, 0);
  layout->setSpacing(10);
  auto *slider = new QSlider(Qt::Horizontal, container);
  slider->setRange(0, 100);
  slider->setValue(value);
  slider->setMinimumWidth(150);
  auto *label = new QLabel(QStringLiteral("%1%").arg(value), container);
  label->setObjectName(QStringLiteral("settings-value"));
  label->setMinimumWidth(42);
  label->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
  layout->addWidget(slider);
  layout->addWidget(label);
  *sliderOut = slider;
  *valueOut = label;
  return container;
}

QWidget *placeholderPanel(QWidget *parent, BrowserIcon icon, const QString &title, const QString &description) {
  auto *card = makeCard(parent);
  auto *content = settingRow(card, title, description, nullptr, icon, true);
  addRow(card, content);
  return card;
}

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
QString permissionText(QWebEnginePermission::PermissionType type) {
  switch (type) {
    case QWebEnginePermission::PermissionType::MediaAudioCapture: return QStringLiteral("Mikrofon");
    case QWebEnginePermission::PermissionType::MediaVideoCapture: return QStringLiteral("Kamera");
    case QWebEnginePermission::PermissionType::MediaAudioVideoCapture: return QStringLiteral("Kamera ve mikrofon");
    case QWebEnginePermission::PermissionType::DesktopVideoCapture: return QStringLiteral("Ekran paylaşımı");
    case QWebEnginePermission::PermissionType::DesktopAudioVideoCapture: return QStringLiteral("Ekran ve ses paylaşımı");
    case QWebEnginePermission::PermissionType::Notifications: return QStringLiteral("Bildirimler");
    case QWebEnginePermission::PermissionType::Geolocation: return QStringLiteral("Konum");
    case QWebEnginePermission::PermissionType::ClipboardReadWrite: return QStringLiteral("Pano erişimi");
    case QWebEnginePermission::PermissionType::LocalFontsAccess: return QStringLiteral("Yerel yazı tipleri");
    case QWebEnginePermission::PermissionType::MouseLock: return QStringLiteral("Fare kilidi");
    default: return QStringLiteral("Diğer izin");
  }
}

QString permissionState(const QWebEnginePermission &permission) {
  switch (permission.state()) {
    case QWebEnginePermission::State::Granted: return QStringLiteral("İzin verildi");
    case QWebEnginePermission::State::Denied: return QStringLiteral("Engellendi");
    default: return QStringLiteral("Sorulacak");
  }
}
#endif

QString settingsStyleSheet() {
  return QStringLiteral(R"CSS(
    #settings-page { background:#121820; color:#e8eef6; }
    #settings-header { background:#171e27; border-bottom:1px solid #2a3542; }
    #settings-title { color:#f3f7fc; font-size:24px; font-weight:650; }
    #settings-search { min-height:38px; background:#202a36; color:#eef5fc; border:1px solid #39495b; border-radius:19px; padding:0 14px; selection-background-color:#3c7697; }
    #settings-search:hover { border-color:#526579; }
    #settings-search:focus { background:#18222d; border:2px solid #58a6c7; padding:0 13px; }
    #settings-sidebar { background:#171e27; border:0; border-right:1px solid #2a3542; padding:10px 8px; color:#bdc9d7; outline:0; }
    #settings-sidebar::item { min-height:38px; padding:0 10px; margin:2px 0; border-radius:8px; }
    #settings-sidebar::item:hover { background:#222d39; color:#e7eef7; }
    #settings-sidebar::item:selected { background:#273948; color:#f3f8fd; border-left:3px solid #62a9c8; padding-left:7px; }
    #settings-sidebar::item:disabled { min-height:8px; max-height:8px; background:transparent; }
    #settings-section, QScrollArea, QScrollArea > QWidget > QWidget { background:#121820; border:0; }
    #settings-heading { color:#f2f6fb; }
    #settings-heading h2 { margin:0; font-size:22px; }
    #settings-heading p { margin-top:6px; color:#98a8b9; }
    #settings-card { background:#1a222c; border:1px solid #2e3b49; border-radius:12px; }
    #settings-card-title { color:#9fb0c2; font-size:12px; font-weight:650; padding:14px 18px 8px; }
    #settings-row { background:transparent; }
    #settings-row:hover { background:#1e2935; }
    #settings-row-title { color:#e7edf5; font-size:14px; font-weight:550; }
    #settings-row-description { color:#91a1b2; font-size:12px; }
    #settings-row-separator { color:#2a3542; background:#2a3542; border:0; max-height:1px; margin-left:18px; }
    #settings-value { color:#a9bacb; }
    #settings-page QPushButton { min-height:30px; background:#25384a; color:#edf5fc; border:1px solid #40576b; border-radius:7px; padding:2px 12px; }
    #settings-page QPushButton:hover { background:#2d475d; border-color:#54728a; }
    #settings-page QPushButton:focus { border:2px solid #62a9c8; padding:1px 11px; }
    #settings-page QPushButton[danger="true"] { background:#272f38; color:#d8e0e8; border-color:#4a5662; }
    #settings-page QPushButton[danger="true"]:hover { background:#343d47; }
    #settings-page QLineEdit, #settings-page QComboBox { min-height:32px; background:#111820; color:#e6edf5; border:1px solid #3a4958; border-radius:7px; padding:0 10px; }
    #settings-page QLineEdit:focus, #settings-page QComboBox:focus { border:2px solid #58a6c7; padding:0 9px; }
    #settings-page QComboBox QAbstractItemView { background:#202a34; color:#e6edf5; selection-background-color:#324b60; border:1px solid #46596b; }
    #settings-page QListWidget#settings-data-list { background:#151c24; color:#e1e8f0; border:1px solid #2e3b49; border-radius:9px; outline:0; padding:4px; }
    #settings-page QListWidget#settings-data-list::item { min-height:46px; padding:5px 8px; border-radius:6px; }
    #settings-page QListWidget#settings-data-list::item:hover { background:#202b36; }
    #settings-page QListWidget#settings-data-list::item:selected { background:#294052; color:#f4f8fc; }
    #settings-page QCheckBox { spacing:8px; }
    #settings-page QCheckBox::indicator { width:18px; height:18px; }
    #settings-page QSlider::groove:horizontal { height:4px; background:#344251; border-radius:2px; }
    #settings-page QSlider::sub-page:horizontal { background:#5da6c5; border-radius:2px; }
    #settings-page QSlider::handle:horizontal { width:16px; margin:-6px 0; background:#dbeaf4; border:2px solid #4c91b1; border-radius:8px; }
  )CSS");
}
}  // namespace

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
  search_ = new QLineEdit(header);
  search_->setObjectName(QStringLiteral("settings-search"));
  search_->setPlaceholderText(QStringLiteral("Ayarlarda ara"));
  search_->setClearButtonEnabled(true);
  search_->setAccessibleName(QStringLiteral("Ayarlarda ara"));
  search_->setMaximumWidth(460);
  search_->addAction(BrowserIcons::icon(BrowserIcon::Search), QLineEdit::LeadingPosition);
  headerLayout->addWidget(title);
  headerLayout->addStretch(1);
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
  addCategory(Category::Appearance, BrowserIcon::Appearance, QStringLiteral("Görünüm"), QStringLiteral("yeni sekme sık ziyaret panel ikon saydamlık"), createAppearanceSection());
  addCategory(Category::Content, BrowserIcon::Content, QStringLiteral("İçerik"), QStringLiteral("site ayarları JavaScript resim medya popup"), createContentSection());
  addCategory(Category::Privacy, BrowserIcon::Privacy, QStringLiteral("Gizlilik ve güvenlik"), QStringLiteral("çerez cache önbellek izleme izin URL"), createPrivacySection());
  addCategory(Category::Blocker, BrowserIcon::Privacy, QStringLiteral("ArDali Blocker"), QStringLiteral("ardali blocker reklam engelleyici filtreleme kalkan kurallar"), createBlockerSection());
  addCategory(Category::Search, BrowserIcon::Search, QStringLiteral("Arama motoru"), QStringLiteral("öneri Google DuckDuckGo Brave Bing"), createSearchSection());
  addSidebarSeparator();
  addCategory(Category::Passwords, BrowserIcon::Password, QStringLiteral("Şifreler ve otomatik doldurma"), QStringLiteral("password manager parola yakında"), createPasswordsSection());
  addCategory(Category::Bookmarks, BrowserIcon::Bookmark, QStringLiteral("Yer işaretleri"), QStringLiteral("yer imi kaydedilmiş sayfa"), createBookmarksSection());
  addCategory(Category::History, BrowserIcon::History, QStringLiteral("Geçmiş"), QStringLiteral("ziyaret tarih saat temizle"), createHistorySection());
  addCategory(Category::Downloads, BrowserIcon::Download, QStringLiteral("İndirilenler"), QStringLiteral("klasör konum dosya DALI"), createDownloadsSection());
  addCategory(Category::Languages, BrowserIcon::Language, QStringLiteral("Diller"), QStringLiteral("Türkçe İngilizce yazım denetimi spellcheck"), createLanguagesSection());
  addCategory(Category::Accessibility, BrowserIcon::Accessibility, QStringLiteral("Erişilebilirlik"), QStringLiteral("klavye odak kontrast"), createAccessibilitySection());
  addSidebarSeparator();
  addCategory(Category::System, BrowserIcon::Settings, QStringLiteral("Sistem"), QStringLiteral("Chromium profil runtime"), createSystemSection());
  addCategory(Category::Listening, BrowserIcon::Tools, QStringLiteral("Pulse"), QStringLiteral("ardali pulse şarkı bul shazam pulse dinle ses mikrofon müzik tanıma"), createListeningSection());
  addCategory(Category::Reset, BrowserIcon::Reset, QStringLiteral("Ayarları sıfırla"), QStringLiteral("varsayılan görünüm sık ziyaret"), createResetSection());
  addSidebarSeparator();
  addCategory(Category::About, BrowserIcon::Info, QStringLiteral("ArDaliBrowser hakkında"), QStringLiteral("sürüm version build Qt WebEngine Chromium"), createAboutSection());

  setStyleSheet(settingsStyleSheet());
  connect(sidebar_, &QListWidget::currentRowChanged, this, &SettingsPage::selectCategory);
  connect(search_, &QLineEdit::textChanged, this, &SettingsPage::applyFilter);
  setTabOrder(search_, sidebar_);
  setCategory(Category::Startup);
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
    engine->setCurrentText(settings.value(QStringLiteral("browser/searchEngine"), QStringLiteral("Google")).toString());
  }
  if (auto *suggestions = findChild<QCheckBox *>(QStringLiteral("settings-search-suggestions"))) {
    const QSignalBlocker blocker(suggestions);
    suggestions->setChecked(settings.value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool());
  }
}

void SettingsPage::selectCategory(int row) {
  if (row < 0 || row >= sidebar_->count()) return;
  const QVariant contentIndex = sidebar_->item(row)->data(Qt::UserRole);
  if (contentIndex.isValid()) content_->setCurrentIndex(contentIndex.toInt());
}

QWidget *SettingsPage::createStartupSection() {
  Section section = makeSection(QStringLiteral("Başlangıç"), QStringLiteral("ArDaliBrowser açıldığında kaldığınız yerden devam edip etmeyeceğinizi seçin."));
  auto *card = makeCard(section.page, QStringLiteral("BAŞLANGIÇ DAVRANIŞI"));
  auto *restore = new QCheckBox(card); restore->setAccessibleName(QStringLiteral("Başlangıçta son sekmeleri geri yükle"));
  restore->setChecked(QSettings().value(QStringLiteral("browser/restoreSession"), true).toBool());
  addRow(card, settingRow(card, QStringLiteral("Son sekmeleri geri yükle"), QStringLiteral("Tarayıcı açıldığında önceki oturumdaki web sekmelerini yeniden açar."), restore, BrowserIcon::Startup, true));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(restore, &QCheckBox::toggled, this, [](bool value) { QSettings().setValue(QStringLiteral("browser/restoreSession"), value); });
  return section.page;
}

QWidget *SettingsPage::createAppearanceSection() {
  Section section = makeSection(QStringLiteral("Görünüm"), QStringLiteral("Yeni sekme sayfasının görünümünü ve sık ziyaret edilenler alanını düzenleyin."));
  auto *card = makeCard(section.page, QStringLiteral("YENİ SEKME")); QSettings preferences;
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
  auto *reset = new QPushButton(QStringLiteral("Sıfırla"), card); reset->setProperty("danger", true); reset->setAccessibleName(QStringLiteral("Yeni sekme ayarlarını sıfırla"));
  addRow(card, settingRow(card, QStringLiteral("Yeni sekme görünümünü sıfırla"), QStringLiteral("Yalnız yeni sekme görünüm tercihlerini varsayılan değerlere döndürür."), reset));
  section.layout->addWidget(card); section.layout->addStretch();
  const auto save = [this, frequent, panel, icons] { QSettings settings; settings.setValue(QStringLiteral("browser/showFrequentSites"), frequent->isChecked()); settings.setValue(QStringLiteral("browser/frequentSitesPanelOpacity"), panel->value()); settings.setValue(QStringLiteral("browser/frequentSitesIconOpacity"), icons->value()); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); };
  connect(panel, &QSlider::valueChanged, panelValue, [panelValue](int value) { panelValue->setText(QStringLiteral("%1%").arg(value)); });
  connect(icons, &QSlider::valueChanged, iconValue, [iconValue](int value) { iconValue->setText(QStringLiteral("%1%").arg(value)); });
  connect(frequent, &QCheckBox::toggled, this, [save](bool) { save(); }); connect(panel, &QSlider::sliderReleased, this, save); connect(icons, &QSlider::sliderReleased, this, save);
  connect(restore, &QPushButton::clicked, this, [this, restore] { QSettings().remove(QStringLiteral("browser/hiddenFrequentSites")); restore->setEnabled(false); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
  const auto resetAppearance = [save, frequent, panel, icons, restore] { QSettings().remove(QStringLiteral("browser/hiddenFrequentSites")); frequent->setChecked(true); panel->setValue(72); icons->setValue(82); restore->setEnabled(false); save(); };
  connect(reset, &QPushButton::clicked, this, resetAppearance); connect(this, &SettingsPage::appearanceResetRequested, this, resetAppearance);
  return section.page;
}

QWidget *SettingsPage::createContentSection() {
  Section section = makeSection(QStringLiteral("İçerik"), QStringLiteral("Web sitelerinin içerik davranışları için merkezi alan."));
  section.layout->addWidget(placeholderPanel(section.page, BrowserIcon::Content, QStringLiteral("İçerik ayarları hazırlanıyor"), QStringLiteral("JavaScript, resimler, medya ve açılır pencere seçenekleri mevcut browser policy modeline bağlandığında burada yönetilecek. Şu anda sahte ayar sunulmuyor.")));
  section.layout->addStretch(); return section.page;
}

QWidget *SettingsPage::createPrivacySection() {
  Section section = makeSection(QStringLiteral("Gizlilik ve güvenlik"), QStringLiteral("İzleme korumasını, tarama verilerini ve kalıcı site izinlerini yönetin."));
  auto *privacyCard = makeCard(section.page, QStringLiteral("GİZLİLİK"));
  auto *strip = new QCheckBox(privacyCard); strip->setAccessibleName(QStringLiteral("İzleme parametrelerini kaldır")); strip->setChecked(profileService_->stripsTrackingParameters());
  addRow(privacyCard, settingRow(privacyCard, QStringLiteral("İzleme parametrelerini kaldır"), QStringLiteral("Bilinen takip parametrelerini HTTP/HTTPS adreslerinden yönlendirme öncesinde temizler."), strip, BrowserIcon::Privacy, true));
  auto *cache = new QPushButton(QStringLiteral("Temizle"), privacyCard); cache->setProperty("danger", true); cache->setAccessibleName(QStringLiteral("HTTP önbelleğini temizle"));
  addRow(privacyCard, settingRow(privacyCard, QStringLiteral("HTTP önbelleği"), QStringLiteral("Bu profile ait geçici web kaynaklarını temizler."), cache, BrowserIcon::Trash, true));
  auto *cookies = new QPushButton(QStringLiteral("Temizle"), privacyCard); cookies->setProperty("danger", true); cookies->setAccessibleName(QStringLiteral("Çerezleri temizle"));
  addRow(privacyCard, settingRow(privacyCard, QStringLiteral("Çerezler ve site verileri"), QStringLiteral("Bu profile ait tüm çerezleri kullanıcı onayıyla siler."), cookies));
  section.layout->addWidget(privacyCard);

  connect(strip, &QCheckBox::toggled, this, [this](bool enabled) { profileService_->setStripsTrackingParameters(enabled); });
  connect(cache, &QPushButton::clicked, this, [this] { profileService_->clearHttpCache(); QMessageBox::information(this, QStringLiteral("Önbellek"), QStringLiteral("HTTP önbelleği temizleme isteği gönderildi.")); });
  connect(cookies, &QPushButton::clicked, this, [this] { if (QMessageBox::question(this, QStringLiteral("Çerezleri temizle"), QStringLiteral("Bu profilin tüm çerezleri silinsin mi?")) == QMessageBox::Yes) profileService_->clearCookies(); });

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  auto *permissionsCard = makeCard(section.page, QStringLiteral("SİTE İZİNLERİ"));
  auto *list = new QListWidget(permissionsCard); list->setObjectName(QStringLiteral("settings-data-list")); list->setAccessibleName(QStringLiteral("Kalıcı site izinleri")); list->setMinimumHeight(180);
  auto *reset = new QPushButton(QStringLiteral("Seçili izni sıfırla"), permissionsCard); reset->setProperty("danger", true);
  auto *listContainer = new QWidget(permissionsCard); auto *listLayout = new QVBoxLayout(listContainer); listLayout->setContentsMargins(18, 12, 18, 14); listLayout->setSpacing(10); listLayout->addWidget(list); listLayout->addWidget(reset, 0, Qt::AlignLeft);
  addRow(permissionsCard, listContainer);
  section.layout->addWidget(permissionsCard); section.layout->addStretch();
  const auto refresh = [this, list] { list->clear(); for (const QWebEnginePermission &permission : profileService_->sitePermissions()) { if (!permission.isValid()) continue; auto *item = new QListWidgetItem(BrowserIcons::icon(BrowserIcon::Privacy), QStringLiteral("%1 — %2\n%3").arg(permission.origin().host(), permissionText(permission.permissionType()), permissionState(permission)), list); item->setData(Qt::UserRole, permission.origin()); item->setData(Qt::UserRole + 1, static_cast<int>(permission.permissionType())); item->setSizeHint(QSize(0, 54)); } if (!list->count()) { auto *item = new QListWidgetItem(QStringLiteral("Kalıcı site izni yok"), list); item->setFlags(Qt::NoItemFlags); } }; refresh();
  connect(reset, &QPushButton::clicked, this, [this, list, refresh] { auto *item = list->currentItem(); if (!item) return; if (profileService_->resetSitePermission(item->data(Qt::UserRole).toUrl(), static_cast<QWebEnginePermission::PermissionType>(item->data(Qt::UserRole + 1).toInt()))) refresh(); });
#else
  section.layout->addWidget(placeholderPanel(
      section.page, BrowserIcon::Privacy, QStringLiteral("Site izinleri"),
      QStringLiteral("Bu Qt sürümünde kamera, mikrofon ve diğer site izinleri istek sırasında yönetilir.")));
  section.layout->addStretch();
#endif
  return section.page;
}

QWidget *SettingsPage::createBlockerSection() {
  Section section = makeSection(QStringLiteral("ArDali Blocker"), QStringLiteral("Reklamları, izleyicileri ve istenmeyen içerikleri yönetin."));
  auto *blockerCard = makeCard(section.page, QStringLiteral("REKLAM VE İZLEYİCİ KORUMASI"));

  auto *openBtn = new QPushButton(QStringLiteral("ArDali Blocker Ayarlarını Aç"), blockerCard);
  openBtn->setAccessibleName(QStringLiteral("ArDali Blocker sekmesini aç"));
  addRow(blockerCard, settingRow(blockerCard, QStringLiteral("Filtreleme ve Kural Yönetimi"),
                                 QStringLiteral("8 sekmeli tam koruma paneli: Mod ayarları, ruleset kataloğu, özel filtreler ve canlı istek günlüğü."),
                                 openBtn, BrowserIcon::Privacy, true));

  if (profileService_ && profileService_->blockerService()) {
    auto *blockerSvc = profileService_->blockerService();
    auto *showCountCheck = new QCheckBox(blockerCard);
    showCountCheck->setChecked(blockerSvc->settings()->showBlockedCountOnToolbar());
    addRow(blockerCard, settingRow(blockerCard, QStringLiteral("Araç çubuğunda kalkan sayacı"),
                                   QStringLiteral("Engellenen istek sayısını kalkan butonu üzerinde rozet olarak gösterir."),
                                   showCountCheck, BrowserIcon::Privacy));

    connect(showCountCheck, &QCheckBox::toggled, this, [blockerSvc](bool checked) {
      blockerSvc->settings()->setShowBlockedCountOnToolbar(checked);
    });
  }

  section.layout->addWidget(blockerCard);
  section.layout->addStretch();

  connect(openBtn, &QPushButton::clicked, this, [this] {
    emit navigateRequested(QUrl(QStringLiteral("ardali://blocker")));
  });

  return section.page;
}

QWidget *SettingsPage::createSearchSection() {
  Section section = makeSection(QStringLiteral("Arama motoru"), QStringLiteral("Adres çubuğu ve yeni sekmede kullanılan web aramasını yönetin."));
  auto *card = makeCard(section.page, QStringLiteral("ARAMA"));
  auto *engine = new QComboBox(card); engine->setObjectName(QStringLiteral("settings-search-engine")); engine->setAccessibleName(QStringLiteral("Varsayılan arama motoru")); engine->addItems({QStringLiteral("Google"), QStringLiteral("DuckDuckGo"), QStringLiteral("Brave Search"), QStringLiteral("Bing")}); engine->setCurrentText(hooks_.searchEngine ? hooks_.searchEngine() : QStringLiteral("Google"));
  addRow(card, settingRow(card, QStringLiteral("Varsayılan arama motoru"), QStringLiteral("Adres çubuğuna yazılan arama sorgularında kullanılacak servis."), engine, BrowserIcon::Search, true));
  auto *suggestions = new QCheckBox(card); suggestions->setObjectName(QStringLiteral("settings-search-suggestions")); suggestions->setAccessibleName(QStringLiteral("Arama önerilerini etkinleştir")); suggestions->setChecked(QSettings().value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool());
  addRow(card, settingRow(card, QStringLiteral("Arama önerileri"), QStringLiteral("Etkinleştirildiğinde yazdığınız sorgu seçili arama motorunun öneri servisine gönderilebilir."), suggestions));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(engine, &QComboBox::currentTextChanged, this, [this](const QString &value) { QSettings().setValue(QStringLiteral("browser/searchEngine"), value); if (hooks_.setSearchEngine) hooks_.setSearchEngine(value); });
  connect(suggestions, &QCheckBox::toggled, this, [this](bool value) { QSettings().setValue(QStringLiteral("browser/searchSuggestionsEnabled"), value); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
  return section.page;
}

QWidget *SettingsPage::createPasswordsSection() {
  Section section = makeSection(QStringLiteral("Şifreler ve otomatik doldurma"), QStringLiteral("Yerel şifre kasasını ve otomatik doldurma güvenlik politikasını yönetin."));
  auto *card = makeCard(section.page, QStringLiteral("ŞİFRE YÖNETİCİSİ"));
  auto *open = new QPushButton(QStringLiteral("Şifre Yöneticisini Aç"), card);
  addRow(card, settingRow(card, QStringLiteral("Yerel şifre kasası"), QStringLiteral("Kimlik bilgileri yalnızca şifreli kasada tutulur; kasa her başlangıçta kilitlidir."), open, BrowserIcon::Password, true));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(open, &QPushButton::clicked, this, [this] { emit navigateRequested(QUrl(QStringLiteral("ardali://passwords"))); });
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
  const auto refresh = [this, list] { list->clear(); for (const BrowserDownloadEntry &entry : profileService_->recentDownloads()) { auto *item = new QListWidgetItem(BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("%1\n%2").arg(entry.fileName, entry.state), list); item->setToolTip(entry.path); item->setSizeHint(QSize(0, 52)); } if (!list->count()) { auto *item = new QListWidgetItem(QStringLiteral("Bu oturumda indirme yok"), list); item->setFlags(Qt::NoItemFlags); } }; refresh();
  connect(profileService_, &BrowserProfileService::downloadsChanged, this, refresh);
  connect(choose, &QPushButton::clicked, this, [this, folder] { const QString selected = QFileDialog::getExistingDirectory(this, QStringLiteral("İndirme klasörünü seç"), folder->text()); if (!selected.isEmpty()) { folder->setText(selected); profileService_->setDownloadDirectory(selected); } });
  connect(ask, &QCheckBox::toggled, this, [this](bool value) { profileService_->setAsksDownloadLocation(value); });
  return section.page;
}

QWidget *SettingsPage::createBookmarksSection() {
  Section section = makeSection(QStringLiteral("Yer işaretleri"), QStringLiteral("Kaydettiğiniz sayfaları açın veya listeden kaldırın."));
  auto *card = makeCard(section.page, QStringLiteral("KAYDEDİLMİŞ SAYFALAR"));
  auto *list = new QListWidget(card); list->setObjectName(QStringLiteral("settings-data-list")); list->setAccessibleName(QStringLiteral("Yer işaretleri listesi")); list->setMinimumHeight(260);
  auto *remove = new QPushButton(QStringLiteral("Seçili yer imini kaldır"), card); remove->setProperty("danger", true);
  auto *container = new QWidget(card); auto *layout = new QVBoxLayout(container); layout->setContentsMargins(18, 10, 18, 14); layout->setSpacing(10); layout->addWidget(list); layout->addWidget(remove, 0, Qt::AlignLeft); addRow(card, container);
  section.layout->addWidget(card); section.layout->addStretch();
  const auto refresh = [this, list] { list->clear(); for (const QUrl &url : profileService_->bookmarks()) { auto *item = new QListWidgetItem(BrowserIcons::icon(BrowserIcon::Bookmark), QStringLiteral("%1\n%2").arg(url.host(), url.toDisplayString()), list); item->setData(Qt::UserRole, url); item->setToolTip(url.toDisplayString()); item->setSizeHint(QSize(0, 54)); } if (!list->count()) { auto *item = new QListWidgetItem(QStringLiteral("Yer imi yok"), list); item->setFlags(Qt::NoItemFlags); } }; refresh();
  connect(list, &QListWidget::itemActivated, this, [this](QListWidgetItem *item) { const QUrl url = item->data(Qt::UserRole).toUrl(); if (url.isValid()) emit navigateRequested(url); });
  connect(remove, &QPushButton::clicked, this, [this, list, refresh] { auto *item = list->currentItem(); const QUrl url = item ? item->data(Qt::UserRole).toUrl() : QUrl{}; if (!url.isValid()) return; profileService_->toggleBookmark(url); refresh(); if (hooks_.refreshBookmarks) hooks_.refreshBookmarks(); });
  return section.page;
}

QWidget *SettingsPage::createHistorySection() {
  Section section = makeSection(QStringLiteral("Geçmiş"), QStringLiteral("Son ziyaret edilen sayfaları açın veya tarama geçmişini temizleyin."));
  auto *card = makeCard(section.page, QStringLiteral("SON ZİYARETLER"));
  auto *list = new QListWidget(card); list->setObjectName(QStringLiteral("settings-data-list")); list->setAccessibleName(QStringLiteral("Tarama geçmişi")); list->setMinimumHeight(280);
  auto *clear = new QPushButton(QStringLiteral("Geçmişi temizle"), card); clear->setProperty("danger", true);
  auto *container = new QWidget(card); auto *layout = new QVBoxLayout(container); layout->setContentsMargins(18, 10, 18, 14); layout->setSpacing(10); layout->addWidget(list); layout->addWidget(clear, 0, Qt::AlignLeft); addRow(card, container);
  section.layout->addWidget(card); section.layout->addStretch();
  const auto refresh = [this, list] { list->clear(); for (const BrowserHistoryEntry &entry : profileService_->recentHistory()) { const QString title = entry.title.isEmpty() ? entry.url.host() : entry.title; auto *item = new QListWidgetItem(BrowserIcons::icon(BrowserIcon::History), QStringLiteral("%1\n%2  ·  %3").arg(title, entry.url.toDisplayString(), entry.visitedAt.toLocalTime().toString(QStringLiteral("dd.MM.yyyy HH:mm"))), list); item->setData(Qt::UserRole, entry.url); item->setToolTip(entry.url.toDisplayString()); item->setSizeHint(QSize(0, 56)); } if (!list->count()) { auto *item = new QListWidgetItem(QStringLiteral("Geçmiş henüz boş"), list); item->setFlags(Qt::NoItemFlags); } }; refresh();
  connect(list, &QListWidget::itemActivated, this, [this](QListWidgetItem *item) { const QUrl url = item->data(Qt::UserRole).toUrl(); if (url.isValid()) emit navigateRequested(url); });
  connect(clear, &QPushButton::clicked, this, [this, refresh] { profileService_->clearHistory(); refresh(); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
  return section.page;
}

QWidget *SettingsPage::createLanguagesSection() {
  Section section = makeSection(QStringLiteral("Diller"), QStringLiteral("Tarayıcının mevcut dil ve yazım denetimi durumu."));
  section.layout->addWidget(placeholderPanel(section.page, BrowserIcon::Language, QStringLiteral("Yazım denetimi"), QStringLiteral("Chromium profili Türkçe (tr-TR) ve İngilizce (en-US) için yapılandırılmıştır; yazım denetiminin çalışması sistemdeki QtWebEngine sözlük paketlerine bağlıdır. Dil değiştirme backend’i henüz sunulmadığı için sahte seçim gösterilmiyor.")));
  section.layout->addStretch(); return section.page;
}

QWidget *SettingsPage::createAccessibilitySection() {
  Section section = makeSection(QStringLiteral("Erişilebilirlik"), QStringLiteral("Klavye, odak ve okunabilirlik seçenekleri için ayrılmış alan."));
  section.layout->addWidget(placeholderPanel(section.page, BrowserIcon::Accessibility, QStringLiteral("Erişilebilirlik seçenekleri hazırlanıyor"), QStringLiteral("Ayrı bir accessibility backend’i henüz bulunmuyor. Settings arayüzü klavye odağı, accessible names ve yüksek kontrastlı focus durumları kullanır.")));
  section.layout->addStretch(); return section.page;
}

QWidget *SettingsPage::createSystemSection() {
  Section section = makeSection(QStringLiteral("Sistem"), QStringLiteral("Tarayıcı motoru ve profil çalışma bilgileri."));
  auto *card = makeCard(section.page, QStringLiteral("ÇALIŞMA ORTAMI"));
  addRow(card, settingRow(card, QStringLiteral("Chromium profili"), QStringLiteral("Kalıcı çerezler, disk önbelleği ve site izinleri ArDaliBrowser profilinde saklanır."), nullptr, BrowserIcon::Settings, true));
  addRow(card, settingRow(card, QStringLiteral("Güvenlik politikası"), QStringLiteral("HTTP/HTTPS navigation ve DALI capability kontrolleri etkindir."), nullptr));
  section.layout->addWidget(card); section.layout->addStretch(); return section.page;
}

QWidget *SettingsPage::createResetSection() {
  Section section = makeSection(QStringLiteral("Ayarları sıfırla"), QStringLiteral("Yalnız desteklenen görünüm tercihlerini anlaşılır kapsamda sıfırlayın."));
  auto *card = makeCard(section.page, QStringLiteral("YENİ SEKME"));
  auto *reset = new QPushButton(QStringLiteral("Yeni sekme ayarlarını sıfırla"), card); reset->setProperty("danger", true);
  addRow(card, settingRow(card, QStringLiteral("Yeni sekme görünümünü sıfırla"), QStringLiteral("Panel ve ikon saydamlığını varsayılan değerlere getirir; gizlenen sık ziyaret edilen siteleri geri yükler."), reset, BrowserIcon::Reset, true));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(reset, &QPushButton::clicked, this, &SettingsPage::appearanceResetRequested);
  return section.page;
}

QWidget *SettingsPage::createListeningSection() {
  Section section = makeSection(QStringLiteral("ArDali Pulse Ayarları"), QStringLiteral("Shazam tabanlı müzik bulucu, ses yakalama ve hedef platform arama tercihleri."));

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
  Section section = makeSection(QStringLiteral("ArDaliBrowser hakkında"), QStringLiteral("Sürüm ve çalışma ortamı bilgileri."));
  auto *card = makeCard(section.page);
  auto *about = new QWidget(card); auto *layout = new QHBoxLayout(about); layout->setContentsMargins(24, 22, 24, 22); layout->setSpacing(20);
  auto *logo = new QLabel(about); logo->setPixmap(qApp->windowIcon().pixmap(72, 72)); logo->setFixedSize(76, 76); logo->setAccessibleName(QStringLiteral("ArDaliBrowser logosu"));
  QString engine = QStringLiteral("Qt WebEngine (Chromium tabanlı)");
  const QRegularExpressionMatch match = QRegularExpression(QStringLiteral("Chrome/([0-9.]+)")).match(profileService_->profile()->httpUserAgent());
  if (match.hasMatch()) engine = QStringLiteral("Chromium %1").arg(match.captured(1));
  auto *details = new QLabel(QStringLiteral("<h2>ArDaliBrowser</h2><p>Sürüm: %1<br>Tarayıcı motoru: %2<br>Qt sürümü: %3</p>").arg(QStringLiteral(ARDALI_BROWSER_VERSION), engine, QString::fromLatin1(qVersion())), about);
  details->setObjectName(QStringLiteral("settings-heading")); details->setWordWrap(true); details->setTextInteractionFlags(Qt::TextSelectableByMouse);
  layout->addWidget(logo, 0, Qt::AlignTop); layout->addWidget(details, 1); addRow(card, about);
  section.layout->addWidget(card); section.layout->addStretch(); return section.page;
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
