"""Source/caller contracts for the separately journalled stop observations.

The rules are an exact reviewed inventory, not an inferred call graph. Body leases keep an
unmeasured branch/allocation from entering the named paths merely because its ENTRY still fits.
"""
from __future__ import annotations

import hashlib
import json
import re

from stop_observation_rules import SYMBOLS, UPDATED_LIMITS, PATHS, BODIES, HEADERS, CALLERS

EXTRA_SOURCES = tuple(HEADERS)
INLINED_INDEX_HELPERS = (
    'observation_identity_word', 'observation_index_note_loss', 'observation_index_incomplete',
    'flash_index_stop_observation_record', 'flash_journal_scan',
    'observation_append_owned',
    'history_journal_reserve_sequence',
)
TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|/\*.*?\*/|//[^\n]*', re.S)
DEFINITION = re.compile(r'\b([A-Za-z_]\w*)\s*\([^;{}]*?\)\s*(?:const\s*)?(?:noexcept\s*)?\{')
KEYWORDS = {'if', 'for', 'while', 'switch', 'catch', 'sizeof', 'alignof', 'decltype', 'static_assert'}


def masked(source):
    source = TOKEN.sub(lambda m: ' ' * len(m[0]), source)
    return re.sub(r'__attribute__\s*\(\([^()]*\)\)', lambda m: ' ' * len(m[0]), source)


def normalized(source):
    # Preserve literal bytes (including diagnostic format arguments), ignore comments/formatting.
    parts, at = [], 0
    for match in TOKEN.finditer(source):
        parts.append(re.sub(r'\s+', '', source[at:match.start()]))
        if not match[0].startswith(('//', '/*')):
            parts.append(match[0])
        at = match.end()
    parts.append(re.sub(r'\s+', '', source[at:]))
    return ''.join(parts)


def definitions(source):
    code = masked(source)
    spans = []
    for match in DEFINITION.finditer(code):
        if match[1] in KEYWORDS:
            continue
        depth, end = 1, match.end()
        while end < len(code) and depth:
            depth += (code[end] == '{') - (code[end] == '}')
            end += 1
        if depth:
            raise ValueError('unclosed source function ' + match[1])
        spans.append((match.start(1), match.end(), end, match[1]))
    return spans


def body(source, name, error=ValueError):
    matches = [span for span in definitions(source) if span[3] == name]
    if len(matches) != 1:
        raise error('stop observation source: expected one function body for ' + name)
    _, start, end, _ = matches[0]
    return source[start:end - 1]


def digest(source):
    code = TOKEN.sub(lambda m: ' ' if m[0].startswith(('//', '/*')) else m[0], source)
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_]\w*|'
                        r'\d+|<<=|>>=|->|::|&&|\|\||==|!=|<=|>=|\+\+|--|<<|>>|'
                        r'\+=|-=|\*=|/=|%=|&=|\|=|\^=|\.\.\.|[^\s]', code)
    return hashlib.sha256('\0'.join(tokens).encode()).hexdigest()


def caller_inventory(sources, names):
    result = {name: {} for name in names}
    # Headers can introduce inline callers or callback aliases too. Include every bare
    # reference, with the existing declarations counted explicitly, not only call syntax.
    search = re.compile(r'\b(' + '|'.join(map(re.escape, names)) + r')\b')
    for path, source in sources.items():
        if not path.endswith(('.cpp', '.hpp')):
            continue
        code = masked(source)
        spans = definitions(source)
        for match in search.finditer(code):
            owners = [span for span in spans if span[0] <= match.start() < span[2]]
            owner = min(owners, key=lambda span: span[0]) if owners else None
            label = '<declaration>' if owner is None else '<definition>' if match.start() == owner[0] else owner[3]
            key = path + ':' + label
            counts = result[match[1]]
            counts[key] = counts.get(key, 0) + 1
    return result


def validate_paths(budgets, error):
    for key, rule in SYMBOLS.items():
        if budgets['symbols'].get(key) != rule:
            raise error('stop observation frame: exact required symbol/cap changed: ' + key)
    for key, maximum in UPDATED_LIMITS.items():
        if budgets['symbols'].get(key, {}).get('max_bytes') != maximum:
            raise error('stop observation frame: reviewed measured limit changed: ' + key)
    if 'history_append_at' in budgets['symbols'] or any(
            'history_append_at' in path['symbols'] for path in budgets['paths'].values()):
        raise error('stop observation inlining: append_at cannot retain an invented outlined frame')
    monitored = {name for name, path in budgets['paths'].items()
                 if name in PATHS or '_stop_' in name or set(path['symbols']) & set(SYMBOLS)}
    if monitored != set(PATHS):
        raise error('stop observation paths: exact caller/branch inventory changed')
    for name, (owner, rule) in PATHS.items():
        if budgets['paths'].get(name) != rule:
            raise error('stop observation path: exact members/allowance/cap changed: ' + name)
        owners = [task for task, spec in budgets['tasks'].items() if name in spec['paths']]
        if owners != [owner]:
            raise error('stop observation path: exactly one reviewed task owner required: ' + name)


def shutdown_specs():
    return {name: (owner, rule['symbols'], rule['base_bytes'], rule['max_bytes'])
            for name, (owner, rule) in PATHS.items() if '_shutdown' in name}


def validate_sources(budgets, sources, error):
    validate_paths(budgets, error)
    missing = (set(HEADERS) | set(BODIES)) - set(sources)
    if missing:
        raise error('stop observation source: missing explicit sources ' + ', '.join(sorted(missing)))
    if any(re.search(r'__attribute__\s*\(\([^;]*\b(?:alias|ifunc)\s*\(',
                     TOKEN.sub(lambda m: ' ' if m[0].startswith(('//', '/*')) else m[0], text))
           for text in sources.values()):
        raise error('stop observation inlining: unreviewed first-party alias/ifunc')
    actual = caller_inventory(sources, tuple(CALLERS))
    if actual != CALLERS:
        changed = [name for name in CALLERS if actual[name] != CALLERS[name]]
        raise error('stop observation caller inventory changed: ' + ', '.join(changed))
    code = {path: re.sub(r'\s+', ' ', masked(text)) for path, text in sources.items()}
    history = sources['main/history.cpp']
    store = sources['main/stop_observation_store.cpp']
    if (not re.search(r'(?m)^ObservationHourlyPayload\s+s_flash_payload;', masked(store))
            or 'alignas(FlashJournalRecord)uint8_ts_flash_sector[logic::HISTORY_FLASH_ERASE_BYTES];'
            not in normalized(history)):
        raise error('stop observation scratch: single flash-owner payload/aligned sector changed')
    record = normalized(body(store, 'stop_observation_record', error))
    forget = normalized(body(store, 'stop_observation_forget', error))
    history_forget = normalized(body(history, 'history_flash_forget', error))
    if (not record.startswith('SemGuardlk(s_mutex);if(!lk||!s_enabled||!s_confirmed||s_sealed)return;')
            or 's_enabled=false;' not in forget or 's_confirmed=false;' not in forget
            or not history_forget.startswith('s_flash_forgotten.store(true);stop_observation_forget();')):
        raise error('stop observation button shortcut: forget/disabled admission changed')
    reader = normalized(body(history, 'flash_read_stop_observation', error))
    if (not reader.startswith('auto&record=*new(s_flash_sector)FlashJournalRecord;')
            or '!logic::observation_header_matches(record.header)' not in reader
            or 'record.header.crc!=logic::history_journal_crc_bytes(record.header,record.payload,logic::OBSERVATION_PAYLOAD_BYTES)' not in reader
            or 'std::memcpy(&payload,record.payload,sizeof(payload));' not in reader
            or not reader.endswith('returnlogic::observation_payload_valid(payload,bucket);')
            or 'flash_record_physically_valid' in reader):
        raise error('stop observation reader: exact header/CRC/copy/payload contract changed')
    restore = normalized(body(history, 'history_service_flash_restore', error))
    journal = normalized(body(history, 'history_flash_service_journal', error))
    callback = 'stop_observation_flash_service(flash_read_stop_observation);'
    positions = [restore.find('checkup_stop_context_expire('), restore.find('Lockflash_lk('),
                 restore.find(callback), restore.find('if(!flash_lk.acquired()'),
                 journal.find(callback), journal.find('if(!flash_lk.acquired()')]
    if (any(at < 0 for at in positions) or positions[0] > positions[1]
            or positions[2] < positions[3] or positions[4] < positions[5]
            or callback in normalized(body(history, 'flash_append_record_at', error))):
        raise error('stop observation flash owner: expiry/lock/append lifetime changed')
    service = normalized(body(store, 'stop_observation_flash_service', error))
    next_record = normalized(body(store, 'stop_observation_flash_next', error))
    admission = normalized(body(store, 'stop_observation_flash_index', error))
    incomplete = normalized(body(store, 'stop_observation_flash_index_incomplete', error))
    if ('observation_index_fence_sequence(s_index,identity)' not in service
            or 'observation_index_fence_sequence(s_index,payload.identity)' not in next_record
            or 'if(s_index.clipped_until_bucket==INT64_MAX)returnfalse;' not in next_record
            or 'stop_observation_flash_index_incomplete();' not in admission
            or incomplete != 'observation_index_incomplete(s_index);s_rebuild=true;'):
        raise error('stop observation fence: exact snapshot/admission/unknown-write guard changed')
    collector = normalized(body(sources['main/logic/stop_context_input.hpp'], 'stop_context_collect', error))
    if (collector.count('std::strtod(text,&end)') != 1
            or 'end!=text+row->value.size()' not in collector
            or 'row->value.size()!=1' not in collector
            or "row->value[0]=='1'" not in collector or "row->value[0]=='0'" not in collector
            or 'history_parse_tenths(' in collector):
        raise error('stop observation collector: canonical bits/full numeric token contract changed')
    if re.search(r'\b(?:alloca|__builtin_alloca)\s*\(', '\n'.join(sources[p] for p in HEADERS)):
        raise error('stop observation source: unreviewed dynamic stack allocation')
    # Explicit body leases cover the complete success/error branches, not only convenient calls.
    for path, functions in BODIES.items():
        for name, expected in functions.items():
            if digest(body(sources[path], name, error)) != expected:
                raise error(f'stop observation source body changed: {path}:{name}')
    for path, expected in HEADERS.items():
        if digest(sources[path]) != expected:
            raise error('stop observation source header changed: ' + path)


def validate_inlining(disassembly, error):
    exact = {re.sub(r'\\(.)', r'\1', rule['pattern'][1:-1]) for rule in SYMBOLS.values()}
    for name in re.findall(r'^\s*[0-9a-fA-F]+\s+<(.+)>:\s*$', disassembly, re.M):
        if ('flash_append_record_at(' in name or
                re.match(r'^_Z.*22flash_append_record_at', name)):
            raise error('stop observation inlining: newly outlined append_at requires frame/path review')
        if any(re.search(r'\b' + helper + r'\(', name) or
               re.match(r'^_Z.*' + str(len(helper)) + helper, name)
               for helper in INLINED_INDEX_HELPERS):
            raise error('stop observation inlining: newly outlined journal/index/scan helper needs frame/path review')
        if (re.match(r'^daik::logic::ObservationIndexEntry::(?:bucket|sequence|slot)\(', name)
                or re.match(r'^_ZNK4daik5logic21ObservationIndexEntry(?:6bucket|8sequence|4slot)E', name)):
            raise error('stop observation inlining: newly outlined index accessor needs frame/path review')
        if ((name.startswith('daik::logic::observation_index_') or
             re.match(r'^_Z.*\d+observation_index_', name)) and name not in exact):
            raise error('stop observation inlining: unreviewed outlined index function/clone')


def self_test(budgets, sources, error):
    validate_sources(budgets, sources, error)
    if 'main/http_handlers.hpp' not in sources:
        raise AssertionError('existing-header caller controls need the real loaded HTTP header')
    count = 0
    def reject(changed_budget=budgets, changed_source=sources):
        nonlocal count
        try:
            validate_sources(changed_budget, changed_source, error)
        except (error, ValueError) as exc:
            if 'stop observation' not in str(exc):
                raise
            count += 1
        else:
            raise AssertionError('accepted stop observation source/path regression')
    for key in SYMBOLS:
        altered = json.loads(json.dumps(budgets))
        del altered['symbols'][key]
        reject(altered)
    for name, (owner, _) in PATHS.items():
        for field in ('symbols', 'base_bytes', 'max_bytes', 'multipliers', 'owner'):
            altered = json.loads(json.dumps(budgets))
            rule = altered['paths'][name]
            if field == 'symbols': rule[field] = rule[field][:-1]
            elif field == 'multipliers': rule[field] = {rule['symbols'][0]: 2}
            elif field == 'owner': altered['tasks'][owner]['paths'].remove(name)
            else: rule[field] += 16
            reject(altered)
    for path in HEADERS:
        altered = dict(sources)
        altered[path] += '\ninline void unreviewed_stack() { alloca(external_bytes); }\n'
        reject(changed_source=altered)
    mutations = [
        ('main/new_task.cpp', '', 'void new_caller() { stop_observation_record(0, false, {}); }'),
        ('main/history.cpp', 'stop_observation_flash_service(flash_read_stop_observation);',
         'stop_observation_flash_service(other_reader);'),
        ('main/history.cpp', 'stop_observation_flash_next(flash_read_stop_observation, bucket, payload)',
         'stop_observation_flash_next(other_reader, bucket, payload)'),
        ('main/history.cpp', 'logic::OBSERVATION_PAYLOAD_BYTES)', 'sizeof(record.payload))'),
        ('main/stop_observation_store.cpp', 's_enabled         = false;', 's_enabled = true;'),
        ('main/stop_observation_store.cpp', '!lk || !s_enabled || !s_confirmed || s_sealed', '!lk || s_sealed'),
        ('main/checkup.cpp', 'logic::stop_context_collect(s_stop_inputs, v, n, rps_known, rps_running)',
         'logic::stop_context_collect(s_stop_inputs, other_rows, n, rps_known, rps_running)'),
        ('main/checkup.cpp', 'if (event.valid)', 'if (false)'),
        ('main/recovery_button.cpp', '? history_flash_forget() : false', '? true : false'),
        ('main/history.cpp', 'stop_observation_forget();', ''),
        ('main/new_alias.cpp', '', 'void fake() __attribute__((alias("_Z_stop_observation_record")));'),
        ('main/new_alias.cpp', '', 'void escape() { auto fn = &stop_observation_record; }'),
        ('main/new_alias.cpp', '', 'void escape() { auto p = &s_flash_payload; }'),
        ('main/http_handlers.hpp', '',
         'inline void new_header_caller() { stop_observation_record(0, false, {}); }'),
        ('main/logic/new_callback.hpp', '',
         'inline auto new_header_callback = &flash_read_stop_observation;'),
        ('main/http_handlers.hpp', '',
         'inline void new_header_alias() { auto fn = &stop_observation_record; }'),
        ('main/http_handlers.hpp', '',
         'inline bool new_sequence_caller(uint64_t& next) { return daik::logic::history_journal_reserve_sequence(next, next); }'),
        ('main/http_handlers.hpp', '',
         'inline auto new_sequence_callback = &daik::logic::history_journal_reserve_sequence;'),
        ('main/history.cpp',
         'logic::history_journal_reserve_sequence(s_flash_next_sequence, r.header.sequence)', 'true'),
        ('main/history.cpp',
         'if (!logic::history_journal_reserve_sequence(s_flash_next_sequence, r.header.sequence))\n'
         '        return ESP_ERR_INVALID_ARG;\n    esp_err_t e = flash_prepare_next_slot(slot);',
         'esp_err_t e = flash_prepare_next_slot(slot);\n'
         '    if (!logic::history_journal_reserve_sequence(s_flash_next_sequence, r.header.sequence))\n'
         '        return ESP_ERR_INVALID_ARG;'),
        ('main/logic/history_persist.hpp', 'next = next == UINT64_MAX ? 0 : next + 1;', 'next++;'),
        ('main/stop_observation_store.cpp', 'observation_index_fence_sequence(s_index, identity)', '0'),
        ('main/stop_observation_store.cpp', 'observation_index_fence_sequence(s_index, payload.identity)', '0'),
        ('main/stop_observation_store.cpp', 's_index.clipped_until_bucket == INT64_MAX', 'false'),
        ('main/stop_observation_store.cpp', 'stop_observation_flash_index_incomplete();', ''),
        ('main/logic/observation_hourly.hpp', 'if (sequence > (fence ? e.words[2] : e.sequence()))',
         'if (true)'),
        ('main/logic/observation_hourly.hpp', 'e.words[0] != a || e.words[1] != b', 'e.words[0] != a'),
        ('main/logic/stop_context_input.hpp', 'row->value.size() != 1', 'row->value.size() < 1'),
        ('main/logic/stop_context_input.hpp', 'end != text + row->value.size()', 'false'),
        ('main/logic/stop_context_input.hpp', 'end != text + row->value.size()',
         'end != text + std::strlen(text)'),
    ]
    for path, before, after in mutations:
        altered = dict(sources)
        if before:
            if before not in altered[path]:
                raise AssertionError('missing stop observation mutation anchor ' + before)
            altered[path] = altered[path].replace(before, after, 1)
        else:
            altered[path] = altered.get(path, '') + '\n' + after
        reject(changed_source=altered)
    for name in ('daik::(anonymous namespace)::flash_append_record_at(x)',
                 '_ZN4daik12_GLOBAL__N_1L22flash_append_record_atEclone$constprop$0'):
        try:
            validate_inlining('100 <' + name + '>:\n100: 004136 entry a1, 32\n', error)
        except error:
            count += 1
        else:
            raise AssertionError('accepted newly outlined append_at')
    for name in [
            candidate for helper in INLINED_INDEX_HELPERS
            for candidate in ('daik::logic::' + helper + '(x)', '_Z' + str(len(helper)) + helper + 'Eclone')
    ] + [
            'daik::logic::ObservationIndexEntry::' + method + '() const'
            for method in ('bucket', 'sequence', 'slot')
    ] + [
            '_ZNK4daik5logic21ObservationIndexEntry' + str(len(method)) + method + 'Ev'
            for method in ('bucket', 'sequence', 'slot')
    ] + ['daik::logic::observation_index_set(x) [clone .isra.9]',
         '_ZN4daik5logic21observation_index_setEclone$constprop$99']:
        try:
            validate_inlining('100 <' + name + '>:\n100: 004136 entry a1, 32\n', error)
        except error:
            count += 1
        else:
            raise AssertionError('accepted unmeasured outlined journal/index/scan helper ' + name)
    return count
