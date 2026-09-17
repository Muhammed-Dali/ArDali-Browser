#include "search_suggestion_service.h"
#include "search_engine_definition.h"
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSet>
#include <QUrlQuery>

SearchSuggestionService::SearchSuggestionService(QObject *parent, QNetworkAccessManager *network)
    : QObject(parent), network_(network ? network : new QNetworkAccessManager(this)) {
  debounce_.setSingleShot(true);
  debounce_.setInterval(200);
  connect(&debounce_, &QTimer::timeout, this, [this] { start(); });
}
void SearchSuggestionService::cancel() {
  ++generation_;
  debounce_.stop();
  completion_ = {};
  if (reply_) { auto reply = reply_; reply_.clear(); reply->abort(); reply->deleteLater(); }
  bytes_.clear();
}
void SearchSuggestionService::setEnabled(bool enabled) {
  if (enabled_ == enabled) return;
  enabled_ = enabled;
  cancel();
  cache_.clear();
}
bool SearchSuggestionService::safeQuery(const QString &query) {
  if (query.trimmed().isEmpty() || query.size() > 256) return false;
  // Do not transmit URL paths, credentials, local addresses, or explicit schemes.
  static const QRegularExpression unsafe(QStringLiteral("[\\x00-\\x1f\\x7f]|^[a-zA-Z][a-zA-Z0-9+.-]*:|[/\\\\@]|^(localhost|127\\.|192\\.168\\.|10\\.)"));
  return !unsafe.match(query.trimmed()).hasMatch();
}
QUrl SearchSuggestionService::endpoint(const QString &engine, const QString &query) {
  const auto &definition = ardali::core::searchEngineDefinition(engine);
  // Exact metadata membership: never interpret a caller-supplied URL as provider.
  if (engine != QString::fromLatin1(definition.id) || !safeQuery(query)) return {};
  QUrl url(QString::fromLatin1(definition.suggestUrl));
  QUrlQuery params(url);
  params.addQueryItem(QStringLiteral("q"), query);
  url.setQuery(params);
  return url;
}
QStringList SearchSuggestionService::parseResponse(const QByteArray &bytes) {
  if (bytes.size() > MaxResponseBytes) return {};
  QJsonParseError error;
  const auto document = QJsonDocument::fromJson(bytes, &error);
  if (error.error != QJsonParseError::NoError || !document.isArray()) return {};
  auto values = document.array();
  if (values.size() >= 2 && values[1].isArray()) values = values[1].toArray();
  QStringList result;
  QSet<QString> seen;
  for (const auto &value : values) {
    const QString text = (value.isObject() ? value.toObject().value(QStringLiteral("phrase")).toString() : value.toString()).trimmed();
    if (!safeQuery(text) || seen.contains(text.toCaseFolded())) continue;
    seen.insert(text.toCaseFolded());
    result.append(text);
    if (result.size() == MaxSuggestions) break;
  }
  return result;
}
void SearchSuggestionService::request(QObject *owner, const QString &query, const QString &engine,
                                      bool privateMode, Completion completion) {
  cancel();
  if (!owner || !enabled_ || privateMode || !endpoint(engine, query).isValid()) { completion({}); return; }
  owner_ = owner; query_ = query; engine_ = engine; completion_ = std::move(completion);
  debounce_.start();
}
void SearchSuggestionService::start() {
  if (!owner_ || !enabled_) return;
  const QString key = engine_ + QChar(0) + query_;
  if (auto *cached = cache_.object(key)) { auto done = std::move(completion_); if (done) done(*cached); return; }
  QNetworkRequest request(endpoint(engine_, query_));
  request.setTransferTimeout(4000);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
  request.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::AuthenticationReuseAttribute, QNetworkRequest::Manual);
  request.setRawHeader("Accept", "application/json");
  request.setRawHeader("User-Agent", "ArDali/6.1");
  auto *reply = network_->get(request);
  reply_ = reply;
  reply->setReadBufferSize(MaxResponseBytes + 1);
  const auto generation = generation_;
  connect(reply, &QNetworkReply::readyRead, this, [this, reply, generation] {
    if (generation != generation_) return;
    bytes_ += reply->read(MaxResponseBytes + 1 - bytes_.size());
    if (bytes_.size() > MaxResponseBytes || reply->header(QNetworkRequest::ContentLengthHeader).toLongLong() > MaxResponseBytes) reply->abort();
  });
  connect(reply, &QNetworkReply::finished, this, [this, reply, generation, key] {
    reply->deleteLater();
    if (generation != generation_) return;
    reply_.clear();
    bytes_ += reply->read(MaxResponseBytes + 1 - bytes_.size());
    QStringList result;
    if (enabled_ && owner_ && reply->error() == QNetworkReply::NoError &&
        reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() == 200)
      result = parseResponse(bytes_);
    bytes_.clear();
    if (!result.isEmpty()) cache_.insert(key, new QStringList(result));
    auto done = std::move(completion_);
    if (owner_ && done) done(result);
  });
  // Absolute timeout also covers a peer that trickles bytes indefinitely.
  QTimer::singleShot(4500, reply, [reply] { if (!reply->isFinished()) reply->abort(); });
}
