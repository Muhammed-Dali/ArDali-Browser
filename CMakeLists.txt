cmake_minimum_required(VERSION 3.21)
project(ArDali VERSION 6.0.0 LANGUAGES CXX)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON CACHE BOOL "Export compile commands for language servers" FORCE)

add_subdirectory(browser)
