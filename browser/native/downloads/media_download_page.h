#pragma once

#include <QWidget>

#include "media_download_service.h"

class BrowserProfileService;
class QLabel;
class QLineEdit;
class QPushButton;
class QComboBox;
class QCheckBox;
class QSpinBox;
class QNetworkAccessManager;
class QNetworkReply;
class QButtonGroup;
class QGridLayout;
class QLayout;
class QProgressBar;
class QToolButton;
class QVBoxLayout;

class MediaDownloadPage final : public QWidget {
  Q_OBJECT
 public:
  explicit MediaDownloadPage(MediaDownloadService *service,
                             BrowserProfileService *profileService,
                             QWidget *parent = nullptr);

  void setSourceUrl(const QUrl &url, bool analyzeImmediately = true);
  QUrl sourceUrl() const;

 private:
  void analyzeInput();
  void applyAnalysis(const MediaAnalysisResult &result);
  void setAnalysisLoading(bool loading, const QString &message = {});
  void setMode(const QString &mode);
  void refreshFormatChoices();
  void updateSelectionSummary();
  void refreshTargetDirectory();
  void startSelectedDownload();
  void refreshJobs();
  void refreshBrowserDownloads();
  QWidget *createJobCard(const MediaDownloadJob &job, QWidget *parent);
  void loadThumbnail(const QUrl &url);
  void exportHistory(bool csv);
  static void clearLayout(QLayout *layout);
  static QString formatBytes(qint64 bytes);

  MediaDownloadService *service_ = nullptr;
  BrowserProfileService *profileService_ = nullptr;
  QLineEdit *urlInput_ = nullptr;
  QPushButton *analyzeButton_ = nullptr;
  QPushButton *cancelAnalysisButton_ = nullptr;
  QLabel *statusLabel_ = nullptr;
  QProgressBar *analysisProgress_ = nullptr;
  QWidget *analysisCard_ = nullptr;
  QWidget *analysisOptions_ = nullptr;
  QLabel *thumbnailLabel_ = nullptr;
  QLabel *titleLabel_ = nullptr;
  QLabel *detailsLabel_ = nullptr;
  QPushButton *videoModeButton_ = nullptr;
  QPushButton *audioModeButton_ = nullptr;
  QComboBox *modeBox_ = nullptr;
  QComboBox *formatBox_ = nullptr;
  QLabel *formatHeading_ = nullptr;
  QWidget *formatChoices_ = nullptr;
  QGridLayout *formatChoicesLayout_ = nullptr;
  QButtonGroup *formatButtonGroup_ = nullptr;
  QComboBox *moreAudioFormats_ = nullptr;
  QComboBox *playlistActionBox_ = nullptr;
  QWidget *advancedOptions_ = nullptr;
  QPushButton *advancedToggle_ = nullptr;
  QLabel *selectionSummary_ = nullptr;
  QLabel *targetNameLabel_ = nullptr;
  QLabel *targetPathLabel_ = nullptr;
  QCheckBox *subtitlesBox_ = nullptr;
  QSpinBox *sectionStartBox_ = nullptr;
  QSpinBox *sectionEndBox_ = nullptr;
  QCheckBox *playlistBox_ = nullptr;
  QSpinBox *playlistStartBox_ = nullptr;
  QSpinBox *playlistEndBox_ = nullptr;
  QPushButton *downloadButton_ = nullptr;
  QVBoxLayout *activeJobsLayout_ = nullptr;
  QVBoxLayout *historyJobsLayout_ = nullptr;
  QVBoxLayout *browserDownloadsLayout_ = nullptr;
  QWidget *activeEmptyLabel_ = nullptr;
  QWidget *historyEmptyLabel_ = nullptr;
  QWidget *browserEmptyLabel_ = nullptr;
  QToolButton *exportButton_ = nullptr;
  QNetworkAccessManager *thumbnailNetwork_ = nullptr;
  QNetworkReply *thumbnailReply_ = nullptr;
  MediaAnalysisResult analysis_;
};
