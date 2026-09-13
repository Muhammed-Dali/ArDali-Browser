#pragma once

#include <QString>

namespace ardali::application_identity {

inline constexpr auto kApplicationName = "ArDaliBrowser";
inline constexpr auto kDisplayName = "ArDali";
inline constexpr auto kOrganizationName = "ArDali";
inline constexpr auto kDesktopFileName = "ardali";
inline constexpr auto kStartupWmClass = "ArDaliBrowser";

void apply();

}  // namespace ardali::application_identity
