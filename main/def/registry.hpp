#pragma once
// Value-definition profile registry: maps a profile id (chosen in the web UI from the model
// dropdown) to its embedded ValueDef table. The GENERATED per-model profiles below come from
// the X10A value definitions (see docs/REGISTERS.md); `generic` and `altherma3_r_erga` are
// hand-written (the latter is the host-test fixture).
#include <cstddef>
#include <cstring>
#include "../logic/value_def.hpp"
#include "altherma3_r_erga.hpp"
// --- generated model profiles ---
#include "altherma_bizone_cb_04_08kw.hpp"
#include "altherma_bizone_cb_11_16kw.hpp"
#include "altherma_ebla_edla_ewaa_ewya_d_series_9_16kw.hpp"
#include "altherma_ebla_edla_d_series_4_8kw_monobloc.hpp"
#include "altherma_ebla_edla_d_series_9_16kw_monobloc.hpp"
#include "altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3.hpp"
#include "altherma_egsqh_a_series_10kw_geo2.hpp"
#include "altherma_epga_d_eab_eav_eavz_d_j_series_11_16kw.hpp"
#include "altherma_epra_d_etsh_x_16p30_50_d_series_14_16kw_ech2o.hpp"
#include "altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw.hpp"
#include "altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o.hpp"
#include "altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw.hpp"
#include "altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o.hpp"
#include "altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw.hpp"
#include "altherma_erga_d_ehsh_x_p30_50_d_series_04_08kw_ech2o.hpp"
#include "altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw.hpp"
#include "altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw.hpp"
#include "altherma_erga_e_ehsh_x_p30_50_e_ef_series_04_08kw_ech2o.hpp"
#include "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw.hpp"
#include "altherma_erla_d_ebsh_x_16p30_50_d_series_11_16kw_ech2o.hpp"
#include "altherma_erla_d_ebv_ebb_ebvz_d_series_11_16kw.hpp"
#include "altherma_erla03_d_ehfh_ehfz_dj_series_3kw.hpp"
#include "altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o.hpp"
#include "altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw.hpp"
#include "altherma_gshp.hpp"
#include "altherma_gshp2.hpp"
#include "altherma_hpsu6_ultra.hpp"
#include "altherma_hybrid.hpp"
#include "altherma_lt_d7_e_bml.hpp"
#include "altherma_lt_11_16kw_hydrosplit_hydro_unit.hpp"
#include "altherma_lt_ca_cb_04_08kw.hpp"
#include "altherma_lt_ca_cb_11_16kw.hpp"
#include "altherma_lt_da_04_08kw.hpp"
#include "altherma_lt_da_pair_bml.hpp"
#include "altherma_lt_gas_inj.hpp"
#include "altherma_lt_multi_dhwhp.hpp"
#include "altherma_lt_multi_hybrid.hpp"
#include "altherma_monobloc_ca_05_07kw.hpp"
#include "altherma_top_grade.hpp"
#include "minichiller_ewaa_ewya_d_series_4_8kw.hpp"
#include "minichiller_ewaa_ewya_d_series_9_16kw.hpp"
#include "minichiller_ewaq_ewyq_b_series_4_8kw.hpp"
#include "minichiller_inverter_04_08kw.hpp"

namespace daik::def {

// Minimal generic fallback: a few near-universal registers so an unknown unit still reports
// something.
inline constexpr ValueDef generic[] = {
    {0x10, 0, 217, 1, -1, "Operation Mode"},
    {0x20, 0, 105, 2,  1, "Outdoor Air Temp (R1T)"},
    {0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"},
};

struct Profile {
    const char*     id;
    const ValueDef* values;
    size_t          count;
};

inline constexpr Profile profiles[] = {
    {"generic",          generic,          sizeof(generic) / sizeof(generic[0])},
    {"altherma3_r_erga", altherma3_r_erga, sizeof(altherma3_r_erga) / sizeof(altherma3_r_erga[0])},
    // --- generated ---
    {"altherma_bizone_cb_04_08kw", altherma_bizone_cb_04_08kw, sizeof(altherma_bizone_cb_04_08kw) / sizeof(altherma_bizone_cb_04_08kw[0])},
    {"altherma_bizone_cb_11_16kw", altherma_bizone_cb_11_16kw, sizeof(altherma_bizone_cb_11_16kw) / sizeof(altherma_bizone_cb_11_16kw[0])},
    {"altherma_ebla_edla_ewaa_ewya_d_series_9_16kw", altherma_ebla_edla_ewaa_ewya_d_series_9_16kw, sizeof(altherma_ebla_edla_ewaa_ewya_d_series_9_16kw) / sizeof(altherma_ebla_edla_ewaa_ewya_d_series_9_16kw[0])},
    {"altherma_ebla_edla_d_series_4_8kw_monobloc", altherma_ebla_edla_d_series_4_8kw_monobloc, sizeof(altherma_ebla_edla_d_series_4_8kw_monobloc) / sizeof(altherma_ebla_edla_d_series_4_8kw_monobloc[0])},
    {"altherma_ebla_edla_d_series_9_16kw_monobloc", altherma_ebla_edla_d_series_9_16kw_monobloc, sizeof(altherma_ebla_edla_d_series_9_16kw_monobloc) / sizeof(altherma_ebla_edla_d_series_9_16kw_monobloc[0])},
    {"altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3", altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3, sizeof(altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3) / sizeof(altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3[0])},
    {"altherma_egsqh_a_series_10kw_geo2", altherma_egsqh_a_series_10kw_geo2, sizeof(altherma_egsqh_a_series_10kw_geo2) / sizeof(altherma_egsqh_a_series_10kw_geo2[0])},
    {"altherma_epga_d_eab_eav_eavz_d_j_series_11_16kw", altherma_epga_d_eab_eav_eavz_d_j_series_11_16kw, sizeof(altherma_epga_d_eab_eav_eavz_d_j_series_11_16kw) / sizeof(altherma_epga_d_eab_eav_eavz_d_j_series_11_16kw[0])},
    {"altherma_epra_d_etsh_x_16p30_50_d_series_14_16kw_ech2o", altherma_epra_d_etsh_x_16p30_50_d_series_14_16kw_ech2o, sizeof(altherma_epra_d_etsh_x_16p30_50_d_series_14_16kw_ech2o) / sizeof(altherma_epra_d_etsh_x_16p30_50_d_series_14_16kw_ech2o[0])},
    {"altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw", altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw, sizeof(altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw) / sizeof(altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw[0])},
    {"altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o", altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o, sizeof(altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o) / sizeof(altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o[0])},
    {"altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw", altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw, sizeof(altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw) / sizeof(altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw[0])},
    {"altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o", altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o, sizeof(altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o) / sizeof(altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o[0])},
    {"altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw", altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw, sizeof(altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw) / sizeof(altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw[0])},
    {"altherma_erga_d_ehsh_x_p30_50_d_series_04_08kw_ech2o", altherma_erga_d_ehsh_x_p30_50_d_series_04_08kw_ech2o, sizeof(altherma_erga_d_ehsh_x_p30_50_d_series_04_08kw_ech2o) / sizeof(altherma_erga_d_ehsh_x_p30_50_d_series_04_08kw_ech2o[0])},
    {"altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw", altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw, sizeof(altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw) / sizeof(altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw[0])},
    {"altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw", altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw, sizeof(altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw) / sizeof(altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw[0])},
    {"altherma_erga_e_ehsh_x_p30_50_e_ef_series_04_08kw_ech2o", altherma_erga_e_ehsh_x_p30_50_e_ef_series_04_08kw_ech2o, sizeof(altherma_erga_e_ehsh_x_p30_50_e_ef_series_04_08kw_ech2o) / sizeof(altherma_erga_e_ehsh_x_p30_50_e_ef_series_04_08kw_ech2o[0])},
    {"altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw, sizeof(altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw) / sizeof(altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw[0])},
    {"altherma_erla_d_ebsh_x_16p30_50_d_series_11_16kw_ech2o", altherma_erla_d_ebsh_x_16p30_50_d_series_11_16kw_ech2o, sizeof(altherma_erla_d_ebsh_x_16p30_50_d_series_11_16kw_ech2o) / sizeof(altherma_erla_d_ebsh_x_16p30_50_d_series_11_16kw_ech2o[0])},
    {"altherma_erla_d_ebv_ebb_ebvz_d_series_11_16kw", altherma_erla_d_ebv_ebb_ebvz_d_series_11_16kw, sizeof(altherma_erla_d_ebv_ebb_ebvz_d_series_11_16kw) / sizeof(altherma_erla_d_ebv_ebb_ebvz_d_series_11_16kw[0])},
    {"altherma_erla03_d_ehfh_ehfz_dj_series_3kw", altherma_erla03_d_ehfh_ehfz_dj_series_3kw, sizeof(altherma_erla03_d_ehfh_ehfz_dj_series_3kw) / sizeof(altherma_erla03_d_ehfh_ehfz_dj_series_3kw[0])},
    {"altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o", altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o, sizeof(altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o) / sizeof(altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o[0])},
    {"altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw", altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw, sizeof(altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw) / sizeof(altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw[0])},
    {"altherma_gshp", altherma_gshp, sizeof(altherma_gshp) / sizeof(altherma_gshp[0])},
    {"altherma_gshp2", altherma_gshp2, sizeof(altherma_gshp2) / sizeof(altherma_gshp2[0])},
    {"altherma_hpsu6_ultra", altherma_hpsu6_ultra, sizeof(altherma_hpsu6_ultra) / sizeof(altherma_hpsu6_ultra[0])},
    {"altherma_hybrid", altherma_hybrid, sizeof(altherma_hybrid) / sizeof(altherma_hybrid[0])},
    {"altherma_lt_d7_e_bml", altherma_lt_d7_e_bml, sizeof(altherma_lt_d7_e_bml) / sizeof(altherma_lt_d7_e_bml[0])},
    {"altherma_lt_11_16kw_hydrosplit_hydro_unit", altherma_lt_11_16kw_hydrosplit_hydro_unit, sizeof(altherma_lt_11_16kw_hydrosplit_hydro_unit) / sizeof(altherma_lt_11_16kw_hydrosplit_hydro_unit[0])},
    {"altherma_lt_ca_cb_04_08kw", altherma_lt_ca_cb_04_08kw, sizeof(altherma_lt_ca_cb_04_08kw) / sizeof(altherma_lt_ca_cb_04_08kw[0])},
    {"altherma_lt_ca_cb_11_16kw", altherma_lt_ca_cb_11_16kw, sizeof(altherma_lt_ca_cb_11_16kw) / sizeof(altherma_lt_ca_cb_11_16kw[0])},
    {"altherma_lt_da_04_08kw", altherma_lt_da_04_08kw, sizeof(altherma_lt_da_04_08kw) / sizeof(altherma_lt_da_04_08kw[0])},
    {"altherma_lt_da_pair_bml", altherma_lt_da_pair_bml, sizeof(altherma_lt_da_pair_bml) / sizeof(altherma_lt_da_pair_bml[0])},
    {"altherma_lt_gas_inj", altherma_lt_gas_inj, sizeof(altherma_lt_gas_inj) / sizeof(altherma_lt_gas_inj[0])},
    {"altherma_lt_multi_dhwhp", altherma_lt_multi_dhwhp, sizeof(altherma_lt_multi_dhwhp) / sizeof(altherma_lt_multi_dhwhp[0])},
    {"altherma_lt_multi_hybrid", altherma_lt_multi_hybrid, sizeof(altherma_lt_multi_hybrid) / sizeof(altherma_lt_multi_hybrid[0])},
    {"altherma_monobloc_ca_05_07kw", altherma_monobloc_ca_05_07kw, sizeof(altherma_monobloc_ca_05_07kw) / sizeof(altherma_monobloc_ca_05_07kw[0])},
    {"altherma_top_grade", altherma_top_grade, sizeof(altherma_top_grade) / sizeof(altherma_top_grade[0])},
    {"minichiller_ewaa_ewya_d_series_4_8kw", minichiller_ewaa_ewya_d_series_4_8kw, sizeof(minichiller_ewaa_ewya_d_series_4_8kw) / sizeof(minichiller_ewaa_ewya_d_series_4_8kw[0])},
    {"minichiller_ewaa_ewya_d_series_9_16kw", minichiller_ewaa_ewya_d_series_9_16kw, sizeof(minichiller_ewaa_ewya_d_series_9_16kw) / sizeof(minichiller_ewaa_ewya_d_series_9_16kw[0])},
    {"minichiller_ewaq_ewyq_b_series_4_8kw", minichiller_ewaq_ewyq_b_series_4_8kw, sizeof(minichiller_ewaq_ewyq_b_series_4_8kw) / sizeof(minichiller_ewaq_ewyq_b_series_4_8kw[0])},
    {"minichiller_inverter_04_08kw", minichiller_inverter_04_08kw, sizeof(minichiller_inverter_04_08kw) / sizeof(minichiller_inverter_04_08kw[0])},
};

inline const Profile& lookup(const char* id) {
    for (const auto& p : profiles)
        if (id && std::strcmp(p.id, id) == 0) return p;
    return profiles[0]; // generic
}

} // namespace daik::def
