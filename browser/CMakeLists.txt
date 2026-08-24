cmake_minimum_required(VERSION 3.21)
project(ArDaliBrowser VERSION 6.1.2 LANGUAGES CXX)

enable_testing()

include(GNUInstallDirs)

configure_file(
  resources/linux/ardali.desktop.in
  ${CMAKE_CURRENT_BINARY_DIR}/ardali.desktop
  @ONLY
)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_AUTOMOC ON)

include_directories(
  ${CMAKE_CURRENT_SOURCE_DIR}/native
  ${CMAKE_CURRENT_SOURCE_DIR}/native/core
  ${CMAKE_CURRENT_SOURCE_DIR}/native/tabs
  ${CMAKE_CURRENT_SOURCE_DIR}/native/newtab
  ${CMAKE_CURRENT_SOURCE_DIR}/native/audio
  ${CMAKE_CURRENT_SOURCE_DIR}/native/pulse
  ${CMAKE_CURRENT_SOURCE_DIR}/native/blocker
  ${CMAKE_CURRENT_SOURCE_DIR}/native/passwords
  ${CMAKE_CURRENT_SOURCE_DIR}/native/eq
  ${CMAKE_CURRENT_SOURCE_DIR}/native/settings
  ${CMAKE_CURRENT_SOURCE_DIR}/native/sidebar
  ${CMAKE_CURRENT_SOURCE_DIR}/native/session
)

find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets WebEngineWidgets Network Svg Concurrent)
find_package(OpenSSL REQUIRED)
find_program(NODE_EXECUTABLE node REQUIRED)

set(DALI_WEB_OUTPUT_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/dali/web-output-audiophile.dl)
set(DALI_WEB_OUTPUT_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-output-audiophile.generated.js)
set(DALI_WEB_EQ32_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/dali/web-equalizer-32.dl)
set(DALI_WEB_EQ32_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-equalizer-32.generated.js)
set(DALI_WEB_COMPRESSOR_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/dali/web-dynamic-compressor.dl)
set(DALI_WEB_COMPRESSOR_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-dynamic-compressor.generated.js)
set(DALI_WEB_LIMITER_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/dali/web-limiter.dl)
set(DALI_WEB_LIMITER_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-limiter.generated.js)
set(DALI_WEB_BASS_ENHANCER_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/dali/web-bass-enhancer.dl)
set(DALI_WEB_BASS_ENHANCER_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-bass-enhancer.generated.js)
set(DALI_WEB_AUTO_GAIN_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/dali/web-auto-gain.dl)
set(DALI_WEB_AUTO_GAIN_MODULE ${CMAKE_CURRENT_BINARY_DIR}/dali/web-auto-gain.generated.js)
add_custom_command(
  OUTPUT ${DALI_WEB_OUTPUT_MODULE} ${DALI_WEB_EQ32_MODULE} ${DALI_WEB_COMPRESSOR_MODULE} ${DALI_WEB_LIMITER_MODULE} ${DALI_WEB_BASS_ENHANCER_MODULE} ${DALI_WEB_AUTO_GAIN_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js ${DALI_WEB_OUTPUT_SOURCE} ${DALI_WEB_OUTPUT_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js ${DALI_WEB_EQ32_SOURCE} ${DALI_WEB_EQ32_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js ${DALI_WEB_COMPRESSOR_SOURCE} ${DALI_WEB_COMPRESSOR_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js ${DALI_WEB_LIMITER_SOURCE} ${DALI_WEB_LIMITER_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js ${DALI_WEB_BASS_ENHANCER_SOURCE} ${DALI_WEB_BASS_ENHANCER_MODULE}
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js ${DALI_WEB_AUTO_GAIN_SOURCE} ${DALI_WEB_AUTO_GAIN_MODULE}
  DEPENDS
    ${DALI_WEB_OUTPUT_SOURCE}
    ${DALI_WEB_EQ32_SOURCE}
    ${DALI_WEB_COMPRESSOR_SOURCE}
    ${DALI_WEB_LIMITER_SOURCE}
    ${DALI_WEB_BASS_ENHANCER_SOURCE}
    ${DALI_WEB_AUTO_GAIN_SOURCE}
    ${CMAKE_CURRENT_SOURCE_DIR}/scripts/compile-dali-preset.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../dali-lang/src/index.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../dali-lang/src/compiler-web-audio.js
  VERBATIM
)
add_custom_target(ardali-web-output-dali DEPENDS ${DALI_WEB_OUTPUT_MODULE} ${DALI_WEB_EQ32_MODULE} ${DALI_WEB_COMPRESSOR_MODULE} ${DALI_WEB_LIMITER_MODULE} ${DALI_WEB_BASS_ENHANCER_MODULE} ${DALI_WEB_AUTO_GAIN_MODULE})

set(DALI_MANIFEST ${CMAKE_CURRENT_SOURCE_DIR}/dali/browser.dali)
set(DALI_POLICY_GENERATOR ${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-browser-policy.js)
set(DALI_POLICY_JSON ${CMAKE_CURRENT_BINARY_DIR}/browser_policy.json)
file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab)
file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/icons)
# AdBlock rulesets are runtime data (generated scripts, redirects and DNR JSON),
# not source-tree fallbacks.  Put one self-contained copy beside the development
# executable so clean machines never depend on a developer-specific absolute path.
file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/resources/adblock
     DESTINATION ${CMAKE_CURRENT_BINARY_DIR}/resources)
foreach(NTP_ASSET ardali-flow-blue.png google.ico duckduckgo.ico brave.ico bing.ico)
  configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/assets/new-tab/${NTP_ASSET}
    ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/${NTP_ASSET}
    COPYONLY
  )
endforeach()
foreach(NTP_ICON appearance.svg search.svg grid.svg clock.svg cards.svg close.svg)
  configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/assets/browser-icons/${NTP_ICON}
    ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/icons/${NTP_ICON}
    COPYONLY
  )
endforeach()
configure_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/assets/icons/ardali-browser-128.png
  ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/ardali-browser.png
  COPYONLY
)
add_custom_command(
  OUTPUT ${DALI_POLICY_JSON}
  COMMAND ${NODE_EXECUTABLE} ${DALI_POLICY_GENERATOR} ${DALI_MANIFEST} ${DALI_POLICY_JSON}
  DEPENDS ${DALI_MANIFEST} ${DALI_POLICY_GENERATOR} ${CMAKE_CURRENT_SOURCE_DIR}/../dali-lang/src/index.js
  VERBATIM
)
add_custom_target(ardali-browser-policy DEPENDS ${DALI_POLICY_JSON})

qt_add_executable(ardali-browser
  native/main.cpp
  native/core/browser_profile_service.cpp
  native/core/browser_policy.cpp
  native/core/browser_icons.cpp
  native/newtab/new_tab_html.cpp
  native/newtab/new_tab_scheme.cpp
  native/newtab/new_tab_background_store.cpp
  native/tabs/tab_manager.cpp
  native/tabs/tab_throbber.cpp
  native/tabs/tab_hover_card.cpp
  native/session/session_store.cpp
  native/settings/settings_page.cpp
  native/sidebar/side_widget.cpp
  native/sidebar/side_widget_config.cpp
  native/sidebar/side_widget_settings_panel.cpp
  native/audio/web_audio_effects_controller.cpp
  native/audio/audio_effects_page.cpp
  native/audio/audio_device_manager.cpp
  native/audio/audio_capture_service.cpp
  native/eq/eq_preset_repository.cpp
  native/eq/eq_preset_page.cpp
  native/blocker/ardali_blocker_settings.cpp
  native/blocker/ardali_blocker_engine.cpp
  native/blocker/ardali_blocker_list_manager.cpp
  native/blocker/ardali_blocker_request_interceptor.cpp
  native/blocker/ardali_blocker_service.cpp
  native/blocker/ardali_blocker_page.cpp
  native/blocker/ardali_blocker_shield_button.cpp
  native/passwords/credential_vault.cpp
  native/passwords/credential_vault_manager.cpp
  native/passwords/password_manager_page.cpp
  native/pulse/song_finder_settings.cpp
  native/pulse/song_fingerprint.cpp
  native/pulse/song_recognition_service.cpp
  native/pulse/big_listen_button.cpp
  native/pulse/song_finder_page.cpp
  native/pulse/song_finder_settings_page.cpp
  native/pulse/pulse_toolbar_button.cpp
)

qt_add_resources(ardali-browser "app_icons"
  PREFIX "/"
  FILES
    assets/icons/ardali-browser-256.png
)

qt_add_resources(ardali-browser "side_widget_icons"
  PREFIX "/side-widget-icons"
  BASE assets/side-widget-icons
  FILES
    assets/side-widget-icons/deliblock.svg
    assets/side-widget-icons/web.svg
    assets/side-widget-icons/files.svg
    assets/side-widget-icons/quick-listen.svg
    assets/side-widget-icons/pulse.svg
    assets/side-widget-icons/video-tools.svg
    assets/side-widget-icons/video.svg
    assets/side-widget-icons/music.svg
    assets/side-widget-icons/gallery.svg
    assets/side-widget-icons/sound-effects.svg
    assets/side-widget-icons/eq-presets.svg
    assets/side-widget-icons/visualizer.svg
    assets/side-widget-icons/settings-gear.svg
    assets/side-widget-icons/about.svg
)

qt_add_resources(ardali-browser "browser_icons"
  PREFIX "/browser-icons"
  BASE assets/browser-icons
  FILES
    assets/browser-icons/startup.svg
    assets/browser-icons/appearance.svg
    assets/browser-icons/content.svg
    assets/browser-icons/privacy.svg
    assets/browser-icons/search.svg
    assets/browser-icons/password.svg
    assets/browser-icons/bookmark.svg
    assets/browser-icons/download.svg
    assets/browser-icons/language.svg
    assets/browser-icons/accessibility.svg
    assets/browser-icons/settings.svg
    assets/browser-icons/reset.svg
    assets/browser-icons/info.svg
    assets/browser-icons/new-tab.svg
    assets/browser-icons/window.svg
    assets/browser-icons/incognito.svg
    assets/browser-icons/history.svg
    assets/browser-icons/zoom.svg
    assets/browser-icons/print.svg
    assets/browser-icons/save.svg
    assets/browser-icons/tools.svg
    assets/browser-icons/help.svg
    assets/browser-icons/exit.svg
    assets/browser-icons/folder.svg
    assets/browser-icons/trash.svg
    assets/browser-icons/grid.svg
    assets/browser-icons/clock.svg
    assets/browser-icons/cards.svg
    assets/browser-icons/minimize.svg
    assets/browser-icons/maximize.svg
    assets/browser-icons/restore.svg
    assets/browser-icons/close.svg
)

if(WIN32)
  enable_language(RC)
  target_sources(ardali-browser PRIVATE resources/windows/ardali-browser.rc)
  set_target_properties(ardali-browser PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

target_link_libraries(ardali-browser PRIVATE Qt6::Widgets Qt6::WebEngineWidgets Qt6::Network Qt6::Svg Qt6::Concurrent OpenSSL::Crypto)
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
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(ardali-browser PRIVATE -Wall -Wextra)
endif()
# Keep raw upstream JSON data as files. Development builds receive the same
# layout as installed builds, so the application never depends on a developer
# checkout or an absolute HOME path at runtime. Copy the shared directory once
# to avoid parallel targets racing while replacing the same destination.
add_custom_target(ardali-eq-presets-runtime ALL
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_CURRENT_SOURCE_DIR}/resources/eq-presets
    ${CMAKE_CURRENT_BINARY_DIR}/eq-presets
  VERBATIM
)
add_dependencies(ardali-browser
  ardali-browser-policy
  ardali-web-output-dali
  ardali-eq-presets-runtime
)

install(TARGETS ardali-browser RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES ${DALI_POLICY_JSON} DESTINATION ${CMAKE_INSTALL_BINDIR})
install(DIRECTORY resources/eq-presets/ DESTINATION ${CMAKE_INSTALL_DATADIR}/ardali-browser/eq-presets)
install(FILES
  ${DALI_WEB_OUTPUT_MODULE}
  ${DALI_WEB_OUTPUT_SOURCE}
  ${DALI_WEB_EQ32_MODULE}
  ${DALI_WEB_EQ32_SOURCE}
  ${DALI_WEB_COMPRESSOR_MODULE}
  ${DALI_WEB_COMPRESSOR_SOURCE}
  ${DALI_WEB_LIMITER_MODULE}
  ${DALI_WEB_LIMITER_SOURCE}
  ${DALI_WEB_BASS_ENHANCER_MODULE}
  ${DALI_WEB_BASS_ENHANCER_SOURCE}
  ${DALI_WEB_AUTO_GAIN_MODULE}
  ${DALI_WEB_AUTO_GAIN_SOURCE}
  DESTINATION ${CMAKE_INSTALL_BINDIR}/dali
)
install(FILES
  assets/new-tab/ardali-flow-blue.png
  assets/new-tab/google.ico
  assets/new-tab/duckduckgo.ico
  assets/new-tab/brave.ico
  assets/new-tab/bing.ico
  DESTINATION ${CMAKE_INSTALL_BINDIR}/assets/new-tab
)
install(FILES assets/icons/ardali-browser-128.png
  DESTINATION ${CMAKE_INSTALL_BINDIR}/assets/new-tab
  RENAME ardali-browser.png
)
install(DIRECTORY resources/adblock
  DESTINATION ${CMAKE_INSTALL_BINDIR}/resources
)
install(FILES
  assets/browser-icons/appearance.svg
  assets/browser-icons/search.svg
  assets/browser-icons/grid.svg
  assets/browser-icons/clock.svg
  assets/browser-icons/cards.svg
  assets/browser-icons/close.svg
  DESTINATION ${CMAKE_INSTALL_BINDIR}/assets/new-tab/icons
)

if(UNIX AND NOT APPLE)
  install(FILES ${CMAKE_CURRENT_BINARY_DIR}/ardali.desktop
    DESTINATION ${CMAKE_INSTALL_DATADIR}/applications
  )
  foreach(ICON_SIZE 16 24 32 48 64 128 256 512)
    install(FILES assets/icons/ardali-browser-${ICON_SIZE}.png
      DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/${ICON_SIZE}x${ICON_SIZE}/apps
      RENAME ardali.png
    )
  endforeach()
endif()

qt_add_executable(ardali-browser-state-test
  native/tests/state_transfer_test.cpp
)

target_link_libraries(ardali-browser-state-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)

qt_add_executable(ardali-browser-tab-manager-test
  native/tests/tab_manager_test.cpp
  native/tabs/tab_manager.cpp
  native/session/session_store.cpp
)

target_link_libraries(ardali-browser-tab-manager-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)

qt_add_executable(ardali-browser-policy-test
  native/tests/browser_policy_test.cpp
  native/core/browser_policy.cpp
)

target_link_libraries(ardali-browser-policy-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)
target_compile_definitions(ardali-browser-policy-test PRIVATE ARDALI_BROWSER_POLICY_PATH="${DALI_POLICY_JSON}")
add_dependencies(ardali-browser-policy-test ardali-browser-policy)

qt_add_executable(ardali-browser-internal-tab-test
  native/tests/internal_tab_test.cpp
  native/tabs/tab_manager.cpp
  native/session/session_store.cpp
)

target_link_libraries(ardali-browser-internal-tab-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)

qt_add_executable(ardali-browser-new-tab-background-test
  native/tests/new_tab_background_store_test.cpp
  native/newtab/new_tab_background_store.cpp
)
target_link_libraries(ardali-browser-new-tab-background-test PRIVATE Qt6::Widgets Qt6::Gui)
qt_add_executable(ardali-browser-web-audio-effects-controller-test
  native/tests/web_audio_effects_controller_test.cpp
  native/audio/web_audio_effects_controller.cpp
  native/audio/audio_effects_page.cpp
  native/eq/eq_preset_repository.cpp
  native/eq/eq_preset_page.cpp
)
target_link_libraries(ardali-browser-web-audio-effects-controller-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)
target_compile_definitions(ardali-browser-web-audio-effects-controller-test PRIVATE
  ARDALI_WEB_OUTPUT_DALI_MODULE_RELATIVE_PATH="dali/web-output-audiophile.generated.js"
  ARDALI_WEB_EQ32_DALI_MODULE_RELATIVE_PATH="dali/web-equalizer-32.generated.js"
  ARDALI_WEB_COMPRESSOR_DALI_MODULE_RELATIVE_PATH="dali/web-dynamic-compressor.generated.js"
  ARDALI_WEB_LIMITER_DALI_MODULE_RELATIVE_PATH="dali/web-limiter.generated.js"
  ARDALI_WEB_BASS_ENHANCER_DALI_MODULE_RELATIVE_PATH="dali/web-bass-enhancer.generated.js"
  ARDALI_WEB_AUTO_GAIN_DALI_MODULE_RELATIVE_PATH="dali/web-auto-gain.generated.js"
)
add_dependencies(ardali-browser-web-audio-effects-controller-test ardali-web-output-dali)
add_dependencies(ardali-browser-web-audio-effects-controller-test ardali-eq-presets-runtime)
qt_add_executable(ardali-browser-eq-preset-repository-test
  native/tests/eq_preset_repository_test.cpp
  native/eq/eq_preset_repository.cpp
)
target_link_libraries(ardali-browser-eq-preset-repository-test PRIVATE Qt6::Core)
add_dependencies(ardali-browser-eq-preset-repository-test ardali-eq-presets-runtime)
qt_add_executable(ardali-browser-tab-throbber-test
  native/tests/tab_throbber_test.cpp
  native/tabs/tab_throbber.cpp
)
target_link_libraries(ardali-browser-tab-throbber-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)
qt_add_executable(ardali-browser-side-widget-test
  native/tests/side_widget_test.cpp
  native/sidebar/side_widget.cpp
  native/sidebar/side_widget_config.cpp
  native/sidebar/side_widget_settings_panel.cpp
)
qt_add_resources(ardali-browser-side-widget-test "test_side_widget_icons"
  PREFIX "/side-widget-icons"
  BASE assets/side-widget-icons
  FILES
    assets/side-widget-icons/deliblock.svg
    assets/side-widget-icons/web.svg
    assets/side-widget-icons/files.svg
    assets/side-widget-icons/quick-listen.svg
    assets/side-widget-icons/pulse.svg
    assets/side-widget-icons/video-tools.svg
    assets/side-widget-icons/video.svg
    assets/side-widget-icons/music.svg
    assets/side-widget-icons/gallery.svg
    assets/side-widget-icons/sound-effects.svg
    assets/side-widget-icons/eq-presets.svg
    assets/side-widget-icons/visualizer.svg
    assets/side-widget-icons/settings-gear.svg
    assets/side-widget-icons/about.svg
)
target_link_libraries(ardali-browser-side-widget-test PRIVATE Qt6::Widgets Qt6::Svg)

qt_add_executable(ardali-browser-blocker-test
  native/tests/ardali_blocker_test.cpp
  native/blocker/ardali_blocker_settings.cpp
  native/blocker/ardali_blocker_engine.cpp
  native/blocker/ardali_blocker_list_manager.cpp
  native/blocker/ardali_blocker_request_interceptor.cpp
  native/blocker/ardali_blocker_service.cpp
  native/blocker/ardali_blocker_page.cpp
  native/blocker/ardali_blocker_shield_button.cpp
  native/newtab/new_tab_html.cpp
)
target_link_libraries(ardali-browser-blocker-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets Qt6::Network Qt6::Concurrent)
target_compile_definitions(ardali-browser-blocker-test PRIVATE ARDALI_BROWSER_VERSION="${PROJECT_VERSION}")

qt_add_executable(ardali-browser-credential-vault-test
  native/tests/credential_vault_test.cpp
  native/passwords/credential_vault.cpp
  native/passwords/credential_vault_manager.cpp
)
target_link_libraries(ardali-browser-credential-vault-test PRIVATE Qt6::Widgets OpenSSL::Crypto)
add_test(NAME browser-credential-vault-test COMMAND ardali-browser-credential-vault-test)

qt_add_executable(ardali-browser-password-manager-page-test
  native/tests/password_manager_page_test.cpp
  native/passwords/password_manager_page.cpp
  native/passwords/credential_vault.cpp
  native/passwords/credential_vault_manager.cpp
)
target_link_libraries(ardali-browser-password-manager-page-test PRIVATE Qt6::Widgets Qt6::Concurrent OpenSSL::Crypto)
add_test(NAME browser-password-manager-page-test COMMAND ardali-browser-password-manager-page-test)

qt_add_executable(ardali-browser-song-finder-test
  native/tests/song_finder_test.cpp
  native/pulse/song_finder_settings.cpp
  native/audio/audio_device_manager.cpp
  native/pulse/song_fingerprint.cpp
  native/audio/audio_capture_service.cpp
  native/pulse/song_recognition_service.cpp
)
target_link_libraries(ardali-browser-song-finder-test PRIVATE Qt6::Core Qt6::Network Qt6::Concurrent)
add_test(NAME browser-song-finder COMMAND ardali-browser-song-finder-test)

add_test(NAME browser-blocker COMMAND ardali-browser-blocker-test)
add_test(NAME browser-policy COMMAND ardali-browser-policy-test)
add_test(NAME browser-tab-throbber COMMAND ardali-browser-tab-throbber-test)
add_test(NAME browser-side-widget COMMAND ardali-browser-side-widget-test)

# The native tests use assert() for executable specifications. Release builds
# define NDEBUG by default, which would otherwise compile the checks (and some
# setup expressions) out entirely and make CTest results meaningless.
set(ARDALI_NATIVE_TEST_TARGETS
  ardali-browser-state-test
  ardali-browser-tab-manager-test
  ardali-browser-policy-test
  ardali-browser-internal-tab-test
  ardali-browser-new-tab-background-test
  ardali-browser-web-audio-effects-controller-test
  ardali-browser-eq-preset-repository-test
  ardali-browser-tab-throbber-test
  ardali-browser-side-widget-test
  ardali-browser-blocker-test
  ardali-browser-credential-vault-test
  ardali-browser-password-manager-page-test
  ardali-browser-song-finder-test
)
foreach(TEST_TARGET IN LISTS ARDALI_NATIVE_TEST_TARGETS)
  if(MSVC)
    target_compile_options(${TEST_TARGET} PRIVATE /UNDEBUG)
  else()
    target_compile_options(${TEST_TARGET} PRIVATE -UNDEBUG)
  endif()
endforeach()
add_test(NAME browser-state-transfer COMMAND ardali-browser-state-test)
add_test(NAME browser-tab-manager COMMAND ardali-browser-tab-manager-test)
add_test(NAME browser-internal-settings-tab COMMAND ardali-browser-internal-tab-test)
add_test(NAME browser-new-tab-background-store COMMAND ardali-browser-new-tab-background-test)
add_test(NAME browser-web-audio-effects-controller COMMAND ardali-browser-web-audio-effects-controller-test)
add_test(NAME browser-eq-preset-repository COMMAND ardali-browser-eq-preset-repository-test)
add_test(NAME browser-settings-runtime COMMAND ardali-browser)
add_test(NAME browser-new-tab-customization-runtime COMMAND ardali-browser)
add_test(NAME browser-new-tab-favicon-runtime COMMAND ardali-browser)
add_test(NAME browser-tab-hover-card-runtime COMMAND ardali-browser)
add_test(NAME browser-eq-preset-browser-runtime COMMAND ardali-browser)
add_test(NAME browser-tab-attach-stress COMMAND ardali-browser)
add_test(NAME browser-tab-attach-last-root-stress COMMAND ardali-browser)

set_tests_properties(browser-blocker browser-state-transfer browser-tab-manager browser-internal-settings-tab browser-tab-throbber browser-side-widget browser-web-audio-effects-controller browser-password-manager-page-test PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox"
)
set_tests_properties(browser-settings-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_SETTINGS_RUNTIME_TEST=1"
  TIMEOUT 20
  RUN_SERIAL TRUE
)
set_tests_properties(browser-new-tab-customization-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_NEW_TAB_CUSTOMIZATION_RUNTIME_TEST=1"
  TIMEOUT 20
  RUN_SERIAL TRUE
)
set_tests_properties(browser-new-tab-favicon-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_NEW_TAB_FAVICON_RUNTIME_TEST=1"
  TIMEOUT 20
  RUN_SERIAL TRUE
)
set_tests_properties(browser-tab-hover-card-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_TAB_HOVER_CARD_RUNTIME_TEST=1"
  TIMEOUT 20
  RUN_SERIAL TRUE
)
set_tests_properties(browser-eq-preset-browser-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_EQ_PRESET_BROWSER_RUNTIME_TEST=1"
  TIMEOUT 20
  RUN_SERIAL TRUE
)
set_tests_properties(browser-tab-attach-stress PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_TAB_ATTACH_RUNTIME_TEST=1;ARDALI_TAB_ATTACH_STRESS_TEST=1;ARDALI_TAB_ATTACH_STRESS_CYCLES=20"
  TIMEOUT 60
  RUN_SERIAL TRUE
)
set_tests_properties(browser-tab-attach-last-root-stress PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_TAB_ATTACH_RUNTIME_TEST=1;ARDALI_TAB_ATTACH_STRESS_TEST=1;ARDALI_TAB_ATTACH_STRESS_LAST_ROOT=1;ARDALI_TAB_ATTACH_STRESS_CYCLES=20"
  TIMEOUT 60
  RUN_SERIAL TRUE
)
