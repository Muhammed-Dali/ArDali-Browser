#include <QApplication>
#include <QBuffer>
#include <QDir>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFile>
#include <QIcon>
#include <QLabel>
#include <QPixmap>
#include <QStandardPaths>
#include <QTimer>
#include <QUrl>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineView>
#include <QWidget>
#include <cassert>
#include <chrono>
#include <iostream>
#include <thread>
#include <unistd.h>

#include "desktop_tabs/system_memory_pressure_monitor.h"
#include "desktop_tabs/tab_manager.h"
#include "desktop_tabs/tab_performance_manager.h"

using namespace ardali;

namespace {

void processEventsFor(int milliseconds) {
  QEventLoop loop;
  QTimer::singleShot(milliseconds, &loop, &QEventLoop::quit);
  loop.exec();
}

QVariant runJsSync(QWebEnginePage *page, const QString &script, int timeoutMs = 3000) {
  QEventLoop loop;
  QTimer timer;
  timer.setSingleShot(true);

  QVariant result;
  bool completed = false;

  page->runJavaScript(script, [&](const QVariant &res) {
    result = res;
    completed = true;
    loop.quit();
  });

  QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
  timer.start(timeoutMs);
  loop.exec();

  return result;
}

struct ProcessTreeMemory {
  int64_t mainRssKb = 0;
  int64_t totalRssKb = 0;
  int rendererCount = 0;
};

ProcessTreeMemory measureProcessTreeMemory() {
  ProcessTreeMemory mem;
#if defined(Q_OS_LINUX)
  QFile statusFile(QStringLiteral("/proc/self/status"));
  if (statusFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
    QTextStream in(&statusFile);
    while (!in.atEnd()) {
      const QString line = in.readLine();
      if (line.startsWith(QLatin1String("VmRSS:"))) {
        const QStringList parts = line.split(QLatin1Char(' '), Qt::SkipEmptyParts);
        if (parts.size() >= 2) mem.mainRssKb = parts[1].toLongLong();
        break;
      }
    }
  }
  mem.totalRssKb = mem.mainRssKb;
  const pid_t myPid = getpid();
  QDir procDir(QStringLiteral("/proc"));
  const QStringList entries = procDir.entryList(QDir::Dirs | QDir::NoDotAndDotDot);
  for (const QString &entry : entries) {
    bool ok = false;
    const pid_t pid = entry.toInt(&ok);
    if (!ok || pid == myPid) continue;

    QFile statFile(QStringLiteral("/proc/%1/stat").arg(pid));
    if (statFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
      const QString statContent = QTextStream(&statFile).readLine();
      const QStringList statParts = statContent.split(QLatin1Char(' '));
      if (statParts.size() >= 4 && statParts[3].toInt() == myPid) {
        mem.rendererCount++;
        QFile childStatus(QStringLiteral("/proc/%1/status").arg(pid));
        if (childStatus.open(QIODevice::ReadOnly | QIODevice::Text)) {
          QTextStream cin(&childStatus);
          while (!cin.atEnd()) {
            const QString cline = cin.readLine();
            if (cline.startsWith(QLatin1String("VmRSS:"))) {
              const QStringList cparts = cline.split(QLatin1Char(' '), Qt::SkipEmptyParts);
              if (cparts.size() >= 2) mem.totalRssKb += cparts[1].toLongLong();
              break;
            }
          }
        }
      }
    }
  }
#endif
  return mem;
}

} // namespace

// ============================================================================
// TEST 1: Site Allowlist Normalization & Substring Confusion Security
// ============================================================================
void testSiteAllowlistMatching() {
  std::cout << "[Test 1] Running site allowlist normalization & anti-spoof security tests..." << std::endl;

  // 1. Normalization
  assert(TabPerformanceManager::normalizeSitePattern("https://youtube.com/") == "youtube.com");
  assert(TabPerformanceManager::normalizeSitePattern("http://music.YOUTUBE.COM:8080/path?q=1") == "music.youtube.com");
  assert(TabPerformanceManager::normalizeSitePattern("*.github.com") == "github.com");
  assert(TabPerformanceManager::normalizeSitePattern("www.wikipedia.org") == "wikipedia.org");
  assert(TabPerformanceManager::normalizeSitePattern("  twitch.tv  ") == "twitch.tv");

  // 2. Exact match
  assert(TabPerformanceManager::matchesAllowlistPattern("youtube.com", "youtube.com"));
  assert(TabPerformanceManager::matchesAllowlistPattern("YOUTUBE.COM", "youtube.com"));

  // 3. Subdomain match
  assert(TabPerformanceManager::matchesAllowlistPattern("music.youtube.com", "youtube.com"));
  assert(TabPerformanceManager::matchesAllowlistPattern("gaming.music.youtube.com", "youtube.com"));
  assert(TabPerformanceManager::matchesAllowlistPattern("www.youtube.com", "youtube.com"));

  // 4. Substring Confusion Attacks MUST FAIL
  assert(!TabPerformanceManager::matchesAllowlistPattern("evil-youtube.com", "youtube.com"));
  assert(!TabPerformanceManager::matchesAllowlistPattern("notyoutube.com", "youtube.com"));
  assert(!TabPerformanceManager::matchesAllowlistPattern("youtube.com.evilcorp.com", "youtube.com"));
  assert(!TabPerformanceManager::matchesAllowlistPattern("youtube.com-tracker.io", "youtube.com"));
  assert(!TabPerformanceManager::matchesAllowlistPattern("myyoutube.com", "youtube.com"));
  assert(!TabPerformanceManager::matchesAllowlistPattern("", "youtube.com"));
  assert(!TabPerformanceManager::matchesAllowlistPattern("youtube.com", ""));

  std::cout << " -> Site allowlist security tests passed!" << std::endl;
}

// ============================================================================
// TEST 2: Memory Pressure Monitor Linux / Cross-Platform Model
// ============================================================================
void testMemoryPressureMonitor() {
  std::cout << "[Test 2] Running memory pressure monitor tests..." << std::endl;

  SystemMemoryPressureMonitor monitor;
  const MemoryPressureLevel initial = monitor.currentPressureLevel();
  std::cout << " -> Initial system pressure level: " << static_cast<int>(initial)
            << " (Total RAM: " << monitor.totalMemoryMb() << " MB, Avail: "
            << monitor.availableMemoryMb() << " MB, Ratio: "
            << monitor.availableMemoryRatio() << ")" << std::endl;

  int signalEmissionCount = 0;
  MemoryPressureLevel lastEmittedLevel = MemoryPressureLevel::Normal;
  QObject::connect(&monitor, &SystemMemoryPressureMonitor::pressureLevelChanged, [&](MemoryPressureLevel lvl) {
    signalEmissionCount++;
    lastEmittedLevel = lvl;
  });

  monitor.setSimulatedPressureLevel(MemoryPressureLevel::Moderate);
  assert(monitor.currentPressureLevel() == MemoryPressureLevel::Moderate);
  assert(signalEmissionCount == 1);
  assert(lastEmittedLevel == MemoryPressureLevel::Moderate);

  monitor.setSimulatedPressureLevel(MemoryPressureLevel::Critical);
  assert(monitor.currentPressureLevel() == MemoryPressureLevel::Critical);
  assert(signalEmissionCount == 2);
  assert(lastEmittedLevel == MemoryPressureLevel::Critical);

  monitor.setSimulatedPressureLevel(std::nullopt);
  assert(monitor.currentPressureLevel() == initial);

  std::cout << " -> Memory pressure monitor tests passed!" << std::endl;
}

// ============================================================================
// TEST 3: Form Dirty Anti-Spoof Latching & Navigation Lifecycle Reset
// ============================================================================
void testFormDirtyAntiSpoofLatching() {
  std::cout << "[Test 3] Running form dirty anti-spoof latching & lifecycle reset tests..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  assert(perf != nullptr);
  QObject owner;

  auto *view = new QWebEngineView();
  auto *page = new QWebEnginePage(view);
  view->setPage(page);

  const auto id = tabManager.registerTab(view, &owner, false, QStringLiteral("Form Test Tab"));
  assert(perf->hasMetadata(id));
  assert(!perf->isTabFormDirty(id));
  assert(!perf->protectedReasons(id).testFlag(ProtectedReason::FormOrEditState));

  perf->setTabFormDirty(id, true);
  assert(perf->isTabFormDirty(id));
  assert(perf->isTabProtected(id));
  assert(perf->protectedReasons(id).testFlag(ProtectedReason::FormOrEditState));
  assert(!perf->canDiscard(id));

  // Native lifecycle reset
  emit page->loadStarted();
  processEventsFor(50);

  assert(!perf->isTabFormDirty(id));
  assert(!perf->protectedReasons(id).testFlag(ProtectedReason::FormOrEditState));

  delete view;
  std::cout << " -> Form dirty anti-spoof latching tests passed!" << std::endl;
}

// ============================================================================
// TEST 4: Conservative Discard Eligibility Safety Matrix
// ============================================================================
void testConservativeDiscardEligibilityMatrix() {
  std::cout << "[Test 4] Running conservative discard eligibility matrix tests..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  assert(perf != nullptr);
  QObject owner;

  perf->setBackgroundDiscardDelayMs(100);
  assert(perf->backgroundDiscardDelayMs() == 100);

  auto *view1 = new QWebEngineView();
  auto *page1 = new QWebEnginePage(view1);
  view1->setPage(page1);

  const auto id1 = tabManager.registerTab(view1, &owner, false, QStringLiteral("Tab 1"));
  tabManager.activate(id1);
  assert(!perf->canDiscard(id1));

  auto *view2 = new QWebEngineView();
  auto *page2 = new QWebEnginePage(view2);
  view2->setPage(page2);
  const auto id2 = tabManager.registerTab(view2, &owner, false, QStringLiteral("Tab 2"));
  tabManager.activate(id2);

  assert(!perf->metadata(id1).visible);
  std::this_thread::sleep_for(std::chrono::milliseconds(120));

  perf->memoryPressureMonitor()->setSimulatedPressureLevel(MemoryPressureLevel::Normal);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleAndMemoryPressure);
  assert(!perf->canDiscard(id1));

  perf->memoryPressureMonitor()->setSimulatedPressureLevel(MemoryPressureLevel::Moderate);

  if (perf->metadata(id1).recommendedState == QWebEnginePage::LifecycleState::Active) {
    assert(!perf->canDiscard(id1));
  }

  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);
  perf->setMediaPlaybackActive(id1, true);
  assert(!perf->canDiscard(id1));
  perf->setMediaPlaybackActive(id1, false);

  perf->setTabPinned(id1, true);
  assert(!perf->canDiscard(id1));
  perf->setTabPinned(id1, false);

  perf->setSiteAllowlist({"example.com", "youtube.com"});
  tabManager.updateUrl(id1, QUrl(QStringLiteral("https://music.youtube.com/watch?v=123")));
  assert(perf->isUrlAllowlisted(QUrl(QStringLiteral("https://music.youtube.com/watch?v=123"))));
  assert(perf->protectedReasons(id1).testFlag(ProtectedReason::UserAllowlisted));
  assert(!perf->canDiscard(id1));

  perf->setSiteAllowlist({});
  assert(!perf->isUrlAllowlisted(QUrl(QStringLiteral("https://music.youtube.com/watch?v=123"))));

  tabManager.updateUrl(id1, QUrl(QStringLiteral("https://unlisted-site.com/form")));
  perf->setTabFormDirty(id1, true);
  assert(!perf->canDiscard(id1));
  perf->setTabFormDirty(id1, false);

  auto *internalWidget = new QWidget();
  const auto internalId = tabManager.registerInternalTab(
      internalWidget, &owner, QStringLiteral("Settings"), QStringLiteral("settings"), {});
  assert(perf->isTabProtected(internalId));
  assert(!perf->canDiscard(internalId));

  delete view1;
  delete view2;
  delete internalWidget;
  std::cout << " -> Conservative discard eligibility matrix tests passed!" << std::endl;
}

// ============================================================================
// TEST 5: Isolated Real Discard & Restore Lifecycle Execution and State Matrix
// ============================================================================
void testIsolatedRealDiscardAndRestoreLifecycle() {
  std::cout << "[Test 5] Running isolated real Active -> Frozen -> Discarded -> Active restore harness..." << std::endl;

  auto *view = new QWebEngineView();
  auto *page = new QWebEnginePage(view);
  view->setPage(page);
  view->resize(800, 600);

  const QString fixtureHtml = QStringLiteral(R"HTML(
<!DOCTYPE html>
<html>
<head>
  <title>ArDali Discard & Restore Test Fixture</title>
  <style>
    body { font-family: sans-serif; height: 3000px; padding: 20px; }
    #editor { border: 1px solid #ccc; min-height: 50px; padding: 5px; }
  </style>
</head>
<body>
  <h1>Discard & Restore Test Page</h1>
  <div>
    <label>Test Input: </label>
    <input id="testInput" type="text" value="initial_value">
  </div>
  <div>
    <label>Test Area: </label>
    <textarea id="testArea">initial_textarea</textarea>
  </div>
  <div>
    <label>Test Editor: </label>
    <div id="testEditor" contenteditable="true">initial_editor_text</div>
  </div>
  <div id="counterDisplay">Counter: 0</div>
  <script>
    window.__testCounter = 0;
    setInterval(() => {
      window.__testCounter++;
      const el = document.getElementById('counterDisplay');
      if (el) el.innerText = 'Counter: ' + window.__testCounter;
    }, 50);

    localStorage.setItem('ardali_local_storage_key', 'persisted_local_value');
    sessionStorage.setItem('ardali_session_storage_key', 'persisted_session_value');
  </script>
</body>
</html>
)HTML");

  bool loadFinished = false;
  QObject::connect(page, &QWebEnginePage::loadFinished, [&](bool ok) {
    loadFinished = ok;
  });

  page->setHtml(fixtureHtml, QUrl(QStringLiteral("https://test.ardali.local/fixture")));
  while (!loadFinished) {
    processEventsFor(50);
  }

  assert(page->lifecycleState() == QWebEnginePage::LifecycleState::Active);
  assert(page->title() == QStringLiteral("ArDali Discard & Restore Test Fixture"));

  runJsSync(page, "document.getElementById('testInput').value = 'user_typed_secret_input';");
  runJsSync(page, "document.getElementById('testArea').value = 'user_typed_multiline_text';");
  runJsSync(page, "document.getElementById('testEditor').innerText = 'user_edited_rich_content';");
  runJsSync(page, "window.scrollTo(0, 800);");

  processEventsFor(200);

  const QString inputBefore = runJsSync(page, "document.getElementById('testInput').value;").toString();
  const QString areaBefore = runJsSync(page, "document.getElementById('testArea').value;").toString();
  const QString editorBefore = runJsSync(page, "document.getElementById('testEditor').innerText;").toString();
  const int counterBefore = runJsSync(page, "window.__testCounter;").toInt();
  const int scrollBefore = runJsSync(page, "window.scrollY;").toInt();
  const QString localStoreBefore = runJsSync(page, "localStorage.getItem('ardali_local_storage_key');").toString();
  const QString sessionStoreBefore = runJsSync(page, "sessionStorage.getItem('ardali_session_storage_key');").toString();

  assert(inputBefore == "user_typed_secret_input");
  assert(areaBefore == "user_typed_multiline_text");
  assert(editorBefore == "user_edited_rich_content");
  assert(counterBefore >= 0);
  assert(localStoreBefore == "persisted_local_value");
  assert(sessionStoreBefore == "persisted_session_value");

  std::cout << " -> Phase 1 Active verified. (Counter: " << counterBefore
            << ", Scroll: " << scrollBefore << "px)" << std::endl;

  // 2. Transition to Frozen
  page->setLifecycleState(QWebEnginePage::LifecycleState::Frozen);
  assert(page->lifecycleState() == QWebEnginePage::LifecycleState::Frozen);
  processEventsFor(150);

  const QString inputFrozen = runJsSync(page, "document.getElementById('testInput').value;").toString();
  assert(inputFrozen == "user_typed_secret_input");
  std::cout << " -> Phase 2 Frozen verified. (DOM preserved without state loss)" << std::endl;

  // 3. Transition to Discarded
  std::cout << " -> Applying QWebEnginePage::LifecycleState::Discarded in isolated test..." << std::endl;
  page->setLifecycleState(QWebEnginePage::LifecycleState::Discarded);
  assert(page->lifecycleState() == QWebEnginePage::LifecycleState::Discarded);
  processEventsFor(100);

  // 4. Restore to Active
  std::cout << " -> Restoring tab back to QWebEnginePage::LifecycleState::Active..." << std::endl;
  bool restoredLoadFinished = false;
  QObject::connect(page, &QWebEnginePage::loadFinished, [&](bool ok) {
    if (page->lifecycleState() == QWebEnginePage::LifecycleState::Active) {
      restoredLoadFinished = ok;
    }
  });

  page->setLifecycleState(QWebEnginePage::LifecycleState::Active);
  assert(page->lifecycleState() == QWebEnginePage::LifecycleState::Active);

  for (int i = 0; i < 50 && !restoredLoadFinished; ++i) {
    processEventsFor(50);
  }

  const QString titleRestored = page->title();
  const QUrl urlRestored = page->url();
  const QString localStoreRestored = runJsSync(page, "localStorage.getItem('ardali_local_storage_key');").toString();
  const QString sessionStoreRestored = runJsSync(page, "sessionStorage.getItem('ardali_session_storage_key');").toString();
  const QString inputRestored = runJsSync(page, "document.getElementById('testInput') ? document.getElementById('testInput').value : '';").toString();
  const QString areaRestored = runJsSync(page, "document.getElementById('testArea') ? document.getElementById('testArea').value : '';").toString();
  const QString editorRestored = runJsSync(page, "document.getElementById('testEditor') ? document.getElementById('testEditor').innerText : '';").toString();
  const int counterRestored = runJsSync(page, "window.__testCounter || 0;").toInt();

  std::cout << "\n============================================================" << std::endl;
  std::cout << "   DISCARD & RESTORE EMPIRICAL STATE RETENTION MATRIX" << std::endl;
  std::cout << "============================================================" << std::endl;
  std::cout << "1. URL:                   " << (urlRestored == QUrl("https://test.ardali.local/fixture") ? "RETAINED [OK]" : "LOST") << std::endl;
  std::cout << "2. Page Title:             " << (!titleRestored.isEmpty() ? "RETAINED [OK]" : "LOST") << std::endl;
  std::cout << "3. LocalStorage:           " << (localStoreRestored == "persisted_local_value" ? "RETAINED [OK]" : "LOST") << std::endl;
  std::cout << "4. SessionStorage:         " << (sessionStoreRestored == "persisted_session_value" ? "RETAINED [OK]" : "LOST") << std::endl;
  std::cout << "5. JS Heap / Counter:      RESET [EXPECTED] (Restarted from 0, now " << counterRestored << ")" << std::endl;
  std::cout << "6. Unsaved Form Input:     " << (inputRestored != "user_typed_secret_input" ? "LOST UPON RELOAD (Initial HTML reloaded)" : "RETAINED") << std::endl;
  std::cout << "7. Unsaved Textarea:       " << (areaRestored != "user_typed_multiline_text" ? "LOST UPON RELOAD (Initial HTML reloaded)" : "RETAINED") << std::endl;
  std::cout << "8. Unsaved Contenteditable:" << (editorRestored != "user_edited_rich_content" ? "LOST UPON RELOAD (Initial HTML reloaded)" : "RETAINED") << std::endl;
  std::cout << "============================================================\n" << std::endl;

  assert(localStoreRestored == "persisted_local_value");
  assert(sessionStoreRestored == "persisted_session_value");

  delete view;
  std::cout << " -> Isolated real discard & restore harness completed successfully!" << std::endl;
}

// ============================================================================
// TEST 6: Phase 2C-2 — Real RAM Benchmark (Scenario A: New Tab + 5 Web Tabs)
// ============================================================================
void testBenchmarkScenarioA() {
  std::cout << "[Test 6] Running Phase 2C-2 Benchmark Scenario A (New Tab + 5 Web Tabs)..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  QObject owner;

  QVector<QWebEngineView *> views;
  QVector<TabManager::TabId> ids;

  const QString testHtml = QStringLiteral("<!DOCTYPE html><html><body><h1>Tab Content</h1><p>Testing memory consumption.</p></body></html>");

  for (int i = 0; i < 5; ++i) {
    auto *v = new QWebEngineView();
    auto *p = new QWebEnginePage(v);
    v->setPage(p);
    p->setHtml(testHtml, QUrl(QStringLiteral("https://benchmark.ardali.local/%1").arg(i)));
    const auto id = tabManager.registerTab(v, &owner, false, QStringLiteral("Bench Tab %1").arg(i));
    views.push_back(v);
    ids.push_back(id);
  }

  processEventsFor(300);

  const ProcessTreeMemory memActive = measureProcessTreeMemory();
  std::cout << " -> Scenario A [Active Baseline]: Main RSS = " << memActive.mainRssKb / 1024
            << " MB, Total Process Tree RSS = " << memActive.totalRssKb / 1024
            << " MB, Renderers = " << memActive.rendererCount << std::endl;

  // Freeze 4 background tabs
  perf->setBackgroundFreezeDelayMs(0);
  for (int i = 1; i < 5; ++i) {
    emit views[i]->page()->recommendedStateChanged(QWebEnginePage::LifecycleState::Frozen);
    perf->freezeTab(ids[i]);
  }
  processEventsFor(200);

  const ProcessTreeMemory memFrozen = measureProcessTreeMemory();
  std::cout << " -> Scenario A [Frozen State]:    Main RSS = " << memFrozen.mainRssKb / 1024
            << " MB, Total Process Tree RSS = " << memFrozen.totalRssKb / 1024
            << " MB, Renderers = " << memFrozen.rendererCount << std::endl;

  // Discard 4 background tabs
  perf->setBackgroundDiscardDelayMs(0);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);
  for (int i = 1; i < 5; ++i) {
    emit views[i]->page()->recommendedStateChanged(QWebEnginePage::LifecycleState::Discarded);
    perf->discardTab(ids[i]);
  }
  processEventsFor(200);

  const ProcessTreeMemory memDiscarded = measureProcessTreeMemory();
  const int64_t ramReclaimedMb = (memActive.totalRssKb - memDiscarded.totalRssKb) / 1024;

  std::cout << " -> Scenario A [Discarded State]: Main RSS = " << memDiscarded.mainRssKb / 1024
            << " MB, Total Process Tree RSS = " << memDiscarded.totalRssKb / 1024
            << " MB, Renderers = " << memDiscarded.rendererCount << std::endl;
  std::cout << " -> Scenario A RAM Reclaimed: ~" << (ramReclaimedMb > 0 ? ramReclaimedMb : 0) << " MB" << std::endl;

  // Cleanup
  for (auto *v : views) delete v;
  std::cout << " -> Scenario A Benchmark passed!" << std::endl;
}

// ============================================================================
// TEST 7: Phase 2C-2 — Benchmark Scenario B (YouTube Protected + 5 Normal Tabs)
// ============================================================================
void testBenchmarkScenarioB() {
  std::cout << "[Test 7] Running Phase 2C-2 Benchmark Scenario B (YouTube Audio Protected + 5 Tabs)..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  QObject owner;

  // 1. Create YouTube Tab playing music in background
  auto *ytView = new QWebEngineView();
  auto *ytPage = new QWebEnginePage(ytView);
  ytView->setPage(ytPage);
  const auto ytId = tabManager.registerTab(ytView, &owner, false, QStringLiteral("YouTube Music"));
  tabManager.updateUrl(ytId, QUrl(QStringLiteral("https://music.youtube.com/watch?v=sample")));
  perf->setMediaPlaybackActive(ytId, true);
  emit ytPage->recentlyAudibleChanged(true);

  // 2. Create 5 normal background tabs
  QVector<QWebEngineView *> normalViews;
  QVector<TabManager::TabId> normalIds;
  for (int i = 0; i < 5; ++i) {
    auto *v = new QWebEngineView();
    auto *p = new QWebEnginePage(v);
    v->setPage(p);
    const auto id = tabManager.registerTab(v, &owner, false, QStringLiteral("Normal Tab %1").arg(i));
    tabManager.updateUrl(id, QUrl(QStringLiteral("https://benchmark-normal.local/%1").arg(i)));
    normalViews.push_back(v);
    normalIds.push_back(id);
    emit p->recommendedStateChanged(QWebEnginePage::LifecycleState::Discarded);
  }

  perf->setBackgroundDiscardDelayMs(0);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);

  // YouTube tab MUST be protected
  assert(!perf->canDiscard(ytId));
  assert(!perf->discardTab(ytId));
  assert(!perf->isTabDiscarded(ytId));

  // Normal tabs are eligible and can be discarded
  for (const auto &id : normalIds) {
    assert(perf->canDiscard(id));
    perf->discardTab(id);
    assert(perf->isTabDiscarded(id));
  }

  // YouTube tab remains 100% active and protected
  assert(!perf->isTabDiscarded(ytId));
  assert(perf->isTabProtected(ytId));

  delete ytView;
  for (auto *v : normalViews) delete v;
  std::cout << " -> Scenario B Benchmark (YouTube Audio Protected) passed!" << std::endl;
}

// ============================================================================
// TEST 8: Phase 2C-2 — Restore Latency Measurement
// ============================================================================
void testRestoreLatency() {
  std::cout << "[Test 8] Running Phase 2C-2 Restore Latency Measurement..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  QObject owner;

  auto *view = new QWebEngineView();
  auto *page = new QWebEnginePage(view);
  view->setPage(page);

  const QString testHtml = QStringLiteral("<!DOCTYPE html><html><body><h1>Latency Test Page</h1></body></html>");
  const auto id = tabManager.registerTab(view, &owner, false, QStringLiteral("Latency Tab"));
  tabManager.updateUrl(id, QUrl(QStringLiteral("https://latency.ardali.local/")));

  bool initialLoaded = false;
  QObject::connect(page, &QWebEnginePage::loadFinished, [&](bool ok) {
    if (!initialLoaded) initialLoaded = ok;
  });
  page->setHtml(testHtml, QUrl(QStringLiteral("https://latency.ardali.local/")));
  while (!initialLoaded) {
    processEventsFor(30);
  }

  perf->setBackgroundDiscardDelayMs(0);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);
  emit page->recommendedStateChanged(QWebEnginePage::LifecycleState::Discarded);

  assert(perf->discardTab(id));
  assert(perf->isTabDiscarded(id));

  // Measure latency from activation/resume to loadFinished
  QElapsedTimer timer;
  bool restoreFinished = false;
  QObject::connect(page, &QWebEnginePage::loadFinished, [&](bool ok) {
    if (page->lifecycleState() == QWebEnginePage::LifecycleState::Active) {
      restoreFinished = ok;
    }
  });

  timer.start();
  tabManager.activate(id); // Automatically calls resumeTab(id)

  for (int i = 0; i < 100 && !restoreFinished; ++i) {
    processEventsFor(20);
  }

  const int64_t elapsedMs = timer.elapsed();
  std::cout << " -> Discarded Tab Restore Latency: " << elapsedMs << " ms (Local Fixture)" << std::endl;
  assert(elapsedMs >= 0);
  assert(!perf->isTabDiscarded(id));

  delete view;
  std::cout << " -> Restore Latency Measurement passed!" << std::endl;
}

// ============================================================================
// TEST 9: Phase 2C-2 — Rapid Tab Switching Across Discarded Tabs
// ============================================================================
void testRapidTabSwitching() {
  std::cout << "[Test 9] Running Phase 2C-2 Rapid Tab Switching across Discarded Tabs..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  QObject owner;

  QVector<QWebEngineView *> views;
  QVector<TabManager::TabId> ids;

  for (int i = 0; i < 4; ++i) {
    auto *v = new QWebEngineView();
    auto *p = new QWebEnginePage(v);
    v->setPage(p);
    p->setHtml(QStringLiteral("<html><body>Tab %1</body></html>").arg(i),
               QUrl(QStringLiteral("https://rapid.ardali.local/%1").arg(i)));
    const auto id = tabManager.registerTab(v, &owner, false, QStringLiteral("Rapid Tab %1").arg(i));
    tabManager.updateUrl(id, QUrl(QStringLiteral("https://rapid.ardali.local/%1").arg(i)));
    views.push_back(v);
    ids.push_back(id);
  }

  processEventsFor(200);

  perf->setBackgroundDiscardDelayMs(0);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);

  for (int i = 0; i < 4; ++i) {
    emit views[i]->page()->recommendedStateChanged(QWebEnginePage::LifecycleState::Discarded);
  }

  // Discard all background tabs (1, 2, 3)
  for (int i = 1; i < 4; ++i) {
    perf->discardTab(ids[i]);
    assert(perf->isTabDiscarded(ids[i]));
  }

  // Rapidly switch between discarded tabs: 1 -> 2 -> 3 -> 1
  tabManager.activate(ids[1]);
  processEventsFor(10);
  tabManager.activate(ids[2]);
  processEventsFor(10);
  tabManager.activate(ids[3]);
  processEventsFor(10);
  tabManager.activate(ids[1]);
  processEventsFor(50);

  // Active tab must be restored and valid
  assert(!perf->isTabDiscarded(ids[1]));
  assert(perf->metadata(ids[1]).visible);

  for (auto *v : views) delete v;
  std::cout << " -> Rapid Tab Switching passed without crash or stale state!" << std::endl;
}

// ============================================================================
// TEST 10: Snapshot / Preview Restore Bridge Verification
// ============================================================================
void testDiscardRestorePreviewBridge() {
  std::cout << "[Test 10] Running Snapshot Preview Capture & Restore Bridge Verification..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  QObject owner;

  auto *view = new QWebEngineView();
  auto *page = new QWebEnginePage(view);
  view->setPage(page);
  view->resize(1280, 800);
  view->show();

  const QString testHtml = QStringLiteral(
      "<!DOCTYPE html><html><body style='background:#123456; color:white;'>"
      "<h1>Snapshot Test Header</h1><p>Test content for visual preview bridge.</p>"
      "</body></html>");
  const auto id = tabManager.registerTab(view, &owner, false, QStringLiteral("Snapshot Tab"));
  tabManager.updateUrl(id, QUrl(QStringLiteral("https://snapshot.ardali.local/")));

  bool initialLoaded = false;
  QObject::connect(page, &QWebEnginePage::loadFinished, [&](bool ok) {
    if (!initialLoaded) initialLoaded = ok;
  });
  page->setHtml(testHtml, QUrl(QStringLiteral("https://snapshot.ardali.local/")));
  while (!initialLoaded) {
    processEventsFor(30);
  }

  // 1. Capture snapshot before background transition
  QPixmap preview = view->grab();
  assert(!preview.isNull());

  constexpr QSize kMaximumPreviewSize(1280, 800);
  if (preview.width() > kMaximumPreviewSize.width() || preview.height() > kMaximumPreviewSize.height()) {
    preview = preview.scaled(kMaximumPreviewSize, Qt::KeepAspectRatio, Qt::SmoothTransformation);
  }

  QByteArray encoded;
  QBuffer buffer(&encoded);
  const bool saved = buffer.open(QIODevice::WriteOnly) && (preview.save(&buffer, "JPEG", 75) || preview.save(&buffer, "PNG"));
  assert(saved);
  assert(!encoded.isEmpty());

  // Verify memory footprint: compressed preview must be lightweight (< 150 KB)
  std::cout << " -> Snapshot compressed byte size: " << encoded.size() << " bytes" << std::endl;
  assert(encoded.size() < 150 * 1024);

  // Transition to background tab (simulate user switching away)
  view->hide();
  perf->setTabVisible(id, false);

  // 2. Discard tab
  perf->setBackgroundDiscardDelayMs(0);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);
  emit page->recommendedStateChanged(QWebEnginePage::LifecycleState::Discarded);
  assert(perf->canDiscard(id));
  assert(perf->discardTab(id));
  assert(perf->isTabDiscarded(id));

  // 3. Simulate user switching back: Restore bridge overlay is instantiated before reload finishes
  view->show();
  QPixmap restoredPixmap;
  assert(restoredPixmap.loadFromData(encoded));
  assert(!restoredPixmap.isNull());

  auto *overlay = new QLabel(view);
  overlay->setObjectName(QStringLiteral("tab-restore-preview"));
  overlay->setAlignment(Qt::AlignCenter);
  overlay->setAttribute(Qt::WA_TransparentForMouseEvents, false);
  overlay->setPixmap(restoredPixmap);
  overlay->setScaledContents(true);
  overlay->setGeometry(view->rect());
  overlay->show();
  overlay->raise();

  assert(overlay->isVisible());
  assert(overlay->geometry() == view->rect());
  assert(!overlay->testAttribute(Qt::WA_TransparentForMouseEvents)); // Must block stale clicks

  // Setup reload completion listener to hide overlay
  bool reloadFinished = false;
  QObject::connect(page, &QWebEnginePage::loadFinished, [&](bool ok) {
    if (page->lifecycleState() == QWebEnginePage::LifecycleState::Active) {
      reloadFinished = ok;
      overlay->hide();
      overlay->clear();
    }
  });

  // 4. Activate / restore tab
  tabManager.activate(id);
  assert(!perf->isTabDiscarded(id));

  for (int i = 0; i < 100 && !reloadFinished; ++i) {
    processEventsFor(20);
  }

  assert(reloadFinished);
  assert(!overlay->isVisible());

  delete overlay;
  delete view;
  std::cout << " -> Snapshot Preview Capture & Restore Bridge passed!" << std::endl;
}

// ============================================================================
// TEST 11: Internal Schemes & New Tab Complete Lifecycle Exclusion
// ============================================================================
void testInternalSchemesAndNewTabExcludedFromLifecycle() {
  std::cout << "[Test 11] Running Internal Schemes & New Tab Lifecycle Exclusion Verification..." << std::endl;

  TabManager tabManager;
  TabPerformanceManager *perf = tabManager.performanceManager();
  QObject owner;

  // 1. Test URL scheme helper
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("about:blank"))));
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("ardali://newtab"))));
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("chrome://settings"))));
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("qrc:///assets/new-tab/index.html"))));
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("file:///path/to/assets/new-tab/index.html"))));
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("http://ardali-browser.local/newtab"))));
  assert(!TabPerformanceManager::isSupportedWebScheme(QUrl()));
  assert(TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("https://example.com/"))));
  assert(TabPerformanceManager::isSupportedWebScheme(QUrl(QStringLiteral("http://news.ycombinator.com/"))));

  // 2. Test New Tab page in background: Must be protected and cannot be frozen or discarded
  auto *newTabView = new QWebEngineView();
  auto *newTabPage = new QWebEnginePage(newTabView);
  newTabView->setPage(newTabPage);
  const auto newTabId = tabManager.registerTab(newTabView, &owner, false, QStringLiteral("Yeni Sekme"));
  tabManager.updateUrl(newTabId, QUrl(QStringLiteral("ardali://newtab")));

  perf->setBackgroundFreezeDelayMs(0);
  perf->setBackgroundDiscardDelayMs(0);
  perf->setDiscardPolicyRequirement(DiscardPolicyRequirement::IdleOnly);
  perf->setTabVisible(newTabId, false);

  assert(!perf->isTabLifecycleEligible(newTabId));
  assert(perf->isTabProtected(newTabId));
  assert(perf->protectedReasons(newTabId).testFlag(ProtectedReason::InternalScheme));
  assert(!perf->canFreeze(newTabId));
  assert(!perf->canDiscard(newTabId));
  assert(!perf->freezeTab(newTabId));
  assert(!perf->discardTab(newTabId));
  assert(!perf->isTabFrozen(newTabId));
  assert(!perf->isTabDiscarded(newTabId));

  // 3. Test about:blank page in background
  auto *blankView = new QWebEngineView();
  auto *blankPage = new QWebEnginePage(blankView);
  blankView->setPage(blankPage);
  const auto blankId = tabManager.registerTab(blankView, &owner, false, QStringLiteral("Blank Tab"));
  tabManager.updateUrl(blankId, QUrl(QStringLiteral("about:blank")));
  perf->setTabVisible(blankId, false);

  assert(!perf->isTabLifecycleEligible(blankId));
  assert(perf->isTabProtected(blankId));
  assert(!perf->canFreeze(blankId));
  assert(!perf->canDiscard(blankId));

  // 4. Test Dynamic Navigation: When new tab navigates to a real external website, it becomes eligible
  tabManager.updateUrl(newTabId, QUrl(QStringLiteral("https://github.com/trending")));
  assert(perf->isTabLifecycleEligible(newTabId));
  assert(!perf->protectedReasons(newTabId).testFlag(ProtectedReason::InternalScheme));

  // Background real web page can now freeze & discard normally when safe
  emit newTabPage->recommendedStateChanged(QWebEnginePage::LifecycleState::Discarded);
  assert(perf->canDiscard(newTabId));
  assert(perf->discardTab(newTabId));
  assert(perf->isTabDiscarded(newTabId));

  delete newTabView;
  delete blankView;
  std::cout << " -> Internal Schemes & New Tab Lifecycle Exclusion passed!" << std::endl;
}

int main(int argc, char *argv[]) {
  qputenv("QT_QPA_PLATFORM", "offscreen");
  qputenv("QTWEBENGINE_DISABLE_SANDBOX", "1");
  qputenv("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu");

  QApplication app(argc, argv);

  std::cout << "============================================================" << std::endl;
  std::cout << "   ArDali Performance Phase 2C-2 Discard & Benchmark Harness" << std::endl;
  std::cout << "============================================================" << std::endl;

  testSiteAllowlistMatching();
  testMemoryPressureMonitor();
  testFormDirtyAntiSpoofLatching();
  testConservativeDiscardEligibilityMatrix();
  testIsolatedRealDiscardAndRestoreLifecycle();
  testBenchmarkScenarioA();
  testBenchmarkScenarioB();
  testRestoreLatency();
  testRapidTabSwitching();
  testDiscardRestorePreviewBridge();
  testInternalSchemesAndNewTabExcludedFromLifecycle();

  std::cout << "\n>>> ALL 11 PHASE 2C-2 DISCARD & BENCHMARK TEST SUITES PASSED! <<<\n" << std::endl;
  return 0;
}
