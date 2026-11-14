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

# Build the pinned lwIP port with a Modbus-only retained-semaphore accessor. Keep the installed
# SDK and the behavior of the existing SDK entry points intact.
idf_component_get_property(lwip_port_dir lwip COMPONENT_DIR)
idf_component_get_property(lwip_component lwip COMPONENT_LIB)
set(lwip_port "${lwip_port_dir}/port/freertos/sys_arch.c")
file(SHA256 "${lwip_port}" lwip_port_digest)
if(NOT lwip_port_digest STREQUAL "dd875fe08b8f6a9279e6b04f81b9a8cf046f17e0e94fc9661ed013e83a046cf9")
    message(FATAL_ERROR "Review the Modbus semaphore accessor against this ESP-IDF lwIP port.")
endif()
get_target_property(lwip_sources "${lwip_component}" SOURCES)
set(lwip_port_matches "${lwip_sources}")
list(FILTER lwip_port_matches INCLUDE REGEX "/port/freertos/sys_arch[.]c$")
if(NOT lwip_port_matches STREQUAL lwip_port)
    message(FATAL_ERROR "Expected exactly one pinned lwIP FreeRTOS port source.")
endif()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${lwip_port}")
# Preserve the sys_arch object basename used by the SDK's linker fragment.
set(lwip_generated "${CMAKE_BINARY_DIR}/daikin-sdk/sys_arch.c")
file(READ "${lwip_port}" lwip_port_source)
string(APPEND lwip_port_source [=[

/* Modbus admission uses a nonallocating peek after the ordinary lazy lookup. */
__attribute__((noinline)) sys_sem_t *
daikin_lwip_thread_sem_get(void)
{
  sys_sem_t *sem = sys_thread_sem_get();
  if (sem != NULL && pthread_getspecific(sys_thread_sem_key) != sem) {
    sys_thread_sem_free(sem);
    return NULL;
  }
  return sem;
}
]=])
file(CONFIGURE OUTPUT "${lwip_generated}" CONTENT "${lwip_port_source}" @ONLY NEWLINE_STYLE UNIX)
list(FIND lwip_sources "${lwip_port}" lwip_port_index)
list(REMOVE_AT lwip_sources "${lwip_port_index}")
list(INSERT lwip_sources "${lwip_port_index}" "${lwip_generated}")
set_property(TARGET "${lwip_component}" PROPERTY SOURCES "${lwip_sources}")
