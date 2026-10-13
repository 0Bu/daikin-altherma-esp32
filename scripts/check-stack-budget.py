#!/usr/bin/env python3
"""Fail when measured ESP32-S3 stack frames exceed reviewed budgets.

The check consumes demangled Xtensa objdump output. It deliberately names the
high-risk paths instead of pretending a static call graph can resolve function
pointers, callbacks, or compiler-generated thunks. Missing required symbols fail
closed, so an optimizer or rename cannot silently disable the gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[1]
DEFAULT_BUDGETS = REPO / "tools/stack/budgets.json"
FUNCTION_RE = re.compile(r"^\s*([0-9a-fA-F]+)\s+<(.+)>:\s*$")
INSTRUCTION_RE = re.compile(r"^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F]+)(?:\s+(.*))?$")
SECTION_RE = re.compile(r"^Disassembly of section .+:$")
STACK_MOVSP_RE = re.compile(r"movsp\s+a1,")
# Only these reviewed SDK functions may use objdump's packed-word rendering. A symbol's
# first instruction must still be at its entry address and contain the Xtensa ENTRY opcode.
PACKED_ENTRY_SYMBOLS = frozenset({
    '__wrap_mbedtls_ssl_handshake_client_step',
    '__wrap_mbedtls_ssl_read',
    '__wrap_mbedtls_ssl_write',
    '__wrap_mbedtls_ssl_write_client_hello',
    '_lock_acquire',
    '_read_r',
    '_ws_write$constprop$0',
    'add_sub_mpi',
    'aes_crypt_ecb_wrap',
    'cJSON_Delete',
    'cJSON_ParseWithLengthOpts',
    'calculate_rinv',
    'calloc',
    'ccm_auth_crypt',
    'ecp_add_mixed',
    'ecp_double_jac',
    'ecp_mul_comb_after_precomp$isra$0',
    'ecp_mul_restartable_internal$isra$0',
    'esp_aes_acquire_hardware',
    'esp_aes_cipher_update',
    'esp_aes_crypt_cbc',
    'esp_aes_crypt_ctr',
    'esp_aes_crypt_ecb',
    'esp_aes_dma_start',
    'esp_aes_gcm_auth_decrypt',
    'esp_aes_gcm_crypt_and_tag',
    'esp_aes_gcm_update',
    'esp_aes_process_dma',
    'esp_cache_get_alignment',
    'esp_clk_apb_freq',
    'esp_clk_cpu_freq',
    'esp_crt_check_signature',
    'esp_crt_verify_callback',
    'esp_crypto_aes_gcm_decrypt',
    'esp_crypto_sha_aes_lock_acquire',
    'esp_crypto_shared_gdma_start_axi_ahb',
    'esp_fill_random',
    'esp_heap_adjust_alignment_to_hw',
    'esp_hmac_compute_transparent',
    'esp_hmac_setup_transparent',
    'esp_log_timestamp',
    'esp_mbedtls_handshake',
    'esp_mbedtls_read',
    'esp_mbedtls_write',
    'esp_mqtt_client_publish',
    'esp_mqtt_client_subscribe_multiple',
    'esp_mqtt_client_subscribe_single',
    'esp_mqtt_client_unsubscribe',
    'esp_mqtt_task',
    'esp_mqtt_write',
    'esp_random',
    'esp_sha256_driver_compute',
    'esp_sha256_finish',
    'esp_sha256_update',
    'esp_sha512_driver_compute',
    'esp_sha512_finish',
    'esp_sha512_update',
    'esp_sha_acquire_hardware',
    'esp_sha_dma',
    'esp_sha_dma_start',
    'esp_sha_hash_compute',
    'esp_tls_conn_new_sync',
    'esp_tls_conn_read',
    'esp_tls_conn_write',
    'esp_tls_low_level_conn',
    'esp_transport_connect',
    'esp_transport_read',
    'esp_transport_read_exact_size',
    'esp_transport_read_internal',
    'esp_transport_write',
    'find_key',
    'gcm_mask',
    'gdma_new_ahb_channel',
    'heap_caps_aligned_alloc',
    'heap_caps_aligned_calloc',
    'lock_init_generic',
    'lwip_read',
    'lwip_read_r_wrapper',
    'lwip_recv_tcp',
    'lwip_recvfrom',
    'lwip_send',
    'lwip_write',
    'lwip_write_r_wrapper',
    'mbedtls_aes_crypt_ecb',
    'mbedtls_calloc',
    'mbedtls_ccm_auth_decrypt',
    'mbedtls_ccm_update',
    'mbedtls_cipher_update',
    'mbedtls_ecdsa_verify',
    'mbedtls_ecdsa_verify_restartable',
    'mbedtls_ecp_group_load',
    'mbedtls_ecp_mul',
    'mbedtls_ecp_mul_restartable',
    'mbedtls_ecp_mul_shortcuts$isra$0',
    'mbedtls_ecp_muladd_restartable',
    'mbedtls_gcm_auth_decrypt',
    'mbedtls_gcm_crypt_and_tag',
    'mbedtls_gcm_update',
    'mbedtls_mpi_add_abs',
    'mbedtls_mpi_add_mpi',
    'mbedtls_mpi_copy',
    'mbedtls_mpi_div_mpi',
    'mbedtls_mpi_exp_mod',
    'mbedtls_mpi_exp_mod_unsafe',
    'mbedtls_mpi_fill_random',
    'mbedtls_mpi_grow',
    'mbedtls_mpi_mod_mpi',
    'mbedtls_mpi_mul_int',
    'mbedtls_mpi_mul_mod',
    'mbedtls_mpi_mul_mpi',
    'mbedtls_mpi_random',
    'mbedtls_mpi_sub_int',
    'mbedtls_mpi_sub_mpi',
    'mbedtls_net_recv',
    'mbedtls_net_send',
    'mbedtls_pk_ecc_set_pubkey',
    'mbedtls_pk_parse_subpubkey',
    'mbedtls_pk_verify_ext',
    'mbedtls_psa_aead_decrypt',
    'mbedtls_psa_ecdsa_verify_hash',
    'mbedtls_psa_ecp_export_key',
    'mbedtls_psa_ecp_export_public_key',
    'mbedtls_psa_ecp_generate_key',
    'mbedtls_psa_ecp_import_key',
    'mbedtls_psa_external_get_random',
    'mbedtls_psa_get_random',
    'mbedtls_psa_key_agreement_ecdh',
    'mbedtls_psa_rsa_verify_hash',
    'mbedtls_rsa_pkcs1_verify',
    'mbedtls_rsa_public',
    'mbedtls_rsa_rsassa_pkcs1_v15_verify',
    'mbedtls_rsa_rsassa_pss_verify_ext',
    'mbedtls_ssl_decrypt_buf',
    'mbedtls_ssl_derive_keys',
    'mbedtls_ssl_fetch_input',
    'mbedtls_ssl_finish_handshake_msg',
    'mbedtls_ssl_flush_output',
    'mbedtls_ssl_handshake',
    'mbedtls_ssl_handshake_client_step',
    'mbedtls_ssl_handshake_step',
    'mbedtls_ssl_parse_certificate',
    'mbedtls_ssl_read',
    'mbedtls_ssl_read_record',
    'mbedtls_ssl_renegotiate',
    'mbedtls_ssl_start_renegotiation',
    'mbedtls_ssl_verify_certificate',
    'mbedtls_ssl_write',
    'mbedtls_ssl_write_client_hello',
    'mbedtls_ssl_write_handshake_msg_ext',
    'mbedtls_ssl_write_record',
    'mbedtls_x509_crt_parse_der_internal',
    'mbedtls_x509_crt_parse_der_nocopy',
    'mbedtls_x509_crt_verify_restartable',
    'mpi_mult_mpi_overlong$isra$0',
    'mqtt_client_enqueue_publish',
    'mqtt_message_receive',
    'mqtt_msg_publish',
    'netconn_apimsg',
    'netconn_recv_data_tcp',
    'netconn_recv_tcp_pbuf_flags',
    'netconn_write_partly',
    'netconn_write_vectors_partly',
    'parse_string',
    'parse_value',
    'psa_aead_decrypt',
    'psa_cipher_update',
    'psa_driver_wrapper_export_public_key',
    'psa_driver_wrapper_import_key',
    'psa_driver_wrapper_mac_compute',
    'psa_export_public_key',
    'psa_export_public_key_internal',
    'psa_generate_key',
    'psa_generate_key_custom',
    'psa_generate_key_internal',
    'psa_generate_random',
    'psa_generate_random_internal',
    'psa_import_key',
    'psa_import_key_into_slot',
    'psa_key_agreement_raw_builtin',
    'psa_key_derivation_output_bytes',
    'psa_mac_setup',
    'psa_mac_verify_setup',
    'psa_raw_key_agreement',
    'psa_verify_hash',
    'psa_verify_hash_builtin',
    'pthread_setspecific',
    'pvPortMalloc',
    'read',
    'ssl_check_ctr_renegotiate',
    'ssl_connect',
    'ssl_read',
    'ssl_write',
    'sys_mbox_post',
    'sys_thread_sem_get',
    'sys_thread_sem_init',
    'tcpip_send_msg_wait_sem',
    'tls_prf_generic',
    'tls_prf_sha256',
    'tls_prf_sha384',
    'ws_connect',
    'ws_read',
    'ws_write',
    'x509_crt_verify_restartable_ca_cb$constprop$0$isra$0',
    'xQueueCreateMutex',
    'xQueueGenericCreate',
    'xTaskGetTickCountFromISR',
})
SDK_TLS_LIMIT = 4608
SDK_TLS_ROM = 192
SDK_TRANSPORT_PREFIX_LIMIT = 880
SDK_TLS_PROFILES = frozenset({
    "certificate_ecdsa", "certificate_rsa_pss_adding", "certificate_rsa_pss_recursive",
    "certificate_rsa_v15_adding", "certificate_rsa_v15_recursive",
    "certificate_ecdsa_subtract", "ecdhe_generate_key", "ecdhe_export_public", "ecdhe_shared_secret",
    "record_ccm", "record_gcm_software", "prf_hmac_sha256",
    'ecdhe_rng_cpu',
    'ecdhe_rng_apb',
    'certificate_der_import',
    'record_gcm_hardware',
    'record_cbc_dma',
    'record_gcm_descriptor',
    'prf_hmac_sha384',
    'prefix_initial_wss',
    'prefix_wss_read',
    'prefix_wss_upgrade_read',
    'prefix_wss_write',
    'prefix_wss_upgrade_write',
    'bio_recv',
    'bio_recv_specific', 'bio_send', 'bio_send_ipc',
    'prf_dma_sha256',
    'prf_dma_sha384',
    'record_cbc_hmac_sha256',
    'record_cbc_hmac_sha384',
})
SDK_RECURSION_SYMBOLS = {
    "mpi_mult_mpi_overlong": "mpi_mult_mpi_overlong$isra$0",
    "ecp_mul_restartable_internal": "ecp_mul_restartable_internal$isra$0",
    "ecp_mul_comb_after_precomp": "ecp_mul_comb_after_precomp$isra$0",
    "x509_crt_verify_restartable_ca_cb": "x509_crt_verify_restartable_ca_cb$constprop$0$isra$0",
}
HTTP_STACK_RE = re.compile(r"\bcfg\.stack_size\s*=\s*([0-9]+)\s*;")
ENTRY_RE = re.compile(r"\bentry\s+a1,\s*(0x[0-9a-fA-F]+|[0-9]+)\b")
RULE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
TO_XSTRING_RE = re.compile(r"^[^\n]+ __gnu_cxx::__to_xstring<[^\n]+>\(")
DOUBLE_STRING_SYMBOL = "std::__cxx11::to_string(double)"
INTEGER_APPEND_SYMBOL = (
    "daik::json_append_integer_field_impl(std::__cxx11::basic_string<char, std::char_traits<char>, "
    "std::allocator<char> >&, std::basic_string_view<char, std::char_traits<char> >, "
    "unsigned long long, bool, bool)")
INTEGER_LENGTH_SYMBOL = (
    "unsigned int std::__detail::__to_chars_len<unsigned long long>(unsigned long long, int)")
INTEGER_DIGITS_SYMBOL = (
    "void std::__detail::__to_chars_10_impl<unsigned long long>(char*, unsigned int, unsigned long long)")
INTEGER_BUILDERS = {
    "daik::build_heartbeat_json[abi:cxx11](daik::HeartbeatFields const&)": 25,
    "daik::build_heating_curve_mqtt_json[abi:cxx11](daik::HeatingCurveMqttFields const&)": 21,
}
STATUS_HEALTH_NUMBER_SYMBOL = (
    "daik::append_status_json<daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u> >"
    "(daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u>&, bool)"
    "::{lambda(char const*, int)\x231}::operator()(char const*, int) const")
STATUS_UNSIGNED_NUMBER_SYMBOL = (
    "void daik::append_json_uint<daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u> >"
    "(daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u>&, unsigned long long)")
TASK_ALLOCATIONS = {
    "httpd": ("main/http_server.cpp", r"\bcfg\.stack_size\s*=\s*([0-9]+)\s*;"),
    "main": ("sdkconfig.defaults", r"(?m)^CONFIG_ESP_MAIN_TASK_STACK_SIZE=([0-9]+)$"),
    "mqtt": ("main/mqtt_ha.cpp", r'xTaskCreate\s*\(\s*mqtt_task,\s*"mqtt_pub",\s*([0-9]+)\s*,'),
    "sdk_mqtt": ("main/mqtt_ha.cpp", r"\bcfg\.task\.stack_size\s*=\s*([0-9]+)\s*;"),
    "poll": ("main/hp_poll.cpp", r'xTaskCreate\s*\(\s*poll_task,\s*"hp_poll",\s*([0-9]+)\s*,'),
    "modbus": ("main/hp_modbus.cpp", r'xTaskCreate\s*\(\s*mb_task,\s*"hp_modbus",\s*([0-9]+)\s*,'),
    "syslog": ("main/syslog.cpp", r'"syslog_task",\s*([0-9]+)\s*,'),
    "env3": ("main/env3.cpp", r'xTaskCreate\s*\(\s*task,\s*"env3",\s*([0-9]+)\s*,'),
    "led": ("main/status_led.cpp", r'xTaskCreate\s*\(\s*status_led_task,\s*"status_led",\s*([0-9]+)\s*,'),
    "button": ("main/recovery_button.cpp", r'xTaskCreate\s*\(\s*button_task,\s*"recovery_btn",\s*([0-9]+)\s*,'),
    "wifi": ("main/wifi.cpp", r'xTaskCreate\s*\(\s*wifi_watchdog_task,\s*"wifi_wd",\s*([0-9]+)\s*,'),
    "eth": ("main/net.cpp", r'xTaskCreate\s*\(\s*eth_fallback_task,\s*"eth_fb",\s*([0-9]+)\s*,'),
    "dns": ("main/captive_dns.cpp", r'xTaskCreate\s*\(\s*dns_task,\s*"captive_dns",\s*([0-9]+)\s*,'),
    "weather": ("main/weather_forecast.cpp", r'xTaskCreate\s*\(\s*weather_task,\s*"weather",\s*(kTaskStack)\s*,'),
    "ota": ("main/ota_update.cpp", r'xTaskCreateStatic\s*\(\s*ota_task,\s*"ota",\s*(kTaskStack)\s*,'),
    "ota_health": ("main/ota_update.cpp", r'xTaskCreateStatic\s*\(\s*health_gate_task,\s*"ota_health",\s*(kHealthTaskStack)\s*,'),
    "deadline": ("main/http_deadline.cpp", r'xTaskCreateStatic\s*\(\s*socket_deadline_watchdog_task,\s*"http_abs_dl",\s*(kWatchdogStackBytes)\s*,'),
}
SHUTDOWN_HTTP_CALLERS = {
    "wifi": "config_wifi", "mqtt": "config_mqtt", "syslog": "config_syslog",
    "ntp": "config_ntp", "board": "config_board", "env3": "config_env3",
}
SHUTDOWN_CALLERS = {
    **{f"httpd_shutdown_{name}": [symbol, "http_reboot", "sdk_restart"]
       for name, symbol in SHUTDOWN_HTTP_CALLERS.items()},
    "poll_shutdown": ["poll_task", "heap_guard", "sdk_restart"],
    "eth_shutdown": ["eth_task", "sdk_restart"],
    "ota_shutdown": ["ota_task", "sdk_restart"],
    "ota_health_shutdown": ["ota_health_task", "sdk_restart"],
}
SDK_PUBLIC_FILES = (
    "mbedtls/mbedtls/tf-psa-crypto/include/psa/crypto_sizes.h",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/psa_crypto_rsa.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/psa_crypto_ecp.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/rsa.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/ecp.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/bignum.c",
    "mbedtls/mbedtls/library/ssl_msg.c",
    "mbedtls/mbedtls/library/ssl_tls.c",
    "mbedtls/mbedtls/library/ssl_tls12_client.c",
    "mbedtls/mbedtls/library/x509_crt.c",
    "mbedtls/port/bignum/esp_bignum.c",
    "mbedtls/port/include/mbedtls/esp_config.h",
    "mbedtls/port/esp_mem.c",
    "mbedtls/port/dynamic/esp_mbedtls_dynamic_impl.c",
    "mbedtls/esp_crt_bundle/esp_crt_bundle.c",
    "esp-tls/esp_tls_mbedtls.c",
    "tcp_transport/transport_ssl.c", "tcp_transport/transport_ws.c",
    "tcp_transport/transport.c", "esp-tls/esp_tls.c",
    "esp_driver_i2c/i2c_master.c", "esp_driver_i2c/include/driver/i2c_types.h",
    "esp_driver_i2c/i2c_private.h",
    "mbedtls/mbedtls/library/ssl_ciphersuites.c", "mbedtls/mbedtls/library/ssl_misc.h",
    "mbedtls/mbedtls/library/x509.c",
    "mbedtls/mbedtls/tf-psa-crypto/core/psa_crypto.c",
    "mbedtls/mbedtls/tf-psa-crypto/core/psa_crypto_random.c",
    "mbedtls/mbedtls/tf-psa-crypto/core/psa_crypto_driver_wrappers_no_static.c",
    "mbedtls/mbedtls/tf-psa-crypto/extras/pk_ecc.c",
    "mbedtls/mbedtls/tf-psa-crypto/extras/pkparse.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/ecdsa.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/psa_crypto_aead.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/psa_crypto_mac.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/psa_crypto_cipher.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/cipher.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/ccm.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/gcm.c",
    "mbedtls/port/esp_hardware.c",
    "mbedtls/port/psa_driver/esp_mac/psa_crypto_driver_esp_hmac_transparent.c",
    "mbedtls/port/psa_driver/esp_aes/psa_crypto_driver_esp_aes.c",
    "mbedtls/port/aes/esp_aes.c", "mbedtls/port/aes/esp_aes_gcm.c",
    "mbedtls/port/aes/dma/esp_aes_dma_core.c",
    "esp_hw_support/hw_random.c", "esp_hw_support/heap_align_hw.c",
    "heap/heap_caps_base.c", "esp_security/src/esp_crypto_lock.c",
    "mbedtls/mbedtls/tf-psa-crypto/drivers/builtin/src/cipher_wrap.c",
    "mbedtls/port/psa_driver/esp_sha/psa_crypto_driver_esp_sha.c",
    "mbedtls/port/psa_driver/esp_sha/core/psa_crypto_driver_esp_sha256.c",
    "mbedtls/port/psa_driver/esp_sha/core/psa_crypto_driver_esp_sha512.c",
    "mbedtls/port/sha/esp_sha.c", "mbedtls/port/sha/core/esp_sha_gdma_impl.c",
    "mbedtls/port/aes/dma/esp_aes_gdma_impl.c", "mbedtls/port/crypto_shared_gdma/esp_crypto_shared_gdma.c",
    "esp_libc/src/locks.c", "freertos/heap_idf.c",
    "freertos/FreeRTOS-Kernel/queue.c", "freertos/FreeRTOS-Kernel/tasks.c",
    "esp_driver_dma/src/gdma.c",
    "mbedtls/port/net_sockets.c", "lwip/lwip/src/api/sockets.c",
    "lwip/lwip/src/api/api_lib.c", "lwip/lwip/src/api/tcpip.c",
    "lwip/port/freertos/sys_arch.c", "mbedtls/port/sha/core/sha.c",
    "vfs/vfs.c", "vfs/vfs_calls.c", "lwip/port/esp32xx/vfs_lwip.c",
    "pthread/pthread.c", "pthread/pthread_local_storage.c",
    "esp_system/esp_system.c",
)
SDK_PUBLIC_MACROS = (
    "CONFIG_ESP_MAIN_TASK_STACK_SIZE", "CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG",
    "CONFIG_LOG_VERSION", "CONFIG_LOG_DEFAULT_LEVEL",
    "CONFIG_MBEDTLS_INTERNAL_MEM_ALLOC", "CONFIG_MBEDTLS_CUSTOM_MEM_ALLOC",
    "CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC", "CONFIG_MBEDTLS_SSL_RENEGOTIATION",
    "CONFIG_MBEDTLS_HARDWARE_MPI", "CONFIG_MBEDTLS_LARGE_KEY_SOFTWARE_MPI",
    "CONFIG_MBEDTLS_MPI_USE_INTERRUPT", "CONFIG_MBEDTLS_MPI_INTERRUPT_LEVEL",
    "CONFIG_MBEDTLS_ECP_C", "CONFIG_MBEDTLS_ECP_DP_SECP521R1_ENABLED",
    "CONFIG_MBEDTLS_ECP_NIST_OPTIM", "CONFIG_MBEDTLS_ECDSA_C",
    "CONFIG_MBEDTLS_SSL_PROTO_TLS1_2", "CONFIG_MBEDTLS_SSL_PROTO_TLS1_3",
    "CONFIG_MBEDTLS_DYNAMIC_BUFFER", "CONFIG_MBEDTLS_CERTIFICATE_BUNDLE",
    "CONFIG_MBEDTLS_SSL_IN_CONTENT_LEN", "CONFIG_MBEDTLS_SSL_OUT_CONTENT_LEN",
    "CONFIG_MBEDTLS_DHM_C", "CONFIG_MBEDTLS_KEY_EXCHANGE_PSK",
    "CONFIG_MBEDTLS_KEY_EXCHANGE_ECDHE_PSK", "CONFIG_MBEDTLS_KEY_EXCHANGE_DHE_PSK",
    "CONFIG_MBEDTLS_KEY_EXCHANGE_RSA_PSK", "CONFIG_MBEDTLS_KEY_EXCHANGE_DHE_RSA",
    "CONFIG_MBEDTLS_KEY_EXCHANGE_ECJPAKE", "CONFIG_MBEDTLS_KEY_EXCHANGE_RSA",
    "CONFIG_MBEDTLS_KEY_EXCHANGE_ELLIPTIC_CURVE", "CONFIG_MBEDTLS_KEY_EXCHANGE_ECDHE_RSA",
    "CONFIG_MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA", "CONFIG_MBEDTLS_ECDH_C",
    "CONFIG_MBEDTLS_ECP_DP_SECP256R1_ENABLED", "CONFIG_MBEDTLS_ECP_DP_SECP384R1_ENABLED",
    "CONFIG_MBEDTLS_ECP_DP_SECP256K1_ENABLED", "CONFIG_MBEDTLS_ECP_DP_BP256R1_ENABLED",
    "CONFIG_MBEDTLS_ECP_DP_BP384R1_ENABLED", "CONFIG_MBEDTLS_ECP_DP_BP512R1_ENABLED",
    "CONFIG_MBEDTLS_ECP_DP_CURVE25519_ENABLED", "CONFIG_MBEDTLS_ECP_DP_CURVE448_ENABLED",
    "CONFIG_MBEDTLS_AES_C", "CONFIG_MBEDTLS_HARDWARE_AES", "CONFIG_MBEDTLS_AES_USE_INTERRUPT",
    "CONFIG_MBEDTLS_AES_INTERRUPT_LEVEL", "CONFIG_MBEDTLS_CIPHER_MODE_CBC",
    "CONFIG_MBEDTLS_GCM_C", "CONFIG_MBEDTLS_CCM_C", "CONFIG_MBEDTLS_CHACHA20_C",
    "CONFIG_MBEDTLS_CAMELLIA_C", "CONFIG_MBEDTLS_ARIA_C", "CONFIG_MBEDTLS_DES_C",
    "CONFIG_MBEDTLS_SHA1_C", "CONFIG_MBEDTLS_SHA256_C", "CONFIG_MBEDTLS_SHA384_C",
    "CONFIG_MBEDTLS_SHA512_C", "CONFIG_MBEDTLS_HARDWARE_SHA", "CONFIG_MBEDTLS_CTR_DRBG_C",
    "CONFIG_MBEDTLS_HMAC_DRBG_C", "CONFIG_MBEDTLS_RSA_C", "CONFIG_MBEDTLS_PKCS1_V15",
    "CONFIG_MBEDTLS_PKCS1_V21", "CONFIG_MBEDTLS_AES_HW_SMALL_DATA_LEN_OPTIM",
    "CONFIG_MBEDTLS_ECP_DP_SECP192R1_ENABLED", "CONFIG_MBEDTLS_ECP_DP_SECP224R1_ENABLED",
    "CONFIG_MBEDTLS_ECP_DP_SECP192K1_ENABLED", "CONFIG_MBEDTLS_ECP_DP_SECP224K1_ENABLED",
    "CONFIG_MBEDTLS_ECP_RESTARTABLE", "CONFIG_MBEDTLS_ECP_FIXED_POINT_OPTIM",
    "CONFIG_I2C_ISR_IRAM_SAFE",
    "CONFIG_LWIP_TCPIP_CORE_LOCKING", "CONFIG_LWIP_NETCONN_SEM_PER_THREAD",
)
INLINED_MQTT_HELPERS = (
    "publish_modbus_state", "publish_env3_state", "publish_env3_discovery",
    "retract_modbus_discovery", "retract_weather_discovery",
    "unsubscribe_reference_topic_if_unused",
)


class BudgetError(ValueError):
    """Disassembly or budget data cannot establish the required stack bound."""


def public_sdkconfig(header: Path) -> dict[str, int | None]:
    """Extract only the named public size/crypto macros; never return other header fields."""
    values: dict[str, int | None] = dict.fromkeys(SDK_PUBLIC_MACROS)
    seen: set[str] = set()
    try:
        with header.open(encoding="utf-8") as source:
            for line in source:
                match = re.match(r"\s*#define\s+(CONFIG_[A-Z0-9_]+)\s+(.+?)\s*$", line)
                if match is None or match.group(1) not in values:
                    continue
                name, value = match.groups()
                if name in seen or not re.fullmatch(r"(?:0x[0-9a-fA-F]+|[0-9]+)", value):
                    raise BudgetError(f"SDK public macro {name}: duplicate or non-integer definition")
                seen.add(name)
                values[name] = int(value, 0)
    except (OSError, UnicodeError) as exc:
        raise BudgetError(f"cannot extract public SDK configuration from {header}: {exc}") from exc
    return values


def validate_sdk_contract(budgets: dict[str, Any], components: Path, header: Path) -> None:
    """Re-review changed SDK code or active build flags before reusing the TLS/ROM envelope."""
    for name in SDK_PUBLIC_FILES:
        try:
            digest = hashlib.sha256((components / name).read_bytes()).hexdigest()
        except OSError as exc:
            raise BudgetError(f"SDK source {name}: unavailable ({exc})") from exc
        if digest != budgets["sdk"]["source_sha256"][name]:
            raise BudgetError(f"SDK source {name}: reviewed fingerprint changed; source-bound budgets need review")
    actual = public_sdkconfig(header)
    for name, expected in budgets["sdk"]["config_macros"].items():
        if actual[name] != expected:
            raise BudgetError(f"SDK public macro {name}: active build differs from reviewed configuration")
    if actual["CONFIG_ESP_MAIN_TASK_STACK_SIZE"] != budgets["tasks"]["main"]["stack_bytes"]:
        raise BudgetError("main task: active SDK stack allocation differs from source-bound budget")


def function_instructions(disassembly: str) -> dict[str, list[str]]:
    blocks: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in disassembly.splitlines():
        if SECTION_RE.match(line):
            current = None
            continue
        header = FUNCTION_RE.match(line)
        if header:
            current = blocks.setdefault(header.group(2), [])
        elif current is not None and (instruction := INSTRUCTION_RE.match(line)):
            current.append((instruction.group(3) or "").strip())
    return blocks


def validate_dynamic_stack(disassembly: str, frames: dict[str, int],
                           required: list[re.Pattern[str]]) -> None:
    """Bind libstdc++'s one reviewed alloca caller; never treat ENTRY as its whole frame."""
    blocks = function_instructions(disassembly)
    dynamic = [name for name, instructions in blocks.items()
               if any(STACK_MOVSP_RE.match(text) for text in instructions)
               and any(pattern.search(name) for pattern in required)]
    for name in dynamic:
        if name != "s_i2c_start_end_command" and not TO_XSTRING_RE.search(name):
            raise BudgetError(f"symbol {name}: unreviewed dynamic stack adjustment")
    if "s_i2c_start_end_command" in frames:
        body = "\n".join(blocks["s_i2c_start_end_command"])
        sequence = (
            r"addi\.n\s+a10,\s*a5,\s*15\nsrli\s+a10,\s*a10,\s*4\n"
            r"slli\s+a10,\s*a10,\s*4\nsub\s+a8,\s*a1,\s*a10\nmovsp\s+a1,\s*a8\n"
            r"s32i\.n\s+a9,\s*a7,\s*4\nsub\s+a8,\s*a1,\s*a10\n"
            r"mov\.n\s+a4,\s*a1\nmovsp\s+a1,\s*a8")
        lengths = re.findall(r"\bmovi(?:\.n)?\s+a5,\s*([0-9]+)\b", body)
        if (frames["s_i2c_start_end_command"] != 64 or lengths != ["1", "0", "2"]
                or len(re.findall(r"\bmovsp\s+a1,", body)) != 2 or not re.search(sequence, body)):
            raise BudgetError("I2C address formatter: ENTRY64 / 0..2 bytes / two align16 allocations changed")
        frames["s_i2c_start_end_command"] += 32
    matches = [name for name in blocks if TO_XSTRING_RE.search(name)]
    if not any(TO_XSTRING_RE.search(name) for name in frames
               if any(pattern.search(name) for pattern in required)):
        return
    if len(matches) != 1:
        raise BudgetError("double formatter: exactly one reviewed __to_xstring body is required")
    name = matches[0]
    body = blocks[name]
    alignment = [
        r"addi\.n\s+a8,\s*a4,\s*15", r"srli\s+a8,\s*a8,\s*4",
        r"slli\s+a8,\s*a8,\s*4", r"sub\s+a8,\s*a1,\s*a8",
        r"movsp\s+a1,\s*a8",
    ]
    sequence = "\n".join(body)
    if (frames.get(name) != 80 or len(re.findall(r"\bmovsp\b", sequence)) != 1
            or not re.search("\n".join(alignment), sequence)):
        raise BudgetError("double formatter: reviewed ENTRY80 / align16 / movsp contract changed")
    callers: list[tuple[str, int]] = []
    for caller, instructions in blocks.items():
        for index, instruction in enumerate(instructions):
            if f"<{name}>" not in instruction:
                continue
            if not re.match(r"call8\s", instruction):
                raise BudgetError("double formatter: unreviewed indirect __to_xstring reference")
            callers.append((caller, index))
    if len(callers) != 1 or callers[0][0] != DOUBLE_STRING_SYMBOL:
        raise BudgetError("double formatter: sole to_string(double) caller contract changed")
    caller, index = callers[0]
    prefix = blocks[caller][max(0, index - 2):index]
    if (frames.get(caller) != 32 or len(prefix) != 2
            or not re.fullmatch(r"movi\s+a12,\s*(?:0x148|328)", prefix[0])
            or not re.fullmatch(r"or\s+a10,\s*a2,\s*a2", prefix[1])):
        raise BudgetError("double formatter: immediate bounded 328-byte argument changed")
    frames[name] += 336  # round 328 up to the exact 16-byte alignment above


def validate_integer_formatter(disassembly: str) -> None:
    """Keep the uint64 decimal conversion and its two callers in the reviewed fixed paths."""
    blocks = function_instructions(disassembly)
    for name in blocks:
        if ("daik::json_append_integer_field" in name
                and name != INTEGER_APPEND_SYMBOL):
            raise BudgetError(f"integer formatter: newly outlined or cloned continuation {name}")
    if INTEGER_APPEND_SYMBOL not in blocks:
        return  # The required symbol inventory reports a missing helper.
    callers: dict[str, int] = {}
    for caller, instructions in blocks.items():
        for instruction in instructions:
            if f"<{INTEGER_APPEND_SYMBOL}>" not in instruction:
                continue
            if not re.match(r"call8\s", instruction):
                raise BudgetError("integer formatter: indirect helper reference requires review")
            callers[caller] = callers.get(caller, 0) + 1
    if callers != INTEGER_BUILDERS:
        raise BudgetError("integer formatter: the two reviewed builder caller counts changed")

    def calls(name: str) -> list[str]:
        result = []
        for index, instruction in enumerate(blocks.get(name, [])):
            if not re.match(r"call", instruction):
                continue
            direct = re.fullmatch(r"call8\s+[0-9a-f]+\s+<(.+)>", instruction)
            if direct:
                result.append(direct.group(1))
                continue
            indirect = re.fullmatch(r"callx8\s+(a[0-9]+)", instruction)
            previous = blocks[name][index - 1] if index else ""
            literal = re.fullmatch(
                r"l32r\s+" + (indirect.group(1) if indirect else "INVALID")
                + r",\s+[^\n]+\([0-9a-f]+\s+<(.+)>\)", previous)
            if indirect is None or literal is None:
                raise BudgetError(f"integer formatter: unreviewed call dispatch in {name}")
            result.append(literal.group(1))
        return result

    string = "std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> >"
    expected = {
        INTEGER_APPEND_SYMBOL: [
            string + "::append(char const*, unsigned int)",
            "_ZNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEpLEPKc$isra$0",
            string + "::push_back(char)", string + "::append(char const*, unsigned int)",
            INTEGER_LENGTH_SYMBOL, INTEGER_DIGITS_SYMBOL,
        ],
        INTEGER_LENGTH_SYMBOL: ["__udivdi3"],
        INTEGER_DIGITS_SYMBOL: ["memcpy", "__umoddi3", "__udivdi3"],
    }
    for name, targets in expected.items():
        if name in blocks and calls(name) != targets:
            raise BudgetError(f"integer formatter: decimal/append/ROM continuation changed in {name}")
    helper = "\n".join(blocks[INTEGER_APPEND_SYMBOL])
    if (not re.search(r"movi\s+a12,\s*10\n[^\n]+\n[^\n]+\ncall8\s+[0-9a-f]+\s+<"
                      + re.escape(INTEGER_LENGTH_SYMBOL) + r">", helper)
            or not re.search(r"movi\.n\s+a8,\s*20\n[^\n]+\naddi\s+a5,\s*a1,\s*20\n", helper)):
        raise BudgetError("integer formatter: decimal base / fixed 20-byte destination changed")


def validate_shutdown_inlining(disassembly: str, budgets: dict[str, Any]) -> None:
    """Bind omitted nominal helper frames to the measured task-level restart instructions."""
    blocks: dict[str, list[str]] = {}
    current = None
    for line in disassembly.splitlines():
        if header := FUNCTION_RE.match(line):
            current = header.group(2)
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line)
    for name, lines in blocks.items():
        # run_update's chunk lambda is emitted separately, but it returns before the task's
        # restart. A nominal helper/cloned helper would need its own newly reviewed frame.
        nominal = ("{lambda" not in name
                   and re.search(r"\b(?:factory_reset|run_update)\(", name))
        raw_clone = re.match(r"^_Z.*(?:13factory_reset|10run_update)E", name)
        if nominal or raw_clone:
            raise BudgetError(f"shutdown inlining: outlined helper {name} needs frame accounting")
        if ("{lambda" in name and "run_update" in name
                and any("<esp_restart" in line for line in lines)):
            raise BudgetError("shutdown inlining: update lambda now contains a restart")
    direct = re.compile(r"^\s*[0-9a-f]+:\s+[0-9a-f]+\s+call8\s+[0-9a-f]+\s+<esp_restart>\s*$")
    for key in ("button_task", "ota_task"):
        pattern = re.compile(budgets["symbols"][key]["pattern"])
        matches = [lines for name, lines in blocks.items() if pattern.search(name)]
        if (len(matches) != 1
                or sum(bool(direct.match(line)) for line in matches[0]) != 1
                or sum("<esp_restart" in line for line in matches[0]) != 1):
            raise BudgetError(f"shutdown inlining: {key} must contain its sole direct restart")


def validate_status_numeric_calls(disassembly: str, budgets: dict[str, Any]) -> None:
    """Keep the outlined nullable-number helper on its sole serializer caller."""
    references: list[tuple[str, str]] = []
    current = None
    for line in disassembly.splitlines():
        if header := FUNCTION_RE.match(line):
            current = header.group(2)
        elif current is not None and "<" + STATUS_HEALTH_NUMBER_SYMBOL + ">" in line:
            references.append((current, line))
    serializer = re.compile(budgets["symbols"]["status_serializer"]["pattern"])
    direct = re.compile(r"^\s*[0-9a-f]+:\s+[0-9a-f]+\s+call8\s+[0-9a-f]+\s+<"
                        + re.escape(STATUS_HEALTH_NUMBER_SYMBOL) + r">\s*$")
    # The compiler merges two branch tails from the 27 source invocations into 25 calls.
    if (len(references) != 25
            or any(not serializer.search(caller) or not direct.match(line)
                   for caller, line in references)):
        raise BudgetError("diagnosis numeric calls: 25 direct serializer calls require review")


def parse_frames(disassembly: str, budgets: dict[str, Any] | None = None) -> dict[str, int]:
    if budgets is None:
        budgets = load_budgets(DEFAULT_BUDGETS)
    required = [re.compile(rule["pattern"]) for rule in budgets["symbols"].values()]
    frames: dict[str, int] = {}
    current: str | None = None
    symbol_address = 0
    strict = False
    for line in disassembly.splitlines():
        if SECTION_RE.match(line):
            if current is not None and strict:
                raise BudgetError(f"symbol {current}: missing first prologue before section boundary")
            current = None
            strict = False
            continue
        header = FUNCTION_RE.match(line)
        if header:
            if current is not None and strict:
                raise BudgetError(f"symbol {current}: missing first prologue")
            current = header.group(2)
            symbol_address = int(header.group(1), 16)
            for name in INLINED_MQTT_HELPERS:
                if (re.match(r"^daik::" + name + r"\(", current)
                        or re.match(r"^_Z[ZN]+4daikL" + str(len(name)) + name, current)):
                    raise BudgetError(f"symbol {current}: newly outlined MQTT continuation needs budget review")
            if re.match(r"^parse_(?:array|object)(?:[.$]|$)", current):
                raise BudgetError(f"symbol {current}: out-of-line cJSON container needs budget review")
            if re.match(r"^(?:parse_value|parse_string|cJSON_Delete|cJSON_ParseWithLengthOpts)[.$]", current):
                raise BudgetError(f"symbol {current}: cloned cJSON recursion needs budget review")
            for base, reviewed in SDK_RECURSION_SYMBOLS.items():
                if re.match(re.escape(base) + r"(?:[.$]|$)", current) and current != reviewed:
                    raise BudgetError(f"symbol {current}: newly outlined SDK recursion needs budget review")
            strict = current in PACKED_ENTRY_SYMBOLS or any(p.search(current) for p in required)
            if strict and current in frames:
                raise BudgetError(f"duplicate required symbol {current}")
            continue
        if current is None:
            continue
        if strict:
            instruction = INSTRUCTION_RE.match(line)
            if not instruction:
                if re.match(r"^\s*[0-9a-fA-F]+:", line):
                    raise BudgetError(f"symbol {current}: truncated first prologue")
                continue
            if int(instruction.group(1), 16) != symbol_address:
                raise BudgetError(f"symbol {current}: first instruction is not at symbol address")
            mnemonic = (instruction.group(3) or "").strip()
            entry = ENTRY_RE.fullmatch(mnemonic)
            if entry:
                frame = int(entry.group(1), 0)
            elif (current in PACKED_ENTRY_SYMBOLS and len(instruction.group(2)) == 8 and
                  (not mnemonic or re.fullmatch(r"\.word\s+0x[0-9a-fA-F]{8}", mnemonic))):
                # Standard SDK objdump can print a packed word with no mnemonic; raw objdump
                # can label it .word. Decode only reviewed first words at their exact symbol
                # addresses. A later ENTRY cannot supply a bound.
                word = int(instruction.group(2), 16)
                raw24 = word & 0xFFFFFF
                if (mnemonic and word != int(mnemonic.split()[1], 16)) or raw24 & 0xFFF != 0x136:
                    raise BudgetError(f"symbol {current}: wrong packed first prologue")
                frame = (raw24 >> 12) * 8
            else:
                raise BudgetError(f"symbol {current}: undecodable first prologue")
            if frame == 0:
                raise BudgetError(f"symbol {current}: empty first stack frame")
            frames[current] = frame
            current = None
            continue
        entry = ENTRY_RE.search(line)
        if entry:
            frame = int(entry.group(1), 0)
            frames[current] = max(frame, frames.get(current, 0))
            current = None
    if current is not None and strict:
        raise BudgetError(f"symbol {current}: missing first prologue")
    validate_dynamic_stack(disassembly, frames, required)
    validate_integer_formatter(disassembly)
    return frames


def validate_http_stack(budgets: dict[str, Any], source: str) -> None:
    matches = HTTP_STACK_RE.findall(source)
    if len(matches) != 1:
        raise BudgetError("HTTP stack must have one machine-readable cfg.stack_size literal")
    stack_size = int(matches[0])
    for name, rule in budgets["paths"].items():
        if name.startswith("httpd_") and rule["max_bytes"] > stack_size - 2048:
            raise BudgetError(f"path {name}: ceiling must retain 2048 B on HTTP stack {stack_size}")


def validate_status_diagnosis_paths(budgets: dict[str, Any], sources: dict[str, str]) -> None:
    """Keep the report frame on its real HTTP callers, separate from decimal-format branches."""
    expected = {
        "httpd_mcp_status": ["mcp_post", "http_send_status_json", "status_serializer",
                             "double_string", "dynamic_double_string"],
        "httpd_direct_status": ["http_send_status_json", "status_serializer",
                                "double_string", "dynamic_double_string"],
        "httpd_mcp_checkup": ["mcp_post", "http_send_status_json", "status_serializer",
                              "checkup_report"],
        "httpd_direct_checkup": ["http_send_status_json", "status_serializer", "checkup_report"],
        "httpd_mcp_health_number": ["mcp_post", "http_send_status_json", "status_serializer",
                                    "status_health_number", "status_unsigned_number"],
        "httpd_direct_health_number": ["http_send_status_json", "status_serializer",
                                       "status_health_number", "status_unsigned_number"],
    }
    for name, members in expected.items():
        rule = budgets["paths"].get(name, {})
        if (rule.get("symbols") != members or rule.get("multipliers") != {}
                or rule.get("base_bytes") != 1536 or rule.get("max_bytes") != 8192):
            raise BudgetError(f"diagnosis status path {name}: HTTP caller/report accounting changed")
    report_paths = {name for name, rule in budgets["paths"].items()
                    if "checkup_report" in rule["symbols"]}
    if report_paths != {"httpd_mcp_checkup", "httpd_direct_checkup"}:
        raise BudgetError("diagnosis status paths: checkup_report belongs to HTTP, not polling")
    code = {name: re.sub(r"/\*.*?\*/|//[^\n]*", "", sources[name], flags=re.S)
            for name in ("main/http_status.cpp", "main/mcp_server.cpp", "main/hp_poll.cpp")}
    status = code["main/http_status.cpp"]
    if (len(re.findall(r"\bcheckup_report\s*\(", status)) != 1
            or not re.search(r"const logic::CheckupReport hr\s*=\s*checkup_report\(\);", status)
            or len(re.findall(r"\bappend_status_json\(out, redact\)", status)) != 1
            or not re.search(r"return http_send_status_json\(req, \{\}, \{\}, redact\);", status)
            or len(re.findall(r"\bhttp_send_status_json\s*\(", code["main/mcp_server.cpp"])) != 1
            or not re.search(r"return http_send_status_json\(req, response, suffix, false\);",
                             code["main/mcp_server.cpp"])
            or re.search(r"\b(?:checkup_report|http_send_status_json)\s*\(", code["main/hp_poll.cpp"])):
        raise BudgetError("diagnosis status source: direct/MCP-only serializer caller contract changed")
    if (len(re.findall(r"\bnum\s*\(", status)) != 27
            or not re.search(r"auto num = \[&j\]\(const char\* name, int v\) "
                             r"__attribute__\(\(noinline\)\)\s*\{", status)
            or not re.search(r"if \(v < 0\)\s*\{[^{}]*return;\s*\}\s*"
                             r"append_json_uint\(j, static_cast<unsigned>\(v\)\);", status)
            or not re.search(r"static void append_json_uint\(JsonOut& out, uint64_t value\)\s*\{\s*"
                             r"char digits\[20\];", status)
            or not re.search(r"value % 10\)\);\s*value /= 10;", status)):
        raise BudgetError("diagnosis numeric source: nullable int/fixed uint64 decimal contract changed")


def shutdown_path_members() -> dict[str, list[str]]:
    # esp_restart invokes handlers sequentially. Keep their paths separate and retain the
    # existing 1536 B SDK/ROM continuation, including smaller reset/seal descendants.
    paths = {}
    for name, prefix in SHUTDOWN_CALLERS.items():
        paths[name + "_journal"] = prefix + ["history_shutdown", "history_journal",
                                             "history_append", "history_append_at"]
        paths[name + "_checkup"] = prefix + ["checkup_shutdown", "checkup_shutdown_reset"]
    # A successful factory reset has already forgotten the journal; the liveness touch and
    # independently registered checkup handler still run. Keep that exclusion source-bound.
    paths["button_shutdown_history_touch"] = ["button_task", "sdk_restart", "history_shutdown"]
    paths["button_shutdown_checkup"] = ["button_task", "sdk_restart", "checkup_shutdown",
                                        "checkup_shutdown_reset"]
    paths["poll_board_journal"] = ["poll_task", "history_board", "history_journal",
                                   "history_append", "history_append_at"]
    return paths


def stack_source_code(source: str) -> str:
    # Blanking strings as well as comments makes brace matching independent of diagnostic copy.
    tokens = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|/\*.*?\*/|//[^\n]*'
    return re.sub(tokens, lambda match: " " * len(match[0]), source, flags=re.S)


def stack_function_body(source: str, name: str) -> str:
    definitions = list(re.finditer(r"\b" + re.escape(name) +
                                   r"\([^;{}]*\)\s*(?:noexcept\s*)?\{", source))
    if len(definitions) != 1:
        raise BudgetError(f"shutdown source: expected one definition of {name}")
    start = definitions[0].end()
    depth = 1
    for end in range(start, len(source)):
        depth += (source[end] == "{") - (source[end] == "}")
        if depth == 0:
            return source[start:end]
    raise BudgetError(f"shutdown source: unclosed body of {name}")


def validate_shutdown_paths(budgets: dict[str, Any], sources: dict[str, str]) -> None:
    expected = shutdown_path_members()
    modeled = {name for name in budgets["paths"]
               if "_shutdown" in name or name == "poll_board_journal"}
    if modeled != set(expected):
        raise BudgetError("shutdown paths: complete caller inventory changed")
    for name, members in expected.items():
        rule = budgets["paths"][name]
        owner = "ota_health" if name.startswith("ota_health_") else name.split("_")[0]
        task = budgets["tasks"][owner]
        if (rule["symbols"] != members or rule["multipliers"] != {}
                or rule["base_bytes"] != 1536
                or rule["max_bytes"] != task["stack_bytes"] - task["reserve_bytes"]):
            raise BudgetError(f"shutdown path {name}: caller/handler/SDK continuation changed")
    code = {name: stack_source_code(source) for name, source in sources.items()}
    counts = {"main/http_config.cpp": 1, "main/heap_guard.cpp": 1,
              "main/net.cpp": 1, "main/recovery_button.cpp": 1, "main/wifi.cpp": 1,
              "main/ota_update.cpp": 2}
    actual = {name: len(re.findall(r"\besp_restart\s*\(", source))
              for name, source in code.items() if re.search(r"\besp_restart\s*\(", source)}
    if actual != counts:
        raise BudgetError("shutdown source: restart caller inventory changed")
    registrations = {name: len(re.findall(r"\besp_register_shutdown_handler\s*\(", source))
                     for name, source in code.items()
                     if re.search(r"\besp_register_shutdown_handler\s*\(", source)}
    if registrations != {"main/history.cpp": 1, "main/checkup.cpp": 1}:
        raise BudgetError("shutdown source: handler registration inventory changed")
    bodies = {}
    for path, name in (("main/http_config.cpp", "reboot_soon"),
                       ("main/heap_guard.cpp", "heap_guard_sample"),
                       ("main/net.cpp", "eth_fallback_task"),
                       ("main/recovery_button.cpp", "factory_reset"),
                       ("main/wifi.cpp", "wifi_finish_sta_rollback"),
                       ("main/ota_update.cpp", "run_update"),
                       ("main/ota_update.cpp", "health_gate_task")):
        bodies[name] = stack_function_body(code[path], name)
        if len(re.findall(r"\besp_restart\s*\(\s*\)", bodies[name])) != 1:
            raise BudgetError(f"shutdown source: restart moved outside {name}")
    for name in SHUTDOWN_HTTP_CALLERS:
        body = stack_function_body(code["main/http_config.cpp"], "set_" + name)
        if len(re.findall(r"\breboot_soon\s*\(\s*\)", body)) != 1:
            raise BudgetError(f"shutdown source: HTTP restart caller set_{name} changed")
    if len(re.findall(r"\breboot_soon\s*\(\s*\)", code["main/http_config.cpp"])) != 7:
        raise BudgetError("shutdown source: unreviewed HTTP restart caller")
    for path, parent, child in (("main/hp_poll.cpp", "poll_task", "heap_guard_sample"),
                                ("main/hp_poll.cpp", "poll_task", "history_record_board"),
                                ("main/recovery_button.cpp", "button_task", "factory_reset"),
                                ("main/ota_update.cpp", "ota_task", "run_update")):
        if len(re.findall(r"\b" + child + r"\s*\(", stack_function_body(code[path], parent))) != 1:
            raise BudgetError(f"shutdown source: {parent}/{child} caller changed")
    for name, count in (("heap_guard_sample", 2), ("history_record_board", 2),
                        ("factory_reset", 2), ("run_update", 2), ("wifi_start_sta", 2),
                        ("wifi_finish_sta_rollback", 2), ("checkup_reboot_save", 1),
                        ("history_flash_save", 1), ("history_flash_service_journal", 4)):
        actual = sum(len(re.findall(r"\b" + name + r"\s*\(", source))
                     for path, source in code.items() if path.endswith(".cpp"))
        if actual != count:
            raise BudgetError(f"shutdown source: unreviewed caller of {name}")
    history = code["main/history.cpp"]
    checkup = code["main/checkup.cpp"]
    if (not re.search(r"esp_register_shutdown_handler\(history_flash_save\)",
                      stack_function_body(history, "history_start"))
            or not re.search(r"esp_register_shutdown_handler\(checkup_reboot_save\)",
                             stack_function_body(checkup, "checkup_start"))
            or not re.search(r"history_flash_service_journal\(\s*12,\s*pdMS_TO_TICKS\(200\)\)",
                             stack_function_body(history, "history_flash_save"))
            or not re.search(r"history_flash_service_journal\(\s*3,\s*0\)",
                             stack_function_body(history, "history_record_board"))):
        raise BudgetError("shutdown source: registered handler/journal caller changed")
    boot = stack_function_body(code["main/main.cpp"], "boot_sequence")
    positions = [boot.find(name + "(") for name in ("wifi_start_sta", "history_start", "checkup_start")]
    if (any(position < 0 for position in positions) or positions != sorted(positions)
            or len(re.findall(r"\bwifi_start_sta\s*\(", code["main/main.cpp"])) != 1
            or len(re.findall(r"\bwifi_finish_sta_rollback\s*\(",
                              stack_function_body(code["main/wifi.cpp"], "wifi_start_sta"))) != 1):
        raise BudgetError("shutdown source: pre-handler WiFi rollback ordering changed")
    reset = bodies["factory_reset"]
    incomplete = re.search(r"if\s*\(wifi_e != ESP_OK \|\| !history_erased \|\| !crash_erased\)\s*\{",
                           reset)
    if (not re.search(r"history_erased\s*=\s*e == ESP_OK && wifi_e == ESP_OK\s*\?\s*"
                      r"history_flash_forget\(\)\s*:\s*false", reset)
            or incomplete is None or "return;" not in reset[incomplete.end():reset.find("}", incomplete.end())]
            or incomplete.start() > reset.find("esp_restart(")
            or not re.search(r"^\s*s_flash_forgotten\.store\(true\);",
                             stack_function_body(history, "history_flash_forget"))
            or not re.search(r"if\s*\(!s_flash_part \|\| s_flash_shutdown_started \|\| "
                             r"s_flash_forgotten\.load\(\)\) return;",
                             stack_function_body(history, "history_flash_save"))):
        raise BudgetError("shutdown source: factory-reset journal exclusion changed")


def validate_task_stacks(budgets: dict[str, Any], sources: dict[str, str]) -> None:
    """Check ceilings against the allocation actually passed to each application task."""
    tasks = budgets["tasks"]
    if set(tasks) != set(TASK_ALLOCATIONS):
        raise BudgetError("task allocation inventory changed or is incomplete")
    owners: dict[str, str] = {}
    for task, (source_path, pattern) in TASK_ALLOCATIONS.items():
        source = sources[source_path]
        source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
        matches = re.findall(pattern, source)
        if len(matches) != 1:
            raise BudgetError(f"task {task}: expected one machine-readable allocation")
        token = matches[0]
        if not token.isdigit():
            constants = re.findall(r"\b" + re.escape(token) + r"\s*=\s*([0-9]+)\s*;", source)
            if len(constants) != 1:
                raise BudgetError(f"task {task}: allocation constant requires review")
            token = constants[0]
        actual = int(token)
        rule = tasks[task]
        if actual != rule["stack_bytes"]:
            raise BudgetError(f"task {task}: source allocation {actual} B differs from reviewed {rule['stack_bytes']} B")
        for path in rule["paths"]:
            if path in owners:
                raise BudgetError(f"path {path}: duplicate task owner")
            expected = {"http_deadline_watchdog": "deadline", "ota_health_gate": "ota_health",
                        "ota_health_shutdown_journal": "ota_health",
                        "ota_health_shutdown_checkup": "ota_health"}.get(path)
            if expected is None:
                candidates = [owner for owner in tasks if path.startswith(owner + "_")]
                if len(candidates) != 1:
                    raise BudgetError(f"path {path}: task owner prefix requires review")
                expected = candidates[0]
            if expected != task:
                raise BudgetError(f"path {path}: source-bound owner must remain {expected}")
            owners[path] = task
            if budgets["paths"][path]["max_bytes"] > actual - rule["reserve_bytes"]:
                raise BudgetError(f"path {path}: ceiling must retain {rule['reserve_bytes']} B on {task} stack {actual}")
    if set(owners) != set(budgets["paths"]):
        raise BudgetError("every stack path must have exactly one source-bound task owner")


def validate_task_inventory(sources: dict[str, str]) -> None:
    expected: dict[str, int] = {}
    for task, (path, _) in TASK_ALLOCATIONS.items():
        if task not in ("httpd", "main", "sdk_mqtt"):
            expected[path] = expected.get(path, 0) + 1
    for path, source in sources.items():
        source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
        count = len(re.findall(r"\bxTaskCreate[A-Za-z0-9_]*\s*\(", source))
        if count != expected.get(path, 0):
            raise BudgetError(f"task creation inventory requires review: {path}")
    if not set(expected) <= set(sources):
        raise BudgetError("task creation source inventory is incomplete")


def validate_syslog_queue(source: str) -> None:
    """Bind the reviewed short SDK continuation to one valid nonblocking message queue."""
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
    if (len(re.findall(r"\bs_queue\s*=", source)) != 2
            or len(re.findall(r"s_queue\s*=\s*xQueueCreate\(32,\s*sizeof\(SyslogMsg\)\)", source)) != 1
            or len(re.findall(r"xQueueSend\(s_queue,\s*&m,\s*0\)", source)) != 1
            or len(re.findall(r"\bxQueueSend\s*\(", source)) != 1
            or re.search(r"\bxQueueAddToSet\s*\(", source)
            or not re.search(r"void syslog_send\([^\n]+\)\s*\{\s*if \(!s_queue\) return;", source)):
        raise BudgetError("Syslog queue: valid nonblocking fixed-message contract changed")


def validate_small_task_diagnostics(sources: dict[str, str]) -> None:
    defaults = sources["sdkconfig.defaults"]
    if (not re.search(r"(?m)^CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y$", defaults)
            or not re.search(r"(?m)^CONFIG_LOG_DEFAULT_LEVEL_INFO=y$", defaults)
            or re.search(r"(?m)^CONFIG_LOG_VERSION(?:_?2=y|=2)$", defaults)
            or any(re.search(r"\besp_log_set_vprintf\s*\(", source) for source in sources.values())):
        raise BudgetError("diagnostic console: reviewed USB/INFO/default-vprintf contract changed")
    for task in ("led", "button", "wifi", "eth"):
        path = TASK_ALLOCATIONS[task][0]
        source = re.sub(r"/\*.*?\*/|//[^\n]*", "", sources[path], flags=re.S)
        calls = re.findall(r'\bdiag_printf\s*\(\s*((?:"(?:[^"\\]|\\.)*"\s*)+)', source)
        if len(calls) != len(re.findall(r"\bdiag_printf\s*\(", source)):
            raise BudgetError(f"task {task}: dynamic diagnostic format requires review")
        for call in calls:
            literals = re.findall(r'"((?:[^"\\]|\\.)*)"', call)
            fmt = "".join(literals).replace("%%", "")
            if re.search(r"%[-+ \x230-9.*$hlLjzt]*[aAeEfFgG]", fmt):
                raise BudgetError(f"task {task}: floating diagnostic format requires a new stack bound")


def validate_mqtt_tls_client(source: str) -> None:
    """Exclude unreviewed client-certificate/PSK/private-key continuations explicitly."""
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
    expected = {"task.stack_size", "broker.address.uri", "broker.verification.crt_bundle_attach",
                "credentials.client_id", "credentials.username", "credentials.authentication.password",
                "session.keepalive", "outbox.limit", "session.last_will.topic", "session.last_will.msg",
                "session.last_will.msg_len", "session.last_will.qos", "session.last_will.retain"}
    fields = re.findall(r"\bcfg\.([a-z_0-9]+(?:\.[a-z_0-9]+)*)\s*=", source)
    if (len(re.findall(r"\besp_mqtt_client_config_t\s+cfg\s*=\s*\{\s*\}\s*;", source)) != 1
            or len(fields) != len(expected) or set(fields) != expected
            or not re.search(r"cfg\.broker\.verification\.crt_bundle_attach\s*=\s*esp_crt_bundle_attach\s*;", source)):
        raise BudgetError("MQTT TLS client: reviewed zero-init/bundle/password field contract changed")


def validate_env_i2c(source: str) -> None:
    """Bind ENV and HTTP-probe transfers to short synchronous operations and 7-bit devices."""
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
    expected_fields = {"dev_addr_length", "device_address", "scl_speed_hz", "i2c_port", "sda_io_num",
                       "scl_io_num", "clk_source", "glitch_ignore_cnt", "flags.enable_internal_pullup"}
    fields = re.findall(r"\bcfg\.([a-z_0-9]+(?:\.[a-z_0-9]+)*)\s*=", source)
    if (set(fields) != expected_fields or len(fields) != len(expected_fields)
            or len(re.findall(r"i2c_master_bus_config_t\s+cfg\s*=\s*\{\s*\}\s*;", source)) != 1
            or not re.search(r"cfg\.dev_addr_length\s*=\s*I2C_ADDR_BIT_LEN_7\s*;", source)):
        raise BudgetError("ENV I2C: zero-init synchronous bus and 7-bit device contract changed")
    allowed = {"i2c_new_master_bus", "i2c_del_master_bus", "i2c_master_bus_add_device",
               "i2c_master_bus_rm_device", "i2c_master_transmit", "i2c_master_receive",
               "i2c_master_transmit_receive"}
    if not set(re.findall(r"\b(i2c_[a-z_]+)\s*\(", source)) <= allowed:
        raise BudgetError("ENV I2C: new operation or callback registration needs stack review")
    arrays = re.findall(r"\buint8_t\s+(bytes|command|raw|sht_raw|qmp_raw|calibration_raw)\[([0-9]+)\]", source)
    expected_arrays = {"bytes": 2, "command": 2, "raw": 6, "sht_raw": 6, "qmp_raw": 6, "calibration_raw": 25}
    if (len(arrays) != 7 or any(int(size) != expected_arrays[name] for name, size in arrays)):
        raise BudgetError("ENV I2C: fixed 2/6/25-byte data buffers require review")
    read = (r"\bread_reg\(\s*[a-z_][a-z_0-9.]*,\s*(?:0x[0-9a-f]+|reg),\s*&?[a-z_][a-z_0-9.]*,\s*"
            r"(?:1|sizeof\((?:sensor\.calibration_raw|qmp_raw)\))\s*\)")
    transmit = r"i2c_master_transmit\([^,]+,\s*(bytes|command),\s*sizeof\(\1\),\s*I2C_TIMEOUT_MS\)"
    receive = r"i2c_master_receive\([^,]+,\s*(sht_raw|raw),\s*sizeof\(\1\),\s*I2C_TIMEOUT_MS\)"
    if (len(re.findall(r"\bread_reg\s*\(", source)) != 8 or len(re.findall(read, source)) != 7
            or len(re.findall(r"\bi2c_master_transmit\s*\(", source)) != 3 or len(re.findall(transmit, source)) != 3
            or len(re.findall(r"\bi2c_master_receive\s*\(", source)) != 2 or len(re.findall(receive, source)) != 2
            or len(re.findall(r"\bi2c_master_transmit_receive\s*\(", source)) != 1
            or not re.search(r"i2c_master_transmit_receive\(dev,\s*&reg,\s*1,\s*data,\s*size,\s*I2C_TIMEOUT_MS\)", source)):
        raise BudgetError("ENV I2C: short fixed-operation/data-length caller contract changed")


def validate_json_recursion(budgets: dict[str, Any], json_source: str,
                            mcp_source: str, adapter_source: str) -> None:
    json_matches = re.findall(r"\bJSON_MAX_DEPTH\s*=\s*([0-9]+)\s*;", json_source)
    mcp_matches = re.findall(r"if\s*\(depth\s*>\s*([0-9]+)\)\s*return false;", mcp_source)
    if json_matches != ["16"] or mcp_matches != ["16"]:
        raise BudgetError("JSON recursion source limits require review")
    if (not re.search(r"\bMQTT_JSON_MAX_DEPTH\s*=\s*JSON_MAX_DEPTH\s*;", json_source)
            or not re.search(r"\bjson_payload_depth_ok\(std::string_view json,\s*size_t max_depth\s*=\s*MQTT_JSON_MAX_DEPTH\)", json_source)):
        raise BudgetError("MQTT JSON depth default must remain bound to JSON_MAX_DEPTH")
    adapter = (
        r"inline\s+cJSON\*\s+json_parse_document\(std::string_view\s+payload\)\s*\{\s*"
        r"if\s*\(!json_payload_is_object\(payload\)\)\s*return nullptr;\s*"
        r"return\s+json_parse_bounded\(\s*payload,\s*"
        r"\[\]\(const char\* bytes,\s*size_t length,\s*const char\*\* end\)\s*noexcept\s*\{\s*"
        r"return cJSON_ParseWithLengthOpts\(bytes,\s*length,\s*end,\s*false\);\s*\},\s*"
        r"\[\]\(cJSON\* root\)\s*noexcept\s*\{\s*cJSON_Delete\(root\);\s*\},\s*"
        r"JSON_MAX_DEPTH\s*\);\s*\}")
    if not re.search(adapter, adapter_source):
        raise BudgetError("bounded cJSON adapter must bind JSON_MAX_DEPTH as its fourth argument")
    for owner in ("hp", "mqtt", "board", "env3", "weather", "diagnostics", "circulation"):
        name = f"httpd_config_{owner}"
        rule = budgets["paths"].get(name)
        if rule is None or rule["multipliers"] != {"cjson_parse_value": 17, "cjson_delete": 17}:
            raise BudgetError(f"path {name}: cJSON parse and simultaneous cleanup need depth + root")
    for name in ("mqtt_reference_parse", "mqtt_circulation_parse",
                 "mqtt_circulation_probe_parse", "weather_task_parse"):
        rule = budgets["paths"].get(name)
        if rule is None or rule["multipliers"] != {"cjson_parse_value": 17, "cjson_delete": 17}:
            raise BudgetError(f"path {name}: bounded shared cJSON recursion and cleanup need depth + root")
    rule = budgets["paths"].get("httpd_mcp_parse")
    if rule is None or rule["multipliers"] != {"mcp_json_value": 18}:
        raise BudgetError("path httpd_mcp_parse: MCP needs depth + root + early-reject frame")


def validate_integer_source(source: str, callers: dict[str, str]) -> None:
    # Match only the two small source functions, independently of surrounding JSON helpers.
    reviewed = """
__attribute__((noinline)) inline void
json_append_integer_field_impl(std::string& out, std::string_view prefix, uint64_t magnitude,
                               bool negative, bool valid) {
    out.append(prefix.data(), prefix.size());
    if (!valid) { out += "null"; return; }
    char digits[20];
    const auto result = std::to_chars(digits, digits + sizeof(digits), magnitude);
    if (negative) out += '-';
    out.append(digits, static_cast<size_t>(result.ptr - digits));
}
template <typename Integer>
__attribute__((always_inline)) inline void
json_append_integer_field(std::string& out, std::string_view prefix, Integer value,
                          bool valid = true) {
    static_assert(std::is_integral_v<Integer> && !std::is_same_v<Integer, bool>);
    using Unsigned = std::make_unsigned_t<Integer>;
    const bool negative = std::is_signed_v<Integer> && value < 0;
    const Unsigned bits = static_cast<Unsigned>(value);
    const Unsigned magnitude = negative ? Unsigned(0) - bits : bits;
    json_append_integer_field_impl(out, prefix, static_cast<uint64_t>(magnitude), negative, valid);
}
"""
    compact = lambda text: re.sub(r"\s+", "", text)
    if (compact(reviewed) not in compact(source)
            or len(re.findall(r"\bjson_append_integer_field_impl\s*\(", source)) != 2
            or len(re.findall(r"\bjson_append_integer_field\s*\(", source)) != 1):
        raise BudgetError("integer formatter source: fixed uint64/20-byte/inline magnitude contract changed")
    expected = {"main/logic/heartbeat.hpp": 25, "main/logic/heating_curve_mqtt.hpp": 21}
    if (set(callers) != set(expected)
            or any(len(re.findall(r"\bjson_append_integer_field\s*\(", callers[path])) != count
                   for path, count in expected.items())):
        raise BudgetError("integer formatter source: reviewed builder caller inventory changed")


def validate_discovery_builder_paths(budgets: dict[str, Any]) -> None:
    # These out-of-line builders return before synchronous SDK/TLS publication. Keep their
    # ordinary construction frames required without inventing overlap with the TLS paths.
    required = {
        "mqtt_discovery": {"json_literal_member"},
        "mqtt_crash": {"json_literal_member", "ha_discovery_identity"},
        "mqtt_heartbeat_discovery_build": {
            "mqtt_board_discovery", "json_literal_member", "ha_discovery_identity"},
        "mqtt_env3_discovery_build": {"json_literal_member", "ha_discovery_identity"},
    }
    owned = budgets["tasks"]["mqtt"]["paths"]
    for path, symbols in required.items():
        rule = budgets["paths"].get(path)
        if rule is None or path not in owned or not symbols.issubset(rule["symbols"]):
            raise BudgetError(f"discovery builder path {path}: required helper coverage missing")


def validate_source_contract(budgets: dict[str, Any]) -> None:
    sources = {path: (REPO / path).read_text(encoding="utf-8")
               for path, _ in TASK_ALLOCATIONS.values()}
    sources.update({str(path.relative_to(REPO)): path.read_text(encoding="utf-8")
                    for suffix in ("*.cpp", "*.hpp") for path in (REPO / "main").glob(suffix)})
    validate_task_inventory(sources)
    validate_syslog_queue(sources["main/syslog.cpp"])
    validate_small_task_diagnostics(sources)
    validate_mqtt_tls_client(sources["main/mqtt_ha.cpp"])
    validate_env_i2c(sources["main/env3.cpp"])
    validate_task_stacks(budgets, sources)
    validate_discovery_builder_paths(budgets)
    validate_http_stack(budgets, (REPO / "main/http_server.cpp").read_text(encoding="utf-8"))
    validate_status_diagnosis_paths(budgets, sources)
    validate_shutdown_paths(budgets, sources)
    validate_json_recursion(
        budgets, (REPO / "main/logic/payload_complete.hpp").read_text(encoding="utf-8"),
        (REPO / "main/logic/mcp.hpp").read_text(encoding="utf-8"),
        (REPO / "main/json_guard.hpp").read_text(encoding="utf-8"))
    validate_integer_source(
        (REPO / "main/logic/json_integer.hpp").read_text(encoding="utf-8"),
        {path: (REPO / path).read_text(encoding="utf-8")
         for path in ("main/logic/heartbeat.hpp", "main/logic/heating_curve_mqtt.hpp")})
    for owner in ("heartbeat", "curve"):
        path = budgets["paths"].get(f"mqtt_{owner}_build", {})
        if (path.get("symbols") != ["mqtt_task", f"mqtt_{owner}_builder", f"mqtt_{owner}_payload",
                                    "json_integer_append", "json_integer_length", "json_integer_digits"]
                or path.get("multipliers") != {} or path.get("base_bytes") != 1536
                or path.get("max_bytes") != 5120):
            raise BudgetError(f"integer formatter path {owner}: reviewed builder/decimal/library bound changed")
    mqtt_depth = r"json_payload_depth_ok\(std::string_view\(frame\.payload,\s*frame\.payload_len\)\)"
    if (len(re.findall(mqtt_depth, sources["main/mqtt_ha.cpp"])) != 2
            or len(re.findall(r"\bjson_payload_depth_ok\s*\(", sources["main/mqtt_ha.cpp"])) != 2
            or len(re.findall(r"\bcJSON_ParseWithLengthOpts\s*\(", sources["main/mqtt_ha.cpp"])) != 2
            or len(re.findall(r"\bcJSON_ParseWithLengthOpts\s*\(", sources["main/weather_forecast.cpp"])) != 1
            or not re.search(r"json_payload_depth_ok\(payload,\s*JSON_MAX_DEPTH\)",
                             sources["main/weather_forecast.cpp"])):
        raise BudgetError("MQTT/Weather cJSON source depth checks require review")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise BudgetError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def require_exact_keys(value: dict[str, Any], expected: set[str], context: str) -> None:
    actual = set(value)
    if actual == expected:
        return
    details: list[str] = []
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    if missing:
        details.append(f"missing {', '.join(missing)}")
    if unexpected:
        details.append(f"unexpected {', '.join(unexpected)}")
    raise BudgetError(f"{context}: keys must be exactly {sorted(expected)} ({'; '.join(details)})")


def is_json_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def valid_rule_name(value: Any) -> bool:
    return isinstance(value, str) and RULE_NAME_RE.fullmatch(value) is not None


def load_budgets(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys
        )
    except BudgetError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BudgetError(f"cannot read {path}: {exc}") from exc
    if not isinstance(document, dict):
        raise BudgetError("budget document must be an object")
    require_exact_keys(document, {"version", "symbols", "paths", "tasks", "sdk"}, "budget document")
    if not is_json_int(document["version"]) or document["version"] != 1:
        raise BudgetError("budget document version must be the JSON integer 1")

    symbols = document["symbols"]
    if not isinstance(symbols, dict) or not symbols:
        raise BudgetError("budget document symbols must be a non-empty object")
    for key, rule in symbols.items():
        if not valid_rule_name(key):
            raise BudgetError("symbol names must match [a-z][a-z0-9_]*")
        if not isinstance(rule, dict):
            raise BudgetError(f"symbol {key}: rule must be an object")
        require_exact_keys(rule, {"pattern", "max_bytes"}, f"symbol {key}")
        pattern = rule["pattern"]
        if not isinstance(pattern, str) or not pattern:
            raise BudgetError(f"symbol {key}: pattern must be a non-empty string")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise BudgetError(f"symbol {key}: invalid pattern ({exc})") from exc
        maximum = rule["max_bytes"]
        if not is_json_int(maximum) or maximum <= 0:
            raise BudgetError(f"symbol {key}: max_bytes must be a positive JSON integer")

    sdk = document["sdk"]
    if not isinstance(sdk, dict):
        raise BudgetError("SDK contract must be an object")
    require_exact_keys(sdk, {"source_sha256", "config_macros", "tls_paths"}, "SDK contract")
    tls_paths = sdk["tls_paths"]
    if not isinstance(tls_paths, dict) or not tls_paths:
        raise BudgetError("SDK TLS paths must be a non-empty object")
    if set(tls_paths) != SDK_TLS_PROFILES:
        raise BudgetError("SDK TLS paths must cover exactly the reviewed active profiles")
    paths = document["paths"]
    if not isinstance(paths, dict) or not paths:
        raise BudgetError("budget document paths must be a non-empty object")
    for key, rule in list(paths.items()) + list(tls_paths.items()):
        if not valid_rule_name(key):
            raise BudgetError("path names must match [a-z][a-z0-9_]*")
        if not isinstance(rule, dict):
            raise BudgetError(f"path {key}: rule must be an object")
        require_exact_keys(
            rule, {"symbols", "multipliers", "base_bytes", "max_bytes"}, f"path {key}"
        )
        members = rule["symbols"]
        if (
            not isinstance(members, list)
            or not members
            or not all(valid_rule_name(item) for item in members)
        ):
            raise BudgetError(f"path {key}: symbols must be a non-empty rule-name list")
        if len(set(members)) != len(members):
            raise BudgetError(f"path {key}: symbols must not contain duplicates")
        unknown = sorted(set(members) - set(symbols))
        if unknown:
            raise BudgetError(f"path {key}: unknown symbols {', '.join(unknown)}")
        multipliers = rule["multipliers"]
        if not isinstance(multipliers, dict):
            raise BudgetError(f"path {key}: multipliers must be an object")
        unknown_multipliers = sorted(set(multipliers) - set(members))
        if unknown_multipliers:
            raise BudgetError(
                f"path {key}: multiplier symbols are not path members "
                f"{', '.join(unknown_multipliers)}"
            )
        for member, multiplier in multipliers.items():
            if not valid_rule_name(member):
                raise BudgetError(f"path {key}: multiplier names must be rule names")
            if not is_json_int(multiplier) or multiplier <= 1:
                raise BudgetError(
                    f"path {key}: multiplier for {member} must be a JSON integer greater than 1"
                )
        base = rule["base_bytes"]
        if not is_json_int(base) or base < 0:
            raise BudgetError(f"path {key}: base_bytes must be a non-negative JSON integer")
        maximum = rule["max_bytes"]
        if not is_json_int(maximum) or maximum <= 0:
            raise BudgetError(f"path {key}: max_bytes must be a positive JSON integer")
        if key in tls_paths:
            prefix = key.startswith("prefix_")
            expected_base = 0 if prefix else SDK_TLS_ROM
            expected_max = SDK_TRANSPORT_PREFIX_LIMIT if prefix else SDK_TLS_LIMIT
            if base != expected_base or maximum != expected_max:
                raise BudgetError(f"SDK TLS path {key}: reviewed prefix880 / ROM192 / full TLS4608 bounds must remain fixed")
            expected = {"tls_mbedtls_mpi_mul_mpi": 2} if key.endswith("_recursive") else {}
            if key in ("record_gcm_hardware", "record_cbc_dma", "record_gcm_descriptor"):
                expected = {"tls_esp_aes_process_dma": 2}
            if key == "prefix_initial_wss":
                expected = {"tls_esp_transport_connect": 2}
            if key == "prefix_wss_write":
                expected = {"sdk_transport_write": 2}
            if multipliers != expected:
                raise BudgetError(f"SDK TLS path {key}: reviewed one-level/sibling recursion contract changed")
            if not prefix and "runtime_task_entry" not in members:
                raise BudgetError(f"SDK TLS path {key}: task-wrapper continuation must remain included")
            if not prefix and "tls_ws_connect" not in members:
                raise BudgetError(f"SDK TLS path {key}: active WSS upgrade prefix must remain included")
        if key in paths and key.startswith(("mqtt_", "sdk_mqtt_")) and "_tls" in key and base != SDK_TLS_LIMIT:
            raise BudgetError(f"path {key}: must use the reviewed full TLS4608 envelope")
    tasks = document["tasks"]
    if not isinstance(tasks, dict) or not tasks:
        raise BudgetError("budget document tasks must be a non-empty object")
    for key, rule in tasks.items():
        if not valid_rule_name(key) or not isinstance(rule, dict):
            raise BudgetError("task rules must be named objects")
        require_exact_keys(rule, {"stack_bytes", "reserve_bytes", "paths"}, f"task {key}")
        for field in ("stack_bytes", "reserve_bytes"):
            if not is_json_int(rule[field]) or rule[field] <= 0:
                raise BudgetError(f"task {key}: {field} must be a positive JSON integer")
        minimum = 2048 if key == "httpd" else 1024
        if rule["reserve_bytes"] < minimum or rule["stack_bytes"] <= rule["reserve_bytes"]:
            raise BudgetError(f"task {key}: reserve must retain at least {minimum} B")
        if (not isinstance(rule["paths"], list) or not rule["paths"]
                or not all(valid_rule_name(item) for item in rule["paths"])):
            raise BudgetError(f"task {key}: paths must be a non-empty rule-name list")
        if len(set(rule["paths"])) != len(rule["paths"]):
            raise BudgetError(f"task {key}: duplicate path")
        if not set(rule["paths"]) <= set(paths):
            raise BudgetError(f"task {key}: unknown path")
    if not isinstance(sdk["source_sha256"], dict) or set(sdk["source_sha256"]) != set(SDK_PUBLIC_FILES):
        raise BudgetError("SDK fingerprints must name exactly the reviewed public source files")
    for name, digest in sdk["source_sha256"].items():
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise BudgetError(f"SDK source {name}: fingerprint must be a SHA-256 hex string")
    if not isinstance(sdk["config_macros"], dict) or set(sdk["config_macros"]) != set(SDK_PUBLIC_MACROS):
        raise BudgetError("SDK configuration must name exactly the reviewed public macros")
    for name, value in sdk["config_macros"].items():
        if value is not None and (not is_json_int(value) or value < 0):
            raise BudgetError(f"SDK public macro {name}: expected non-negative integer or absence")
    return document


def evaluate(frames: dict[str, int], budgets: dict[str, Any]) -> dict[str, int]:
    selected: dict[str, int] = {}
    errors: list[str] = []
    for key, rule in budgets["symbols"].items():
        pattern = re.compile(rule["pattern"])
        maximum = rule["max_bytes"]
        matches = [(name, frame) for name, frame in frames.items() if pattern.search(name)]
        if not matches:
            errors.append(f"symbol {key}: required pattern {pattern.pattern!r} is absent")
            continue
        selected[key] = max(frame for _, frame in matches)
        if selected[key] > maximum:
            names = ", ".join(name for name, _ in matches)
            errors.append(
                f"symbol {key}: {selected[key]} B exceeds {maximum} B ({names})"
            )

    path_groups = (("path", budgets["paths"]), ("sdk_path", budgets["sdk"]["tls_paths"]))
    for kind, key, rule in ((kind, key, rule) for kind, group in path_groups for key, rule in group.items()):
        members = rule["symbols"]
        missing = [item for item in members if item not in selected]
        if missing:
            errors.append(f"path {key}: unavailable members {', '.join(missing)}")
            continue
        base = rule["base_bytes"]
        maximum = rule["max_bytes"]
        multipliers = rule["multipliers"]
        measured = base + sum(
            selected[item] * multipliers.get(item, 1) for item in members
        )
        selected[f"{kind}:{key}"] = measured
        if measured > maximum:
            errors.append(f"path {key}: {measured} B exceeds {maximum} B")

    if errors:
        raise BudgetError("; ".join(errors))
    return selected


def disassemble(elf: Path, objdump: str) -> str:
    if not elf.is_file():
        raise BudgetError(f"ELF does not exist: {elf}")
    try:
        result = subprocess.run(
            [objdump, "-d", "-C", str(elf)],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise BudgetError(f"cannot execute {objdump}: {exc}") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit {result.returncode}"
        raise BudgetError(f"objdump failed: {detail}")
    return result.stdout


def self_test() -> None:
    fixture = """
00000001 <daik::mcp_post(httpd_req*)>:
   1: 004136          entry a1, 1232
00000002 <daik::http_send_status_json(httpd_req*, int)>:
   2: 004136          entry a1, 128
00000003 <void daik::append_status_json<daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u> >(daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u>&, bool)>:
   3: 004136          entry a1, 4848
00000004 <daik::mqtt_task(void*)>:
   4: 004136          entry a1, 1120
00000005 <daik::(anonymous namespace)::ota_task(void*)>:
   5: 004136          entry a1, 2608
   8: fff7a5          call8 1000 <esp_restart>
00000006 <daik::ota_stat(httpd_req*)>:
   6: 004136          entry a1, 5088
00000007 <daik::(anonymous namespace)::fetch_manifest_identity_once(std::string const&, daik::OtaManifestIdentity&, char const*&, bool&)>:
   7: 004136          entry a1, 1280
00000008 <_ZN4daik12_GLOBAL__N_1L23fetch_manifest_identityERKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEERNS_19OtaManifestIdentityERPKc$constprop$0>:
   8: 004136          entry a1, 48
00000009 <daik::ota_check(httpd_req*)>:
   9: 004136          entry a1, 1152
0000000a <daik::(anonymous namespace)::start_check(daik::OtaFeedUrls const*)>:
   a: 004136          entry a1, 688
0000000b <daik::manifest_identity(char const*, unsigned int, daik::OtaManifestIdentity&)>:
   b: 004136          entry a1, 160
0000000c <daik::detail::skip_json_value(char const*, unsigned int, unsigned int&, unsigned int)>:
   c: 004136          entry a1, 64
0000000d <daik::(anonymous namespace)::socket_deadline_watchdog_task(void*)>:
   d: 004136          entry a1, 512
0000000e <daik::(anonymous namespace)::health_gate_task(void*)>:
   e: 004136          entry a1, 80
0000000f <daik::(anonymous namespace)::weather_task(void*)>:
   f: 004136          entry a1, 1152
00000010 <daik::(anonymous namespace)::fetch_forecast(daik::Config const&, daik::WeatherForecastSample&, std::string&, bool&, daik::HttpClientProbe&)>:
  10: 004136          entry a1, 160
00000011 <daik::(anonymous namespace)::download_json(daik::Config const&, std::string&, std::string&, bool&, daik::HttpClientProbe&)>:
  11: 004136          entry a1, 432
00000012 <daik::(anonymous namespace)::parse_forecast(std::string const&, long long, daik::WeatherForecastSample&, std::string&)>:
  12: 004136          entry a1, 512
00000040 <_ZN4daik12_GLOBAL__N_1L13weather_cycleEmRNS0_21RefreshRequestAttemptE$constprop$0>:
  40: 004136          entry a1, 736
"""
    fixture += """
00000013 <daik::set_hp(httpd_req*)>:
  13: 004136          entry a1, 3200
00000014 <daik::set_mqtt(httpd_req*)>:
  14: 004136          entry a1, 2336
00000015 <daik::set_board(httpd_req*)>:
  15: 004136          entry a1, 2176
00000016 <daik::set_env3(httpd_req*)>:
  16: 004136          entry a1, 1792
00000017 <daik::set_weather(httpd_req*)>:
  17: 004136          entry a1, 1776
00000018 <daik::set_diagnostics(httpd_req*)>:
  18: 004136          entry a1, 1536
00000019 <daik::set_circulation(httpd_req*)>:
  19: 004136          entry a1, 976
0000001a <daik::parse_circulation_request(httpd_req*, daik::CirculationRequest&)>:
  1a: 004136          entry a1, 1408
0000001b <daik::hp_query_probe(httpd_req*)>:
  1b: 004136          entry a1, 2720
0000001c <daik::mcp_parse(char const*, int)>:
  1c: 004136          entry a1, 144
0000001d <daik::mcp_detail::JsonReader::value(int)>:
  1d: 004136          entry a1, 32
0000001e <daik::mcp_detail::JsonReader::string(std::string*)>:
  1e: 004136          entry a1, 48
0000001f <parse_value>:
  1f: 16008136 \t
00000020 <parse_string>:
  20: d8006136 \t
00000021 <cJSON_Delete>:
  21: 61004136 \t
00000022 <cJSON_ParseWithLengthOpts>:
  22: c2008136 \t
00000023 <daik::config_save(daik::Config const&)>:
  23: 004136          entry a1, 32
00000024 <daik::save_whole(daik::Config const&, bool)>:
  24: 004136          entry a1, 48
00000025 <_ZN4daik23config_save_transactionINS_12_GLOBAL__N_112NvsBlobStoreEEENS_17ConfigSaveOutcomeERNS_6ConfigERKS4_bRT_$constprop$0>:
  25: 004136          entry a1, 1600
00000026 <daik::nvs_set_blob(char const*, void const*, unsigned int)>:
  26: 004136          entry a1, 48
00000027 <daik::h_scan(httpd_req*)>:
  27: 004136          entry a1, 768
00000028 <daik::wifi_scan(daik::WifiScanEntry*, int)>:
  28: 004136          entry a1, 1920
00000029 <daik::config_save_link(daik::Config const&)>:
  29: 004136          entry a1, 32
"""
    extra_frames = {'daik::service_reference_frames(daik::Config const&)': 32,
     'daik::json_append_literal_string_member(std::string&, char const*, std::string const&, char const*)': 48,
     'daik::ha_discovery_identity(std::string&, std::string const&, char const*, char const*)': 32,
     '_ZN4daikL22decode_reference_frameERKNS_18ReferenceMqttFrameERKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEESA_SA_SA_SA_SA_SA_SA_$constprop$0': 64,
     '_ZN4daikL25service_circulation_frameERKNS_18ReferenceMqttFrameERKNS_6ConfigE$constprop$0': 64,
     '_ZN4daikL31service_circulation_probe_frameERKNS_18ReferenceMqttFrameE$constprop$0': 64,
     '_ZN4daikL24decode_circulation_frameERKNS_18ReferenceMqttFrameERKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEESA_$constprop$0': 64,
     'daik::service_reference_subscription(daik::Config const&, unsigned long)': 64,
     'daik::service_circulation_subscription(daik::Config const&, unsigned long)': 64,
     'daik::build_client()': 64,
     'daik::mqtt_ha_start()': 64,
     'daik::service_requested_topic_cleanup(daik::Config const&)': 64,
     'daik::service_retained_cleanup_probe(std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > const&, std::atomic<bool>&, bool&, long long)': 32,
     'daik::publish_x10a_discovery()': 64,
     'daik::discovery_config(std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > const&, std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > const&, std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > const&, std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > const&, daik::ValueDef const&)': 64,
     'daik::publish_weather_state(bool)': 64,
     'daik::build_weather_mqtt_json[abi:cxx11](daik::WeatherMqttSnapshot const&, long long)': 64,
     'daik::publish_heartbeat()': 64,
     'daik::build_heartbeat_json[abi:cxx11](daik::HeartbeatFields const&)': 64,
     'daik::publish_crash()': 64,
     'daik::publish_heating_curve_telemetry(daik::Config const&)': 64,
     '_ZN4daikL22evaluate_heating_curveERKNS_6ConfigERKNS_7HpStatsE$isra$0': 64,
     'daik::poll_task(void*)': 64,
     'daik::hp_detect_run()': 64,
     'daik::hp_query_detailed(unsigned char, daik::Protocol, unsigned char*, unsigned int, daik::HpQueryLogPolicy)': 64,
     'daik::hp_format(daik::ValueDef const&, unsigned char const*, int, int, std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> >&, daik::ValueDef const*, unsigned int, daik::SaturationWitness)': 64,
     'daik::history_record(daik::CachedValue const*, unsigned int, unsigned long)': 64,
     'daik::checkup_report()': 64,
     STATUS_HEALTH_NUMBER_SYMBOL: 32,
     STATUS_UNSIGNED_NUMBER_SYMBOL: 64,
     'esp_restart': 32,
     'daik::reboot_soon()': 32,
     'daik::heap_guard_sample()': 64,
     'daik::history_flash_save()': 48,
     'daik::(anonymous namespace)::checkup_reboot_save()': 80,
     'daik::(anonymous namespace)::apply_reset_locked()': 112,
     'daik::(anonymous namespace)::apply_dhw_reset_locked()': 112,
     'daik::set_wifi(httpd_req*)': 64,
     'daik::set_syslog(httpd_req*)': 64,
     'daik::set_ntp(httpd_req*)': 64,
     'daik::history_flash_service_journal(unsigned int, unsigned long)': 64,
     'daik::(anonymous namespace)::flash_append_record(daik::(anonymous namespace)::FlashJournalRecord&)': 64,
     '_ZN4daik12_GLOBAL__N_1L22flash_append_record_atERNS0_18FlashJournalRecordERj$constprop$0': 64,
     'daik::mb_task(void*)': 64,
     'daik::mb_poll_once()': 64,
     'daik::history_record_modbus(daik::CachedValue const*, unsigned int, unsigned long)': 64,
     'daik::mb_read(daik::MbFunc, unsigned short, unsigned short, daik::MbRead&, daik::logic::MbFailure&, bool)': 64,
     'daik::(anonymous namespace)::task(void*)': 64,
     'daik::(anonymous namespace)::read_reg(i2c_master_dev_t*, unsigned char, unsigned char*, unsigned int)': 48,
     'daik::history_record_env3(bool, float, float, float)': 64,
     'daik::syslog_sendto(int&, sockaddr_in const&, char const*, unsigned int, int*)': 64,
     'daik::diag_printf(char const*, ...)': 64,
     'daik::syslog_send(char const*, unsigned int)': 64,
     'daik::(anonymous namespace)::status_led_task(void*)': 64,
     'daik::(anonymous namespace)::button_task(void*)': 64,
     'daik::wifi_watchdog_task(void*)': 64,
     'daik::wifi_start_sta()': 64,
     'daik::eth_fallback_task(void*)': 64,
     'daik::dns_task(void*)': 64,
     'daik::config_load()': 64,
     'daik::history_start()': 64,
     'daik::mb_autodiscover_initial()': 64,
     'daik::http_send_values_json(httpd_req*, std::basic_string_view<char, std::char_traits<char> >, std::basic_string_view<char, std::char_traits<char> >)': 64,
     'daik::h_history(httpd_req*)': 64,
     'daik::h_diag(httpd_req*)': 64,
     'daik::redact_diag_line[abi:cxx11](std::basic_string_view<char, std::char_traits<char> >)': 48,
     'daik::h_coredump(httpd_req*)': 32,
     'daik::h_active_model_values(httpd_req*)': 64,
     '_ZN4daik10board_pinsEPKcb$isra$0': 48,
     '_ZZN4daik11syslog_initEvENKUlPvE_clES0_$constprop$0': 64,
     'daik::syslog_init()::{lambda(void*)\x231}::_FUN(void*)': 32,
     'app_main': 32,
     'boot_sequence()': 64,
     '_ZN4daikL10h_coredumpEP9httpd_req$part$0': 64,
     'esp_mqtt_client_publish': 48,
     'mqtt_client_enqueue_publish': 64,
     'mqtt_msg_publish': 32,
     'esp_transport_write': 32,
     'esp_tls_conn_write': 32,
     'mbedtls_ssl_write': 32,
     'xQueueGenericSend': 64,
     'xTaskRemoveFromEventList': 32,
     'prvIsYieldRequiredSMP': 32,
     'vPortYieldOtherCore': 32,
     'esp_crosscore_int_send_yield': 32,
     'esp_crosscore_int_send': 32,
     'xPortEnterCriticalTimeout': 32,
     'esp_cpu_compare_and_set': 32,
     'vPortTaskWrapper': 32,
     'daik::service_reference_frame(daik::ReferenceMqttFrame const&, daik::Config const&)': 64,
     'daik::apply_reference_frame(daik::ReferenceMqttFrame const&, daik::Config const&)': 64,
     'daik::JsonGuard::reset(cJSON*)': 32,
     'daik::JsonGuard::~JsonGuard()': 32,
     'daik::wifi_init_sta_driver(bool&)': 64,
     'daik::wifi_wait_sta_connected(bool)': 64,
     'daik::wifi_finish_sta_rollback()': 64,
     'daik::wifi_finish_sta_success()': 64,
     'malloc': 32,
     'heap_caps_malloc_default': 32,
     'heap_caps_malloc': 48,
     'heap_caps_malloc_base': 32,
     'heap_caps_aligned_alloc_base': 48,
     'multi_heap_aligned_alloc_offs': 32,
     'multi_heap_aligned_alloc_impl_offs': 32,
     'multi_heap_internal_lock': 32,
     'snprintf': 112,
     'vsnprintf': 96,
     '__d_vfprintf': 128,
     '__ultoa_invert': 48,
     '__file_str_put': 32,
     'esp_log': 96,
     'vprintf': 48,
     '__bufio_put': 32,
     '__bufio_buffer_allocate_locked': 128,
     '__bufio_flush_locked': 48,
     'write': 32,
     '_write_r': 32,
     'console_write': 32,
     'usb_serial_jtag_write': 32,
     'usb_serial_jtag_tx_char_no_driver': 32,
     '_lock_acquire_recursive': 32,
     'lock_acquire_generic': 48,
     'xQueueSemaphoreTake': 64,
     'daik::build_heartbeat_payload()': 64,
     'daik::build_heating_curve_payload(daik::Config const&)': 64,
     'daik::mqtt_cycle_gate(daik::MqttPublishGateState, bool&)': 64,
     'daik::crash_publication_changed()': 64,
     'daik::build_weather_payload(bool)': 64,
     'esp_mqtt_task': 96,
     'daik::apply_reference_binding(daik::Config const&, unsigned long, bool&)': 64,
     'daik::retire_reference_topics(std::array<std::string,3> const&)': 32,
     'daik::service_circulation_probe_subscription(daik::Config const&)': 64,
     'daik::start_retained_cleanup_probe(std::string const&, std::atomic<bool>&, bool&, long long&, char const*)': 32,
     'daik::mqtt_publish(std::string const&, char const*, int, int, int)': 32,
     'daik::publish_x10a_state(daik::Config const&, bool)': 64,
     'daik::hp_values_x10a_json_probe(char const*, unsigned long long)': 64,
     'daik::hp_values_x10a_json_copy(std::string&, unsigned int, unsigned long long, unsigned long, char const*, unsigned long long)': 64,
     'daik::current_modbus_values(bool&)': 64,
     'daik::publish_heartbeat_discovery()': 64,
     'daik::retract_legacy_fixed()': 64,
     'daik::retract_ungrouped_values()': 64,
     'daik::history_record_circulation()': 48,
     'daik::history_record_board()': 48,
     'daik::build_heating_curve_mqtt_json[abi:cxx11](daik::HeatingCurveMqttFields const&)': 64,
     'daik::(anonymous namespace)::fold_circulation_locked(daik::CirculationPumpSample const&)': 32,
     'daik::(anonymous namespace)::advance_raster_locked(long long, unsigned long)': 48,
     'daik::build_flat_json[abi:cxx11](std::vector<daik::GroupedValue> const&)': 64,
     'daik::build_env3_mqtt_json[abi:cxx11](bool, float, float, float, unsigned long, unsigned long)': 64,
     'esp_mqtt_client_subscribe_single': 48,
     'esp_mqtt_client_subscribe_multiple': 48,
     'esp_mqtt_client_unsubscribe': 32,
     'esp_mqtt_write': 48,
     'ssl_write': 80,
     'esp_mbedtls_write': 32,
     '__wrap_mbedtls_ssl_write': 32,
     'ssl_check_ctr_renegotiate': 48,
     'mbedtls_ssl_renegotiate': 32,
     'mbedtls_ssl_start_renegotiation': 32,
     'mbedtls_ssl_handshake': 32,
     'mbedtls_ssl_handshake_step': 32,
     '__wrap_mbedtls_ssl_handshake_client_step': 32,
     'mbedtls_ssl_handshake_client_step': 144,
     'mbedtls_ssl_parse_certificate': 96,
     'mbedtls_ssl_verify_certificate': 96,
     'mbedtls_x509_crt_verify_restartable': 48,
     'x509_crt_verify_restartable_ca_cb$constprop$0$isra$0': 272,
     'esp_crt_verify_callback': 48,
     'esp_crt_check_signature': 864,
     'psa_verify_hash': 80,
     'psa_verify_hash_builtin': 48,
     'mbedtls_psa_ecdsa_verify_hash': 64,
     'mbedtls_ecdsa_verify': 48,
     'mbedtls_ecdsa_verify_restartable': 128,
     'mbedtls_ecp_muladd_restartable': 112,
     'mbedtls_ecp_mul_shortcuts$isra$0': 48,
     'ecp_mul_restartable_internal$isra$0': 176,
     'ecp_mul_comb_after_precomp$isra$0': 400,
     'ecp_add_mixed': 48,
     'ecp_double_jac': 48,
     'mbedtls_mpi_mul_mod': 32,
     'mbedtls_mpi_mod_mpi': 48,
     'mbedtls_mpi_div_mpi': 144,
     'mbedtls_mpi_mul_int': 48,
     'mbedtls_mpi_mul_mpi': 48,
     'mbedtls_mpi_grow': 32,
     'mbedtls_calloc': 32,
     'esp_mbedtls_mem_calloc': 32,
     'heap_caps_calloc': 32,
     'heap_caps_calloc_base': 32,
     'mbedtls_pk_verify_ext': 80,
     'mbedtls_rsa_rsassa_pss_verify_ext': 1136,
     'mbedtls_psa_rsa_verify_hash': 80,
     'mbedtls_rsa_pkcs1_verify': 48,
     'mbedtls_rsa_public': 48,
     'mbedtls_mpi_exp_mod_unsafe': 32,
     'mbedtls_mpi_exp_mod': 80,
     'calculate_rinv': 48,
     'mpi_mult_mpi_overlong$isra$0': 64,
     'mbedtls_mpi_add_mpi': 32,
     'add_sub_mpi': 32,
     'mbedtls_mpi_add_abs': 32,
     'mbedtls_mpi_copy': 32,
     'mbedtls_rsa_rsassa_pkcs1_v15_verify': 48,
     's_i2c_send_commands': 48,
     's_i2c_transaction_start': 64,
     's_i2c_synchronous_transaction': 32,
     'i2c_master_transmit': 64,
     'i2c_master_multi_buffer_transmit': 176,
     'i2c_master_transmit_receive': 144,
     'i2c_master_receive': 112,
     'daik::env3_probe(int, int)': 192,
     'daik::(anonymous namespace)::write_reg_verified(i2c_master_dev_t*, unsigned char, unsigned char)': 48,
     'psa_generate_key': 32,
     'psa_generate_key_custom': 80,
     'psa_generate_key_internal': 32,
     'mbedtls_psa_ecp_generate_key': 176,
     'mbedtls_ecp_group_load': 48,
     'mbedtls_mpi_sub_int': 48,
     'mbedtls_mpi_sub_mpi': 32,
     'psa_export_public_key': 48,
     'psa_driver_wrapper_export_public_key': 32,
     'psa_export_public_key_internal': 48,
     'mbedtls_psa_ecp_export_public_key': 64,
     'mbedtls_psa_ecp_export_key': 32,
     'mbedtls_ecp_mul': 48,
     'mbedtls_ecp_mul_restartable': 32,
     'psa_raw_key_agreement': 80,
     'psa_key_agreement_raw_builtin': 48,
     'mbedtls_psa_key_agreement_ecdh': 96,
     'mbedtls_ssl_read_record': 64,
     'mbedtls_ssl_decrypt_buf': 624,
     'psa_aead_decrypt': 96,
     'mbedtls_psa_aead_decrypt': 480,
     'mbedtls_ccm_auth_decrypt': 80,
     'ccm_auth_crypt': 48,
     'mbedtls_ccm_update': 80,
     'mbedtls_cipher_update': 64,
     'aes_crypt_ecb_wrap': 32,
     'mbedtls_aes_crypt_ecb': 32,
     'esp_aes_crypt_ecb': 32,
     'esp_aes_acquire_hardware': 32,
     'esp_crypto_sha_aes_lock_acquire': 32,
     '_lock_acquire': 32,
     'lock_init_generic': 32,
     'xQueueCreateMutex': 32,
     'xQueueGenericCreate': 32,
     'pvPortMalloc': 32,
     'mbedtls_gcm_auth_decrypt': 80,
     'mbedtls_gcm_crypt_and_tag': 48,
     'mbedtls_gcm_update': 64,
     'gcm_mask': 64,
     'mbedtls_ssl_derive_keys': 400,
     'tls_prf_sha256': 48,
     'tls_prf_generic': 336,
     'psa_key_derivation_output_bytes': 304,
     'psa_driver_wrapper_mac_compute': 64,
     'esp_hmac_compute_transparent': 144,
     'esp_hmac_setup_transparent': 176,
     'esp_sha_hash_compute': 512,
     'esp_sha256_driver_compute': 48,
     'esp_sha256_finish': 48,
     'esp_sha256_update': 48,
     'esp_sha_acquire_hardware': 32,
     'ws_connect': 288,
     'mbedtls_mpi_random': 32,
     'mbedtls_mpi_fill_random': 32,
     'mbedtls_psa_get_random': 32,
     'psa_generate_random': 32,
     'psa_generate_random_internal': 64,
     'mbedtls_psa_external_get_random': 32,
     'esp_fill_random': 64,
     'esp_random': 32,
     'esp_clk_cpu_freq': 32,
     'esp_clk_apb_freq': 32,
     'mbedtls_x509_crt_parse_der_nocopy': 32,
     'mbedtls_x509_crt_parse_der_internal': 160,
     'mbedtls_pk_parse_subpubkey': 64,
     'mbedtls_pk_ecc_set_pubkey': 176,
     'psa_import_key': 64,
     'psa_driver_wrapper_import_key': 48,
     'psa_import_key_into_slot': 64,
     'mbedtls_psa_ecp_import_key': 48,
     'esp_crypto_aes_gcm_decrypt': 64,
     'esp_aes_gcm_auth_decrypt': 80,
     'esp_aes_gcm_crypt_and_tag': 48,
     'esp_aes_gcm_update': 112,
     'esp_aes_crypt_ctr': 48,
     'esp_aes_process_dma': 64,
     'esp_aes_dma_start': 32,
     'esp_crypto_shared_gdma_start_axi_ahb': 96,
     'gdma_new_ahb_channel': 96,
     'psa_cipher_update': 32,
     'esp_aes_cipher_update': 64,
     'esp_aes_crypt_cbc': 64,
     'heap_caps_aligned_calloc': 32,
     'heap_caps_aligned_alloc': 32,
     'esp_heap_adjust_alignment_to_hw': 48,
     'esp_cache_get_alignment': 48,
     'esp_log_timestamp': 32,
     'xTaskGetTickCountFromISR': 32,
     'tls_prf_sha384': 48,
     'esp_sha512_driver_compute': 48,
     'esp_sha512_finish': 48,
     'esp_sha512_update': 48,
     'esp_transport_connect': 32,
     'ssl_connect': 48,
     'esp_tls_conn_new_sync': 48,
     'esp_tls_low_level_conn': 80,
     'esp_mbedtls_handshake': 32,
     'mqtt_message_receive': 64,
     'esp_transport_read': 32,
     'ws_read': 80,
     'esp_transport_read_exact_size': 64,
     'esp_transport_read_internal': 32,
     'ssl_read': 64,
     'esp_tls_conn_read': 32,
     'esp_mbedtls_read': 32,
     '__wrap_mbedtls_ssl_read': 32,
     'mbedtls_ssl_read': 32,
     'ws_write': 32,
     '_ws_write$constprop$0': 48,
     'mbedtls_ssl_fetch_input': 32,
     'mbedtls_net_recv': 32,
     'read': 32,
     '_read_r': 32,
     'lwip_read': 32,
     'lwip_recvfrom': 80,
     'lwip_recv_tcp': 64,
     'netconn_recv_tcp_pbuf_flags': 32,
     'netconn_recv_data_tcp': 80,
     'netconn_apimsg': 128,
     'sys_thread_sem_get': 32,
     'sys_thread_sem_init': 64,
     'pthread_setspecific': 32,
     'find_key': 32,
     'esp_sha_dma': 64,
     'esp_sha_dma_start': 32,
     'psa_mac_verify_setup': 32,
     'psa_mac_setup': 64,
     'lwip_read_r_wrapper': 32,
     'calloc': 48,
     '__wrap_mbedtls_ssl_write_client_hello': 32,
     'mbedtls_ssl_write_client_hello': 80,
     'mbedtls_ssl_finish_handshake_msg': 32,
     'mbedtls_ssl_write_handshake_msg_ext': 32,
     'mbedtls_ssl_write_record': 64,
     'mbedtls_ssl_flush_output': 32,
     'mbedtls_net_send': 32,
     'lwip_write_r_wrapper': 32,
     'lwip_write': 32,
     'lwip_send': 48,
     'netconn_write_partly': 48,
     'netconn_write_vectors_partly': 80,
     'tcpip_send_msg_wait_sem': 128,
     'sys_mbox_post': 48,
     INTEGER_APPEND_SYMBOL: 80,
     INTEGER_LENGTH_SYMBOL: 48,
     INTEGER_DIGITS_SYMBOL: 240}
    # Keep generated anchors outside the hand-written decimal/I2C fixtures below. Otherwise
    # a packed-prologue mutation can also replace an unrelated first instruction at 0x220.
    for index, (name, frame) in enumerate(extra_frames.items(), 0x1000):
        fixture += f"\n{index:08x} <{name}>:\n{index:x}: 004136 entry a1, {frame}\n"
        if name == 'daik::(anonymous namespace)::button_task(void*)':
            fixture += f"{index + 3:x}: fff7a5 call8 1000 <esp_restart>\n"
        if name in INTEGER_BUILDERS:
            for offset in range(INTEGER_BUILDERS[name]):
                fixture += f"{index + 3 + offset:x}: fff7a5 call8 800 <{INTEGER_APPEND_SYMBOL}>\n"
        if name == INTEGER_APPEND_SYMBOL:
            string = "std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> >"
            fixture += f"""
801: 000081 l32r a8, 1 <literal> (1 <{string}::append(char const*, unsigned int)>)
804: 0008e0 callx8 a8
807: fff7a5 call8 1 <_ZNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEpLEPKc$isra$0>
80a: 000081 l32r a8, 1 <literal> (1 <{string}::push_back(char)>)
80d: 0008e0 callx8 a8
810: 000081 l32r a8, 1 <literal> (1 <{string}::append(char const*, unsigned int)>)
813: 0008e0 callx8 a8
816: 00000c movi a12, 10
819: 00000c or a10, a6, a6
81c: 00000c mov.n a11, a7
81f: fff7a5 call8 900 <{INTEGER_LENGTH_SYMBOL}>
822: 00000c movi.n a8, 20
825: 00000c mov.n a4, a10
828: 00000c addi a5, a1, 20
82b: fff7a5 call8 a00 <{INTEGER_DIGITS_SYMBOL}>
"""
        if name == INTEGER_LENGTH_SYMBOL:
            fixture += "901: 000081 l32r a8, 1 <literal> (40002544 <__udivdi3>)\n904: 0008e0 callx8 a8\n"
        if name == INTEGER_DIGITS_SYMBOL:
            for offset, target in enumerate(("memcpy", "__umoddi3", "__udivdi3")):
                fixture += (f"{0xa01 + offset * 6:x}: 000081 l32r a8, 1 <literal> (1 <{target}>)\n"
                            f"{0xa04 + offset * 6:x}: 0008e0 callx8 a8\n")
    fixture += """
00000700 <s_i2c_start_end_command>:
700: 008136 entry a1, 64
703: 150c movi.n a5, 1
705: 050c movi.n a5, 0
707: a5fb addi.n a10, a5, 15
709: 41a4a0 srli a10, a10, 4
70c: 11aac0 slli a10, a10, 4
70f: c081a0 sub a8, a1, a10
712: 001810 movsp a1, a8
715: 1799 s32i.n a9, a7, 4
717: c081a0 sub a8, a1, a10
71a: 014d mov.n a4, a1
71c: 001810 movsp a1, a8
71f: 250c movi.n a5, 2
"""
    double_body = 'std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > __gnu_cxx::__to_xstring<std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> >, char>(int (*)(char*, unsigned int, char const*, __va_list_tag), unsigned int, char const*, ...)'
    fixture += f"""
00000200 <{double_body}>:
200: 00a136 entry a1, 80
203: 84fb addi.n a8, a4, 15
205: 418480 srli a8, a8, 4
208: 1188c0 slli a8, a8, 4
20b: c08180 sub a8, a1, a8
20e: 001810 movsp a1, a8
00000220 <std::__cxx11::to_string(double)>:
220: 004136 entry a1, 32
223: 48a1c2 movi a12, 0x148
226: 20a220 or a10, a2, a2
229: fff7a5 call8 200 <{double_body}>
"""
    number_calls = "".join(f"{0x3003 + offset:x}: fff7a5 call8 3000 <{STATUS_HEALTH_NUMBER_SYMBOL}>\n"
                           for offset in range(25))
    fixture = fixture.replace("   3: 004136          entry a1, 4848\n",
                              "   3: 004136          entry a1, 4848\n" + number_calls)
    budgets = load_budgets(DEFAULT_BUDGETS)
    validate_source_contract(budgets)
    frames = parse_frames(fixture)

    selected = evaluate(frames, budgets)
    validate_shutdown_inlining(fixture, budgets)
    validate_status_numeric_calls(fixture, budgets)
    assert selected["status_serializer"] == 4848
    assert selected["path:httpd_mcp_status"] == 8192
    assert selected["path:httpd_direct_status"] == 6960
    assert selected["path:httpd_mcp_checkup"] == 7808
    assert selected["path:httpd_direct_checkup"] == 6576
    assert selected["path:httpd_mcp_health_number"] == 7840
    assert selected["path:httpd_direct_health_number"] == 6608
    assert selected["ota_task"] == 2608
    assert selected["path:httpd_ota_status"] == 6624
    assert selected["path:ota_task_manifest_fetch"] == 4672
    assert selected["path:httpd_ota_check"] == 3376
    assert selected["path:http_deadline_watchdog"] == 1536
    assert selected["weather_task"] == 1152
    assert selected["weather_cycle"] == 736
    assert selected["path:weather_task_download"] == 4528
    assert selected["path:weather_task_parse"] == 6352
    assert selected["ota_health_task"] == 80
    assert selected["path:ota_health_gate"] == 2128
    assert selected["path:httpd_config_hp"] == 6480
    assert selected["path:httpd_config_circulation"] == 5664
    assert selected["path:httpd_hp_query_probe"] == 4256
    assert selected["path:httpd_mcp_parse"] == 3536
    assert selected["path:httpd_config_save"] == 8000
    assert selected["path:httpd_config_save_link"] == 8000
    assert selected["path:httpd_wifi_scan"] == 5248
    assert selected["path:httpd_mqtt_tls"] == 7968

    status_sources = {path: (REPO / path).read_text(encoding="utf-8")
                      for path in ("main/http_status.cpp", "main/mcp_server.cpp", "main/hp_poll.cpp")}
    validate_status_diagnosis_paths(budgets, status_sources)
    diagnosis_controls = 0
    for name, member in (("httpd_direct_checkup", "checkup_report"),
                         ("httpd_mcp_checkup", "checkup_report"),
                         ("httpd_mcp_checkup", "http_send_status_json"),
                         ("httpd_mcp_status", "http_send_status_json"),
                         ("httpd_mcp_health_number", "status_health_number"),
                         ("httpd_mcp_health_number", "status_unsigned_number"),
                         ("httpd_direct_health_number", "status_health_number"),
                         ("httpd_direct_health_number", "status_unsigned_number")):
        changed = json.loads(json.dumps(budgets))
        changed["paths"][name]["symbols"].remove(member)
        try:
            validate_status_diagnosis_paths(changed, status_sources)
        except BudgetError as exc:
            assert "diagnosis status path" in str(exc)
        else:
            raise AssertionError(f"self-test accepted omitted {member} from {name}")
        diagnosis_controls += 1
    changed = json.loads(json.dumps(budgets))
    changed["paths"]["poll_history"]["symbols"].append("checkup_report")
    try:
        validate_status_diagnosis_paths(changed, status_sources)
    except BudgetError as exc:
        assert "belongs to HTTP, not polling" in str(exc)
    else:
        raise AssertionError("self-test accepted charging the report frame to polling")
    diagnosis_controls += 1
    for name, before, after in (
        ("main/http_status.cpp", "return http_send_status_json(req, {}, {}, redact);", "return ESP_FAIL;"),
        ("main/mcp_server.cpp", "return http_send_status_json(req, response, suffix, false);", "return ESP_FAIL;"),
        ("main/hp_poll.cpp", "static void poll_task(void*) {",
         "static void poll_task(void*) { checkup_report();"),
    ):
        changed = dict(status_sources)
        changed[name] = changed[name].replace(before, after)
        assert changed[name] != status_sources[name]
        try:
            validate_status_diagnosis_paths(budgets, changed)
        except BudgetError as exc:
            assert "diagnosis status source" in str(exc)
        else:
            raise AssertionError(f"self-test accepted a changed report caller in {name}")
        diagnosis_controls += 1

    for before, after in (
        ('__attribute__((noinline))', '__attribute__((always_inline))'),
        ('num("windows", ck.b);', 'other_number("windows", ck.b);'),
        ('char digits[20];', 'char digits[19];'),
        ('JsonOut& out, uint64_t value', 'JsonOut& out, uint32_t value'),
        ('value /= 10;', 'value /= 16;'),
    ):
        changed = dict(status_sources)
        changed["main/http_status.cpp"] = changed["main/http_status.cpp"].replace(before, after)
        assert changed["main/http_status.cpp"] != status_sources["main/http_status.cpp"]
        try:
            validate_status_diagnosis_paths(budgets, changed)
        except BudgetError as exc:
            assert "diagnosis numeric source" in str(exc)
        else:
            raise AssertionError(f"self-test accepted changed numeric serializer source: {before}")
        diagnosis_controls += 1

    shutdown_sources = {str(path.relative_to(REPO)): path.read_text(encoding="utf-8")
                        for path in (REPO / "main").glob("*.cpp")}
    validate_shutdown_paths(budgets, shutdown_sources)
    shutdown_controls = 0
    for name, members in shutdown_path_members().items():
        for member in members:
            changed = json.loads(json.dumps(budgets))
            changed["paths"][name]["symbols"].remove(member)
            try:
                validate_shutdown_paths(changed, shutdown_sources)
            except BudgetError as exc:
                assert "shutdown path" in str(exc)
            else:
                raise AssertionError(f"self-test accepted omitted {member} from {name}")
            shutdown_controls += 1
        changed = json.loads(json.dumps(budgets))
        changed["paths"][name]["base_bytes"] = 0
        try:
            validate_shutdown_paths(changed, shutdown_sources)
        except BudgetError as exc:
            assert "shutdown path" in str(exc)
        else:
            raise AssertionError(f"self-test accepted omitted SDK continuation from {name}")
        shutdown_controls += 1
    for path, before, after in (
        ("main/history.cpp", "esp_register_shutdown_handler(history_flash_save)",
         "esp_register_shutdown_handler(other_handler)"),
        ("main/checkup.cpp", "esp_register_shutdown_handler(checkup_reboot_save)",
         "esp_register_shutdown_handler(other_handler)"),
        ("main/history.cpp", "history_flash_service_journal(/*max_records=*/12, pdMS_TO_TICKS(200))",
         "history_flash_service_journal(/*max_records=*/13, pdMS_TO_TICKS(200))"),
        ("main/history.cpp", "history_flash_service_journal(/*max_records=*/3, /*wait_ticks=*/0)",
         "history_flash_service_journal(/*max_records=*/4, /*wait_ticks=*/0)"),
        ("main/history.cpp", "s_flash_forgotten.store(true);", "s_flash_forgotten.store(false);"),
        ("main/history.cpp", "s_flash_shutdown_started || s_flash_forgotten.load()",
         "s_flash_shutdown_started"),
        ("main/recovery_button.cpp", "wifi_e != ESP_OK || !history_erased || !crash_erased",
         "wifi_e != ESP_OK || !crash_erased"),
        ("main/recovery_button.cpp", "? history_flash_forget() : false", "? true : false"),
        ("main/recovery_button.cpp", "factory_reset();", "other_reset();"),
        ("main/hp_poll.cpp", "heap_guard_sample();", "other_heap_guard();"),
        ("main/hp_poll.cpp", "history_record_board();", "other_history();"),
        ("main/http_config.cpp", "reboot_soon();", "other_reboot();"),
        ("main/net.cpp", "esp_restart();", "other_restart();"),
        ("main/wifi.cpp", "wifi_finish_sta_rollback();", "other_rollback();"),
        ("main/main.cpp", "wifi_up = daik::wifi_start_sta();",
         "wifi_up = (daik::history_start(), daik::wifi_start_sta());"),
        ("main/net.cpp", "void net_eth_fallback_start() {",
         "void net_eth_fallback_start() { esp_restart();"),
        ("main/net.cpp", "void net_eth_fallback_start() {",
         "void net_eth_fallback_start() { wifi_start_sta();"),
        ("main/checkup.cpp", "void checkup_reboot_save() {",
         "void checkup_reboot_save() { history_flash_save();"),
    ):
        changed = dict(shutdown_sources)
        changed[path] = changed[path].replace(before, after, 1)
        assert changed[path] != shutdown_sources[path], f"missing shutdown control {path}: {before}"
        try:
            validate_shutdown_paths(budgets, changed)
        except BudgetError as exc:
            assert "shutdown source" in str(exc)
        else:
            raise AssertionError(f"self-test accepted a changed shutdown caller in {path}: {before}")
        shutdown_controls += 1

    for symbol, address, word, frame in (
        ("parse_value", "1f", "16008136", 64),
        ("parse_string", "20", "d8006136", 48),
        ("cJSON_Delete", "21", "61004136", 32),
        ("cJSON_ParseWithLengthOpts", "22", "c2008136", 64),
    ):
        first = f"{address}: {word} \t"
        for rendered in (f"{address}: {word}        .word 0x{word}",
                         f"{address}: {word}        entry a1, {frame}"):
            decoded = fixture.replace(first, rendered)
            assert parse_frames(decoded)[symbol] == frame
            evaluate(parse_frames(decoded), budgets)

    def reject_disassembly(name: str, text: str, expected: str) -> None:
        try:
            evaluate(parse_frames(text), budgets)
            validate_shutdown_inlining(text, budgets)
            validate_status_numeric_calls(text, budgets)
        except BudgetError as exc:
            assert expected in str(exc), f"{name}: unexpected failure {exc}"
        else:
            raise AssertionError(f"self-test accepted {name}")

    numeric_call = f"3003: fff7a5 call8 3000 <{STATUS_HEALTH_NUMBER_SYMBOL}>\n"
    numeric_disassembly_controls = 0
    for altered in (
        fixture.replace(numeric_call, ""),
        fixture.replace(numeric_call, numeric_call.replace("call8", "l32r a8,")),
        fixture.replace(numeric_call, "") + "\n00004000 <unreviewed_number_caller()>:\n"
        "4000: 004136 entry a1, 32\n" + numeric_call,
    ):
        assert altered != fixture
        reject_disassembly("changed nullable-number caller", altered, "diagnosis numeric calls")
        numeric_disassembly_controls += 1

    shutdown_optimizer_controls = 0
    for name in (
        'daik::(anonymous namespace)::factory_reset()',
        'daik::(anonymous namespace)::run_update(daik::(anonymous namespace)::OtaTaskArgs const&)',
        '_ZN4daik12_GLOBAL__N_1L13factory_resetEv$constprop$0',
        '_ZN4daik12_GLOBAL__N_1L10run_updateERKNS0_11OtaTaskArgsE$isra$0',
    ):
        reject_disassembly("outlined shutdown helper " + name, fixture +
                           f"\n00003000 <{name}>:\n3000: 004136 entry a1, 32\n",
                           "shutdown inlining")
        shutdown_optimizer_controls += 1
    button_match = re.search(r"<daik::\(anonymous namespace\)::button_task\(void\*\)>:\n"
                             r"[^\n]+\n([^\n]*call8[^\n]*<esp_restart>)", fixture)
    assert button_match is not None
    for call in (button_match.group(1), "   8: fff7a5          call8 1000 <esp_restart>"):
        for replacement in ("", call.replace("call8", "l32r a8,"), call + "\n" + call):
            reject_disassembly("changed task-level shutdown call", fixture.replace(call, replacement),
                               "shutdown inlining")
            shutdown_optimizer_controls += 1
    update_lambda = ('daik::(anonymous namespace)::run_update(daik::(anonymous namespace)::'
                     'OtaTaskArgs const&)::{lambda(unsigned char const*, unsigned int)\x231}::'
                     'operator()(unsigned char const*, unsigned int) const')
    lambda_fixture = fixture + f"\n00003000 <{update_lambda}>:\n3000: 004136 entry a1, 32\n"
    evaluate(parse_frames(lambda_fixture), budgets)
    validate_shutdown_inlining(lambda_fixture, budgets)
    reject_disassembly("restart moved into update lambda", lambda_fixture +
                       "3003: fff7a5 call8 1000 <esp_restart>\n", "shutdown inlining")
    shutdown_optimizer_controls += 1

    # Exercise every required anchor, not only the original HTTP examples. Small fixture frames
    # establish acceptance/control behavior; the real ELF supplies the production measurements.
    inventory_controls = 0
    for key, rule in budgets["symbols"].items():
        pattern = re.compile(rule["pattern"])
        names = [name for name in frames if pattern.search(name)]
        removed = dict(frames)
        for name in names:
            removed.pop(name)
        try:
            evaluate(removed, budgets)
        except BudgetError as exc:
            assert f"symbol {key}: required pattern" in str(exc)
        else:
            raise AssertionError(f"self-test accepted removed required symbol {key}")
        grown = dict(frames)
        grown[names[0]] = rule["max_bytes"] + 16
        try:
            evaluate(grown, budgets)
        except BudgetError as exc:
            assert f"symbol {key}:" in str(exc)
        else:
            raise AssertionError(f"self-test accepted frame growth for {key}")
        inventory_controls += 2
    validate_discovery_builder_paths(budgets)
    for path, symbol in (
        ("mqtt_discovery", "json_literal_member"),
        ("mqtt_crash", "json_literal_member"),
        ("mqtt_crash", "ha_discovery_identity"),
        ("mqtt_heartbeat_discovery_build", "mqtt_board_discovery"),
        ("mqtt_heartbeat_discovery_build", "json_literal_member"),
        ("mqtt_heartbeat_discovery_build", "ha_discovery_identity"),
        ("mqtt_env3_discovery_build", "json_literal_member"),
        ("mqtt_env3_discovery_build", "ha_discovery_identity"),
    ):
        missing = json.loads(json.dumps(budgets))
        missing["paths"][path]["symbols"].remove(symbol)
        try:
            validate_discovery_builder_paths(missing)
        except BudgetError as exc:
            assert f"discovery builder path {path}:" in str(exc)
        else:
            raise AssertionError(f"self-test accepted missing {symbol} from {path}")
        inventory_controls += 1
    for path in ("mqtt_heartbeat_discovery_build", "mqtt_env3_discovery_build"):
        for remove_owner in (False, True):
            missing = json.loads(json.dumps(budgets))
            if remove_owner:
                missing["tasks"]["mqtt"]["paths"].remove(path)
            else:
                del missing["paths"][path]
            try:
                validate_discovery_builder_paths(missing)
            except BudgetError as exc:
                assert f"discovery builder path {path}:" in str(exc)
            else:
                raise AssertionError(f"self-test accepted missing builder path/owner {path}")
            inventory_controls += 1
    sources = {path: (REPO / path).read_text(encoding="utf-8")
               for path, _ in TASK_ALLOCATIONS.values()}
    moved = json.loads(json.dumps(budgets))
    moved["tasks"]["main"]["paths"].remove("main_config_load")
    moved["tasks"]["mqtt"]["paths"].append("main_config_load")
    try:
        validate_task_stacks(moved, sources)
    except BudgetError as exc:
        assert "source-bound owner must remain main" in str(exc)
    else:
        raise AssertionError("self-test accepted moving a path to an unrelated task budget")
    diagnostic_controls = 0
    altered_sources = []
    changed = dict(sources)
    changed["main/net.cpp"] = changed["main/net.cpp"].replace('diag_printf("net:', 'diag_printf("net:%f')
    altered_sources.append(changed)
    changed = dict(sources)
    changed["main/unreviewed_logger.cpp"] = "esp_log_set_vprintf(other_writer);"
    altered_sources.append(changed)
    for setting in ("CONFIG_LOG_VERSION_2=y\n", "CONFIG_LOG_VERSION=2\n"):
        changed = dict(sources)
        changed["sdkconfig.defaults"] += setting
        altered_sources.append(changed)
    changed = dict(sources)
    changed["sdkconfig.defaults"] = changed["sdkconfig.defaults"].replace(
        "CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y", "CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=n")
    altered_sources.append(changed)
    for changed in altered_sources:
        try:
            validate_small_task_diagnostics(changed)
        except BudgetError:
            pass
        else:
            raise AssertionError("self-test accepted a changed small-task diagnostic continuation")
        diagnostic_controls += 1
    integer_disassembly_controls = 0
    for name, altered, expected in (
        ("decimal base", fixture.replace("816: 00000c movi a12, 10", "816: 00000c movi a12, 16"),
         "decimal base"),
        ("destination bound", fixture.replace("828: 00000c addi a5, a1, 20", "828: 00000c addi a5, a1, 32"),
         "20-byte destination"),
        ("ROM division dispatch", fixture.replace("40002544 <__udivdi3>", "40002544 <unreviewed_division>"),
         "ROM continuation"),
        ("new conversion continuation", fixture.replace("<memcpy>)", "<unreviewed_copy>)"),
         "ROM continuation"),
        ("new helper caller", fixture + f"\n00000880 <unreviewed_payload()>:\n"
         f"880: 004136 entry a1, 32\n883: fff7a5 call8 800 <{INTEGER_APPEND_SYMBOL}>\n",
         "caller counts"),
        ("missing helper caller", fixture.replace(f"call8 800 <{INTEGER_APPEND_SYMBOL}>", "nop", 1),
         "caller counts"),
        ("indirect helper caller", fixture.replace(f"call8 800 <{INTEGER_APPEND_SYMBOL}>",
                                                  f"l32r a8, 800 <{INTEGER_APPEND_SYMBOL}>", 1),
         "indirect helper"),
        ("outlined frontend", fixture + "\n00000880 <void daik::json_append_integer_field<int>(int)>:\n"
         "880: 004136 entry a1, 32\n", "newly outlined"),
        ("dynamic integer helper", fixture.replace("801: 000081 l32r a8,", "800: 001810 movsp a1, a8\n801: 000081 l32r a8,"),
         "unreviewed dynamic stack"),
    ):
        assert altered != fixture
        reject_disassembly(f"integer formatter {name}", altered, expected)
        integer_disassembly_controls += 1
    integer_source = (REPO / "main/logic/json_integer.hpp").read_text(encoding="utf-8")
    integer_callers = {path: (REPO / path).read_text(encoding="utf-8")
                       for path in ("main/logic/heartbeat.hpp", "main/logic/heating_curve_mqtt.hpp")}
    validate_integer_source(integer_source, integer_callers)
    validate_integer_source(re.sub(r"\s+", " \n ", integer_source), integer_callers)
    integer_source_controls = 0
    for original, changed in (
        ("char digits[20]", "char digits[external_size]"),
        ("char digits[20]", "char digits[19]"),
        ("uint64_t magnitude", "uint32_t magnitude"),
        ("sizeof(digits), magnitude", "sizeof(digits), magnitude, 16"),
        ("__attribute__((always_inline))", "__attribute__((noinline))"),
        ("char digits[20];", "char digits[20]; alloca(external_size);"),
    ):
        altered = re.sub(re.escape(original).replace(r"\ ", r"\s+"), lambda _: changed, integer_source)
        assert altered != integer_source
        try:
            validate_integer_source(altered, integer_callers)
        except BudgetError as exc:
            assert "integer formatter source" in str(exc)
        else:
            raise AssertionError("self-test accepted changed integer formatter source")
        integer_source_controls += 1
    altered_callers = dict(integer_callers)
    altered_callers["main/logic/heartbeat.hpp"] += "\njson_append_integer_field(other, value);\n"
    try:
        validate_integer_source(integer_source, altered_callers)
    except BudgetError as exc:
        assert "caller inventory" in str(exc)
    else:
        raise AssertionError("self-test accepted an additional integer builder source caller")
    integer_source_controls += 1
    for owner in ("heartbeat", "curve"):
        for member in ("json_integer_append", "json_integer_length", "json_integer_digits"):
            altered_budget = json.loads(json.dumps(budgets))
            altered_budget["paths"][f"mqtt_{owner}_build"]["symbols"].remove(member)
            try:
                validate_source_contract(altered_budget)
            except BudgetError as exc:
                assert "integer formatter path" in str(exc)
            else:
                raise AssertionError(f"self-test accepted omitted {member} from {owner}")
            integer_source_controls += 1
    reject_disassembly("double buffer argument growth", fixture.replace("movi a12, 0x148",
                       "movi a12, 0x158"), "328-byte argument")
    reject_disassembly("double dynamic alignment growth", fixture.replace("addi.n a8, a4, 15",
                       "addi.n a8, a4, 31"), "align16")
    reject_disassembly("double dynamic rounding change", fixture.replace("srli a8, a8, 4",
                       "srli a8, a8, 3"), "align16")
    reject_disassembly("double dynamic destination change", fixture.replace("20e: 001810 movsp a1, a8",
                       "20e: 001810 movsp a1, a7"), "movsp contract")
    reject_disassembly("new double formatter caller", fixture +
                       f"\n00000240 <unreviewed_caller()>:\n240: 004136 entry a1, 32\n"
                       f"243: fff7a5 call8 200 <{double_body}>\n", "sole to_string(double)")
    reject_disassembly("new indirect double formatter reference", fixture +
                       f"\n00000240 <unreviewed_caller()>:\n240: 004136 entry a1, 32\n"
                       f"243: 000081 l32r a8, 200 <{double_body}>\n", "indirect")
    reject_disassembly("unknown dynamic application stack", fixture.replace(
                       "1: 004136          entry a1, 1232",
                       "1: 004136          entry a1, 1232\n2: 001810 movsp a1, a8"),
                       "unreviewed dynamic stack")
    reject_disassembly("required app later ENTRY rescue", fixture.replace(
                       "1: 004136          entry a1, 1232",
                       "1: 000000          nop\n2: 004136 entry a1, 1232"), "first prologue")
    reject_disassembly("unreviewed packed app prologue", fixture.replace(
                       "1: 004136          entry a1, 1232", "1: 00006136"), "first prologue")
    i2c_dynamic_controls = 0
    for original, altered in (("707: a5fb addi.n a10, a5, 15", "707: a5fb addi.n a10, a5, 31"),
                               ("71f: 250c movi.n a5, 2", "71f: 250c movi.n a5, 17"),
                               ("71c: 001810 movsp a1, a8", "71c: 001810 movsp a1, a9"),
                               ("71f: 250c movi.n a5, 2", "71f: 250c movi.n a5, 2\n721: 001810 movsp a1, a8")):
        reject_disassembly("changed I2C dynamic address bound", fixture.replace(original, altered),
                           "two align16 allocations changed")
        i2c_dynamic_controls += 1
    sdk_recursion_controls = 0
    for name in SDK_RECURSION_SYMBOLS:
        reject_disassembly(f"new SDK recursive continuation {name}", fixture +
                           f"\n00000700 <{name}$isra$9>:\n700: 004136 entry a1, 32\n",
                           "newly outlined SDK recursion")
        sdk_recursion_controls += 1
    packed_controls = 0
    for name in sorted(PACKED_ENTRY_SYMBOLS - {"parse_value", "parse_string", "cJSON_Delete",
                                              "cJSON_ParseWithLengthOpts"}):
        match = re.search(r"<" + re.escape(name) + r">:\n([^\n]+)", fixture)
        assert match is not None
        original = match.group(1)
        address = original.split(":", 1)[0]
        word = ((frames[name] // 8) << 12) | 0x136
        rendered = f"{address}: {word:08x} .word 0x{word:08x}"
        assert parse_frames(fixture.replace(original, rendered))[name] == frames[name]
        reject_disassembly(f"wrong packed SDK first opcode {name}", fixture.replace(
                           original, f"{address}: {word ^ 1:08x}\n{address}: 004136 entry a1, 32"),
                           "first prologue")
        packed_controls += 1
    sources = {path: (REPO / path).read_text(encoding="utf-8")
               for path, _ in TASK_ALLOCATIONS.values()}
    validate_task_inventory(sources)
    changed = dict(sources)
    changed["main/unreviewed_task.cpp"] = 'xTaskCreate(other_task, "other", 4096, 0, 1, 0);'
    try:
        validate_task_inventory(changed)
    except BudgetError as exc:
        assert "inventory requires review" in str(exc)
    else:
        raise AssertionError("self-test accepted a new task outside the reviewed allocation inventory")
    queue_controls = 0
    for original, changed in (("xQueueCreate(32, sizeof(SyslogMsg))", "xQueueCreate(32, 0)"),
                              ("xQueueSend(s_queue, &m, 0)", "xQueueSend(s_queue, &m, 1)"),
                              ("if (!s_queue) return;", "if (false) return;")):
        source = sources["main/syslog.cpp"].replace(original, changed)
        assert source != sources["main/syslog.cpp"]
        try:
            validate_syslog_queue(source)
        except BudgetError as exc:
            assert "nonblocking fixed-message contract" in str(exc)
        else:
            raise AssertionError("self-test accepted altered nonblocking Syslog queue ownership")
        queue_controls += 1
    tls_source_controls = 0
    for field in ("credentials.authentication.certificate", "credentials.authentication.key",
                  "broker.verification.psk_hint_key", "broker.verification.certificate"):
        changed = sources["main/mqtt_ha.cpp"].replace(
            "esp_mqtt_client_config_t cfg = {};", "esp_mqtt_client_config_t cfg = {};\n"
            f"cfg.{field} = unreviewed;")
        try:
            validate_mqtt_tls_client(changed)
        except BudgetError as exc:
            assert "bundle/password field contract" in str(exc)
        else:
            raise AssertionError("self-test accepted expanded MQTT TLS client credentials")
        tls_source_controls += 1
    i2c_source_controls = 0
    for original, altered in (("cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;", "cfg.dev_addr_length = I2C_ADDR_BIT_LEN_10;"),
                               ("cfg.i2c_port = I2C_NUM_0;", "cfg.i2c_port = I2C_NUM_0; cfg.trans_queue_depth = 4;"),
                               ("calibration_raw[25]", "calibration_raw[128]"),
                               ("&stored, 1)", "&stored, external_size)"),
                               ("const uint8_t command[2]", "const uint8_t command[16]"),
                               ("i2c_master_receive(sensor.sht, raw, sizeof(raw), I2C_TIMEOUT_MS)",
                                "i2c_master_receive(sensor.sht, raw, external_size, I2C_TIMEOUT_MS)")):
        altered_source = sources["main/env3.cpp"].replace(original, altered)
        assert altered_source != sources["main/env3.cpp"]
        try:
            validate_env_i2c(altered_source)
        except BudgetError as exc:
            assert "ENV I2C:" in str(exc)
        else:
            raise AssertionError("self-test accepted changed ENV/HTTP I2C transfer bound")
        i2c_source_controls += 1
    for task, (source_path, pattern) in TASK_ALLOCATIONS.items():
        changed = dict(sources)
        match = re.search(pattern, changed[source_path])
        assert match is not None
        start, end = match.span(1)
        changed[source_path] = changed[source_path][:start] + "1024" + changed[source_path][end:]
        try:
            validate_task_stacks(budgets, changed)
        except BudgetError as exc:
            assert f"task {task}:" in str(exc), str(exc)
        else:
            raise AssertionError(f"self-test accepted changed task allocation {task}")
        changed_budget = json.loads(json.dumps(budgets))
        path = changed_budget["tasks"][task]["paths"][0]
        changed_budget["paths"][path]["max_bytes"] = changed_budget["tasks"][task]["stack_bytes"]
        try:
            validate_task_stacks(changed_budget, sources)
        except BudgetError as exc:
            assert "ceiling must retain" in str(exc)
        else:
            raise AssertionError(f"self-test accepted consumed reserve in {task}")
        inventory_controls += 2

    evaluate(parse_frames(fixture.replace(
        "_ZN4daik12_GLOBAL__N_1L13weather_cycleEmRNS0_21RefreshRequestAttemptE$constprop$0",
        "daik::(anonymous namespace)::weather_cycle(unsigned long, daik::RefreshRequestAttempt&)")),
        budgets)
    reject_disassembly("missing Weather cycle", fixture.replace(
        "_ZN4daik12_GLOBAL__N_1L13weather_cycle", "_ZN4daik12_GLOBAL__N_1L13renamed_cycle"),
        "weather_cycle")
    reject_disassembly("Weather cycle frame growth", fixture.replace(
        "40: 004136          entry a1, 736", "40: 004136          entry a1, 4112"),
        "weather_cycle")
    cloned_download = fixture.replace(
        "daik::(anonymous namespace)::download_json(daik::Config const&, std::string&, std::string&, bool&, daik::HttpClientProbe&)",
        "_ZN4daik12_GLOBAL__N_1L13download_jsonERKNS_21WeatherConfigSnapshotERNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEESA_RbRNS_15HttpClientProbeE$constprop$0")
    evaluate(parse_frames(cloned_download), budgets)
    reject_disassembly("missing Weather download with lambda present", cloned_download.replace(
        "_ZN4daik12_GLOBAL__N_1L13download_json", "_ZN4daik12_GLOBAL__N_1L13renamed_fetch") +
        "\n00000041 <daik::(anonymous namespace)::download_json(daik::Config const&, std::string&)::{lambda()}::operator()() const>:\n  41: 004136 entry a1, 32\n",
        "weather_download")

    reject_disassembly("wrong first blank opcode", fixture.replace(
        "1f: 16008136 \t", "1f: 16008135 \t"), "first prologue")
    reject_disassembly("later ENTRY rescue", fixture.replace(
        "1f: 16008136 \t", "1f: 16008135 \t\n  2a: 008136 entry a1, 64"), "first prologue")
    reject_disassembly("truncated blank word", fixture.replace(
        "1f: 16008136 \t", "1f: 008136 \t"), "first prologue")
    reject_disassembly("empty first word", fixture.replace(
        "1f: 16008136 \t", "1f: \t"), "first prologue")
    reject_disassembly("zero packed frame", fixture.replace(
        "1f: 16008136 \t", "1f: 16000136 \t"), "empty first stack frame")
    reject_disassembly("mismatched .word", fixture.replace(
        "1f: 16008136 \t", "1f: 16008136 .word 0x16008135"), "first prologue")
    reject_disassembly("wrong instruction address", fixture.replace(
        "1f: 16008136", "2a: 16008136"), "symbol address")
    reject_disassembly("missing cJSON symbol", fixture.replace("<parse_value>", "<renamed_value>"),
        "cjson_parse_value")
    reject_disassembly("recursive frame growth", fixture.replace(
        "1f: 16008136 \t", "1f: 16009136 \t"), "cjson_parse_value")
    reject_disassembly("Config frame growth", fixture.replace("entry a1, 3200", "entry a1, 3216"),
        "config_hp")
    reject_disassembly("MQTT save caller frame growth", fixture.replace(
        "14: 004136          entry a1, 2336", "14: 004136          entry a1, 2352"), "config_mqtt")
    reject_disassembly("MCP recursion frame growth", fixture.replace(
        "1d: 004136          entry a1, 32", "1d: 004136          entry a1, 48"), "mcp_json_value")
    reject_disassembly("Config transaction frame growth", fixture.replace(
        "25: 004136          entry a1, 1600", "25: 004136          entry a1, 1616"),
        "config_transaction")
    reject_disassembly("missing Config transaction", fixture.replace(
        "_ZN4daik23config_save_transaction", "_ZN4daik23renamed_transaction"), "config_transaction")
    reject_disassembly("WiFi scan frame growth", fixture.replace(
        "28: 004136          entry a1, 1920", "28: 004136          entry a1, 1936"), "wifi_scan")
    reject_disassembly("missing WiFi scan", fixture.replace("<daik::wifi_scan(", "<daik::renamed_scan("),
        "wifi_scan")
    reject_disassembly("new out-of-line container", fixture +
        "\n00000023 <parse_array>:\n  23: 004136 entry a1, 64\n", "budget review")
    reject_disassembly("new cloned recursive parser", fixture +
        "\n00000300 <parse_value$constprop$0>:\n  300: 004136 entry a1, 64\n", "budget review")
    reject_disassembly("new out-of-line publication continuation", fixture +
        "\n00000300 <daik::publish_modbus_state(bool&)>:\n300: 004136 entry a1, 64\n",
        "newly outlined MQTT continuation")
    assert "unreviewed_packed" not in parse_frames(
        "00000023 <unreviewed_packed>:\n  23: e2008136 .word 0xe2008136\n")
    try:
        validate_http_stack(budgets, "cfg.stack_size = 8192;")
    except BudgetError as exc:
        assert "retain 2048 B" in str(exc)
    else:
        raise AssertionError("self-test accepted insufficient HTTP stack reserve")
    json_source = (REPO / "main/logic/payload_complete.hpp").read_text(encoding="utf-8")
    mcp_source = (REPO / "main/logic/mcp.hpp").read_text(encoding="utf-8")
    adapter_source = (REPO / "main/json_guard.hpp").read_text(encoding="utf-8")
    for name, changed_json, changed_mcp, member, multiplier in (
        ("cJSON source depth", json_source.replace("JSON_MAX_DEPTH      = 16;",
                                                  "JSON_MAX_DEPTH      = 17;"), mcp_source, None, None),
        ("MCP source depth", json_source, mcp_source.replace("depth > 16", "depth > 17"), None, None),
        ("cJSON parse root", json_source, mcp_source, "cjson_parse_value", 16),
        ("simultaneous cJSON cleanup", json_source, mcp_source, "cjson_delete", 16),
        ("MCP early-reject frame", json_source, mcp_source, "mcp_json_value", 17),
    ):
        changed_budgets = json.loads(json.dumps(budgets))
        if member is not None:
            path = "httpd_mcp_parse" if member == "mcp_json_value" else "httpd_config_hp"
            changed_budgets["paths"][path]["multipliers"][member] = multiplier
        try:
            validate_json_recursion(changed_budgets, changed_json, changed_mcp, adapter_source)
        except BudgetError:
            pass
        else:
            raise AssertionError(f"self-test accepted {name}")
    for path in ("mqtt_reference_parse", "mqtt_circulation_parse",
                 "mqtt_circulation_probe_parse", "weather_task_parse"):
        changed_budgets = json.loads(json.dumps(budgets))
        changed_budgets["paths"][path]["multipliers"]["cjson_delete"] = 16
        try:
            validate_json_recursion(changed_budgets, json_source, mcp_source, adapter_source)
        except BudgetError as exc:
            assert path in str(exc)
        else:
            raise AssertionError(f"self-test accepted reduced shared-parser cleanup depth in {path}")
    larger_default = json_source.replace("MQTT_JSON_MAX_DEPTH = JSON_MAX_DEPTH;",
                                        "MQTT_JSON_MAX_DEPTH = 32;")
    assert larger_default != json_source
    try:
        validate_json_recursion(budgets, larger_default, mcp_source, adapter_source)
    except BudgetError as exc:
        assert "MQTT JSON depth default" in str(exc)
    else:
        raise AssertionError("self-test accepted larger MQTT implicit parser depth")
    overridden_adapter = adapter_source.replace("}, JSON_MAX_DEPTH);", "}, 32);")
    assert overridden_adapter != adapter_source
    try:
        validate_json_recursion(budgets, json_source, mcp_source, overridden_adapter)
    except BudgetError as exc:
        assert "fourth argument" in str(exc)
    else:
        raise AssertionError("self-test accepted a larger cJSON adapter depth override")
    assert budgets["paths"]["ota_task_manifest_fetch"]["max_bytes"] == 6144
    assert budgets["paths"]["weather_task_download"]["max_bytes"] == 11264
    assert budgets["paths"]["weather_task_parse"]["max_bytes"] == 11264
    assert budgets["paths"]["ota_health_gate"]["max_bytes"] == 3072

    too_large = fixture.replace("entry a1, 1120", "entry a1, 2304")
    try:
        evaluate(parse_frames(too_large), budgets)
    except BudgetError as exc:
        assert "mqtt_task" in str(exc)
    else:
        raise AssertionError("self-test failed to reject an oversized frame")

    health_too_large = fixture.replace("e: 004136          entry a1, 80",
                                     "e: 004136          entry a1, 1056")
    try:
        evaluate(parse_frames(health_too_large), budgets)
    except BudgetError as exc:
        assert "ota_health_task" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the ota_health reserve")

    manifest_path_too_large = (
        fixture.replace("5: 004136          entry a1, 2608", "5: 004136          entry a1, 2816")
        .replace("7: 004136          entry a1, 1280", "7: 004136          entry a1, 1408")
        .replace("8: 004136          entry a1, 48", "8: 004136          entry a1, 128")
        .replace("b: 004136          entry a1, 160", "b: 004136          entry a1, 512")
        .replace("c: 004136          entry a1, 64", "c: 004136          entry a1, 256")
    )
    try:
        evaluate(parse_frames(manifest_path_too_large), budgets)
    except BudgetError as exc:
        assert "ota_task_manifest_fetch" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the OTA task path reserve")

    weather_path_too_large = (
        fixture.replace("entry a1, 1152", "entry a1, 6144")
        .replace("entry a1, 160", "entry a1, 2048")
        .replace("entry a1, 432", "entry a1, 3072")
    )
    try:
        evaluate(parse_frames(weather_path_too_large), budgets)
    except BudgetError as exc:
        assert "weather_task_download" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the Weather task reserve")

    weather_parse_path_too_large = (
        fixture.replace("entry a1, 1152", "entry a1, 6144")
        .replace("entry a1, 160", "entry a1, 2048")
        .replace("  12: 004136          entry a1, 512",
                 "  12: 004136          entry a1, 3072")
    )
    try:
        evaluate(parse_frames(weather_parse_path_too_large), budgets)
    except BudgetError as exc:
        assert "weather_task_parse" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the Weather parse reserve")

    missing = fixture.replace("daik::mcp_post", "daik::renamed_post")
    try:
        evaluate(parse_frames(missing), budgets)
    except BudgetError as exc:
        assert "required pattern" in str(exc)
    else:
        raise AssertionError("self-test failed to reject a missing required symbol")

    with tempfile.TemporaryDirectory() as raw:
        bad = Path(raw) / "budgets.json"
        valid_document = json.loads(DEFAULT_BUDGETS.read_text(encoding="utf-8"))
        negative_checks = 0
        sdk_root = Path(raw) / "components"
        sdk_fixture = json.loads(json.dumps(budgets))
        for name in SDK_PUBLIC_FILES:
            path = sdk_root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            contents = f"/* reviewed public source fixture: {name} */\n".encode()
            path.write_bytes(contents)
            sdk_fixture["sdk"]["source_sha256"][name] = hashlib.sha256(contents).hexdigest()
        header = Path(raw) / "sdkconfig.h"
        header_text = "".join(f"#define {name} {value}\n"
                              for name, value in sdk_fixture["sdk"]["config_macros"].items()
                              if value is not None)
        header_text += "#define CONFIG_UNRELATED_TUNING 123\n"
        header.write_text(header_text, encoding="utf-8")
        assert set(public_sdkconfig(header)) == set(SDK_PUBLIC_MACROS)
        validate_sdk_contract(sdk_fixture, sdk_root, header)
        sdk_controls = 0
        changed_source = sdk_root / SDK_PUBLIC_FILES[0]
        original_source = changed_source.read_bytes()
        changed_source.write_bytes(original_source + b"#define PSA_VENDOR_RSA_MAX_KEY_BITS 8192u\n")
        try:
            validate_sdk_contract(sdk_fixture, sdk_root, header)
        except BudgetError as exc:
            assert "fingerprint changed" in str(exc)
        else:
            raise AssertionError("self-test accepted SDK recursion-limit drift with unchanged ENTRY frames")
        changed_source.write_bytes(original_source)
        sdk_controls += 1
        for macro, expected_value in sdk_fixture["sdk"]["config_macros"].items():
            changed_value = 1 if expected_value is None else expected_value + 1
            changed = re.sub(r"(?m)^#define " + macro + r" .+\n", "", header_text)
            header.write_text(changed + f"#define {macro} {changed_value}\n", encoding="utf-8")
            try:
                validate_sdk_contract(sdk_fixture, sdk_root, header)
            except BudgetError as exc:
                assert "active build differs" in str(exc)
            else:
                raise AssertionError(f"self-test accepted active SDK override {macro}")
            sdk_controls += 1
        header.write_text(header_text + "#define CONFIG_ESP_MAIN_TASK_STACK_SIZE 8192\n", encoding="utf-8")
        try:
            public_sdkconfig(header)
        except BudgetError as exc:
            assert "duplicate" in str(exc)
        else:
            raise AssertionError("self-test accepted ambiguous duplicate public SDK macro")
        sdk_controls += 1
        header.write_text(header_text, encoding="utf-8")
        changed_source.unlink()
        try:
            validate_sdk_contract(sdk_fixture, sdk_root, header)
        except BudgetError as exc:
            assert "unavailable" in str(exc)
        else:
            raise AssertionError("self-test accepted a missing reviewed SDK source")
        sdk_controls += 1

        def clone() -> dict[str, Any]:
            return json.loads(json.dumps(valid_document))

        def reject_payload(name: str, payload: str, expected: str) -> None:
            nonlocal negative_checks
            bad.write_text(payload, encoding="utf-8")
            try:
                load_budgets(bad)
            except BudgetError as exc:
                if expected not in str(exc):
                    raise AssertionError(
                        f"{name}: expected {expected!r} in {str(exc)!r}"
                    ) from exc
            else:
                raise AssertionError(f"self-test accepted {name}")
            negative_checks += 1

        def reject_document(name: str, document: Any, expected: str) -> None:
            reject_payload(name, json.dumps(document), expected)

        reject_document("a non-object document", [], "must be an object")
        mutated = clone()
        mutated["extra"] = 1
        reject_document("an extra document key", mutated, "keys must be exactly")
        mutated = clone()
        del mutated["paths"]
        reject_document("a missing document key", mutated, "missing paths")
        for name, value in (("boolean", True), ("string", "1"), ("float", 1.0), ("other", 2)):
            mutated = clone()
            mutated["version"] = value
            reject_document(f"a {name} version", mutated, "JSON integer 1")

        mutated = clone()
        mutated["symbols"] = {}
        reject_document("empty symbols", mutated, "symbols must be a non-empty object")
        mutated = clone()
        mutated["symbols"] = ["mqtt_task"]
        reject_document("non-object symbols", mutated, "symbols must be a non-empty object")
        mutated = clone()
        mutated["paths"] = {}
        reject_document("empty paths", mutated, "paths must be a non-empty object")
        mutated = clone()
        mutated["paths"] = ["httpd_mcp_status"]
        reject_document("non-object paths", mutated, "paths must be a non-empty object")

        mutated = clone()
        mutated["symbols"][""] = mutated["symbols"].pop("mqtt_task")
        reject_document("an empty symbol name", mutated, "symbol names")
        mutated = clone()
        mutated["symbols"][" mqtt_task"] = mutated["symbols"].pop("mqtt_task")
        reject_document("a padded symbol name", mutated, "symbol names")
        mutated = clone()
        mutated["symbols"]["MQTT-task"] = mutated["symbols"].pop("mqtt_task")
        reject_document("a malformed symbol name", mutated, "symbol names")
        mutated = clone()
        mutated["symbols"]["mqtt_task"] = []
        reject_document("a non-object symbol rule", mutated, "rule must be an object")
        mutated = clone()
        del mutated["symbols"]["mqtt_task"]["pattern"]
        reject_document("a missing symbol key", mutated, "missing pattern")
        mutated = clone()
        mutated["symbols"]["mqtt_task"]["extra"] = 1
        reject_document("an extra symbol key", mutated, "unexpected extra")
        for name, value, expected in (
            ("empty", "", "non-empty string"),
            ("non-string", 7, "non-empty string"),
            ("invalid regex", "(", "invalid pattern"),
        ):
            mutated = clone()
            mutated["symbols"]["mqtt_task"]["pattern"] = value
            reject_document(f"a {name} symbol pattern", mutated, expected)
        for name, value in (
            ("boolean", True),
            ("string", "2048"),
            ("float", 2048.0),
            ("zero", 0),
            ("negative", -1),
        ):
            mutated = clone()
            mutated["symbols"]["mqtt_task"]["max_bytes"] = value
            reject_document(
                f"a {name} symbol maximum", mutated, "positive JSON integer"
            )

        mutated = clone()
        mutated["paths"][""] = mutated["paths"].pop("httpd_direct_status")
        reject_document("an empty path name", mutated, "path names")
        mutated = clone()
        mutated["paths"][" httpd_direct_status"] = mutated["paths"].pop(
            "httpd_direct_status"
        )
        reject_document("a padded path name", mutated, "path names")
        mutated = clone()
        mutated["paths"]["HTTP-path"] = mutated["paths"].pop("httpd_direct_status")
        reject_document("a malformed path name", mutated, "path names")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"] = []
        reject_document("a non-object path rule", mutated, "rule must be an object")
        mutated = clone()
        del mutated["paths"]["httpd_direct_status"]["base_bytes"]
        reject_document("a missing path key", mutated, "missing base_bytes")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["extra"] = 1
        reject_document("an extra path key", mutated, "unexpected extra")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["multipliers"] = []
        reject_document("non-object path multipliers", mutated, "multipliers must be an object")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["multipliers"] = {"missing": 2}
        reject_document("unknown path multiplier", mutated, "not path members missing")
        for name, value in (("boolean", True), ("string", "2"), ("one", 1), ("zero", 0)):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["multipliers"] = {
                "status_serializer": value
            }
            reject_document(
                f"a {name} path multiplier", mutated, "JSON integer greater than 1"
            )
        for name, value in (
            ("empty", []),
            ("non-list", "status_serializer"),
            ("empty-name", [""]),
        ):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["symbols"] = value
            reject_document(
                f"a {name} path member list", mutated, "non-empty rule-name list"
            )
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["symbols"] = [
            "status_serializer",
            "status_serializer",
        ]
        reject_document("duplicate path members", mutated, "must not contain duplicates")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["symbols"] = ["missing"]
        reject_document("an unknown path member", mutated, "unknown symbols missing")
        for name, value in (
            ("boolean", True),
            ("string", "1536"),
            ("float", 1536.0),
            ("negative", -1),
        ):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["base_bytes"] = value
            reject_document(
                f"a {name} path base", mutated, "non-negative JSON integer"
            )
        for name, value in (
            ("boolean", True),
            ("string", "8192"),
            ("float", 8192.0),
            ("zero", 0),
            ("negative", -1),
        ):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["max_bytes"] = value
            reject_document(
                f"a {name} path maximum", mutated, "positive JSON integer"
            )
        reject_payload(
            "a duplicate JSON key",
            '{"version":1,"version":1,"symbols":{},"paths":{}}',
            "duplicate JSON key 'version'",
        )
        for field, value in (("sdk", []), ("tasks", [])):
            mutated = clone()
            mutated[field] = value
            reject_document(f"non-object {field}", mutated, "object")
        mutated = clone()
        mutated["sdk"]["source_sha256"]["unreviewed-source.c"] = "0" * 64
        reject_document("unreviewed SDK source path", mutated, "exactly the reviewed public source files")
        mutated = clone()
        mutated["sdk"]["source_sha256"][SDK_PUBLIC_FILES[0]] = "0" * 63
        reject_document("truncated SDK fingerprint", mutated, "SHA-256 hex")
        mutated = clone()
        mutated["sdk"]["config_macros"]["CONFIG_UNRELATED_TUNING"] = 123
        reject_document("unreviewed public SDK macro", mutated, "exactly the reviewed public macros")
        mutated = clone()
        mutated["sdk"]["config_macros"]["CONFIG_ESP_MAIN_TASK_STACK_SIZE"] = True
        reject_document("boolean SDK size", mutated, "non-negative integer or absence")
        for field, value in (("base_bytes", 0), ("max_bytes", SDK_TLS_LIMIT + 16)):
            mutated = clone()
            mutated["sdk"]["tls_paths"]["certificate_ecdsa"][field] = value
            reject_document(f"altered TLS {field}", mutated, "full TLS4608 bounds must remain fixed")
        mutated = clone()
        mutated["sdk"]["tls_paths"] = {}
        reject_document("missing SDK TLS profiles", mutated, "non-empty object")
        mutated = clone()
        mutated["paths"]["mqtt_sync_tls_publish"]["base_bytes"] = 4096
        reject_document("stale partial TLS envelope", mutated, "reviewed full TLS4608 envelope")
        mutated = clone()
        del mutated["sdk"]["tls_paths"]["certificate_rsa_pss_adding"]
        reject_document("omitted TLS PSS profile", mutated, "exactly the reviewed active profiles")
        mutated = clone()
        mutated["sdk"]["tls_paths"]["certificate_rsa_pss_recursive"]["multipliers"] = {}
        reject_document("omitted overlong recursive frame", mutated, "one-level/sibling recursion contract")
        mutated = clone()
        mutated["sdk"]["tls_paths"]["certificate_rsa_pss_recursive"]["multipliers"]["tls_mbedtls_mpi_mul_mpi"] = 3
        reject_document("new overlong recursion level", mutated, "one-level/sibling recursion contract")
        mutated = clone()
        mutated["sdk"]["tls_paths"]["certificate_ecdsa"]["symbols"].remove("runtime_task_entry")
        reject_document("omitted TLS task entry", mutated, "task-wrapper continuation")
        mutated = clone()
        mutated["sdk"]["tls_paths"]["certificate_ecdsa"]["symbols"].remove("tls_ws_connect")
        reject_document("omitted WSS upgrade caller", mutated, "WSS upgrade prefix")
        for multiplier in (None, 3):
            mutated = clone()
            mutated["sdk"]["tls_paths"]["record_cbc_dma"]["multipliers"] = (
                {} if multiplier is None else {"tls_esp_aes_process_dma": multiplier})
            reject_document("changed bounded DMA recursion", mutated, "one-level/sibling recursion contract")
    print(f"stack budget self-test: PASS ({negative_checks} malformed schemas rejected, "
          f"{inventory_controls} inventory/growth/allocation/reserve controls, "
          f"9 dynamic/first-prologue, {packed_controls} packed SDK, "
          f"{queue_controls} queue-source, {diagnostic_controls} diagnostic-source, "
          f"{tls_source_controls} TLS-client-source, {sdk_recursion_controls} SDK-recursion, "
          f"{integer_disassembly_controls} integer-disassembly, {integer_source_controls} integer-source/path, "
          f"{diagnosis_controls} diagnosis-source/path, "
          f"{numeric_disassembly_controls} diagnosis-numeric-calls, "
          f"{shutdown_controls} shutdown-source/path, "
          f"{shutdown_optimizer_controls} shutdown-inlining, "
          f"{i2c_dynamic_controls} I2C-dynamic, {i2c_source_controls} I2C-source, "
          f"{sdk_controls} SDK-source/config controls)")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--elf", type=Path)
    source.add_argument("--disassembly", type=Path)
    parser.add_argument("--objdump", default="xtensa-esp32s3-elf-objdump")
    parser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGETS)
    parser.add_argument("--sdk-components", type=Path,
                        help="reviewed public SDK components tree; defaults to IDF_PATH/components")
    parser.add_argument("--sdkconfig-header", type=Path,
                        help="active build/config/sdkconfig.h; inferred from --elf's build directory")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if args.elf is None and args.disassembly is None:
        parser.error("one of --elf or --disassembly is required")
    budgets = load_budgets(args.budgets)
    validate_source_contract(budgets)
    components = args.sdk_components
    if components is None and (idf_path := os.environ.get("IDF_PATH")):
        components = Path(idf_path) / "components"
    header = args.sdkconfig_header
    if header is None and args.elf is not None:
        header = args.elf.parent / "config/sdkconfig.h"
    if components is None or header is None:
        raise BudgetError("source-bound SDK budgets need IDF_PATH/--sdk-components and an active --sdkconfig-header")
    validate_sdk_contract(budgets, components, header)
    if args.elf is not None:
        text = disassemble(args.elf, args.objdump)
    else:
        try:
            text = args.disassembly.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise BudgetError(f"cannot read {args.disassembly}: {exc}") from exc
    validate_shutdown_inlining(text, budgets)
    validate_status_numeric_calls(text, budgets)
    result = evaluate(parse_frames(text, budgets), budgets)
    reserves = {task: rule["stack_bytes"] - max(result[f"path:{path}"] for path in rule["paths"])
                for task, rule in budgets["tasks"].items()}
    tightest = min(reserves, key=reserves.get)
    tls_peak = max(result[f"sdk_path:{name}"] for name in budgets["sdk"]["tls_paths"])
    print(f"stack budget: OK ({len(budgets['symbols'])} required frames, "
          f"{len(budgets['paths'])} task paths, {len(budgets['sdk']['tls_paths'])} TLS profiles; "
          f"tightest modeled task reserve {tightest}={reserves[tightest]} B; "
          f"TLS={tls_peak}/{SDK_TLS_LIMIT} B)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BudgetError as exc:
        raise SystemExit(f"stack budget: {exc}") from exc
