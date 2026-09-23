#pragma once

#include <QJsonArray>
#include <QObject>
#include <QUrl>

class QWebEngineUrlSchemeHandler;
class QWebEngineProfile;

namespace dalinira::core {
class IBrowserProfileDataProvider;
}

void registerDaliNiraUrlSchemes();
QString newTabFaviconUrl(const dalinira::core::IBrowserProfileDataProvider *profileData, const QUrl &page);
QJsonArray collectNewTabFrequentSites(const dalinira::core::IBrowserProfileDataProvider *profileData,
                                      int limit = 6);
QJsonArray collectNewTabBookmarks(const dalinira::core::IBrowserProfileDataProvider *profileData,
                                  int limit = 6);
QWebEngineUrlSchemeHandler *createNewTabSchemeHandler(const QString &assetsDirectory, const QString &managedBackgroundPath,
                                                      const QString &managedThumbnailPath,
                                                      dalinira::core::IBrowserProfileDataProvider *profileData = nullptr,
                                                      QObject *parent = nullptr,
                                                      QWebEngineProfile *webProfile = nullptr);
