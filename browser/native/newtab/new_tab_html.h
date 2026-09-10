#pragma once

#include <QJsonArray>
#include <QString>
#include <QUrl>

QString searchEnginePlaceholder(const QString &engine);

QString newTabHtml(const QString &defaultEngine,
                   const QJsonArray &frequentSites = {},
                   const QJsonArray &bookmarks = {});
QString incognitoNewTabHtml(const QString &defaultEngine);
QString newTabTopSitesUpdateScript(const QJsonArray &frequentSites,
                                   const QJsonArray &bookmarks);
QString strictBlockWarningHtml(const QString &domain, const QString &targetUrl);
QUrl validatedStrictBlockTarget(const QString &domain, const QString &targetUrl);
bool isAuthorizedStrictBlockBypass(const QUrl &requestUrl, const QUrl &initiator);
