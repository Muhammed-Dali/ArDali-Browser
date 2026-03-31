// ============================================================
// SDL2 + OpenGL + projectM + Dear ImGui (paketlenmiş)
// - SDL2_ttf yok
// - HiDPI: viewport için drawable boyutunu kullanır; DPI ölçeği değişince ImGui fontlarını yeniden yükler ve stili ölçekler.
// - OpenGL yükleyici: CUSTOM (SDL_GL_GetProcAddress)
// ============================================================

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <errno.h>
#include <filesystem>
#include <fcntl.h>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <unistd.h>
#include <unordered_set>
#include <unordered_map>
#include <vector>

#include <SDL2/SDL.h>
#include <SDL2/SDL_version.h>
#ifdef _WIN32
#include <SDL2/SDL_syswm.h>
#endif

#ifdef SDL_IMAGE_MAJOR_VERSION
#include <SDL2/SDL_image.h>
#endif

#ifdef _WIN32
#include <windows.h>
#include <dwmapi.h>
#include <io.h>
#include <GL/glew.h>
#endif
#include <SDL2/SDL_opengl.h>

#ifndef _WIN32
#include <fcntl.h>
#include <unistd.h>
#endif

// projectM headers differ by distro/package/version.
// Some distros ship a "projectM.h" umbrella header; others require including individual API headers.
// Include the umbrella if present, then explicitly include the C-API headers we rely on.
#if __has_include(<projectM-4/projectM.h>)
  #include <projectM-4/projectM.h>
#elif __has_include(<projectM/projectM.h>)
  #include <projectM/projectM.h>
#elif __has_include(<libprojectM/projectM.h>)
  #include <libprojectM/projectM.h>
#elif __has_include(<projectM.h>)
  #include <projectM.h>
#else
  #error "projectM headers not found. Install libprojectm-dev (and playlist dev package if required) or adjust include paths."
#endif

// Ensure types + the specific APIs used in this file are declared (some umbrellas don't include everything).
#if __has_include(<projectM-4/types.h>)
  #include <projectM-4/types.h>
  #include <projectM-4/audio.h>
  #include <projectM-4/core.h>
  #include <projectM-4/parameters.h>
  #include <projectM-4/render_opengl.h>
  #include <projectM-4/version.h>
#elif __has_include(<projectM/types.h>)
  #include <projectM/types.h>
  #if __has_include(<projectM/audio.h>)
    #include <projectM/audio.h>
  #endif
  #if __has_include(<projectM/core.h>)
    #include <projectM/core.h>
  #endif
  #if __has_include(<projectM/parameters.h>)
    #include <projectM/parameters.h>
  #endif
  #if __has_include(<projectM/render_opengl.h>)
    #include <projectM/render_opengl.h>
  #endif
  #if __has_include(<projectM/version.h>)
    #include <projectM/version.h>
  #endif
#elif __has_include(<libprojectM/types.h>)
  #include <libprojectM/types.h>
  #if __has_include(<libprojectM/audio.h>)
    #include <libprojectM/audio.h>
  #endif
  #if __has_include(<libprojectM/core.h>)
    #include <libprojectM/core.h>
  #endif
  #if __has_include(<libprojectM/parameters.h>)
    #include <libprojectM/parameters.h>
  #endif
  #if __has_include(<libprojectM/render_opengl.h>)
    #include <libprojectM/render_opengl.h>
  #endif
  #if __has_include(<libprojectM/version.h>)
    #include <libprojectM/version.h>
  #endif
#elif __has_include(<types.h>)
  #include <types.h>
  #if __has_include(<audio.h>)
    #include <audio.h>
  #endif
  #if __has_include(<core.h>)
    #include <core.h>
  #endif
  #if __has_include(<parameters.h>)
    #include <parameters.h>
  #endif
  #if __has_include(<render_opengl.h>)
    #include <render_opengl.h>
  #endif
  #if __has_include(<version.h>)
    #include <version.h>
  #endif
#endif

#include "gl_loader.h"

#include "imgui.h"
#include "backends/imgui_impl_opengl3.h"
#include "backends/imgui_impl_sdl2.h"

namespace fs = std::filesystem;

static void setSdlWindowIconFromEnv(SDL_Window* w) {
    if (!w) return;

#ifdef _WIN32
    auto applyWindowsTitlebarTheme = [&](HWND hwnd) {
        if (!hwnd) return;
        // Windows 10/11: prefer dark caption so titlebar is not bright white.
        BOOL dark = TRUE;
        constexpr DWORD DWMWA_USE_IMMERSIVE_DARK_MODE_20 = 20;
        constexpr DWORD DWMWA_USE_IMMERSIVE_DARK_MODE_19 = 19;
        HRESULT hr = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_20, &dark, sizeof(dark));
        if (FAILED(hr)) {
            (void)DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_19, &dark, sizeof(dark));
        }
        // Optional explicit caption/text colors (supported on newer Windows builds).
        constexpr DWORD DWMWA_CAPTION_COLOR = 35;
        constexpr DWORD DWMWA_TEXT_COLOR = 36;
        COLORREF caption = RGB(24, 24, 24);
        COLORREF text = RGB(236, 236, 236);
        (void)DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &caption, sizeof(caption));
        (void)DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, &text, sizeof(text));
    };

    // Windows titlebar (sol ust) ikonu: WM_SETICON ile .ico yuklemek daha guvenilir.
    if (const char* icoPath = std::getenv("AURIVO_VISUALIZER_ICON_ICO")) {
        if (icoPath && *icoPath) {
            SDL_SysWMinfo wmInfo;
            SDL_VERSION(&wmInfo.version);
            if (SDL_GetWindowWMInfo(w, &wmInfo) == SDL_TRUE) {
                HWND hwnd = wmInfo.info.win.window;
                applyWindowsTitlebarTheme(hwnd);

                auto utf8ToWide = [](const char* s) -> std::wstring {
                    if (!s) return L"";
                    int len = MultiByteToWideChar(CP_UTF8, 0, s, -1, nullptr, 0);
                    if (len <= 0) return L"";
                    std::wstring out;
                    out.resize((size_t)len);
                    MultiByteToWideChar(CP_UTF8, 0, s, -1, out.data(), len);
                    if (!out.empty() && out.back() == L'\0') out.pop_back();
                    return out;
                };

                static HICON gIcoBig = nullptr;
                static HICON gIcoSmall = nullptr;

                std::wstring wpath = utf8ToWide(icoPath);
                if (!wpath.empty()) {
                    if (!gIcoBig) {
                        gIcoBig = (HICON)LoadImageW(nullptr, wpath.c_str(), IMAGE_ICON, 256, 256,
                                                   LR_LOADFROMFILE | LR_DEFAULTCOLOR);
                    }
                    if (!gIcoSmall) {
                        gIcoSmall = (HICON)LoadImageW(nullptr, wpath.c_str(), IMAGE_ICON, 32, 32,
                                                     LR_LOADFROMFILE | LR_DEFAULTCOLOR);
                    }
                    if (gIcoBig) SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)gIcoBig);
                    if (gIcoSmall) SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)gIcoSmall);
                    if (gIcoBig) SetClassLongPtrW(hwnd, GCLP_HICON, (LONG_PTR)gIcoBig);
                    if (gIcoSmall) SetClassLongPtrW(hwnd, GCLP_HICONSM, (LONG_PTR)gIcoSmall);

                    // Eger ikon ayarlandiysa, BMP fallback'e gecmeye gerek yok.
                    if (gIcoBig || gIcoSmall) return;
                }
            }
        }
    }

    // Even if ico env is missing, still try to apply dark titlebar.
    SDL_SysWMinfo wmInfo;
    SDL_VERSION(&wmInfo.version);
    if (SDL_GetWindowWMInfo(w, &wmInfo) == SDL_TRUE) {
        applyWindowsTitlebarTheme(wmInfo.info.win.window);
    }
#endif

    const char* iconPath = std::getenv("AURIVO_VISUALIZER_ICON");
    if (!iconPath || !*iconPath) return;

    SDL_Surface* iconSurf = nullptr;
#ifdef SDL_IMAGE_MAJOR_VERSION
    iconSurf = IMG_Load(iconPath);
#else
    // SDL_LoadBMP PNG okuyamaz; bu yüzden ana süreçten BMP yolunu geçiyoruz.
    iconSurf = SDL_LoadBMP(iconPath);
#endif
    if (!iconSurf) {
        std::cerr << "[Icon] failed to load: " << iconPath << " (" << SDL_GetError() << ")" << std::endl;
        return;
    }

    SDL_SetWindowIcon(w, iconSurf);
    SDL_FreeSurface(iconSurf);
}

#ifdef _WIN32
static void setWindowsAppUserModelId() {
    // Group visualizer with the main Aurivo app on taskbar.
    // Must be called before top-level windows are created.
    using SetAppIdFn = HRESULT (WINAPI*)(PCWSTR);
    HMODULE shell32 = LoadLibraryW(L"shell32.dll");
    if (!shell32) return;
    auto setAppId = reinterpret_cast<SetAppIdFn>(GetProcAddress(shell32, "SetCurrentProcessExplicitAppUserModelID"));
    if (setAppId) {
        (void)setAppId(L"com.aurivo.mediaplayer");
    }
    FreeLibrary(shell32);
}
#endif

enum class UiLang {
    EN,
    TR,
    AR,
    FR,
    DE,
    ES,
    HI,
};

static const char* fixMojibakeCached(const char* s);

static std::string toLowerAscii(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

static void utf8Append(std::string& out, uint32_t cp) {
    if (cp <= 0x7F) {
        out.push_back((char)cp);
    } else if (cp <= 0x7FF) {
        out.push_back((char)(0xC0 | ((cp >> 6) & 0x1F)));
        out.push_back((char)(0x80 | (cp & 0x3F)));
    } else if (cp <= 0xFFFF) {
        out.push_back((char)(0xE0 | ((cp >> 12) & 0x0F)));
        out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back((char)(0x80 | (cp & 0x3F)));
    } else {
        out.push_back((char)(0xF0 | ((cp >> 18) & 0x07)));
        out.push_back((char)(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back((char)(0x80 | (cp & 0x3F)));
    }
}

static bool utf8DecodeOne(const char* s, size_t len, size_t& i, uint32_t& outCp) {
    if (i >= len) return false;
    const unsigned char c0 = (unsigned char)s[i];
    if (c0 < 0x80) {
        outCp = c0;
        i += 1;
        return true;
    }
    if ((c0 & 0xE0) == 0xC0 && i + 1 < len) {
        const unsigned char c1 = (unsigned char)s[i + 1];
        if ((c1 & 0xC0) != 0x80) { i += 1; outCp = 0xFFFD; return true; }
        outCp = ((uint32_t)(c0 & 0x1F) << 6) | (uint32_t)(c1 & 0x3F);
        i += 2;
        return true;
    }
    if ((c0 & 0xF0) == 0xE0 && i + 2 < len) {
        const unsigned char c1 = (unsigned char)s[i + 1];
        const unsigned char c2 = (unsigned char)s[i + 2];
        if (((c1 & 0xC0) != 0x80) || ((c2 & 0xC0) != 0x80)) { i += 1; outCp = 0xFFFD; return true; }
        outCp = ((uint32_t)(c0 & 0x0F) << 12) | ((uint32_t)(c1 & 0x3F) << 6) | (uint32_t)(c2 & 0x3F);
        i += 3;
        return true;
    }
    if ((c0 & 0xF8) == 0xF0 && i + 3 < len) {
        const unsigned char c1 = (unsigned char)s[i + 1];
        const unsigned char c2 = (unsigned char)s[i + 2];
        const unsigned char c3 = (unsigned char)s[i + 3];
        if (((c1 & 0xC0) != 0x80) || ((c2 & 0xC0) != 0x80) || ((c3 & 0xC0) != 0x80)) { i += 1; outCp = 0xFFFD; return true; }
        outCp = ((uint32_t)(c0 & 0x07) << 18) | ((uint32_t)(c1 & 0x3F) << 12) | ((uint32_t)(c2 & 0x3F) << 6) | (uint32_t)(c3 & 0x3F);
        i += 4;
        return true;
    }
    i += 1;
    outCp = 0xFFFD;
    return true;
}

static bool isArabicDiacritic(uint32_t cp) {
    return (cp >= 0x064B && cp <= 0x065F) || cp == 0x0670 || (cp >= 0x06D6 && cp <= 0x06ED);
}

static bool isArabicJoinCandidate(uint32_t cp) {
    // Arapça harfler (temel + genişletilmiş) ve birazdan üreteceğimiz sunum biçimleri.
    if (cp >= 0x0600 && cp <= 0x06FF) return true;
    if (cp >= 0x0750 && cp <= 0x077F) return true;
    if (cp >= 0x08A0 && cp <= 0x08FF) return true;
    return false;
}

enum class ArabicJoinType { NONE, RIGHT, DUAL };

static ArabicJoinType arabicJoinType(uint32_t cp) {
    // Bağlanmayan / şeffaf işaretler
    if (!isArabicJoinCandidate(cp) || isArabicDiacritic(cp)) return ArabicJoinType::NONE;

    // Sağa bağlanan (yalnızca öncekiyle bağlanır)
    switch (cp) {
        case 0x0622: // Ø¢
        case 0x0623: // Ø£
        case 0x0624: // Ø¤
        case 0x0625: // Ø¥
        case 0x0627: // Ø§
        case 0x0629: // Ø©
        case 0x062F: // Ø¯
        case 0x0630: // Ø°
        case 0x0631: // Ø±
        case 0x0632: // Ø²
        case 0x0648: // Ùˆ
        case 0x0649: // Ù‰
            return ArabicJoinType::RIGHT;
        default:
            break;
    }

    // UI metnimizdeki diğer harflerin çoğu için çift yönlü bağlanan
    if ((cp >= 0x0626 && cp <= 0x0647) || cp == 0x064A) return ArabicJoinType::DUAL;
    return ArabicJoinType::NONE;
}

struct ArabicForms {
    uint32_t isolated = 0;
    uint32_t finalForm = 0;
    uint32_t initial = 0;
    uint32_t medial = 0;
};

static const ArabicForms* arabicForms(uint32_t cp) {
    // UI stringleri için minimal eşleme tablosu (Arapça Sunum Biçimleri-B).
    static const std::pair<uint32_t, ArabicForms> table[] = {
        {0x0622, {0xFE81, 0xFE82, 0, 0}}, // Ø¢
        {0x0623, {0xFE83, 0xFE84, 0, 0}}, // Ø£
        {0x0624, {0xFE85, 0xFE86, 0, 0}}, // Ø¤
        {0x0625, {0xFE87, 0xFE88, 0, 0}}, // Ø¥
        {0x0626, {0xFE89, 0xFE8A, 0xFE8B, 0xFE8C}}, // Ø¦
        {0x0627, {0xFE8D, 0xFE8E, 0, 0}}, // Ø§
        {0x0628, {0xFE8F, 0xFE90, 0xFE91, 0xFE92}}, // Ø¨
        {0x0629, {0xFE93, 0xFE94, 0, 0}}, // Ø©
        {0x062A, {0xFE95, 0xFE96, 0xFE97, 0xFE98}}, // Øª
        {0x062B, {0xFE99, 0xFE9A, 0xFE9B, 0xFE9C}}, // Ø«
        {0x062C, {0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0}}, // Ø¬
        {0x062D, {0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4}}, // Ø­
        {0x062E, {0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8}}, // Ø®
        {0x062F, {0xFEA9, 0xFEAA, 0, 0}}, // Ø¯
        {0x0630, {0xFEAB, 0xFEAC, 0, 0}}, // Ø°
        {0x0631, {0xFEAD, 0xFEAE, 0, 0}}, // Ø±
        {0x0632, {0xFEAF, 0xFEB0, 0, 0}}, // Ø²
        {0x0633, {0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4}}, // Ø³
        {0x0634, {0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8}}, // Ø´
        {0x0635, {0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC}}, // Øµ
        {0x0636, {0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0}}, // Ø¶
        {0x0637, {0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4}}, // Ø·
        {0x0638, {0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8}}, // Ø¸
        {0x0639, {0xFEC9, 0xFECA, 0xFECB, 0xFECC}}, // Ø¹
        {0x063A, {0xFECD, 0xFECE, 0xFECF, 0xFED0}}, // Øº
        {0x0641, {0xFED1, 0xFED2, 0xFED3, 0xFED4}}, // Ù
        {0x0642, {0xFED5, 0xFED6, 0xFED7, 0xFED8}}, // Ù‚
        {0x0643, {0xFED9, 0xFEDA, 0xFEDB, 0xFEDC}}, // Ùƒ
        {0x0644, {0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0}}, // Ù„
        {0x0645, {0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4}}, // Ù…
        {0x0646, {0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8}}, // Ù†
        {0x0647, {0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC}}, // Ù‡
        {0x0648, {0xFEED, 0xFEEE, 0, 0}}, // Ùˆ
        {0x0649, {0xFEEF, 0xFEF0, 0, 0}}, // Ù‰
        {0x064A, {0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4}}, // ÙŠ
    };

    for (const auto& [k, v] : table) {
        if (k == cp) return &v;
    }
    return nullptr;
}

static bool isLamAlef(uint32_t next, uint32_t& outIso, uint32_t& outFinal) {
    // Lam-alef ligatürleri (Arapça Sunum Biçimleri-A).
    switch (next) {
        case 0x0622: outIso = 0xFEF5; outFinal = 0xFEF6; return true; // Ù„Ø¢
        case 0x0623: outIso = 0xFEF7; outFinal = 0xFEF8; return true; // Ù„Ø£
        case 0x0625: outIso = 0xFEF9; outFinal = 0xFEFA; return true; // Ù„Ø¥
        case 0x0627: outIso = 0xFEFB; outFinal = 0xFEFC; return true; // Ù„Ø§
        default: return false;
    }
}

static std::string rtlizeArabicText(const char* utf8) {
    if (!utf8 || !*utf8) return "";
    const size_t len = std::strlen(utf8);

    std::vector<uint32_t> cps;
    cps.reserve(len);
    for (size_t i = 0; i < len;) {
        uint32_t cp = 0;
        if (!utf8DecodeOne(utf8, len, i, cp)) break;
        if (isArabicDiacritic(cp)) continue; // bu basit şekillendiricide okunabilirlik için harekeleri atla
        cps.push_back(cp);
    }

    // Sunum biçimlerine dönüştür (çok küçük alt küme, UI etiketleri için yeterli)
    std::vector<uint32_t> shaped;
    shaped.reserve(cps.size());

    auto prevJoinType = [&](int idx) -> ArabicJoinType {
        for (int j = idx; j >= 0; j--) {
            if (isArabicDiacritic(cps[j])) continue;
            return arabicJoinType(cps[j]);
        }
        return ArabicJoinType::NONE;
    };

    for (size_t idx = 0; idx < cps.size(); idx++) {
        const uint32_t cp = cps[idx];

        // Lam-alef ligatürü işleme
        if (cp == 0x0644 && idx + 1 < cps.size()) {
            uint32_t iso = 0, fin = 0;
            if (isLamAlef(cps[idx + 1], iso, fin)) {
                const ArabicJoinType pj = prevJoinType((int)idx - 1);
                const bool connectsPrev = (pj == ArabicJoinType::DUAL || pj == ArabicJoinType::RIGHT);
                shaped.push_back(connectsPrev ? fin : iso);
                idx += 1; // sonrakini tüket
                continue;
            }
        }

        const ArabicForms* forms = arabicForms(cp);
        const ArabicJoinType curType = arabicJoinType(cp);
        if (!forms || curType == ArabicJoinType::NONE) {
            shaped.push_back(cp);
            continue;
        }

        // Önceki anlamlı karakteri bul
        int prev = (int)idx - 1;
        while (prev >= 0 && isArabicDiacritic(cps[(size_t)prev])) prev--;
        // Sonraki anlamlı karakteri bul
        int next = (int)idx + 1;
        while (next < (int)cps.size() && isArabicDiacritic(cps[(size_t)next])) next++;

        ArabicJoinType prevType = (prev >= 0) ? arabicJoinType(cps[(size_t)prev]) : ArabicJoinType::NONE;
        ArabicJoinType nextType = (next < (int)cps.size()) ? arabicJoinType(cps[(size_t)next]) : ArabicJoinType::NONE;

        const bool prevConnectsNext = (prevType == ArabicJoinType::DUAL);
        const bool curConnectsPrev = (curType == ArabicJoinType::DUAL || curType == ArabicJoinType::RIGHT);
        const bool curConnectsNext = (curType == ArabicJoinType::DUAL);
        const bool nextConnectsPrev = (nextType == ArabicJoinType::DUAL || nextType == ArabicJoinType::RIGHT);

        const bool joinPrev = prevConnectsNext && curConnectsPrev;
        const bool joinNext = curConnectsNext && nextConnectsPrev;

        uint32_t out = forms->isolated;
        if (joinPrev && joinNext && forms->medial) out = forms->medial;
        else if (joinPrev && forms->finalForm) out = forms->finalForm;
        else if (joinNext && forms->initial) out = forms->initial;
        else out = forms->isolated;

        shaped.push_back(out);
    }

    // LTR çizici için ters çevir (yaklaşık RTL)
    std::reverse(shaped.begin(), shaped.end());

    auto isLtrRunCp = [](uint32_t cp) -> bool {
        // ASCII alfasayısal
        if (cp < 128) return std::isalnum((unsigned char)cp) != 0;
        // Arap-Hint rakamları
        if (cp >= 0x0660 && cp <= 0x0669) return true;
        if (cp >= 0x06F0 && cp <= 0x06F9) return true;
        // Etiketlerde kullandığımız yaygın matematik sembolü
        if (cp == 0x00D7) return true; // ×
        return false;
    };

    auto swapBracket = [](uint32_t& cp) {
        switch (cp) {
            case '(': cp = ')'; break;
            case ')': cp = '('; break;
            case '[': cp = ']'; break;
            case ']': cp = '['; break;
            case '{': cp = '}'; break;
            case '}': cp = '{'; break;
            case '<': cp = '>'; break;
            case '>': cp = '<'; break;
            default: break;
        }
    };

    for (auto& cp : shaped) swapBracket(cp);

    // RTL metin içinde doğru okunmaları için LTR parçalarını (sayı/latin) geri çevir.
    for (size_t i = 0; i < shaped.size();) {
        if (!isLtrRunCp(shaped[i])) { i++; continue; }
        size_t j = i + 1;
        while (j < shaped.size() && isLtrRunCp(shaped[j])) j++;
        std::reverse(shaped.begin() + (ptrdiff_t)i, shaped.begin() + (ptrdiff_t)j);
        i = j;
    }

    std::string out;
    out.reserve(len + 8);
    for (uint32_t cp : shaped) utf8Append(out, cp);
    return out;
}

static const char* rtlCacheArabic(const char* s) {
    static thread_local std::array<std::string, 64> ring;
    static thread_local size_t idx = 0;
    ring[idx] = rtlizeArabicText(s);
    const char* out = ring[idx].c_str();
    idx = (idx + 1) % ring.size();
    return out;
}

static UiLang detectUiLang() {
    static std::optional<UiLang> cached;
    if (cached) return *cached;

    const char* raw =
        (std::getenv("AURIVO_LANG") && *std::getenv("AURIVO_LANG")) ? std::getenv("AURIVO_LANG") :
        (std::getenv("LC_ALL") && *std::getenv("LC_ALL")) ? std::getenv("LC_ALL") :
        (std::getenv("LC_MESSAGES") && *std::getenv("LC_MESSAGES")) ? std::getenv("LC_MESSAGES") :
        (std::getenv("LANG") && *std::getenv("LANG")) ? std::getenv("LANG") :
        "";

    std::string s = toLowerAscii(std::string(raw));
    // Yaygın locale biçimlerini normalize et: "tr-TR", "tr_TR.UTF-8", "ar_SA@arabic" -> "tr"/"ar"
    if (const auto pos = s.find_first_of(".@"); pos != std::string::npos) s.resize(pos);
    if (const auto pos = s.find_first_of("-_"); pos != std::string::npos) s.resize(pos);

    UiLang lang = UiLang::EN;
    if (s == "tr") lang = UiLang::TR;
    else if (s == "ar") lang = UiLang::AR;
    else if (s == "fr") lang = UiLang::FR;
    else if (s == "de") lang = UiLang::DE;
    else if (s == "es") lang = UiLang::ES;
    else if (s == "hi") lang = UiLang::HI;

    cached = lang;
    return lang;
}

static const char* L7(const char* en, const char* tr, const char* ar, const char* fr, const char* de, const char* es, const char* hi) {
    switch (detectUiLang()) {
        case UiLang::TR: return fixMojibakeCached(tr);
        case UiLang::AR: return rtlCacheArabic(fixMojibakeCached(ar));
        case UiLang::FR: return fixMojibakeCached(fr);
        case UiLang::DE: return fixMojibakeCached(de);
        case UiLang::ES: return fixMojibakeCached(es);
        case UiLang::HI: return fixMojibakeCached(hi);
        case UiLang::EN:
        default: return fixMojibakeCached(en);
    }
}

static const char* L7Raw(const char* en, const char* tr, const char* ar, const char* fr, const char* de, const char* es, const char* hi) {
    switch (detectUiLang()) {
        case UiLang::TR: return fixMojibakeCached(tr);
        case UiLang::AR: return fixMojibakeCached(ar);
        case UiLang::FR: return fixMojibakeCached(fr);
        case UiLang::DE: return fixMojibakeCached(de);
        case UiLang::ES: return fixMojibakeCached(es);
        case UiLang::HI: return fixMojibakeCached(hi);
        case UiLang::EN:
        default: return fixMojibakeCached(en);
    }
}

static const char* visEnvText(const char* key, const char* fallback) {
    const char* val = std::getenv(key);
    if (val && *val) return val;
    return fallback;
}

static uint64_t nowMs() {
#if SDL_VERSION_ATLEAST(2, 0, 18)
    return SDL_GetTicks64();
#else
    return (uint64_t)SDL_GetTicks();
#endif
}

static void scheduleNextAutoSwitch();

static fs::path getVisualizerConfigDir() {
    const char* xdg = std::getenv("XDG_CONFIG_HOME");
    if (xdg && *xdg) {
        return fs::path(xdg) / "aurivo-projectm-visualizer";
    }
    const char* home = std::getenv("HOME");
    if (home && *home) {
        return fs::path(home) / ".config" / "aurivo-projectm-visualizer";
    }
    return fs::temp_directory_path() / "aurivo-projectm-visualizer";
}

static fs::path getPresetPickerSettingsPath() {
    return getVisualizerConfigDir() / "preset_picker.cfg";
}

static std::string getPresetsPath(int argc, char* argv[]) {
    for (int i = 1; i < argc - 1; i++) {
        if (std::string(argv[i]) == "--presets") {
            return argv[i + 1];
        }
    }

    if (const char* envPath = std::getenv("PROJECTM_PRESETS_PATH")) {
        return std::string(envPath);
    }

    // Varsayılan: yürütülebilire göre ../third_party/projectm/presets
    try {
        fs::path exePath = fs::canonical("/proc/self/exe");
        fs::path defaultPath = exePath.parent_path() / ".." / "third_party" / "projectm" / "presets";
        return defaultPath.string();
    } catch (...) {
        return "./third_party/projectm/presets";
    }
}

static std::string basenameUtf8(const std::string& path) {
    try {
        return fs::path(path).filename().string();
    } catch (...) {
        const auto pos = path.find_last_of("/\\");
        return (pos == std::string::npos) ? path : path.substr(pos + 1);
    }
}

static bool iequalsExt(const fs::path& p, const std::string& extLower) {
    std::string ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext == extLower;
}

struct PresetItem {
    std::string path;
    std::string displayName;
    bool enabled = true;
};

static std::string trimAscii(const std::string& s) {
    size_t b = 0;
    while (b < s.size() && (s[b] == ' ' || s[b] == '\t' || s[b] == '\r' || s[b] == '\n')) b++;
    size_t e = s.size();
    while (e > b && (s[e - 1] == ' ' || s[e - 1] == '\t' || s[e - 1] == '\r' || s[e - 1] == '\n')) e--;
    return s.substr(b, e - b);
}

static std::string initialsFromPresetName(const std::string& name) {
    std::string out;
    bool takeNext = true;
    for (char ch : name) {
        const unsigned char uc = (unsigned char)ch;
        if (std::isalnum(uc)) {
            if (takeNext) out.push_back((char)std::toupper(uc));
            takeNext = false;
        } else {
            takeNext = true;
        }
        if (out.size() >= 2) break;
    }
    if (out.empty()) out = "PR";
    return out;
}

static bool findPresetsRecursive(const std::string& rootPath, std::vector<PresetItem>& out) {
    out.clear();
    if (!fs::exists(rootPath) || !fs::is_directory(rootPath)) {
        std::cerr << "Presets directory does not exist: " << rootPath << std::endl;
        return false;
    }

    try {
        for (const auto& entry : fs::recursive_directory_iterator(rootPath)) {
            if (!entry.is_regular_file()) continue;
            if (!iequalsExt(entry.path(), ".milk")) continue;
            PresetItem item;
            item.path = entry.path().string();
            item.displayName = basenameUtf8(item.path);
            item.enabled = true;
            out.push_back(std::move(item));
        }
    } catch (const std::exception& e) {
        std::cerr << "Error scanning presets: " << e.what() << std::endl;
        return false;
    }

    std::sort(out.begin(), out.end(), [](const PresetItem& a, const PresetItem& b) {
        return a.displayName < b.displayName;
    });

    std::cout << "Found " << out.size() << " presets in " << rootPath << std::endl;
    return !out.empty();
}

enum class AspectMode {
    Free,
    A16_9,
    A4_3,
    A1_1,
};

enum class QualityMode {
    Low,
    Medium,
    High,
};

enum class QualityFpsMode {
    LOW_15,
    MID_25,
    HIGH_35,
    SUPER_60,
};

enum class TextureQuality {
    Q256,
    Q512,
    Q1024,
    Q2048,
};

enum class ClarityMode {
    Soft,
    Balanced,
    Sharp,
    SharpPlus,
};

static const char* fpsModeToString(QualityFpsMode m) {
    switch (m) {
        case QualityFpsMode::LOW_15: return "low15";
        case QualityFpsMode::MID_25: return "mid25";
        case QualityFpsMode::HIGH_35: return "high35";
        case QualityFpsMode::SUPER_60: return "super60";
        default: return "super60";
    }
}

static QualityFpsMode fpsModeFromString(const std::string& s) {
    const std::string v = toLowerAscii(trimAscii(s));
    if (v == "low15" || v == "15") return QualityFpsMode::LOW_15;
    if (v == "mid25" || v == "25") return QualityFpsMode::MID_25;
    if (v == "high35" || v == "35") return QualityFpsMode::HIGH_35;
    if (v == "super60" || v == "60") return QualityFpsMode::SUPER_60;
    return QualityFpsMode::SUPER_60;
}

static const char* textureQualityToString(TextureQuality q) {
    switch (q) {
        case TextureQuality::Q256: return "q256";
        case TextureQuality::Q512: return "q512";
        case TextureQuality::Q1024: return "q1024";
        case TextureQuality::Q2048: return "q2048";
        default: return "q1024";
    }
}

static TextureQuality textureQualityFromString(const std::string& s) {
    const std::string v = toLowerAscii(trimAscii(s));
    if (v == "q256" || v == "256") return TextureQuality::Q256;
    if (v == "q512" || v == "512") return TextureQuality::Q512;
    if (v == "q1024" || v == "1024") return TextureQuality::Q1024;
    if (v == "q2048" || v == "2048") return TextureQuality::Q2048;
    return TextureQuality::Q1024;
}

static const char* clarityModeToString(ClarityMode m) {
    switch (m) {
        case ClarityMode::Soft: return "soft";
        case ClarityMode::Balanced: return "balanced";
        case ClarityMode::Sharp: return "sharp";
        case ClarityMode::SharpPlus: return "sharpplus";
        default: return "balanced";
    }
}

static ClarityMode clarityModeFromString(const std::string& s) {
    const std::string v = toLowerAscii(trimAscii(s));
    if (v == "soft" || v == "yumusak") return ClarityMode::Soft;
    if (v == "balanced" || v == "dengeli") return ClarityMode::Balanced;
    if (v == "sharp" || v == "keskin") return ClarityMode::Sharp;
    if (v == "sharpplus" || v == "sharp+" || v == "keskin+") return ClarityMode::SharpPlus;
    return ClarityMode::Balanced;
}

struct ViewportRect {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
};

static ViewportRect computeAspectViewport(int fbW, int fbH, AspectMode mode) {
    if (mode == AspectMode::Free || fbW <= 0 || fbH <= 0) {
        return ViewportRect{0, 0, fbW, fbH};
    }

    float target = 1.0f;
    switch (mode) {
        case AspectMode::A16_9: target = 16.0f / 9.0f; break;
        case AspectMode::A4_3: target = 4.0f / 3.0f; break;
        case AspectMode::A1_1: target = 1.0f; break;
        default: target = 1.0f; break;
    }

    float cur = (float)fbW / (float)fbH;
    float vw = (float)fbW;
    float vh = (float)fbH;
    float vx = 0.0f;
    float vy = 0.0f;

    if (cur > target) {
        vw = vh * target;
        vx = ((float)fbW - vw) * 0.5f;
    } else if (cur < target) {
        vh = vw / target;
        vy = ((float)fbH - vh) * 0.5f;
    }

    vx = std::floor(vx);
    vy = std::floor(vy);
    vw = std::floor(vw);
    vh = std::floor(vh);

    return ViewportRect{(int)vx, (int)vy, (int)vw, (int)vh};
}

struct AppState {
    SDL_Window* window = nullptr;
    SDL_GLContext gl = nullptr;

    // Görselleştiriciyi kapatmaması için ayrı preset seçici pencere (OS düzeyi).
    SDL_Window* pickerWindow = nullptr;
    SDL_GLContext pickerGL = nullptr;
    ImGuiContext* pickerImGui = nullptr;

    ImGuiContext* mainImGui = nullptr;

    int winW = 1280;
    int winH = 720;
    int fbW = 1280;
    int fbH = 720;

    // Tercih edilen ana pencere boyutu.
    // Aurivo (Electron) içinden başlatıldığında env AURIVO_VIS_MAIN_W/H ile geçersiz kılınır
    // böylece pencere her zaman uygulamanın beklediği varsayılan boyutta açılır.
    int mainPrefW = 900;
    int mainPrefH = 650;
    uint64_t mainEnforceUntilMs = 0;

    float dpiScale = 1.0f;
    float lastDpiScale = 0.0f;

    int pickerWinW = 720;
    int pickerWinH = 640;
    int pickerFbW = 720;
    int pickerFbH = 640;
    float pickerDpiScale = 1.0f;
    float pickerLastDpiScale = 0.0f;

    bool running = true;
    bool fullscreen = false;

    projectm_handle pm = nullptr;

    std::vector<PresetItem> presets;
    int currentPreset = 0;
    int pendingPresetApply = -1;

    AspectMode aspect = AspectMode::Free;
    QualityMode quality = QualityMode::High;

    QualityFpsMode fpsMode = QualityFpsMode::SUPER_60;
    TextureQuality textureQuality = TextureQuality::Q1024;
    ClarityMode clarityMode = ClarityMode::Balanced;
    int targetFps = 60;

    // Ses beslemesi: SADECE stdin üzerinden uygulama PCM'i (Electron float32 interleaved pipe eder).
    std::vector<uint8_t> pcmInBuf;
    std::vector<float> pcmTmp;
    uint64_t lastPcmMs = 0;
    unsigned int pmMaxSamplesPerChannel = 0;
    bool audioStale = true;
    bool debugOverlay = false;

#ifdef _WIN32
    HANDLE stdinHandle = INVALID_HANDLE_VALUE;
    bool stdinIsPipe = false;
#endif
    bool stdinNonBlocking = false;

    bool showPresetPicker = false;
    int delaySeconds = 15;
    uint64_t nextAutoSwitchMs = 0;

    int pickerNavIndex = 0;
    bool pickerNavScrollTo = false;
    std::array<char, 160> pickerSearchBuf{};
    bool pickerCompactMode = true;

    ImGuiStyle baseStyle;
    std::string fontPath;
};

static AppState g;

static void ensureDllSearchPathFromExeDir() {
#ifdef _WIN32
    wchar_t exePath[MAX_PATH] = {0};
    const DWORD n = GetModuleFileNameW(NULL, exePath, MAX_PATH);
    if (!n || n >= MAX_PATH) return;
    for (int i = (int)n - 1; i >= 0; --i) {
        if (exePath[i] == L'\\' || exePath[i] == L'/') {
            exePath[i] = 0;
            break;
        }
    }
    // Prefer loading DLL dependencies from the visualizer directory (native-dist)
    // instead of relying on PATH on end-user systems.
    SetDllDirectoryW(exePath);
#endif
}

static void loadPresetPickerSettings() {
    fs::path cfg = getPresetPickerSettingsPath();
    std::error_code ec;
    if (!fs::exists(cfg, ec) || !fs::is_regular_file(cfg, ec)) return;

    std::ifstream in(cfg);
    if (!in.is_open()) return;

    int delay = g.delaySeconds;
    int winW = g.pickerWinW;
    int winH = g.pickerWinH;
    int mainW = g.mainPrefW;
    int mainH = g.mainPrefH;
    std::unordered_set<std::string> enabledPaths;
    std::string lastPresetPath;

    std::string line;
    while (std::getline(in, line)) {
        line = trimAscii(line);
        if (line.empty()) continue;
        if (line[0] == '#') continue;

        const auto pos = line.find('=');
        if (pos == std::string::npos) continue;
        std::string key = trimAscii(line.substr(0, pos));
        std::string val = trimAscii(line.substr(pos + 1));
        if (key == "delaySeconds") {
            try {
                int v = std::stoi(val);
                if (v >= 1 && v <= 3600) delay = v;
            } catch (...) {
            }
        } else if (key == "pickerWinW") {
            try {
                int v = std::stoi(val);
                if (v >= 420 && v <= 4096) winW = v;
            } catch (...) {
            }
        } else if (key == "pickerWinH") {
            try {
                int v = std::stoi(val);
                if (v >= 360 && v <= 4096) winH = v;
            } catch (...) {
            }
        } else if (key == "mainWinW") {
            try {
                int v = std::stoi(val);
                if (v >= 640 && v <= 8192) mainW = v;
            } catch (...) {
            }
        } else if (key == "mainWinH") {
            try {
                int v = std::stoi(val);
                if (v >= 480 && v <= 8192) mainH = v;
            } catch (...) {
            }
        } else if (key == "enabled") {
            if (!val.empty()) enabledPaths.insert(val);
        } else if (key == "lastPreset") {
            lastPresetPath = val;
        } else if (key == "fpsMode") {
            g.fpsMode = fpsModeFromString(val);
        } else if (key == "textureQuality") {
            g.textureQuality = textureQualityFromString(val);
        } else if (key == "clarityMode") {
            g.clarityMode = clarityModeFromString(val);
        }
    }

    g.delaySeconds = delay;
    g.pickerWinW = winW;
    g.pickerWinH = winH;
    g.mainPrefW = mainW;
    g.mainPrefH = mainH;

    if (!enabledPaths.empty()) {
        for (auto& p : g.presets) p.enabled = false;
        for (auto& p : g.presets) {
            if (enabledPaths.count(p.path)) p.enabled = true;
        }
    }

    if (!lastPresetPath.empty()) {
        for (int i = 0; i < (int)g.presets.size(); i++) {
            if (g.presets[i].path == lastPresetPath) {
                g.currentPreset = i;
                break;
            }
        }
    }
}

static void savePresetPickerSettings() {
    fs::path cfg = getPresetPickerSettingsPath();
    fs::path dir = cfg.parent_path();

    std::error_code ec;
    fs::create_directories(dir, ec);

    fs::path tmp = cfg;
    tmp += ".tmp";

    std::ofstream out(tmp);
    if (!out.is_open()) return;

    out << "# Aurivo projectM visualizer preset picker\n";
    out << "delaySeconds=" << g.delaySeconds << "\n";
    out << "pickerWinW=" << g.pickerWinW << "\n";
    out << "pickerWinH=" << g.pickerWinH << "\n";
    out << "mainWinW=" << g.mainPrefW << "\n";
    out << "mainWinH=" << g.mainPrefH << "\n";
    out << "fpsMode=" << fpsModeToString(g.fpsMode) << "\n";
    out << "textureQuality=" << textureQualityToString(g.textureQuality) << "\n";
    out << "clarityMode=" << clarityModeToString(g.clarityMode) << "\n";
    if (g.currentPreset >= 0 && g.currentPreset < (int)g.presets.size()) {
        out << "lastPreset=" << g.presets[g.currentPreset].path << "\n";
    }
    for (const auto& p : g.presets) {
        if (p.enabled) out << "enabled=" << p.path << "\n";
    }
    out.flush();
    out.close();

    fs::rename(tmp, cfg, ec);
    if (ec) {
        fs::remove(cfg, ec);
        ec.clear();
        fs::rename(tmp, cfg, ec);
        if (ec) {
            fs::remove(tmp, ec);
        }
    }
}

static inline uint32_t readU32LE(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool initStdinNonBlocking() {
#ifdef _WIN32
    g.stdinHandle = (HANDLE)_get_osfhandle(_fileno(stdin));
    if (g.stdinHandle == INVALID_HANDLE_VALUE) {
        g.stdinNonBlocking = false;
        return false;
    }

    DWORD type = GetFileType(g.stdinHandle);
    if (type == FILE_TYPE_PIPE) {
        g.stdinIsPipe = true;
        g.stdinNonBlocking = true;
        return true;
    }

    // Konsol veya pipe olmayan durumda: okunacak veri yok, ama bloklama yok.
    g.stdinIsPipe = false;
    g.stdinNonBlocking = true;
    return true;
#else
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    if (flags == -1) return false;
    if (fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) == -1) return false;
    return true;
#endif
}

static void feedSilenceIfStale(uint64_t now) {
    if (!g.pm) return;
    if (g.pmMaxSamplesPerChannel == 0) return;

    // Yakın zamanda PCM almadıysak iç tamponu sessizlikle ezmeye devam et.
    // Bu, duraklatıldığında "son sıfır olmayan ses"in kalıp görselleri hareket ettirmesini önler.
    const uint64_t staleMs = 150;
    if (g.lastPcmMs != 0 && (now - g.lastPcmMs) <= staleMs) {
        if (g.audioStale) {
            g.audioStale = false;
            if (g.debugOverlay) std::cout << "[Audio] PCM resumed" << std::endl;
        }
        return;
    }

    if (!g.audioStale) {
        g.audioStale = true;
        if (g.debugOverlay) std::cout << "[Audio] PCM stale (>" << staleMs << "ms) -> injecting silence" << std::endl;
    }

    const unsigned int n = g.pmMaxSamplesPerChannel;
    const size_t floats = (size_t)n * 2;
    if (g.pcmTmp.size() < floats) g.pcmTmp.assign(floats, 0.0f);
    else std::fill(g.pcmTmp.begin(), g.pcmTmp.begin() + (ptrdiff_t)floats, 0.0f);

    projectm_pcm_add_float(g.pm, g.pcmTmp.data(), n, PROJECTM_STEREO);
}

static void pumpPcmFromStdin() {
    // stdin'den gelen tüm baytları oku ve v2 paketlerini ayrıştır:
    // [u32 channels][u32 countPerChannel][float32 payload interleaved]
    uint8_t tmp[64 * 1024];
#ifdef _WIN32
    if (!g.stdinNonBlocking || !g.stdinIsPipe) {
        return;
    }
    for (;;) {
        DWORD avail = 0;
        if (!PeekNamedPipe(g.stdinHandle, nullptr, 0, nullptr, &avail, nullptr)) {
            break;
        }
        if (avail == 0) {
            break;
        }
        DWORD toRead = (DWORD)std::min<size_t>(sizeof(tmp), (size_t)avail);
        DWORD r = 0;
        if (!ReadFile(g.stdinHandle, tmp, toRead, &r, nullptr) || r == 0) {
            break;
        }
        g.pcmInBuf.insert(g.pcmInBuf.end(), tmp, tmp + r);
        if (r < toRead) {
            break;
        }
    }
#else
    for (;;) {
        ssize_t r = ::read(STDIN_FILENO, tmp, sizeof(tmp));
        if (r > 0) {
            g.pcmInBuf.insert(g.pcmInBuf.end(), tmp, tmp + r);
            continue;
        }
        if (r == 0) {
            // EOF: üst süreç pipe'ı kapattı.
            break;
        }
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            break;
        }
        // Diğer okuma hatası: bu kare için denemeyi bırak.
        break;
    }
#endif

    // Güvenlik: anlık tıkanmalarda kuyruk çok büyürse en yeni veriyi koruyup eskileri at.
    // Bu, görsel tepkinin "geriden gelmesini" engeller.
    constexpr size_t kMaxBufferedBytes = 2 * 1024 * 1024; // 2 MB
    constexpr size_t kKeepTailBytes = 512 * 1024;         // son 512 KB
    if (g.pcmInBuf.size() > kMaxBufferedBytes) {
        g.pcmInBuf.erase(g.pcmInBuf.begin(), g.pcmInBuf.begin() + (ptrdiff_t)(g.pcmInBuf.size() - kKeepTailBytes));
    }

    // Gecikmeyi düşürmek için: kuyruktaki tam paketlerden SADECE en yenisini işle.
    // Böylece eski paketler render thread'ini geriden takip ettirmez.
    size_t offset = 0;
    bool hasComplete = false;
    size_t latestPacketOffset = 0;
    size_t latestPacketBytes = 0;
    uint32_t latestChannels = 0;
    uint32_t latestCountPerChannel = 0;

    for (;;) {
        if (g.pcmInBuf.size() - offset < 8) break;
        const uint8_t* p = g.pcmInBuf.data() + offset;
        uint32_t channels = readU32LE(p + 0);
        uint32_t countPerChannel = readU32LE(p + 4);

        // Desync / suistimal önlemek için temel doğrulama.
        if (!((channels == 1) || (channels == 2)) || countPerChannel == 0 || countPerChannel > 65536) {
            g.pcmInBuf.clear();
            return;
        }

        const size_t floatCount = (size_t)channels * (size_t)countPerChannel;
        const size_t payloadBytes = floatCount * sizeof(float);
        const size_t packetBytes = 8 + payloadBytes;
        if (g.pcmInBuf.size() - offset < packetBytes) break;

        hasComplete = true;
        latestPacketOffset = offset;
        latestPacketBytes = packetBytes;
        latestChannels = channels;
        latestCountPerChannel = countPerChannel;
        offset += packetBytes;
    }

    if (!hasComplete) return;

    const uint8_t* latestPacket = g.pcmInBuf.data() + latestPacketOffset;
    const size_t latestFloatCount = (size_t)latestChannels * (size_t)latestCountPerChannel;
    const size_t latestPayloadBytes = latestFloatCount * sizeof(float);

    // Yükü hizalı float tamponuna kopyala.
    g.pcmTmp.resize(latestFloatCount);
    std::memcpy(g.pcmTmp.data(), latestPacket + 8, latestPayloadBytes);

    if (g.pm) {
        const unsigned int maxN = g.pmMaxSamplesPerChannel;
        projectm_channels ch = (latestChannels == 2) ? PROJECTM_STEREO : PROJECTM_MONO;
        const float* samplesPtr = g.pcmTmp.data();
        unsigned int n = (unsigned int)latestCountPerChannel;

        // projectM kanal başına en fazla örnek saklar. Paketler büyükse en yeni kısmı besle.
        if (maxN > 0 && n > maxN) {
            const size_t skipFrames = (size_t)(n - maxN);
            samplesPtr = g.pcmTmp.data() + skipFrames * (size_t)latestChannels;
            n = maxN;
        }

        projectm_pcm_add_float(g.pm, samplesPtr, n, ch);
        g.lastPcmMs = nowMs();
    }

    // Tüm tam paketleri tüket; yalnızca son yarım paket (varsa) tutulur.
    if (offset > 0) {
        g.pcmInBuf.erase(g.pcmInBuf.begin(), g.pcmInBuf.begin() + (ptrdiff_t)offset);
    }
}

static void updateDrawable() {
    SDL_GetWindowSize(g.window, &g.winW, &g.winH);
    SDL_GL_GetDrawableSize(g.window, &g.fbW, &g.fbH);
    g.dpiScale = (g.winW > 0) ? ((float)g.fbW / (float)g.winW) : 1.0f;
}

static void enforceMainWindowInitialSize() {
    if (!g.window) return;
    if (g.mainEnforceUntilMs == 0) return;
    uint64_t t = nowMs();
    if (t > g.mainEnforceUntilMs) {
        g.mainEnforceUntilMs = 0;
        return;
    }

    const Uint32 flags = SDL_GetWindowFlags(g.window);
    const bool isFullscreen = (flags & SDL_WINDOW_FULLSCREEN_DESKTOP) || (flags & SDL_WINDOW_FULLSCREEN);
    if (isFullscreen) return;

    int w = 0, h = 0;
    SDL_GetWindowSize(g.window, &w, &h);
    if (std::abs(w - g.mainPrefW) <= 2 && std::abs(h - g.mainPrefH) <= 2) {
        g.mainEnforceUntilMs = 0;
        return;
    }

    // Bazı WM/compositor'lar oluşturma sonrası kendi başlangıç boyutlarını uygular.
    // Başlangıçta kısa süreliğine tercih edilen boyutu zorla.
    SDL_RestoreWindow(g.window);
    SDL_SetWindowSize(g.window, g.mainPrefW, g.mainPrefH);
    SDL_SetWindowPosition(g.window, SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED);
}

static void updateDrawablePicker() {
    if (!g.pickerWindow) return;
    SDL_GetWindowSize(g.pickerWindow, &g.pickerWinW, &g.pickerWinH);
    SDL_GL_GetDrawableSize(g.pickerWindow, &g.pickerFbW, &g.pickerFbH);
    g.pickerDpiScale = (g.pickerWinW > 0) ? ((float)g.pickerFbW / (float)g.pickerWinW) : 1.0f;
}

static void applyRenderTuning() {
    if (!g.pm) return;

    TextureQuality effectiveQuality = g.textureQuality;
    if (g.clarityMode == ClarityMode::Sharp && effectiveQuality == TextureQuality::Q256) {
        effectiveQuality = TextureQuality::Q512;
    } else if (g.clarityMode == ClarityMode::SharpPlus) {
        if (effectiveQuality == TextureQuality::Q256 || effectiveQuality == TextureQuality::Q512) {
            effectiveQuality = TextureQuality::Q1024;
        }
    }

    int meshX = 128;
    int meshY = 96;
    switch (effectiveQuality) {
        case TextureQuality::Q256:  meshX = 64;  meshY = 48;  break;
        case TextureQuality::Q512:  meshX = 104; meshY = 78;  break;
        case TextureQuality::Q1024: meshX = 168; meshY = 126; break;
        case TextureQuality::Q2048: meshX = 252; meshY = 190; break;
        default: break;
    }

    float clarityMul = 1.0f;
    switch (g.clarityMode) {
        case ClarityMode::Soft:      clarityMul = 0.42f; break;
        case ClarityMode::Balanced:  clarityMul = 1.00f; break;
        case ClarityMode::Sharp:     clarityMul = 2.80f; break;
        case ClarityMode::SharpPlus: clarityMul = 4.60f; break;
        default: break;
    }

    meshX = std::clamp((int)std::lround((float)meshX * clarityMul), 32, 960);
    meshY = std::clamp((int)std::lround((float)meshY * clarityMul), 24, 720);
    projectm_set_mesh_size(g.pm, meshX, meshY);

    int qualitySize = 1024;
    switch (effectiveQuality) {
        case TextureQuality::Q256: qualitySize = 256; break;
        case TextureQuality::Q512: qualitySize = 512; break;
        case TextureQuality::Q1024: qualitySize = 1024; break;
        case TextureQuality::Q2048: qualitySize = 2048; break;
        default: break;
    }

    std::cout << "[UI] tuning => mesh " << meshX << "x" << meshY
              << " | clarity=" << (g.clarityMode == ClarityMode::Soft ? "soft"
                                 : g.clarityMode == ClarityMode::Sharp ? "sharp"
                                 : g.clarityMode == ClarityMode::SharpPlus ? "sharp+"
                                 : "balanced")
              << " | quality=" << qualitySize
              << std::endl;
}

static void applyQuality(QualityMode q) {
    g.quality = q;
    if (!g.pm) return;
    switch (q) {
        case QualityMode::Low:
            g.textureQuality = TextureQuality::Q256;
            break;
        case QualityMode::Medium:
            g.textureQuality = TextureQuality::Q512;
            break;
        case QualityMode::High:
            g.textureQuality = TextureQuality::Q1024;
            break;
    }
    applyRenderTuning();
}

static int fpsFromMode(QualityFpsMode m) {
    switch (m) {
        case QualityFpsMode::LOW_15: return 15;
        case QualityFpsMode::MID_25: return 25;
        case QualityFpsMode::HIGH_35: return 35;
        case QualityFpsMode::SUPER_60: return 60;
        default: return 60;
    }
}

static void applyFpsMode(QualityFpsMode m) {
    g.fpsMode = m;
    g.targetFps = fpsFromMode(m);
    if (g.pm) {
        projectm_set_fps(g.pm, g.targetFps);
    }
    std::cout << "[UI] target fps set to " << g.targetFps << " (vsync may cap actual fps)" << std::endl;
    savePresetPickerSettings();
}

static int textureSizeFromMode(TextureQuality q) {
    switch (q) {
        case TextureQuality::Q256: return 256;
        case TextureQuality::Q512: return 512;
        case TextureQuality::Q1024: return 1024;
        case TextureQuality::Q2048: return 2048;
        default: return 1024;
    }
}

static void applyTextureQuality(TextureQuality q) {
    g.textureQuality = q;
    applyRenderTuning();
    const int size = textureSizeFromMode(q);
    std::cout << "[UI] quality set to " << size << " + clarity profile" << std::endl;
    savePresetPickerSettings();
}

static void applyClarityMode(ClarityMode m) {
    g.clarityMode = m;
    applyRenderTuning();
    const char* name = "balanced";
    if (m == ClarityMode::Soft) name = "soft";
    else if (m == ClarityMode::Sharp) name = "sharp";
    else if (m == ClarityMode::SharpPlus) name = "sharp+";
    std::cout << "[UI] clarity mode set to " << name << std::endl;
    savePresetPickerSettings();
}

static bool applyPresetByIndexNow(int idx) {
    if (!g.pm) return false;
    if (idx < 0 || idx >= (int)g.presets.size()) return false;
    g.currentPreset = idx;
    const auto& p = g.presets[idx];
    // Preset geçişindeki kısa takılmaları azaltmak için yumuşak geçişi kapat.
    projectm_load_preset_file(g.pm, p.path.c_str(), false);
    return true;
}

static void requestPresetPreview(int idx) {
    if (idx < 0 || idx >= (int)g.presets.size()) return;
    g.pendingPresetApply = idx;
}

static void flushPendingPresetApply() {
    if (g.pendingPresetApply < 0) return;
    const int idx = g.pendingPresetApply;
    g.pendingPresetApply = -1;

    // Preset yüklerken ana GL context'inde olduğumuzdan emin ol.
    SDL_GL_MakeCurrent(g.window, g.gl);
    applyPresetByIndexNow(idx);
    scheduleNextAutoSwitch();
}

static std::vector<int> enabledPresetIndices() {
    std::vector<int> ids;
    ids.reserve(g.presets.size());
    for (int i = 0; i < (int)g.presets.size(); i++) {
        if (g.presets[i].enabled) ids.push_back(i);
    }
    return ids;
}

static void scheduleNextAutoSwitch() {
    g.nextAutoSwitchMs = nowMs() + (uint64_t)g.delaySeconds * 1000ULL;
}

static void pumpAutoPresetSwitch() {
    if (g.delaySeconds < 1) return;
    if (!g.pm) return;
    if (g.presets.empty()) return;

    int enabledCount = 0;
    int firstEnabled = -1;
    for (int i = 0; i < (int)g.presets.size(); i++) {
        if (g.presets[i].enabled) {
            enabledCount++;
            if (firstEnabled < 0) firstEnabled = i;
        }
    }

    if (enabledCount <= 0) return;

    // Tam olarak bir preset etkinse otomatik döngü yapma.
    // Kullanıcı yine de listeden başka presetleri manuel olarak önizleyebilmeli.
    if (enabledCount == 1) return;

    uint64_t t = nowMs();
    if (g.nextAutoSwitchMs == 0) scheduleNextAutoSwitch();
    if (t < g.nextAutoSwitchMs) return;

    int next = g.currentPreset;
    for (int step = 0; step < (int)g.presets.size(); step++) {
        next = (next + 1) % (int)g.presets.size();
        if (g.presets[next].enabled) break;
    }

    if (next != g.currentPreset && g.presets[next].enabled) {
        requestPresetPreview(next);
    }
    scheduleNextAutoSwitch();
}

static std::optional<std::string> findInterFontPath() {
    // Env override (gerekirse host uygulama tarafından set edilir)
    if (const char* envFont = std::getenv("AURIVO_VIS_FONT_PATH")) {
        if (*envFont) {
            std::error_code ec;
            fs::path p(envFont);
            if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) {
                return fs::canonical(p, ec).string();
            }
        }
    }

    // Olası birkaç konumu dene.
    const std::vector<fs::path> candidates = []() {
        std::vector<fs::path> c;
        c.emplace_back(fs::path("assets/fonts/Inter-Regular.ttf"));
        c.emplace_back(fs::path("../assets/fonts/Inter-Regular.ttf"));
        c.emplace_back(fs::path("../../assets/fonts/Inter-Regular.ttf"));

#ifdef _WIN32
        // Windows: yürütülebilir konumundan çöz
        char exePath[MAX_PATH] = {0};
        DWORD n = GetModuleFileNameA(nullptr, exePath, MAX_PATH);
        if (n > 0 && n < MAX_PATH) {
            fs::path exeDir = fs::path(exePath).parent_path();
            c.emplace_back(exeDir / "assets" / "fonts" / "Inter-Regular.ttf");
            c.emplace_back(exeDir / ".." / "assets" / "fonts" / "Inter-Regular.ttf");
            c.emplace_back(exeDir / ".." / ".." / "assets" / "fonts" / "Inter-Regular.ttf");
        }
#else
        try {
            fs::path exePath = fs::canonical("/proc/self/exe");
            fs::path exeDir = exePath.parent_path();
            c.emplace_back(exeDir / "assets" / "fonts" / "Inter-Regular.ttf");
            c.emplace_back(exeDir / ".." / "assets" / "fonts" / "Inter-Regular.ttf");
            c.emplace_back(exeDir / ".." / ".." / "assets" / "fonts" / "Inter-Regular.ttf");
        } catch (...) {
        }
#endif

        return c;
    }();

    for (const auto& p : candidates) {
        std::error_code ec;
        if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) {
            return fs::canonical(p, ec).string();
        }
    }
	    return std::nullopt;
}

static std::optional<std::string> findFirstExistingFontPath(const std::vector<fs::path>& candidates);

static std::optional<std::string> findWindowsUiFontPath() {
#ifdef _WIN32
    const std::vector<fs::path> candidates = {
        fs::path("C:/Windows/Fonts/segoeui.ttf"),
        fs::path("C:/Windows/Fonts/tahoma.ttf"),
        fs::path("C:/Windows/Fonts/arial.ttf"),
        fs::path("C:/Windows/Fonts/arialuni.ttf")
    };
    return findFirstExistingFontPath(candidates);
#else
    return std::nullopt;
#endif
}

static std::optional<std::string> findFirstExistingFontPath(const std::vector<fs::path>& candidates) {
    for (const auto& p : candidates) {
        std::error_code ec;
        if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) {
            return fs::canonical(p, ec).string();
        }
    }
    return std::nullopt;
}

static std::optional<std::string> findArabicFontPath() {
    const std::vector<fs::path> candidates = {
        fs::path("assets/fonts/NotoSansArabic-Regular.ttf"),
#ifdef _WIN32
        fs::path("C:/Windows/Fonts/segoeui.ttf"),
        fs::path("C:/Windows/Fonts/seguihis.ttf"),
        fs::path("C:/Windows/Fonts/arial.ttf"),
#endif
        fs::path("/usr/share/fonts/noto/NotoSansArabic-Regular.ttf"),
        fs::path("/usr/share/fonts/noto/NotoSansArabicUI-Regular.ttf"),
        fs::path("/usr/share/fonts/noto/NotoNaskhArabic-Regular.ttf"),
        fs::path("/usr/share/fonts/noto/NotoNaskhArabicUI-Regular.ttf"),
        fs::path("/usr/share/fonts/TTF/DejaVuSans.ttf"),
    };
    return findFirstExistingFontPath(candidates);
}

static std::optional<std::string> findDevanagariFontPath() {
    const std::vector<fs::path> candidates = {
        fs::path("assets/fonts/NotoSansDevanagari-Regular.ttf"),
#ifdef _WIN32
        fs::path("C:/Windows/Fonts/nirmala.ttf"),
        fs::path("C:/Windows/Fonts/segoeui.ttf"),
#endif
        fs::path("/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf"),
        fs::path("/usr/share/fonts/noto/NotoSansDevanagariUI-Regular.ttf"),
        fs::path("/usr/share/fonts/TTF/DejaVuSans.ttf"),
    };
    return findFirstExistingFontPath(candidates);
}

static void applyClementineishStyle() {
	    ImGuiStyle& style = ImGui::GetStyle();
	    style.WindowRounding = 6.0f;
	    style.PopupRounding = 6.0f;
    style.FrameRounding = 5.0f;
    style.ScrollbarRounding = 6.0f;
    style.GrabRounding = 5.0f;
    style.WindowBorderSize = 1.0f;
    style.FrameBorderSize = 0.0f;
    style.PopupBorderSize = 1.0f;

    ImVec4* colors = style.Colors;
    colors[ImGuiCol_WindowBg] = ImVec4(0.10f, 0.10f, 0.10f, 0.96f);
    colors[ImGuiCol_PopupBg] = ImVec4(0.12f, 0.12f, 0.12f, 0.98f);
    colors[ImGuiCol_Border] = ImVec4(0.28f, 0.28f, 0.28f, 1.00f);
    colors[ImGuiCol_FrameBg] = ImVec4(0.16f, 0.16f, 0.16f, 1.00f);
    colors[ImGuiCol_FrameBgHovered] = ImVec4(0.18f, 0.24f, 0.32f, 1.00f);
    colors[ImGuiCol_FrameBgActive] = ImVec4(0.20f, 0.30f, 0.40f, 1.00f);
    colors[ImGuiCol_Header] = ImVec4(0.16f, 0.22f, 0.30f, 1.00f);
    colors[ImGuiCol_HeaderHovered] = ImVec4(0.18f, 0.28f, 0.38f, 1.00f);
    colors[ImGuiCol_HeaderActive] = ImVec4(0.20f, 0.34f, 0.46f, 1.00f);
    colors[ImGuiCol_Button] = ImVec4(0.16f, 0.16f, 0.16f, 1.00f);
    colors[ImGuiCol_ButtonHovered] = ImVec4(0.18f, 0.24f, 0.32f, 1.00f);
    colors[ImGuiCol_ButtonActive] = ImVec4(0.20f, 0.30f, 0.40f, 1.00f);
    colors[ImGuiCol_CheckMark] = ImVec4(0.17f, 0.55f, 0.95f, 1.00f);
    colors[ImGuiCol_SliderGrab] = ImVec4(0.17f, 0.55f, 0.95f, 1.00f);
    colors[ImGuiCol_SliderGrabActive] = ImVec4(0.20f, 0.60f, 0.98f, 1.00f);
    colors[ImGuiCol_Separator] = ImVec4(0.24f, 0.24f, 0.24f, 1.00f);
    colors[ImGuiCol_Text] = ImVec4(0.92f, 0.92f, 0.92f, 1.00f);
    colors[ImGuiCol_TextDisabled] = ImVec4(0.60f, 0.60f, 0.60f, 1.00f);
}

static void reloadFontsForScale(float scale) {
	    ImGuiIO& io = ImGui::GetIO();

    // Türkçe karakterleri güvenilir kapsamak için Latin Extended aralıklarını ekle.
    static ImVector<ImWchar> glyphRanges;
    if (glyphRanges.Size == 0) {
        ImFontGlyphRangesBuilder builder;
        builder.AddRanges(io.Fonts->GetGlyphRangesDefault());
        const ImWchar latinExtA[] = { 0x0100, 0x017F, 0 };
        const ImWchar latinExtB[] = { 0x0180, 0x024F, 0 };
        const ImWchar latinExtAdd[] = { 0x1E00, 0x1EFF, 0 };
        builder.AddRanges(latinExtA);
        builder.AddRanges(latinExtB);
        builder.AddRanges(latinExtAdd);
        builder.AddChar(0x0130); // İ
        builder.AddChar(0x0131); // ı
        builder.AddChar(0x011E); // Ğ
        builder.AddChar(0x011F); // ğ
        builder.AddChar(0x015E); // Ş
        builder.AddChar(0x015F); // ş
        builder.BuildRanges(&glyphRanges);
    }

    io.Fonts->Clear();

	    ImFontConfig cfg;
	    // Varsayılan olarak biraz daha büyük + keskin font render.
	    cfg.OversampleH = 4;
	    cfg.OversampleV = 3;
	    cfg.PixelSnapH = true;
	    cfg.RasterizerMultiply = 1.15f; // okunabilirlik için biraz daha kalın

	    // Varsayılan font boyutu: uygulamanın geri kalanıyla tutarlı tut.
	    // Arapça metin küçük boyutlarda daha zor okunur; bu yüzden sadece Arapça için biraz büyüt.
	    const bool isArabicUi = (detectUiLang() == UiLang::AR);
	    const float basePx = isArabicUi ? 22.0f : 18.0f;
	    const float minPx = isArabicUi ? 16.0f : 14.0f;
	    const float fontPx = std::max(minPx, std::floor(basePx * scale));

	    ImFont* font = io.Fonts->AddFontFromFileTTF(g.fontPath.c_str(), fontPx, &cfg, glyphRanges.Data);
	    if (!font) {
	        std::cerr << "Failed to load font: " << g.fontPath << std::endl;
	        // Varsayılan'a yedekle
	        io.Fonts->AddFontDefault();
	    } else {
	        io.FontDefault = font;
	    }

        // Latin dışı yazılar için birleşik yedek fontlar ekle (Arapça / Devanagari).
        // Inter Arapça/Devanagari glifleri içermez; birleşik font olmazsa ImGui "????" gösterir.
        if (detectUiLang() == UiLang::AR) {
            // Bu repodaki Dear ImGui GetGlyphRangesArabic() sağlamıyor; bu yüzden temel bir Arapça aralığı sağla.
            // Arapça + ek + genişletilmiş + sunum biçimlerini içerir.
            static const ImWchar arabicRange[] = {
                0x0600, 0x06FF,
                0x0750, 0x077F,
                0x08A0, 0x08FF,
                0xFB50, 0xFDFF,
                0xFE70, 0xFEFF,
                0
            };
            if (auto arFont = findArabicFontPath()) {
                ImFontConfig mergeCfg;
                mergeCfg.MergeMode = true;
                mergeCfg.OversampleH = cfg.OversampleH;
                mergeCfg.OversampleV = cfg.OversampleV;
                mergeCfg.PixelSnapH = cfg.PixelSnapH;
                mergeCfg.RasterizerMultiply = cfg.RasterizerMultiply;
                if (!io.Fonts->AddFontFromFileTTF(arFont->c_str(), fontPx, &mergeCfg, arabicRange)) {
                    std::cerr << "[Font] Arabic merge font load failed: " << *arFont << std::endl;
                }
            } else {
                std::cerr << "[Font] Arabic font not found (install noto-fonts or bundle a font in assets/fonts)." << std::endl;
            }
        } else if (detectUiLang() == UiLang::HI) {
            // Dear ImGui Devanagari glif aralığı yardımcı fonksiyonu sağlamıyor; bu yüzden temel aralık sağlıyoruz.
            static const ImWchar devRange[] = { 0x0900, 0x097F, 0 };
            if (auto devFont = findDevanagariFontPath()) {
                ImFontConfig mergeCfg;
                mergeCfg.MergeMode = true;
                mergeCfg.OversampleH = cfg.OversampleH;
                mergeCfg.OversampleV = cfg.OversampleV;
                mergeCfg.PixelSnapH = cfg.PixelSnapH;
                mergeCfg.RasterizerMultiply = cfg.RasterizerMultiply;
                if (!io.Fonts->AddFontFromFileTTF(devFont->c_str(), fontPx, &mergeCfg, devRange)) {
                    std::cerr << "[Font] Devanagari merge font load failed: " << *devFont << std::endl;
                }
            } else {
                std::cerr << "[Font] Devanagari font not found (install noto-fonts or bundle a font in assets/fonts)." << std::endl;
            }
        }

	    // İstendiği gibi font dokusunu yeniden oluştur.
	    ImGui_ImplOpenGL3_DestroyFontsTexture();
	    ImGui_ImplOpenGL3_CreateFontsTexture();
}

static void rescaleImGui(float scale) {
    // Sıfırla, sonra boyutları deterministik olarak ölçekle.
    ImGuiStyle& style = ImGui::GetStyle();
    style = g.baseStyle;
    style.ScaleAllSizes(scale);
    applyClementineishStyle();
    reloadFontsForScale(scale);
}

static std::string truncateToFit(const std::string& text, float maxWidth, bool* outTruncated) {
    if (outTruncated) *outTruncated = false;
    if (ImGui::CalcTextSize(text.c_str()).x <= maxWidth) return text;

    const char* dots = "...";
    const float dotsW = ImGui::CalcTextSize(dots).x;
    if (dotsW >= maxWidth) {
        if (outTruncated) *outTruncated = true;
        return dots;
    }

    // Bayt sayısına göre yaklaşık ikili arama (pratikte UTF-8 dosya adları için uygun; tooltip tam metni gösterir).
    int lo = 0;
    int hi = (int)text.size();
    while (lo < hi) {
        int mid = (lo + hi + 1) / 2;
        std::string candidate = text.substr(0, mid) + dots;
        if (ImGui::CalcTextSize(candidate.c_str()).x <= maxWidth) lo = mid;
        else hi = mid - 1;
    }

    if (outTruncated) *outTruncated = true;
    return text.substr(0, lo) + dots;
}

static bool stringContainsCaseInsensitiveAscii(const std::string& haystack, const char* needle) {
    if (!needle || !*needle) return true;
    const std::string h = toLowerAscii(haystack);
    const std::string n = toLowerAscii(std::string(needle));
    return h.find(n) != std::string::npos;
}

static void renderContextMenuContents() {
        const char* ctxDisplay = visEnvText("AURIVO_VIS_CTX_DISPLAY", L7("Display", "Görüntü", "العرض", "Affichage", "Anzeige", "Pantalla", "डिस्प्ले"));
        const char* ctxRendering = visEnvText("AURIVO_VIS_CTX_RENDERING", L7("Rendering", "İşleme", "العرض المرئي", "Rendu", "Rendering", "Renderizado", "रेंडरिंग"));
        const char* ctxPresets = visEnvText("AURIVO_VIS_CTX_PRESETS", L7("Presets", "Presetler", "الإعدادات", "Presets", "Presets", "Presets", "प्रीसेट"));
        const char* ctxToggleFullscreen = visEnvText("AURIVO_VIS_CTX_TOGGLE_FULLSCREEN", L7("Toggle fullscreen", "Tam ekran göster/gizle", "تبديل ملء الشاشة", "Basculer plein écran", "Vollbild umschalten", "Alternar pantalla completa", "फुलस्क्रीन टॉगल करें"));
        const char* ctxFrameRate = visEnvText("AURIVO_VIS_CTX_FRAME_RATE", L7("Frame rate", "Kare oranı", "معدل الإطارات", "Fréquence d’images", "Bildrate", "Velocidad de fotogramas", "फ़्रेम दर"));
        const char* ctxQuality = visEnvText("AURIVO_VIS_CTX_QUALITY", L7("Quality", "Kalite", "الجودة", "Qualité", "Qualität", "Calidad", "गुणवत्ता"));
        const char* ctxClarity = visEnvText("AURIVO_VIS_CTX_CLARITY", L7("Clarity", "Netlik", "الوضوح", "Netteté", "Klarheit", "Nitidez", "स्पष्टता"));
        const char* ctxSelectVisuals = visEnvText("AURIVO_VIS_CTX_SELECT_VISUALS", L7("Select visualizations...", "Görselleştirmeleri seç...", "اختيار المرئيات...", "Sélectionner des visuels...", "Visuals auswählen...", "Seleccionar visuales...", "विज़ुअल चुनें..."));
        const char* ctxClose = visEnvText("AURIVO_VIS_CTX_CLOSE", L7("Close visualization", "Görselleştirmeyi kapat", "إغلاق المرئيات", "Fermer le visualiseur", "Visualizer schließen", "Cerrar visualizador", "विज़ुअलाइज़र बंद करें"));
        const char* ctxFpsLow = visEnvText("AURIVO_VIS_CTX_FPS_LOW", L7("Low (15 fps)", "Düşük (15 fps)", "منخفض (١٥)", "Faible (15 fps)", "Niedrig (15 fps)", "Bajo (15 fps)", "कम (15 fps)"));
        const char* ctxFpsMedium = visEnvText("AURIVO_VIS_CTX_FPS_MEDIUM", L7("Medium (25 fps)", "Orta (25 fps)", "متوسط (٢٥)", "Moyen (25 fps)", "Mittel (25 fps)", "Medio (25 fps)", "मध्यम (25 fps)"));
        const char* ctxFpsHigh = visEnvText("AURIVO_VIS_CTX_FPS_HIGH", L7("High (35 fps)", "Yüksek (35 fps)", "مرتفع (٣٥)", "Élevé (35 fps)", "Hoch (35 fps)", "Alto (35 fps)", "उच्च (35 fps)"));
        const char* ctxFpsSuper = visEnvText("AURIVO_VIS_CTX_FPS_SUPER", L7("Super high (60 fps)", "Süper yüksek (60 fps)", "فائق (٦٠)", "Très élevé (60 fps)", "Sehr hoch (60 fps)", "Muy alto (60 fps)", "बहुत उच्च (60 fps)"));
        const char* ctxQualityLow = visEnvText("AURIVO_VIS_CTX_QUALITY_LOW", L7("Low (256x256)", "Düşük (256x256)", "منخفض (٢٥٦×٢٥٦)", "Faible (256×256)", "Niedrig (256×256)", "Bajo (256×256)", "कम (256×256)"));
        const char* ctxQualityMedium = visEnvText("AURIVO_VIS_CTX_QUALITY_MEDIUM", L7("Medium (512x512)", "Orta (512x512)", "متوسط (٥١٢×٥١٢)", "Moyen (512×512)", "Mittel (512×512)", "Medio (512×512)", "मध्यम (512×512)"));
        const char* ctxQualityHigh = visEnvText("AURIVO_VIS_CTX_QUALITY_HIGH", L7("High (1024x1024)", "Yüksek (1024x1024)", "مرتفع (١٠٢٤×١٠٢٤)", "Élevé (1024×1024)", "Hoch (1024×1024)", "Alto (1024×1024)", "उच्च (1024×1024)"));
        const char* ctxQualitySuper = visEnvText("AURIVO_VIS_CTX_QUALITY_SUPER", L7("Super high (2048x2048)", "Süper yüksek (2048x2048)", "فائق (٢٠٤٨×٢٠٤٨)", "Très élevé (2048×2048)", "Sehr hoch (2048×2048)", "Muy alto (2048×2048)", "बहुत उच्च (2048×2048)"));
        const char* ctxClaritySoft = visEnvText("AURIVO_VIS_CTX_CLARITY_SOFT", L7("Soft", "Yumuşak", "ناعم", "Doux", "Weich", "Suave", "नरम"));
        const char* ctxClarityBalanced = visEnvText("AURIVO_VIS_CTX_CLARITY_BALANCED", L7("Balanced", "Dengeli", "متوازن", "Équilibré", "Ausgewogen", "Equilibrado", "संतुलित"));
        const char* ctxClaritySharp = visEnvText("AURIVO_VIS_CTX_CLARITY_SHARP", L7("Sharp", "Keskin", "حاد", "Net", "Scharf", "Nítido", "तीक्ष्ण"));
        const char* ctxClaritySharpPlus = visEnvText("AURIVO_VIS_CTX_CLARITY_SHARP_PLUS", L7("Sharp+", "Keskin+", "حاد+", "Net+", "Scharf+", "Nítido+", "तीक्ष्ण+"));

        ImGui::PushStyleColor(ImGuiCol_TextDisabled, ImVec4(0.58f, 0.66f, 0.76f, 1.0f));
        ImGui::TextUnformatted(ctxDisplay);
        ImGui::PopStyleColor();

	        // 1) Tam ekran göster/gizle
		        if (ImGui::MenuItem(
                ctxToggleFullscreen,
		                "F",
		                g.fullscreen
		            )) {
	            g.fullscreen = !g.fullscreen;
	            SDL_SetWindowFullscreen(g.window, g.fullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);
	        }

	        // 2) Kare oranı >  (FPS alt menüsü)
		        ImGui::SetNextWindowSizeConstraints(ImVec2(220, 0), ImVec2(FLT_MAX, FLT_MAX));
        if (ImGui::BeginMenu(ctxFrameRate)) {
            if (ImGui::RadioButton(ctxFpsLow, g.fpsMode == QualityFpsMode::LOW_15)) {
		                applyFpsMode(QualityFpsMode::LOW_15);
		                ImGui::CloseCurrentPopup();
		            }
		            if (ImGui::RadioButton(ctxFpsMedium, g.fpsMode == QualityFpsMode::MID_25)) {
		                applyFpsMode(QualityFpsMode::MID_25);
		                ImGui::CloseCurrentPopup();
		            }
            if (ImGui::RadioButton(ctxFpsHigh, g.fpsMode == QualityFpsMode::HIGH_35)) {
		                applyFpsMode(QualityFpsMode::HIGH_35);
		                ImGui::CloseCurrentPopup();
		            }
            if (ImGui::RadioButton(ctxFpsSuper, g.fpsMode == QualityFpsMode::SUPER_60)) {
		                applyFpsMode(QualityFpsMode::SUPER_60);
		                ImGui::CloseCurrentPopup();
		            }
		            ImGui::EndMenu();
		        }

        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_TextDisabled, ImVec4(0.58f, 0.66f, 0.76f, 1.0f));
        ImGui::TextUnformatted(ctxRendering);
        ImGui::PopStyleColor();

	        // 3) Kalite > (doku kalite radyo alt menüsü olarak istenen)
		        ImGui::SetNextWindowSizeConstraints(ImVec2(260, 0), ImVec2(FLT_MAX, FLT_MAX));
		        if (ImGui::BeginMenu(ctxQuality)) {
            if (ImGui::RadioButton(ctxQualityLow, g.textureQuality == TextureQuality::Q256)) {
		                applyTextureQuality(TextureQuality::Q256);
		                ImGui::CloseCurrentPopup();
		            }
		            if (ImGui::RadioButton(ctxQualityMedium, g.textureQuality == TextureQuality::Q512)) {
		                applyTextureQuality(TextureQuality::Q512);
		                ImGui::CloseCurrentPopup();
		            }
            if (ImGui::RadioButton(ctxQualityHigh, g.textureQuality == TextureQuality::Q1024)) {
		                applyTextureQuality(TextureQuality::Q1024);
		                ImGui::CloseCurrentPopup();
		            }
            if (ImGui::RadioButton(ctxQualitySuper, g.textureQuality == TextureQuality::Q2048)) {
		                applyTextureQuality(TextureQuality::Q2048);
		                ImGui::CloseCurrentPopup();
		            }
		            ImGui::EndMenu();
		        }

	        // 4) Netlik > (gercek keskinlik/ayrisim profili)
		        ImGui::SetNextWindowSizeConstraints(ImVec2(240, 0), ImVec2(FLT_MAX, FLT_MAX));
		        if (ImGui::BeginMenu(ctxClarity)) {
            if (ImGui::RadioButton(ctxClaritySoft, g.clarityMode == ClarityMode::Soft)) {
		                applyClarityMode(ClarityMode::Soft);
		                ImGui::CloseCurrentPopup();
		            }
		            if (ImGui::RadioButton(ctxClarityBalanced, g.clarityMode == ClarityMode::Balanced)) {
		                applyClarityMode(ClarityMode::Balanced);
		                ImGui::CloseCurrentPopup();
		            }
            if (ImGui::RadioButton(ctxClaritySharp, g.clarityMode == ClarityMode::Sharp)) {
		                applyClarityMode(ClarityMode::Sharp);
		                ImGui::CloseCurrentPopup();
		            }
            if (ImGui::RadioButton(ctxClaritySharpPlus, g.clarityMode == ClarityMode::SharpPlus)) {
		                applyClarityMode(ClarityMode::SharpPlus);
		                ImGui::CloseCurrentPopup();
		            }
		            ImGui::EndMenu();
		        }

        ImGui::Separator();
        ImGui::PushStyleColor(ImGuiCol_TextDisabled, ImVec4(0.58f, 0.66f, 0.76f, 1.0f));
        ImGui::TextUnformatted(ctxPresets);
        ImGui::PopStyleColor();

		        // 5) Görselleştirmeleri seç...
        if (ImGui::MenuItem(ctxSelectVisuals)) {
		            g.showPresetPicker = true;
		        }

        ImGui::Separator();

	        // 6) Görselleştirmeyi kapat
	        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.25f, 0.20f, 1.0f));
        if (ImGui::MenuItem(ctxClose, nullptr)) {
	            g.running = false;
	        }
	        ImGui::PopStyleColor();

}

static void drawContextMenuHost() {
    // Görselleştirici alanına sağ tıklandığında (başka ImGui penceresi yokken) görünmez tam ekran pencere barındır
    // böylece bağlam menüsü açacak bir yer olur.
    ImGuiIO& io = ImGui::GetIO();

    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::SetNextWindowBgAlpha(0.0f);

    ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoNav |
                             ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoScrollbar |
                             ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoInputs;

    ImGui::Begin("##AurivoContextHost", nullptr, flags);

    // Sağlam bağlam menüsü tetikleyici: hangi ImGui penceresi hover olursa olsun sağ tuş bırakmada aç.
    // Bu, BeginPopupContextWindow()'un hover/capture tuhaflıkları nedeniyle tetiklenmediği uç durumları önler.
    if (ImGui::IsMouseReleased(ImGuiMouseButton_Right) &&
        !ImGui::IsPopupOpen("AurivoContextMenu", ImGuiPopupFlags_AnyPopupId)) {
        ImGui::OpenPopup("AurivoContextMenu");
    }

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 12.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 14.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 9.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_PopupBorderSize, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.07f, 0.09f, 0.13f, 0.97f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.28f, 0.42f, 0.55f, 0.42f));
    ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.17f, 0.24f, 0.33f, 0.58f));
    ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.22f, 0.33f, 0.45f, 0.72f));
    ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.25f, 0.40f, 0.54f, 0.84f));
    ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.35f, 0.46f, 0.58f, 0.35f));

    if (ImGui::BeginPopup("AurivoContextMenu")) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImVec2 p = ImGui::GetWindowPos();
        const ImVec2 s = ImGui::GetWindowSize();
        dl->AddRectFilledMultiColor(
            p,
            ImVec2(p.x + s.x, p.y + 5.0f),
            IM_COL32(90, 182, 255, 205),
            IM_COL32(82, 236, 197, 165),
            IM_COL32(82, 236, 197, 165),
            IM_COL32(90, 182, 255, 205)
        );
        renderContextMenuContents();
        ImGui::EndPopup();
    }
    ImGui::PopStyleColor(6);
    ImGui::PopStyleVar(5);
    ImGui::End();
}

static void drawPresetPicker() {
    if (!g.showPresetPicker) return;

    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGuiWindowFlags rootFlags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus;
    ImGui::Begin("##AurivoPickerRoot", nullptr, rootFlags);

    const float scale = (g.pickerWindow ? g.pickerDpiScale : g.dpiScale);
    ImDrawList* rootDl = ImGui::GetWindowDrawList();
    const ImVec2 rootPos = ImGui::GetWindowPos();
    const ImVec2 rootSize = ImGui::GetWindowSize();

    rootDl->AddRectFilled(rootPos, ImVec2(rootPos.x + rootSize.x, rootPos.y + rootSize.y), IM_COL32(10, 14, 22, 255));
    rootDl->AddRectFilledMultiColor(
        rootPos,
        ImVec2(rootPos.x + rootSize.x, rootPos.y + rootSize.y * 0.48f),
        IM_COL32(28, 96, 146, 118),
        IM_COL32(18, 34, 62, 64),
        IM_COL32(6, 12, 18, 0),
        IM_COL32(12, 28, 46, 82)
    );

    const bool compactMode = g.pickerCompactMode;
    const float outerPad = compactMode ? std::max(12.0f, 16.0f * scale) : std::max(16.0f, 22.0f * scale);
    const float blockGap = compactMode ? std::max(8.0f, 10.0f * scale) : std::max(12.0f, 14.0f * scale);
    const float heroH = compactMode ? std::max(64.0f, 72.0f * scale) : std::max(84.0f, 96.0f * scale);
    const float footerH = compactMode ? std::max(40.0f, 50.0f * scale) : std::max(46.0f, 58.0f * scale);

    const char* heroTitle = visEnvText("AURIVO_VIS_PICKER_HERO_TITLE", L7("Curate the visual atmosphere", "Görsel atmosferi küratör gibi seçin", "Ù†Ø³Ù‚ Ø§Ù„Ø£Ø¬ÙˆØ§Ø¡ Ø§Ù„Ø¨ØµØ±ÙŠØ©", "Composez une atmosphère visuelle", "Gestalte die visuelle Stimmung", "Cura la atmósfera visual", "à¤µà¤¿à¤œà¤¼à¥à¤…à¤² à¤®à¤¾à¤¹à¥Œà¤² à¤šà¥à¤¨à¥‡à¤‚"));
    const char* heroHint = visEnvText("AURIVO_VIS_PICKER_HINT", L7(
        "Choose the presets included in the premium-style auto switch flow.",
        "Otomatik geçiş akışına dahil olacak presetleri daha seçkin bir düzenle yönetin.",
        "Ø­Ø¯Ø¯ Ø§Ù„Ù…Ø±Ø¦ÙŠØ§Øª Ø§Ù„ØªÙŠ Ø³ØªØ¯Ø®Ù„ ÙÙŠ Ø§Ù„ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ.",
        "Choisissez les presets inclus dans la rotation automatique.",
        "Wähle die Presets für den automatischen Wechsel aus.",
        "Elige los presets incluidos en el cambio automático.",
        "à¤‘à¤Ÿà¥‹ à¤¸à¥à¤µà¤¿à¤š à¤®à¥‡à¤‚ à¤¶à¤¾à¤®à¤¿à¤² à¤¹à¥‹à¤¨à¥‡ à¤µà¤¾à¤²à¥‡ à¤ªà¥à¤°à¥€à¤¸à¥‡à¤Ÿ à¤šà¥à¤¨à¥‡à¤‚।"
    ));
    const char* dirLabel = visEnvText("AURIVO_VIS_PICKER_PRESET_DIR", L7("Preset directory", "Preset dizini", "Ù…Ø¬Ù„Ø¯ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª", "Dossier des préréglages", "Preset-Ordner", "Carpeta de presets", "à¤ªà¥à¤°à¥€à¤¸à¥‡à¤Ÿ à¤«à¤¼à¥‹à¤²à¥à¤¡à¤°"));
    const char* searchHint = visEnvText("AURIVO_VIS_PICKER_SEARCH", L7("Search presets...", "Preset ara...", "Ø§Ø¨Ø­Ø« Ø¹Ù† preset...", "Rechercher un preset...", "Preset suchen...", "Buscar preset...", "à¤ªà¥à¤°à¥€à¤¸à¥‡à¤Ÿ à¤–à¥‹à¤œà¥‡à¤‚..."));
    const char* delayLabel = visEnvText("AURIVO_VIS_PICKER_DELAY", L7("Switch delay", "Geçiş gecikmesi", "ØªØ£Ø®ÙŠØ± Ø§Ù„ØªØ¨Ø¯ÙŠÙ„", "Délai de rotation", "Wechselverzögerung", "Retraso de cambio", "à¤¸à¥à¤µà¤¿à¤š à¤¡à¥‡à¤²à¥‡"));
    const char* compactLabel = visEnvText("AURIVO_VIS_PICKER_COMPACT", L7("Compact", "Kompakt", "Ù…Ø¯Ù…Ø¬", "Compact", "Kompakt", "Compacto", "à¤•à¥‰à¤®à¥à¤ªà¥ˆà¤•à¥à¤Ÿ"));
    const char* enabledLabel = visEnvText("AURIVO_VIS_PICKER_ENABLED", L7("Enabled", "Etkin", "Ù…ÙÙØ¹Ù„", "Actif", "Aktiv", "Activo", "à¤¸à¤•à¥à¤°à¤¿à¤¯"));
    const char* filterActiveLabel = visEnvText("AURIVO_VIS_PICKER_FILTER_ACTIVE", L7("Filter active:", "Filtre aktif:", "Ø§Ù„ÙÙ„ØªØ± Ù†Ø´Ø·:", "Filtre actif :", "Filter aktiv:", "Filtro activo:", "à¤«à¤¿à¤²à¥à¤Ÿà¤° à¤¸à¤•à¥à¤°à¤¿à¤¯:"));
    const char* galleryLabel = visEnvText("AURIVO_VIS_PICKER_GALLERY", L7("Preset gallery", "Preset galerisi", "Ù…Ø¹Ø±Ø¶ preset", "Galerie de presets", "Preset-Galerie", "Galería de presets", "à¤ªà¥à¤°à¥€à¤¸à¥‡à¤Ÿ à¤—à¥ˆà¤²à¤°à¥€"));
    const char* noMatchLabel = visEnvText("AURIVO_VIS_PICKER_NO_MATCH", L7("No preset matched your search.", "Aramanızla eşleşen preset bulunamadı.", "Ù„Ù… ÙŠÙØ¹Ø«Ø± Ø¹Ù„Ù‰ preset Ù…Ø·Ø§Ø¨Ù‚.", "Aucun preset ne correspond.", "Kein passendes Preset gefunden.", "No hay coincidencias.", "à¤•à¥‹à¤ˆ à¤®à¤¿à¤²à¤¾à¤¨ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾।"));
    const char* inRotationLabel = visEnvText("AURIVO_VIS_PICKER_IN_ROTATION", L7("In rotation", "Döngüde", "ÙÙŠ Ø§Ù„Ø¯ÙˆØ±Ø§Ù†", "Dans la rotation", "In Rotation", "En rotación", "à¤°à¥‹à¤Ÿà¥‡à¤¶à¤¨ à¤®à¥‡à¤‚"));
    const char* manualOnlyLabel = visEnvText("AURIVO_VIS_PICKER_MANUAL_ONLY", L7("Manual only", "Sadece manuel", "ÙŠØ¯ÙˆÙŠ ÙÙ‚Ø·", "Manuel uniquement", "Nur manuell", "Solo manual", "à¤¸à¤¿à¤°à¥à¤« à¤®à¥ˆà¤¨à¥à¤…à¤²"));
    const char* includedTipLabel = visEnvText("AURIVO_VIS_PICKER_INCLUDED", L7("Included in auto-switch", "Otomatik geçişe dahil", "Ù…Ø¶Ù…Ù† ÙÙŠ Ø§Ù„ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ", "Inclus dans la rotation auto", "Im Auto-Wechsel enthalten", "Incluido en auto-cambio", "à¤‘à¤Ÿà¥‹ à¤¸à¥à¤µà¤¿à¤š à¤®à¥‡à¤‚ à¤¶à¤¾à¤®à¤¿à¤²"));
    static uint64_t pickerAppearMs = 0;
    if (ImGui::IsWindowAppearing()) {
        pickerAppearMs = nowMs();
    }
    float appearNorm = std::clamp((float)(nowMs() - pickerAppearMs) / 420.0f, 0.0f, 1.0f);
    float appearEase = 1.0f - (1.0f - appearNorm) * (1.0f - appearNorm);

    int enabledCount = 0;
    for (const auto& p : g.presets) {
        if (p.enabled) enabledCount++;
    }

    std::vector<int> visibleIndices;
    visibleIndices.reserve(g.presets.size());
    for (int i = 0; i < (int)g.presets.size(); i++) {
        if (stringContainsCaseInsensitiveAscii(g.presets[i].displayName, g.pickerSearchBuf.data())) {
            visibleIndices.push_back(i);
        }
    }

    auto setNavToVisible = [&](int desiredIndex) {
        if (visibleIndices.empty()) {
            g.pickerNavIndex = -1;
            return;
        }
        int chosen = visibleIndices.front();
        for (int idx : visibleIndices) {
            if (idx >= desiredIndex) {
                chosen = idx;
                break;
            }
            chosen = idx;
        }
        g.pickerNavIndex = chosen;
    };

    auto visiblePositionOf = [&](int presetIndex) -> int {
        for (int i = 0; i < (int)visibleIndices.size(); i++) {
            if (visibleIndices[i] == presetIndex) return i;
        }
        return -1;
    };

    if (ImGui::IsWindowAppearing()) {
        setNavToVisible(std::clamp(g.currentPreset, 0, (int)g.presets.size() - 1));
        g.pickerNavScrollTo = true;
    } else if (!visibleIndices.empty() && visiblePositionOf(g.pickerNavIndex) < 0) {
        setNavToVisible(g.currentPreset);
        g.pickerNavScrollTo = true;
    }

    if (ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) && !ImGui::IsAnyItemActive() && !visibleIndices.empty()) {
        int visiblePos = visiblePositionOf(g.pickerNavIndex);
        if (visiblePos < 0) visiblePos = 0;

        if (ImGui::IsKeyPressed(ImGuiKey_UpArrow)) {
            visiblePos = std::max(0, visiblePos - 1);
            g.pickerNavIndex = visibleIndices[visiblePos];
            g.pickerNavScrollTo = true;
            g.currentPreset = g.pickerNavIndex;
            requestPresetPreview(g.pickerNavIndex);
        } else if (ImGui::IsKeyPressed(ImGuiKey_DownArrow)) {
            visiblePos = std::min((int)visibleIndices.size() - 1, visiblePos + 1);
            g.pickerNavIndex = visibleIndices[visiblePos];
            g.pickerNavScrollTo = true;
            g.currentPreset = g.pickerNavIndex;
            requestPresetPreview(g.pickerNavIndex);
        } else if (ImGui::IsKeyPressed(ImGuiKey_Space)) {
            if (g.pickerNavIndex >= 0 && g.pickerNavIndex < (int)g.presets.size()) {
                g.presets[g.pickerNavIndex].enabled = !g.presets[g.pickerNavIndex].enabled;
            }
        } else if (ImGui::IsKeyPressed(ImGuiKey_Enter)) {
            g.currentPreset = g.pickerNavIndex;
            requestPresetPreview(g.pickerNavIndex);
        }
    }

    ImGui::SetCursorPos(ImVec2(outerPad, outerPad));
    ImGui::BeginGroup();
    {
        ImVec2 heroPos = ImGui::GetCursorScreenPos();
        ImVec2 heroSize(ImGui::GetContentRegionAvail().x, heroH);
        rootDl->AddRectFilled(heroPos, ImVec2(heroPos.x + heroSize.x, heroPos.y + heroSize.y), IM_COL32(17, 24, 34, 214), 16.0f * scale);
        rootDl->AddRectFilledMultiColor(
            heroPos,
            ImVec2(heroPos.x + heroSize.x, heroPos.y + heroSize.y),
            IM_COL32(58, 168, 255, 30),
            IM_COL32(95, 230, 194, 14),
            IM_COL32(8, 12, 18, 2),
            IM_COL32(10, 14, 22, 8)
        );
        rootDl->AddCircleFilled(ImVec2(heroPos.x + heroSize.x - 44.0f * scale, heroPos.y + 34.0f * scale), 32.0f * scale, IM_COL32(70, 160, 255, 18), 36);

        ImGui::Dummy(heroSize);
        ImGui::SetCursorScreenPos(ImVec2(heroPos.x + 16.0f * scale, heroPos.y + (compactMode ? 8.0f : 12.0f) * scale));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.93f, 0.97f, 1.0f, 1.0f));
        ImGui::TextUnformatted(heroTitle);
        ImGui::PopStyleColor();

        if (!compactMode) {
            ImGui::SetCursorScreenPos(ImVec2(heroPos.x + 16.0f * scale, heroPos.y + 36.0f * scale));
            ImGui::PushTextWrapPos(heroPos.x + heroSize.x - 120.0f * scale);
            ImGui::TextDisabled("%s", heroHint);
            ImGui::PopTextWrapPos();
        }

        ImGui::SetCursorScreenPos(ImVec2(heroPos.x + 16.0f * scale, heroPos.y + heroSize.y - (compactMode ? 22.0f : 24.0f) * scale));
        ImGui::TextDisabled("%s:", dirLabel);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.70f, 0.87f, 1.0f, 1.0f));
        ImGui::Text("%d", (int)g.presets.size());
        ImGui::PopStyleColor();
        ImGui::SameLine();
        ImGui::TextDisabled("|");
        ImGui::SameLine();
        ImGui::TextDisabled("%s:", enabledLabel);
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.62f, 0.90f, 0.78f, 1.0f));
        ImGui::Text("%d", enabledCount);
        ImGui::PopStyleColor();
    }

    ImGui::Dummy(ImVec2(0, compactMode ? std::max(6.0f, 8.0f * scale) : std::max(8.0f, 10.0f * scale)));
    {
        ImVec2 controlPos = ImGui::GetCursorScreenPos();
        ImVec2 controlSize(ImGui::GetContentRegionAvail().x, (compactMode ? 50.0f : 58.0f) * scale);
        rootDl->AddRectFilled(controlPos, ImVec2(controlPos.x + controlSize.x, controlPos.y + controlSize.y), IM_COL32(15, 20, 28, 220), 14.0f * scale);
        rootDl->AddRect(controlPos, ImVec2(controlPos.x + controlSize.x, controlPos.y + controlSize.y), IM_COL32(255, 255, 255, 18), 14.0f * scale, 0, 1.0f);
        ImGui::Dummy(controlSize);

        float delayBlockW = std::max(230.0f, 240.0f * scale);
        float compactBtnW = std::max(88.0f, 94.0f * scale);
        float searchW = std::max(120.0f, controlSize.x - delayBlockW - compactBtnW - 34.0f * scale);

        ImGui::SetCursorScreenPos(ImVec2(controlPos.x + 12.0f * scale, controlPos.y + (compactMode ? 8.0f : 10.0f) * scale));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f * scale);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f * scale, (compactMode ? 7.0f : 9.0f) * scale));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.09f, 0.12f, 0.17f, 0.98f));
        ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.12f, 0.17f, 0.24f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.13f, 0.20f, 0.29f, 1.0f));
        ImGui::SetNextItemWidth(searchW);
        if (ImGui::InputTextWithHint("##picker_search", searchHint, g.pickerSearchBuf.data(), g.pickerSearchBuf.size())) {
            setNavToVisible(g.currentPreset);
            g.pickerNavScrollTo = true;
        }
        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);

        ImGui::SetCursorScreenPos(ImVec2(controlPos.x + 16.0f * scale + searchW, controlPos.y + (compactMode ? 8.0f : 10.0f) * scale));
        if (ImGui::Button(compactLabel, ImVec2(compactBtnW, (compactMode ? 30.0f : 34.0f) * scale))) {
            g.pickerCompactMode = !g.pickerCompactMode;
        }

        auto applyDelay = [&](int v) {
            int clamped = std::clamp(v, 5, 120);
            if (clamped != g.delaySeconds) {
                g.delaySeconds = clamped;
                scheduleNextAutoSwitch();
            }
        };

        float delayX = controlPos.x + controlSize.x - delayBlockW + 10.0f * scale;
        ImGui::SetCursorScreenPos(ImVec2(delayX, controlPos.y + (compactMode ? 5.0f : 7.0f) * scale));
        ImGui::TextDisabled("%s", delayLabel);
        ImGui::SetCursorScreenPos(ImVec2(delayX + 106.0f * scale, controlPos.y + (compactMode ? 2.0f : 4.0f) * scale));
        char delayDigits[16];
        std::snprintf(delayDigits, sizeof(delayDigits), "%d", g.delaySeconds);
        const float valueW = std::max(38.0f * scale, ImGui::CalcTextSize(delayDigits).x + 20.0f * scale);
        if (ImGui::ArrowButton("##delay_minus", ImGuiDir_Left)) {
            applyDelay(g.delaySeconds - 5);
        }
        ImGui::SameLine(0, 6.0f * scale);
        int delayTmp = g.delaySeconds;
        ImGui::PushItemWidth(valueW);
        if (ImGui::InputInt("##delay_compact", &delayTmp, 0, 0)) {
            applyDelay(delayTmp);
        }
        ImGui::PopItemWidth();
        ImGui::SameLine(0, 4.0f * scale);
        ImGui::TextDisabled("s");
        ImGui::SameLine(0, 6.0f * scale);
        if (ImGui::ArrowButton("##delay_plus", ImGuiDir_Right)) {
            applyDelay(g.delaySeconds + 5);
        }
    }

    std::string activeSearch = trimAscii(g.pickerSearchBuf.data());
    if (!activeSearch.empty()) {
        ImGui::Dummy(ImVec2(0, 8.0f * scale));
        ImVec2 filterPos = ImGui::GetCursorScreenPos();
        const std::string filterText = std::string(filterActiveLabel) + std::string(" ") + activeSearch;
        const float filterW = ImGui::CalcTextSize(filterText.c_str()).x + 26.0f * scale;
        const float filterH = 24.0f * scale;
            rootDl->AddRectFilled(filterPos, ImVec2(filterPos.x + filterW, filterPos.y + filterH), IM_COL32(34, 63, 94, 232), 12.0f * scale);
            rootDl->AddRect(filterPos, ImVec2(filterPos.x + filterW, filterPos.y + filterH), IM_COL32(124, 196, 255, 110), 12.0f * scale, 0, 1.0f);
            ImGui::Dummy(ImVec2(filterW, filterH));
            ImGui::SetCursorScreenPos(ImVec2(filterPos.x + 11.0f * scale, filterPos.y + 5.0f * scale));
            ImGui::TextUnformatted(filterText.c_str());
    }

    ImGui::Dummy(ImVec2(0, blockGap));

    const float listHeaderH = (compactMode ? 26.0f : 32.0f) * scale;
    const float listFooterReserve = footerH + blockGap;
    const float listH = std::max(170.0f, ImGui::GetContentRegionAvail().y - listFooterReserve);
    {
        ImVec2 listPos = ImGui::GetCursorScreenPos();
        ImVec2 listSize(ImGui::GetContentRegionAvail().x, listH);
        rootDl->AddRectFilled(listPos, ImVec2(listPos.x + listSize.x, listPos.y + listSize.y), IM_COL32(14, 18, 25, 220), 18.0f * scale);
        rootDl->AddRect(listPos, ImVec2(listPos.x + listSize.x, listPos.y + listSize.y), IM_COL32(255, 255, 255, 18), 18.0f * scale, 0, 1.0f);

        ImGui::SetCursorScreenPos(ImVec2(listPos.x + 16.0f * scale, listPos.y + 10.0f * scale));
        ImGui::TextDisabled("%s", galleryLabel);
        ImGui::SetCursorScreenPos(ImVec2(listPos.x, listPos.y + listHeaderH));

        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f * scale, 8.0f * scale));
        bool childOk = ImGui::BeginChild("##preset_list", ImVec2(listSize.x, listSize.y - listHeaderH), false, ImGuiWindowFlags_NoNav);
        ImGui::PopStyleVar();
        if (childOk) {
            if (visibleIndices.empty()) {
                ImGui::Dummy(ImVec2(0, 18.0f * scale));
                ImGui::TextDisabled("%s", noMatchLabel);
            } else {
                ImDrawList* listDl = ImGui::GetWindowDrawList();
                const float rowH = compactMode ? std::max(42.0f, 46.0f * scale) : std::max(52.0f, 58.0f * scale);
                const float cardGap = compactMode ? std::max(5.0f, 6.0f * scale) : std::max(8.0f, 10.0f * scale);
                const float cbSize = compactMode ? std::clamp(16.0f * scale, 14.0f, 20.0f) : std::clamp(18.0f * scale, 16.0f, 24.0f);

                ImGuiListClipper clipper;
                clipper.Begin((int)visibleIndices.size(), rowH + cardGap);
                while (clipper.Step()) {
                    for (int visibleRow = clipper.DisplayStart; visibleRow < clipper.DisplayEnd; visibleRow++) {
                        const int i = visibleIndices[visibleRow];
                        PresetItem& p = g.presets[i];
                        const bool isCurrent = (i == g.currentPreset);
                        const bool isNav = (i == g.pickerNavIndex);
                        float rowAnimT = 1.0f;
                        if (appearNorm < 0.995f) {
                            rowAnimT = std::clamp((appearEase - visibleRow * 0.035f) / 0.65f, 0.0f, 1.0f);
                        }
                        const float rowYOffset = (1.0f - rowAnimT) * 14.0f * scale;
                        const int rowAlpha = (int)std::lround(255.0f * rowAnimT);
                        const uint32_t seed = (uint32_t)std::hash<std::string>{}(p.path);
                        const int baseR = 56 + (int)(seed & 0x3F);
                        const int baseG = 90 + (int)((seed >> 6) & 0x5F);
                        const int baseB = 118 + (int)((seed >> 13) & 0x4F);
                        std::string initials = initialsFromPresetName(p.displayName);

                        ImGui::PushID(i);
                        ImVec2 rowMin = ImGui::GetCursorScreenPos();
                        rowMin.y += rowYOffset;
                        float rowW = ImGui::GetContentRegionAvail().x;
                        ImVec2 rowMax(rowMin.x + rowW, rowMin.y + rowH);

                        const ImU32 bgCol = isCurrent ? IM_COL32(22, 64, 100, rowAlpha) : IM_COL32(18, 24, 34, rowAlpha);
                        const ImU32 borderCol = isNav ? IM_COL32(108, 208, 255, std::min(220, rowAlpha)) : IM_COL32(255, 255, 255, std::min(36, rowAlpha));
                        listDl->AddRectFilled(rowMin, rowMax, bgCol, 14.0f * scale);
                        listDl->AddRect(rowMin, rowMax, borderCol, 14.0f * scale, 0, isNav ? 1.5f : 1.0f);
                        if (p.enabled) {
                            listDl->AddRectFilled(ImVec2(rowMin.x + 8.0f * scale, rowMin.y + 8.0f * scale), ImVec2(rowMin.x + 12.0f * scale, rowMax.y - 8.0f * scale), IM_COL32(88, 220, 176, std::min(255, rowAlpha)), 8.0f * scale);
                        }

                        ImGui::SetCursorScreenPos(rowMin);
                        ImGui::InvisibleButton("##row_hit", ImVec2(rowW, rowH));
                        bool rowHovered = ImGui::IsItemHovered();
                        bool rowClicked = ImGui::IsItemClicked(ImGuiMouseButton_Left);

                        ImVec2 cbMin(rowMin.x + 20.0f * scale, rowMin.y + (rowH - cbSize) * 0.5f);
                        ImVec2 cbMax(cbMin.x + cbSize, cbMin.y + cbSize);
                        bool cbHovered = ImGui::IsMouseHoveringRect(cbMin, cbMax, true);
                        listDl->AddRectFilled(cbMin, cbMax, p.enabled ? IM_COL32(88, 220, 176, std::min(235, rowAlpha)) : IM_COL32(30, 36, 46, std::min(255, rowAlpha)), 6.0f * scale);
                        listDl->AddRect(cbMin, cbMax, p.enabled ? IM_COL32(122, 245, 205, std::min(255, rowAlpha)) : IM_COL32(122, 132, 148, std::min(170, rowAlpha)), 6.0f * scale, 0, 1.2f);
                        if (p.enabled) {
                            listDl->AddLine(ImVec2(cbMin.x + cbSize * 0.24f, cbMin.y + cbSize * 0.55f), ImVec2(cbMin.x + cbSize * 0.43f, cbMin.y + cbSize * 0.74f), IM_COL32(9, 18, 22, std::min(255, rowAlpha)), std::max(1.6f, 2.2f * scale));
                            listDl->AddLine(ImVec2(cbMin.x + cbSize * 0.43f, cbMin.y + cbSize * 0.74f), ImVec2(cbMin.x + cbSize * 0.76f, cbMin.y + cbSize * 0.30f), IM_COL32(9, 18, 22, std::min(255, rowAlpha)), std::max(1.6f, 2.2f * scale));
                        }
                        if (cbHovered) {
                            ImGui::SetTooltip("%s", includedTipLabel);
                        }

                        const float coverW = compactMode ? std::max(40.0f, 46.0f * scale) : std::max(54.0f, 66.0f * scale);
                        const float coverH = rowH - (compactMode ? 10.0f : 14.0f) * scale;
                        ImVec2 coverMin(cbMax.x + 12.0f * scale, rowMin.y + (rowH - coverH) * 0.5f);
                        ImVec2 coverMax(coverMin.x + coverW, coverMin.y + coverH);
                        listDl->AddRectFilled(coverMin, coverMax, IM_COL32(baseR / 2, baseG / 2, baseB / 2, std::min(255, rowAlpha)), 10.0f * scale);
                        listDl->AddRectFilledMultiColor(
                            coverMin,
                            coverMax,
                            IM_COL32(baseR, baseG, baseB, std::min(220, rowAlpha)),
                            IM_COL32(std::min(255, baseR + 30), std::min(255, baseG + 20), std::min(255, baseB + 42), std::min(190, rowAlpha)),
                            IM_COL32(18, 25, 34, std::min(180, rowAlpha)),
                            IM_COL32(34, 58, 78, std::min(210, rowAlpha))
                        );
                        listDl->AddRect(coverMin, coverMax, IM_COL32(255, 255, 255, std::min(48, rowAlpha)), 10.0f * scale, 0, 1.0f);
                        listDl->AddCircleFilled(ImVec2(coverMax.x - 10.0f * scale, coverMin.y + 10.0f * scale), 5.0f * scale, IM_COL32(255, 255, 255, std::min(85, rowAlpha)), 18);
                        listDl->AddText(ImVec2(coverMin.x + 8.0f * scale, coverMin.y + 8.0f * scale), IM_COL32(248, 252, 255, std::min(255, rowAlpha)), initials.c_str());

                        float contentX = coverMax.x + 12.0f * scale;
                        float actionW = compactMode ? 48.0f * scale : 60.0f * scale;
                        float textW = std::max(80.0f, rowW - (contentX - rowMin.x) - actionW - 16.0f * scale);
                        ImVec2 actionPos(rowMax.x - actionW, rowMin.y + 11.0f * scale);
                        ImVec2 actionMax(actionPos.x + (compactMode ? 32.0f : 40.0f) * scale, actionPos.y + 28.0f * scale);
                        ImVec2 textPos(contentX, compactMode ? (rowMin.y + (rowH - ImGui::GetTextLineHeight()) * 0.5f - 1.0f * scale) : (rowMin.y + 10.0f * scale));
                        if (rowHovered && !isCurrent) {
                            listDl->AddRectFilled(rowMin, rowMax, IM_COL32(72, 158, 222, std::min(64, rowAlpha)), 14.0f * scale);
                        }
                        bool actionHovered = ImGui::IsMouseHoveringRect(actionPos, actionMax, true);
                        if (rowClicked && cbHovered) {
                            p.enabled = !p.enabled;
                        } else if (rowClicked) {
                            g.pickerNavIndex = i;
                            g.pickerNavScrollTo = false;
                            g.currentPreset = i;
                            requestPresetPreview(i);
                        }

                        bool truncated = false;
                        std::string shown = truncateToFit(p.displayName, textW, &truncated);
                        listDl->AddText(textPos, isCurrent ? IM_COL32(244, 249, 255, std::min(255, rowAlpha)) : IM_COL32(220, 228, 238, std::min(255, rowAlpha)), shown.c_str());
                        if (!compactMode) {
                            listDl->AddText(ImVec2(textPos.x, textPos.y + 22.0f * scale), IM_COL32(134, 149, 170, std::min(255, rowAlpha)), p.enabled ? inRotationLabel : manualOnlyLabel);
                        }
                        if (truncated && rowHovered) {
                            ImGui::SetTooltip("%s", p.displayName.c_str());
                        }

                        listDl->AddRectFilled(actionPos, actionMax,
                                              isCurrent ? IM_COL32(94, 184, 255, std::min(255, rowAlpha))
                                                        : (actionHovered ? IM_COL32(64, 94, 132, std::min(255, rowAlpha)) : IM_COL32(37, 48, 63, std::min(255, rowAlpha))),
                                              14.0f * scale);
                        const ImVec2 dotC((actionPos.x + actionMax.x) * 0.5f, (actionPos.y + actionMax.y) * 0.5f);
                        listDl->AddCircleFilled(dotC, 5.0f * scale, isCurrent ? IM_COL32(9, 22, 36, std::min(255, rowAlpha)) : IM_COL32(176, 196, 220, std::min(240, rowAlpha)), 20);

                        ImGui::SetCursorScreenPos(ImVec2(rowMin.x, rowMax.y + cardGap));
                        if (isNav && g.pickerNavScrollTo) {
                            ImGui::SetScrollHereY(0.35f);
                            g.pickerNavScrollTo = false;
                        }
                        ImGui::PopID();
                    }
                }
            }
        }
        ImGui::EndChild();
    }

    ImGui::Dummy(ImVec2(0, blockGap));

    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 12.0f * scale);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(16.0f * scale, 10.0f * scale));
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.11f, 0.15f, 0.21f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.14f, 0.20f, 0.28f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.24f, 0.33f, 1.0f));

    if (ImGui::Button(visEnvText("AURIVO_VIS_PICKER_ALL", L7("Select all", "Tümünü seç", "ØªØ­Ø¯ÙŠØ¯ Ø§Ù„ÙƒÙ„", "Tout sélectionner", "Alle wählen", "Seleccionar todo", "à¤¸à¤­à¥€ à¤šà¥à¤¨à¥‡à¤‚")))) {
        for (auto& p : g.presets) p.enabled = true;
    }
    ImGui::SameLine();
    if (ImGui::Button(visEnvText("AURIVO_VIS_PICKER_NONE", L7("Clear all", "Tümünü temizle", "Ù…Ø³Ø­ Ø§Ù„ÙƒÙ„", "Tout effacer", "Alles leeren", "Limpiar todo", "à¤¸à¤­à¥€ à¤¹à¤Ÿà¤¾à¤à¤")))) {
        for (auto& p : g.presets) p.enabled = false;
    }

    const char* okText = visEnvText("AURIVO_VIS_PICKER_OK", L7("Done", "Tamam", "ØªÙ…", "Terminer", "Fertig", "Listo", "à¤ªà¥‚à¤°à¤¾"));
    float btnW = std::max(96.0f * scale, ImGui::CalcTextSize(okText).x + ImGui::GetStyle().FramePadding.x * 2.0f);
    float rightX = ImGui::GetCursorPosX() + (ImGui::GetContentRegionAvail().x - btnW);
    rightX = std::max(ImGui::GetCursorPosX(), rightX);
    ImGui::SameLine();
    ImGui::SetCursorPosX(rightX);
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.31f, 0.69f, 1.0f, 0.95f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.39f, 0.75f, 1.0f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.24f, 0.61f, 0.94f, 1.0f));
    if (ImGui::Button(okText, ImVec2(btnW, 0))) {
        g.showPresetPicker = false;
    }
    ImGui::PopStyleColor(3);

    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(2);
    ImGui::EndGroup();

    ImGui::End();
}

static bool tryCreateContextForWindow(SDL_Window* w, SDL_GLContext& outCtx) {
    auto tryCreate = [&](int major, int minor) -> bool {
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, major);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, minor);
        #ifdef _WIN32
        // projectM Windows'ta legacy GL yolları kullanır; uyumluluk eksik sembolleri önler.
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_COMPATIBILITY);
#else
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
#endif
        if (outCtx) {
            SDL_GL_DeleteContext(outCtx);
            outCtx = nullptr;
        }
        outCtx = SDL_GL_CreateContext(w);
        return outCtx != nullptr;
    };

    // Önce GL 3.3 core dene, sonra 3.0 core.
    if (!tryCreate(3, 3)) {
        std::cerr << "GL 3.3 core context failed: " << SDL_GetError() << " (falling back to 3.0)" << std::endl;
        if (!tryCreate(3, 0)) {
            std::cerr << "GL 3.0 core context failed: " << SDL_GetError() << std::endl;
            return false;
        }
    }
    return true;
}

static bool ensurePickerWindow() {
    if (g.pickerWindow && g.pickerGL && g.pickerImGui) return true;

    // Mevcut GL context'ini (muhtemelen ana pencere) yedekle ve dönmeden önce geri yükle.
    SDL_Window* backupWindow = SDL_GL_GetCurrentWindow();
    SDL_GLContext backupContext = SDL_GL_GetCurrentContext();

    int wx = 0, wy = 0, ww = 0, wh = 0;
    if (g.window) {
        SDL_GetWindowPosition(g.window, &wx, &wy);
        SDL_GetWindowSize(g.window, &ww, &wh);
    }

    // Ana pencere GL özniteliklerini yansıt.
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    // İstenen boyutu kullanılabilir ekran alanına sıkıştır ve oluşturma sonrası zorla.
    int desiredW = g.pickerWinW;
    int desiredH = g.pickerWinH;
    int displayIndex = (g.window ? SDL_GetWindowDisplayIndex(g.window) : 0);
    SDL_Rect usable{0, 0, 0, 0};
    if (SDL_GetDisplayUsableBounds(displayIndex, &usable) == 0 && usable.w > 0 && usable.h > 0) {
        desiredW = std::clamp(desiredW, 420, (int)(usable.w * 0.95f));
        desiredH = std::clamp(desiredH, 360, (int)(usable.h * 0.95f));
    } else {
        desiredW = std::clamp(desiredW, 420, 1920);
        desiredH = std::clamp(desiredH, 360, 1080);
    }

    Uint32 pickerFlags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI;

		    g.pickerWindow = SDL_CreateWindow(
		        visEnvText("AURIVO_VIS_PICKER_TITLE", L7Raw(
		            "Aurivo Visuals",
            "Aurivo G\u00F6rseller",
		            "Ù…Ø±Ø¦ÙŠØ§Øª Aurivo",
		            "Visuels Aurivo",
		            "Aurivo Visuals",
		            "Visuales de Aurivo",
		            "Aurivo Visuals"
		        )),
	        wx + ww + 18,
	        wy + 42,
	        desiredW,
        desiredH,
        pickerFlags
    );
    if (!g.pickerWindow) {
        std::cerr << "Failed to create picker window: " << SDL_GetError() << std::endl;
        return false;
    }

    // Preset secici pencere ikonunu da ayarla (Windows titlebar sol ust simge)
    setSdlWindowIconFromEnv(g.pickerWindow);

    // Bazı WM'ler önceki boyutu geri yükleyebilir; istenen boyutu zorla.
    SDL_SetWindowSize(g.pickerWindow, desiredW, desiredH);

    if (!tryCreateContextForWindow(g.pickerWindow, g.pickerGL)) {
        if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
        return false;
    }

    SDL_GL_MakeCurrent(g.pickerWindow, g.pickerGL);
    std::cout << "BOOT swap interval set" << std::endl;
    SDL_GL_SetSwapInterval(1);

    // Bu context için de GL function pointer'larını yükle (zaten yüklüyse güvenli no-op).
    std::cout << "BOOT GL load functions..." << std::endl;
    if (!AurivoGL_LoadFunctions()) {
#ifdef _WIN32
    glewExperimental = GL_TRUE;
    GLenum glewErr = glewInit();
    if (glewErr != GLEW_OK) {
        std::cerr << "glewInit failed: " << (const char*)glewGetErrorString(glewErr) << std::endl;
        return false;
    }
    std::cout << "BOOT glewInit ok" << std::endl;
#endif
        std::cerr << "OpenGL function loading failed for picker window." << std::endl;
        if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
        return false;
    }

    // Seçici pencere için ayrı bir ImGui context oluştur.
    g.pickerImGui = ImGui::CreateContext();
    ImGui::SetCurrentContext(g.pickerImGui);

    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();
    ImGuiStyle& style = ImGui::GetStyle();
    style = g.baseStyle;
    applyClementineishStyle();

    ImGui_ImplSDL2_InitForOpenGL(g.pickerWindow, g.pickerGL);

    int major = 0, minor = 0;
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, &major);
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, &minor);
    const char* glsl = (major > 3 || (major == 3 && minor >= 3)) ? "#version 330 core" : "#version 130";
    ImGui_ImplOpenGL3_Init(glsl);

    updateDrawablePicker();
    g.pickerLastDpiScale = 0.0f;
    if (!g.fontPath.empty()) {
        rescaleImGui(g.pickerDpiScale);
        g.pickerLastDpiScale = g.pickerDpiScale;
    }

    // Ana context'i geri yükle.
    ImGui::SetCurrentContext(g.mainImGui);

    // Önceki GL context'i geri yükle; projectM ana context'te render etmeye devam etsin.
    if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
    return true;
}

static void destroyPickerWindow() {
    if (!g.pickerWindow) return;

    // GL silmelerinin seçici context'inde yapılmasını sağla.
    SDL_Window* backupWindow = SDL_GL_GetCurrentWindow();
    SDL_GLContext backupContext = SDL_GL_GetCurrentContext();
    if (g.pickerGL) {
        SDL_GL_MakeCurrent(g.pickerWindow, g.pickerGL);
    }

    if (g.pickerImGui) {
        ImGui::SetCurrentContext(g.pickerImGui);
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplSDL2_Shutdown();
        ImGui::DestroyContext(g.pickerImGui);
        g.pickerImGui = nullptr;
    }

    if (g.pickerGL) {
        SDL_GL_DeleteContext(g.pickerGL);
        g.pickerGL = nullptr;
    }
    SDL_DestroyWindow(g.pickerWindow);
    g.pickerWindow = nullptr;

    // Ana pencere çalışırken ImGui'yi null mevcut context'te bırakma.
    if (g.mainImGui) {
        ImGui::SetCurrentContext(g.mainImGui);
    }

    // Önceki GL context'i geri yükle (genelde ana pencere).
    if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
}

static bool initSDLVideo() {
    // WM_CLASS / Wayland app_id: görev çubuğu/dock gruplaması için ana uygulamayla eşleştir.
    // Bu hint'ler pencere oluşturulmadan önce, güvenli tarafta kalmak için SDL_Init öncesi set edilir.
    const char* wmclass = std::getenv("AURIVO_VIS_WMCLASS");
    if (!wmclass || !*wmclass) wmclass = "aurivo-media-player";
    const char* desktopEntry = std::getenv("AURIVO_VIS_DESKTOP_ENTRY");
    // Wayland app_id tercihen desktop dosyasının kimliğiyle aynı olmalı;
    // aksi halde başlık çubuğunda uygulama yerine varsayılan compositor ikonu görünebilir.
    if (!desktopEntry || !*desktopEntry) desktopEntry = "com.aurivo.mediaplayer";
    SDL_SetHint("SDL_VIDEO_X11_WMCLASS", wmclass);
    SDL_SetHint("SDL_VIDEO_X11_WMCLASS_NAME", wmclass);
    // Wayland tarafında app_id desktop dosyası kimliğiyle birebir eşleşmeli.
    SDL_SetHint("SDL_VIDEO_WAYLAND_WMCLASS", desktopEntry);
    SDL_SetHint("SDL_APP_ID", desktopEntry);

    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS | SDL_INIT_TIMER) != 0) {
        std::cerr << "SDL_Init failed: " << SDL_GetError() << std::endl;
        return false;
    }

    const char* driver = SDL_GetCurrentVideoDriver();
    std::cout << "Video driver: " << (driver ? driver : "unknown") << std::endl;
    return true;
}

static bool initMainWindowAndGL() {
    // Modern OpenGL core profilini tercih et.
    // Yedek plan: 3.3 core dene, sonra 3.0 core.
    auto tryCreateContext = [&](int major, int minor) -> bool {
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, major);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, minor);
#ifdef _WIN32
        // projectM Windows'ta legacy GL yolları kullanır; uyumluluk eksik sembolleri önler.
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_COMPATIBILITY);
#else
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
#endif

        if (g.gl) {
            SDL_GL_DeleteContext(g.gl);
            g.gl = nullptr;
        }
        g.gl = SDL_GL_CreateContext(g.window);
        if (!g.gl) {
            std::cout << "BOOT GL context create failed: " << SDL_GetError() << std::endl;
            return false;
        }
        std::cout << "BOOT GL context ok (" << major << "." << minor << ")" << std::endl;
        return true;
    };
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    // Mantıklı bir başlangıç boyutu seç (bazı WM'ler WM_CLASS'a göre geri yükle/maximize etmeye çalışabilir).
    int desiredW = g.mainPrefW;
    int desiredH = g.mainPrefH;
    SDL_Rect usable{0, 0, 0, 0};
    if (SDL_GetDisplayUsableBounds(0, &usable) == 0 && usable.w > 0 && usable.h > 0) {
        desiredW = std::clamp(desiredW, 640, (int)(usable.w * 0.95f));
        desiredH = std::clamp(desiredH, 480, (int)(usable.h * 0.95f));
    }

    Uint32 mainFlags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI;

	    g.window = SDL_CreateWindow(
	        L7Raw(
	            "Aurivo Visualizer",
            "Aurivo G\u00F6rselle\u015Ftirici",
	            "Ù…Ø±Ø¦ÙŠØ§Øª Ø£ÙˆØ±ÙŠÙÙˆ",
	            "Visualiseur Aurivo",
	            "Aurivo-Visualizer",
	            "Visualizador Aurivo",
	            "Aurivo à¤µà¤¿à¤œà¤¼à¥à¤…à¤²à¤¾à¤‡à¤œà¤¼à¤°"
	        ),
	        SDL_WINDOWPOS_CENTERED,
	        SDL_WINDOWPOS_CENTERED,
	        desiredW,
        desiredH,
        mainFlags
    );
    if (!g.window) {
        std::cerr << "Failed to create window: " << SDL_GetError() << std::endl;
        return false;
    }

    // Başlangıç boyutunu zorla (bazı masaüstlerinde "maksimize açılır"ı önler).
    SDL_RestoreWindow(g.window);
    SDL_SetWindowSize(g.window, desiredW, desiredH);
    SDL_SetWindowPosition(g.window, SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED);

    // Pencere gösterildikten sonra kısa süre tercih edilen boyutu zorla, çünkü bazı WM'ler
    // oluşturma sonrası kendi maximize/geri yükle işlemlerini uygular.
    g.mainEnforceUntilMs = nowMs() + 1500ULL;

    // Pencere ikonunu env'den ayarla (ana süreç tarafından geçirilir)
    setSdlWindowIconFromEnv(g.window);

    // Önce GL 3.3 core dene.
    if (!tryCreateContext(3, 3)) {
        std::cerr << "GL 3.3 core context failed: " << SDL_GetError() << " (falling back to 3.0)" << std::endl;
        if (!tryCreateContext(3, 0)) {
            std::cerr << "GL 3.0 core context failed: " << SDL_GetError() << std::endl;
            return false;
        }
    }

    // Yeni oluşturulan context'in GL yükleyici başlatmadan önce mevcut olduğundan emin ol.
    if (SDL_GL_MakeCurrent(g.window, g.gl) != 0) {
        std::cerr << "SDL_GL_MakeCurrent failed: " << SDL_GetError() << std::endl;
        return false;
    }

    std::cout << "BOOT swap interval set" << std::endl;
    SDL_GL_SetSwapInterval(1);

    std::cout << "BOOT GL load functions..." << std::endl;
    if (!AurivoGL_LoadFunctions()) {
#ifdef _WIN32
    glewExperimental = GL_TRUE;
    GLenum glewErr = glewInit();
    if (glewErr != GLEW_OK) {
        std::cerr << "glewInit failed: " << (const char*)glewGetErrorString(glewErr) << std::endl;
        return false;
    }
    std::cout << "BOOT glewInit ok" << std::endl;
#endif
        std::cerr << "OpenGL function loading failed (SDL_GL_GetProcAddress)." << std::endl;
        return false;
    }

    // projectM Windows'ta uzantı yüklemek için GLEW'e dayanabilir.
    // Özel yükleyici başarılı olsa bile null GL girişleri olmaması için GLEW'i başlat.
#ifdef _WIN32
    glewExperimental = GL_TRUE;
    GLenum glewErr = glewInit();
    if (glewErr != GLEW_OK) {
        std::cerr << "glewInit failed: " << (const char*)glewGetErrorString(glewErr) << std::endl;
        return false;
    }
    std::cout << "BOOT glewInit ok" << std::endl;
#endif

    updateDrawable();
    return true;
}

static bool looksMojibake(const char* s) {
    if (!s || !*s) return false;
    return std::strstr(s, "Ã") || std::strstr(s, "Â") || std::strstr(s, "Ä") ||
           std::strstr(s, "Å") || std::strstr(s, "Ø") || std::strstr(s, "Ù") ||
           std::strstr(s, "Ð") || std::strstr(s, "Ñ") || std::strstr(s, "â") ||
           std::strstr(s, "à¤");
}

static std::string fixMojibakeUtf8(const char* s) {
    if (!s) return "";
    const size_t len = std::strlen(s);
    std::vector<uint8_t> latinBytes;
    latinBytes.reserve(len);

    // UTF-8 -> kod noktaları çöz, sonra Latin-1 baytlarına eşle.
    size_t i = 0;
    while (i < len) {
        uint32_t cp = 0;
        if (!utf8DecodeOne(s, len, i, cp)) break;
        if (cp <= 0xFF) latinBytes.push_back((uint8_t)cp);
        else latinBytes.push_back((uint8_t)'?');
    }

    // Bu baytları UTF-8 olarak çözerek hedef metni geri kazan.
    std::string out;
    out.reserve(latinBytes.size());
    const char* b = reinterpret_cast<const char*>(latinBytes.data());
    const size_t blen = latinBytes.size();
    size_t j = 0;
    while (j < blen) {
        uint32_t cp = 0;
        if (!utf8DecodeOne(b, blen, j, cp)) break;
        utf8Append(out, cp);
    }
    return out;
}

static const char* fixMojibakeCached(const char* s) {
    if (!looksMojibake(s)) return s;
    static std::unordered_map<std::string, std::string> cache;
    const std::string key = s ? std::string(s) : std::string();
    auto it = cache.find(key);
    if (it != cache.end()) return it->second.c_str();
    std::string fixed = fixMojibakeUtf8(s);
    auto inserted = cache.emplace(key, std::move(fixed));
    return inserted.first->second.c_str();
}

static bool initProjectM() {
    std::cout << "[projectM] create..." << std::endl;
    g.pm = projectm_create();
    if (!g.pm) {
        std::cerr << "projectm_create failed" << std::endl;
        return false;
    }

    std::cout << "[projectM] create ok" << std::endl;
    // projectM v4 C-API provides this query; older/packaged variants might not.
    // Fall back to a safe default buffer size (512 samples/channel) if unavailable.
#if defined(PROJECTM_VERSION_MAJOR) && (PROJECTM_VERSION_MAJOR >= 4)
    g.pmMaxSamplesPerChannel = projectm_pcm_get_max_samples();
#else
    g.pmMaxSamplesPerChannel = 512;
#endif
    std::cout << "[Audio] projectM max samples/channel: " << g.pmMaxSamplesPerChannel << std::endl;

    applyQuality(g.quality);
    applyFpsMode(g.fpsMode);
    applyTextureQuality(g.textureQuality);
    return true;
}

static bool initImGui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();

    g.mainImGui = ImGui::GetCurrentContext();

    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();
    g.baseStyle = ImGui::GetStyle();
    applyClementineishStyle();

    ImGui_ImplSDL2_InitForOpenGL(g.window, g.gl);

    // >=3.3 başarıyla oluşturulduysa GLSL 330 kullan; aksi halde GLSL 130 (GL 3.0 için).
    int major = 0, minor = 0;
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, &major);
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, &minor);
    const char* glsl = (major > 3 || (major == 3 && minor >= 3)) ? "#version 330 core" : "#version 130";
    ImGui_ImplOpenGL3_Init(glsl);

    auto fp = findInterFontPath();
    if (!fp) {
        // Windows'ta tam glif kapsamı sağlamak için sistem UI fontlarına yedekle.
        auto sys = findWindowsUiFontPath();
        if (sys) {
            std::cout << "[Font] Inter-Regular.ttf not found; using system font: " << *sys << std::endl;
            g.fontPath = *sys;
        } else {
            std::cerr << "Inter-Regular.ttf bulunamad\u0131. Beklenen yol: assets/fonts/Inter-Regular.ttf" << std::endl;
            g.fontPath = "";
            io.Fonts->AddFontDefault();
        }
    } else {
        g.fontPath = *fp;
    }

    updateDrawable();
    g.lastDpiScale = 0.0f;
    if (!g.fontPath.empty()) {
        rescaleImGui(g.dpiScale);
    }

    return true;
}

static void shutdownAll() {
    std::cout << "[Shutdown] begin" << std::endl;
    if (g.pm) {
        projectm_destroy(g.pm);
        g.pm = nullptr;
    }

    destroyPickerWindow();

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplSDL2_Shutdown();
    ImGui::DestroyContext();

    if (g.gl) {
        SDL_GL_DeleteContext(g.gl);
        g.gl = nullptr;
    }
    if (g.window) {
        SDL_DestroyWindow(g.window);
        g.window = nullptr;
    }

    SDL_Quit();
    std::cout << "[Shutdown] done" << std::endl;
}

static Uint32 getEventWindowId(const SDL_Event& e) {
    switch (e.type) {
        case SDL_WINDOWEVENT: return e.window.windowID;
        case SDL_MOUSEMOTION: return e.motion.windowID;
        case SDL_MOUSEBUTTONDOWN:
        case SDL_MOUSEBUTTONUP: return e.button.windowID;
        case SDL_MOUSEWHEEL: return e.wheel.windowID;
        case SDL_TEXTINPUT: return e.text.windowID;
        case SDL_TEXTEDITING: return e.edit.windowID;
        case SDL_KEYDOWN:
        case SDL_KEYUP: return e.key.windowID;
        default: return 0;
    }
}

int main(int argc, char* argv[]) {
    ensureDllSearchPathFromExeDir();
    srand((unsigned)time(nullptr));
#ifdef _WIN32
    setWindowsAppUserModelId();
#endif

    std::string presetsRoot = getPresetsPath(argc, argv);
    std::cout << "Presets root: " << presetsRoot << std::endl;

    if (!findPresetsRecursive(presetsRoot, g.presets)) {
        std::cerr << "No presets found." << std::endl;
        return 1;
    }

    // Preset taraması sonrası seçici ayarlarını yükle; böylece kaydedilen yolları indekslere eşleyebiliriz.
    loadPresetPickerSettings();

    // Üst uygulama varsayılan boyut sağlıyorsa onu tercih et (her seferinde bu boyutta aç).
    if (const char* w = std::getenv("AURIVO_VIS_MAIN_W")) {
        try {
            int v = std::stoi(std::string(w));
            if (v >= 640 && v <= 8192) g.mainPrefW = v;
        } catch (...) {
        }
    }
    if (const char* h = std::getenv("AURIVO_VIS_MAIN_H")) {
        try {
            int v = std::stoi(std::string(h));
            if (v >= 480 && v <= 8192) g.mainPrefH = v;
        } catch (...) {
        }
    }

    if (!initSDLVideo()) return 1;
    std::cout << "BOOT initSDLVideo ok" << std::endl;
    if (!initMainWindowAndGL()) {
        shutdownAll();
        return 1;
    }
    std::cout << "BOOT initMainWindowAndGL ok" << std::endl;
    std::cout << "BOOT initProjectM enter" << std::endl;
    if (!initProjectM()) {
        shutdownAll();
        return 1;
    }
    std::cout << "BOOT initProjectM ok" << std::endl;
    if (!initImGui()) {
        shutdownAll();
        return 1;
    }

    std::cout << "BOOT initImGui ok" << std::endl;
    // Hata ayıklama overlay/loglama (isteğe bağlı)
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--debug") {
            g.debugOverlay = true;
            break;
        }
    }
    if (const char* dbg = std::getenv("AURIVO_VIS_DEBUG")) {
        if (std::string(dbg) == "1") g.debugOverlay = true;
    }

    // Ses giriş politikası: SADECE stdin üzerinden uygulama PCM'i. yakalama yok, yedek yok.
    if (!initStdinNonBlocking()) {
        std::cerr << "[Audio] stdin non-blocking setup failed; PCM feed may stutter." << std::endl;
    } else {
#ifdef _WIN32
        if (!g.stdinIsPipe) {
            std::cout << "[Audio] stdin is not a pipe; PCM input disabled (no capture)" << std::endl;
        } else {
            std::cout << "[Audio] ✓ projectM input = aurivo_pcm (stdin only, NO mic/capture)" << std::endl;
        }
#else
        std::cout << "[Audio] ✓ projectM input = aurivo_pcm (stdin only, NO mic/capture)" << std::endl;
#endif
    }

    // İlk preset yüklenmeden önce ana GL context'in mevcut olduğundan emin ol.
    SDL_GL_MakeCurrent(g.window, g.gl);
    g.currentPreset = std::clamp(g.currentPreset, 0, (int)g.presets.size() - 1);
    applyPresetByIndexNow(g.currentPreset);
    scheduleNextAutoSwitch();

    SDL_Event e;
    while (g.running) {
        uint64_t frameStartMs = nowMs();

        // Kareyi her zaman ana GL context'te başlat.
        SDL_GL_MakeCurrent(g.window, g.gl);

        // Gelen PCM'i (bloklamadan) al ve projectM'e besle.
        pumpPcmFromStdin();
        feedSilenceIfStale(frameStartMs);
        while (SDL_PollEvent(&e)) {
            // Olayları, ait oldukları SDL penceresine göre doğru ImGui context'ine yönlendir.
            Uint32 wid = getEventWindowId(e);
            if (g.pickerWindow && wid != 0 && wid == SDL_GetWindowID(g.pickerWindow) && g.pickerImGui) {
                ImGui::SetCurrentContext(g.pickerImGui);
                ImGui_ImplSDL2_ProcessEvent(&e);
                ImGui::SetCurrentContext(g.mainImGui);
            } else {
                ImGui::SetCurrentContext(g.mainImGui);
                ImGui_ImplSDL2_ProcessEvent(&e);
            }

            if (e.type == SDL_QUIT) {
                std::cout << "[Shutdown] SDL_QUIT received" << std::endl;
                g.running = false;
            } else if (e.type == SDL_WINDOWEVENT && e.window.event == SDL_WINDOWEVENT_CLOSE) {
                // Seçici pencere ise kapat; değilse çık.
                if (g.pickerWindow && e.window.windowID == SDL_GetWindowID(g.pickerWindow)) {
                    g.showPresetPicker = false;
                } else {
                    std::cout << "[Shutdown] main window close requested" << std::endl;
                    g.running = false;
                }
            } else if (e.type == SDL_MOUSEBUTTONDOWN) {
                // Ana görselleştiricide çift tık tam ekranı aç/kapatır.
                if (g.window && e.button.windowID == SDL_GetWindowID(g.window) && e.button.button == SDL_BUTTON_LEFT && e.button.clicks == 2) {
                    ImGui::SetCurrentContext(g.mainImGui);
                    ImGuiIO& io = ImGui::GetIO();
                    if (!io.WantCaptureMouse) {
                        g.fullscreen = !g.fullscreen;
                        SDL_SetWindowFullscreen(g.window, g.fullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);
                    }
                }
            } else if (e.type == SDL_WINDOWEVENT) {
                // Ana pencerenin kullanıcı yeniden boyutlandırmasını takip et (sadece maximize/tam ekran değilken kalıcı))
                if (g.window && e.window.windowID == SDL_GetWindowID(g.window)) {
                    if (e.window.event == SDL_WINDOWEVENT_SIZE_CHANGED || e.window.event == SDL_WINDOWEVENT_RESIZED) {
                        const Uint32 flags = SDL_GetWindowFlags(g.window);
                        const bool isFullscreen = (flags & SDL_WINDOW_FULLSCREEN_DESKTOP) || (flags & SDL_WINDOW_FULLSCREEN);
                        const bool isMaximized = (flags & SDL_WINDOW_MAXIMIZED) != 0;
                        if (!isFullscreen && !isMaximized) {
                            g.mainPrefW = std::clamp((int)e.window.data1, 640, 8192);
                            g.mainPrefH = std::clamp((int)e.window.data2, 480, 8192);
                        }
                    }
                }
            }
        }

        enforceMainWindowInitialSize();

        // Seçici ayarlarını kapanışta kalıcı yap (Tamam / ESC / pencere kapat düğmesi).
        static bool wasPickerOpen = false;
        if (wasPickerOpen && !g.showPresetPicker) {
            savePresetPickerSettings();
        }
        wasPickerOpen = g.showPresetPicker;

        // Duruma göre seçici penceresini oluştur/yok et.
        if (g.showPresetPicker) {
            if (!ensurePickerWindow()) {
                std::cerr << "Failed to open preset picker window." << std::endl;
                g.showPresetPicker = false;
            }
        } else {
            if (g.pickerWindow) destroyPickerWindow();
        }

        updateDrawable();

        // ImGui için HiDPI: fb/win ölçek değiştiğinde stili ölçekle + fontları yeniden yükle.
        if (!g.fontPath.empty() && std::fabs(g.dpiScale - g.lastDpiScale) > 0.001f) {
            rescaleImGui(g.dpiScale);
            g.lastDpiScale = g.dpiScale;
        }

        pumpAutoPresetSwitch();

        // Bekleyen preset değişikliklerini ana GL context'te güvenle uygula.
        flushPendingPresetApply();

        // Başlat ImGui frame
        ImGui::SetCurrentContext(g.mainImGui);
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplSDL2_NewFrame();
        ImGui::NewFrame();

        // Klavye kısayolları (ImGui capture'ı dikkate al)
        ImGuiIO& io = ImGui::GetIO();
        if (!io.WantCaptureKeyboard) {
            const Uint8* keystate = SDL_GetKeyboardState(nullptr);
            if (keystate[SDL_SCANCODE_ESCAPE]) {
                // Seçici açıksa kapat; değilse çık.
                if (g.showPresetPicker) g.showPresetPicker = false;
                else g.running = false;
            }
            // Tuş basımında tam ekranı aç/kapat (kenar tetiklemeli)
            static bool lastF = false;
            bool curF = keystate[SDL_SCANCODE_F] != 0;
            if (curF && !lastF) {
                g.fullscreen = !g.fullscreen;
                SDL_SetWindowFullscreen(g.window, g.fullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);
            }
            lastF = curF;
        }

        drawContextMenuHost();

        // Ses durumu için hata ayıklama overlay'i (capture yok; sadece stdin)
        if (g.debugOverlay) {
            ImGui::SetNextWindowBgAlpha(0.35f);
            ImGui::SetNextWindowPos(ImVec2(12.0f, 12.0f), ImGuiCond_Always);
            ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                     ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_AlwaysAutoResize |
                                     ImGuiWindowFlags_NoNav;
            ImGui::Begin("##audio_status", nullptr, flags);
            if (g.audioStale) {
                ImGui::TextUnformatted("Audio: paused/no PCM (silence)\nInput: app PCM via stdin (no capture)");
            } else {
                ImGui::TextUnformatted("Audio: playing (app PCM)\nInput: app PCM via stdin (no capture)");
            }
            ImGui::End();
        }

        // projectM'i render et
        glViewport(0, 0, g.fbW, g.fbH);
        glClearColor(0, 0, 0, 1);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        ViewportRect vp = computeAspectViewport(g.fbW, g.fbH, g.aspect);
        glViewport(vp.x, vp.y, vp.w, vp.h);
        if (g.pm) {
            projectm_set_window_size(g.pm, vp.w, vp.h);
            projectm_opengl_render_frame(g.pm);
        }

        // ImGui overlay'ini render et
        glViewport(0, 0, g.fbW, g.fbH);
        glDisable(GL_DEPTH_TEST);
        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        SDL_GL_SwapWindow(g.window);

        // Seçici pencereyi kendi GL context'i + ImGui context'i içinde render et.
        if (g.pickerWindow && g.pickerGL && g.pickerImGui) {
            SDL_GL_MakeCurrent(g.pickerWindow, g.pickerGL);
            ImGui::SetCurrentContext(g.pickerImGui);

            updateDrawablePicker();
            if (!g.fontPath.empty() && std::fabs(g.pickerDpiScale - g.pickerLastDpiScale) > 0.001f) {
                rescaleImGui(g.pickerDpiScale);
                g.pickerLastDpiScale = g.pickerDpiScale;
            }

            ImGui_ImplOpenGL3_NewFrame();
            ImGui_ImplSDL2_NewFrame();
            ImGui::NewFrame();

            drawPresetPicker();

            glViewport(0, 0, g.pickerFbW, g.pickerFbH);
            glClearColor(0, 0, 0, 1);
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
            ImGui::Render();
            ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
            SDL_GL_SwapWindow(g.pickerWindow);

            // Ana context'i geri yükle
            ImGui::SetCurrentContext(g.mainImGui);
            SDL_GL_MakeCurrent(g.window, g.gl);
        }

        // Seçilen hedef FPS'e göre basit kare limiti.
        // PCM yokken (pause/stop/IPC kopuk), FPS'i düşürerek CPU'yu azalt.
        int effectiveFps = g.targetFps;
        if (g.audioStale && !g.showPresetPicker) {
            effectiveFps = std::min(effectiveFps, 30);
        }
        if (effectiveFps > 0) {
            uint64_t frameMs = nowMs() - frameStartMs;
            uint64_t targetMs = (uint64_t)std::max(1, 1000 / effectiveFps);
            if (frameMs < targetMs) {
                SDL_Delay((Uint32)(targetMs - frameMs));
            }
        }
    }

    savePresetPickerSettings();
    shutdownAll();
    return 0;
}
