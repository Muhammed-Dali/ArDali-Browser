#include "search_engine_definition.h"

#include <QCoreApplication>

namespace dalinira::core {

const std::array<SearchEngineDefinition, 4> &searchEngineDefinitions() {
  static const std::array<SearchEngineDefinition, 4> definitions{{
      {"Google", "google.ico", "Google'da arayın veya URL'yi yazın", "https://www.google.com/search", "https://suggestqueries.google.com/complete/search?client=firefox&oe=utf-8", "q"},
      {"DuckDuckGo", "duckduckgo.ico", "DuckDuckGo'da arayın veya URL'yi yazın", "https://duckduckgo.com/", "https://duckduckgo.com/ac/?type=list", "q"},
      {"Startpage", "startpage.ico", "Startpage'de arayın veya URL'yi yazın", "https://www.startpage.com/sp/search", "https://www.startpage.com/osuggestions", "query"},
      {"Mojeek", "mojeek.ico", "Mojeek'te arayın veya URL'yi yazın", "https://www.mojeek.com/search", "", "q"},
  }};
  return definitions;
}

const SearchEngineDefinition &searchEngineDefinition(const QString &engineName) {
  const QString lower = engineName.trimmed().toLower();
  const auto &definitions = searchEngineDefinitions();
  if (lower.contains(QLatin1String("duckduckgo")) || lower.contains(QLatin1String("duck")))
    return definitions[1];
  if (lower.contains(QLatin1String("startpage")))
    return definitions[2];
  if (lower.contains(QLatin1String("mojeek")))
    return definitions[3];
  if (lower.contains(QLatin1String("google")) || lower.contains(QLatin1String("brave")) || lower.contains(QLatin1String("bing")))
    return definitions[0];
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

}  // namespace dalinira::core
