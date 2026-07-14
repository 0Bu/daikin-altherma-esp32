cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

if(NOT IDF_TARGET STREQUAL "esp32s3")
    message(FATAL_ERROR "This project only supports esp32s3 target.")
endif()

project(daikin-altherma-esp32)
