#pragma once

#include <QDateTime>
#include <QHash>
#include <QObject>
#include <QString>
#include <QVector>

#include <algorithm>

class BrowserProfileService;
class GeneralDownloadManager;
class MediaDownloadService;
class QTimer;

enum class DownloadUiSource { General, Media, NativeFallback };
enum class DownloadUiState { Queued, Downloading, Paused, Processing, Completed, Failed, Cancelled };

struct DownloadUiItem {
  QString key;
  QString title;
  QString subtitle;
  QString localPath;
  DownloadUiSource source = DownloadUiSource::General;
  DownloadUiState state = DownloadUiState::Queued;
  qint64 downloadedBytes = 0;
  qint64 totalBytes = 0;
  qint64 bytesPerSecond = 0;
  qint64 etaSeconds = -1;
  double percent = 0.0;
  QDateTime createdAt;
  QString statusText;
  bool converting = false;
};

class DownloadUiModel final : public QObject {
  Q_OBJECT
 public:
  explicit DownloadUiModel(BrowserProfileService *profile,
                           MediaDownloadService *media,
                           QObject *parent = nullptr);

  QVector<DownloadUiItem> items() const;
  static int activeCountForItems(const QVector<DownloadUiItem> &items) {
    return std::count_if(items.cbegin(), items.cend(), [](const auto &item) {
      return item.state == DownloadUiState::Queued || item.state == DownloadUiState::Downloading
          || item.state == DownloadUiState::Processing;
    });
  }
  static double aggregateProgressForItems(const QVector<DownloadUiItem> &items) {
    long double downloaded = 0.0;
    long double total = 0.0;
    double percentSum = 0.0;
    int percentCount = 0;
    bool hasUnknownTotal = false;
    for (const auto &item : items) {
      const bool tracked = item.state == DownloadUiState::Queued
          || item.state == DownloadUiState::Downloading || item.state == DownloadUiState::Paused
          || item.state == DownloadUiState::Processing;
      if (!tracked) continue;
      if (item.totalBytes > 0) {
        downloaded += std::clamp<qint64>(item.downloadedBytes, 0, item.totalBytes);
        total += item.totalBytes;
        percentSum += 100.0 * std::clamp<qint64>(item.downloadedBytes, 0, item.totalBytes)
            / item.totalBytes;
        ++percentCount;
      } else {
        hasUnknownTotal = true;
        percentSum += item.percent;
        ++percentCount;
      }
    }
    if (hasUnknownTotal)
      return percentCount ? std::clamp(percentSum / percentCount, 0.0, 100.0) : 0.0;
    if (total > 0.0)
      return std::clamp(static_cast<double>(downloaded / total) * 100.0, 0.0, 100.0);
    return percentCount ? std::clamp(percentSum / percentCount, 0.0, 100.0) : 0.0;
  }
  int activeCount() const;
  double aggregateProgress() const;
  bool hasPaused() const;
  bool hasErrors() const;
  bool hasRecentCompletion() const;

  bool pause(const QString &key);
  bool resume(const QString &key);
  bool cancel(const QString &key);
  bool retry(const QString &key);
  bool remove(const QString &key);

 signals:
  void changed();
  void downloadStarted(const QString &key);
  void downloadCompleted(const QString &key);
  void downloadFailed(const QString &key);

 private:
  void scheduleRefresh();
  void refresh();
  QString stateSignature(const DownloadUiItem &item) const;

  BrowserProfileService *profile_ = nullptr;
  GeneralDownloadManager *general_ = nullptr;
  MediaDownloadService *media_ = nullptr;
  QTimer *coalesceTimer_ = nullptr;
  QVector<DownloadUiItem> items_;
  QHash<QString, QString> knownStates_;
  bool initialized_ = false;
};
