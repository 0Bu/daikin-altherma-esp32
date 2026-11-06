FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d

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
