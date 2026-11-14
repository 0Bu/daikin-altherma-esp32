FROM ubuntu:26.04@sha256:0d5255be560e2d2ddcfbfda88549e9e815ef29e7cd7fc62183d5709e6e2963c6
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ git nodejs python3 \
    && rm -rf /var/lib/apt/lists/*
