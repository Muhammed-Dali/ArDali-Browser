#pragma once

#include <QHash>
#include <QIcon>
#include <QObject>
#include <QPointer>
#include <QUrl>
#include <QUuid>
#include <QVector>

class QWebEnginePage;
class QWebEngineView;
class QWidget;

class TabManager final : public QObject {
  Q_OBJECT

 public:
  using TabId = QUuid;

  enum class TabKind { Web, Internal };

  struct TabCapabilities {
    bool closable = true;
    bool reorderable = true;
    bool detachable = true;
    bool persistentInSession = true;
  };

  struct TabRecord {
    TabId id;
    TabKind kind = TabKind::Web;
    QPointer<QWidget> content;
    QPointer<QWebEngineView> view;
    QPointer<QWebEnginePage> page;
    QPointer<QObject> ownerWindow;
    QString title;
    QString internalId;
    QUrl url;
    QIcon icon;
    TabCapabilities capabilities;
    bool active = false;
    bool detached = false;
    bool rendererCrashed = false;
    int rendererExitCode = 0;
    QString rendererStatus;
    int order = 0;
    quint64 activationSerial = 0;
  };

  explicit TabManager(QObject *parent = nullptr);

  TabId registerTab(QWebEngineView *view, QObject *ownerWindow, bool detached, const QString &title);
  TabId registerInternalTab(QWidget *content, QObject *ownerWindow, const QString &title,
                            const QString &internalId, TabCapabilities capabilities);
  bool transfer(TabId id, QObject *ownerWindow, bool detached);
  bool activate(TabId id);
  bool remove(TabId id);
  bool updateTitle(TabId id, const QString &title);
  bool updateUrl(TabId id, const QUrl &url);
  bool updateIcon(TabId id, const QIcon &icon);
  bool markRendererCrashed(TabId id, int terminationStatus, int exitCode);
  bool reorder(QObject *ownerWindow, const QVector<TabId> &orderedIds);

  TabId idFor(const QWebEngineView *view) const;
  TabId idForContent(const QWidget *content) const;
  TabId findInternal(QObject *ownerWindow, const QString &internalId) const;
  TabId activeFor(QObject *ownerWindow) const;
  const TabRecord *record(TabId id) const;
  QVector<TabRecord> recordsFor(QObject *ownerWindow) const;
  int recordCount() const { return records_.size(); }
  bool validate(QString *reason = nullptr) const;

 private:
  QHash<TabId, TabRecord> records_;
  QHash<const QWebEngineView *, TabId> viewIndex_;
  QHash<const QWidget *, TabId> contentIndex_;
  quint64 activationSerial_ = 0;
};
