#pragma once

#include <QString>
#include <QStringList>
#include <QUrl>

namespace BrowserSecurity {

// Returns a runtime URL representation safe for durable history/session
// storage. Navigation continues to use the original URL.
QUrl sanitizeUrlForPersistence(const QUrl &url);

// Resolves an external helper without consulting the process PATH. Explicit
// bundled candidates are checked first, followed by platform system paths.
// The result is always a canonical absolute executable path or an empty value.
QString resolveTrustedExecutable(const QString &programName,
                                 const QStringList &bundledCandidates = {},
                                 bool includeSystemDirectories = true);

// Produces a single portable filename component. Directory traversal,
// controls, reserved device names and excessive length are removed.
QString sanitizeDownloadFileName(const QString &suggested,
                                 const QString &fallback = QStringLiteral("download"));

}  // namespace BrowserSecurity
