#!/usr/bin/env python3
"""Run real heater Store plus explicitly bounded, unchanged History journal bodies on host flash."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1])
parser.add_argument('--out', type=Path)
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none')
parser.add_argument('--case', action='append')
args = parser.parse_args()
ROOT = args.root.resolve()
HISTORY = ROOT / 'main/history.cpp'
STORE = ROOT / 'main/heater_context_store.cpp'
if not HISTORY.is_file() or not STORE.is_file():
    parser.error('--root requires History and the real heater Store')
if args.out:
    OUT = args.out.resolve()
    OUT.mkdir(mode=0o700, parents=True, exist_ok=False)
else:
    OUT = Path(tempfile.mkdtemp(prefix='daikin-heater-journal-runtime-')).resolve()
    OUT.chmod(0o700)

source = HISTORY.read_text()
extracted = []


def digest(data):
    return hashlib.sha256(data).hexdigest()


def block(signature, suffix='', record=True):
    # These selected production bodies contain ordinary quoted strings, not raw strings.
    # Reject a future raw string instead of silently extracting a different source body.
    starts = []
    for match in re.finditer(re.escape(signature), source):
        opening = source.find('{', match.start())
        semicolon = source.find(';', match.end())
        if opening >= 0 and (semicolon < 0 or opening < semicolon):
            starts.append(match.start())
    if len(starts) != 1:
        raise RuntimeError('need exactly one production declaration: ' + signature)
    start = starts[0]
    opening = source.index('{', start)
    depth, index, mode, escaped = 0, opening, 'code', False
    while index < len(source):
        char = source[index]
        pair = source[index:index + 2]
        if mode == 'line':
            if char == '\n': mode = 'code'
        elif mode == 'comment':
            if pair == '*/': mode = 'code'; index += 1
        elif mode in ('"', "'"):
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == mode: mode = 'code'
        elif pair == '//': mode = 'line'; index += 1
        elif pair == '/*': mode = 'comment'; index += 1
        elif source[index:index + 2] == 'R"':
            raise RuntimeError('raw strings need an explicit extractor update')
        elif char in ('"', "'"): mode = char
        elif char == '{': depth += 1
        elif char == '}':
            depth -= 1
            if not depth:
                end = index + 1
                if suffix:
                    if source[end:end + len(suffix)] != suffix:
                        raise RuntimeError('unexpected declaration suffix: ' + signature)
                    end += len(suffix)
                text = source[start:end] + '\n'
                if record:
                    extracted.append({'declaration': signature, 'first_line': source.count('\n', 0, start) + 1,
                                      'last_line': source.count('\n', 0, end) + 1,
                                      'sha256': digest(text.encode())})
                return text
        index += 1
    raise RuntimeError('unterminated production body: ' + signature)


def exact_range(first, after):
    if source.count(first) != 1 or source.count(after) != 1:
        raise RuntimeError('nonunique production source range')
    start, end = source.index(first), source.index(after)
    if start >= end:
        raise RuntimeError('reversed production source range')
    text = source[start:end]
    extracted.append({'declaration': first, 'first_line': source.count('\n', 0, start) + 1,
                      'last_line': source.count('\n', 0, end), 'sha256': digest(text.encode())})
    return text


(OUT / 'history_geometry.hpp').write_text(exact_range('struct FlashJournalRecord {', '\nconst esp_partition_t* s_flash_part'))
(OUT / 'history_state.hpp').write_text(exact_range('const esp_partition_t* s_flash_part', '\nstruct FlashManifestCache {'))
(OUT / 'history_failure_state.hpp').write_text(exact_range('size_t   s_flash_fail_slot', '\n// A source whose append cursor'))
(OUT / 'history_future_note.hpp').write_text(block('struct FutureCursorNote {', ';'))
(OUT / 'history_checkup_owned.hpp').write_text(exact_range('inline bool flash_checkup_schema_matches(', '\nbool flash_record_valid('))
(OUT / 'history_source.hpp').write_text(block('enum class HistorySource : uint8_t {', ';'))
signatures = [
    'bool flash_is_manifest(', 'bool flash_record_physically_valid(', 'bool flash_record_valid(',
    'esp_err_t flash_read_record(', 'bool flash_read_heater_context(', 'esp_err_t flash_region_erased(',
    'esp_err_t flash_prepare_next_slot(', 'bool flash_build_next_heater_context(',
    'esp_err_t flash_append_record_at(', 'void flash_count_abandoned_sector(',
    'void flash_note_append_failure(', 'void flash_note_append_success(', 'esp_err_t flash_append_record(',
    '[[gnu::always_inline]] inline bool flash_build_for_service(', 'static size_t history_flash_service_journal(',
]
signatures.append('static void flash_progress_heater_context('
                  if 'static void flash_progress_heater_context(' in source
                  else 'void flash_progress_heater_context(')
signatures.append('[[gnu::noinline]] bool flash_is_heater_owned(')
signatures.append('[[gnu::noinline]] void flash_heater_append_outcome(')
for index, signature in enumerate(signatures):
    (OUT / ('body_' + str(index) + '.hpp')).write_text(block(signature))
# The large legacy restore function is inspected, not compiled or represented by a fake clone.
# Its one real progress leaf is body_15. All other History service sites must explicitly spend0.
restore_body = block('void history_service_flash_restore(', record=False)
if len(re.findall(r'\bflash_progress_heater_context\s*\(\s*\)\s*;', restore_body)) != 1:
    raise RuntimeError('the real restore entry must contain exactly one heater progress call')
def unconditional_restore_leaf(body):
    call = re.search(r'^\s*flash_progress_heater_context\s*\(\s*\)\s*;', body, re.MULTILINE)
    if not call: return False
    prefix = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', body[:call.start()])
    return prefix.count('{') - prefix.count('}') == 1 and prefix.rstrip()[-1:] in (';', '{')
if not unconditional_restore_leaf(restore_body):
    raise RuntimeError('restore progress must remain unconditional at its admitted flash-lock scope, including while pinned')
restore_negative_controls = []
for tag, changed in [('omit', restore_body.replace('flash_progress_heater_context();', '')),
                     ('pinned-gate', restore_body.replace('flash_progress_heater_context();',
                         'if (!s_flash_heater_pinned) flash_progress_heater_context();'))]:
    if unconditional_restore_leaf(changed):
        raise RuntimeError('restore caller-contract control escaped: ' + tag)
    restore_negative_controls.append(tag)
service_calls = re.findall(
    r'heater_context_flash_service\s*\(\s*flash_read_heater_context\s*,\s*'
    r'(?:/\*[^*]*\*/\s*)?([A-Za-z0-9_:]+)\s*\)', source)
positive = [value for value in service_calls if value != '0']
all_calls = re.findall(r'\bheater_context_flash_service\s*\(', source)
if len(positive) != 1 or positive[0] not in ('256', 'HEATER_CONTEXT_FLASH_MAX_READS') or len(all_calls) != len(service_calls):
    raise RuntimeError('History must have one explicit256 budget and only explicit0 elsewhere')
save_body = block('void history_flash_save(', record=False)
save_limits = re.findall(
    r'history_flash_service_journal\s*\(\s*(?:/\*[^*]*\*/\s*)?([0-9]+)\s*,', save_body)
if save_limits != ['12']:
    raise RuntimeError('the actual shutdown save must retain its one12-record drain')
caller_contract = {'restore_body_sha256': digest(restore_body.encode()),
                   'shutdown_save_body_sha256': digest(save_body.encode()),
                   'shutdown_record_limit': 12,
                   'progress_leaf_calls_in_restore': 1,
                   'unconditional_restore_leaf_including_pinned': True,
                   'source_contract_negative_controls': restore_negative_controls,
                   'explicit_service_budgets': service_calls,
                   'compiled_restore_entry': False}
(OUT / 'extraction.json').write_text(json.dumps({'history_sha256': digest(source.encode()),
                                               'bodies_and_state': extracted,
                                               'caller_contract': caller_contract}, indent=2) + '\n')

compiler = shlex.split(os.environ.get('CXX', 'c++'))
san = ['-fsanitize=undefined', '-fno-sanitize-recover=all'] if args.sanitizer == 'undefined' else []
flags = ['-std=c++20', '-O0', '-g', '-fno-omit-frame-pointer', '-Wall', '-Wextra', '-Werror',
         '-Wno-unused-function', '-Wno-unused-const-variable', *san,
         '-I', str(OUT), '-I', str(HERE / 'stubs'), '-I', str(ROOT / 'main')]
commands = []


def run(argv, timeout=120):
    argv = [str(value) for value in argv]
    commands.append(shlex.join(argv))
    return subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=timeout)


inputs = {Path(__file__).resolve(), HERE / 'fixture.cpp', HERE / 'README.md', HISTORY, STORE}
dependencies = {}


def dependency_paths(path):
    result = set()
    for word in shlex.split(path.read_text().replace('\\\n', ' ').partition(':')[2]):
        item = Path(word)
        result.add((item if item.is_absolute() else ROOT / item).resolve())
    if not result:
        raise RuntimeError('empty actual compiler input inventory: ' + str(path))
    return result


for tag, unit in [('fixture', HERE / 'fixture.cpp'), ('store', STORE)]:
    deps = OUT / (tag + '-preflight.d')
    result = run([*compiler, *flags, '-MM', '-MF', deps, unit])
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    dependencies[tag] = dependency_paths(deps)
    inputs.update(path for path in dependencies[tag] if not path.is_relative_to(OUT))
before = {str(path): digest(path.read_bytes()) for path in sorted(inputs)}
(OUT / 'inputs-before.json').write_text(json.dumps(before, indent=2) + '\n')
binary = OUT / 'runtime'
for tag, unit in [('fixture', HERE / 'fixture.cpp'), ('store', STORE)]:
    deps = OUT / (tag + '.d')
    compiled = run([*compiler, *flags, '-MMD', '-MF', deps, '-c', unit, '-o', OUT / (tag + '.o')])
    (OUT / (tag + '-compile.log')).write_text(compiled.stdout + compiled.stderr)
    if compiled.returncode:
        raise RuntimeError(compiled.stdout + compiled.stderr)
    if dependency_paths(deps) != dependencies[tag]:
        raise RuntimeError('actual MMD differs from preflight: ' + tag)
linked = run([*compiler, *flags, OUT / 'fixture.o', OUT / 'store.o', '-o', binary])
(OUT / 'link.log').write_text(linked.stdout + linked.stderr)
if linked.returncode:
    raise RuntimeError(linked.stdout + linked.stderr)
unknown = run([binary, 'unknown_case'], timeout=10)
if unknown.returncode != 1 or 'FAIL oracle=known_case case=unknown_case' not in unknown.stdout:
    raise RuntimeError('the harness must reject an unknown case at its named oracle')
sanitizer_control = None
if args.sanitizer == 'undefined':
    tripwire = run([binary, 'sanitizer_tripwire'], timeout=10)
    if tripwire.returncode == 0 or 'runtime error: signed integer overflow:' not in tripwire.stderr:
        raise RuntimeError('the signed-overflow tripwire must terminate under UBSan\n' + tripwire.stderr)
    sanitizer_control = {'returncode': tripwire.returncode, 'stdout': tripwire.stdout,
                         'stderr': tripwire.stderr}

cases = ['cohort_actual_slots', 'service_pins_across_ticks', 'protected_corrupt_sector',
         'protected_torn_sector', 'protected_read_failure', 'keeper_fence_outside_records',
         'inflight_sector_deferral', 'sequence_exhaustion', 'bad_data_readback', 'unreadable_data_readback',
         'accepted_program_error', 'late_revision_deferred_bytes', 'source_interleave',
         'consent_interleave', 'clock_interleave', 'core_cursor_control',
         'bounded_tick_budget', 'keeper_pending_cursor', 'keeper_combined_fences',
         'slow_reader_deadline', 'replay_budget', 'io_retry_repair',
         'partial_epoch_invalidation', 'partial_erase_invalidation', 'shutdown_budget',
         'independent_heater_eligibility', 'pending_source_reset', 'pending_consent_reset',
         'opaque_archive', 'legacy_method2_archive', 'latest_revision_replace',
         'shutdown_48_cells_best_effort', 'blocking_ack', 'blocking_failed',
         'blocking_deferred', 'blocking_invalidate', 'lost_scan_finish',
         'unrelated_erase_no_rewrite', 'unknown_mutation_no_rewrite', 'clock_negative_jitter',
         'rotation_progress', 'ghost_no_data', 'blocking_unknown_invalidate',
         'dispatcher_sources', 'dispatcher_future_note']
if args.case and set(args.case) - set(cases):
    parser.error('unknown --case')
results = []
for case in args.case or cases:
    result = run([binary, case], timeout=60)
    (OUT / (case + '.log')).write_text(result.stdout + result.stderr)
    print(result.stdout + result.stderr, end='', flush=True)
    results.append({'case': case, 'returncode': result.returncode,
                    'stdout': result.stdout, 'stderr': result.stderr})
    if result.returncode: break


def replace_one(text, pattern, replacement):
    changed, count = re.subn(pattern, replacement, text)
    if count != 1:
        raise RuntimeError('mutation needs one exact source anchor: ' + pattern)
    return changed


controls = []
if not args.case and all(not result['returncode'] for result in results):
    append_body = (OUT / 'body_8.hpp').read_text()
    prepare_body = (OUT / 'body_6.hpp').read_text()
    build_body = (OUT / 'body_7.hpp').read_text()
    service_body = (OUT / 'body_14.hpp').read_text()
    unpinned = replace_one(service_body,
        r'const\s+size_t\s+attempts\s*=\s*s_flash_heater_pinned\s*\?\s*1\s*:\s*kJournalServiceSources;',
        'const size_t attempts = kJournalServiceSources;')
    unpinned = replace_one(unpinned,
        r'const\s+size_t\s+src_i\s*=\s*s_flash_heater_pinned\s*\?\s*kHeaterContextSource\s*:\s*'
        r'\(s_flash_service_source \+ try_src\) % kJournalServiceSources;',
        'const size_t src_i = (s_flash_service_source + try_src) % kJournalServiceSources;')
    unpinned = replace_one(unpinned,
        r's_flash_service_source\s*=\s*s_flash_heater_pinned\s*\?\s*kHeaterContextSource\s*:\s*'
        r'\(src_i \+ 1\) % kJournalServiceSources;',
        's_flash_service_source = (src_i + 1) % kJournalServiceSources;')
    mutations = [
        ('omit_dispatch_future_log', 'body_13.hpp', replace_one((OUT / 'body_13.hpp').read_text(),
          r'if \(note.future\) flash_note_cursor_ahead\(src_i, note\);',
          '(void)note.future;'),
         'dispatcher_future_note',
         'actual wrapper reports rejected future cursor once after provider return'),
        ('dispatch_stop_as_core', 'body_13.hpp', replace_one((OUT / 'body_13.hpp').read_text(),
          r'if \(src_i == kStopObservationSource\) return flash_build_next_stop_observation\(r\);',
          'if (src_i == kStopObservationSource) { FutureCursorNote dummy; return flash_build_next_checkup_record(r, wait_ticks, dummy); }'),
         'dispatcher_sources', 'actual dispatcher selects the Stop provider only'),
        ('wrong_physical_ack_slot', 'body_8.hpp', replace_one(append_body,
          r'heater_context_flash_appended\(s_flash_heater_piece,\s*static_cast<uint16_t>\(slot\),\s*view\);',
          'heater_context_flash_appended(s_flash_heater_piece, static_cast<uint16_t>(logic::HISTORY_JOURNAL_SLOT_COUNT), view);'),
         'accepted_program_error', 'exact physical readback ACK releases only its matching claim'),
        ('bypass_keeper_guard', 'body_6.hpp', replace_one(prepare_body,
          r'heater_context_flash_erase_permission\(\s*flash_read_heater_context,\s*static_cast<uint16_t>\(slot\)\)',
          'HeaterContextErasePermission::Allowed'),
         'protected_corrupt_sector', 'damaged torn or unreadable guard yields one protected sector without a write'),
        ('omit_sequence_reservation', 'body_8.hpp', replace_one(append_body,
          r'if \(!logic::history_journal_sequence_reservable\(s_flash_next_sequence, 1\)\) \{\s*'
          r's_flash_seq_rejected = true;\s*return ESP_ERR_INVALID_STATE;\s*\}',
          '(void)s_flash_next_sequence;'),
         'sequence_exhaustion', 'exhausted sequence fails before slot preparation erase or program'),
        ('route_heater_to_legacy_core_ack', 'body_8.hpp', replace_one(append_body,
          r'else if \(logic::heater_cohort::kind\(verify\.header\) != logic::heater_cohort::Kind::Unknown \|\|\s*'
          r'logic::heater_independent::kind\(verify\.header\) !=\s*logic::heater_cohort::Kind::Unknown\)',
          'else if (false)'),
         'cohort_actual_slots', 'heater kinds never ACK or advance the legacy core cursor'),
        ('omit_service_pending_pinning', 'body_14.hpp', unpinned,
         'inflight_sector_deferral', 'false next with proof pending retains pin and sequence against ordinary writer'),
        ('repeat_progress_inside_writer', 'body_14.hpp', replace_one(service_body,
          r'if \(!flash_lk.acquired\(\)\) return 0;',
          'if (!flash_lk.acquired()) return 0;\n    flash_progress_heater_context();'),
         'bounded_tick_budget', 'zero-budget writer calls do not multiply archive progress'),
        ('release_false_next_pin', 'body_7.hpp', replace_one(build_body,
          r's_flash_heater_pinned\s*=\s*heater_context_flash_claim_pending\(\);',
          's_flash_heater_pinned = false;'),
         'inflight_sector_deferral', 'false next with proof pending retains pin and sequence against ordinary writer'),
        ('suppress_progress_while_pinned', 'body_15.hpp', replace_one((OUT / 'body_15.hpp').read_text(),
          r'heater_context_flash_service\(flash_read_heater_context, HEATER_CONTEXT_FLASH_MAX_READS\);',
          'if (!s_flash_heater_pinned) heater_context_flash_service(flash_read_heater_context, HEATER_CONTEXT_FLASH_MAX_READS);'),
         'inflight_sector_deferral', 'positive restore leaf progresses even while History is pinned'),
        ('wrong_ack_token', 'body_8.hpp', replace_one(append_body,
          r'heater_context_flash_appended\(s_flash_heater_piece,\s*static_cast<uint16_t>\(slot\),\s*view\);',
          'auto wrong = s_flash_heater_piece; ++wrong.token; heater_context_flash_appended(wrong, static_cast<uint16_t>(slot), view);'),
         'accepted_program_error', 'exact physical readback ACK releases only its matching claim'),
    ]
    store_source = STORE.read_text()
    for function, case, oracle in [
        ('heater_context_flash_appended', 'blocking_ack', 'ACK or failed callback waits through contention and settles exact claim'),
        ('heater_context_flash_failed', 'blocking_failed', 'ACK or failed callback waits through contention and settles exact claim'),
        ('heater_context_flash_deferred', 'blocking_deferred', 'deferred callback waits through owner contention instead of losing reservation'),
        ('heater_context_flash_index_invalidate', 'blocking_unknown_invalidate', 'failed erase generic invalidation waits through contention and withdraws proof'),
        ('heater_context_flash_sector_erased', 'blocking_invalidate', 'physical erase invalidation waits through contention and withdraws old proof'),
    ]:
        start = store_source.index('void ' + function + '(')
        end = store_source.index('\n}', start) + 2
        body = store_source[start:end]
        body = replace_one(body, r'SemGuard\s+lock\(s_mutex\);', 'SemGuard lock(s_mutex, 0);')
        mutations.append(('lose_contended_' + function, 'mutant-store.cpp',
                          store_source[:start] + body + store_source[end:], case, oracle))
    mutations.append(('lose_final_scan_finish_retry', 'mutant-store.cpp', replace_one(store_source,
        r'if \(s_scan.next == logic::HISTORY_JOURNAL_SLOT_COUNT\) \{\s*finish_scan_locked\(\);\s*break;\s*\}',
        '/* mutation: forget finalization retry before Reader */'),
        'lost_scan_finish', 'lost finish resumes without any out-of-range Reader'))
    mutations.append(('redate_accepted_clock_jitter', 'mutant-store.cpp', replace_one(store_source,
        r'if \(!s_anchored\)\s*s_offset\s*=', 'if (true) s_offset ='),
        'clock_negative_jitter',
        'accepted negative clock jitter still commits both complete atomic hour records'))
    start = store_source.index('void heater_context_flash_sector_erased(')
    end = store_source.index('\n}', start) + 2
    body = replace_one(store_source[start:end], r'    invalidate\(\);',
        '    invalidate();\n    for (auto& heater : s_cells)\n'
        '        for (auto& c : heater) if (c.state & BaseKnown) c.state |= Dirty;')
    mutations.append(('dirty_all_cells_after_known_erase', 'mutant-store.cpp',
        store_source[:start] + body + store_source[end:], 'rotation_progress',
        'real multi-sector rotation advances all40 distinct cells including youngest hours'))
    mutations.append(('wrong_successful_erase_sector', 'body_6.hpp', replace_one(prepare_body,
        r'heater_context_flash_sector_erased\(static_cast<uint16_t>\(slot\)\);',
        'heater_context_flash_sector_erased(0);'), 'unrelated_erase_no_rewrite',
        'unrelated actual sector erase never rewrites the48 unaffected durable cells'))
    start = store_source.index('void heater_context_flash_index_invalidate(')
    end = store_source.index('\n}', start) + 2
    body = replace_one(store_source[start:end], r'    invalidate\(\);',
        '    invalidate();\n    for (auto& heater : s_cells)\n'
        '        for (auto& c : heater) if (c.state & BaseKnown) c.state |= Dirty;')
    dirty_unknown = store_source[:start] + body + store_source[end:]
    mutations.append(('dirty_all_cells_after_unknown_mutation', 'mutant-store.cpp', dirty_unknown,
        'unknown_mutation_no_rewrite',
        'unchanged physical reproof does not dirty authoritative durable cells'))
    # Recreate both interacting defenses of the former empty-candidate bug: invent data
    # eligibility and dirty all materialized candidates after unknown mutation.
    ghost = replace_one(dirty_unknown,
        r'return c.samples \|\| c.readable_us \|\| c.unreadable_us;',
        '(void)c; return true;')
    mutations.append(('invent_empty_candidate_evidence', 'mutant-store.cpp', ghost,
        'ghost_no_data', 'real History writer never emits empty ghost Data after prefence reproof'))
    for tag, filename, contents, case, oracle in mutations:
        directory = OUT / tag
        directory.mkdir()
        for path in OUT.glob('*.hpp'):
            shutil.copy2(path, directory / path.name)
        (directory / filename).write_text(contents)
        mutant = directory / 'runtime'
        store_unit = directory / filename if filename == 'mutant-store.cpp' else STORE
        unit_tag = 'store' if filename == 'mutant-store.cpp' else 'fixture'
        unit = store_unit if unit_tag == 'store' else HERE / 'fixture.cpp'
        deps, obj = directory / 'actual.d', directory / 'actual.o'
        result = run([*compiler, '-I', directory, *flags, '-MMD', '-MF', deps, '-c', unit, '-o', obj])
        (directory / 'compile.log').write_text(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError('negative control did not compile: ' + tag + '\n' + result.stderr)
        actual_inputs = {path for path in dependency_paths(deps) if not path.is_relative_to(OUT)}
        if unit_tag == 'store': actual_inputs.add(STORE)
        expected_inputs = {path for path in dependencies[unit_tag] if not path.is_relative_to(OUT)}
        if actual_inputs != expected_inputs:
            raise RuntimeError('control changed current production include closure: ' + tag)
        other = OUT / ('fixture.o' if unit_tag == 'store' else 'store.o')
        result = run([*compiler, *flags, obj, other, '-o', mutant])
        (directory / 'link.log').write_text(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError('negative control did not link: ' + tag + '\n' + result.stderr)
        result = run([mutant, case], timeout=60)
        (directory / 'run.log').write_text(result.stdout + result.stderr)
        expected = 'FAIL oracle=' + oracle + ' case=' + case
        if result.returncode != 1 or expected not in result.stdout or 'runtime error:' in result.stderr:
            raise RuntimeError('negative control missed its behavioral oracle: ' + tag + '\n' +
                               result.stdout + result.stderr)
        controls.append({'name': tag, 'case': case, 'oracle': oracle,
                         'source_sha256': digest(contents.encode()), 'returncode': result.returncode,
                         'stdout': result.stdout, 'stderr': result.stderr})
        print('DETECTED', tag, result.stdout.strip(), flush=True)
after = {str(path): digest(path.read_bytes()) for path in sorted(inputs)}
unchanged = before == after and digest(HISTORY.read_bytes()) == digest(source.encode())
record = {'outcome': 'passed' if unchanged and all(not r['returncode'] for r in results) else 'failed',
          'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'sanitizer': args.sanitizer, 'inputs_unchanged': unchanged, 'input_sha256': after,
          'requested_cases': args.case, 'complete_case_inventory': not bool(args.case),
          'vacuity_control': {'returncode': unknown.returncode, 'stdout': unknown.stdout},
          'sanitizer_control': sanitizer_control, 'negative_controls': controls,
          'history_sha256': digest(source.encode()), 'extracted_bodies': extracted,
          'compiled_history_functions': len(signatures), 'actual_mmd_matches_preflight': True,
          'caller_contract': caller_contract,
          'compiler': run([*compiler, '--version']).stdout, 'commands': commands, 'cases': results,
          'claim_limits': ['Seventeen unchanged production History bodies and selected exact state declarations, not the full History TU.',
                           'The complete heater Store is a separate production translation unit; its pure codec/replay and header CRC are real.',
                           'Unrelated legacy builders/restore/manifest/Stop services are explicit recording ports, not certified implementations.',
                           'Four MiB host byte-array flash, 1-to-0 programs, erase, clock and mutex ports; no physical flash, RTOS timing, reboot or target stack proof.']}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
print('EVIDENCE', OUT / 'evidence.json')
if not unchanged: raise SystemExit('Source changed during the run')
raise SystemExit(any(result['returncode'] for result in results))
