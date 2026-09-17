#pragma once

#include <QJsonArray>
#include <QObject>
#include <QUrl>

class QWebEngineUrlSchemeHandler;
class QWebEngineProfile;

namespace ardali::core {
class IBrowserProfileDataProvider;
}

void registerArdaliUrlSchemes();
QString newTabFaviconUrl(const ardali::core::IBrowserProfileDataProvider *profileData, const QUrl &page);
QJsonArray collectNewTabFrequentSites(const ardali::core::IBrowserProfileDataProvider *profileData,
                                      int limit = 6);
QJsonArray collectNewTabBookmarks(const ardali::core::IBrowserProfileDataProvider *profileData,
                                  int limit = 6);
QWebEngineUrlSchemeHandler *createNewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                                                      const QString &managedThumbnailPath,
                                                      ardali::core::IBrowserProfileDataProvider *profileData = nullptr,
                                                      QObject *parent = nullptr,
                                                      QWebEngineProfile *webProfile = nullptr);
