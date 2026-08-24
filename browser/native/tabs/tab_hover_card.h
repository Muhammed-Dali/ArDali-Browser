#pragma once

#include <QFrame>
#include <QIcon>
#include <QLabel>
#include <QPointer>
#include <QTimer>
#include <QUrl>
#include <QVector>

class QWebEnginePage;
class QWebEngineView;

struct TabMemoryInfo {
  bool valid = false;
  qint64 bytes = 0;
  bool isShared = false;
  bool isRssFallback = false;
  QString text;
};

class TabHoverCard final : public QFrame {
  Q_OBJECT

 public:
  explicit TabHoverCard(QWidget *parent = nullptr);
  ~TabHoverCard() override = default;

  void showForTab(const QString &title, const QUrl &url, const QIcon &icon,
                  QWebEngineView *view, const QVector<QWebEngineView *> &allViews,
                  const QRect &globalTabRect, QWidget *anchorWidget);
  void hideCard();
  void refreshMemoryInfo();

  static TabMemoryInfo measureMemory(QWebEnginePage *page, const QVector<QWebEngineView *> &allViews);

 protected:
  void paintEvent(QPaintEvent *event) override;

 private:
  QLabel *iconLabel_ = nullptr;
  QLabel *titleLabel_ = nullptr;
  QLabel *domainLabel_ = nullptr;
  QFrame *separator_ = nullptr;
  QLabel *memoryDotLabel_ = nullptr;
  QLabel *memoryTextLabel_ = nullptr;

  QTimer memoryPollTimer_;
  QPointer<QWebEngineView> currentView_;
  QVector<QWebEngineView *> currentAllViews_;
};
