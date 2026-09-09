#include "search_engine_definition.h"

#include <QCoreApplication>

namespace ardali::core {

const std::array<SearchEngineDefinition, 4> &searchEngineDefinitions() {
  static const std::array<SearchEngineDefinition, 4> definitions{{
      {"Google", "google.ico", "Google'da arayın veya URL'yi yazın", "https://www.google.com/search", "https://suggestqueries.google.com/complete/search?client=firefox"},
      {"DuckDuckGo", "duckduckgo.ico", "DuckDuckGo'da arayın veya URL'yi yazın", "https://duckduckgo.com/", "https://duckduckgo.com/ac/?type=list"},
      {"Brave Search", "brave.ico", "Brave Search'te arayın veya URL'yi yazın", "https://search.brave.com/search", "https://search.brave.com/api/suggest"},
      {"Bing", "bing.ico", "Bing'de arayın veya URL'yi yazın", "https://www.bing.com/search", "https://api.bing.com/osjson.aspx"},
  }};
  return definitions;
}

const SearchEngineDefinition &searchEngineDefinition(const QString &engineName) {
  const QString lower = engineName.trimmed().toLower();
  const auto &definitions = searchEngineDefinitions();
  if (lower.contains(QLatin1String("duckduckgo")) || lower.contains(QLatin1String("duck")))
    return definitions[1];
  if (lower.contains(QLatin1String("brave"))) return definitions[2];
  if (lower.contains(QLatin1String("bing"))) return definitions[3];
  return definitions[0];
}

QString searchEngineIconAsset(const QString &engineName) {
  return QString::fromLatin1(searchEngineDefinition(engineName).iconAsset);
}

QString searchEngineResourcePath(const QString &engineName) {
  return QStringLiteral(":/search-engines/") + searchEngineIconAsset(engineName);
}

QString searchEnginePlaceholderText(const QString &engineName) {
  return QCoreApplication::translate("SearchPlaceholder", searchEngineDefinition(engineName).placeholder);
}

}  // namespace ardali::core
