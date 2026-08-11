#pragma once

#include <QObject>

class QWebEngineUrlSchemeHandler;

void registerArdaliUrlSchemes();
QWebEngineUrlSchemeHandler *createNewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                                                      const QString &managedThumbnailPath, QObject *parent = nullptr);
