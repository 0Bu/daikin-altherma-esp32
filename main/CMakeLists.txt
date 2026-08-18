set(UI_LOCALE_CODES de es fr it pl cs uk)
set(UI_LOCALE_GZIP_FILES "")
foreach(locale IN LISTS UI_LOCALE_CODES)
    list(APPEND UI_LOCALE_GZIP_FILES "${CMAKE_CURRENT_BINARY_DIR}/locale-${locale}.js.gz")
endforeach()

idf_component_register(
    SRCS
        "main.cpp"
        "config.cpp"
        "nvs_storage.cpp"
        "net.cpp"
        "wifi.cpp"
        "weather_forecast.cpp"
        "hp_comm.cpp"
        "hp_convert.cpp"
        "hp_detect.cpp"
        "hp_modbus.cpp"
        "hp_poll.cpp"
        "env3.cpp"
        "history.cpp"
        "checkup.cpp"
        "state_dwell.cpp"
        "http_server.cpp"
        "http_common.cpp"
        "http_client_diag.cpp"
        "http_status.cpp"
        "http_config.cpp"
        "http_ota.cpp"
        "mcp_server.cpp"
        "provisioning.cpp"
        "captive_dns.cpp"
        "safe_mode.cpp"
        "heap_guard.cpp"
        "stack_watch.cpp"
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
        ${UI_LOCALE_GZIP_FILES}
        "${CMAKE_CURRENT_SOURCE_DIR}/www/favicon.ico"
        "${CMAKE_CURRENT_SOURCE_DIR}/www/heat_pump_icon.png"
    REQUIRES
        nvs_flash
        esp_partition
        esp_wifi
        esp_event
        esp_netif
        esp_http_server
        esp_app_format
        app_update
        esp_http_client
        esp-tls
        mbedtls
        lwip
        esp_driver_uart
        esp_driver_i2c
        esp_driver_gpio
        esp_driver_rmt
        esp_driver_spi
        esp_eth
        led_strip
        mqtt
        esp_timer
        bootloader_support
        mdns
        espcoredump
)

# C++17 is the language contract shared with the host logic suite. ESP-IDF 6 currently defaults
# applications to a newer dialect; inheriting that default would let device-only code start using
# constructs the C++17 host compiler cannot parse, with no project file recording the change.
target_compile_options(${COMPONENT_LIB} PRIVATE -std=gnu++17)

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

# THE STACK CONTRACT for the /status builder — the one file in this component whose OPTIMISATION
# LEVEL is a correctness setting rather than a taste. `http_append_status_json()` has overflowed a
# task stack twice (v1.0.12 on httpd, #318 on httpd again through an OTA that double-faulted and
# rolled back a fleet), and both times the fix was to raise a stack against a frame nobody had
# questioned. Measured on 2026-08-07 (main @ 7524b4c), the frame was 0x2e00 = 11776 bytes while the
# NAMED LOCALS in that function sum to ~2.2 KB. The other ~9 KB is not live data: this project
# builds at ESP-IDF's default CONFIG_COMPILER_OPTIMIZATION_DEBUG (-Og), which allocates a distinct
# stack slot per `jstr()`/`std::to_string()` temporary instead of coalescing them, and a 760-line
# function dense with EH cleanup regions is the worst case for that. -Os on this ONE translation
# unit takes the frame to 0xea0 = 3744 (−68%), and the deepest httpd path — `mcp_post`, NOT
# `h_status`, because MCP's get_status reuses this same builder and pays its frame plus its own —
# from 14512 bytes of a 16384 stack (~1872 free, before ISR frames and before the ~700-byte
# _Unwind_RaiseException path a std::bad_alloc costs below the throwing frame) to 6480.
#
# Verified on hardware too, not only on the ELF: both images built from this one base, signed and
# flashed to the bench board in turn, produced byte-for-byte structurally identical /status,
# /status?redact=1, /values and MCP get_status payloads (403 JSON paths each; every value delta was
# live-varying state). That is what rules out latent UB -Og happened to mask.
#
# Chosen over the two alternatives because both are worse, measured rather than assumed:
#   raising cfg.stack_size again  — 4 KB of permanent RAM on a board whose binding limit is the
#                                   largest CONTIGUOUS free block, spent on a compiler artefact.
#   splitting the builder up      — the frame is a SUM of block contributions but the peak is
#                                   `builder + max(helper)`. Extracting the already-braced `health`
#                                   block moved the frame 11616 → 11184 (on the f686dff base, before
#                                   the frame reached 11776) while the standalone helper
#                                   cost 736, i.e. the PEAK got 304 bytes WORSE; a second block
#                                   (`history`) reached 10816 + max(736, 496) = 11552, 64 bytes
#                                   better than the start. It only pays past ~10 extracted blocks.
#
# THE COST, stated because it is real: -Og's precise backtraces are what diagnosed both overflows,
# and this is the file whose core dumps mattered. Inlining makes a dump from here less exact. That
# is accepted deliberately — a frame two thirds smaller prevents more dumps than it obscures.
#
# Per-SOURCE-FILE, and NOT a CONFIG_COMPILER_* key in sdkconfig.defaults, for the same two reasons
# the warning contract above is component-PRIVATE: a Kconfig key is global and would re-optimise
# ESP-IDF and the managed components too, and sdkconfig.defaults is hashed into CI's ccache key
# (scripts/idf-version.sh), so this would discard every cached object it cannot invalidate. Scoped
# this way the command line changes for exactly one object.
#
# Re-measure after anything that grows this builder (the command is in docs/ARCHITECTURE.md under
# "Memory constraints"); read the worst PATH, never the biggest FRAME, and never an idle heap
# number.
set_source_files_properties(http_status.cpp PROPERTIES COMPILE_OPTIONS "-Os")

# Assemble, minify and pre-compress the web UI at build time. The sources are split for edit locality —
# www/index.html, www/style.css and the ordered JavaScript fragments in www/app.sources — and
# inline_assets.cmake splices them back into the ONE self-contained page the device serves.
# The editable sources keep their load-bearing comments; the offline Python step strips HTML, CSS
# and JS comments plus asset whitespace from the artefact only, then produces deterministic gzip.
# All THREE languages, because the markup was the one that leaked: index.html is spliced in raw, so
# until it was measured its 39 KB of drawing/layout commentary shipped inside the image — 14 KB
# gzipped, 9.5% of this budget, on text no browser can read.  The size budget makes UI growth a
# build failure instead of silently multiplying TCP windows again.
# Symbols: _binary_index_html_gz_{start,end} (see h_index in http_status.cpp).
set(APP_JS_MANIFEST "${CMAKE_CURRENT_SOURCE_DIR}/www/app.sources")
set(UI_MINIFIER "${CMAKE_CURRENT_SOURCE_DIR}/../tools/web_asset/minify_and_gzip.py")
set(UI_LOCALE_MINIFIER "${CMAKE_CURRENT_SOURCE_DIR}/../tools/web_asset/minify_js_and_gzip.py")
set(UI_MINIFIER_VENDOR
    "${CMAKE_CURRENT_SOURCE_DIR}/../tools/web_asset/vendor/rjsmin.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/../tools/web_asset/vendor/rcssmin.py")
# The default-off X10A diagnosis form/result renderer added 3.3 KiB compressed to the former
# 150 KiB ceiling. Keep a measured 160 KiB cap rather than disabling the gate or rounding it away.
set(UI_GZIP_MAX_BYTES 163840)
idf_build_get_property(PYTHON PYTHON)
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
    COMMAND ${PYTHON} "${UI_MINIFIER}"
            --input "${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html"
            --output "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz"
            --max-gzip-bytes ${UI_GZIP_MAX_BYTES}
    DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html"
            "${UI_MINIFIER}"
            ${UI_MINIFIER_VENDOR}
    COMMENT "Minifying and gzipping web UI (limit: ${UI_GZIP_MAX_BYTES} bytes)"
    VERBATIM)
add_custom_target(gen_index_gz DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz")
add_dependencies(${COMPONENT_LIB} gen_index_gz)

# Non-English dashboard catalogs are device-local, separately compressed assets. Keeping them out
# of index.html preserves the 150 KiB single-response startup contract while /locale.js selects one
# asset by its query parameter. Each file is still linked into the signed application image; no
# network service participates in localization. A separate tight cap prevents a catalog from
# quietly becoming another large response even though it is served straight from flash.
set(UI_LOCALE_GZIP_MAX_BYTES 32768)
set(UI_LOCALE_OUTPUTS "")
foreach(locale IN LISTS UI_LOCALE_CODES)
    set(locale_src "${CMAKE_CURRENT_SOURCE_DIR}/www/locales/${locale}.js")
    set(locale_gz "${CMAKE_CURRENT_BINARY_DIR}/locale-${locale}.js.gz")
    add_custom_command(
        OUTPUT "${locale_gz}"
        COMMAND ${PYTHON} "${UI_LOCALE_MINIFIER}"
                --input "${locale_src}"
                --output "${locale_gz}"
                --max-gzip-bytes ${UI_LOCALE_GZIP_MAX_BYTES}
        DEPENDS "${locale_src}" "${UI_LOCALE_MINIFIER}" "${UI_MINIFIER}" ${UI_MINIFIER_VENDOR}
        COMMENT "Minifying and gzipping ${locale} UI locale"
        VERBATIM)
    list(APPEND UI_LOCALE_OUTPUTS "${locale_gz}")
endforeach()
add_custom_target(gen_locale_gz DEPENDS ${UI_LOCALE_OUTPUTS})
add_dependencies(${COMPONENT_LIB} gen_locale_gz)

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
