// Doc entity-id audit — does every Home Assistant entity id the DOCS quote actually exist?
//
// The docs hand the reader copy-pasteable YAML: template sensors, automations, a virtual heat meter.
// Every one of them names entity ids like `sensor.daikin_altherma_inlet_water_temp_r4t`. An id is
// derived from a catalog LABEL (logic/ha_device.hpp ha_slug), so it is only as stable as the label —
// and the catalog spells the same quantity several ways across models, which no reader of the doc
// can see.
//
// This rots in the worst possible way: SILENTLY, and looking like the user's fault. A recipe naming
// an id that no profile publishes does not error. Home Assistant creates the template sensor, its
// `availability` guard evaluates `states('sensor.…') | is_number` against `unknown`, returns false
// forever, and the sensor sits at `unavailable`. The reader concludes their heat pump does not
// support the feature. Nothing anywhere says "that id was never real".
//
// Found on the first run (2026-07-29), in the heat-meter recipe that had shipped since #206:
//   sensor.daikin_altherma_flow_rate_lmin              — no profile, and not even a valid slug of
//                                                        the label it was derived from ("l/min"
//                                                        slugs to `l_min`, not `lmin`)
//   sensor.daikin_altherma_return_water_temp_before_phe_r4t
//                                                      — real label, but ONLY in
//                                                        def/altherma3_r_erga.hpp, the hand-written
//                                                        host-test fixture that
//                                                        def::is_detection_model() explicitly
//                                                        refuses as a detection candidate
//
// That second one is why this checks DETECTABLE profiles rather than the whole registry. Resolving
// against every table would have called the recipe clean: the label does exist — on a profile no
// device can ever be assigned. `generic` is excluded for the same reason it is not a detection
// candidate; it is the fallback for a unit nothing matched, not a model to write a recipe against.
//
// Deliberately NOT a check that the id is right for EVERY profile. Requiring universal coverage
// would fail the docs for stating a majority id and naming the alternatives beside it, which is what
// they should do — the catalog genuinely disagrees across models. The question here is narrower and
// decidable: does this id exist ANYWHERE a real device could produce it?
//
// Reads the ids out of the docs with a deliberately dumb scan (any `sensor.`/`binary_sensor.`
// token carrying the device-name prefix) and resolves each through the REAL ha_slug over the REAL
// catalog, so there is no second copy of the id rule to drift from the firmware's.
//
// Usage: entity_id_audit <device-prefix> <doc.md> [doc.md ...]
// Exit:  0 = clean, 1 = findings, 2 = usage/read error.
#include <cctype>
#include <cstdio>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "logic/availability.hpp"
#include "logic/conv_override.hpp"
#include "logic/discovery.hpp"
#include "def/registry.hpp"
#include "def/overlay.hpp"
#include "def/signatures.hpp"

using namespace daik;

namespace {

struct Quote {
    std::string id;      // the full entity id as written, e.g. sensor.daikin_altherma_foo
    std::string file;
    int         line;
};

// Every entity id the published catalog can produce, mapped to the profiles that carry it. Built
// from the resolved VIEW (overlay rows included) and filtered exactly as mqtt_ha filters what it
// announces, so an id that is here is one a real device really publishes.
std::map<std::string, std::set<std::string>> catalog_ids(const std::string& prefix) {
    std::map<std::string, std::set<std::string>> out;
    for (const auto& p : def::profiles) {
        if (!def::is_detection_model(p.id)) continue;   // fixtures + `generic` cannot be assigned
        const logic::ProfileView v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            const ValueDef d = logic::adjudicated(v[i]);
            if (!row_publishable(d) || !conv_publishable(d.conv)) continue;
            const std::string obj = object_id(d.label);
            if (obj.empty()) continue;
            const char* domain = conv_is_binary(d.conv) ? "binary_sensor." : "sensor.";
            out[domain + prefix + "_" + obj].insert(p.id);
        }
    }
    return out;
}

bool id_char(char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '.'; }

// Pull every `sensor.<prefix>_…` / `binary_sensor.<prefix>_…` token out of one file. Dumb on
// purpose: it must find ids inside YAML, Jinja templates, prose, tables and code fences alike, and a
// parser per context is a parser per context to get wrong.
void scan(const std::string& path, const std::string& prefix, std::vector<Quote>& out) {
    std::ifstream f(path);
    if (!f) { std::fprintf(stderr, "entity_id_audit: cannot read %s\n", path.c_str()); std::exit(2); }
    const std::string needles[2] = {"sensor." + prefix + "_", "binary_sensor." + prefix + "_"};
    std::string line;
    int n = 0;
    while (std::getline(f, line)) {
        n++;
        for (const std::string& needle : needles) {
            size_t at = 0;
            while ((at = line.find(needle, at)) != std::string::npos) {
                // "binary_sensor.x" also contains "sensor.x" — take the longest match by skipping a
                // hit whose preceding character is part of an identifier.
                if (at > 0 && id_char(line[at - 1])) { at += needle.size(); continue; }
                size_t end = at;
                while (end < line.size() && id_char(line[end])) end++;
                out.push_back({line.substr(at, end - at), path, n});
                at = end;
            }
        }
    }
}

}   // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s <device-prefix> <doc.md> [doc.md ...]\n", argv[0]);
        return 2;
    }
    const std::string prefix = argv[1];

    const auto known = catalog_ids(prefix);
    std::vector<Quote> quotes;
    for (int i = 2; i < argc; i++) scan(argv[i], prefix, quotes);

    size_t detectable = 0;
    for (const auto& p : def::profiles) if (def::is_detection_model(p.id)) detectable++;

    int findings = 0;
    std::set<std::string> reported;   // one finding per distinct id, not per occurrence
    for (const Quote& q : quotes) {
        if (known.count(q.id)) continue;
        if (!reported.insert(q.id).second) continue;
        findings++;
        std::printf("  [E-ID] %s:%d  %s\n", q.file.c_str(), q.line, q.id.c_str());
        std::printf("         no detectable profile publishes this entity.\n");
        // A near miss is the common case (a slug typo, or an id taken from a fixture profile), and
        // naming the closest real id turns "wrong" into "here is what you meant".
        //
        // The bar is a FRACTION of the id, not an absolute character count: every id shares the
        // `sensor.<prefix>_` head, so counting raw matched characters makes one coincidental letter
        // past that head look like a strong match. It did — the first version answered
        // `return_water_temp_before_phe_r4t` with `refrig_temp_evap_in`, an unrelated refrigerant
        // row, purely on the shared `…_r`. A confidently wrong suggestion is worse than none here:
        // it is the one line a reader would paste without checking.
        std::string best;
        size_t best_score = 0;
        for (const auto& kv : known) {
            size_t i = 0;
            while (i < kv.first.size() && i < q.id.size() && kv.first[i] == q.id[i]) i++;
            if (i > best_score) { best_score = i; best = kv.first; }
        }
        const size_t shorter = best.empty() ? 0 : std::min(best.size(), q.id.size());
        if (!best.empty() && best_score * 5 >= shorter * 3)   // >= 60 % of the shorter id
            std::printf("         closest published id: %s  (%zu/%zu profiles)\n",
                        best.c_str(), known.at(best).size(), detectable);
    }

    std::printf("doc entity ids: %s — %zu quoted (%zu distinct) in %d file(s), "
                "resolved against %zu detectable profiles publishing %zu distinct ids\n",
                findings ? "FINDINGS" : "clean",
                quotes.size(),
                [&] { std::set<std::string> s; for (const auto& q : quotes) s.insert(q.id); return s.size(); }(),
                argc - 2, detectable, known.size());
    return findings ? 1 : 0;
}
