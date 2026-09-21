#include "translate_bubble_popup.h"
#include "language_detector.h"
#include "translate_service.h"

#include <QHBoxLayout>
#include <QGuiApplication>
#include <QScreen>
#include <QAction>
#include <QPainter>
#include <QPainterPath>

TranslateBubblePopup::TranslateBubblePopup(QWidget *parent)
    : QFrame(parent, Qt::Popup | Qt::FramelessWindowHint | Qt::NoDropShadowWindowHint) {
  setAttribute(Qt::WA_TranslucentBackground, true);
  setAttribute(Qt::WA_StyledBackground, false);
  setObjectName(QStringLiteral("translate-bubble-popup"));
  setFixedWidth(290);

  setStyleSheet(QStringLiteral(
      "QFrame#translate-bubble-popup {"
      "  background: transparent;"
      "}"
      "QPushButton, QToolButton {"
      "  font-family: system-ui, -apple-system, sans-serif;"
      "}"
      "QPushButton#source-lang-btn, QPushButton#target-lang-btn {"
      "  font-size: 13px;"
      "  font-weight: 500;"
      "  padding: 6px 10px;"
      "  background: transparent;"
      "  border: none;"
      "  border-bottom: 2px solid transparent;"
      "  border-radius: 0px;"
      "  min-height: 22px;"
      "}"
      "QPushButton#settings-btn {"
      "  background-color: #35363a;"
      "  color: #8ab4f8;"
      "  border: 1px solid #5f6368;"
      "  border-radius: 4px;"
      "  padding: 5px 8px;"
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
      "  padding: 3px 5px;"
      "  border-radius: 4px;"
      "}"
      "QToolButton#more-btn:hover, QToolButton#close-btn:hover {"
      "  background-color: #35363a;"
      "  color: #ffffff;"
      "}"
      "QToolButton::menu-indicator {"
      "  image: none;"
      "  width: 0px;"
      "}"
      "QLabel#status-label {"
      "  font-size: 11px;"
      "  color: #9aa0a6;"
      "  font-family: system-ui, sans-serif;"
      "  padding-right: 2px;"
      "}"
      "QLabel#brand-label {"
      "  font-size: 11px;"
      "  color: #80868b;"
      "  font-family: system-ui, sans-serif;"
      "  padding-left: 2px;"
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

  auto *mainLayout = new QVBoxLayout(this);
  mainLayout->setContentsMargins(12, 10, 12, 10);
  mainLayout->setSpacing(6);

  // Top Tabs Row: [ Source ] [ Target ] [stretch] [ ⋮ ] [ ✕ ]
  auto *tabsLayout = new QHBoxLayout;
  tabsLayout->setSpacing(4);
  tabsLayout->setContentsMargins(0, 0, 0, 0);

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
  tabsLayout->addStretch();
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
  bottomLayout->setContentsMargins(0, 0, 0, 0);
  brandLabel_ = new QLabel(QStringLiteral("ArDali Çeviri"), this);
  brandLabel_->setObjectName(QStringLiteral("brand-label"));
  statusLabel_ = new QLabel(this);
  statusLabel_->setObjectName(QStringLiteral("status-label"));

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
      const QString target = translator_->targetLanguage().isEmpty() ? QStringLiteral("tr") : translator_->targetLanguage();
      translator_->translatePage(target);
    }
  });

  setupMoreMenu();
}

void TranslateBubblePopup::paintEvent(QPaintEvent *event) {
  Q_UNUSED(event);
  QPainter painter(this);
  painter.setRenderHint(QPainter::Antialiasing);

  const QRectF r = QRectF(rect()).adjusted(0.5, 0.5, -0.5, -0.5);
  QPainterPath path;
  path.addRoundedRect(r, 8.0, 8.0);

  // 100% solid, fully opaque dark background - prevents any page bleed-through
  painter.fillPath(path, QColor(0x28, 0x2a, 0x2d));

  // 1px crisp subtle border
  QPen pen(QColor(0x3c, 0x40, 0x43));
  pen.setWidthF(1.0);
  painter.setPen(pen);
  painter.drawPath(path);
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

  connect(moreMenu_, &QMenu::aboutToShow, this, [this, alwaysTranslateAct] {
    if (translator_ && translator_->service() && !translator_->sourceLanguage().isEmpty()) {
      alwaysTranslateAct->setChecked(translator_->service()->shouldAutoTranslate(translator_->sourceLanguage()));
    }
  });

  connect(alwaysTranslateAct, &QAction::toggled, this, [this](bool checked) {
    if (translator_ && translator_->service() && !translator_->sourceLanguage().isEmpty()) {
      if (checked) {
        translator_->service()->addAutoTranslateLanguage(translator_->sourceLanguage());
      } else {
        translator_->service()->removeAutoTranslateLanguage(translator_->sourceLanguage());
      }
    }
  });

  connect(neverSiteAct, &QAction::triggered, this, [this] { close(); });
  connect(neverLangAct, &QAction::triggered, this, [this] {
    if (translator_ && translator_->service() && !translator_->sourceLanguage().isEmpty()) {
      translator_->service()->addNeverTranslateLanguage(translator_->sourceLanguage());
    }
    close();
  });

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
  QString srcCode = translator_ ? translator_->sourceLanguage() : QString();
  QString targetCode = translator_ ? translator_->targetLanguage() : QStringLiteral("tr");

  QString srcLangName = LanguageDetector::languageDisplayName(srcCode);
  if (srcLangName.isEmpty() || srcLangName == srcCode) {
    if (srcCode.isEmpty()) {
      srcLangName = QStringLiteral("Orijinal");
    } else {
      srcLangName = srcCode.toUpper();
    }
  }

  QString targetLangName = LanguageDetector::languageDisplayName(targetCode);
  if (targetLangName.isEmpty()) {
    targetLangName = QStringLiteral("Türkçe");
  }

  sourceLangBtn_->setText(srcLangName);
  targetLangBtn_->setText(targetLangName);

  if (translator_ && translator_->service()) {
    const QString pid = translator_->service()->providerId();
    if (pid == QLatin1String("google_cloud") || pid == QLatin1String("google_gtx")) {
      brandLabel_->setText(QStringLiteral("Google Translate"));
    } else if (pid == QLatin1String("libretranslate")) {
      brandLabel_->setText(QStringLiteral("LibreTranslate"));
    } else if (pid == QLatin1String("deepl")) {
      brandLabel_->setText(QStringLiteral("DeepL"));
    } else {
      brandLabel_->setText(QStringLiteral("ArDali Çeviri"));
    }
  } else {
    brandLabel_->setText(QStringLiteral("ArDali Çeviri"));
  }

  const QString kActiveTabStyle = QStringLiteral(
      "QPushButton {"
      "  color: #8ab4f8;"
      "  border: none;"
      "  border-bottom: 2px solid #8ab4f8;"
      "  background: transparent;"
      "  border-radius: 0px;"
      "  font-weight: 600;"
      "  font-size: 13px;"
      "  padding: 6px 10px;"
      "}"
      "QPushButton:hover {"
      "  background-color: rgba(138, 180, 248, 0.08);"
      "}"
  );

  const QString kInactiveTabStyle = QStringLiteral(
      "QPushButton {"
      "  color: #9aa0a6;"
      "  border: none;"
      "  border-bottom: 2px solid transparent;"
      "  background: transparent;"
      "  border-radius: 0px;"
      "  font-weight: 500;"
      "  font-size: 13px;"
      "  padding: 6px 10px;"
      "}"
      "QPushButton:hover {"
      "  color: #e8eaed;"
      "  background-color: rgba(255, 255, 255, 0.06);"
      "}"
  );

  if (!translator_) {
    sourceLangBtn_->setStyleSheet(kActiveTabStyle);
    targetLangBtn_->setStyleSheet(kInactiveTabStyle);
    statusLabel_->setText(QString());
    openSettingsBtn_->hide();
    return;
  }

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
      statusLabel_->setStyleSheet(QStringLiteral("color: #8ab4f8; font-size: 11px;"));
      sourceLangBtn_->setEnabled(false);
      targetLangBtn_->setEnabled(false);
      openSettingsBtn_->hide();
      break;

    case PageTranslator::State::Translated:
      sourceLangBtn_->setStyleSheet(kInactiveTabStyle);
      targetLangBtn_->setStyleSheet(kActiveTabStyle);
      statusLabel_->setText(QStringLiteral("✓ Çevrildi"));
      statusLabel_->setStyleSheet(QStringLiteral("color: #81c995; font-size: 11px;"));
      sourceLangBtn_->setEnabled(true);
      targetLangBtn_->setEnabled(true);
      openSettingsBtn_->hide();
      break;

    case PageTranslator::State::Error:
      sourceLangBtn_->setStyleSheet(kActiveTabStyle);
      targetLangBtn_->setStyleSheet(kInactiveTabStyle);
      const QString err = translator_->lastError();
      if (err.contains(QStringLiteral("yapılandırılmamış"), Qt::CaseInsensitive) ||
          err.contains(QStringLiteral("seçilmedi"), Qt::CaseInsensitive)) {
        statusLabel_->setText(QStringLiteral("⚠ Sağlayıcı seçilmedi"));
      } else {
        statusLabel_->setText(QStringLiteral("⚠ Hata"));
      }
      statusLabel_->setStyleSheet(QStringLiteral("color: #f28b82; font-size: 11px;"));
      openSettingsBtn_->show();
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
    if (pos.x() < geom.left() + 8) pos.setX(geom.left() + 8);
    if (pos.y() + height() > geom.bottom()) pos.setY(pos.y() - height() - 36);
    if (pos.y() < geom.top() + 8) pos.setY(geom.top() + 8);
  }

  move(pos);
  show();
  raise();
  activateWindow();
}
