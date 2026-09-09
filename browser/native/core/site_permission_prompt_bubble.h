#pragma once

#include <QDateTime>
#include <QFrame>
#include <QLabel>
#include <QPointer>
#include <QPushButton>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif

#include "browser_icons.h"

enum class SitePermissionChoice {
  AllowThisVisit,
  AlwaysAllow,
  Block,
  Dismissed
};

class SitePermissionPromptBubble : public QFrame {
  Q_OBJECT

 public:
  explicit SitePermissionPromptBubble(QWidget *parent = nullptr);
  ~SitePermissionPromptBubble() override = default;

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
  void setupPrompt(const QUrl &origin, QWebEnginePermission::PermissionType type);
#endif
  void setupPromptLegacy(const QUrl &origin, const QString &featureText, BrowserIcon icon);

  QUrl origin() const { return origin_; }
  QString canonicalOrigin() const { return canonicalOrigin_; }
  QString promptText() const { return promptTextLabel_ ? promptTextLabel_->text() : QString(); }

 signals:
  void choiceMade(SitePermissionChoice choice);

 protected:
  void keyPressEvent(QKeyEvent *event) override;
  void paintEvent(QPaintEvent *event) override;

 private:
  void initializeUi();
  static QString formatPermissionPromptText(const QString &displayHost, const QString &featureDescription);

  QUrl origin_;
  QString canonicalOrigin_;

  QLabel *iconLabel_ = nullptr;
  QLabel *originLabel_ = nullptr;
  QToolButton *closeBtn_ = nullptr;
  QLabel *promptTextLabel_ = nullptr;

  QPushButton *allowThisVisitBtn_ = nullptr;
  QPushButton *alwaysAllowBtn_ = nullptr;
  QPushButton *blockBtn_ = nullptr;
};
