#include "tab_window_registry.h"
#include "tab_strip_widget.h"

#include <cstdio>
#include <cstdlib>

namespace dalinira::desktop_tabs {

TabWindowRegistry &TabWindowRegistry::instance() {
  static TabWindowRegistry s_instance;
  return s_instance;
}

void TabWindowRegistry::registerWindow(QWidget *window, TabStripWidget *tabStrip) {
  if (!window || !tabStrip) return;

  // Check if already registered
  for (auto &entry : windows_) {
    if (entry.window == window) {
      entry.tabStrip = tabStrip;
      return;
    }
  }
  windows_.append({window, tabStrip});
}

void TabWindowRegistry::unregisterWindow(QWidget *window) {
  if (!window) return;
  windows_.removeIf([window](const RegisteredWindow &entry) {
    return entry.window == nullptr || entry.window == window;
  });
}

QList<RegisteredWindow> TabWindowRegistry::registeredWindows() const {
  QList<RegisteredWindow> result;
  for (const auto &entry : windows_) {
    if (entry.window && entry.tabStrip) {
      result.append(entry);
    }
  }
  return result;
}

void TabWindowRegistry::reloadTabAppearances() {
  for (auto &entry : windows_) {
    if (entry.tabStrip) entry.tabStrip->loadSettings();
  }
}

RegisteredWindow TabWindowRegistry::findTargetAt(const QPoint &globalScreenPoint, QWidget *excludeWindow) const {
  QWidget *topExclude = excludeWindow ? excludeWindow->window() : nullptr;
  const QVariant sourceProfile = topExclude
      ? topExclude->property("daliniraTabProfile") : QVariant{};
  const QVariant sourceWindowType = topExclude
      ? topExclude->property("daliniraTabWindowType") : QVariant{};

  for (const auto &entry : windows_) {
    if (!entry.window || !entry.tabStrip) continue;
    if (entry.window.data() == excludeWindow || entry.window->window() == topExclude) continue;
    if (!entry.window->isVisible() || entry.window->isMinimized()) continue;
    if (entry.window->property("daliniraDragCaptureShell").toBool() ||
        entry.window->property("daliniraTabClosing").toBool()) continue;
    if (sourceProfile.isValid() && entry.window->property("daliniraTabProfile").isValid() &&
        entry.window->property("daliniraTabProfile") != sourceProfile) continue;
    if (sourceWindowType.isValid() && entry.window->property("daliniraTabWindowType").isValid() &&
        entry.window->property("daliniraTabWindowType") != sourceWindowType) continue;

    // The strip can live inside a scroller and may extend beyond the client
    // geometry reported for a frameless top-level window. Its mapped bounds
    // are the authoritative target geometry.
    const QPoint localPos = entry.tabStrip->mapFromGlobal(globalScreenPoint);
    const QRect dropBounds = entry.tabStrip->attachBoundary();

    if (dropBounds.contains(localPos)) {
      if (qEnvironmentVariableIntValue("DALINIRA_DESKTOP_TAB_DIAGNOSTICS") == 1 ||
          qEnvironmentVariableIntValue("DALINIRA_TAB_DIAGNOSTICS") == 1) {
        std::fprintf(stderr, "[REGISTRY] TargetFound window=%p strip=%p\n",
                     static_cast<void *>(entry.window.data()),
                     static_cast<void *>(entry.tabStrip.data()));
      }
      return entry;
    }
  }
  return {nullptr, nullptr};
}

void TabWindowRegistry::clear() {
  windows_.clear();
}

}  // namespace dalinira::desktop_tabs
