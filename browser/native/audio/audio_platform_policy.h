#pragma once

#include <QStringList>
#include <QUrl>

namespace dalinira::audio {

// Single authoritative allowlist for the Web Audio runtime. Subdomains are
// accepted only at a DNS-label boundary (host == domain or "." + domain).
const QStringList &supportedAudioPlatformDomains();
bool isSupportedAudioPlatform(const QUrl &url);

}  // namespace dalinira::audio
