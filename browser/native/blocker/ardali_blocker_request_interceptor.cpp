#include "ardali_blocker_request_interceptor.h"

#include <QUrl>
#include <QUrlQuery>
#include "ardali_blocker_service.h"

ArDaliBlockerRequestInterceptor::ArDaliBlockerRequestInterceptor(ArDaliBlockerService *service, QObject *parent)
    : QWebEngineUrlRequestInterceptor(parent), service_(service) {}

void ArDaliBlockerRequestInterceptor::interceptRequest(QWebEngineUrlRequestInfo &info) {
  QUrl requestUrl = info.requestUrl();
  if (!requestUrl.isValid()) return;

  const QString scheme = requestUrl.scheme().toLower();
  if (scheme == QLatin1String("ardali")) {
    if (requestUrl.host() == QLatin1String("bypass-strictblock")) {
      const QString domain = QUrlQuery(requestUrl).queryItemValue(QStringLiteral("domain"));
      if (!domain.isEmpty() && service_) {
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

  // 2. Evaluate with ArDali Blocker Service
  if (!service_) return;

  const QUrl firstPartyUrl = info.firstPartyUrl();
  const int resourceTypeInt = static_cast<int>(info.resourceType());

  RequestDecision decision = service_->evaluateRequest(
      requestUrl, resourceTypeInt, firstPartyUrl, 0, QString::fromLatin1(info.requestMethod()).toLower());

  if (decision.action == ArDaliBlockerAction::Block) {
    info.block(true);
    return;
  }
  if (decision.action == ArDaliBlockerAction::Redirect && !decision.redirectUrl.isEmpty()) {
    info.redirect(QUrl(decision.redirectUrl));
    return;
  }
  if (queryChanged) {
    info.redirect(requestUrl);
  }
}
