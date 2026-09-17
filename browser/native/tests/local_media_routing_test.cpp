#include "downloads/local_media_routing.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QTemporaryDir>

#include <cassert>
#include <iostream>

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  QTemporaryDir root;
  assert(root.isValid());
  const QString audioWebm = QDir(root.path()).filePath(QStringLiteral("audio-only.webm"));
  const QString video = QDir(root.path()).filePath(QStringLiteral("movie.mp4"));
  const QString unsupported = QDir(root.path()).filePath(QStringLiteral("notes.txt"));
  for (const QString &path : {audioWebm, video, unsupported}) {
    QFile file(path);
    assert(file.open(QIODevice::WriteOnly));
    assert(file.write("fixture") == 7);
  }

  const MediaDownloadKind audioKind = MediaDownloadKind::AudioOriginal;
  const MediaDownloadKind videoKind = MediaDownloadKind::Video;
  assert(LocalMediaRouting::classify(audioWebm, QStringLiteral("video/webm"), &audioKind)
         == LocalMediaPlayerKind::Audio);
  assert(LocalMediaRouting::classify(video, QStringLiteral("video/mp4"), &videoKind)
         == LocalMediaPlayerKind::Video);
  assert(LocalMediaRouting::classify(video, QStringLiteral("video/mp4"))
         == LocalMediaPlayerKind::Video);
  assert(LocalMediaRouting::classify(unsupported, QStringLiteral("text/plain"))
         == LocalMediaPlayerKind::External);
  assert(LocalMediaRouting::isSafeDownloadedFile(audioWebm, root.path()));
  assert(!LocalMediaRouting::isSafeDownloadedFile(QStringLiteral("/etc/passwd"), root.path()));

  std::cout << "audio/video/external routing, audio-only WebM metadata and root confinement: ok\n";
  return 0;
}
