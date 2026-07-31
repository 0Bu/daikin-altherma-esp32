idf_component_register(
    SRCS
        "main.cpp"
        "config.cpp"
        "nvs_storage.cpp"
        "wifi.cpp"
        "hp_comm.cpp"
        "hp_convert.cpp"
        "hp_detect.cpp"
        "hp_modbus.cpp"
        "hp_poll.cpp"
        "history.cpp"
        "checkup.cpp"
        "http_server.cpp"
        "http_common.cpp"
        "http_status.cpp"
        "http_config.cpp"
        "http_ota.cpp"
        "mcp_server.cpp"
        "provisioning.cpp"
        "captive_dns.cpp"
        "safe_mode.cpp"
        "mqtt_ha.cpp"
        "ota_update.cpp"
        "diag_log.cpp"
        "syslog.cpp"
        "diag_crash.cpp"
        "status_led.cpp"
        "recovery_button.cpp"
        "sntp_time.cpp"
    INCLUDE_DIRS
        "."
    EMBED_FILES
        "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz"
        "${CMAKE_CURRENT_BINARY_DIR}/setup.html.gz"
        "${CMAKE_CURRENT_BINARY_DIR}/mcp.html.gz"
    REQUIRES
        nvs_flash
        esp_wifi
        esp_event
        esp_netif
        esp_http_server
        esp_app_format
        esp_https_ota
        app_update
        esp_http_client
        esp-tls
        lwip
        esp_driver_uart
        esp_driver_gpio
        esp_driver_rmt
        led_strip
        mqtt
        esp_timer
        bootloader_support
        mdns
        espcoredump
)

# THE WARNING CONTRACT for main/. Three places in this component are written the way they are
# BECAUSE a class of warning is fatal here — and until now nothing in this repo made that true:
#
#   -Werror=unused-result   nvs_storage.hpp's [[nodiscard]] setters. A dropped NVS write is SILENT
#                           (a full partition, a worn flash), and safe_mode.cpp could not latch its
#                           crash counter because of exactly one. `bool ok = nvs_set_i32(...)` still
#                           compiles and still lies; what [[nodiscard]] buys is that the IGNORED
#                           result is a build error — which it only is if this class is fatal.
#   -Werror=format          diag_printf carries __attribute__((format(printf, 1, 2))) and has 124
#                           call sites in this component, so this checks every one of them.
#                           logic/timestamp.hpp documents the case NOTHING ELSE can catch: int32_t
#                           is `long int` on the xtensa toolchain but plain `int` on the host, so a
#                           %d mismatch is invisible to scripts/run-mock-tests.sh. GCC spells this
#                           diagnostic [-Werror=format=], which is what that comment cites.
#   -Werror=return-type     hp_comm.cpp's `return false;  // unreachable` says so by name.
#
# All three were INHERITED, never pinned: they held only if ESP-IDF's own defaults happened to make
# them fatal, and IDF's -Werror handling is version- AND Kconfig-dependent
# (COMPILER_DISABLE_DEFAULT_ERRORS rewrites -Werror to -Werror=all). An inherited guarantee is not
# one — it can change under an IDF bump with nothing here to notice, and the symptom is a warning
# scrolling past in a 5-minute build log while the check stays green.
#
# PRIVATE on ${COMPONENT_LIB}, deliberately NOT a CONFIG_COMPILER_* key in sdkconfig.defaults, for
# two independent reasons: a Kconfig key is global, so it would hold ESP-IDF itself and the managed
# components (led_strip, mdns, mqtt) to a contract that is not ours to demand and that breaks on any
# bump; and sdkconfig.defaults is hashed into CI's ccache key (scripts/idf-version.sh), so a
# diagnostic-only change there would discard every cached object it cannot possibly invalidate.
# Scoped this way, the command line changes for these 28 objects and nothing else.
#
# Only the ERROR-ness of three named classes is set here. -Wall is already passed to every component
# by ESP-IDF, so restating it would read as "this line is what turns it on" while changing nothing;
# -Wextra is left off because IDF suppresses -Wunused-parameter globally and the mandated-signature
# IDF callbacks in this component would fill the log with warnings nobody can act on. A gate with
# noise in it is one people learn to stop reading. See CONTRIBUTING.md for why there is no
# clang-tidy/cppcheck gate either — that was measured, not assumed.
target_compile_options(${COMPONENT_LIB} PRIVATE
    -Werror=return-type
    -Werror=format
    -Werror=unused-result
)

# Assemble + pre-compress the web UI at build time. The sources are split for edit locality —
# www/index.html, www/style.css and the ordered JavaScript fragments in www/app.sources — and
# inline_assets.cmake splices them back into the ONE self-contained page the device serves.
# Browsers always accept gzip, so shipping the page pre-gzipped cuts bytes on the wire ~3x —
# the single biggest lever for first-paint over a high-latency WiFi link. Regenerated on every
# build, so the served page never goes stale. Symbols: _binary_index_html_gz_{start,end}
# (see handle_index in http_status.cpp).
set(APP_JS_MANIFEST "${CMAKE_CURRENT_SOURCE_DIR}/www/app.sources")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${APP_JS_MANIFEST}")
file(STRINGS "${APP_JS_MANIFEST}" APP_JS_ENTRIES ENCODING UTF-8)
set(APP_JS_SOURCES "")
foreach(raw IN LISTS APP_JS_ENTRIES)
    string(STRIP "${raw}" rel)
    if(NOT rel STREQUAL "" AND NOT rel MATCHES "^#")
        list(APPEND APP_JS_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/www/${rel}")
    endif()
endforeach()

add_custom_command(
    OUTPUT  "${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html"
    COMMAND ${CMAKE_COMMAND}
            -DHTML=${CMAKE_CURRENT_SOURCE_DIR}/www/index.html
            -DCSS=${CMAKE_CURRENT_SOURCE_DIR}/www/style.css
            -DJS_MANIFEST=${APP_JS_MANIFEST}
            -DOUT=${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html
            -P ${CMAKE_CURRENT_SOURCE_DIR}/www/inline_assets.cmake
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/www/index.html"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/style.css"
            "${APP_JS_MANIFEST}"
            ${APP_JS_SOURCES}
            "${CMAKE_CURRENT_SOURCE_DIR}/www/inline_assets.cmake"
    COMMENT "Inlining web UI assets (index.html + style.css + app.sources)"
    VERBATIM)
add_custom_command(
    OUTPUT  "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz"
    COMMAND gzip -9 -n -c "${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html"
            > "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz"
    DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html"
    COMMENT "Gzipping web UI (index_inlined.html -> index.html.gz)"
    VERBATIM)
add_custom_target(gen_index_gz DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz")
add_dependencies(${COMPONENT_LIB} gen_index_gz)

# Pre-compress the captive-portal setup page the same way (static source, no asset splicing).
# Symbols: _binary_setup_html_gz_{start,end} (see form_get in provisioning.cpp).
add_custom_command(
    OUTPUT  "${CMAKE_CURRENT_BINARY_DIR}/setup.html.gz"
    COMMAND gzip -9 -n -c "${CMAKE_CURRENT_SOURCE_DIR}/www/setup.html"
            > "${CMAKE_CURRENT_BINARY_DIR}/setup.html.gz"
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/www/setup.html"
    COMMENT "Gzipping setup portal (www/setup.html -> setup.html.gz)"
    VERBATIM)
add_custom_target(gen_setup_gz DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/setup.html.gz")
add_dependencies(${COMPONENT_LIB} gen_setup_gz)

# The MCP endpoint is both a protocol URL (POST) and a self-documenting setup page (GET). Keep its
# source split for editability like the main UI, but ship one pre-gzipped, dependency-free page.
# Symbols: _binary_mcp_html_gz_{start,end} (see mcp_server.cpp).
add_custom_command(
    OUTPUT  "${CMAKE_CURRENT_BINARY_DIR}/mcp_dashboard_inlined.html"
    COMMAND ${CMAKE_COMMAND}
            -DHTML=${CMAKE_CURRENT_SOURCE_DIR}/www/mcp_dashboard.html
            -DCSS=${CMAKE_CURRENT_SOURCE_DIR}/www/mcp_dashboard.css
            -DJS=${CMAKE_CURRENT_SOURCE_DIR}/www/mcp_dashboard.js
            -DOUT=${CMAKE_CURRENT_BINARY_DIR}/mcp_dashboard_inlined.html
            -P ${CMAKE_CURRENT_SOURCE_DIR}/www/inline_assets.cmake
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/www/mcp_dashboard.html"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/mcp_dashboard.css"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/mcp_dashboard.js"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/inline_assets.cmake"
    COMMENT "Inlining MCP dashboard assets"
    VERBATIM)
add_custom_command(
    OUTPUT  "${CMAKE_CURRENT_BINARY_DIR}/mcp.html.gz"
    COMMAND gzip -9 -n -c "${CMAKE_CURRENT_BINARY_DIR}/mcp_dashboard_inlined.html"
            > "${CMAKE_CURRENT_BINARY_DIR}/mcp.html.gz"
    DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/mcp_dashboard_inlined.html"
    COMMENT "Gzipping MCP dashboard"
    VERBATIM)
add_custom_target(gen_mcp_gz DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/mcp.html.gz")
add_dependencies(${COMPONENT_LIB} gen_mcp_gz)
