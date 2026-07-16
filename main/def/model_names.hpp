#pragma once
// GENERATED (gen_names_generic.py — offline tooling, maintained outside this repo) id -> display /
// family / marketing-name table for the auto-detected model. Regenerate, never hand-edit.
// Family/marketing follow Daikin sales nomenclature.
// Used by /status.detect for an honest identification. Altherma-only.
#include <cstddef>
#include <cstring>

namespace daik::def {

struct ModelName { const char* id; const char* name; const char* family; const char* marketing; };

inline constexpr ModelName MODEL_NAMES[] = {
    {"altherma_bizone_cb_04_08kw", "Altherma Bizone CB 04-08kW", "Altherma LT / older", ""},
    {"altherma_bizone_cb_11_16kw", "Altherma Bizone CB 11-16kW", "Altherma LT / older", ""},
    {"altherma_ebla_edla_d_series_4_8kw_monobloc", "Altherma EBLA-EDLA D series 4-8kW Monobloc", "Altherma 3 M", "Altherma 3 M (EBLA/EDLA)"},
    {"altherma_ebla_edla_d_series_9_16kw_monobloc", "Altherma EBLA-EDLA D series 9-16kW Monobloc", "Altherma 3 M", "Altherma 3 M (EBLA/EDLA)"},
    {"altherma_ebla_edla_ewaa_ewya_d_series_9_16kw", "Altherma EBLA-EDLA EWAA-EWYA D SERIES 9-16KW", "Altherma 3 M", "Altherma 3 M (EBLA/EDLA)"},
    {"altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3", "Altherma EGSAH-X-EWSAH-X-D series 6-10kW GEO3", "Altherma 3 GEO", ""},
    {"altherma_egsqh_a_series_10kw_geo2", "Altherma EGSQH-A series 10kW GEO2", "Altherma GEO (R410a)", ""},
    {"altherma_epga_d_eab_eav_eavz_d_j_series_11_16kw", "Altherma EPGA D EAB-EAV-EAVZ D J series 11-16kW", "Altherma 3 H (gas-drive)", ""},
    {"altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o", "Altherma EPRA D D7 ETSH-X 16P30-50 E E7 series 14-18kW-ECH2O", "Altherma 3 H", "Altherma 3 H (EPRA)"},
    {"altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw", "Altherma EPRA D D7 ETV16-ETB16-ETVZ16 E E7 series 14-18kW", "Altherma 3 H", "Altherma 3 H (EPRA)"},
    {"altherma_epra_d_etsh_x_16p30_50_d_series_14_16kw_ech2o", "Altherma EPRA D ETSH-X 16P30-50 D series 14-16kW-ECH2O", "Altherma 3 H", "Altherma 3 H (EPRA)"},
    {"altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw", "Altherma EPRA D ETV16-ETB16-ETVZ16 D series 14-16kW", "Altherma 3 H", "Altherma 3 H (EPRA)"},
    {"altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o", "Altherma EPRA E ETSH-X 16P30-50 E series 8-12kW-ECH2O", "Altherma 3 H", "Altherma 3 H (EPRA)"},
    {"altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw", "Altherma EPRA E ETV16-ETB16-ETVZ16 E EJ series 8-12kW", "Altherma 3 H", "Altherma 3 H (EPRA)"},
    {"altherma_erga_d_ehsh_x_p30_50_d_series_04_08kw_ech2o", "Altherma ERGA D EHSH-X P30-50 D series 04-08kW-ECH2O", "Altherma 3 R", "Altherma 3 R (ERGA)"},
    {"altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw", "Altherma ERGA D EHV-EHB-EHVZ DA series 04-08kW", "Altherma 3 R", "Altherma 3 R (ERGA)"},
    {"altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw", "Altherma ERGA D EHV-EHB-EHVZ DJ series 04-08 kW", "Altherma 3 R", "Altherma 3 R (ERGA)"},
    {"altherma_erga_e_ehsh_x_p30_50_e_ef_series_04_08kw_ech2o", "Altherma ERGA E EHSH-X P30-50 E EF series 04-08kW-ECH2O", "Altherma 3 R", "Altherma 3 R (ERGA)"},
    {"altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", "Altherma ERGA E EHV-EHB-EHVZ E EJ series 04-08kW", "Altherma 3 R", "Altherma 3 R (ERGA)"},
    {"altherma_erla03_d_ehfh_ehfz_dj_series_3kw", "Altherma ERLA03 D EHFH-EHFZ DJ series 3kW", "Altherma 3 R", ""},
    {"altherma_erla_d_ebsh_x_16p30_50_d_series_11_16kw_ech2o", "Altherma ERLA D EBSH-X 16P30-50 D SERIES 11-16kW-ECH2O", "Altherma 3 R", "Altherma 3 R (ERLA)"},
    {"altherma_erla_d_ebv_ebb_ebvz_d_series_11_16kw", "Altherma ERLA D EBV-EBB-EBVZ D SERIES 11-16kW", "Altherma 3 R", "Altherma 3 R (ERLA)"},
    {"altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o", "Altherma ERRA E ELSH-X 12P30-50 EF series 8-12kW-ECH2O", "Altherma 3 R", "Altherma 3 R (ERRA)"},
    {"altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw", "Altherma ERRA E ELV12-ELB12-ELVZ12 EF EJ series 8-12kW", "Altherma 3 R", "Altherma 3 R (ERRA)"},
    {"altherma_gshp", "Altherma GSHP", "Altherma GEO (R410a)", ""},
    {"altherma_gshp2", "Altherma GSHP2", "Altherma 3 GEO", ""},
    {"altherma_hpsu6_ultra", "Altherma HPSU6 ultra", "Altherma ECH2O / HPSU", ""},
    {"altherma_hybrid", "Altherma Hybrid", "Altherma Hybrid", ""},
    {"altherma_lt_11_16kw_hydrosplit_hydro_unit", "Altherma LT 11-16kW Hydrosplit hydro unit", "Altherma LT / older", ""},
    {"altherma_lt_ca_cb_04_08kw", "Altherma LT CA CB 04-08kW", "Altherma LT / older", ""},
    {"altherma_lt_ca_cb_11_16kw", "Altherma LT CA CB 11-16kW", "Altherma LT / older", ""},
    {"altherma_lt_d7_e_bml", "Altherma LT-D7 E BML", "Altherma LT / older", ""},
    {"altherma_lt_da_04_08kw", "Altherma LT DA 04-08kW", "Altherma LT / older", ""},
    {"altherma_lt_da_pair_bml", "Altherma LT DA pair BML", "Altherma LT / older", ""},
    {"altherma_lt_gas_inj", "Altherma LT Gas INJ", "Altherma LT / older", ""},
    {"altherma_lt_multi_dhwhp", "Altherma LT Multi DHWHP", "Altherma LT / older", ""},
    {"altherma_lt_multi_hybrid", "Altherma LT Multi Hybrid", "Altherma LT / older", ""},
    {"altherma_monobloc_ca_05_07kw", "Altherma Monobloc CA 05-07kW", "Altherma LT / older", ""},
    {"altherma_top_grade", "Altherma Top-Grade", "Altherma LT / older", ""},
};

// Display metadata for a profile id; nullptr if unknown (e.g. "generic").
inline const ModelName* model_name(const char* id) {
    if (!id) return nullptr;
    for (const auto& m : MODEL_NAMES) if (std::strcmp(m.id, id) == 0) return &m;
    return nullptr;
}

} // namespace daik::def
