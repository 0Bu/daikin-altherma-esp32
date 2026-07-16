# 3.20: scripts/run-mock-tests.sh drives this with `ctest --test-dir`, which older ctest lacks.
cmake_minimum_required(VERSION 3.20)
project(daikin_logic_tests CXX)

# Host-side mock build: the pure logic in main/logic/ (IDF-free) compiled with the plain system
# toolchain — no ESP-IDF, no board. See ../scripts/run-mock-tests.sh and ../test/README.md.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)

# So `#include "logic/crc.hpp"` and `#include "def/registry.hpp"` resolve as on the device.
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../main)

enable_testing()
add_executable(logic_tests test_logic.cpp)
add_test(NAME logic_tests COMMAND logic_tests)
