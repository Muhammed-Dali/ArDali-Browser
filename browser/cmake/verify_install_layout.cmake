if(NOT DEFINED ARDALI_BUILD_DIR OR NOT DEFINED ARDALI_INSTALL_BINDIR)
  message(FATAL_ERROR "ARDALI_BUILD_DIR and ARDALI_INSTALL_BINDIR are required")
endif()

set(stage "${ARDALI_BUILD_DIR}/install-layout-test")
file(REMOVE_RECURSE "${stage}")

execute_process(
  COMMAND "${CMAKE_COMMAND}" -E env "DESTDIR=${stage}"
          "${CMAKE_COMMAND}" --install "${ARDALI_BUILD_DIR}" --prefix /usr
  RESULT_VARIABLE install_result
  OUTPUT_VARIABLE install_output
  ERROR_VARIABLE install_error
)
if(NOT install_result EQUAL 0)
  message(FATAL_ERROR "staged install failed:\n${install_output}\n${install_error}")
endif()

set(executable_root "${stage}/usr/lib/ardali-browser")
set(required_files
  "${executable_root}/ardali-browser"
  "${stage}/usr/bin/ardali-browser"
  "${executable_root}/browser_policy.json"
  "${executable_root}/dali/web-output-audiophile.generated.js"
  "${executable_root}/dali/web-equalizer-32.generated.js"
  "${executable_root}/dali/web-dynamic-compressor.generated.js"
  "${executable_root}/dali/web-limiter.generated.js"
  "${executable_root}/dali/web-bass-enhancer.generated.js"
  "${executable_root}/dali/web-auto-gain.generated.js"
  "${stage}/usr/share/ardali-browser/new-tab/ardali-browser.png"
  "${stage}/usr/share/ardali-browser/new-tab/icons/search.svg"
  "${stage}/usr/share/ardali-browser/eq-presets/ardali_presets.json"
  "${stage}/usr/share/applications/ardali.desktop"
  "${stage}/usr/share/icons/hicolor/256x256/apps/ardali.png"
  "${stage}/usr/share/icons/hicolor/128x128/apps/ardali.png"
  "${stage}/usr/share/icons/hicolor/32x32/apps/ardali.png"
)
foreach(required_file IN LISTS required_files)
  if(NOT EXISTS "${required_file}")
    message(FATAL_ERROR "installed runtime asset missing: ${required_file}")
  endif()
  file(SIZE "${required_file}" required_size)
  if(required_size EQUAL 0)
    message(FATAL_ERROR "installed runtime asset is empty: ${required_file}")
  endif()
endforeach()

file(READ "${stage}/usr/share/applications/ardali.desktop" desktop_entry)
foreach(expected_line
    "Name=ArDali"
    "Exec=/usr/bin/ardali-browser %U"
    "TryExec=/usr/bin/ardali-browser"
    "Icon=ardali"
    "StartupWMClass=ArDaliBrowser"
    "StartupNotify=true")
  string(FIND "${desktop_entry}" "${expected_line}" line_position)
  if(line_position EQUAL -1)
    message(FATAL_ERROR "desktop integration mismatch; missing: ${expected_line}")
  endif()
endforeach()

file(GLOB autoeq_files "${stage}/usr/share/ardali-browser/eq-presets/autoeq/*.json")
list(LENGTH autoeq_files autoeq_count)
if(autoeq_count LESS 1750)
  message(FATAL_ERROR "installed AutoEQ collection is incomplete: ${autoeq_count}")
endif()

file(REMOVE_RECURSE "${stage}")
