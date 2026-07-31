# Build-time re-assembly of the web UI: splice www/style.css and the JavaScript source(s) back into
# the marker lines in www/index.html, producing the ONE self-contained page the firmware embeds
# (then gzips — see main/CMakeLists.txt). The sources are split for edit locality only; the served
# asset has the same single-classic-script execution model as a hand-written monolithic index.html.
#
#   cmake -DHTML=<index.html> -DCSS=<style.css> -DJS=<app.js> -DOUT=<out.html> -P inline_assets.cmake
#   cmake -DHTML=<index.html> -DCSS=<style.css> -DJS_MANIFEST=<app.sources> \
#         -DOUT=<out.html> -P inline_assets.cmake
#
# string(FIND/REPLACE) is used instead of configure_file so the CSS/JS content is treated as
# opaque bytes — no @VAR@ / ${VAR} substitution can ever mangle the assets.

foreach(v HTML CSS OUT)
    if(NOT DEFINED ${v})
        message(FATAL_ERROR "inline_assets.cmake: missing -D${v}=<path>")
    endif()
endforeach()
if((DEFINED JS AND DEFINED JS_MANIFEST) OR (NOT DEFINED JS AND NOT DEFINED JS_MANIFEST))
    message(FATAL_ERROR "inline_assets.cmake: pass exactly one of -DJS or -DJS_MANIFEST")
endif()

file(READ "${HTML}" page)
file(READ "${CSS}" css)
if(DEFINED JS)
    file(READ "${JS}" js)
else()
    get_filename_component(js_base "${JS_MANIFEST}" DIRECTORY)
    file(STRINGS "${JS_MANIFEST}" js_entries ENCODING UTF-8)
    set(js "")
    set(js_count 0)
    foreach(raw IN LISTS js_entries)
        string(STRIP "${raw}" rel)
        if(rel STREQUAL "" OR rel MATCHES "^#")
            continue()
        endif()
        if(IS_ABSOLUTE "${rel}" OR rel MATCHES "(^|/)\\.\\.(/|$)")
            message(FATAL_ERROR "inline_assets.cmake: unsafe JS manifest entry '${rel}'")
        endif()
        if(NOT rel MATCHES "\\.js$")
            message(FATAL_ERROR "inline_assets.cmake: JS manifest entry is not .js: '${rel}'")
        endif()
        set(js_file "${js_base}/${rel}")
        if(NOT EXISTS "${js_file}")
            message(FATAL_ERROR "inline_assets.cmake: JS manifest entry not found: '${rel}'")
        endif()
        file(READ "${js_file}" js_part)
        string(APPEND js "${js_part}")
        math(EXPR js_count "${js_count} + 1")
    endforeach()
    if(js_count EQUAL 0)
        message(FATAL_ERROR "inline_assets.cmake: no JavaScript sources in ${JS_MANIFEST}")
    endif()
endif()

# Each marker must appear EXACTLY once, and must not appear inside the assets themselves —
# both would silently ship a broken page, so turn them into hard build errors.
foreach(pair "/*@@INLINE:style.css@@*/\n;CSS" "//@@INLINE:app.js@@\n;JS")
    list(GET pair 0 marker)
    list(GET pair 1 label)
    string(FIND "${page}" "${marker}" first_at)
    string(FIND "${page}" "${marker}" last_at REVERSE)
    if(first_at EQUAL -1)
        message(FATAL_ERROR "inline_assets.cmake: ${label} marker not found in ${HTML}")
    endif()
    if(NOT first_at EQUAL last_at)
        message(FATAL_ERROR "inline_assets.cmake: ${label} marker appears more than once in ${HTML}")
    endif()
endforeach()
foreach(asset css js)
    foreach(marker "/*@@INLINE:style.css@@*/" "//@@INLINE:app.js@@")
        string(FIND "${${asset}}" "${marker}" hit)
        if(NOT hit EQUAL -1)
            message(FATAL_ERROR "inline_assets.cmake: marker text '${marker}' found inside the ${asset} asset")
        endif()
    endforeach()
endforeach()

string(REPLACE "/*@@INLINE:style.css@@*/\n" "${css}" page "${page}")
string(REPLACE "//@@INLINE:app.js@@\n" "${js}" page "${page}")

file(WRITE "${OUT}" "${page}")
