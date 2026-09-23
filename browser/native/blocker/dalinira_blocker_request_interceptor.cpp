#include "dalinira_blocker_request_interceptor.h"

#include <QUrl>
#include <QUrlQuery>
#include "dalinira_blocker_service.h"
#include "new_tab_html.h"

DaliNiraBlockerRequestInterceptor::DaliNiraBlockerRequestInterceptor(DaliNiraBlockerService *service, QObject *parent)
    : QWebEngineUrlRequestInterceptor(parent), service_(service) {}

void DaliNiraBlockerRequestInterceptor::interceptRequest(QWebEngineUrlRequestInfo &info) {
  QUrl requestUrl = info.requestUrl();
  if (!requestUrl.isValid()) return;

  const QString scheme = requestUrl.scheme().toLower();
  if (scheme == QLatin1String("dalinira")) {
    if (requestUrl.host() == QLatin1String("bypass-strictblock")) {
      if (!isAuthorizedStrictBlockBypass(requestUrl, info.initiator())) {
        info.block(true);
        return;
      }
      const QString domain = QUrlQuery(requestUrl).queryItemValue(QStringLiteral("domain"), QUrl::FullyDecoded);
      if (service_) {
        service_->allowTemporaryStrictBypass(domain, 15);
      }
    }
    return;
  }

  if (scheme != QLatin1String("http") && scheme != QLatin1String("https")) return;

  // 1. Strip tracking parameters (fbclid, gclid, utm_*, etc.)
  QUrlQuery query(requestUrl);
  static const QStringList trackingKeys = {
      QStringLiteral("fbclid"), QStringLiteral("gclid"), QStringLiteral("dclid"),
      QStringLiteral("msclkid"), QStringLiteral("mc_cid"), QStringLiteral("mc_eid"),
      QStringLiteral("_hsenc"), QStringLiteral("_hsmi")
  };
  bool queryChanged = false;
  for (const QString &key : trackingKeys) {
    if (query.hasQueryItem(key)) {
      query.removeAllQueryItems(key);
      queryChanged = true;
    }
  }
  const auto items = query.queryItems(QUrl::FullyDecoded);
  for (const auto &[key, value] : items) {
    Q_UNUSED(value);
    if (key.startsWith(QStringLiteral("utm_"), Qt::CaseInsensitive)) {
      query.removeAllQueryItems(key);
      queryChanged = true;
    }
  }
  if (queryChanged) {
    requestUrl.setQuery(query);
  }

  // 2. Evaluate with DaliNira Blocker Service
  if (!service_) return;

  QUrl firstPartyUrl = info.firstPartyUrl();
  if (!firstPartyUrl.isValid() || firstPartyUrl.host().isEmpty()) {
    firstPartyUrl = info.initiator();
  }
  const int resourceTypeInt = static_cast<int>(info.resourceType());

  RequestDecision decision = service_->evaluateRequest(
      requestUrl, resourceTypeInt, firstPartyUrl, 0, QString::fromLatin1(info.requestMethod()).toLower());

  if (decision.action == DaliNiraBlockerAction::Block) {
    if (qEnvironmentVariableIntValue("DALINIRA_FEATURE_DIAGNOSTICS") == 1) {
      qInfo().noquote() << "[BLOCKER] request blocked";
    }
    info.block(true);
    return;
  }
  if (decision.action == DaliNiraBlockerAction::Redirect && !decision.redirectUrl.isEmpty()) {
    info.redirect(QUrl(decision.redirectUrl));
    return;
  }
  if (queryChanged) {
    info.redirect(requestUrl);
  }
}
