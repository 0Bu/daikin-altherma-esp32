// Domain-correctness audit of the shipped value catalog — the mechanical half of the
// /domain-review merge gate. Answers "are these values physically RIGHT?", not "does it compile?".
//
// WHY THIS EXISTS. The technical gates (/project-review, /feature-docs) check consistency and doc
// drift; the host tests check the logic they are given. None of them can see a value that is
// well-formed, compiles, passes every test — and is physically wrong. That class shipped on main in
// eight profiles at once (see the 2026-07-16 review): a mixed-water temperature decoded with the
// wrong converter published -971.5 °C, a bizone valve POSITION was published to Home Assistant as a
// 12800 °C temperature sensor, an expansion-valve row swallowed the neighbouring Fan-2 byte, and a
// "no data" sentinel was published as a real -3276.8 °C reading. Every one of those was found by a
// slow manual review, and every one is mechanically detectable. This program detects them.
//
// It runs the REAL converter (logic/convert.hpp) over the REAL catalog (def/registry.hpp) — the
// same source of truth the firmware uses, so there is no second implementation to drift — and
// cross-checks both against the authoritative spec tables in docs/REGISTERS.md §5.
//
// Checks (see check_* below):
//   SPEC-CONV    a row whose label the spec knows must decode the way the spec says.
//   SPEC-LAYOUT  a row on a SHARED page must match some spec entry at its (reg, offset).
//   CONSENSUS    a row that contradicts the same-named row in the rest of the catalog.
//   LABEL-UNIT   one wire field described by two different physical UNITS across the catalog.
//   SEMANTICS    a non-temperature quantity published as a temperature (HA device_class).
//   OVERLAP      two rows in one register whose byte windows partially collide.
//
// Findings carry a DECODE WITNESS: concrete wire bytes, what the spec/majority decodes them to,
// and what this row decodes them to — the same evidence the manual review produced by hand.
//
// A finding is a question, not a verdict: a model may genuinely differ from the representative
// table (docs/REGISTERS.md:196-200). Adjudicated deviations go in tools/domain/audit_exceptions.txt
// with a reason, and stay listed as "suppressed" — never silently dropped.
//
// Build/run: scripts/run-domain-audit.sh   (exit 0 = clean, 1 = findings, 2 = usage/parse error)
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "logic/convert.hpp"
#include "logic/discovery.hpp"        // object_id / group_for_page — a label IS an identifier (#217)
#include "logic/label_override.hpp"   // the PUBLISHED label, when the generator's is wrong (#230 A)

using namespace daik;

namespace {

// ── Label identity ────────────────────────────────────────────────────────────────────────────
// Spec prose and generated rows differ in punctuation/spacing/case for the same value
// ("Mixed water temp." vs "Mixed Water Temp"), so identity is the alphanumeric skeleton.
std::string norm_label(const std::string& s) {
    std::string o;
    for (unsigned char c : s) {
        if (std::isalnum(c)) o += static_cast<char>(std::tolower(c));
    }
    return o;
}

// ── Type / unit vocabulary ────────────────────────────────────────────────────────────────────
// ValueDef::type is the HA unit hint (logic/discovery.hpp): 1=°C, 2=bar, 3=A, -1=generic.
// The spec's Type column carries the unit text (blank = generic).
int type_from_spec(const std::string& s) {
    if (s == "°C") return 1;
    if (s == "bar") return 2;
    if (s == "A") return 3;
    return -1;
}
std::string type_name(int t) {
    switch (t) {
        case 1:  return "°C";
        case 2:  return "bar";
        case 3:  return "A";
        default: return "-";
    }
}

std::string hex2(int v) {
    char b[8];
    std::snprintf(b, sizeof(b), "0x%02X", v);
    return b;
}
std::string fmt(double v) {
    char b[32];
    std::snprintf(b, sizeof(b), "%.2f", v);
    return b;
}

// ── Physical envelopes ────────────────────────────────────────────────────────────────────────
// `sane` = where a witness sample is drawn from (a value the unit could really report right now).
// `absurd` = outside any physical possibility for the quantity — the -971.5 °C / 12800 °C signal.
// Only quantities with a declared unit can be judged; a generic row has no envelope (lo>hi).
struct Envelope {
    double sane_lo, sane_hi, abs_lo, abs_hi;
    bool   known;
};
Envelope envelope_for(int type) {
    switch (type) {
        case 1:  return {20.0, 40.0, -60.0, 200.0, true};    // water/refrigerant/air temperature
        case 2:  return {1.0, 30.0, -1.0, 100.0, true};      // refrigerant pressure
        case 3:  return {0.5, 20.0, -1.0, 200.0, true};      // current
        default: return {0, 0, 0, 0, false};
    }
}

// ── Spec model ────────────────────────────────────────────────────────────────────────────────
struct SpecRow {
    int         reg = 0, off = 0, len = 0, conv = 0, type = -1, line = 0;
    std::string label, nlabel;
};

// Pages the spec table describes for EVERY family. docs/REGISTERS.md:196-200: the table is a
// REPRESENTATIVE model — outdoor pages (0x00-0x30) are shared "almost verbatim", the hydronic
// pages (0x60+) legitimately vary per family. So the by-OFFSET layout check applies only here;
// the by-LABEL check applies everywhere (a named value's converter does not change per model —
// a model either carries the value or it does not).
bool shared_page(int reg) { return reg <= 0x30; }

std::vector<std::string> split_row(const std::string& line) {
    std::vector<std::string> f;
    std::string cur;
    for (char c : line) {
        if (c == '|') {
            f.push_back(cur);
            cur.clear();
        } else {
            cur += c;
        }
    }
    f.push_back(cur);
    for (auto& s : f) {
        size_t a = s.find_first_not_of(" \t\r\n");
        size_t b = s.find_last_not_of(" \t\r\n");
        s = (a == std::string::npos) ? "" : s.substr(a, b - a + 1);
    }
    return f;
}

bool all_digits(const std::string& s) {
    return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c); });
}

// ── The unit word inside a label ───────────────────────────────────────────────────────────────
// A parenthesised token naming a physical unit — what check_label_unit compares. Everything else a
// label puts in brackets is deliberately NOT here: a sensor tag ("(R1T)"), a circuit selector
// ("(main)", "(add)"), an accessory code ("(DLWA2)"), the saturation-temperature marker "(T)" and an
// encoding note ("(0:max-100:stop)") all say WHICH instance or HOW it is encoded, never what is
// measured. A vocabulary rather than a pattern, because the finding asserts a physical claim: an
// unrecognised bracket is left alone instead of guessed at.
struct UnitTok {
    bool        found = false;
    std::string raw, unit;
};

UnitTok unit_token(const std::string& label) {
    static const std::set<std::string> UNITS = {
        "step", "pls", "pulse", "rpm", "rps", "hz", "a", "ma", "v", "w", "kw", "kwh",
        "bar", "kpa", "mpa", "l/min", "l/h", "m3/h", "%", "°c", "k", "min", "s", "h",
    };
    UnitTok out;
    for (size_t p = 0; (p = label.find('(', p)) != std::string::npos;) {
        size_t e = label.find(')', p + 1);
        if (e == std::string::npos) break;
        std::string raw = label.substr(p + 1, e - p - 1);
        p               = e + 1;
        std::string n;
        for (unsigned char c : raw) n += static_cast<char>(std::tolower(c));
        size_t a = n.find_first_not_of(" \t");
        size_t b = n.find_last_not_of(" \t");
        if (a == std::string::npos) continue;
        n = n.substr(a, b - a + 1);
        // A SCALED unit is the same quantity: "10 rpm" is rpm, and the disagreement worth reporting
        // is rpm-vs-step, never 10 rpm-vs-rpm (which would be a resolution difference, not a
        // different measurand).
        size_t sp = n.find(' ');
        if (sp != std::string::npos && all_digits(n.substr(0, sp))) n = n.substr(sp + 1);
        if (!UNITS.count(n)) continue;
        out = {true, raw, n};
        return out;
    }
    return out;
}


// Parse docs/REGISTERS.md §5: "#### Register `0xNN`" sections of
// "| Off | Len | Conv | Bit | Type | Value |" tables. Only §5 is read; earlier sections hold
// converter reference/enum tables with a different shape.
std::vector<SpecRow> parse_spec(const std::string& path, std::string& err) {
    std::vector<SpecRow> out;
    std::ifstream in(path);
    if (!in) {
        err = "cannot open " + path;
        return out;
    }
    std::string line;
    int         lineno = 0, reg = -1;
    bool        in_catalog = false;
    while (std::getline(in, line)) {
        lineno++;
        if (line.rfind("## ", 0) == 0) {                       // a top-level section boundary
            in_catalog = line.rfind("## 5.", 0) == 0;
            reg        = -1;
            continue;
        }
        if (!in_catalog) continue;
        if (line.rfind("#### Register", 0) == 0) {
            size_t a = line.find("0x");
            reg      = (a == std::string::npos) ? -1 : static_cast<int>(std::stoul(line.substr(a + 2, 2), nullptr, 16));
            continue;
        }
        if (reg < 0 || line.empty() || line[0] != '|') continue;
        auto f = split_row(line);
        // "| Off | Len | Conv | Bit | Type | Value |" -> 7 fields (leading+trailing empty).
        if (f.size() < 7) continue;
        if (!all_digits(f[1]) || !all_digits(f[2]) || !all_digits(f[3])) continue;   // header/rule
        SpecRow r;
        r.reg    = reg;
        r.off    = std::stoi(f[1]);
        r.len    = std::stoi(f[2]);
        r.conv   = std::stoi(f[3]);
        r.type   = type_from_spec(f[5]);
        r.label  = f[6];
        r.nlabel = norm_label(r.label);
        r.line   = lineno;
        out.push_back(r);
    }
    if (out.empty()) err = "parsed 0 spec rows from " + path + " (format changed?)";
    return out;
}

// ── Catalog model ─────────────────────────────────────────────────────────────────────────────
struct Row {
    std::string profile;
    ValueDef    def;
    std::string nlabel;
};

// conv 405 (pressure -> saturation temperature) picks its curve from the profile's refrigerant
// row, so a witness on such a row must decode with the SAME curve the firmware would use.
std::map<std::string, int>& rtype_map() {
    static std::map<std::string, int> m;
    return m;
}
int rtype_of(const std::string& profile) {
    auto it = rtype_map().find(profile);
    return (it == rtype_map().end()) ? 802 : it->second;
}

// ── Findings ──────────────────────────────────────────────────────────────────────────────────
struct Finding {
    std::string code, sev, key;
    std::string head;                 // one-line "what"
    std::vector<std::string> detail;  // evidence lines
};

// A finding's stable identity, so an adjudicated deviation can be recorded in
// audit_exceptions.txt without muting a whole check.
std::string finding_key(const std::string& code, const std::string& profile, int reg, int off,
                        const std::string& nlabel) {
    return code + ":" + profile + ":" + hex2(reg) + ":" + std::to_string(off) + ":" + nlabel;
}

// ── Converter equivalence, proven by execution ────────────────────────────────────────────────
// Two converter ids can be different names for the same decode AT A GIVEN FIELD WIDTH. The live
// case: read_u16/read_s16 both return data[0] for size 1 (logic/registers.hpp:13), so conv 101
// (signed) and conv 152 (unsigned) are indistinguishable on a 1-byte field — the ERRA bizone rows
// rely on exactly that. Rather than hard-code such pairs (a list that rots), decide it the only way
// that cannot lie: run BOTH converters over EVERY input the field can hold and compare. If nothing
// can tell them apart, swapping them is a no-op and there is nothing to report.
bool converters_equivalent(const ValueDef& a, const ValueDef& b, int rtype) {
    if (a.conv == b.conv) return true;
    if (a.size != b.size) return false;
    const int  n     = a.size ? a.size : 1;
    const long space = (n >= 2) ? 65536 : 256;
    for (long raw = 0; raw < space; raw++) {
        uint8_t data[4] = {static_cast<uint8_t>(raw & 0xFF), static_cast<uint8_t>((raw >> 8) & 0xFF), 0, 0};
        Reading ra = convert(a, data, rtype);
        Reading rb = convert(b, data, rtype);
        if (ra.ok != rb.ok || ra.unimpl != rb.unimpl) return false;
        if (ra.ok && ra.value != rb.value) return false;
        if (std::string(ra.text) != std::string(rb.text)) return false;
    }
    return true;
}

// The refrigerant row (conv 801-805) is the one place where the converter id IS the datum: 801=R410A,
// 802=R32, 803=R22 (logic/convert.hpp). Which one a profile carries states what the unit is filled
// with, so it is model-specific BY DEFINITION and can never match a single representative spec row.
// Comparing it against the spec or the majority is a category error, not a finding.
bool is_refrigerant_const(int conv) { return conv >= 801 && conv <= 805; }

// ── Decode witness ────────────────────────────────────────────────────────────────────────────
// Search the wire for bytes that the EXPECTED converter reads as a value the unit could really
// report, then show what this row's converter makes of the very same bytes. Converter-agnostic:
// the search is over wire bytes, so the comparison is honest.
struct Witness {
    bool        found = false;
    std::string bytes, expect, actual;
    bool        actual_absurd = false;
};

Witness witness(const ValueDef& want, const ValueDef& got, int rtype) {
    Witness  w;
    Envelope env = envelope_for(want.type);
    if (!env.known) return w;
    const int  n     = want.size ? want.size : 1;
    const long space = (n >= 2) ? 65536 : 256;

    // A converter pair can differ ONLY in what it REFUSES to report. conv 114 and conv 105 do
    // identical arithmetic; 114 alone treats raw 0x8000 as "no data" and drops the reading, which
    // is the entire defect behind the -3276.8 °C bug. On every ordinary input the two agree
    // exactly — so a witness drawn from the normal operating range would print "20.00 vs 20.00"
    // and argue the reviewer OUT of a real finding. Look for the disagreement where it lives: an
    // input the spec's converter rejects and this row publishes anyway.
    for (long raw = 0; raw < space; raw++) {
        uint8_t data[4] = {static_cast<uint8_t>(raw & 0xFF), static_cast<uint8_t>((raw >> 8) & 0xFF), 0, 0};
        Reading rw      = convert(want, data, rtype);
        Reading rg      = convert(got, data, rtype);
        if (rw.unimpl || rw.ok || !rg.ok || rg.unimpl) continue;    // want rejects, got publishes
        char hb[16];
        if (n >= 2) std::snprintf(hb, sizeof(hb), "%02X %02X", data[0], data[1]);
        else        std::snprintf(hb, sizeof(hb), "%02X", data[0]);
        Envelope ge   = envelope_for(got.type);
        w.found       = true;
        w.bytes       = hb;
        w.expect      = "no reading (the unit is saying \"no data\")";
        w.actual      = fmt(rg.value) + " " + type_name(got.type) + " published as a real reading";
        w.actual_absurd = ge.known && (rg.value < ge.abs_lo || rg.value > ge.abs_hi);
        return w;
    }

    // Otherwise take the WORST honest sample, not the first. Every reading here is one the unit
    // could really report, so any of them is fair evidence — but a reviewer decides in seconds when
    // shown "39.68 °C reads as -3275.30 °C" and squints for minutes at "20.48 °C reads as 0.80 °C".
    // Prefer a sample that drives this row outside physics; failing that, the widest divergence.
    long   best = -1;
    double best_score = -1.0;
    bool   best_absurd = false;
    for (long raw = 0; raw < space; raw++) {
        uint8_t data[4] = {static_cast<uint8_t>(raw & 0xFF), static_cast<uint8_t>((raw >> 8) & 0xFF), 0, 0};
        Reading rw      = convert(want, data, rtype);
        if (!rw.ok || rw.unimpl) continue;
        if (rw.value < env.sane_lo || rw.value > env.sane_hi) continue;
        Reading rg = convert(got, data, rtype);

        bool   absurd = false;
        double score;
        if (rg.unimpl || !rg.ok) {
            score = 0.0;                       // "value silently dropped" — divergence is moot
        } else {
            Envelope ge = envelope_for(got.type);
            absurd      = ge.known && (rg.value < ge.abs_lo || rg.value > ge.abs_hi);
            score       = std::abs(rg.value - rw.value);
        }
        // An impossible reading beats any merely-large one.
        if ((absurd && !best_absurd) || (absurd == best_absurd && score > best_score)) {
            best = raw; best_score = score; best_absurd = absurd;
        }
        if (best < 0) { best = raw; best_score = score; best_absurd = absurd; }
    }
    if (best < 0) return w;

    uint8_t data[4] = {static_cast<uint8_t>(best & 0xFF), static_cast<uint8_t>((best >> 8) & 0xFF), 0, 0};
    Reading rw      = convert(want, data, rtype);
    Reading rg      = convert(got, data, rtype);
    char    hb[16];
    if (n >= 2) std::snprintf(hb, sizeof(hb), "%02X %02X", data[0], data[1]);
    else        std::snprintf(hb, sizeof(hb), "%02X", data[0]);
    w.found  = true;
    w.bytes  = hb;
    w.expect = fmt(rw.value) + " " + type_name(want.type);
    if (rg.unimpl)   w.actual = "(converter not implemented — value silently dropped)";
    else if (!rg.ok) w.actual = "(skipped: no-data sentinel)";
    else {
        w.actual              = fmt(rg.value) + " " + type_name(got.type);
        Envelope ge           = envelope_for(got.type);
        w.actual_absurd       = ge.known && (rg.value < ge.abs_lo || rg.value > ge.abs_hi);
    }
    return w;
}

void add_witness(Finding& f, const ValueDef& want, const ValueDef& got, int rtype) {
    Witness w = witness(want, got, rtype);
    if (!w.found) return;
    f.detail.push_back("witness:  wire [" + w.bytes + "] -> expected " + w.expect + " | this row " +
                       w.actual + (w.actual_absurd ? "   << PHYSICALLY IMPOSSIBLE" : ""));
}

// ── Check 1: SPEC-CONV — the spec knows this value's name; the row must decode as documented ──
// The direct detector for the mixed-water (conv 105 vs 118), M1S valve (conv 152/size 2 vs
// 101/size 1) and no-data-sentinel (conv 105 vs 114) bugs.
void check_spec_conv(const std::vector<Row>& rows, const std::vector<SpecRow>& spec,
                     std::vector<Finding>& out) {
    std::map<std::string, std::vector<const SpecRow*>> by_label;   // reg+nlabel -> entries
    for (const auto& s : spec) by_label[hex2(s.reg) + s.nlabel].push_back(&s);

    for (const auto& r : rows) {
        if (is_refrigerant_const(r.def.conv)) continue;            // the id is the model's datum
        auto it = by_label.find(hex2(r.def.reg) + r.nlabel);
        if (it == by_label.end()) continue;                        // spec doesn't name it -> silent
        const auto& cands = it->second;
        bool ok = std::any_of(cands.begin(), cands.end(), [&](const SpecRow* s) {
            if (s->len != r.def.size || s->type != r.def.type) return false;
            ValueDef sd{r.def.reg, r.def.offset, s->conv, static_cast<uint8_t>(s->len), s->type, r.def.label};
            return converters_equivalent(sd, r.def, rtype_of(r.profile));
        });
        if (ok) continue;

        const SpecRow* want = cands.front();
        Finding        f;
        f.code = "SPEC-CONV";
        f.sev  = "HIGH";
        f.key  = finding_key(f.code, r.profile, r.def.reg, r.def.offset, r.nlabel);
        f.head = r.profile + "  " + hex2(r.def.reg) + "+" + std::to_string(r.def.offset) + "  \"" +
                 r.def.label + "\"";
        f.detail.push_back("this row: conv " + std::to_string(r.def.conv) + " size " +
                           std::to_string(r.def.size) + " type " + type_name(r.def.type));
        for (const SpecRow* s : cands)
            f.detail.push_back("spec:     conv " + std::to_string(s->conv) + " len " +
                               std::to_string(s->len) + " type " + type_name(s->type) +
                               "  (docs/REGISTERS.md:" + std::to_string(s->line) + ", off " +
                               std::to_string(s->off) + ")");
        ValueDef wd{static_cast<uint8_t>(want->reg), static_cast<uint8_t>(want->off), want->conv,
                    static_cast<uint8_t>(want->len), want->type, want->label.c_str()};
        add_witness(f, wd, r.def, rtype_of(r.profile));
        out.push_back(f);
    }
}

// ── Check 2: SPEC-LAYOUT — on a shared page, the field at (reg,off) is fixed by the protocol ──
// Catches a row that redefines the wire layout: the expansion-valve row widened to size 2 over
// Fan 2's byte. Restricted to the outdoor pages the spec calls shared (docs/REGISTERS.md:196-200).
void check_spec_layout(const std::vector<Row>& rows, const std::vector<SpecRow>& spec,
                       std::vector<Finding>& out) {
    std::map<std::string, std::vector<const SpecRow*>> at;      // reg+off -> entries
    std::set<int>                                      pages;
    for (const auto& s : spec) {
        at[hex2(s.reg) + "+" + std::to_string(s.off)].push_back(&s);
        pages.insert(s.reg);
    }
    for (const auto& r : rows) {
        if (!shared_page(r.def.reg) || !pages.count(r.def.reg)) continue;
        auto it = at.find(hex2(r.def.reg) + "+" + std::to_string(r.def.offset));
        if (it == at.end()) continue;                            // spec silent at this offset
        const auto& cands = it->second;
        bool ok = std::any_of(cands.begin(), cands.end(), [&](const SpecRow* s) {
            return s->conv == r.def.conv && s->len == r.def.size;
        });
        if (ok) continue;
        // A row already reported by SPEC-CONV (same label, wrong decode) is the same defect seen
        // from the other side — report the layout view only when the label is NOT in the spec.
        bool named = std::any_of(cands.begin(), cands.end(),
                                 [&](const SpecRow* s) { return s->nlabel == r.nlabel; });
        if (named) continue;

        Finding f;
        f.code = "SPEC-LAYOUT";
        f.sev  = "HIGH";
        f.key  = finding_key(f.code, r.profile, r.def.reg, r.def.offset, r.nlabel);
        f.head = r.profile + "  " + hex2(r.def.reg) + "+" + std::to_string(r.def.offset) + "  \"" +
                 r.def.label + "\"";
        f.detail.push_back("this row: conv " + std::to_string(r.def.conv) + " size " +
                           std::to_string(r.def.size) + " type " + type_name(r.def.type) +
                           "  — reads bytes [" + std::to_string(r.def.offset) + ".." +
                           std::to_string(r.def.offset + (r.def.size ? r.def.size - 1 : 0)) + "]");
        f.detail.push_back("spec says this offset on a SHARED outdoor page carries:");
        for (const SpecRow* s : cands)
            f.detail.push_back("          conv " + std::to_string(s->conv) + " len " +
                               std::to_string(s->len) + "  \"" + s->label +
                               "\"  (docs/REGISTERS.md:" + std::to_string(s->line) + ")");
        out.push_back(f);
    }
}

// ── Check 3: CONSENSUS — the same named value must decode the same way across the catalog ──
// Backstop where the spec is silent: one profile contradicting the other N on the same
// (register, offset, label) is drift until proven otherwise.
void check_consensus(const std::vector<Row>& rows, std::vector<Finding>& out) {
    struct Variant {
        int                      conv, size, type;
        std::vector<std::string> profiles;
    };
    std::map<std::string, std::vector<Variant>> groups;
    std::map<std::string, const Row*>           sample;
    for (const auto& r : rows) {
        if (is_refrigerant_const(r.def.conv)) continue;            // R410A vs R32 is not a minority
        std::string k = hex2(r.def.reg) + "+" + std::to_string(r.def.offset) + ":" + r.nlabel;
        sample.emplace(k, &r);
        auto& vs = groups[k];
        auto  it = std::find_if(vs.begin(), vs.end(), [&](const Variant& v) {
            return v.conv == r.def.conv && v.size == r.def.size && v.type == r.def.type;
        });
        if (it == vs.end()) vs.push_back({r.def.conv, r.def.size, r.def.type, {r.profile}});
        else                it->profiles.push_back(r.profile);
    }
    for (auto& [k, vs] : groups) {
        if (vs.size() < 2) continue;
        std::sort(vs.begin(), vs.end(),
                  [](const Variant& a, const Variant& b) { return a.profiles.size() > b.profiles.size(); });
        const Variant& maj = vs[0];
        // A tie is a genuine split, not a minority -> no majority to appeal to.
        if (maj.profiles.size() == vs[1].profiles.size()) continue;
        const Row& sm = *sample[k];
        for (size_t i = 1; i < vs.size(); i++) {
            const Variant& mv = vs[i];
            for (const auto& p : mv.profiles) {
                ValueDef majd{sm.def.reg, sm.def.offset, maj.conv, static_cast<uint8_t>(maj.size),
                              maj.type, sm.def.label};
                ValueDef mind{sm.def.reg, sm.def.offset, mv.conv, static_cast<uint8_t>(mv.size),
                              mv.type, sm.def.label};
                // Same unit + a decode nothing can distinguish = a spelling difference, not drift.
                if (maj.type == mv.type && converters_equivalent(majd, mind, rtype_of(p))) continue;
                Finding f;
                f.code = "CONSENSUS";
                f.sev  = "MEDIUM";
                f.key  = finding_key(f.code, p, sm.def.reg, sm.def.offset, sm.nlabel);
                f.head = p + "  " + hex2(sm.def.reg) + "+" + std::to_string(sm.def.offset) + "  \"" +
                         sm.def.label + "\"";
                f.detail.push_back("this row:  conv " + std::to_string(mv.conv) + " size " +
                                   std::to_string(mv.size) + " type " + type_name(mv.type) + "   (" +
                                   std::to_string(mv.profiles.size()) + " profile(s))");
                f.detail.push_back("catalog:   conv " + std::to_string(maj.conv) + " size " +
                                   std::to_string(maj.size) + " type " + type_name(maj.type) + "   (" +
                                   std::to_string(maj.profiles.size()) + " profile(s))");
                ValueDef wd{sm.def.reg, sm.def.offset, maj.conv, static_cast<uint8_t>(maj.size),
                            maj.type, sm.def.label};
                ValueDef gd{sm.def.reg, sm.def.offset, mv.conv, static_cast<uint8_t>(mv.size),
                            mv.type, sm.def.label};
                add_witness(f, wd, gd, rtype_of(p));
                out.push_back(f);
            }
        }
    }
}

// ── Check 4: LABEL-UNIT — one wire field described by two different physical units ─────────────
// The label is not prose. ha_slug() turns it into the Home Assistant entity id AND the
// VictoriaMetrics series suffix (logic/discovery.hpp; test_metric_identity pins the whole set), so
// the UNIT WORD inside a label is a published claim about what the field measures.
//
// Page 0x30 offset 1 (conv 211) is spelled "Fan 1 (step)" on 22 profiles and "Fan 1 (10 rpm)" on
// four (#230) — same converter, same width, same type code, and three of the four call the
// NEIGHBOURING byte "Fan 2 (step)". Two fans on one outdoor unit are not measured in different
// quantities by the same converter, so at most one spelling is true; the false one publishes
// `actuators_fan_1_10_rpm`, where a reader takes a 30 for 300 rpm rather than step 30. That is the
// #35-#39 shape (well-formed, spec-conformant byte layout, audit-clean, and false) carried by a
// label instead of a converter.
//
// No other check here can see it. SPEC-CONV matches BY label, so a divergent label simply misses the
// spec entry and stays silent; SPEC-LAYOUT is satisfied (conv + width do match the spec at that
// offset); CONSENSUS groups BY label, so the two spellings never meet. #217's identity gate freezes
// the identifier SET, and both spellings are already in it.
//
// Decided on the UNIT alone, never on the rest of the label. The catalog legitimately spells one
// quantity several ways per family (docs/REGISTERS.md:196-200) — "[HPSU] Tv inflow Temp  (R1T)" and
// "Leaving water temp. before BUH (R1T)" are the same sensor named by two product families — so a
// check on label TEXT would demand uniform prose the source data does not have. A physical unit is
// different: it names the QUANTITY, and one field cannot carry two.
void check_label_unit(const std::vector<Row>& rows, const std::vector<SpecRow>& spec,
                      std::vector<Finding>& out) {
    struct Variant {
        std::string             unit, raw;
        std::vector<const Row*> rows;
    };
    std::map<std::string, std::vector<Variant>> groups;         // wire field -> unit variants

    // Oracle: the spec's own label at this (reg, offset), where §5 names a unit there.
    std::map<std::string, const SpecRow*> spec_at;
    for (const auto& s : spec)
        if (unit_token(s.label).found) spec_at.emplace(hex2(s.reg) + "+" + std::to_string(s.off), &s);

    // Grouped by the WHOLE wire field: two rows that decode differently are a different question,
    // and SPEC-CONV / CONSENSUS already ask it.
    for (const auto& r : rows) {
        UnitTok u = unit_token(r.def.label);
        if (!u.found) continue;
        std::string k = hex2(r.def.reg) + "+" + std::to_string(r.def.offset) + ":" +
                        std::to_string(r.def.conv) + "/" + std::to_string(r.def.size) + "/" +
                        std::to_string(r.def.type);
        auto& vs = groups[k];
        auto  it = std::find_if(vs.begin(), vs.end(),
                                [&](const Variant& v) { return v.unit == u.unit; });
        if (it == vs.end()) vs.push_back({u.unit, u.raw, {&r}});
        else                it->rows.push_back(&r);
    }

    for (auto& [k, vs] : groups) {
        (void)k;
        if (vs.size() < 2) continue;
        std::sort(vs.begin(), vs.end(),
                  [](const Variant& a, const Variant& b) { return a.rows.size() > b.rows.size(); });

        const ValueDef& field = vs[0].rows.front()->def;
        std::string     want, why;
        auto            sit = spec_at.find(hex2(field.reg) + "+" + std::to_string(field.offset));
        if (sit != spec_at.end()) {
            const std::string su = unit_token(sit->second->label).unit;
            // Only when the spec agrees with SOME spelling. A spec unit matching neither would make
            // every row here a finding on the strength of one table entry — and a whole field
            // contradicting the spec is SPEC-CONV / SPEC-LAYOUT's question, not this one.
            bool present = std::any_of(vs.begin(), vs.end(),
                                       [&](const Variant& v) { return v.unit == su; });
            if (present) {
                want = su;
                why  = "docs/REGISTERS.md:" + std::to_string(sit->second->line) + "  \"" +
                      sit->second->label + "\"";
            }
        }
        if (want.empty()) {
            // A tie is a genuine split, not a minority — there is no majority to appeal to.
            if (vs[0].rows.size() == vs[1].rows.size()) continue;
            want = vs[0].unit;
            why  = std::to_string(vs[0].rows.size()) + " profile(s) spell this field \"" +
                  vs[0].raw + "\"";
        }

        for (const auto& v : vs) {
            if (v.unit == want) continue;
            for (const Row* r : v.rows) {
                Finding f;
                f.code = "LABEL-UNIT";
                f.sev  = "HIGH";
                f.key  = finding_key(f.code, r->profile, r->def.reg, r->def.offset, r->nlabel);
                f.head = r->profile + "  " + hex2(r->def.reg) + "+" +
                         std::to_string(r->def.offset) + "  \"" + r->def.label + "\"";
                f.detail.push_back("this row: unit \"" + v.raw + "\"   (conv " +
                                   std::to_string(r->def.conv) + " size " +
                                   std::to_string(r->def.size) + " type " + type_name(r->def.type) +
                                   ")");
                f.detail.push_back("expected: unit \"" + want + "\"   — " + why);
                f.detail.push_back("one field cannot be two quantities: same converter, same width,");
                f.detail.push_back("same type code, so at most one of these spellings is true.");
                // The consequence, spelled out — the label IS the identifier (#217/#221).
                f.detail.push_back("publishes: " + std::string(group_for_page(r->def.reg)) + "_" +
                                   object_id(r->def.label) + "   (HA entity id + VictoriaMetrics" +
                                   " series suffix)");
                out.push_back(f);
            }
        }
    }
}

// ── Check 5: SEMANTICS — what Home Assistant is told this value IS ────────────────────────────
// type 1 makes discovery.hpp stamp device_class:temperature + unit °C on the entity. A valve
// position, a step count or a pulse counter carrying type 1 becomes a phantom temperature sensor.
// Deliberately conservative: it fires only on POSITIVE evidence of a non-temperature quantity —
// "no 'temp' in the label" is not evidence (a DHW setpoint is a temperature and never says so).
void check_semantics(const std::vector<Row>& rows, std::vector<Finding>& out) {
    static const std::vector<std::pair<std::string, std::string>> not_temperature = {
        {"valveposition", "a valve position"}, {"step", "a step index"},
        {"pls", "a pulse count"},              {"pulse", "a pulse count"},
        {"qty", "a quantity"},                 {"address", "an address"},
        {"errorcode", "an error code"},        {"capacitycode", "a capacity code"},
        {"lmin", "a flow rate"},               {"rpm", "a rotation speed"},
        {"mpuid", "an identifier"},            {"eeprom", "an EEPROM digit"},
    };
    for (const auto& r : rows) {
        if (r.def.type != 1) continue;
        if (r.nlabel.find("temp") != std::string::npos) continue;
        for (const auto& [needle, what] : not_temperature) {
            if (r.nlabel.find(needle) == std::string::npos) continue;
            Finding f;
            f.code = "SEMANTICS";
            f.sev  = "HIGH";
            f.key  = finding_key(f.code, r.profile, r.def.reg, r.def.offset, r.nlabel);
            f.head = r.profile + "  " + hex2(r.def.reg) + "+" + std::to_string(r.def.offset) + "  \"" +
                     r.def.label + "\"";
            f.detail.push_back("this row: type " + type_name(r.def.type) +
                               " -> Home Assistant gets device_class:temperature, unit °C");
            f.detail.push_back("but the label says this value is " + std::string(what) +
                               " — not a temperature.");
            f.detail.push_back("effect:   a phantom temperature entity in HA (history, graphs, alerts).");
            out.push_back(f);
            break;
        }
    }
}

// ── Check 6: OVERLAP — two rows fighting over the same wire bytes ─────────────────────────────
// Two rows may share a field ON PURPOSE, and both legitimate shapes start at the SAME offset:
//   • identical window — one field, two views (raw pressure + its saturation temperature);
//   • nested window — mutually exclusive per-accessory variants of one field. The spec itself
//     lists three of these at 0x65 off 0 (docs/REGISTERS.md:493-496): a 2-byte water temperature
//     or a 1-byte bizone valve position, depending on what is installed.
// A STRADDLING overlap — two windows starting at different offsets and colliding — has no
// legitimate reading: one row is eating a neighbour's byte, so its value is assembled from two
// unrelated fields and the neighbour's own value is gone. That is the expansion-valve/Fan-2 bug.
void check_overlap(const std::vector<Row>& rows, std::vector<Finding>& out) {
    std::map<std::string, std::vector<const Row*>> by_page;      // profile+reg -> rows
    for (const auto& r : rows) {
        if (r.def.size == 0) continue;                            // conv 801-805 read no bytes
        by_page[r.profile + hex2(r.def.reg)].push_back(&r);
    }
    for (auto& [k, rs] : by_page) {
        (void)k;
        for (size_t i = 0; i < rs.size(); i++) {
            for (size_t j = i + 1; j < rs.size(); j++) {
                const Row& a = *rs[i];
                const Row& b = *rs[j];
                int a0 = a.def.offset, a1 = a.def.offset + a.def.size - 1;
                int b0 = b.def.offset, b1 = b.def.offset + b.def.size - 1;
                if (a1 < b0 || b1 < a0) continue;                 // disjoint
                if (a0 == b0) continue;                           // shared start = dual view / variant
                Finding f;
                f.code = "OVERLAP";
                f.sev  = "HIGH";
                f.key  = finding_key(f.code, a.profile, a.def.reg, std::min(a0, b0),
                                     a.nlabel + "~" + b.nlabel);
                f.head = a.profile + "  " + hex2(a.def.reg) + "  \"" + a.def.label + "\" vs \"" +
                         b.def.label + "\"";
                f.detail.push_back(std::string("\"") + a.def.label + "\"  reads bytes [" + std::to_string(a0) +
                                   ".." + std::to_string(a1) + "]  (conv " + std::to_string(a.def.conv) +
                                   ", size " + std::to_string(a.def.size) + ")");
                f.detail.push_back(std::string("\"") + b.def.label + "\"  reads bytes [" + std::to_string(b0) +
                                   ".." + std::to_string(b1) + "]  (conv " + std::to_string(b.def.conv) +
                                   ", size " + std::to_string(b.def.size) + ")");
                f.detail.push_back("partial collision — one row is reading a byte that belongs to the");
                f.detail.push_back("other, so at least one of these two values is fabricated.");
                out.push_back(f);
            }
        }
    }
}

// ── Adjudicated exceptions ────────────────────────────────────────────────────────────────────
std::set<std::string> load_exceptions(const std::string& path) {
    std::set<std::string> keys;
    std::ifstream         in(path);
    if (!in) return keys;
    std::string line;
    while (std::getline(in, line)) {
        size_t h = line.find('#');
        if (h != std::string::npos) line = line.substr(0, h);
        size_t a = line.find_first_not_of(" \t\r\n");
        size_t b = line.find_last_not_of(" \t\r\n");
        if (a == std::string::npos) continue;
        keys.insert(line.substr(a, b - a + 1));
    }
    return keys;
}

}  // namespace

int main(int argc, char** argv) {
    std::string spec_path = (argc > 1) ? argv[1] : "docs/REGISTERS.md";
    std::string exc_path  = (argc > 2) ? argv[2] : "tools/domain/audit_exceptions.txt";

    std::string          err;
    std::vector<SpecRow> spec = parse_spec(spec_path, err);
    if (!err.empty()) {
        std::cerr << "domain-audit: " << err << "\n";
        return 2;
    }

    // The RESOLVED row set, not the raw generated tables: def/overlay.hpp supplies the page-0x10
    // protection words the offline generator does not emit yet (#110 Part B), and a hand-written
    // supplement that the domain gate cannot see would be exactly the un-audited second source of
    // truth this tool exists to prevent. Resolving here audits those rows against docs/REGISTERS.md
    // §5 on every profile, identically to a generated row — and it is what makes DELETING the
    // supplement, once the generator emits the rows, a no-op for this file.
    std::vector<Row> rows;
    for (const auto& p : def::profiles) {
        // The BASE table picks the conv-405 curve — the supplement carries no pressure row (pinned by
        // a static_assert in def/overlay.hpp), so resolving here would change nothing but would imply
        // it could.
        rtype_map()[p.id] = profile_refrigerant(p.values, p.count);
        const auto v = def::resolved(p);
        for (size_t i = 0; i < v.count(); i++) {
            ValueDef d = v[i];
            // Resolve the LABEL through logic/label_override.hpp — but NOT the converter. LABEL-UNIT's
            // subject is the PUBLISHED identifier (it prints the HA entity id / VM series suffix), and
            // the pipeline announces the adjudicated label, so the audit must judge that word, not the
            // generator's. The converter checks (SPEC-CONV/LAYOUT/CONSENSUS) deliberately stay on the
            // raw conv: conv_override is a decode decision they must see the intrinsic semantics of,
            // exactly as they always have. Each check thus resolves through the override that governs
            // its own subject.
            d.label = logic::effective_label(d.reg, d.offset, d.conv, d.label);
            rows.push_back({p.id, d, norm_label(d.label)});
        }
    }

    std::vector<Finding> f;
    check_spec_conv(rows, spec, f);
    check_spec_layout(rows, spec, f);
    check_consensus(rows, f);
    check_label_unit(rows, spec, f);
    check_semantics(rows, f);
    check_overlap(rows, f);

    std::set<std::string> exc = load_exceptions(exc_path);
    std::vector<Finding>  live, muted;
    for (auto& x : f) (exc.count(x.key) ? muted : live).push_back(x);

    std::cout << "domain audit — value-catalog correctness\n"
              << "  spec:    " << spec_path << " (" << spec.size() << " rows)\n"
              << "  catalog: " << (sizeof(def::profiles) / sizeof(def::profiles[0])) << " profiles, "
              << rows.size() << " rows\n\n";

    std::sort(live.begin(), live.end(), [](const Finding& a, const Finding& b) {
        if (a.sev != b.sev) return a.sev < b.sev;                 // HIGH before MEDIUM
        return a.code < b.code;
    });
    for (const auto& x : live) {
        std::cout << "[" << x.sev << "] " << x.code << "  " << x.head << "\n";
        for (const auto& d : x.detail) std::cout << "    " << d << "\n";
        std::cout << "    key: " << x.key << "\n\n";
    }

    // Suppressed findings stay VISIBLE — an exception is an adjudication on record, not a delete.
    if (!muted.empty()) {
        std::cout << "suppressed by " << exc_path << " (" << muted.size() << "):\n";
        for (const auto& x : muted) std::cout << "  - " << x.code << "  " << x.head << "\n";
        std::cout << "\n";
    }

    if (live.empty()) {
        std::cout << "clean — no domain findings.\n";
        return 0;
    }
    std::cout << live.size() << " finding(s). Each is a question, not a verdict: confirm against\n"
              << "docs/REGISTERS.md and a real unit. A deviation that is genuinely correct for a\n"
              << "model goes in " << exc_path << " with a reason.\n";
    return 1;
}
