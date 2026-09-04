#include "media_download_page.h"

#include "browser_icons.h"
#include "browser_profile_service.h"
#include "security_utils.h"

#include <QAction>
#include <QAbstractButton>
#include <QButtonGroup>
#include <QCheckBox>
#include <QClipboard>
#include <QComboBox>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFrame>
#include <QGridLayout>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLayout>
#include <QLineEdit>
#include <QMenu>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProgressBar>
#include <QPushButton>
#include <QPixmap>
#include <QSaveFile>
#include <QScrollArea>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QStandardPaths>
#include <QStyle>
#include <QStyleHints>
#include <QSet>
#include <QToolButton>
#include <QVBoxLayout>

#include <algorithm>

namespace {

QWidget *card(QWidget *parent, const QString &title, QVBoxLayout **content = nullptr,
              QWidget *headerAction = nullptr) {
  auto *widget = new QFrame(parent);
  widget->setObjectName(QStringLiteral("media-download-card"));
  auto *layout = new QVBoxLayout(widget);
  layout->setContentsMargins(20, 18, 20, 20);
  layout->setSpacing(13);
  auto *headingRow = new QHBoxLayout;
  headingRow->setSpacing(8);
  auto *heading = new QLabel(title, widget);
  heading->setObjectName(QStringLiteral("media-download-heading"));
  headingRow->addWidget(heading);
  headingRow->addStretch();
  if (headerAction) headingRow->addWidget(headerAction);
  layout->addLayout(headingRow);
  if (content) *content = layout;
  return widget;
}

bool terminalState(MediaDownloadState state) {
  return state == MediaDownloadState::Completed || state == MediaDownloadState::Failed
      || state == MediaDownloadState::Cancelled;
}

QString kindText(MediaDownloadKind kind) {
  switch (kind) {
    case MediaDownloadKind::Video: return QStringLiteral("Video");
    case MediaDownloadKind::AudioOriginal: return QStringLiteral("Orijinal ses");
    case MediaDownloadKind::AudioConvert: return QStringLiteral("Dönüştürülmüş ses");
    case MediaDownloadKind::PlaylistThumbnails: return QStringLiteral("Playlist kapakları");
    case MediaDownloadKind::PlaylistLinks: return QStringLiteral("Playlist bağlantıları");
  }
  return {};
}

QString stateProperty(MediaDownloadState state) {
  switch (state) {
    case MediaDownloadState::Queued: return QStringLiteral("queued");
    case MediaDownloadState::Downloading: return QStringLiteral("downloading");
    case MediaDownloadState::Processing: return QStringLiteral("processing");
    case MediaDownloadState::Completed: return QStringLiteral("completed");
    case MediaDownloadState::Failed: return QStringLiteral("failed");
    case MediaDownloadState::Cancelled: return QStringLiteral("cancelled");
  }
  return {};
}

QString friendlySource(QString source) {
  const QString lowered = source.toLower();
  if (lowered.contains(QStringLiteral("youtube"))) return QStringLiteral("YouTube");
  if (lowered.contains(QStringLiteral("tiktok"))) return QStringLiteral("TikTok");
  if (lowered.contains(QStringLiteral("facebook"))) return QStringLiteral("Facebook");
  if (lowered.contains(QStringLiteral("instagram"))) return QStringLiteral("Instagram");
  source.replace(QLatin1Char('_'), QLatin1Char(' '));
  return source.trimmed();
}

QString friendlyEngineStatus(const QString &message) {
  const QString lowered = message.toLower();
  if (lowered.contains(QStringLiteral("indiriliyor")) || lowered.contains(QStringLiteral("hazırlan")))
    return QStringLiteral("İndirme motoru hazırlanıyor…");
  if (lowered.contains(QStringLiteral("doğrulan")) || lowered.contains(QStringLiteral("bütünlük"))
      || lowered.contains(QStringLiteral("javascript")))
    return QStringLiteral("İndirme bileşeni doğrulanıyor…");
  if (lowered.contains(QStringLiteral("hazır")) || lowered.contains(QStringLiteral("güncel")))
    return QStringLiteral("İndirme motoru hazır.");
  if (lowered.contains(QStringLiteral("güncelleme başarısız")))
    return QStringLiteral("İndirme motoru güncellenemedi; mevcut bileşen kullanılacak.");
  return message;
}

QString friendlyFailure(const QString &message) {
  const QString lowered = message.toLower();
  if (lowered.contains(QStringLiteral("yt-dlp")) || lowered.contains(QStringLiteral("executable")))
    return QStringLiteral("İndirme motoru hazırlanamadı.");
  return message;
}

QString durationText(qint64 seconds) {
  if (seconds <= 0) return QStringLiteral("Süre bilinmiyor");
  const qint64 hours = seconds / 3600;
  const qint64 minutes = (seconds % 3600) / 60;
  const qint64 remainingSeconds = seconds % 60;
  if (hours > 0)
    return QStringLiteral("%1:%2:%3").arg(hours).arg(minutes, 2, 10, QLatin1Char('0'))
        .arg(remainingSeconds, 2, 10, QLatin1Char('0'));
  return QStringLiteral("%1:%2").arg(minutes).arg(remainingSeconds, 2, 10, QLatin1Char('0'));
}

QPushButton *actionButton(BrowserIcon icon, const QString &text, const QString &tooltip,
                          QWidget *parent, const char *role = nullptr) {
  auto *button = new QPushButton(BrowserIcons::icon(icon), text, parent);
  button->setToolTip(tooltip);
  button->setAccessibleName(tooltip);
  button->setMinimumHeight(36);
  if (role) button->setProperty(role, true);
  return button;
}

QWidget *emptyState(const QIcon &icon, const QString &title, const QString &description, QWidget *parent) {
  auto *container = new QWidget(parent);
  container->setObjectName(QStringLiteral("media-empty-state"));
  auto *layout = new QVBoxLayout(container);
  layout->setContentsMargins(16, 15, 16, 15);
  layout->setSpacing(7);
  auto *iconLabel = new QLabel(container);
  iconLabel->setObjectName(QStringLiteral("media-empty-icon"));
  iconLabel->setPixmap(icon.pixmap(28, 28));
  iconLabel->setAlignment(Qt::AlignCenter);
  auto *titleLabel = new QLabel(title, container);
  titleLabel->setObjectName(QStringLiteral("media-empty-title"));
  titleLabel->setAlignment(Qt::AlignCenter);
  auto *descriptionLabel = new QLabel(description, container);
  descriptionLabel->setObjectName(QStringLiteral("media-empty-description"));
  descriptionLabel->setAlignment(Qt::AlignCenter);
  descriptionLabel->setWordWrap(true);
  layout->addWidget(iconLabel);
  layout->addWidget(titleLabel);
  layout->addWidget(descriptionLabel);
  container->setAccessibleName(title + QStringLiteral(". ") + description);
  container->setMinimumHeight(120);
  return container;
}

}  // namespace

MediaDownloadPage::MediaDownloadPage(MediaDownloadService *service,
                                     BrowserProfileService *profileService,
                                     QWidget *parent)
    : QWidget(parent), service_(service), profileService_(profileService) {
  setObjectName(QStringLiteral("media-download-page"));
  setAccessibleName(QStringLiteral("İndirmeler ve medya indirici"));
  setProperty("lightTheme", QGuiApplication::styleHints()->colorScheme() == Qt::ColorScheme::Light);
  connect(QGuiApplication::styleHints(), &QStyleHints::colorSchemeChanged, this,
          [this](Qt::ColorScheme scheme) {
    setProperty("lightTheme", scheme == Qt::ColorScheme::Light);
    const QString sheet = styleSheet();
    setStyleSheet(QString{});
    setStyleSheet(sheet);
    update();
  });

  auto *outer = new QVBoxLayout(this);
  outer->setContentsMargins(0, 0, 0, 0);
  auto *scroll = new QScrollArea(this);
  scroll->setObjectName(QStringLiteral("media-download-scroll"));
  scroll->setWidgetResizable(true);
  scroll->setFrameShape(QFrame::NoFrame);
  scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  auto *content = new QWidget(scroll);
  content->setObjectName(QStringLiteral("media-download-content"));
  content->setMinimumWidth(360);
  auto *layout = new QVBoxLayout(content);
  layout->setContentsMargins(30, 26, 30, 36);
  layout->setSpacing(16);

  auto *hero = new QWidget(content);
  hero->setObjectName(QStringLiteral("media-download-hero"));
  auto *heroLayout = new QVBoxLayout(hero);
  heroLayout->setContentsMargins(2, 0, 2, 4);
  heroLayout->setSpacing(4);
  auto *heroTitle = new QLabel(QStringLiteral("İndirmeler"), hero);
  heroTitle->setObjectName(QStringLiteral("media-download-title"));
  auto *heroDescription = new QLabel(
      QStringLiteral("Bu sayfadaki medyayı tek tıkla indirin; bağlantı yapıştırma seçeneği her zaman elinizin altında."), hero);
  heroDescription->setObjectName(QStringLiteral("media-download-subtitle"));
  heroDescription->setWordWrap(true);
  heroLayout->addWidget(heroTitle);
  heroLayout->addWidget(heroDescription);
  layout->addWidget(hero);

  QVBoxLayout *sourceLayout = nullptr;
  QWidget *sourceCard = card(content, QStringLiteral("MEDYA İNDİR"), &sourceLayout);
  sourceCard->setObjectName(QStringLiteral("media-source-card"));
  auto *sourceHint = new QLabel(
      QStringLiteral("Bir bağlantı yapıştırın veya web sayfasındayken araç çubuğundaki İndir düğmesini kullanın."), sourceCard);
  sourceHint->setObjectName(QStringLiteral("media-source-hint"));
  sourceHint->setWordWrap(true);
  sourceLayout->addWidget(sourceHint);
  auto *sourceGrid = new QGridLayout;
  sourceGrid->setHorizontalSpacing(8);
  sourceGrid->setVerticalSpacing(9);
  urlInput_ = new QLineEdit(sourceCard);
  urlInput_->setObjectName(QStringLiteral("media-url-input"));
  urlInput_->setPlaceholderText(QStringLiteral("Medya bağlantısını buraya yapıştırın"));
  urlInput_->setAccessibleName(QStringLiteral("Medya bağlantısı"));
  urlInput_->setAccessibleDescription(QStringLiteral("HTTP veya HTTPS medya bağlantısı"));
  auto *paste = actionButton(BrowserIcon::Clipboard, QStringLiteral("Yapıştır"),
                             QStringLiteral("Panodaki bağlantıyı yapıştır ve analiz et"), sourceCard);
  paste->setObjectName(QStringLiteral("media-paste-button"));
  analyzeButton_ = actionButton(BrowserIcon::Search, QStringLiteral("Analiz Et"),
                                QStringLiteral("Bağlantıdaki medyayı analiz et"), sourceCard, "secondary");
  analyzeButton_->setObjectName(QStringLiteral("media-analyze-button"));
  cancelAnalysisButton_ = actionButton(BrowserIcon::Close, QStringLiteral("İptal"),
                                       QStringLiteral("Devam eden analizi iptal et"), sourceCard, "danger");
  cancelAnalysisButton_->setObjectName(QStringLiteral("media-cancel-analysis-button"));
  cancelAnalysisButton_->hide();
  sourceGrid->addWidget(urlInput_, 0, 0, 1, 3);
  sourceGrid->addWidget(paste, 1, 0);
  sourceGrid->addWidget(analyzeButton_, 1, 1);
  sourceGrid->addWidget(cancelAnalysisButton_, 1, 2);
  sourceGrid->setColumnStretch(2, 1);
  sourceLayout->addLayout(sourceGrid);
  auto *statusRow = new QHBoxLayout;
  statusRow->setSpacing(10);
  analysisProgress_ = new QProgressBar(sourceCard);
  analysisProgress_->setObjectName(QStringLiteral("media-analysis-progress"));
  analysisProgress_->setTextVisible(false);
  analysisProgress_->setRange(0, 0);
  analysisProgress_->setFixedSize(64, 5);
  analysisProgress_->hide();
  statusLabel_ = new QLabel(sourceCard);
  statusLabel_->setObjectName(QStringLiteral("media-status-label"));
  statusLabel_->setWordWrap(true);
  statusLabel_->setText(service_ && service_->ytDlpAvailable()
      ? QStringLiteral("İndirmeye hazır")
      : QStringLiteral("İndirme motoru ilk kullanımda otomatik hazırlanacak."));
  statusRow->addWidget(analysisProgress_, 0, Qt::AlignVCenter);
  statusRow->addWidget(statusLabel_, 1);
  sourceLayout->addLayout(statusRow);
  layout->addWidget(sourceCard);

  QVBoxLayout *analysisLayout = nullptr;
  analysisCard_ = card(content, QStringLiteral("İÇERİK VE İNDİRME SEÇENEKLERİ"), &analysisLayout);
  analysisCard_->setObjectName(QStringLiteral("media-analysis-card"));
  auto *summary = new QHBoxLayout;
  summary->setSpacing(16);
  thumbnailLabel_ = new QLabel(analysisCard_);
  thumbnailLabel_->setFixedSize(176, 100);
  thumbnailLabel_->setAlignment(Qt::AlignCenter);
  thumbnailLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Video).pixmap(40, 40));
  thumbnailLabel_->setAccessibleName(QStringLiteral("Medya önizlemesi"));
  thumbnailLabel_->setObjectName(QStringLiteral("media-thumbnail"));
  auto *summaryText = new QVBoxLayout;
  summaryText->setSpacing(5);
  titleLabel_ = new QLabel(analysisCard_);
  titleLabel_->setObjectName(QStringLiteral("media-title"));
  titleLabel_->setWordWrap(true);
  titleLabel_->setText(QStringLiteral("İçerik analiz ediliyor…"));
  detailsLabel_ = new QLabel(analysisCard_);
  detailsLabel_->setObjectName(QStringLiteral("media-details"));
  detailsLabel_->setWordWrap(true);
  detailsLabel_->setText(QStringLiteral("Başlık, süre ve kullanılabilir formatlar hazırlanıyor."));
  summaryText->addWidget(titleLabel_);
  summaryText->addWidget(detailsLabel_);
  summaryText->addStretch();
  summary->addWidget(thumbnailLabel_);
  summary->addLayout(summaryText, 1);
  analysisLayout->addLayout(summary);

  analysisOptions_ = new QWidget(analysisCard_);
  analysisOptions_->setObjectName(QStringLiteral("media-analysis-options"));
  auto *optionsLayout = new QVBoxLayout(analysisOptions_);
  optionsLayout->setContentsMargins(0, 6, 0, 0);
  optionsLayout->setSpacing(14);
  auto *typeLabel = new QLabel(QStringLiteral("Ne indirmek istiyorsunuz?"), analysisOptions_);
  typeLabel->setObjectName(QStringLiteral("media-option-label"));
  optionsLayout->addWidget(typeLabel);
  auto *typeRow = new QHBoxLayout;
  typeRow->setSpacing(8);
  videoModeButton_ = actionButton(BrowserIcon::Video, QStringLiteral("Video"),
                                  QStringLiteral("Videoyu görüntü ve ses olarak indir"), analysisOptions_);
  audioModeButton_ = actionButton(BrowserIcon::Music, QStringLiteral("Ses"),
                                  QStringLiteral("Yalnızca sesi indir"), analysisOptions_);
  for (QPushButton *button : {videoModeButton_, audioModeButton_}) {
    button->setCheckable(true);
    button->setProperty("segment", true);
    button->setMinimumHeight(44);
    typeRow->addWidget(button, 1);
  }
  videoModeButton_->setObjectName(QStringLiteral("media-video-mode"));
  audioModeButton_->setObjectName(QStringLiteral("media-audio-mode"));
  auto *typeGroup = new QButtonGroup(analysisOptions_);
  typeGroup->setExclusive(true);
  typeGroup->addButton(videoModeButton_);
  typeGroup->addButton(audioModeButton_);
  optionsLayout->addLayout(typeRow);

  modeBox_ = new QComboBox(analysisOptions_);
  modeBox_->setObjectName(QStringLiteral("media-internal-mode-model"));
  modeBox_->addItem(QStringLiteral("Video"), QStringLiteral("video"));
  modeBox_->addItem(QStringLiteral("Orijinal ses"), QStringLiteral("original"));
  for (const QString &format : {QStringLiteral("mp3"), QStringLiteral("m4a"), QStringLiteral("opus"),
                                QStringLiteral("wav"), QStringLiteral("flac"), QStringLiteral("alac")})
    modeBox_->addItem(QStringLiteral("Sadece ses · %1").arg(format.toUpper()), format);
  modeBox_->addItem(QStringLiteral("Playlist kapaklarını indir"), QStringLiteral("playlist-thumbnails"));
  modeBox_->addItem(QStringLiteral("Playlist bağlantılarını kaydet"), QStringLiteral("playlist-links"));
  modeBox_->hide();

  auto *audioFormatPanel = new QWidget(analysisOptions_);
  audioFormatPanel->setObjectName(QStringLiteral("audio-format-panel"));
  auto *audioFormatLayout = new QGridLayout(audioFormatPanel);
  audioFormatLayout->setContentsMargins(0, 0, 0, 0);
  audioFormatLayout->setHorizontalSpacing(8);
  audioFormatLayout->setVerticalSpacing(8);
  const QList<QPair<QString, QString>> primaryAudioFormats{
      {QStringLiteral("original"), QStringLiteral("Orijinal\nEn hızlı")},
      {QStringLiteral("mp3"), QStringLiteral("MP3\nEn uyumlu")},
      {QStringLiteral("m4a"), QStringLiteral("M4A\nYüksek kalite")},
      {QStringLiteral("opus"), QStringLiteral("Opus\nVerimli")}};
  auto *audioFormatGroup = new QButtonGroup(audioFormatPanel);
  audioFormatGroup->setExclusive(true);
  int audioColumn = 0;
  for (const auto &[mode, label] : primaryAudioFormats) {
    auto *button = new QPushButton(label, audioFormatPanel);
    button->setObjectName(QStringLiteral("media-audio-format-%1").arg(mode));
    button->setProperty("audioMode", mode);
    button->setProperty("formatChip", true);
    button->setCheckable(true);
    button->setMinimumHeight(58);
    button->setAccessibleName(label.section(QLatin1Char('\n'), 0, 0) + QStringLiteral(" ses formatı"));
    if (mode != QLatin1String("original") && !service_->ffmpegAvailable()) {
      button->setEnabled(false);
      button->setToolTip(QStringLiteral("Bu format için medya dönüştürme bileşeni gerekli."));
      button->setAccessibleDescription(QStringLiteral("Medya dönüştürme bileşeni kullanılamadığı için devre dışı"));
    }
    audioFormatGroup->addButton(button);
    audioFormatLayout->addWidget(button, 0, audioColumn++);
    connect(button, &QPushButton::clicked, this, [this, mode] { setMode(mode); });
  }
  moreAudioFormats_ = new QComboBox(audioFormatPanel);
  moreAudioFormats_->setObjectName(QStringLiteral("media-more-audio-formats"));
  moreAudioFormats_->setAccessibleName(QStringLiteral("Daha fazla ses formatı"));
  moreAudioFormats_->addItem(QStringLiteral("Daha fazla format"), QString{});
  moreAudioFormats_->addItem(QStringLiteral("WAV · Kayıpsız"), QStringLiteral("wav"));
  moreAudioFormats_->addItem(QStringLiteral("FLAC · Kayıpsız ve sıkıştırılmış"), QStringLiteral("flac"));
  moreAudioFormats_->addItem(QStringLiteral("ALAC · Apple kayıpsız"), QStringLiteral("alac"));
  moreAudioFormats_->setEnabled(service_->ffmpegAvailable());
  if (!service_->ffmpegAvailable())
    moreAudioFormats_->setToolTip(QStringLiteral("Ek ses formatları için medya dönüştürme bileşeni gerekli."));
  audioFormatLayout->addWidget(moreAudioFormats_, 1, 0, 1, 4);
  audioFormatPanel->hide();
  optionsLayout->addWidget(audioFormatPanel);

  formatHeading_ = new QLabel(QStringLiteral("Video kalitesi"), analysisOptions_);
  formatHeading_->setObjectName(QStringLiteral("media-option-label"));
  optionsLayout->addWidget(formatHeading_);
  formatChoices_ = new QWidget(analysisOptions_);
  formatChoices_->setObjectName(QStringLiteral("media-format-choices"));
  formatChoicesLayout_ = new QGridLayout(formatChoices_);
  formatChoicesLayout_->setContentsMargins(0, 0, 0, 0);
  formatChoicesLayout_->setHorizontalSpacing(8);
  formatChoicesLayout_->setVerticalSpacing(8);
  optionsLayout->addWidget(formatChoices_);

  advancedToggle_ = new QPushButton(QStringLiteral("Gelişmiş seçenekler"), analysisOptions_);
  advancedToggle_->setObjectName(QStringLiteral("media-advanced-toggle"));
  advancedToggle_->setCheckable(true);
  advancedToggle_->setToolTip(QStringLiteral("Codec, playlist, altyazı ve zaman aralığı seçeneklerini göster"));
  advancedToggle_->setAccessibleName(QStringLiteral("Gelişmiş indirme seçeneklerini göster"));
  advancedToggle_->setProperty("tertiary", true);
  optionsLayout->addWidget(advancedToggle_, 0, Qt::AlignLeft);

  advancedOptions_ = new QWidget(analysisOptions_);
  advancedOptions_->setObjectName(QStringLiteral("media-advanced-options"));
  auto *advancedLayout = new QGridLayout(advancedOptions_);
  advancedLayout->setContentsMargins(14, 13, 14, 14);
  advancedLayout->setHorizontalSpacing(10);
  advancedLayout->setVerticalSpacing(10);
  auto *detailsFormatLabel = new QLabel(QStringLiteral("Codec / container ayrıntısı"), advancedOptions_);
  formatBox_ = new QComboBox(advancedOptions_);
  formatBox_->setObjectName(QStringLiteral("media-format-details"));
  formatBox_->setAccessibleName(QStringLiteral("Ayrıntılı format seçimi"));
  advancedLayout->addWidget(detailsFormatLabel, 0, 0);
  advancedLayout->addWidget(formatBox_, 0, 1, 1, 3);
  subtitlesBox_ = new QCheckBox(QStringLiteral("Altyazıları da indir"), advancedOptions_);
  subtitlesBox_->setObjectName(QStringLiteral("media-subtitles-option"));
  subtitlesBox_->setAccessibleName(QStringLiteral("Mevcut altyazıları da indir"));
  advancedLayout->addWidget(subtitlesBox_, 1, 0, 1, 2);
  auto *sectionLabel = new QLabel(QStringLiteral("Zaman aralığı"), advancedOptions_);
  sectionStartBox_ = new QSpinBox(advancedOptions_);
  sectionStartBox_->setRange(0, 604800);
  sectionStartBox_->setSpecialValueText(QStringLiteral("Baştan"));
  sectionStartBox_->setPrefix(QStringLiteral("Başlangıç: "));
  sectionStartBox_->setAccessibleName(QStringLiteral("Bölüm başlangıcı, saniye"));
  sectionEndBox_ = new QSpinBox(advancedOptions_);
  sectionEndBox_->setRange(0, 604800);
  sectionEndBox_->setSpecialValueText(QStringLiteral("Sona kadar"));
  sectionEndBox_->setPrefix(QStringLiteral("Bitiş: "));
  sectionEndBox_->setAccessibleName(QStringLiteral("Bölüm bitişi, saniye"));
  advancedLayout->addWidget(sectionLabel, 2, 0);
  advancedLayout->addWidget(sectionStartBox_, 2, 1);
  advancedLayout->addWidget(sectionEndBox_, 2, 2, 1, 2);
  playlistBox_ = new QCheckBox(QStringLiteral("Tüm playlist'i indir"), advancedOptions_);
  playlistBox_->setObjectName(QStringLiteral("media-playlist-option"));
  playlistBox_->setToolTip(QStringLiteral("Kapalıyken playlist bağlantılarında yalnızca açık medya indirilir."));
  playlistBox_->setAccessibleName(QStringLiteral("Bağlantı bir playlist ise tümünü indir"));
  playlistStartBox_ = new QSpinBox(advancedOptions_);
  playlistStartBox_->setRange(1, 99999);
  playlistStartBox_->setValue(1);
  playlistStartBox_->setPrefix(QStringLiteral("İlk öğe: "));
  playlistEndBox_ = new QSpinBox(advancedOptions_);
  playlistEndBox_->setRange(0, 99999);
  playlistEndBox_->setSpecialValueText(QStringLiteral("Son öğe: tümü"));
  playlistEndBox_->setPrefix(QStringLiteral("Son öğe: "));
  playlistStartBox_->hide();
  playlistEndBox_->hide();
  advancedLayout->addWidget(playlistBox_, 3, 0);
  advancedLayout->addWidget(playlistStartBox_, 3, 1);
  advancedLayout->addWidget(playlistEndBox_, 3, 2, 1, 2);
  auto *playlistActionLabel = new QLabel(QStringLiteral("Playlist aracı"), advancedOptions_);
  playlistActionBox_ = new QComboBox(advancedOptions_);
  playlistActionBox_->setObjectName(QStringLiteral("media-playlist-action"));
  playlistActionBox_->setAccessibleName(QStringLiteral("Playlist için gelişmiş işlem"));
  playlistActionBox_->addItem(QStringLiteral("Medya indir"), QString{});
  playlistActionBox_->addItem(QStringLiteral("Kapak görsellerini indir"), QStringLiteral("playlist-thumbnails"));
  playlistActionBox_->addItem(QStringLiteral("Bağlantıları metin dosyasına kaydet"), QStringLiteral("playlist-links"));
  advancedLayout->addWidget(playlistActionLabel, 4, 0);
  advancedLayout->addWidget(playlistActionBox_, 4, 1, 1, 3);
  advancedOptions_->hide();
  optionsLayout->addWidget(advancedOptions_);

  auto *targetPanel = new QFrame(analysisOptions_);
  targetPanel->setObjectName(QStringLiteral("media-target-panel"));
  auto *targetLayout = new QHBoxLayout(targetPanel);
  targetLayout->setContentsMargins(13, 11, 13, 11);
  auto *targetIcon = new QLabel(targetPanel);
  targetIcon->setPixmap(BrowserIcons::icon(BrowserIcon::Folder).pixmap(24, 24));
  targetIcon->setAccessibleName(QStringLiteral("Hedef klasör"));
  auto *targetText = new QVBoxLayout;
  targetText->setSpacing(1);
  targetNameLabel_ = new QLabel(targetPanel);
  targetNameLabel_->setObjectName(QStringLiteral("media-target-name"));
  targetPathLabel_ = new QLabel(targetPanel);
  targetPathLabel_->setObjectName(QStringLiteral("media-target-path"));
  targetPathLabel_->setTextInteractionFlags(Qt::TextSelectableByKeyboard | Qt::TextSelectableByMouse);
  targetText->addWidget(targetNameLabel_);
  targetText->addWidget(targetPathLabel_);
  auto *changeTarget = new QPushButton(QStringLiteral("Değiştir"), targetPanel);
  changeTarget->setObjectName(QStringLiteral("media-change-target"));
  changeTarget->setToolTip(QStringLiteral("Varsayılan indirme klasörünü değiştir"));
  changeTarget->setAccessibleName(QStringLiteral("İndirme klasörünü değiştir"));
  changeTarget->setProperty("tertiary", true);
  targetLayout->addWidget(targetIcon);
  targetLayout->addLayout(targetText, 1);
  targetLayout->addWidget(changeTarget);
  optionsLayout->addWidget(targetPanel);

  auto *downloadRow = new QHBoxLayout;
  auto *selectionText = new QVBoxLayout;
  auto *selectionLabel = new QLabel(QStringLiteral("Seçiminiz"), analysisOptions_);
  selectionLabel->setObjectName(QStringLiteral("media-selection-label"));
  selectionSummary_ = new QLabel(analysisOptions_);
  selectionSummary_->setObjectName(QStringLiteral("media-selection-summary"));
  selectionText->addWidget(selectionLabel);
  selectionText->addWidget(selectionSummary_);
  downloadButton_ = actionButton(BrowserIcon::Download, QStringLiteral("İndir"),
                                 QStringLiteral("Seçilen formatı indirmeye başla"), analysisOptions_, "primary");
  downloadButton_->setObjectName(QStringLiteral("media-primary-download"));
  downloadButton_->setMinimumSize(138, 46);
  downloadRow->addLayout(selectionText, 1);
  downloadRow->addWidget(downloadButton_);
  optionsLayout->addLayout(downloadRow);
  analysisLayout->addWidget(analysisOptions_);
  analysisCard_->hide();
  layout->addWidget(analysisCard_);

  QVBoxLayout *activeLayout = nullptr;
  QWidget *activeCard = card(content, QStringLiteral("AKTİF İNDİRMELER"), &activeLayout);
  activeCard->setObjectName(QStringLiteral("media-active-downloads-card"));
  auto *activeContainer = new QWidget(activeCard);
  activeContainer->setObjectName(QStringLiteral("media-active-jobs"));
  activeJobsLayout_ = new QVBoxLayout(activeContainer);
  activeJobsLayout_->setContentsMargins(0, 0, 0, 0);
  activeJobsLayout_->setSpacing(9);
  activeLayout->addWidget(activeContainer);
  layout->addWidget(activeCard);

  exportButton_ = new QToolButton(content);
  exportButton_->setObjectName(QStringLiteral("media-export-menu-button"));
  exportButton_->setIcon(BrowserIcons::icon(BrowserIcon::More));
  exportButton_->setText(QStringLiteral("Daha Fazla"));
  exportButton_->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
  exportButton_->setPopupMode(QToolButton::InstantPopup);
  exportButton_->setToolTip(QStringLiteral("İndirme geçmişi işlemleri"));
  exportButton_->setAccessibleName(QStringLiteral("İndirme geçmişi için daha fazla işlem"));
  auto *exportMenu = new QMenu(exportButton_);
  exportMenu->setObjectName(QStringLiteral("media-export-menu"));
  QAction *exportCsv = exportMenu->addAction(BrowserIcons::icon(BrowserIcon::Save), QStringLiteral("CSV olarak kaydet"));
  QAction *exportJson = exportMenu->addAction(BrowserIcons::icon(BrowserIcon::Save), QStringLiteral("JSON olarak kaydet"));
  exportCsv->setToolTip(QStringLiteral("İndirme geçmişini tablo verisi olarak dışa aktar"));
  exportJson->setToolTip(QStringLiteral("İndirme geçmişini yapılandırılmış veri olarak dışa aktar"));
  exportButton_->setMenu(exportMenu);
  QVBoxLayout *historyLayout = nullptr;
  QWidget *historyCard = card(content, QStringLiteral("TAMAMLANANLAR VE GEÇMİŞ"), &historyLayout, exportButton_);
  historyCard->setObjectName(QStringLiteral("media-history-card"));
  auto *historyContainer = new QWidget(historyCard);
  historyContainer->setObjectName(QStringLiteral("media-history-jobs"));
  historyJobsLayout_ = new QVBoxLayout(historyContainer);
  historyJobsLayout_->setContentsMargins(0, 0, 0, 0);
  historyJobsLayout_->setSpacing(9);
  historyLayout->addWidget(historyContainer);
  layout->addWidget(historyCard);

  QVBoxLayout *browserLayout = nullptr;
  QWidget *browserCard = card(content, QStringLiteral("DOSYA İNDİRMELERİ"), &browserLayout);
  browserCard->setObjectName(QStringLiteral("browser-downloads-card"));
  auto *browserHint = new QLabel(QStringLiteral("Web sayfalarından indirilen normal dosyalar burada görünür."), browserCard);
  browserHint->setObjectName(QStringLiteral("media-section-hint"));
  browserLayout->addWidget(browserHint);
  auto *browserContainer = new QWidget(browserCard);
  browserContainer->setObjectName(QStringLiteral("browser-downloads-list"));
  browserDownloadsLayout_ = new QVBoxLayout(browserContainer);
  browserDownloadsLayout_->setContentsMargins(0, 0, 0, 0);
  browserDownloadsLayout_->setSpacing(8);
  browserLayout->addWidget(browserContainer);
  layout->addWidget(browserCard);
  layout->addStretch();
  scroll->setWidget(content);
  outer->addWidget(scroll);

  setStyleSheet(QStringLiteral(R"CSS(
    #media-download-page, #media-download-content, #media-download-scroll { background:#10151c; color:#edf2f7; border:0; }
    #media-download-title { color:#f4f7fb; font-size:28px; font-weight:750; }
    #media-download-subtitle, #media-source-hint, #media-section-hint, #media-details,
    #media-target-path, #media-status-label { color:#9eabba; font-size:13px; }
    QFrame#media-source-card, QFrame#media-analysis-card, QFrame#media-active-downloads-card,
    QFrame#media-history-card, QFrame#browser-downloads-card { background:#181f28; border:1px solid #293440; border-radius:15px; }
    #media-download-heading { color:#8ab4f8; font-size:11px; font-weight:750; letter-spacing:1px; }
    #media-title { color:#f2f6fa; font-size:18px; font-weight:720; }
    #media-thumbnail { background:#0f151c; border:1px solid #303c49; border-radius:11px; color:#778697; }
    #media-option-label, #media-target-name, #media-selection-summary { color:#edf3f8; font-size:13px; font-weight:650; }
    #media-selection-label { color:#8290a0; font-size:11px; font-weight:650; }
    QLineEdit, QComboBox, QSpinBox { background:#10171f; color:#edf3f8; border:1px solid #344454; border-radius:9px; padding:7px 10px; min-height:24px; }
    QLineEdit:focus, QComboBox:focus, QSpinBox:focus { border-color:#8ab4f8; }
    QComboBox QAbstractItemView { background:#1b232d; color:#edf3f8; selection-background-color:#30445a; }
    QPushButton, QToolButton { background:#242e39; color:#e9f0f7; border:1px solid #354352; border-radius:9px; padding:7px 12px; }
    QPushButton:hover, QToolButton:hover { background:#2d3a47; border-color:#4a5d70; }
    QPushButton:focus, QToolButton:focus { border:1px solid #8ab4f8; }
    QPushButton:pressed, QToolButton:pressed { background:#1d2731; }
    QPushButton[primary="true"] { background:#2476c7; color:#ffffff; border-color:#3188dc; font-size:14px; font-weight:700; }
    QPushButton[primary="true"]:hover { background:#2e86d9; }
    QPushButton[secondary="true"] { background:#263c52; border-color:#3c6489; }
    QPushButton[tertiary="true"] { background:transparent; border-color:#384655; }
    QPushButton[danger="true"] { background:#38262a; color:#ffb3ba; border-color:#624047; }
    QPushButton:disabled, QToolButton:disabled { color:#677481; background:#1a222b; border-color:#29333e; }
    QPushButton[segment="true"] { background:#111820; min-height:30px; font-size:14px; font-weight:650; }
    QPushButton[segment="true"]:checked { background:#203e5d; color:#d8ebff; border:2px solid #5da8ef; }
    QPushButton[formatChip="true"], QPushButton[qualityChip="true"] { background:#111820; text-align:left; min-width:105px; }
    QPushButton[formatChip="true"]:checked, QPushButton[qualityChip="true"]:checked { background:#213d58; color:#e3f2ff; border:2px solid #5da8ef; }
    #media-advanced-options { background:#121922; border:1px solid #2d3946; border-radius:11px; }
    QFrame#media-target-panel { background:#121a23; border:1px solid #2d3a47; border-radius:11px; }
    QFrame#media-job-card, QFrame#browser-download-row { background:#111820; border:1px solid #2b3743; border-radius:12px; }
    QFrame#media-job-card[state="completed"] { border-color:#285444; }
    QFrame#media-job-card[state="failed"] { border-color:#704048; }
    #media-job-title, #browser-download-title { color:#edf3f8; font-size:14px; font-weight:680; }
    #media-job-meta, #media-job-progress-text, #browser-download-meta { color:#91a0b0; font-size:12px; }
    #media-job-status { color:#a9cfff; font-size:12px; font-weight:650; }
    #media-job-error { color:#ffabb4; font-size:12px; }
    #media-empty-title { color:#c9d4de; font-size:13px; font-weight:650; }
    #media-empty-description { color:#8795a4; font-size:12px; }
    QProgressBar#media-analysis-progress, QProgressBar#media-job-progress { background:#25313d; border:0; border-radius:3px; min-height:5px; max-height:7px; }
    QProgressBar#media-analysis-progress::chunk, QProgressBar#media-job-progress::chunk { background:#4e9fe8; border-radius:3px; }
    QCheckBox { color:#dce5ee; spacing:8px; }
    QMenu { background:#1b232d; color:#edf3f8; border:1px solid #384756; border-radius:9px; padding:6px; }
    QMenu::item { min-height:26px; padding:5px 28px; border-radius:6px; }
    QMenu::item:selected { background:#2b3a48; }
    #media-download-page[lightTheme="true"], #media-download-page[lightTheme="true"] #media-download-content,
    #media-download-page[lightTheme="true"] #media-download-scroll { background:#f4f7fa; color:#18222d; }
    #media-download-page[lightTheme="true"] #media-download-title,
    #media-download-page[lightTheme="true"] #media-title,
    #media-download-page[lightTheme="true"] #media-option-label,
    #media-download-page[lightTheme="true"] #media-target-name,
    #media-download-page[lightTheme="true"] #media-selection-summary { color:#17212c; }
    #media-download-page[lightTheme="true"] QFrame#media-source-card,
    #media-download-page[lightTheme="true"] QFrame#media-analysis-card,
    #media-download-page[lightTheme="true"] QFrame#media-active-downloads-card,
    #media-download-page[lightTheme="true"] QFrame#media-history-card,
    #media-download-page[lightTheme="true"] QFrame#browser-downloads-card { background:#ffffff; border-color:#d9e1e8; }
    #media-download-page[lightTheme="true"] #media-download-subtitle,
    #media-download-page[lightTheme="true"] #media-source-hint,
    #media-download-page[lightTheme="true"] #media-section-hint,
    #media-download-page[lightTheme="true"] #media-details,
    #media-download-page[lightTheme="true"] #media-target-path,
    #media-download-page[lightTheme="true"] #media-status-label { color:#5d6b79; }
    #media-download-page[lightTheme="true"] #media-empty-title,
    #media-download-page[lightTheme="true"] #media-job-title,
    #media-download-page[lightTheme="true"] #browser-download-title { color:#17212c; }
    #media-download-page[lightTheme="true"] #media-empty-description,
    #media-download-page[lightTheme="true"] #media-job-meta,
    #media-download-page[lightTheme="true"] #media-job-progress-text,
    #media-download-page[lightTheme="true"] #browser-download-meta { color:#5d6b79; }
    #media-download-page[lightTheme="true"] #media-download-heading { color:#1764a8; }
    #media-download-page[lightTheme="true"] #media-job-status { color:#205f95; }
    #media-download-page[lightTheme="true"] #media-job-error { color:#a92f3a; }
    #media-download-page[lightTheme="true"] QLineEdit,
    #media-download-page[lightTheme="true"] QComboBox,
    #media-download-page[lightTheme="true"] QSpinBox,
    #media-download-page[lightTheme="true"] QPushButton[segment="true"],
    #media-download-page[lightTheme="true"] QPushButton[formatChip="true"],
    #media-download-page[lightTheme="true"] QPushButton[qualityChip="true"],
    #media-download-page[lightTheme="true"] QFrame#media-job-card,
    #media-download-page[lightTheme="true"] QFrame#browser-download-row,
    #media-download-page[lightTheme="true"] QFrame#media-target-panel,
    #media-download-page[lightTheme="true"] #media-advanced-options { background:#f7f9fb; color:#17212c; border-color:#d5dee6; }
    #media-download-page[lightTheme="true"] QPushButton,
    #media-download-page[lightTheme="true"] QToolButton { background:#eef2f6; color:#17212c; border-color:#cbd5df; }
    #media-download-page[lightTheme="true"] QPushButton:hover,
    #media-download-page[lightTheme="true"] QToolButton:hover { background:#e4eaf0; border-color:#aebbc8; }
    #media-download-page[lightTheme="true"] QPushButton[primary="true"] { background:#176fbd; color:#ffffff; border-color:#176fbd; }
    #media-download-page[lightTheme="true"] QPushButton[primary="true"]:hover { background:#0e61aa; }
    #media-download-page[lightTheme="true"] QPushButton[secondary="true"] { background:#e4eef8; color:#153f66; border-color:#9dbbd6; }
    #media-download-page[lightTheme="true"] QPushButton[tertiary="true"] { background:transparent; color:#28445d; border-color:#c3ced8; }
    #media-download-page[lightTheme="true"] QPushButton[danger="true"] { background:#fff0f1; color:#9b2633; border-color:#e3aab0; }
    #media-download-page[lightTheme="true"] QPushButton[segment="true"]:checked,
    #media-download-page[lightTheme="true"] QPushButton[formatChip="true"]:checked,
    #media-download-page[lightTheme="true"] QPushButton[qualityChip="true"]:checked { background:#dceeff; color:#123f69; border-color:#3988ca; }
    #media-download-page[lightTheme="true"] QCheckBox { color:#263746; }
    #media-download-page[lightTheme="true"] QMenu { background:#ffffff; color:#17212c; border-color:#cbd5df; }
    #media-download-page[lightTheme="true"] QMenu::item:selected { background:#e4eef8; }
  )CSS"));

  thumbnailNetwork_ = new QNetworkAccessManager(this);
  thumbnailNetwork_->setCache(nullptr);
  connect(paste, &QPushButton::clicked, this, [this] {
    urlInput_->setText(QGuiApplication::clipboard()->text().trimmed());
    analyzeInput();
  });
  connect(analyzeButton_, &QPushButton::clicked, this, &MediaDownloadPage::analyzeInput);
  connect(urlInput_, &QLineEdit::returnPressed, this, &MediaDownloadPage::analyzeInput);
  connect(cancelAnalysisButton_, &QPushButton::clicked, service_, &MediaDownloadService::cancelAnalysis);
  connect(videoModeButton_, &QPushButton::clicked, this, [this] {
    playlistActionBox_->setCurrentIndex(0);
    setMode(QStringLiteral("video"));
  });
  connect(audioModeButton_, &QPushButton::clicked, this, [this] {
    playlistActionBox_->setCurrentIndex(0);
    const QString current = modeBox_->currentData().toString();
    setMode(current == QLatin1String("video") || current.startsWith(QStringLiteral("playlist-"))
        ? QStringLiteral("original") : current);
  });
  connect(moreAudioFormats_, qOverload<int>(&QComboBox::activated), this, [this](int index) {
    const QString mode = moreAudioFormats_->itemData(index).toString();
    if (!mode.isEmpty()) setMode(mode);
  });
  connect(formatBox_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int) {
    if (!formatButtonGroup_) { updateSelectionSummary(); return; }
    const int formatIndex = formatBox_->currentData().toInt();
    if (QAbstractButton *exact = formatButtonGroup_->button(formatIndex)) exact->setChecked(true);
    else if (formatIndex >= 0) {
      const QVector<MediaFormatOption> &formats = modeBox_->currentData() == QLatin1String("video")
          ? analysis_.videoFormats : analysis_.audioFormats;
      if (formatIndex < formats.size()) {
        const int quality = formats.at(formatIndex).height;
        for (QAbstractButton *button : formatButtonGroup_->buttons())
          button->setChecked(button->property("qualityKey").toInt() == quality);
      }
    }
    updateSelectionSummary();
  });
  connect(advancedToggle_, &QPushButton::toggled, advancedOptions_, &QWidget::setVisible);
  connect(advancedToggle_, &QPushButton::toggled, this, [this](bool expanded) {
    advancedToggle_->setText(expanded ? QStringLiteral("Gelişmiş seçenekleri gizle")
                                      : QStringLiteral("Gelişmiş seçenekler"));
    advancedToggle_->setAccessibleName(expanded ? QStringLiteral("Gelişmiş indirme seçeneklerini gizle")
                                                : QStringLiteral("Gelişmiş indirme seçeneklerini göster"));
  });
  connect(playlistBox_, &QCheckBox::toggled, playlistStartBox_, &QWidget::setVisible);
  connect(playlistBox_, &QCheckBox::toggled, playlistEndBox_, &QWidget::setVisible);
  connect(playlistActionBox_, qOverload<int>(&QComboBox::activated), this, [this](int index) {
    const QString specialMode = playlistActionBox_->itemData(index).toString();
    if (!specialMode.isEmpty()) { playlistBox_->setChecked(true); setMode(specialMode); }
    else setMode(audioModeButton_->isChecked() ? QStringLiteral("original") : QStringLiteral("video"));
  });
  connect(changeTarget, &QPushButton::clicked, this, [this] {
    QString current = profileService_ ? profileService_->configuredDownloadDirectory()
                                      : service_->defaultDownloadDirectory();
    if (current.isEmpty()) current = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    const QString selected = QFileDialog::getExistingDirectory(this, QStringLiteral("İndirme klasörünü seç"), current);
    if (selected.isEmpty()) return;
    if (profileService_) profileService_->setDownloadDirectory(selected);
    else service_->setDefaultDownloadDirectory(selected);
    refreshTargetDirectory();
  });
  connect(downloadButton_, &QPushButton::clicked, this, &MediaDownloadPage::startSelectedDownload);
  connect(exportCsv, &QAction::triggered, this, [this] { exportHistory(true); });
  connect(exportJson, &QAction::triggered, this, [this] { exportHistory(false); });
  connect(service_, &MediaDownloadService::analysisStarted, this, [this](const QUrl &) {
    setAnalysisLoading(true, QStringLiteral("İçerik analiz ediliyor…"));
  });
  connect(service_, &MediaDownloadService::enginePreparationStatus, this,
          [this](const QString &message, int percent) {
    const QString friendlyMessage = friendlyEngineStatus(message);
    const QString display = percent > 0 && percent < 100
        ? QStringLiteral("%1 (%2%)").arg(friendlyMessage).arg(percent) : friendlyMessage;
    const bool preparing = service_->analysisRunning();
    statusLabel_->setText(display);
    analysisProgress_->setVisible(preparing);
    analyzeButton_->setEnabled(!preparing);
    cancelAnalysisButton_->setVisible(preparing);
    if (preparing) setAnalysisLoading(true, display);
  });
  connect(service_, &MediaDownloadService::analysisReady, this, [this](const MediaAnalysisResult &result) {
    setAnalysisLoading(false);
    applyAnalysis(result);
  });
  connect(service_, &MediaDownloadService::analysisFailed, this, [this](const QString &message) {
    setAnalysisLoading(false);
    statusLabel_->setText(friendlyFailure(message));
    if (analysis_.title.isEmpty()) analysisCard_->hide();
  });
  connect(service_, &MediaDownloadService::analysisCancelled, this, [this] {
    setAnalysisLoading(false);
    statusLabel_->setText(QStringLiteral("Analiz iptal edildi."));
    if (analysis_.title.isEmpty()) analysisCard_->hide();
  });
  connect(service_, &MediaDownloadService::jobsChanged, this, &MediaDownloadPage::refreshJobs);
  if (profileService_)
    connect(profileService_, &BrowserProfileService::downloadsChanged, this, &MediaDownloadPage::refreshBrowserDownloads);
  refreshTargetDirectory();
  refreshJobs();
  refreshBrowserDownloads();
}

void MediaDownloadPage::setSourceUrl(const QUrl &url, bool analyzeImmediately) {
  urlInput_->setText(url.toString(QUrl::FullyEncoded));
  if (analyzeImmediately) analyzeInput();
}

QUrl MediaDownloadPage::sourceUrl() const {
  return QUrl::fromUserInput(urlInput_ ? urlInput_->text().trimmed() : QString{});
}

void MediaDownloadPage::analyzeInput() {
  const QUrl url = QUrl::fromUserInput(urlInput_->text().trimmed());
  QString reason;
  if (!MediaDownloadService::isSupportedMediaUrl(url, &reason)) {
    statusLabel_->setText(reason);
    urlInput_->setFocus();
    return;
  }
  statusLabel_->setText(QStringLiteral("Analiz başlatılıyor…"));
  if (!service_->analyze(url) && service_->analysisRunning())
    statusLabel_->setText(QStringLiteral("Bir analiz zaten devam ediyor."));
}

void MediaDownloadPage::setAnalysisLoading(bool loading, const QString &message) {
  analyzeButton_->setEnabled(!loading);
  cancelAnalysisButton_->setVisible(loading);
  analysisProgress_->setVisible(loading);
  if (loading) {
    analysisCard_->show();
    analysisOptions_->hide();
    titleLabel_->setText(message.isEmpty() ? QStringLiteral("İçerik analiz ediliyor…") : message);
    detailsLabel_->setText(QStringLiteral("Başlık, süre ve kullanılabilir formatlar hazırlanıyor."));
    thumbnailLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Video).pixmap(40, 40));
    statusLabel_->setText(message.isEmpty() ? QStringLiteral("İçerik analiz ediliyor…") : message);
  }
}

void MediaDownloadPage::applyAnalysis(const MediaAnalysisResult &result) {
  analysis_ = result;
  titleLabel_->setText(result.title);
  titleLabel_->setToolTip(result.title);
  const QString duration = durationText(result.durationSeconds);
  detailsLabel_->setText(QStringLiteral("%1  •  Süre: %2  •  %3 video, %4 ses seçeneği")
      .arg(friendlySource(result.source), duration)
      .arg(result.videoFormats.size()).arg(result.audioFormats.size()));
  statusLabel_->setText(QStringLiteral("Analiz tamamlandı. Video veya ses seçin."));
  analysisOptions_->show();
  analysisCard_->show();
  setMode(result.videoFormats.isEmpty() ? QStringLiteral("original") : QStringLiteral("video"));
  loadThumbnail(QUrl(result.thumbnailUrl));
}

void MediaDownloadPage::setMode(const QString &mode) {
  const int index = modeBox_->findData(mode);
  if (index < 0) return;
  modeBox_->setCurrentIndex(index);
  const bool auxiliary = mode.startsWith(QStringLiteral("playlist-"));
  const bool audio = mode != QLatin1String("video") && !auxiliary;
  if (!auxiliary) { videoModeButton_->setChecked(!audio); audioModeButton_->setChecked(audio); }
  bool primaryAudioMode = false;
  for (QPushButton *button : findChildren<QPushButton *>()) {
    const QString buttonMode = button->property("audioMode").toString();
    if (buttonMode.isEmpty()) continue;
    const bool checked = buttonMode == mode;
    button->setChecked(checked);
    primaryAudioMode = primaryAudioMode || checked;
  }
  const QSignalBlocker blocker(moreAudioFormats_);
  moreAudioFormats_->setCurrentIndex(audio && !primaryAudioMode
      ? std::max(0, moreAudioFormats_->findData(mode)) : 0);
  refreshFormatChoices();
}

void MediaDownloadPage::refreshFormatChoices() {
  clearLayout(formatChoicesLayout_);
  delete formatButtonGroup_;
  formatButtonGroup_ = new QButtonGroup(this);
  formatButtonGroup_->setExclusive(true);
  const QString mode = modeBox_->currentData().toString();
  const bool auxiliaryPlaylist = mode.startsWith(QStringLiteral("playlist-"));
  const bool video = mode == QLatin1String("video");
  const bool audio = !video && !auxiliaryPlaylist;
  if (QWidget *panel = findChild<QWidget *>(QStringLiteral("audio-format-panel"))) panel->setVisible(audio);
  playlistBox_->setEnabled(!auxiliaryPlaylist);
  if (auxiliaryPlaylist) playlistBox_->setChecked(true);
  subtitlesBox_->setVisible(video);
  sectionStartBox_->setEnabled(!auxiliaryPlaylist);
  sectionEndBox_->setEnabled(!auxiliaryPlaylist);
  formatHeading_->setText(auxiliaryPlaylist ? QStringLiteral("Playlist işlemi")
      : video ? QStringLiteral("Video kalitesi") : QStringLiteral("Kaynak ses kalitesi"));
  const QSignalBlocker blocker(formatBox_);
  formatBox_->clear();
  const QVector<MediaFormatOption> &formats = video ? analysis_.videoFormats : analysis_.audioFormats;
  const bool conversionUnavailable = audio && mode != QLatin1String("original") && !service_->ffmpegAvailable();
  const auto formatUsable = [this, video, conversionUnavailable](const MediaFormatOption &format) {
    if (conversionUnavailable) return false;
    return !video || format.hasAudio || service_->ffmpegAvailable();
  };
  for (int index = 0; index < formats.size(); ++index)
    if (formatUsable(formats.at(index))) formatBox_->addItem(formats.at(index).label, index);
  if (auxiliaryPlaylist) {
    auto *description = new QLabel(mode == QLatin1String("playlist-thumbnails")
        ? QStringLiteral("Playlist'teki öğelerin mevcut kapak görselleri indirilecek.")
        : QStringLiteral("Playlist bağlantıları güvenli bir metin dosyasına kaydedilecek."), formatChoices_);
    description->setObjectName(QStringLiteral("media-section-hint"));
    description->setWordWrap(true);
    formatChoicesLayout_->addWidget(description, 0, 0, 1, 3);
    description->show();
    formatBox_->setEnabled(false);
    downloadButton_->setEnabled(true);
    updateSelectionSummary();
    return;
  }
  QSet<int> seenQuality;
  int visibleIndex = 0;
  for (int index = 0; index < formats.size(); ++index) {
    const MediaFormatOption &format = formats.at(index);
    if (!formatUsable(format)) continue;
    const int qualityKey = video ? format.height : index;
    if (video && seenQuality.contains(qualityKey)) continue;
    seenQuality.insert(qualityKey);
    QString title;
    QString subtitle;
    if (video) {
      title = format.height > 0 ? QStringLiteral("%1p").arg(format.height) : QStringLiteral("Video");
      if (format.height >= 1080) subtitle = QStringLiteral("Full HD");
      else if (format.height >= 720) subtitle = QStringLiteral("HD");
      else subtitle = format.extension.toUpper();
    } else {
      title = format.audioBitrate > 0 ? QStringLiteral("%1 kbps").arg(format.audioBitrate)
                                     : QStringLiteral("En iyi kaynak");
      subtitle = format.extension.toUpper();
    }
    auto *button = new QPushButton(title + QLatin1Char('\n') + subtitle, formatChoices_);
    button->setObjectName(QStringLiteral("media-format-choice-%1").arg(index));
    button->setProperty("qualityChip", true);
    button->setProperty("qualityKey", qualityKey);
    button->setCheckable(true);
    button->setMinimumHeight(58);
    button->setToolTip(format.label);
    button->setAccessibleName(title + QStringLiteral(" kalite seçeneği"));
    button->setAccessibleDescription(format.label);
    formatButtonGroup_->addButton(button, index);
    formatChoicesLayout_->addWidget(button, visibleIndex / 3, visibleIndex % 3);
    button->show();
    if (visibleIndex == 0) button->setChecked(true);
    ++visibleIndex;
  }
  connect(formatButtonGroup_, &QButtonGroup::idClicked, this, [this](int formatIndex) {
    const int comboIndex = formatBox_->findData(formatIndex);
    if (comboIndex >= 0) formatBox_->setCurrentIndex(comboIndex);
    updateSelectionSummary();
  });
  formatBox_->setEnabled(visibleIndex > 0);
  downloadButton_->setEnabled(visibleIndex > 0);
  if (visibleIndex > 0) formatBox_->setCurrentIndex(0);
  if (visibleIndex == 0) {
    auto *missing = new QLabel(conversionUnavailable
        ? QStringLiteral("Bu ses biçimi için medya dönüştürme bileşeni kullanılamıyor.")
        : QStringLiteral("Bu tür için kullanılabilir format bulunamadı."), formatChoices_);
    missing->setObjectName(QStringLiteral("media-section-hint"));
    formatChoicesLayout_->addWidget(missing, 0, 0, 1, 3);
    missing->show();
  }
  updateSelectionSummary();
}

void MediaDownloadPage::updateSelectionSummary() {
  const QString mode = modeBox_->currentData().toString();
  if (mode == QLatin1String("playlist-thumbnails")) { selectionSummary_->setText(QStringLiteral("Playlist kapakları")); return; }
  if (mode == QLatin1String("playlist-links")) { selectionSummary_->setText(QStringLiteral("Playlist bağlantıları • TXT")); return; }
  const bool video = mode == QLatin1String("video");
  const QVector<MediaFormatOption> &formats = video ? analysis_.videoFormats : analysis_.audioFormats;
  const int selected = formatBox_->currentIndex() >= 0 ? formatBox_->currentData().toInt() : -1;
  if (selected < 0 || selected >= formats.size()) { selectionSummary_->setText(QStringLiteral("Format seçin")); return; }
  const MediaFormatOption &format = formats.at(selected);
  if (video) selectionSummary_->setText(QStringLiteral("%1 • %2")
      .arg(format.height > 0 ? QStringLiteral("%1p").arg(format.height) : QStringLiteral("Video"), format.extension.toUpper()));
  else if (mode == QLatin1String("original"))
    selectionSummary_->setText(QStringLiteral("Orijinal • %1 • Yeniden kodlama yok").arg(format.extension.toUpper()));
  else selectionSummary_->setText(QStringLiteral("%1 • En iyi kalite").arg(mode.toUpper()));
}

void MediaDownloadPage::refreshTargetDirectory() {
  QString directory = profileService_ ? profileService_->configuredDownloadDirectory() : service_->defaultDownloadDirectory();
  if (directory.isEmpty()) directory = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
  const bool asks = profileService_ && profileService_->asksDownloadLocation();
  const QString folderName = QFileInfo(directory).fileName().isEmpty() ? QStringLiteral("İndirilenler") : QFileInfo(directory).fileName();
  targetNameLabel_->setText(asks ? QStringLiteral("Her indirmede konum sorulacak") : folderName);
  targetPathLabel_->setText(directory);
  targetPathLabel_->setToolTip(directory);
  targetPathLabel_->setAccessibleName(QStringLiteral("Hedef klasör: %1").arg(directory));
}

void MediaDownloadPage::startSelectedDownload() {
  const QString mode = modeBox_->currentData().toString();
  const bool auxiliaryPlaylist = mode.startsWith(QStringLiteral("playlist-"));
  const QVector<MediaFormatOption> &formats = mode == QLatin1String("video") ? analysis_.videoFormats : analysis_.audioFormats;
  const int index = formatBox_->currentIndex() >= 0 ? formatBox_->currentData().toInt() : -1;
  if (!auxiliaryPlaylist && (index < 0 || index >= formats.size())) return;
  if (!auxiliaryPlaylist && sectionEndBox_->value() > 0 && sectionEndBox_->value() <= sectionStartBox_->value()) {
    statusLabel_->setText(QStringLiteral("Bölüm bitişi başlangıçtan büyük olmalıdır."));
    return;
  }
  QString directory = profileService_ ? profileService_->configuredDownloadDirectory() : service_->defaultDownloadDirectory();
  if (directory.isEmpty()) directory = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
  if (profileService_ && profileService_->asksDownloadLocation()) {
    directory = QFileDialog::getExistingDirectory(this, QStringLiteral("Medya indirme klasörünü seç"), directory);
    if (directory.isEmpty()) return;
  }
  MediaDownloadRequest request;
  request.url = analysis_.url;
  request.title = analysis_.title;
  request.targetDirectory = directory;
  if (!auxiliaryPlaylist) {
    const MediaFormatOption &format = formats.at(index);
    request.formatId = format.id;
    request.formatExtension = format.extension;
    request.formatHeight = format.height;
    request.formatHasAudio = format.hasAudio;
  }
  request.subtitles = subtitlesBox_->isChecked();
  request.sectionStartSeconds = sectionStartBox_->value();
  request.sectionEndSeconds = sectionEndBox_->value();
  request.playlist = playlistBox_->isChecked();
  request.playlistStart = playlistStartBox_->value();
  request.playlistEnd = playlistEndBox_->value();
  if (mode == QLatin1String("playlist-thumbnails")) request.kind = MediaDownloadKind::PlaylistThumbnails;
  else if (mode == QLatin1String("playlist-links")) request.kind = MediaDownloadKind::PlaylistLinks;
  else if (mode == QLatin1String("video")) request.kind = MediaDownloadKind::Video;
  else if (mode == QLatin1String("original")) request.kind = MediaDownloadKind::AudioOriginal;
  else { request.kind = MediaDownloadKind::AudioConvert; request.audioFormat = mode; }
  const QUuid id = service_->enqueue(request);
  if (id.isNull()) { statusLabel_->setText(QStringLiteral("İndirme başlatılamadı. Hedef klasörü ve gerekli bileşenleri kontrol edin.")); return; }
  statusLabel_->setText(QStringLiteral("İndirme kuyruğa eklendi."));
}

QWidget *MediaDownloadPage::createJobCard(const MediaDownloadJob &job, QWidget *parent) {
  auto *jobCard = new QFrame(parent);
  jobCard->setObjectName(QStringLiteral("media-job-card"));
  jobCard->setProperty("state", stateProperty(job.state));
  jobCard->setProperty("jobId", job.id.toString(QUuid::WithoutBraces));
  jobCard->setAccessibleName(QStringLiteral("%1, %2").arg(job.title, job.statusText));
  auto *layout = new QVBoxLayout(jobCard);
  layout->setContentsMargins(14, 13, 14, 13);
  layout->setSpacing(9);
  auto *header = new QHBoxLayout;
  auto *icon = new QLabel(jobCard);
  const BrowserIcon mediaIcon = job.kind == MediaDownloadKind::Video ? BrowserIcon::Video
      : (job.kind == MediaDownloadKind::PlaylistLinks || job.kind == MediaDownloadKind::PlaylistThumbnails)
          ? BrowserIcon::Cards : BrowserIcon::Music;
  icon->setPixmap(BrowserIcons::icon(mediaIcon).pixmap(30, 30));
  icon->setFixedSize(38, 38);
  icon->setAlignment(Qt::AlignCenter);
  auto *text = new QVBoxLayout;
  text->setSpacing(2);
  auto *title = new QLabel(job.title, jobCard);
  title->setObjectName(QStringLiteral("media-job-title"));
  title->setWordWrap(true);
  title->setMaximumHeight(44);
  title->setToolTip(job.title);
  auto *meta = new QLabel((job.playlist ? QStringLiteral("Playlist • ") : QString{}) + kindText(job.kind), jobCard);
  meta->setObjectName(QStringLiteral("media-job-meta"));
  text->addWidget(title);
  text->addWidget(meta);
  auto *status = new QLabel(job.statusText, jobCard);
  status->setObjectName(QStringLiteral("media-job-status"));
  header->addWidget(icon);
  header->addLayout(text, 1);
  header->addWidget(status, 0, Qt::AlignTop);
  layout->addLayout(header);
  if (!terminalState(job.state)) {
    auto *progress = new QProgressBar(jobCard);
    progress->setObjectName(QStringLiteral("media-job-progress"));
    progress->setTextVisible(false);
    if (job.totalBytes <= 0 && job.percent <= 0.0) progress->setRange(0, 0);
    else { progress->setRange(0, 100); progress->setValue(qRound(job.percent)); }
    progress->setAccessibleName(QStringLiteral("İndirme ilerlemesi yüzde %1").arg(qRound(job.percent)));
    layout->addWidget(progress);
    QStringList progressParts;
    if (job.percent > 0.0) progressParts << QStringLiteral("%1%").arg(qRound(job.percent));
    if (job.downloadedBytes > 0) progressParts << (job.totalBytes > 0
        ? QStringLiteral("%1 / %2").arg(formatBytes(job.downloadedBytes), formatBytes(job.totalBytes))
        : formatBytes(job.downloadedBytes));
    if (job.bytesPerSecond > 0) progressParts << QStringLiteral("%1/s").arg(formatBytes(job.bytesPerSecond));
    if (job.etaSeconds >= 0) progressParts << QStringLiteral("%1 sn kaldı").arg(job.etaSeconds);
    auto *progressText = new QLabel(progressParts.isEmpty() ? QStringLiteral("Hazırlanıyor…") : progressParts.join(QStringLiteral(" • ")), jobCard);
    progressText->setObjectName(QStringLiteral("media-job-progress-text"));
    layout->addWidget(progressText);
  } else if (job.state == MediaDownloadState::Failed && !job.errorText.isEmpty()) {
    auto *error = new QLabel(friendlyFailure(job.errorText), jobCard);
    error->setObjectName(QStringLiteral("media-job-error"));
    error->setWordWrap(true);
    layout->addWidget(error);
  }
  auto *actions = new QHBoxLayout;
  actions->setSpacing(7);
  actions->addStretch();
  if (!terminalState(job.state)) {
    auto *cancel = actionButton(BrowserIcon::Close, QStringLiteral("İptal"), QStringLiteral("Bu indirmeyi iptal et"), jobCard, "danger");
    connect(cancel, &QPushButton::clicked, this, [this, id = job.id] { service_->cancel(id); });
    actions->addWidget(cancel);
  } else if (job.state == MediaDownloadState::Completed) {
    auto *open = actionButton(BrowserIcon::Play, QStringLiteral("Aç"), QStringLiteral("İndirilen dosyayı aç"), jobCard);
    open->setEnabled(QFileInfo::exists(job.outputPath));
    connect(open, &QPushButton::clicked, this, [path = job.outputPath] { if (QFileInfo::exists(path)) QDesktopServices::openUrl(QUrl::fromLocalFile(path)); });
    auto *folder = actionButton(BrowserIcon::Folder, QStringLiteral("Klasörde göster"), QStringLiteral("İndirilen dosyanın klasörünü aç"), jobCard);
    const QString folderPath = job.outputPath.isEmpty() ? job.targetDirectory : QFileInfo(job.outputPath).absolutePath();
    folder->setEnabled(QFileInfo(folderPath).isDir());
    connect(folder, &QPushButton::clicked, this, [folderPath] { if (QFileInfo(folderPath).isDir()) QDesktopServices::openUrl(QUrl::fromLocalFile(folderPath)); });
    auto *more = new QToolButton(jobCard);
    more->setIcon(BrowserIcons::icon(BrowserIcon::More));
    more->setText(QStringLiteral("Daha Fazla"));
    more->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    more->setPopupMode(QToolButton::InstantPopup);
    more->setToolTip(QStringLiteral("Tamamlanan indirme için daha fazla işlem"));
    more->setAccessibleName(QStringLiteral("Tamamlanan indirme için daha fazla işlem"));
    auto *menu = new QMenu(more);
    QAction *remove = menu->addAction(BrowserIcons::icon(BrowserIcon::Trash), QStringLiteral("Listeden kaldır"));
    connect(remove, &QAction::triggered, this, [this, id = job.id] { service_->remove(id); });
    more->setMenu(menu);
    actions->addWidget(open);
    actions->addWidget(folder);
    actions->addWidget(more);
  } else {
    auto *retry = actionButton(BrowserIcon::Reset, QStringLiteral("Tekrar Dene"), QStringLiteral("Bu indirmeyi yeniden başlat"), jobCard, "secondary");
    auto *remove = actionButton(BrowserIcon::Trash, QStringLiteral("Listeden Kaldır"), QStringLiteral("Bu kaydı indirme listesinden kaldır"), jobCard, "danger");
    connect(retry, &QPushButton::clicked, this, [this, id = job.id] { service_->retry(id); });
    connect(remove, &QPushButton::clicked, this, [this, id = job.id] { service_->remove(id); });
    actions->addWidget(retry);
    actions->addWidget(remove);
  }
  layout->addLayout(actions);
  return jobCard;
}

void MediaDownloadPage::refreshJobs() {
  clearLayout(activeJobsLayout_);
  clearLayout(historyJobsLayout_);
  int activeCount = 0;
  int historyCount = 0;
  for (const MediaDownloadJob &job : service_->jobs()) {
    if (terminalState(job.state)) { historyJobsLayout_->addWidget(createJobCard(job, historyJobsLayout_->parentWidget())); ++historyCount; }
    else { activeJobsLayout_->addWidget(createJobCard(job, activeJobsLayout_->parentWidget())); ++activeCount; }
  }
  if (!activeCount) {
    activeEmptyLabel_ = emptyState(BrowserIcons::icon(BrowserIcon::Download), QStringLiteral("Şu anda aktif indirme yok"),
        QStringLiteral("Yeni bir indirme başladığında ilerleme burada görünecek."), activeJobsLayout_->parentWidget());
    activeJobsLayout_->addWidget(activeEmptyLabel_);
  }
  if (!historyCount) {
    historyEmptyLabel_ = emptyState(BrowserIcons::icon(BrowserIcon::History), QStringLiteral("Henüz indirme yok"),
        QStringLiteral("Bir medya sayfasındayken araç çubuğundaki İndir düğmesini kullanın veya bağlantı yapıştırın."),
        historyJobsLayout_->parentWidget());
    historyJobsLayout_->addWidget(historyEmptyLabel_);
  }
  exportButton_->setEnabled(historyCount > 0);
}

void MediaDownloadPage::refreshBrowserDownloads() {
  clearLayout(browserDownloadsLayout_);
  const QList<BrowserDownloadEntry> downloads = profileService_ ? profileService_->recentDownloads() : QList<BrowserDownloadEntry>{};
  for (const BrowserDownloadEntry &entry : downloads) {
    auto *row = new QFrame(browserDownloadsLayout_->parentWidget());
    row->setObjectName(QStringLiteral("browser-download-row"));
    auto *rowLayout = new QHBoxLayout(row);
    rowLayout->setContentsMargins(13, 11, 13, 11);
    auto *icon = new QLabel(row);
    icon->setPixmap(BrowserIcons::icon(BrowserIcon::Download).pixmap(24, 24));
    auto *text = new QVBoxLayout;
    auto *title = new QLabel(entry.fileName, row);
    title->setObjectName(QStringLiteral("browser-download-title"));
    title->setToolTip(entry.fileName);
    auto *meta = new QLabel(QStringLiteral("%1 • %2").arg(entry.state, entry.path), row);
    meta->setObjectName(QStringLiteral("browser-download-meta"));
    meta->setToolTip(entry.path);
    meta->setTextInteractionFlags(Qt::TextSelectableByKeyboard | Qt::TextSelectableByMouse);
    text->addWidget(title);
    text->addWidget(meta);
    rowLayout->addWidget(icon);
    rowLayout->addLayout(text, 1);
    browserDownloadsLayout_->addWidget(row);
  }
  if (downloads.isEmpty()) {
    browserEmptyLabel_ = emptyState(BrowserIcons::icon(BrowserIcon::Folder), QStringLiteral("Dosya indirmesi yok"),
        QStringLiteral("Web sayfalarından indirdiğiniz dosyalar burada listelenecek."), browserDownloadsLayout_->parentWidget());
    browserDownloadsLayout_->addWidget(browserEmptyLabel_);
  }
}

void MediaDownloadPage::loadThumbnail(const QUrl &url) {
  if (thumbnailReply_) { thumbnailReply_->abort(); thumbnailReply_->deleteLater(); thumbnailReply_ = nullptr; }
  thumbnailLabel_->setPixmap(BrowserIcons::icon(BrowserIcon::Video).pixmap(40, 40));
  if (!url.isValid() || (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https"))) return;
  QNetworkRequest request(url);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  request.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
  thumbnailReply_ = thumbnailNetwork_->get(request);
  connect(thumbnailReply_, &QNetworkReply::readyRead, this, [this] {
    if (thumbnailReply_ && thumbnailReply_->bytesAvailable() > 5 * 1024 * 1024) thumbnailReply_->abort();
  });
  connect(thumbnailReply_, &QNetworkReply::finished, this, [this] {
    QNetworkReply *reply = thumbnailReply_;
    thumbnailReply_ = nullptr;
    if (!reply) return;
    const QByteArray bytes = reply->error() == QNetworkReply::NoError && reply->bytesAvailable() <= 5 * 1024 * 1024 ? reply->readAll() : QByteArray{};
    QPixmap image;
    if (!bytes.isEmpty() && image.loadFromData(bytes))
      thumbnailLabel_->setPixmap(image.scaled(thumbnailLabel_->size(), Qt::KeepAspectRatio, Qt::SmoothTransformation));
    reply->deleteLater();
  });
}

void MediaDownloadPage::clearLayout(QLayout *layout) {
  if (!layout) return;
  while (QLayoutItem *item = layout->takeAt(0)) {
    if (QWidget *widget = item->widget()) delete widget;
    if (QLayout *child = item->layout()) clearLayout(child);
    delete item;
  }
}

QString MediaDownloadPage::formatBytes(qint64 bytes) {
  if (bytes <= 0) return QStringLiteral("—");
  if (bytes >= 1024 * 1024 * 1024LL) return QStringLiteral("%1 GB").arg(bytes / 1024.0 / 1024.0 / 1024.0, 0, 'f', 2);
  if (bytes >= 1024 * 1024) return QStringLiteral("%1 MB").arg(bytes / 1024.0 / 1024.0, 0, 'f', 1);
  return QStringLiteral("%1 KB").arg(bytes / 1024.0, 0, 'f', 0);
}

void MediaDownloadPage::exportHistory(bool csv) {
  const QString extension = csv ? QStringLiteral("csv") : QStringLiteral("json");
  const QString selected = QFileDialog::getSaveFileName(this, QStringLiteral("İndirme geçmişini dışa aktar"),
      QDir::home().filePath(QStringLiteral("ardali-media-downloads.%1").arg(extension)),
      csv ? QStringLiteral("CSV (*.csv)") : QStringLiteral("JSON (*.json)"));
  if (selected.isEmpty()) return;
  QByteArray bytes;
  if (csv) {
    const auto escaped = [](QString value) { value.replace(QLatin1Char('"'), QStringLiteral("\"\"")); return QLatin1Char('"') + value + QLatin1Char('"'); };
    QString output = QStringLiteral("title,url,status,output,created_at\n");
    for (const MediaDownloadJob &job : service_->jobs()) {
      if (!terminalState(job.state)) continue;
      output += QStringList{escaped(job.title), escaped(BrowserSecurity::sanitizeUrlForPersistence(job.url).toString(QUrl::FullyEncoded)),
          escaped(job.statusText), escaped(job.outputPath), escaped(job.createdAt.toString(Qt::ISODate))}.join(QLatin1Char(',')) + QLatin1Char('\n');
    }
    bytes = output.toUtf8();
  } else {
    QJsonArray entries;
    for (const MediaDownloadJob &job : service_->jobs()) {
      if (!terminalState(job.state)) continue;
      entries.append(QJsonObject{{QStringLiteral("title"), job.title},
          {QStringLiteral("url"), BrowserSecurity::sanitizeUrlForPersistence(job.url).toString(QUrl::FullyEncoded)},
          {QStringLiteral("status"), job.statusText}, {QStringLiteral("output"), job.outputPath},
          {QStringLiteral("createdAt"), job.createdAt.toString(Qt::ISODate)}});
    }
    bytes = QJsonDocument(entries).toJson(QJsonDocument::Indented);
  }
  QSaveFile file(selected);
  if (!file.open(QIODevice::WriteOnly) || !file.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner)
      || file.write(bytes) != bytes.size() || !file.commit()) {
    statusLabel_->setText(QStringLiteral("Geçmiş dışa aktarılamadı."));
    return;
  }
  QFile::setPermissions(selected, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
  statusLabel_->setText(QStringLiteral("İndirme geçmişi dışa aktarıldı."));
}
