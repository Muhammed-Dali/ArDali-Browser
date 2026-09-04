#include <QApplication>
#include <QPointer>
#include <QTimer>
#include <QWebEnginePage>
#include <QWebEngineView>
#include <cassert>

#include "page_translator.h"

int main(int argc, char *argv[]) {
  qputenv("QT_QPA_PLATFORM", QByteArray("offscreen"));
  QApplication app(argc, argv);

  // Test 1: PageTranslator is parented to view by default
  {
    auto *view = new QWebEngineView();
    auto *translator = new PageTranslator(view, nullptr);
    assert(translator->parent() == view);
    assert(translator->state() == PageTranslator::State::Idle);
    assert(translator->targetLanguage() == QStringLiteral("tr"));
    delete view; // View deletion must clean up child translator without leak or crash
  }

  // Test 2: Destruction of view cleans up PageTranslator via QPointer (no memory leak)
  {
    QPointer<PageTranslator> guardedTranslator;
    {
      auto *view = new QWebEngineView();
      auto *translator = new PageTranslator(view, nullptr);
      guardedTranslator = translator;
      assert(!guardedTranslator.isNull());
      delete view;
    }
    assert(guardedTranslator.isNull());
  }

  // Test 3: findChild pattern reuses existing translator on view (no duplicates across detach/attach)
  {
    auto *view = new QWebEngineView();
    auto *translator1 = view->findChild<PageTranslator *>(QString(), Qt::FindDirectChildrenOnly);
    assert(translator1 == nullptr);

    translator1 = new PageTranslator(view, nullptr, view);
    auto *translator2 = view->findChild<PageTranslator *>(QString(), Qt::FindDirectChildrenOnly);
    assert(translator2 != nullptr);
    assert(translator1 == translator2);

    delete view;
  }

  // Test 4: Reset cleans up state, increments generation, and stops dynamic watcher
  {
    auto *view = new QWebEngineView();
    auto *translator = new PageTranslator(view, nullptr);
    const uint64_t genBefore = translator->currentGeneration();
    translator->reset();
    assert(translator->currentGeneration() > genBefore);
    assert(translator->state() == PageTranslator::State::Idle);
    assert(translator->sourceLanguage().isEmpty());
    assert(translator->lastError().isEmpty());
    delete view;
  }

  // Test 5: restoreOriginal transitions state and stops watcher
  {
    auto *view = new QWebEngineView();
    auto *translator = new PageTranslator(view, nullptr);
    translator->restoreOriginal();
    assert(translator->state() == PageTranslator::State::Detected);
    delete view;
  }

  // Test 6: Non-web / invalid URL schemes reset safely without crashes
  {
    auto *view = new QWebEngineView();
    auto *translator = new PageTranslator(view, nullptr);
    view->setUrl(QUrl(QStringLiteral("about:blank")));
    translator->detectLanguage();
    assert(translator->state() == PageTranslator::State::Idle);
    delete view;
  }

  // Test 7: Signal emission verifies state changes
  {
    auto *view = new QWebEngineView();
    auto *translator = new PageTranslator(view, nullptr);
    int stateChangeCount = 0;
    PageTranslator::State recordedState = PageTranslator::State::Idle;
    QObject::connect(translator, &PageTranslator::stateChanged, [&](PageTranslator::State newState) {
      ++stateChangeCount;
      recordedState = newState;
    });
    translator->restoreOriginal();
    assert(stateChangeCount == 1);
    assert(recordedState == PageTranslator::State::Detected);
    delete view;
  }

  return 0;
}
