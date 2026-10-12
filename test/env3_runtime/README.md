# ENV III production runtime fixture

`node test/test_src_runtime.mjs` compiles the complete current `main/env3.cpp`, with the real
configuration model, CRC/compensation helpers and board rules. I2C handles, task scheduling, clocks
and history recording are deterministic SDK-shaped adapters. Eight named cases cover startup,
probe identity/CRC, resource failure/cleanup, partial initialization retry, sample failure and
recovery, exact freshness boundaries, and task startup under a failing Config-copy service.
Six temporary source mutations must fail their corresponding named assertion, including restoring
the original uncaught task-entry Config copy.

The synthetic calibration/sample bytes are test inputs, not a measurement from an attached module.
The adapter verifies handle lifetime and calls; it cannot establish electrical compatibility,
real sensor presence, physical units, RTOS races, stack usage or history persistence. The fixture
stops the infinite task at its poll delay and does not contact a device.
