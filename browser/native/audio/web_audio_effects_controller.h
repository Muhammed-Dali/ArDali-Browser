#pragma once

#include <QObject>
#include <QHash>
#include <QPointer>
#include <QSet>
#include <QString>
#include <QTimer>
#include <QVector>

class QWebEngineView;

#include "../desktop_tabs/tab_performance_manager.h"

class WebAudioEffectsController final : public QObject {
  Q_OBJECT

 public:
  struct Status {
    bool engineAvailable = false;
    bool enabled = true;
    int attachedMediaCount = 0;
    QVector<int> sampleRates;
    QString detail;
  };

  explicit WebAudioEffectsController(QObject *parent = nullptr);
  ~WebAudioEffectsController() override;

  bool enabled() const { return enabled_; }
  double preampDb() const { return preampDb_; }
  static const QVector<int> &equalizerFrequencies();
  QVector<double> equalizerBands() const { return equalizerBands_; }
  double equalizerBand(int index) const;
  bool isEqualizerActive() const;
  double bassDb() const { return bassDb_; }
  double midDb() const { return midDb_; }
  double trebleDb() const { return trebleDb_; }
  bool isToneActive() const;
  double stereoExpanderPercent() const { return stereoExpanderPercent_; }
  double balance() const { return balance_; }
  bool isSpatialActive() const;
  QString acousticSpace() const { return acousticSpace_; }
  // Module state is deliberately separate from the master Web DSP switch.
  // Stages 3-6 give Reverb, Dynamic Compressor, Limiter and Bass Enhancer processing
  // implementations; the same persistence surface is reserved for later stages.
  bool moduleEnabled(const QString &moduleId) const;
  bool reverbEnabled() const;
  double reverbRoomSizeMs() const { return reverbRoomSizeMs_; }
  double reverbDamping() const { return reverbDamping_; }
  double reverbWetDryDb() const { return reverbWetDryDb_; }
  double reverbHfRatio() const { return reverbHfRatio_; }
  double reverbInputGainDb() const { return reverbInputGainDb_; }
  QString reverbPreset() const { return reverbPreset_; }
  bool compressorEnabled() const;
  double compressorThresholdDb() const { return compressorThresholdDb_; }
  double compressorRatio() const { return compressorRatio_; }
  double compressorAttackMs() const { return compressorAttackMs_; }
  double compressorReleaseMs() const { return compressorReleaseMs_; }
  double compressorMakeupDb() const { return compressorMakeupDb_; }
  double compressorKneeDb() const { return compressorKneeDb_; }
  QString compressorPreset() const { return compressorPreset_; }
  bool limiterEnabled() const;
  double limiterCeilingDb() const { return limiterCeilingDb_; }
  double limiterReleaseMs() const { return limiterReleaseMs_; }
  double limiterLookaheadMs() const { return limiterLookaheadMs_; }
  double limiterGainDb() const { return limiterGainDb_; }
  QString limiterPreset() const { return limiterPreset_; }
  bool bassEnhancerEnabled() const;
  double bassEnhancerFrequencyHz() const { return bassEnhancerFrequencyHz_; }
  double bassEnhancerGainDb() const { return bassEnhancerGainDb_; }
  double bassEnhancerHarmonicsPercent() const { return bassEnhancerHarmonicsPercent_; }
  double bassEnhancerWidth() const { return bassEnhancerWidth_; }
  double bassEnhancerMixPercent() const { return bassEnhancerMixPercent_; }
  bool bassEnhancerDeep() const { return bassEnhancerDeep_; }
  bool autoGainEnabled() const;
  double autoGainTargetDbfs() const { return autoGainTargetDbfs_; }
  double autoGainMaxGainDb() const { return autoGainMaxGainDb_; }
  QString autoGainSpeed() const { return autoGainSpeed_; }
  QString autoGainPreset() const { return autoGainPreset_; }
  ardali::PerformancePolicyMode performancePolicyMode() const { return policyMode_; }
  bool isPanelVisible() const { return panelVisible_; }
  QString activeSubpanelId() const { return activeSubpanelId_; }
  Status status() const { return status_; }

  void registerWebView(QWebEngineView *view);
  void applyToView(QWebEngineView *view);

 public slots:
  void setEnabled(bool enabled);
  void setPreampDb(double db);
  void resetOutput();
  void setEqualizerBand(int index, double db);
  // A preset preview must affect the live WebAudio graph but must not write
  // QSettings.  Keeping this operation on the controller prevents a second
  // EQ state from drifting away from the DSP state.
  void previewEqualizerBands(const QVector<double> &bands);
  void commitEqualizerBands(const QVector<double> &bands);
  void setBassDb(double db);
  void setMidDb(double db);
  void setTrebleDb(double db);
  void setStereoExpanderPercent(double percent);
  void setBalance(double value);
  void setAcousticSpace(const QString &space);
  void resetEqualizer();
  void resetEqualizerModule();
  void setModuleEnabled(const QString &moduleId, bool enabled);
  void setReverbEnabled(bool enabled);
  void setReverbRoomSizeMs(double value);
  void setReverbDamping(double value);
  void setReverbWetDryDb(double value);
  void setReverbHfRatio(double value);
  void setReverbInputGainDb(double value);
  void applyReverbPreset(const QString &presetId);
  void resetReverb();
  void setCompressorEnabled(bool enabled);
  void setCompressorThresholdDb(double value);
  void setCompressorRatio(double value);
  void setCompressorAttackMs(double value);
  void setCompressorReleaseMs(double value);
  void setCompressorMakeupDb(double value);
  void setCompressorKneeDb(double value);
  void applyCompressorPreset(const QString &presetId);
  void resetCompressor();
  void requestCompressorGainReduction();
  void setLimiterEnabled(bool enabled);
  void setLimiterCeilingDb(double value);
  void setLimiterReleaseMs(double value);
  void setLimiterLookaheadMs(double value);
  void setLimiterGainDb(double value);
  void applyLimiterPreset(const QString &presetId);
  void resetLimiter();
  void requestLimiterReduction();
  void setBassEnhancerEnabled(bool enabled);
  void setBassEnhancerFrequencyHz(double value);
  void setBassEnhancerGainDb(double value);
  void setBassEnhancerHarmonicsPercent(double value);
  void setBassEnhancerWidth(double value);
  void setBassEnhancerMixPercent(double value);
  void applyBassEnhancerDeep();
  void resetBassEnhancer();
  void setAutoGainEnabled(bool enabled);
  void setAutoGainTargetDbfs(double value);
  void setAutoGainMaxGainDb(double value);
  void applyAutoGainPreset(const QString &presetId);
  void resetAutoGain();
  void setPerformancePolicyMode(ardali::PerformancePolicyMode mode);
  void setPanelVisible(bool visible, const QString &activeSubpanelId = QString());
  void applyToAllWebViews();
  QString injectionScript() const;
  QString parameterUpdateScript() const;
  QString equalizerBandUpdateScript(int index) const;

 signals:
  void stateChanged();
  void statusChanged(const WebAudioEffectsController::Status &status);
  void compressorGainReductionChanged(double reductionDb, bool available);
  void limiterReductionChanged(double reductionDb, bool available);

 private:
  QString daliModuleSource() const;
  QString daliEqModuleSource() const;
  QString daliCompressorModuleSource() const;
  QString daliLimiterModuleSource() const;
  QString daliBassEnhancerModuleSource() const;
  QString daliAutoGainModuleSource() const;
  void applyEqualizerBandToView(QWebEngineView *view, int index);
  void bootstrapView(QWebEngineView *view);
  void installDocumentBootstrap(QWebEngineView *view);
  void updateStatusFromResult(const QVariant &result);
  void persist();
  void schedulePersist();
  void scheduleApply();
  void scheduleReverbStateChange(bool clearPreset);
  void scheduleCompressorStateChange(bool clearPreset);
  void scheduleLimiterStateChange(bool clearPreset);
  void scheduleBassEnhancerStateChange(bool clearDeep);
  void scheduleAutoGainStateChange();

  QVector<QPointer<QWebEngineView>> views_;
  QSet<QWebEngineView *> bootstrapViews_;
  QSet<int> pendingEqualizerBands_;
  quint64 masterEnableGeneration_ = 0;
  bool forceFullReapply_ = false;
  bool enabled_ = true;
  double preampDb_ = 0.0;
  QVector<double> equalizerBands_;
  double bassDb_ = 0.0;
  double midDb_ = 0.0;
  double trebleDb_ = 0.0;
  double stereoExpanderPercent_ = 100.0;
  double balance_ = 0.0;
  QString acousticSpace_ = QStringLiteral("off");
  QHash<QString, bool> moduleEnabledStates_;
  double reverbRoomSizeMs_ = 1000.0;
  double reverbDamping_ = 0.5;
  double reverbWetDryDb_ = -10.0;
  double reverbHfRatio_ = 0.7;
  double reverbInputGainDb_ = 0.0;
  QString reverbPreset_;
  double compressorThresholdDb_ = -20.0;
  double compressorRatio_ = 4.0;
  double compressorAttackMs_ = 10.0;
  double compressorReleaseMs_ = 100.0;
  double compressorMakeupDb_ = 0.0;
  double compressorKneeDb_ = 3.0;
  QString compressorPreset_;
  bool compressorMeterRequestPending_ = false;
  quint64 compressorMeterRequestGeneration_ = 0;
  double limiterCeilingDb_ = -0.3;
  double limiterReleaseMs_ = 50.0;
  double limiterLookaheadMs_ = 5.0;
  double limiterGainDb_ = 0.0;
  QString limiterPreset_;
  bool limiterMeterRequestPending_ = false;
  quint64 limiterMeterRequestGeneration_ = 0;
  double bassEnhancerFrequencyHz_ = 80.0;
  double bassEnhancerGainDb_ = 6.0;
  double bassEnhancerHarmonicsPercent_ = 50.0;
  double bassEnhancerWidth_ = 1.5;
  double bassEnhancerMixPercent_ = 50.0;
  bool bassEnhancerDeep_ = false;
  double autoGainTargetDbfs_ = -14.0;
  double autoGainMaxGainDb_ = 12.0;
  QString autoGainSpeed_ = QStringLiteral("medium");
  QString autoGainPreset_ = QStringLiteral("balanced");
  ardali::PerformancePolicyMode policyMode_ = ardali::PerformancePolicyMode::Balanced;
  bool panelVisible_ = false;
  QString activeSubpanelId_;
  Status status_;
  mutable QString daliModuleSource_;
  mutable QString daliEqModuleSource_;
  mutable QString daliCompressorModuleSource_;
  mutable QString daliLimiterModuleSource_;
  mutable QString daliBassEnhancerModuleSource_;
  mutable QString daliAutoGainModuleSource_;
  QTimer persistTimer_;
  QTimer applyTimer_;
  friend int main(int argc, char *argv[]);
};

Q_DECLARE_METATYPE(WebAudioEffectsController::Status)
