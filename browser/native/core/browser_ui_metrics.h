#pragma once

namespace ardali::ui {

// Browser chrome metrics in Qt logical pixels. Qt 6 maps these to physical
// pixels using the screen's devicePixelRatio; callers must not multiply them.
struct BrowserChromeMetrics {
  static constexpr int topBarHeight = 40;
  static constexpr int navigationBarHeight = 46;
  static constexpr int navigationButtonSize = 32;
  static constexpr int navigationIconSize = 20;
  static constexpr int omniboxHeight = 34;
  static constexpr int bookmarkBarHeight = 32;
  static constexpr int bookmarkIconSize = 18;
  static constexpr int bookmarkButtonHeight = 28;
  static constexpr int tabSearchButtonSize = 32;
};

} // namespace ardali::ui
