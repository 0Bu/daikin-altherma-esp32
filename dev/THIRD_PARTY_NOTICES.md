# Third-party notices

This project is licensed under the MIT License in [`LICENSE`](LICENSE). The firmware and its build
and installer tooling also use or are derived from the projects below. Versions used by firmware
builds are recorded in [`dependencies.lock`](dependencies.lock); installer versions are pinned in
[`docs/index.html`](docs/index.html).

## ESPAltherma

Parts of the X10A protocol and value definitions were derived from
[ESPAltherma](https://github.com/raomin/ESPAltherma), Copyright (c) 2020 Raomin, under the MIT
License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## ESP-IDF and Espressif components

Firmware builds use [ESP-IDF](https://github.com/espressif/esp-idf) 6.0.2 and these Espressif
components: cJSON 1.7.19~2, led_strip 3.0.3, mDNS 1.11.3, ESP-MQTT 1.1.0, W5500 2.0.0 and
wiznet_common 1.0.0.

ESP-IDF and the listed components other than cJSON are licensed under Apache-2.0. A complete copy
of the Apache License 2.0 is distributed beside this notice as `Apache-2.0.txt`; its canonical
source copy is tracked at `tools/web_asset/vendor/LICENSE`.

cJSON is Copyright (c) 2009-2017 Dave Gamble and cJSON contributors and is licensed under the MIT
License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Web tooling

- [`esptool-js`](https://github.com/espressif/esptool-js) 0.6.1 is loaded by the Web Serial
  installer and is licensed under Apache-2.0. Its published bundle contains pako 2.1.0, licensed
  under MIT and Zlib terms.
- `rjsmin.py` 1.2.4 and `rcssmin.py` 1.2.1 are vendored build-only minifiers, Copyright 2011-2025
  André Malo or his licensors, licensed under Apache-2.0. Their license and detailed notice are in
  [`tools/web_asset/vendor/`](tools/web_asset/vendor/README.md).

The names Daikin, Espressif, ESP-IDF, ESPAltherma and those of other projects remain the property of
their respective owners. This project is not affiliated with or endorsed by Daikin.
