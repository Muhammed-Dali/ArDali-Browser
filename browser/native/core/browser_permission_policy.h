#pragma once

#include <QWebEnginePage>

namespace BrowserPermissionPolicy {

enum class Decision { Deny, Grant };

// Legacy Qt WebEngine permissions must always result from an explicit user
// choice. The default/no-answer path is deny.
constexpr Decision decisionForExplicitUserChoice(bool approved) {
  return approved ? Decision::Grant : Decision::Deny;
}

constexpr bool legacyPermissionsAreAutoGranted() { return false; }

QString featureName(QWebEnginePage::Feature feature);

}  // namespace BrowserPermissionPolicy
