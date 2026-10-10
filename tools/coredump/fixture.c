// Synthetic-only unstripped application for the real pinned coredump decoder. Never flashed.
typedef struct {
    unsigned* pxTopOfStack;
    unsigned* pxStack;
    unsigned* pxEndOfStack;
    unsigned  uxPriority;
    unsigned  uxBasePriority;
    char      pcTaskName[16];
} TCB_t;

TCB_t fixture_tcb = {(unsigned*)0x3fc81100, (unsigned*)0x3fc81000, (unsigned*)0x3fc81200, 5, 5,
                     "fixture_task"};
volatile unsigned fixture_tag = FIXTURE_TAG;

__attribute__((noinline, used)) void fixture_leaf(void) { __asm__ volatile("nop"); }

void _start(void) {
    fixture_leaf();
    for (;;) {}
}
