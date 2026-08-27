cmake_minimum_required(VERSION 3.20)
project(daikin_runtime_integration_tests CXX)

find_package(Threads REQUIRED)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(runtime_integration_tests runtime_integration_tests.cpp)
target_include_directories(runtime_integration_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../main)
target_compile_options(runtime_integration_tests PRIVATE -Wall -Wextra -Werror)
target_link_libraries(runtime_integration_tests PRIVATE Threads::Threads)

enable_testing()
add_test(NAME runtime_integration_tests COMMAND runtime_integration_tests)
