#include <QAction>
#include <QApplication>
#include <QBuffer>
#include <QCloseEvent>
#include <QCheckBox>
#include <QColor>
#include <QClipboard>
#include <QComboBox>
#include <QCompleter>
#include <QCursor>
#include <QDir>
#include <QDrag>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QEasingCurve>
#include <QFontMetrics>
#include <QEvent>
#include <QElapsedTimer>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QFrame>
#include <QGuiApplication>
#include <QHash>
#include <QHideEvent>
#include <QHBoxLayout>
#include <QIcon>
#include <QImage>
#include <QLabel>
#include <QLineEdit>
#include <QListView>
#include <QListWidget>
#include <QMainWindow>
#include <QMenu>
#include <QMessageBox>
#include <QMimeData>
#include <QMouseEvent>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>
#include <QProgressBar>
#include <QVariantAnimation>
#include <QPushButton>
#include <QPixmap>
#include <QPainter>
#include <QPainterPath>
#include <QRegularExpression>
#include <QResizeEvent>
#include <QScrollArea>
#include <QScrollBar>
#include <QScreen>
#include <QSet>
#include <QShortcut>
#include <QSignalBlocker>
#include <QSizePolicy>
#include <QSlider>
#include <QSettings>
#include <QStackedWidget>
#include <QStandardPaths>
#include <QStandardItem>
#include <QStandardItemModel>
#include <QStyledItemDelegate>
#include <QKeySequence>
#include <QTabBar>
#include <QTimer>
#include <QTemporaryDir>
#include <QToolBar>
#include <QToolButton>
#include <QUrl>
#include <QUrlQuery>
#include <QVBoxLayout>
#include <QWebEnginePage>
#include <QWebEnginePermission>
#include <QWebEngineProfile>
#include <QWebEngineHistory>
#include <QWebEngineContextMenuRequest>
#include <QWebEngineView>
#include <QWheelEvent>
#include <QWindow>
#include <QStyle>

#include <cmath>
#include <atomic>
#include <cstdio>
#include <functional>
#include <memory>
#include <optional>

#include "tab_manager.h"
#include "browser_policy.h"
#include "browser_profile_service.h"
#include "browser_icons.h"
#include "new_tab_scheme.h"
#include "new_tab_html.h"
#include "new_tab_background_store.h"
#include "session_store.h"
#include "settings_page.h"

namespace {

constexpr char kDetachedTabMimeType[] = "application/x-ardali-detached-tab";
std::atomic<quint64> gBrowserWindowSequence{1};

struct SearchEngine {
  const char *name;
  const char *searchUrl;
};

constexpr SearchEngine kSearchEngines[] = {
    {"Google", "https://www.google.com/search?q=%1"},
    {"DuckDuckGo", "https://duckduckgo.com/?q=%1"},
    {"Brave Search", "https://search.brave.com/search?q=%1"},
    {"Bing", "https://www.bing.com/search?q=%1"},
};

QString searchUrlFor(const QString &engine, const QString &query) {
  for (const auto &candidate : kSearchEngines) {
    if (engine == QLatin1String(candidate.name))
      return QString::fromLatin1(candidate.searchUrl).arg(QString::fromLatin1(QUrl::toPercentEncoding(query)));
  }
  return QString::fromLatin1(kSearchEngines[0].searchUrl).arg(QString::fromLatin1(QUrl::toPercentEncoding(query)));
}

QUrl resolveAddressInput(const QString &input, const QString &engine) {
  const QString text = input.trimmed();
  if (text.isEmpty()) return {};
  const QUrl direct(text);
  if (direct.isValid() && (direct.scheme() == QLatin1String("http") || direct.scheme() == QLatin1String("https"))) return direct;
  if (!text.contains(QRegularExpression("\\s")) && (text.contains('.') || text == QLatin1String("localhost")))
    return QUrl::fromUserInput(QStringLiteral("https://") + text);
  return QUrl(searchUrlFor(engine, text));
}

bool isNewTabUrl(const QUrl &url) {
  return (url.scheme() == QLatin1String("ardali") && url.host() == QLatin1String("newtab"))
      || url.host() == QLatin1String("ardali-browser.local")
      || (url.isLocalFile() && url.path().contains(QStringLiteral("/assets/new-tab/")));
}

QString frequentSiteDisplayName(const QUrl &url) {
  QString host = url.host().toLower();
  if (host.startsWith(QStringLiteral("www."))) host.remove(0, 4);
  if (host == QLatin1String("localhost") || host.contains(QRegularExpression(QStringLiteral("^\\d{1,3}(?:\\.\\d{1,3}){3}$")))) {
    const int port = url.port();
    return port > 0 && port != 80 && port != 443 ? QStringLiteral("%1:%2").arg(host).arg(port) : host;
  }
  static const QHash<QString, QString> brandNames = {
      {QStringLiteral("youtube"), QStringLiteral("YouTube")},
      {QStringLiteral("google"), QStringLiteral("Google")},
      {QStringLiteral("github"), QStringLiteral("GitHub")},
      {QStringLiteral("ebay"), QStringLiteral("eBay")},
      {QStringLiteral("linkedin"), QStringLiteral("LinkedIn")},
      {QStringLiteral("tiktok"), QStringLiteral("TikTok")},
      {QStringLiteral("duckduckgo"), QStringLiteral("DuckDuckGo")},
      {QStringLiteral("wikipedia"), QStringLiteral("Wikipedia")},
      {QStringLiteral("instagram"), QStringLiteral("Instagram")},
      {QStringLiteral("facebook"), QStringLiteral("Facebook")},
      {QStringLiteral("twitter"), QStringLiteral("Twitter")},
      {QStringLiteral("reddit"), QStringLiteral("Reddit")},
      {QStringLiteral("amazon"), QStringLiteral("Amazon")},
      {QStringLiteral("netflix"), QStringLiteral("Netflix")},
      {QStringLiteral("spotify"), QStringLiteral("Spotify")},
      {QStringLiteral("twitch"), QStringLiteral("Twitch")},
      {QStringLiteral("microsoft"), QStringLiteral("Microsoft")},
      {QStringLiteral("outlook"), QStringLiteral("Outlook")},
  };
  const QStringList parts = host.split(QLatin1Char('.'), Qt::SkipEmptyParts);
  if (parts.isEmpty()) return host;
  QString platform = parts.size() >= 2 ? parts.at(parts.size() - 2) : parts.constFirst();
  // co.uk/com.tr gibi iki parçalı ülke uzantılarında marka bir önceki parçadır.
  static const QSet<QString> countrySecondLevels = {
      QStringLiteral("com"), QStringLiteral("co"), QStringLiteral("org"),
      QStringLiteral("net"), QStringLiteral("gov"), QStringLiteral("edu")};
  if (parts.size() >= 3 && countrySecondLevels.contains(platform)) platform = parts.at(parts.size() - 3);
  if (brandNames.contains(platform)) return brandNames.value(platform);
  if (!platform.isEmpty()) platform[0] = platform.at(0).toUpper();
  return platform;
}

QIcon bookmarkIcon(bool bookmarked) {
  QPixmap pixmap(32, 32);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing);
  const QColor color = bookmarked ? QColor(QStringLiteral("#4fc3f7")) : QColor(QStringLiteral("#d8dce0"));
  QPainterPath ribbon;
  ribbon.moveTo(10.0, 5.5);
  ribbon.lineTo(22.0, 5.5);
  ribbon.lineTo(22.0, 25.0);
  ribbon.lineTo(16.0, 20.7);
  ribbon.lineTo(10.0, 25.0);
  ribbon.closeSubpath();
  painter.setPen(QPen(color, 2.0, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
  painter.setBrush(bookmarked ? QBrush(color) : Qt::NoBrush);
  painter.drawPath(ribbon);
  return QIcon(pixmap);
}

QIcon zoomIcon() {
  QPixmap pixmap(32, 32);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing);
  painter.setPen(QPen(QColor(QStringLiteral("#a9c7fa")), 2.8, Qt::SolidLine, Qt::RoundCap));
  painter.drawEllipse(QRectF(3.5, 3.5, 18.0, 18.0));
  painter.drawLine(QPointF(17.5, 17.5), QPointF(28.0, 28.0));
  return QIcon(pixmap);
}

QString bookmarkDisplayName(const QUrl &url) {
  const QString host = url.host().toLower();
  if (host.endsWith(QStringLiteral("youtube.com"))) return QStringLiteral("YouTube");
  if (host.endsWith(QStringLiteral("github.com"))) return QStringLiteral("GitHub");
  if (host.endsWith(QStringLiteral("wikipedia.org"))) return QStringLiteral("Wikipedia");
  if (host.endsWith(QStringLiteral("google.com"))) return QStringLiteral("Google");
  if (host.endsWith(QStringLiteral("duckduckgo.com"))) return QStringLiteral("DuckDuckGo");
  return host.isEmpty() ? url.toDisplayString() : host;
}

QString suggestionDomainFor(const QString &value) {
  const QString folded = value.toCaseFolded();
  static const QList<QPair<QString, QString>> catalog = {
      {QStringLiteral("ebay"), QStringLiteral("ebay.com")},
      {QStringLiteral("youtube"), QStringLiteral("youtube.com")},
      {QStringLiteral("github"), QStringLiteral("github.com")},
      {QStringLiteral("wikipedia"), QStringLiteral("wikipedia.org")},
      {QStringLiteral("hotmail"), QStringLiteral("outlook.com")},
      {QStringLiteral("outlook"), QStringLiteral("outlook.com")},
      {QStringLiteral("home depot"), QStringLiteral("homedepot.com")},
      {QStringLiteral("hbo"), QStringLiteral("hbo.com")},
      {QStringLiteral("reddit"), QStringLiteral("reddit.com")},
  };
  for (const auto &[name, domain] : catalog) {
    if (folded == name || folded.startsWith(name + QLatin1Char(' '))) return domain;
  }
  return {};
}

enum AddressSuggestionRole {
  SuggestionUrlRole = Qt::UserRole,
  SuggestionKindRole = Qt::UserRole + 1,
  SuggestionDetailRole = Qt::UserRole + 2,
  SuggestionHeaderRole = Qt::UserRole + 3,
};

class AddressSuggestionDelegate final : public QStyledItemDelegate {
 public:
  using QStyledItemDelegate::QStyledItemDelegate;

  QSize sizeHint(const QStyleOptionViewItem &, const QModelIndex &index) const override {
    return {500, index.data(SuggestionHeaderRole).toBool() ? 27 : 50};
  }

  void paint(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const override {
    painter->save();
    const QRect rect = option.rect;
    if (index.data(SuggestionHeaderRole).toBool()) {
      painter->fillRect(rect, QColor(QStringLiteral("#25272b")));
      QFont font = option.font;
      font.setBold(true);
      font.setPointSize(std::max(8, font.pointSize() - 1));
      painter->setFont(font);
      painter->setPen(QColor(QStringLiteral("#a9c7fa")));
      painter->drawText(rect.adjusted(14, 0, -10, 0), Qt::AlignVCenter | Qt::AlignLeft, index.data(Qt::DisplayRole).toString());
      painter->restore();
      return;
    }

    const bool selected = option.state.testFlag(QStyle::State_Selected);
    painter->fillRect(rect, selected ? QColor(QStringLiteral("#3c4043")) : QColor(QStringLiteral("#202124")));
    const QString kind = index.data(SuggestionKindRole).toString();
    const QString symbol = kind == QLatin1String("bookmark") ? QStringLiteral("★")
        : kind == QLatin1String("history") ? QStringLiteral("◷") : QStringLiteral("⌕");
    QFont symbolFont = option.font;
    symbolFont.setPointSize(symbolFont.pointSize() + 3);
    painter->setFont(symbolFont);
    painter->setPen(QColor(QStringLiteral("#8ab4f8")));
    painter->drawText(QRect(rect.left() + 13, rect.top(), 22, rect.height()), Qt::AlignCenter, symbol);

    painter->setFont(option.font);
    painter->setPen(QColor(QStringLiteral("#f1f3f4")));
    painter->drawText(rect.adjusted(45, 5, -12, -24), Qt::AlignLeft | Qt::AlignVCenter,
                      QFontMetrics(option.font).elidedText(index.data(Qt::DisplayRole).toString(), Qt::ElideRight, rect.width() - 58));
    QFont detailFont = option.font;
    detailFont.setPointSize(std::max(8, detailFont.pointSize() - 1));
    painter->setFont(detailFont);
    painter->setPen(QColor(QStringLiteral("#bdc1c6")));
    painter->drawText(rect.adjusted(45, 25, -12, -4), Qt::AlignLeft | Qt::AlignVCenter,
                      QFontMetrics(detailFont).elidedText(index.data(SuggestionDetailRole).toString(), Qt::ElideMiddle, rect.width() - 58));
    painter->restore();
  }
};

}  // namespace

class BrowserPage final : public QWebEnginePage {
 public:
  using NewTabFactory = std::function<QWebEnginePage *(WebWindowType)>;

  BrowserPage(QWebEngineProfile *profile, const BrowserPolicy *policy, BrowserProfileService *profileService, NewTabFactory newTabFactory, QObject *parent)
      : QWebEnginePage(profile, parent), policy_(policy), profileService_(profileService), newTabFactory_(std::move(newTabFactory)) {
    connect(this, &QWebEnginePage::permissionRequested, this, [this](const QWebEnginePermission &permission) {
      if (profileService_) profileService_->handlePermission(permission); else permission.deny();
    });
  }

 protected:
  bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override {
    // The browser's own packaged new-tab document uses a local base URL so it
    // can load its bundled Flow Blue image. This is deliberately narrower than
    // allowing arbitrary file:// navigation.
    if (isMainFrame && !isNewTabUrl(url) && (!policy_ || !policy_->allowsNavigation(url))) return false;
    return QWebEnginePage::acceptNavigationRequest(url, type, isMainFrame);
  }

  QWebEnginePage *createWindow(WebWindowType type) override {
    // User gestures such as target=_blank and middle-click are reported as
    // tab requests. Script-created browser/dialog windows stay blocked.
    if (type != WebBrowserTab && type != WebBrowserBackgroundTab) return nullptr;
    return newTabFactory_ ? newTabFactory_(type) : nullptr;
  }

 private:
  const BrowserPolicy *policy_ = nullptr;
  BrowserProfileService *profileService_ = nullptr;
  NewTabFactory newTabFactory_;
};

class BrowserTabBar final : public QTabBar {
  Q_OBJECT
 public:
  explicit BrowserTabBar(QWidget *parent = nullptr) : QTabBar(parent) {
    // Qt's built-in mode paints the moving tab above arbitrary child controls.
    // A separate drag proxy gives the browser chrome a deterministic z-order.
    setMovable(false);
    setExpanding(false);
    setDocumentMode(true);
    setUsesScrollButtons(false);
  }

  void setDetachEnabled(bool enabled) { detachEnabled_ = enabled; }
  void setExternalAttachDragEnabled(bool enabled) { externalAttachDragEnabled_ = enabled; }
  bool externalAttachDragEnabled() const { return externalAttachDragEnabled_; }
  int contentWidth() const {
    int width = 0;
    for (int index = 0; index < count(); ++index) width += tabSizeHint(index).width() + 3;
    return width;
  }

  int visualTabsRight() const {
    int right = 0;
    for (int index = 0; index < count(); ++index) right = std::max(right, tabRect(index).right() + 1);
    return right;
  }

  QSize tabSizeHint(int index) const override {
    // Do not let the platform tab style use the full available bar width.
    // The close button and chrome padding are included in this explicit size.
    const int textWidth = fontMetrics().horizontalAdvance(tabText(index));
    return {std::clamp(textWidth + 62, 150, 248), 30};
  }

  QSize minimumTabSizeHint(int index) const override { return tabSizeHint(index); }

signals:
  void detachRequested(int index, QPoint screenPosition, QPoint pointerOffset);
  void pointerDragStarted(QPoint screenPosition);
  void pointerDragMoved(QPoint screenPosition);
  void pointerDragFinished();
  void draggedTabRightChanged(int right);
  void dragProxyStarted(QPixmap pixmap, int left, int width);
  void dragProxyMoved(int left, int right);
  void dragProxyCandidateChanged(int insertionSlot);
  void dragProxySettleRequested(int finalLeft);
  void dragProxyFinished();
  void tabReorderStarted();
  void tabReorderFinished();
  void externalDragFinished();
  void externalWindowMoveStarted(QPoint pointerOffsetInWindow);

 protected:
  void tabInserted(int index) override {
    QTabBar::tabInserted(index);
    auto *closeButton = new QToolButton(this);
    closeButton->setObjectName("tab-close-button");
    closeButton->setText(QStringLiteral("×"));
    closeButton->setToolTip(QStringLiteral("Sekmeyi kapat"));
    closeButton->setAccessibleName(QStringLiteral("Sekmeyi kapat"));
    closeButton->setAutoRaise(true);
    closeButton->setCursor(Qt::ArrowCursor);
    setTabButton(index, QTabBar::RightSide, closeButton);
    connect(closeButton, &QToolButton::clicked, this, [this, closeButton] {
      for (int tab = 0; tab < count(); ++tab) {
        if (tabButton(tab, QTabBar::RightSide) == closeButton) {
          emit tabCloseRequested(tab);
          return;
        }
      }
    });
  }

  void mousePressEvent(QMouseEvent *event) override {
    if (event->button() == Qt::LeftButton) {
      pressedTab_ = tabAt(event->position().toPoint());
      pressGlobal_ = event->globalPosition().toPoint();
      pressLocal_ = event->position().toPoint();
      if (pressedTab_ >= 0) {
        const QRect rect = tabRect(pressedTab_);
        dragPointerOffsetX_ = event->position().toPoint().x() - rect.left();
        dragTabWidth_ = rect.width();
        dragSourceRect_ = rect;
        dragStarted_ = false;
        emit pointerDragStarted(pressGlobal_);
      }
    }
    QTabBar::mousePressEvent(event);
  }

  void mouseMoveEvent(QMouseEvent *event) override {
    if (pressedTab_ >= 0 && (event->buttons() & Qt::LeftButton)) {
      const QPoint global = event->globalPosition().toPoint();
      if (externalAttachDragEnabled_ && (event->position().toPoint() - pressLocal_).manhattanLength() >= QApplication::startDragDistance()) {
        const int tab = pressedTab_;
        const QRect rect = tabRect(tab);
        const QPixmap snapshot = grab(rect);
        pressedTab_ = -1;
        emit pointerDragFinished();
        if (qEnvironmentVariableIsSet("ARDALI_TAB_TRANSFER_DIAGNOSTICS"))
          qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER {\"stage\":\"FALLBACK_DRAG_START\",\"startSystemMove\":false,\"platform\":\"%1\"}")
                                    .arg(QGuiApplication::platformName());
        if (mouseGrabber() == this) releaseMouse();
        auto *mimeData = new QMimeData;
        mimeData->setData(kDetachedTabMimeType, QByteArrayLiteral("move"));
        QDrag drag(this);
        drag.setMimeData(mimeData);
        drag.setPixmap(snapshot);
        drag.setHotSpot(event->position().toPoint() - rect.topLeft());
        drag.exec(Qt::MoveAction);
        pressedTab_ = -1;
        dragStarted_ = false;
        finishDragProxy();
        QMouseEvent releaseEvent(QEvent::MouseButtonRelease, event->position(), event->globalPosition(),
                                 Qt::LeftButton, Qt::NoButton, event->modifiers());
        QTabBar::mouseReleaseEvent(&releaseEvent);
        if (mouseGrabber() == this) releaseMouse();
        emit externalDragFinished();
        dragPointerOffsetX_ = 0;
        dragTabWidth_ = 0;
        event->accept();
        return;
      }
      const int downDistance = global.y() - pressGlobal_.y();
      const int dragDistance = QApplication::startDragDistance();
      // A detach is a boundary crossing, not a long vertical-distance test.
      // The tab remains safely reorderable until the pointer has crossed the
      // actual bottom of its native strip with a small DPI-safe hysteresis.
      const int detachHysteresis = std::clamp((dragDistance + 1) / 2, 4, 12);
      const int tabStripBottom = mapToGlobal(QPoint(0, height())).y();
      const bool leftTabStrip = global.y() >= tabStripBottom + detachHysteresis;
      const bool tabDetachable = !tabData(pressedTab_).isValid() || tabData(pressedTab_).toBool();
      if (detachEnabled_ && tabDetachable && leftTabStrip && downDistance >= dragDistance
          && downDistance > std::abs(global.x() - pressGlobal_.x())) {
        if (dragStarted_) restoreDraggedTab(dragSourceIndex_);
        const int tab = pressedTab_;
        const QPoint pointerOffset = event->position().toPoint() - tabRect(tab).topLeft();
        finishDragProxy();
        pressedTab_ = -1;
        // Keep the physical held-button gesture alive while the detached shell
        // is exposed. Releasing the source grab here makes the new native move
        // feel like a second drag on Wayland/X11.
        emit pointerDragFinished();
        emit detachRequested(tab, global, pointerOffset);
        event->accept();
        return;
      }
      const int horizontalDistance = std::abs(event->position().toPoint().x() - pressLocal_.x());
      // WebMedia began an in-strip reorder after 6 logical pixels.  Keep this
      // deliberately narrower than the system drag distance used by detach:
      // it makes tab order react promptly without making a downward detach
      // easier to trigger.
      constexpr int reorderPointerThreshold = 6;
      if (!dragStarted_ && horizontalDistance >= reorderPointerThreshold) {
        beginDragProxy();
      }
      const int dragLeft = std::max(0, event->position().toPoint().x() - dragPointerOffsetX_);
      if (dragStarted_) {
        // Match the former WebMedia strip: crossing is driven by the held
        // pointer itself, against the other tabs' midpoints.  A normalised
        // proxy centre made a left-edge grab wait until nearly the entire tab
        // covered its neighbour before the visual order could react.
        const int insertionSlot = insertionIndex(event->position().toPoint());
        if (insertionSlot != dragCandidate_) {
          dragCandidate_ = insertionSlot;
          emit dragProxyCandidateChanged(insertionSlot);
        }
        emit draggedTabRightChanged(dragLeft + dragTabWidth_);
        emit dragProxyMoved(dragLeft, dragLeft + dragTabWidth_);
      }
      emit pointerDragMoved(global);
      event->accept();
      return;
    }
    QTabBar::mouseMoveEvent(event);
  }

  void mouseReleaseEvent(QMouseEvent *event) override {
    if (mouseGrabber() == this) releaseMouse();
    if (pressedTab_ >= 0) {
      if (dragStarted_) {
        const int target = insertionIndex(event->position().toPoint());
        restoreDraggedTab(dragSourceIndex_);
        emit tabReorderStarted();
        if (target >= 0 && target != dragSourceIndex_) moveTab(dragSourceIndex_, target);
        if (dragSourceWasCurrent_) setCurrentIndex(target);
        emit tabReorderFinished();
        // The proxy is still under the held pointer. Let the containing window
        // settle it into the committed tab slot with a short spring rather
        // than making the final placement appear as a hard snap.
        if (target >= 0 && target < count()) emit dragProxySettleRequested(tabRect(target).left());
        finishDragProxy();
        event->accept();
      } else {
        QTabBar::mouseReleaseEvent(event);
      }
      emit pointerDragFinished();
    } else {
      QTabBar::mouseReleaseEvent(event);
    }
    pressedTab_ = -1;
    dragPointerOffsetX_ = 0;
    dragTabWidth_ = 0;
  }

 private:
  int insertionIndex(const QPoint &position) const {
    // The source is temporarily removed so its stationary QTabBar widget does
    // not remain under the drag proxy.  Keep using the pre-removal geometry
    // for hit testing, though: testing against the compressed remaining rects
    // makes the candidate jump as soon as the drag begins.  This is the Qt
    // equivalent of WebMedia's elementFromPoint() over the original tab row.
    if (dragStarted_ && dragSourceIndex_ >= 0 && dragOriginalTabRects_.size() == count() + 1) {
      int insertionSlot = 0;
      for (int originalIndex = 0; originalIndex < dragOriginalTabRects_.size(); ++originalIndex) {
        if (originalIndex == dragSourceIndex_) continue;
        if (position.x() < dragOriginalTabRects_[originalIndex].center().x()) return insertionSlot;
        ++insertionSlot;
      }
      return insertionSlot;
    }

    // The valid result is an insertion *slot* in [0, count()], not the last
    // live tab index. Returning count() keeps a tab dropped at far right
    // there after the source is restored.
    for (int index = 0; index < count(); ++index) {
      if (position.x() < tabRect(index).center().x()) return index;
    }
    return count();
  }

  void beginDragProxy() {
    dragStarted_ = true;
    dragSourceIndex_ = pressedTab_;
    dragSourceText_ = tabText(pressedTab_);
    dragSourceToolTip_ = tabToolTip(pressedTab_);
    dragSourceData_ = tabData(pressedTab_);
    dragSourceIcon_ = tabIcon(pressedTab_);
    dragSourceWasCurrent_ = currentIndex() == pressedTab_;
    dragOriginalTabRects_.clear();
    dragOriginalTabRects_.reserve(count());
    for (int index = 0; index < count(); ++index) dragOriginalTabRects_.push_back(tabRect(index));
    // Start from the source's own logical slot.  The first overlay frame then
    // reproduces the pre-drag layout instead of briefly placing the source
    // after a sibling that QTabBar has just reflowed to the left.
    dragCandidate_ = dragSourceIndex_;
    const QPixmap snapshot = grab(dragSourceRect_);
    {
      // Removing the actual tab eliminates the stationary ghost shown while
      // dragging. Signals are blocked until the final real move is committed.
      const QSignalBlocker blocker(this);
      removeTab(pressedTab_);
    }
    emit dragProxyStarted(snapshot, dragSourceRect_.left(), dragTabWidth_);
    emit dragProxyCandidateChanged(dragCandidate_);
  }

  void restoreDraggedTab(int index) {
    if (dragSourceIndex_ < 0) return;
    const QSignalBlocker blocker(this);
    const int restored = insertTab(std::clamp(index, 0, count()), dragSourceIcon_, dragSourceText_);
    setTabToolTip(restored, dragSourceToolTip_);
    setTabData(restored, dragSourceData_);
    pressedTab_ = restored;
    dragSourceIndex_ = restored;
  }

  void finishDragProxy() {
    if (!dragStarted_) return;
    dragStarted_ = false;
    emit draggedTabRightChanged(0);
    emit dragProxyFinished();
    dragSourceIndex_ = -1;
    dragSourceText_.clear();
    dragSourceToolTip_.clear();
    dragSourceData_.clear();
    dragSourceIcon_ = {};
    dragOriginalTabRects_.clear();
    dragCandidate_ = -1;
  }

  int pressedTab_ = -1;
  QPoint pressGlobal_;
  QPoint pressLocal_;
  int dragPointerOffsetX_ = 0;
  int dragTabWidth_ = 0;
  QRect dragSourceRect_;
  QVector<QRect> dragOriginalTabRects_;
  bool dragStarted_ = false;
  int dragSourceIndex_ = -1;
  int dragCandidate_ = -1;
  QString dragSourceText_;
  QString dragSourceToolTip_;
  QVariant dragSourceData_;
  QIcon dragSourceIcon_;
  bool dragSourceWasCurrent_ = false;
  bool detachEnabled_ = true;
  bool externalAttachDragEnabled_ = false;
};

class TabStripScrollArea final : public QScrollArea {
  Q_OBJECT
 public:
  explicit TabStripScrollArea(QWidget *parent = nullptr) : QScrollArea(parent) {
    setWidgetResizable(false);
    setFrameShape(QFrame::NoFrame);
    setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  }

 protected:
  bool viewportEvent(QEvent *event) override {
    if (event->type() == QEvent::MouseButtonPress) {
      auto *mouse = static_cast<QMouseEvent *>(event);
      if (mouse->button() == Qt::LeftButton) {
        chromePressGlobal_ = mouse->globalPosition().toPoint();
        chromePressed_ = true;
      }
    } else if (event->type() == QEvent::MouseMove && chromePressed_) {
      auto *mouse = static_cast<QMouseEvent *>(event);
      if ((mouse->buttons() & Qt::LeftButton)
          && (mouse->globalPosition().toPoint() - chromePressGlobal_).manhattanLength() >= QApplication::startDragDistance()) {
        chromePressed_ = false;
        if (QWidget *host = window(); host && host->windowHandle() && host->windowHandle()->startSystemMove()) {
          event->accept();
          return true;
        }
      }
    } else if (event->type() == QEvent::MouseButtonRelease) {
      chromePressed_ = false;
    } else if (event->type() == QEvent::MouseButtonDblClick) {
      auto *mouse = static_cast<QMouseEvent *>(event);
      if (mouse->button() == Qt::LeftButton) {
        if (QWidget *host = window()) host->isMaximized() ? host->showNormal() : host->showMaximized();
        event->accept();
        return true;
      }
    }
    return QScrollArea::viewportEvent(event);
  }

  void wheelEvent(QWheelEvent *event) override {
    const QPoint angle = event->angleDelta();
    const int delta = angle.x() != 0 ? angle.x() : angle.y();
    if (delta == 0) { event->ignore(); return; }
    horizontalScrollBar()->setValue(horizontalScrollBar()->value() - delta);
    event->accept();
  }

  private:
  QPoint chromePressGlobal_;
  bool chromePressed_ = false;
};

enum class TabTransferState {
  Preparing,
  Moving,
  DestinationReady,
  Committed,
  RolledBack
};

class TabTransferTransaction {
 public:
  TabTransferTransaction(TabManager::TabId id, QObject *source, QObject *destination)
      : id_(id), source_(source), destination_(destination), state_(TabTransferState::Preparing) {}

  TabTransferState state() const { return state_; }

  const char *stateName() const {
    switch (state_) {
      case TabTransferState::Preparing: return "Preparing";
      case TabTransferState::Moving: return "Moving";
      case TabTransferState::DestinationReady: return "DestinationReady";
      case TabTransferState::Committed: return "Committed";
      case TabTransferState::RolledBack: return "RolledBack";
    }
    return "Unknown";
  }

  void transitionTo(TabTransferState newState) {
    state_ = newState;
  }

  TabManager::TabId id() const { return id_; }
  QObject *source() const { return source_; }
  QObject *destination() const { return destination_; }

 private:
  TabManager::TabId id_;
  QObject *source_;
  QObject *destination_;
  TabTransferState state_;
};

class BrowserWindow final : public QMainWindow {
  Q_OBJECT
 public:
  BrowserWindow(QWebEngineProfile *profile, BrowserProfileService *profileService, TabManager *tabManager, const BrowserPolicy *policy,
                SessionStore *sessionStore, BrowserWindow *mainWindow, bool createInitial)
      : profile_(profile), profileService_(profileService), tabManager_(tabManager), policy_(policy), sessionStore_(sessionStore), mainWindow_(mainWindow) {
    windowDebugId_ = gBrowserWindowSequence.fetch_add(1);
    const bool detachedMode = mainWindow_ != nullptr;
    // The root window lives on main()'s stack. Only detached windows are heap
    // allocated and may delete themselves when closed.
    setAttribute(Qt::WA_DeleteOnClose, detachedMode);
    // Browser chrome owns the top row. This removes the separate desktop title
    // bar so tabs and window controls share one Brave-like surface.
    setWindowFlag(Qt::FramelessWindowHint, true);
    setMinimumSize(640, 420);
    resize(1280, 860);
    setWindowTitle("ArDaliBrowser");
    setWindowIcon(qApp->windowIcon());
    qApp->installEventFilter(this);
    if (transferDiagnosticsEnabled()) {
      const quint64 destroyedWindowId = windowDebugId_;
      const bool destroyedDetachedMode = detachedMode;
      connect(this, &QObject::destroyed, qApp, [destroyedWindowId, destroyedDetachedMode] {
        qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER %1")
                                  .arg(QString::fromUtf8(QJsonDocument(QJsonObject{
                                      {QStringLiteral("stage"), QStringLiteral("SHELL_DESTROYED")},
                                      {QStringLiteral("windowId"), QString::number(destroyedWindowId)},
                                      {QStringLiteral("detachedWindow"), destroyedDetachedMode},
                                  }).toJson(QJsonDocument::Compact)));
      });
    }
    zoomWatchTimer_.setInterval(120);
    connect(&zoomWatchTimer_, &QTimer::timeout, this, [this] { updateZoomControls(); });
    zoomWatchTimer_.start();
    suggestionWatchTimer_.setInterval(180);
    connect(&suggestionWatchTimer_, &QTimer::timeout, this, &BrowserWindow::pollNewTabSuggestionQuery);
    suggestionWatchTimer_.start();
    if (profileService_) {
      connect(profileService_, &BrowserProfileService::downloadsChanged, this, &BrowserWindow::syncAllNewTabFrequentSites);
      connect(profileService_, &BrowserProfileService::bookmarksChanged, this, &BrowserWindow::syncAllNewTabFrequentSites);
      connect(profileService_, &BrowserProfileService::trackingProtectionChanged, this, &BrowserWindow::syncAllNewTabFrequentSites);
    }
    // Suggestion favicons are transient UI data. Keep this manager without a
    // disk cache so downloaded icon bytes never become persistent files.
    suggestionNetwork_.setCache(nullptr);

    auto *root = new QWidget(this);
    browserRoot_ = root;
    root->setObjectName(QStringLiteral("browser-root"));
    auto *layout = new QVBoxLayout(root);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    auto *tabStrip = new QWidget(root);
    tabStrip_ = tabStrip;
    tabStrip->setObjectName("tab-strip");
    tabStrip->setAccessibleName(QStringLiteral("Sekme şeridi"));
    tabStrip->setProperty("detachedMode", detachedMode);
    tabStrip->setFixedHeight(40);
    tabStripLayout_ = new QHBoxLayout(tabStrip);
    tabStripLayout_->setContentsMargins(8, 4, 8, 0);
    tabStripLayout_->setSpacing(6);
    tabBar_ = new BrowserTabBar(tabStrip);
    tabBar_->setAccessibleName(QStringLiteral("Sekmeler"));
    tabBar_->setFocusPolicy(Qt::StrongFocus);
    tabBar_->setTabsClosable(false);
    tabBar_->setElideMode(Qt::ElideRight);
    tabBar_->setDetachEnabled(!detachedMode);
    tabBar_->setExternalAttachDragEnabled(detachedMode);
    tabScroll_ = new TabStripScrollArea(tabStrip);
    tabScroll_->setObjectName("tab-strip-scroll");
    tabScroll_->setFixedHeight(34);
    tabScroll_->setAlignment(Qt::AlignLeft | Qt::AlignTop);
    // Keep this above the tab bar instead of making it a child of QTabBar.
    // QTabBar repaints a live-dragged tab over its children otherwise.
    newTabButton_ = new QToolButton(tabScroll_->viewport());
    newTabButton_->setObjectName("new-tab-button");
    newTabButton_->setText("+");
    newTabButton_->setToolTip("Yeni sekme");
    newTabButton_->setAccessibleName(QStringLiteral("Yeni sekme aç"));
    newTabButton_->setFixedSize(28, 28);
    newTabButton_->setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
    newTabButton_->setVisible(!detachedMode);
    tabScroll_->setWidget(tabBar_);
    if (!detachedMode) {
      tabStrip->setAcceptDrops(true);
      tabScroll_->viewport()->setAcceptDrops(true);
      tabBar_->setAcceptDrops(true);
      tabStrip->installEventFilter(this);
      tabScroll_->viewport()->installEventFilter(this);
      tabBar_->installEventFilter(this);
    }
    tabStripLayout_->addWidget(tabScroll_, 1);
    minimizeButton_ = new QToolButton(tabStrip);
    minimizeButton_->setObjectName(QStringLiteral("window-minimize-button"));
    minimizeButton_->setIcon(BrowserIcons::icon(BrowserIcon::Minimize));
    minimizeButton_->setToolTip(QStringLiteral("Küçült"));
    minimizeButton_->setAccessibleName(QStringLiteral("Pencereyi küçült"));
    maximizeButton_ = new QToolButton(tabStrip);
    maximizeButton_->setObjectName(QStringLiteral("window-maximize-button"));
    maximizeButton_->setIcon(BrowserIcons::icon(BrowserIcon::Maximize));
    maximizeButton_->setToolTip(QStringLiteral("Büyüt veya geri yükle"));
    maximizeButton_->setAccessibleName(QStringLiteral("Pencereyi büyüt veya geri yükle"));
    closeWindowButton_ = new QToolButton(tabStrip);
    closeWindowButton_->setObjectName(QStringLiteral("window-close-button"));
    closeWindowButton_->setIcon(BrowserIcons::icon(BrowserIcon::Close));
    closeWindowButton_->setToolTip(QStringLiteral("Kapat"));
    closeWindowButton_->setAccessibleName(QStringLiteral("Pencereyi kapat"));
    for (QToolButton *button : {minimizeButton_, maximizeButton_, closeWindowButton_}) {
      button->setAutoRaise(true);
      button->setFocusPolicy(Qt::StrongFocus);
      button->setIconSize(QSize(16, 16));
      button->setFixedSize(40, 32);
      tabStripLayout_->addWidget(button, 0, Qt::AlignTop);
    }
    layout->addWidget(tabStrip);
    attachMarker_ = new QFrame(tabScroll_->viewport());
    attachMarker_->setObjectName("attach-marker");
    attachMarker_->hide();

    auto *toolbar = new QToolBar(root);
    toolbar->setObjectName("navigation-bar");
    toolbar->setAccessibleName(QStringLiteral("Gezinti araç çubuğu"));
    toolbar->setMovable(false);
    back_ = toolbar->addAction("‹");
    back_->setToolTip(QStringLiteral("Geri (Alt+Sol)"));
    forward_ = toolbar->addAction("›");
    forward_->setToolTip(QStringLiteral("İleri (Alt+Sağ)"));
    reload_ = toolbar->addAction("↻");
    reload_->setToolTip(QStringLiteral("Yenile (Ctrl+R)"));
    address_ = new QLineEdit(toolbar);
    address_->setPlaceholderText("Adres veya arama girin");
    address_->setAccessibleName(QStringLiteral("Adres veya arama çubuğu"));
    address_->setMinimumWidth(460);
    bookmark_ = toolbar->addAction(bookmarkIcon(false), QString());
    bookmark_->setToolTip("Yer imi ekle");
    for (QToolButton *button : toolbar->findChildren<QToolButton *>()) {
      if (button->defaultAction() == bookmark_) {
        button->setObjectName(QStringLiteral("bookmark-button"));
        button->setIconSize(QSize(21, 21));
        break;
      }
    }
    addressSuggestionModel_ = new QStandardItemModel(address_);
    addressCompleter_ = new QCompleter(addressSuggestionModel_, address_);
    addressCompleter_->setCaseSensitivity(Qt::CaseInsensitive);
    // Results are pre-filtered below so the popup can retain source headings
    // instead of letting QCompleter filter them away a second time.
    addressCompleter_->setCompletionMode(QCompleter::UnfilteredPopupCompletion);
    addressCompleter_->setCompletionRole(Qt::DisplayRole);
    addressCompleter_->setMaxVisibleItems(8);
    // QCompleter takes ownership of its popup; giving it another QWidget
    // parent as well can leave competing destruction paths during shutdown.
    auto *suggestionPopup = new QListView;
    suggestionPopup->setItemDelegate(new AddressSuggestionDelegate(suggestionPopup));
    suggestionPopup->setUniformItemSizes(false);
    suggestionPopup->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    suggestionPopup->setStyleSheet(QStringLiteral(
        "QListView { background: #202124; color: #f1f3f4; border: 1px solid #5f6368; border-radius: 10px; padding: 4px 0; outline: 0; }"));
    addressCompleter_->setPopup(suggestionPopup);
    address_->setCompleter(addressCompleter_);
    toolbar->addWidget(address_);
    zoomPopup_ = new QFrame(root);
    zoomPopup_->setObjectName(QStringLiteral("zoom-menu-panel"));
    auto *zoomLayout = new QHBoxLayout(zoomPopup_);
    zoomLayout->setContentsMargins(7, 5, 7, 5);
    zoomLayout->setSpacing(2);
    auto *zoomOut = new QToolButton(zoomPopup_);
    zoomOut->setText(QStringLiteral("−"));
    zoomOut->setToolTip(QStringLiteral("Uzaklaştır (Ctrl+-)"));
    zoomOut->setAccessibleName(QStringLiteral("Uzaklaştır"));
    zoomPercent_ = new QLabel(zoomPopup_);
    zoomPercent_->setObjectName(QStringLiteral("zoom-percent"));
    auto *zoomIn = new QToolButton(zoomPopup_);
    zoomIn->setText(QStringLiteral("+"));
    zoomIn->setToolTip(QStringLiteral("Yakınlaştır (Ctrl++)"));
    zoomIn->setAccessibleName(QStringLiteral("Yakınlaştır"));
    auto *zoomReset = new QToolButton(zoomPopup_);
    zoomReset->setText(QStringLiteral("Sıfırla"));
    zoomReset->setToolTip(QStringLiteral("Yakınlaştırmayı sıfırla (Ctrl+0)"));
    zoomReset->setAccessibleName(QStringLiteral("Yakınlaştırmayı sıfırla"));
    zoomLayout->addWidget(zoomOut);
    zoomLayout->addWidget(zoomPercent_);
    zoomLayout->addWidget(zoomIn);
    zoomLayout->addWidget(zoomReset);
    zoomButton_ = new QToolButton(address_);
    zoomButton_->setObjectName(QStringLiteral("zoom-button"));
    zoomButton_->setIcon(zoomIcon());
    zoomButton_->setIconSize(QSize(20, 20));
    zoomButton_->setFixedSize(38, 34);
    zoomButton_->setToolTip(QStringLiteral("Sayfa yakınlaştırma"));
    zoomButton_->setAccessibleName(QStringLiteral("Sayfa yakınlaştırma"));
    zoomButton_->hide();
    address_->setTextMargins(0, 0, 52, 0);
    address_->installEventFilter(this);
    connect(zoomButton_, &QToolButton::clicked, this, [this] { showZoomPopup(); });
    connect(zoomOut, &QToolButton::clicked, this, [this] { changeCurrentZoom(-0.1); });
    connect(zoomIn, &QToolButton::clicked, this, [this] { changeCurrentZoom(0.1); });
    connect(zoomReset, &QToolButton::clicked, this, [this] { setCurrentZoom(1.0); });
    // The engine picker belongs to the new-tab search surface; this hidden
    // model keeps the saved default available to direct address-bar searches.
    searchEngine_ = new QComboBox(this);
    searchEngine_->hide();
    for (const auto &engine : kSearchEngines) searchEngine_->addItem(QString::fromLatin1(engine.name));
    QSettings settings;
    const int savedEngine = searchEngine_->findText(settings.value("browser/searchEngine", "Google").toString());
    searchEngine_->setCurrentIndex(savedEngine >= 0 ? savedEngine : 0);
    settings_ = toolbar->addAction("☰");
    settings_->setToolTip("Ana menü");
    settings_->setText(QStringLiteral("☰"));
    layout->addWidget(toolbar);

    bookmarkBar_ = new QToolBar(root);
    bookmarkBar_->setObjectName("bookmark-bar");
    bookmarkBar_->setMovable(false);
    bookmarkBar_->setIconSize(QSize(16, 16));
    layout->addWidget(bookmarkBar_);

    loadProgress_ = new QProgressBar(root);
    loadProgress_->setObjectName("page-load-progress");
    loadProgress_->setRange(0, 100);
    loadProgress_->setTextVisible(false);
    loadProgress_->setAccessibleName(QStringLiteral("Sayfa yükleme ilerlemesi"));
    loadProgress_->setFixedHeight(3);
    loadProgress_->hide();
    layout->addWidget(loadProgress_);

    pages_ = new QStackedWidget(root);
    layout->addWidget(pages_, 1);
    setCentralWidget(root);
    setStyleSheet(R"CSS(
      QMainWindow { background: #202124; }
      QWidget#browser-root { background: #202124; border: 0; }
      QWidget#browser-root[windowedFrame="true"] { border: 1px solid #3a3f46; }
      QWidget#tab-strip { background: #202124; border-bottom: 1px solid #303134; min-height: 38px; }
      QTabBar { background: transparent; }
      QTabBar::tab { background: #303134; color: #c9cdd2; min-width: 150px; max-width: 248px; height: 30px; padding: 0 12px; margin-right: 3px; border-radius: 8px 8px 0 0; }
      QTabBar::tab:selected { background: #151515; color: #f1f3f4; }
      QTabBar::tab:hover:!selected { background: #3a3b3d; }
      QWidget#tab-strip[attachHover="true"] { border: 1px solid #8ab4f8; border-bottom: 1px solid #8ab4f8; }
      QFrame#attach-marker { background: #8ab4f8; border-radius: 2px; }
      QToolButton#tab-close-button { min-width: 20px; max-width: 20px; min-height: 22px; border: 0; border-radius: 10px; color: #c9cdd2; font-size: 18px; padding: 0; }
      QToolButton#tab-close-button:hover { background: #5f6368; color: #ffffff; }
      QToolButton#new-tab-button { min-width: 28px; min-height: 28px; border: 0; border-radius: 14px; color: #d8dce0; font-size: 21px; background: transparent; }
      QToolButton#new-tab-button:hover { background: #3a3b3d; }
      QToolButton#new-tab-button:focus { border: 1px solid #8ab4f8; }
      QToolButton#window-minimize-button, QToolButton#window-maximize-button, QToolButton#window-close-button {
        background: transparent; color: #d8dce0; border: 0; border-radius: 5px; font-size: 17px; padding: 0;
      }
      QToolButton#window-minimize-button:hover, QToolButton#window-maximize-button:hover { background: #3a3b3d; }
      QToolButton#window-close-button:hover { background: #c42b1c; color: #ffffff; }
      QToolButton#window-minimize-button:focus, QToolButton#window-maximize-button:focus, QToolButton#window-close-button:focus { border: 1px solid #8ab4f8; }
      QToolBar#navigation-bar { background: #151515; border: 0; border-bottom: 1px solid #303134; spacing: 5px; padding: 7px 10px; }
      QToolBar#navigation-bar QToolButton { color: #d8dce0; border: 0; border-radius: 14px; min-width: 28px; min-height: 28px; font-size: 20px; }
      QToolBar#navigation-bar QToolButton:hover { background: #383a3d; }
      QToolBar#navigation-bar QToolButton:focus { border: 1px solid #8ab4f8; }
      QLineEdit { background: #303134; border: 1px solid transparent; border-radius: 17px; color: #e8eaed; padding: 0 14px; min-height: 32px; selection-background-color: #8ab4f8; }
      QLineEdit:focus { background: #202124; border-color: #8ab4f8; }
      QToolBar#navigation-bar QToolButton#bookmark-button { margin: 0 2px 0 1px; min-width: 27px; max-width: 27px; min-height: 28px; }
      QLineEdit QToolButton#zoom-button { background: transparent; border: 0; margin: 0; padding: 0; }
      QFrame#zoom-menu-panel { background: #202124; border: 1px solid #485469; border-radius: 14px; }
      QFrame#zoom-menu-panel QLabel { color: #e8eaed; min-width: 42px; qproperty-alignment: AlignCenter; }
      QFrame#zoom-menu-panel QToolButton { min-width: 27px; min-height: 27px; font-size: 16px; border-radius: 12px; }
      QFrame#zoom-menu-panel QToolButton:hover { background: #3b4655; }
      QFrame#zoom-menu-panel QToolButton:last-child { min-width: 54px; font-size: 12px; }
      QComboBox { background: #303134; color: #e8eaed; border: 1px solid transparent; border-radius: 16px; min-height: 32px; padding: 0 9px; min-width: 112px; }
      QComboBox:hover, QComboBox:focus { border-color: #8ab4f8; }
      QComboBox QAbstractItemView { background: #303134; color: #e8eaed; selection-background-color: #5f6368; }
      QToolBar#bookmark-bar { background: #202124; border: 0; border-bottom: 1px solid #303134; min-height: 30px; spacing: 3px; padding: 2px 10px; }
      QToolBar#bookmark-bar QToolButton { color: #d5dce7; border: 0; border-radius: 8px; padding: 3px 8px; }
      QToolBar#bookmark-bar QToolButton:hover { background: #343a45; }
      QProgressBar#page-load-progress { border: 0; background: #202124; }
      QProgressBar#page-load-progress::chunk { background: #42a5f5; }
    )CSS");

    connect(newTabButton_, &QToolButton::clicked, this, [this] { addNewTab(); });
    connect(minimizeButton_, &QToolButton::clicked, this, &QWidget::showMinimized);
    connect(maximizeButton_, &QToolButton::clicked, this, &BrowserWindow::toggleMaximized);
    connect(closeWindowButton_, &QToolButton::clicked, this, &QWidget::close);
    connect(back_, &QAction::triggered, this, [this] { if (auto *view = currentView(); view && view->history()->canGoBack()) view->back(); });
    connect(forward_, &QAction::triggered, this, [this] { if (auto *view = currentView(); view && view->history()->canGoForward()) view->forward(); });
    connect(reload_, &QAction::triggered, this, [this] { if (auto *view = currentView()) view->reload(); });
    connect(bookmark_, &QAction::triggered, this, &BrowserWindow::toggleCurrentBookmark);
    connect(address_, &QLineEdit::returnPressed, this, [this] { if (currentView()) navigateCurrent(resolveAddressInput(address_->text(), searchEngine_->currentText())); });
    connect(address_, &QLineEdit::textEdited, this, [this](const QString &text) { refreshAddressSuggestions(text); });
    connect(addressCompleter_, QOverload<const QModelIndex &>::of(&QCompleter::activated), this, [this](const QModelIndex &index) {
      const QString url = index.data(Qt::UserRole).toString();
      if (url.isEmpty()) return;
      address_->setText(url);
      navigateCurrent(QUrl(url));
    });
    connect(searchEngine_, &QComboBox::currentTextChanged, this, [this](const QString &engine) {
      QSettings().setValue(QStringLiteral("browser/searchEngine"), engine);
      QJsonArray payload; payload.append(engine);
      const QString json = QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact));
      for (int index = 0; pages_ && index < pages_->count(); ++index) {
        if (auto *view = qobject_cast<QWebEngineView *>(pages_->widget(index)); view && isNewTabUrl(view->url()))
          view->page()->runJavaScript(QStringLiteral("window.ardaliSetSearchEngine&&window.ardaliSetSearchEngine(%1[0])").arg(json));
      }
    });
    connect(settings_, &QAction::triggered, this, &BrowserWindow::showMainMenu);
    installKeyboardShortcuts();
    connect(tabBar_, &QTabBar::currentChanged, this, [this](int index) {
      // BrowserTabBar's custom horizontal drag commits both visual containers
      // in its tabMoved transaction below. Reacting here while QTabBar is
      // between indices would validate a state that is intentionally only
      // half-reordered.
      if (tabReorderInProgress_) return;
      if (index >= 0 && index < pages_->count()) pages_->setCurrentIndex(index);
      if (auto *settings = qobject_cast<SettingsPage *>(pages_->currentWidget())) settings->refreshPreferences();
      if (QWidget *content = pages_->currentWidget()) tabManager_->activate(tabManager_->idForContent(content));
      updateChrome();
      validateTabState();
      scheduleSessionSave();
    });
    connect(tabBar_, &QTabBar::tabMoved, this, [this](int from, int to) {
      if (from < 0 || to < 0 || from >= pages_->count() || to >= pages_->count()) return;
      const int selectedIndex = std::clamp(tabBar_->currentIndex(), 0, pages_->count() - 1);
      {
        // QTabBar has already moved. Reorder and select the matching stacked
        // page under blockers so observers never see tab=current N while
        // stack=current M.
        const QSignalBlocker blockTabBar(tabBar_);
        const QSignalBlocker blockPages(pages_);
        QWidget *const moved = pages_->widget(from);
        pages_->removeWidget(moved);
        pages_->insertWidget(to, moved);
        pages_->setCurrentIndex(selectedIndex);
        tabBar_->setCurrentIndex(selectedIndex);
      }
      QVector<TabManager::TabId> order;
      for (int index = 0; index < pages_->count(); ++index) {
        order.push_back(tabManager_->idForContent(pages_->widget(index)));
      }
      if (!tabManager_->reorder(this, order)) qWarning("Tab model reorder failed");
      if (QWidget *content = pages_->currentWidget()) tabManager_->activate(tabManager_->idForContent(content));
      if (!tabReorderInProgress_) {
        updateChrome();
        validateTabState();
        scheduleSessionSave();
      }
    });
    connect(tabBar_, &BrowserTabBar::tabReorderStarted, this, [this] { tabReorderInProgress_ = true; });
    connect(tabBar_, &BrowserTabBar::tabReorderFinished, this, [this] {
      if (!tabReorderInProgress_) return;
      tabReorderInProgress_ = false;
      if (tabBar_->count() > 0 && pages_->count() == tabBar_->count()) {
        const int selectedIndex = std::clamp(tabBar_->currentIndex(), 0, pages_->count() - 1);
        const QSignalBlocker blockTabBar(tabBar_);
        const QSignalBlocker blockPages(pages_);
        tabBar_->setCurrentIndex(selectedIndex);
        pages_->setCurrentIndex(selectedIndex);
      }
      if (QWidget *content = pages_->currentWidget()) tabManager_->activate(tabManager_->idForContent(content));
      updateChrome();
      validateTabState();
      scheduleSessionSave();
    });
    connect(tabBar_, &QTabBar::tabCloseRequested, this, &BrowserWindow::closeTab);
    connect(tabBar_, &BrowserTabBar::detachRequested, this, &BrowserWindow::detachTab);
    connect(tabBar_, &BrowserTabBar::externalWindowMoveStarted, this,
            [this](const QPoint &pointerOffsetInWindow) {
              // This is a re-drag of an already detached tab. It must be able
              // to enter the root strip directly; the initial-detach guard is
              // applied only by continueInitialDetachedMoveWhenExposed().
              beginDetachedWindowMove(pointerOffsetInWindow, false);
            });
    connect(tabBar_, &BrowserTabBar::externalDragFinished, this, [this] {
      if (pendingMainAttachIndex_ < 0 || !mainWindow_ || !pendingMainAttachView_ || pendingMainAttachId_.isNull()) {
        pendingMainAttachIndex_ = -1;
        pendingMainAttachView_.clear();
        pendingMainAttachId_ = {};
        return;
      }
      const int insertIndex = pendingMainAttachIndex_;
      const QPointer<QWebEngineView> view = pendingMainAttachView_;
      const TabManager::TabId id = pendingMainAttachId_;
      pendingMainAttachIndex_ = -1;
      pendingMainAttachView_.clear();
      pendingMainAttachId_ = {};
      // QDrag::exec() has returned at this point. Deferring one more turn
      // keeps the source shell alive until its nested drag loop and native
      // drag icon are fully unwound before the tab transfer can close it.
      QTimer::singleShot(0, this, [this, view, id, insertIndex] {
        if (mainWindow_ && view) attachViewToMainAt(view, id, insertIndex);
      });
    });
    connect(tabBar_, &BrowserTabBar::pointerDragStarted, this, [this](const QPoint &position) { updateTabAutoScroll(position); });
    connect(tabBar_, &BrowserTabBar::pointerDragMoved, this, [this](const QPoint &position) {
      refreshTabStripWidth();
      updateTabAutoScroll(position);
    });
    connect(tabBar_, &BrowserTabBar::draggedTabRightChanged, this, [this](int right) {
      draggedTabRight_ = right;
      refreshTabStripWidth();
    });
    connect(tabBar_, &BrowserTabBar::dragProxyStarted, this, [this](const QPixmap &pixmap, int left, int width) {
      dragProxySettleAnimation_.stop();
      dragProxySettlePending_ = false;
      if (!dragTabProxy_) {
        dragTabProxy_ = new QLabel(tabScroll_->viewport());
        dragTabProxy_->setAttribute(Qt::WA_TransparentForMouseEvents);
      }
      dragTabProxy_->setPixmap(pixmap);
      dragTabProxy_->setFixedSize(pixmap.size());
      draggedTabLeft_ = left;
      draggedTabWidth_ = width;
      refreshTabStripWidth();
      beginDragReorderPreview();
      updateDragProxy();
      dragTabProxy_->show();
      dragTabProxy_->raise();
    });
    connect(tabBar_, &BrowserTabBar::dragProxyCandidateChanged, this, [this](int insertionSlot) {
      setDragReorderCandidate(insertionSlot);
    });
    connect(tabBar_, &BrowserTabBar::dragProxyMoved, this, [this](int left, int right) {
      if (dragProxySettleAnimation_.state() != QAbstractAnimation::Stopped) dragProxySettleAnimation_.stop();
      dragProxySettlePending_ = false;
      draggedTabLeft_ = left;
      draggedTabRight_ = right;
      refreshTabStripWidth();
      updateDragProxy();
      renderDragReorderPreview();
    });
    connect(tabBar_, &BrowserTabBar::dragProxySettleRequested, this, [this](int finalLeft) {
      if (!dragTabProxy_ || !tabBar_ || !tabScroll_) return;
      const QPoint finalPosition = tabBar_->mapTo(tabScroll_->viewport(), QPoint(finalLeft, 2));
      dragProxySettleAnimation_.stop();
      dragProxySettlePending_ = true;
      dragProxySettleAnimation_.setStartValue(dragTabProxy_->pos());
      dragProxySettleAnimation_.setEndValue(finalPosition);
      dragProxySettleAnimation_.start();
    });
    connect(tabBar_, &BrowserTabBar::dragProxyFinished, this, [this] {
      clearDragReorderPreview();
      if (dragTabProxy_ && !dragProxySettlePending_) dragTabProxy_->hide();
      draggedTabLeft_ = -1;
      draggedTabWidth_ = 0;
      draggedTabRight_ = 0;
      refreshTabStripWidth();
      if (dragProxySettlePending_ && dragTabProxy_) dragTabProxy_->raise();
    });
    dragProxySettleAnimation_.setDuration(180);
    dragProxySettleAnimation_.setEasingCurve(QEasingCurve::OutBack);
    connect(&dragProxySettleAnimation_, &QVariantAnimation::valueChanged, this, [this](const QVariant &value) {
      if (!dragTabProxy_) return;
      dragTabProxy_->move(value.toPoint());
      dragTabProxy_->raise();
    });
    connect(&dragProxySettleAnimation_, &QVariantAnimation::finished, this, [this] {
      dragProxySettlePending_ = false;
      if (dragTabProxy_) dragTabProxy_->hide();
    });
    dragReorderAnimation_.setDuration(135);
    QEasingCurve reorderEasing(QEasingCurve::OutBack);
    reorderEasing.setOvershoot(0.35);
    dragReorderAnimation_.setEasingCurve(reorderEasing);
    connect(&dragReorderAnimation_, &QVariantAnimation::valueChanged, this, [this](const QVariant &value) {
      const qreal progress = value.toReal();
      if (dragReorderStartOffsets_.size() != dragReorderTargetOffsets_.size()) return;
      dragReorderCurrentOffsets_.resize(dragReorderStartOffsets_.size());
      for (int index = 0; index < dragReorderStartOffsets_.size(); ++index) {
        dragReorderCurrentOffsets_[index] = dragReorderStartOffsets_[index]
            + (dragReorderTargetOffsets_[index] - dragReorderStartOffsets_[index]) * progress;
      }
      if (dragReorderGapStartLeft_ >= 0.0 && dragReorderGapTargetLeft_ >= 0.0) {
        dragReorderAnimatedGapLeft_ = dragReorderGapStartLeft_
            + (dragReorderGapTargetLeft_ - dragReorderGapStartLeft_) * progress;
      }
      // The + control is a viewport sibling, not a QTabBar tab. Re-evaluate
      // its real position for every visual sibling-shift frame so it follows
      // the moving end of the strip instead of appearing pinned in place.
      refreshTabStripWidth();
    });
    connect(&dragReorderAnimation_, &QVariantAnimation::finished, this, [this] {
      dragReorderCurrentOffsets_ = dragReorderTargetOffsets_;
      dragReorderAnimatedGapLeft_ = dragReorderGapTargetLeft_;
      refreshTabStripWidth();
    });
    connect(tabBar_, &BrowserTabBar::pointerDragFinished, this, [this] { stopTabAutoScroll(); });
    connect(tabScroll_->horizontalScrollBar(), &QScrollBar::valueChanged, this, [this] { refreshTabStripWidth(); });
    tabAutoScrollTimer_.setInterval(16);
    connect(&tabAutoScrollTimer_, &QTimer::timeout, this, [this] {
      if (!tabScrollDirection_) { stopTabAutoScroll(); return; }
      auto *bar = tabScroll_->horizontalScrollBar();
      bar->setValue(bar->value() + (tabScrollDirection_ * 12));
    });
    detachedMoveWatchTimer_.setInterval(16);
    connect(&detachedMoveWatchTimer_, &QTimer::timeout, this, [this] {
      if (!mainWindow_ || !detachedSystemMoveActive_) { detachedMoveWatchTimer_.stop(); return; }
      const QPoint currentPosition = pos();
      const QPoint currentCursorPosition = QCursor::pos();
      if (currentPosition != detachedMoveLastPosition_ || currentCursorPosition != detachedMoveLastCursorPosition_) {
        detachedMoveLastPosition_ = currentPosition;
        detachedMoveLastCursorPosition_ = currentCursorPosition;
        detachedMoveLastMotion_.restart();
      }
      const int windowMoveDistance = (currentPosition - detachedMoveStartPosition_).manhattanLength();
      const int cursorMoveDistance = (currentCursorPosition - detachedMoveStartCursorPosition_).manhattanLength();
      const bool windowPositionAdvanced = windowMoveDistance >= QApplication::startDragDistance();
      const bool cursorPositionAdvanced = cursorMoveDistance >= QApplication::startDragDistance();
      if (windowPositionAdvanced || cursorPositionAdvanced) detachedMoveHasMoved_ = true;
      const bool leftPressed = QGuiApplication::mouseButtons().testFlag(Qt::LeftButton);
      detachedMoveSawPressed_ = detachedMoveSawPressed_ || leftPressed;
      // QCursor::pos() may stay stale during an xdg_toplevel interactive move.
      // The window position does update, so reconstruct the held tab point
      // from its stable offset inside the frameless window.
      const QPoint windowDerivedPosition = detachedMovePointerOffsetInWindow_.x() >= 0
          ? mapToGlobal(detachedMovePointerOffsetInWindow_)
          : currentCursorPosition;
      // On Wayland either source may update first. Once the shell itself has
      // moved, its held-tab reconstruction is authoritative (including a
      // no-target result); before that, retain the live cursor so a fast real
      // entry into the root strip can form a candidate.
      const bool waylandMove = QGuiApplication::platformName().contains(QLatin1String("wayland"), Qt::CaseInsensitive);
      const bool useCursorProbe = waylandMove ? !windowPositionAdvanced : cursorPositionAdvanced;
      const int cursorInsertIndex = useCursorProbe
          ? mainWindow_->tabInsertIndexAtGlobal(currentCursorPosition) : -1;
      const int windowInsertIndex = windowPositionAdvanced ? mainWindow_->tabInsertIndexAtGlobal(windowDerivedPosition) : -1;
      const int insertIndex = waylandMove && windowPositionAdvanced
          ? windowInsertIndex
          : (cursorInsertIndex >= 0 ? cursorInsertIndex : windowInsertIndex);
      if (insertIndex >= 0) {
        // Entering a real root target proves this gesture has progressed even
        // when a native compositor does not report a new client position.
        detachedMoveHasMoved_ = true;
        if (transferDiagnosticsEnabled() && insertIndex != detachedMoveLastInsertIndex_) {
          QJsonObject payload{
              {QStringLiteral("stage"), QStringLiteral("ATTACH_HIT_TEST")},
              {QStringLiteral("windowId"), QString::number(windowDebugId_)},
              {QStringLiteral("insertIndex"), insertIndex},
              {QStringLiteral("cursorPosition"), QStringLiteral("%1,%2").arg(currentCursorPosition.x()).arg(currentCursorPosition.y())},
              {QStringLiteral("windowDerivedPosition"), QStringLiteral("%1,%2").arg(windowDerivedPosition.x()).arg(windowDerivedPosition.y())},
              {QStringLiteral("cursorAdvanced"), cursorPositionAdvanced},
              {QStringLiteral("windowAdvanced"), windowPositionAdvanced},
          };
          qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER %1").arg(QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact)));
        }
        detachedMoveLastInsertIndex_ = insertIndex;
        detachedMoveLastTarget_.restart();
      } else {
        detachedMoveLastInsertIndex_ = -1;
        mainWindow_->clearAttachHover();
      }
      // The first detached frame can still overlap the root strip because the
      // detach threshold is intentionally short. It must leave that target
      // once before it is eligible to snap back; later re-drags have no lock.
      if (detachedMoveRequiresTargetExit_) {
        if (insertIndex < 0) {
          detachedMoveRequiresTargetExit_ = false;
        }
        mainWindow_->clearAttachHover();
        return;
      }
      // This is a current candidate, not an instruction to attach. Keeping it
      // visual until the drop is essential: it both makes the insertion gap
      // observable and prevents a stale hit from turning an outside release
      // into an attach.
      if (insertIndex >= 0) {
        mainWindow_->showAttachHover(insertIndex, currentTabVisualWidth());
      }
      // Native Wayland moves may expose a false "no button" state while the
      // compositor still owns the gesture. Do not turn that into a timed
      // drop: preview remains live until the actual MouseButtonRelease caught
      // by BrowserWindow::eventFilter() below.
      Q_UNUSED(leftPressed);
    });
    sessionSaveTimer_.setSingleShot(true);
    connect(&sessionSaveTimer_, &QTimer::timeout, this, &BrowserWindow::saveSessionNow);
    tabBar_->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(tabBar_, &QWidget::customContextMenuRequested, this, [this](const QPoint &pos) {
      const int index = tabBar_->tabAt(pos);
      if (index < 0) return;
      QMenu menu(this);
      QAction *reopen = menu.addAction(QStringLiteral("Kapatılan sekmeyi geri aç"));
      reopen->setEnabled(profileService_ && profileService_->hasClosedTabs());
      QAction *detach = menu.addAction("Sekmeyi yeni pencereye taşı");
      QAction *const selected = menu.exec(tabBar_->mapToGlobal(pos));
      if (selected == reopen) reopenMostRecentClosedTab();
      else if (selected == detach) detachTab(index, QCursor::pos(), tabBar_->tabRect(index).center());
    });

    renderBookmarks();
    if (createInitial) addNewTab();
    if (!detachedMode) {
      QSettings settings;
      const QRect normalGeometry = settings.value(QStringLiteral("window/mainNormalGeometry")).toRect();
      bool geometryRestored = false;
      if (normalGeometry.isValid()) {
        for (QScreen *screen : QGuiApplication::screens()) {
          if (screen->availableGeometry().intersects(normalGeometry)) {
            setGeometry(normalGeometry);
            geometryRestored = true;
            break;
          }
        }
      }
      // Migrate the geometry written by older builds once, without allowing an
      // off-screen rectangle to override Qt's safe default placement.
      if (!geometryRestored) {
        const QByteArray legacyGeometry = settings.value(QStringLiteral("window/mainGeometry")).toByteArray();
        if (!legacyGeometry.isEmpty()) restoreGeometry(legacyGeometry);
      }
      restoreMainMaximized_ = settings.value(QStringLiteral("window/mainMaximized"), false).toBool();
    }
    updateWindowChromeState();
    QTimer::singleShot(0, this, [this] { refreshTabStripWidth(); });
  }

  BrowserTabBar *tabBar() const { return tabBar_; }

  void showWithSavedWindowState() {
    if (mainWindow_) {
      show();
    } else if (restoreMainMaximized_) {
      showMaximized();
    } else {
      showNormal();
    }
  }

  void restoreSession(const QVector<SavedTab> &tabs) {
    if (mainWindow_ || !policy_->allowsSessionRestore()) return;
    int activeIndex = -1;
    for (const SavedTab &tab : tabs) {
      const int index = tabBar_->count();
      const QUrl url = isNewTabUrl(tab.url) ? QUrl{} : tab.url;
      addNewTab(url, tab.title);
      if (tab.active) activeIndex = index;
    }
    if (activeIndex >= 0 && activeIndex < tabBar_->count()) tabBar_->setCurrentIndex(activeIndex);
  }

  void ensureInitialTab() {
    if (tabBar_->count() == 0) addNewTab();
  }

  void runTabAttachStressTest(int iterations) {
    if (!qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_STRESS_TEST") || iterations < 1) return;
    const auto fail = [](const QString &reason) {
      std::fprintf(stderr, "tab attach stress failed: %s\n", qPrintable(reason));
      std::fflush(stderr);
      qCritical("tab attach stress failed: %s", qPrintable(reason));
      qApp->exit(2);
    };
    const bool lastRootTabScenario = qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_STRESS_LAST_ROOT");
    if (!lastRootTabScenario) { addNewTab(); addNewTab(); }
    QPointer<QWebEngineView> movedView(currentView());
    if (!movedView || !movedView->page()) { fail(QStringLiteral("stress tab creation failed")); return; }
    const TabManager::TabId movedId = tabManager_->idFor(movedView);
    QPointer<QWebEnginePage> movedPage(movedView->page());
    QTimer::singleShot(700, this, [this, iterations, movedView, movedPage, movedId, fail] {
      if (!movedView || !movedPage || movedId.isNull()) { fail(QStringLiteral("stress tab vanished before start")); return; }
      movedPage->runJavaScript(QStringLiteral("window.__ardaliTransferStress=(window.__ardaliTransferStress||0)+1;history.pushState({stress:true},'', '#transfer-stress');window.__ardaliTransferStress"),
          [this, iterations, movedView, movedPage, movedId, fail](const QVariant &marker) {
        if (marker.toInt() != 1) { fail(QStringLiteral("could not initialize web state marker")); return; }
        auto cycle = std::make_shared<std::function<void(int)>>();
        *cycle = [this, iterations, movedView, movedPage, movedId, fail, cycle](int completed) {
          if (!movedView || !movedPage) { fail(QStringLiteral("live view/page identity changed")); return; }
          const TabManager::TabRecord *before = tabManager_->record(movedId);
          if (!before || before->ownerWindow != this || before->detached || before->view != movedView || before->page != movedPage) {
            fail(QStringLiteral("main ownership invalid before cycle %1").arg(completed + 1)); return;
          }
          if (completed >= iterations) {
            QString reason;
            if (!tabManager_->validate(&reason)) { fail(QStringLiteral("final tab invariant: %1").arg(reason)); return; }
            if (tabManager_->recordCount() != pages_->count()) { fail(QStringLiteral("unexpected final record count")); return; }
            movedPage->runJavaScript(QStringLiteral("JSON.stringify({marker:window.__ardaliTransferStress,hash:location.hash,historyLength:history.length})"),
                [iterations, fail](const QVariant &value) {
              const QJsonObject state = QJsonDocument::fromJson(value.toString().toUtf8()).object();
              if (state.value(QStringLiteral("marker")).toInt() != 1
                  || state.value(QStringLiteral("hash")).toString() != QLatin1String("#transfer-stress")
                  || state.value(QStringLiteral("historyLength")).toInt() < 2) {
                fail(QStringLiteral("web state/history changed during stress")); return;
              }
              qInfo("tab attach stress: %d cycles ok", iterations);
              qApp->exit(0);
            });
            return;
          }
          const int sourceIndex = pages_->indexOf(movedView);
          if (sourceIndex < 0) { fail(QStringLiteral("source view absent from root stack")); return; }
          const QRect sourceRect = tabBar_->tabRect(sourceIndex);
          const int anchorX = completed % 3 == 0 ? 10
              : (completed % 3 == 1 ? sourceRect.width() / 2 : sourceRect.width() - 10);
          const QPoint pointerOffset(std::clamp(anchorX, 0, std::max(0, sourceRect.width() - 1)), sourceRect.height() / 2);
          // Rotate left/middle/right held points so the exposed-shell anchor
          // correction is exercised beyond the usual tab center.
          detachTab(sourceIndex, tabBar_->mapToGlobal(sourceRect.topLeft() + pointerOffset), pointerOffset);
          QTimer::singleShot(35, this, [this, completed, movedView, movedPage, movedId, fail, cycle] {
            BrowserWindow *detached = nullptr;
            for (QWidget *topLevel : QApplication::topLevelWidgets()) {
              auto *candidate = qobject_cast<BrowserWindow *>(topLevel);
              const TabManager::TabRecord *record = tabManager_->record(movedId);
              if (candidate && candidate != this && record && record->ownerWindow == candidate && record->detached) {
                detached = candidate;
                break;
              }
            }
            if (!detached || !movedView || !movedPage) { fail(QStringLiteral("detached shell missing in cycle %1").arg(completed + 1)); return; }
            const TabManager::TabRecord *detachedRecord = tabManager_->record(movedId);
            if (!detachedRecord || detachedRecord->view != movedView || detachedRecord->page != movedPage
                || detachedRecord->ownerWindow != detached || !detachedRecord->detached) {
              fail(QStringLiteral("detached ownership invalid in cycle %1").arg(completed + 1)); return;
            }
            auto *rootStrip = findChild<QWidget *>(QStringLiteral("tab-strip"));
            if (!rootStrip) { fail(QStringLiteral("root strip missing")); return; }
            const QPoint outside = rootStrip->mapToGlobal(QPoint(rootStrip->width() / 2, rootStrip->height() + 40));
            const int requestedInsertIndex = completed % (tabBar_->count() + 1);
            const int targetX = requestedInsertIndex < tabBar_->count()
                ? tabBar_->tabRect(requestedInsertIndex).left() + 8
                : tabBar_->tabRect(tabBar_->count() - 1).right() + 8;
            const QPoint target = tabBar_->mapToGlobal(QPoint(targetX, tabBar_->height() / 2));
            const int expectedPreviewWidth = detached->currentTabVisualWidth();
            detached->runtimeTestBeginInitialMoveAt(outside);
            const QPointer<BrowserWindow> guardedDetached(detached);
            QTimer::singleShot(30, this, [guardedDetached, outside] {
              if (guardedDetached) guardedDetached->runtimeTestSnapCurrentToMain(outside);
            });
            // A release outside the root strip is a complete no-op: it must
            // retain the detached owner before the following real drop.
            QTimer::singleShot(60, this, [guardedDetached] {
              if (guardedDetached) guardedDetached->finishDetachedWindowMove();
            });
            QTimer::singleShot(90, this, [this, guardedDetached, movedId, outside, fail] {
              const TabManager::TabRecord *stillDetached = tabManager_->record(movedId);
              if (!guardedDetached || !stillDetached || stillDetached->ownerWindow != guardedDetached || !stillDetached->detached) {
                fail(QStringLiteral("outside release unexpectedly attached")); return;
              }
              guardedDetached->runtimeTestBeginInitialMoveAt(outside);
            });
            QTimer::singleShot(120, this, [guardedDetached, target] {
              if (guardedDetached) guardedDetached->runtimeTestSnapCurrentToMain(target);
            });
            QTimer::singleShot(150, this, [this, requestedInsertIndex, expectedPreviewWidth, fail] {
              if (!hasAttachPreview(requestedInsertIndex, expectedPreviewWidth)) {
                fail(QStringLiteral("insertion preview did not match the current candidate"));
              }
            });
            // The offscreen platform can retain a synthetic button state even
            // after the target probe has moved. Model the physical release
            // explicitly; production release delivery still goes through the
            // event filter/timer path above.
            QTimer::singleShot(170, this, [guardedDetached] {
              if (guardedDetached) guardedDetached->finishDetachedWindowMove();
            });
            QTimer::singleShot(360, this, [this, completed, requestedInsertIndex, movedView, movedPage, movedId, guardedDetached, fail, cycle] {
              const TabManager::TabRecord *attached = tabManager_->record(movedId);
              QString reason;
              if (!attached || attached->ownerWindow != this || attached->detached || attached->view != movedView || attached->page != movedPage
                  || !tabManager_->validate(&reason) || pages_->indexOf(movedView) < 0) {
                fail(QStringLiteral("attach invariant invalid in cycle %1: %2 (record=%3 ownerIsRoot=%4 detached=%5 view=%6 page=%7 visualIndex=%8)")
                    .arg(completed + 1).arg(reason).arg(attached ? 1 : 0)
                    .arg(attached && attached->ownerWindow == this).arg(attached && attached->detached)
                    .arg(attached && attached->view == movedView).arg(attached && attached->page == movedPage)
                    .arg(pages_->indexOf(movedView))); return;
              }
              if (guardedDetached) { fail(QStringLiteral("detached shell survived attach in cycle %1").arg(completed + 1)); return; }
              if (pages_->indexOf(movedView) != requestedInsertIndex) {
                fail(QStringLiteral("wrong insertion index in cycle %1: expected %2 got %3")
                    .arg(completed + 1).arg(requestedInsertIndex).arg(pages_->indexOf(movedView))); return;
              }
              (*cycle)(completed + 1);
            });
          });
        };
        (*cycle)(0);
      });
    });
  }

  void runSettingsLifecycleRuntimeTest() {
    if (!qEnvironmentVariableIsSet("ARDALI_SETTINGS_RUNTIME_TEST")) return;
    const auto fail = [](const char *reason) {
      qCritical("settings runtime test failed: %s", reason);
      qApp->exit(2);
    };
    if (!currentView()) { fail("initial web tab missing"); return; }
    auto *minimizeControl = findChild<QToolButton *>(QStringLiteral("window-minimize-button"));
    auto *maximizeControl = findChild<QToolButton *>(QStringLiteral("window-maximize-button"));
    auto *closeControl = findChild<QToolButton *>(QStringLiteral("window-close-button"));
    if (!windowFlags().testFlag(Qt::FramelessWindowHint) || !tabStrip_ || !tabStripLayout_
        || !minimizeControl || !maximizeControl || !closeControl) {
      fail("custom window chrome is incomplete"); return;
    }
    for (QToolButton *control : {minimizeControl, maximizeControl, closeControl}) {
      if (control->icon().isNull() || !control->text().isEmpty() || control->accessibleName().isEmpty()
          || control->toolTip().isEmpty() || control->focusPolicy() != Qt::StrongFocus) {
        fail("window control icon or accessibility contract failed"); return;
      }
    }
    const bool initiallyMaximized = isMaximized();
    maximizeControl->click();
    QCoreApplication::processEvents();
    if (isMaximized() == initiallyMaximized) { fail("maximize control did not toggle window state"); return; }
    int leftMargin = 0, topMargin = 0, rightMargin = 0, bottomMargin = 0;
    tabStripLayout_->getContentsMargins(&leftMargin, &topMargin, &rightMargin, &bottomMargin);
    if (isMaximized() && (topMargin != 0 || maximizeControl->icon().isNull())) {
      fail("maximized chrome spacing or restore icon invalid"); return;
    }
    maximizeControl->click();
    QCoreApplication::processEvents();
    if (isMaximized() != initiallyMaximized) { fail("restore control did not recover window state"); return; }
    toggleFullScreen();
    QCoreApplication::processEvents();
    if (!isFullScreen() || tabStrip_->isVisible()) { fail("fullscreen did not hide top chrome"); return; }
    toggleFullScreen();
    QCoreApplication::processEvents();
    if (isFullScreen() || !tabStrip_->isVisible() || isMaximized() != initiallyMaximized) {
      fail("fullscreen exit did not restore chrome state"); return;
    }
    const int initialCount = pages_->count();
    QWidget *const initialWeb = currentView();
    const auto initialWebId = tabManager_->idForContent(initialWeb);
    showSettings();
    const auto firstSettingsId = tabManager_->findInternal(this, QStringLiteral("settings"));
    const TabManager::TabRecord *settingsRecord = tabManager_->record(firstSettingsId);
    if (firstSettingsId.isNull() || pages_->count() != initialCount + 1 || !settingsRecord
        || settingsRecord->kind != TabManager::TabKind::Internal || settingsRecord->capabilities.detachable
        || settingsRecord->capabilities.persistentInSession || tabManager_->activeFor(this) != firstSettingsId
        || currentView() || !address_->isReadOnly() || reload_->isEnabled() || back_->isEnabled() || forward_->isEnabled()) {
      fail("internal tab registration or web action state invalid"); return;
    }
    auto *settingsPage = qobject_cast<SettingsPage *>(settingsRecord->content.data());
    auto *settingsSidebar = settingsPage ? settingsPage->findChild<QListWidget *>(QStringLiteral("settings-sidebar")) : nullptr;
    auto *settingsSearch = settingsPage ? settingsPage->findChild<QLineEdit *>(QStringLiteral("settings-search")) : nullptr;
    const int settingsTabIndex = pages_->indexOf(settingsRecord->content);
    if (!settingsPage || !settingsSidebar || !settingsSearch || tabBar_->tabIcon(settingsTabIndex).isNull()) {
      fail("settings UI controls or tab icon missing"); return;
    }
    settingsPage->setCategory(SettingsPage::Category::Downloads);
    if (!settingsSidebar->currentItem() || settingsSidebar->currentItem()->text() != QStringLiteral("İndirilenler")) {
      fail("direct settings category open failed"); return;
    }
    settingsSearch->setText(QStringLiteral("öneri servisine"));
    if (!settingsSidebar->currentItem() || settingsSidebar->currentItem()->text() != QStringLiteral("Arama motoru")) {
      fail("settings search did not select matching category"); return;
    }
    for (int row = 0; row < settingsSidebar->count(); ++row) {
      QListWidgetItem *item = settingsSidebar->item(row);
      if ((item->flags() & Qt::ItemIsEnabled) && item->icon().isNull()) { fail("sidebar category icon missing"); return; }
    }
    for (int rawIcon = static_cast<int>(BrowserIcon::Startup); rawIcon <= static_cast<int>(BrowserIcon::Close); ++rawIcon) {
      const QIcon icon = BrowserIcons::icon(static_cast<BrowserIcon>(rawIcon));
      if (icon.isNull() || icon.pixmap(18, 18).isNull()) { fail("browser icon resource failed to render"); return; }
    }
    showSettings();
    if (pages_->count() != initialCount + 1 || tabManager_->findInternal(this, QStringLiteral("settings")) != firstSettingsId) {
      fail("settings singleton violated"); return;
    }
    int settingsIndex = pages_->indexOf(settingsRecord->content);
    tabBar_->moveTab(settingsIndex, 0);
    settingsRecord = tabManager_->record(firstSettingsId);
    const QVector<TabManager::TabRecord> reordered = tabManager_->recordsFor(this);
    if (reordered.isEmpty() || reordered.front().id != firstSettingsId || pages_->widget(0) != settingsRecord->content) {
      fail("settings reorder diverged from tab model"); return;
    }
    detachTab(0, QPoint(100, 100), QPoint(10, 10));
    settingsRecord = tabManager_->record(firstSettingsId);
    if (!settingsRecord || settingsRecord->ownerWindow != this || pages_->count() != initialCount + 1) {
      fail("non-detachable settings tab moved"); return;
    }
    closeTab(0);
    if (!tabManager_->findInternal(this, QStringLiteral("settings")).isNull() || pages_->count() != initialCount) {
      fail("settings close did not clean model and widget stack"); return;
    }
    showSettings();
    const auto reopenedId = tabManager_->findInternal(this, QStringLiteral("settings"));
    if (reopenedId.isNull() || reopenedId == firstSettingsId) { fail("settings reopen did not create a new record"); return; }
    closeTab(pages_->indexOf(tabManager_->record(reopenedId)->content));
    const int webIndex = pages_->indexOf(initialWeb);
    if (webIndex < 0) { fail("web tab lost during settings lifecycle"); return; }
    tabBar_->setCurrentIndex(webIndex);
    if (tabManager_->activeFor(this) != initialWebId || currentView() != initialWeb || address_->isReadOnly() || !reload_->isEnabled()) {
      fail("web tab state did not recover"); return;
    }
    qInfo("settings internal tab runtime lifecycle: ok");
    qApp->exit(0);
  }

  void runNewTabCustomizationRuntimeTest() {
    if (!qEnvironmentVariableIsSet("ARDALI_NEW_TAB_CUSTOMIZATION_RUNTIME_TEST")) return;
    const auto fail = [](const char *reason) {
      qCritical("new-tab customization runtime failed: %s", reason);
      std::fprintf(stderr, "new-tab customization runtime failed: %s\n", reason);
      qApp->exit(2);
    };
    QWebEngineView *const view = currentView();
    if (!view || !view->page() || !isNewTabUrl(view->url())) { fail("initial new-tab page missing"); return; }
    const QUrl frequentFixture(QStringLiteral("https://frequent.runtime.test/page"));
    const QUrl bookmarkFixture(QStringLiteral("https://bookmark.runtime.test/"));
    profileService_->recordHistory(frequentFixture, QStringLiteral("Runtime Frequent"));
    if (!profileService_->isBookmarked(bookmarkFixture)) profileService_->toggleBookmark(bookmarkFixture);
    QTemporaryDir backgroundFixture;
    const QString backgroundPath = backgroundFixture.path() + QStringLiteral("/runtime-background.png");
    QImage backgroundImage(800, 450, QImage::Format_ARGB32);
    backgroundImage.fill(QColor(QStringLiteral("#326b91")));
    if (!backgroundImage.save(backgroundPath, "PNG")
        || !profileService_->newTabBackgroundStore()->importImage(backgroundPath).ok()) {
      fail("managed background fixture could not be imported"); return;
    }
    QSettings().setValue(QStringLiteral("browser/newTabBackgroundSource"), QStringLiteral("custom"));
    syncFrequentSites(view);
    view->page()->runJavaScript(QStringLiteral(R"JS(
      (() => {
        const api=window.ardaliCustomization;
        const customize=document.getElementById('customize');
        const modal=document.getElementById('customization-modal');
        if(!api||!customize||!modal)return JSON.stringify({ready:false});
        customize.click();
        const opened=api.isOpen();
        const categories=['background','search','topsites','clock','cards'];
        const categoryResults={};
        for(const category of categories){api.select(category);const panel=document.querySelector(`[data-category-panel="${category}"]`);categoryResults[category]=!!panel&&!panel.hidden}
        const setInput=(id,value,eventName)=>{const input=document.getElementById(id);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new Event(eventName,{bubbles:true}))};
        setInput('shortcuts-toggle',false,'change');
        setInput('frequent-panel-opacity',63,'input');
        setInput('frequent-icon-opacity',77,'input');
        setInput('dim',55,'input');
        setInput('clock-toggle',false,'change');
        setInput('date-toggle',false,'change');
        setInput('cards-toggle',false,'change');
        setInput('background-toggle',false,'change');
        setInput('search-toggle',false,'change');
        const builtinBackground=document.querySelector('[data-background="builtin"]');builtinBackground.click();const builtinSelected=builtinBackground.classList.contains('selected');
        const customBackground=document.querySelector('[data-background="custom"]');customBackground.click();const customSelected=customBackground.classList.contains('selected');
        setInput('clock-format','auto','change');const autoClock=document.getElementById('clock').textContent;
        setInput('clock-format','12','change');const twelveClock=document.getElementById('clock').textContent;
        setInput('clock-format','24','change');
        const twentyFourClock=document.getElementById('clock').textContent;
        const frequentSource=document.querySelector('input[name="top-sites-source"][value="frequent"]');frequentSource.checked=true;frequentSource.dispatchEvent(new Event('change',{bubbles:true}));
        const frequentRemove=document.querySelector('.shortcut-remove:not([hidden])');if(frequentRemove)frequentRemove.click();
        const bookmarkSource=document.querySelector('input[name="top-sites-source"][value="bookmarks"]');bookmarkSource.checked=true;bookmarkSource.dispatchEvent(new Event('change',{bubbles:true}));
        const bing=document.querySelector('input[name="custom-engine"][value="Bing"]');bing.checked=true;bing.dispatchEvent(new Event('change',{bubbles:true}));
        setInput('suggestions-toggle',true,'change');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        const escapeClosed=!api.isOpen();
        customize.click();
        const reopened=api.isOpen()&&document.querySelectorAll('#customization-modal').length===1;
        api.close();
        const icons=[...document.querySelectorAll('.category-button img,.customize img,.modal-close img')].every(icon=>icon.complete&&icon.naturalWidth>0);
        return JSON.stringify({ready:true,opened,categories:categoryResults,escapeClosed,reopened,icons,
          customizeLabel:customize.getAttribute('aria-label'),closeLabel:document.getElementById('customization-close').getAttribute('aria-label'),
          modalCount:document.querySelectorAll('#customization-modal').length,state:JSON.parse(localStorage.getItem('ardali.newtab')||'{}'),engine:document.getElementById('engine').value,
          managed:!!window.ardaliManagedBackgroundAvailable,frequentCount:(window.ardaliTopSiteSources.frequent||[]).length,bookmarkCount:(window.ardaliTopSiteSources.bookmarks||[]).length,
          cards:window.ardaliCardData,customPreview:!document.getElementById('custom-background-card').hidden,builtinSelected,customSelected,
          clockFormats:{auto:autoClock,twelve:twelveClock,twentyFour:twentyFourClock},hiddenCount:JSON.parse(localStorage.getItem('ardali.newtab')||'{}').hiddenFrequentSites.length,
          live:{backgroundHidden:document.body.classList.contains('background-hidden'),searchHidden:document.getElementById('search').hidden,cardsHidden:document.getElementById('cards').hidden,topTitle:document.getElementById('top-sites-title').textContent}});
      })()
    )JS"), [this, fail, guardedView = QPointer<QWebEngineView>(view)](const QVariant &value) {
      const QJsonDocument document = QJsonDocument::fromJson(value.toString().toUtf8());
      const QJsonObject result = document.object();
      const QJsonObject categories = result.value(QStringLiteral("categories")).toObject();
      const QJsonObject state = result.value(QStringLiteral("state")).toObject();
      if (!result.value(QStringLiteral("ready")).toBool() || !result.value(QStringLiteral("opened")).toBool()
          || !result.value(QStringLiteral("escapeClosed")).toBool() || !result.value(QStringLiteral("reopened")).toBool()
          || !result.value(QStringLiteral("icons")).toBool() || result.value(QStringLiteral("modalCount")).toInt() != 1
          || result.value(QStringLiteral("customizeLabel")).toString().isEmpty() || result.value(QStringLiteral("closeLabel")).toString().isEmpty()) {
        fail("modal lifecycle, icon, or accessibility contract failed"); return;
      }
      if (!result.value(QStringLiteral("managed")).toBool() || !result.value(QStringLiteral("customPreview")).toBool()
          || !result.value(QStringLiteral("builtinSelected")).toBool() || !result.value(QStringLiteral("customSelected")).toBool()
          || result.value(QStringLiteral("frequentCount")).toInt() < 1 || result.value(QStringLiteral("bookmarkCount")).toInt() < 1
          || result.value(QStringLiteral("hiddenCount")).toInt() < 1
          || result.value(QStringLiteral("cards")).toObject().value(QStringLiteral("downloads")).toInt(-1) != profileService_->recentDownloads().size()
          || result.value(QStringLiteral("cards")).toObject().value(QStringLiteral("protection")).toBool() != profileService_->stripsTrackingParameters()) {
        fail("managed background or profile-backed content contract failed"); return;
      }
      if (result.value(QStringLiteral("clockFormats")).toObject().value(QStringLiteral("auto")).toString().isEmpty()
          || result.value(QStringLiteral("clockFormats")).toObject().value(QStringLiteral("twelve")).toString().isEmpty()
          || result.value(QStringLiteral("clockFormats")).toObject().value(QStringLiteral("twentyFour")).toString().isEmpty()
          || result.value(QStringLiteral("clockFormats")).toObject().value(QStringLiteral("twelve")).toString()
              == result.value(QStringLiteral("clockFormats")).toObject().value(QStringLiteral("twentyFour")).toString()
          || !result.value(QStringLiteral("live")).toObject().value(QStringLiteral("backgroundHidden")).toBool()
          || !result.value(QStringLiteral("live")).toObject().value(QStringLiteral("searchHidden")).toBool()
          || !result.value(QStringLiteral("live")).toObject().value(QStringLiteral("cardsHidden")).toBool()
          || result.value(QStringLiteral("live")).toObject().value(QStringLiteral("topTitle")).toString() != QStringLiteral("Yer İmleri")) {
        fail("clock format or live preview contract failed"); return;
      }
      for (const QString &category : {QStringLiteral("background"), QStringLiteral("search"), QStringLiteral("topsites"), QStringLiteral("clock"), QStringLiteral("cards")}) {
        if (!categories.value(category).toBool()) { fail("sidebar category selection failed"); return; }
      }
      if (state.value(QStringLiteral("shortcuts")).toBool(true) || state.value(QStringLiteral("frequentPanelOpacity")).toInt() != 63
          || state.value(QStringLiteral("frequentIconOpacity")).toInt() != 77 || state.value(QStringLiteral("dim")).toInt() != 55
          || state.value(QStringLiteral("clock")).toBool(true) || state.value(QStringLiteral("date")).toBool(true)
          || state.value(QStringLiteral("cards")).toBool(true) || state.value(QStringLiteral("backgroundVisible")).toBool(true)
          || state.value(QStringLiteral("searchVisible")).toBool(true) || state.value(QStringLiteral("clockFormat")).toString() != QLatin1String("24")
          || state.value(QStringLiteral("topSitesSource")).toString() != QLatin1String("bookmarks")
          || result.value(QStringLiteral("engine")).toString() != QLatin1String("Bing")) {
        fail("live preview state did not persist in new-tab storage"); return;
      }
      QTimer::singleShot(550, this, [this, fail, guardedView] {
        if (!guardedView || guardedView != currentView()) { fail("new-tab page became stale during persistence"); return; }
        QSettings settings;
        if (settings.value(QStringLiteral("browser/showFrequentSites"), true).toBool()
            || settings.value(QStringLiteral("browser/frequentSitesPanelOpacity")).toInt() != 63
            || settings.value(QStringLiteral("browser/frequentSitesIconOpacity")).toInt() != 77
            || settings.value(QStringLiteral("browser/searchEngine")).toString() != QLatin1String("Bing")
            || settings.value(QStringLiteral("browser/newTabBackgroundVisible"), true).toBool()
            || settings.value(QStringLiteral("browser/newTabSearchVisible"), true).toBool()
            || settings.value(QStringLiteral("browser/newTabClockFormat")).toString() != QLatin1String("24")
            || settings.value(QStringLiteral("browser/newTabTopSitesSource")).toString() != QLatin1String("bookmarks")
            || !settings.value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool()) {
          fail("QSettings and customization preferences diverged"); return;
        }
        showSettings(SettingsPage::Category::Appearance);
        const auto settingsId = tabManager_->findInternal(this, QStringLiteral("settings"));
        const TabManager::TabRecord *settingsRecord = tabManager_->record(settingsId);
        auto *settingsPage = settingsRecord ? qobject_cast<SettingsPage *>(settingsRecord->content.data()) : nullptr;
        auto *frequent = settingsPage ? settingsPage->findChild<QCheckBox *>(QStringLiteral("settings-frequent-sites")) : nullptr;
        auto *panel = settingsPage ? settingsPage->findChild<QSlider *>(QStringLiteral("settings-frequent-panel-opacity")) : nullptr;
        auto *icons = settingsPage ? settingsPage->findChild<QSlider *>(QStringLiteral("settings-frequent-icon-opacity")) : nullptr;
        auto *engine = settingsPage ? settingsPage->findChild<QComboBox *>(QStringLiteral("settings-search-engine")) : nullptr;
        auto *suggestions = settingsPage ? settingsPage->findChild<QCheckBox *>(QStringLiteral("settings-search-suggestions")) : nullptr;
        if (!settingsPage || !frequent || frequent->isChecked() || !panel || panel->value() != 63
            || !icons || icons->value() != 77 || !engine || engine->currentText() != QLatin1String("Bing")
            || !suggestions || !suggestions->isChecked()) {
          fail("Settings controls did not refresh from shared preferences"); return;
        }
        const int oldNewTabIndex = pages_->indexOf(guardedView);
        if (oldNewTabIndex < 0) { fail("original new-tab disappeared before lifecycle check"); return; }
        closeTab(oldNewTabIndex);
        QTimer::singleShot(80, this, [this, fail, guardedView] {
          if (guardedView) { fail("closed new-tab widget remained alive"); return; }
          addNewTab();
          const QPointer<QWebEngineView> reopenedView(currentView());
          QTimer::singleShot(450, this, [this, fail, reopenedView] {
            if (!reopenedView || !reopenedView->page() || !isNewTabUrl(reopenedView->url())) {
              fail("replacement new-tab did not load"); return;
            }
            reopenedView->page()->runJavaScript(QStringLiteral("JSON.stringify({ready:document.documentElement.dataset.customizationReady==='true',modalCount:document.querySelectorAll('#customization-modal').length,state:JSON.parse(localStorage.getItem('ardali.newtab')||'{}'),backgroundHidden:document.body.classList.contains('background-hidden'),searchHidden:document.getElementById('search').hidden,cardsHidden:document.getElementById('cards').hidden,managed:!!window.ardaliManagedBackgroundAvailable})"),
                [this, fail, reopenedView](const QVariant &replacementValue) {
              const QJsonObject replacement = QJsonDocument::fromJson(replacementValue.toString().toUtf8()).object();
              const QJsonObject replacementState = replacement.value(QStringLiteral("state")).toObject();
              if (!replacement.value(QStringLiteral("ready")).toBool() || replacement.value(QStringLiteral("modalCount")).toInt() != 1
                  || !replacement.value(QStringLiteral("backgroundHidden")).toBool() || !replacement.value(QStringLiteral("searchHidden")).toBool()
                  || !replacement.value(QStringLiteral("cardsHidden")).toBool() || !replacement.value(QStringLiteral("managed")).toBool()
                  || replacementState.value(QStringLiteral("clockFormat")).toString() != QLatin1String("24")
                  || replacementState.value(QStringLiteral("topSitesSource")).toString() != QLatin1String("bookmarks")) {
                fail("replacement new-tab modal lifecycle failed"); return;
              }
              reopenedView->page()->runJavaScript(QStringLiteral("window.ardaliNewTabCommand={type:'removeBackground',nonce:Date.now()}"));
              QTimer::singleShot(500, this, [this, fail, reopenedView] {
                if (!reopenedView || profileService_->newTabBackgroundStore()->hasValidManagedImage()
                    || QSettings().value(QStringLiteral("browser/newTabBackgroundSource")).toString() != QLatin1String("builtin")) {
                  fail("managed background remove or native fallback failed"); return;
                }
                reopenedView->page()->runJavaScript(QStringLiteral("JSON.stringify({available:!!window.ardaliManagedBackgroundAvailable,source:JSON.parse(localStorage.getItem('ardali.newtab')||'{}').backgroundSource})"),
                    [fail](const QVariant &removedValue) {
                  const QJsonObject removed = QJsonDocument::fromJson(removedValue.toString().toUtf8()).object();
                  if (removed.value(QStringLiteral("available")).toBool()
                      || removed.value(QStringLiteral("source")).toString() != QLatin1String("builtin")) {
                    fail("renderer did not fall back after managed removal"); return;
                  }
                  qInfo("new-tab customization runtime: ok");
                  qApp->exit(0);
                });
              });
            });
          });
        });
      });
    });
  }

  void saveSessionNow() {
    if (mainWindow_ || !sessionStore_ || !policy_->allowsSessionRestore()) return;
    QString error;
    if (!sessionStore_->save(*tabManager_, this, &error)) qWarning("Session save failed: %s", qPrintable(error));
  }

  bool adoptView(QWebEngineView *view, const QString &title, int requestedIndex = -1) {
    if (!view || !view->page()) return false;
    const auto knownId = tabManager_->idFor(view);
    const auto id = knownId.isNull() ? tabManager_->registerTab(view, this, mainWindow_ != nullptr, title) : knownId;
    if (id.isNull()) return false;
    if (!knownId.isNull() && !tabManager_->transfer(knownId, this, mainWindow_ != nullptr)) return false;
    bindView(view);
    const int insertedIndex = insertRegisteredTab(view, id, title.isEmpty() ? QStringLiteral("Yeni Sekme") : title, requestedIndex);
    const TabManager::TabRecord *const record = tabManager_->record(id);
    return insertedIndex >= 0 && pages_->widget(insertedIndex) == view && record
        && record->ownerWindow == this && record->content == view && record->view == view
        && record->page == view->page() && record->detached == (mainWindow_ != nullptr);
  }

  int insertRegisteredTab(QWidget *content, TabManager::TabId id, const QString &title, int requestedIndex = -1) {
    if (!content || id.isNull() || !tabManager_->record(id)) return -1;
    const int index = std::clamp(requestedIndex < 0 ? pages_->count() : requestedIndex, 0, pages_->count());
    pages_->insertWidget(index, content);
    tabBar_->insertTab(index, title);
    const TabManager::TabRecord *const record = tabManager_->record(id);
    if (record && !record->icon.isNull()) {
      tabBar_->setTabIcon(index, record->icon);
    } else if (auto *view = qobject_cast<QWebEngineView *>(content); view && !view->icon().isNull()) {
      tabBar_->setTabIcon(index, view->icon());
      tabManager_->updateIcon(id, view->icon());
    } else {
      tabBar_->setTabIcon(index, BrowserIcons::icon(BrowserIcon::Window));
    }
    tabBar_->setTabData(index, tabManager_->record(id)->capabilities.detachable);
    // QTabBar emits currentChanged synchronously. Establish both visual
    // containers before any observer can validate the active tab state.
    {
      const QSignalBlocker blockTabBar(tabBar_);
      const QSignalBlocker blockPages(pages_);
      pages_->setCurrentWidget(content);
      tabBar_->setCurrentIndex(index);
    }
    QVector<TabManager::TabId> order;
    for (int pageIndex = 0; pageIndex < pages_->count(); ++pageIndex)
      order.push_back(tabManager_->idForContent(pages_->widget(pageIndex)));
    if (!tabManager_->reorder(this, order)) qWarning("Registered tab insertion could not update model order");
    tabManager_->activate(id);
    validateTabState();
    refreshTabStripWidth();
    updateChrome();
    scheduleSessionSave();
    return index;
  }

 protected:
  bool eventFilter(QObject *watched, QEvent *event) override {
    if (!isMaximized() && !isFullScreen() && event->type() == QEvent::MouseButtonPress) {
      auto *mouse = static_cast<QMouseEvent *>(event);
      auto *widget = qobject_cast<QWidget *>(watched);
      if (mouse->button() == Qt::LeftButton && widget && widget->window() == this
          && !qobject_cast<QToolButton *>(widget)) {
        constexpr int resizeBorder = 6;
        const QPoint local = mapFromGlobal(mouse->globalPosition().toPoint());
        Qt::Edges edges;
        if (local.x() <= resizeBorder) edges |= Qt::LeftEdge;
        else if (local.x() >= width() - resizeBorder) edges |= Qt::RightEdge;
        if (local.y() <= resizeBorder) edges |= Qt::TopEdge;
        else if (local.y() >= height() - resizeBorder) edges |= Qt::BottomEdge;
        if (edges != Qt::Edges{} && windowHandle() && windowHandle()->startSystemResize(edges)) {
          mouse->accept();
          return true;
        }
      }
    }
    if (mainWindow_ && detachedSystemMoveActive_ && event->type() == QEvent::MouseButtonRelease) {
      QTimer::singleShot(0, this, [this] {
        if (detachedSystemMoveActive_)
          finishDetachedWindowMove();
      });
    }
    const bool watchesMainTabStrip = !mainWindow_ && (watched == tabStrip_ || watched == tabBar_
        || watched == attachPreviewOverlay_ || (tabScroll_ && watched == tabScroll_->viewport()));
    if (watchesMainTabStrip && (event->type() == QEvent::DragEnter || event->type() == QEvent::DragMove
                                || event->type() == QEvent::DragLeave || event->type() == QEvent::Drop)) {
      if (event->type() == QEvent::DragLeave) {
        clearAttachHover();
        event->accept();
        return true;
      }
      auto *dropEvent = static_cast<QDropEvent *>(event);
      if (!dropEvent->mimeData()->hasFormat(kDetachedTabMimeType)) return false;
      auto *sourceBar = qobject_cast<BrowserTabBar *>(dropEvent->source());
      auto *sourceWindow = sourceBar ? qobject_cast<BrowserWindow *>(sourceBar->window()) : nullptr;
      if (!sourceWindow || sourceWindow == this || sourceWindow->mainWindow_.data() != this) return false;
      auto *targetWidget = qobject_cast<QWidget *>(watched);
      const QPoint screenPosition = targetWidget->mapToGlobal(dropEvent->position().toPoint());
      const int insertIndex = tabInsertIndexAtGlobal(screenPosition);
      if (insertIndex < 0) return false;
      showAttachHover(insertIndex, sourceWindow->currentTabVisualWidth());
      dropEvent->setDropAction(Qt::MoveAction);
      dropEvent->accept();
      if (event->type() == QEvent::Drop) {
        clearAttachHover();
        // The source is still inside QDrag::exec(). Queue the transfer on it
        // and commit only after BrowserTabBar emits externalDragFinished.
        sourceWindow->queueAttachToMainAfterExternalDrag(insertIndex);
      }
      return true;
    }
    if (watched == address_ && (event->type() == QEvent::Resize || event->type() == QEvent::Show)) {
      positionZoomButton();
      return false;
    }
    QWebEngineView *view = qobject_cast<QWebEngineView *>(watched);
    if (!view) {
      for (QObject *parent = watched ? watched->parent() : nullptr; parent; parent = parent->parent()) {
        if ((view = qobject_cast<QWebEngineView *>(parent))) break;
      }
    }
    if (view && view == currentView() && isActiveWindow() && event->type() == QEvent::Wheel) {
      auto *wheel = static_cast<QWheelEvent *>(event);
      if (wheel->modifiers().testFlag(Qt::ControlModifier) && !wheel->angleDelta().isNull()) {
        view->setZoomFactor(std::clamp(view->zoomFactor() + (wheel->angleDelta().y() > 0 ? 0.1 : -0.1), 0.25, 5.0));
        if (view == currentView()) updateZoomControls();
        wheel->accept();
        return true;
      }
    }
    return QMainWindow::eventFilter(watched, event);
  }

  void changeEvent(QEvent *event) override {
    QMainWindow::changeEvent(event);
    if (event->type() == QEvent::WindowStateChange) updateWindowChromeState();
  }

  void closeEvent(QCloseEvent *event) override {
    const auto currentId = pages_ && pages_->currentWidget() ? tabManager_->idForContent(pages_->currentWidget()) : TabManager::TabId{};
    logTransfer(mainWindow_ ? QStringLiteral("SHELL_CLOSE") : QStringLiteral("ROOT_CLOSE"), currentId, this);
    dragProxySettleAnimation_.stop();
    dragProxySettlePending_ = false;
    clearDragReorderPreview();
    if (mainWindow_) {
      detachedMoveWatchTimer_.stop();
      detachedSystemMoveActive_ = false;
      mainWindow_->clearAttachHover();
    } else {
      QSettings settings;
      const QRect normal = (isMaximized() || isFullScreen()) ? normalGeometry() : geometry();
      if (normal.isValid()) settings.setValue(QStringLiteral("window/mainNormalGeometry"), normal);
      settings.setValue(QStringLiteral("window/mainMaximized"), isMaximized());
      settings.remove(QStringLiteral("window/mainGeometry"));
      settings.sync();
    }
    if (suggestionReply_) {
      suggestionReply_->disconnect(this);
      suggestionReply_->abort();
      suggestionReply_->deleteLater();
      suggestionReply_.clear();
    }
    clearSuggestionIcons();
    QMainWindow::closeEvent(event);
    QTimer::singleShot(0, qApp, [] {
      int visibleWindows = 0;
      for (QWidget *widget : QApplication::topLevelWidgets()) {
        if (qobject_cast<BrowserWindow *>(widget) && widget->isVisible()) {
          visibleWindows++;
        }
      }
      if (visibleWindows == 0) {
        qApp->quit();
      }
    });
  }

  void resizeEvent(QResizeEvent *event) override {
    QMainWindow::resizeEvent(event);
    QTimer::singleShot(0, this, [this] { refreshTabStripWidth(); });
  }

  void hideEvent(QHideEvent *event) override {
    cacheCurrentTabAttachGeometry();
    QMainWindow::hideEvent(event);
  }

 private slots:
  void detachTab(int index, const QPoint &screenPosition, const QPoint &pointerOffset) {
    const auto id = index >= 0 && index < pages_->count() ? tabManager_->idForContent(pages_->widget(index)) : TabManager::TabId{};
    const TabManager::TabRecord *record = tabManager_->record(id);
    if (!record || !record->capabilities.detachable || record->kind != TabManager::TabKind::Web) return;
    auto *view = qobject_cast<QWebEngineView *>(pages_->widget(index));
    if (!view) { qWarning("Detachable web tab has no QWebEngineView"); return; }
    const QString title = tabBar_->tabText(index);

    auto *detached = new BrowserWindow(profile_, profileService_, tabManager_, policy_, sessionStore_, rootWindow(), false);
    TabTransferTransaction tx(id, this, detached);
    tx.transitionTo(TabTransferState::Preparing);

    beginTabTransfer();
    detached->beginTabTransfer();
    logTransfer(QStringLiteral("DETACH_BEGIN_PREPARING"), id, this, detached);

    tx.transitionTo(TabTransferState::Moving);
    logTransfer(QStringLiteral("DETACH_MOVING"), id, this, detached);

    pages_->removeWidget(view);
    tabBar_->removeTab(index);

    const bool adopted = detached->adoptView(view, title);
    if (!adopted) {
      tx.transitionTo(TabTransferState::RolledBack);
      logTransfer(QStringLiteral("DETACH_ROLLBACK"), id, this, detached, false);
      insertRegisteredTab(view, id, title, index);
      detached->finishTabTransfer();
      finishTabTransfer();
      detached->deleteLater();
      return;
    }

    tx.transitionTo(TabTransferState::DestinationReady);
    logTransfer(QStringLiteral("DETACH_DESTINATION_READY"), id, this, detached, true);

    detached->heldTabOffsetInTab_ = pointerOffset;
    detached->initialDetachedCursorPosition_ = screenPosition;

    detached->move(screenPosition - pointerOffset);
    detached->show();

    tx.transitionTo(TabTransferState::Committed);
    QTimer::singleShot(0, detached, [detached] { detached->continueInitialDetachedMoveWhenExposed(); });
    logTransfer(QStringLiteral("DETACH_COMMITTED"), id, this, detached);

    detached->finishTabTransfer();
    finishTabTransfer();

    if (tabBar_->count() == 0 && !mainWindow_) hide();
    logTransfer(QStringLiteral("DETACH_COMPLETE"), id, this, detached);
  }

  void attachCurrentToMainAt(int insertIndex) {
    const int index = tabBar_ ? tabBar_->currentIndex() : -1;
    auto *view = index >= 0 && pages_ ? qobject_cast<QWebEngineView *>(pages_->widget(index)) : nullptr;
    if (!view) return;
    attachViewToMainAt(view, tabManager_->idFor(view), insertIndex);
  }

  bool attachViewToMainAt(QWebEngineView *requestedView, TabManager::TabId requestedId, int insertIndex) {
    BrowserWindow *const destination = mainWindow_.data();
    const QPointer<QWebEngineView> view(requestedView);
    if (!destination || !view || requestedId.isNull() || attachCommitInProgress_) return false;
    const int index = pages_->indexOf(view);
    const TabManager::TabRecord *const sourceRecord = tabManager_->record(requestedId);
    if (index < 0 || index >= tabBar_->count() || !sourceRecord || sourceRecord->ownerWindow != this
        || sourceRecord->content != view || sourceRecord->view != view || !sourceRecord->detached) {
      logTransfer(QStringLiteral("ATTACH_REJECTED_STALE_SOURCE"), requestedId, this, destination, false);
      return false;
    }
    const QString title = tabBar_->tabText(index);

    TabTransferTransaction tx(requestedId, this, destination);
    tx.transitionTo(TabTransferState::Preparing);

    attachCommitInProgress_ = true;
    beginTabTransfer();
    destination->beginTabTransfer();
    logTransfer(QStringLiteral("ATTACH_BEGIN_PREPARING"), requestedId, this, destination);

    detachedSystemMoveActive_ = false;
    detachedMoveWatchTimer_.stop();

    tx.transitionTo(TabTransferState::Moving);
    pages_->removeWidget(view);
    tabBar_->removeTab(index);

    logTransfer(QStringLiteral("ATTACH_MOVING"), requestedId, this, destination);

    const bool adopted = destination->adoptView(view, title, insertIndex);
    const TabManager::TabRecord *const destinationRecord = tabManager_->record(requestedId);
    const bool destinationOwnsView = adopted && view && destination->pages_->indexOf(view) >= 0
        && destinationRecord && destinationRecord->ownerWindow == destination
        && destinationRecord->content == view && destinationRecord->view == view
        && !destinationRecord->detached;

    if (!destinationOwnsView) {
      tx.transitionTo(TabTransferState::RolledBack);
      logTransfer(QStringLiteral("ATTACH_ADOPTION_FAILED_ROLLBACK"), requestedId, this, destination, false);
      const int destinationIndex = view ? destination->pages_->indexOf(view) : -1;
      if (destinationIndex >= 0) {
        destination->pages_->removeWidget(view);
        if (destinationIndex < destination->tabBar_->count()) destination->tabBar_->removeTab(destinationIndex);
      }
      const TabManager::TabRecord *const currentRecord = tabManager_->record(requestedId);
      const bool restoredModel = currentRecord && currentRecord->ownerWindow == this
          ? true
          : tabManager_->transfer(requestedId, this, true);
      bool restoredVisual = false;
      if (restoredModel && view) {
        bindView(view);
        restoredVisual = insertRegisteredTab(view, requestedId, title, index) >= 0;
      }
      destination->clearAttachHover();
      destination->finishTabTransfer();
      finishTabTransfer();
      attachCommitInProgress_ = false;
      logTransfer(restoredVisual ? QStringLiteral("ATTACH_ROLLBACK_COMPLETE") : QStringLiteral("ATTACH_ROLLBACK_FAILED"),
                  requestedId, this, destination, restoredVisual);
      return false;
    }

    tx.transitionTo(TabTransferState::DestinationReady);
    logTransfer(QStringLiteral("ATTACH_DESTINATION_READY"), requestedId, this, destination, true);

    if (!destination->isVisible()) {
      destination->showWithSavedWindowState();
      if (!destination->isVisible()) destination->setVisible(true);
    }
    destination->raise();
    destination->activateWindow();

    tx.transitionTo(TabTransferState::Committed);
    logTransfer(QStringLiteral("ATTACH_COMMITTED"), requestedId, this, destination);

    destination->clearAttachHover();
    destination->finishTabTransfer();
    finishTabTransfer();
    attachCommitInProgress_ = false;
    logTransfer(QStringLiteral("ATTACH_ADOPT_ROOT"), requestedId, this, destination);

    const QPointer<BrowserWindow> self(this);
    const QPointer<BrowserWindow> guardedDestination(destination);
    QTimer::singleShot(0, this, [self, guardedDestination, requestedId] {
      if (!self || self->pages_->count() != 0 || self->tabBar_->count() != 0) return;
      self->logTransfer(QStringLiteral("ATTACH_COMPLETE"), requestedId, self, guardedDestination);
      self->close();
    });
    return true;
  }

  void queueAttachToMainAfterExternalDrag(int insertIndex) {
    if (!mainWindow_ || attachCommitInProgress_) return;
    const int currentIndex = tabBar_ ? tabBar_->currentIndex() : -1;
    auto *view = currentIndex >= 0 && pages_ ? qobject_cast<QWebEngineView *>(pages_->widget(currentIndex)) : nullptr;
    const auto id = view ? tabManager_->idFor(view) : TabManager::TabId{};
    const TabManager::TabRecord *const record = tabManager_->record(id);
    if (!view || id.isNull() || !record || record->ownerWindow != this || !record->detached) {
      logTransfer(QStringLiteral("ATTACH_QUEUE_REJECTED_STALE_SOURCE"), id, this, mainWindow_, false);
      return;
    }
    pendingMainAttachIndex_ = std::clamp(insertIndex, 0, mainWindow_->tabBar_ ? mainWindow_->tabBar_->count() : 0);
    pendingMainAttachView_ = view;
    pendingMainAttachId_ = id;
    logTransfer(QStringLiteral("ATTACH_QUEUED"), id, this, mainWindow_);
  }

  void runtimeTestSnapCurrentToMain(const QPoint &targetScreenPosition) {
    if (!qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_RUNTIME_TEST") || !mainWindow_) return;
    // The X11 path observes the real cursor during native window movement,
    // while Wayland intentionally falls back to the window-derived pointer.
    // Keep this synthetic runtime gesture faithful to the active platform.
    if (QGuiApplication::platformName() == QLatin1String("xcb")) QCursor::setPos(targetScreenPosition);
    detachedMovePointerOffsetInWindow_ = targetScreenPosition - pos();
  }

  void runtimeTestBeginInitialMoveAt(const QPoint &targetScreenPosition) {
    if (!qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_RUNTIME_TEST") || !mainWindow_) return;
    if (QGuiApplication::platformName() == QLatin1String("xcb")) QCursor::setPos(targetScreenPosition);
    beginDetachedWindowMove(targetScreenPosition - pos(), true);
    detachedMoveStartPosition_ = pos() - QPoint(QApplication::startDragDistance() + 2, 0);
  }

  void closeTab(int index) {
    if (index < 0 || index >= pages_->count()) return;
    QWidget *content = pages_->widget(index);
    const auto id = tabManager_->idForContent(content);
    const TabManager::TabRecord *record = tabManager_->record(id);
    if (!record || !record->capabilities.closable) return;
    beginTabTransfer();
    if (record->kind == TabManager::TabKind::Web && profileService_ && record->view)
      profileService_->rememberClosedTab(record->view->url(), record->view->title());
    pages_->removeWidget(content);
    tabBar_->removeTab(index);
    tabManager_->remove(id);
    content->deleteLater();
    if (tabBar_->count() == 0) {
      if (!mainWindow_) addNewTab();
    }
    finishTabTransfer();
    if (tabBar_->count() == 0 && mainWindow_) close();
  }

 private:
  struct DragReorderVisual {
    QRect rect;
    QPixmap pixmap;
  };

  static bool transferDiagnosticsEnabled() {
    return qEnvironmentVariableIsSet("ARDALI_TAB_TRANSFER_DIAGNOSTICS");
  }

  static QString objectAddress(const QObject *object) {
    return object ? QStringLiteral("0x%1").arg(reinterpret_cast<quintptr>(object), 0, 16) : QStringLiteral("null");
  }

  static int visibleTopLevelWindowCount() {
    int visible = 0;
    for (QWidget *widget : QApplication::topLevelWidgets()) {
      if (widget && widget->isVisible()) ++visible;
    }
    return visible;
  }

  static QJsonObject windowTransferSnapshot(const BrowserWindow *window) {
    QJsonObject snapshot;
    if (!window) return snapshot;
    snapshot.insert(QStringLiteral("windowId"), QString::number(window->windowDebugId_));
    snapshot.insert(QStringLiteral("window"), objectAddress(window));
    snapshot.insert(QStringLiteral("detachedWindow"), window->mainWindow_ != nullptr);
    snapshot.insert(QStringLiteral("visible"), window->isVisible());
    snapshot.insert(QStringLiteral("isExposed"), window->windowHandle() && window->windowHandle()->isExposed());
    snapshot.insert(QStringLiteral("topLevel"), window->isWindow());
    snapshot.insert(QStringLiteral("tabCount"), window->tabBar_ ? window->tabBar_->count() : -1);
    snapshot.insert(QStringLiteral("tabCurrentIndex"), window->tabBar_ ? window->tabBar_->currentIndex() : -1);
    snapshot.insert(QStringLiteral("stackCount"), window->pages_ ? window->pages_->count() : -1);
    snapshot.insert(QStringLiteral("stackCurrentWidget"), window->pages_ ? objectAddress(window->pages_->currentWidget()) : QStringLiteral("null"));
    return snapshot;
  }

  void logTransfer(const QString &stage, TabManager::TabId id = {}, const BrowserWindow *source = nullptr,
                   const BrowserWindow *destination = nullptr, std::optional<bool> transferResult = std::nullopt) const {
    if (!transferDiagnosticsEnabled()) return;
    QJsonObject payload;
    payload.insert(QStringLiteral("stage"), stage);
    payload.insert(QStringLiteral("windowId"), QString::number(windowDebugId_));
    payload.insert(QStringLiteral("platform"), QGuiApplication::platformName());
    payload.insert(QStringLiteral("topLevelWindowCount"), static_cast<int>(QApplication::topLevelWidgets().size()));
    payload.insert(QStringLiteral("visibleTopLevelWindowCount"), visibleTopLevelWindowCount());
    if (source) payload.insert(QStringLiteral("source"), windowTransferSnapshot(source));
    if (destination) payload.insert(QStringLiteral("destination"), windowTransferSnapshot(destination));
    if (tabManager_) {
      payload.insert(QStringLiteral("recordCount"), tabManager_->recordCount());
      const TabManager::TabRecord *record = id.isNull() ? nullptr : tabManager_->record(id);
      if (record) {
        payload.insert(QStringLiteral("tabId"), record->id.toString(QUuid::WithoutBraces));
        payload.insert(QStringLiteral("tabKind"), record->kind == TabManager::TabKind::Web ? QStringLiteral("web") : QStringLiteral("internal"));
        payload.insert(QStringLiteral("detached"), record->detached);
        payload.insert(QStringLiteral("hasFavicon"), !record->icon.isNull());
        payload.insert(QStringLiteral("ownerWindow"), objectAddress(record->ownerWindow));
        payload.insert(QStringLiteral("activeRecord"), tabManager_->activeFor(record->ownerWindow).toString(QUuid::WithoutBraces));
        payload.insert(QStringLiteral("view"), objectAddress(record->view));
        payload.insert(QStringLiteral("page"), objectAddress(record->page));
        payload.insert(QStringLiteral("contentParent"), objectAddress(record->content ? record->content->parentWidget() : nullptr));
      }
    }
    if (transferResult.has_value()) payload.insert(QStringLiteral("transferResult"), *transferResult);
    qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER %1").arg(QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact)));
  }

  void beginTabTransfer() { tabTransferInProgress_ = true; }

  void finishTabTransfer() {
    tabTransferInProgress_ = false;
    QVector<TabManager::TabId> visualOrder;
    if (pages_) {
      visualOrder.reserve(pages_->count());
      for (int index = 0; index < pages_->count(); ++index)
        visualOrder.push_back(tabManager_->idForContent(pages_->widget(index)));
    }
    if (!tabManager_->reorder(this, visualOrder)) qFatal("Could not synchronize transferred tab order");
    if (pages_ && pages_->currentWidget()) {
      const auto currentId = tabManager_->idForContent(pages_->currentWidget());
      if (!currentId.isNull() && !tabManager_->activate(currentId)) qFatal("Could not activate transferred tab");
    }
    validateTabState();
    refreshTabStripWidth();
    updateChrome();
    scheduleSessionSave();
  }

  BrowserWindow *rootWindow() { return mainWindow_ ? mainWindow_.data() : this; }
  QWebEngineView *currentView() const { return qobject_cast<QWebEngineView *>(pages_->currentWidget()); }

  void toggleMaximized() {
    if (isFullScreen()) return;
    isMaximized() ? showNormal() : showMaximized();
  }

  void toggleFullScreen() {
    if (isFullScreen()) {
      wasMaximizedBeforeFullScreen_ ? showMaximized() : showNormal();
      return;
    }
    wasMaximizedBeforeFullScreen_ = isMaximized();
    showFullScreen();
  }

  void updateWindowChromeState() {
    const bool fullScreen = isFullScreen();
    const bool maximized = isMaximized();
    if (tabStrip_) tabStrip_->setVisible(!fullScreen);
    if (tabStripLayout_) tabStripLayout_->setContentsMargins(8, (maximized || fullScreen) ? 0 : 4, 8, 0);
    if (maximizeButton_) {
      maximizeButton_->setIcon(BrowserIcons::icon(maximized ? BrowserIcon::Restore : BrowserIcon::Maximize));
      maximizeButton_->setToolTip(maximized ? QStringLiteral("Geri yükle") : QStringLiteral("Büyüt"));
      maximizeButton_->setAccessibleName(maximized ? QStringLiteral("Pencereyi geri yükle") : QStringLiteral("Pencereyi büyüt"));
    }
    if (browserRoot_) {
      browserRoot_->setProperty("windowedFrame", !maximized && !fullScreen);
      browserRoot_->style()->unpolish(browserRoot_);
      browserRoot_->style()->polish(browserRoot_);
    }
  }

  void reopenMostRecentClosedTab() {
    if (!profileService_) return;
    const std::optional<ClosedTabEntry> closed = profileService_->takeMostRecentClosedTab();
    if (!closed) return;
    BrowserWindow *const target = mainWindow_ ? mainWindow_.data() : this;
    if (!target) return;
    const QUrl url = isNewTabUrl(closed->url) ? QUrl{} : closed->url;
    target->addNewTab(url, closed->title.isEmpty() ? QStringLiteral("Yeni Sekme") : closed->title);
    target->raise();
    target->activateWindow();
  }

  void installKeyboardShortcuts() {
    const auto addShortcut = [this](const QKeySequence &sequence, auto callback) {
      auto *shortcut = new QShortcut(sequence, this);
      shortcut->setContext(Qt::WindowShortcut);
      connect(shortcut, &QShortcut::activated, this, callback);
    };
    addShortcut(QKeySequence::New, [this] { addNewTab(); });
    addShortcut(QKeySequence::Close, [this] { closeTab(tabBar_->currentIndex()); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_T), [this] { reopenMostRecentClosedTab(); });
    addShortcut(QKeySequence::Refresh, [this] { if (auto *view = currentView()) view->reload(); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_L), [this] {
      address_->setFocus(Qt::ShortcutFocusReason);
      address_->selectAll();
    });
    addShortcut(QKeySequence(Qt::ALT | Qt::Key_Left), [this] { if (auto *view = currentView(); view && view->history()->canGoBack()) view->back(); });
    addShortcut(QKeySequence(Qt::ALT | Qt::Key_Right), [this] { if (auto *view = currentView(); view && view->history()->canGoForward()) view->forward(); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_D), [this] { toggleCurrentBookmark(); });
    addShortcut(QKeySequence::ZoomIn, [this] { changeCurrentZoom(0.1); });
    addShortcut(QKeySequence::ZoomOut, [this] { changeCurrentZoom(-0.1); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_0), [this] { setCurrentZoom(1.0); });
    addShortcut(QKeySequence(Qt::Key_F11), [this] { toggleFullScreen(); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_H), [this] { showHistoryMenu(); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_J), [this] { showDownloadsMenu(); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_Comma), [this] { showSettings(); });
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_Tab), [this] {
      const int count = tabBar_->count();
      if (count > 1) tabBar_->setCurrentIndex((tabBar_->currentIndex() + 1) % count);
    });
    addShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Tab), [this] {
      const int count = tabBar_->count();
      if (count > 1) tabBar_->setCurrentIndex((tabBar_->currentIndex() + count - 1) % count);
    });
    for (int number = 1; number <= 8; ++number) {
      addShortcut(QKeySequence(Qt::CTRL | (Qt::Key_0 + number)), [this, number] {
        if (number - 1 < tabBar_->count()) tabBar_->setCurrentIndex(number - 1);
      });
    }
    addShortcut(QKeySequence(Qt::CTRL | Qt::Key_9), [this] {
      if (tabBar_->count() > 0) tabBar_->setCurrentIndex(tabBar_->count() - 1);
    });
  }

  void addNewTab(const QUrl &url = {}, const QString &title = QStringLiteral("Yeni Sekme")) {
    if (!url.isEmpty() && !policy_->allowsNavigation(url)) return;
    auto *view = new QWebEngineView;
    view->setPage(createBrowserPage(view));
    adoptView(view, title);
    if (url.isEmpty()) {
      loadNewTabPage(view);
      return;
    }
    view->load(url);
  }

  void showSettings(SettingsPage::Category category = SettingsPage::Category::Startup) {
    const auto existingId = tabManager_->findInternal(this, QStringLiteral("settings"));
    if (!existingId.isNull()) {
      const TabManager::TabRecord *record = tabManager_->record(existingId);
      const int index = record && record->content ? pages_->indexOf(record->content) : -1;
      if (index >= 0) {
        if (auto *settings = qobject_cast<SettingsPage *>(record->content.data())) settings->setCategory(category);
        tabBar_->setCurrentIndex(index);
        return;
      }
    }
    SettingsPage::Hooks hooks;
    hooks.searchEngine = [this] { return searchEngine_->currentText(); };
    hooks.setSearchEngine = [this](const QString &engine) { searchEngine_->setCurrentText(engine); };
    hooks.syncNewTabs = [this] {
      lastSuggestionKey_.clear();
      for (int index = 0; index < pages_->count(); ++index) {
        if (auto *view = qobject_cast<QWebEngineView *>(pages_->widget(index)); view && isNewTabUrl(view->url())) {
          const QString suggestionValue = QSettings().value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool() ? QStringLiteral("enabled") : QStringLiteral("disabled");
          view->page()->runJavaScript(QStringLiteral("localStorage.setItem('ardali.searchSuggestions','%1');window.dispatchEvent(new Event('ardali-settings-search-suggestions')); location.reload();").arg(suggestionValue));
        }
      }
    };
    hooks.refreshBookmarks = [this] { renderBookmarks(); };
    auto *page = new SettingsPage(profileService_, std::move(hooks));
    page->setCategory(category);
    connect(page, &SettingsPage::navigateRequested, this, [this](const QUrl &url) { addNewTab(url, url.host()); });
    const TabManager::TabCapabilities capabilities{true, true, false, false};
    const auto id = tabManager_->registerInternalTab(page, this, QStringLiteral("Ayarlar"), QStringLiteral("settings"), capabilities);
    if (id.isNull()) { page->deleteLater(); return; }
    const int index = insertRegisteredTab(page, id, QStringLiteral("Ayarlar"));
    if (index < 0) { tabManager_->remove(id); page->deleteLater(); return; }
    tabBar_->setTabIcon(index, BrowserIcons::icon(BrowserIcon::Settings));
    tabBar_->setTabToolTip(index, QStringLiteral("ardali://settings"));
  }

  void showMainMenu() {
    QMenu menu(this);
    menu.setStyleSheet(QStringLiteral("QMenu{background:#1b232d;color:#e8eef5;border:1px solid #3a4857;border-radius:9px;padding:6px;} QMenu::item{min-height:25px;padding:5px 30px 5px 30px;border-radius:6px;} QMenu::item:selected{background:#2b3947;} QMenu::item:disabled{color:#6f7b87;} QMenu::separator{height:1px;background:#33404d;margin:6px 8px;} QMenu::icon{padding-left:7px;}"));
    QAction *newTab = menu.addAction(BrowserIcons::icon(BrowserIcon::NewTab), QStringLiteral("Yeni sekme"));
    QAction *newWindow = menu.addAction(BrowserIcons::icon(BrowserIcon::Window), QStringLiteral("Yeni pencere"));
    QAction *incognito = menu.addAction(BrowserIcons::icon(BrowserIcon::Incognito), QStringLiteral("Yeni gizli pencere"));
    incognito->setEnabled(false);
    incognito->setToolTip(QStringLiteral("Gizli profil desteği henüz mevcut değil."));
    menu.addSeparator();
    QAction *passwords = menu.addAction(BrowserIcons::icon(BrowserIcon::Password), QStringLiteral("Şifreler ve otomatik doldurma"));
    passwords->setEnabled(false); // TODO: Integrate ArDali Password Manager.
    QAction *history = menu.addAction(BrowserIcons::icon(BrowserIcon::History), QStringLiteral("Geçmiş"));
    QAction *bookmarks = menu.addAction(BrowserIcons::icon(BrowserIcon::Bookmark), QStringLiteral("Yer işaretleri"));
    QAction *downloads = menu.addAction(BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("İndirilenler"));
    menu.addSeparator();
    QMenu *zoom = menu.addMenu(BrowserIcons::icon(BrowserIcon::Zoom), QStringLiteral("Yakınlaştır"));
    QAction *zoomOut = zoom->addAction(QStringLiteral("−"));
    QAction *zoomReset = zoom->addAction(QStringLiteral("%%1").arg(currentView() ? qRound(currentView()->zoomFactor() * 100.0) : 100));
    QAction *zoomIn = zoom->addAction(QStringLiteral("+"));
    const bool hasWebContent = currentView() != nullptr;
    zoomOut->setEnabled(hasWebContent);
    zoomReset->setEnabled(hasWebContent);
    zoomIn->setEnabled(hasWebContent);
    menu.addSeparator();
    QAction *print = menu.addAction(BrowserIcons::icon(BrowserIcon::Print), QStringLiteral("Yazdır")); print->setEnabled(false);
    QAction *find = menu.addAction(BrowserIcons::icon(BrowserIcon::Search), QStringLiteral("Bul ve düzenle")); find->setEnabled(false);
    QAction *save = menu.addAction(BrowserIcons::icon(BrowserIcon::Save), QStringLiteral("Kaydet ve paylaş")); save->setEnabled(false);
    QAction *tools = menu.addAction(BrowserIcons::icon(BrowserIcon::Tools), QStringLiteral("Diğer araçlar")); tools->setEnabled(false);
    menu.addSeparator();
    QAction *help = menu.addAction(BrowserIcons::icon(BrowserIcon::Help), QStringLiteral("Yardım")); help->setEnabled(false);
    QAction *settings = menu.addAction(BrowserIcons::icon(BrowserIcon::Settings), QStringLiteral("Ayarlar"));
    QAction *quit = menu.addAction(BrowserIcons::icon(BrowserIcon::Exit), QStringLiteral("Çıkış"));
    connect(newTab, &QAction::triggered, this, [this] { addNewTab(); });
    connect(newWindow, &QAction::triggered, this, [this] { auto *window = new BrowserWindow(profile_, profileService_, tabManager_, policy_, nullptr, nullptr, true); window->setAttribute(Qt::WA_DeleteOnClose); window->show(); });
    connect(history, &QAction::triggered, this, &BrowserWindow::showHistoryMenu);
    connect(bookmarks, &QAction::triggered, this, [this] { showSettings(SettingsPage::Category::Bookmarks); });
    connect(downloads, &QAction::triggered, this, &BrowserWindow::showDownloadsMenu);
    connect(zoomOut, &QAction::triggered, this, [this] { changeCurrentZoom(-0.1); });
    connect(zoomReset, &QAction::triggered, this, [this] { setCurrentZoom(1.0); });
    connect(zoomIn, &QAction::triggered, this, [this] { changeCurrentZoom(0.1); });
    connect(settings, &QAction::triggered, this, [this] { showSettings(); });
    connect(quit, &QAction::triggered, qApp, &QCoreApplication::quit);
    menu.exec(QCursor::pos());
  }

  QWebEnginePage *createBrowserPage(QWebEngineView *view) {
    return new BrowserPage(profile_, policy_, profileService_, [this](QWebEnginePage::WebWindowType type) {
      return createPopupTabPage(type);
    }, view);
  }

  QWebEnginePage *createPopupTabPage(QWebEnginePage::WebWindowType type) {
    if (type != QWebEnginePage::WebBrowserTab && type != QWebEnginePage::WebBrowserBackgroundTab) return nullptr;
    BrowserWindow *const target = mainWindow_ ? mainWindow_.data() : this;
    if (!target) return nullptr;
    const int previousIndex = target->tabBar_->currentIndex();
    auto *view = new QWebEngineView;
    view->setPage(target->createBrowserPage(view));
    target->adoptView(view, QStringLiteral("Yeni Sekme"));
    if (type == QWebEnginePage::WebBrowserBackgroundTab && previousIndex >= 0) {
      target->tabBar_->setCurrentIndex(previousIndex);
    }
    return view->page();
  }

  void loadNewTabPage(QWebEngineView *view) {
    if (!view) return;
    QUrl newTabUrl(QStringLiteral("ardali://newtab/"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("engine"), searchEngine_->currentText());
    newTabUrl.setQuery(query);
    view->load(newTabUrl);
  }

  void navigateCurrent(const QUrl &url) {
    if (url.isEmpty() || !policy_->allowsNavigation(url)) return;
    if (auto *view = currentView()) view->load(url);
  }

  void setCurrentZoom(qreal factor) {
    if (auto *view = currentView()) {
      view->setZoomFactor(std::clamp(factor, 0.25, 5.0));
      updateZoomControls();
    }
  }

  void changeCurrentZoom(qreal delta) {
    if (auto *view = currentView()) setCurrentZoom(view->zoomFactor() + delta);
  }

  QString newTabSuggestionScript() const {
    QJsonArray entries;
    const auto add = [&entries](const QString &section, const QString &kind, const QString &title, const QUrl &url) {
      if (!url.isValid()) return;
      entries.append(QJsonObject{{QStringLiteral("section"), section}, {QStringLiteral("kind"), kind},
                                 {QStringLiteral("title"), title}, {QStringLiteral("url"), url.toString(QUrl::FullyEncoded)}});
    };
    add(QStringLiteral("HIZLI SİTELER"), QStringLiteral("shortcut"), QStringLiteral("YouTube"), QUrl(QStringLiteral("https://www.youtube.com/")));
    add(QStringLiteral("HIZLI SİTELER"), QStringLiteral("shortcut"), QStringLiteral("GitHub"), QUrl(QStringLiteral("https://github.com/")));
    add(QStringLiteral("HIZLI SİTELER"), QStringLiteral("shortcut"), QStringLiteral("Wikipedia"), QUrl(QStringLiteral("https://www.wikipedia.org/")));
    if (profileService_) {
      for (const QUrl &url : profileService_->bookmarks()) add(QStringLiteral("YER İMLERİ"), QStringLiteral("bookmark"), bookmarkDisplayName(url), url);
      for (const BrowserHistoryEntry &entry : profileService_->recentHistory()) add(QStringLiteral("GEÇMİŞ"), QStringLiteral("history"), entry.title, entry.url);
    }
    QString json = QString::fromUtf8(QJsonDocument(entries).toJson(QJsonDocument::Compact));
    json.replace(QLatin1Char('<'), QStringLiteral("\\u003c"));
    json.replace(QLatin1Char('>'), QStringLiteral("\\u003e"));
    json.replace(QLatin1Char('&'), QStringLiteral("\\u0026"));
    QSettings settings;
    const QString savedPreference = settings.contains(QStringLiteral("browser/searchSuggestionsEnabled"))
        ? (settings.value(QStringLiteral("browser/searchSuggestionsEnabled")).toBool() ? QStringLiteral("\"enabled\"") : QStringLiteral("\"disabled\""))
        : QStringLiteral("null");
    return QStringLiteral(R"JS(
      (() => {
        if (document.getElementById('ardali-native-suggestions')) return;
        const entries = %1;
        const input = document.getElementById('query');
        const form = document.getElementById('search');
        if (!input || !form) return;
        const style = document.createElement('style');
        style.textContent = '.search{width:min(470px,100%);margin-inline:auto;transform:translateY(0) scale(1);transform-origin:center;transition:width .26s cubic-bezier(.2,.8,.2,1),transform .26s cubic-bezier(.2,.8,.2,1),box-shadow .22s ease}.search:focus-within{box-shadow:0 18px 48px #0009}.module,.cards{transition:opacity .18s ease,transform .24s cubic-bezier(.2,.8,.2,1),visibility 0s linear .24s}body.ardali-search-focused .search{width:100%;transform:translateY(clamp(54px,8vh,88px)) scale(1.015)}body.ardali-search-focused .module,body.ardali-search-focused .cards{opacity:0;transform:translateY(28px) scale(.97);visibility:hidden;pointer-events:none}.ardali-suggestions{position:absolute;top:59px;left:0;right:0;z-index:6;overflow:hidden;border:1px solid #40516a;border-radius:15px;background:#101722f5;box-shadow:0 15px 35px #000a;text-align:left}.ardali-suggestions[hidden]{display:none}.ardali-consent{padding:17px 18px;background:linear-gradient(135deg,#3020a2,#25127f);color:#fff}.ardali-consent-title{font-size:15px;font-weight:700}.ardali-consent-copy{margin:10px 0 14px;color:#e2ddff;font-size:13px;line-height:1.4}.ardali-consent-actions{display:flex;align-items:center;gap:12px}.ardali-consent button{border:0;border-radius:20px;padding:10px 17px;font-weight:700;cursor:pointer}.ardali-consent-enable{background:#c9c7ff;color:#24186f}.ardali-consent-decline{background:transparent;color:#fff}.ardali-suggestion{display:flex;align-items:center;width:100%;min-height:52px;border:0;background:transparent;color:#fff;padding:8px 15px;text-align:left;cursor:pointer}.ardali-suggestion:hover,.ardali-suggestion:focus{background:#26364a;outline:0}.ardali-suggestion-icon{width:34px;height:34px;margin-right:12px;border-radius:8px;object-fit:contain;background:#fff}.ardali-suggestion-copy{flex:1;min-width:0}.ardali-suggestion-title,.ardali-suggestion-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ardali-suggestion-title{font-size:15px}.ardali-suggestion-detail{margin-top:3px;color:#bac5d7;font-size:12px}@media(max-width:620px){.search{width:min(88vw,470px)}body.ardali-search-focused .search{width:100%;transform:translateY(42px)}.ardali-consent-actions{align-items:flex-start;flex-direction:column}}';
        document.head.appendChild(style);
        const panel = document.createElement('div');
        panel.id = 'ardali-native-suggestions';
        panel.className = 'ardali-suggestions';
        panel.hidden = true;
        form.appendChild(panel);
        const savedSuggestionPreference=%2;
        if(savedSuggestionPreference!==null)localStorage.setItem('ardali.searchSuggestions',savedSuggestionPreference);
        let remoteSuggestions = Array.isArray(window.ardaliRemoteSuggestions) ? window.ardaliRemoteSuggestions : [];
        window.ardaliSuggestionIcons=window.ardaliSuggestionIcons||{};
        let suggestionConsent = localStorage.getItem('ardali.searchSuggestions');
        const navigate = value => { location.href = value; };
        const bases = {Google:'https://www.google.com/search?q=',DuckDuckGo:'https://duckduckgo.com/?q=','Brave Search':'https://search.brave.com/search?q=',Bing:'https://www.bing.com/search?q='};
        const search = value => navigate(bases[document.getElementById('engine').value] + encodeURIComponent(value));
        const siteCatalog = [
          ['ebay','ebay.com','eBay'],['youtube','youtube.com','YouTube'],['github','github.com','GitHub'],['wikipedia','wikipedia.org','Wikipedia'],
          ['hotmail','outlook.com','Outlook.com · Microsoft web tabanlı e-posta hizmeti'],['outlook','outlook.com','Outlook.com · Microsoft web tabanlı e-posta hizmeti'],
          ['home depot','homedepot.com','Ev geliştirme ve yapı ürünleri'],['hbo','hbo.com','Film ve televizyon ağı'],['reddit','reddit.com','Reddit']
        ];
        const siteMeta = value => { const folded=value.toLocaleLowerCase('tr-TR'); const match=siteCatalog.find(item=>folded===item[0]||folded.startsWith(item[0]+' ')); return match?{domain:match[1],detail:match[2]}:null; };
        const historyQueries = [...new Set(entries.filter(item=>item.kind==='history').map(item=>{try{const url=new URL(item.url);return url.searchParams.get('q')||url.searchParams.get('query')||''}catch{return''}}).filter(Boolean))];
        const appendSuggestion = (value, detail, history=false) => {
          const button=document.createElement('button'); button.type='button'; button.className='ardali-suggestion';
          const meta=siteMeta(value);
          if(meta&&suggestionConsent==='enabled'&&window.ardaliSuggestionIcons[meta.domain]){const icon=document.createElement('img');icon.className='ardali-suggestion-icon';icon.alt='';icon.src=window.ardaliSuggestionIcons[meta.domain];button.appendChild(icon)}
          const copy=document.createElement('span');copy.className='ardali-suggestion-copy';
          const title=document.createElement('div');title.className='ardali-suggestion-title';title.textContent=value;
          const sub=document.createElement('div');sub.className='ardali-suggestion-detail';sub.textContent=meta?meta.detail:(history?'Önceki arama':document.getElementById('engine').value+' ile ara');
          copy.append(title,sub);button.append(copy);button.onclick=()=>search(value);panel.appendChild(button);
        };
        const render = () => {
          const query = input.value.trim().toLocaleLowerCase('tr-TR');
          panel.replaceChildren();
          if (!query) { panel.hidden = true; return; }
          if (!suggestionConsent) {
            const consent=document.createElement('section');consent.className='ardali-consent';
            consent.innerHTML='<div class="ardali-consent-title">Arama önerileri etkinleştirilsin mi?</div><div class="ardali-consent-copy">Arama yaptığınızda yazdıklarınız daha iyi öneriler için seçili arama motorunuza gönderilecektir.</div><div class="ardali-consent-actions"><button class="ardali-consent-enable" type="button">Etkinleştir</button><button class="ardali-consent-decline" type="button">Hayır, teşekkürler</button></div>';
            consent.querySelector('.ardali-consent-enable').onclick=()=>{suggestionConsent='enabled';localStorage.setItem('ardali.searchSuggestions','enabled');window.dispatchEvent(new Event('ardali-suggestion-consent-changed'));render()};
            consent.querySelector('.ardali-consent-decline').onclick=()=>{suggestionConsent='disabled';localStorage.setItem('ardali.searchSuggestions','disabled');remoteSuggestions=[];window.dispatchEvent(new Event('ardali-suggestion-consent-changed'));render()};
            panel.appendChild(consent);
          }
          appendSuggestion(input.value.trim(), document.getElementById('engine').value+' ile ara');
          if (suggestionConsent==='enabled') {
            const merged=[];
            for(const value of historyQueries.filter(value=>value.toLocaleLowerCase('tr-TR').startsWith(query)))if(!merged.includes(value))merged.push(value);
            for(const value of remoteSuggestions)if(!merged.includes(value)&&value.toLocaleLowerCase('tr-TR')!==query)merged.push(value);
            for(const value of merged.slice(0,7))appendSuggestion(value,'',historyQueries.includes(value));
            }
          panel.hidden = false;
        };
        window.addEventListener('ardali-remote-suggestions', () => { remoteSuggestions = Array.isArray(window.ardaliRemoteSuggestions) ? window.ardaliRemoteSuggestions : []; render(); });
        window.addEventListener('ardali-suggestion-icons',render);
        window.addEventListener('ardali-settings-search-suggestions',()=>{suggestionConsent=localStorage.getItem('ardali.searchSuggestions');remoteSuggestions=[];render()});
        const enterSearchMode = () => { document.body.classList.add('ardali-search-focused'); render(); };
        const leaveSearchMode = () => { document.body.classList.remove('ardali-search-focused'); panel.hidden = true; };
        input.addEventListener('input', render); input.addEventListener('focus', enterSearchMode);
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); input.blur(); leaveSearchMode(); return; }
          if (event.key !== 'Enter') return;
          event.preventDefault(); event.stopImmediatePropagation();
          const value = input.value.trim();
          if (value) search(value);
        }, true);
        form.addEventListener('submit', event => {
          event.preventDefault(); event.stopImmediatePropagation();
          const value = input.value.trim();
          if (value) search(value);
        }, true);
        document.getElementById('engine').addEventListener('change', () => { remoteSuggestions = []; render(); });
        document.addEventListener('pointerdown', event => { if (!form.contains(event.target)) leaveSearchMode(); });
        render();
      })();
    )JS").arg(json, savedPreference);
  }

  void syncFrequentSites(QWebEngineView *view) {
    if (!view || !view->page() || !profileService_ || !profile_ || !isNewTabUrl(view->url())) return;
    QSettings settings;
    const QStringList hiddenSites = settings.value(QStringLiteral("browser/hiddenFrequentSites")).toStringList();
    QList<BrowserFrequentSite> sites;
    for (const BrowserFrequentSite &site : profileService_->frequentSites(100)) {
      const QString siteUrl = site.url.toString(QUrl::FullyEncoded);
      if (hiddenSites.contains(siteUrl)) continue;
      sites.append(site);
      if (sites.size() >= 6) break;
    }
    QJsonArray frequentValues;
    for (const BrowserFrequentSite &site : sites) {
      const QString name = frequentSiteDisplayName(site.url);
      frequentValues.append(QJsonObject{{QStringLiteral("name"), name},
                                {QStringLiteral("title"), site.title},
                                {QStringLiteral("url"), site.url.toString(QUrl::FullyEncoded)},
                                {QStringLiteral("visitCount"), site.visitCount}});
    }
    QJsonArray bookmarkValues;
    QList<QUrl> bookmarkSites;
    for (const QUrl &url : profileService_->bookmarks()) {
      bookmarkSites.append(url);
      bookmarkValues.append(QJsonObject{{QStringLiteral("name"), bookmarkDisplayName(url)},
                                        {QStringLiteral("title"), url.toDisplayString()},
                                        {QStringLiteral("url"), url.toString(QUrl::FullyEncoded)}});
      if (bookmarkSites.size() >= 6) break;
    }
    QJsonArray hiddenValues;
    for (const QString &hidden : hiddenSites) hiddenValues.append(hidden);
    NewTabBackgroundStore *const backgrounds = profileService_->newTabBackgroundStore();
    const bool managedBackgroundAvailable = backgrounds && backgrounds->hasValidManagedImage();
    QString backgroundSource = settings.value(QStringLiteral("browser/newTabBackgroundSource"), QStringLiteral("builtin")).toString();
    if (backgroundSource == QLatin1String("custom") && !managedBackgroundAvailable) {
      backgroundSource = QStringLiteral("builtin");
      settings.setValue(QStringLiteral("browser/newTabBackgroundSource"), backgroundSource);
    }
    const QJsonObject config{{QStringLiteral("visible"), settings.value(QStringLiteral("browser/showFrequentSites"), true).toBool()},
                             {QStringLiteral("panelOpacity"), std::clamp(settings.value(QStringLiteral("browser/frequentSitesPanelOpacity"), 72).toInt(), 0, 100)},
                             {QStringLiteral("iconOpacity"), std::clamp(settings.value(QStringLiteral("browser/frequentSitesIconOpacity"), 82).toInt(), 0, 100)},
                             {QStringLiteral("hiddenSites"), hiddenValues},
                             {QStringLiteral("backgroundVisible"), settings.value(QStringLiteral("browser/newTabBackgroundVisible"), true).toBool()},
                             {QStringLiteral("backgroundSource"), backgroundSource},
                             {QStringLiteral("managedBackgroundAvailable"), managedBackgroundAvailable},
                             {QStringLiteral("searchVisible"), settings.value(QStringLiteral("browser/newTabSearchVisible"), true).toBool()},
                             {QStringLiteral("topSitesSource"), settings.value(QStringLiteral("browser/newTabTopSitesSource"), QStringLiteral("frequent")).toString()},
                             {QStringLiteral("clockFormat"), settings.value(QStringLiteral("browser/newTabClockFormat"), QStringLiteral("auto")).toString()},
                             {QStringLiteral("theme"), settings.value(QStringLiteral("browser/newTabTheme"), QStringLiteral("flow")).toString()},
                             {QStringLiteral("dim"), std::clamp(settings.value(QStringLiteral("browser/newTabDim"), 38).toInt(), 0, 80)},
                             {QStringLiteral("clock"), settings.value(QStringLiteral("browser/newTabShowClock"), true).toBool()},
                             {QStringLiteral("date"), settings.value(QStringLiteral("browser/newTabShowDate"), true).toBool()},
                             {QStringLiteral("cards"), settings.value(QStringLiteral("browser/newTabShowCards"), true).toBool()}};
    const QJsonObject sources{{QStringLiteral("frequent"), frequentValues}, {QStringLiteral("bookmarks"), bookmarkValues}};
    const QJsonObject cards{{QStringLiteral("downloads"), profileService_->recentDownloads().size()},
                            {QStringLiteral("protection"), profileService_->stripsTrackingParameters()}};
    auto safeJson = [](const QJsonDocument &document) {
      QString json = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
      json.replace(QLatin1Char('<'), QStringLiteral("\\u003c"));
      json.replace(QLatin1Char('>'), QStringLiteral("\\u003e"));
      json.replace(QLatin1Char('&'), QStringLiteral("\\u0026"));
      return json;
    };
    const QString sourcesJson = safeJson(QJsonDocument(sources));
    const QString configJson = safeJson(QJsonDocument(config));
    const QString cardsJson = safeJson(QJsonDocument(cards));
    view->page()->runJavaScript(QStringLiteral(
        "window.ardaliFrequentSiteConfig=%2;window.ardaliTopSiteSources=%1;window.ardaliFrequentSites=window.ardaliTopSiteSources.frequent;"
        "window.ardaliCardData=%3;window.ardaliFrequentSiteIcons={};"
        "window.dispatchEvent(new Event('ardali-frequent-sites'));"
    ).arg(sourcesJson, configJson, cardsJson));

    QList<QPair<QUrl, QUrl>> iconRequests;
    for (const BrowserFrequentSite &site : sites)
      iconRequests.append({site.url, site.iconLookupUrl});
    for (const QUrl &url : bookmarkSites) iconRequests.append({url, url});
    for (const auto &[site, lookup] : iconRequests) {
      const QString siteUrl = site.toString(QUrl::FullyEncoded);
      profile_->requestIconForPageURL(lookup, 64,
          [guardedView = QPointer<QWebEngineView>(view), siteUrl](const QIcon &icon, const QUrl &, const QUrl &) {
            if (!guardedView || !guardedView->page() || !isNewTabUrl(guardedView->url()) || icon.isNull()) return;
            const QPixmap pixmap = icon.pixmap(64, 64);
            if (pixmap.isNull()) return;
            QByteArray bytes;
            QBuffer buffer(&bytes);
            if (!buffer.open(QIODevice::WriteOnly) || !pixmap.save(&buffer, "PNG")) return;
            const QJsonObject payload{{QStringLiteral("url"), siteUrl},
                                      {QStringLiteral("data"), QStringLiteral("data:image/png;base64,%1").arg(QString::fromLatin1(bytes.toBase64()))}};
            QString payloadJson = QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact));
            payloadJson.replace(QLatin1Char('<'), QStringLiteral("\\u003c"));
            payloadJson.replace(QLatin1Char('>'), QStringLiteral("\\u003e"));
            payloadJson.replace(QLatin1Char('&'), QStringLiteral("\\u0026"));
            guardedView->page()->runJavaScript(QStringLiteral(
                "(()=>{const item=%1;window.ardaliFrequentSiteIcons=window.ardaliFrequentSiteIcons||{};"
                "window.ardaliFrequentSiteIcons[item.url]=item.data;"
                "window.dispatchEvent(new Event('ardali-frequent-site-icons'));})()"
            ).arg(payloadJson));
          });
    }
  }

  void syncAllNewTabFrequentSites() {
    for (int index = 0; index < pages_->count(); ++index) {
      if (auto *view = qobject_cast<QWebEngineView *>(pages_->widget(index)); view && isNewTabUrl(view->url())) syncFrequentSites(view);
    }
  }

  void persistFrequentSiteSettings(QWebEngineView *view, const QString &serializedSettings) {
    const QJsonDocument document = QJsonDocument::fromJson(serializedSettings.toUtf8());
    if (!document.isObject()) return;
    const QJsonObject object = document.object();
    QSettings settings;
    const bool visible = object.value(QStringLiteral("shortcuts")).toBool(true);
    const int panelOpacity = std::clamp(object.value(QStringLiteral("frequentPanelOpacity")).toInt(72), 0, 100);
    const int iconOpacity = std::clamp(object.value(QStringLiteral("frequentIconOpacity")).toInt(82), 0, 100);
    const bool backgroundVisible = object.value(QStringLiteral("backgroundVisible")).toBool(true);
    const bool searchVisible = object.value(QStringLiteral("searchVisible")).toBool(true);
    const QString backgroundSource = object.value(QStringLiteral("backgroundSource")).toString() == QLatin1String("custom")
        ? QStringLiteral("custom") : QStringLiteral("builtin");
    const QString topSitesSource = object.value(QStringLiteral("topSitesSource")).toString() == QLatin1String("bookmarks")
        ? QStringLiteral("bookmarks") : QStringLiteral("frequent");
    QString clockFormat = object.value(QStringLiteral("clockFormat")).toString();
    if (clockFormat != QLatin1String("12") && clockFormat != QLatin1String("24")) clockFormat = QStringLiteral("auto");
    QStringList hiddenSites;
    for (const QJsonValue &value : object.value(QStringLiteral("hiddenFrequentSites")).toArray()) {
      const QUrl url(value.toString());
      if (url.isValid() && (url.scheme() == QLatin1String("http") || url.scheme() == QLatin1String("https"))) {
        hiddenSites.append(url.toString(QUrl::FullyEncoded));
      }
    }
    hiddenSites.removeDuplicates();
    const bool dataViewChanged = settings.value(QStringLiteral("browser/hiddenFrequentSites")).toStringList() != hiddenSites
        || settings.value(QStringLiteral("browser/newTabTopSitesSource"), QStringLiteral("frequent")).toString() != topSitesSource;
    settings.setValue(QStringLiteral("browser/showFrequentSites"), visible);
    settings.setValue(QStringLiteral("browser/frequentSitesPanelOpacity"), panelOpacity);
    settings.setValue(QStringLiteral("browser/frequentSitesIconOpacity"), iconOpacity);
    settings.setValue(QStringLiteral("browser/hiddenFrequentSites"), hiddenSites);
    settings.setValue(QStringLiteral("browser/newTabBackgroundVisible"), backgroundVisible);
    settings.setValue(QStringLiteral("browser/newTabBackgroundSource"), backgroundSource);
    settings.setValue(QStringLiteral("browser/newTabSearchVisible"), searchVisible);
    settings.setValue(QStringLiteral("browser/newTabTopSitesSource"), topSitesSource);
    settings.setValue(QStringLiteral("browser/newTabClockFormat"), clockFormat);
    settings.setValue(QStringLiteral("browser/newTabTheme"), object.value(QStringLiteral("theme")).toString() == QLatin1String("plain") ? QStringLiteral("plain") : QStringLiteral("flow"));
    settings.setValue(QStringLiteral("browser/newTabDim"), std::clamp(object.value(QStringLiteral("dim")).toInt(38), 0, 80));
    settings.setValue(QStringLiteral("browser/newTabShowClock"), object.value(QStringLiteral("clock")).toBool(true));
    settings.setValue(QStringLiteral("browser/newTabShowDate"), object.value(QStringLiteral("date")).toBool(true));
    settings.setValue(QStringLiteral("browser/newTabShowCards"), object.value(QStringLiteral("cards")).toBool(true));
    if (dataViewChanged && view) syncFrequentSites(view);
  }

  void pollNewTabSuggestionQuery() {
    QWebEngineView *const view = currentView();
    if (!view || !isNewTabUrl(view->url()) || !view->page()) return;
    view->page()->runJavaScript(QStringLiteral("(() => { const input = document.getElementById('query'); const engine = document.getElementById('engine'); const command=window.ardaliNewTabCommand||null;window.ardaliNewTabCommand=null;return input && engine ? JSON.stringify({query:input.value.trim(), engine:engine.value, consent:localStorage.getItem('ardali.searchSuggestions')||'', newTabSettings:localStorage.getItem('ardali.newtab')||'',command}) : ''; })()"),
        [this, guardedView = QPointer<QWebEngineView>(view)](const QVariant &value) {
          if (!guardedView || guardedView != currentView() || !isNewTabUrl(guardedView->url())) return;
          const QJsonDocument document = QJsonDocument::fromJson(value.toString().toUtf8());
          if (!document.isObject()) return;
          const QJsonObject query = document.object();
          persistFrequentSiteSettings(guardedView, query.value(QStringLiteral("newTabSettings")).toString());
          const QJsonObject command = query.value(QStringLiteral("command")).toObject();
          if (!command.isEmpty()) handleNewTabBackgroundCommand(guardedView, command.value(QStringLiteral("type")).toString());
          const QString engine = query.value(QStringLiteral("engine")).toString();
          if (searchEngine_->findText(engine) >= 0 && searchEngine_->currentText() != engine) searchEngine_->setCurrentText(engine);
          requestRemoteSuggestions(guardedView, query.value(QStringLiteral("query")).toString(), engine,
                                   query.value(QStringLiteral("consent")).toString());
        });
  }

  void handleNewTabBackgroundCommand(QWebEngineView *view, const QString &command) {
    if (!view || view != currentView() || !isNewTabUrl(view->url()) || !profileService_) return;
    NewTabBackgroundStore *const store = profileService_->newTabBackgroundStore();
    if (!store) return;
    bool ok = false;
    QString message;
    if (command == QLatin1String("pickBackground")) {
      const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Yeni sekme arka planı seç"), QString(),
          QStringLiteral("Görseller (*.png *.jpg *.jpeg *.webp)"));
      if (path.isEmpty()) { message = QStringLiteral("Seçim iptal edildi."); }
      else {
        const NewTabBackgroundStore::ImportResult result = store->importImage(path);
        ok = result.ok();
        message = ok ? QStringLiteral("Arka plan güvenli profil kopyasına aktarıldı.") : result.message;
        if (ok) QSettings().setValue(QStringLiteral("browser/newTabBackgroundSource"), QStringLiteral("custom"));
      }
    } else if (command == QLatin1String("removeBackground")) {
      ok = store->removeManagedImage();
      message = ok ? QStringLiteral("Özel arka plan kaldırıldı; ArDali arka planına dönüldü.")
                   : QStringLiteral("Yönetilen arka plan kaldırılamadı.");
      if (ok) QSettings().setValue(QStringLiteral("browser/newTabBackgroundSource"), QStringLiteral("builtin"));
    } else return;
    const QString script = QStringLiteral("window.ardaliBackgroundResult(%1,%2,%3)")
        .arg(ok ? QStringLiteral("true") : QStringLiteral("false"),
             QString::fromUtf8(QJsonDocument(QJsonArray{message}).toJson(QJsonDocument::Compact)).mid(1).chopped(1),
             store->hasValidManagedImage() ? QStringLiteral("true") : QStringLiteral("false"));
    view->page()->runJavaScript(script);
    syncAllNewTabFrequentSites();
  }

  void requestRemoteSuggestions(QWebEngineView *view, const QString &query, const QString &engine, const QString &consent) {
    const bool consentGranted = consent == QLatin1String("enabled");
    if (consentGranted || consent == QLatin1String("disabled")) {
      QSettings().setValue(QStringLiteral("browser/searchSuggestionsEnabled"), consentGranted);
    }
    const QString normalized = query.trimmed();
    const QString key = (consentGranted ? QStringLiteral("enabled\n") : QStringLiteral("disabled\n")) + engine + QLatin1Char('\n') + normalized;
    if (key == lastSuggestionKey_) return;
    lastSuggestionKey_ = key;
    if (suggestionReply_) suggestionReply_->abort();
    clearSuggestionIcons(view);
    if (!consentGranted || normalized.size() < 1 || (engine != QLatin1String("Google") && engine != QLatin1String("DuckDuckGo"))) {
      deliverRemoteSuggestions(view, {});
      return;
    }
    QUrl endpoint(engine == QLatin1String("Google")
        ? QStringLiteral("https://suggestqueries.google.com/complete/search")
        : QStringLiteral("https://duckduckgo.com/ac/"));
    QUrlQuery parameters;
    parameters.addQueryItem(QStringLiteral("q"), normalized);
    if (engine == QLatin1String("Google")) {
      parameters.addQueryItem(QStringLiteral("client"), QStringLiteral("firefox"));
      parameters.addQueryItem(QStringLiteral("hl"), QStringLiteral("tr"));
      parameters.addQueryItem(QStringLiteral("ie"), QStringLiteral("UTF-8"));
      parameters.addQueryItem(QStringLiteral("oe"), QStringLiteral("UTF-8"));
    } else {
      parameters.addQueryItem(QStringLiteral("type"), QStringLiteral("list"));
    }
    endpoint.setQuery(parameters);
    QNetworkRequest request(endpoint);
    request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("ArDaliBrowser/0.1"));
    suggestionReply_ = suggestionNetwork_.get(request);
    connect(suggestionReply_, &QNetworkReply::finished, this, [this, view = QPointer<QWebEngineView>(view), reply = QPointer<QNetworkReply>(suggestionReply_), key, engine] {
      if (!reply) return;
      if (reply == suggestionReply_) suggestionReply_.clear();
      reply->deleteLater();
      if (key != lastSuggestionKey_) return;
      if (reply->error() != QNetworkReply::NoError) {
        qWarning("Search suggestions failed: %s", qPrintable(reply->errorString()));
        deliverRemoteSuggestions(view, {});
        return;
      }
      const QByteArray payload = reply->readAll();
      QJsonParseError parseError;
      const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
      if (parseError.error != QJsonParseError::NoError) {
        qWarning("Search suggestions JSON failed: %s", qPrintable(parseError.errorString()));
        return;
      }
      QStringList values;
      if (engine == QLatin1String("Google") && document.isArray()) {
        const QJsonArray response = document.array();
        if (response.size() > 1) {
          for (const QJsonValue &item : response.at(1).toArray()) if (item.isString()) values.append(item.toString());
        }
      } else if (engine == QLatin1String("DuckDuckGo") && document.isArray()) {
        for (const QJsonValue &item : document.array()) {
          const QString phrase = item.toObject().value(QStringLiteral("phrase")).toString();
          if (!phrase.isEmpty()) values.append(phrase);
        }
      }
      values.removeDuplicates();
      if (values.size() > 6) values = values.first(6);
      deliverRemoteSuggestions(view, values);
    });
  }

  void deliverRemoteSuggestions(QWebEngineView *view, const QStringList &values) {
    if (!view || !view->page() || !isNewTabUrl(view->url())) return;
    QJsonArray array;
    for (const QString &value : values) array.append(value);
    QString json = QString::fromUtf8(QJsonDocument(array).toJson(QJsonDocument::Compact));
    json.replace(QLatin1Char('<'), QStringLiteral("\\u003c"));
    json.replace(QLatin1Char('>'), QStringLiteral("\\u003e"));
    json.replace(QLatin1Char('&'), QStringLiteral("\\u0026"));
    view->page()->runJavaScript(QStringLiteral("window.ardaliRemoteSuggestions=%1;window.dispatchEvent(new Event('ardali-remote-suggestions')); ").arg(json));
    for (const QString &value : values) {
      const QString domain = suggestionDomainFor(value);
      if (!domain.isEmpty()) fetchSuggestionIcon(view, domain);
    }
    syncSuggestionIcons(view);
  }

  void fetchSuggestionIcon(QWebEngineView *view, const QString &domain) {
    if (!view || domain.isEmpty() || suggestionIconData_.contains(domain) || suggestionIconPending_.contains(domain)) return;
    suggestionIconPending_.insert(domain);
    QNetworkRequest request(QUrl(QStringLiteral("https://%1/favicon.ico").arg(domain)));
    request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("Mozilla/5.0 ArDaliBrowser/0.1"));
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    request.setAttribute(QNetworkRequest::CacheSaveControlAttribute, false);
    QNetworkReply *const reply = suggestionNetwork_.get(request);
    suggestionIconReplies_.insert(domain, reply);
    connect(reply, &QNetworkReply::finished, this, [this, view = QPointer<QWebEngineView>(view), reply = QPointer<QNetworkReply>(reply), domain] {
      suggestionIconPending_.remove(domain);
      if (!reply) return;
      if (suggestionIconReplies_.value(domain) == reply) suggestionIconReplies_.remove(domain);
      reply->deleteLater();
      if (reply->error() != QNetworkReply::NoError) {
        qWarning("Suggestion icon failed for %s: %s", qPrintable(domain), qPrintable(reply->errorString()));
        return;
      }
      const QByteArray bytes = reply->readAll();
      if (bytes.isEmpty() || bytes.size() > 1024 * 1024) return;
      if (!QSettings().value(QStringLiteral("browser/searchSuggestionsEnabled"), false).toBool()) return;
      QString mime = reply->header(QNetworkRequest::ContentTypeHeader).toString().section(QLatin1Char(';'), 0, 0).trimmed();
      if (!mime.startsWith(QStringLiteral("image/"))) mime = QStringLiteral("image/x-icon");
      suggestionIconData_.insert(domain, QStringLiteral("data:%1;base64,%2").arg(mime, QString::fromLatin1(bytes.toBase64())));
      syncSuggestionIcons(view);
    });
  }

  void clearSuggestionIcons(QWebEngineView *view = nullptr) {
    const QList<QPointer<QNetworkReply>> replies = suggestionIconReplies_.values();
    suggestionIconReplies_.clear();
    suggestionIconPending_.clear();
    for (const QPointer<QNetworkReply> &reply : replies) {
      if (reply) {
        reply->disconnect(this);
        reply->abort();
        reply->deleteLater();
      }
    }
    suggestionIconData_.clear();
    if (view) syncSuggestionIcons(view);
  }

  void syncSuggestionIcons(QWebEngineView *view) {
    if (!view || !view->page() || !isNewTabUrl(view->url())) return;
    QJsonObject icons;
    for (auto it = suggestionIconData_.constBegin(); it != suggestionIconData_.constEnd(); ++it) icons.insert(it.key(), it.value());
    QString json = QString::fromUtf8(QJsonDocument(icons).toJson(QJsonDocument::Compact));
    json.replace(QLatin1Char('<'), QStringLiteral("\\u003c"));
    json.replace(QLatin1Char('>'), QStringLiteral("\\u003e"));
    json.replace(QLatin1Char('&'), QStringLiteral("\\u0026"));
    view->page()->runJavaScript(QStringLiteral("window.ardaliSuggestionIcons=%1;window.dispatchEvent(new Event('ardali-suggestion-icons')); ").arg(json));
  }

  void refreshAddressSuggestions(const QString &input) {
    if (!addressSuggestionModel_ || !addressCompleter_ || !profileService_) return;
    const QString query = input.trimmed();
    addressSuggestionModel_->clear();
    if (query.isEmpty()) {
      addressCompleter_->popup()->hide();
      return;
    }

    const QString folded = query.toCaseFolded();
    QSet<QString> seen;
    int count = 0;
    const auto addSection = [this](const QString &title) {
      auto *item = new QStandardItem(title);
      item->setData(true, SuggestionHeaderRole);
      item->setFlags(Qt::NoItemFlags);
      addressSuggestionModel_->appendRow(item);
    };
    const auto addCandidate = [this, &seen, &count, &folded](const QString &kind, const QString &title, const QUrl &url) {
      if (count >= 15 || !url.isValid()) return;
      const QString encoded = url.toString(QUrl::FullyEncoded);
      if (seen.contains(encoded)) return;
      const QString searchable = (title + QLatin1Char(' ') + url.toDisplayString()).toCaseFolded();
      if (!searchable.contains(folded)) return;
      seen.insert(encoded);
      auto *item = new QStandardItem(title.isEmpty() ? url.host() : title);
      item->setData(url.toString(QUrl::FullyEncoded), SuggestionUrlRole);
      item->setData(kind, SuggestionKindRole);
      item->setData(url.toDisplayString(), SuggestionDetailRole);
      item->setToolTip(url.toDisplayString());
      addressSuggestionModel_->appendRow(item);
      ++count;
    };

    const int initialCount = count;
    addSection(QStringLiteral("YER İMLERİ"));
    for (const QUrl &url : profileService_->bookmarks()) addCandidate(QStringLiteral("bookmark"), bookmarkDisplayName(url), url);
    if (count == initialCount) addressSuggestionModel_->removeRow(addressSuggestionModel_->rowCount() - 1);

    const int bookmarkCount = count;
    addSection(QStringLiteral("GEÇMİŞ"));
    for (const BrowserHistoryEntry &entry : profileService_->recentHistory()) addCandidate(QStringLiteral("history"), entry.title, entry.url);
    if (count == bookmarkCount) addressSuggestionModel_->removeRow(addressSuggestionModel_->rowCount() - 1);

    const QUrl searchUrl(searchUrlFor(searchEngine_->currentText(), query));
    addSection(QStringLiteral("ARAMA"));
    auto *searchItem = new QStandardItem(query);
    searchItem->setData(searchUrl.toString(QUrl::FullyEncoded), SuggestionUrlRole);
    searchItem->setData(QStringLiteral("search"), SuggestionKindRole);
    searchItem->setData(QStringLiteral("%1 ile ara").arg(searchEngine_->currentText()), SuggestionDetailRole);
    searchItem->setToolTip(searchUrl.toDisplayString());
    addressSuggestionModel_->appendRow(searchItem);
    addressCompleter_->setCompletionPrefix(QString());
    addressCompleter_->complete(address_->rect());
  }

  void showHistoryMenu() {
    if (!profileService_) return;
    QMenu menu(this);
    const QList<BrowserHistoryEntry> entries = profileService_->recentHistory();
    if (entries.isEmpty()) {
      QAction *empty = menu.addAction(QStringLiteral("Geçmiş henüz boş"));
      empty->setEnabled(false);
    } else {
      for (const BrowserHistoryEntry &entry : entries.first(std::min<qsizetype>(30, entries.size()))) {
        const QString label = entry.title.isEmpty() ? entry.url.host() : entry.title;
        QAction *action = menu.addAction(label.left(90));
        action->setToolTip(QStringLiteral("%1\n%2").arg(entry.url.toDisplayString(), entry.visitedAt.toLocalTime().toString(QStringLiteral("dd.MM.yyyy HH:mm"))));
        connect(action, &QAction::triggered, this, [this, url = entry.url] { navigateCurrent(url); });
      }
      menu.addSeparator();
      QAction *clear = menu.addAction(QStringLiteral("Geçmişi temizle"));
      connect(clear, &QAction::triggered, this, [this] {
        profileService_->clearHistory();
      });
    }
    menu.exec(QCursor::pos());
  }

  void showDownloadsMenu() {
    if (!profileService_) return;
    QMenu menu(this);
    const QList<BrowserDownloadEntry> entries = profileService_->recentDownloads();
    if (entries.isEmpty()) {
      QAction *empty = menu.addAction(QStringLiteral("Bu oturumda indirme yok"));
      empty->setEnabled(false);
    } else {
      for (const BrowserDownloadEntry &entry : entries.first(std::min<qsizetype>(20, entries.size()))) {
        QAction *action = menu.addAction(QStringLiteral("%1 — %2").arg(entry.fileName.left(65), entry.state));
        action->setEnabled(false);
        action->setToolTip(entry.path);
      }
    }
    menu.exec(QCursor::pos());
  }

  void showSiteInfo() {
    const QUrl url = currentView() ? currentView()->url() : QUrl{};
    if (isNewTabUrl(url) || url.isEmpty()) return;
    const QString scheme = url.scheme().compare(QStringLiteral("https"), Qt::CaseInsensitive) == 0
        ? QStringLiteral("Bağlantı HTTPS ile şifrelenmiş.")
        : QStringLiteral("Bu bağlantı şifrelenmemiş olabilir.");
    QMessageBox::information(this, QStringLiteral("Site bilgisi"),
        QStringLiteral("%1\n\n%2").arg(url.host(), scheme));
  }

  void toggleCurrentBookmark() {
    if (!profileService_ || !currentView()) return;
    const QUrl url = currentView()->url();
    const bool added = profileService_->toggleBookmark(url);
    if (!url.isValid() || isNewTabUrl(url)) return;
    bookmark_->setToolTip(added ? QStringLiteral("Yer imi kaldır") : QStringLiteral("Yer imi ekle"));
    bookmark_->setIcon(bookmarkIcon(added));
    renderBookmarks();
  }

  void renderBookmarks() {
    if (!bookmarkBar_ || !profileService_) return;
    bookmarkBar_->clear();
    for (const QUrl &url : profileService_->bookmarks()) {
      const QString title = bookmarkDisplayName(url);
      QAction *action = bookmarkBar_->addAction(title);
      action->setToolTip(url.toDisplayString());
      if (auto *view = currentView(); view && view->url().adjusted(QUrl::RemoveFragment) == url.adjusted(QUrl::RemoveFragment)
          && !view->icon().isNull()) {
        action->setIcon(view->icon());
      }
      const QPointer<QAction> guardedAction(action);
      profile_->requestIconForPageURL(url, 32, [guardedAction](const QIcon &icon, const QUrl &, const QUrl &) {
        if (guardedAction && !icon.isNull()) guardedAction->setIcon(icon);
      });
      connect(action, &QAction::triggered, this, [this, url] { navigateCurrent(url); });
    }
    bookmarkBar_->setVisible(!bookmarkBar_->actions().isEmpty());
  }

  void syncLoadProgress(QWebEngineView *view) {
    if (!loadProgress_ || !view || view != currentView()) return;
    const bool loading = view->property("ardali-loading").toBool();
    loadProgress_->setVisible(loading);
    if (loading) loadProgress_->setValue(view->property("ardali-load-progress").toInt());
  }

  void setLoadState(QWebEngineView *view, bool loading, int progress) {
    if (!view) return;
    view->setProperty("ardali-loading", loading);
    view->setProperty("ardali-load-progress", progress);
    const int index = pages_->indexOf(view);
    if (index >= 0) {
      const QString status = loading ? QStringLiteral("Yükleniyor…") : view->url().toDisplayString();
      tabBar_->setTabToolTip(index, status);
    }
    syncLoadProgress(view);
  }

  void bindView(QWebEngineView *view) {
    if (!view) return;
    QObject *const previousOwner = qvariant_cast<QObject *>(view->property("ardali-owner"));
    if (previousOwner == this) return;
    if (previousOwner) {
      QObject::disconnect(view, nullptr, previousOwner, nullptr);
      // The zoom signal is emitted by the page rather than the view. Remove
      // that previous-owner receiver too; otherwise every detach/attach cycle
      // leaves one more root-window lambda connected to the same page.
      if (view->page()) QObject::disconnect(view->page(), nullptr, previousOwner, nullptr);
      view->removeEventFilter(previousOwner);
    }
    view->setProperty("ardali-owner", QVariant::fromValue(static_cast<QObject *>(this)));
    view->installEventFilter(this);
    view->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(view, &QWidget::customContextMenuRequested, this, [this, view](const QPoint &position) {
      showWebContextMenu(view, position);
    });
    connect(view, &QWebEngineView::titleChanged, this, [this, view](const QString &title) {
      const int index = pages_->indexOf(view);
      if (index >= 0) tabBar_->setTabText(index, title.left(120));
      tabManager_->updateTitle(tabManager_->idFor(view), title);
      refreshTabStripWidth();
      scheduleSessionSave();
      if (view == currentView()) setWindowTitle(title.isEmpty() ? QStringLiteral("ArDaliBrowser") : title);
    });
    connect(view, &QWebEngineView::urlChanged, this, [this, view](const QUrl &url) {
      tabManager_->updateUrl(tabManager_->idFor(view), url);
      scheduleSessionSave();
      if (view == currentView()) updateChrome();
    });
    connect(view, &QWebEngineView::iconChanged, this, [this, view](const QIcon &icon) {
      const auto id = tabManager_->idFor(view);
      if (!icon.isNull()) {
        tabManager_->updateIcon(id, icon);
      }
      const int index = pages_->indexOf(view);
      if (index >= 0) {
        const TabManager::TabRecord *record = tabManager_->record(id);
        const QIcon displayIcon = (record && !record->icon.isNull())
            ? record->icon
            : (!icon.isNull() ? icon : BrowserIcons::icon(BrowserIcon::Window));
        tabBar_->setTabIcon(index, displayIcon);
      }
    });
    connect(view->page(), &QWebEnginePage::zoomFactorChanged, this, [this, view](qreal) {
      if (view == currentView()) updateZoomControls();
    });
    connect(view, &QWebEngineView::loadStarted, this, [this, view] {
      setLoadState(view, true, 0);
    });
    connect(view, &QWebEngineView::loadProgress, this, [this, view](int progress) {
      setLoadState(view, true, progress);
    });
    connect(view, &QWebEngineView::loadFinished, this, [this, view](bool success) {
      setLoadState(view, false, 100);
      if (success && isNewTabUrl(view->url())) {
        view->page()->runJavaScript(newTabSuggestionScript());
        syncFrequentSites(view);
      }
      if (success && profileService_) profileService_->recordHistory(view->url(), view->title());
      if (view == currentView()) updateChrome();
    });
    connect(view, &QWebEngineView::renderProcessTerminated, this,
            [this, view](QWebEnginePage::RenderProcessTerminationStatus status, int exitCode) {
      const auto id = tabManager_->idFor(view);
      tabManager_->markRendererCrashed(id, static_cast<int>(status), exitCode);
      const int index = pages_->indexOf(view);
      const QString title = tabManager_->record(id)->title;
      if (index >= 0) tabBar_->setTabText(index, QStringLiteral("⚠ %1").arg(title.left(116)));
      if (view == currentView()) setWindowTitle(QStringLiteral("Sekme işlemi sonlandı — ArDaliBrowser"));
      scheduleSessionSave();
    });
    const int index = pages_->indexOf(view);
    if (index >= 0 && !view->icon().isNull()) tabBar_->setTabIcon(index, view->icon());
    syncLoadProgress(view);
  }

  void showWebContextMenu(QWebEngineView *view, const QPoint &position) {
    if (!view || !view->page()) return;
    const QWebEngineContextMenuRequest *const request = view->lastContextMenuRequest();
    if (!request) return;

    QMenu menu(this);
    const QUrl link = request->linkUrl();
    if (link.isValid() && policy_ && policy_->allowsNavigation(link)) {
      const QString openLabel = mainWindow_ ? QStringLiteral("Bağlantıyı ana pencerede yeni sekmede aç")
                                            : QStringLiteral("Bağlantıyı yeni sekmede aç");
      QAction *openLink = menu.addAction(openLabel);
      connect(openLink, &QAction::triggered, this, [this, link] {
        BrowserWindow *const target = mainWindow_ ? mainWindow_.data() : this;
        if (!target) return;
        target->addNewTab(link, link.host().isEmpty() ? QStringLiteral("Yeni Sekme") : link.host());
        target->raise();
        target->activateWindow();
      });
      QAction *copyLink = menu.addAction(QStringLiteral("Bağlantı adresini kopyala"));
      connect(copyLink, &QAction::triggered, this, [link] {
        QGuiApplication::clipboard()->setText(link.toDisplayString(QUrl::FullyDecoded));
      });
      menu.addSeparator();
    }

    QAction *back = menu.addAction(QStringLiteral("Geri"));
    back->setEnabled(view->history()->canGoBack());
    connect(back, &QAction::triggered, view, &QWebEngineView::back);
    QAction *forward = menu.addAction(QStringLiteral("İleri"));
    forward->setEnabled(view->history()->canGoForward());
    connect(forward, &QAction::triggered, view, &QWebEngineView::forward);
    QAction *reload = menu.addAction(QStringLiteral("Yenile"));
    connect(reload, &QAction::triggered, view, &QWebEngineView::reload);

    if (!request->selectedText().isEmpty()) {
      menu.addSeparator();
      QAction *copySelection = menu.addAction(QStringLiteral("Seçili metni kopyala"));
      connect(copySelection, &QAction::triggered, view->page(), [page = view->page()] {
        page->triggerAction(QWebEnginePage::Copy);
      });
    }
    if (request->isContentEditable()) {
      QAction *paste = menu.addAction(QStringLiteral("Yapıştır"));
      connect(paste, &QAction::triggered, view->page(), [page = view->page()] {
        page->triggerAction(QWebEnginePage::Paste);
      });
    }
    menu.exec(view->mapToGlobal(position));
  }

  void updateChrome() {
    if (auto *view = currentView()) {
      address_->setReadOnly(false);
      address_->setText(isNewTabUrl(view->url()) ? QString() : view->url().toDisplayString());
      setWindowTitle(view->title().isEmpty() ? QStringLiteral("ArDaliBrowser") : view->title());
      back_->setEnabled(view->history()->canGoBack());
      forward_->setEnabled(view->history()->canGoForward());
      reload_->setEnabled(true);
      bookmark_->setEnabled(true);
      const bool starred = profileService_ && profileService_->isBookmarked(view->url());
      bookmark_->setToolTip(starred ? QStringLiteral("Yer imi kaldır") : QStringLiteral("Yer imi ekle"));
      bookmark_->setIcon(bookmarkIcon(starred));
      updateZoomControls();
      syncLoadProgress(view);
    } else {
      address_->setReadOnly(true);
      address_->setText(QStringLiteral("ardali://settings"));
      setWindowTitle(QStringLiteral("Ayarlar — ArDaliBrowser"));
      back_->setEnabled(false);
      forward_->setEnabled(false);
      reload_->setEnabled(false);
      bookmark_->setEnabled(false);
      zoomButton_->hide();
      if (zoomPopup_) zoomPopup_->hide();
    }
  }

  void updateZoomControls() {
    if (!zoomButton_ || !zoomPercent_) return;
    const auto *view = currentView();
    const int percent = view ? qRound(view->zoomFactor() * 100.0) : 100;
    zoomPercent_->setText(QStringLiteral("%1%").arg(percent));
    const bool zoomed = percent != 100;
    zoomButton_->setVisible(zoomed);
    positionZoomButton();
    if (zoomed && !zoomWasActive_) showZoomPopup();
    if (!zoomed && zoomPopup_) zoomPopup_->hide();
    zoomWasActive_ = zoomed;
  }

  void showZoomPopup() {
    if (!address_ || !browserRoot_ || !zoomPopup_) return;
    zoomPopup_->adjustSize();
    const QPoint anchor = address_->mapToGlobal(QPoint(address_->width() - 10, address_->height() + 5));
    const QPoint local = browserRoot_->mapFromGlobal(anchor);
    zoomPopup_->move(local.x() - zoomPopup_->width(), local.y());
    zoomPopup_->show();
    zoomPopup_->raise();
  }

  void positionZoomButton() {
    if (!address_ || !zoomButton_) return;
    zoomButton_->move(address_->width() - zoomButton_->width() - 12, -2);
    zoomButton_->raise();
  }

  void refreshTabStripWidth() {
    if (!tabScroll_ || !tabBar_ || !newTabButton_) return;
    constexpr int height = 34;
    // A temporarily tabless hidden root still needs a usable insertion area
    // before + when its detached last tab is dragged home.
    const int emptyRootDropWidth = tabBar_->count() == 0 ? 44 : 1;
    const int tabsWidth = std::max({emptyRootDropWidth, tabBar_->contentWidth(), tabBar_->visualTabsRight(),
                                    dragReorderVisualRight(), draggedTabRight_});
    // The external-drag preview owns no model tab. Reserve its width in the
    // strip itself so the real + button follows the same layout rule as the
    // previewed insertion. The tab bar is covered by a visual-only overlay
    // while that gap is present; no QTabBar/QStackedWidget state changes.
    const int previewWidth = attachPreviewIndex_ >= 0 ? attachPreviewWidth_ : 0;
    const int contentWidth = tabsWidth + previewWidth + newTabButton_->width() + 4;
    tabBar_->setFixedSize(contentWidth, height);
    const QPoint plusPosition = tabBar_->mapTo(tabScroll_->viewport(), QPoint(tabsWidth + previewWidth + 4, 3));
    newTabButton_->move(plusPosition);
    newTabButton_->raise();
    updateDragProxy();
    cacheVisibleTabAttachGeometry();
    if (dragReorderCandidate_ >= 0) renderDragReorderPreview();
    if (attachPreviewIndex_ >= 0) renderAttachPreview();
  }

  void cacheVisibleTabAttachGeometry() {
    if (!isVisible()) return;
    cacheCurrentTabAttachGeometry();
  }

  void cacheCurrentTabAttachGeometry() {
    if (!tabScroll_ || !tabScroll_->viewport() || !tabBar_) return;
    QWidget *const viewport = tabScroll_->viewport();
    lastVisibleTabAttachRect_ = QRect(viewport->mapToGlobal(QPoint(0, 0)), viewport->size());
    lastVisibleTabBarOrigin_ = tabBar_->mapToGlobal(QPoint(0, 0));
  }

  void updateDragProxy() {
    if (!dragTabProxy_ || draggedTabLeft_ < 0 || !tabBar_ || !tabScroll_) return;
    const QPoint position = tabBar_->mapTo(tabScroll_->viewport(), QPoint(draggedTabLeft_, 2));
    dragTabProxy_->move(position);
    dragTabProxy_->raise();
    if (newTabButton_) newTabButton_->raise();
  }

  int dragReorderVisualRight() const {
    int right = 0;
    for (int index = 0; index < dragReorderVisuals_.size(); ++index) {
      const qreal offset = index < dragReorderCurrentOffsets_.size() ? dragReorderCurrentOffsets_[index] : 0.0;
      right = std::max(right, dragReorderVisuals_[index].rect.right() + 1 + qRound(offset));
    }
    return right;
  }

  int dragReorderGapLeftForCandidate(int insertionSlot) const {
    if (dragReorderVisuals_.isEmpty()) return 0;
    const int slot = std::clamp(insertionSlot, 0, static_cast<int>(dragReorderVisuals_.size()));
    if (slot < dragReorderVisuals_.size()) return dragReorderVisuals_[slot].rect.left();
    return dragReorderVisuals_.back().rect.right() + 1;
  }

  void beginDragReorderPreview() {
    clearDragReorderPreview();
    if (!tabScroll_ || !tabBar_ || !newTabButton_ || draggedTabWidth_ <= 0) return;
    QWidget *const viewport = tabScroll_->viewport();
    if (!viewport) return;
    dragReorderVisuals_.reserve(tabBar_->count());
    for (int index = 0; index < tabBar_->count(); ++index) {
      const QRect rect = tabBar_->tabRect(index);
      dragReorderVisuals_.push_back({rect, tabBar_->grab(rect)});
    }
    dragReorderNewTabPixmap_ = newTabButton_->grab();
    dragReorderGapWidth_ = draggedTabWidth_ + 3;
    dragReorderCurrentOffsets_.fill(0.0, dragReorderVisuals_.size());
    dragReorderStartOffsets_ = dragReorderCurrentOffsets_;
    dragReorderTargetOffsets_ = dragReorderCurrentOffsets_;
    if (!dragReorderOverlay_) {
      dragReorderOverlay_ = new QLabel(viewport);
      dragReorderOverlay_->setAttribute(Qt::WA_TransparentForMouseEvents);
      dragReorderOverlay_->setAttribute(Qt::WA_NoSystemBackground);
    }
  }

  void setDragReorderCandidate(int insertionSlot) {
    if (dragReorderVisuals_.isEmpty() && tabBar_ && tabBar_->count() > 0) beginDragReorderPreview();
    if (!tabScroll_ || !tabBar_ || !dragReorderOverlay_ || draggedTabWidth_ <= 0) return;
    const int candidate = std::clamp(insertionSlot, 0, static_cast<int>(dragReorderVisuals_.size()));
    if (candidate == dragReorderCandidate_) return;
    const bool firstCandidate = dragReorderCandidate_ < 0;
    dragReorderAnimation_.stop();
    if (dragReorderCurrentOffsets_.size() != dragReorderVisuals_.size())
      dragReorderCurrentOffsets_.fill(0.0, dragReorderVisuals_.size());
    dragReorderStartOffsets_ = dragReorderCurrentOffsets_;
    dragReorderTargetOffsets_.resize(dragReorderVisuals_.size());
    for (int index = 0; index < dragReorderVisuals_.size(); ++index)
      dragReorderTargetOffsets_[index] = index >= candidate ? dragReorderGapWidth_ : 0.0;
    dragReorderCandidate_ = candidate;
    const qreal targetGap = dragReorderGapLeftForCandidate(candidate);
    if (firstCandidate) {
      dragReorderCurrentOffsets_ = dragReorderTargetOffsets_;
      dragReorderStartOffsets_ = dragReorderTargetOffsets_;
      dragReorderAnimatedGapLeft_ = targetGap;
      dragReorderGapStartLeft_ = targetGap;
      dragReorderGapTargetLeft_ = targetGap;
      refreshTabStripWidth();
      return;
    }
    if (dragReorderAnimatedGapLeft_ < 0.0) dragReorderAnimatedGapLeft_ = targetGap;
    dragReorderGapStartLeft_ = dragReorderAnimatedGapLeft_;
    dragReorderGapTargetLeft_ = targetGap;
    dragReorderAnimation_.setStartValue(0.0);
    dragReorderAnimation_.setEndValue(1.0);
    dragReorderAnimation_.start();
    refreshTabStripWidth();
  }

  void renderDragReorderPreview() {
    if (!dragReorderOverlay_ || !tabScroll_ || !tabBar_ || !newTabButton_ || dragReorderCandidate_ < 0) return;
    QWidget *const viewport = tabScroll_->viewport();
    if (!viewport) return;
    QPixmap preview(viewport->size());
    preview.fill(QColor(32, 33, 36));
    QPainter painter(&preview);
    const QPoint tabOrigin = tabBar_->mapTo(viewport, QPoint(0, 0));
    for (int index = 0; index < dragReorderVisuals_.size(); ++index) {
      const DragReorderVisual &visual = dragReorderVisuals_[index];
      if (visual.pixmap.isNull()) continue;
      const qreal offset = index < dragReorderCurrentOffsets_.size() ? dragReorderCurrentOffsets_[index] : 0.0;
      painter.drawPixmap(tabOrigin + visual.rect.topLeft() + QPoint(qRound(offset), 0), visual.pixmap);
    }
    // The held-tab proxy occupies this visual gap.  Deliberately leave the
    // surrounding strip background untouched; the old WebMedia reorder path
    // never drew a placeholder outline, and a dashed rectangle makes the
    // gap look like a drop target rather than a live tab move.
    if (!dragReorderNewTabPixmap_.isNull()) {
      // refreshTabStripWidth() has already placed the real control after the
      // furthest live/proxy tab.  The overlay covers that control while a
      // reorder is in progress, so composite its snapshot at that *current*
      // viewport position rather than at the static tab-row end.
      painter.drawPixmap(newTabButton_->pos(), dragReorderNewTabPixmap_);
    }
    painter.end();
    dragReorderOverlay_->setPixmap(preview);
    dragReorderOverlay_->setGeometry(viewport->rect());
    dragReorderOverlay_->show();
    dragReorderOverlay_->raise();
    if (dragTabProxy_) dragTabProxy_->raise();
  }

  void clearDragReorderPreview() {
    dragReorderAnimation_.stop();
    if (dragReorderOverlay_) dragReorderOverlay_->hide();
    dragReorderVisuals_.clear();
    dragReorderNewTabPixmap_ = QPixmap();
    dragReorderCurrentOffsets_.clear();
    dragReorderStartOffsets_.clear();
    dragReorderTargetOffsets_.clear();
    dragReorderCandidate_ = -1;
    dragReorderGapWidth_ = 0;
    dragReorderAnimatedGapLeft_ = -1.0;
    dragReorderGapStartLeft_ = -1.0;
    dragReorderGapTargetLeft_ = -1.0;
  }

  void updateTabAutoScroll(const QPoint &screenPosition) {
    const QPoint local = tabScroll_->viewport()->mapFromGlobal(screenPosition);
    constexpr int edge = 32;
    if (local.x() < edge) tabScrollDirection_ = -1;
    else if (local.x() >= tabScroll_->viewport()->width() - edge) tabScrollDirection_ = 1;
    else tabScrollDirection_ = 0;
    if (tabScrollDirection_ && !tabAutoScrollTimer_.isActive()) tabAutoScrollTimer_.start();
    if (!tabScrollDirection_) stopTabAutoScroll();
  }

  void stopTabAutoScroll() {
    tabScrollDirection_ = 0;
    tabAutoScrollTimer_.stop();
  }

  void beginDetachedWindowMove(const QPoint &pointerOffsetInWindow = QPoint(-1, -1), bool requireTargetExit = false) {
    if (!mainWindow_) return;
    detachedMoveRequiresTargetExit_ = requireTargetExit;
    if (pointerOffsetInWindow.x() >= 0) detachedMovePointerOffsetInWindow_ = pointerOffsetInWindow;
    else detachedMovePointerOffsetInWindow_ = QCursor::pos() - pos();
    detachedMoveLastInsertIndex_ = -1;
    detachedMoveStartPosition_ = pos();
    detachedMoveLastPosition_ = pos();
    detachedMoveStartCursorPosition_ = QCursor::pos();
    detachedMoveLastCursorPosition_ = detachedMoveStartCursorPosition_;
    detachedMoveHasMoved_ = false;
    detachedMoveSawPressed_ = QGuiApplication::mouseButtons().testFlag(Qt::LeftButton);
    detachedMoveElapsed_.restart();
    detachedMoveLastMotion_.restart();
    detachedSystemMoveActive_ = true;
    detachedMoveWatchTimer_.start();
  }

  void continueInitialDetachedMoveWhenExposed(int attemptsRemaining = 12) {
    const bool leftHeld = QGuiApplication::mouseButtons().testFlag(Qt::LeftButton);
    const bool anchorRuntimeTest = qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_STRESS_TEST");
    const bool canVerifySyntheticAnchor = anchorRuntimeTest
        && (QGuiApplication::platformName() == QLatin1String("offscreen")
            || QGuiApplication::platformName() == QLatin1String("xcb"));
    if (!mainWindow_ || (!leftHeld && !canVerifySyntheticAnchor)) return;
    QWindow *const handle = windowHandle();
    if (handle && handle->isExposed()) {
      if (tabBar_ && tabBar_->count() > 0) {
        const QPoint heldPointInWindow = tabBar_->mapTo(this, tabBar_->tabRect(0).topLeft()) + heldTabOffsetInTab_;
        const QPoint cursorPosition = leftHeld ? QCursor::pos() : initialDetachedCursorPosition_;
        move(cursorPosition - heldPointInWindow);
        detachedMovePointerOffsetInWindow_ = heldPointInWindow;
        if (canVerifySyntheticAnchor) {
          const QPoint actualHeldPoint = tabBar_->mapToGlobal(tabBar_->tabRect(0).topLeft() + heldTabOffsetInTab_);
          if ((actualHeldPoint - cursorPosition).manhattanLength() > 2) {
            std::fprintf(stderr, "tab attach stress failed: detached tab cursor anchor drifted\n");
            std::fflush(stderr);
            qApp->exit(2);
            return;
          }
        }
      }
      if (leftHeld && handle->startSystemMove()) beginDetachedWindowMove(detachedMovePointerOffsetInWindow_, true);
      return;
    }
    if (attemptsRemaining <= 0) return;
    QTimer::singleShot(16, this, [this, attemptsRemaining] {
      continueInitialDetachedMoveWhenExposed(attemptsRemaining - 1);
    });
  }

  void finishDetachedWindowMove() {
    if (!mainWindow_ || !detachedSystemMoveActive_) return;
    detachedSystemMoveActive_ = false;
    detachedMoveWatchTimer_.stop();
    if (detachedMoveRequiresTargetExit_) {
      detachedMoveRequiresTargetExit_ = false;
      detachedMoveLastInsertIndex_ = -1;
      mainWindow_->clearAttachHover();
      return;
    }
    if (!detachedMoveHasMoved_) { mainWindow_->clearAttachHover(); return; }
    // Re-probe at drop time. detachedMoveLastInsertIndex_ is diagnostics and
    // preview state only; it must never resurrect a target that has already
    // been left.
    const QPoint cursorPosition = QCursor::pos();
    const QPoint windowDerivedPosition = detachedMovePointerOffsetInWindow_.x() >= 0
        ? mapToGlobal(detachedMovePointerOffsetInWindow_)
        : cursorPosition;
    // On Wayland the moved shell is authoritative only after it has actually
    // advanced; before that, a fast native gesture needs the live cursor to
    // recognize a valid entry into the root strip.
    const bool cursorPositionAdvanced =
        (cursorPosition - detachedMoveStartCursorPosition_).manhattanLength() >= QApplication::startDragDistance();
    const bool windowPositionAdvanced =
        (pos() - detachedMoveStartPosition_).manhattanLength() >= QApplication::startDragDistance();
    const bool waylandMove = QGuiApplication::platformName().contains(QLatin1String("wayland"), Qt::CaseInsensitive);
    const bool useCursorProbe = waylandMove ? !windowPositionAdvanced : cursorPositionAdvanced;
    const int cursorInsertIndex = useCursorProbe ? mainWindow_->tabInsertIndexAtGlobal(cursorPosition) : -1;
    const int windowInsertIndex = mainWindow_->tabInsertIndexAtGlobal(windowDerivedPosition);
    const int insertIndex = waylandMove && windowPositionAdvanced
        ? windowInsertIndex
        : (cursorInsertIndex >= 0 ? cursorInsertIndex : windowInsertIndex);
    detachedMoveLastInsertIndex_ = -1;
    if (insertIndex >= 0) attachCurrentToMainAt(insertIndex);
    else mainWindow_->clearAttachHover();
  }

  void scheduleSessionSave() {
    if (mainWindow_ || !sessionStore_ || !policy_->allowsSessionRestore()) return;
    if (!sessionSaveTimer_.isActive()) sessionSaveTimer_.start(300);
  }

  int tabInsertIndexAtGlobal(const QPoint &screenPosition) const {
    if (!tabStrip_ || !tabScroll_ || !tabBar_) return -1;
    // Use the scrollable tab region, not the complete chrome row: the latter
    // includes minimize/maximize/close controls. Keep a modest logical-pixel
    // halo around the real insertion surface without extending into the
    // navigation toolbar below it.
    QWidget *const viewport = tabScroll_->viewport();
    if (!viewport) return -1;
    const int halo = std::clamp(QApplication::startDragDistance(), 10, 14);
    const bool useCachedGeometry = !isVisible() && lastVisibleTabAttachRect_.isValid();
    const QRect visibleTarget = useCachedGeometry ? lastVisibleTabAttachRect_
                                                  : QRect(viewport->mapToGlobal(QPoint(0, 0)), viewport->size());
    const QRect targetRect = visibleTarget.adjusted(-halo, -halo, halo, halo);
    if (!targetRect.contains(screenPosition)) return -1;
    // The + control remains a real button, never a drop target. The empty
    // insertion space immediately to its left still maps to tab count().
    if (newTabButton_) {
      const QRect plusRect(newTabButton_->mapToGlobal(QPoint(0, 0)), newTabButton_->size());
      if (plusRect.contains(screenPosition)) return -1;
    }
    const int x = useCachedGeometry ? screenPosition.x() - lastVisibleTabBarOrigin_.x()
                                    : tabBar_->mapFromGlobal(screenPosition).x();
    for (int index = 0; index < tabBar_->count(); ++index) {
      if (x < tabBar_->tabRect(index).center().x()) return index;
    }
    return tabBar_->count();
  }

  int currentTabVisualWidth() const {
    if (!tabBar_) return 0;
    const int index = tabBar_->currentIndex();
    return index >= 0 && index < tabBar_->count() ? tabBar_->tabRect(index).width() : 0;
  }

  void showAttachHover(int index, int sourceTabWidth = 0) {
    if (mainWindow_) { mainWindow_->showAttachHover(index, sourceTabWidth); return; }
    if (!attachMarker_ || !tabScroll_ || !tabBar_ || index < 0) { clearAttachHover(); return; }
    const int previewWidth = std::clamp(sourceTabWidth > 0 ? sourceTabWidth : currentTabVisualWidth(), 120, 280);
    const bool previewChanged = attachPreviewIndex_ != index || attachPreviewWidth_ != previewWidth;
    if (previewChanged) {
      // Capture the unmodified row once. The overlay below is deliberately
      // paint-only: previewing an insertion must not create a fake QTabBar
      // entry or a TabManager record.
      if (attachPreviewIndex_ < 0) {
        attachPreviewTabsPixmap_ = tabBar_->grab();
        attachPreviewNewTabPixmap_ = newTabButton_ ? newTabButton_->grab() : QPixmap();
      }
      attachPreviewIndex_ = index;
      attachPreviewWidth_ = previewWidth;
      refreshTabStripWidth();
    }
    tabStrip_->setProperty("attachHover", true);
    tabStrip_->style()->unpolish(tabStrip_);
    tabStrip_->style()->polish(tabStrip_);
    renderAttachPreview();
  }

  void clearAttachHover() {
    if (mainWindow_) { mainWindow_->clearAttachHover(); return; }
    if (attachMarker_) attachMarker_->hide();
    if (attachPreviewOverlay_) attachPreviewOverlay_->hide();
    const bool hadPreview = attachPreviewIndex_ >= 0;
    attachPreviewIndex_ = -1;
    attachPreviewWidth_ = 0;
    attachPreviewTabsPixmap_ = QPixmap();
    attachPreviewNewTabPixmap_ = QPixmap();
    if (hadPreview) {
      if (tabBar_) tabBar_->show();
      if (newTabButton_) newTabButton_->setVisible(!mainWindow_);
      refreshTabStripWidth();
    }
    if (!tabStrip_) return;
    tabStrip_->setProperty("attachHover", false);
    tabStrip_->style()->unpolish(tabStrip_);
    tabStrip_->style()->polish(tabStrip_);
  }

  void renderAttachPreview() {
    if (!tabScroll_ || !tabBar_ || !newTabButton_ || attachPreviewIndex_ < 0) return;
    QWidget *const viewport = tabScroll_->viewport();
    if (!viewport || attachPreviewTabsPixmap_.isNull()) return;
    if (!attachPreviewOverlay_) {
      attachPreviewOverlay_ = new QLabel(viewport);
      attachPreviewOverlay_->setAttribute(Qt::WA_TransparentForMouseEvents);
      attachPreviewOverlay_->setAttribute(Qt::WA_NoSystemBackground);
      // The overlay visually covers the tab row during a Wayland QDrag. It
      // must still participate in the root's existing DragMove/Drop routing
      // rather than causing the target to disappear after the first frame.
      attachPreviewOverlay_->setAcceptDrops(true);
      attachPreviewOverlay_->installEventFilter(this);
    }
    const int xInTabBar = attachPreviewIndex_ < tabBar_->count()
        ? tabBar_->tabRect(attachPreviewIndex_).left()
        : (tabBar_->count() > 0 ? tabBar_->tabRect(tabBar_->count() - 1).right() + 1 : 0);
    const QPoint tabOrigin = tabBar_->mapTo(viewport, QPoint(0, 0));
    QPixmap preview(viewport->size());
    // Keep the real QTabBar and + button alive as DnD targets below this
    // visual layer. An opaque strip prevents their unshifted pixels leaking
    // through while the composited preview supplies the shifted tab row.
    preview.fill(QColor(32, 33, 36));
    QPainter painter(&preview);
    const int sourceWidth = attachPreviewTabsPixmap_.width();
    const int split = std::clamp(xInTabBar, 0, sourceWidth);
    if (split > 0)
      painter.drawPixmap(tabOrigin, attachPreviewTabsPixmap_, QRect(0, 0, split, attachPreviewTabsPixmap_.height()));
    if (split < sourceWidth) {
      painter.drawPixmap(tabOrigin + QPoint(split + attachPreviewWidth_, 0), attachPreviewTabsPixmap_,
                         QRect(split, 0, sourceWidth - split, attachPreviewTabsPixmap_.height()));
    }
    const QRect gap(tabOrigin + QPoint(split, 3), QSize(attachPreviewWidth_, std::max(20, viewport->height() - 6)));
    painter.fillRect(gap, QColor(42, 47, 53));
    QPen gapPen(QColor(138, 180, 248));
    gapPen.setStyle(Qt::DashLine);
    painter.setPen(gapPen);
    painter.drawRoundedRect(gap.adjusted(1, 1, -2, -2), 5, 5);
    if (!attachPreviewNewTabPixmap_.isNull())
      painter.drawPixmap(newTabButton_->pos(), attachPreviewNewTabPixmap_);
    painter.end();
    attachMarker_->hide();
    attachPreviewOverlay_->setPixmap(preview);
    attachPreviewOverlay_->setGeometry(viewport->rect());
    attachPreviewOverlay_->show();
    attachPreviewOverlay_->raise();
  }

  bool hasAttachPreview(int index, int sourceTabWidth) const {
    const int expectedWidth = std::clamp(sourceTabWidth, 120, 280);
    if (attachPreviewIndex_ != index || attachPreviewWidth_ != expectedWidth) return false;
    // The last-root regression fixture deliberately hides its destination
    // root. Its candidate state is still meaningful, but no child preview can
    // be visible until attach restores that top-level window. A synthetic
    // Wayland native move likewise cannot be used to assert compositor paint
    // delivery; its state transition is covered here and paint is asserted by
    // the offscreen/X11 fixture.
    if (!isVisible() || QGuiApplication::platformName().contains(QLatin1String("wayland"), Qt::CaseInsensitive)) return true;
    return attachPreviewOverlay_ && attachPreviewOverlay_->isVisible()
        && tabBar_ && tabBar_->isVisible()
        && newTabButton_ && newTabButton_->isVisible();
  }

  void validateTabState() const {
    const auto invariantFatal = [this](const QString &message) {
      if (transferDiagnosticsEnabled() || qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_STRESS_TEST")) {
        std::fprintf(stderr, "ARDALI_TAB_INVARIANT_FATAL window=%llu transfer=%d: %s\n",
                     static_cast<unsigned long long>(windowDebugId_), tabTransferInProgress_ ? 1 : 0,
                     qPrintable(message));
        std::fflush(stderr);
      }
      qFatal("%s", qPrintable(message));
    };
    QString reason;
    const bool valid = tabManager_ && tabManager_->validate(&reason);
    if (transferDiagnosticsEnabled()) {
      QJsonObject payload{
          {QStringLiteral("stage"), QStringLiteral("VALIDATE_TAB_STATE")},
          {QStringLiteral("windowId"), QString::number(windowDebugId_)},
          {QStringLiteral("transferInProgress"), tabTransferInProgress_},
          {QStringLiteral("valid"), valid},
          {QStringLiteral("reason"), reason},
      };
      qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER %1").arg(QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact)));
    }
    if (!valid) invariantFatal(QStringLiteral("Tab state invariant failed: %1").arg(reason));
    // QTabBar emits currentChanged synchronously while a live view is between
    // source and destination stacks. The global model remains valid there, but
    // a visual/current-tab comparison has no transaction-stable meaning until
    // the destination has adopted the view.
    if (tabTransferInProgress_) return;
    const QVector<TabManager::TabRecord> ownedRecords = tabManager_->recordsFor(const_cast<BrowserWindow *>(this));
    const int pageCount = pages_ ? pages_->count() : 0;
    const int tabCount = tabBar_ ? tabBar_->count() : 0;
    if (pageCount != tabCount || pageCount != ownedRecords.size()) {
      invariantFatal(QStringLiteral("Visual tab containers do not match TabManager ownership: pages=%1 tabs=%2 records=%3")
                         .arg(pageCount).arg(tabCount).arg(ownedRecords.size()));
    }
    const bool detachedOwner = mainWindow_ != nullptr;
    for (int index = 0; index < pageCount; ++index) {
      const auto id = tabManager_->idForContent(pages_->widget(index));
      const TabManager::TabRecord *record = tabManager_->record(id);
      if (!record || record->ownerWindow != this || record->detached != detachedOwner || record->order != index) {
        invariantFatal(QStringLiteral("Visual tab order, owner, or detached state does not match TabManager at index %1").arg(index));
      }
    }
    if (pageCount == 0) {
      if (!tabManager_->activeFor(const_cast<BrowserWindow *>(this)).isNull())
        invariantFatal(QStringLiteral("Empty native window has an active TabManager record"));
      return;
    }
    if (!pages_->currentWidget() || !tabBar_ || tabBar_->currentIndex() != pages_->currentIndex()) {
      invariantFatal(QStringLiteral("QTabBar and QStackedWidget current indices differ: tab=%1 stack=%2")
                         .arg(tabBar_ ? tabBar_->currentIndex() : -1).arg(pages_ ? pages_->currentIndex() : -1));
    }
    if (pages_ && pages_->currentWidget()) {
      const auto visible = tabManager_->idForContent(pages_->currentWidget());
      const auto active = tabManager_->activeFor(const_cast<BrowserWindow *>(this));
      if (visible.isNull() || visible != active)
        invariantFatal(QStringLiteral("Visible tab does not match TabManager active record"));
    }
  }

  QPointer<QWebEngineProfile> profile_;
  BrowserProfileService *profileService_ = nullptr;
  QPointer<TabManager> tabManager_;
  const BrowserPolicy *policy_ = nullptr;
  SessionStore *sessionStore_ = nullptr;
  QPointer<BrowserWindow> mainWindow_;
  QWidget *tabStrip_ = nullptr;
  QWidget *browserRoot_ = nullptr;
  QHBoxLayout *tabStripLayout_ = nullptr;
  QStackedWidget *pages_ = nullptr;
  BrowserTabBar *tabBar_ = nullptr;
  TabStripScrollArea *tabScroll_ = nullptr;
  QLineEdit *address_ = nullptr;
  QCompleter *addressCompleter_ = nullptr;
  QStandardItemModel *addressSuggestionModel_ = nullptr;
  QComboBox *searchEngine_ = nullptr;
  QToolButton *zoomButton_ = nullptr;
  QFrame *zoomPopup_ = nullptr;
  QLabel *zoomPercent_ = nullptr;
  QToolButton *newTabButton_ = nullptr;
  QToolButton *minimizeButton_ = nullptr;
  QToolButton *maximizeButton_ = nullptr;
  QToolButton *closeWindowButton_ = nullptr;
  QToolBar *bookmarkBar_ = nullptr;
  QProgressBar *loadProgress_ = nullptr;
  QAction *back_ = nullptr;
  QAction *forward_ = nullptr;
  QAction *reload_ = nullptr;
  QAction *bookmark_ = nullptr;
  QAction *settings_ = nullptr;
  QFrame *attachMarker_ = nullptr;
  QLabel *attachPreviewOverlay_ = nullptr;
  QLabel *dragTabProxy_ = nullptr;
  QLabel *dragReorderOverlay_ = nullptr;
  QVariantAnimation dragProxySettleAnimation_{this};
  QVariantAnimation dragReorderAnimation_{this};
  QTimer tabAutoScrollTimer_{this};
  QTimer detachedMoveWatchTimer_{this};
  QElapsedTimer detachedMoveElapsed_;
  QElapsedTimer detachedMoveLastMotion_;
  QElapsedTimer detachedMoveLastTarget_;
  QTimer sessionSaveTimer_{this};
  QTimer zoomWatchTimer_{this};
  QTimer suggestionWatchTimer_{this};
  QNetworkAccessManager suggestionNetwork_{this};
  QPointer<QNetworkReply> suggestionReply_;
  QHash<QString, QPointer<QNetworkReply>> suggestionIconReplies_;
  QHash<QString, QString> suggestionIconData_;
  QSet<QString> suggestionIconPending_;
  QString lastSuggestionKey_;
  int tabScrollDirection_ = 0;
  int draggedTabLeft_ = -1;
  int draggedTabWidth_ = 0;
  int draggedTabRight_ = 0;
  int pendingMainAttachIndex_ = -1;
  QPointer<QWebEngineView> pendingMainAttachView_;
  TabManager::TabId pendingMainAttachId_;
  int attachPreviewIndex_ = -1;
  int attachPreviewWidth_ = 0;
  QPixmap attachPreviewTabsPixmap_;
  QPixmap attachPreviewNewTabPixmap_;
  QVector<DragReorderVisual> dragReorderVisuals_;
  QPixmap dragReorderNewTabPixmap_;
  QVector<qreal> dragReorderCurrentOffsets_;
  QVector<qreal> dragReorderStartOffsets_;
  QVector<qreal> dragReorderTargetOffsets_;
  int dragReorderCandidate_ = -1;
  int dragReorderGapWidth_ = 0;
  qreal dragReorderAnimatedGapLeft_ = -1.0;
  qreal dragReorderGapStartLeft_ = -1.0;
  qreal dragReorderGapTargetLeft_ = -1.0;
  int detachedMoveLastInsertIndex_ = -1;
  QPoint detachedMoveStartPosition_;
  QPoint detachedMoveLastPosition_;
  QPoint detachedMoveStartCursorPosition_;
  QPoint detachedMoveLastCursorPosition_;
  QPoint detachedMovePointerOffsetInWindow_{-1, -1};
  QPoint heldTabOffsetInTab_;
  QPoint initialDetachedCursorPosition_;
  QRect lastVisibleTabAttachRect_;
  QPoint lastVisibleTabBarOrigin_;
  bool detachedMoveHasMoved_ = false;
  bool detachedMoveSawPressed_ = false;
  bool detachedSystemMoveActive_ = false;
  bool detachedMoveRequiresTargetExit_ = false;
  bool attachCommitInProgress_ = false;
  bool dragProxySettlePending_ = false;
  bool tabReorderInProgress_ = false;
  bool tabTransferInProgress_ = false;
  quint64 windowDebugId_ = 0;
  bool zoomWasActive_ = false;
  bool restoreMainMaximized_ = false;
  bool wasMaximizedBeforeFullScreen_ = false;
};

int main(int argc, char *argv[]) {
  registerArdaliUrlSchemes();
  QApplication app(argc, argv);
  app.setQuitOnLastWindowClosed(false);
  QApplication::setApplicationName("ArDaliBrowser");
  QGuiApplication::setDesktopFileName(QStringLiteral("ardali-browser"));
  const QIcon appIcon(QStringLiteral(":/assets/icons/ardali-browser-256.png"));
  if (appIcon.isNull()) qWarning("ArDaliBrowser application icon could not be loaded");
  else QApplication::setWindowIcon(appIcon);
  std::unique_ptr<QTemporaryDir> runtimeTestData;
  if (qEnvironmentVariableIsSet("ARDALI_SETTINGS_RUNTIME_TEST")
      || qEnvironmentVariableIsSet("ARDALI_NEW_TAB_CUSTOMIZATION_RUNTIME_TEST")
      || qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_RUNTIME_TEST")
      || qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_STRESS_TEST")) {
    runtimeTestData = std::make_unique<QTemporaryDir>();
    QSettings::setPath(QSettings::NativeFormat, QSettings::UserScope, runtimeTestData->path());
  }
  const QString dataDir = runtimeTestData ? runtimeTestData->path() : QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
  QDir().mkpath(dataDir);
  QString policyError;
  const QString installedPolicyPath = QCoreApplication::applicationDirPath() + QStringLiteral("/browser_policy.json");
  const QString policyPath = QFileInfo::exists(installedPolicyPath)
      ? installedPolicyPath
      : QStringLiteral(ARDALI_BROWSER_POLICY_PATH);
  const BrowserPolicy policy = BrowserPolicy::load(policyPath, &policyError);
  if (!policy.isValid()) {
    qCritical("Cannot start ArDaliBrowser: %s", qPrintable(policyError));
    return 2;
  }
  BrowserProfileService profileService(dataDir, &policy, &app);
  TabManager tabManager(&app);
  SessionStore sessionStore(dataDir + "/tabs.session.json");
  BrowserWindow mainWindow(profileService.profile(), &profileService, &tabManager, &policy, &sessionStore, nullptr, false);
  if (policy.allowsSessionRestore() && QSettings().value("browser/restoreSession", true).toBool()) {
    mainWindow.restoreSession(sessionStore.load());
  }
  mainWindow.ensureInitialTab();
  QObject::connect(&app, &QCoreApplication::aboutToQuit, &mainWindow, [&mainWindow] { mainWindow.saveSessionNow(); });
  if (qEnvironmentVariableIsSet("ARDALI_TAB_TRANSFER_DIAGNOSTICS")) {
    QObject::connect(&app, &QGuiApplication::lastWindowClosed, &app, [] {
      qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER {\"stage\":\"LAST_WINDOW_CLOSED\"}");
    });
    QObject::connect(&app, &QCoreApplication::aboutToQuit, &app, [] {
      qInfo().noquote() << QStringLiteral("ARDALI_TAB_TRANSFER {\"stage\":\"ABOUT_TO_QUIT\"}");
    });
  }
  mainWindow.showWithSavedWindowState();
  if (qEnvironmentVariableIsSet("ARDALI_SETTINGS_RUNTIME_TEST")) {
    QTimer::singleShot(100, &mainWindow, [&mainWindow] { mainWindow.runSettingsLifecycleRuntimeTest(); });
  }
  if (qEnvironmentVariableIsSet("ARDALI_NEW_TAB_CUSTOMIZATION_RUNTIME_TEST")) {
    QTimer::singleShot(450, &mainWindow, [&mainWindow] { mainWindow.runNewTabCustomizationRuntimeTest(); });
  }
  if (qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_STRESS_TEST")) {
    const int iterations = std::clamp(qEnvironmentVariableIntValue("ARDALI_TAB_ATTACH_STRESS_CYCLES"), 1, 50);
    QTimer::singleShot(800, &mainWindow, [&mainWindow, iterations] { mainWindow.runTabAttachStressTest(iterations); });
  } else if (qEnvironmentVariableIsSet("ARDALI_TAB_ATTACH_RUNTIME_TEST")) {
    QTimer::singleShot(800, &mainWindow, [&app, &mainWindow, &tabManager] {
      auto fail = [&app](const char *reason) {
        std::fprintf(stderr, "tab drag attach runtime failed: %s\n", reason);
        std::fflush(stderr);
        qCritical("tab drag attach runtime failed: %s", reason);
        app.exit(2);
      };
      auto *newTab = mainWindow.findChild<QToolButton *>(QStringLiteral("new-tab-button"));
      if (!newTab) { fail("new-tab button missing"); return; }
      newTab->click();
      const QVector<TabManager::TabRecord> beforeRecords = tabManager.recordsFor(&mainWindow);
      if (beforeRecords.size() != 2 || !beforeRecords.constLast().view || !beforeRecords.constLast().page) {
        fail("second live tab was not created");
        return;
      }
      const TabManager::TabId movedId = beforeRecords.constLast().id;
      QPointer<QWebEnginePage> movedPage = beforeRecords.constLast().page;
      QTimer::singleShot(700, &mainWindow, [&app, &mainWindow, &tabManager, movedId, movedPage, fail] {
        if (!movedPage || !isNewTabUrl(movedPage->url())) { fail("second new-tab page did not load"); return; }
        movedPage->runJavaScript(QStringLiteral("window.__ardaliDragAttachMarker='preserved';history.pushState({dragAttach:true},'', '#drag-attach');"),
            [&app, &mainWindow, &tabManager, movedId, movedPage, fail](const QVariant &) mutable {
        if (!QMetaObject::invokeMethod(&mainWindow, "detachTab", Qt::DirectConnection,
                                       Q_ARG(int, 1), Q_ARG(QPoint, QPoint(900, 420)), Q_ARG(QPoint, QPoint(75, 15)))) {
          fail("detach slot could not be invoked");
          return;
        }
        BrowserWindow *detached = nullptr;
        for (QWidget *widget : QApplication::topLevelWidgets()) {
          auto *candidate = qobject_cast<BrowserWindow *>(widget);
          if (candidate && candidate != &mainWindow) { detached = candidate; break; }
        }
        if (!detached) { fail("detached window missing"); return; }
        if (!detached->tabBar()->externalAttachDragEnabled() || !mainWindow.tabBar()->acceptDrops()) {
          fail("native tab drag source or root drop target is disabled");
          return;
        }
        for (QAction *action : detached->findChildren<QAction *>()) {
          if (action->text().contains(QStringLiteral("Ana pencereye"), Qt::CaseInsensitive)) {
            fail("legacy attach action is still visible");
            return;
          }
        }
        const TabManager::TabRecord *detachedRecord = tabManager.record(movedId);
        if (!detachedRecord || detachedRecord->ownerWindow != detached || !detachedRecord->detached || detachedRecord->page != movedPage) {
          fail("live page was not preserved during detach");
          return;
        }
        auto *rootStrip = mainWindow.findChild<QWidget *>(QStringLiteral("tab-strip"));
        if (!rootStrip) { fail("root tab strip missing"); return; }
        const QPoint snapTarget = rootStrip->mapToGlobal(QPoint(1, rootStrip->height() / 2));
        // Reproduce the last-root-tab case: the destination shell can be
        // hidden while the detached window remains the only visible host.
        mainWindow.hide();
        if (!QMetaObject::invokeMethod(detached, "runtimeTestBeginInitialMoveAt", Qt::DirectConnection,
                                       Q_ARG(QPoint, snapTarget))) {
          fail("initial detach target guard could not be invoked");
          return;
        }
        const QPointer<BrowserWindow> guardedDetached(detached);
        QTimer::singleShot(60, &mainWindow, [&mainWindow, &tabManager, movedId, snapTarget, guardedDetached, fail] {
          const TabManager::TabRecord *stillDetached = tabManager.record(movedId);
          if (!guardedDetached || !stillDetached || stillDetached->ownerWindow != guardedDetached || !stillDetached->detached) {
            fail("initial detach snapped back before leaving the root strip");
            return;
          }
          auto *rootStrip = mainWindow.findChild<QWidget *>(QStringLiteral("tab-strip"));
          const QPoint outsideTarget = rootStrip->mapToGlobal(QPoint(rootStrip->width() / 2, rootStrip->height() + 100));
          QMetaObject::invokeMethod(guardedDetached, "runtimeTestSnapCurrentToMain", Qt::DirectConnection,
                                    Q_ARG(QPoint, outsideTarget));
          QTimer::singleShot(50, &mainWindow, [guardedDetached, snapTarget] {
            if (guardedDetached)
              QMetaObject::invokeMethod(guardedDetached, "runtimeTestSnapCurrentToMain", Qt::DirectConnection,
                                        Q_ARG(QPoint, snapTarget));
          });
        });
        QTimer::singleShot(250, &mainWindow, [&app, &mainWindow, &tabManager, movedId, movedPage, guardedDetached, fail] {
          if (!mainWindow.isVisible()) {
            fail("root window stayed hidden after attach");
            return;
          }
          if (guardedDetached && guardedDetached->isVisible()) {
            fail("detached shell remained visible after attach");
            return;
          }
          const QVector<TabManager::TabRecord> attachedRecords = tabManager.recordsFor(&mainWindow);
          const TabManager::TabRecord *attachedRecord = tabManager.record(movedId);
          if (attachedRecords.size() != 2 || attachedRecords.constFirst().id != movedId || !attachedRecord
              || attachedRecord->ownerWindow != &mainWindow || attachedRecord->detached || attachedRecord->page != movedPage) {
            fail("drop position or live tab ownership was not preserved");
            return;
          }
          movedPage->runJavaScript(QStringLiteral("JSON.stringify({marker:window.__ardaliDragAttachMarker,hash:location.hash,historyLength:history.length})"),
              [&app, fail](const QVariant &value) mutable {
            const QJsonDocument document = QJsonDocument::fromJson(value.toString().toUtf8());
            const QJsonObject state = document.object();
            if (state.value(QStringLiteral("marker")).toString() != QLatin1String("preserved")
                || state.value(QStringLiteral("hash")).toString() != QLatin1String("#drag-attach")
                || state.value(QStringLiteral("historyLength")).toInt() < 2) {
              fail("page state or history changed during attach");
              return;
            }
            qInfo("tab drag attach runtime: ok");
            app.exit(0);
          });
        });
        });
      });
    });
  }
  return app.exec();
}

#include "main.moc"
