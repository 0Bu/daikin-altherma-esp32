# syntax=docker/dockerfile:1@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
ARG IDF_VERSION
FROM espressif/idf:${IDF_VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang-18 libclang-rt-18-dev \
    && rm -rf /var/lib/apt/lists/*
