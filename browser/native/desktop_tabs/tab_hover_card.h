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
  void refreshCardInfo();

  static TabMemoryInfo measureMemory(QWebEnginePage *page, const QVector<QWebEngineView *> &allViews);
  static QString extractDomain(const QUrl &url);

 protected:
  void paintEvent(QPaintEvent *event) override;

 private:
  QLabel *iconLabel_ = nullptr;
  QLabel *titleLabel_ = nullptr;
  QLabel *domainLabel_ = nullptr;
  QFrame *separator_ = nullptr;

  QWidget *audioContainer_ = nullptr;
  QLabel *audioIconLabel_ = nullptr;
  QLabel *audioTextLabel_ = nullptr;

  QWidget *memoryContainer_ = nullptr;
  QLabel *memoryIconLabel_ = nullptr;
  QLabel *memoryTextLabel_ = nullptr;

  QTimer pollTimer_;
  QPointer<QWebEngineView> currentView_;
  QVector<QWebEngineView *> currentAllViews_;
};
