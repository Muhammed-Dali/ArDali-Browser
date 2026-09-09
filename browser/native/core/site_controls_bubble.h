#pragma once

#include <QFrame>
#include <QLabel>
#include <QPointer>
#include <QPushButton>
#include <QScrollArea>
#include <QStackedWidget>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>
#include <QComboBox>
#include <functional>

#include "browser_icons.h"
#include "browser_profile_service.h"

class SiteControlsBubble : public QFrame {
  Q_OBJECT

 public:
  explicit SiteControlsBubble(QWidget *parent = nullptr);
  ~SiteControlsBubble() override = default;

  void setProfileService(BrowserProfileService *service);

  void updateForTab(uint64_t tabId,
                    const QUrl &url,
                    bool isHttps,
                    bool hasActiveCam,
                    bool hasActiveMic,
                    const std::function<bool(const QString &permKey)> &hasTempGrant);

  void refreshPermissions();

  QString currentHost() const { return host_; }
  QString currentCanonicalOrigin() const { return canonicalOrigin_; }
  QUrl currentUrl() const { return url_; }
  bool isHttps() const { return isHttps_; }
  bool hasActiveCam() const { return hasActiveCam_; }
  bool hasActiveMic() const { return hasActiveMic_; }

  int permissionChoice(const QString &key) const;
  bool isTemporaryBadgeVisible(const QString &key) const;
  void setPermissionChoice(const QString &key, int choice);
  void triggerResetAllPermissions();

  QString securityTitle() const;
  QString securityDescription() const;
  QString cookiesCountText() const;
  void triggerClearCookies();

  int stackIndex() const;
  void setStackIndex(int idx);

 signals:
  void permissionsResetRequested(const QString &canonicalOrigin);
  void permissionRuleChanged(const QString &key, const QString &canonicalOrigin, int choice);
  void cookiesClearedRequested(const QString &host);

 protected:
  void keyPressEvent(QKeyEvent *event) override;
  void hideEvent(QHideEvent *event) override;
  void paintEvent(QPaintEvent *event) override;

 private:
  void initializeUi();
  QWidget *createMainPage();
  QWidget *createSecurityPage();
  QWidget *createCookiesPage();
  QWidget *createPermissionsPage();
  QWidget *createAboutPage();

  void updateSecurityPageContent();
  void updateCookiesPageContent();
  void updatePermissionsPageContent();
  void updateAboutPageContent();

  QPointer<BrowserProfileService> profileService_;

  uint64_t tabId_ = 0;
  QUrl url_;
  QString host_;
  QString canonicalOrigin_;
  bool isHttps_ = false;
  bool hasActiveCam_ = false;
  bool hasActiveMic_ = false;
  std::function<bool(const QString &permKey)> hasTempGrantCallback_;

  QStackedWidget *stack_ = nullptr;

  // Main page widgets
  QLabel *mainHostLabel_ = nullptr;
  QToolButton *mainCloseBtn_ = nullptr;
  QPushButton *mainSecurityRow_ = nullptr;
  QLabel *mainSecurityIconLabel_ = nullptr;
  QLabel *mainSecurityTitleLabel_ = nullptr;
  QLabel *mainSecuritySubLabel_ = nullptr;

  QPushButton *mainCookiesRow_ = nullptr;
  QLabel *mainCookiesSubLabel_ = nullptr;

  QPushButton *mainPermsRow_ = nullptr;
  QLabel *mainPermsSubLabel_ = nullptr;

  QPushButton *mainAboutRow_ = nullptr;

  // Security page widgets
  QLabel *secHostLabel_ = nullptr;
  QLabel *secStatusIconLabel_ = nullptr;
  QLabel *secStatusTitleLabel_ = nullptr;
  QLabel *secStatusDescLabel_ = nullptr;
  QLabel *secCertIconLabel_ = nullptr;
  QLabel *secCertTitleLabel_ = nullptr;
  QLabel *secCertDescLabel_ = nullptr;

  // Cookies page widgets
  QLabel *cookiesHostLabel_ = nullptr;
  QLabel *cookiesCountLabel_ = nullptr;
  QLabel *cookiesStatusLabel_ = nullptr;
  QPushButton *cookiesClearBtn_ = nullptr;

  // Permissions page widgets
  QLabel *permsHostLabel_ = nullptr;
  QWidget *permsContainerWidget_ = nullptr;
  QVBoxLayout *permsListLayout_ = nullptr;
  QPushButton *resetAllPermsBtn_ = nullptr;

  struct PermissionRowWidgets {
    QString key;
    QLabel *iconLabel = nullptr;
    QLabel *titleLabel = nullptr;
    QLabel *tempBadgeLabel = nullptr;
    QComboBox *combo = nullptr;
  };
  QList<PermissionRowWidgets> permRows_;

  // About page widgets
  QLabel *aboutHostLabel_ = nullptr;
  QLabel *aboutUrlLabel_ = nullptr;
  QLabel *aboutProtocolLabel_ = nullptr;
  QLabel *aboutSecurityDetailLabel_ = nullptr;
};
