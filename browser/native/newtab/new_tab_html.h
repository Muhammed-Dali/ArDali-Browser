#pragma once

#include <QString>
#include <QUrl>

QString newTabHtml(const QString &defaultEngine);
QString strictBlockWarningHtml(const QString &domain, const QString &targetUrl);
QUrl validatedStrictBlockTarget(const QString &domain, const QString &targetUrl);
bool isAuthorizedStrictBlockBypass(const QUrl &requestUrl, const QUrl &initiator);
