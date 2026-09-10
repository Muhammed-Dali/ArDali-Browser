#include "search_suggestion_service.h"
#include "settings_page.h"

#include "browser_profile_service.h"
#include "ardali_blocker_service.h"
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
#include <QStandardPaths>
#include <QVBoxLayout>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif
#include <QWebEngineProfile>

#include <algorithm>
#include <memory>

namespace {
constexpr int kContentMaxWidth = 920;

struct Section {
  QWidget *page = nullptr;
  QVBoxLayout *layout = nullptr;
};

class ClickableFrame final : public QFrame {
 public:
  using QFrame::QFrame;
  std::function<void()> clicked;

 protected:
  void mouseReleaseEvent(QMouseEvent *event) override {
    if (event->button() == Qt::LeftButton && rect().contains(event->position().toPoint()) && clicked) {
      clicked();
      event->accept();
      return;
    }
    QFrame::mouseReleaseEvent(event);
  }
};

struct InteractiveSettingRowResult {
  ClickableFrame *frame = nullptr;
  QLabel *subtitleLabel = nullptr;
};

InteractiveSettingRowResult makeInteractiveSettingRow(
    QWidget *parent,
    BrowserIcon icon,
    const QString &title,
    const QString &initialSubtitle,
    std::function<void(QLabel *)> onClickAction) {
  auto *row = new ClickableFrame(parent);
  row->setObjectName(QStringLiteral("settings-row"));
  row->setCursor(Qt::PointingHandCursor);

  auto *layout = new QHBoxLayout(row);
  layout->setContentsMargins(18, 14, 18, 14);
  layout->setSpacing(14);

  auto *iconLabel = new QLabel(row);
  iconLabel->setPixmap(BrowserIcons::icon(icon).pixmap(18, 18));
  iconLabel->setFixedSize(20, 20);
  layout->addWidget(iconLabel, 0, Qt::AlignVCenter);

  auto *textCol = new QWidget(row);
  auto *textLayout = new QVBoxLayout(textCol);
  textLayout->setContentsMargins(0, 0, 0, 0);
  textLayout->setSpacing(3);

  auto *titleLabel = new QLabel(title, textCol);
  titleLabel->setObjectName(QStringLiteral("settings-row-title"));
  textLayout->addWidget(titleLabel);

  auto *subLabel = new QLabel(initialSubtitle, textCol);
  subLabel->setObjectName(QStringLiteral("settings-row-description"));
  subLabel->setWordWrap(true);
  textLayout->addWidget(subLabel);

  layout->addWidget(textCol, 1, Qt::AlignVCenter);

  auto *chevron = new QLabel(row);
  chevron->setPixmap(BrowserIcons::icon(BrowserIcon::ChevronRight).pixmap(14, 14));
  chevron->setFixedSize(16, 16);
  layout->addWidget(chevron, 0, Qt::AlignVCenter);

  if (onClickAction) {
    row->clicked = [onClickAction, subLabel] {
      onClickAction(subLabel);
    };
  }

  return {row, subLabel};
}

InteractiveSettingRowResult makeInteractiveSettingRow(
    QWidget *parent,
    BrowserIcon icon,
    const QString &title,
    const QString &initialSubtitle,
    std::function<void()> onClickAction) {
  return makeInteractiveSettingRow(parent, icon, title, initialSubtitle, [onClickAction](QLabel *) {
    if (onClickAction) onClickAction();
  });
}

struct CollapsibleSectionResult {
  ClickableFrame *headerRow = nullptr;
  QWidget *childContainer = nullptr;
};

CollapsibleSectionResult makeCollapsibleSectionRow(
    QWidget *parent,
    const QString &title,
    const QString &description = {}) {
  auto *header = new ClickableFrame(parent);
  header->setObjectName(QStringLiteral("settings-row"));
  header->setCursor(Qt::PointingHandCursor);

  auto *layout = new QHBoxLayout(header);
  layout->setContentsMargins(18, 14, 18, 14);
  layout->setSpacing(14);

  auto *textCol = new QWidget(header);
  auto *textLayout = new QVBoxLayout(textCol);
  textLayout->setContentsMargins(0, 0, 0, 0);
  textLayout->setSpacing(3);

  auto *titleLabel = new QLabel(title, textCol);
  titleLabel->setObjectName(QStringLiteral("settings-row-title"));
  textLayout->addWidget(titleLabel);

  if (!description.isEmpty()) {
    auto *descLabel = new QLabel(description, textCol);
    descLabel->setObjectName(QStringLiteral("settings-row-description"));
    textLayout->addWidget(descLabel);
  }
  layout->addWidget(textCol, 1, Qt::AlignVCenter);

  auto *arrowLabel = new QLabel(header);
  arrowLabel->setPixmap(BrowserIcons::icon(BrowserIcon::ChevronDown).pixmap(14, 14));
  arrowLabel->setFixedSize(16, 16);
  layout->addWidget(arrowLabel, 0, Qt::AlignVCenter);

  auto *container = new QWidget(parent);
  container->setVisible(false);
  auto *cLayout = new QVBoxLayout(container);
  cLayout->setContentsMargins(0, 0, 0, 0);
  cLayout->setSpacing(0);

  header->clicked = [container] {
    container->setVisible(!container->isVisible());
  };

  return {header, container};
}

void showOptionDialog(
    QWidget *parent,
    const QString &title,
    BrowserIcon icon,
    const QString &description,
    const QList<QPair<QString, QString>> &options,
    int initialIndex,
    std::function<void(int)> onSelect) {
  QDialog dialog(parent);
  dialog.setWindowTitle(title);
  dialog.setWindowFlags(dialog.windowFlags() & ~Qt::WindowContextHelpButtonHint);
  dialog.setMinimumWidth(490);
  dialog.setStyleSheet(QStringLiteral(R"CSS(
    QDialog { background: #151d26; color: #edf5fc; border: 1px solid #2e3b49; border-radius: 12px; }
    #dialog-header { background: #1c2633; border-bottom: 1px solid #2d3b4b; border-top-left-radius: 11px; border-top-right-radius: 11px; }
    #dialog-title { font-size: 16px; font-weight: 650; color: #f2f7fc; }
    #dialog-desc { color: #8fa0b3; font-size: 13px; }
    #dialog-option-box { background: #1a232e; border: 1px solid #2d3c4c; border-radius: 10px; margin-bottom: 6px; }
    #dialog-option-box:hover { background: #222e3d; border-color: #3e566e; }
    QRadioButton { color: #edf4fb; font-size: 14px; font-weight: 550; spacing: 10px; }
    QRadioButton::indicator { width: 18px; height: 18px; border-radius: 9px; border: 2px solid #4a5c6e; background: #111820; }
    QRadioButton::indicator:checked { border-color: #55a8cf; background: #55a8cf; }
    #dialog-option-desc { color: #8899ac; font-size: 12px; margin-left: 28px; }
    QPushButton { min-height: 32px; background: #243546; color: #edf5fc; border: 1px solid #3c5164; border-radius: 7px; padding: 0 16px; font-weight: 550; }
    QPushButton:hover { background: #2d4358; border-color: #4b667e; }
    QPushButton#primary { background: #32759e; border-color: #4595c2; }
    QPushButton#primary:hover { background: #3c8bb9; }
  )CSS"));

  auto *root = new QVBoxLayout(&dialog);
  root->setContentsMargins(0, 0, 0, 16);
  root->setSpacing(14);

  auto *header = new QWidget(&dialog);
  header->setObjectName(QStringLiteral("dialog-header"));
  auto *hLayout = new QHBoxLayout(header);
  hLayout->setContentsMargins(18, 14, 18, 14);
  hLayout->setSpacing(12);

  auto *iconLbl = new QLabel(header);
  iconLbl->setPixmap(BrowserIcons::icon(icon).pixmap(22, 22));
  iconLbl->setFixedSize(24, 24);
  hLayout->addWidget(iconLbl, 0, Qt::AlignVCenter);

  auto *titleCol = new QWidget(header);
  auto *tLayout = new QVBoxLayout(titleCol);
  tLayout->setContentsMargins(0, 0, 0, 0);
  tLayout->setSpacing(2);
  auto *titleLbl = new QLabel(title, titleCol);
  titleLbl->setObjectName(QStringLiteral("dialog-title"));
  tLayout->addWidget(titleLbl);
  if (!description.isEmpty()) {
    auto *descLbl = new QLabel(description, titleCol);
    descLbl->setObjectName(QStringLiteral("dialog-desc"));
    descLbl->setWordWrap(true);
    tLayout->addWidget(descLbl);
  }
  hLayout->addWidget(titleCol, 1);
  root->addWidget(header);

  auto *body = new QWidget(&dialog);
  auto *bLayout = new QVBoxLayout(body);
  bLayout->setContentsMargins(20, 0, 20, 0);
  bLayout->setSpacing(8);

  auto *group = new QButtonGroup(&dialog);
  for (int i = 0; i < options.size(); ++i) {
    auto *optBox = new ClickableFrame(body);
    optBox->setObjectName(QStringLiteral("dialog-option-box"));
    optBox->setCursor(Qt::PointingHandCursor);
    auto *optLayout = new QVBoxLayout(optBox);
    optLayout->setContentsMargins(14, 10, 14, 10);
    optLayout->setSpacing(3);

    auto *rb = new QRadioButton(options[i].first, optBox);
    rb->setChecked(i == initialIndex);
    group->addButton(rb, i);
    optLayout->addWidget(rb);

    if (!options[i].second.isEmpty()) {
      auto *sub = new QLabel(options[i].second, optBox);
      sub->setObjectName(QStringLiteral("dialog-option-desc"));
      sub->setWordWrap(true);
      optLayout->addWidget(sub);
    }
    optBox->clicked = [rb] { rb->setChecked(true); };
    bLayout->addWidget(optBox);
  }
  root->addWidget(body);

  auto *btnLayout = new QHBoxLayout;
  btnLayout->setContentsMargins(20, 6, 20, 0);
  btnLayout->addStretch();
  auto *cancelBtn = new QPushButton(QStringLiteral("İptal"), &dialog);
  auto *saveBtn = new QPushButton(QStringLiteral("Kaydet"), &dialog);
  saveBtn->setObjectName(QStringLiteral("primary"));
  btnLayout->addWidget(cancelBtn);
  btnLayout->addWidget(saveBtn);
  root->addLayout(btnLayout);

  QObject::connect(cancelBtn, &QPushButton::clicked, &dialog, &QDialog::reject);
  QObject::connect(saveBtn, &QPushButton::clicked, &dialog, &QDialog::accept);

  if (dialog.exec() == QDialog::Accepted) {
    const int checkedId = group->checkedId();
    if (checkedId >= 0 && checkedId < options.size()) {
      onSelect(checkedId);
    }
  }
}

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

BrowserIcon permissionIcon(QWebEnginePermission::PermissionType type) {
  switch (type) {
    case QWebEnginePermission::PermissionType::MediaAudioCapture: return BrowserIcon::Microphone;
    case QWebEnginePermission::PermissionType::MediaVideoCapture: return BrowserIcon::Camera;
    case QWebEnginePermission::PermissionType::MediaAudioVideoCapture: return BrowserIcon::Camera;
    case QWebEnginePermission::PermissionType::DesktopVideoCapture:
    case QWebEnginePermission::PermissionType::DesktopAudioVideoCapture: return BrowserIcon::Video;
    case QWebEnginePermission::PermissionType::Notifications: return BrowserIcon::Notification;
    case QWebEnginePermission::PermissionType::Geolocation: return BrowserIcon::Location;
    case QWebEnginePermission::PermissionType::ClipboardReadWrite: return BrowserIcon::Clipboard;
    case QWebEnginePermission::PermissionType::LocalFontsAccess: return BrowserIcon::Fonts;
    case QWebEnginePermission::PermissionType::MouseLock: return BrowserIcon::Mouse;
    default: return BrowserIcon::Privacy;
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
    #settings-page QListWidget#settings-data-list, #settings-page QListWidget#settings-allowlist-list { background:#151c24; color:#e1e8f0; border:1px solid #2e3b49; border-radius:9px; outline:0; padding:4px; }
    #settings-page QListWidget#settings-data-list::item, #settings-page QListWidget#settings-allowlist-list::item { min-height:46px; padding:5px 8px; border-radius:6px; }
    #settings-page QListWidget#settings-data-list::item:hover, #settings-page QListWidget#settings-allowlist-list::item:hover { background:#202b36; }
    #settings-page QListWidget#settings-data-list::item:selected, #settings-page QListWidget#settings-allowlist-list::item:selected { background:#294052; color:#f4f8fc; }
    #settings-page QCheckBox { spacing:8px; }
    #settings-page QCheckBox::indicator { width:18px; height:18px; }
    #settings-page QSlider::groove:horizontal { height:4px; background:#344251; border-radius:2px; }
    #settings-page QSlider::sub-page:horizontal { background:#5da6c5; border-radius:2px; }
    #settings-page QSlider::handle:horizontal { width:16px; margin:-6px 0; background:#dbeaf4; border:2px solid #4c91b1; border-radius:8px; }
    #settings-mode-card { background:#141c25; border:1px solid #2e3b49; border-radius:10px; }
    #settings-mode-card:hover { background:#1a2532; border-color:#465a6f; }
    #settings-mode-card[selected="true"] { background:#1c2d3c; border:2px solid #58a6c7; }
    #settings-mode-title { color:#f3f7fc; font-size:14px; font-weight:600; }
    #settings-mode-badge { background:#284255; color:#8cd2f4; border:1px solid #3c6580; border-radius:10px; font-size:11px; font-weight:600; padding:1px 7px; }
    #settings-mode-desc { color:#98a9ba; font-size:12px; }
    #settings-subpage-back-btn { min-width:34px; max-width:34px; min-height:34px; max-height:34px; background:transparent; border:1px solid transparent; border-radius:7px; padding:0; }
    #settings-subpage-back-btn:hover { background:#222d39; border-color:#354657; }
    #settings-subpage-del-btn { min-width:28px; max-width:28px; min-height:28px; max-height:28px; background:transparent; border:1px solid transparent; border-radius:6px; padding:0; }
    #settings-subpage-del-btn:hover { background:#382229; border-color:#5c2d38; }
    #settings-site-row { background:transparent; border-bottom:1px solid #232d39; }
    #settings-site-row:hover { background:#1e2935; }
    #settings-add-btn { min-height:28px; background:#223344; color:#edf5fc; border:1px solid #3d5368; border-radius:6px; padding:0 14px; font-weight:600; font-size:12px; }
    #settings-add-btn:hover { background:#2a4156; border-color:#506d86; }
    #settings-pill-btn { min-height:28px; background:#222a35; color:#edf5fc; border:1px solid #3d4f62; border-radius:14px; padding:0 16px; font-weight:550; font-size:12px; }
    #settings-pill-btn:hover { background:#2c3a4a; border-color:#536b84; }
    #settings-pill-btn:focus { border:1px solid #62a9c8; outline:none; }
    #settings-more-btn { min-width:28px; max-width:28px; min-height:28px; max-height:28px; background:transparent; border:0; border-radius:14px; padding:0; color:#bdc9d7; font-size:16px; font-weight:bold; }
    #settings-more-btn:hover { background:#263240; color:#f3f7fc; }
    #settings-icon-del-btn { min-width:28px; max-width:28px; min-height:28px; max-height:28px; background:transparent; border:0; border-radius:6px; padding:0; color:#8e9fae; font-size:13px; }
    #settings-icon-del-btn:hover { background:#382229; color:#f28b82; }
    #settings-chevron-btn { min-width:28px; max-width:28px; min-height:28px; max-height:28px; background:transparent; border:0; border-radius:6px; padding:0; color:#8e9fae; font-size:18px; font-weight:bold; }
    #settings-chevron-btn:hover { background:#263240; color:#f3f7fc; }
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
  addCategory(Category::Blocker, BrowserIcon::Privacy, QStringLiteral("ArDali Blocker"), QStringLiteral("ardali blocker reklam engelleyici filtreleme kalkan kurallar"), createBlockerSection());
  addCategory(Category::Search, BrowserIcon::Search, QStringLiteral("Arama motoru"), QStringLiteral("öneri Google DuckDuckGo Brave Bing"), createSearchSection());
  addSidebarSeparator();
  addCategory(Category::Passwords, BrowserIcon::Password, QStringLiteral("Şifreler ve otomatik doldurma"), QStringLiteral("password manager parola yakında"), createPasswordsSection());
  addCategory(Category::Languages, BrowserIcon::Language, QStringLiteral("Diller"), QStringLiteral("dil language lisan dil seçimi arayüz dili uygulama dili Türkçe İngilizce Arapça yazım denetimi spellcheck çeviri translate"), createLanguagesSection());
  addCategory(Category::Downloads, BrowserIcon::Download, QStringLiteral("İndirilenler"), QStringLiteral("klasör konum dosya DALI"), createDownloadsSection());
  addCategory(Category::Bookmarks, BrowserIcon::Bookmark, QStringLiteral("Yer işaretleri"), QStringLiteral("yer imi kaydedilmiş sayfa"), createBookmarksSection());
  addCategory(Category::History, BrowserIcon::History, QStringLiteral("Geçmiş"), QStringLiteral("ziyaret tarih saat temizle"), createHistorySection());
  addCategory(Category::Accessibility, BrowserIcon::Accessibility, QStringLiteral("Erişilebilirlik"), QStringLiteral("klavye odak kontrast"), createAccessibilitySection());
  addSidebarSeparator();
  addCategory(Category::System, BrowserIcon::Settings, QStringLiteral("Sistem"), QStringLiteral("Chromium profil runtime"), createSystemSection());
  addCategory(Category::Listening, BrowserIcon::Tools, QStringLiteral("Pulse"), QStringLiteral("ardali pulse şarkı bul shazam pulse dinle ses mikrofon müzik tanıma"), createListeningSection());
  addCategory(Category::Reset, BrowserIcon::Reset, QStringLiteral("Ayarları sıfırla"), QStringLiteral("varsayılan görünüm sık ziyaret"), createResetSection());
  addSidebarSeparator();
  addCategory(Category::About, BrowserIcon::Info, QStringLiteral("ArDaliBrowser hakkında"), QStringLiteral("sürüm version build Qt WebEngine Chromium"), createAboutSection());

  setStyleSheet(settingsStyleSheet());
  connect(sidebar_, &QListWidget::currentRowChanged, this, &SettingsPage::selectCategory);
  connect(sidebar_, &QListWidget::itemClicked, this, [this](QListWidgetItem *item) {
    if (item) selectCategory(sidebar_->row(item));
  });
  connect(search_, &QLineEdit::textChanged, this, &SettingsPage::applyFilter);
  connect(&ardali::i18n::LanguageManager::instance(), &ardali::i18n::LanguageManager::languageChanged,
          this, [this] { retranslateUi(); });
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
  updateItem(Category::Blocker, QStringLiteral("settings.category.blocker"), QStringLiteral("ArDali Blocker"));
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
  updateItem(Category::About, QStringLiteral("settings.category.about"), QStringLiteral("ArDaliBrowser hakkında"));

  if (search_) {
    search_->setPlaceholderText(I18n::text(QStringLiteral("settings.search_placeholder"), QStringLiteral("Ayarlarda ara")));
  }

  if (uiLangCombo_) {
    uiLangCombo_->setItemText(0, ardali::i18n::LanguageManager::instance().formatSystemLanguageLabel());
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
    engine->setCurrentText(settings.value(QStringLiteral("browser/searchEngine"), QStringLiteral("Google")).toString());
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
  }
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
      QStringLiteral("Chrome / Brave Kavisli"),
      QStringLiteral("Varsayılan"),
      QStringLiteral("Birebir Google Chrome ve Brave sekme yapısı; 240px genişlik, kavisli kulaklar ve araç çubuğuyla kesintisiz birleşim.") },
    { QStringLiteral("ardali_signature"),
      QStringLiteral("ArDali Kavisli (İmza Tasarım)"),
      QStringLiteral("Önerilen"),
      QStringLiteral("Chrome sekme yapısı üzerine eklenmiş özel ArDali mavi ışıltısı.") },
    { QStringLiteral("floating_pill"),
      QStringLiteral("Modern Kapsül (Yüzen Sekme)"),
      QStringLiteral("Modern"),
      QStringLiteral("Alt çubuğa bitişik olmak yerine hafif boşlukla yüzen, dört köşesi yuvarlatılmış modern kapsül görünümü.") }
  };

  QSettings preferences;
  const QString currentStyleStr = ardali::desktop_tabs::tabStylePreferenceValue(
      ardali::desktop_tabs::tabStyleFromPreference(
          preferences.value(QStringLiteral("browser/tabStyle"),
                            QStringLiteral("chrome_curved")).toString()));

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

QWidget *SettingsPage::createPerformanceSection() {
  Section section = makeSection(
      QStringLiteral("Performans"),
      QStringLiteral("Bellek kullanımı, arka plan sekme optimizasyonu ve site istisnalarını yönetin."));

  auto *perfManager = hooks_.performanceManager ? hooks_.performanceManager() : nullptr;

  // --------------------------------------------------------------------------
  // Card 1: PERFORMANS MODU (Selection Cards)
  // --------------------------------------------------------------------------
  auto *modeCard = makeCard(section.page, QStringLiteral("PERFORMANS MODU"));

  auto *cardsContainer = new QWidget(modeCard);
  cardsContainer->setObjectName(QStringLiteral("settings-mode-container"));
  auto *cardsLayout = new QVBoxLayout(cardsContainer);
  cardsLayout->setContentsMargins(18, 14, 18, 14);
  cardsLayout->setSpacing(10);

  struct ModeCardInfo {
    ardali::PerformancePolicyMode mode;
    QString title;
    QString badge;
    QString description;
  };

  const std::vector<ModeCardInfo> modeInfos = {
    { ardali::PerformancePolicyMode::Balanced,
      QStringLiteral("Dengeli"),
      QStringLiteral("Önerilen"),
      QStringLiteral("Performans ve bellek kullanımı arasında dengeli bir deneyim sağlar.") },
    { ardali::PerformancePolicyMode::MemorySaver,
      QStringLiteral("Bellek Tasarrufu"),
      QString(),
      QStringLiteral("Kullanmadığınız sekmelerin kaynak kullanımını daha erken azaltarak daha fazla bellek boşaltır.") },
    { ardali::PerformancePolicyMode::MaximumPerformance,
      QStringLiteral("Maksimum Performans"),
      QString(),
      QStringLiteral("Sekmeleri daha uzun süre etkin tutarak hızlı geçişlere öncelik verir. Daha fazla bellek kullanabilir.") }
  };

  QVector<QFrame *> modeFrameWidgets;
  QVector<QRadioButton *> modeRadioButtons;

  QSettings preferences;
  const QString initialModeStr = preferences.value(QStringLiteral("performance/policyMode"), QStringLiteral("balanced")).toString().toLower();
  ardali::PerformancePolicyMode currentMode = ardali::PerformancePolicyMode::Balanced;
  if (perfManager) {
    currentMode = perfManager->policyMode();
  } else {
    if (initialModeStr == QLatin1String("memory_saver")) currentMode = ardali::PerformancePolicyMode::MemorySaver;
    else if (initialModeStr == QLatin1String("maximum_performance")) currentMode = ardali::PerformancePolicyMode::MaximumPerformance;
  }

  auto *btnGroup = new QButtonGroup(cardsContainer);

  for (size_t i = 0; i < modeInfos.size(); ++i) {
    const auto &info = modeInfos[i];
    auto *frame = new QFrame(cardsContainer);
    frame->setObjectName(QStringLiteral("settings-mode-card"));
    frame->setProperty("selected", info.mode == currentMode);
    frame->setCursor(Qt::PointingHandCursor);

    auto *fLayout = new QHBoxLayout(frame);
    fLayout->setContentsMargins(16, 12, 16, 12);
    fLayout->setSpacing(12);

    auto *radio = new QRadioButton(frame);
    radio->setChecked(info.mode == currentMode);
    radio->setAccessibleName(info.title);
    radio->setAccessibleDescription(info.description);
    btnGroup->addButton(radio, static_cast<int>(i));
    modeRadioButtons.push_back(radio);

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

    cardsLayout->addWidget(frame);
    modeFrameWidgets.push_back(frame);
  }

  auto updateModeSelection = [modeInfos, modeFrameWidgets, modeRadioButtons, perfManager](int index) {
    if (index < 0 || index >= static_cast<int>(modeInfos.size())) return;
    const auto selectedMode = modeInfos[index].mode;
    for (int i = 0; i < static_cast<int>(modeFrameWidgets.size()); ++i) {
      const bool isSelected = (i == index);
      modeFrameWidgets[i]->setProperty("selected", isSelected);
      modeFrameWidgets[i]->style()->unpolish(modeFrameWidgets[i]);
      modeFrameWidgets[i]->style()->polish(modeFrameWidgets[i]);
      if (modeRadioButtons[i]->isChecked() != isSelected) {
        modeRadioButtons[i]->setChecked(isSelected);
      }
    }
    if (perfManager) {
      perfManager->setPolicyMode(selectedMode);
    } else {
      QSettings s;
      switch (selectedMode) {
        case ardali::PerformancePolicyMode::Balanced: s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("balanced")); break;
        case ardali::PerformancePolicyMode::MemorySaver: s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("memory_saver")); break;
        case ardali::PerformancePolicyMode::MaximumPerformance: s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("maximum_performance")); break;
      }
    }
  };

  connect(btnGroup, &QButtonGroup::idClicked, this, updateModeSelection);

  addRow(modeCard, cardsContainer);
  section.layout->addWidget(modeCard);

  // --------------------------------------------------------------------------
  // Card 2: BELLEK YÖNETİMİ (Discard Kill-Switch)
  // --------------------------------------------------------------------------
  auto *discardCard = makeCard(section.page, QStringLiteral("BELLEK YÖNETİMİ"));
  auto *discardToggle = new QCheckBox(discardCard);
  discardToggle->setObjectName(QStringLiteral("settings-discard-toggle"));
  discardToggle->setAccessibleName(QStringLiteral("Bellek Tasarrufu"));
  discardToggle->setAccessibleDescription(QStringLiteral("Uzun süre kullanmadığınız sekmeler gerektiğinde bellekten çıkarılır."));
  const bool discardInitial = perfManager ? perfManager->isDiscardEnabled()
                                          : preferences.value(QStringLiteral("performance/discardEnabled"), true).toBool();
  discardToggle->setChecked(discardInitial);

  connect(discardToggle, &QCheckBox::toggled, this, [perfManager](bool checked) {
    if (perfManager) {
      perfManager->setDiscardEnabled(checked);
    } else {
      QSettings().setValue(QStringLiteral("performance/discardEnabled"), checked);
    }
  });

  addRow(discardCard, settingRow(
      discardCard,
      QStringLiteral("Bellek Tasarrufu"),
      QStringLiteral("Uzun süre kullanmadığınız sekmeler gerektiğinde bellekten çıkarılarak diğer uygulamalar için daha fazla bellek kullanılabilir hale getirilir."),
      discardToggle,
      BrowserIcon::Performance,
      true));
  section.layout->addWidget(discardCard);

  // --------------------------------------------------------------------------
  // Card 3: SİTE İSTİSNALARI (Allowlist Manager)
  // --------------------------------------------------------------------------
  auto *allowlistCard = makeCard(section.page, QStringLiteral("SİTE İSTİSNALARI"));

  auto *allowlistContainer = new QWidget(allowlistCard);
  auto *alLayout = new QVBoxLayout(allowlistContainer);
  alLayout->setContentsMargins(18, 14, 18, 14);
  alLayout->setSpacing(12);

  auto *alDesc = new QLabel(
      QStringLiteral("Eklediğiniz siteler bellek tasarrufu nedeniyle bellekten çıkarılmaz."),
      allowlistContainer);
  alDesc->setObjectName(QStringLiteral("settings-row-description"));
  alDesc->setWordWrap(true);
  alLayout->addWidget(alDesc);

  auto *inputRow = new QWidget(allowlistContainer);
  auto *irLayout = new QHBoxLayout(inputRow);
  irLayout->setContentsMargins(0, 0, 0, 0);
  irLayout->setSpacing(10);

  auto *siteInput = new QLineEdit(inputRow);
  siteInput->setObjectName(QStringLiteral("settings-allowlist-input"));
  siteInput->setPlaceholderText(QStringLiteral("Site adresi girin (örn. youtube.com)"));
  siteInput->setAccessibleName(QStringLiteral("Her zaman etkin tutulacak site adresi"));
  siteInput->setClearButtonEnabled(true);

  auto *addBtn = new QPushButton(QStringLiteral("Ekle"), inputRow);
  addBtn->setObjectName(QStringLiteral("settings-allowlist-add"));
  addBtn->setAccessibleName(QStringLiteral("Siteyi istisnalara ekle"));

  irLayout->addWidget(siteInput, 1);
  irLayout->addWidget(addBtn, 0);
  alLayout->addWidget(inputRow);

  auto *statusMsg = new QLabel(allowlistContainer);
  statusMsg->setObjectName(QStringLiteral("settings-allowlist-status"));
  statusMsg->setVisible(false);
  alLayout->addWidget(statusMsg);

  auto *siteListWidget = new QListWidget(allowlistContainer);
  siteListWidget->setObjectName(QStringLiteral("settings-allowlist-list"));
  siteListWidget->setAccessibleName(QStringLiteral("Her zaman etkin tutulan siteler"));
  siteListWidget->setMinimumHeight(120);
  siteListWidget->setMaximumHeight(240);
  alLayout->addWidget(siteListWidget);

  auto refreshSiteList = [perfManager, siteListWidget]() {
    siteListWidget->clear();
    QStringList list;
    if (perfManager) {
      list = perfManager->siteAllowlist();
    } else {
      list = QSettings().value(QStringLiteral("performance/siteAllowlist")).toStringList();
    }
    for (const QString &domain : list) {
      if (domain.trimmed().isEmpty()) continue;
      auto *item = new QListWidgetItem(siteListWidget);
      auto *itemWidget = new QWidget;
      auto *iwLayout = new QHBoxLayout(itemWidget);
      iwLayout->setContentsMargins(8, 4, 8, 4);
      iwLayout->setSpacing(10);

      auto *domainLabel = new QLabel(domain, itemWidget);
      domainLabel->setObjectName(QStringLiteral("settings-row-title"));

      auto *removeBtn = new QPushButton(QStringLiteral("Kaldır"), itemWidget);
      removeBtn->setProperty("danger", true);
      removeBtn->setAccessibleName(QStringLiteral("%1 sitesini istisnalardan kaldır").arg(domain));
      removeBtn->setFixedSize(68, 28);

      QObject::connect(removeBtn, &QPushButton::clicked, itemWidget, [perfManager, domain, siteListWidget]() {
        QStringList current;
        if (perfManager) current = perfManager->siteAllowlist();
        else current = QSettings().value(QStringLiteral("performance/siteAllowlist")).toStringList();
        current.removeAll(domain);
        if (perfManager) perfManager->setSiteAllowlist(current);
        else QSettings().setValue(QStringLiteral("performance/siteAllowlist"), current);

        // Remove row from list
        for (int r = 0; r < siteListWidget->count(); ++r) {
          auto *it = siteListWidget->item(r);
          if (it && it->text() == domain) {
            delete siteListWidget->takeItem(r);
            break;
          }
        }
        if (siteListWidget->count() == 0) {
          auto *emptyItem = new QListWidgetItem(QStringLiteral("Henüz eklenmiş bir site istisnası yok."), siteListWidget);
          emptyItem->setFlags(Qt::NoItemFlags);
        }
      });

      iwLayout->addWidget(domainLabel, 1);
      iwLayout->addWidget(removeBtn, 0);
      item->setSizeHint(QSize(0, 38));
      item->setText(domain);
      siteListWidget->setItemWidget(item, itemWidget);
    }
    if (siteListWidget->count() == 0) {
      auto *emptyItem = new QListWidgetItem(QStringLiteral("Henüz eklenmiş bir site istisnası yok."), siteListWidget);
      emptyItem->setFlags(Qt::NoItemFlags);
    }
  };

  refreshSiteList();

  auto handleAddSite = [siteInput, statusMsg, perfManager, refreshSiteList]() {
    const QString raw = siteInput->text().trimmed();
    statusMsg->setVisible(false);
    if (raw.isEmpty()) return;

    if (raw.contains(QLatin1String("javascript:"), Qt::CaseInsensitive) ||
        raw.contains(QLatin1String("file:"), Qt::CaseInsensitive) ||
        raw.contains(QLatin1String("data:"), Qt::CaseInsensitive) ||
        raw.contains(QLatin1Char('@'))) {
      statusMsg->setText(QStringLiteral("Lütfen geçerli bir web sitesi adresi girin."));
      statusMsg->setStyleSheet(QStringLiteral("color: #f28b82; font-size: 12px;"));
      statusMsg->setVisible(true);
      return;
    }

    const QString normalized = ardali::TabPerformanceManager::normalizeSitePattern(raw);
    if (normalized.isEmpty() || !normalized.contains(QLatin1Char('.')) || normalized.endsWith(QLatin1Char('.'))) {
      statusMsg->setText(QStringLiteral("Lütfen geçerli bir web sitesi adresi girin."));
      statusMsg->setStyleSheet(QStringLiteral("color: #f28b82; font-size: 12px;"));
      statusMsg->setVisible(true);
      return;
    }

    QStringList current;
    if (perfManager) current = perfManager->siteAllowlist();
    else current = QSettings().value(QStringLiteral("performance/siteAllowlist")).toStringList();

    if (current.contains(normalized)) {
      statusMsg->setText(QStringLiteral("Bu site zaten listede ekli."));
      statusMsg->setStyleSheet(QStringLiteral("color: #fdd663; font-size: 12px;"));
      statusMsg->setVisible(true);
      return;
    }

    current.append(normalized);
    if (perfManager) perfManager->setSiteAllowlist(current);
    else QSettings().setValue(QStringLiteral("performance/siteAllowlist"), current);

    siteInput->clear();
    statusMsg->setVisible(false);
    refreshSiteList();
  };

  connect(addBtn, &QPushButton::clicked, this, handleAddSite);
  connect(siteInput, &QLineEdit::returnPressed, this, handleAddSite);

  addRow(allowlistCard, allowlistContainer);
  section.layout->addWidget(allowlistCard);

  // --------------------------------------------------------------------------
  // Card 4: SİSTEM BELLEK DURUMU (Memory Status Indicator)
  // --------------------------------------------------------------------------
  auto *statusCard = makeCard(section.page, QStringLiteral("SİSTEM BELLEK DURUMU"));
  auto *statusLabel = new QLabel(statusCard);
  statusLabel->setObjectName(QStringLiteral("settings-memory-status-label"));

  auto updateMemoryStatus = [statusLabel, perfManager]() {
    ardali::MemoryPressureLevel level = ardali::MemoryPressureLevel::Normal;
    if (perfManager && perfManager->memoryPressureMonitor()) {
      level = perfManager->memoryPressureMonitor()->currentPressureLevel();
    }
    QString text;
    QString color;
    switch (level) {
      case ardali::MemoryPressureLevel::Critical:
        text = QStringLiteral("Bellek kullanımı çok yüksek");
        color = QStringLiteral("#f28b82");
        break;
      case ardali::MemoryPressureLevel::Moderate:
        text = QStringLiteral("Bellek kullanımı yüksek");
        color = QStringLiteral("#fdd663");
        break;
      case ardali::MemoryPressureLevel::Normal:
      default:
        text = QStringLiteral("Bellek kullanımı normal");
        color = QStringLiteral("#81c995");
        break;
    }
    statusLabel->setText(text);
    statusLabel->setStyleSheet(QStringLiteral("color: %1; font-weight: 600;").arg(color));
  };

  updateMemoryStatus();

  if (perfManager && perfManager->memoryPressureMonitor()) {
    connect(perfManager->memoryPressureMonitor(), &ardali::SystemMemoryPressureMonitor::pressureLevelChanged,
            statusLabel, [updateMemoryStatus](ardali::MemoryPressureLevel) {
              updateMemoryStatus();
            });
  }

  addRow(statusCard, settingRow(
      statusCard,
      QStringLiteral("Bellek durumu"),
      QStringLiteral("İşletim sistemi ve kullanılabilir RAM seviyesi."),
      statusLabel,
      BrowserIcon::Info,
      true));
  section.layout->addWidget(statusCard);

  section.layout->addStretch();
  return section.page;
}

QWidget *SettingsPage::createContentSection() {
  Section section = makeSection(QStringLiteral("İçerik"), QStringLiteral("Web sitelerinin JavaScript, resim, çerez ve açılır pencere davranışlarını yönetin."));

  auto *contentCard = makeCard(section.page, QStringLiteral("İÇERİK"));

  // Çerezleri engelle
  const auto getCookieSub = [this] {
    const auto pol = profileService_->cookiePolicy();
    if (pol == QStringLiteral("block_all")) return QStringLiteral("Tüm çerezler engelleniyor");
    if (pol == QStringLiteral("allow_all")) return QStringLiteral("Tüm çerezlere izin veriliyor");
    return QStringLiteral("Üçüncü taraf çerezleri engelleniyor");
  };
  InteractiveSettingRowResult cookieRow;
  cookieRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Cookie, QStringLiteral("Çerezleri engelle"), getCookieSub(),
      [this](QLabel *subLabel) {
        const auto pol = profileService_->cookiePolicy();
        int idx = pol == QStringLiteral("block_all") ? 2 : (pol == QStringLiteral("allow_all") ? 1 : 0);
        showOptionDialog(
            this, QStringLiteral("Çerez Ayarları"), BrowserIcon::Cookie,
            QStringLiteral("Web sitelerinin çerez saklama ve izleme verisi davranışını belirleyin."),
            {
                {QStringLiteral("Üçüncü taraf çerezleri engelle (önerilir)"), QStringLiteral("Siteler normal çalışır ancak üçüncü taraf izleyici ve analiz çerezleri engellenir.")},
                {QStringLiteral("Tüm çerezlere izin ver"), QStringLiteral("Siteler hem birinci hem de üçüncü taraf çerezleri saklayabilir.")},
                {QStringLiteral("Tüm çerezleri engelle (önerilmez)"), QStringLiteral("Çerezler tamamen engellenir. Birçok web sitesi oturum açma işlevi çalışmayabilir.")}
            },
            idx,
            [this, subLabel](int chosen) {
              QString newPol = chosen == 2 ? QStringLiteral("block_all") : (chosen == 1 ? QStringLiteral("allow_all") : QStringLiteral("third_party"));
              profileService_->setCookiePolicy(newPol);
              if (subLabel) {
                subLabel->setText(chosen == 2 ? QStringLiteral("Tüm çerezler engelleniyor") : (chosen == 1 ? QStringLiteral("Tüm çerezlere izin veriliyor") : QStringLiteral("Üçüncü taraf çerezleri engelleniyor")));
              }
            });
      });
  addRow(contentCard, cookieRow.frame);

  // JavaScript
  const auto getJsSub = [this] {
    return profileService_->isJavascriptEnabled()
        ? QStringLiteral("Siteler JavaScript kullanabilir")
        : QStringLiteral("Sitelerin JavaScript kullanmasına izin verme");
  };
  InteractiveSettingRowResult jsRow;
  jsRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Javascript, QStringLiteral("JavaScript"), getJsSub(),
      [this](QLabel *subLabel) {
        showOptionDialog(
            this, QStringLiteral("JavaScript"), BrowserIcon::Javascript,
            QStringLiteral("Web sitelerinin JavaScript kodu çalıştırma davranışını yönetin."),
            {
                {QStringLiteral("Siteler JavaScript kullanabilir (önerilir)"), QStringLiteral("Web siteleri etkileşimli özellikler, dinamik butonlar ve modern içeriklerle sorunsuz çalışır.")},
                {QStringLiteral("Sitelerin JavaScript kullanmasına izin verme"), QStringLiteral("JavaScript kodu engellenir. Sitelerin dinamik özellikleri çalışmayabilir ancak hız ve güvenlik artar.")}
            },
            profileService_->isJavascriptEnabled() ? 0 : 1,
            [this, subLabel](int chosen) {
              profileService_->setJavascriptEnabled(chosen == 0);
              if (subLabel) {
                subLabel->setText(chosen == 0 ? QStringLiteral("Siteler JavaScript kullanabilir") : QStringLiteral("Sitelerin JavaScript kullanmasına izin verme"));
              }
            });
      });
  addRow(contentCard, jsRow.frame);

  // Resimler
  const auto getImgSub = [this] {
    return profileService_->isAutoLoadImagesEnabled()
        ? QStringLiteral("Siteler resim gösterebilir")
        : QStringLiteral("Sitelerin resim göstermesine izin verme");
  };
  InteractiveSettingRowResult imgRow;
  imgRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Image, QStringLiteral("Resimler"), getImgSub(),
      [this](QLabel *subLabel) {
        showOptionDialog(
            this, QStringLiteral("Resimler"), BrowserIcon::Image,
            QStringLiteral("Web sitelerinin resim ve grafik yükleme davranışını belirleyin."),
            {
                {QStringLiteral("Siteler resim gösterebilir (önerilir)"), QStringLiteral("Tüm web sitelerinde resimler, fotoğraflar ve grafikler otomatik yüklenir.")},
                {QStringLiteral("Sitelerin resim göstermesine izin verme"), QStringLiteral("Resimler yüklenmez; veri tasarrufu sağlanır ve yalnızca metin içerikler gösterilir.")}
            },
            profileService_->isAutoLoadImagesEnabled() ? 0 : 1,
            [this, subLabel](int chosen) {
              profileService_->setAutoLoadImagesEnabled(chosen == 0);
              if (subLabel) {
                subLabel->setText(chosen == 0 ? QStringLiteral("Siteler resim gösterebilir") : QStringLiteral("Sitelerin resim göstermesine izin verme"));
              }
            });
      });
  addRow(contentCard, imgRow.frame);

  // Pop-up ve yönlendirmeler
  const auto getPopupSub = [this] {
    return !profileService_->arePopupsAllowed()
        ? QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme")
        : QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir");
  };
  InteractiveSettingRowResult popupRow;
  popupRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Popup, QStringLiteral("Pop-up ve yönlendirmeler"), getPopupSub(),
      [this](QLabel *subLabel) {
        showOptionDialog(
            this, QStringLiteral("Pop-up ve yönlendirmeler"), BrowserIcon::Popup,
            QStringLiteral("Sitelerin yeni pencere açma veya otomatik yönlendirme davranışını belirleyin."),
            {
                {QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme (önerilir)"), QStringLiteral("İstenmeyen açılır pencereler ve otomatik yönlendirmeler engellenir.")},
                {QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir"), QStringLiteral("Web sitelerinin pop-up pencereler açmasına izin verilir.")}
            },
            !profileService_->arePopupsAllowed() ? 0 : 1,
            [this, subLabel](int chosen) {
              profileService_->setPopupsAllowed(chosen == 1);
              if (subLabel) {
                subLabel->setText(chosen == 0 ? QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme") : QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir"));
              }
            });
      });
  addRow(contentCard, popupRow.frame);

  section.layout->addWidget(contentCard);
  section.layout->addStretch();
  return section.page;
}

class DynamicStackedWidget final : public QStackedWidget {
 public:
  explicit DynamicStackedWidget(QWidget *parent = nullptr) : QStackedWidget(parent) {
    connect(this, &QStackedWidget::currentChanged, this, [this](int) {
      updateGeometry();
      adjustSize();
    });
  }
  QSize sizeHint() const override {
    if (currentWidget()) return currentWidget()->sizeHint();
    return QStackedWidget::sizeHint();
  }
  QSize minimumSizeHint() const override {
    if (currentWidget()) return currentWidget()->minimumSizeHint();
    return QStackedWidget::minimumSizeHint();
  }
};

class PrivacyDetailSubpage final : public QWidget {
 public:
  PrivacyDetailSubpage(BrowserProfileService *profileService, std::function<void()> onBack, QWidget *parent = nullptr)
      : QWidget(parent), profileService_(profileService), onBack_(std::move(onBack)) {
    setObjectName(QStringLiteral("settings-privacy-subpage"));
    auto *outer = new QHBoxLayout(this);
    outer->setContentsMargins(22, 20, 22, 32);
    outer->addStretch(1);

    auto *column = new QWidget(this);
    column->setMaximumWidth(kContentMaxWidth);
    column->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    auto *layout = new QVBoxLayout(column);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(16);

    // 1. Header: Back button + Title + Help button + Search Filter
    auto *header = new QWidget(column);
    auto *headerLayout = new QHBoxLayout(header);
    headerLayout->setContentsMargins(0, 0, 0, 4);
    headerLayout->setSpacing(12);

    auto *backBtn = new QPushButton(header);
    backBtn->setObjectName(QStringLiteral("settings-subpage-back-btn"));
    backBtn->setFixedSize(36, 36);
    backBtn->setCursor(Qt::PointingHandCursor);
    backBtn->setIcon(BrowserIcons::icon(BrowserIcon::ArrowLeft));
    backBtn->setIconSize(QSize(18, 18));
    backBtn->setToolTip(QStringLiteral("Geri"));
    backBtn->setAccessibleName(QStringLiteral("Geri"));
    connect(backBtn, &QPushButton::clicked, this, [this] {
      if (onBack_) onBack_();
    });
    headerLayout->addWidget(backBtn, 0, Qt::AlignVCenter);

    titleLabel_ = new QLabel(header);
    titleLabel_->setObjectName(QStringLiteral("settings-subpage-title"));
    titleLabel_->setStyleSheet(QStringLiteral("font-size: 22px; font-weight: 700; color: #f3f7fc;"));
    headerLayout->addWidget(titleLabel_, 0, Qt::AlignVCenter);

    helpBtn_ = new QPushButton(header);
    helpBtn_->setObjectName(QStringLiteral("settings-subpage-help-btn"));
    helpBtn_->setFixedSize(32, 32);
    helpBtn_->setCursor(Qt::PointingHandCursor);
    helpBtn_->setIcon(BrowserIcons::icon(BrowserIcon::Help));
    helpBtn_->setIconSize(QSize(18, 18));
    helpBtn_->setToolTip(QStringLiteral("Üçüncü taraf çerezleri hakkında"));
    helpBtn_->setVisible(false);
    connect(helpBtn_, &QPushButton::clicked, this, [this] {
      QMessageBox::information(this, QStringLiteral("Üçüncü Taraf Çerezleri"),
                               QStringLiteral("Üçüncü taraf çerezleri, ziyaret ettiğiniz siteden farklı bir web sitesine ait çerezlerdir.\n\n"
                                              "ArDali Kalkanlar bu tür takip çerezlerini varsayılan olarak engeller. "
                                              "Buraya izin verilen olarak eklediğiniz siteler üçüncü taraf çerezlerini kullanabilir."));
    });
    headerLayout->addWidget(helpBtn_, 0, Qt::AlignVCenter);

    headerLayout->addStretch(1);

    filterEdit_ = new QLineEdit(header);
    filterEdit_->setObjectName(QStringLiteral("settings-subpage-filter"));
    filterEdit_->setPlaceholderText(QStringLiteral("Sayfadaki siteleri filtrele"));
    filterEdit_->setFixedWidth(240);
    filterEdit_->setClearButtonEnabled(true);
    filterEdit_->addAction(BrowserIcons::icon(BrowserIcon::Search), QLineEdit::LeadingPosition);
    connect(filterEdit_, &QLineEdit::textChanged, this, &PrivacyDetailSubpage::filterSites);
    headerLayout->addWidget(filterEdit_, 0, Qt::AlignVCenter);

    layout->addWidget(header);

    // 2. Microphone device selector (only shown when configured for microphone)
    deviceContainer_ = new QWidget(column);
    auto *devLayout = new QHBoxLayout(deviceContainer_);
    devLayout->setContentsMargins(0, 0, 0, 2);
    devLayout->setSpacing(12);
    auto *devLabel = new QLabel(QStringLiteral("Mikrofon aygıtı:"), deviceContainer_);
    devLabel->setStyleSheet(QStringLiteral("color: #edf5fc; font-size: 13px; font-weight: 600;"));
    devLayout->addWidget(devLabel);
    deviceCombo_ = new QComboBox(deviceContainer_);
    deviceCombo_->setMinimumWidth(320);
    deviceCombo_->addItem(QStringLiteral("Sistem varsayılanı (Dahili Mikrofon)"), QStringLiteral("default"));
    deviceCombo_->addItem(QStringLiteral("Analog Giriş (Dahili Ses Kartı)"), QStringLiteral("analog"));
    deviceCombo_->addItem(QStringLiteral("Harici Mikrofon / Kulaklık Girişi"), QStringLiteral("external"));
    devLayout->addWidget(deviceCombo_);
    devLayout->addStretch(1);
    deviceContainer_->setVisible(false);
    layout->addWidget(deviceContainer_);

    connect(deviceCombo_, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
      if (idx >= 0 && profileService_ && hasDeviceSelector_) {
        profileService_->setPreferredAudioInputDevice(deviceCombo_->itemText(idx));
      }
    });

    // 3. Intro description
    introLabel_ = new QLabel(column);
    introLabel_->setObjectName(QStringLiteral("settings-subpage-intro"));
    introLabel_->setStyleSheet(QStringLiteral("color: #98a8b9; font-size: 13px; line-height: 1.4; margin-bottom: 4px;"));
    introLabel_->setWordWrap(true);
    layout->addWidget(introLabel_);

    // 4. Varsayılan davranış Card
    defaultCard_ = makeCard(column, QStringLiteral("VARSAYILAN DAVRANIŞ"));

    auto *defaultIntro = new QLabel(QStringLiteral("Siteler, siz ziyaret ettiğinizde otomatik olarak bu ayarı izler"), defaultCard_);
    defaultIntro->setStyleSheet(QStringLiteral("color: #7f91a3; font-size: 12px; padding: 0 18px 8px;"));
    cardLayout(defaultCard_)->addWidget(defaultIntro);

    defaultBtnGroup_ = new QButtonGroup(defaultCard_);

    // Option 1: Allow / Ask
    allowFrame_ = new ClickableFrame(defaultCard_);
    allowFrame_->setObjectName(QStringLiteral("settings-row"));
    allowFrame_->setCursor(Qt::PointingHandCursor);
    auto *allowLayout = new QVBoxLayout(allowFrame_);
    allowLayout->setContentsMargins(18, 12, 18, 12);
    allowLayout->setSpacing(8);

    auto *allowTopRow = new QWidget(allowFrame_);
    auto *allowTopLayout = new QHBoxLayout(allowTopRow);
    allowTopLayout->setContentsMargins(0, 0, 0, 0);
    allowTopLayout->setSpacing(12);

    radioAllow_ = new QRadioButton(allowTopRow);
    radioAllow_->setCursor(Qt::PointingHandCursor);
    defaultBtnGroup_->addButton(radioAllow_, 0);
    allowTopLayout->addWidget(radioAllow_, 0, Qt::AlignVCenter);

    allowIconLabel_ = new QLabel(allowTopRow);
    allowIconLabel_->setFixedSize(20, 20);
    allowTopLayout->addWidget(allowIconLabel_, 0, Qt::AlignVCenter);

    allowTitleLabel_ = new QLabel(allowTopRow);
    allowTitleLabel_->setObjectName(QStringLiteral("settings-row-title"));
    allowTopLayout->addWidget(allowTitleLabel_, 1, Qt::AlignVCenter);

    allowLayout->addWidget(allowTopRow);

    // Sub-radios for display mode (only for location and notifications)
    displayModeContainer_ = new QWidget(allowFrame_);
    auto *dmLayout = new QVBoxLayout(displayModeContainer_);
    dmLayout->setContentsMargins(36, 4, 0, 4);
    dmLayout->setSpacing(8);

    auto *dmHeading = new QLabel(QStringLiteral("İstekler nasıl gösterilsin?"), displayModeContainer_);
    dmHeading->setStyleSheet(QStringLiteral("color: #d1dde8; font-size: 13px; font-weight: 600; margin-top: 2px;"));
    dmLayout->addWidget(dmHeading);

    dmGroup_ = new QButtonGroup(displayModeContainer_);

    radioCollapseAll_ = new QRadioButton(QStringLiteral("Adres çubuğundaki tüm istekleri daralt"), displayModeContainer_);
    radioCollapseAll_->setCursor(Qt::PointingHandCursor);
    dmGroup_->addButton(radioCollapseAll_, 0);
    dmLayout->addWidget(radioCollapseAll_);

    radioQuiet_ = new QRadioButton(QStringLiteral("İstenmeyen istekleri daralt (önerilir)"), displayModeContainer_);
    radioQuiet_->setCursor(Qt::PointingHandCursor);
    dmGroup_->addButton(radioQuiet_, 1);
    dmLayout->addWidget(radioQuiet_);

    radioExpandAll_ = new QRadioButton(QStringLiteral("Tüm istekleri genişlet"), displayModeContainer_);
    radioExpandAll_->setCursor(Qt::PointingHandCursor);
    dmGroup_->addButton(radioExpandAll_, 2);
    dmLayout->addWidget(radioExpandAll_);

    allowLayout->addWidget(displayModeContainer_);

    allowFrame_->clicked = [this] {
      radioAllow_->setChecked(true);
      onDefaultPolicyChanged(0);
    };
    addRow(defaultCard_, allowFrame_);

    // Option 2 (Middle): For siteData ("Tüm pencereleri kapattığınızda verileri sil")
    middleFrame_ = new ClickableFrame(defaultCard_);
    middleFrame_->setObjectName(QStringLiteral("settings-row"));
    middleFrame_->setCursor(Qt::PointingHandCursor);
    auto *middleLayout = new QHBoxLayout(middleFrame_);
    middleLayout->setContentsMargins(18, 12, 18, 12);
    middleLayout->setSpacing(12);

    radioMiddle_ = new QRadioButton(middleFrame_);
    radioMiddle_->setCursor(Qt::PointingHandCursor);
    defaultBtnGroup_->addButton(radioMiddle_, 2);
    middleLayout->addWidget(radioMiddle_, 0, Qt::AlignVCenter);

    middleIconLabel_ = new QLabel(middleFrame_);
    middleIconLabel_->setFixedSize(20, 20);
    middleLayout->addWidget(middleIconLabel_, 0, Qt::AlignVCenter);

    auto *middleTextCol = new QWidget(middleFrame_);
    auto *middleTextLayout = new QVBoxLayout(middleTextCol);
    middleTextLayout->setContentsMargins(0, 0, 0, 0);
    middleTextLayout->setSpacing(3);

    middleTitleLabel_ = new QLabel(middleTextCol);
    middleTitleLabel_->setObjectName(QStringLiteral("settings-row-title"));
    middleTextLayout->addWidget(middleTitleLabel_);

    middleSubLabel_ = new QLabel(middleTextCol);
    middleSubLabel_->setObjectName(QStringLiteral("settings-row-description"));
    middleTextLayout->addWidget(middleSubLabel_);

    middleLayout->addWidget(middleTextCol, 1, Qt::AlignVCenter);

    middleFrame_->clicked = [this] {
      radioMiddle_->setChecked(true);
      onDefaultPolicyChanged(2);
    };
    addRow(defaultCard_, middleFrame_);
    middleFrame_->setVisible(false);

    // Option 3: Deny / Block / Alternative
    denyFrame_ = new ClickableFrame(defaultCard_);
    denyFrame_->setObjectName(QStringLiteral("settings-row"));
    denyFrame_->setCursor(Qt::PointingHandCursor);
    auto *denyLayout = new QHBoxLayout(denyFrame_);
    denyLayout->setContentsMargins(18, 12, 18, 12);
    denyLayout->setSpacing(12);

    radioDeny_ = new QRadioButton(denyFrame_);
    radioDeny_->setCursor(Qt::PointingHandCursor);
    defaultBtnGroup_->addButton(radioDeny_, 1);
    denyLayout->addWidget(radioDeny_, 0, Qt::AlignVCenter);

    denyIconLabel_ = new QLabel(denyFrame_);
    denyIconLabel_->setFixedSize(20, 20);
    denyLayout->addWidget(denyIconLabel_, 0, Qt::AlignVCenter);

    auto *denyTextCol = new QWidget(denyFrame_);
    auto *denyTextLayout = new QVBoxLayout(denyTextCol);
    denyTextLayout->setContentsMargins(0, 0, 0, 0);
    denyTextLayout->setSpacing(3);

    denyTitleLabel_ = new QLabel(denyTextCol);
    denyTitleLabel_->setObjectName(QStringLiteral("settings-row-title"));
    denyTextLayout->addWidget(denyTitleLabel_);

    denySubLabel_ = new QLabel(denyTextCol);
    denySubLabel_->setObjectName(QStringLiteral("settings-row-description"));
    denyTextLayout->addWidget(denySubLabel_);

    denyLayout->addWidget(denyTextCol, 1, Qt::AlignVCenter);

    denyFrame_->clicked = [this] {
      radioDeny_->setChecked(true);
      onDefaultPolicyChanged(1);
    };
    addRow(defaultCard_, denyFrame_);

    layout->addWidget(defaultCard_);

    connect(defaultBtnGroup_, &QButtonGroup::idClicked, this, [this](int id) {
      onDefaultPolicyChanged(id);
    });

    connect(dmGroup_, &QButtonGroup::idClicked, this, [this](int id) {
      if (radioDeny_->isChecked()) return;
      QString mode = QStringLiteral("quiet");
      QString policy = QStringLiteral("quiet");
      if (id == 0) {
        mode = QStringLiteral("collapse_all");
        policy = QStringLiteral("quiet");
      } else if (id == 2) {
        mode = QStringLiteral("expand_all");
        policy = QStringLiteral("prompt");
      }
      profileService_->setRequestDisplayMode(permissionKey_, mode);
      profileService_->setPermissionDefaultPolicy(permissionKey_, policy);
    });

    // Zoom Card (only for zoomLevels)
    zoomCard_ = makeCard(column, QStringLiteral("VARSAYILAN YAKINLAŞTIRMA"));
    auto *zoomRowWidget = new QWidget(zoomCard_);
    auto *zoomRowLayout = new QHBoxLayout(zoomRowWidget);
    zoomRowLayout->setContentsMargins(18, 12, 18, 12);
    zoomRowLayout->setSpacing(12);
    auto *zoomLbl = new QLabel(QStringLiteral("Varsayılan sayfa yakınlaştırma düzeyi:"), zoomRowWidget);
    zoomLbl->setStyleSheet(QStringLiteral("color: #e7edf5; font-size: 14px; font-weight: 500;"));
    zoomRowLayout->addWidget(zoomLbl, 1);
    zoomCombo_ = new QComboBox(zoomRowWidget);
    zoomCombo_->setMinimumWidth(160);
    zoomCombo_->addItems({QStringLiteral("%25"), QStringLiteral("%33"), QStringLiteral("%50"),
                          QStringLiteral("%67"), QStringLiteral("%75"), QStringLiteral("%80"),
                          QStringLiteral("%90"), QStringLiteral("%100 (Varsayılan)"),
                          QStringLiteral("%110"), QStringLiteral("%125"), QStringLiteral("%150"),
                          QStringLiteral("%175"), QStringLiteral("%200"), QStringLiteral("%250"),
                          QStringLiteral("%300"), QStringLiteral("%400"), QStringLiteral("%500")});
    zoomRowLayout->addWidget(zoomCombo_);
    addRow(zoomCard_, zoomRowWidget);
    zoomCard_->setVisible(false);
    layout->addWidget(zoomCard_);

    connect(zoomCombo_, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int idx) {
      if (permissionKey_ == QLatin1String("zoomLevels")) {
        const QString text = zoomCombo_->itemText(idx);
        QSettings().setValue(QStringLiteral("appearance/defaultZoom"), text);
      }
    });

    // 5. Özelleştirilmiş Davranışlar Card (default for permissions & content)
    customCard_ = makeCard(column, QStringLiteral("ÖZELLEŞTİRİLMİŞ DAVRANIŞLAR"));

    auto *customIntro = new QLabel(QStringLiteral("Aşağıdaki siteler, varsayılan yerine özel bir ayar kullanır"), customCard_);
    customIntro->setStyleSheet(QStringLiteral("color: #7f91a3; font-size: 12px; padding: 0 18px 8px;"));
    cardLayout(customCard_)->addWidget(customIntro);

    // Denied group
    auto *deniedSection = new QWidget(customCard_);
    auto *deniedSecLayout = new QVBoxLayout(deniedSection);
    deniedSecLayout->setContentsMargins(0, 0, 0, 0);
    deniedSecLayout->setSpacing(0);

    auto *deniedHeader = new QWidget(deniedSection);
    auto *deniedHLayout = new QHBoxLayout(deniedHeader);
    deniedHLayout->setContentsMargins(18, 12, 18, 8);
    deniedHLayout->setSpacing(12);

    deniedTitleLabel_ = new QLabel(deniedHeader);
    deniedTitleLabel_->setStyleSheet(QStringLiteral("color: #e7edf5; font-size: 14px; font-weight: 600;"));
    deniedHLayout->addWidget(deniedTitleLabel_, 1);

    auto *addDeniedBtn = new QPushButton(QStringLiteral("Ekle"), deniedHeader);
    addDeniedBtn->setObjectName(QStringLiteral("settings-add-btn"));
    connect(addDeniedBtn, &QPushButton::clicked, this, [this] { showAddSiteDialog(false); });
    deniedHLayout->addWidget(addDeniedBtn);
    deniedSecLayout->addWidget(deniedHeader);

    deniedListWidget_ = new QWidget(deniedSection);
    deniedListLayout_ = new QVBoxLayout(deniedListWidget_);
    deniedListLayout_->setContentsMargins(0, 0, 0, 0);
    deniedListLayout_->setSpacing(0);
    deniedSecLayout->addWidget(deniedListWidget_);

    addRow(customCard_, deniedSection);

    // Allowed group
    auto *allowedSection = new QWidget(customCard_);
    auto *allowedSecLayout = new QVBoxLayout(allowedSection);
    allowedSecLayout->setContentsMargins(0, 0, 0, 0);
    allowedSecLayout->setSpacing(0);

    auto *allowedHeader = new QWidget(allowedSection);
    auto *allowedHLayout = new QHBoxLayout(allowedHeader);
    allowedHLayout->setContentsMargins(18, 12, 18, 8);
    allowedHLayout->setSpacing(12);

    allowedTitleLabel_ = new QLabel(allowedHeader);
    allowedTitleLabel_->setStyleSheet(QStringLiteral("color: #e7edf5; font-size: 14px; font-weight: 600;"));
    allowedHLayout->addWidget(allowedTitleLabel_, 1);

    auto *addAllowedBtn = new QPushButton(QStringLiteral("Ekle"), allowedHeader);
    addAllowedBtn->setObjectName(QStringLiteral("settings-add-btn"));
    connect(addAllowedBtn, &QPushButton::clicked, this, [this] { showAddSiteDialog(true); });
    allowedHLayout->addWidget(addAllowedBtn);
    allowedSecLayout->addWidget(allowedHeader);

    allowedListWidget_ = new QWidget(allowedSection);
    allowedListLayout_ = new QVBoxLayout(allowedListWidget_);
    allowedListLayout_->setContentsMargins(0, 0, 0, 0);
    allowedListLayout_->setSpacing(0);
    allowedSecLayout->addWidget(allowedListWidget_);

    addRow(customCard_, allowedSection);

    layout->addWidget(customCard_);

    // 6. Üçüncü taraf çerezleri Card (only shown for thirdPartyCookies)
    cookiesCard_ = makeCard(column, QStringLiteral("ÖZELLEŞTİRİLMİŞ DAVRANIŞLAR"));

    auto *cookiesSection = new QWidget(cookiesCard_);
    auto *cookiesSecLayout = new QVBoxLayout(cookiesSection);
    cookiesSecLayout->setContentsMargins(0, 0, 0, 0);
    cookiesSecLayout->setSpacing(0);

    auto *cookiesHeader = new QWidget(cookiesSection);
    auto *cookiesHLayout = new QHBoxLayout(cookiesHeader);
    cookiesHLayout->setContentsMargins(18, 12, 18, 8);
    cookiesHLayout->setSpacing(12);

    auto *cookiesTitleLabel = new QLabel(QStringLiteral("Üçüncü taraf çerezlerini kullanmasına izin verilen siteler"), cookiesHeader);
    cookiesTitleLabel->setStyleSheet(QStringLiteral("color: #e7edf5; font-size: 14px; font-weight: 600;"));
    cookiesHLayout->addWidget(cookiesTitleLabel, 1);

    auto *addCookiesBtn = new QPushButton(QStringLiteral("Ekle"), cookiesHeader);
    addCookiesBtn->setObjectName(QStringLiteral("settings-add-btn"));
    connect(addCookiesBtn, &QPushButton::clicked, this, [this] { showAddSiteDialog(true); });
    cookiesHLayout->addWidget(addCookiesBtn);
    cookiesSecLayout->addWidget(cookiesHeader);

    auto *noticeBox = new QFrame(cookiesSection);
    noticeBox->setObjectName(QStringLiteral("settings-cookies-notice"));
    noticeBox->setStyleSheet(QStringLiteral(R"CSS(
      QFrame#settings-cookies-notice {
        background: rgba(45, 80, 115, 0.25);
        border: 1px solid rgba(88, 166, 255, 0.25);
        border-radius: 8px;
        margin: 4px 18px 12px 18px;
      }
    )CSS"));
    auto *noticeLayout = new QHBoxLayout(noticeBox);
    noticeLayout->setContentsMargins(14, 10, 14, 10);
    noticeLayout->setSpacing(10);
    auto *noticeIcon = new QLabel(noticeBox);
    noticeIcon->setPixmap(BrowserIcons::icon(BrowserIcon::Privacy).pixmap(18, 18));
    noticeIcon->setFixedSize(18, 18);
    noticeLayout->addWidget(noticeIcon, 0, Qt::AlignVCenter);
    auto *noticeLabel = new QLabel(QStringLiteral("Bazı çerez ayarları ArDali Kalkanlar tarafından kontrol edilir. Bunları ardali://blocker sayfasında görebilirsiniz."), noticeBox);
    noticeLabel->setStyleSheet(QStringLiteral("color: #9ac2ef; font-size: 13px; background: transparent; border: none;"));
    noticeLabel->setWordWrap(true);
    noticeLayout->addWidget(noticeLabel, 1, Qt::AlignVCenter);
    cookiesSecLayout->addWidget(noticeBox);

    cookiesListWidget_ = new QWidget(cookiesSection);
    cookiesListLayout_ = new QVBoxLayout(cookiesListWidget_);
    cookiesListLayout_->setContentsMargins(0, 0, 0, 0);
    cookiesListLayout_->setSpacing(0);
    cookiesSecLayout->addWidget(cookiesListWidget_);

    addRow(cookiesCard_, cookiesSection);
    cookiesCard_->setVisible(false);
    layout->addWidget(cookiesCard_);

    layout->addStretch(1);

    outer->addWidget(column, 2);
    outer->addStretch(1);
  }

  void configure(const QString &permissionKey) {
    permissionKey_ = permissionKey;
    if (filterEdit_) {
      const QSignalBlocker blocker(filterEdit_);
      filterEdit_->clear();
    }

    if (permissionKey == QLatin1String("geolocation")) {
      titleLabel_->setText(QStringLiteral("Konum"));
      introLabel_->setText(QStringLiteral("Yerel haberler veya yakındaki mağazalar gibi alakalı özellikleri ya da bilgileri sunmak için siteler genellikle konumunuzu kullanır"));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Location).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::LocationSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler konum bilgimi isteyebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin konumumu görmesine izin verme"));
      denySubLabel_->setText(QStringLiteral("Konumunuzu gerektiren özellikler çalışmaz"));
      deniedTitleLabel_->setText(QStringLiteral("Konumunuzu görmesine izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Konumunuzu görmesine izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = true;
    } else if (permissionKey == QLatin1String("camera")) {
      titleLabel_->setText(QStringLiteral("Kamera"));
      introLabel_->setText(QStringLiteral("Görüntülü sohbet gibi iletişim özelliklerinin kullanılması için siteler genellikle video kameranızı kullanır"));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Camera).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::CameraSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler kameranızı kullanmak isteyebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin kameramı kullanmasına izin verme"));
      denySubLabel_->setText(QStringLiteral("Kameranın kullanılmasını gerektiren özellikler çalışmaz"));
      deniedTitleLabel_->setText(QStringLiteral("Kameranızı kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Kameranızı kullanmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("microphone")) {
      titleLabel_->setText(QStringLiteral("Mikrofon"));
      introLabel_->setText(QStringLiteral("Görüntülü sohbet gibi iletişim özellikleri için siteler genellikle mikrofonunuzu kullanır"));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Microphone).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::MicrophoneSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler mikrofonunuzu kullanmak isteyebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin mikrofonumu kullanmasına izin verme"));
      denySubLabel_->setText(QStringLiteral("Mikrofonun kullanılmasını gerektiren özellikler çalışmaz"));
      deniedTitleLabel_->setText(QStringLiteral("Mikrofonunuzu kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Mikrofonunuzu kullanmasına izin verilenler"));
      hasDeviceSelector_ = true;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("notifications")) {
      titleLabel_->setText(QStringLiteral("Bildirimler"));
      introLabel_->setText(QStringLiteral("Siteler genellikle son dakika haberleri veya sohbet mesajları konusunda sizi bilgilendirmek için bildirim gönderir."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Notification).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::NotificationSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler bildirim gönderme izni isteyebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin bildirim göndermesine izin verme"));
      denySubLabel_->setText(QStringLiteral("Bildirim gönderilmesini gerektiren özellikler çalışmaz"));
      deniedTitleLabel_->setText(QStringLiteral("Bildirim göndermesine izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Bildirim göndermesine izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = true;
    } else if (permissionKey == QLatin1String("clipboard")) {
      titleLabel_->setText(QStringLiteral("Pano"));
      introLabel_->setText(QStringLiteral("Sitelerin panonuzdaki metin ve görselleri okuma/yazma davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Clipboard).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Clipboard).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler panoyu görebilir ve değiştirebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin panoyu görmesine veya değiştirmesine izin verme"));
      denySubLabel_->setText(QStringLiteral("Pano erişim istekleri otomatik olarak engellenir"));
      deniedTitleLabel_->setText(QStringLiteral("Panoyu kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Panoyu kullanmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("localFonts")) {
      titleLabel_->setText(QStringLiteral("Yerel yazı tipleri"));
      introLabel_->setText(QStringLiteral("Sitelerin cihazınızda yüklü yerel yazı tiplerine erişim davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Fonts).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Fonts).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler yüklü yazı tiplerini kullanabilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin yüklü yazı tiplerini kullanmasına izin verme"));
      denySubLabel_->setText(QStringLiteral("Yerel yazı tiplerine erişim engellenir"));
      deniedTitleLabel_->setText(QStringLiteral("Yerel yazı tiplerini kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Yerel yazı tiplerini kullanmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("mouseLock")) {
      titleLabel_->setText(QStringLiteral("Fare kilidi"));
      introLabel_->setText(QStringLiteral("Sitelerin fare imlecinizi kilitleme davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Mouse).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Mouse).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler fare imlecini kilitleyebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin fare imlecini kilitlemesine izin verme"));
      denySubLabel_->setText(QStringLiteral("Fare kilitleme istekleri engellenir"));
      deniedTitleLabel_->setText(QStringLiteral("Fareyi kilitlemesine izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Fareyi kilitlemesine izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("screenShare")) {
      titleLabel_->setText(QStringLiteral("Ekran paylaşımı"));
      introLabel_->setText(QStringLiteral("Web sitelerinin ekranınızı veya bir pencereyi paylaşma iznini belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Window).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Window).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler ekranınızı paylaşmak isteyebilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin ekranınızı paylaşmasını engelle"));
      denySubLabel_->setText(QStringLiteral("Ekran paylaşımı istekleri doğrudan reddedilir"));
      deniedTitleLabel_->setText(QStringLiteral("Ekran paylaşmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Ekran paylaşmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("javascript")) {
      titleLabel_->setText(QStringLiteral("JavaScript"));
      introLabel_->setText(QStringLiteral("Siteler JavaScript'i çalıştırabilir. Bu durum, bazı sitelerin beklendiği gibi çalışmasını engeller, ancak sitelerdeki hareketlerinizi izlemeyi ve güvenlik açıklarından yararlanmayı zorlaştırır."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Javascript).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::JavascriptSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler JavaScript kullanabilir (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin JavaScript kullanmasına izin verme"));
      denySubLabel_->setText(QStringLiteral("JavaScript kullanılmasını gerektiren özellikler çalışmaz"));
      deniedTitleLabel_->setText(QStringLiteral("JavaScript kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("JavaScript kullanmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("images")) {
      titleLabel_->setText(QStringLiteral("Resimler"));
      introLabel_->setText(QStringLiteral("Siteler genellikle resimleri otomatik olarak gösterir. Resimlerin gösterilmesine izin vermemek sayfaların daha hızlı yüklenmesini sağlar ve veri kullanımını azaltır."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Image).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::ImageSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler resim gösterebilir (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin resim göstermesine izin verme"));
      denySubLabel_->setText(QStringLiteral("Resimlerin kullanılmasını gerektiren özellikler çalışmaz"));
      deniedTitleLabel_->setText(QStringLiteral("Resim göstermesine izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Resim göstermesine izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("popups")) {
      titleLabel_->setText(QStringLiteral("Pop-up ve yönlendirmeler"));
      introLabel_->setText(QStringLiteral("Siteler, otomatik olarak yeni sekmeler açmak veya reklam göstermek için genellikle pop-up ve yönlendirmeleri kullanır."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Popup).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::PopupSlash).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler pop-up'lar gönderip yönlendirmeler kullanabilir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme (önerilir)"));
      denySubLabel_->setText(QStringLiteral("Pop-up veya yönlendirme gerektiren özellikler engellenir"));
      deniedTitleLabel_->setText(QStringLiteral("Pop-up göndermesine veya yönlendirme kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Pop-up göndermesine veya yönlendirme kullanmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("thirdPartyCookies")) {
      titleLabel_->setText(QStringLiteral("Üçüncü taraf çerezleri"));
      introLabel_->setText(QStringLiteral("Üçüncü taraf çerezleri, ziyaret ettiğiniz siteden farklı siteler tarafından oluşturulur. Bu çerezler, sitelerdeki hareketlerinizi izlemek ve reklamları kişiselleştirmek için kullanılabilir."));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("sound")) {
      titleLabel_->setText(QStringLiteral("Ses"));
      introLabel_->setText(QStringLiteral("Web sitelerinin ses ve medya oynatma davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Audio).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Audio).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler ses çalabilir (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin ses çalmasına izin verme"));
      denySubLabel_->setText(QStringLiteral("Tüm web siteleri varsayılan olarak sessize alınır"));
      deniedTitleLabel_->setText(QStringLiteral("Ses çalmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Ses çalmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("zoomLevels")) {
      titleLabel_->setText(QStringLiteral("Yakınlaştırma seviyeleri"));
      introLabel_->setText(QStringLiteral("Siteler için özel yakınlaştırma düzeylerini yönetin veya varsayılan sayfa yakınlaştırma oranını belirleyin."));
      deniedTitleLabel_->setText(QStringLiteral("Özel yakınlaştırma uygulanan siteler"));
      allowedTitleLabel_->setText(QStringLiteral("Standart yakınlaştırma kullanan siteler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("pdf")) {
      titleLabel_->setText(QStringLiteral("PDF dokümanları"));
      introLabel_->setText(QStringLiteral("PDF dosyalarının tarayıcıda açılma veya indirilme davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Pdf).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Download).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("PDF'leri ArDali'de aç"));
      denyTitleLabel_->setText(QStringLiteral("PDF'leri indir"));
      denySubLabel_->setText(QStringLiteral("PDF belgeleri otomatik olarak İndirilenler klasörüne kaydedilir"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("protectedContent")) {
      titleLabel_->setText(QStringLiteral("Korumalı içerik kimlikleri"));
      introLabel_->setText(QStringLiteral("Müzik ve video akış sitelerinin (DRM) telif hakkı korumalı medya oynatmak için cihaz kimliğinizi kullanma davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::ProtectedContent).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::ProtectedContent).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Sitelerin korumalı içerik (DRM) kimliklerini kullanmasına izin ver (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin korumalı içerik kimliklerini kullanmasına izin verme"));
      denySubLabel_->setText(QStringLiteral("Cihaz kimliği paylaşılmaz; DRM korumalı bazı medya akışları oynatılamayabilir"));
      deniedTitleLabel_->setText(QStringLiteral("Korumalı içerik kimliklerini kullanmasına izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Korumalı içerik kimliklerini kullanmasına izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("insecureContent")) {
      titleLabel_->setText(QStringLiteral("Güvenli olmayan içerik"));
      introLabel_->setText(QStringLiteral("HTTPS güvenli web sitelerinde HTTP üzerinden yüklenen güvenli olmayan (karışık) içeriklerin davranışını yönetin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::InsecureContent).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::InsecureContent).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Güvenli sitelerde güvenli olmayan içeriği engelle (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Tüm sitelerde güvenli olmayan içeriğe izin ver"));
      denySubLabel_->setText(QStringLiteral("Güvenli olmayan karma içerikler kısıtlama olmadan yüklenir"));
      deniedTitleLabel_->setText(QStringLiteral("Güvenli olmayan içeriği engellenen siteler"));
      allowedTitleLabel_->setText(QStringLiteral("Güvenli olmayan içeriğe izin verilen siteler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("siteData")) {
      titleLabel_->setText(QStringLiteral("Cihaz üzerindeki site verileri"));
      introLabel_->setText(QStringLiteral("Web sitelerinin cihazınızda yerel depolama, IndexedDB ve geçici veriler saklama davranışını belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::SiteData).pixmap(18, 18));
      middleIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::SiteData).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::SiteData).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler, cihazınıza veri kaydedebilir (önerilir)"));
      middleTitleLabel_->setText(QStringLiteral("Tüm pencereleri kapattığınızda verileri sil"));
      middleSubLabel_->setText(QStringLiteral("Tarayıcı kapandığında cihazda depolanan geçici site verileri otomatik temizlenir"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin cihazınıza veri kaydetmesini engelleyin (önerilmez)"));
      denySubLabel_->setText(QStringLiteral("Hiçbir site yerel depolama kullanamaz; bazı siteler çalışmayabilir"));
      deniedTitleLabel_->setText(QStringLiteral("Cihazınıza veri kaydetmesine izin verilmeyenler"));
      allowedTitleLabel_->setText(QStringLiteral("Cihazınıza veri kaydetmesine izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("jsOptimize")) {
      titleLabel_->setText(QStringLiteral("JavaScript optimizasyonu ve güvenlik"));
      introLabel_->setText(QStringLiteral("Web sitelerinde V8 JIT (Just-In-Time) derlemesini ve gelişmiş JavaScript optimizasyonlarını yönetin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::JsOptimize).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::JsOptimize).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Siteler JavaScript optimizasyonunu kullanabilir (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Sitelerin JavaScript optimizasyonunu kullanmasını devre dışı bırak"));
      denySubLabel_->setText(QStringLiteral("JIT kapatılarak bellek istismarlarına karşı maksimum güvenlik sağlanır"));
      deniedTitleLabel_->setText(QStringLiteral("JavaScript optimizasyonu engellenen siteler"));
      allowedTitleLabel_->setText(QStringLiteral("JavaScript optimizasyonuna izin verilen siteler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    } else if (permissionKey == QLatin1String("autoFullscreen")) {
      titleLabel_->setText(QStringLiteral("Otomatik tam ekran"));
      introLabel_->setText(QStringLiteral("Web sitelerinin kullanıcı etkileşimi olmadan tam ekrana geçme iznini belirleyin."));
      allowIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Fullscreen).pixmap(18, 18));
      denyIconLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Fullscreen).pixmap(18, 18));
      allowTitleLabel_->setText(QStringLiteral("Sitelerin kullanıcı etkileşimi olmadan tam ekrana geçmesini engelle (önerilir)"));
      denyTitleLabel_->setText(QStringLiteral("Siteler otomatik olarak tam ekrana geçebilir"));
      denySubLabel_->setText(QStringLiteral("Web siteleri kullanıcı tıklaması olmadan da tam ekrana geçebilir"));
      deniedTitleLabel_->setText(QStringLiteral("Otomatik tam ekrana geçmesi engellenenler"));
      allowedTitleLabel_->setText(QStringLiteral("Otomatik tam ekrana geçmesine izin verilenler"));
      hasDeviceSelector_ = false;
      hasDisplayMode_ = false;
    }

    const bool isCookies = (permissionKey == QLatin1String("thirdPartyCookies"));
    const bool isZoom = (permissionKey == QLatin1String("zoomLevels"));
    const bool isPdf = (permissionKey == QLatin1String("pdf"));
    const bool isSiteData = (permissionKey == QLatin1String("siteData"));

    if (helpBtn_) helpBtn_->setVisible(isCookies);
    if (defaultCard_) defaultCard_->setVisible(!isCookies && !isZoom);
    if (middleFrame_) middleFrame_->setVisible(isSiteData);
    if (zoomCard_) zoomCard_->setVisible(isZoom);
    if (customCard_) customCard_->setVisible(!isCookies && !isPdf);
    if (cookiesCard_) cookiesCard_->setVisible(isCookies);
    if (deviceContainer_) deviceContainer_->setVisible(!isCookies && hasDeviceSelector_);
    if (displayModeContainer_) displayModeContainer_->setVisible(!isCookies && hasDisplayMode_);

    refresh();
  }

  void refresh() {
    if (!profileService_ || permissionKey_.isEmpty()) return;

    if (permissionKey_ == QLatin1String("thirdPartyCookies")) {
      populateSiteList(cookiesListLayout_, profileService_->allowedOrigins(permissionKey_), true);
      if (filterEdit_ && !filterEdit_->text().isEmpty()) {
        filterSites(filterEdit_->text());
      }
      return;
    }

    if (permissionKey_ == QLatin1String("zoomLevels")) {
      const QString saved = QSettings().value(QStringLiteral("appearance/defaultZoom"), QStringLiteral("%100 (Varsayılan)")).toString();
      const QSignalBlocker blocker(zoomCombo_);
      int idx = zoomCombo_->findText(saved);
      if (idx >= 0) zoomCombo_->setCurrentIndex(idx);
      populateSiteList(deniedListLayout_, profileService_->deniedOrigins(permissionKey_), false);
      populateSiteList(allowedListLayout_, profileService_->allowedOrigins(permissionKey_), true);
      if (filterEdit_ && !filterEdit_->text().isEmpty()) filterSites(filterEdit_->text());
      return;
    }

    if (permissionKey_ == QLatin1String("siteData")) {
      const QString pol = profileService_->siteDataPolicy();
      const QSignalBlocker blocker(defaultBtnGroup_);
      if (pol == QStringLiteral("delete_on_exit")) {
        radioMiddle_->setChecked(true);
      } else if (pol == QStringLiteral("block")) {
        radioDeny_->setChecked(true);
      } else {
        radioAllow_->setChecked(true);
      }
      populateSiteList(deniedListLayout_, profileService_->deniedOrigins(permissionKey_), false);
      populateSiteList(allowedListLayout_, profileService_->allowedOrigins(permissionKey_), true);
      if (filterEdit_ && !filterEdit_->text().isEmpty()) filterSites(filterEdit_->text());
      return;
    }

    bool isDeny = false;
    if (permissionKey_ == QLatin1String("javascript")) {
      isDeny = !profileService_->isJavascriptEnabled();
    } else if (permissionKey_ == QLatin1String("images")) {
      isDeny = !profileService_->isAutoLoadImagesEnabled();
    } else if (permissionKey_ == QLatin1String("popups")) {
      isDeny = !profileService_->arePopupsAllowed();
    } else if (permissionKey_ == QLatin1String("sound")) {
      isDeny = !profileService_->isSoundAllowed();
    } else if (permissionKey_ == QLatin1String("pdf")) {
      isDeny = !profileService_->openPdfInBrowser();
    } else if (permissionKey_ == QLatin1String("protectedContent")) {
      isDeny = !profileService_->isProtectedContentEnabled();
    } else if (permissionKey_ == QLatin1String("insecureContent")) {
      isDeny = (profileService_->insecureContentPolicy() == QStringLiteral("allow"));
    } else if (permissionKey_ == QLatin1String("jsOptimize")) {
      isDeny = !profileService_->isJsOptimizationEnabled();
    } else if (permissionKey_ == QLatin1String("autoFullscreen")) {
      isDeny = profileService_->isAutoFullscreenAllowed();
    } else {
      const QString policy = profileService_->permissionDefaultPolicy(permissionKey_);
      isDeny = (policy == QLatin1String("deny"));
    }

    {
      const QSignalBlocker blocker(defaultBtnGroup_);
      radioAllow_->setChecked(!isDeny);
      radioDeny_->setChecked(isDeny);
    }

    if (hasDisplayMode_) {
      displayModeContainer_->setVisible(!isDeny);
      const QString mode = profileService_->requestDisplayMode(permissionKey_);
      const QSignalBlocker blocker(dmGroup_);
      if (mode == QLatin1String("collapse_all")) {
        radioCollapseAll_->setChecked(true);
      } else if (mode == QLatin1String("expand_all")) {
        radioExpandAll_->setChecked(true);
      } else {
        radioQuiet_->setChecked(true);
      }
    }

    if (hasDeviceSelector_ && deviceCombo_) {
      const QString dev = profileService_->preferredAudioInputDevice();
      const QSignalBlocker blocker(deviceCombo_);
      int idx = deviceCombo_->findText(dev);
      if (idx >= 0) {
        deviceCombo_->setCurrentIndex(idx);
      } else if (!dev.isEmpty()) {
        deviceCombo_->addItem(dev);
        deviceCombo_->setCurrentIndex(deviceCombo_->count() - 1);
      } else {
        deviceCombo_->setCurrentIndex(0);
      }
    }

    populateSiteList(deniedListLayout_, profileService_->deniedOrigins(permissionKey_), false);
    populateSiteList(allowedListLayout_, profileService_->allowedOrigins(permissionKey_), true);

    if (filterEdit_ && !filterEdit_->text().isEmpty()) {
      filterSites(filterEdit_->text());
    }
  }

 private:
  void filterSites(const QString &query) {
    const QString term = query.trimmed().toCaseFolded();
    auto filterLayout = [term](QVBoxLayout *layout) {
      if (!layout) return;
      for (int i = 0; i < layout->count(); ++i) {
        auto *w = layout->itemAt(i)->widget();
        if (!w) continue;
        const QString origin = w->property("originText").toString();
        if (!origin.isEmpty()) {
          w->setVisible(term.isEmpty() || origin.toCaseFolded().contains(term));
        }
      }
    };
    filterLayout(deniedListLayout_);
    filterLayout(allowedListLayout_);
    filterLayout(cookiesListLayout_);
  }

  void showAddSiteDialog(bool allow) {
    QDialog dialog(this);
    dialog.setWindowTitle(QStringLiteral("Site Ekle"));
    dialog.setWindowFlags(dialog.windowFlags() & ~Qt::WindowContextHelpButtonHint);
    dialog.setMinimumWidth(440);
    dialog.setStyleSheet(QStringLiteral(R"CSS(
      QDialog { background: #151d26; color: #edf5fc; border: 1px solid #2e3b49; border-radius: 12px; }
      QLabel { color: #edf5fc; font-size: 13px; }
      QLineEdit { min-height: 34px; background: #111820; color: #e6edf5; border: 1px solid #3a4958; border-radius: 7px; padding: 0 10px; font-size: 13px; }
      QLineEdit:focus { border: 2px solid #58a6c7; padding: 0 9px; }
      QPushButton { min-height: 32px; background: #243546; color: #edf5fc; border: 1px solid #3c5164; border-radius: 7px; padding: 0 16px; font-weight: 550; }
      QPushButton:hover { background: #2d4358; border-color: #4b667e; }
      QPushButton#primary { background: #32759e; border-color: #4595c2; }
      QPushButton#primary:hover { background: #3c8bb9; }
    )CSS"));

    auto *layout = new QVBoxLayout(&dialog);
    layout->setContentsMargins(20, 20, 20, 20);
    layout->setSpacing(14);

    const bool isCookies = (permissionKey_ == QLatin1String("thirdPartyCookies"));
    QString titleText;
    if (isCookies) {
      titleText = QStringLiteral("Üçüncü Taraf Çerezlerine İzin Verilen Site Ekle");
    } else {
      titleText = allow ? QStringLiteral("İzin Verilen Site Ekle") : QStringLiteral("Engellenen Site Ekle");
    }

    auto *titleLbl = new QLabel(titleText, &dialog);
    titleLbl->setStyleSheet(QStringLiteral("font-size: 16px; font-weight: 650; color: #f2f7fc;"));
    layout->addWidget(titleLbl);

    QString descText = isCookies
        ? QStringLiteral("Özel kural eklemek istediğiniz sitenin web adresini veya joker karakterli alan adını girin (Örn: [*.]example.com):")
        : QStringLiteral("Özel kural eklemek istediğiniz sitenin web adresini girin:");

    auto *descLbl = new QLabel(descText, &dialog);
    descLbl->setStyleSheet(QStringLiteral("color: #8fa0b3; font-size: 13px;"));
    layout->addWidget(descLbl);

    auto *edit = new QLineEdit(&dialog);
    edit->setPlaceholderText(isCookies ? QStringLiteral("[*.]example.com veya https://www.example.com") : QStringLiteral("https://www.example.com"));
    layout->addWidget(edit);

    auto *btnLayout = new QHBoxLayout;
    btnLayout->addStretch();
    auto *cancelBtn = new QPushButton(QStringLiteral("İptal"), &dialog);
    auto *addBtn = new QPushButton(QStringLiteral("Ekle"), &dialog);
    addBtn->setObjectName(QStringLiteral("primary"));
    btnLayout->addWidget(cancelBtn);
    btnLayout->addWidget(addBtn);
    layout->addLayout(btnLayout);

    connect(cancelBtn, &QPushButton::clicked, &dialog, &QDialog::reject);
    connect(addBtn, &QPushButton::clicked, &dialog, &QDialog::accept);

    if (dialog.exec() == QDialog::Accepted) {
      QString urlStr = edit->text().trimmed();
      if (!urlStr.isEmpty()) {
        if (urlStr.startsWith(QLatin1String("[*.]"))) {
          profileService_->addSitePermissionRule(permissionKey_, urlStr, allow);
          refresh();
        } else {
          if (!urlStr.startsWith(QLatin1String("http://")) && !urlStr.startsWith(QLatin1String("https://"))) {
            urlStr = QStringLiteral("https://") + urlStr;
          }
          QUrl url(urlStr);
          if (url.isValid() && !url.host().isEmpty()) {
            const QString origin = url.scheme() + QStringLiteral("://") + url.authority();
            profileService_->addSitePermissionRule(permissionKey_, origin, allow);
            refresh();
          }
        }
      }
    }
  }

  void populateSiteList(QVBoxLayout *layout, const QStringList &origins, bool isAllowed) {
    while (QLayoutItem *item = layout->takeAt(0)) {
      if (item->widget()) delete item->widget();
      delete item;
    }

    if (origins.isEmpty()) {
      auto *emptyLabel = new QLabel(QStringLiteral("Site eklenmedi"), layout->parentWidget());
      emptyLabel->setStyleSheet(QStringLiteral("color: #728496; font-size: 13px; font-style: italic; padding: 10px 18px;"));
      layout->addWidget(emptyLabel);
      return;
    }

    for (const QString &origin : origins) {
      auto *row = new QWidget(layout->parentWidget());
      row->setObjectName(QStringLiteral("settings-site-row"));
      row->setProperty("originText", origin);
      auto *rowLayout = new QHBoxLayout(row);
      rowLayout->setContentsMargins(18, 8, 18, 8);
      rowLayout->setSpacing(12);

      auto *iconLbl = new QLabel(row);
      iconLbl->setPixmap(BrowserIcons::icon(BrowserIcon::Privacy).pixmap(16, 16));
      iconLbl->setFixedSize(16, 16);
      rowLayout->addWidget(iconLbl);

      auto *originLbl = new QLabel(origin, row);
      originLbl->setStyleSheet(QStringLiteral("color: #edf5fc; font-size: 13px; font-weight: 500;"));
      originLbl->setTextInteractionFlags(Qt::TextSelectableByMouse);
      rowLayout->addWidget(originLbl, 1);

      auto *delBtn = new QPushButton(row);
      delBtn->setObjectName(QStringLiteral("settings-subpage-del-btn"));
      delBtn->setFixedSize(28, 28);
      delBtn->setCursor(Qt::PointingHandCursor);
      delBtn->setIcon(BrowserIcons::icon(BrowserIcon::Trash));
      delBtn->setIconSize(QSize(14, 14));
      delBtn->setToolTip(QStringLiteral("Kaldır"));
      delBtn->setAccessibleName(QStringLiteral("Kaldır: %1").arg(origin));
      connect(delBtn, &QPushButton::clicked, this, [this, origin] {
        profileService_->removeSitePermissionRule(permissionKey_, origin);
        refresh();
      });
      rowLayout->addWidget(delBtn);

      layout->addWidget(row);
    }
  }

  void onDefaultPolicyChanged(int optionId) {
    if (!profileService_ || permissionKey_.isEmpty()) return;

    if (permissionKey_ == QLatin1String("javascript")) {
      profileService_->setJavascriptEnabled(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("images")) {
      profileService_->setAutoLoadImagesEnabled(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("popups")) {
      profileService_->setPopupsAllowed(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("sound")) {
      profileService_->setSoundAllowed(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("pdf")) {
      profileService_->setOpenPdfInBrowser(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("protectedContent")) {
      profileService_->setProtectedContentEnabled(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("insecureContent")) {
      profileService_->setInsecureContentPolicy(optionId == 0 ? QStringLiteral("block") : QStringLiteral("allow"));
      return;
    }
    if (permissionKey_ == QLatin1String("siteData")) {
      if (optionId == 0) profileService_->setSiteDataPolicy(QStringLiteral("allow"));
      else if (optionId == 2) profileService_->setSiteDataPolicy(QStringLiteral("delete_on_exit"));
      else if (optionId == 1) profileService_->setSiteDataPolicy(QStringLiteral("block"));
      return;
    }
    if (permissionKey_ == QLatin1String("jsOptimize")) {
      profileService_->setJsOptimizationEnabled(optionId == 0);
      return;
    }
    if (permissionKey_ == QLatin1String("autoFullscreen")) {
      profileService_->setAutoFullscreenAllowed(optionId == 1);
      return;
    }

    const bool isDeny = (optionId == 1);
    if (isDeny) {
      if (hasDisplayMode_) displayModeContainer_->setVisible(false);
      profileService_->setPermissionDefaultPolicy(permissionKey_, QStringLiteral("deny"));
    } else {
      if (hasDisplayMode_) {
        displayModeContainer_->setVisible(true);
        const QString mode = profileService_->requestDisplayMode(permissionKey_);
        if (mode == QLatin1String("expand_all")) {
          profileService_->setPermissionDefaultPolicy(permissionKey_, QStringLiteral("prompt"));
        } else {
          profileService_->setPermissionDefaultPolicy(permissionKey_, QStringLiteral("quiet"));
        }
      } else {
        profileService_->setPermissionDefaultPolicy(permissionKey_, QStringLiteral("prompt"));
      }
    }
  }

  BrowserProfileService *profileService_ = nullptr;
  std::function<void()> onBack_;
  QString permissionKey_;

  QLabel *titleLabel_ = nullptr;
  QPushButton *helpBtn_ = nullptr;
  QLineEdit *filterEdit_ = nullptr;

  QLabel *introLabel_ = nullptr;
  QWidget *deviceContainer_ = nullptr;
  QComboBox *deviceCombo_ = nullptr;

  QFrame *defaultCard_ = nullptr;
  ClickableFrame *allowFrame_ = nullptr;
  QRadioButton *radioAllow_ = nullptr;
  QLabel *allowIconLabel_ = nullptr;
  QLabel *allowTitleLabel_ = nullptr;

  QWidget *displayModeContainer_ = nullptr;
  QButtonGroup *dmGroup_ = nullptr;
  QRadioButton *radioCollapseAll_ = nullptr;
  QRadioButton *radioQuiet_ = nullptr;
  QRadioButton *radioExpandAll_ = nullptr;

  ClickableFrame *middleFrame_ = nullptr;
  QRadioButton *radioMiddle_ = nullptr;
  QLabel *middleIconLabel_ = nullptr;
  QLabel *middleTitleLabel_ = nullptr;
  QLabel *middleSubLabel_ = nullptr;

  ClickableFrame *denyFrame_ = nullptr;
  QRadioButton *radioDeny_ = nullptr;
  QLabel *denyIconLabel_ = nullptr;
  QLabel *denyTitleLabel_ = nullptr;
  QLabel *denySubLabel_ = nullptr;

  QButtonGroup *defaultBtnGroup_ = nullptr;

  QFrame *zoomCard_ = nullptr;
  QComboBox *zoomCombo_ = nullptr;

  QFrame *customCard_ = nullptr;
  QLabel *deniedTitleLabel_ = nullptr;
  QLabel *allowedTitleLabel_ = nullptr;
  QWidget *deniedListWidget_ = nullptr;
  QWidget *allowedListWidget_ = nullptr;
  QVBoxLayout *deniedListLayout_ = nullptr;
  QVBoxLayout *allowedListLayout_ = nullptr;

  QFrame *cookiesCard_ = nullptr;
  QWidget *cookiesListWidget_ = nullptr;
  QVBoxLayout *cookiesListLayout_ = nullptr;

  bool hasDeviceSelector_ = false;
  bool hasDisplayMode_ = false;
};

QWidget *SettingsPage::createPrivacySection() {
  privacyStack_ = new DynamicStackedWidget;
  privacyStack_->setObjectName(QStringLiteral("settings-privacy-stack"));

  privacySubpage_ = new PrivacyDetailSubpage(profileService_, [this] {
    if (privacyStack_) {
      privacyStack_->setCurrentIndex(0);
      privacyStack_->updateGeometry();
      QWidget *p = privacyStack_->parentWidget();
      while (p) {
        if (auto *scroll = qobject_cast<QScrollArea *>(p)) {
          scroll->verticalScrollBar()->setValue(0);
          break;
        }
        p = p->parentWidget();
      }
    }
    if (updatePrivacySubtitles_) updatePrivacySubtitles_();
  }, privacyStack_);

  Section section = makeSection(QStringLiteral("Gizlilik ve güvenlik"), QStringLiteral("Site izinlerini, çerezleri, içerik ayarlarını ve izleme korumasını yönetin."));

  // =========================================================================
  // 1. İZİNLER KARTI
  // =========================================================================
  auto *permissionsCard = makeCard(section.page, QStringLiteral("İZİNLER"));

  auto openSubpage = [this](const QString &key) {
    if (privacySubpage_ && privacyStack_) {
      privacySubpage_->configure(key);
      privacyStack_->setCurrentIndex(1);
      privacyStack_->updateGeometry();
      QWidget *p = privacyStack_->parentWidget();
      while (p) {
        if (auto *scroll = qobject_cast<QScrollArea *>(p)) {
          scroll->verticalScrollBar()->setValue(0);
          break;
        }
        p = p->parentWidget();
      }
    }
  };

  // Konum
  const auto getGeoSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("geolocation")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin konumumu görmesine izin verme")
        : QStringLiteral("Siteler konum bilgimi isteyebilir");
  };
  InteractiveSettingRowResult geoRow = makeInteractiveSettingRow(
      permissionsCard, BrowserIcon::Location, QStringLiteral("Konum"), getGeoSub(),
      [openSubpage] { openSubpage(QStringLiteral("geolocation")); });
  addRow(permissionsCard, geoRow.frame);

  // Kamera
  const auto getCamSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("camera")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin kameramı kullanmasına izin verme")
        : QStringLiteral("Siteler kameranızı kullanmak isteyebilir");
  };
  InteractiveSettingRowResult camRow = makeInteractiveSettingRow(
      permissionsCard, BrowserIcon::Camera, QStringLiteral("Kamera"), getCamSub(),
      [openSubpage] { openSubpage(QStringLiteral("camera")); });
  addRow(permissionsCard, camRow.frame);

  // Mikrofon
  const auto getMicSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("microphone")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin mikrofonumu kullanmasına izin verme")
        : QStringLiteral("Siteler mikrofonunuzu kullanmak isteyebilir");
  };
  InteractiveSettingRowResult micRow = makeInteractiveSettingRow(
      permissionsCard, BrowserIcon::Microphone, QStringLiteral("Mikrofon"), getMicSub(),
      [openSubpage] { openSubpage(QStringLiteral("microphone")); });
  addRow(permissionsCard, micRow.frame);

  // Bildirimler
  const auto getNotifSub = [this] {
    const auto pol = profileService_->permissionDefaultPolicy(QStringLiteral("notifications"));
    if (pol == QStringLiteral("deny")) return QStringLiteral("Sitelerin bildirim göndermesine izin verme");
    return QStringLiteral("Siteler bildirim gönderme izni isteyebilir");
  };
  InteractiveSettingRowResult notifRow = makeInteractiveSettingRow(
      permissionsCard, BrowserIcon::Notification, QStringLiteral("Bildirimler"), getNotifSub(),
      [openSubpage] { openSubpage(QStringLiteral("notifications")); });
  addRow(permissionsCard, notifRow.frame);

  // Ek izinler (Akordeon)
  auto extraPerms = makeCollapsibleSectionRow(permissionsCard, QStringLiteral("Ek izinler"));
  addRow(permissionsCard, extraPerms.headerRow);

  const auto getClipSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("clipboard")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin panoyu görmesine veya değiştirmesine izin verme")
        : QStringLiteral("Siteler panoyu görebilir ve değiştirebilir");
  };
  const auto getFontsSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("localFonts")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin yüklü yazı tiplerini kullanmasına izin verme")
        : QStringLiteral("Siteler yüklü yazı tiplerini kullanabilir");
  };
  const auto getMouseSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("mouseLock")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin fare imlecini kilitlemesine izin verme")
        : QStringLiteral("Siteler fare imlecini kilitleyebilir");
  };
  const auto getScreenSub = [this] {
    return profileService_->permissionDefaultPolicy(QStringLiteral("screenShare")) == QStringLiteral("deny")
        ? QStringLiteral("Sitelerin ekranınızı paylaşmasını engelle")
        : QStringLiteral("Siteler ekranınızı paylaşmak isteyebilir");
  };

  // Ek izin 1: Pano
  InteractiveSettingRowResult clipRow = makeInteractiveSettingRow(
      extraPerms.childContainer, BrowserIcon::Clipboard, QStringLiteral("Pano"), getClipSub(),
      [openSubpage] { openSubpage(QStringLiteral("clipboard")); });
  extraPerms.childContainer->layout()->addWidget(clipRow.frame);

  // Ek izin 2: Yerel yazı tipleri
  InteractiveSettingRowResult fontsRow = makeInteractiveSettingRow(
      extraPerms.childContainer, BrowserIcon::Fonts, QStringLiteral("Yerel yazı tipleri"), getFontsSub(),
      [openSubpage] { openSubpage(QStringLiteral("localFonts")); });
  extraPerms.childContainer->layout()->addWidget(fontsRow.frame);

  // Ek izin 3: Fare kilidi
  InteractiveSettingRowResult mouseRow = makeInteractiveSettingRow(
      extraPerms.childContainer, BrowserIcon::Mouse, QStringLiteral("Fare kilidi"), getMouseSub(),
      [openSubpage] { openSubpage(QStringLiteral("mouseLock")); });
  extraPerms.childContainer->layout()->addWidget(mouseRow.frame);

  // Ek izin 4: Ekran paylaşımı
  InteractiveSettingRowResult screenRow = makeInteractiveSettingRow(
      extraPerms.childContainer, BrowserIcon::Window, QStringLiteral("Ekran paylaşımı"), getScreenSub(),
      [openSubpage] { openSubpage(QStringLiteral("screenShare")); });
  extraPerms.childContainer->layout()->addWidget(screenRow.frame);

  addRow(permissionsCard, extraPerms.childContainer);
  section.layout->addWidget(permissionsCard);

  // =========================================================================
  // 2. İÇERİK KARTI
  // =========================================================================
  auto *contentCard = makeCard(section.page, QStringLiteral("İÇERİK"));

  const auto getCookieSub = [this] {
    const auto pol = profileService_->cookiePolicy();
    if (pol == QStringLiteral("block_all")) return QStringLiteral("Tüm çerezler engelleniyor");
    if (pol == QStringLiteral("allow_all")) return QStringLiteral("Tüm çerezlere izin veriliyor");
    return QStringLiteral("Üçüncü taraf çerezleri engelleniyor");
  };
  const auto getJsSub = [this] {
    return profileService_->isJavascriptEnabled()
        ? QStringLiteral("Siteler JavaScript kullanabilir")
        : QStringLiteral("Sitelerin JavaScript kullanmasına izin verme");
  };
  const auto getImgSub = [this] {
    return profileService_->isAutoLoadImagesEnabled()
        ? QStringLiteral("Siteler resim gösterebilir")
        : QStringLiteral("Sitelerin resim göstermesine izin verme");
  };
  const auto getPopupSub = [this] {
    return !profileService_->arePopupsAllowed()
        ? QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme")
        : QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir");
  };

  // 1. Üçüncü taraf çerezleri
  InteractiveSettingRowResult cookieRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Cookie, QStringLiteral("Üçüncü taraf çerezleri"), getCookieSub(),
      [openSubpage] { openSubpage(QStringLiteral("thirdPartyCookies")); });
  addRow(contentCard, cookieRow.frame);

  // 2. JavaScript
  InteractiveSettingRowResult jsRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Javascript, QStringLiteral("JavaScript"), getJsSub(),
      [openSubpage] { openSubpage(QStringLiteral("javascript")); });
  addRow(contentCard, jsRow.frame);

  // 3. Resimler
  InteractiveSettingRowResult imgRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Image, QStringLiteral("Resimler"), getImgSub(),
      [openSubpage] { openSubpage(QStringLiteral("images")); });
  addRow(contentCard, imgRow.frame);

  // 4. Pop-up ve yönlendirmeler
  InteractiveSettingRowResult popupRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Popup, QStringLiteral("Pop-up ve yönlendirmeler"), getPopupSub(),
      [openSubpage] { openSubpage(QStringLiteral("popups")); });
  addRow(contentCard, popupRow.frame);

  // Ek içerik ayarları (Akordeon)
  auto extraContent = makeCollapsibleSectionRow(contentCard, QStringLiteral("Ek içerik ayarları"));
  addRow(contentCard, extraContent.headerRow);

  // Subtitle getters for extra content
  const auto getSoundSub = [this] {
    return profileService_->isSoundAllowed()
        ? QStringLiteral("Siteler ses çalabilir")
        : QStringLiteral("Sitelerin ses çalmasına izin verme");
  };
  const auto getPdfSub = [this] {
    return profileService_->openPdfInBrowser()
        ? QStringLiteral("PDF'leri ArDali'de aç")
        : QStringLiteral("PDF'leri indir");
  };
  const auto getProtectedContentSub = [this] {
    return profileService_->isProtectedContentEnabled()
        ? QStringLiteral("Sitelerin korumalı içerik (DRM) kimliklerini kullanmasına izin ver")
        : QStringLiteral("Sitelerin korumalı içerik kimliklerini kullanmasına izin verme");
  };
  const auto getInsecureContentSub = [this] {
    return profileService_->insecureContentPolicy() == QStringLiteral("allow")
        ? QStringLiteral("Tüm sitelerde güvenli olmayan içeriğe izin ver")
        : QStringLiteral("Güvenli sitelerde güvenli olmayan içerik varsayılan olarak engellenir");
  };
  const auto getSiteDataSub = [this] {
    const QString pol = profileService_->siteDataPolicy();
    if (pol == QStringLiteral("delete_on_exit")) return QStringLiteral("Tüm pencereleri kapattığınızda verileri sil");
    if (pol == QStringLiteral("block")) return QStringLiteral("Sitelerin cihazınıza veri kaydetmesini engelleyin");
    return QStringLiteral("Siteler, cihazınıza veri kaydedebilir");
  };
  const auto getJsOptimizeSub = [this] {
    return profileService_->isJsOptimizationEnabled()
        ? QStringLiteral("Siteler JavaScript optimizasyonunu kullanabilir")
        : QStringLiteral("Sitelerin JavaScript optimizasyonunu kullanmasını devre dışı bırak");
  };
  const auto getAutoFullscreenSub = [this] {
    return profileService_->isAutoFullscreenAllowed()
        ? QStringLiteral("Siteler otomatik olarak tam ekrana geçebilir")
        : QStringLiteral("Sitelerin kullanıcı etkileşimi olmadan tam ekrana geçmesini engelle");
  };

  // 1. Ses
  InteractiveSettingRowResult soundRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::Audio, QStringLiteral("Ses"), getSoundSub(),
      [openSubpage] { openSubpage(QStringLiteral("sound")); });
  extraContent.childContainer->layout()->addWidget(soundRow.frame);

  // 2. Yakınlaştırma seviyeleri
  InteractiveSettingRowResult zoomRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::Zoom, QStringLiteral("Yakınlaştırma seviyeleri"),
      QStringLiteral("Siteler için özel yakınlaştırma düzeylerini yönetin"),
      [openSubpage] { openSubpage(QStringLiteral("zoomLevels")); });
  extraContent.childContainer->layout()->addWidget(zoomRow.frame);

  // 3. PDF dokümanları
  InteractiveSettingRowResult pdfRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::Pdf, QStringLiteral("PDF dokümanları"), getPdfSub(),
      [openSubpage] { openSubpage(QStringLiteral("pdf")); });
  extraContent.childContainer->layout()->addWidget(pdfRow.frame);

  // 4. Korumalı içerik kimlikleri
  InteractiveSettingRowResult protectedContentRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::ProtectedContent, QStringLiteral("Korumalı içerik kimlikleri"), getProtectedContentSub(),
      [openSubpage] { openSubpage(QStringLiteral("protectedContent")); });
  extraContent.childContainer->layout()->addWidget(protectedContentRow.frame);

  // 5. Güvenli olmayan içerik
  InteractiveSettingRowResult insecureContentRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::InsecureContent, QStringLiteral("Güvenli olmayan içerik"), getInsecureContentSub(),
      [openSubpage] { openSubpage(QStringLiteral("insecureContent")); });
  extraContent.childContainer->layout()->addWidget(insecureContentRow.frame);

  // 6. Cihaz üzerindeki site verileri
  InteractiveSettingRowResult siteDataRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::SiteData, QStringLiteral("Cihaz üzerindeki site verileri"), getSiteDataSub(),
      [openSubpage] { openSubpage(QStringLiteral("siteData")); });
  extraContent.childContainer->layout()->addWidget(siteDataRow.frame);

  // 7. JavaScript optimizasyonu ve güvenlik
  InteractiveSettingRowResult jsOptimizeRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::JsOptimize, QStringLiteral("JavaScript optimizasyonu ve güvenlik"), getJsOptimizeSub(),
      [openSubpage] { openSubpage(QStringLiteral("jsOptimize")); });
  extraContent.childContainer->layout()->addWidget(jsOptimizeRow.frame);

  // 8. Otomatik tam ekran
  InteractiveSettingRowResult autoFullscreenRow = makeInteractiveSettingRow(
      extraContent.childContainer, BrowserIcon::Fullscreen, QStringLiteral("Otomatik tam ekran"), getAutoFullscreenSub(),
      [openSubpage] { openSubpage(QStringLiteral("autoFullscreen")); });
  extraContent.childContainer->layout()->addWidget(autoFullscreenRow.frame);

  addRow(contentCard, extraContent.childContainer);
  section.layout->addWidget(contentCard);

  updatePrivacySubtitles_ = [geoRow, getGeoSub, camRow, getCamSub, micRow, getMicSub, notifRow, getNotifSub,
                             clipRow, getClipSub, fontsRow, getFontsSub, mouseRow, getMouseSub, screenRow, getScreenSub,
                             cookieRow, getCookieSub, jsRow, getJsSub, imgRow, getImgSub, popupRow, getPopupSub,
                             soundRow, getSoundSub, pdfRow, getPdfSub, protectedContentRow, getProtectedContentSub,
                             insecureContentRow, getInsecureContentSub, siteDataRow, getSiteDataSub,
                             jsOptimizeRow, getJsOptimizeSub, autoFullscreenRow, getAutoFullscreenSub] {
    if (geoRow.subtitleLabel) geoRow.subtitleLabel->setText(getGeoSub());
    if (camRow.subtitleLabel) camRow.subtitleLabel->setText(getCamSub());
    if (micRow.subtitleLabel) micRow.subtitleLabel->setText(getMicSub());
    if (notifRow.subtitleLabel) notifRow.subtitleLabel->setText(getNotifSub());
    if (clipRow.subtitleLabel) clipRow.subtitleLabel->setText(getClipSub());
    if (fontsRow.subtitleLabel) fontsRow.subtitleLabel->setText(getFontsSub());
    if (mouseRow.subtitleLabel) mouseRow.subtitleLabel->setText(getMouseSub());
    if (screenRow.subtitleLabel) screenRow.subtitleLabel->setText(getScreenSub());
    if (cookieRow.subtitleLabel) cookieRow.subtitleLabel->setText(getCookieSub());
    if (jsRow.subtitleLabel) jsRow.subtitleLabel->setText(getJsSub());
    if (imgRow.subtitleLabel) imgRow.subtitleLabel->setText(getImgSub());
    if (popupRow.subtitleLabel) popupRow.subtitleLabel->setText(getPopupSub());
    if (soundRow.subtitleLabel) soundRow.subtitleLabel->setText(getSoundSub());
    if (pdfRow.subtitleLabel) pdfRow.subtitleLabel->setText(getPdfSub());
    if (protectedContentRow.subtitleLabel) protectedContentRow.subtitleLabel->setText(getProtectedContentSub());
    if (insecureContentRow.subtitleLabel) insecureContentRow.subtitleLabel->setText(getInsecureContentSub());
    if (siteDataRow.subtitleLabel) siteDataRow.subtitleLabel->setText(getSiteDataSub());
    if (jsOptimizeRow.subtitleLabel) jsOptimizeRow.subtitleLabel->setText(getJsOptimizeSub());
    if (autoFullscreenRow.subtitleLabel) autoFullscreenRow.subtitleLabel->setText(getAutoFullscreenSub());
  };

  // =========================================================================
  // 3. KULLANILMAYAN SİTELERİN İZİNLERİNİ OTOMATİK OLARAK KALDIR
  // =========================================================================
  auto *autoRevokeCard = makeCard(section.page);
  auto *autoRevokeSwitch = new GlowToggleSwitch(autoRevokeCard);
  autoRevokeSwitch->setChecked(profileService_->autoRevokeUnusedPermissions());
  autoRevokeSwitch->setAccessibleName(QStringLiteral("Kullanılmayan sitelerin izinlerini otomatik olarak kaldır"));
  addRow(autoRevokeCard, settingRow(
      autoRevokeCard,
      QStringLiteral("Kullanılmayan sitelerin izinlerini otomatik olarak kaldır"),
      QStringLiteral("Verilerinizin korunması için ArDali'nin, yakın zamanda ziyaret etmediğiniz sitelerin izinlerini kaldırmasına izin verin."),
      autoRevokeSwitch));
  section.layout->addWidget(autoRevokeCard);
  connect(autoRevokeSwitch, &QCheckBox::toggled, this, [this](bool checked) {
    profileService_->setAutoRevokeUnusedPermissions(checked);
  });

  // =========================================================================
  // 4. TARAMA VERİLERİ VE İZLEME KORUMASI KARTI
  // =========================================================================
  auto *privacyCard = makeCard(section.page, QStringLiteral("TARAMA VERİLERİ VE İZLEME KORUMASI"));
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
  auto *sitePermsCard = makeCard(section.page, QStringLiteral("KAYITLI SİTE İZİNLERİ"));
  auto *list = new QListWidget(sitePermsCard); list->setObjectName(QStringLiteral("settings-data-list")); list->setAccessibleName(QStringLiteral("Kalıcı site izinleri")); list->setMinimumHeight(180);
  auto *reset = new QPushButton(QStringLiteral("Seçili izni sıfırla"), sitePermsCard); reset->setProperty("danger", true);
  auto *listContainer = new QWidget(sitePermsCard); auto *listLayout = new QVBoxLayout(listContainer); listLayout->setContentsMargins(18, 12, 18, 14); listLayout->setSpacing(10); listLayout->addWidget(list); listLayout->addWidget(reset, 0, Qt::AlignLeft);
  addRow(sitePermsCard, listContainer);
  section.layout->addWidget(sitePermsCard);
  const auto refresh = [this, list] {
    list->clear();
    for (const QWebEnginePermission &permission : profileService_->sitePermissions()) {
      if (!permission.isValid()) continue;
      auto *item = new QListWidgetItem(
          BrowserIcons::icon(permissionIcon(permission.permissionType())),
          QStringLiteral("%1 — %2\n%3").arg(permission.origin().host(), permissionText(permission.permissionType()), permissionState(permission)),
          list);
      item->setData(Qt::UserRole, permission.origin());
      item->setData(Qt::UserRole + 1, static_cast<int>(permission.permissionType()));
      item->setSizeHint(QSize(0, 54));
    }
    if (!list->count()) {
      auto *item = new QListWidgetItem(QStringLiteral("Kalıcı site izni yok"), list);
      item->setFlags(Qt::NoItemFlags);
    }
  };
  refresh();
  connect(profileService_, &BrowserProfileService::permissionsPolicyChanged, this, refresh);
  connect(reset, &QPushButton::clicked, this, [this, list, refresh] {
    auto *item = list->currentItem();
    if (!item) return;
    if (profileService_->resetSitePermission(item->data(Qt::UserRole).toUrl(), static_cast<QWebEnginePermission::PermissionType>(item->data(Qt::UserRole + 1).toInt()))) {
      refresh();
    }
  });
#endif

  section.layout->addStretch();

  privacyStack_->addWidget(section.page);
  privacyStack_->addWidget(privacySubpage_);

  return privacyStack_;
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
  auto *suggestions = new QCheckBox(card); suggestions->setObjectName(QStringLiteral("settings-search-suggestions")); suggestions->setAccessibleName(QStringLiteral("Arama önerilerini etkinleştir")); suggestions->setChecked(profileService_ ? profileService_->searchSuggestions()->isEnabled() : QSettings().value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool()); suggestions->setEnabled(!profileService_ || !profileService_->profile()->isOffTheRecord());
  addRow(card, settingRow(card, QStringLiteral("Arama önerileri"), QStringLiteral("Etkinleştirildiğinde yazdığınız sorgu seçili arama motorunun öneri servisine gönderilebilir."), suggestions));
  section.layout->addWidget(card); section.layout->addStretch();
  connect(engine, &QComboBox::currentTextChanged, this, [this](const QString &value) { QSettings().setValue(QStringLiteral("browser/searchEngine"), value); if (hooks_.setSearchEngine) hooks_.setSearchEngine(value); });
  connect(suggestions, &QCheckBox::toggled, this, [this](bool value) { if (profileService_) profileService_->setSearchSuggestionsEnabled(value); else QSettings().setValue(QStringLiteral("browser/searchSuggestionsEnabled"), value); if (hooks_.syncNewTabs) hooks_.syncNewTabs(); });
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

namespace {
struct LanguageMeta {
  QString code;
  QString displayName;
  QString spellCheckCode;
};

static const QList<LanguageMeta> kLanguagesList = {
  {QStringLiteral("tr"), QStringLiteral("Türkçe"), QStringLiteral("tr-TR")},
  {QStringLiteral("en-US"), QStringLiteral("İngilizce (Amerika Birleşik Devletleri)"), QStringLiteral("en-US")},
  {QStringLiteral("en"), QStringLiteral("İngilizce"), QStringLiteral("en-GB")},
  {QStringLiteral("en-GB"), QStringLiteral("İngilizce (Birleşik Krallık)"), QStringLiteral("en-GB")},
  {QStringLiteral("de"), QStringLiteral("Almanca"), QStringLiteral("de-DE")},
  {QStringLiteral("fr"), QStringLiteral("Fransızca"), QStringLiteral("fr-FR")},
  {QStringLiteral("es"), QStringLiteral("İspanyolca"), QStringLiteral("es-ES")},
  {QStringLiteral("it"), QStringLiteral("İtalyanca"), QStringLiteral("it-IT")},
  {QStringLiteral("ar"), QStringLiteral("Arapça"), QStringLiteral("ar")},
  {QStringLiteral("ru"), QStringLiteral("Rusça"), QStringLiteral("ru-RU")},
  {QStringLiteral("ja"), QStringLiteral("Japonca"), QStringLiteral("ja")},
  {QStringLiteral("zh-CN"), QStringLiteral("Çince (Basitleştirilmiş)"), QStringLiteral("zh-CN")},
  {QStringLiteral("ko"), QStringLiteral("Korece"), QStringLiteral("ko")},
  {QStringLiteral("pt-BR"), QStringLiteral("Portekizce (Brezilya)"), QStringLiteral("pt-BR")},
  {QStringLiteral("pt"), QStringLiteral("Portekizce"), QStringLiteral("pt-PT")},
  {QStringLiteral("nl"), QStringLiteral("Felemenkçe"), QStringLiteral("nl-NL")},
  {QStringLiteral("pl"), QStringLiteral("Lehçe"), QStringLiteral("pl-PL")},
  {QStringLiteral("uk"), QStringLiteral("Ukraynaca"), QStringLiteral("uk-UA")},
  {QStringLiteral("az"), QStringLiteral("Azerice"), QStringLiteral("az")},
  {QStringLiteral("el"), QStringLiteral("Yunanca"), QStringLiteral("el-GR")},
  {QStringLiteral("hi"), QStringLiteral("Hintçe"), QStringLiteral("hi-IN")},
  {QStringLiteral("sv"), QStringLiteral("İsveççe"), QStringLiteral("sv-SE")},
  {QStringLiteral("no"), QStringLiteral("Norveççe"), QStringLiteral("nb-NO")},
  {QStringLiteral("da"), QStringLiteral("Danca"), QStringLiteral("da-DK")},
  {QStringLiteral("fi"), QStringLiteral("Fince"), QStringLiteral("fi-FI")},
  {QStringLiteral("cs"), QStringLiteral("Çekçe"), QStringLiteral("cs-CZ")},
  {QStringLiteral("hu"), QStringLiteral("Macarca"), QStringLiteral("hu-HU")},
  {QStringLiteral("ro"), QStringLiteral("Rumence"), QStringLiteral("ro-RO")},
  {QStringLiteral("id"), QStringLiteral("Endonezce"), QStringLiteral("id-ID")},
  {QStringLiteral("vi"), QStringLiteral("Vietnamca"), QStringLiteral("vi-VN")}
};

static QString getLanguageDisplayName(const QString &code) {
  for (const auto &item : kLanguagesList) {
    if (item.code.compare(code, Qt::CaseInsensitive) == 0) {
      return item.displayName;
    }
  }
  return LanguageDetector::languageDisplayName(code);
}

static QString getSpellCheckCode(const QString &code) {
  for (const auto &item : kLanguagesList) {
    if (item.code.compare(code, Qt::CaseInsensitive) == 0) {
      return item.spellCheckCode;
    }
  }
  return code;
}

class AddLanguageDialog : public QDialog {
 public:
  explicit AddLanguageDialog(const QStringList &excludeCodes, QWidget *parent = nullptr)
      : QDialog(parent) {
    setWindowTitle(QStringLiteral("Dil ekle"));
    setMinimumWidth(380);
    setMinimumHeight(440);
    setStyleSheet(QStringLiteral(
        "QDialog { background: #171e27; color: #e8eef6; }"
        "QLineEdit { min-height: 32px; background: #111820; color: #e6edf5; border: 1px solid #3a4958; border-radius: 7px; padding: 0 10px; }"
        "QLineEdit:focus { border: 2px solid #58a6c7; }"
        "QListWidget { background: #121820; color: #e1e8f0; border: 1px solid #2e3b49; border-radius: 8px; outline: 0; padding: 4px; }"
        "QListWidget::item { min-height: 34px; padding: 4px 8px; border-radius: 5px; }"
        "QListWidget::item:hover { background: #202b36; }"
        "QPushButton { min-height: 30px; border-radius: 7px; padding: 2px 14px; font-weight: 550; font-size: 12px; }"
        "#dlg-cancel-btn { background: #253342; color: #edf5fc; border: 1px solid #3c4f63; }"
        "#dlg-cancel-btn:hover { background: #2f4052; }"
        "#dlg-add-btn { background: #1a73e8; color: #ffffff; border: 0; }"
        "#dlg-add-btn:hover { background: #1b66ca; }"
    ));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(18, 18, 18, 18);
    layout->setSpacing(12);

    auto *search = new QLineEdit(this);
    search->setPlaceholderText(QStringLiteral("Dillerde ara"));
    search->setClearButtonEnabled(true);
    layout->addWidget(search);

    auto *listWidget = new QListWidget(this);
    layout->addWidget(listWidget, 1);

    for (const auto &item : kLanguagesList) {
      if (excludeCodes.contains(item.code, Qt::CaseInsensitive)) continue;
      auto *listItem = new QListWidgetItem(item.displayName, listWidget);
      listItem->setData(Qt::UserRole, item.code);
      listItem->setFlags(listItem->flags() | Qt::ItemIsUserCheckable);
      listItem->setCheckState(Qt::Unchecked);
    }

    connect(search, &QLineEdit::textChanged, this, [listWidget](const QString &filter) {
      for (int i = 0; i < listWidget->count(); ++i) {
        auto *it = listWidget->item(i);
        const bool match = filter.isEmpty() || it->text().contains(filter, Qt::CaseInsensitive)
                           || it->data(Qt::UserRole).toString().contains(filter, Qt::CaseInsensitive);
        it->setHidden(!match);
      }
    });

    auto *btnRow = new QHBoxLayout();
    btnRow->addStretch();
    auto *cancelBtn = new QPushButton(QStringLiteral("İptal"), this);
    cancelBtn->setObjectName(QStringLiteral("dlg-cancel-btn"));
    connect(cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
    btnRow->addWidget(cancelBtn);

    auto *addBtn = new QPushButton(QStringLiteral("Ekle"), this);
    addBtn->setObjectName(QStringLiteral("dlg-add-btn"));
    connect(addBtn, &QPushButton::clicked, this, [this, listWidget]() {
      for (int i = 0; i < listWidget->count(); ++i) {
        auto *it = listWidget->item(i);
        if (it->checkState() == Qt::Checked) {
          selectedCodes_.append(it->data(Qt::UserRole).toString());
        }
      }
      accept();
    });
    btnRow->addWidget(addBtn);
    layout->addLayout(btnRow);
  }

  QStringList selectedCodes() const { return selectedCodes_; }

 private:
  QStringList selectedCodes_;
};

class CustomizeSpellCheckDialog : public QDialog {
 public:
  explicit CustomizeSpellCheckDialog(QWidget *parent = nullptr) : QDialog(parent) {
    setWindowTitle(QStringLiteral("Yazım denetimini özelleştir"));
    setMinimumWidth(400);
    setMinimumHeight(440);
    setStyleSheet(QStringLiteral(
        "QDialog { background: #171e27; color: #e8eef6; }"
        "QLineEdit { min-height: 32px; background: #111820; color: #e6edf5; border: 1px solid #3a4958; border-radius: 7px; padding: 0 10px; }"
        "QLineEdit:focus { border: 2px solid #58a6c7; }"
        "QListWidget { background: #121820; color: #e1e8f0; border: 1px solid #2e3b49; border-radius: 8px; outline: 0; padding: 4px; }"
        "QListWidget::item { min-height: 34px; padding: 4px 8px; border-radius: 5px; }"
        "QPushButton { min-height: 30px; border-radius: 7px; padding: 2px 14px; font-weight: 550; font-size: 12px; }"
        "#dlg-add-word-btn { background: #1a73e8; color: #ffffff; border: 0; }"
        "#dlg-add-word-btn:hover { background: #1b66ca; }"
        "#dlg-close-btn { background: #253342; color: #edf5fc; border: 1px solid #3c4f63; }"
        "#dlg-close-btn:hover { background: #2f4052; }"
    ));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(18, 18, 18, 18);
    layout->setSpacing(12);

    auto *desc = new QLabel(QStringLiteral("Özel sözcükler ekleyin. Bu sözcükler web sayfalarında metin yazarken yazım denetiminde yanlış olarak işaretlenmez."), this);
    desc->setWordWrap(true);
    desc->setStyleSheet(QStringLiteral("color: #91a1b2; font-size: 12px;"));
    layout->addWidget(desc);

    auto *inputRow = new QHBoxLayout();
    auto *wordEdit = new QLineEdit(this);
    wordEdit->setPlaceholderText(QStringLiteral("Sözcük ekle"));
    inputRow->addWidget(wordEdit, 1);

    auto *addBtn = new QPushButton(QStringLiteral("Ekle"), this);
    addBtn->setObjectName(QStringLiteral("dlg-add-word-btn"));
    inputRow->addWidget(addBtn);
    layout->addLayout(inputRow);

    auto *listWidget = new QListWidget(this);
    layout->addWidget(listWidget, 1);

    auto *btnRow = new QHBoxLayout();
    btnRow->addStretch();
    auto *closeBtn = new QPushButton(QStringLiteral("Kapat"), this);
    closeBtn->setObjectName(QStringLiteral("dlg-close-btn"));
    connect(closeBtn, &QPushButton::clicked, this, &QDialog::accept);
    btnRow->addWidget(closeBtn);
    layout->addLayout(btnRow);

    QSettings settings;
    auto words = std::make_shared<QStringList>(settings.value(QStringLiteral("spellcheck/customWords")).toStringList());

    const auto refreshList = [listWidget, words]() {
      listWidget->clear();
      for (const QString &w : *words) {
        auto *item = new QListWidgetItem(listWidget);
        auto *wgt = new QWidget();
        auto *h = new QHBoxLayout(wgt);
        h->setContentsMargins(8, 2, 8, 2);
        auto *lbl = new QLabel(w, wgt);
        lbl->setStyleSheet(QStringLiteral("color: #e8eef6; font-size: 13px;"));
        h->addWidget(lbl, 1);
        auto *delBtn = new QPushButton(QStringLiteral("✕"), wgt);
        delBtn->setObjectName(QStringLiteral("settings-icon-del-btn"));
        delBtn->setToolTip(QStringLiteral("Kaldır"));
        QObject::connect(delBtn, &QPushButton::clicked, [w, words, listWidget]() {
          words->removeAll(w);
          QSettings s;
          s.setValue(QStringLiteral("spellcheck/customWords"), *words);
          for (int i = 0; i < listWidget->count(); ++i) {
            if (listWidget->item(i)->data(Qt::UserRole).toString() == w) {
              delete listWidget->takeItem(i);
              break;
            }
          }
        });
        h->addWidget(delBtn);
        item->setData(Qt::UserRole, w);
        item->setSizeHint(wgt->sizeHint());
        listWidget->setItemWidget(item, wgt);
      }
    };

    refreshList();

    connect(addBtn, &QPushButton::clicked, this, [wordEdit, words, refreshList]() {
      const QString txt = wordEdit->text().trimmed();
      if (!txt.isEmpty() && !words->contains(txt)) {
        words->append(txt);
        QSettings s;
        s.setValue(QStringLiteral("spellcheck/customWords"), *words);
        wordEdit->clear();
        refreshList();
      }
    });
    connect(wordEdit, &QLineEdit::returnPressed, addBtn, &QPushButton::click);
  }
};
}  // namespace

QWidget *SettingsPage::createLanguagesSection() {
  Section section = makeSection(I18n::text(QStringLiteral("settings.language.header"), QStringLiteral("Diller")),
                                I18n::text(QStringLiteral("settings.language.subtitle"), QStringLiteral("Tercih edilen web sitesi dilleri, yazım denetimi ve sayfa çevirisi yapılandırması.")));

  QSettings settings;
  auto preferredLangs = std::make_shared<QStringList>(settings.value(QStringLiteral("language/preferredLanguages")).toStringList());
  if (preferredLangs->isEmpty()) {
    *preferredLangs = {QStringLiteral("tr"), QStringLiteral("en-US"), QStringLiteral("en")};
  }

  auto *translateSvc = profileService_ ? profileService_->translateService() : nullptr;

  auto syncAcceptLanguage = [this](const QStringList &langs) {
    QStringList parts;
    double q = 1.0;
    for (int i = 0; i < langs.size(); ++i) {
      if (i == 0) {
        parts.append(langs[i]);
      } else {
        parts.append(QStringLiteral("%1;q=%2").arg(langs[i], QString::number(q, 'f', 1)));
      }
      q = std::max(0.1, q - 0.1);
    }
    if (profileService_ && profileService_->profile()) {
      profileService_->profile()->setHttpAcceptLanguage(parts.join(QStringLiteral(",")));
    }
  };

  syncAcceptLanguage(*preferredLangs);

  // =========================================================================
  // 1. TERCİH EDİLEN DİLLER
  // =========================================================================
  auto *prefHeading = new QLabel(QStringLiteral("Tercih edilen diller"), section.page);
  prefHeading->setStyleSheet(QStringLiteral("font-size: 15px; font-weight: 650; color: #f2f6fb; margin-top: 10px; margin-bottom: 6px;"));
  section.layout->addWidget(prefHeading);

  auto *prefCard = makeCard(section.page);

  // --- Uygulama Arayüz Dili Satırı ---
  auto *uiLangCombo = new QComboBox(prefCard);
  uiLangCombo_ = uiLangCombo;
  uiLangCombo->setObjectName(QStringLiteral("settings-ui-language-combo"));
  uiLangCombo->addItem(ardali::i18n::LanguageManager::instance().formatSystemLanguageLabel(), QStringLiteral("system"));
  for (const auto &info : ardali::i18n::LanguageManager::instance().supportedLanguages()) {
    uiLangCombo->addItem(info.nativeName, info.code);
  }
  const QString currentPref = ardali::i18n::LanguageManager::instance().languagePreference();
  int prefIdx = uiLangCombo->findData(currentPref);
  if (prefIdx >= 0) uiLangCombo->setCurrentIndex(prefIdx);
  else uiLangCombo->setCurrentIndex(0);

  connect(uiLangCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [uiLangCombo](int idx) {
    if (idx >= 0) {
      const QString chosen = uiLangCombo->itemData(idx).toString();
      ardali::i18n::LanguageManager::instance().setLanguagePreference(chosen);
    }
  });

  auto *uiLangRow = settingRow(prefCard,
                               QStringLiteral("Uygulama Dili"),
                               QStringLiteral("Menüler, ayarlar ve tarayıcı arayüzü için kullanılacak dili belirler."),
                               uiLangCombo, BrowserIcon::Language, true);
  addRow(prefCard, uiLangRow);

  auto *addLangBtn = new QPushButton(QStringLiteral("Dil ekle"), prefCard);
  addLangBtn->setObjectName(QStringLiteral("settings-pill-btn"));

  auto *topRow = settingRow(prefCard,
                            QStringLiteral("Konuştuğunuz dillerdeki web siteleri"),
                            QStringLiteral("Konuştuğunuz dilleri web sitelerine bildirin. Mümkün olduğunda bu dillerde içerik gösterirler."),
                            addLangBtn);
  addRow(prefCard, topRow);

  auto *langsContainer = new QWidget(prefCard);
  auto *langsLayout = new QVBoxLayout(langsContainer);
  langsLayout->setContentsMargins(0, 0, 0, 0);
  langsLayout->setSpacing(0);
  addRow(prefCard, langsContainer);

  section.layout->addWidget(prefCard);

  // =========================================================================
  // 2. YAZIM DENETİMİ
  // =========================================================================
  auto *spellHeading = new QLabel(QStringLiteral("Yazım denetimi"), section.page);
  spellHeading->setStyleSheet(QStringLiteral("font-size: 15px; font-weight: 650; color: #f2f6fb; margin-top: 24px; margin-bottom: 6px;"));
  section.layout->addWidget(spellHeading);

  auto *spellCard = makeCard(section.page);

  auto *spellMasterSwitch = new GlowToggleSwitch(spellCard);
  const bool initialSpellEnabled = profileService_ && profileService_->profile() ? profileService_->profile()->isSpellCheckEnabled() : true;
  spellMasterSwitch->setChecked(initialSpellEnabled);
  addRow(spellCard, settingRow(spellCard,
                               QStringLiteral("Web sayfalarında metin yazarken yazım hatalarını kontrol et"),
                               QString{},
                               spellMasterSwitch));

  auto *spellSubhead = new QLabel(QStringLiteral("Şu diller için yazım denetimi kullan:"), spellCard);
  spellSubhead->setStyleSheet(QStringLiteral("color: #91a1b2; font-size: 13px; font-weight: 550; padding: 12px 18px 4px;"));
  cardLayout(spellCard)->addWidget(spellSubhead);

  auto *spellLangsContainer = new QWidget(spellCard);
  auto *spellLangsLayout = new QVBoxLayout(spellLangsContainer);
  spellLangsLayout->setContentsMargins(0, 0, 0, 0);
  spellLangsLayout->setSpacing(0);
  addRow(spellCard, spellLangsContainer);

  auto *customDictBtn = new QPushButton(QStringLiteral("›"), spellCard);
  customDictBtn->setObjectName(QStringLiteral("settings-chevron-btn"));
  auto *customDictRow = settingRow(spellCard, QStringLiteral("Yazım denetimini özelleştir"), QString{}, customDictBtn);
  addRow(spellCard, customDictRow);

  connect(customDictBtn, &QPushButton::clicked, this, [this]() {
    CustomizeSpellCheckDialog dlg(this);
    dlg.exec();
  });

  section.layout->addWidget(spellCard);

  // =========================================================================
  // 3. ARDALI ÇEVİRİ
  // =========================================================================
  auto *translateHeading = new QLabel(QStringLiteral("ArDali Çeviri"), section.page);
  translateHeading->setStyleSheet(QStringLiteral("font-size: 15px; font-weight: 650; color: #f2f6fb; margin-top: 24px; margin-bottom: 6px;"));
  section.layout->addWidget(translateHeading);

  auto *transCard = makeCard(section.page);

  auto *transMasterSwitch = new GlowToggleSwitch(transCard);
  transMasterSwitch->setChecked(translateSvc ? translateSvc->isEnabled() : true);
  addRow(transCard, settingRow(transCard,
                               QStringLiteral("ArDali Çeviri'yi kullan"),
                               QStringLiteral("Bu ayar açıkken ArDali Çeviri, siteleri tercih ettiğiniz dile çevirmeyi önerir. Ayrıca, siteleri otomatik olarak da çevirebilir."),
                               transMasterSwitch));

  auto *targetCombo = new QComboBox(transCard);
  for (const auto &item : kLanguagesList) {
    targetCombo->addItem(item.displayName, item.code);
  }
  const QString curTarget = translateSvc ? translateSvc->defaultTargetLanguage() : QStringLiteral("tr");
  int targetIdx = targetCombo->findData(curTarget);
  if (targetIdx < 0) {
    for (int i = 0; i < targetCombo->count(); ++i) {
      if (targetCombo->itemData(i).toString().startsWith(curTarget, Qt::CaseInsensitive)) {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx >= 0) targetCombo->setCurrentIndex(targetIdx);

  connect(targetCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [translateSvc, targetCombo](int idx) {
    if (translateSvc && idx >= 0) {
      translateSvc->setDefaultTargetLanguage(targetCombo->itemData(idx).toString());
      QSettings s;
      translateSvc->savePreferences(s);
    }
  });
  addRow(transCard, settingRow(transCard, QStringLiteral("Şu dile çevir"), QString{}, targetCombo));

  auto *addAutoBtn = new QPushButton(QStringLiteral("Dil ekle"), transCard);
  addAutoBtn->setObjectName(QStringLiteral("settings-pill-btn"));
  addRow(transCard, settingRow(transCard, QStringLiteral("Şu dilleri otomatik olarak çevir"), QString{}, addAutoBtn));

  auto *autoLangsContainer = new QWidget(transCard);
  auto *autoLangsLayout = new QVBoxLayout(autoLangsContainer);
  autoLangsLayout->setContentsMargins(0, 0, 0, 6);
  autoLangsLayout->setSpacing(0);
  addRow(transCard, autoLangsContainer);

  auto *addNeverBtn = new QPushButton(QStringLiteral("Dil ekle"), transCard);
  addNeverBtn->setObjectName(QStringLiteral("settings-pill-btn"));
  addRow(transCard, settingRow(transCard, QStringLiteral("Şu dilleri çevirmeyi hiçbir zaman önerme"), QString{}, addNeverBtn));

  auto *neverLangsContainer = new QWidget(transCard);
  auto *neverLangsLayout = new QVBoxLayout(neverLangsContainer);
  neverLangsLayout->setContentsMargins(0, 0, 0, 6);
  neverLangsLayout->setSpacing(0);
  addRow(transCard, neverLangsContainer);

  section.layout->addWidget(transCard);

  // Dynamic Refreshers
  auto refreshSpellLangs = std::make_shared<std::function<void()>>();
  auto refreshPreferredLangs = std::make_shared<std::function<void()>>();

  *refreshSpellLangs = [this, spellLangsContainer, spellLangsLayout, preferredLangs]() {
    while (QLayoutItem *item = spellLangsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    QStringList activeSpellLangs;
    if (profileService_ && profileService_->profile()) {
      activeSpellLangs = profileService_->profile()->spellCheckLanguages();
    }
    for (const QString &code : *preferredLangs) {
      const QString disp = getLanguageDisplayName(code);
      const QString spellCode = getSpellCheckCode(code);
      auto *row = new QWidget(spellLangsContainer);
      row->setObjectName(QStringLiteral("settings-row"));
      auto *h = new QHBoxLayout(row);
      h->setContentsMargins(18, 10, 18, 10);
      auto *lbl = new QLabel(disp, row);
      lbl->setObjectName(QStringLiteral("settings-row-title"));
      h->addWidget(lbl, 1);

      auto *toggle = new GlowToggleSwitch(row);
      toggle->setChecked(activeSpellLangs.contains(spellCode, Qt::CaseInsensitive) || activeSpellLangs.contains(code, Qt::CaseInsensitive));
      QObject::connect(toggle, &QCheckBox::toggled, [this, spellCode](bool checked) {
        if (!profileService_ || !profileService_->profile()) return;
        QStringList cur = profileService_->profile()->spellCheckLanguages();
        if (checked) {
          if (!cur.contains(spellCode, Qt::CaseInsensitive)) cur.append(spellCode);
        } else {
          cur.removeAll(spellCode);
        }
        profileService_->profile()->setSpellCheckLanguages(cur);
        QSettings s;
        s.setValue(QStringLiteral("spellcheck/languages"), cur);
      });
      h->addWidget(toggle, 0, Qt::AlignVCenter);
      spellLangsLayout->addWidget(row);
    }
  };

  *refreshPreferredLangs = [this, langsContainer, langsLayout, preferredLangs, syncAcceptLanguage, refreshSpellLangs, refreshPreferredLangs, translateSvc, targetCombo]() {
    while (QLayoutItem *item = langsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    for (int i = 0; i < preferredLangs->size(); ++i) {
      const QString code = (*preferredLangs)[i];
      const QString disp = getLanguageDisplayName(code);
      auto *row = new QWidget(langsContainer);
      row->setObjectName(QStringLiteral("settings-row"));
      auto *h = new QHBoxLayout(row);
      h->setContentsMargins(18, 10, 18, 10);
      h->setSpacing(12);

      auto *textWgt = new QWidget(row);
      auto *v = new QVBoxLayout(textWgt);
      v->setContentsMargins(0, 0, 0, 0);
      v->setSpacing(2);

      auto *titleLbl = new QLabel(QStringLiteral("%1. %2").arg(i + 1).arg(disp), textWgt);
      titleLbl->setObjectName(QStringLiteral("settings-row-title"));
      v->addWidget(titleLbl);

      if (i == 0) {
        auto *subLbl = new QLabel(QStringLiteral("Bu dil, sayfalar çevrilirken kullanılır"), textWgt);
        subLbl->setObjectName(QStringLiteral("settings-row-description"));
        v->addWidget(subLbl);
      }
      h->addWidget(textWgt, 1);

      auto *moreBtn = new QPushButton(QStringLiteral("⋮"), row);
      moreBtn->setObjectName(QStringLiteral("settings-more-btn"));
      moreBtn->setToolTip(QStringLiteral("Daha fazla işlem"));

      QObject::connect(moreBtn, &QPushButton::clicked, [this, moreBtn, i, code, disp, preferredLangs, syncAcceptLanguage, refreshPreferredLangs, translateSvc, targetCombo]() {
        auto *menu = new QMenu(moreBtn);
        menu->setStyleSheet(QStringLiteral(
            "QMenu { background: #202a36; color: #e8eef6; border: 1px solid #3a4958; border-radius: 8px; padding: 4px; }"
            "QMenu::item { padding: 6px 20px; border-radius: 5px; font-size: 13px; }"
            "QMenu::item:selected { background: #2f4052; color: #ffffff; }"
            "QMenu::item:disabled { color: #6b7a8a; }"
            "QMenu::separator { height: 1px; background: #2e3b49; margin: 4px 6px; }"
        ));

        // 1. ArDali Browser'ı bu dilde görüntüle
        const QString currentPref = ardali::i18n::LanguageManager::instance().languagePreference();
        QString targetUiCode = code.toLower();
        if (targetUiCode.startsWith(QLatin1String("tr"))) targetUiCode = QStringLiteral("tr");
        else if (targetUiCode.startsWith(QLatin1String("en"))) targetUiCode = QStringLiteral("en");
        else if (targetUiCode.startsWith(QLatin1String("ar"))) targetUiCode = QStringLiteral("ar");

        auto *uiAct = menu->addAction(QStringLiteral("ArDali Browser'ı bu dilde görüntüle"));
        uiAct->setCheckable(true);
        const bool isCurrentUi = (currentPref == targetUiCode || (currentPref == QLatin1String("system") && targetUiCode == ardali::i18n::LanguageManager::instance().activeLanguage().code));
        uiAct->setChecked(isCurrentUi);
        if (isCurrentUi) {
          uiAct->setEnabled(false);
        } else {
          QObject::connect(uiAct, &QAction::triggered, [targetUiCode]() {
            ardali::i18n::LanguageManager::instance().setLanguagePreference(targetUiCode);
          });
        }

        menu->addSeparator();

        // 2. En üste taşı
        auto *topAct = menu->addAction(QStringLiteral("En üste taşı"));
        topAct->setEnabled(i > 0);
        QObject::connect(topAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs, translateSvc, targetCombo]() {
          preferredLangs->move(i, 0);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          if (translateSvc) {
            translateSvc->setDefaultTargetLanguage(preferredLangs->first());
            translateSvc->savePreferences(s);
            int idx = targetCombo->findData(preferredLangs->first());
            if (idx >= 0) targetCombo->setCurrentIndex(idx);
          }
          (*refreshPreferredLangs)();
        });

        // 3. Yukarı taşı
        auto *upAct = menu->addAction(QStringLiteral("Yukarı taşı"));
        upAct->setEnabled(i > 0);
        QObject::connect(upAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs]() {
          preferredLangs->swapItemsAt(i, i - 1);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          (*refreshPreferredLangs)();
        });

        // 4. Aşağı taşı
        auto *downAct = menu->addAction(QStringLiteral("Aşağı taşı"));
        downAct->setEnabled(i < preferredLangs->size() - 1);
        QObject::connect(downAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs]() {
          preferredLangs->swapItemsAt(i, i + 1);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          (*refreshPreferredLangs)();
        });

        // 5. Kaldır
        auto *removeAct = menu->addAction(QStringLiteral("Kaldır"));
        removeAct->setEnabled(preferredLangs->size() > 1);
        QObject::connect(removeAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs]() {
          preferredLangs->removeAt(i);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          (*refreshPreferredLangs)();
        });

        menu->addSeparator();

        // 6. Bu dildeki sayfaları çevirmeyi öner
        auto *offerAct = menu->addAction(QStringLiteral("Bu dildeki sayfaları çevirmeyi öner"));
        offerAct->setCheckable(true);
        const bool never = translateSvc && translateSvc->neverTranslateLanguages().contains(code);
        offerAct->setChecked(!never);
        QObject::connect(offerAct, &QAction::triggered, [translateSvc, code](bool checked) {
          if (translateSvc) {
            if (checked) {
              translateSvc->removeNeverTranslateLanguage(code);
            } else {
              translateSvc->addNeverTranslateLanguage(code);
            }
            QSettings s;
            translateSvc->savePreferences(s);
          }
        });

        menu->exec(moreBtn->mapToGlobal(QPoint(0, moreBtn->height())));
        menu->deleteLater();
      });

      h->addWidget(moreBtn, 0, Qt::AlignVCenter);
      langsLayout->addWidget(row);
    }
    (*refreshSpellLangs)();
  };

  // Auto-translate list refresher
  auto refreshAutoTranslateList = [autoLangsContainer, autoLangsLayout, translateSvc]() {
    while (QLayoutItem *item = autoLangsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    const QStringList autoLangs = translateSvc ? translateSvc->autoTranslateLanguages() : QStringList{};
    if (autoLangs.isEmpty()) {
      auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), autoLangsContainer);
      emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
      autoLangsLayout->addWidget(emptyLbl);
    } else {
      for (const QString &code : autoLangs) {
        auto *row = new QWidget(autoLangsContainer);
        row->setObjectName(QStringLiteral("settings-row"));
        auto *h = new QHBoxLayout(row);
        h->setContentsMargins(18, 6, 18, 6);
        auto *lbl = new QLabel(getLanguageDisplayName(code), row);
        lbl->setObjectName(QStringLiteral("settings-row-title"));
        h->addWidget(lbl, 1);

        auto *delBtn = new QPushButton(QStringLiteral("🗑"), row);
        delBtn->setObjectName(QStringLiteral("settings-icon-del-btn"));
        delBtn->setToolTip(QStringLiteral("Kaldır"));
        QObject::connect(delBtn, &QPushButton::clicked, [translateSvc, code, autoLangsContainer, autoLangsLayout]() {
          if (translateSvc) {
            translateSvc->removeAutoTranslateLanguage(code);
            QSettings s;
            translateSvc->savePreferences(s);
            for (int i = 0; i < autoLangsLayout->count(); ++i) {
              auto *w = autoLangsLayout->itemAt(i)->widget();
              if (w) {
                auto *l = w->findChild<QLabel *>();
                if (l && l->text() == getLanguageDisplayName(code)) {
                  delete autoLangsLayout->takeAt(i)->widget();
                  break;
                }
              }
            }
            if (translateSvc->autoTranslateLanguages().isEmpty()) {
              auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), autoLangsContainer);
              emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
              autoLangsLayout->addWidget(emptyLbl);
            }
          }
        });
        h->addWidget(delBtn, 0, Qt::AlignVCenter);
        autoLangsLayout->addWidget(row);
      }
    }
  };

  // Never-translate list refresher
  auto refreshNeverTranslateList = [neverLangsContainer, neverLangsLayout, translateSvc]() {
    while (QLayoutItem *item = neverLangsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    const QStringList neverLangs = translateSvc ? translateSvc->neverTranslateLanguages() : QStringList{QStringLiteral("tr")};
    if (neverLangs.isEmpty()) {
      auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), neverLangsContainer);
      emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
      neverLangsLayout->addWidget(emptyLbl);
    } else {
      for (const QString &code : neverLangs) {
        auto *row = new QWidget(neverLangsContainer);
        row->setObjectName(QStringLiteral("settings-row"));
        auto *h = new QHBoxLayout(row);
        h->setContentsMargins(18, 6, 18, 6);
        auto *lbl = new QLabel(getLanguageDisplayName(code), row);
        lbl->setObjectName(QStringLiteral("settings-row-title"));
        h->addWidget(lbl, 1);

        auto *delBtn = new QPushButton(QStringLiteral("🗑"), row);
        delBtn->setObjectName(QStringLiteral("settings-icon-del-btn"));
        delBtn->setToolTip(QStringLiteral("Kaldır"));
        QObject::connect(delBtn, &QPushButton::clicked, [translateSvc, code, neverLangsContainer, neverLangsLayout]() {
          if (translateSvc) {
            translateSvc->removeNeverTranslateLanguage(code);
            QSettings s;
            translateSvc->savePreferences(s);
            for (int i = 0; i < neverLangsLayout->count(); ++i) {
              auto *w = neverLangsLayout->itemAt(i)->widget();
              if (w) {
                auto *l = w->findChild<QLabel *>();
                if (l && l->text() == getLanguageDisplayName(code)) {
                  delete neverLangsLayout->takeAt(i)->widget();
                  break;
                }
              }
            }
            if (translateSvc->neverTranslateLanguages().isEmpty()) {
              auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), neverLangsContainer);
              emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
              neverLangsLayout->addWidget(emptyLbl);
            }
          }
        });
        h->addWidget(delBtn, 0, Qt::AlignVCenter);
        neverLangsLayout->addWidget(row);
      }
    }
  };

  (*refreshPreferredLangs)();
  refreshAutoTranslateList();
  refreshNeverTranslateList();

  // Connections for Add Language buttons
  connect(addLangBtn, &QPushButton::clicked, this, [this, preferredLangs, syncAcceptLanguage, refreshPreferredLangs]() {
    AddLanguageDialog dlg(*preferredLangs, this);
    if (dlg.exec() == QDialog::Accepted) {
      for (const QString &c : dlg.selectedCodes()) {
        if (!preferredLangs->contains(c)) preferredLangs->append(c);
      }
      QSettings s;
      s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
      syncAcceptLanguage(*preferredLangs);
      (*refreshPreferredLangs)();
    }
  });

  connect(addAutoBtn, &QPushButton::clicked, this, [this, translateSvc, refreshAutoTranslateList]() {
    const QStringList existing = translateSvc ? translateSvc->autoTranslateLanguages() : QStringList{};
    AddLanguageDialog dlg(existing, this);
    if (dlg.exec() == QDialog::Accepted) {
      if (translateSvc) {
        for (const QString &c : dlg.selectedCodes()) translateSvc->addAutoTranslateLanguage(c);
        QSettings s;
        translateSvc->savePreferences(s);
        refreshAutoTranslateList();
      }
    }
  });

  connect(addNeverBtn, &QPushButton::clicked, this, [this, translateSvc, refreshNeverTranslateList]() {
    const QStringList existing = translateSvc ? translateSvc->neverTranslateLanguages() : QStringList{};
    AddLanguageDialog dlg(existing, this);
    if (dlg.exec() == QDialog::Accepted) {
      if (translateSvc) {
        for (const QString &c : dlg.selectedCodes()) translateSvc->addNeverTranslateLanguage(c);
        QSettings s;
        translateSvc->savePreferences(s);
        refreshNeverTranslateList();
      }
    }
  });

  connect(spellMasterSwitch, &QCheckBox::toggled, this, [this, spellLangsContainer, customDictRow](bool checked) {
    if (profileService_ && profileService_->profile()) {
      profileService_->profile()->setSpellCheckEnabled(checked);
    }
    QSettings s;
    s.setValue(QStringLiteral("spellcheck/enabled"), checked);
    spellLangsContainer->setEnabled(checked);
    customDictRow->setEnabled(checked);
  });

  connect(transMasterSwitch, &QCheckBox::toggled, this, [translateSvc, targetCombo, addAutoBtn, autoLangsContainer, addNeverBtn, neverLangsContainer](bool checked) {
    if (translateSvc) {
      translateSvc->setEnabled(checked);
      QSettings s;
      translateSvc->savePreferences(s);
    }
    targetCombo->setEnabled(checked);
    addAutoBtn->setEnabled(checked);
    autoLangsContainer->setEnabled(checked);
    addNeverBtn->setEnabled(checked);
    neverLangsContainer->setEnabled(checked);
  });

  // =========================================================================
  // 4. ÇEVİRİ SAĞLAYICISI VE API YAPILANDIRMASI
  // =========================================================================
  auto *configCard = makeCard(section.page, QStringLiteral("ÇEVİRİ SAĞLAYICISI VE API YAPILANDIRMASI"));

  auto *providerCombo = new QComboBox(configCard);
  providerCombo->setObjectName(QStringLiteral("settings-translation-provider"));
  providerCombo->addItem(QStringLiteral("Yapılandırılmamış"), QStringLiteral("none"));
  providerCombo->addItem(QStringLiteral("LibreTranslate"), QStringLiteral("libretranslate"));
  providerCombo->addItem(QStringLiteral("DeepL"), QStringLiteral("deepl"));
  providerCombo->addItem(QStringLiteral("Google Cloud Translation"), QStringLiteral("google_cloud"));
  providerCombo->addItem(QStringLiteral("Google Translate (Experimental / Unofficial)"), QStringLiteral("google_gtx"));

  QString currentProviderId = translateSvc ? translateSvc->providerId() : QStringLiteral("google_gtx");
  if (currentProviderId == QLatin1String("none")) {
    currentProviderId = QStringLiteral("google_gtx");
    if (translateSvc) {
      translateSvc->setProvider(currentProviderId);
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  }
  int pIdx = providerCombo->findData(currentProviderId);
  if (pIdx >= 0) providerCombo->setCurrentIndex(pIdx);

  addRow(configCard, settingRow(configCard, QStringLiteral("Çeviri sağlayıcısı"),
                                QStringLiteral("Sayfaların metinlerini çevirecek backend servisi."),
                                providerCombo));

  auto *stacked = new QStackedWidget(configCard);
  stacked->setObjectName(QStringLiteral("settings-translation-config-stack"));

  // Page 0: None / Unconfigured
  auto *nonePage = new QWidget(stacked);
  auto *noneLayout = new QVBoxLayout(nonePage);
  noneLayout->setContentsMargins(18, 14, 18, 14);
  auto *noneLabel = new QLabel(QStringLiteral("Sayfa çevirisi için bir sağlayıcı seçilmedi. Çeviriyi kullanmak için yukarıdaki listeden LibreTranslate, DeepL veya Google Cloud seçin."), nonePage);
  noneLabel->setObjectName(QStringLiteral("settings-row-description"));
  noneLabel->setWordWrap(true);
  noneLayout->addWidget(noneLabel);
  stacked->addWidget(nonePage);

  // Page 1: LibreTranslate
  auto *ltPage = new QWidget(stacked);
  auto *ltLayout = new QVBoxLayout(ltPage);
  ltLayout->setContentsMargins(0, 0, 0, 0);
  ltLayout->setSpacing(0);

  auto *ltUrlEdit = new QLineEdit(ltPage);
  ltUrlEdit->setObjectName(QStringLiteral("settings-lt-endpoint"));
  ltUrlEdit->setPlaceholderText(QStringLiteral("https://translate.example.com/translate"));
  if (translateSvc && translateSvc->libreTranslateEndpoint().isValid()) {
    ltUrlEdit->setText(translateSvc->libreTranslateEndpoint().toString());
  }
  ltLayout->addWidget(settingRow(ltPage, QStringLiteral("Sunucu adresi"), QStringLiteral("Self-hosted veya özel LibreTranslate REST uç noktası."), ltUrlEdit));

  auto *ltKeyEdit = new QLineEdit(ltPage);
  ltKeyEdit->setObjectName(QStringLiteral("settings-lt-key"));
  ltKeyEdit->setEchoMode(QLineEdit::Password);
  ltKeyEdit->setPlaceholderText(QStringLiteral("Opsiyonel API Anahtarı"));
  if (translateSvc) {
    ltKeyEdit->setText(translateSvc->loadApiKey(QStringLiteral("libretranslate")));
  }
  ltLayout->addWidget(settingRow(ltPage, QStringLiteral("API anahtarı (Opsiyonel)"), QStringLiteral("Sunucunuz kimlik doğrulama gerektiriyorsa girin."), ltKeyEdit));

  auto *ltTestBtn = new QPushButton(QStringLiteral("Bağlantıyı Test Et"), ltPage);
  auto *ltStatusLabel = new QLabel(ltPage);
  ltStatusLabel->setObjectName(QStringLiteral("settings-row-description"));
  ltLayout->addWidget(settingRow(ltPage, QStringLiteral("Bağlantı testi"), QStringLiteral("LibreTranslate sunucusuna test isteği göndererek doğrular."), ltTestBtn));
  ltLayout->addWidget(ltStatusLabel);
  stacked->addWidget(ltPage);

  // Page 2: DeepL
  auto *deeplPage = new QWidget(stacked);
  auto *deeplLayout = new QVBoxLayout(deeplPage);
  deeplLayout->setContentsMargins(0, 0, 0, 0);

  auto *deeplKeyEdit = new QLineEdit(deeplPage);
  deeplKeyEdit->setObjectName(QStringLiteral("settings-deepl-key"));
  deeplKeyEdit->setEchoMode(QLineEdit::Password);
  deeplKeyEdit->setPlaceholderText(QStringLiteral("DeepL API Anahtarı (örn: ...:fx)"));
  if (translateSvc) {
    deeplKeyEdit->setText(translateSvc->loadApiKey(QStringLiteral("deepl")));
  }
  deeplLayout->addWidget(settingRow(deeplPage, QStringLiteral("API anahtarı"), QStringLiteral("DeepL Free veya Pro abonelik anahtarınız."), deeplKeyEdit));

  auto *deeplPlanCombo = new QComboBox(deeplPage);
  deeplPlanCombo->addItem(QStringLiteral("DeepL API Free"), QStringLiteral("free"));
  deeplPlanCombo->addItem(QStringLiteral("DeepL API Pro"), QStringLiteral("pro"));
  if (translateSvc && translateSvc->deepLIsPro()) deeplPlanCombo->setCurrentIndex(1);
  deeplLayout->addWidget(settingRow(deeplPage, QStringLiteral("Plan türü"), QStringLiteral("Ücretsiz planlar için api-free.deepl.com, ücretli planlar için api.deepl.com kullanılır."), deeplPlanCombo));

  auto *deeplTestBtn = new QPushButton(QStringLiteral("Bağlantıyı Test Et"), deeplPage);
  auto *deeplStatusLabel = new QLabel(deeplPage);
  deeplStatusLabel->setObjectName(QStringLiteral("settings-row-description"));
  deeplLayout->addWidget(settingRow(deeplPage, QStringLiteral("Bağlantı testi"), QStringLiteral("DeepL API anahtarınızı test metniyle doğrular."), deeplTestBtn));
  deeplLayout->addWidget(deeplStatusLabel);
  stacked->addWidget(deeplPage);

  // Page 3: Google Cloud
  auto *gcpPage = new QWidget(stacked);
  auto *gcpLayout = new QVBoxLayout(gcpPage);
  gcpLayout->setContentsMargins(0, 0, 0, 0);

  auto *gcpKeyEdit = new QLineEdit(gcpPage);
  gcpKeyEdit->setObjectName(QStringLiteral("settings-gcp-key"));
  gcpKeyEdit->setEchoMode(QLineEdit::Password);
  gcpKeyEdit->setPlaceholderText(QStringLiteral("Google Cloud API Anahtarı"));
  if (translateSvc) {
    gcpKeyEdit->setText(translateSvc->loadApiKey(QStringLiteral("google_cloud")));
  }
  gcpLayout->addWidget(settingRow(gcpPage, QStringLiteral("API anahtarı"), QStringLiteral("Google Cloud Console üzerinden alınan Translation API anahtarı."), gcpKeyEdit));

  auto *gcpTestBtn = new QPushButton(QStringLiteral("Bağlantıyı Test Et"), gcpPage);
  auto *gcpStatusLabel = new QLabel(gcpPage);
  gcpStatusLabel->setObjectName(QStringLiteral("settings-row-description"));
  gcpLayout->addWidget(settingRow(gcpPage, QStringLiteral("Bağlantı testi"), QStringLiteral("Google Cloud API anahtarını doğrular."), gcpTestBtn));
  gcpLayout->addWidget(gcpStatusLabel);
  stacked->addWidget(gcpPage);

  // Page 4: Google GTX
  auto *gtxPage = new QWidget(stacked);
  auto *gtxLayout = new QVBoxLayout(gtxPage);
  gtxLayout->setContentsMargins(18, 14, 18, 14);
  auto *gtxNotice = new QLabel(QStringLiteral("<b>Deneysel / Resmi Olmayan Sağlayıcı</b><br>Bu sağlayıcı Google'ın resmi Cloud Translation API'si değildir. Dokümante edilmemiş bir web endpoint'i kullanır ve gelecekte Google tarafından haber verilmeden çalışmayı durdurabilir veya sınırlandırılabilir."), gtxPage);
  gtxNotice->setObjectName(QStringLiteral("settings-row-description"));
  gtxNotice->setWordWrap(true);
  gtxLayout->addWidget(gtxNotice);
  stacked->addWidget(gtxPage);

  const auto updateStack = [stacked, providerCombo]() {
    const QString p = providerCombo->currentData().toString();
    if (p == QLatin1String("libretranslate")) stacked->setCurrentIndex(1);
    else if (p == QLatin1String("deepl")) stacked->setCurrentIndex(2);
    else if (p == QLatin1String("google_cloud")) stacked->setCurrentIndex(3);
    else if (p == QLatin1String("google_gtx")) stacked->setCurrentIndex(4);
    else stacked->setCurrentIndex(0);
  };

  updateStack();

  connect(providerCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [translateSvc, providerCombo, updateStack]() {
    updateStack();
    if (translateSvc) {
      translateSvc->setProvider(providerCombo->currentData().toString());
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  });

  connect(ltUrlEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->setLibreTranslateEndpoint(QUrl(text.trimmed()));
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  });

  connect(ltKeyEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->saveApiKey(QStringLiteral("libretranslate"), text.trimmed());
    }
  });

  connect(deeplKeyEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->saveApiKey(QStringLiteral("deepl"), text.trimmed());
    }
  });

  connect(deeplPlanCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [translateSvc](int idx) {
    if (translateSvc) {
      translateSvc->setDeepLIsPro(idx == 1);
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  });

  connect(gcpKeyEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->saveApiKey(QStringLiteral("google_cloud"), text.trimmed());
    }
  });

  connect(ltTestBtn, &QPushButton::clicked, this, [translateSvc, ltStatusLabel]() {
    ltStatusLabel->setText(QStringLiteral("⏳ Test ediliyor..."));
    if (translateSvc) {
      translateSvc->testConnection(QStringLiteral("libretranslate"), [ltStatusLabel](bool success, const QString &msg) {
        ltStatusLabel->setText(msg);
        ltStatusLabel->setStyleSheet(success ? QStringLiteral("color: #81c995; padding-left: 18px;") : QStringLiteral("color: #f28b82; padding-left: 18px;"));
      });
    }
  });

  connect(deeplTestBtn, &QPushButton::clicked, this, [translateSvc, deeplStatusLabel]() {
    deeplStatusLabel->setText(QStringLiteral("⏳ Test ediliyor..."));
    if (translateSvc) {
      translateSvc->testConnection(QStringLiteral("deepl"), [deeplStatusLabel](bool success, const QString &msg) {
        deeplStatusLabel->setText(msg);
        deeplStatusLabel->setStyleSheet(success ? QStringLiteral("color: #81c995; padding-left: 18px;") : QStringLiteral("color: #f28b82; padding-left: 18px;"));
      });
    }
  });

  connect(gcpTestBtn, &QPushButton::clicked, this, [translateSvc, gcpStatusLabel]() {
    gcpStatusLabel->setText(QStringLiteral("⏳ Test ediliyor..."));
    if (translateSvc) {
      translateSvc->testConnection(QStringLiteral("google_cloud"), [gcpStatusLabel](bool success, const QString &msg) {
        gcpStatusLabel->setText(msg);
        gcpStatusLabel->setStyleSheet(success ? QStringLiteral("color: #81c995; padding-left: 18px;") : QStringLiteral("color: #f28b82; padding-left: 18px;"));
      });
    }
  });

  cardLayout(configCard)->addWidget(stacked);
  section.layout->addWidget(configCard);
  section.layout->addStretch();
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
  addRow(card, settingRow(card, QStringLiteral("Chromium profili"), QStringLiteral("Kalıcı çerezler, disk önbelleği ve site izinleri ArDaliBrowser profilinde saklanır."), nullptr, BrowserIcon::Settings, true));
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
      pm->setPolicyMode(ardali::PerformancePolicyMode::Balanced);
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
  Section section = makeSection(QStringLiteral("ArDaliBrowser hakkında"), QStringLiteral("Sürüm, geliştirici ve çalışma ortamı bilgileri."));
  auto *card = makeCard(section.page);
  auto *about = new QWidget(card);
  auto *layout = new QHBoxLayout(about);
  layout->setContentsMargins(24, 22, 24, 22);
  layout->setSpacing(20);

  auto *logo = new QLabel(about);
  logo->setPixmap(qApp->windowIcon().pixmap(72, 72));
  logo->setFixedSize(76, 76);
  logo->setAccessibleName(QStringLiteral("ArDaliBrowser logosu"));

  QString engine = QStringLiteral("Qt WebEngine (Chromium tabanlı)");
  if (profileService_ && profileService_->profile()) {
    const QRegularExpressionMatch match = QRegularExpression(QStringLiteral("Chrome/([0-9.]+)")).match(profileService_->profile()->httpUserAgent());
    if (match.hasMatch()) engine = QStringLiteral("Chromium %1").arg(match.captured(1));
  }

  auto *details = new QLabel(
      QStringLiteral("<h2>ArDaliBrowser</h2>"
                     "<p style='line-height: 1.6; font-size: 13px;'>"
                     "<b>Sürüm:</b> %1<br>"
                     "<b>Tarayıcı motoru:</b> %2<br>"
                     "<b>Qt sürümü:</b> %3<br>"
                     "<b>Geliştirici:</b> Muhammed Dali<br>"
                     "<b>GitHub:</b> <a style='color: #58a6ff; text-decoration: none; font-weight: 600;' href='https://github.com/Muhammed-Dali'>github.com/Muhammed-Dali</a><br>"
                     "<b>Proje Kaynak Kodu:</b> <a style='color: #58a6ff; text-decoration: none; font-weight: 600;' href='https://github.com/Muhammed-Dali/ArDali-Browser'>github.com/Muhammed-Dali/ArDali-Browser</a>"
                     "</p>")
          .arg(QStringLiteral(ARDALI_BROWSER_VERSION), engine, QString::fromLatin1(qVersion())),
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

  auto *repoBtn = new QPushButton(QStringLiteral("  ArDali-Browser GitHub Deposu"), linksCard);
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
    QDesktopServices::openUrl(QUrl(QStringLiteral("https://github.com/Muhammed-Dali/ArDali-Browser")));
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
