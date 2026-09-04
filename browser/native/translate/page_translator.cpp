#include "page_translator.h"
#include "language_detector.h"
#include "translate_service.h"
#include "translate_engine_script.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QWebEnginePage>
#include <QWebEngineScript>

namespace {
constexpr int kMaxBatchSize = 40;
constexpr int kMutationPollIntervalMs = 400;
}

PageTranslator::PageTranslator(QWebEngineView *view, TranslateService *service, QObject *parent)
    : QObject(parent ? parent : static_cast<QObject *>(view)), view_(view), service_(service) {}

PageTranslator::~PageTranslator() {
  stopDynamicMutationWatcher();
}

PageTranslator::State PageTranslator::state() const {
  return state_;
}

QString PageTranslator::sourceLanguage() const {
  return sourceLanguage_;
}

QString PageTranslator::targetLanguage() const {
  return targetLanguage_;
}

QString PageTranslator::lastError() const {
  return lastError_;
}

uint64_t PageTranslator::currentGeneration() const {
  return currentGeneration_;
}

void PageTranslator::ensureScriptInjected() {
  if (!view_ || !view_->page()) return;
  view_->page()->runJavaScript(translateEngineScript(), QWebEngineScript::ApplicationWorld);
}

void PageTranslator::detectLanguage() {
  if (!view_ || !view_->page()) return;

  const QUrl url = view_->url();
  if (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https")) {
    reset();
    return;
  }

  ensureScriptInjected();

  const uint64_t generation = currentGeneration_;
  QPointer<PageTranslator> guardedThis(this);
  view_->page()->runJavaScript(
      QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.detect() : null;"),
      QWebEngineScript::ApplicationWorld,
      [guardedThis, generation](const QVariant &result) {
        if (!guardedThis || guardedThis->currentGeneration_ != generation) return;
        if (!result.isValid() || result.isNull()) return;

        const QVariantMap map = result.toMap();
        const QString htmlLang = map.value(QStringLiteral("htmlLang")).toString();
        const QString metaLang = map.value(QStringLiteral("metaLang")).toString();
        const QString sample = map.value(QStringLiteral("sampleText")).toString();

        const QString detected = LanguageDetector::detectLanguage(htmlLang, metaLang, sample);
        if (detected.isEmpty()) return;

        guardedThis->sourceLanguage_ = detected;
        if (LanguageDetector::isTranslatable(detected, guardedThis->targetLanguage_)) {
          guardedThis->state_ = State::Detected;
          emit guardedThis->languageDetected(detected, guardedThis->targetLanguage_);
          emit guardedThis->stateChanged(guardedThis->state_);
        }
      });
}

void PageTranslator::translatePage(const QString &targetLang) {
  if (!view_ || !view_->page() || !service_) return;
  if (!targetLang.isEmpty()) targetLanguage_ = targetLang;

  state_ = State::Translating;
  lastError_.clear();
  emit stateChanged(state_);

  ensureScriptInjected();

  const uint64_t generation = ++currentGeneration_;
  QPointer<PageTranslator> guardedThis(this);

  view_->page()->runJavaScript(
      QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.extractNodes() : null;"),
      QWebEngineScript::ApplicationWorld,
      [guardedThis, generation](const QVariant &result) {
        if (!guardedThis || guardedThis->currentGeneration_ != generation) return;
        if (!result.isValid() || result.isNull()) {
          guardedThis->state_ = State::Error;
          guardedThis->lastError_ = QStringLiteral("Sayfa metinleri ayıklanamadı.");
          emit guardedThis->translationFinished(false, guardedThis->lastError_);
          emit guardedThis->stateChanged(guardedThis->state_);
          return;
        }

        const QVariantList nodes = result.toMap().value(QStringLiteral("nodes")).toList();
        QList<BatchItem> items;
        items.reserve(nodes.size());

        for (const QVariant &item : nodes) {
          const QVariantMap m = item.toMap();
          items.append({
              m.value(QStringLiteral("id")).toInt(),
              m.value(QStringLiteral("text")).toString(),
              m.value(QStringLiteral("type")).toString(),
              m.value(QStringLiteral("attr")).toString()
          });
        }

        guardedThis->dispatchTranslationBatches(items, generation, false);
      });
}

void PageTranslator::dispatchTranslationBatches(const QList<BatchItem> &items, uint64_t generation, bool isDynamic) {
  if (items.isEmpty()) {
    if (!isDynamic) {
      state_ = State::Translated;
      if (view_ && view_->page()) {
        view_->page()->runJavaScript(
            QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.startObserving() : null;"),
            QWebEngineScript::ApplicationWorld);
      }
      startDynamicMutationWatcher();
      emit translationFinished(true, QString());
      emit stateChanged(state_);
    }
    return;
  }

  QList<QList<BatchItem>> batches;
  QList<BatchItem> currentBatch;

  for (const auto &item : items) {
    currentBatch.append(item);
    if (currentBatch.size() >= kMaxBatchSize) {
      batches.append(currentBatch);
      currentBatch.clear();
    }
  }
  if (!currentBatch.isEmpty()) batches.append(currentBatch);

  auto remaining = std::make_shared<int>(batches.size());
  auto hasFailed = std::make_shared<bool>(false);

  if (isDynamic) {
    isDynamicTranslating_ = true;
  }

  QPointer<PageTranslator> guardedThis(this);

  for (const auto &batch : batches) {
    QStringList texts;
    texts.reserve(batch.size());
    for (const auto &entry : batch) texts.append(entry.text);

    service_->translateBatch(
        texts, sourceLanguage_, targetLanguage_,
        [guardedThis, batch, remaining, hasFailed, generation, isDynamic](bool success, const QStringList &translated, const QString &err) {
          if (!guardedThis || guardedThis->currentGeneration_ != generation) return;

          if (!success || translated.size() != batch.size()) {
            if (!*hasFailed) {
              *hasFailed = true;
              if (!isDynamic) {
                guardedThis->state_ = State::Error;
                guardedThis->lastError_ = err.isEmpty() ? QStringLiteral("Çeviri servisi hatası.") : err;
                emit guardedThis->translationFinished(false, guardedThis->lastError_);
                emit guardedThis->stateChanged(guardedThis->state_);
              } else {
                guardedThis->isDynamicTranslating_ = false;
              }
            }
            return;
          }

          if (*hasFailed) return;

          // Build updates JSON array
          QJsonArray updates;
          for (int i = 0; i < batch.size(); ++i) {
            QJsonObject obj;
            obj.insert(QStringLiteral("id"), batch.at(i).id);
            obj.insert(QStringLiteral("translated"), translated.at(i));
            if (!batch.at(i).type.isEmpty()) obj.insert(QStringLiteral("type"), batch.at(i).type);
            if (!batch.at(i).attr.isEmpty()) obj.insert(QStringLiteral("attr"), batch.at(i).attr);
            updates.append(obj);
          }

          const QString jsCall = QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.applyTranslations(%1) : null;")
                                     .arg(QString::fromUtf8(QJsonDocument(updates).toJson(QJsonDocument::Compact)));

          if (guardedThis->view_ && guardedThis->view_->page()) {
            guardedThis->view_->page()->runJavaScript(jsCall, QWebEngineScript::ApplicationWorld);
          }

          (*remaining)--;
          if (*remaining == 0 && !*hasFailed) {
            if (isDynamic) {
              guardedThis->isDynamicTranslating_ = false;
            } else {
              guardedThis->state_ = State::Translated;
              if (guardedThis->view_ && guardedThis->view_->page()) {
                guardedThis->view_->page()->runJavaScript(
                    QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.startObserving() : null;"),
                    QWebEngineScript::ApplicationWorld);
              }
              guardedThis->startDynamicMutationWatcher();
              emit guardedThis->translationFinished(true, QString());
              emit guardedThis->stateChanged(guardedThis->state_);
            }
          }
        });
  }
}

void PageTranslator::startDynamicMutationWatcher() {
  if (!mutationPollTimer_) {
    mutationPollTimer_ = new QTimer(this);
    connect(mutationPollTimer_, &QTimer::timeout, this, &PageTranslator::processPendingMutations);
  }
  if (!mutationPollTimer_->isActive()) {
    mutationPollTimer_->start(kMutationPollIntervalMs);
  }
}

void PageTranslator::stopDynamicMutationWatcher() {
  if (mutationPollTimer_ && mutationPollTimer_->isActive()) {
    mutationPollTimer_->stop();
  }
  isDynamicTranslating_ = false;
}

void PageTranslator::processPendingMutations() {
  if (!view_ || !view_->page() || state_ != State::Translated || isDynamicTranslating_) return;

  const uint64_t generation = currentGeneration_;
  QPointer<PageTranslator> guardedThis(this);

  view_->page()->runJavaScript(
      QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.checkPendingMutations() : null;"),
      QWebEngineScript::ApplicationWorld,
      [guardedThis, generation](const QVariant &result) {
        if (!guardedThis || guardedThis->currentGeneration_ != generation) return;
        if (!result.isValid() || result.isNull()) return;

        const QVariantList nodes = result.toMap().value(QStringLiteral("nodes")).toList();
        if (nodes.isEmpty()) return;

        QList<BatchItem> items;
        items.reserve(nodes.size());
        for (const QVariant &item : nodes) {
          const QVariantMap m = item.toMap();
          items.append({
              m.value(QStringLiteral("id")).toInt(),
              m.value(QStringLiteral("text")).toString(),
              m.value(QStringLiteral("type")).toString(),
              m.value(QStringLiteral("attr")).toString()
          });
        }

        guardedThis->dispatchTranslationBatches(items, generation, true);
      });
}

void PageTranslator::handleSpaNavigation(const QUrl &newUrl) {
  Q_UNUSED(newUrl);
  if (state_ == State::Translated) {
    // Keep translated state active; trigger immediate mutation check
    processPendingMutations();
  } else if (state_ == State::Idle || state_ == State::Detected) {
    detectLanguage();
  }
}

void PageTranslator::restoreOriginal() {
  stopDynamicMutationWatcher();
  if (view_ && view_->page()) {
    view_->page()->runJavaScript(
        QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.restoreOriginal() : null;"),
        QWebEngineScript::ApplicationWorld);
  }

  state_ = State::Detected;
  emit stateChanged(state_);
}

void PageTranslator::reset() {
  stopDynamicMutationWatcher();
  currentGeneration_++;
  if (view_ && view_->page()) {
    view_->page()->runJavaScript(
        QStringLiteral("window.__ardaliTranslate ? window.__ardaliTranslate.reset() : null;"),
        QWebEngineScript::ApplicationWorld);
  }
  state_ = State::Idle;
  sourceLanguage_.clear();
  lastError_.clear();
  emit stateChanged(state_);
}
