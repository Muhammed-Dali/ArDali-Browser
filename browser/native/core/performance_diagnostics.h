#pragma once

#include <QObject>
#include <QTimer>

class ArDaliBlockerService;
class SongRecognitionService;
class TabManager;
class WebAudioEffectsController;

class PerformanceDiagnostics final : public QObject {
  Q_OBJECT

 public:
  PerformanceDiagnostics(TabManager *tabManager, ArDaliBlockerService *blocker,
                         WebAudioEffectsController *audio,
                         SongRecognitionService *songFinder,
                         QObject *parent = nullptr);

  void start();
  void reportNow() const;

 private:
  TabManager *tabManager_ = nullptr;
  ArDaliBlockerService *blocker_ = nullptr;
  WebAudioEffectsController *audio_ = nullptr;
  SongRecognitionService *songFinder_ = nullptr;
  QTimer reportTimer_;
};
