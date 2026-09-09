#include "downloads/download_ui_model.h"

#include <QCoreApplication>

#include <cassert>
#include <cmath>
#include <iostream>

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);

  DownloadUiItem general;
  general.key = QStringLiteral("g:one");
  general.source = DownloadUiSource::General;
  general.state = DownloadUiState::Downloading;
  general.downloadedBytes = 50;
  general.totalBytes = 100;
  general.percent = 50.0;

  DownloadUiItem media;
  media.key = QStringLiteral("m:two");
  media.source = DownloadUiSource::Media;
  media.state = DownloadUiState::Downloading;
  media.downloadedBytes = 150;
  media.totalBytes = 300;
  media.percent = 50.0;

  QVector<DownloadUiItem> simultaneous{general, media};
  assert(DownloadUiModel::activeCountForItems(simultaneous) == 2);
  assert(std::abs(DownloadUiModel::aggregateProgressForItems(simultaneous) - 50.0) < 0.001);

  general.downloadedBytes = 0;
  media.downloadedBytes = 0;
  assert(DownloadUiModel::aggregateProgressForItems({general, media}) == 0.0);
  general.downloadedBytes = 100;
  media.downloadedBytes = 300;
  assert(DownloadUiModel::aggregateProgressForItems({general, media}) == 100.0);

  media.state = DownloadUiState::Paused;
  assert(DownloadUiModel::activeCountForItems({general, media}) == 1);
  general.state = DownloadUiState::Completed;
  assert(DownloadUiModel::activeCountForItems({general, media}) == 0);

  DownloadUiItem unknownGeneral;
  unknownGeneral.state = DownloadUiState::Downloading;
  unknownGeneral.percent = 25.0;
  DownloadUiItem unknownMedia;
  unknownMedia.state = DownloadUiState::Processing;
  unknownMedia.percent = 75.0;
  assert(std::abs(DownloadUiModel::aggregateProgressForItems({unknownGeneral, unknownMedia}) - 50.0) < 0.001);
  general.downloadedBytes = 50;
  general.state = DownloadUiState::Downloading;
  assert(std::abs(DownloadUiModel::aggregateProgressForItems({general, unknownGeneral}) - 37.5) < 0.001);

  std::cout << "unified general/media active count and weighted toolbar progress (0/50/100): ok\n";
  return 0;
}
