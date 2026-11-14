FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

# The real locale producer compiles the vendored Zopfli encoder in its private runtime cache.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc-13 libc6-dev \
    && rm -rf /var/lib/apt/lists/*
ENV HOST_CC=/usr/bin/gcc-13

WORKDIR /opt/daikin-browser
COPY tools/browser/package.json tools/browser/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && node -e 'require("node:fs").symlinkSync(require("playwright").chromium.executablePath(), "/opt/daikin-browser/chromium")' \
    && npm cache clean --force

ENV DAIKIN_BROWSER_CONTAINER=1
ENV CI=true
ENV HOME=/tmp
WORKDIR /project
COPY . /project/
RUN chmod -R a+rX /project
