# syntax=docker/dockerfile:1
ARG IDF_VERSION
FROM espressif/idf:${IDF_VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang-18 libclang-rt-18-dev \
    && rm -rf /var/lib/apt/lists/*
