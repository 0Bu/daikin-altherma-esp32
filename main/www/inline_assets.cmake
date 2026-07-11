# Build-time re-assembly of the web UI: splice www/style.css and www/app.js back into the
# marker lines in www/index.html, producing the ONE self-contained page the firmware embeds
# (then gzips — see main/CMakeLists.txt). The sources are split for edit locality only; the
# served asset is byte-identical to a hand-written monolithic index.html.
#
#   cmake -DHTML=<index.html> -DCSS=<style.css> -DJS=<app.js> -DOUT=<out.html> -P inline_assets.cmake
#
# string(FIND/REPLACE) is used instead of configure_file so the CSS/JS content is treated as
# opaque bytes — no @VAR@ / ${VAR} substitution can ever mangle the assets.

foreach(v HTML CSS JS OUT)
    if(NOT DEFINED ${v})
        message(FATAL_ERROR "inline_assets.cmake: missing -D${v}=<path>")
    endif()
endforeach()

file(READ "${HTML}" page)
file(READ "${CSS}" css)
file(READ "${JS}" js)

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
