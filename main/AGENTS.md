# Firmware scope

The root `AGENTS.md` owns memory, concurrency, HTTP exception and stack rules. Apply them to every
firmware caller, including tasks outside the file being changed. Use `docs/ARCHITECTURE.md` for
component ownership and measured budgets; source changes cannot establish live-device headroom.
