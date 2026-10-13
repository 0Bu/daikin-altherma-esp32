#pragma once
// HAND-WRITTEN storage layer for exact duplicate generated profiles. Model IDs, registry order,
// counts and the original per-model headers remain unchanged. These named pointers share only
// proven identical row storage; the compile-time guards fail if either source table later changes.
// Remove the affected alias when an updated catalog makes a pair different; never edit a generated
// table to make a sharing assertion pass.
#include "../logic/profile_table_equal.hpp"
#include "altherma_gshp.hpp"
#include "altherma_egsqh_a_series_10kw_geo2.hpp"
#include "altherma_gshp2.hpp"
#include "altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3.hpp"
#include "altherma_lt_multi_dhwhp.hpp"
#include "altherma_lt_multi_hybrid.hpp"
#include "altherma_lt_ca_cb_04_08kw.hpp"
#include "altherma_bizone_cb_04_08kw.hpp"
#include "altherma_bizone_cb_11_16kw.hpp"
#include "minichiller_ewaa_ewya_d_series_9_16kw.hpp"
#include "minichiller_inverter_04_08kw.hpp"
#include "minichiller_ewaq_ewyq_b_series_4_8kw.hpp"
#include "altherma_ebla_edla_d_series_4_8kw_monobloc.hpp"
#include "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw.hpp"
#include "altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o.hpp"
#include "altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw.hpp"
#include "altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o.hpp"
#include "altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw.hpp"
#include "altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw.hpp"
#include "altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o.hpp"

namespace daik::def {

static_assert(logic::profile_tables_equal(altherma_gshp,
                                          sizeof(altherma_gshp) / sizeof(altherma_gshp[0]),
                                          altherma_egsqh_a_series_10kw_geo2,
                                          sizeof(altherma_egsqh_a_series_10kw_geo2) /
                                              sizeof(altherma_egsqh_a_series_10kw_geo2[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(
    logic::profile_tables_equal(altherma_gshp2, sizeof(altherma_gshp2) / sizeof(altherma_gshp2[0]),
                                altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3,
                                sizeof(altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3) /
                                    sizeof(altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3[0])),
    "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(
                  altherma_lt_multi_dhwhp,
                  sizeof(altherma_lt_multi_dhwhp) / sizeof(altherma_lt_multi_dhwhp[0]),
                  altherma_lt_multi_hybrid,
                  sizeof(altherma_lt_multi_hybrid) / sizeof(altherma_lt_multi_hybrid[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(
                  altherma_lt_ca_cb_04_08kw,
                  sizeof(altherma_lt_ca_cb_04_08kw) / sizeof(altherma_lt_ca_cb_04_08kw[0]),
                  altherma_bizone_cb_04_08kw,
                  sizeof(altherma_bizone_cb_04_08kw) / sizeof(altherma_bizone_cb_04_08kw[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(altherma_bizone_cb_11_16kw,
                                          sizeof(altherma_bizone_cb_11_16kw) /
                                              sizeof(altherma_bizone_cb_11_16kw[0]),
                                          minichiller_ewaa_ewya_d_series_9_16kw,
                                          sizeof(minichiller_ewaa_ewya_d_series_9_16kw) /
                                              sizeof(minichiller_ewaa_ewya_d_series_9_16kw[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(minichiller_inverter_04_08kw,
                                          sizeof(minichiller_inverter_04_08kw) /
                                              sizeof(minichiller_inverter_04_08kw[0]),
                                          minichiller_ewaq_ewyq_b_series_4_8kw,
                                          sizeof(minichiller_ewaq_ewyq_b_series_4_8kw) /
                                              sizeof(minichiller_ewaq_ewyq_b_series_4_8kw[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(
    logic::profile_tables_equal(altherma_ebla_edla_d_series_4_8kw_monobloc,
                                sizeof(altherma_ebla_edla_d_series_4_8kw_monobloc) /
                                    sizeof(altherma_ebla_edla_d_series_4_8kw_monobloc[0]),
                                altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw,
                                sizeof(altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw) /
                                    sizeof(altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw[0])),
    "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(
                  altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o,
                  sizeof(altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o) /
                      sizeof(altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o[0]),
                  altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw,
                  sizeof(altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw) /
                      sizeof(altherma_epra_e_etv16_etb16_etvz16_e_ej_series_8_12kw[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(
                  altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o,
                  sizeof(altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o) /
                      sizeof(altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o[0]),
                  altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw,
                  sizeof(altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw) /
                      sizeof(altherma_erra_e_elv12_elb12_elvz12_ef_ej_series_8_12kw[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

static_assert(logic::profile_tables_equal(
                  altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw,
                  sizeof(altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw) /
                      sizeof(altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw[0]),
                  altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o,
                  sizeof(altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o) /
                      sizeof(altherma_epra_d_d7_etsh_x_16p30_50_e_e7_series_14_18kw_ech2o[0])),
              "shared storage requires the complete ordered generated tables to remain equal");

inline constexpr const ValueDef* profile_storage_altherma_gshp           = altherma_gshp;
inline constexpr const ValueDef* profile_storage_altherma_gshp2          = altherma_gshp2;
inline constexpr const ValueDef* profile_storage_altherma_lt_multi_dhwhp = altherma_lt_multi_dhwhp;
inline constexpr const ValueDef* profile_storage_altherma_lt_ca_cb_04_08kw =
    altherma_lt_ca_cb_04_08kw;
inline constexpr const ValueDef* profile_storage_altherma_bizone_cb_11_16kw =
    altherma_bizone_cb_11_16kw;
inline constexpr const ValueDef* profile_storage_minichiller_inverter_04_08kw =
    minichiller_inverter_04_08kw;
inline constexpr const ValueDef* profile_storage_altherma_ebla_edla_d_series_4_8kw_monobloc =
    altherma_ebla_edla_d_series_4_8kw_monobloc;
inline constexpr const ValueDef*
    profile_storage_altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o =
        altherma_epra_e_etsh_x_16p30_50_e_series_8_12kw_ech2o;
inline constexpr const ValueDef*
    profile_storage_altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o =
        altherma_erra_e_elsh_x_12p30_50_ef_series_8_12kw_ech2o;
inline constexpr const ValueDef*
    profile_storage_altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw =
        altherma_epra_d_d7_etv16_etb16_etvz16_e_e7_series_14_18kw;

} // namespace daik::def
