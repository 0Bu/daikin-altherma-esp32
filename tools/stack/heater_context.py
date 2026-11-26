"""Exact source, caller, scratch and indirect-output stack contracts for heaters.

No call graph is inferred and no arbitrary callx target is authorized. The final rules must bind
the actual integrated source and ELF; mechanics can be tested before that binding is available.
"""
from __future__ import annotations

from pathlib import Path
import re
import struct
import tempfile

import heater_context_rules as rules
import stop_observation as source_tools

EXTRA_SOURCES = rules.EXTRA_SOURCES
OUTPUT_NAME = ('daik::logic::detail::append_heater_context_json_impl('
               'daik::detail::JsonOutput&, daik::logic::HeaterContextPayloadFields const&, '
               'bool, int)')
OUTPUT_RAW = ('_ZN4daik5logic6detail31append_heater_context_json_implERNS_6detail10JsonOutputE'
              'RKNS0_26HeaterContextPayloadFieldsEbi')
FUNCTION = re.compile(r'^\s*([0-9a-fA-F]+)\s+<(.+)>:\s*$')
INSTRUCTION = re.compile(r'^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F]+)(?:\s+(.*))?$')
SECTION = re.compile(r'^Disassembly of section .+:$')


def require(condition, detail, error):
    if not condition:
        raise error('heater context ' + detail)


def _body(sources, path, name, error):
    try:
        return source_tools.body(sources[path], name, error)
    except (KeyError, ValueError) as exc:
        raise error('heater context source: missing/ambiguous body ' + path + ':' + name) from exc


def _code(sources, path, name, error):
    return source_tools.normalized(_body(sources, path, name, error))


def _reader_scopes(source, error):
    """A guard lives until its lexical brace closes; Reader calls must occur outside it."""
    for _, start, end, name in source_tools.definitions(source):
        text = source_tools.masked(source[start:end - 1])
        stack = [len(text)]
        ends = {}
        opened = []
        for at, char in enumerate(text):
            if char == '{':
                opened.append(at)
            elif char == '}' and opened:
                ends[opened.pop()] = at
        guarded = []
        for guard in re.finditer(r'\bSemGuard\s+\w+\s*\(\s*s_mutex\b', text):
            enclosing = [at for at, finish in ends.items() if at < guard.start() < finish]
            finish = ends[max(enclosing)] if enclosing else stack[0]
            guarded.append((guard.start(), finish))
        for call in re.finditer(r'\breader\s*\(', text):
            require(not any(begin < call.start() < finish for begin, finish in guarded),
                    'reader: Reader called while heater mutex is held in ' + name, error)


def validate_safety(sources, error):
    missing = set(EXTRA_SOURCES) - set(sources)
    require(not missing, 'source: missing explicit files ' + ', '.join(sorted(missing)), error)
    store = sources['main/heater_context_store.cpp']
    clean = source_tools.masked(store)
    normalized = source_tools.normalized(store)
    require(not re.search(r'\b(?:alloca|__builtin_alloca|malloc|calloc|realloc|new)\b|'
                          r'\bstd::(?:string|vector|map|function)\b|\bxSemaphore(?:Take|Give)\s*\(', clean),
            'scratch: allocating/dynamic/raw-lock owner code requires review', error)
    for declaration in rules.SCRATCH:
        require(normalized.count(declaration) == 1,
                'scratch: exact static owner declaration changed: ' + declaration, error)
    for _, start, end, name in source_tools.definitions(store):
        text = source_tools.masked(store[start:end - 1])
        require(not re.search(r'\b(?:CellMeta|HotCell|hd::Hour|hd::Totals|wh::Data|wh::Fence)\s+\w+\s*(?:\[|[;={])', text),
                'scratch: automatic aggregate in ' + name, error)
    _reader_scopes(store, error)
    require(not re.search(r'\b(?:checkup_\w+|hp_\w+|with_config|config_snapshot|'
                          r'history_flash_\w+)\s*\(', clean),
            'lock: reverse owner/config/HP call from Store', error)
    for name in rules.RECEIPTS:
        require(_code(sources, 'main/heater_context_store.cpp', name, error).startswith('SemGuardlock(s_mutex);'),
                'receipt: one-shot callback cannot lose its mutex acquisition: ' + name, error)
    next_record = _code(sources, 'main/heater_context_store.cpp', 'heater_context_flash_next', error)
    require(not re.search(r'\b(?:reader|materialize|rebuild_clean|heater_context_flash_service|'
                          r'heater_context_flash_scan_\w+)\(', next_record),
            'progress: hidden Reader/scan in next', error)
    service = _code(sources, 'main/heater_context_store.cpp', 'heater_context_flash_service', error)
    zero = service.find('if(!budget)return;')
    scan = service.find('heater_context_flash_scan_begin(')
    require(0 <= zero < scan, 'progress: zero-budget Reader boundary changed', error)
    require('n<256?n:256' in normalized and 'now-start>=5000' in normalized,
            'progress: 256-read / 5-ms slice contract changed', error)
    appended = _code(sources, 'main/heater_context_store.cpp', 'heater_context_flash_appended', error)
    require('piece_same(p)' in appended and 'claim_current()' in appended and
            'std::memcmp(v.payload,s_wire,p.bytes)' in appended and
            'v.header->sequence!=p.sequence' in appended and 'v.header->bucket!=p.bucket' in appended and
            's_hot[c.hot].mutation==s_claim_mutation' in appended,
            'receipt: immutable epoch/bucket/mutation/readback contract changed', error)
    progress = _code(sources, 'main/history.cpp', 'flash_progress_heater_context', error)
    require(progress == 'heater_context_flash_service(flash_read_heater_context,HEATER_CONTEXT_FLASH_MAX_READS);',
            'progress: sole positive-budget leaf changed', error)
    restore = _code(sources, 'main/history.cpp', 'history_service_flash_restore', error)
    require(restore.count('flash_progress_heater_context();') == 1 and
            0 <= restore.find('checkup_heater_context_expire();') < restore.find('Lockflash_lk('),
            'progress: unconditional tick/expiry ownership changed', error)
    history = source_tools.masked(sources['main/history.cpp'])
    calls = re.findall(r'\bheater_context_flash_service\s*\(([^;]+)\)\s*;', history)
    compact = [re.sub(r'\s+', '', call) for call in calls]
    require(compact.count('flash_read_heater_context,HEATER_CONTEXT_FLASH_MAX_READS') == 1 and
            all(call in ('flash_read_heater_context,HEATER_CONTEXT_FLASH_MAX_READS',
                         'flash_read_heater_context,0') for call in compact),
            'progress: unreviewed positive budget or Reader callback', error)
    shutdown = _code(sources, 'main/history.cpp', 'history_flash_save', error)
    require('history_flash_service_journal(12,pdMS_TO_TICKS(200),true)' in shutdown,
            'progress: bounded shutdown drain changed', error)
    history_code = source_tools.normalized(sources['main/history.cpp'])
    require('[[gnu::always_inline]]inlineboolflash_build_for_service(' in history_code and
            '[[gnu::noinline]]boolflash_build_next_heater_context(' in history_code,
            'lifetime: separately measured build/log boundary changed', error)
    build = _code(sources, 'main/history.cpp', 'flash_build_for_service', error)
    require('diag_printf(' not in build and
            0 <= build.find('flash_build_next_checkup_record(') < build.find('flash_note_cursor_ahead(') and
            0 <= build.find('flash_build_next_record(') < build.find('flash_note_cursor_ahead('),
            'lifetime: payload build must return before future-cursor formatting', error)
    admission = _code(sources, 'main/checkup.cpp', 'record_heater_locked', error)
    require('!completed_sweep' in admission and 'sample_us<=s_heater_read_fence_us' in admission and
            'input::collect(s_heater_inputs,values,count,sweep)' in admission and
            'hp_poll_generation_matches(source_generation)' in admission and
            'input::still_current(s_heater_inputs,snapshot,current)' in admission,
            'admission: current owner/fresh completed-sweep fence changed', error)
    header = source_tools.normalized(sources['main/logic/json_output.hpp'])
    require('void*context;void(*append)(void*,std::string_view);' in header and
            'append(context,part);' in header and
            'return{&out,[](void*context,std::string_viewpart){' in header and
            'dst.append(part.data(),part.size());elsedst+=part;' in header,
            'sink: borrowed synchronous context/view adapter changed', error)
    factory = _code(sources, 'main/logic/json_output.hpp', 'json_output', error)
    require(not re.search(r'\b(?:new|alloca|std::string|std::function)\b', factory),
            'sink: allocating factory requires review', error)
    bridge = _code(sources, 'main/logic/heater_context_payload.hpp', 'append_heater_context_json', error)
    require(bridge == ('autosink=daik::detail::json_output(j);'
                       'detail::append_heater_context_json_impl(sink,f,flat,selected_heater);'),
            'sink: sole synchronous Heater production instantiation changed', error)
    status = _code(sources, 'main/http_status.cpp', 'append_status_json', error)
    require(status.count('append_heater_context_status(j,diag_effective);') == 1,
            'sink: HTTP Heater shared-output caller changed', error)
    http_heater = _code(sources, 'main/http_status.cpp', 'append_heater_context_status', error)
    require(http_heater.count('heater_context_payload(fields);') == 1 and
            'diag_effective!=DiagnosticsSource::Modbus' in http_heater and
            http_heater.find('checkup_heater_context_expire();') < http_heater.find('heater_context_payload(fields);') and
            http_heater.find('heater_context_payload(fields);') < http_heater.find('append_heater_context_json(') and
            'SemGuard' not in http_heater,
            'sink: one atomic snapshot, released before formatting: append_heater_context_status', error)
    mqtt_heater = _code(sources, 'main/mqtt_ha.cpp', 'publish_heater_context', error)
    require(mqtt_heater.count('heater_context_payload(fields);') == 1 and
            mqtt_heater.find('checkup_heater_context_expire();') < mqtt_heater.find('heater_context_payload(fields);') and
            mqtt_heater.find('heater_context_payload(fields);') < mqtt_heater.find('append_heater_context_json(') and
            'SemGuard' not in mqtt_heater,
            'sink: one atomic snapshot, released before formatting: publish_heater_context', error)


def asm_inventory(sources, error):
    """Do not let an assembly-name declaration hide a caller from the C++ token inventory."""
    result = {}
    for path, source in sources.items():
        code = source_tools.masked(source)
        require(not re.search(r'^\s*#\s*pragma\s+(?:weak|redefine_extname)\b', code, re.M),
                'caller: unreviewed symbol-alias pragma', error)
        values = []
        for match in re.finditer(r'\b(?:asm|__asm|__asm__)\b', code):
            begin = code.find('(', match.end())
            require(begin >= 0, 'caller: unclosed assembly declaration', error)
            depth, end = 1, begin + 1
            while end < len(code) and depth:
                depth += (code[end] == '(') - (code[end] == ')')
                end += 1
            require(not depth, 'caller: unclosed assembly declaration', error)
            values.append(source_tools.digest(source[match.start():end]))
        if values:
            result[path] = values
    return result


def _validate_leases(sources, digests, bodies, callers, error):
    require(bool(digests) and bool(bodies) and bool(callers), 'source: final leases/callers unavailable', error)
    for path, expected in digests.items():
        require(path in sources and source_tools.digest(sources[path]) == expected,
                'source: reviewed file changed: ' + path, error)
    for path, functions in bodies.items():
        for name, expected in functions.items():
            require(source_tools.digest(_body(sources, path, name, error)) == expected,
                    'source: reviewed body changed: ' + path + ':' + name, error)
    actual = source_tools.caller_inventory(sources, tuple(callers))
    changed = [name for name in callers if actual[name] != callers[name]]
    require(not changed, 'caller: reference/alias/header inventory changed: ' + ', '.join(changed), error)
    require(asm_inventory(sources, error) == rules.ASM_LEASES,
            'caller: assembly-name declaration/reference inventory changed', error)
    require(not any(re.search(r'__attribute__\s*\(\([^;]*\b(?:alias|ifunc)\s*\(',
                             source_tools.masked(source)) for source in sources.values()),
            'caller: unreviewed alias/ifunc', error)


def validate_paths(budgets, error):
    require(rules.FINALIZED and re.fullmatch(r'[0-9a-f]{64}', rules.FINAL_ELF_SHA256 or '') and
            re.fullmatch(r'[0-9a-f]{64}', rules.FINAL_MAP_SHA256 or '') and
            bool(rules.SYMBOLS) and bool(rules.PATHS) and bool(rules.DISPATCH) and
            bool(rules.CALLBACK_REFERENCES) and bool(rules.STORAGE) and
            len(rules.STORAGE) == 51 and sum(item.get('bytes', 0) for item in rules.STORAGE.values()) <= 4800 and
            all(item.get('owner') == 'heater_context_store.cpp' for item in rules.STORAGE.values()) and
            rules.SCHEMA_CHAIN == ('heater_profile_layout',) and isinstance(rules.PACKED_BRIDGES, dict),
            'binding: final integrated source/ELF/frame/path inventory is pending', error)
    require({key for key in budgets['symbols'] if key.startswith('heater_')} == set(rules.SYMBOLS),
            'frame: exact required inventory changed', error)
    for key, expected in rules.SYMBOLS.items():
        require(budgets['symbols'].get(key) == expected, 'frame: cap/pattern changed: ' + key, error)
    monitored = {key for key in budgets['paths'] if '_heater_' in key}
    require(monitored == set(rules.PATHS), 'path: exact branch inventory changed', error)
    for name, (owner, expected) in rules.PATHS.items():
        require(budgets['paths'].get(name) == expected, 'path: members/allowance/cap changed: ' + name, error)
        require([task for task, spec in budgets['tasks'].items() if name in spec['paths']] == [owner],
                'path: exactly one reviewed task owner required: ' + name, error)


def expand_budgets(budgets, error):
    """Expand the explicit reviewed variants once; never infer paths from the tested ELF."""
    for name, (owner, rule) in rules.PATHS.items():
        require(name not in budgets['paths'] and
                all(name not in task['paths'] for task in budgets['tasks'].values()),
                'path: generated branch collides with a JSON path/owner: ' + name, error)
        require(owner in budgets['tasks'] and set(rule['symbols']) <= set(budgets['symbols']),
                'path: generated branch has missing frames/owner: ' + name, error)
        budgets['paths'][name] = {**rule, 'symbols': list(rule['symbols']),
                                  'multipliers': dict(rule['multipliers'])}
        budgets['tasks'][owner]['paths'].append(name)
    return budgets


def validate_sources(budgets, sources, error):
    validate_paths(budgets, error)
    validate_safety(sources, error)
    _validate_leases(sources, rules.SOURCE_DIGESTS, rules.BODIES, rules.CALLERS, error)


def shutdown_specs():
    return {name: (owner, rule['symbols'], rule['base_bytes'], rule['max_bytes'])
            for name, (owner, rule) in rules.PATHS.items() if '_shutdown' in name}


def mutation_path_names():
    """One longest measured branch per explicit caller; production still checks every leaf."""
    names = set()
    for owner, label, _prefix, branch, _cap in rules.ENTRANCES:
        chains = rules.BRANCHES[branch]
        at = max(range(len(chains)), key=lambda index: sum(rules.SYMBOLS[key]['max_bytes'] for key in chains[index]))
        names.add(owner + '_heater_' + label + f'_{at:02d}')
    return names


def integer64_callers():
    return dict(rules.INTEGER64_CALLERS)


def fixture_dispatch(disassembly):
    """Structural self-test fixture only; real frames/dispatch always come from the final ELF."""
    lines = disassembly.splitlines(keepends=True)
    blocks = []
    for start, line in enumerate(lines):
        if (match := FUNCTION.match(line)):
            end = next((at for at in range(start + 1, len(lines))
                        if FUNCTION.match(lines[at]) or SECTION.match(lines[at])), len(lines))
            blocks.append((start, end, match[2], int(match[1], 16)))
    for start, end, name, address in reversed(blocks):
        body = lines[start + 1:end]
        if name in rules.DISPATCH:
            first = next(line for line in body if INSTRUCTION.match(line))
            body = [first]
            staged, indirect = {}, iter(rules.INDIRECT_SITES.get(name, []))
            for position, (opcode, target) in zip(rules.CALL_OFFSETS[name], rules.DISPATCH[name], strict=True):
                if opcode.startswith('callx'):
                    following = next(indirect)
                else:
                    following = [opcode + ' 1000 <' + target + '>']
                for at, instruction in enumerate(following, position - len(following) + 1):
                    require(at not in staged or staged[at] == instruction,
                            'self-test: incompatible actual instruction windows', AssertionError)
                    staged[at] = instruction
            instructions = [staged.get(at, 'nop') for at in range(max(staged, default=0) + 1)]
            for index, instruction in enumerate(instructions[1:], 1):
                # l32r contexts are stored without relocatable literal-pool addresses.
                instruction = re.sub(r'^(l32r a\d+), <(.+)>$', r'\1, 1000 <literal> (1000 <\2>)', instruction)
                body.append(f'{address + 3 + 3 * index:x}: 0008e0 {instruction}\n')
        for target, callers in rules.CALLBACK_REFERENCES.items():
            if name not in callers:
                continue
            present = sum('<' + target + '>' in line for line in body)
            for index in range(callers[name] - present):
                body.append(f'{address + 0x80 + index * 3:x}: 000081 l32r a8, 1000 <literal> (1000 <{target}>)\n')
        lines[start + 1:end] = body
    return ''.join(lines)


def _instructions(disassembly):
    blocks, current = {}, None
    for line in disassembly.splitlines():
        match = FUNCTION.match(line)
        if match:
            current = match[2]
            if current in blocks:
                current = None  # Canonical required-symbol parser owns duplicate rejection.
            else:
                blocks[current] = []
        elif current is not None and (match := INSTRUCTION.match(line)):
            blocks[current].append((match[3] or '').strip())
    return blocks


def _calls(instructions):
    calls = []
    for text in instructions:
        direct = re.fullmatch(r'(call\d+)\s+[0-9a-f]+\s+<(.+)>', text)
        indirect = re.fullmatch(r'(callx\d+)\s+(a\d+)', text)
        if direct:
            calls.append([direct[1], direct[2]])
        elif indirect:
            calls.append([indirect[1], indirect[2]])
        elif re.match(r'call', text):
            calls.append(['UNREVIEWED', text])
    return calls


def _indirect_sites(instructions):
    """Bind the actual register setup at every indirect continuation, not only callx's register."""
    result = []
    for at, text in enumerate(instructions):
        if not re.match(r'callx\d+\s', text):
            continue
        context = []
        for instruction in instructions[max(1, at - 3):at + 1]:
            if instruction.startswith('l32r'):
                literal = re.search(r'\(([0-9a-f]+) <(.+)>\)$', instruction)
                instruction = instruction.split(',')[0] + ', <' + (literal[2] if literal else 'UNRESOLVED') + '>'
            else:
                instruction = re.sub(r'[0-9a-f]+ <(.+)>', r'1000 <\1>', instruction)
            context.append(re.sub(r'\s+', ' ', instruction))
        result.append(context)
    return result


def validate_dispatch(disassembly, dispatch, error):
    blocks = _instructions(disassembly)
    for name, expected in dispatch.items():
        require(name in blocks and _calls(blocks[name]) == expected,
                'sink: exact direct/indirect continuation changed: ' + name, error)
    def exact_name(pattern):
        pattern = re.sub(r'\\x([0-9a-fA-F]{2})', lambda match: chr(int(match[1], 16)), pattern)
        return re.sub(r'\\(.)', r'\1', pattern[1:-1])
    expected_names = {exact_name(rule['pattern']) for rule in
                      (*rules.SYMBOLS.values(), *source_tools.SYMBOLS.values())}
    for name in blocks:
        if any(re.search(r'\b' + re.escape(helper) + r'\(', name) or
               re.match(r'^_Z.*' + str(len(helper)) + re.escape(helper), name)
               for helper in rules.INLINED):
            require(name in expected_names, 'inlining: newly outlined helper requires review: ' + name, error)
        if ('append_heater_context_json<' in name or 'append_heater_context_json_impl' in name or
                'append_heater_context_status' in name or 'json_output<' in name or
                name.startswith('daik::detail::JsonOutput')):
            require(name in expected_names, 'sink: unreviewed instantiation/clone/adapter: ' + name, error)
    return blocks


def validate_callback_references(blocks, references, error):
    """Bind adapter/Reader function-pointer literals to their exact reviewed caller inventory."""
    actual = {target: {} for target in references}
    literal_start = re.compile(r'\([0-9a-f]+ <')
    for name, instructions in blocks.items():
        for instruction in instructions:
            if '<' not in instruction:
                continue
            found = set()
            literal = literal_start.search(instruction)
            prefix = instruction[:literal.start()] if literal else instruction
            if '<' in prefix and '>' in prefix:
                found.add(prefix[prefix.index('<') + 1:prefix.rindex('>')])
            if literal and instruction.endswith('>)'):
                found.add(instruction[literal.end():-2])
            for target in found & references.keys():
                callers = actual[target]
                callers[name] = callers.get(name, 0) + 1
    for target, expected in references.items():
        require(actual[target] == expected,
                'sink: callback/pointer reference inventory changed: ' + target, error)


def validate_inlining(disassembly, error):
    # Missing final rules fail in validate_paths; never invent a packed first-frame allowance.
    if rules.DISPATCH:
        blocks = validate_dispatch(disassembly, rules.DISPATCH, error)
        validate_callback_references(blocks, rules.CALLBACK_REFERENCES, error)
        for name, expected in rules.INDIRECT_SITES.items():
            require(name in blocks and _indirect_sites(blocks[name]) == expected,
                    'sink: exact indirect register/literal setup changed: ' + name, error)


def _bounded(data, offset, length, error):
    if offset < 0 or length < 0 or offset + length > len(data):
        raise error('heater context storage: truncated ELF range')
    return data[offset:offset + length]


def _elf_metadata(data, error):
    if len(data) < 52 or data[:7] != b'\x7fELF\x01\x01\x01':
        raise error('heater context storage: ELF32 little-endian image is required')
    header = struct.unpack('<16sHHIIIIIHHHHHH', _bounded(data, 0, 52, error))
    if (header[1:4] != (2, 94, 1) or header[8] != 52 or header[11] != 40 or
            not header[12] or header[13] >= header[12]):
        raise error('heater context storage: unsupported Xtensa executable ELF header')
    sections = list(struct.iter_unpack('<IIIIIIIIII', _bounded(data, header[6], 40 * header[12], error)))
    def strtab(index):
        if index >= len(sections) or sections[index][1] != 3:
            raise error('heater context storage: missing ELF string table')
        return _bounded(data, sections[index][4], sections[index][5], error)
    def zstr(table, offset):
        if offset >= len(table) or (end := table.find(b'\0', offset)) < 0:
            raise error('heater context storage: unterminated ELF string')
        return table[offset:end].decode('utf-8', 'replace')
    names = strtab(header[13])
    symbols = {}
    for section in sections:
        if section[1] != 2:
            continue
        if section[9] != 16 or section[5] % 16:
            raise error('heater context storage: malformed ELF symbol table')
        strings = strtab(section[6])
        owner = None
        for name_off, value, size, info, other, shndx in struct.iter_unpack(
                '<IIIBBH', _bounded(data, section[4], section[5], error)):
            name = zstr(strings, name_off)
            if info == 0x04 and other == 0 and shndx == 0xfff1:
                owner = name
            if name:
                symbols.setdefault(name, []).append((value, size, info, other, shndx, owner))
    return sections, names, symbols, zstr


def validate_storage(data, error, storage=None):
    """Verify static Heater scratch against the real ELF symbol table."""
    storage = rules.STORAGE if storage is None else storage
    if not storage:
        return  # Missing final rules fail in validate_paths.
    sections, names, symbols, zstr = _elf_metadata(data, error)
    ranges = []
    for name, expected in storage.items():
        require(isinstance(expected, dict) and set(expected) <= {'bytes', 'alignment', 'owner'} and
                {'bytes', 'alignment'} <= set(expected) and
                isinstance(expected['bytes'], int) and not isinstance(expected['bytes'], bool) and
                1 <= expected['bytes'] <= 9216 and expected['alignment'] in (1, 2, 4, 8, 16),
                'storage: invalid static contract: ' + name, error)
        owner = expected.get('owner')
        if owner is not None:
            require(isinstance(owner, str) and re.fullmatch(r'[A-Za-z0-9_.-]+\.cpp', owner),
                    'storage: invalid file owner: ' + name, error)
        found = symbols.get(name, [])
        if owner is not None:
            require(len(symbols.get(owner, [])) == 1 and symbols[owner][0][2:5] == (0x04, 0, 0xfff1),
                    'storage: ambiguous or missing file owner: ' + owner, error)
            found = [item for item in found if item[5] == owner]
        require(len(found) == 1, 'storage: missing or aliased owner scratch symbol: ' + name, error)
        value, size, info, _other, shndx, _owner = found[0]
        require((info >> 4) == 0 and (info & 0xf) in (0, 1) and shndx < len(sections),
                'storage: non-local or unmapped scratch object: ' + name, error)
        section = sections[shndx]
        section_name = zstr(names, section[0])
        require(section[1] in (1, 8) and (section[2] & 3) == 3 and not (section[2] & 4) and
                'noinit' not in section_name and size == expected['bytes'] and
                value % expected['alignment'] == 0 and
                section[3] <= value and value + size <= section[3] + section[5],
                'storage: unreviewed scratch size/alignment/section: ' + name, error)
        ranges.append((value, value + size, name))
    ranges.sort()
    for first, second in zip(ranges, ranges[1:]):
        require(first[1] <= second[0], f'storage: overlapping scratch {first[2]} and {second[2]}', error)


def _function_code(data, nm_text, address, error, raw_name=OUTPUT_RAW):
    matches = [line.split() for line in nm_text.splitlines() if line.split() and line.split()[-1] == raw_name]
    require(len(matches) == 1 and len(matches[0]) == 4 and matches[0][2] == 'T' and
            all(re.fullmatch(r'[0-9a-fA-F]+', value) for value in matches[0][:2]),
            'packed output: exactly one global nm function required', error)
    start, size = (int(value, 16) for value in matches[0][:2])
    require(start == address and 4 <= size <= 256,
            'packed output: nm disagrees with bridge address/size', error)
    sections, names, symbols, zstr = _elf_metadata(data, error)
    found = symbols.get(raw_name, [])
    require(len(found) == 1 and found[0][:4] == (start, size, 0x12, 0) and found[0][4] < len(sections),
            'packed output: nm disagrees with global ELF function symbol', error)
    section = sections[found[0][4]]
    require(section[1] == 1 and (section[2] & 6) == 6 and
            zstr(names, section[0]) in ('.text', '.flash.text', '.iram0.text') and
            section[3] <= start and start + size <= section[3] + section[5],
            'packed output: bridge escapes executable section', error)
    code = _bounded(data, section[4] + start - section[3], size, error)
    require((int.from_bytes(code[:3], 'little') & 0xfff) == 0x136,
            'packed output: missing Xtensa ENTRY opcode', error)
    return code


def _restore_one_output(disassembly, data, elf, objdump, tool_output, raw_body, error,
                        output_name, output_raw):
    """Decode one explicitly named global bridge, never only its packed ENTRY word."""
    lines = disassembly.splitlines(keepends=True)
    starts = [(at, match) for at, line in enumerate(lines)
              if (match := FUNCTION.match(line)) and match[2] == output_name]
    require(len(starts) <= 1, 'packed output: duplicate bridge symbol', error)
    if not starts:
        return disassembly  # Required symbol inventory reports absence.
    start, match = starts[0]
    end = next((at for at in range(start + 1, len(lines))
                if FUNCTION.match(lines[at]) or SECTION.match(lines[at])), len(lines))
    address = int(match[1], 16)
    require(objdump.endswith('objdump'), 'packed output: cannot bind nm to objdump', error)
    nm = tool_output([objdump[:-len('objdump')] + 'nm', '-n', '-S', '--defined-only', str(elf)])
    code = _function_code(data, nm, address, error, output_raw)
    first = next((INSTRUCTION.match(line) for line in lines[start + 1:end] if INSTRUCTION.match(line)), None)
    require(first is not None and int(first[1], 16) == address,
            'packed output: first instruction not at exact entry', error)
    word = int(first[2], 16)
    mnemonic = (first[3] or '').strip()
    packed = re.fullmatch(r'\.word\s+0x([0-9a-fA-F]{8})', mnemonic)
    entry = re.fullmatch(r'entry\s+a1,\s*(0x[0-9a-fA-F]+|[0-9]+)', mnemonic)
    require((len(first[2]) == 8 and word == int.from_bytes(code[:4], 'little') and
             (not mnemonic or packed and int(packed[1], 16) == word)) or
            (len(first[2]) == 6 and entry and
             int(entry[1], 0) == (int.from_bytes(code[:3], 'little') >> 12) * 8 and
             word in (int.from_bytes(code[:3], 'little'), int.from_bytes(code[:3], 'big'))),
            'packed output: first bytes disagree with ELF', error)
    if end < len(lines) and (following := FUNCTION.match(lines[end])):
        require(int(following[1], 16) >= address + len(code), 'packed output: overlapping nested symbol', error)
    with tempfile.TemporaryDirectory(prefix='daikin-stack-heater-output-') as temporary:
        raw = Path(temporary) / 'output.raw'
        raw.write_bytes(code)
        decoded = tool_output([objdump, '-D', '-b', 'binary', '-m', 'xtensa',
                               f'--adjust-vma=0x{address:x}', str(raw)])
        replacement = raw_body(decoded, address, code)
    first_line, newline, body = replacement.partition('\n')
    require(first_line == f'{address:08x} <daik::hp_detect_run()>:' and newline,
            'packed output: full body decoder identity changed', error)
    require(not any(re.match(r'movsp\s+a1,', (instruction[3] or '').strip())
                    for line in body.splitlines() if (instruction := INSTRUCTION.match(line))),
            'packed output: dynamic stack adjustment', error)
    # Raw binary disassembly has no ELF symbol table. Recover only exact direct targets from
    # the original symbol headers, so a nameless call cannot evade the output dispatch lease.
    targets = {}
    for line in lines:
        if (target := FUNCTION.match(line)):
            targets.setdefault(int(target[1], 16), set()).add(target[2])
    def resolve(match):
        target = int(match[2], 16)
        if address <= target < address + len(code):
            return match[0]
        names = targets.get(target, set())
        require(len(names) == 1, f'packed output: unresolved/ambiguous direct target 0x{target:x}', error)
        return match[1] + f'{target:x}' + ' <' + next(iter(names)) + '>'
    body = re.sub(r'((?:call[0-9]+|j)\s+)((?:0x)?[0-9a-f]+)(?:\s+<[^\n]*>)?', resolve, body)
    lines[start:end] = [f'{address:08x} <{output_name}>:\n' + body]
    return ''.join(lines)


def restore_packed_output(disassembly, data, elf, objdump, tool_output, raw_body, error):
    for name, raw in rules.PACKED_BRIDGES.items():
        disassembly = _restore_one_output(disassembly, data, elf, objdump, tool_output,
                                          raw_body, error, name, raw)
    return disassembly


def packed_self_test(error, raw_body):
    """Reject incomplete/global-symbol/body substitutions without a packed-word shortcut."""
    address = 0x42001000
    code = bytes.fromhex('3661001df0')  # Fixed ENTRY48 + RETW.N.
    def image(raw_name=OUTPUT_RAW, info=0x12, other=0, flags=6, value=address, size=len(code), alias=False,
              file_owner=None, duplicate_owner=False, section_name='.flash.text'):
        data = bytearray(52)
        def append(value):
            data.extend(b'\0' * (-len(data) % 4))
            offset = len(data)
            data.extend(value)
            return offset
        text = append(code)
        names = b'\0' + raw_name.encode() + b'\0'
        text_name_offset = len(names)
        names += section_name.encode() + b'\0'
        alias_offset = len(names)
        if alias:
            names += (OUTPUT_RAW + '_alias').encode() + b'\0'
        owner_offset = len(names)
        if file_owner is not None:
            names += file_owner.encode() + b'\0'
        strings = append(names)
        symbols = bytes(16)
        if file_owner is not None:
            marker = struct.pack('<IIIBBH', owner_offset, 0, 0, 0x04, 0, 0xfff1)
            symbols += marker * (2 if duplicate_owner else 1)
        symbols += struct.pack('<IIIBBH', 1, value, size, info, other, 1)
        if alias:
            symbols += struct.pack('<IIIBBH', alias_offset, value, size, 1, 0, 1)
        symtab = append(symbols)
        sections = [
            (0,) * 10,
            (text_name_offset, 1, flags, address, text, len(code), 0, 0, 4, 0),
            (0, 2, 0, 0, symtab, len(symbols), 3, 0, 4, 16),
            (0, 3, 0, 0, strings, len(names), 0, 0, 1, 0),
        ]
        table = append(b''.join(struct.pack('<IIIIIIIIII', *section) for section in sections))
        data[:52] = struct.pack('<16sHHIIIIIHHHHHH', b'\x7fELF\x01\x01\x01' + bytes(9),
                                2, 94, 1, address, 0, table, 0, 52, 0, 0, 40, 4, 3)
        return bytes(data)
    nm = f'{address:08x} {len(code):08x} T {OUTPUT_RAW}\n'
    standard = (f'Disassembly of section .flash.text:\n{address:08x} <{OUTPUT_NAME}>:\n'
                f'{address:x}: 1d006136 .word 0x1d006136\n{address + 4:x}: f0 .byte 0xf0\n')
    decoded = (f'Disassembly of section .data:\n{address:08x} <.data>:\n'
               f'{address:x}: 366100 entry a1, 48\n{address + 3:x}: 1df0 retw.n\n')
    def run(data=image(), listing=standard, names=nm, raw=decoded, decoder=raw_body):
        calls = []
        def tool(arguments):
            calls.append(arguments)
            if arguments[0].endswith('nm'):
                return names
            require(Path(arguments[-1]).read_bytes() == code,
                    'self-test: exact extracted bytes changed', AssertionError)
            return raw
        result = _restore_one_output(listing, data, Path('/fixture.elf'),
                                     'xtensa-esp32s3-elf-objdump', tool, decoder, error,
                                     OUTPUT_NAME, OUTPUT_RAW)
        return result, calls
    result, calls = run()
    require('entry a1, 48' in result and len(calls) == 2,
            'self-test: full bridge decoding did not run', AssertionError)
    count = 0
    def reject(label, expected, **arguments):
        nonlocal count
        try:
            run(**arguments)
        except error as exc:
            require(expected in str(exc), 'self-test: wrong rejection for ' + label, AssertionError)
            count += 1
        else:
            raise AssertionError('accepted packed Heater bridge regression: ' + label)
    reject('missing nm', 'exactly one global nm', names='')
    reject('duplicate nm', 'exactly one global nm', names=nm + nm)
    reject('local nm', 'exactly one global nm', names=nm.replace(' T ', ' t '))
    reject('wrong ELF name', 'global ELF function', data=image(raw_name=OUTPUT_RAW + '$isra$0'))
    reject('local ELF symbol', 'global ELF function', data=image(info=0x02))
    reject('hidden ELF symbol', 'global ELF function', data=image(other=2))
    reject('wrong ELF entry', 'global ELF function', data=image(value=address + 1))
    reject('wrong ELF extent', 'global ELF function', data=image(size=len(code) - 1))
    reject('nonexecutable section', 'executable section', data=image(flags=2))
    reject('truncated ELF', 'truncated ELF', data=image()[:-1])
    reject('wrong printed first address', 'first instruction not at exact entry',
           listing=standard.replace(f'{address:x}:', f'{address + 1:x}:', 1))
    reject('wrong printed first bytes', 'first bytes disagree',
           listing=standard.replace('1d006136', '1d006137'))
    reject('wrong printed mnemonic', 'first bytes disagree',
           listing=standard.replace('.word 0x1d006136', 'addi a1, a1, 16'))
    reject('duplicate output', 'duplicate bridge', listing=standard + standard)
    reject('partial raw body', 'complete function', raw=decoded.rsplit('\n', 2)[0] + '\n')
    reject('wrong raw identity', 'raw function entry', raw=decoded.replace('<.data>', '<unreviewed>'))
    reject('dynamic stack', 'dynamic stack adjustment', decoder=lambda *_:
           f'{address:08x} <daik::hp_detect_run()>:\n{address:x}: 366100 entry a1, 48\n'
           f'{address + 3:x}: 000000 movsp a1, a8\n')
    storage = {OUTPUT_RAW: {'bytes': len(code), 'alignment': 1}}
    validate_storage(image(info=0x01, flags=3), error, storage)
    for label, data, contract in (
        ('missing object', image(raw_name=OUTPUT_RAW + '_missing', info=1, flags=3), storage),
        ('global object', image(info=0x11, flags=3), storage),
        ('executable object', image(info=1, flags=7), storage),
        ('read-only object', image(info=1, flags=2), storage),
        ('wrong object size', image(info=1, flags=3), {OUTPUT_RAW: {'bytes': 6, 'alignment': 1}}),
        ('wrong object alignment', image(info=1, flags=3, value=address + 1),
         {OUTPUT_RAW: {'bytes': 5, 'alignment': 8}}),
        ('overlapping owner scratch', image(info=1, flags=3, alias=True),
         {**storage, OUTPUT_RAW + '_alias': {'bytes': 5, 'alignment': 1}}),
        ('invalid object rule', image(info=1, flags=3), {OUTPUT_RAW: {'bytes': 5, 'alignment': 0}}),
        ('missing file owner', image(info=1, flags=3),
         {OUTPUT_RAW: {'bytes': 5, 'alignment': 1, 'owner': 'fixture.cpp'}}),
        ('wrong file owner', image(info=1, flags=3, file_owner='other.cpp'),
         {OUTPUT_RAW: {'bytes': 5, 'alignment': 1, 'owner': 'fixture.cpp'}}),
        ('duplicate file owner', image(info=1, flags=3, file_owner='fixture.cpp', duplicate_owner=True),
         {OUTPUT_RAW: {'bytes': 5, 'alignment': 1, 'owner': 'fixture.cpp'}}),
        ('unbounded file owner rule', image(info=1, flags=3, file_owner='fixture.cpp'),
         {OUTPUT_RAW: {'bytes': 5, 'alignment': 1, 'owner': '../fixture.cpp'}}),
    ):
        try:
            validate_storage(data, error, contract)
        except error as exc:
            require('storage:' in str(exc), 'self-test: unrelated storage failure ' + label, AssertionError)
            count += 1
        else:
            raise AssertionError('accepted Heater storage regression: ' + label)
    validate_storage(image(info=1, flags=3, file_owner='fixture.cpp'), error,
                     {OUTPUT_RAW: {'bytes': 5, 'alignment': 1, 'owner': 'fixture.cpp'}})
    return count


def mechanical_self_test(budgets, listing, error):
    """Reject omissions, wrong owners and altered real output dispatch independently of leases."""
    validate_paths(budgets, error)
    validate_inlining(listing, error)
    count = 0
    def reject(action, expected):
        nonlocal count
        try:
            action()
        except error as exc:
            require(expected in str(exc), 'self-test: wrong mechanical rejection: ' + str(exc), AssertionError)
            count += 1
        else:
            raise AssertionError('accepted Heater path/dispatch regression: ' + expected)
    name, (owner, rule) = next(iter(rules.PATHS.items()))
    for field in ('missing', 'symbols', 'base_bytes', 'max_bytes', 'multipliers'):
        changed = {**budgets, 'paths': dict(budgets['paths'])}
        if field == 'missing':
            del changed['paths'][name]
        else:
            changed['paths'][name] = dict(rule)
            if field == 'symbols': changed['paths'][name][field] = rule[field][:-1]
            elif field == 'multipliers': changed['paths'][name][field] = {rule['symbols'][0]: 2}
            else: changed['paths'][name][field] += 16
        reject(lambda: validate_paths(changed, error), 'heater context path:')
    changed = {**budgets, 'tasks': dict(budgets['tasks'])}
    changed['tasks'][owner] = {**budgets['tasks'][owner],
                              'paths': [value for value in budgets['tasks'][owner]['paths'] if value != name]}
    reject(lambda: validate_paths(changed, error), 'exactly one reviewed task owner')
    frame = next(iter(rules.SYMBOLS))
    changed = {**budgets, 'symbols': dict(budgets['symbols'])}
    changed['symbols'][frame] = {**changed['symbols'][frame], 'max_bytes': rules.SYMBOLS[frame]['max_bytes'] + 16}
    reject(lambda: validate_paths(changed, error), 'cap/pattern changed')
    def edit(name, mutation):
        lines = listing.splitlines(keepends=True)
        start = next(at for at, line in enumerate(lines) if (m := FUNCTION.match(line)) and m[2] == name)
        end = next((at for at in range(start + 1, len(lines)) if FUNCTION.match(lines[at]) or SECTION.match(lines[at])), len(lines))
        before = ''.join(lines[start + 1:end]); after = mutation(before)
        require(before != after, 'self-test: missing output mutation anchor', AssertionError)
        return ''.join(lines[:start + 1]) + after + ''.join(lines[end:])
    impl = next(name for name in rules.DISPATCH if 'append_heater_context_json_impl(' in name)
    altered = edit(impl, lambda text: text.replace('call8 ', 'call4 ', 1))
    reject(lambda: validate_inlining(altered, error), 'exact direct/indirect continuation')
    sink_op = next(name for name in rules.DISPATCH if 'JsonOutput::operator+=(' in name)
    altered = edit(sink_op, lambda text: text.replace('callx8 a8', 'callx8 a9', 1))
    reject(lambda: validate_inlining(altered, error), 'exact direct/indirect continuation')
    wrapper = next(name for name in rules.INDIRECT_SITES if 'json_output<std::' in name)
    altered = edit(wrapper, lambda text: text.replace('::append(char const*, unsigned int)>', '::unreviewed_append(char const*, unsigned int)>', 1))
    reject(lambda: validate_inlining(altered, error), 'exact indirect register/literal setup')
    cb_target = next(iter(rules.CALLBACK_REFERENCES))
    altered = listing + '\nff0000 <unreviewed_callback()>:\nff0000: 004136 entry a1, 32\n' + \
        'ff0003: 000081 l32r a8, 1000 <literal> (1000 <' + cb_target + '>)\n'
    reject(lambda: validate_inlining(altered, error), 'callback/pointer reference inventory')
    altered = listing + '\nff0000 <daik::detail::json_output<Unreviewed>(Unreviewed&)>:\nff0000: 004136 entry a1, 32\n'
    reject(lambda: validate_inlining(altered, error), 'unreviewed instantiation/clone/adapter')
    altered = listing + '\nff0000 <daik::flash_progress_heater_context()>:\nff0000: 004136 entry a1, 32\n'
    reject(lambda: validate_inlining(altered, error), 'newly outlined helper requires review')
    return count


def self_test(budgets, sources, error):
    validate_sources(budgets, sources, error)
    count = 0
    def reject(changed):
        nonlocal count
        try:
            validate_sources(budgets, changed, error)
        except error as exc:
            require('heater context' in str(exc), 'self-test: unrelated failure', AssertionError)
            count += 1
        else:
            raise AssertionError('accepted heater source/caller/scratch regression')
    for path in rules.SOURCE_DIGESTS:
        changed = dict(sources)
        changed[path] += '\ninline void hidden_stack() { alloca(external_bytes); }\n'
        reject(changed)
    for name in rules.CALLERS:
        for path in ('main/new_task.cpp', 'main/existing_header.hpp'):
            changed = dict(sources)
            changed[path] = changed.get(path, '') + '\nvoid hidden_caller() { auto p = &' + name + '; }\n'
            reject(changed)
    for callback in rules.RECEIPTS:
        changed = dict(sources)
        original = _body(sources, 'main/heater_context_store.cpp', callback, error)
        replacement = original.replace('SemGuard lock(s_mutex);', 'SemGuard lock(s_mutex, 0);', 1)
        require(replacement != original, 'self-test: missing callback lock mutation anchor', AssertionError)
        changed['main/heater_context_store.cpp'] = changed['main/heater_context_store.cpp'].replace(original, replacement, 1)
        reject(changed)
    mutations = [
        ('main/heater_context_store.cpp', 'if (!budget) return;', 'if (false) return;'),
        ('main/heater_context_store.cpp', 's_hot[c.hot].mutation == s_claim_mutation', 'true'),
        ('main/heater_context_store.cpp', 'std::memcmp(v.payload, s_wire, p.bytes)', 'false'),
        ('main/logic/json_output.hpp', 'append(context, part);',
         'static void (*saved)(void*, std::string_view); saved = append;'),
        ('main/logic/json_output.hpp', 'dst += part;',
         'static std::string_view saved_view; saved_view = part;'),
        ('main/http_status.cpp', 'append_heater_context_status(j, diag_effective);',
         'append_heater_context_status(j, diag_effective); append_heater_context_status(j, diag_effective);'),
        ('main/http_status.cpp', 'diag_effective != DiagnosticsSource::Modbus', 'true'),
        ('main/mqtt_ha.cpp', 'heater_context_payload(fields);', ''),
        ('main/history.cpp', 'HEATER_CONTEXT_FLASH_MAX_READS);', 'HEATER_CONTEXT_FLASH_MAX_READS * 2);'),
        ('main/history.cpp',
         'heater_context_flash_service(flash_read_heater_context, HEATER_CONTEXT_FLASH_MAX_READS);',
         'heater_context_flash_service(flash_read_heater_context, HEATER_CONTEXT_FLASH_MAX_READS);'
         'heater_context_flash_service(flash_read_heater_context, HEATER_CONTEXT_FLASH_MAX_READS);'),
        ('main/history.cpp', 'checkup_heater_context_expire();', ''),
        ('main/history.cpp', '[[gnu::always_inline]] inline bool flash_build_for_service', 'bool flash_build_for_service'),
        ('main/history.cpp', '[[gnu::noinline]] bool flash_build_next_heater_context', 'bool flash_build_next_heater_context'),
        ('main/history.cpp', '/*max_records=*/12', '/*max_records=*/13'),
        ('main/checkup.cpp', '!completed_sweep', 'false'),
        ('main/checkup.cpp', 'input::still_current(s_heater_inputs, snapshot, current)', 'true'),
    ]
    for path, before, after in mutations:
        require(before in sources[path], 'self-test: missing source anchor ' + before, AssertionError)
        changed = dict(sources)
        changed[path] = changed[path].replace(before, after, 1)
        reject(changed)
    for addition in ('extern void hidden() asm("_ZN4daik22heater_context_payloadE");',
                     '#pragma redefine_extname hidden heater_context_payload'):
        changed = dict(sources)
        changed['main/new_alias.hpp'] = addition
        reject(changed)
    # This mechanism control is independent of body hashes: a Reader after a live guard fails.
    try:
        _reader_scopes('void bad() { SemGuard lock(s_mutex); reader(0, value); }', error)
    except error:
        count += 1
    else:
        raise AssertionError('accepted Reader under heater mutex')
    return count
