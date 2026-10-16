/* Build-only stdin/stdout adapter for the vendored gzip encoder. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "gzip_container.h"

int main(void) {
    size_t         size = 0, capacity = 8192, output_size = 0;
    unsigned char* input  = malloc(capacity);
    unsigned char* output = NULL;
    if (!input) return 1;
    while (!feof(stdin)) {
        if (size == capacity) {
            if (capacity > SIZE_MAX / 2) {
                free(input);
                return 1;
            }
            capacity *= 2;
            unsigned char* grown = realloc(input, capacity);
            if (!grown) {
                free(input);
                return 1;
            }
            input = grown;
        }
        size += fread(input + size, 1, capacity - size, stdin);
        if (ferror(stdin)) {
            free(input);
            return 1;
        }
    }
    ZopfliOptions options;
    ZopfliInitOptions(&options);
    options.numiterations = 5;
    ZopfliGzipCompress(&options, input, size, &output, &output_size);
    free(input);
    const int failed = fwrite(output, 1, output_size, stdout) != output_size || fflush(stdout);
    free(output);
    return failed ? 1 : 0;
}
