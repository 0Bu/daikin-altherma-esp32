cmake_minimum_required(VERSION 3.22)

# The firmware has one project component. Telling ESP-IDF that up front keeps optional framework
# components out of the build graph; transitive requirements are still discovered from main's
# REQUIRES and idf_component.yml declarations.
set(COMPONENTS main)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

if(NOT IDF_TARGET STREQUAL "esp32s3")
    message(FATAL_ERROR "This project only supports esp32s3 target.")
endif()

project(daikin-altherma-esp32)
