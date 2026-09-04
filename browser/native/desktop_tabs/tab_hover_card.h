#pragma once

#include <functional>
#include <QFrame>
#include <QIcon>
#include <QLabel>
#include <QPointer>
#include <QTimer>
#include <QUrl>
#include <QVector>

#include <QWebEnginePage>
#include <QWebEngineView>

struct TabMemoryInfo {
  bool valid = false;
  qint64 bytes = 0;
  bool isShared = false;
  int sharedCount = 1;
  bool isRssFallback = false;
  QString text;
};

class TabHoverCard final : public QFrame {
  Q_OBJECT

 public:
  using LifecycleProvider = std::function<QWebEnginePage::LifecycleState()>;

  explicit TabHoverCard(QWidget *parent = nullptr);
  ~TabHoverCard() override = default;

  void showForTab(const QString &title, const QUrl &url, const QIcon &icon,
                  QWebEngineView *view, const QVector<QPointer<QWebEngineView>> &allViews,
                  const QRect &globalTabRect, QWidget *anchorWidget,
                  LifecycleProvider lifecycleProvider,
                  bool isInternal = false);

  void showForTab(const QString &title, const QUrl &url, const QIcon &icon,
                  QWebEngineView *view, const QVector<QWebEngineView *> &allViews,
                  const QRect &globalTabRect, QWidget *anchorWidget = nullptr,
                  QWebEnginePage::LifecycleState lifecycleState = QWebEnginePage::LifecycleState::Active,
                  bool isInternal = false);

  void hideCard();
  void refreshCardInfo();

  static TabMemoryInfo measureMemory(QWebEnginePage *page, const QVector<QWebEngineView *> &allViews);
  static TabMemoryInfo measureMemory(QWebEnginePage *page, const QVector<QPointer<QWebEngineView>> &allViews);
  static QString extractDomain(const QUrl &url);

 protected:
  void paintEvent(QPaintEvent *event) override;
  void hideEvent(QHideEvent *event) override;

 private:
  QLabel *iconLabel_ = nullptr;
  QLabel *titleLabel_ = nullptr;
  QLabel *domainLabel_ = nullptr;
  QFrame *separator_ = nullptr;

  QWidget *lifecycleContainer_ = nullptr;
  QLabel *lifecycleIconLabel_ = nullptr;
  QLabel *lifecycleTextLabel_ = nullptr;

  QWidget *audioContainer_ = nullptr;
  QLabel *audioIconLabel_ = nullptr;
  QLabel *audioTextLabel_ = nullptr;

  QWidget *memoryContainer_ = nullptr;
  QLabel *memoryIconLabel_ = nullptr;
  QLabel *memoryTextLabel_ = nullptr;

  QTimer pollTimer_;
  QPointer<QWebEngineView> currentView_;
  QVector<QPointer<QWebEngineView>> currentAllViews_;
  LifecycleProvider lifecycleProvider_;
  QWebEnginePage::LifecycleState currentLifecycleState_ = QWebEnginePage::LifecycleState::Active;
  bool isInternal_ = false;
};
