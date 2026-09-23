#pragma once

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <limits>
#include <vector>

#if defined(__linux__)
#include <malloc.h>
#endif

#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QString>
#include <QStringList>

#include "core/adult_content_protection.h"

namespace dalinira::core {

#pragma pack(push, 1)
struct CompactDomainEntry {
  uint32_t offset = 0;
  uint16_t length = 0;
};
#pragma pack(pop)

class CompactDomainTable {
 public:
  CompactDomainTable() = default;
  ~CompactDomainTable() = default;

  // Build from file with performance breakdown
  DomainListStats loadFromFile(const QString &filePath,
                               qint64 *parseTimeMs = nullptr,
                               qint64 *buildTimeMs = nullptr) {
    DomainListStats stats;
    clear();

    QElapsedTimer parseTimer;
    parseTimer.start();

    QFile file(filePath);
    if (!file.open(QIODevice::ReadOnly)) {
      return stats;
    }

    QByteArray fileData = file.readAll();
    file.close();

    std::vector<std::string> validDomains;
    validDomains.reserve(std::max<size_t>(260000, static_cast<size_t>(fileData.size() / 18)));

    const char *data = fileData.constData();
    const qint64 totalLen = fileData.size();
    qint64 pos = 0;

    QString lineStr;
    lineStr.reserve(256);

    while (pos < totalLen) {
      qint64 lineEnd = pos;
      while (lineEnd < totalLen && data[lineEnd] != '\n' && data[lineEnd] != '\r') {
        lineEnd++;
      }

      const qint64 lineLen = lineEnd - pos;
      if (lineLen > 0) {
        qint64 start = pos;
        while (start < lineEnd && (data[start] == ' ' || data[start] == '\t')) {
          start++;
        }
        if (start < lineEnd && data[start] != '#') {
          qint64 end = lineEnd;
          while (end > start && (data[end - 1] == ' ' || data[end - 1] == '\t')) {
            end--;
          }
          while (end > start && data[end - 1] == '.') {
            end--;
          }

          if (end > start) {
            lineStr = QString::fromLatin1(data + start, static_cast<int>(end - start));
            const int colon = lineStr.lastIndexOf(QLatin1Char(':'));
            if (colon > 0) {
              lineStr = lineStr.left(colon);
            }
            const QString lower = lineStr.toLower();
            if (AdultContentProtectionService::isValidCanonicalDomain(lower)) {
              validDomains.push_back(lower.toStdString());
            } else {
              stats.invalidCount++;
            }
          }
        }
      }

      pos = lineEnd;
      while (pos < totalLen && (data[pos] == '\n' || data[pos] == '\r')) {
        pos++;
      }
    }

    fileData.clear();

    if (parseTimeMs) {
      *parseTimeMs = parseTimer.elapsed();
    }

    QElapsedTimer buildTimer;
    buildTimer.start();

    // Sort lexicographically
    std::sort(validDomains.begin(), validDomains.end());

    // Deduplicate
    auto last = std::unique(validDomains.begin(), validDomains.end());
    stats.duplicateCount = static_cast<int>(validDomains.end() - last);
    validDomains.erase(last, validDomains.end());
    stats.validCount = static_cast<int>(validDomains.size());

    // Pack into single contiguous byte buffer and compact index
    size_t totalChars = 0;
    for (const auto &d : validDomains) {
      totalChars += d.size();
    }

    buffer_.resize(totalChars);
    index_.resize(validDomains.size());

    uint32_t currentOffset = 0;
    for (size_t i = 0; i < validDomains.size(); ++i) {
      const auto &d = validDomains[i];
      std::memcpy(buffer_.data() + currentOffset, d.data(), d.size());
      index_[i].offset = currentOffset;
      index_[i].length = static_cast<uint16_t>(d.size());
      currentOffset += static_cast<uint32_t>(d.size());
    }

    // Release temporary memory immediately
    std::vector<std::string>().swap(validDomains);
#if defined(__linux__)
    malloc_trim(0);
#endif

    if (buildTimeMs) {
      *buildTimeMs = buildTimer.elapsed();
    }

    return stats;
  }

  // Build from pre-split lines
  DomainListStats loadFromLines(const QStringList &lines,
                                qint64 *parseTimeMs = nullptr,
                                qint64 *buildTimeMs = nullptr) {
    DomainListStats stats;
    clear();

    QElapsedTimer parseTimer;
    parseTimer.start();

    std::vector<std::string> validDomains;
    validDomains.reserve(lines.size());

    for (const QString &line : lines) {
      QString trimmed = line.trimmed();
      if (trimmed.isEmpty() || trimmed.startsWith(QLatin1Char('#'))) {
        continue;
      }
      while (trimmed.endsWith(QLatin1Char('.'))) {
        trimmed.chop(1);
      }
      const int colon = trimmed.lastIndexOf(QLatin1Char(':'));
      if (colon > 0) {
        trimmed = trimmed.left(colon);
      }
      const QString lower = trimmed.toLower();
      if (!AdultContentProtectionService::isValidCanonicalDomain(lower)) {
        stats.invalidCount++;
        continue;
      }
      validDomains.push_back(lower.toStdString());
    }

    if (parseTimeMs) {
      *parseTimeMs = parseTimer.elapsed();
    }

    QElapsedTimer buildTimer;
    buildTimer.start();

    std::sort(validDomains.begin(), validDomains.end());
    auto last = std::unique(validDomains.begin(), validDomains.end());
    stats.duplicateCount = static_cast<int>(validDomains.end() - last);
    validDomains.erase(last, validDomains.end());
    stats.validCount = static_cast<int>(validDomains.size());

    size_t totalChars = 0;
    for (const auto &d : validDomains) {
      totalChars += d.size();
    }

    buffer_.resize(totalChars);
    index_.resize(validDomains.size());

    uint32_t currentOffset = 0;
    for (size_t i = 0; i < validDomains.size(); ++i) {
      const auto &d = validDomains[i];
      std::memcpy(buffer_.data() + currentOffset, d.data(), d.size());
      index_[i].offset = currentOffset;
      index_[i].length = static_cast<uint16_t>(d.size());
      currentOffset += static_cast<uint32_t>(d.size());
    }

    std::vector<std::string>().swap(validDomains);
#if defined(__linux__)
    malloc_trim(0);
#endif

    if (buildTimeMs) {
      *buildTimeMs = buildTimer.elapsed();
    }

    return stats;
  }

  // Versioned binary snapshot. The format is deliberately simple and self-validating:
  // magic[8] + version/u32 + count/u32 + bufferSize/u64 + payloadHash/u64,
  // followed by count * (offset/u32,length/u16) and the contiguous domain bytes.
  bool saveSnapshot(const QString &filePath) const {
    if (index_.empty() || buffer_.empty()) return false;

    QByteArray payload;
    payload.reserve(static_cast<qsizetype>(indexBytes() + bufferBytes()));
    auto appendU16 = [&payload](uint16_t v) {
      payload.append(static_cast<char>(v & 0xff));
      payload.append(static_cast<char>((v >> 8) & 0xff));
    };
    auto appendU32 = [&payload](uint32_t v) {
      for (int i = 0; i < 4; ++i) payload.append(static_cast<char>((v >> (i * 8)) & 0xff));
    };
    for (const auto &e : index_) {
      appendU32(e.offset);
      appendU16(e.length);
    }
    payload.append(buffer_.data(), static_cast<qsizetype>(buffer_.size()));

    const uint64_t hash = fnv1a64(payload.constData(), static_cast<size_t>(payload.size()));
    QSaveFile out(filePath);
    if (!out.open(QIODevice::WriteOnly)) return false;
    QByteArray header;
    header.append("DLADULT1", 8);
    auto headerU32 = [&header](uint32_t v) {
      for (int i = 0; i < 4; ++i) header.append(static_cast<char>((v >> (i * 8)) & 0xff));
    };
    auto headerU64 = [&header](uint64_t v) {
      for (int i = 0; i < 8; ++i) header.append(static_cast<char>((v >> (i * 8)) & 0xff));
    };
    headerU32(kSnapshotVersion);
    headerU32(static_cast<uint32_t>(index_.size()));
    headerU64(static_cast<uint64_t>(buffer_.size()));
    headerU64(hash);
    if (out.write(header) != header.size() || out.write(payload) != payload.size()) {
      out.cancelWriting();
      return false;
    }
    return out.commit();
  }

  bool loadSnapshot(const QString &filePath, qint64 *loadTimeMs = nullptr) {
    QElapsedTimer timer;
    timer.start();
    clear();

    QFile in(filePath);
    if (!in.open(QIODevice::ReadOnly)) return false;
    const QByteArray bytes = in.readAll();
    constexpr qsizetype kHeaderSize = 32;
    if (bytes.size() < kHeaderSize || std::memcmp(bytes.constData(), "DLADULT1", 8) != 0) return false;

    const auto readU16 = [](const char *p) -> uint16_t {
      return static_cast<uint16_t>(static_cast<unsigned char>(p[0])) |
             (static_cast<uint16_t>(static_cast<unsigned char>(p[1])) << 8);
    };
    const auto readU32 = [](const char *p) -> uint32_t {
      uint32_t v = 0;
      for (int i = 0; i < 4; ++i) v |= static_cast<uint32_t>(static_cast<unsigned char>(p[i])) << (i * 8);
      return v;
    };
    const auto readU64 = [](const char *p) -> uint64_t {
      uint64_t v = 0;
      for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(static_cast<unsigned char>(p[i])) << (i * 8);
      return v;
    };

    const uint32_t version = readU32(bytes.constData() + 8);
    const uint32_t count = readU32(bytes.constData() + 12);
    const uint64_t bufferSize = readU64(bytes.constData() + 16);
    const uint64_t expectedHash = readU64(bytes.constData() + 24);
    if (version != kSnapshotVersion || count == 0 || bufferSize == 0) return false;
    const uint64_t indexSize = static_cast<uint64_t>(count) * 6ULL;
    const uint64_t payloadSize = indexSize + bufferSize;
    if (payloadSize > static_cast<uint64_t>(std::numeric_limits<qsizetype>::max()) ||
        static_cast<uint64_t>(bytes.size() - kHeaderSize) != payloadSize) return false;

    const char *payload = bytes.constData() + kHeaderSize;
    if (fnv1a64(payload, static_cast<size_t>(payloadSize)) != expectedHash) return false;

    std::vector<CompactDomainEntry> newIndex(count);
    std::vector<char> newBuffer(static_cast<size_t>(bufferSize));
    for (uint32_t i = 0; i < count; ++i) {
      const char *entry = payload + static_cast<size_t>(i) * 6;
      newIndex[i].offset = readU32(entry);
      newIndex[i].length = readU16(entry + 4);
      const uint64_t end = static_cast<uint64_t>(newIndex[i].offset) + newIndex[i].length;
      if (newIndex[i].length == 0 || end > bufferSize) return false;
    }
    std::memcpy(newBuffer.data(), payload + indexSize, static_cast<size_t>(bufferSize));

    // Reject malformed snapshots whose index is not strictly sorted/unique.
    for (size_t i = 1; i < newIndex.size(); ++i) {
      const auto &a = newIndex[i - 1];
      const auto &b = newIndex[i];
      std::string_view sa(newBuffer.data() + a.offset, a.length);
      std::string_view sb(newBuffer.data() + b.offset, b.length);
      if (!(sa < sb)) return false;
    }

    index_.swap(newIndex);
    buffer_.swap(newBuffer);
    if (loadTimeMs) *loadTimeMs = timer.elapsed();
    return true;
  }

  // Exact binary search
  bool contains(std::string_view domain) const {
    if (index_.empty() || domain.empty()) return false;

    auto it = std::lower_bound(index_.begin(), index_.end(), domain,
      [this](const CompactDomainEntry &entry, std::string_view target) {
        std::string_view s(buffer_.data() + entry.offset, entry.length);
        return s < target;
      });

    if (it != index_.end()) {
      std::string_view found(buffer_.data() + it->offset, it->length);
      return found == domain;
    }
    return false;
  }

  bool contains(const QString &domain) const {
    const QByteArray utf8 = domain.toUtf8();
    return contains(std::string_view(utf8.constData(), utf8.size()));
  }

  // Domain boundary search (left label peeling: a.b.example.com -> b.example.com -> example.com -> com)
  bool matchesDomain(std::string_view normalizedHost) const {
    if (normalizedHost.empty() || index_.empty()) return false;

    std::string_view candidate = normalizedHost;
    while (!candidate.empty()) {
      if (contains(candidate)) {
        return true;
      }
      const size_t dot = candidate.find('.');
      if (dot == std::string_view::npos) {
        break;
      }
      candidate.remove_prefix(dot + 1);
    }
    return false;
  }

  bool matchesDomain(const QString &normalizedHost) const {
    if (normalizedHost.isEmpty() || index_.empty()) return false;
    const QByteArray utf8 = normalizedHost.toUtf8();
    return matchesDomain(std::string_view(utf8.constData(), utf8.size()));
  }

  // Full check including normalization and allowlist
  bool isBlockedHost(const QString &rawHost,
                     const AdultContentProtectionService &service) const {
    const QString h = AdultContentProtectionService::normalizeHost(rawHost);
    if (h.isEmpty()) return false;

    // 1. Allowlist precedence
    if (service.isAllowedHost(h)) {
      return false;
    }

    // 2. Compact table lookup
    return matchesDomain(h);
  }

  size_t domainCount() const { return index_.size(); }
  std::string_view domainAt(size_t i) const {
    if (i >= index_.size()) return {};
    return std::string_view(buffer_.data() + index_[i].offset, index_[i].length);
  }
  size_t bufferBytes() const { return buffer_.size(); }
  size_t indexBytes() const { return index_.size() * sizeof(CompactDomainEntry); }
  size_t totalStructureBytes() const { return bufferBytes() + indexBytes(); }


  void clear() {
    buffer_.clear();
    buffer_.shrink_to_fit();
    index_.clear();
    index_.shrink_to_fit();
  }

 private:
  static constexpr uint32_t kSnapshotVersion = 1;
  static uint64_t fnv1a64(const char *data, size_t len) {
    uint64_t hash = 14695981039346656037ULL;
    for (size_t i = 0; i < len; ++i) {
      hash ^= static_cast<unsigned char>(data[i]);
      hash *= 1099511628211ULL;
    }
    return hash;
  }

  std::vector<char> buffer_;
  std::vector<CompactDomainEntry> index_;
};

} // namespace dalinira::core
