static void test_heater_context_payload() {
    using namespace daik::logic;
    struct Metadata {
        uint32_t epoch        = 7;
        uint16_t capabilities = heater_context::ALL, flags = 1, dropped = 0;
        uint8_t  supported_heaters = 3, observed_hours[2]{2, 3};
        bool     confirmed = true, dated = true, partial = true;
        bool     restore_pending = false, persistence_pending = true;
    } meta;
    heater_context::Totals     totals[2]{};
    HeaterContextPayloadFields fields;
    heater_context_payload_project(fields, totals, meta);
    std::string nested;
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"confirmed\":true") != std::string::npos);
    CHECK(nested.find("\"on_s\":null") != std::string::npos);
    CHECK(nested.find("\"positive_s\":null") != std::string::npos);
    CHECK(nested.find("\"samples\":0") != std::string::npos);
    CHECK(nested.find("\"quiet_mild_notice\":null") != std::string::npos);

    // The first ON flag is positive sample evidence, not a fabricated elapsed second. One
    // microsecond below a displayed second likewise retains its actual positive sample count.
    totals[0].samples = totals[0].readable_samples = totals[0].on_samples = 1;
    totals[0].readable_us = totals[0].on_us = totals[0].union_us = 999999;
    totals[0].overlap_us = totals[0].complete_context_us = 999999;
    for (size_t k = 0; k < heater_context::CATEGORIES; ++k) {
        totals[0].positive_us[k] = totals[0].evaluable_on_us[k] = 999999;
        totals[0].positive_samples[k] = totals[0].evaluable_on_samples[k] = 1;
    }
    heater_context_payload_project(fields, totals, meta);
    CHECK(fields.heater[0].on_s == 0);
    CHECK(fields.heater[0].positive_samples[0] == 1);
    CHECK(fields.heater[0].evaluable_mask == heater_context::ALL);
    CHECK(fields.heater[1].evaluable_mask == 0);
    nested.clear();
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"on_s\":0") != std::string::npos);
    CHECK(nested.find("\"positive_samples\":1") != std::string::npos);
    CHECK(nested.find("\"quiet_mild_notice\":false") != std::string::npos);

    // Two simultaneous heaters keep separate populations. No OR context is subtracted from
    // their combined ON time. Exact microseconds are retained in storage; only display floors.
    totals[0].readable_us = totals[0].on_us = 1500001;
    totals[0].unknown_context_us = totals[0].unclassified_us = 500002;
    totals[1].samples = totals[1].readable_samples = totals[1].on_samples = 2;
    totals[1].readable_us = totals[1].on_us = 2500001;
    totals[1].union_us                      = 2000000;
    totals[1].unclassified_us               = 500001;
    totals[1].unknown_context_us            = 2500001;
    totals[1].positive_us[0]                = 2000000;
    totals[1].evaluable_on_us[0]            = 2500001;
    totals[1].evaluable_on_samples[0]       = 1;
    totals[1].positive_samples[0]           = 1;
    heater_context_payload_project(fields, totals, meta);
    CHECK(fields.heater[0].on_s == 1 && fields.heater[1].on_s == 2);
    CHECK(fields.heater[0].observed_hours == 2 && fields.heater[1].observed_hours == 3);
    CHECK(fields.heater[1].positive_s[0] == 2);
    CHECK(fields.heater[1].evaluable_on_s[0] == 2);
    CHECK(fields.heater[1].evaluable_mask == 1);
    CHECK(fields.epoch == 7 && fields.dated && fields.partial && fields.persistence_pending);
    std::string flat;
    append_heater_context_json(flat, fields, true, 0);
    CHECK(flat.find("\"heater\":0") != std::string::npos);
    CHECK(flat.find("\"on_s\":1") != std::string::npos);
    CHECK(flat.find("\"confirmed\":1") != std::string::npos);
    CHECK(flat.find("\"categories_overlap\":1") != std::string::npos);
    std::string bsh;
    append_heater_context_json(bsh, fields, true, 1);
    CHECK(bsh.find("\"heater\":1") != std::string::npos);
    CHECK(bsh.find("\"on_s\":2") != std::string::npos);
    CHECK(bsh.find("\"emergency_positive_s\":2") != std::string::npos);
    CHECK(bsh.find("\"error_positive_s\":null") != std::string::npos);
    CHECK(flat.size() < 2048 && bsh.size() < 2048);

    // Absence of a declared instrument remains different from a supported but unread input.
    meta.supported_heaters = 1;
    meta.capabilities      = heater_context::mask(heater_context::Category::Emergency);
    heater_context_payload_project(fields, totals, meta);
    nested.clear();
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"bsh\":{\"supported\":false,\"readable_s\":null") != std::string::npos);
    CHECK(nested.find("\"error\":{\"supported\":false,\"positive_s\":null") != std::string::npos);
    meta.confirmed = false;
    heater_context_payload_project(fields, totals, meta);
    nested.clear();
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"capability_mask\":null") != std::string::npos);
    CHECK(nested.find("\"supported\":null") != std::string::npos);
    CHECK(nested.find("\"on_s\":1") == std::string::npos);
    flat.clear();
    append_heater_context_json(flat, fields, true, 0);
    CHECK(flat.find("\"confirmed\":0") != std::string::npos);
    CHECK(flat.find("\"emergency_supported\":null") != std::string::npos);
    for (int invalid : {-1, 2}) {
        flat.clear();
        append_heater_context_json(flat, fields, true, invalid);
        CHECK(flat.find("\"heater\":null") != std::string::npos);
        CHECK(flat.find("\"on_s\":") == std::string::npos);
    }

    // A project notice uses qualified flag-time, not a temperature sample alone. Its boundary
    // survives the compact projection exactly; it is never an absence/whole-plant verdict.
    const size_t quiet = size_t(heater_context::Category::QuietMildHeating);
    totals[0].samples = totals[0].readable_samples = totals[0].on_samples = 64;
    totals[0].readable_us = totals[0].on_us = totals[0].union_us = heater_context::NOTICE_US;
    totals[0].unclassified_us                                    = 0;
    totals[0].unknown_context_us     = heater_context::NOTICE_US - totals[0].complete_context_us;
    totals[0].evaluable_on_us[quiet] = heater_context::NOTICE_US;
    totals[0].evaluable_on_samples[quiet] = totals[0].positive_samples[quiet] = 64;
    totals[0].positive_us[quiet] = heater_context::NOTICE_US - 1;
    heater_context_payload_project(fields, totals, meta);
    CHECK(!fields.heater[0].quiet_mild_notice);
    totals[0].positive_us[quiet]++;
    heater_context_payload_project(fields, totals, meta);
    CHECK(fields.heater[0].quiet_mild_notice);
    totals[0].saturated     = true;
    totals[1].unreadable_us = (uint64_t(UINT32_MAX) + 1) * 1000000;
    heater_context_payload_project(fields, totals, meta);
    CHECK(fields.heater[0].saturated);
    CHECK(fields.heater[1].unreadable_s == UINT32_MAX && fields.heater[1].saturated);
    CHECK(sizeof(fields) <= 368);

    // A qualified interval's old-hour seam piece has time but no ending sample. The new hour
    // owns that sample; this must not null the old hour's independently readable flag-time.
    heater_context::Totals seam[2]{};
    seam[0].readable_us = seam[0].on_us = seam[0].union_us = seam[0].unknown_context_us = 2000000;
    seam[0].positive_us[0] = seam[0].evaluable_on_us[0] = 2000000;
    meta.confirmed                                      = true;
    heater_context_payload_project(fields, seam, meta);
    CHECK(fields.heater[0].has_observed && fields.heater[0].has_readable);
    CHECK(fields.heater[0].samples == 0 && fields.heater[0].evaluable_mask == 1);
    nested.clear();
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"on_s\":2") != std::string::npos);
    CHECK(nested.find("\"positive_s\":2,\"evaluable_on_s\":2,\"positive_samples\":0") !=
          std::string::npos);
    seam[0]               = {};
    seam[0].unreadable_us = 2000000;
    seam[0].samples       = 1;
    heater_context_payload_project(fields, seam, meta);
    CHECK(fields.heater[0].has_observed && !fields.heater[0].has_readable);
    nested.clear();
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"unreadable_s\":2") != std::string::npos);
    CHECK(nested.find("\"on_s\":null") != std::string::npos);

    seam[0].samples = 0; // the unknown-only old-hour piece also owns no ending sample
    heater_context_payload_project(fields, seam, meta);
    CHECK(fields.heater[0].has_observed && !fields.heater[0].has_readable);
    nested.clear();
    append_heater_context_json(nested, fields);
    CHECK(nested.find("\"unreadable_s\":2") != std::string::npos);
    CHECK(nested.find("\"on_s\":null") != std::string::npos);

    // A conservative output-resource ceiling maximizes every scalar independently. This is a
    // serialization bound, not a physically possible heater population or target heap proof.
    fields           = {};
    fields.confirmed = fields.dated = true;
    fields.epoch                    = UINT32_MAX;
    fields.flags = fields.dropped = UINT16_MAX;
    fields.capabilities           = heater_context::ALL;
    fields.supported_heaters      = 3;
    for (auto& h : fields.heater) {
        h.has_observed = h.has_readable = true;
        h.readable_s = h.on_s = h.off_s = h.transition_s = h.unreadable_s = UINT32_MAX;
        h.union_s = h.overlap_s = h.unknown_context_s = h.unclassified_s = UINT32_MAX;
        h.complete_context_s                                             = UINT32_MAX;
        h.samples = h.readable_samples = h.on_samples = UINT32_MAX;
        h.observed_hours                              = UINT8_MAX;
        h.evaluable_mask                              = heater_context::ALL;
        for (size_t k = 0; k < heater_context::CATEGORIES; ++k)
            h.positive_s[k] = h.evaluable_on_s[k] = h.positive_samples[k] = UINT32_MAX;
    }
    for (int h = 0; h < 2; ++h) {
        flat.clear();
        append_heater_context_json(flat, fields, true, h);
        CHECK(flat.size() <= 2048);
    }
}
