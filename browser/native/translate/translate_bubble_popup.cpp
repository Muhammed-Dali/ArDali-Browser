#include "translate_bubble_popup.h"
#include "language_detector.h"

#include <QGraphicsDropShadowEffect>
#include <QHBoxLayout>
#include <QGuiApplication>
#include <QScreen>
#include <QAction>

TranslateBubblePopup::TranslateBubblePopup(QWidget *parent)
    : QFrame(parent, Qt::Popup | Qt::FramelessWindowHint) {
  setAttribute(Qt::WA_TranslucentBackground);
  setObjectName(QStringLiteral("translate-bubble-popup"));
  setFixedWidth(300);

  setStyleSheet(QStringLiteral(
      "QFrame#translate-bubble-popup {"
      "  background-color: #282a2d;"
      "  border: 1px solid #3c4043;"
      "  border-radius: 8px;"
      "}"
      "QPushButton, QToolButton {"
      "  font-family: system-ui, -apple-system, sans-serif;"
      "}"
      "QPushButton#source-lang-btn, QPushButton#target-lang-btn {"
      "  font-size: 13px;"
      "  padding: 6px 12px;"
      "  border-radius: 4px;"
      "  font-weight: 500;"
      "  min-height: 22px;"
      "}"
      "QPushButton#settings-btn {"
      "  background-color: #35363a;"
      "  color: #8ab4f8;"
      "  border: 1px solid #5f6368;"
      "  border-radius: 4px;"
      "  padding: 4px 8px;"
      "  font-size: 12px;"
      "}"
      "QPushButton#settings-btn:hover {"
      "  background-color: #43464a;"
      "  color: #ffffff;"
      "}"
      "QToolButton#more-btn, QToolButton#close-btn {"
      "  background: transparent;"
      "  border: none;"
      "  color: #9aa0a6;"
      "  font-size: 15px;"
      "  padding: 4px 6px;"
      "  border-radius: 4px;"
      "}"
      "QToolButton#more-btn:hover, QToolButton#close-btn:hover {"
      "  background-color: #35363a;"
      "  color: #ffffff;"
      "}"
      "QLabel#status-label {"
      "  font-size: 11px;"
      "  color: #9aa0a6;"
      "  font-family: system-ui, sans-serif;"
      "  padding-left: 4px;"
      "}"
      "QLabel#brand-label {"
      "  font-size: 11px;"
      "  color: #80868b;"
      "  font-family: system-ui, sans-serif;"
      "  padding-left: 4px;"
      "}"
      "QMenu {"
      "  background-color: #282a2d;"
      "  color: #e8eaed;"
      "  border: 1px solid #3c4043;"
      "  border-radius: 6px;"
      "  padding: 4px 0px;"
      "}"
      "QMenu::item {"
      "  padding: 6px 16px;"
      "  font-size: 13px;"
      "}"
      "QMenu::item:selected {"
      "  background-color: #35363a;"
      "  color: #ffffff;"
      "}"
  ));

  auto *effect = new QGraphicsDropShadowEffect(this);
  effect->setBlurRadius(16);
  effect->setColor(QColor(0, 0, 0, 180));
  effect->setOffset(0, 6);
  setGraphicsEffect(effect);

  auto *mainLayout = new QVBoxLayout(this);
  mainLayout->setContentsMargins(10, 10, 10, 8);
  mainLayout->setSpacing(6);

  // Top Tabs Row: [ Source ] [ Target ] [ ⋮ ] [ ✕ ]
  auto *tabsLayout = new QHBoxLayout;
  tabsLayout->setSpacing(4);

  sourceLangBtn_ = new QPushButton(QStringLiteral("İngilizce"), this);
  sourceLangBtn_->setObjectName(QStringLiteral("source-lang-btn"));
  sourceLangBtn_->setCursor(Qt::PointingHandCursor);

  targetLangBtn_ = new QPushButton(QStringLiteral("Türkçe"), this);
  targetLangBtn_->setObjectName(QStringLiteral("target-lang-btn"));
  targetLangBtn_->setCursor(Qt::PointingHandCursor);

  moreBtn_ = new QToolButton(this);
  moreBtn_->setObjectName(QStringLiteral("more-btn"));
  moreBtn_->setText(QStringLiteral("⋮"));
  moreBtn_->setPopupMode(QToolButton::InstantPopup);
  moreBtn_->setCursor(Qt::PointingHandCursor);

  closeBtn_ = new QToolButton(this);
  closeBtn_->setObjectName(QStringLiteral("close-btn"));
  closeBtn_->setText(QStringLiteral("✕"));
  closeBtn_->setCursor(Qt::PointingHandCursor);
  connect(closeBtn_, &QToolButton::clicked, this, &QWidget::close);

  tabsLayout->addWidget(sourceLangBtn_);
  tabsLayout->addWidget(targetLangBtn_);
  tabsLayout->addSpacing(2);
  tabsLayout->addWidget(moreBtn_);
  tabsLayout->addWidget(closeBtn_);
  mainLayout->addLayout(tabsLayout);

  // Middle Action / Error Row (e.g. Ayarları Aç)
  openSettingsBtn_ = new QPushButton(QStringLiteral("⚙ Çeviri Ayarlarını Aç"), this);
  openSettingsBtn_->setObjectName(QStringLiteral("settings-btn"));
  openSettingsBtn_->setCursor(Qt::PointingHandCursor);
  openSettingsBtn_->hide();
  connect(openSettingsBtn_, &QPushButton::clicked, this, [this] {
    emit openSettingsRequested();
    close();
  });
  mainLayout->addWidget(openSettingsBtn_);

  // Bottom Status / Brand Row
  auto *bottomLayout = new QHBoxLayout;
  statusLabel_ = new QLabel(this);
  statusLabel_->setObjectName(QStringLiteral("status-label"));
  brandLabel_ = new QLabel(QStringLiteral("ArDali Çeviri"), this);
  brandLabel_->setObjectName(QStringLiteral("brand-label"));

  bottomLayout->addWidget(brandLabel_);
  bottomLayout->addStretch();
  bottomLayout->addWidget(statusLabel_);
  mainLayout->addLayout(bottomLayout);

  connect(sourceLangBtn_, &QPushButton::clicked, this, [this] {
    if (translator_) {
      translator_->restoreOriginal();
    }
  });

  connect(targetLangBtn_, &QPushButton::clicked, this, [this] {
    if (translator_) {
      translator_->translatePage(QStringLiteral("tr"));
    }
  });

  setupMoreMenu();
}

void TranslateBubblePopup::setupMoreMenu() {
  moreMenu_ = new QMenu(this);

  auto *chooseLangMenu = moreMenu_->addMenu(QStringLiteral("Başka bir dil seç..."));
  static const QList<QPair<QString, QString>> kLanguages = {
      {QStringLiteral("Almanca"), QStringLiteral("de")},
      {QStringLiteral("Fransızca"), QStringLiteral("fr")},
      {QStringLiteral("İspanyolca"), QStringLiteral("es")},
      {QStringLiteral("İtalyanca"), QStringLiteral("it")},
      {QStringLiteral("Rusça"), QStringLiteral("ru")},
      {QStringLiteral("Arapça"), QStringLiteral("ar")},
      {QStringLiteral("Japonca"), QStringLiteral("ja")},
      {QStringLiteral("Çince"), QStringLiteral("zh")},
      {QStringLiteral("Türkçe"), QStringLiteral("tr")},
      {QStringLiteral("İngilizce"), QStringLiteral("en")},
  };

  for (const auto &lang : kLanguages) {
    auto *act = chooseLangMenu->addAction(lang.first);
    connect(act, &QAction::triggered, this, [this, code = lang.second] {
      if (translator_) {
        translator_->translatePage(code);
      }
    });
  }

  moreMenu_->addSeparator();
  auto *alwaysTranslateAct = moreMenu_->addAction(QStringLiteral("Bu dili her zaman çevir"));
  alwaysTranslateAct->setCheckable(true);

  auto *neverSiteAct = moreMenu_->addAction(QStringLiteral("Bu siteyi hiçbir zaman çevirme"));
  auto *neverLangAct = moreMenu_->addAction(QStringLiteral("Bu dili hiçbir zaman çevirme"));

  connect(neverSiteAct, &QAction::triggered, this, [this] { close(); });
  connect(neverLangAct, &QAction::triggered, this, [this] { close(); });

  moreMenu_->addSeparator();
  auto *settingsAct = moreMenu_->addAction(QStringLiteral("Çeviri Ayarları..."));
  connect(settingsAct, &QAction::triggered, this, [this] {
    emit openSettingsRequested();
    close();
  });

  moreBtn_->setMenu(moreMenu_);
}

void TranslateBubblePopup::setTranslator(PageTranslator *translator) {
  if (translator_ == translator) {
    updateUi();
    return;
  }

  if (translator_) {
    disconnect(translator_, nullptr, this, nullptr);
  }

  translator_ = translator;

  if (translator_) {
    connect(translator_, &PageTranslator::stateChanged, this, &TranslateBubblePopup::updateUi);
    connect(translator_, &PageTranslator::languageDetected, this, &TranslateBubblePopup::updateUi);
    connect(translator_, &PageTranslator::translationFinished, this, &TranslateBubblePopup::updateUi);
  }

  updateUi();
}

void TranslateBubblePopup::updateUi() {
  if (!translator_) {
    sourceLangBtn_->setText(QStringLiteral("Orijinal"));
    targetLangBtn_->setText(QStringLiteral("Türkçe"));
    statusLabel_->setText(QString());
    openSettingsBtn_->hide();
    return;
  }

  const QString srcLangName = LanguageDetector::languageDisplayName(translator_->sourceLanguage());
  const QString targetLangName = LanguageDetector::languageDisplayName(translator_->targetLanguage());

  sourceLangBtn_->setText(srcLangName.isEmpty() ? QStringLiteral("Orijinal") : srcLangName);
  targetLangBtn_->setText(targetLangName.isEmpty() ? QStringLiteral("Türkçe") : targetLangName);

  const QString kActiveTabStyle = QStringLiteral(
      "QPushButton {"
      "  color: #8ab4f8;"
      "  border: 1.5px solid #8ab4f8;"
      "  background-color: rgba(138, 180, 248, 0.08);"
      "  font-weight: 600;"
      "}"
      "QPushButton:hover {"
      "  background-color: rgba(138, 180, 248, 0.16);"
      "}"
  );

  const QString kInactiveTabStyle = QStringLiteral(
      "QPushButton {"
      "  color: #e8eaed;"
      "  border: 1.5px solid transparent;"
      "  background: transparent;"
      "  font-weight: normal;"
      "}"
      "QPushButton:hover {"
      "  background-color: #35363a;"
      "  color: #ffffff;"
      "}"
  );

  switch (translator_->state()) {
    case PageTranslator::State::Idle:
    case PageTranslator::State::Detected:
      sourceLangBtn_->setStyleSheet(kActiveTabStyle);
      targetLangBtn_->setStyleSheet(kInactiveTabStyle);
      statusLabel_->setText(QString());
      sourceLangBtn_->setEnabled(true);
      targetLangBtn_->setEnabled(true);
      openSettingsBtn_->hide();
      break;

    case PageTranslator::State::Translating:
      sourceLangBtn_->setStyleSheet(kInactiveTabStyle);
      targetLangBtn_->setStyleSheet(kActiveTabStyle);
      statusLabel_->setText(QStringLiteral("Çevriliyor..."));
      statusLabel_->setStyleSheet(QStringLiteral("color: #8ab4f8;"));
      sourceLangBtn_->setEnabled(false);
      targetLangBtn_->setEnabled(false);
      openSettingsBtn_->hide();
      break;

    case PageTranslator::State::Translated:
      sourceLangBtn_->setStyleSheet(kInactiveTabStyle);
      targetLangBtn_->setStyleSheet(kActiveTabStyle);
      statusLabel_->setText(QStringLiteral("✓ Çevrildi"));
      statusLabel_->setStyleSheet(QStringLiteral("color: #81c995;"));
      sourceLangBtn_->setEnabled(true);
      targetLangBtn_->setEnabled(true);
      openSettingsBtn_->hide();
      break;

    case PageTranslator::State::Error:
      sourceLangBtn_->setStyleSheet(kActiveTabStyle);
      targetLangBtn_->setStyleSheet(kInactiveTabStyle);
      const QString err = translator_->lastError();
      if (err.contains(QStringLiteral("yapılandırılmamış"), Qt::CaseInsensitive)) {
        statusLabel_->setText(QStringLiteral("⚠ Sağlayıcı seçilmedi"));
        openSettingsBtn_->show();
      } else {
        statusLabel_->setText(QStringLiteral("⚠ Hata"));
        openSettingsBtn_->show();
      }
      statusLabel_->setStyleSheet(QStringLiteral("color: #f28b82;"));
      sourceLangBtn_->setEnabled(true);
      targetLangBtn_->setEnabled(true);
      break;
  }
}

void TranslateBubblePopup::showAtAnchor(const QPoint &globalPos) {
  updateUi();
  adjustSize();

  QPoint pos = globalPos;
  if (const QScreen *screen = QGuiApplication::screenAt(globalPos)) {
    const QRect geom = screen->availableGeometry();
    if (pos.x() + width() > geom.right()) pos.setX(geom.right() - width() - 8);
    if (pos.y() + height() > geom.bottom()) pos.setY(pos.y() - height() - 36);
  }

  move(pos);
  show();
  raise();
  activateWindow();
}
