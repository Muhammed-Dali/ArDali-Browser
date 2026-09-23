#include "settings_page.h"
#include "settings_ui_helpers.h"
#include "tab_performance_manager.h"
#include "system_memory_pressure_monitor.h"

#include <QButtonGroup>
#include <QCheckBox>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QRadioButton>
#include <QSettings>
#include <QStyle>
#include <vector>

using namespace dalinira::settings_ui;

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
    dalinira::PerformancePolicyMode mode;
    QString title;
    QString badge;
    QString description;
  };

  const std::vector<ModeCardInfo> modeInfos = {
    { dalinira::PerformancePolicyMode::Balanced,
      QStringLiteral("Dengeli"),
      QStringLiteral("Önerilen"),
      QStringLiteral("Performans ve bellek kullanımı arasında dengeli bir deneyim sağlar.") },
    { dalinira::PerformancePolicyMode::MemorySaver,
      QStringLiteral("Bellek Tasarrufu"),
      QString(),
      QStringLiteral("Kullanmadığınız sekmelerin kaynak kullanımını daha erken azaltarak daha fazla bellek boşaltır.") },
    { dalinira::PerformancePolicyMode::MaximumPerformance,
      QStringLiteral("Maksimum Performans"),
      QString(),
      QStringLiteral("Sekmeleri daha uzun süre etkin tutarak hızlı geçişlere öncelik verir. Daha fazla bellek kullanabilir.") }
  };

  QVector<QFrame *> modeFrameWidgets;
  QVector<QRadioButton *> modeRadioButtons;

  QSettings preferences;
  const QString initialModeStr = preferences.value(QStringLiteral("performance/policyMode"), QStringLiteral("balanced")).toString().toLower();
  dalinira::PerformancePolicyMode currentMode = dalinira::PerformancePolicyMode::Balanced;
  if (perfManager) {
    currentMode = perfManager->policyMode();
  } else {
    if (initialModeStr == QLatin1String("memory_saver")) currentMode = dalinira::PerformancePolicyMode::MemorySaver;
    else if (initialModeStr == QLatin1String("maximum_performance")) currentMode = dalinira::PerformancePolicyMode::MaximumPerformance;
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
        case dalinira::PerformancePolicyMode::Balanced: s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("balanced")); break;
        case dalinira::PerformancePolicyMode::MemorySaver: s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("memory_saver")); break;
        case dalinira::PerformancePolicyMode::MaximumPerformance: s.setValue(QStringLiteral("performance/policyMode"), QStringLiteral("maximum_performance")); break;
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

    const QString normalized = dalinira::TabPerformanceManager::normalizeSitePattern(raw);
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
    dalinira::MemoryPressureLevel level = dalinira::MemoryPressureLevel::Normal;
    if (perfManager && perfManager->memoryPressureMonitor()) {
      level = perfManager->memoryPressureMonitor()->currentPressureLevel();
    }
    QString text;
    QString color;
    switch (level) {
      case dalinira::MemoryPressureLevel::Critical:
        text = QStringLiteral("Bellek kullanımı çok yüksek");
        color = QStringLiteral("#f28b82");
        break;
      case dalinira::MemoryPressureLevel::Moderate:
        text = QStringLiteral("Bellek kullanımı yüksek");
        color = QStringLiteral("#fdd663");
        break;
      case dalinira::MemoryPressureLevel::Normal:
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
    connect(perfManager->memoryPressureMonitor(), &dalinira::SystemMemoryPressureMonitor::pressureLevelChanged,
            statusLabel, [updateMemoryStatus](dalinira::MemoryPressureLevel) {
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
