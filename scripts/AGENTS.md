# Script Execution & Portability Invariants

1. **Strict Shell Safety**: Every bash script must include `set -euo pipefail` (or appropriate fail-closed options) immediately following the shebang.
2. **Cross-Platform Portability**: Scripts must execute cleanly on both Linux and macOS environments. Avoid GNU-specific coreutils flags or unportable shell extensions without POSIX or macOS fallbacks.
3. **Non-Interactive Execution**: Scripts must run deterministically in unattended CI environments without hanging on interactive prompts or pagers.
4. **Exit Code Conventions**: Exit `0` on success, `1` on gate findings or contract violations, and `2` on runtime/usage errors.
