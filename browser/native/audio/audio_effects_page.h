#pragma once

#include <QHash>
#include <QWidget>
#include <QTimer>
#include <QVector>

class QCheckBox;
class QComboBox;
class QDial;
class QHideEvent;
class QLabel;
class QListWidget;
class QProgressBar;
class QShowEvent;
class QStackedWidget;
class QSlider;
class WebAudioEffectsController;

class AudioEffectsPage final : public QWidget {
  Q_OBJECT

 public:
 explicit AudioEffectsPage(WebAudioEffectsController *controller, QWidget *parent = nullptr);

 signals:
  void eqPresetBrowserRequested();

 protected:
  void showEvent(QShowEvent *event) override;
  void hideEvent(QHideEvent *event) override;

 private:
  void createOutputPage();
  void createEqualizerPage();
  void createReverbPage();
  void createCompressorPage();
  void createLimiterPage();
  void createBassEnhancerPage();
  void createAutoGainPage();
  void createPlaceholderPages();
  void updateFromController();
  void scheduleControllerSync();
  void updateCompressorMeterPolling();
  void updateLimiterMeterPolling();
  void updateAutoGainStatusPolling();
  QString currentSubpanelId() const;

  WebAudioEffectsController *controller_ = nullptr;
  QCheckBox *globalToggle_ = nullptr;
  QCheckBox *reverbToggle_ = nullptr;
  QCheckBox *compressorToggle_ = nullptr;
  QCheckBox *limiterToggle_ = nullptr;
  QCheckBox *bassEnhancerToggle_ = nullptr;
  QCheckBox *autoGainToggle_ = nullptr;
  QLabel *statusLabel_ = nullptr;
  QListWidget *navigation_ = nullptr;
  QStackedWidget *pages_ = nullptr;
  QDial *preampDial_ = nullptr;
  QLabel *preampValue_ = nullptr;
  QVector<QSlider *> equalizerSliders_;
  QVector<QLabel *> equalizerValues_;
  QDial *bassDial_ = nullptr;
  QDial *midDial_ = nullptr;
  QDial *trebleDial_ = nullptr;
  QDial *stereoExpanderDial_ = nullptr;
  QLabel *bassValue_ = nullptr;
  QLabel *midValue_ = nullptr;
  QLabel *trebleValue_ = nullptr;
  QLabel *stereoExpanderValue_ = nullptr;
  QComboBox *acousticSpaceSelect_ = nullptr;
  QSlider *balanceSlider_ = nullptr;
  QLabel *balanceValue_ = nullptr;
  QHash<QString, QCheckBox *> moduleToggles_;
  QDial *reverbRoomSizeDial_ = nullptr;
  QDial *reverbDampingDial_ = nullptr;
  QDial *reverbWetDryDial_ = nullptr;
  QDial *reverbHfRatioDial_ = nullptr;
  QDial *reverbInputGainDial_ = nullptr;
  QLabel *reverbRoomSizeValue_ = nullptr;
  QLabel *reverbDampingValue_ = nullptr;
  QLabel *reverbWetDryValue_ = nullptr;
  QLabel *reverbHfRatioValue_ = nullptr;
  QLabel *reverbInputGainValue_ = nullptr;
  QDial *compressorThresholdDial_ = nullptr;
  QDial *compressorRatioDial_ = nullptr;
  QDial *compressorAttackDial_ = nullptr;
  QDial *compressorReleaseDial_ = nullptr;
  QDial *compressorMakeupDial_ = nullptr;
  QDial *compressorKneeDial_ = nullptr;
  QLabel *compressorThresholdValue_ = nullptr;
  QLabel *compressorRatioValue_ = nullptr;
  QLabel *compressorAttackValue_ = nullptr;
  QLabel *compressorReleaseValue_ = nullptr;
  QLabel *compressorMakeupValue_ = nullptr;
  QLabel *compressorKneeValue_ = nullptr;
  QLabel *compressorGainReductionValue_ = nullptr;
  QProgressBar *compressorGainReductionMeter_ = nullptr;
  QDial *limiterCeilingDial_ = nullptr;
  QDial *limiterReleaseDial_ = nullptr;
  QDial *limiterLookaheadDial_ = nullptr;
  QDial *limiterGainDial_ = nullptr;
  QLabel *limiterCeilingValue_ = nullptr;
  QLabel *limiterReleaseValue_ = nullptr;
  QLabel *limiterLookaheadValue_ = nullptr;
  QLabel *limiterGainValue_ = nullptr;
  QLabel *limiterReductionValue_ = nullptr;
  QProgressBar *limiterReductionMeter_ = nullptr;
  QDial *bassEnhancerFrequencyDial_ = nullptr;
  QDial *bassEnhancerGainDial_ = nullptr;
  QDial *bassEnhancerHarmonicsDial_ = nullptr;
  QDial *bassEnhancerWidthDial_ = nullptr;
  QDial *bassEnhancerMixDial_ = nullptr;
  QLabel *bassEnhancerFrequencyValue_ = nullptr;
  QLabel *bassEnhancerGainValue_ = nullptr;
  QLabel *bassEnhancerHarmonicsValue_ = nullptr;
  QLabel *bassEnhancerWidthValue_ = nullptr;
  QLabel *bassEnhancerMixValue_ = nullptr;
  QDial *autoGainTargetDial_ = nullptr;
  QDial *autoGainMaxGainDial_ = nullptr;
  QLabel *autoGainTargetValue_ = nullptr;
  QLabel *autoGainMaxGainValue_ = nullptr;
  QTimer controllerSyncTimer_;
  QTimer compressorMeterTimer_;
  QTimer limiterMeterTimer_;
  QTimer autoGainStatusTimer_;
};
