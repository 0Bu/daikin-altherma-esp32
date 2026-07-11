idf_component_register(
    SRCS
        "main.cpp"
        "config.cpp"
        "nvs_storage.cpp"
        "wifi.cpp"
        "hp_comm.cpp"
        "hp_convert.cpp"
        "hp_poll.cpp"
        "http_server.cpp"
        "http_common.cpp"
        "http_status.cpp"
        "http_config.cpp"
        "http_ota.cpp"
        "mcp_server.cpp"
        "provisioning.cpp"
        "captive_dns.cpp"
        "mqtt_ha.cpp"
        "ota_update.cpp"
        "control.cpp"
        "diag_log.cpp"
    INCLUDE_DIRS
        "."
    EMBED_FILES
        "${CMAKE_CURRENT_BINARY_DIR}/index.html.gz"
        "${CMAKE_CURRENT_BINARY_DIR}/setup.html.gz"
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
        esp_driver_gpio
        esp_driver_uart
        mqtt
        esp_timer
        bootloader_support
        mdns
)

# Assemble + pre-compress the web UI at build time. The sources are split for edit locality —
# www/index.html (markup with inline markers), www/style.css, www/app.js — and
# inline_assets.cmake splices them back into the ONE self-contained page the device serves.
# Browsers always accept gzip, so shipping the page pre-gzipped cuts bytes on the wire ~3x —
# the single biggest lever for first-paint over a high-latency WiFi link. Regenerated on every
# build, so the served page never goes stale. Symbols: _binary_index_html_gz_{start,end}
# (see handle_index in http_status.cpp).
add_custom_command(
    OUTPUT  "${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html"
    COMMAND ${CMAKE_COMMAND}
            -DHTML=${CMAKE_CURRENT_SOURCE_DIR}/www/index.html
            -DCSS=${CMAKE_CURRENT_SOURCE_DIR}/www/style.css
            -DJS=${CMAKE_CURRENT_SOURCE_DIR}/www/app.js
            -DOUT=${CMAKE_CURRENT_BINARY_DIR}/index_inlined.html
            -P ${CMAKE_CURRENT_SOURCE_DIR}/www/inline_assets.cmake
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/www/index.html"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/style.css"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/app.js"
            "${CMAKE_CURRENT_SOURCE_DIR}/www/inline_assets.cmake"
    COMMENT "Inlining web UI assets (index.html + style.css + app.js)"
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
