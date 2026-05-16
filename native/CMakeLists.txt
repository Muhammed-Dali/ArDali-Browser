# ============================================
# AURIVO AUDIO ENGINE - CMake Configuration
# Node.js Native Addon with BASS Audio Library
# ============================================

cmake_minimum_required(VERSION 3.15)
project(aurivo_audio VERSION 2.0.0 LANGUAGES CXX)

# ============================================
# C++ Standard
# ============================================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ============================================
# Build Type (Default: Release)
# ============================================
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "System: ${CMAKE_SYSTEM_NAME}")
message(STATUS "Processor: ${CMAKE_SYSTEM_PROCESSOR}")

# ============================================
# Output Directory
# ============================================
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/Release)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/Release)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/Release)

# ============================================
# Node.js ve N-API Ayarları
# ============================================
# Node.js'i bul (tırnakları temizle)
execute_process(
    COMMAND node -p "require('node-addon-api').include.replace(/\"/g, '')"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

# Node.js include dizinini bul
execute_process(
    COMMAND node -p "require('path').dirname(require.resolve('node-addon-api')) + '/node_modules/node-api-headers/include'"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_API_HEADERS_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
)

# Alternatif: node-gyp headers
execute_process(
    COMMAND node -p "process.config.variables.node_prefix + '/include/node'"
    OUTPUT_VARIABLE NODE_INCLUDE_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
)

# Node.js versiyonu
execute_process(
    COMMAND node -p "process.versions.node"
    OUTPUT_VARIABLE NODE_VERSION
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

message(STATUS "Node.js version: ${NODE_VERSION}")
message(STATUS "Node addon API dir: ${NODE_ADDON_API_DIR}")

# ============================================
# BASS Library Paths
# ============================================
set(BASS_ROOT_DIR "${CMAKE_SOURCE_DIR}/../libs")
set(BASS_INCLUDE_DIR "${BASS_ROOT_DIR}/bass/c")
set(BASS_FX_INCLUDE_DIR "${BASS_ROOT_DIR}/bass_fx/c")

# Platform-specific library paths
if(WIN32)
    set(BASS_LIB_DIR "${BASS_ROOT_DIR}/windows")
    set(BASS_LIB_NAME "bass")
    set(BASS_FX_LIB_NAME "bass_fx")
    set(BASS_LIB_EXT ".dll")
    set(BASS_IMPORT_EXT ".lib")
elseif(APPLE)
    set(BASS_LIB_DIR "${BASS_ROOT_DIR}/macos")
    set(BASS_LIB_NAME "bass")
    set(BASS_FX_LIB_NAME "bass_fx")
    set(BASS_LIB_EXT ".dylib")
else()
    # Linux
    set(BASS_LIB_DIR "${BASS_ROOT_DIR}/linux")
    set(BASS_LIB_NAME "bass")
    set(BASS_FX_LIB_NAME "bass_fx")
    set(BASS_LIB_EXT ".so")
endif()

message(STATUS "BASS include dir: ${BASS_INCLUDE_DIR}")
message(STATUS "BASS library dir: ${BASS_LIB_DIR}")

# ============================================
# Source Files
# ============================================
set(SOURCES
    aurivo_audio.cpp
    aurivo_dsp.cpp
)

# ============================================
# Create Shared Library (Node.js Module)
# ============================================
add_library(${PROJECT_NAME} SHARED ${SOURCES})

# Node.js modülü için .node uzantısı
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    OUTPUT_NAME "aurivo_audio"
)

# ============================================
# Include Directories
# ============================================
target_include_directories(${PROJECT_NAME} PRIVATE
    ${BASS_INCLUDE_DIR}
    ${BASS_FX_INCLUDE_DIR}
    ${NODE_ADDON_API_DIR}
    ${NODE_API_HEADERS_DIR}
    ${NODE_INCLUDE_DIR}
)

# ============================================
# Preprocessor Definitions
# ============================================
target_compile_definitions(${PROJECT_NAME} PRIVATE
    NAPI_VERSION=8
    NAPI_DISABLE_CPP_EXCEPTIONS
    BUILDING_NODE_EXTENSION
)

# ============================================
# Platform-Specific Configuration
# ============================================
if(WIN32)
    # Windows (MSVC)
    message(STATUS "Configuring for Windows...")
    
    target_compile_definitions(${PROJECT_NAME} PRIVATE
        WIN32
        _WINDOWS
        NOMINMAX
        _CRT_SECURE_NO_WARNINGS
    )
    
    # MSVC Runtime Library
    set_property(TARGET ${PROJECT_NAME} PROPERTY
        MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL"
    )
    
    # Compiler flags
    target_compile_options(${PROJECT_NAME} PRIVATE
        $<$<CONFIG:Release>:/O2 /GL /Gy /DNDEBUG>
        $<$<CONFIG:Debug>:/Od /Zi /RTC1>
        /W3
        /EHsc
    )
    
    # Linker flags
    target_link_options(${PROJECT_NAME} PRIVATE
        $<$<CONFIG:Release>:/LTCG /OPT:REF /OPT:ICF>
    )
    
    # Link BASS libraries (import libs)
    target_link_libraries(${PROJECT_NAME} PRIVATE
        "${BASS_LIB_DIR}/bass.lib"
        "${BASS_LIB_DIR}/bass_fx.lib"
    )
    
    # Node.js library
    execute_process(
        COMMAND node -p "process.config.variables.node_prefix + '/node.lib'"
        OUTPUT_VARIABLE NODE_LIB
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )
    if(EXISTS "${NODE_LIB}")
        target_link_libraries(${PROJECT_NAME} PRIVATE "${NODE_LIB}")
    endif()

elseif(APPLE)
    # macOS
    message(STATUS "Configuring for macOS...")
    
    target_compile_options(${PROJECT_NAME} PRIVATE
        $<$<CONFIG:Release>:-O3 -DNDEBUG -flto>
        $<$<CONFIG:Debug>:-O0 -g>
        -fPIC
        -fvisibility=hidden
    )
    
    target_link_options(${PROJECT_NAME} PRIVATE
        -undefined dynamic_lookup
        $<$<CONFIG:Release>:-flto>
        "-Wl,-rpath,@loader_path"
        "-Wl,-rpath,@loader_path/.."
        "-Wl,-rpath,@loader_path/../libs/macos"
    )
    
    # Link BASS libraries
    target_link_libraries(${PROJECT_NAME} PRIVATE
        "${BASS_LIB_DIR}/libbass.dylib"
        "${BASS_LIB_DIR}/libbass_fx.dylib"
    )
    
    # macOS Frameworks
    find_library(COREAUDIO_FRAMEWORK CoreAudio)
    find_library(AUDIOUNIT_FRAMEWORK AudioUnit)
    find_library(COREFOUNDATION_FRAMEWORK CoreFoundation)
    
    if(COREAUDIO_FRAMEWORK)
        target_link_libraries(${PROJECT_NAME} PRIVATE
            ${COREAUDIO_FRAMEWORK}
            ${AUDIOUNIT_FRAMEWORK}
            ${COREFOUNDATION_FRAMEWORK}
        )
    endif()

else()
    # Linux
    message(STATUS "Configuring for Linux...")
    
    target_compile_options(${PROJECT_NAME} PRIVATE
        $<$<CONFIG:Release>:-O3 -DNDEBUG -flto -march=native>
        $<$<CONFIG:Debug>:-O0 -g -fsanitize=address>
        -fPIC
        -fvisibility=hidden
        -Wall
        -Wextra
        -Wpedantic
    )
    
    target_link_options(${PROJECT_NAME} PRIVATE
        $<$<CONFIG:Release>:-flto -s>
        $<$<CONFIG:Debug>:-fsanitize=address>
        "-Wl,-rpath,$ORIGIN"
        "-Wl,-rpath,$ORIGIN/.."
        "-Wl,-rpath,$ORIGIN/../libs/linux"
        "-Wl,--enable-new-dtags"
    )
    
    # Link BASS libraries
    target_link_directories(${PROJECT_NAME} PRIVATE ${BASS_LIB_DIR})
    target_link_libraries(${PROJECT_NAME} PRIVATE
        bass
        bass_fx
    )
    
    # System libraries
    find_package(Threads REQUIRED)
    target_link_libraries(${PROJECT_NAME} PRIVATE
        Threads::Threads
        ${CMAKE_DL_LIBS}
    )
endif()

# ============================================
# Post-Build: Copy BASS Libraries
# ============================================
if(WIN32)
    set(BASS_LIBS_TO_COPY
        "bass.dll"
        "bass_fx.dll"
        "bass_aac.dll"
        "bassape.dll"
        "bassflac.dll"
        "basswv.dll"
    )
elseif(APPLE)
    set(BASS_LIBS_TO_COPY
        "libbass.dylib"
        "libbass_fx.dylib"
    )
else()
    # Linux
    set(BASS_LIBS_TO_COPY
        "libbass.so"
        "libbass_fx.so"
        "libbass_aac.so"
        "libbassape.so"
        "libbassflac.so"
        "libbasswv.so"
    )
endif()

# Copy each library if it exists
foreach(LIB ${BASS_LIBS_TO_COPY})
    set(LIB_PATH "${BASS_LIB_DIR}/${LIB}")
    if(EXISTS "${LIB_PATH}")
        add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${LIB_PATH}"
                "$<TARGET_FILE_DIR:${PROJECT_NAME}>/${LIB}"
            COMMENT "Copying ${LIB} to output directory"
        )
    else()
        message(STATUS "Optional library not found: ${LIB}")
    endif()
endforeach()

# ============================================
# Installation
# ============================================
install(TARGETS ${PROJECT_NAME}
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin
)

install(FILES ${BASS_LIBS_TO_COPY_FULL_PATHS}
    DESTINATION lib
    OPTIONAL
)

# ============================================
# Summary
# ============================================
message(STATUS "")
message(STATUS "========================================")
message(STATUS "AURIVO AUDIO ENGINE Configuration")
message(STATUS "========================================")
message(STATUS "Project: ${PROJECT_NAME}")
message(STATUS "Version: ${PROJECT_VERSION}")
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "Output: ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/aurivo_audio.node")
message(STATUS "========================================")
message(STATUS "")
