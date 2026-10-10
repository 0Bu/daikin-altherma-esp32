# Schematic audit finding definitions

Read this when interpreting `scripts/run-schematic-audit.sh` output. The exception and merge
rules remain in [the skill](../SKILL.md).

| Code | Means |
|---|---|
| `S001` | A hit target with no `INSPECT` entry — tapping it opens an empty panel. **Not adjudicable.** |
| `S002` | An `INSPECT` entry with no hit target — copy nobody can reach. |
| `S003` / `S010` | A `sample` that names no catalog register / matches no `DESCRIPTIONS` entry (a blank explainer). |
| `S004` / `S005` | An `id` the SVG declares and the assembled UI never writes, or the reverse — a silent no-op either way. |
| `S006` | A `data-i18n` key missing from a language dict — a locale prints fallback English, or the raw key. |
| `S007` / `S008` / `S009` | Duplicate id / dangling `<use>` / character data adrift in the SVG. |
| `S011` | A drawn pipe inside no hit target — unhoverable, and it fails by absence: nothing looks wrong. |
| `G001`–`G005` | Outside the viewBox, overlapping, struck through by a pipe, overflowing its pill, skewed. |
| `G006` | A pill too far from — or not over — the run it names. The defect class the gate exists for. |
| `G007` / `G012` | A rotor whose bounding box is not centred on its hub, or the pump rotating counter-clockwise instead of clockwise. |
| `G008` / `G009` | A run off the two-level grid, or a box whose margins no longer match it. |
| `G010` | An animated flow overlay tracing no drawn pipe — the two copies of one path have drifted. |
| `G011` | A run's *invisible* tap area reaching into a fitting drawn earlier. The hit lines are `stroke-linecap: round`, so each covers half a stroke past its declared endpoint; every trim had been computed as if the cap were flat, and the 3-way valve outlined itself on hover and then opened the DHW branch. Says nothing about two hit lines meeting — that place is genuinely shared, and `E004` decides whose it is. |
| `G013` | Neighbouring labels on one baseline collide in a shipped locale. |
| `E001` | A pill whose unit repeats in the drawing and which carries no name. |
| `E002` | A reading drawn past a junction, on a branch its sensor does not read. **Not adjudicable.** |
| `E003` / `E004` | A flow overlay, or a hit target, spanning a junction — one animation (or one highlight) asserting two branches' states at once. |

