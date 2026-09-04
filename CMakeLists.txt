cmake_minimum_required(VERSION 3.20)
project(ArDaliBrowser VERSION 6.1.2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 6.4 REQUIRED COMPONENTS
  Core
  Gui
  Widgets
  WebEngineWidgets
  Network
  Svg
  Concurrent
  DBus
)
find_package(OpenSSL REQUIRED)
find_program(NODE_EXECUTABLE node REQUIRED)

include_directories(
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/core
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/desktop_tabs
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/newtab
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/audio
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/pulse
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/blocker
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/passwords
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/eq
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/settings
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/session
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/downloads
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/native/translate
)

# -------------------------------------------------------------
# DALI Lang Web Audio DSP & Policy generation
# -------------------------------------------------------------
set(DALI_WEB_OUTPUT_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/web-output-audiophile.dl)
set(DALI_WEB_OUTPUT_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-output-audiophile.generated.js)
set(DALI_WEB_EQ32_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/web-equalizer-32.dl)
set(DALI_WEB_EQ32_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-equalizer-32.generated.js)
set(DALI_WEB_COMPRESSOR_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/web-dynamic-compressor.dl)
set(DALI_WEB_COMPRESSOR_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-dynamic-compressor.generated.js)
set(DALI_WEB_LIMITER_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/web-limiter.dl)
set(DALI_WEB_LIMITER_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-limiter.generated.js)
set(DALI_WEB_BASS_ENHANCER_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/web-bass-enhancer.dl)
set(DALI_WEB_BASS_ENHANCER_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-bass-enhancer.generated.js)
set(DALI_WEB_AUTO_GAIN_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/web-auto-gain.dl)
set(DALI_WEB_AUTO_GAIN_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-auto-gain.generated.js)

add_custom_command(
  OUTPUT ${DALI_WEB_OUTPUT_MODULE} ${DALI_WEB_EQ32_MODULE} ${DALI_WEB_COMPRESSOR_MODULE} ${DALI_WEB_LIMITER_MODULE} ${DALI_WEB_BASS_ENHANCER_MODULE} ${DALI_WEB_AUTO_GAIN_MODULE}
  COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/dali
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js ${DALI_WEB_OUTPUT_SOURCE} ${DALI_WEB_OUTPUT_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js ${DALI_WEB_EQ32_SOURCE} ${DALI_WEB_EQ32_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js ${DALI_WEB_COMPRESSOR_SOURCE} ${DALI_WEB_COMPRESSOR_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js ${DALI_WEB_LIMITER_SOURCE} ${DALI_WEB_LIMITER_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js ${DALI_WEB_BASS_ENHANCER_SOURCE} ${DALI_WEB_BASS_ENHANCER_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js ${DALI_WEB_AUTO_GAIN_SOURCE} ${DALI_WEB_AUTO_GAIN_MODULE}
  DEPENDS
    ${DALI_WEB_OUTPUT_SOURCE}
    ${DALI_WEB_EQ32_SOURCE}
    ${DALI_WEB_COMPRESSOR_SOURCE}
    ${DALI_WEB_LIMITER_SOURCE}
    ${DALI_WEB_BASS_ENHANCER_SOURCE}
    ${DALI_WEB_AUTO_GAIN_SOURCE}
    ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/compile-dali-preset.js
    ${CMAKE_CURRENT_SOURCE_DIR}/dali-lang/src/index.js
    ${CMAKE_CURRENT_SOURCE_DIR}/dali-lang/src/compiler-web-audio.js
  VERBATIM
)
add_custom_target(ardali-web-output-dali DEPENDS ${DALI_WEB_OUTPUT_MODULE} ${DALI_WEB_EQ32_MODULE} ${DALI_WEB_COMPRESSOR_MODULE} ${DALI_WEB_LIMITER_MODULE} ${DALI_WEB_BASS_ENHANCER_MODULE} ${DALI_WEB_AUTO_GAIN_MODULE})

set(DALI_MANIFEST ${CMAKE_CURRENT_SOURCE_DIR}/browser/dali/browser.dali)
set(DALI_POLICY_GENERATOR ${CMAKE_CURRENT_SOURCE_DIR}/browser/scripts/generate-browser-policy.js)
set(DALI_POLICY_JSON ${CMAKE_CURRENT_BINARY_DIR}/browser_policy.json)

file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab)
file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/icons)
file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/browser/resources/adblock
     DESTINATION ${CMAKE_CURRENT_BINARY_DIR}/resources)

foreach(NTP_ASSET ardali-flow-blue.png google.ico duckduckgo.ico brave.ico bing.ico)
  configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/browser/assets/new-tab/${NTP_ASSET}
    ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/${NTP_ASSET}
    COPYONLY
  )
endforeach()
foreach(NTP_ICON appearance.svg search.svg grid.svg clock.svg cards.svg close.svg)
  configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/browser/assets/browser-icons/${NTP_ICON}
    ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/icons/${NTP_ICON}
    COPYONLY
  )
endforeach()
configure_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/browser/assets/icons/ardali-browser-128.png
  ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/ardali-browser.png
  COPYONLY
)

add_custom_command(
  OUTPUT ${DALI_POLICY_JSON}
  COMMAND ${NODE_EXECUTABLE} ${DALI_POLICY_GENERATOR} ${DALI_MANIFEST} ${DALI_POLICY_JSON}
  DEPENDS ${DALI_MANIFEST} ${DALI_POLICY_GENERATOR} ${CMAKE_CURRENT_SOURCE_DIR}/dali-lang/src/index.js
  VERBATIM
)
add_custom_target(ardali-browser-policy DEPENDS ${DALI_POLICY_JSON})

# -------------------------------------------------------------
# Source list
# -------------------------------------------------------------
set(CORE_SOURCES
  browser/native/core/browser_profile_service.cpp
  browser/native/core/browser_policy.cpp
  browser/native/core/security_utils.cpp
  browser/native/core/web_engine_hardware_acceleration.cpp
  browser/native/core/web_engine_memory_policy.cpp
  browser/native/core/browser_icons.cpp
)

set(NEWTAB_SOURCES
  browser/native/newtab/new_tab_html.cpp
  browser/native/newtab/new_tab_scheme.cpp
  browser/native/newtab/new_tab_background_store.cpp
)

set(DESKTOP_TABS_SOURCES
  browser/native/desktop_tabs/tab_manager.cpp
  browser/native/desktop_tabs/tab_performance_manager.cpp
  browser/native/desktop_tabs/system_memory_pressure_monitor.cpp
  browser/native/desktop_tabs/tab_throbber.cpp
  browser/native/desktop_tabs/tab_hover_card.cpp
  browser/native/desktop_tabs/tab_appearance.cpp
  browser/native/desktop_tabs/tab_layout_model.cpp
  browser/native/desktop_tabs/tab_strip_animator.cpp
  browser/native/desktop_tabs/tab_strip_widget.cpp
  browser/native/desktop_tabs/tab_search_popup.cpp
  browser/native/desktop_tabs/tab_group_model.cpp
  browser/native/desktop_tabs/tab_group_popup.cpp
  browser/native/desktop_tabs/tab_group_launcher_popup.cpp
  browser/native/desktop_tabs/tab_drag_session.cpp
  browser/native/desktop_tabs/tab_window_registry.cpp
  browser/native/desktop_tabs/detached_tab_window_controller.cpp
  browser/native/desktop_tabs/tab_drag_controller.cpp
  browser/native/desktop_tabs/platform/tab_drag_platform.cpp
)

set(SESSION_SOURCES
  browser/native/session/session_store.cpp
)

set(SETTINGS_SOURCES
  browser/native/settings/settings_page.cpp
)

set(AUDIO_SOURCES
  browser/native/audio/web_audio_effects_controller.cpp
  browser/native/audio/audio_effects_page.cpp
  browser/native/audio/audio_device_manager.cpp
  browser/native/audio/audio_capture_service.cpp
)

set(EQ_SOURCES
  browser/native/eq/eq_preset_repository.cpp
  browser/native/eq/eq_preset_page.cpp
)

set(BLOCKER_SOURCES
  browser/native/blocker/ardali_blocker_settings.cpp
  browser/native/blocker/ardali_blocker_engine.cpp
  browser/native/blocker/ardali_blocker_list_manager.cpp
  browser/native/blocker/ardali_blocker_request_interceptor.cpp
  browser/native/blocker/ardali_blocker_service.cpp
  browser/native/blocker/ardali_blocker_page.cpp
  browser/native/blocker/ardali_blocker_shield_button.cpp
)

set(PASSWORDS_SOURCES
  browser/native/passwords/credential_vault.cpp
  browser/native/passwords/credential_vault_manager.cpp
  browser/native/passwords/password_manager_page.cpp
)

set(PULSE_SOURCES
  browser/native/pulse/song_finder_settings.cpp
  browser/native/pulse/song_fingerprint.cpp
  browser/native/pulse/song_recognition_service.cpp
  browser/native/pulse/big_listen_button.cpp
  browser/native/pulse/song_finder_page.cpp
  browser/native/pulse/song_finder_settings_page.cpp
  browser/native/pulse/pulse_toolbar_button.cpp
)

set(DOWNLOADS_SOURCES
  browser/native/downloads/media_download_service.cpp
  browser/native/downloads/media_download_page.cpp
  browser/native/downloads/yt_dlp_update_manager.cpp
)

set(TRANSLATE_SOURCES
  browser/native/translate/translate_service.cpp
  browser/native/translate/translation_secret_store.cpp
  browser/native/translate/providers/libretranslate_provider.cpp
  browser/native/translate/providers/deepl_provider.cpp
  browser/native/translate/providers/google_cloud_provider.cpp
  browser/native/translate/providers/google_gtx_provider.cpp
  browser/native/translate/language_detector.cpp
  browser/native/translate/page_translator.cpp
  browser/native/translate/translate_bubble_popup.cpp
)

set(BROWSER_SOURCES
  ${CORE_SOURCES}
  ${NEWTAB_SOURCES}
  ${DESKTOP_TABS_SOURCES}
  ${SESSION_SOURCES}
  ${SETTINGS_SOURCES}
  ${AUDIO_SOURCES}
  ${EQ_SOURCES}
  ${BLOCKER_SOURCES}
  ${PASSWORDS_SOURCES}
  ${PULSE_SOURCES}
  ${DOWNLOADS_SOURCES}
  ${TRANSLATE_SOURCES}
  browser/native/browser_window.cpp
  browser/native/main.cpp
)

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  add_executable(ardali-webengine-process
    browser/native/core/web_engine_process_launcher.cpp
  )
  if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(ardali-webengine-process PRIVATE -Wall -Wextra)
  endif()
endif()

add_executable(ardali-browser ${BROWSER_SOURCES})

qt_add_resources(ardali-browser "app_icons"
  PREFIX "/"
  BASE browser
  FILES
    browser/assets/icons/ardali-browser-16.png
    browser/assets/icons/ardali-browser-32.png
    browser/assets/icons/ardali-browser-128.png
    browser/assets/icons/ardali-browser-256.png
)

qt_add_resources(ardali-browser "app_icons_alias"
  PREFIX "/icons"
  BASE browser/assets/icons
  FILES
    browser/assets/icons/ardali-browser-256.png
    browser/assets/icons/ardali-browser-128.png
)

qt_add_resources(ardali-browser "side_widget_icons"
  PREFIX "/side-widget-icons"
  BASE browser/assets/side-widget-icons
  FILES
    browser/assets/side-widget-icons/deliblock.svg
    browser/assets/side-widget-icons/web.svg
    browser/assets/side-widget-icons/files.svg
    browser/assets/side-widget-icons/quick-listen.svg
    browser/assets/side-widget-icons/pulse.svg
    browser/assets/side-widget-icons/video-tools.svg
    browser/assets/side-widget-icons/video.svg
    browser/assets/side-widget-icons/music.svg
    browser/assets/side-widget-icons/gallery.svg
    browser/assets/side-widget-icons/sound-effects.svg
    browser/assets/side-widget-icons/eq-presets.svg
    browser/assets/side-widget-icons/visualizer.svg
    browser/assets/side-widget-icons/settings-gear.svg
    browser/assets/side-widget-icons/about.svg
)

qt_add_resources(ardali-browser "browser_icons"
  PREFIX "/browser-icons"
  BASE browser/assets/browser-icons
  FILES
    browser/assets/browser-icons/startup.svg
    browser/assets/browser-icons/appearance.svg
    browser/assets/browser-icons/performance.svg
    browser/assets/browser-icons/content.svg
    browser/assets/browser-icons/privacy.svg
    browser/assets/browser-icons/search.svg
    browser/assets/browser-icons/password.svg
    browser/assets/browser-icons/bookmark.svg
    browser/assets/browser-icons/download.svg
    browser/assets/browser-icons/language.svg
    browser/assets/browser-icons/accessibility.svg
    browser/assets/browser-icons/settings.svg
    browser/assets/browser-icons/reset.svg
    browser/assets/browser-icons/info.svg
    browser/assets/browser-icons/new-tab.svg
    browser/assets/browser-icons/window.svg
    browser/assets/browser-icons/incognito.svg
    browser/assets/browser-icons/history.svg
    browser/assets/browser-icons/zoom.svg
    browser/assets/browser-icons/print.svg
    browser/assets/browser-icons/save.svg
    browser/assets/browser-icons/tools.svg
    browser/assets/browser-icons/help.svg
    browser/assets/browser-icons/exit.svg
    browser/assets/browser-icons/folder.svg
    browser/assets/browser-icons/trash.svg
    browser/assets/browser-icons/grid.svg
    browser/assets/browser-icons/clock.svg
    browser/assets/browser-icons/cards.svg
    browser/assets/browser-icons/video.svg
    browser/assets/browser-icons/music.svg
    browser/assets/browser-icons/play.svg
    browser/assets/browser-icons/clipboard.svg
    browser/assets/browser-icons/more.svg
    browser/assets/browser-icons/minimize.svg
    browser/assets/browser-icons/maximize.svg
    browser/assets/browser-icons/restore.svg
    browser/assets/browser-icons/close.svg
    browser/assets/browser-icons/audio.svg
    browser/assets/browser-icons/memory.svg
)

qt_add_resources(ardali-browser "search_engine_icons"
  PREFIX "/search-engines"
  BASE browser/assets/new-tab
  FILES
    browser/assets/new-tab/google.svg
    browser/assets/new-tab/duckduckgo.svg
    browser/assets/new-tab/brave.svg
    browser/assets/new-tab/bing.svg
    browser/assets/new-tab/google.ico
    browser/assets/new-tab/duckduckgo.ico
    browser/assets/new-tab/brave.ico
    browser/assets/new-tab/bing.ico
)

qt_add_resources(ardali-browser "translate_scripts"
  PREFIX "/translate"
  BASE browser/native/translate/resources
  FILES
    browser/native/translate/resources/translate_engine.js
)

target_link_libraries(ardali-browser PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Widgets
  Qt6::WebEngineWidgets
  Qt6::Network
  Qt6::Svg
  Qt6::Concurrent
  Qt6::DBus
  OpenSSL::Crypto
)

target_compile_definitions(ardali-browser PRIVATE
  ARDALI_BROWSER_POLICY_PATH="${DALI_POLICY_JSON}"
  ARDALI_BROWSER_VERSION="${PROJECT_VERSION}"
  ARDALI_WEB_OUTPUT_DALI_MODULE_RELATIVE_PATH="dali/web-output-audiophile.generated.js"
  ARDALI_WEB_EQ32_DALI_MODULE_RELATIVE_PATH="dali/web-equalizer-32.generated.js"
  ARDALI_WEB_COMPRESSOR_DALI_MODULE_RELATIVE_PATH="dali/web-dynamic-compressor.generated.js"
  ARDALI_WEB_LIMITER_DALI_MODULE_RELATIVE_PATH="dali/web-limiter.generated.js"
  ARDALI_WEB_BASS_ENHANCER_DALI_MODULE_RELATIVE_PATH="dali/web-bass-enhancer.generated.js"
  ARDALI_WEB_AUTO_GAIN_DALI_MODULE_RELATIVE_PATH="dali/web-auto-gain.generated.js"
)

add_custom_target(ardali-eq-presets-runtime ALL
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_CURRENT_SOURCE_DIR}/browser/resources/eq-presets
    ${CMAKE_CURRENT_BINARY_DIR}/eq-presets
  VERBATIM
)

add_dependencies(ardali-browser
  ardali-browser-policy
  ardali-web-output-dali
  ardali-eq-presets-runtime
)
if(TARGET ardali-webengine-process)
  add_dependencies(ardali-browser ardali-webengine-process)
endif()

set_target_properties(ardali-browser PROPERTIES
  OUTPUT_NAME "ardali-browser"
)

# -------------------------------------------------------------
# Unit Tests
# -------------------------------------------------------------
enable_testing()

add_executable(ardali-browser-policy-test
  browser/native/tests/browser_policy_test.cpp
  browser/native/core/browser_policy.cpp
)
target_link_libraries(ardali-browser-policy-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)
target_compile_definitions(ardali-browser-policy-test PRIVATE ARDALI_BROWSER_POLICY_PATH="${DALI_POLICY_JSON}")
add_dependencies(ardali-browser-policy-test ardali-browser-policy)
add_test(NAME browser-policy-test COMMAND ardali-browser-policy-test)

add_executable(ardali-browser-security-utils-test
  browser/native/tests/security_utils_test.cpp
  browser/native/core/security_utils.cpp
)
target_link_libraries(ardali-browser-security-utils-test PRIVATE Qt6::Core)
add_test(NAME browser-security-utils COMMAND ardali-browser-security-utils-test)

add_executable(ardali-browser-web-engine-hardware-acceleration-test
  browser/native/tests/web_engine_hardware_acceleration_test.cpp
  browser/native/core/web_engine_hardware_acceleration.cpp
)
target_link_libraries(ardali-browser-web-engine-hardware-acceleration-test PRIVATE Qt6::Core)
add_test(NAME browser-web-engine-hardware-acceleration COMMAND ardali-browser-web-engine-hardware-acceleration-test)

add_executable(ardali-browser-web-engine-memory-policy-test
  browser/native/tests/web_engine_memory_policy_test.cpp
  browser/native/core/web_engine_memory_policy.cpp
)
target_link_libraries(ardali-browser-web-engine-memory-policy-test PRIVATE Qt6::Core)
add_test(NAME browser-web-engine-memory-policy COMMAND ardali-browser-web-engine-memory-policy-test)

add_executable(ardali-browser-eq-preset-repository-test
  browser/native/tests/eq_preset_repository_test.cpp
  browser/native/eq/eq_preset_repository.cpp
)
target_link_libraries(ardali-browser-eq-preset-repository-test PRIVATE Qt6::Core)
add_dependencies(ardali-browser-eq-preset-repository-test ardali-eq-presets-runtime)
add_test(NAME browser-eq-preset-repository COMMAND ardali-browser-eq-preset-repository-test)

add_executable(ardali-browser-credential-vault-test
  browser/native/tests/credential_vault_test.cpp
  browser/native/passwords/credential_vault.cpp
  browser/native/passwords/credential_vault_manager.cpp
)
target_link_libraries(ardali-browser-credential-vault-test PRIVATE Qt6::Widgets OpenSSL::Crypto)
add_test(NAME browser-credential-vault-test COMMAND ardali-browser-credential-vault-test)

add_executable(ardali-browser-song-finder-test
  browser/native/tests/song_finder_test.cpp
  browser/native/pulse/song_finder_settings.cpp
  browser/native/audio/audio_device_manager.cpp
  browser/native/pulse/song_fingerprint.cpp
  browser/native/audio/audio_capture_service.cpp
  browser/native/pulse/song_recognition_service.cpp
  browser/native/core/security_utils.cpp
)
target_link_libraries(ardali-browser-song-finder-test PRIVATE Qt6::Core Qt6::Network Qt6::Concurrent)
add_test(NAME browser-song-finder COMMAND ardali-browser-song-finder-test)

add_executable(ardali-browser-media-download-service-test
  browser/native/tests/media_download_service_test.cpp
  browser/native/downloads/media_download_service.cpp
  browser/native/downloads/yt_dlp_update_manager.cpp
  browser/native/core/security_utils.cpp
)
target_link_libraries(ardali-browser-media-download-service-test PRIVATE Qt6::Core Qt6::Network)
add_test(NAME browser-media-download-service COMMAND ardali-browser-media-download-service-test)

add_executable(ardali-browser-desktop-tab-system-test
  browser/native/tests/desktop_tab_system_test.cpp
  browser/native/desktop_tabs/tab_appearance.cpp
  browser/native/desktop_tabs/tab_layout_model.cpp
  browser/native/desktop_tabs/tab_strip_animator.cpp
  browser/native/desktop_tabs/tab_strip_widget.cpp
  browser/native/desktop_tabs/tab_group_model.cpp
  browser/native/desktop_tabs/tab_drag_session.cpp
  browser/native/desktop_tabs/tab_window_registry.cpp
  browser/native/desktop_tabs/detached_tab_window_controller.cpp
  browser/native/desktop_tabs/tab_drag_controller.cpp
  browser/native/desktop_tabs/platform/tab_drag_platform.cpp
)
target_link_libraries(ardali-browser-desktop-tab-system-test PRIVATE Qt6::Widgets Qt6::Gui)
add_test(NAME browser-desktop-tab-system COMMAND ardali-browser-desktop-tab-system-test)

add_executable(ardali-browser-tab-drag-controller-test
  browser/native/tests/tab_drag_controller_test.cpp
  browser/native/desktop_tabs/tab_appearance.cpp
  browser/native/desktop_tabs/tab_layout_model.cpp
  browser/native/desktop_tabs/tab_strip_animator.cpp
  browser/native/desktop_tabs/tab_strip_widget.cpp
  browser/native/desktop_tabs/tab_group_model.cpp
  browser/native/desktop_tabs/tab_drag_session.cpp
  browser/native/desktop_tabs/tab_window_registry.cpp
  browser/native/desktop_tabs/detached_tab_window_controller.cpp
  browser/native/desktop_tabs/tab_drag_controller.cpp
  browser/native/desktop_tabs/platform/tab_drag_platform.cpp
)
target_link_libraries(ardali-browser-tab-drag-controller-test PRIVATE Qt6::Widgets Qt6::Gui)
add_test(NAME browser-tab-drag-controller COMMAND ardali-browser-tab-drag-controller-test)

add_executable(ardali-browser-critical-tab-drag-scenario-test
  browser/native/tests/critical_tab_drag_scenario_test.cpp
  browser/native/desktop_tabs/tab_appearance.cpp
  browser/native/desktop_tabs/tab_layout_model.cpp
  browser/native/desktop_tabs/tab_strip_animator.cpp
  browser/native/desktop_tabs/tab_strip_widget.cpp
  browser/native/desktop_tabs/tab_group_model.cpp
  browser/native/desktop_tabs/tab_drag_session.cpp
  browser/native/desktop_tabs/tab_window_registry.cpp
  browser/native/desktop_tabs/detached_tab_window_controller.cpp
  browser/native/desktop_tabs/tab_drag_controller.cpp
  browser/native/desktop_tabs/platform/tab_drag_platform.cpp
)
target_link_libraries(ardali-browser-critical-tab-drag-scenario-test PRIVATE Qt6::Widgets Qt6::Gui)
add_test(NAME browser-critical-tab-drag-scenario COMMAND ardali-browser-critical-tab-drag-scenario-test)

add_executable(ardali-browser-runtime-feature-integration-test
  browser/native/tests/runtime_feature_integration_test.cpp
  browser/native/audio/web_audio_effects_controller.cpp
  browser/native/blocker/ardali_blocker_service.cpp
  browser/native/blocker/ardali_blocker_engine.cpp
  browser/native/blocker/ardali_blocker_list_manager.cpp
  browser/native/blocker/ardali_blocker_request_interceptor.cpp
  browser/native/blocker/ardali_blocker_settings.cpp
  browser/native/pulse/song_recognition_service.cpp
  browser/native/pulse/song_finder_settings.cpp
  browser/native/audio/audio_capture_service.cpp
  browser/native/audio/audio_device_manager.cpp
  browser/native/pulse/song_fingerprint.cpp
  browser/native/newtab/new_tab_scheme.cpp
  browser/native/newtab/new_tab_html.cpp
  browser/native/core/security_utils.cpp
  browser/native/downloads/media_download_service.cpp
  browser/native/downloads/yt_dlp_update_manager.cpp
  browser/native/blocker/ardali_blocker_shield_button.cpp
)
target_link_libraries(ardali-browser-runtime-feature-integration-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets Qt6::Network Qt6::Concurrent)
target_compile_definitions(ardali-browser-runtime-feature-integration-test PRIVATE
  ARDALI_WEB_OUTPUT_DALI_MODULE_RELATIVE_PATH="dali/web-output-audiophile.generated.js"
  ARDALI_WEB_EQ32_DALI_MODULE_RELATIVE_PATH="dali/web-equalizer-32.generated.js"
  ARDALI_WEB_COMPRESSOR_DALI_MODULE_RELATIVE_PATH="dali/web-dynamic-compressor.generated.js"
  ARDALI_WEB_LIMITER_DALI_MODULE_RELATIVE_PATH="dali/web-limiter.generated.js"
  ARDALI_WEB_BASS_ENHANCER_DALI_MODULE_RELATIVE_PATH="dali/web-bass-enhancer.generated.js"
  ARDALI_WEB_AUTO_GAIN_DALI_MODULE_RELATIVE_PATH="dali/web-auto-gain.generated.js"
)
add_test(NAME browser-runtime-feature-integration COMMAND ardali-browser-runtime-feature-integration-test)
