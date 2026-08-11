cmake_minimum_required(VERSION 3.21)
project(ArDaliBrowser VERSION 0.1.0 LANGUAGES CXX)

enable_testing()

include(GNUInstallDirs)

configure_file(
  resources/linux/ardali-browser.desktop.in
  ${CMAKE_CURRENT_BINARY_DIR}/ardali-browser.desktop
  @ONLY
)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Widgets WebEngineWidgets Network Svg)
find_program(NODE_EXECUTABLE node REQUIRED)

set(DALI_MANIFEST ${CMAKE_CURRENT_SOURCE_DIR}/dali/browser.dali)
set(DALI_POLICY_GENERATOR ${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-browser-policy.js)
set(DALI_POLICY_JSON ${CMAKE_CURRENT_BINARY_DIR}/browser_policy.json)
file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab)
file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/assets/new-tab/icons)
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
  native/browser_profile_service.cpp
  native/new_tab_html.cpp
  native/new_tab_scheme.cpp
  native/new_tab_background_store.cpp
  native/tab_manager.cpp
  native/browser_policy.cpp
  native/session_store.cpp
  native/settings_page.cpp
  native/browser_icons.cpp
)

qt_add_resources(ardali-browser "app_icons"
  PREFIX "/"
  FILES
    assets/icons/ardali-browser-256.png
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

target_link_libraries(ardali-browser PRIVATE Qt6::Widgets Qt6::WebEngineWidgets Qt6::Network Qt6::Svg)
target_compile_definitions(ardali-browser PRIVATE ARDALI_BROWSER_POLICY_PATH="${DALI_POLICY_JSON}" ARDALI_BROWSER_VERSION="${PROJECT_VERSION}")
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(ardali-browser PRIVATE -Wall -Wextra)
endif()
add_dependencies(ardali-browser ardali-browser-policy)

install(TARGETS ardali-browser RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES ${DALI_POLICY_JSON} DESTINATION ${CMAKE_INSTALL_BINDIR})
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
  install(FILES ${CMAKE_CURRENT_BINARY_DIR}/ardali-browser.desktop
    DESTINATION ${CMAKE_INSTALL_DATADIR}/applications
  )
  foreach(ICON_SIZE 16 24 32 48 64 128 256 512)
    install(FILES assets/icons/ardali-browser-${ICON_SIZE}.png
      DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/${ICON_SIZE}x${ICON_SIZE}/apps
      RENAME ardali-browser.png
    )
  endforeach()
endif()

qt_add_executable(ardali-browser-state-test
  native/state_transfer_test.cpp
)

target_link_libraries(ardali-browser-state-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)

qt_add_executable(ardali-browser-tab-manager-test
  native/tab_manager_test.cpp
  native/tab_manager.cpp
  native/session_store.cpp
)

target_link_libraries(ardali-browser-tab-manager-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)

qt_add_executable(ardali-browser-policy-test
  native/browser_policy_test.cpp
  native/browser_policy.cpp
)

target_link_libraries(ardali-browser-policy-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)
target_compile_definitions(ardali-browser-policy-test PRIVATE ARDALI_BROWSER_POLICY_PATH="${DALI_POLICY_JSON}")
add_dependencies(ardali-browser-policy-test ardali-browser-policy)

qt_add_executable(ardali-browser-internal-tab-test
  native/internal_tab_test.cpp
  native/tab_manager.cpp
  native/session_store.cpp
)

target_link_libraries(ardali-browser-internal-tab-test PRIVATE Qt6::Widgets Qt6::WebEngineWidgets)

qt_add_executable(ardali-browser-new-tab-background-test
  native/new_tab_background_store_test.cpp
  native/new_tab_background_store.cpp
)
target_link_libraries(ardali-browser-new-tab-background-test PRIVATE Qt6::Widgets)

add_test(NAME browser-policy COMMAND ardali-browser-policy-test)
add_test(NAME browser-state-transfer COMMAND ardali-browser-state-test)
add_test(NAME browser-tab-manager COMMAND ardali-browser-tab-manager-test)
add_test(NAME browser-internal-settings-tab COMMAND ardali-browser-internal-tab-test)
add_test(NAME browser-new-tab-background-store COMMAND ardali-browser-new-tab-background-test)
add_test(NAME browser-settings-runtime COMMAND ardali-browser)
add_test(NAME browser-new-tab-customization-runtime COMMAND ardali-browser)
add_test(NAME browser-tab-attach-stress COMMAND ardali-browser)
add_test(NAME browser-tab-attach-last-root-stress COMMAND ardali-browser)

set_tests_properties(browser-state-transfer browser-tab-manager browser-internal-settings-tab PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox"
)
set_tests_properties(browser-settings-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox;ARDALI_SETTINGS_RUNTIME_TEST=1"
  TIMEOUT 20
)
set_tests_properties(browser-new-tab-customization-runtime PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_NEW_TAB_CUSTOMIZATION_RUNTIME_TEST=1"
  TIMEOUT 20
)
set_tests_properties(browser-tab-attach-stress PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_TAB_ATTACH_RUNTIME_TEST=1;ARDALI_TAB_ATTACH_STRESS_TEST=1;ARDALI_TAB_ATTACH_STRESS_CYCLES=20"
  TIMEOUT 30
)
set_tests_properties(browser-tab-attach-last-root-stress PROPERTIES
  ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QTWEBENGINE_DISABLE_SANDBOX=1;QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox --disable-gpu;ARDALI_TAB_ATTACH_RUNTIME_TEST=1;ARDALI_TAB_ATTACH_STRESS_TEST=1;ARDALI_TAB_ATTACH_STRESS_LAST_ROOT=1;ARDALI_TAB_ATTACH_STRESS_CYCLES=20"
  TIMEOUT 30
)
