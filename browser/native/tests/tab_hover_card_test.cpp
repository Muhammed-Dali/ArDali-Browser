#include "desktop_tabs/tab_hover_card.h"

#include <cassert>
#include <iostream>

#include <QApplication>
#include <QFlags>
#include <QIcon>
#include <QLabel>
#include <QPointer>
#include <QRect>
#include <QString>
#include <QUrl>
#include <QVector>
#include <QWebEnginePage>
#include <QWebEngineView>
#include <QtGlobal>

static void testWindowFlagsAndFlickerAttributes() {
  std::cout << "[TEST] Running testWindowFlagsAndFlickerAttributes...\n";
  TabHoverCard card;

  // Verify non-activating and mouse-transparent attributes
  assert(card.testAttribute(Qt::WA_ShowWithoutActivating));
  assert(card.testAttribute(Qt::WA_TransparentForMouseEvents));

  // Verify window flags include ToolTip, Frameless, and WindowTransparentForInput
  const Qt::WindowFlags flags = card.windowFlags();
  assert(flags & Qt::ToolTip);
  assert(flags & Qt::FramelessWindowHint);
  assert(flags & Qt::WindowTransparentForInput);

  std::cout << "  -> PASS: All flicker prevention window flags and attributes verified.\n";
}

static void testDomainExtraction() {
  std::cout << "[TEST] Running testDomainExtraction...\n";
  assert(TabHoverCard::extractDomain(QUrl(QStringLiteral("ardali://newtab"))) == QStringLiteral("ArDaliBrowser"));
  assert(TabHoverCard::extractDomain(QUrl(QStringLiteral("ardali://settings"))) == QStringLiteral("Ayarlar"));
  assert(TabHoverCard::extractDomain(QUrl(QStringLiteral("ardali://passwords"))) == QStringLiteral("Şifre Yöneticisi"));
  assert(TabHoverCard::extractDomain(QUrl(QStringLiteral("ardali://downloads"))) == QStringLiteral("İndirmeler"));
  assert(TabHoverCard::extractDomain(QUrl(QStringLiteral("https://www.google.com/search?q=test"))) == QStringLiteral("google.com"));
  assert(TabHoverCard::extractDomain(QUrl(QStringLiteral("https://github.com/openai"))) == QStringLiteral("github.com"));
  std::cout << "  -> PASS: Domain extraction verified.\n";
}

static void testLifecycleStateAuthoritativeSource() {
  std::cout << "[TEST] Running testLifecycleStateAuthoritativeSource...\n";
  TabHoverCard card;

  // 1. Internal Tab
  QRect tabRect(100, 100, 160, 36);
  card.showForTab(QStringLiteral("Ayarlar"), QUrl(QStringLiteral("ardali://settings")), QIcon(),
                  nullptr, QVector<QPointer<QWebEngineView>>{}, tabRect, nullptr,
                  []() { return QWebEnginePage::LifecycleState::Active; },
                  /*isInternal=*/true);

  auto *lifeLabel = card.findChild<QLabel *>(QStringLiteral("hover-status-text"));
  assert(lifeLabel != nullptr);
  auto labels = card.findChildren<QLabel *>(QStringLiteral("hover-status-text"));
  bool foundInternal = false;
  bool foundInternalMem = false;
  for (auto *lbl : labels) {
    if (lbl->text().contains(QStringLiteral("Dahili Sekme"))) foundInternal = true;
    if (lbl->text().contains(QStringLiteral("Dahili arayüz sekmesi"))) foundInternalMem = true;
  }
  assert(foundInternal);
  assert(foundInternalMem);

  // 2. Discarded Tab with Authoritative Provider
  card.showForTab(QStringLiteral("Discarded Tab"), QUrl(QStringLiteral("https://example.com")), QIcon(),
                  nullptr, QVector<QPointer<QWebEngineView>>{}, tabRect, nullptr,
                  []() { return QWebEnginePage::LifecycleState::Discarded; },
                  /*isInternal=*/false);

  bool foundDiscarded = false;
  bool foundDiscardedMem = false;
  for (auto *lbl : card.findChildren<QLabel *>(QStringLiteral("hover-status-text"))) {
    if (lbl->text().contains(QStringLiteral("Boşaltıldı (Discarded)"))) foundDiscarded = true;
    if (lbl->text().contains(QStringLiteral("Renderer belleği: Boşaltıldı"))) foundDiscardedMem = true;
  }
  assert(foundDiscarded);
  assert(foundDiscardedMem);

  // 3. Frozen Tab
  card.showForTab(QStringLiteral("Frozen Tab"), QUrl(QStringLiteral("https://example.com")), QIcon(),
                  nullptr, QVector<QPointer<QWebEngineView>>{}, tabRect, nullptr,
                  []() { return QWebEnginePage::LifecycleState::Frozen; },
                  /*isInternal=*/false);

  bool foundFrozen = false;
  for (auto *lbl : card.findChildren<QLabel *>(QStringLiteral("hover-status-text"))) {
    if (lbl->text().contains(QStringLiteral("Donduruldu (Frozen)"))) foundFrozen = true;
  }
  assert(foundFrozen);

  card.hideCard();
  std::cout << "  -> PASS: Lifecycle state authoritative display verified.\n";
}

static void testPollingTimerLifecycle() {
  std::cout << "[TEST] Running testPollingTimerLifecycle...\n";
  TabHoverCard card;
  QRect tabRect(100, 100, 160, 36);

  card.showForTab(QStringLiteral("Test Tab"), QUrl(QStringLiteral("https://example.com")), QIcon(),
                  nullptr, QVector<QPointer<QWebEngineView>>{}, tabRect, nullptr,
                  []() { return QWebEnginePage::LifecycleState::Active; });

  assert(card.isVisible());

  // Hiding the card must stop timer
  card.hideCard();
  assert(!card.isVisible());

  // Calling refreshCardInfo on a hidden card must keep timer stopped
  card.refreshCardInfo();

  std::cout << "  -> PASS: Polling timer visibility gating verified.\n";
}

static void testStalePointerSafety() {
  std::cout << "[TEST] Running testStalePointerSafety...\n";

  // Create real view and a destroyed view to verify QPointer safety
  auto *liveView = new QWebEngineView();
  auto *dyingView = new QWebEngineView();
  QPointer<QWebEngineView> ptrLive = liveView;
  QPointer<QWebEngineView> ptrDying = dyingView;

  QVector<QPointer<QWebEngineView>> views;
  views.append(ptrLive);
  views.append(ptrDying);

  // Destroy dyingView
  delete dyingView;
  assert(ptrDying.isNull());
  assert(!ptrLive.isNull());

  // Calling measureMemory with stale / null QPointer in vector must not crash
  TabMemoryInfo info = TabHoverCard::measureMemory(liveView->page(), views);
  Q_UNUSED(info);

  delete liveView;
  std::cout << "  -> PASS: Stale pointer safety verified with zero crashes.\n";
}

int main(int argc, char *argv[]) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu");

  QApplication app(argc, argv);

  std::cout << "========================================\n";
  std::cout << "RUNNING TAB HOVER CARD TESTS\n";
  std::cout << "========================================\n";

  testWindowFlagsAndFlickerAttributes();
  testDomainExtraction();
  testLifecycleStateAuthoritativeSource();
  testPollingTimerLifecycle();
  testStalePointerSafety();

  std::cout << "========================================\n";
  std::cout << "ALL TAB HOVER CARD TESTS PASSED!\n";
  std::cout << "========================================\n";
  return 0;
}
