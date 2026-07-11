#pragma once
// Optional coarse control (off unless pins configured): an on/off thermostat relay exposed as a
// Home Assistant switch, and the SG-Ready smart-grid contacts (sg/set 0..3 -> SG1/SG2, current
// mode on sg/state). This is the ONLY output path; monitoring itself is read-only. Pin choice
// and SG mode mapping per docs/README.md → Optional control.

namespace daik {

void control_init();                 // configure GPIOs if therm_pin/sg*_pin != -1; else no-op
void control_set_thermostat(bool on);
void control_set_sg_mode(int mode);  // 0..3
int  control_sg_mode();

} // namespace daik
