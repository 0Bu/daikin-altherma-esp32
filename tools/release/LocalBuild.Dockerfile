# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
ARG IDF_VERSION
FROM espressif/idf:${IDF_VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang-18 libclang-rt-18-dev \
    && rm -rf /var/lib/apt/lists/*
