#include "browser_policy.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

BrowserPolicy BrowserPolicy::load(const QString &path, QString *error) {
  BrowserPolicy policy;
  QFile file(path);
  if (!file.open(QIODevice::ReadOnly)) {
    if (error) *error = QStringLiteral("Cannot open DALI browser policy: %1").arg(path);
    return policy;
  }
  QJsonParseError parseError;
  const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
  const QJsonObject root = document.object();
  if (parseError.error != QJsonParseError::NoError || root.value("version").toInt() != 1
      || root.value("engine").toString() != QStringLiteral("chromium")) {
    if (error) *error = QStringLiteral("Invalid DALI browser policy: %1").arg(parseError.errorString());
    return policy;
  }
  const QJsonObject capabilities = root.value("capabilities").toObject();
  for (const QJsonValue &value : capabilities.value("allow").toArray()) policy.allowed_.insert(value.toString());
  for (const QJsonValue &value : capabilities.value("deny").toArray()) policy.denied_.insert(value.toString());
  policy.valid_ = policy.allowed_.contains("navigation.http_https")
      && policy.allowed_.contains("window.reparent_live_page")
      && policy.denied_.contains("popup.unrequested");
  if (!policy.valid_ && error) *error = QStringLiteral("DALI browser policy is missing required capabilities");
  return policy;
}

bool BrowserPolicy::allowsNavigation(const QUrl &url) const {
  if (!valid_ || !allowed_.contains("navigation.http_https")) return false;
  const QString scheme = url.scheme().toLower();
  return scheme == QStringLiteral("http") || scheme == QStringLiteral("https") || scheme == QStringLiteral("ardali");
}

bool BrowserPolicy::allowsDownloadPrompt() const {
  return valid_ && allowed_.contains("downloads.prompt");
}

bool BrowserPolicy::allowsSessionRestore() const {
  return valid_ && allowed_.contains("session.restore");
}

bool BrowserPolicy::blocksUnrequestedPopups() const {
  return !valid_ || denied_.contains("popup.unrequested");
}
