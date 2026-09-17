#pragma once

#include "language_manager.h"

namespace ardali::i18n {

class I18n {
 public:
  static inline QString text(const QString &key, const QString &fallback = QString()) {
    return LanguageManager::instance().translate(key, fallback);
  }

  static inline QString tr(const QString &key, const QString &fallback = QString()) {
    return LanguageManager::instance().translate(key, fallback);
  }

  static inline QString text(const QString &key, const QVariantMap &replacements) {
    return LanguageManager::instance().translate(key, replacements);
  }

  static inline bool isRtl() {
    return LanguageManager::instance().isRtl();
  }

  static inline QString activeLanguageCode() {
    return LanguageManager::instance().activeLanguageCode();
  }
};

}  // namespace ardali::i18n

namespace ardali {
using I18n = ardali::i18n::I18n;
}

using I18n = ardali::i18n::I18n;
