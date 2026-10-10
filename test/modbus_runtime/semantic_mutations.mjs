// Single mutations of the complete production hp_modbus.cpp, compiled only in temporary files.
// Each descriptor uses the existing runtime runner's unique-anchor / specific-oracle contract.
const definitionAssignment = "cv.modbus_definition = def::homehub_definition_id(r);";

export const semanticMutations = [
  {
    name: "untyped-homehub-row", scenario: "homehub_definition_rows",
    before: definitionAssignment,
    after: "cv.modbus_definition = 0;",
  },
  {
    name: "offset-only-native-definition", scenario: "native_definition_rows",
    before: definitionAssignment,
    after: "cv.modbus_definition = def::homehub_definition_id(*def::homehub_find(r.offset));",
  },
  ...[
    { offset: 38, base: 38, scenario: "native_current_mode" },
    { offset: 65, base: 56, scenario: "native_demand_response" },
    { offset: 83, base: 3, scenario: "native_unit_mode" },
    { offset: 9, base: 9, scenario: "native_quiet_selection" },
    { offset: 58, base: 58, scenario: "native_power_label" },
  ].map(({ offset, base, scenario }) => ({
    name: `native-semantic-${offset}`, scenario,
    before: definitionAssignment,
    // The chosen base row recreates the obsolete public kind/name while leaving raw decoding
    // and the rest of the poll intact. The semantic oracle checks the kind/name before offset.
    after: `cv.modbus_definition = def::homehub_definition_id(r.offset == ${offset} ? *def::homehub_find(${base}) : r);`,
  })),
  {
    name: "snapshot-drops-definition", scenario: "definition_snapshot_cutover",
    before: /for \(size_t i = 0; i < n; i\+\+\) out\[i\] = s_cache\[i\];/,
    after: "for (size_t i = 0; i < n; i++) { out[i] = s_cache[i]; out[i].modbus_definition = 0; }",
  },
  {
    name: "base-zero-borrows-native-none", scenario: "homehub_definition_rows",
    before: "r.kind == def::HomeHubValueKind::Altherma4CurrentOperationMode",
    after: "true",
  },
  {
    name: "native-inherits-unsupported-57", scenario: "native_definition_rows",
    before: "MbRead io;",
    // Model the removed inheritance by actually sending FC03 offset57 through production mb_read.
    // The peer answers it; acceptance still must reject the unsupported request/extra cache row.
    after: `MbRead io;
    if (s_active_profile.load(std::memory_order_acquire) == ModbusProfile::Altherma4) {
        MbFailure inherited_failure;
        if (mb_read(MbFunc::ReadHolding, 56, 1, io, inherited_failure)) {
            uint16_t inherited_raw = 0;
            if (mb_reg_at(io.resp, 0, inherited_raw))
                take_row(*def::homehub_find(57), inherited_raw, io.observed_ms);
        }
    }`,
  },
  {
    name: "promotion-retains-baseline", scenario: "probe_native_promotion",
    before: "fresh.clear();",
    after: "/* mutation: expose base definitions after native promotion */",
  },
  {
    name: "promotion-delays-native-full", scenario: "probe_native_promotion",
    before: "s_cycle_tick = profile_promoted ? 0 : s_cycle_tick + 1;",
    after: "s_cycle_tick = ((void)profile_promoted, s_cycle_tick + 1);",
  },
  {
    name: "promotion-keeps-base-split-budget", scenario: "probe_native_promotion",
    before: /fresh\.clear\(\);\n\s*for \(bool& split : s_batch_split\) split = false;/,
    after: "fresh.clear(); /* mutation: carry base fallback splits into the native plan */",
  },
];
