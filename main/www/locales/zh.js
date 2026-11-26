// translation-source: 05e9b0c704e32e75ff37cd3fb41521715b21a0f3012adf045bb7663aa45386fe
const zhAria = (x) => (l, d) => `${l} — ${x}。${d}。用方向键逐点读取。`;
const zhMb = (a) => (r) => `${a}${r ? `（寄存器 ${r}）` : ""}。`;
I18N.zh = localeValues([
  /* sys.nodata */ "无数据",
  /* sys.unreachable */ "无法访问",
  /* sys.mb_only */ "X10A 离线 — 数据来自 Modbus",
  /* mode.stop */ "停止",
  /* mode.heat */ "供暖",
  /* mode.cool */ "制冷",
  /* mode.space */ "空间调温",
  /* mode.dhw */ "生活热水",
  /* mode.heat_dhw */ "供暖 + 生活热水",
  /* mode.cool_dhw */ "制冷 + 生活热水",
  /* mode.space_dhw */ "空间调温 + 生活热水",
  /* sys.unreachable_sub */ "无法访问设备 — 正在重试…",
  /* sys.waiting */ "正在等待热泵…",
  /* sys.operating */ "运行中",
  /* sys.standby */ "待机 — 未运行",
  /* sys.defrosting */ "除霜",
  /* sys.circulating */ "循环中 — 压缩机关闭",
  /* sys.cool_mode */ "制冷模式",
  /* sys.residual_circulating */ "余热循环 — 无制冷输出",
  /* sys.bsh_active */ "水箱电加热器已启动",
  /* sys.disinfecting */ "水箱消毒运行中",
  /* sys.online */ "在线",
  /* sys.fault */ "故障",
  /* sys.warning */ "警告",
  /* sys.fault_line */ (c) => "故障 · " + c + " — 请查看 Daikin 故障代码。",
  /* sys.warning_line */ (c) => "警告 · " + c + " — 请检查热泵。",
  /* sys.polled */ (s) => `${s} 秒前轮询`,
  /* config.unreadable_title */ "无法读取服务设置",
  /* config.unreadable_meta */ "此版本无法读取已存储的服务设置，正在使用备用设置，尚未替换保留的副本。兼容的较新固件可能恢复它。成功保存服务设置会替换该副本；仅保存 X10A 引脚或协议不会替换。",
  /* recovery.title */ "恢复模式",
  /* recovery.meta_heap */ "多次内存耗尽重启后，已停用热泵连接/MQTT 以保网页可用。请安装较新固件；重新上电会尝试完整启动。",
  /* recovery.meta */ "多次重启后进入恢复模式并暂停热泵通信/MQTT。检查“设置 → 协议”的 RX/TX 后重启。",
  /* rollback.title */ "WiFi 更改失败 — 已恢复原配置",
  /* rollback.meta */ (back) => `设备无法使用新的 WiFi 设置联网，已恢复原网络${back}并重启。请在“设置 → 连接”中检查网络名称和密码后重试。`,
  /* crash.title_fault */ "设备在故障后重启",
  /* crash.title_orphan */ "发现先前重启遗留的崩溃报告",
  /* crash.reset */ "复位",
  /* crash.task */ "任务",
  /* crash.fw */ "固件",
  /* crash.elf */ "ELF",
  /* crash.corrupted */ "已损坏",
  /* crash.stored_dump */ "已保存的崩溃报告",
  /* crash.stored_hint */ "此报告的生成时间及其与本次重启的关系未知。",
  /* crash.backtrace */ "调用栈",
  /* crash.download */ "下载崩溃报告",
  /* crash.copy */ "复制诊断信息",
  /* crash.dismiss */ "删除报告",
  /* crash.copied */ "诊断信息已复制 — 请粘贴到故障报告中",
  /* crash.copy_fail */ "复制失败 — 请手动打开 /coredump 和 /diag",
  /* crash.ask_dump */ "从设备删除吗？核心转储也会被删除；如需报告问题，请先下载。",
  /* crash.ask */ "从设备删除此报告吗？",
  /* crash.ask_yes */ "删除",
  /* crash.ask_no */ "保留",
  /* crash.deleted */ "崩溃报告已删除",
  /* crash.delete_fail */ "设备无法删除报告 — 报告仍然存在",
  /* bug.row */ "报告问题",
  /* bug.title */ "报告问题",
  /* bug.intro */ "请简述问题。设备会附加状态、读数和日志，并先移除网络名称、地址及服务器名称。",
  /* bug.what */ "发生了什么",
  /* bug.need_text */ "请先描述问题，一两句话即可。",
  /* bug.continue */ "准备报告",
  /* bug.step2_title */ "检查报告",
  /* bug.step2 */ "检查报告；按钮会复制并打开预填 GitHub issue。粘贴到“Device report”，补充回答后提交。",
  /* bug.collecting */ "正在收集设备数据…",
  /* bug.collect_fail */ "无法读取设备 — 下方报告会注明缺失部分。",
  /* bug.copy */ "复制并打开 GitHub",
  /* bug.download */ "下载 .md",
  /* bug.md_hint */ "若复制失败或希望使用文件，请下载同一份 .md 报告，并将文件拖入表单的“Device report”字段。",
  /* bug.copied */ "报告已复制 — 请粘贴到“Device report”字段",
  /* bug.copy_fail */ "复制失败 — 请选中下方文本并手动复制",
  /* bug.redacted */ "网络名称、地址、代理和服务器名称均已移除。",
  /* nav.settings */ "设置",
  /* nav.back */ "返回",
  /* nav.cards */ "仪表板卡片",
  /* nav.diagnosis */ "诊断",
  /* nav.outdoor */ "室外机",
  /* nav.settings_alert */ (n) => `设置 — ${n} 个连接不可用`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "两个数据源一致",
  /* src.delta */ (d, u) => `差值 ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "两个数据源的状态不一致",
  /* conn.homehub */ "HomeHub",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "连接",
  /* conn.offline */ "离线",
  /* conn.disabled */ "已停用",
  /* conn.connecting */ "正在连接…",
  /* conn.connected */ "已连接",
  /* conn.resolving */ "正在解析…",
  /* conn.eth_no_cable */ "未接网线",
  /* conn.eth_no_lease */ "网线已连接，但未取得地址",
  /* conn.eth_fd */ "全双工",
  /* conn.enabled */ "已启用",
  /* conn.enabled_noping */ "已启用，但主机不响应 ping",
  /* conn.synced */ "已同步",
  /* conn.syncing */ "正在同步…",
  /* conn.error */ (e) => "错误：" + e,
  /* conn.connected_to */ (s) => "已连接到 " + s,
  /* conn.aria */ (label, state) => `${label}：${state}。点按可编辑。`,
  /* modbus.err.mdns_not_found */ "未通过 mDNS 找到 HomeHub。",
  /* modbus.err.no_address */ "尚未配置 HomeHub 地址。",
  /* modbus.err.resolve_failed */ "无法解析 HomeHub 地址。",
  /* modbus.err.connect_timeout */ "连接超时 — 无法访问 HomeHub。",
  /* modbus.err.connection_refused */ "可访问 HomeHub，但 Modbus TCP 端口已关闭。",
  /* modbus.err.network_unreachable */ "没有通往 HomeHub 的网络路径。",
  /* modbus.err.host_unreachable */ "网络中无法访问 HomeHub。",
  /* modbus.err.connect_failed */ "连接 HomeHub 失败。",
  /* modbus.err.request_failed */ zhMb("无法创建 Modbus 请求"),
  /* modbus.err.send_timeout */ zhMb("发送 Modbus 请求超时"),
  /* modbus.err.send_failed */ zhMb("无法发送 Modbus 请求"),
  /* modbus.err.response_timeout */ zhMb("等待 HomeHub 响应超时"),
  /* modbus.err.connection_closed */ zhMb("HomeHub 已关闭连接"),
  /* modbus.err.receive_failed */ zhMb("无法读取 HomeHub 响应"),
  /* modbus.err.invalid_response */ zhMb("Modbus 响应无效"),
  /* modbus.err.internal_error */ "Modbus 轮询循环内部错误。",
  /* modbus.err.exception */ (r, n, why) => `HomeHub 拒绝寄存器 ${r || "?"}（异常 ${n}：${why}）。`,
  /* modbus.exc.1 */ "非法功能",
  /* modbus.exc.2 */ "非法数据地址",
  /* modbus.exc.3 */ "非法数据值",
  /* modbus.exc.4 */ "设备故障",
  /* modbus.exc.5 */ "请求已确认",
  /* modbus.exc.6 */ "设备忙",
  /* modbus.exc.8 */ "存储器奇偶校验错误",
  /* modbus.exc.10 */ "网关路径不可用",
  /* modbus.exc.11 */ "目标设备无响应",
  /* modbus.exc.unknown */ "未知原因",
  /* card.model */ "型号",
  /* card.hplink */ "热泵连接",
  /* card.online */ "在线",
  /* card.uptime */ "运行时间",
  /* card.freeheap */ "可用内存",
  /* card.maxalloc */ "最大连续空闲块",
  /* card.offline */ "离线",
  /* card.protocol */ "协议",
  /* card.rxpin */ "RX 引脚",
  /* card.txpin */ "TX 引脚",
  /* card.capacity */ "额定容量",
  /* card.hplink_help */ "表示 ESP32 是否正通过 X10A 收到热泵的有效响应。",
  /* card.protocol_help */ "X10A-I 和 X10A-S 是服务接口支持的两种帧格式；固件会根据有效响应自动识别。",
  /* card.rxpin_help */ "ESP32 接收热泵 X10A 数据的 GPIO。连接离线时，选择其他组合会重新自动检测。",
  /* card.txpin_help */ "ESP32 向热泵发送 X10A 请求的 GPIO。RX 与 TX 必须不同，并与实际接线一致。",
  /* card.capacity_iu */ "额定容量（室内机）",
  /* card.candidates */ "可能的型号",
  /* card.oueeprom */ "室外机 ID",
  /* card.checkup */ "设备诊断 · 24 小时",
  /* service.title */ "制热时冷媒回路",
  /* service.state.waiting */ "等待制热",
  /* service.state.observing */ "记录中",
  /* service.state.limited */ "部分缺失",
  /* service.state.interrupted */ "已暂停",
  /* service.reason.unsupported_profile */ "此型号不能提供全部所需读数。",
  /* service.reason.compressor_not_running */ "压缩机未运行。",
  /* service.reason.unsupported_or_unknown_mode */ "未确认正常空间供暖。",
  /* service.reason.dhw_path */ "热泵正在加热生活热水。",
  /* service.reason.defrost */ "室外机正在除霜。",
  /* service.reason.unit_fault */ "热泵正在报告故障或警告。",
  /* service.reason.special_controller_phase */ "短暂的启动或特殊控制阶段正在进行。",
  /* service.reason.missing_fresh_signal */ "至少缺少一个所需的当前读数。",
  /* service.reason.poll_gap */ "X10A 连接已中断或被有意暂停。",
  /* service.window */ (d, n) => `${d} · ${n} 个读数`,
  /* service.help.observing */ "正在记录本次供暖。",
  /* service.help.limited */ "正在记录；缺少的背景列于上方。",
  /* service.help.interrupted */ "在下一次符合条件的供暖运行重新开始。",
  /* service.common */ "一次供暖运行，与24小时检查分开。不诊断制冷剂充注量或正常范围。阀门：指令，非实测位置。",
  /* check.fault */ "机组故障",
  /* check.dhw_loss */ "热水箱降温",
  /* check.cycling */ "压缩机启动",
  /* check.defrost */ "除霜",
  /* check.pressure */ "水压",
  /* check.flow */ "最低流量",
  /* check.flow.lowest */ "供暖时的最低流量",
  /* check.flow.runup */ "室内连续供暖至少 10 分钟后，测量值才计入统计。",
  /* check.flow.assessment */ "不同机型和运行模式所需的最低流量可查阅安装手册。流量过低可能触发 7H 故障。",
  /* check.flow.explain */ "流量表示每分钟流过热泵的水有多少升。",
  /* check.flow.live */ "当前",
  /* check.flow.show */ "在曲线上显示一个最低点",
  /* check.flow.readout */ (value) => `这一时间段内，至少有一次测得 ${value}。测量时，室内供暖已连续运行至少 10 分钟。`,
  /* check.flow.locations_missing */ "未保存此前测得该数值的具体时间。",
  /* check.flow.unavailable */ "缺少确定供暖时最低流量所需的测量值。",
  /* check.flow.waiting */ "正在等待符合条件的供暖时段。",
  /* check.heater */ "电加热器",
  /* check.retries */ "保护计数器",
  /* check.status.ok */ "正常",
  /* check.status.info */ "提示",
  /* check.status.warn */ "警告",
  /* check.status.collecting */ "检查中",
  /* check.status.observation */ "测量值",
  /* check.status.experimental */ "实验性",
  /* check.status.unavailable */ "不可用",
  /* check.dhw.maximum */ "最强水箱降温",
  /* check.dhw.waiting */ "正在等待符合条件的一小时窗口。",
  /* check.dhw.no_window */ "过去 24 小时内没有已完成的一小时窗口。",
  /* check.dhw.locations_missing */ "当前图表中没有此数值较早读数的时间窗口。",
  /* check.dhw.stale */ "当前水箱降温读数缺失或已过时；标记的窗口均为历史记录。",
  /* check.dhw.shape_step */ "该小时内温度骤降 — 符合取用热水或水箱内快速混合的特征。",
  /* check.dhw.shape_steady */ "温度持续平稳下降且无骤降 — 符合静置散热、重力循环或持续外部循环的特征。",
  /* check.dhw.circ_on */ "该小时内外部循环泵运行（≥ 5 分钟），符合外部循环散热特征。",
  /* check.dhw.circ_off */ "外部循环泵已持续关闭至少 2 小时，此处不大可能由外部循环造成散热。",
  /* check.dhw.pump_off */ "内部水泵保持停止，因此不大可能通过三通阀流失热量；仅凭 R5T 无法证实原因。",
  /* check.dhw.pump_on */ "内部采暖泵在该小时内运行，因此仍存在通过三通阀散热的可能；仅凭 R5T 无法证实原因。",
  /* check.dhw.circ_label */ "外部循环泵",
  /* check.dhw.summary_phases */ (n) => `24 小时内出现 ${n} 个明显降温时段（≥ 0.8 °C/h）。`,
  /* check.dhw.summary_circ_on */ (name, withPump, total) => `${name}在 ${total} 个明显时段中有 ${withPump} 个同步运行。`,
  /* check.dhw.summary_circ_off */ (name) => `在观测到的明显降温时段内${name}保持关闭（≥ 2 小时）。`,
  /* check.detail.value_label */ "数值：",
  /* check.detail.assessment_label */ "评估：",
  /* check.detail.ok */ "可读数据未触发本项规则。",
  /* check.detail.info */ "观察到提示；限制见下文。",
  /* check.detail.warn */ "设备错误或观察到持续低压。",
  /* check.detail.fault.error */ "机组正报告错误。确切代码见“运行”卡片。",
  /* check.detail.fault.warning */ "机组正报告警告或提醒，并非错误。确切代码见“运行”卡片。",
  /* check.detail.fault.past */ "当前无消息；本时段曾记录消息。消息消失不能证明原因或问题已解决。",
  /* check.detail.fault.past_unknown */ "曾记录消息；当前故障状态无法读取。",
  /* check.detail.collecting */ (a, b) => `可读信号：${a}，要求${b}。`,
  /* check.detail.collecting_unknown */ "无当前评估。",
  /* check.detail.observation */ "仅观察；无通用OK/警告限值。",
  /* check.detail.experimental */ "实验计数器；稳定不排除限流。",
  /* check.detail.unavailable */ "本配置无可评估信号。",
  /* check.starts */ (n) => `${n} 次启动`,
  /* check.cycling.runs */ (n) => `${n} 次运行`,
  /* check.cycling.mean */ (d) => `平均 ${d}`,
  /* check.cycling.completed */ "已完成的运行",
  /* check.cycling.unclear */ "用途不明",
  /* check.cycling.unclear_hint */ "运行中可能切换模式，也可能只记录到一部分。",
  /* check.cycling.short */ "供暖运行的平均时长较短。",
  /* check.cycling.normal */ "供暖运行的平均时长足够。",
  /* check.cycling.few */ "供暖运行次数还太少。",
  /* check.cycling.waiting */ "还需要更多数据。",
  /* check.cycling.class_unavailable */ "这套设备提供的供暖运行信息太少，无法评估。",
  /* check.cycling.unavailable */ "没有压缩机数据。",
  /* check.cycling.stale */ "当前缺少测量数据。",
  /* check.cycling.history_empty */ "暂无历史记录。",
  /* check.cycling.timed_starts */ (s) => `${s}有时间记录`,
  /* check.cycling.run_start */ "启动",
  /* check.cycling.run_stop */ "停止",
  /* check.cycling.run_duration */ "运行时长",
  /* check.cycling.run_ongoing */ "运行中",
  /* check.cycling.run_stop_unknown */ "停止时间未知",
  /* check.cycling.no_timed_runs */ "这一小时没有带时间记录的启动。",
  /* check.cycling.run_details_unavailable */ "这一小时没有单次运行的时间记录。",
  /* check.cycling.saved_starts */ (s) => `其中 ${s}来自重启前的每小时统计。`,
  /* check.cycling.short_runs */ (n) => `${n} < 5 min`,
  /* check.cycling.col_stop */ "停止原因",
  /* check.cycling.stop_low_flow */ "供水超目标 · 流量偏低",
  /* check.cycling.stop_low_rps */ "供水超目标 · 低转速",
  /* check.cycling.stop_req_off */ "压缩机请求结束",
  /* check.cycling.stop_tgt_drop */ "目标温度下调",
  /* check.cycling.stop_defrost */ "化霜暂停",
  /* check.cycling.stop_defrost_done */ "化霜结束",
  /* check.cycling.stop_dhw */ "切换至热水",
  /* check.cycling.stop_normal_dhw */ "热水运行结束",
  /* check.cycling.stop_normal */ "正常停止",
  /* check.cycling.out_cond */ (v) => `（室外 ${v}）`,
  /* check.cycling.find_low_flow */ (minFlow, typ) => `低流量短周期：数分内供水超目标（${minFlow}${typ}）。`,
  /* check.cycling.find_low_rps */ (flow, cond) => `低转速短周期${cond}：启动后供水超目标（${flow}）。`,
  /* check.cycling.find_control */ "控制停机：请求关或目标下调。",
  /* check.cycling.find_defrost_dhw */ (cond) => `化霜与热水${cond}：暂停供暖。`,
  /* check.cycling.find_defrost */ (cond) => `化霜${cond}：暂停供暖除霜。`,
  /* check.cycling.find_dhw */ "热水：暂停供暖加热热水。",
  /* check.cycling.find_steady */ (flow) => flow ? `平稳供暖：最低 ${flow}。` : "平稳供暖。",
  /* check.cycling.pause_tag */ (d) => `，停机 ${d} 后`,
  /* check.cycling.cond_tag */ (lwt, tgt) => tgt ? `供水 ${lwt}，目标 ${tgt}` : `供水 ${lwt}`,
  /* check.cycling.from_tag */ (prev) => `自 ${prev} `,
  /* check.cycling.rwt_tag */ (rwt) => `回水 ${rwt}`,
  /* check.cycling.typ_tag */ (typ) => `，通常 ${typ}`,
  /* check.cycling.s_cool */ (at, pause, lwt, tgt) => `${at}${pause} 启动：供水 ${lwt}，目标 ${tgt}，请求开启。`,
  /* check.cycling.s_req */ (at, pause, cond) => `${at}${pause} 请求开启启动${cond}。`,
  /* check.cycling.s_tgt */ (at, pause, prev, tgt, cond) => `${at}${pause} 目标${prev}调高至 ${tgt}${cond}。`,
  /* check.cycling.s_defrost_after */ (at, pause, cond) => `${at}${pause} 化霜结束恢复${cond}。`,
  /* check.cycling.s_dhw_after */ (at, pause, cond) => `${at}${pause} 热水结束恢复${cond}。`,
  /* check.cycling.s_defrost */ (at, pause) => `${at}${pause} 为化霜启动。`,
  /* check.cycling.s_dhw */ (at, pause, cond) => `${at}${pause} 为热水启动${cond}。`,
  /* check.cycling.s_gen */ (at, pause, cond) => `${at}${pause} 启动${cond}。`,
  /* check.cycling.e_low_flow */ (to, lwt, tgt, rwt, flow, typ) => `${to} 停机：供水 ${lwt} 高于目标 ${tgt}${rwt}，流量 ${flow}${typ}。`,
  /* check.cycling.e_low_rps */ (to, lwt, tgt, rwt, flow, rps) => `${to} 停机：供水 ${lwt} 高于目标 ${tgt}${rwt}，${flow}、${rps}。`,
  /* check.cycling.e_req */ (to, vals) => `${to} 停机：请求关闭${vals}。`,
  /* check.cycling.e_tgt */ (to, prev, tgt, vals) => `${to} 停机：目标${prev}下调至 ${tgt}${vals}。`,
  /* check.cycling.e_defrost_run */ (to, vals) => `化霜结束 ${to}${vals}。`,
  /* check.cycling.e_defrost_pause */ (to, vals) => `${to} 为化霜停机${vals}。`,
  /* check.cycling.e_dhw */ (to, vals) => `${to} 停机：切换至热水${vals}。`,
  /* check.cycling.e_norm */ (to, vals) => `结束 ${to}${vals}。`,
  /* check.cycling.e_ongoing */ "最近读数时仍在运行。",
  /* check.cycling.cause_unavailable */ "无详情",
  /* check.cycling.cause_older_unavailable */ "这些较早的运行没有可用的已保存启停详情。",
  /* check.heater_context.categories */ "应急运行标志|错误状态|除霜/恢复|热水流路|Silent Mode 标志|室外 ≤+2°C|室外 >+2°C|上报压缩机已停止|Silent Mode + 温和室外条件下供暖",
  /* check.heater_context.notice */ "在 Silent Mode、供暖和温和室外条件下，上报加热器时长至少 15 分钟：项目暂定提示。",
  /* check.heater_insp.runtime */ "上报 ON 时长 (24 小时)",
  /* check.heater_insp.zero */ "过去 24 小时内未上报 ON 时长。",
  /* check.heater_insp.zero_cov */ (d) => `过去 24 小时内的 ${d} 观测时间中未上报 ON 时长。`,
  /* check.heater_insp.active */ "过去 24 小时内曾上报处于启用状态。",
  /* check.heater_insp.active_cov */ (d) => `过去 24 小时内的 ${d} 观测时间中曾上报处于启用状态。`,
  /* check.heater_insp.active_ctx */ (list) => `同时观测到：${list}。`,
  /* check.heater_insp.active_unclassified */ "过去 24 小时内曾上报处于启用状态，无已分类的上下文。",
  /* check.heater_insp.active_unclassified_cov */ (d) => `过去 24 小时内的 ${d} 观测时间中曾上报处于启用状态，无已分类的上下文。`,
  /* check.heater_insp.archive_incomplete */ "24 小时上下文存档不完整。",
  /* check.heater_insp.stale */ "当前读数缺失或已过时。",
  /* check.heater_insp.limit */ "标志时长不是电能消耗，也不能确立原因或必要性；缺失信号和采样点之间的状态仍为未知。",
  /* check.heater_insp.waiting */ "正在等待 24 小时加热器观测数据。",
  /* check.heater_insp.unavailable */ "此来源不可用 24 小时加热器诊断。",
  /* check.min */ (m) => `${m} 分钟`,
  /* check.hour.latest */ "最近时段",
  /* check.hour.earlier */ (h) => `早 ${h} 小时`,
  /* check.hour.other */ "其他 / 未知",
  /* check.hour.gap */ "测量缺口",
  /* check.hour.coverage */ (observed, possible) => possible ? `已观测 ${observed}，可观测 ${possible}` : `已观测 ${observed} · 已过时长未知`,
  /* check.hour.ending */ (time) => `时段结束 ${time}`,
  /* check.hour.saved */ (time) => `保存的时间 ${time}`,
  /* check.fault_err */ "当前故障",
  /* check.fault_warn */ "当前警告",
  /* check.fault_past */ "先前有报警",
  /* check.fault_none */ "当前无故障",
  /* check.fault_unknown */ "未知",
  /* check.fault_past_unknown */ "曾有报警 · 当前未知",
  /* check.fault_since_short */ (d) => `已持续 ${d}`,
  /* check.fault_ago_short */ (d) => `${d}前`,
  /* check.fault_hero_ok */ (d) => `24 小时观测中的 ${d} 内未报告故障或警告。`,
  /* check.fault_latched_only */ "热泵报告了已锁存的故障标志；记录的 24 小时窗口内没有带时间戳的时段。",
  /* check.fault_unit_outdoor */ "室外机",
  /* check.fault_unit_indoor */ "室内机",
  /* check.fault_unit_both */ "室外 + 室内",
  /* check.fault_secondary */ (s) => `同时有效：${s}`,
  /* check.fault_stop_ongoing */ "进行中",
  /* check.fault_stop_unknown */ "不明确",
  /* check.fault_col_code */ "代码",
  /* check.fault_col_meaning */ "含义",
  /* check.fault_ok_label */ "无故障",
  /* check.fault_gap_label */ "未监测",
  /* check.fault_severity_caution */ "注意",
  /* check.retry_seen */ "有增加",
  /* check.retry_none */ "无增加",
  /* service.metric.comp */ "压缩机",
  /* service.metric.disch */ "排气温度",
  /* service.metric.eev */ "膨胀阀指令",
  /* service.metric.hp */ "高压",
  /* service.metric.lp */ "低压",
  /* check.hydronic.agree_labels */ "仅水泵 R1T−R4T|仅水泵 R2T−R1T|一致状态|一致限制",
  /* check.hydronic.agree_reasons */ "流量低于 5.0 l/min|压缩机运行中|电辅热启用或不明|三通阀已切换|温度未稳态",
  /* check.hydronic.agree_limits */ "R2T 不可用|含生活热水路径",
  /* check.hydronic.agree_meta */ "窗口|读数|仅被动温差一致；非传感器校准；未排除外部热源。",
  /* service.metric.range */ (a, b, c, d) => `最小 ${a} · 平均 ${b} · 最大 ${c} ${d}`,
  /* service.metric.samples */ n => `已纳入读数：${n}`,
  /* service.metric.input_none */ "未选定输入",
  /* service.metric.meta_limit */ "计数是已纳入的读数，并非时间覆盖率。选定输入不代表存在当前读数。",
  /* service.limit.special_phases_unavailable */ "控制阶段",
  /* service.limit.temperature_context_incomplete */ "温度背景",
  /* service.limit.pressure_sides_incomplete */ "压力侧",
  /* service.limit.outdoor_context_incomplete */ "室外背景",
  /* service.row.limits */ "缺少的背景：",
  /* check.detail.period_label */ "数据时段：",
  /* check.detail.period */ (a) => `${a}，最多24小时；可能缺测`,
  /* check.detail.age_label */ "最后测量值的年龄：",
  /* check.detail.fault.ok */ "可读故障信号中无当前或保存的消息。",
  /* check.defrost.normal */ "寒冷潮湿时，短时除霜很常见。除霜占比表示在能够读取除霜状态的压缩机运行时间中，有多少时间用于除霜。",
  /* check.defrost.modbus.about */ "Modbus 用同一个信号表示除霜和压缩机重启准备。",
  /* check.defrost.modbus.normal */ "稳定运行时信号关闭。这两个阶段均可使信号开启。",
  /* check.defrost.starts_label */ "记录到的除霜启动次数",
  /* check.defrost.share */ "除霜占比",
  /* check.defrost.notice */ "除霜占比较高",
  /* check.detail.pressure.info */ "偏低",
  /* check.detail.pressure.warn */ "危急",
  /* check.detail.pressure.ok */ "正常",
  /* check.pressure.finding */ "已确认的结果",
  /* check.pressure.sustained */ (a) => `压力连续至少 60 秒不高于 ${a}。`,
  /* check.pressure.clear */ "未确认有持续低压。",
  /* check.pressure.rules */ "如何评估水压？",
  /* check.pressure.unavailable */ "X10A 水压诊断不可用。",
  /* check.pressure.pending */ "读数处于危险范围，持续时间尚不明确。",
  /* check.detail.source_stale */ "无新鲜X10A样本；当前状态未知。保留历史。",
  /* check.detail.current_label */ "≤1.0 bar 偏低",
  /* check.detail.minimum_time_label */ "≤0.5 bar 危急",
  /* check.detail.coverage_missing */ (a) => `缺少可读时间：${a} s。`,
  /* values.waiting */ "正在等待首次轮询…",
  /* values.sg_x10a_mode */ "Smart Grid 模式（X10A 触点）",
  /* group.Operation */ "运行",
  /* group.Domestic hot water */ "生活热水",
  /* group.Water circuit */ "水路",
  /* group.Refrigerant / outdoor */ "制冷剂 / 室外机",
  /* group.Electrical */ "电气",
  /* group.Device */ "设备",
  /* group.Other values */ "其他数值",
  /* group.Protection */ "保护",
  /* group.Values */ "数值",
  /* state.on */ "开",
  /* state.off */ "关",
  /* enum.auto */ "自动",
  /* enum.heating */ "供暖",
  /* enum.cooling */ "制冷",
  /* enum.no_error */ "无错误",
  /* enum.fault */ "故障",
  /* enum.warning */ "警告",
  /* enum.space_heating */ "空间供暖",
  /* enum.dhw */ "生活热水",
  /* enum.free_running */ "自由运行",
  /* enum.forced_off */ "强制关闭",
  /* enum.recommended_on */ "建议开启",
  /* enum.forced_on */ "强制开启",
  /* enum.space_cooling */ "空间制冷",
  /* enum.none */ "无",
  /* enum.reduced */ "受限",
  /* enum.automatic */ "自动",
  /* enum.manual */ "手动",
  /* enum.actuator */ "执行器",
  /* enum.tank_heat_up */ "水箱加热",
  /* a4.quiet_selection */ "静音模式选择",
  /* a4.heating_offset */ "主区域天气补偿供暖偏移量",
  /* a4.imposed_power_limit */ "施加的功率上限",
  /* a4.pre_phe_outdoor */ "室外板式换热器前的水温",
  /* a4.main_target */ "主区域供暖/制冷目标",
  /* a4.quiet_help */ "选择关闭、自动或手动静音运行。不表示静音模式当前是否正在运行；所选级别或时间表仍可能设为关闭。",
  /* a4.current_help */ "报告空间温度调节状态：无、供暖或制冷。应结合正常运行标志读取；它不能证明压缩机正在运行。",
  /* a4.limit_help */ "施加的电功率上限，并非实测耗电量。保护运行可能超过此设置。",
  /* a4.demand_help */ "报告需求响应状态：自由运行、强制关闭、强制开启、建议开启或受限。这些数字代码与配置的 Smart Grid 选择不同。",
  /* a4.operation_help */ "报告停止、水箱加热、空间供暖、空间制冷或执行器运行。这是报告的状态，不能证明发生了有效热传递。",
  /* a4.heating_offset_help */ "以开尔文为单位调整主区域的气候补偿供暖曲线。这是偏移量，不是实测温度，也不是完整的目标水温。",
  /* a4.pre_phe_outdoor_help */ "室外板式换热器之前的水温。这是水侧传感器，不是室外空气温度或制冷剂温度。",
  /* a4.flow_help */ "Altherma 4 的流量换算尚未验证。显示的 L/min 数值沿用现有换算；评估性能前，请与机组自身的读数比较。",
  /* a4.pump_help */ "Altherma 4 手册将此项称为泵速，却标注 L/min。这里显示的 % 单位是尚未验证的假设；请与机组自身的读数比较。",
  /* a4.pressure_help */ "Altherma 4 的压力换算尚未验证。显示的 bar 数值沿用现有换算；判断压力前，请与机组自身的读数比较。",
  /* a4.demand_response */ "需求响应模式",
  /* a4.unit_operation */ "机组运行状态",
  /* a4.cooling_offset */ "主区域气候补偿制冷偏置",
  /* a4.add_target */ "附加区域供暖/制冷目标",
  /* a4.abnormality_counter */ "用户异常计数器",
  /* a4.cooling_offset_help */ "以开尔文调整主区域气候补偿制冷曲线。这是偏置值，不是实测温度，也不是完整的出水设定温度。",
  /* a4.abnormality_help */ "机组记录的用户侧异常累计次数。不变的非零值反映历史事件而非当前故障；当前状态请看机组诊断状态与故障代码。",
  /* enum.unknown */ (n) => `未知（${n}）`,
  /* chip.space_on */ "空间回路已开启",
  /* chip.space_off */ "空间回路已关闭",
  /* chip.quiet */ "静音",
  /* schem.sg_boost */ "增载",
  /* sg.mode0 */ "自由运行",
  /* sg.mode1 */ "强制关闭",
  /* sg.mode2 */ "建议开启",
  /* sg.mode3 */ "强制开启",
  /* schem.to_dhw */ "3WV → 水箱",
  /* schem.to_space */ "3WV → 房间",
  /* normal.label */ "正常范围：",
  /* meaning.label */ "如何理解：",
  /* hist.title */ "过去 24 小时",
  /* hist.recorded */ (h) => `已记录 · ${h} 小时`,
  /* hist.now */ "现在",
  /* hist.ago */ (h) => `${h} 小时前`,
  /* hist.retained */ "最近一次收到的读数",
  /* hist.before_retained */ (h) => `最近一次收到的读数的 ${h} 小时前`,
  /* hist.loading */ "正在加载趋势…",
  /* hist.none */ "尚无已记录读数。",
  /* hist.err */ "趋势不可用。",
  /* hist.gaps */ (n) => `${n} 个无数据时段 — 未测量`,
  /* hist.nm */ "未测量",
  /* hist.rel */ (h) => `${h} 小时前`,
  /* hist.held */ "室外机待机",
  /* hist.heldnote */ (h) => `已待机 ${h} 小时 — 未测量`,
  /* hist.aria */ (l) => `${l} — 24 小时趋势。用方向键逐点读取。`,
  /* hist.aria_pinned */ (l, r) => `${l} — 24 小时趋势。已固定：${r}。再次点按可清除。`,
  /* hist.pin_hint */ "点按固定",
  /* hist.duration_min */ (m) => `${m} 分钟`,
  /* hist.duration_h */ (h) => `${h} 小时`,
  /* hist.duration_hm */ (h, m) => `${h} 小时 ${m} 分钟`,
  /* hist.duration_sec */ (s) => `${s} 秒`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · 约 ${d}`,
  /* hist.state_active */ "启动",
  /* hist.state_off */ "关闭",
  /* val.since */ (d) => `已持续 ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} 未观察`,
  /* hist.modbus_plateau */ (when, d) => `寄存器自 ${when} 起未变 · 约 ${d} · 测量时间未知`,
  /* hist.boost_total */ (d) => `增载 · ${d}`,
  /* hist.boost_none */ "记录期内没有增载。",
  /* hist.boost_ago_range */ (a, b) => `${a}–${b} 小时前`,
  /* hist.boost_active */ "增载中",
  /* hist.boost_inactive */ "未增载",
  /* hist.boost_aria */ zhAria("Smart Grid 四种状态的历史"),
  /* hist.defrost_total */ (d) => `检测到除霜的 5 分钟区段 · ${d}`,
  /* hist.defrost_none */ "记录期内未观察到除霜循环。",
  /* hist.defrost_active */ "正在除霜",
  /* hist.defrost_inactive */ "未除霜",
  /* hist.defrost_aria */ zhAria("除霜历史"),
  /* hist.quiet_total */ (d) => `静音 · ${d}`,
  /* hist.quiet_none */ "记录期内未观察到静音模式。",
  /* hist.quiet_active */ "静音已启动",
  /* hist.quiet_inactive */ "静音未启动",
  /* hist.quiet_aria */ zhAria("静音模式历史"),
  /* hist.heater_total */ (d) => `水箱电加热 · ${d}`,
  /* hist.heater_none */ "记录期内未观察到水箱电加热器运行。",
  /* hist.heater_active */ "水箱电加热启动",
  /* hist.heater_inactive */ "水箱电加热关闭",
  /* hist.heater_aria */ zhAria("水箱电加热器历史"),
  /* hist.preheat_total */ (d) => `预热 · ${d}`,
  /* hist.preheat_none */ "记录期内未观察到水箱预热。",
  /* hist.preheat_active */ "预热中",
  /* hist.preheat_inactive */ "未预热",
  /* hist.preheat_aria */ zhAria("X10A 水箱预热历史"),
  /* hist.disinfection_total */ (d) => `消毒 · ${d}`,
  /* hist.disinfection_none */ "记录期内未观察到消毒运行。",
  /* hist.disinfection_active */ "消毒中",
  /* hist.disinfection_inactive */ "未消毒",
  /* hist.disinfection_aria */ zhAria("HomeHub 消毒历史"),
  /* hist.buh_total */ (d) => `BUH · ${d}`,
  /* hist.buh_none */ "记录期内未观察到 BUH 运行。",
  /* hist.buh_active */ "BUH 启动",
  /* hist.buh_inactive */ "BUH 关闭",
  /* hist.buh_step1 */ "1 级",
  /* hist.buh_step2 */ "2 级",
  /* hist.buh_aria */ zhAria("BUH 历史"),
  /* hist.valve_dhw_total */ (d) => `热水 · ${d}`,
  /* hist.valve_space_total */ (d) => `房间 · ${d}`,
  /* hist.valve_none */ "记录期内没有热水位置。",
  /* hist.valve_dhw */ "热水",
  /* hist.valve_space */ "房间",
  /* hist.valve_aria */ zhAria("3WV 历史"),
  /* hist.circ_total */ (d) => `水泵 · ${d}`,
  /* hist.circ_none */ "记录期内未观察到水泵运行。",
  /* hist.circ_on */ "运行",
  /* hist.circ_off */ "停止",
  /* hist.circ_unavailable */ "不可用",
  /* hist.circ_gaps */ (n) => `${n} 个不可用时段`,
  /* hist.circ_aria */ zhAria("循环泵历史"),
  /* hist.valve2_on_total */ (d) => `2WV 开 · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV 关 · ${d}`,
  /* hist.valve2_on */ "2WV 开",
  /* hist.valve2_off */ "2WV 关",
  /* hist.valve2_none */ "所选时段内未记录到 2WV 输出启动。",
  /* hist.valve2_aria */ zhAria("2WV 输出历史"),
  /* hist.flow_switch_total */ (d) => `流量开关 ON · ${d}`,
  /* hist.flow_switch_on */ "流量开关 ON",
  /* hist.flow_switch_off */ "流量开关 OFF",
  /* hist.flow_switch_none */ "所选时段内未记录到该 X10A 信号启动。",
  /* hist.flow_switch_aria */ zhAria("水流量开关历史"),
  /* hist.comp_total */ (d, n) => `压缩机 · ${d} · ${n} 次运行阶段`,
  /* hist.comp_none */ "记录时段内未观察到压缩机运行。",
  /* hist.comp_active */ "压缩机运行中",
  /* hist.comp_inactive */ "压缩机已停止",
  /* hist.comp_aria */ zhAria("HomeHub 压缩机时间线"),
  /* hist.mb_defrost_total */ (d) => `化霜 / 重启 · ${d}`,
  /* hist.mb_defrost_none */ "记录时段内未观察到化霜或重启阶段。",
  /* hist.mb_defrost_active */ "化霜 / 重启",
  /* hist.mb_defrost_inactive */ "正常 / 待机",
  /* hist.mb_defrost_aria */ zhAria("HomeHub 化霜/重启时间线"),
  /* hist.pump_total */ (d) => `水泵 · ${d}`,
  /* hist.pump_none */ "记录时段内未观察到循环泵运行。",
  /* hist.pump_active */ "水泵运行中",
  /* hist.pump_inactive */ "水泵已停止",
  /* hist.pump_aria */ zhAria("HomeHub 循环泵时间线"),
  /* toast.saved */ "已保存",
  /* toast.no_changes */ "没有更改",
  /* toast.reboot */ "正在重启并重新连接…",
  /* toast.rebooted */ "已重启 — 请重新连接设备",
  /* board.draft_stale */ "板卡设置已更改。请重新打开编辑窗口后再保存。",
  /* toast.busy_retry */ "设备忙 — 请稍后重试",
  /* toast.unreachable */ "无法访问设备",
  /* toast.rejected */ "已拒绝",
  /* toast.applying */ "仍在应用上一次更改…",
  /* toast.check_wifi */ "请检查 WiFi 设置",
  /* toast.check_broker */ "请检查代理地址",
  /* toast.check_syslog_port */ "请检查 Syslog 端口",
  /* toast.verifying_mqtt */ "正在验证 MQTT 连接…",
  /* toast.saving_syslog */ "正在保存 Syslog 设置…",
  /* toast.saving_ntp */ "正在保存 NTP 设置…",
  /* toast.trying_pins */ "正在测试引脚…",
  /* toast.saving_board */ "正在保存开发板硬件设置…",
  /* ota.uptodate */ "已是最新",
  /* ota.check_failed */ "检查失败",
  /* ota.starting */ "正在启动…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "正在重启…",
  /* ota.failed */ "更新失败",
  /* ota.timeout */ "超时",
  /* ota.cancelled */ "已取消",
  /* ota.busy */ "设备忙",
  /* ota.replaced */ "更新操作已改变 — 请重新检查",
  /* ota.unreachable */ "无法访问设备",
  /* ota.active_title */ "固件更新",
  /* ota.active_sub */ (detail) => `正在安装 · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `正在安装 · ${detail} · 最后收到的状态`,
  /* ota.snapshot_title */ "固件更新",
  /* ota.snapshot_label */ "数据状态",
  /* ota.snapshot_value */ "快照",
  /* ota.snapshot_help */ "这是页面重新加载前最后收到的状态。安装期间实时数据可能中断；重启前设置保持锁定。",
  /* ota.reload_hint */ "已安装 — 请重新加载页面",
  /* ota.dialog_title */ "固件更新",
  /* ota.switch_title */ "切换固件版本",
  /* ota.changes_title */ "此更新中的更改",
  /* ota.no_changes */ "此更新未提供更新日志。",
  /* ota.install_help */ "设备会下载并安装已签名镜像，然后重启。若新固件无法联网，设备会自动恢复当前版本。",
  /* ota.switch_help */ "由于选择了其他更新通道，此版本较旧。安装前会验证其签名；若旧版本无法联网，设备会自动恢复当前版本。",
  /* ota.install */ "安装更新",
  /* ota.switch */ "安装旧版本",
  /* aria.ota */ "检查固件更新",
  /* ota.title_check */ "点按检查固件更新",
  /* ota.title_avail */ (v) => `发现 v${v} — 点按安装`,
  /* mq.err_format */ "请输入 主机:端口，例如 192.168.1.10:1883；TLS 请用 mqtts://host:8883",
  /* sl.err_port */ "端口必须是 1 到 65535 的整数，例如 logs.example.com:514。",
  /* btn.saving */ "正在保存…",
  /* btn.verifying */ "正在验证…",
  /* btn.save */ "保存",
  /* btn.cancel */ "取消",
  /* btn.close */ "关闭",
  /* schem.card_aria */ "系统实时示意图：室外机、制冷剂回路、板式换热器、带备用加热器和三通阀的水回路、生活热水箱和空间调温回路",
  /* schem.group_aria */ "系统实时示意图——选择数值或部件可查看说明",
  /* schem.outdoor_unit */ "室外机",
  /* schem.defrost_pill */ "除霜",
  /* schem.outdoor */ "室外",
  /* insp.close */ "关闭",
  /* schem.defrost_transfer */ "确认正在除霜时，热量可能从水传向制冷剂。只有当前流量和温度支持这一判断时，管路才会显示该方向。",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "热水箱",
  /* schem.set */ "设定",
  /* schem.bsh_label */ "电加热",
  /* schem.space_circuit */ "空间回路",
  /* schem.heating */ "供暖",
  /* schem.cooling */ "制冷",
  /* schem.pump */ "水泵",
  /* schem.return */ "R4T",
  /* schem.room */ "室温",
  /* schem.flow_rate */ "流量",
  /* schem.water_press */ "水压",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "流量开关",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "WiFi 配置",
  /* wifi.ssid */ "WiFi 网络（SSID）",
  /* wifi.pass */ "WiFi 密码",
  /* wifi.err_ssid */ "SSID 必须为 1 到 32 个 UTF-8 字节",
  /* wifi.err_pass */ "密码必须为空（开放网络）或为 8 到 63 个 UTF-8 字节",
  /* wifi.hint */ "请输入 WiFi 网络名称。若设备无法连接，会自动恢复先前的 WiFi 设置。",
  /* mqtt.title */ "MQTT 代理",
  /* mqtt.hostport */ "主机 : 端口",
  /* mqtt.user */ "用户名 · 可选",
  /* mqtt.pass */ "密码 · 可选",
  /* mqtt.clear */ "删除已保存的凭据 — 匿名连接",
  /* mqtt.hint */ "用户名或密码必须使用加密 TLS 连接（mqtts://，例如 mqtts://host:8883）。主机留空可停用 MQTT。",
  /* mqtt.base */ "基础主题",
  /* mqtt.base_hint */ "每台设备须用独立基础主题，否则会共享主题、指标和 Home Assistant 设备。更改会重命名设备并留下旧 retained 主题。",
  /* err.mqtt_base_too_long */ "基础主题过长。",
  /* err.mqtt_base_wildcard */ "基础主题不能包含 + 或 #；它们是订阅通配符，代理不允许向其发布。",
  /* err.mqtt_base_reserved */ "基础主题不能以 $ 开头；该层级属于代理。",
  /* err.mqtt_base_slash */ "基础主题不能以斜杠开头或结尾。",
  /* err.mqtt_base_control */ "基础主题不能包含控制字符。",
  /* err.mqtt_base_space */ "基础主题不能包含空格。",
  /* err.mqtt_base_empty_segment */ "基础主题不能包含空段（//）。",
  /* err.mqtt_base_not_sluggable */ "基础主题必须至少含一个字母或数字，因为它会成为此设备在 Home Assistant 中的 ID；否则两台设备会冲突。",
  /* mqtt.err.waiting_x10a */ "X10A 未收到热泵响应 — 请检查接线、GND 和 RX/TX 引脚。",
  /* mqtt.err.task_alloc */ "无法启动 MQTT 任务 — 请重启设备并检查诊断信息。",
  /* mqtt.err.transport */ "连接代理的 TLS/TCP 失败。",
  /* mqtt.err.refused */ "代理拒绝连接 — 请检查用户名和密码。",
  /* mqtt.err.connection */ "连接 MQTT 代理失败。",
  /* dyn.state_gate */ "设备状态未知",
  /* dyn.state_mode */ "供暖/制冷模式未知",
  /* env.title */ "外部传感器",
  /* env.card */ "室外气象",
  /* env.none */ "无传感器",
  /* env.temperature */ "温度",
  /* env.humidity */ "湿度",
  /* env.pressure */ "气压",
  /* env.sensor_state */ "传感器",
  /* env.live */ "实时",
  /* env.collecting */ "正在采集…",
  /* env.history_title */ "ENV III 测量",
  /* env.history_help */ "ESP32 以五分钟间隔保存温度、湿度和气压的滚动 24 小时趋势。",
  /* env.history_scales */ "独立刻度",
  /* env.unavailable */ "传感器不可用",
  /* env.err_pins */ "SDA 和 SCL 必须是不同的有效引脚",
  /* env.saving */ "正在保存外部传感器配置…",
  /* env.checking */ "正在检查 ENV III…",
  /* env.err_not_reachable */ "当前无法通过这些 SDA/SCL 引脚访问 ENV III。",
  /* env.err_sht30 */ "无法通过这些引脚访问 ENV III 温湿度传感器。",
  /* env.err_qmp6988 */ "无法通过这些引脚访问 ENV III 压力传感器。",
  /* env.err_disable_first */ "更改 SDA/SCL 引脚前，请先选择“无传感器”并保存。",
  /* env.pins_hint */ "SDA=数据（黄线），SCL=时钟（白线）；若 GPIO 颠倒，固件会测试并保存相反顺序。",
  /* env.atoms3_header_hint */ "AtomS3 Lite：从 GPIO5–GPIO8、GPIO38 选两脚。X10A 未占 GPIO2/1 时才可用 Grove；串口与 I2C 不得共脚，ENV III 不可用 GPIO39。",
  /* circ.title */ "循环泵来源",
  /* circ.row */ "生活热水循环泵",
  /* circ.default_name */ "循环泵",
  /* circ.name */ "名称",
  /* circ.topic */ "MQTT 主题",
  /* circ.power_path */ "功率 JSON 路径",
  /* circ.time_path */ "时间 JSON 路径",
  /* circ.power_help */ "实际有功功率，单位 W；不使用继电器输出状态。",
  /* circ.time_help */ "RFC3339 或 Unix 秒格式的测量时间。",
  /* circ.on_threshold */ "开启阈值 · W",
  /* circ.off_threshold */ "关闭阈值 · W",
  /* circ.max_age */ "最大时效 · 秒",
  /* circ.confirm */ "确认时间 · 秒",
  /* circ.hint */ "仅只读。保存前会验证近期 MQTT 值，绝不会操作插座。",
  /* circ.settings_help */ "此卡片把水泵实际功率与水箱一小时干净降温时段关联，仅观察，绝不会操作插座。",
  /* circ.not_configured */ "未配置",
  /* circ.unavailable */ "不可用",
  /* circ.broker_off */ "无 MQTT 代理",
  /* circ.running */ "运行",
  /* circ.stopped */ "停止",
  /* circ.checking */ "检查中",
  /* circ.stale */ "过期",
  /* circ.waiting */ "等待消息",
  /* circ.detail.source */ "来源",
  /* circ.detail.power */ "有功功率",
  /* circ.detail.state */ "检测状态",
  /* circ.detail.age */ "测量时效",
  /* circ.delete */ "删除",
  /* circ.deleting */ "正在删除…",
  /* circ.deleted */ "循环泵来源已删除",
  /* circ.saved */ "循环泵来源已保存",
  /* circ.test_failed */ "未收到可读且最新的水泵功率值",
  /* circ.err_topic */ "请输入不含 + 或 # 通配符的精确 MQTT 主题",
  /* circ.err_power_path */ "请输入有功功率 JSON 路径，例如 apower",
  /* circ.err_time_path */ "请输入时间戳 JSON 路径，例如 aenergy.minute_ts",
  /* circ.err_max_age */ "最大时效必须是 10 到 3600 秒的整数",
  /* circ.err_confirm */ "确认时间必须是 1 到 600 秒的整数",
  /* circ.err_threshold */ "功率阈值最多保留一位小数",
  /* circ.err_order */ "开启阈值必须高于关闭阈值",
  /* syslog.title */ "Syslog 服务器",
  /* syslog.hostport */ "主机 : 端口",
  /* syslog.hint */ "请输入 Syslog 服务器主机名或 IP 地址及端口。留空可停用 Syslog。",
  /* ntp.title */ "NTP 服务器",
  /* ntp.server */ "服务器",
  /* ntp.hint */ "请输入时间服务器主机名或 IP 地址。留空使用固件默认值。",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "主机 · IP 或 .local 名称",
  /* homehub.port */ "端口",
  /* homehub.unit */ "单元 ID",
  /* homehub.hint */ "首次联网会搜索一次，也可手动搜索/输入。保存空地址将停用 HomeHub、Modbus 与相关诊断。默认端口 502、单元 ID 1；仅配置只读数据源。",
  /* hh.search */ "搜索",
  /* hh.searching */ "正在搜索…",
  /* hh.found */ (host) => `找到 HomeHub：${host}`,
  /* hh.not_found */ "未找到 HomeHub — 请手动输入地址。",
  /* hh.saved */ "Modbus 设置已保存",
  /* hh.err_port */ "端口必须为 1 到 65535",
  /* hh.err_unit */ "单元 ID 必须为 1 到 247",
  /* board.title */ "开发板硬件",
  /* board.ledtype */ "状态 LED",
  /* board.none */ "无",
  /* board.reset_section */ "复位按钮",
  /* board.env3_section */ "ENV III · 外部传感器",
  /* board.preset */ "开发板",
  /* board.preset_custom */ "自定义",
  /* board.not_selected */ "未选择",
  /* board.led_gpio */ "普通 LED（GPIO）",
  /* board.led_ws2812 */ "可寻址 RGB（WS2812）",
  /* board.ledpin */ "LED 引脚",
  /* board.btnpin */ "复位按钮引脚",
  /* board.ledlegend_rgb */ "LED 颜色和闪烁模式",
  /* board.ledlegend_gpio */ "LED 闪烁模式",
  /* board.led_rgb_off */ "熄灭 — 未启用任何网络。",
  /* board.led_rgb_setup */ "蓝色慢闪 — 配置门户已启动。",
  /* board.led_rgb_connecting */ "黄色快闪 — 正在连接网络。",
  /* board.led_rgb_healthy */ "绿色常亮 — X10A 及 MQTT（如已配置）已连接。",
  /* board.led_rgb_bus_down */ "红色双闪 — X10A 已断开或处于恢复模式。",
  /* board.led_rgb_mqtt_down */ "橙色闪烁 — X10A 已连接，MQTT 已断开。",
  /* board.led_rgb_wipe_armed */ "红色极速闪烁 — 已准备清除；松开可取消。",
  /* board.led_rgb_wiping */ "白色常亮 — 正在恢复出厂设置/清除数据；请勿断电。",
  /* board.led_gpio_off */ "熄灭 — 未启用任何网络。",
  /* board.led_gpio_setup */ "慢闪 — 配置门户已启动。",
  /* board.led_gpio_connecting */ "快闪 — 正在连接网络。",
  /* board.led_gpio_healthy */ "常亮 — X10A 及 MQTT（如已配置）已连接。",
  /* board.led_gpio_bus_down */ "双闪 — X10A 已断开或处于恢复模式。",
  /* board.led_gpio_mqtt_down */ "中速闪烁 — X10A 已连接，MQTT 已断开。",
  /* board.led_gpio_wipe_armed */ "极速闪烁 — 已准备清除；松开可取消。",
  /* board.led_gpio_wiping */ "极速闪烁后常亮 — 正在恢复出厂设置/清除数据；请勿断电。",
  /* board.ledinv */ "低电平有效（引脚为 LOW 时 LED 点亮）",
  /* board.btninv */ "低电平有效（按钮将引脚接到 GND）",
  /* board.hint */ "要恢复出厂设置，请按住按钮 5 秒。如果历史日志尚未就绪，则不会清除任何数据。重置会清除 Wi-Fi 等设置、已记录的历史数据、状态持续时间、原始崩溃转储和已保存的 MQTT 清理记录。开发板、LED 和按钮的设置会尽可能保留。清除失败时，可能已有部分数据被清除。只有所有清除操作都成功，设备才会重启。如果重置未开始或未完成，请查看 /diag。未连接按钮时，请选择“无”。",
  /* card.hardware */ "硬件",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite 是一款紧凑型 ESP32-S3 开发板，内置 WS2812 RGB 状态 LED。",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 是 Seeed Studio 的紧凑型 ESP32-S3 开发板。",
  /* card.hw_board_other */ (name) => `已选开发板：${name}。`,
  /* card.hw_active_low */ "低电平有效",
  /* card.hw_active_high */ "高电平有效",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind}，GPIO${pin}${active ? `，${active}` : ""}。`,
  /* card.hw_led_disabled */ "未配置。",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}，${active}。`,
  /* card.hw_btn_disabled */ "未配置。",
  /* card.hw_env_detail */ (sda, scl) => `SDA：GPIO${sda}，SCL：GPIO${scl}。`,
  /* card.hw_env_disabled */ "未配置。",
  /* card.firmware */ "版本",
  /* card.channel */ "更新通道",
  /* card.firmware_help */ "ESP32 当前运行的版本。点按数值可在所选更新通道中查找已签名固件镜像。",
  /* card.channel_help */ "稳定版跟随手动发布；开发版跟随最新相关集成。更改通道后会立即检查该更新流。",
  /* chan.release */ "稳定版",
  /* chan.dev */ "开发版",
  /* chan.saved */ (c) => `更新通道：${c}`,
  /* card.proto_title */ "协议",
  /* card.fw_title */ "固件",
  /* settings.diagnostics */ "设备诊断",
  /* card.language */ "语言",
  /* card.language_help */ "“浏览器”会使用浏览器语言偏好；选择具体语言后，整个设备界面固定使用该语言。",
  /* card.diagnostics */ "设备诊断",
  /* card.diagnostics_help */ "启用 24 小时设备检查和可选的循环泵功率监测。",
  /* diagnostics.off */ "已停用",
  /* diagnostics.saved_on */ "设备诊断已启用 — 现在开始采集",
  /* diagnostics.saved_off */ "设备诊断已停用 — 已停止采集",
  /* probe.toggle */ "协议诊断",
  /* probe.intro */ "直接读取 X10A 寄存器页，并可选择转换器进行解析。",
  /* probe.request */ "请求",
  /* probe.register */ "寄存器",
  /* probe.manual */ "手动输入",
  /* probe.page */ "寄存器页",
  /* probe.offset */ "载荷偏移",
  /* probe.size */ "字段宽度",
  /* probe.byte */ "字节",
  /* probe.bytes */ "字节",
  /* probe.converter */ "转换器",
  /* probe.page_help */ "十六进制或十进制 · 0…255",
  /* probe.offset_help */ "载荷索引 · 0…31",
  /* probe.size_help */ "要解码的字节数",
  /* probe.converter_auto */ "自动",
  /* probe.converter_auto_help */ size=>`尝试所有已实现的 ${size} 字节转换器。`,
  /* probe.conv_raw_byte */ "原始字节 · 0…255",
  /* probe.conv_unsigned_byte */ "无符号字节",
  /* probe.conv_tenth_byte */ "原始字节 × 0.1",
  /* probe.conv_unsigned_half_byte */ "无符号字节 × 0.5",
  /* probe.conv_signed_raw_le */ "有符号整数 · 小端序",
  /* probe.conv_signed_raw_be */ "有符号整数 · 大端序",
  /* probe.conv_signed_256_le */ "有符号 ÷ 256 · 小端序",
  /* probe.conv_signed_256_be */ "有符号 ÷ 256 · 大端序",
  /* probe.conv_signed_tenth_le */ "有符号 × 0.1 · 小端序",
  /* probe.conv_signed_tenth_be */ "有符号 × 0.1 · 大端序",
  /* probe.conv_signed_tenth_nodata_le */ "有符号 × 0.1 · 小端序 · 0x8000 = 无数据",
  /* probe.conv_signed_tenth_nodata_be */ "有符号 × 0.1 · 大端序 · 0x8000 = 无数据",
  /* probe.conv_signed_128_le */ "有符号 ÷ 256 × 2 · 小端序",
  /* probe.conv_signed_128_be */ "有符号 ÷ 256 × 2 · 大端序",
  /* probe.conv_signed_half_be */ "有符号 × 0.5 · 大端序",
  /* probe.conv_signed_hundredth_be */ "有符号 × 0.01 · 大端序",
  /* probe.conv_unsigned_raw_le */ "无符号整数 · 小端序",
  /* probe.conv_unsigned_raw_be */ "无符号整数 · 大端序",
  /* probe.conv_unsigned_half_be */ "无符号 × 0.5 · 大端序",
  /* probe.conv_saturation */ "压力 → 饱和温度",
  /* probe.conv_raw_fan */ "原始字节 / 风机级别",
  /* probe.conv_capacity */ "室内机容量代码",
  /* probe.conv_eeprom_digit */ "原始 EEPROM 数字",
  /* probe.conv_eeprom_pair */ "原始 EEPROM 数字对",
  /* probe.conv_bits_high */ "位 4–6 · 3 位计数器",
  /* probe.conv_bits_low */ "位 0–2 · 3 位计数器",
  /* probe.conv_operation_mode */ "运行模式",
  /* probe.conv_error_class */ "错误类别",
  /* probe.conv_error_code */ "Daikin 错误代码",
  /* probe.conv_indoor_mode */ "室内机模式 · 高半字节",
  /* probe.conv_hybrid_mode */ "混合模式",
  /* probe.conv_bit */ bit=>`位 ${bit} · 0 或 1`,
  /* probe.conv_unknown */ "未知转换器",
  /* probe.send */ "读取寄存器",
  /* probe.querying */ "正在查询…",
  /* probe.action_note */ "每个轮询周期一个请求。OTA 期间禁用。",
  /* probe.catalog_loading */ "正在加载当前配置文件…",
  /* probe.catalog_empty */ "没有可用的寄存器定义。",
  /* probe.catalog_error */ "无法加载配置文件寄存器。",
  /* probe.catalog_profile */ profile=>`配置文件：${profile}`,
  /* probe.catalog_fallback */ (definition,profile)=>`main/def：${definition} · 配置文件：${profile}`,
  /* probe.response */ "响应",
  /* probe.frame */ "帧",
  /* probe.payload */ "载荷",
  /* probe.slice */ "所选字节",
  /* probe.interpretation */ "解析",
  /* probe.response_for */ reg=>`寄存器 ${reg} 的响应`,
  /* probe.payload_marked */ "载荷 · 已标记所选字节",
  /* probe.slice_note */ (offset,size,slice)=>`偏移 ${offset} · ${size} 字节 · 0x${String(slice).replace(/\s+/g,"")}`,
  /* probe.full_frame */ "完整帧",
  /* probe.decode_value */ "转换结果",
  /* probe.no_decodes */ "没有转换结果。",
  /* probe.refused */ "值已丢弃",
  /* probe.unimplemented */ "未实现",
  /* probe.aliases */ "又名",
  /* probe.invalid */ "请检查页面、偏移、字段宽度和转换器。",
  /* probe.failed */ "查询失败。",
  /* probe.status_ok */ "响应有效",
  /* probe.status_busy */ "忙",
  /* probe.status_no_link */ "无 X10A 连接",
  /* probe.status_timeout */ "超时",
  /* probe.status_no_reply */ "无响应",
  /* probe.status_rejected */ "已拒绝",
  /* probe.status_bad_crc */ "校验和错误",
  /* probe.status_unexpected_reply */ "意外响应",
  /* probe.status_invalid_length */ "长度无效",
  /* probe.status_short_reply */ "响应不完整",
  /* probe.status_out_of_bounds */ "超出载荷范围",
  /* probe.status_error */ "错误",
  /* probe.transport_ok */ "帧完整且有效。",
  /* probe.transport_busy */ "已有另一个寄存器请求在执行。",
  /* probe.transport_no_link */ "X10A 连接不可用。",
  /* probe.transport_timeout */ "轮询任务未及时执行请求。",
  /* probe.transport_no_reply */ "未收到响应字节。",
  /* probe.transport_rejected */ "机组拒绝了此寄存器页。",
  /* probe.transport_bad_crc */ "已收到响应，但校验和无效。",
  /* probe.transport_unexpected_reply */ "响应属于另一个寄存器页。",
  /* probe.transport_invalid_length */ "响应声明的帧长度无效。",
  /* probe.transport_short_reply */ "只收到部分响应。",
  /* probe.transport_out_of_bounds */ "请求的字节超出此载荷范围。",
  /* probe.transport_error */ "请求失败。",
  /* lang.auto */ "浏览器",
  /* lang.de */ "Deutsch",
  /* lang.en */ "English",
  /* lang.es */ "Español",
  /* lang.fr */ "Français",
  /* lang.it */ "Italiano",
  /* lang.pl */ "Polski",
  /* lang.cs */ "Čeština",
  /* lang.uk */ "Українська",
  /* lang.zh */ "简体中文",
  /* lang.ja */ "日本語",
  /* lang.nb */ "Norsk",
  /* lang.sv */ "Svenska",
  /* lang.fi */ "Suomi",
  /* lang.saved */ "语言已保存",
  /* check.detail.source_stale_modbus */ "无新鲜Modbus样本；当前状态未知。保留历史。",
  /* mb.flow_scale_help */ "未确认的 /100 流量换算（待定/回退）；请对照机组显示 L/min。已从流向、ΔT、热功率和 24h 检查中排除。",
  /* hist.modbus_flow_unverified */ "未确认的 Modbus /100 换算（待定/回退）；请对照机组显示。",
  /* wf.label */ "性能系数",
  /* wf.short.partial */ "暂定",
  /* wf.short.limited */ "受限",
  /* wf.state.unsupported */ "不支持",
  /* wf.state.collecting */ "收集中",
  /* wf.state.standby */ "待机",
  /* wf.verdict.cheaper */ "比燃气省钱",
  /* wf.verdict.similar */ "与燃气相当",
  /* wf.verdict.more_expensive */ "比燃气费钱",
  /* wf.verdict.limited */ "受限",
  /* wf.verdict.measured */ "实测",
  /* wf.verdict.partial */ "暂定",
  /* wf.aria.estimate */ (v) => `估算 ${v}`,
  /* wf.kpi.breakeven */ (be) => `平衡点 ${be}`,
  /* wf.kpi.hp_cost */ "热泵",
  /* wf.kpi.gas_cost */ "燃气 · 88%",
  /* wf.kpi.delta */ "差额",
  /* wf.kpi.energy */ "24h 热量",
  /* wf.kpi.heat_elec */ (e) => `用电 ${e} kWh`,
  /* wf.scope.est */ "估算",
  /* wf.scope.comp */ "仅压缩机",
  /* wf.scale.label */ "平衡点",
  /* wf.scale.band */ (p) => `±${p}%`,
  /* wf.scale.cheaper */ "更省 →",
  /* wf.scale.expensive */ "← 更贵",
  /* wf.cta.tariffs */ "设置电/气价",
  /* wf.cta.edit_tariffs */ "修改价格",
  /* wf.desc.collecting */ (o) => `满 2 小时起显示 · 已记录 ${o}`,
  /* wf.desc.standby */ (o) => `运行量不足以计算 · 已观察 ${o}`,
  /* wf.desc.unsupported */ "缺少所需的流量、温度或电量输入。",
  /* wf.banner.stale */ "数据源信号过期 — 已暂停计算。",
  /* wf.banner.buh_limited */ "辅助电加热不在电量计量范围内 — 数值受限。",
  /* wf.banner.buh_unpaired */ "无出口传感器时辅助电加热开启 — 已排除。",
  /* wf.banner.bsh_excluded */ (d) => `水箱电加热 ${d} 已排除。`,
  /* wf.banner.ct_unwired */ "互感器为 0 A — 仅计入压缩机。",
  /* wf.ctx.window */ "时段",
  /* wf.ctx.power */ "电量来源",
  /* wf.ctx.outdoor */ "室外",
  /* wf.ctx.outdoor_range */ (avg, min) => `均 ${avg} °C · 低 ${min} °C`,
  /* wf.ctx.defrost */ "化霜",
  /* wf.ctx.buh */ "辅助电加热",
  /* wf.ctx.buh_inc */ (d) => `${d} · 已计入`,
  /* wf.ctx.cooling */ "制冷",
  /* wf.ctx.excluded */ (d) => `${d} 已排除`,
  /* wf.src.x10a_ct */ "互感器 · 整机",
  /* wf.src.x10a_inv */ "变频 · 仅压缩机",
  /* wf.foot.base */ "24h 供暖与热水 · 纯水 · 估算。",
  /* wf.foot.gas */ "24h 供暖与热水 · 纯水 · 88% 冷凝燃气炉，不含固定费 · 估算。",
  /* wf.gas.row */ "燃气费用对比",
  /* wf.gas.title */ "燃气与电价",
  /* wf.not_configured */ "未设置费率",
  /* wf.gas.detail.elec */ "电价",
  /* wf.gas.detail.gas */ "气价",
  /* wf.gas.detail.breakeven */ "平衡点",
  /* wf.gas.settings_help */ "24 小时热泵 vs 固定 88% Hs 现代冷凝燃气锅炉（纯水 4.186 kJ/(L·K)，不含固定费）。",
  /* wf.gas.elec_price */ "电价 / kWh",
  /* wf.gas.gas_price */ "气价 / kWh",
  /* wf.gas.currency */ "货币",
  /* wf.gas.preview */ (b) => `平衡点：${b}（±20%）`,
  /* wf.gas.preview_empty */ "输入电价和气价以计算平衡点。",
  /* wf.gas.hint */ "固定 88% Hs 现代冷凝燃气锅炉与纯水（4.186 kJ/(L·K)），供暖+热水，不含固定费。更新 24 小时。",
  /* wf.gas.delete */ "清除",
  /* wf.gas.deleting */ "正在清除…",
  /* wf.gas.saved */ "费率已保存",
  /* wf.gas.deleted */ "费率已清除",
  /* wf.gas.err_price */ "0.0001–99.9999。",
  /* wf.gas.err_currency */ "请选择支持的货币。",
]);
INSPECT_I18N.zh = inspectValues(
  ["无当前读数：", "压缩机已停；仅运行时更新的室外传感器会隐藏旧值。", "无法读取压缩机转速，室外机读数可能来自上次运行。"],
  [
    ["运行模式", "运行模式", "室内机模式；不能单独证明压缩机或水流运行。"], // status
    ["室外气象", "ENV III 室外气象", "ENV III 温湿度和气压；位置决定是否代表室外。"], // env3
    [(d) => d && d.sgSrc === "X10A" ? "Smart Grid 请求 · X10A" : "Smart Grid 请求 · Modbus", "Smart Grid 请求", (d) => d && d.sgSrc === "X10A"
      ? "SG-Ready 触点的四态外部指令；不是冷暖模式或水箱加热证明，网络指令未必反映在触点上。"
      : "HomeHub 读取的四态外部指令；不是冷暖模式或水箱加热证明。", (d) => !d || d.sgMode == null
      ? "无当前 Smart Grid 值。"
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "SG-Ready 触点建议增载；热水模式、3WV 和流量才证明水箱加热。"
      : d.sgMode === 2
      ? "HomeHub 建议增载；热水模式、3WV 和流量才证明水箱加热。"
      : d.sgMode === 1 ? "能源管理器报告“强制关闭”。"
      : d.sgMode === 3 ? "能源管理器报告“强制开启”。"
      : "无外部 Smart Grid 请求；机组自主运行。"], // sgrequest
    ["室外机", "室外机", "风机换热、压缩机升高制冷剂压力和温度；示意不代表所有机型布局。", (d) => d.defrost
      ? "除霜中：制冷剂反向融冰，短暂从水路取热。"
      : compressorRunning(d)
      ? d.rps != null
        ? `运行中：压缩机 ${fmt0(d.rps)} rps${d.quiet ? "，受静音模式限制" : ""}。`
        : "运行中：HomeHub 确认启动；转速等需 X10A。"
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "待机：X10A 室外值停更；室外空气改用 Modbus，测量时间未知。"
      : "待机：无主动换热；隐藏停更的室外传感器。"], // ou
    ["压缩机", "压缩机", "压缩制冷剂；rps 是转速，不等于热功率或电功率。"], // comp
    ["室外空气", "室外空气温度", "室外机传感器附近的空气温度，受日照、安装位置和风影响；待机时隐藏滞留的 X10A 值或改用 HomeHub。"], // out
    ["室外换热器 · R4T", "室外换热器 R4T 温度", "供暖时可低于 0 °C 并结霜，须结合除霜状态。"], // ouhx
    ["高压", "制冷剂高压", "制冷剂高压侧压力，运行或待机均可能可用；不是水压。"], // hp
    ["排气温度", "压缩机排气温度", "压缩机出口气温；待机时隐藏 X10A 滞留值。"], // disch
    ["低压", "制冷剂低压", "制冷剂低压侧压力；部分配置无有效读数。"], // lp
    ["膨胀阀", "电子膨胀阀", "控制脉冲调节制冷剂；不是开度百分比或位置反馈。"], // eev
    ["液侧制冷剂 · R3T", "液侧制冷剂 R3T 温度", "室内换热器液侧制冷剂温度，不是回水。"], // r3t
    ["板式换热器", "板式换热器 PHE", "PHE 隔离传热；功率由流量与 R1T/R4T 估算，传感器位置随型号。", (d) => !compressorRunning(d, 5)
      ? "压缩机已停；水泵搬运余热不算主动冷暖功率。"
      : d.dtStale ? "水泵/流量未证明流经 PHE，无法计算。"
      : d.pth == null ? "读数无法估算当前模式的有效换热。"
      : d.pthKind === "cooling" ? `约从水中带走 ${fmt1(d.pth)} kW：${fmt1(d.flow)} l/min，ΔT ${fmt1(d.dt)} K。`
      : `约向水中传递 ${fmt1(d.pth)} kW：${fmt1(d.flow)} l/min，ΔT ${fmt1(d.dt)} K。`], // phe
    ["PHE 出水 · BUH 前 · R1T", "PHE 出水温度 BUH 前 R1T", "PHE 出口、BUH 前水温；不含 BUH 电热。"], // lwt
    ["BUH 后出水 · R2T", "BUH 后出水温度 R2T", "BUH 后水温，可能含电热；确切位置随水力模块。"], // r2t
    ["PHE 入口 · R4T", "PHE 回水温度 R4T", "PHE 入口的内部回水温度，不专指建筑末端。"], // rwt
    ["PHE 水侧 ΔT", "PHE 水侧温差", "R1T−R4T；结合流量描述 PHE 换热，不等于末端供回水。", (d) => d.dtStale ? "水泵/流量未证明循环，无工作 ΔT。"
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K，仅水泵余热均衡，不是热功率。`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K；制冷时 R1T<R4T，故为负。`
      : `${fmt1(d.dt)} K；正值表示 PHE 向水供热。`], // dt
    [(d) => d && d.pthKind === "cooling" ? "制冷功率估算" : "热功率估算", "PHE 热功率估算", (d) => d && d.pthKind === "cooling"
      ? "流量×(R4T−R1T)×4.186，按水估算制冷；受传感器/介质影响，仅压缩机运行且方向有效时显示。"
      : "流量×(R1T−R4T)×4.186，按水估算供热；受传感器/介质影响，不含 R1T 下游 BUH。", (d) => d.dtStale ? d.bsh === true
      ? "PHE 无循环证明；BSH 可直接加热水箱，但此处无法量化。"
      : "未证明流经 PHE，故不计算；这不表示 0 kW。"
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW 制冷${d.cop != null ? `；EER ${fmt1(d.cop)}` : ""}。`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `；COP ${fmt1(d.cop)}` : ""}。`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "热泵 EER 估算" : d && d.copScope === "plant" ? "BUH 后 COP 估算" : "热泵 COP 估算", "效率估算", (d) => d && d.efficiencyKind === "eer"
      ? "制冷功率÷输入功率；继承介质、传感器、电压/功率因数误差，是瞬时 EER，非季节效率。"
      : "边界相容的热功率÷输入功率：有 R2T 时 CT 算 BUH 后，否则逆变器电流仅算热泵；瞬时值非认证计量。", (d) => d.copBlock === "tank_heater" ? "无 COP：电功率可能含 BSH，但其水箱热量不经过出水传感器，边界不一致。"
      : d.copBlock === "buh_no_r2t" ? "无 COP：BUH 启动却无下游传感器，电热边界不一致。"
      : d.copBlock === "mb_scope" ? "无法计算 COP。HomeHub 指南未说明输入功率包含哪些用电设备。估算的热量仅对应板式换热器。计算 COP 前必须确认两个数值的测量范围一致。"
      : d.copBlock === "no_pel" ? d.pelHeld ? "无 COP：停机后逆变器电流是旧值。" : "无 COP：无 CT 或逆变器电流。"
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `每 1 kW 电约制冷 ${fmt1(d.cop)} kW：${fmt1(d.copPth)} / ${fmt1(d.pel)} kW。`
      : d.copScope === "plant" ? `CT：每 1 kW 电在 BUH 后约供热 ${fmt1(d.cop)} kW（${fmt1(d.copPth)} / ${fmt1(d.pel)} kW）；负载取决于接线。`
      : `热泵边界：每 1 kW 电约供热 ${fmt1(d.cop)} kW（${fmt1(d.copPth)} / ${fmt1(d.pel)} kW），不含 BUH。`], // cop
    ["备用加热器 · BUH", "备用加热器 BUH", "R1T 下游水路电热，不是水箱 BSH。", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "2 级：两级加热。" : d.buh1 ? "1 级：一级加热。" : "BUH 各级关闭。"], // buh
    ["水箱电加热器", "水箱电加热器 BSH", "水箱浸入式 BSH；可独立加热，X10A 只报状态不测功率。", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "BSH 已启动。" : "BSH 已关闭。"; }], // bsh
    ["三通阀", "三通阀 3WV", "逻辑输出选择水箱/空间；不反馈机械位置或流量。", (d) => d.valveDhw == null ? null : d.valveDhw ? "指示水箱路径；不证明位置、流量或加热。" : "指示空间路径；不证明位置或循环。"], // valve
    ["二通阀输出", "二通阀输出 2WV", "空间 2WV 的 X10A 输出；不反馈位置或冷暖模式。", (d) => d.valve2On == null ? null : d.valve2On ? "2WV 输出启动；不证明供暖或位置。" : "2WV 输出关闭；不表示制冷，也不否定待机供暖模式。"], // valve2
    ["生活热水箱", "生活热水箱或蓄热罐", "R5T 测量的生活热水箱或蓄热罐。水箱加热、目标和 BSH 状态分别显示。"], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "制冷回路" : activeSpaceKind(d) === "heat" ? "供暖回路" : "空间回路", "空间调温回路", "散热器、地暖或风机盘管；R1T/R4T 在机内，不能确认末端温度。", (d) => d.valveDhw === true ? "未选空间路径；泵/流量另证水箱循环。"
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `余热流向空间回路；R1T ${degC(d.lwt)}，无末端传感器；非主动制冷。`
        : `水流向${activeSpaceKind(d) === "cool" ? "制冷" : activeSpaceKind(d) === "heat" ? "供暖" : "空间"}回路；机内 R1T ${degC(d.lwt)}，末端未测。`
      : "泵/流量未证明空间支路循环。"], // heat
    ["空间运行", "空间供暖或制冷运行", "空间冷暖运行信号；不是温控需求或压缩机证明。"], // spaceh
    ["室温", "室温", "参考区域温度与目标；含义取决于位置。"], // room
    ["循环泵", "循环泵", "反向 X10A 信号（0 = 最大，100 = 停机，[0, 100] → 100–0 %）不测量 RPM，也不证明旋转、扬程或流量；开关状态与流量分开查看。", (d) => pumpNowText(d, [(n) => `水泵指令 ${n} %。`, "泵状态为开启。", "水泵报告停机。", "水泵开关状态未知。", (n) => `实测流量 ${n} l/min。`, "无流量数据。", "报告停机与实测流量矛盾，可能存在外泵、延时停机或旧信号。", "尚不能确认水循环。"])], // pump
    [(d) => pelMeasured(d) ? "电功率 · HomeHub" : "电功率估算", "电功率", (d) => pelMeasured(d)
      ? "HomeHub 输入 51 的耗电；校准、测点和所含加热器未公开，不是认证总表。"
      : "COP/EER 输入估算：CT 按声明相与 230 V，未知真实电压/功率因数；逆变器电流仅含压缩机。", (d) => d.pelHeld ? "停机后逆变器电流是旧值，不能显示耗电/效率。"
      : d.pel == null ? "无当前电气读数，不能计算 COP/EER。"
      : d.pelSrc === "MB" ? "HomeHub 输入 51；测量边界未公开。"
      : d.pelSrc === "CT" ? "CT 估算；负载取决于接线。"
      : "逆变器电流估算，仅含压缩机。"], // pel
    ["除霜", "除霜", "反转制冷剂回路融冰；寒湿时正常，会短暂从水路取热。", (d) => d.defrost == null ? null : d.defrost ? "除霜中。" : "未除霜。"], // defrost
    ["静音模式", "静音模式", "降噪且常限制转速/功率；信号不含级别或热量影响。", (d) => d.quiet == null ? null : d.quiet ? "静音已启用。" : "静音已关闭。"], // quiet
    ["气管", "制冷剂气管", "分体机气管：供暖时热气流向 PHE，制冷反向；一体机无现场管。", (d) => compressorRunning(d) ? d.rps != null ? `${fmt1(d.circP)} bar，${fmt0(d.disch)} °C。` : "HomeHub 确认循环；压力/排温需 X10A。" : "压缩机已停，无主动循环。"], // rhot
    ["液管", "制冷剂液管", "分体机液管：供暖时冷凝液返回室外阀，制冷反向；一体机无现场管。", (d) => compressorRunning(d) ? d.rps != null ? `膨胀阀 ${fmt0(d.eev)} 脉冲。` : "HomeHub 确认循环；阀位需 X10A。" : "压缩机已停，无循环。"], // rcold
    ["PHE 出水管", "PHE 出水管", "R1T 后水经 BUH、泵和 3WV；R1T 位于 BUH/支路前。", (d) => waterMoving(d) ? `BUH 前 R1T ${degC(d.lwt)}，${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "；BUH 启动" : ""}。` : "泵/流量未证明循环。"], // wsup
    ["水箱回路", "水箱水路", "水箱/蓄热罐支路；内部结构随型号，图仅示功能。", (d) => d.valveDhw === true ? waterMoving(d) ? `水箱路径：${fmt1(d.flow)} l/min，PHE ${degC(d.lwt)}，水箱 ${degC(d.tank)}。` : "已选水箱，但泵/流量未证明加热。" : "未选水箱；指示空间回路。"], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "制冷支路" : activeSpaceKind(d) === "heat" ? "供暖支路" : "空间支路", "空间水路支路", "通往建筑末端；R1T/R4T 在机内，不能证明支路温度或负荷。", (d) => d.valveDhw === true ? "未选空间支路；指示水箱。"
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `余热 ${fmt1(d.flow)} l/min；非主动制冷。R1T ${degC(d.lwt)}，R4T ${degC(d.ret)}；末端未测。`
        : `${fmt1(d.flow)} l/min；机内 R1T ${degC(d.lwt)}，R4T ${degC(d.ret)}。`
      : "泵/流量未证明空间支路循环。"], // wheat
    ["PHE 回水管", "PHE 回水管", "支路汇合后经 R4T 回 PHE；不是末端专用传感器。", (d) => waterMoving(d) ? `${degC(d.ret)}，${fmt1(d.flow)} l/min，${fmt1(d.wp)} bar。` : "泵/流量未证明回水循环。"], // wret
    ["流量", "水流量", "公共水路流量；最低值随型号，须结合泵和压力。"], // flow
    ["流量开关状态", "流量开关状态", "X10A 二进制输入；不测 l/min 或确认最低流量。", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A 启动；结合泵和 ${fmt1(d.flow)} l/min。` : `X10A 未启动；结合 ${fmt1(d.flow)} l/min 与 7H/C0。`], // flow_switch
    ["水压", "水路压力"], // wp
  ],
);

HOMEHUB_LABEL_I18N.zh = homeHubValues([
  "供暖出水目标 · 主区域", // 1
  "制冷出水目标 · 主区域", // 2
  "供暖或制冷模式", // 3
  "空间调温已启用", // 4
  "供暖目标 · 主区域", // 6
  "制冷目标 · 主区域", // 7
  "静音模式", // 9
  "生活热水再加热目标", // 10
  "热水再加热开启/关闭", // 12
  "热水强力/加速模式", // 13
  "机组诊断状态", // 21
  "机组故障代码", // 22
  "机组故障子代码", // 23
  "循环泵运行", // 30
  "压缩机运行", // 31
  "BSH 运行", // 32
  "水箱消毒运行", // 33
  "化霜 / 重启", // 35
  "热启动", // 36
  "3WV 位置", // 37
  "当前供暖或制冷模式", // 38
  "PHE 出水温度", // 40
  "BUH 后出水温度", // 41
  "回水温度", // 42
  "生活热水箱温度", // 43
  "室外温度", // 44
  "液侧制冷剂温度", // 45
  "流量", // 49
  "主区域室温", // 50
  "输入电功率", // 51
  "生活热水运行", // 52
  "空间调温运行", // 53
  "出水修正 · 主区域", // 54
  "制冷出水偏置 · 主区域", // 55
  "Smart Grid 模式", // 56
  "蓄热功率上限", // 57
  "总功率上限", // 58
]);

DESCRIPTION_I18N.zh = descriptionValues([
  ["生活热水箱/蓄热罐目标温度。"], // 0
  ["水箱第二传感器读数，如下部传感器。"], // 1
  ["水箱 R5T 温度。"], // 2
  ["强力模式加热至舒适/蓄热目标。"], // 3
  ["X10A 预热；非 HomeHub 消毒信号或消毒证明。"], // 4
  ["HomeHub 输入 33 消毒状态；两次 Modbus 轮询间的短脉冲可漏记。"], // 5
  ["室外温控状态；不同于室内需求，不证明压缩机运行。"], // 6
  ["室外静音位；级别和触发源未证实。"], // 7
  ["水路太阳能输入；功能和极性未证实。"], // 8
  ["重启等待/启动阶段，不表示供热；启动附近短暂 ON 可正常。"], // 9
  ["将制冷剂油送回压缩机的回油运行。"], // 10
  ["制冷剂压力均衡阶段；不是压力或阀位测量。"], // 11
  ["室外专有需求位；请求层级未公开，仅供相关性观察。"], // 12
  ["4WV 命令/状态，非位置反馈；极性须结合模式/温度。"], // 13
  ["曲轴箱加热命令/状态；不测电流/温度，停机时也可启动。"], // 14
  ["专有电磁阀/输出位；名称不证明动作或极性。"], // 15
  ["室内故障子代码；无型号验证映射，零不排除主故障。"], // 16
  ["地暖截止阀命令/状态；非位置/流量反馈，极性未确认。"], // 17
  ["室内“系统关闭”位；ON 不证明泵、加热器和保护均断电。"], // 18
  ["附加区域外部温控输入；不是室温或压缩机状态。"], // 19
  ["主区域温控需求；不证明所请求模式已输出。"], // 20
  ["四个原始限功率位之一；编码未证实时勿推导级别。"], // 21
  ["PHE 加热器命令/状态；命令或反馈未明，不证明电流。"], // 22
  ["保持寄存器 12 中的生活热水自动再加热允许位；ON = 允许，OFF = 关闭，不证明正在加热。"], // 23
  ["保持寄存器 13 中的生活热水强力/加速模式请求位；ON = 请求或运行中，OFF = 常规运行。"], // 24
  ["水箱低于启动阈值后再加热至目标。"], // 25
  ["定时预设：舒适目标较高，经济目标较低。"], // 26
  ["混合系统向锅炉发出的热水请求。"], // 27
  ["3WV：1=热水、0=空间；阀位不证明运行。"], // 28
  ["2WV 的 X10A 输出；不证明模式、电压或位置。"], // 29
  ["第二区域混水阀开度。"], // 30
  ["当前冷暖模式的出水目标。"], // 31
  ["第二区域混水阀下游温度。"], // 32
  ["BUH 后 R2T；可含电热，但非建筑末端温度。"], // 33
  ["PHE 后、BUH 前 R1T；配合 R4T/流量估算功率，位置随型号。"], // 34
  ["PHE 回水 R4T；须结合流量/压缩机/模式，无统一 5 K。"], // 35
  ["公共水流量；最低值随型号/模式，过低可触发 7H。"], // 36
  ["封闭液压回路中的水压。","许多 Altherma 手册要求泵入口的压力高于 1 bar。允许的压力范围取决于机型、安装高度和膨胀罐。压力为 1.0 bar 或更低时，请查阅相应机型的手册。"], // 37
  ["反向 X10A 指令：0 = 最大，100 = 停机（[0, 100] → 100–0 %）。不测 RPM 也不证明旋转、扬程或流量；请分开查看开关状态与流量。"], // 38
  ["泵状态；须结合流量，运行不证明换热。"], // 39
  ["太阳能回路泵状态；不同于热泵水路泵。"], // 40
  ["配置所命名泵速；刻度/回路随型号。"], // 41
  ["X10A 流量开关：ON=检测流动，非 l/min/最低流量；部分型号无实体触点。"], // 42
  ["水路/室内模式：停、暖、冷、热水或组合；不证明运行。"], // 43
  ["HomeHub 或两个 X10A 触点的四态 Smart Grid 指令；非冷暖模式。"], // 44
  ["当前空间冷暖模式；不证明压缩机启动。"], // 45
  ["HomeHub 配置的自动/暖/冷选择；非室外机当前状态。"], // 46
  ["室外机停/暖/冷状态；停机仍可保留选择，不证明供热。"], // 47
  ["HomeHub 输入寄存器 35 合并了除霜和压缩机重启两种状态。", "稳定运行时信号关闭。信号开启表示正在除霜或准备重启。"], // 48
  ["输入寄存器 36 中的热启动标志；OFF = 稳定运行，ON = 恢复供水前的短暂换热器预热。"], // 49
  ["除霜用于清除室外换热器上的霜。", "寒冷潮湿时除霜属正常现象。仅凭此信号无法判断除霜是否过于频繁。"], // 50
  ["当前故障严重级别：正常、错误、警告或提醒。"], // 51
  ["当前所报告故障代码的含义"], // 52
  ["故障后应急运行，可使用 BUH/锅炉。"], // 53
  ["报警继电器向外部系统报告机组故障。"], // 54
  ["主区域冷暖目标室温。"], // 55
  ["内部 thermo ON 需求；不说明负载或压缩机；Space heating Operation 输出也非需求。"], // 56
  ["Space H Operation 电气输出，非正常空间运行状态。"], // 57
  ["正常空间冷暖启用/运行；非温控需求，制冷待机也可 ON。"], // 58
  ["机组自身传感器控制区的目标室温。"], // 59
  ["内置/有线传感器室温；用途取决于控制方式。"], // 60
  ["排温保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 61
  ["逆变器电流保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 62
  ["高压保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 63
  ["低压保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 64
  ["逆变器温度保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 65
  ["其他内部限功率位；不能诊断原因。"], // 66
  ["PHE 入口或出口水温；PHE 在制冷剂与水路之间传热。"], // 67
  ["室外换热器温度；低于 0 °C 可正常，单值不证明结冰。"], // 68
  ["机组测得的室外温度，用于气候补偿和运行决策；日照、安装位置和风会使其不同于天气观测值。"], // 69
  ["压缩机出口热气；随压力、转速、模式和负荷变化。单值或其他系列的范围不能证明故障或制冷剂不足。"], // 70
  ["返回压缩机的低温低压吸气制冷剂温度。"], // 71
  ["两个换热器之间液管内的制冷剂温度。"], // 72
  ["蒸发器入口或出口的制冷剂温度。"], // 73
  ["制冷剂喷气管温度，供机组控制喷气和保护循环。"], // 74
  ["制冷剂回路气液两相区温度，不是设定值。"], // 75
  ["室外除霜传感器；位置和控制因型号而异。单点不能证明整盘管结冰或除霜结束。"], // 76
  ["由压力换算的饱和温度；不是独立传感器，也不是 bar 压力。"], // 77
  ["高/低压应看同型号同模式的稳定趋势；启动、回油和除霜会改变压力。没有通用正常范围。"], // 78
  ["压缩机转速 rps；范围随型号，不等于热功率。"], // 79
  ["EEV 步数是命令，无机械反馈，不是开度%或流量；单独不能证明动作、卡滞或制冷剂不足。"], // 80
  ["室外风机电机控制电子器件的温度。"], // 81
  ["室外风机速度，以级别或 rpm 表示。"], // 82
  ["内部目标随型号/模式变化；与对应压力换算的饱和温度比较。偏差不能诊断原因或充注量。"], // 83
  ["保护逻辑的压缩机排气/端口目标温度。"], // 84
  ["供回水目标 ΔT 随型号/模式/末端，无统一 5 K。"], // 85
  ["机组所充制冷剂，如 R32 或 R410A；决定压力—温度曲线。"], // 86
  ["压缩机端口测得的温度，用于内部监控和保护。"], // 87
  ["室外机制冷剂回路压力读数。"], // 88
  ["CT 的 L1/L2/L3 电流；仅完整相组按 230 V 粗估，未校准且忽略真实电压/功率因数。"], // 89
  ["压缩机逆变器电流；仅近似反映压缩机负载。"], // 90
  ["室外逆变器/功率电子散热器温度。"], // 91
  ["BUH 启动级；0=无，可用于低温、除霜、热水、消毒或应急。"], // 92
  ["水力模块 BUH 电阻级；0=无，允许原因/均衡温度取决于型号/设置。"], // 93
  ["HomeHub 输入 32 是 BSH 状态非功率；输入 51 也非 BSH 自身功率。"], // 94
  ["水箱浸入式 BSH，可独立加热；X10A 只报 ON/OFF，不报功率。"], // 95
  ["电加热器热保护链状态；开路时需结合故障代码并检查电气回路。"], // 96
  ["水管防冻范围/触发随型号；须持续供电，停电不保证。"], // 97
  ["X10A 防冻状态；无确切型号资料则未知涉及的泵/加热器/区域。"], // 98
  ["地源盐水回路/泵；介质、浓度、压力、温度限值取决于安装和手册。"], // 99
  ["混合热源选择：热泵/联合/锅炉；非实测供热。"], // 100
  ["混合供暖出水目标，非实测水温；须结合模式/实温。"], // 101
  ["第二热源双价许可/状态；ON 不证明锅炉燃烧。"], // 102
  ["向锅炉的双价/混合请求；不证明燃烧或供热。"], // 103
  ["锅炉请求水温目标，非实测；范围取决于安装。"], // 104
  ["内部双价比较值 BE_COP；X10A 含义和刻度未公开，不是当前 COP。"], // 105
  ["电网/Smart Grid/太阳能输入；动作取决于配置，ON 仅表示触点有效。"], // 106
  ["室内/外机固定额定容量或代码；非当前测量。"], // 107
  ["静音模式降低室外噪声，也可能限制可用供暖或制冷容量。"], // 108
  ["HomeHub 诊断状态：无错误、故障或警告；状态本身不能说明原因。"], // 109
  ["当前所报告故障代码的含义"], // 110
  ["Daikin 数字故障子码；须与状态/主码同读，不可用时隐藏。"], // 111
  ["HomeHub 压缩机 ON/OFF；无转速/容量，须结合运行、阀位、流量。"], // 112
  ["正常生活热水运行是否启动，不说明启动原因。"], // 113
  ["正常空间供暖或制冷运行是否启动。"], // 114
  ["PHE 后、BUH 前水温；仅有循环时可与回水算 ΔT。"], // 115
  ["BUH 后出水；比 PHE 高可表示电热，但须由 BUH 状态确认。"], // 116
  ["生活热水箱内测得的水温。"], // 117
  ["液管制冷剂温度；关系随模式，孤立值不能诊断。"], // 118
  ["遥控器报告的主区域室温。"], // 119
  ["HomeHub 整机耗电；随模式/负载，不能全归于压缩机。"], // 120
  ["HomeHub 只读供暖出水目标；固定或气候补偿，仅保持室温时降低才可能增效。"], // 121
  ["HomeHub 只读制冷出水目标；仅支持并启用制冷时相关，否则仍可显示配置值。"], // 122
  ["空间回路是否启用：这是总开关，不是当前运行状态。"], // 123
  ["静音运行降低噪声，也可能限制可用容量。"], // 124
  ["热水再加热目标，非启动阈值；启动还取决于回差/程序。"], // 125
  ["供暖出水目标 −10…+10 K 修正；只读，非零且未运行不证明供热。"], // 126
  ["制冷出水目标 −10…+10 K 修正；只读，非零且未处于制冷运行不证明制冷。"], // 127
  ["Smart Grid“建议开启”蓄热上限；与总上限取低值，非当前耗电。"], // 128
  ["HomeHub 总功率上限，自由运行也适用；是配置非实测，调低会限制各 Smart Grid 模式。"], // 129
]);

MODEL_DESCRIPTION_I18N.zh = modelDescriptionValues([
  ["显示热泵报告的故障和警告代码；简短说明为大金通用提示，代码清除并不证明原因已排除。"], // health_fault
  ["水箱详情视图中水箱传感器 R5T 采纳的最大每小时温度下降。", "≥0.8 K/h 的时段会在水箱图表中高亮显示。R5T 只是分层水箱中的一个测点，并非实测水箱能量。内部水泵及类似取水标记可提示可能的原因，但既不能证明其中之一，也不能排除其他热损失。"], // health_dhw_loss
  ["测量有缺口时，部分启动可能漏计。", "启动次数没有固定的正常值。数据充足时，本项检查将已完成的供暖运行平均达到 10 分钟视为时长足够。"], // health_cycling
  ["除霜", "≥3次配对、>15%压缩机运行时间，仅计压缩机及除霜状态均可读时段。项目规则非Daikin限值；缺少湿度及整个盘管温度。"], // health_defrost
  ["封闭水路24小时水压曲线（X10A，5分钟最小值）。", "曲线说明：>1.0 bar正常，≤1.0 bar偏低，≤0.5 bar危急（连续60秒触发诊断）。允许充注与运行压力取决于具体机型手册及系统高度；单凭读数不能证明漏水或故障。"], // health_pressure
  ["内置水泵连续运行 60 秒后的最低流量；另附供暖启动 600 秒后按样本加权的水温差、流量与水泵指令统计。", "非额定流量，也不证明部分负荷。仅覆盖公共水侧换热器。水泵指令不代表转速或扬程。600 秒项目筛选（允许 ≤15 秒间隔）不证明稳定运行，也不作目标对比或水力成因判断。"], // health_flow
  ["BUH/BSH的ON时间", "非能量，不证明加热多余。"], // health_heater
  ["5个实验计数器", "可比增长；忽略缺口/重置。稳定不排除限功率，也不证明原因。"], // health_retries
  ["RAM 24小时曲线稳定或回升正常；持续下降可能泄漏。兼容通电重启可保留RAM曲线。5分钟粒度可能隐藏短暂停机。否则，须时间同步，闪存仅恢复日志内带时间的兼容区间。未完/最近未存区间可能丢失。"], // free_heap
  ["TLS/OTA 需要足够大的连续内存块；总 RAM 稳定而最大连续块下降，可能表示内存碎片。"], // max_alloc
  ["识别页给出的室外机额定容量，不是当前热输出。"], // capacity
  ["室内机额定容量；不能当作室外机或整套系统容量。"], // capacity_iu
  ["多个 Daikin 系列共用寄存器和容量，故无法仅凭总线区分确切型号；读数仍有效，型号以铭牌为准。"], // candidates
  ["缺少室外机容量时，候选型号可能不同；固件采用最佳室内匹配但不保证准确，应核对铭牌。"], // candidates_nocap
  ["室外机识别字节没有公开型号名称映射；如有歧义，请与铭牌核对。"], // oueeprom
]);

FAULT_CODE_I18N.zh = faultCodeValues([
  "水流异常", // 7H
  "回水温度传感器故障", // 80
  "出水温度传感器故障", // 81
  "换热器防冻保护已启动", // 89
  "生活热水出口水温异常升高", // 8F
  "出水温度异常升高", // 8H
  "过零检测故障", // A1
  "高压削峰或防冻保护异常", // A5
  "BUH 过热或未连接", // AA
  "BSH 过热", // AC
  "水箱防军团菌消毒未完成", // AH
  "生活热水加热超时", // AJ
  "流量传感器故障", // C0
  "换热器温度传感器故障", // C4
  "换热器传感器故障", // C5
  "室温传感器故障", // CJ
  "室外机 PCB 故障", // E1
  "漏电流检测故障", // E2
  "室外机高压开关已动作", // E3
  "吸气压力故障", // E4
  "室外机变频压缩机电机过热", // E5
  "室外机压缩机启动失败", // E6
  "室外机风扇电机故障", // E7
  "室外机输入过压", // E8
  "电子膨胀阀故障", // E9
  "室外机制冷/制热切换异常", // EA
  "水箱温度异常升高", // EC
  "室外机排气管温度异常", // F3
  "室外机制冷时压力异常偏高", // F6
  "室外机压力异常偏高，高压开关已动作", // FA
  "室外机电压/电流传感器故障", // H0
  "外部温度传感器故障", // H1
  "室外机高压开关故障", // H3
  "压缩机过载保护故障", // H5
  "室外机位置检测传感器故障", // H6
  "室外机压缩机输入（CT）系统故障", // H8
  "室外机室外空气温度传感器故障", // H9
  "水箱温度传感器故障", // HC
  "水压传感器故障", // HJ
  "室外机排气管传感器故障", // J3
  "室外机换热器传感器故障", // J6
  "室外机高压传感器故障", // JA
  "变频器 PCB 故障", // L1
  "室外机控制箱温升异常", // L3
  "室外机变频器散热片温升异常", // L4
  "检测到室外机变频器直流过流", // L5
  "变频器 PCB 热保护已动作", // L8
  "压缩机锁定保护", // L9
  "室外机通信系统故障", // LC
  "电源缺相或相间不平衡", // P1
  "检测到直流异常", // P3
  "室外机散热片温度传感器故障", // P4
  "容量设置不匹配", // PJ
  "室外机制冷剂不足", // U0
  "反相或缺相故障", // U1
  "室外机电源电压故障", // U2
  "地暖地坪干燥功能未正确完成", // U3
  "室内机与室外机通信异常", // U4
  "用户界面通信异常", // U5
  "室外机主 CPU 与变频器 CPU 传输故障", // U7
  "外部设备（LAN 适配器/室温控制器/USB）通信异常", // U8
  "室内机与室外机组合或兼容性异常", // UA
  "检测到管路接反或通信接线故障", // UF
], "当前未传输故障代码。", "未保存此代码的简短说明。");

MB_DELTA_I18N.zh = mbDeltaValues([
  "压缩机停机时，X10A 保留上次运行值；独立轮询的 HomeHub 寄存器可继续变化，但没有测量时间戳",
  "两者从不同的室温控制器读取室温",
]);
