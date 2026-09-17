#pragma once

#include <array>

#include <QString>

namespace ardali::core {

struct SearchEngineDefinition {
  const char *id;
  const char *iconAsset;
  const char *placeholder;
  const char *searchUrl;
  const char *suggestUrl;
};

const std::array<SearchEngineDefinition, 4> &searchEngineDefinitions();
const SearchEngineDefinition &searchEngineDefinition(const QString &engineName);
QString searchEngineIconAsset(const QString &engineName);
QString searchEngineResourcePath(const QString &engineName);
QString searchEnginePlaceholderText(const QString &engineName);

}  // namespace ardali::core
