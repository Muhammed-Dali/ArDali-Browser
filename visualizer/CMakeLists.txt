cmake_minimum_required(VERSION 3.15)
project(AurivoProjectMVisualizer)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Use pkg-config for all libraries
find_package(PkgConfig REQUIRED)

# Find SDL2
find_package(SDL2 REQUIRED)
include_directories(${SDL2_INCLUDE_DIRS})

# Try to find SDL2_image (optional; fallback to BMP if not available)
pkg_check_modules(SDL2_IMAGE sdl2_image)
if(SDL2_IMAGE_FOUND)
    include_directories(${SDL2_IMAGE_INCLUDE_DIRS})
    link_directories(${SDL2_IMAGE_LIBRARY_DIRS})
    message(STATUS "SDL2_image found; will use IMG_Load for icon")
else()
    message(STATUS "SDL2_image not found; will use SDL_LoadBMP fallback")
endif()

# Find OpenGL
find_package(OpenGL REQUIRED)
include_directories(${OPENGL_INCLUDE_DIR})

# Find GLEW (use pkg-config on Linux/macOS; Windows can still use glew32)
pkg_check_modules(GLEW glew)
if(GLEW_FOUND)
    include_directories(${GLEW_INCLUDE_DIRS})
    link_directories(${GLEW_LIBRARY_DIRS})
else()
    if (WIN32)
        message(STATUS "GLEW pkg-config not found; using glew32 fallback")
        set(GLEW_LIBRARIES "glew32")
    else()
        message(FATAL_ERROR "GLEW not found (pkg-config: glew). Install development package (e.g. libglew-dev).")
    endif()
endif()

# Threads (portable replacement for hardcoded pthread)
find_package(Threads REQUIRED)

# Use system libprojectm instead of bundled Clementine version
# Ubuntu/Debian typically ship `libprojectM` pkg-config; some distros ship `projectM-4`.
# Try a few common pkg-config names for the core library.
pkg_check_modules(PROJECTM projectM-4)
if(NOT PROJECTM_FOUND)
    pkg_check_modules(PROJECTM libprojectM)
endif()
if(NOT PROJECTM_FOUND)
    pkg_check_modules(PROJECTM projectM)
endif()

# Playlist library is optional; the visualizer doesn't require it.
pkg_check_modules(PROJECTM_PLAYLIST projectM-4-playlist)
if(NOT PROJECTM_PLAYLIST_FOUND)
    pkg_check_modules(PROJECTM_PLAYLIST libprojectM-playlist)
endif()
if(NOT PROJECTM_PLAYLIST_FOUND)
    pkg_check_modules(PROJECTM_PLAYLIST projectM-playlist)
endif()
include_directories(${PROJECTM_INCLUDE_DIRS})
link_directories(${PROJECTM_LIBRARY_DIRS})
if(PROJECTM_PLAYLIST_FOUND)
    include_directories(${PROJECTM_PLAYLIST_INCLUDE_DIRS})
    link_directories(${PROJECTM_PLAYLIST_LIBRARY_DIRS})
endif()

# Some distributions ship broken pkg-config .pc files for projectM that emit "-l:projectM-4"
# instead of "-lprojectM-4" or "-l:libprojectM-4.so". CMake will pass this through verbatim and
# the linker won't find the library. Strip an optional leading ":" from library entries.
function(aurivo_strip_colon_prefix out_var in_var)
    set(out "")
    foreach(item IN LISTS ${in_var})
        string(REGEX REPLACE "^:" "" item "${item}")
        list(APPEND out "${item}")
    endforeach()
    set(${out_var} "${out}" PARENT_SCOPE)
endfunction()

aurivo_strip_colon_prefix(PROJECTM_LIBRARIES_STRIPPED PROJECTM_LIBRARIES)
set(PROJECTM_LIBRARIES "${PROJECTM_LIBRARIES_STRIPPED}")
if(PROJECTM_PLAYLIST_FOUND)
    aurivo_strip_colon_prefix(PROJECTM_PLAYLIST_LIBRARIES_STRIPPED PROJECTM_PLAYLIST_LIBRARIES)
    set(PROJECTM_PLAYLIST_LIBRARIES "${PROJECTM_PLAYLIST_LIBRARIES_STRIPPED}")
endif()

# Windows fallback when pkg-config doesn't provide projectM
if (WIN32 AND (NOT PROJECTM_FOUND))
    message(STATUS "projectM pkg-config not found; using MSYS2 fallback paths")
    set(PROJECTM_INCLUDE_DIRS "C:/msys64/mingw64/include")
    set(PROJECTM_LIBRARY_DIRS "C:/msys64/mingw64/lib")
    set(PROJECTM_LIBRARIES "projectM-4")
    set(PROJECTM_PLAYLIST_LIBRARIES "")
endif()

if ((NOT WIN32) AND (NOT PROJECTM_FOUND))
    message(FATAL_ERROR "projectM not found via pkg-config. Install libprojectm-dev (or projectM-4 dev package).")
endif()

# Dear ImGui (vendored)
get_filename_component(REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
set(IMGUI_DIR "${REPO_ROOT}/third_party/imgui")

add_library(imgui STATIC
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_sdl2.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)

# Ensure UTF-8 source parsing on Windows (fix mojibake in non-ASCII UI strings)
if (WIN32)
    if (MSVC)
        target_compile_options(imgui PRIVATE /utf-8)
    else()
        target_compile_options(imgui PRIVATE -finput-charset=UTF-8 -fexec-charset=UTF-8)
    endif()
endif()

target_include_directories(imgui PUBLIC
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
    ${CMAKE_CURRENT_LIST_DIR}
    ${SDL2_INCLUDE_DIRS}
    ${OPENGL_INCLUDE_DIR}
    ${GLEW_INCLUDE_DIRS}
)

target_compile_definitions(imgui PRIVATE
    IMGUI_IMPL_OPENGL_LOADER_CUSTOM
)

if(SDL2_IMAGE_FOUND)
    target_compile_definitions(imgui PUBLIC SDL_IMAGE_MAJOR_VERSION=2)
endif()

target_link_libraries(imgui PUBLIC
    ${SDL2_LIBRARIES}
    ${OPENGL_LIBRARIES}
)

# Visualizer executable
# Windows: build as GUI subsystem (no extra console window).
if (WIN32)
    add_executable(aurivo-projectm-visualizer WIN32
        main_imgui.cpp
        gl_loader.cpp
    )
else()
    add_executable(aurivo-projectm-visualizer
        main_imgui.cpp
        gl_loader.cpp
    )
endif()

# Ensure UTF-8 source parsing on Windows (fix mojibake in non-ASCII UI strings)
if (WIN32)
    if (MSVC)
        target_compile_options(aurivo-projectm-visualizer PRIVATE /utf-8)
    else()
        target_compile_options(aurivo-projectm-visualizer PRIVATE -finput-charset=UTF-8 -fexec-charset=UTF-8)
    endif()
endif()

target_link_libraries(aurivo-projectm-visualizer
    ${SDL2_LIBRARIES}
    ${OPENGL_LIBRARIES}
    ${GLEW_LIBRARIES}
    imgui
    ${PROJECTM_LIBRARIES}
    Threads::Threads
)

if(PROJECTM_PLAYLIST_FOUND)
    target_link_libraries(aurivo-projectm-visualizer ${PROJECTM_PLAYLIST_LIBRARIES})
endif()

if (WIN32)
    target_link_libraries(aurivo-projectm-visualizer shell32)
    target_link_libraries(aurivo-projectm-visualizer dwmapi)
endif()

# Bundle-friendly runtime path: look for shared libraries next to the executable.
if(UNIX AND NOT APPLE)
    set_target_properties(aurivo-projectm-visualizer PROPERTIES
        BUILD_RPATH "$ORIGIN"
        INSTALL_RPATH "$ORIGIN"
    )
endif()

if(SDL2_IMAGE_FOUND)
    target_link_libraries(aurivo-projectm-visualizer ${SDL2_IMAGE_LIBRARIES})
    target_compile_definitions(aurivo-projectm-visualizer PRIVATE SDL_IMAGE_MAJOR_VERSION=2)
endif()

# Dev convenience: copy the built visualizer into ../native-dist on Windows
if (WIN32)
    add_custom_command(TARGET aurivo-projectm-visualizer POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_SOURCE_DIR}/../native-dist"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:aurivo-projectm-visualizer>"
            "${CMAKE_SOURCE_DIR}/../native-dist/$<TARGET_FILE_NAME:aurivo-projectm-visualizer>"
    )
endif()

# Installation
install(TARGETS aurivo-projectm-visualizer
    RUNTIME DESTINATION ${CMAKE_SOURCE_DIR}/../native-dist
)
