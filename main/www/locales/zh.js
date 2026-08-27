// translation-source: 5168982ac8a7dbd59eda7c9c9076626f265279f5292a597c01c727c875cd59bc
I18N.zh = localeValues([
  /* sys.nodata */ "无数据",
  /* sys.unreachable */ "无法访问",
  /* sys.x10a_down */ "X10A 离线",
  /* sys.mb_carrying */ "运行模式未知 — 数据来自 Modbus",
  /* sys.mb_only */ "X10A 离线 — 数据来自 Modbus",
  /* sys.mb_source */ "X10A 离线 · Modbus",
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
  /* sys.online */ "在线",
  /* sys.fault */ "故障",
  /* sys.warning */ "警告",
  /* sys.fault_line */ (c) => "故障 · " + c + " — 请查看 Daikin 故障代码。",
  /* sys.warning_line */ (c) => "警告 · " + c + " — 请检查热泵。",
  /* sys.polled */ (s) => `${s} 秒前轮询`,
  /* recovery.title */ "恢复模式",
  /* recovery.meta_heap */ "多次内存耗尽重启后，已停用热泵连接/MQTT 以保网页可用。请安装较新固件；重新上电会尝试完整启动。",
  /* recovery.meta */ "多次重启后进入恢复模式并暂停热泵通信/MQTT。检查“设置 → 协议”的 RX/TX 后重启。",
  /* rollback.title */ "WiFi 更改失败 — 已恢复原配置",
  /* rollback.meta */ (back) => `设备无法使用新的 WiFi 设置联网，已恢复原网络${back}并重启。请在“设置 → 连接”中检查网络名称和密码后重试。`,
  /* crash.title_fault */ "设备崩溃后已重启",
  /* crash.title_orphan */ "发现先前重启遗留的崩溃报告",
  /* crash.reset */ "复位",
  /* crash.task */ "任务",
  /* crash.fw */ "固件",
  /* crash.elf */ "ELF",
  /* crash.corrupted */ "已损坏",
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
  /* bug.what_ph */ "从今天早上开始，Home Assistant 中的水箱温度显示为 12800 °C。",
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
  /* nav.settings_alert */ (n) => `设置 — ${n} 个连接不可用`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "两个数据源一致",
  /* src.delta */ (d, u) => `差值 ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "两个数据源的状态不一致",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "正在搜索…",
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
  /* modbus.err.request_failed */ (r) => `无法创建 Modbus 请求${r ? `（寄存器 ${r}）` : ""}。`,
  /* modbus.err.send_timeout */ (r) => `发送 Modbus 请求超时${r ? `（寄存器 ${r}）` : ""}。`,
  /* modbus.err.send_failed */ (r) => `无法发送 Modbus 请求${r ? `（寄存器 ${r}）` : ""}。`,
  /* modbus.err.response_timeout */ (r) => `等待 HomeHub 响应超时${r ? `（寄存器 ${r}）` : ""}。`,
  /* modbus.err.connection_closed */ (r) => `HomeHub 已关闭连接${r ? `（寄存器 ${r}）` : ""}。`,
  /* modbus.err.receive_failed */ (r) => `无法读取 HomeHub 响应${r ? `（寄存器 ${r}）` : ""}。`,
  /* modbus.err.invalid_response */ (r) => `Modbus 响应无效${r ? `（寄存器 ${r}）` : ""}。`,
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
  /* service.title */ "供暖时的制冷剂回路",
  /* service.state.waiting */ "等待供暖运行",
  /* service.state.observing */ "正在记录",
  /* service.state.limited */ "正在记录 · 部分数据缺失",
  /* service.state.interrupted */ "已暂停",
  /* service.row.window */ "目前已记录",
  /* service.row.reason */ "为什么是此状态？",
  /* service.reason.unsupported_profile */ "此型号不能提供全部所需读数。",
  /* service.reason.compressor_not_running */ "压缩机未运行。",
  /* service.reason.unsupported_or_unknown_mode */ "热泵当前不在普通空间供暖模式，或无法读取运行模式。",
  /* service.reason.dhw_path */ "热泵正在加热生活热水。",
  /* service.reason.defrost */ "室外机正在除霜。",
  /* service.reason.unit_fault */ "热泵正在报告故障。",
  /* service.reason.special_controller_phase */ "短暂的启动或特殊控制阶段正在进行。",
  /* service.reason.missing_fresh_signal */ "至少缺少一个所需的当前读数。",
  /* service.reason.poll_gap */ "X10A 连接已中断或被有意暂停。",
  /* service.window */ (d, n) => `${d} · ${n} 个当前读数`,
  /* service.help.observing */ "普通供暖运行期间正在连续记录读数。",
  /* service.help.limited */ "记录正在进行，但缺少一些额外的对比读数。",
  /* service.help.interrupted */ "记录已结束，下次合适的供暖运行时会自动重新开始。",
  /* service.common */ "支持的型号在普通供暖时自动开始；无需检修模式或更改设置。不判断冷媒量或正常范围。阀门值：控制指令，不是实测位置。",
  /* check.fault */ "机组故障",
  /* check.dhw_loss */ "生活热水箱热损失",
  /* check.cycling */ "压缩机启动",
  /* check.defrost */ "除霜循环",
  /* check.pressure */ "最低水压",
  /* check.flow */ "最低流量",
  /* check.heater */ "辅助加热器",
  /* check.retries */ "保护重试",
  /* check.status.ok */ "正常",
  /* check.status.info */ "说明",
  /* check.status.warn */ "警告",
  /* check.status.collecting */ "检查中",
  /* check.status.observation */ "仅测量",
  /* check.status.experimental */ "实验性",
  /* check.status.unavailable */ "不可用",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · 已评估 ${n}/${a}` : s,
  /* check.detail.value_label */ "数值：",
  /* check.detail.assessment_label */ "评估：",
  /* check.detail.ok */ "评估已完成；在已观察的设备数据中未发现异常。",
  /* check.detail.info */ "这是有用信息，但不能证明存在故障。“正常”一栏会说明本项目何时认为值得注意。",
  /* check.detail.warn */ "设备报告的问题或有文档依据的限值需要关注。",
  /* check.detail.fault.error */ "机组正报告错误。确切代码见“运行”卡片。",
  /* check.detail.fault.warning */ "机组正报告警告或提醒，并非错误。确切代码见“运行”卡片。",
  /* check.detail.fault.past */ "当前没有报告。过去 24 小时内曾出现并自行消失，因此本行不是“正常”。已消失的消息无需处理；若再次出现，请记录时间。",
  /* check.detail.fault.past_unknown */ "过去 24 小时内出现过消息，但当前状态无法读取；故障行无响应，请检查 X10A 连接。",
  /* check.detail.collecting */ (n, r) => `已采集 ${n}/${r}；数据不足，暂不能评估。`,
  /* check.detail.cycling_split */ " 仅评估已确认的空间供暖；排除热水和制冷。完整循环的 3WV 与空间模式须持续可读且不变，否则不分类。",
  /* check.detail.cycling_pooled */ " 分类输入零散、已分类少于 12 个或未分类超过 10% 时合并全部循环；热水/制冷可能掩盖短供暖循环。",
  /* check.detail.outdoor_cycling */ " X10A 室外数据只包含近期已完成且分类一致的空间供暖循环样本，仅提供背景，不改变循环阈值或结论。",
  /* check.detail.outdoor_defrost */ " X10A 室外数据只包含除霜状态和压缩机状态可读且压缩机运行时的近期样本，仅提供背景，不改变除霜阈值或结论。",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `已完成 ${n}/${r} 个干净的一小时时段；当前干净时段 ${c}/${w}。`,
  /* check.detail.dhw_settling */ (n, r, s) => `已完成 ${n}/${r} 个干净的一小时时段；检测到水箱加热或 BSH，还需稳定 ${s} 分钟。`,
  /* check.detail.dhw_waiting */ (n, r) => `已完成 ${n}/${r} 个干净的一小时时段；尚无完整的一小时干净时段。`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` 已丢弃 ${n} 个候选时段（${reasons}）；最长达到 ${best}/60 分钟。`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `此方法无法评估：完整 24 小时内没有完成一个干净的一小时时段，且丢弃了 ${n} 个候选时段（${reasons}）；最长达到 ${best}/60 分钟。水箱加热后需连续 105 分钟不受干扰（稳定 45 分钟 + 测量 60 分钟）；取水、泵运行、读数不可用或快到像取水的持续热损失都可能中断时段。保存的汇总无法确定主因，因此不能排除快速持续热损失。`,
  /* check.detail.dhw_blocked_link */ (n, best) => `无法评估：完整 24 小时内没有完成一个干净的一小时时段，且因 X10A 在时段内停止响应而丢弃了 ${n} 个候选时段；最长达到 ${best}/60 分钟。问题在连接而非设备，请检查 X10A 接线和 RX/TX 引脚。`,
  /* check.detail.dhw_reason.charge */ "水箱加热",
  /* check.detail.dhw_reason.pump */ "内部水泵",
  /* check.detail.dhw_reason.draw */ "类似取水的降温",
  /* check.detail.dhw_reason.reading */ "R5T 读数不可信",
  /* check.detail.dhw_reason.blind */ "X10A 无响应",
  /* check.detail.collecting_unknown */ "尚无足够可用数据进行评估。",
  /* check.detail.observation */ "仅为测量值；没有通用的正常/警告限值。",
  /* check.detail.experimental */ "实验性观察；计数器不变不能证明机组未发生限功率。",
  /* check.detail.unavailable */ "当前配置文件没有提供此检查所需的数据。",
  /* check.starts */ (n) => `${n} 次启动`,
  /* check.cycles */ (n) => `${n} 个循环`,
  /* check.paired_cycles */ (n) => `${n} 个已配对`,
  /* check.mean */ (d) => `${d}/次启动`,
  /* check.cycling_space */ (n, d) => d ? `空间供暖 ${n} × ${d}` : `空间供暖 ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `生活热水 ${n} × ${d}` : `生活热水 ${n}`,
  /* check.cycling_cooling */ (n) => `制冷：排除 ${n} 个`,
  /* check.cycling_censored */ (n) => `${n} 个未分类`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} 最低 ${min} °C · 平均 ${mean} °C`,
  /* check.min */ (m) => `${m} 分钟`,
  /* check.tank */ (m) => `水箱 ${m} 分钟`,
  /* check.tank_runtime */ (d) => `水箱 ${d}`,
  /* check.loss_windows */ (n) => `${n} 个时段`,
  /* check.loss_pump_off */ "循环泵关闭时",
  /* check.loss_with_pump */ "循环泵运行时",
  /* check.loss_unattributed */ "泵归因不完整",
  /* check.fault_err */ "当前故障",
  /* check.fault_warn */ "当前警告",
  /* check.fault_past */ "过去 24 小时内发生 · 当前无效",
  /* check.fault_none */ "当前无故障",
  /* check.fault_unknown */ "当前状态未知",
  /* check.fault_past_unknown */ "过去 24 小时内发生 · 当前状态未知",
  /* check.retry_seen */ "检测到计数器增加",
  /* check.retry_none */ "未检测到增加",
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
  /* protect.limiting */ "正在限功率",
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
  /* hist.loading */ "正在加载趋势…",
  /* hist.none */ "尚无已记录读数。",
  /* hist.err */ "趋势不可用。",
  /* hist.gaps */ (n) => `${n} 个无数据时段 — 未测量`,
  /* hist.nm */ "未测量",
  /* hist.rel */ (h) => `${h} 小时前`,
  /* hist.held */ "室外机待机",
  /* hist.heldnote */ (h) => `已待机 ${h} 小时 — 未测量`,
  /* hist.forecast */ "Open-Meteo · 预报",
  /* hist.in_hours */ (h) => `${h} 小时后`,
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
  /* hist.boost_aria */ (l, d) => `${l} — Smart Grid 四种状态的历史。${d}。用方向键逐点读取。`,
  /* hist.defrost_total */ (d) => `除霜 · ${d}`,
  /* hist.defrost_none */ "记录期内未观察到除霜循环。",
  /* hist.defrost_active */ "正在除霜",
  /* hist.defrost_inactive */ "未除霜",
  /* hist.defrost_aria */ (l, d) => `${l} — 除霜历史。${d}。用方向键逐点读取。`,
  /* hist.quiet_total */ (d) => `静音 · ${d}`,
  /* hist.quiet_none */ "记录期内未观察到静音模式。",
  /* hist.quiet_active */ "静音已启动",
  /* hist.quiet_inactive */ "静音未启动",
  /* hist.quiet_aria */ (l, d) => `${l} — 静音模式历史。${d}。用方向键逐点读取。`,
  /* hist.heater_total */ (d) => `水箱电加热 · ${d}`,
  /* hist.heater_none */ "记录期内未观察到水箱电加热器运行。",
  /* hist.heater_active */ "水箱电加热启动",
  /* hist.heater_inactive */ "水箱电加热关闭",
  /* hist.heater_aria */ (l, d) => `${l} — 水箱电加热器历史。${d}。用方向键逐点读取。`,
  /* hist.preheat_total */ (d) => `预热 · ${d}`,
  /* hist.preheat_none */ "记录期内未观察到水箱预热。",
  /* hist.preheat_active */ "预热中",
  /* hist.preheat_inactive */ "未预热",
  /* hist.preheat_aria */ (l, d) => `${l} — X10A 水箱预热历史。${d}。用方向键逐点读取。`,
  /* hist.disinfection_total */ (d) => `消毒 · ${d}`,
  /* hist.disinfection_none */ "记录期内未观察到消毒运行。",
  /* hist.disinfection_active */ "消毒中",
  /* hist.disinfection_inactive */ "未消毒",
  /* hist.disinfection_aria */ (l, d) => `${l} — HomeHub 消毒历史。${d}。用方向键逐点读取。`,
  /* hist.buh_total */ (d) => `BUH · ${d}`,
  /* hist.buh_none */ "记录期内未观察到 BUH 运行。",
  /* hist.buh_active */ "BUH 启动",
  /* hist.buh_inactive */ "BUH 关闭",
  /* hist.buh_step1 */ "1 级",
  /* hist.buh_step2 */ "2 级",
  /* hist.buh_aria */ (l, d) => `${l} — BUH 历史。${d}。用方向键逐点读取。`,
  /* hist.valve_dhw_total */ (d) => `热水 · ${d}`,
  /* hist.valve_space_total */ (d) => `房间 · ${d}`,
  /* hist.valve_none */ "记录期内没有热水位置。",
  /* hist.valve_dhw */ "热水",
  /* hist.valve_space */ "房间",
  /* hist.valve_aria */ (l, d) => `${l} — 3WV 历史。${d}。用方向键逐点读取。`,
  /* hist.circ_total */ (d) => `水泵 · ${d}`,
  /* hist.circ_none */ "记录期内未观察到水泵运行。",
  /* hist.circ_on */ "运行",
  /* hist.circ_off */ "停止",
  /* hist.circ_unavailable */ "不可用",
  /* hist.circ_gaps */ (n) => `${n} 个不可用时段`,
  /* hist.circ_aria */ (l, d) => `${l} — 循环泵历史。${d}。用方向键逐点读取。`,
  /* hist.valve2_on_total */ (d) => `2WV 开 · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV 关 · ${d}`,
  /* hist.valve2_on */ "2WV 开",
  /* hist.valve2_off */ "2WV 关",
  /* hist.valve2_none */ "所选时段内未记录到 2WV 输出启动。",
  /* hist.valve2_aria */ (l, d) => `${l} — 2WV 输出历史。${d}。用方向键逐点读取。`,
  /* hist.flow_switch_total */ (d) => `流量开关 ON · ${d}`,
  /* hist.flow_switch_on */ "流量开关 ON",
  /* hist.flow_switch_off */ "流量开关 OFF",
  /* hist.flow_switch_none */ "所选时段内未记录到该 X10A 信号启动。",
  /* hist.flow_switch_aria */ (l, d) => `${l} — 水流量开关历史。${d}。用方向键逐点读取。`,
  /* toast.saved */ "已保存",
  /* toast.no_changes */ "没有更改",
  /* toast.reboot */ "正在重启并重新连接…",
  /* toast.rebooted */ "已重启 — 请重新连接设备",
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
  /* ota.changes_title */ "此版本的新内容",
  /* ota.no_changes */ "此版本未提供更新日志。",
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
  /* schem.defrost_pill */ "❄ 除霜",
  /* schem.outdoor */ "室外",
  /* insp.close */ "关闭",
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
  /* wifi.err_ssid */ "SSID 最多 32 个字符",
  /* wifi.err_pass */ "密码必须为空（开放网络）或为 8 到 63 个字符",
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
  /* dyn.card */ "气候补偿曲线诊断",
  /* dyn.state */ "状态",
  /* dyn.state_recording */ "正在记录",
  /* dyn.state_recording_nowx */ "正在记录 · 无天气预报",
  /* dyn.state_waiting */ "等待空间供暖",
  /* dyn.state_cooling */ "制冷 · 不采样",
  /* dyn.state_room */ "室温源不可用",
  /* dyn.state_x10a */ "X10A 离线",
  /* dyn.state_homehub */ "HomeHub 离线",
  /* dyn.state_gate */ "设备状态未知",
  /* dyn.state_mode */ "供暖/制冷模式未知",
  /* dyn.state_clock */ "时钟未设置",
  /* dyn.state_blocked */ "未记录",
  /* dyn.state_setup_room */ "请配置室温源",
  /* dyn.state_setup_homehub */ "HomeHub 未配置",
  /* dyn.state_homehub_disabled */ "诊断已停用 — HomeHub 已停用",
  /* dyn.state_no_broker */ "未记录 — 无 MQTT 代理",
  /* dyn.state_safe_mode */ "未记录 — 安全模式",
  /* dyn.state_inactive */ "未记录 — 采样器已停止",
  /* dyn.room_off */ "室内温控器已关闭",
  /* dyn.room_not_heating */ "室内温控器未供暖",
  /* dyn.room_stale */ "室温读数过旧",
  /* dyn.room_no_value */ "等待室温读数",
  /* dyn.room_invalid_payload */ "MQTT 消息无效",
  /* dyn.room_invalid_temperature */ "室温超出允许范围",
  /* dyn.room_invalid_setpoint */ "目标温度超出允许范围",
  /* dyn.room_no_setpoint */ "缺少目标温度",
  /* dyn.room_no_time */ "缺少测量时间",
  /* dyn.room_retained_no_time */ "retained 值缺少测量时间",
  /* dyn.room_future_time */ "测量时间在未来",
  /* dyn.room_backward_time */ "测量时间倒退",
  /* dyn.room_invalid_time */ "测量时间无效",
  /* dyn.room_no_enabled */ "缺少温控器开关状态",
  /* dyn.room_no_hvac_mode */ "缺少温控器运行模式",
  /* dyn.room_source */ "室温来源",
  /* dyn.weather */ "可选天气预报对照",
  /* dyn.strategy */ "诊断信号",
  /* dyn.not_configured */ "未配置",
  /* dyn.outdoor */ "实测室外空气",
  /* dyn.outdoor_detail_status */ "状态",
  /* dyn.outdoor_detail_now */ "当前读数",
  /* dyn.outdoor_detail_sample */ "最近记录事件时",
  /* dyn.outdoor_status_live */ (source) => `${source} 有当前读数，会作为背景附加到每个记录事件。`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} 已配置，但没有当前读数。事件会继续记录，但不带此轴。`,
  /* dyn.outdoor_status_absent */ (source) => `${source} 未配置。事件会继续记录，但不带此轴。`,
  /* dyn.outdoor_status_idle */ (source) => `${source} 已配置，但当前没有记录。原因见上方状态行。`,
  /* dyn.outdoor_sample_none */ "记录时无室外值",
  /* dyn.outdoor_help_axis */ "室外温度用于比较室温偏差：同为 +0.5 K，−5 °C 时可能曲线过陡，+12 °C 时可能整体过高。此项可选且不决定记录。",
  /* dyn.outdoor_help_placement */ "数值只代表传感器安装位置。固件无法知道位置：室内机旁测到的是室温，室外阴凉处才是室外空气；只有后者适合比较。",
  /* dyn.outdoor_help_setup */ "Grove 口的 M5Stack ENV III 可持续测量室外阴凉处的空气；热泵传感器待机时停止更新。请在“ESP32 → 硬件”配置。",
  /* dyn.plant_outdoor */ "设备室外空气",
  /* dyn.plant_outdoor_help */ "HomeHub 输入 44 与供暖条件在同轮 Modbus 采集并保存来源；它独立于 ENV III，且不决定是否记录。",
  /* dyn.shadow_strategy */ "原始室温偏差 · 30 分钟",
  /* dyn.card_help */ "确认空间供暖时每 30 分钟记录室温偏差及可用的室外温度。趋势需结合运行时长、最低出水限幅和温控器；1 K 偏差不等于调 1 K 出水。本功能只读。",
  /* dyn.state_help_recording */ "已确认的空间供暖正在运行，且室温输入有效，因此正在记录原始室温误差。请结合运行时长和限幅证据评估季节趋势；单个样本不是结论。",
  /* dyn.state_help_waiting */ "设备当前不在正常空间运行，因此不记录样本。夏季通常如此，并非故障。",
  /* dyn.state_help_cooling */ "HomeHub 报告空间运行，但当前为制冷模式；制冷窗口特意不纳入气候补偿曲线数据。",
  /* dyn.state_help_blocked */ "缺少必要输入，因此不记录。输入恢复后会继续；陈旧或含糊的数据绝不会采样。",
  /* dyn.state_help_room */ "室温读数已到达设备，但目前无法形成相对目标的有效偏差；来源恢复可用前不会创建样本。",
  /* dyn.state_help_setup */ "保存带时间和目标的 MQTT 室温源后开始诊断。天气预报仅为可选对照，不要求上传位置。",
  /* dyn.state_help_inactive */ "已配置但未评估：安全模式停用 MQTT 等可选组件；配置保留，正常启动后自动继续。",
  /* dyn.state_help_no_broker */ "已保存室温源，但诊断通过 MQTT 读取，而未配置代理。请在“连接”中设置代理；保存的室温源会保留，随后自动开始记录。",
  /* dyn.state_help_setup_homehub */ "诊断需要 HomeHub 判断设备是否真正供暖；没有它就无法区分供暖、生活热水或停止。请在“协议”中设置 HomeHub 地址。",
  /* dyn.state_help_homehub_disabled */ "此诊断依赖两个 HomeHub 设备信号。HomeHub 地址明确留空时，Modbus 和该诊断都不会运行。",
  /* dyn.strategy_help */ "样本=目标室温−实际室温，正值偏冷；不做死区、舍入或限速，也不是出水修正。房间须有代表性；温控器/阀门可能掩盖曲线过高。请结合 D2 最低限幅和供暖请求率。",
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
  /* ref.title */ "室温来源",
  /* ref.name */ "名称",
  /* ref.temperature_source */ "温度来源",
  /* ref.target */ "目标温度",
  /* ref.timestamp_source */ "时间戳来源 · 可选",
  /* ref.max_age */ "最大时效 · 秒",
  /* ref.temperature_source_help */ "精确 MQTT 主题，可在 $ 后附加 JSON 路径。收到消息时会报告路径缺失或错误。",
  /* ref.target_help */ "固定 °C 数值，或精确 MQTT 主题并可在 $ 后附加 JSON 路径。",
  /* ref.timestamp_source_help */ "可选 RFC3339/Unix 源时间：主题$路径。留空用 MQTT 实时到达时间，并拒绝 retained 值。",
  /* ref.max_age_help */ "源读数允许的最大时效：10 到 3600 秒。",
  /* ref.error */ "最近错误",
  /* ref.broker_off */ "MQTT 代理已停用",
  /* ref.retained */ "代理缓存的 retained 值",
  /* ref.time_untrusted */ "retained 值没有可信测量时间",
  /* ref.clock_unsynced */ "设备时钟未同步",
  /* ref.now */ "现在",
  /* ref.ago */ (s) => `${s} 秒前`,
  /* ref.age_unknown */ "未知",
  /* ref.saved */ "室温来源已保存",
  /* ref.detail.status_label */ "状态：",
  /* ref.detail.diagnosis_label */ "气候补偿曲线诊断：",
  /* ref.status.measurement_valid */ "测量有效",
  /* ref.status.not_configured */ "未配置",
  /* ref.status.usable */ "可用",
  /* ref.status.unusable */ "不可用",
  /* ref.status.error */ "错误",
  /* ref.status.stale */ "过期",
  /* ref.status.waiting */ "等待中",
  /* ref.status.unavailable */ "不可用",
  /* ref.detail.setup */ "用铅笔按钮添加 MQTT 来源",
  /* ref.detail.stale */ "读数早于允许时间",
  /* ref.detail.waiting */ "尚未收到 MQTT 读数",
  /* ref.detail.error */ (e) => `MQTT 消息被拒绝：${e}`,
  /* ref.detail.temperature_label */ "室温：",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "目标温度：",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "最近读数：",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · 允许最大 ${max} 秒`,
  /* ref.detail.purpose */ "诊断会比较室温与目标，显示气候补偿曲线长期偏高或偏低；不会控制热泵。",
  /* ref.delete */ "删除",
  /* ref.deleting */ "正在删除…",
  /* ref.deleted */ "室温来源及已采集读数已删除",
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
  /* wx.title */ "Open-Meteo 天气预报",
  /* wx.latitude */ "纬度",
  /* wx.longitude */ "经度",
  /* wx.waiting */ "等待天气预报",
  /* wx.fetching */ "正在获取 Open-Meteo 预报…",
  /* wx.unavailable */ "不可用",
  /* wx.error */ "Open-Meteo 预报错误",
  /* wx.detail.status */ "状态：",
  /* wx.status.fresh */ "最新",
  /* wx.status.inactive */ "已停用",
  /* wx.status.fetching */ "正在更新",
  /* wx.status.stale */ "过期",
  /* wx.status.unavailable */ "不可用",
  /* wx.status.waiting */ "等待中",
  /* wx.detail.fresh */ "预报已成功获取。",
  /* wx.detail.fetching */ "ESP32 正在获取新的预报数据。",
  /* wx.detail.stale */ "最近一次成功获取过旧；显示值仅供诊断。",
  /* wx.detail.unavailable */ "最近一次获取失败；若有旧值，也仅供诊断。",
  /* wx.detail.waiting */ "尚未收到预报。",
  /* wx.detail.temperature_label */ "温度：",
  /* wx.detail.temperature */ (v) => `${v} °C 是未来两个完整小时的预测室外平均气温。`,
  /* wx.detail.solar_label */ "太阳辐照量：",
  /* wx.detail.solar */ (v) => `${v} Wh/m² 是同一两小时时段的预测水平面总辐照量。`,
  /* wx.detail.source_label */ "来源：",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless。仅供观察；预报不会改变热泵控制。",
  /* wx.err_both */ "请同时填写纬度和经度，或全部留空以停用",
  /* wx.err_latitude */ "纬度必须是 -90 到 90 的小数",
  /* wx.err_longitude */ "经度必须是 -180 到 180 的小数",
  /* wx.saving */ "正在保存天气来源…",
  /* wx.hint.configured */ "ESP32 每 45 分钟向 Open-Meteo 发送坐标并暴露公网 IP；清空两个坐标可删除来源。",
  /* wx.hint.setup */ "输入经纬度，或向任一栏粘贴 Google Maps 坐标对。ESP32 每 45 分钟向 Open-Meteo 发送坐标并暴露公网 IP；预报只读。",
  /* wx.attribution */ "天气数据：Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "请输入精确 MQTT 主题，并可附加 $json-path",
  /* ref.err_target */ "请输入 5 到 35 °C 的固定值，或精确 MQTT 主题并可附加 $json-path",
  /* ref.err_timestamp_source */ "请输入精确 MQTT 主题，并可附加 $json-path",
  /* ref.err_max_age */ "最大时效必须是 10 到 3600 秒的整数",
  /* ref.save_help */ "保存只会存储映射。启用设备诊断时订阅才运行，否则保持停用；仍需有可读且最新的 MQTT 值。",
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
  /* board.led_rgb_off */ "熄灭 — 未启用 Wi-Fi 模式。",
  /* board.led_rgb_setup */ "蓝色慢闪 — 配置门户已启动。",
  /* board.led_rgb_connecting */ "黄色快闪 — 正在连接 Wi-Fi。",
  /* board.led_rgb_healthy */ "绿色常亮 — 所有已配置连接均正常。",
  /* board.led_rgb_bus_down */ "红色双闪 — X10A 已断开。",
  /* board.led_rgb_mqtt_down */ "橙色闪烁 — X10A 已连接，MQTT 已断开。",
  /* board.led_rgb_wipe_armed */ "红色极速闪烁 — 已准备清除；松开可取消。",
  /* board.led_rgb_wiping */ "白色常亮 — 正在恢复出厂设置/清除数据；请勿断电。",
  /* board.led_gpio_off */ "熄灭 — 未启用 Wi-Fi 模式。",
  /* board.led_gpio_setup */ "慢闪 — 配置门户已启动。",
  /* board.led_gpio_connecting */ "快闪 — 正在连接 Wi-Fi。",
  /* board.led_gpio_healthy */ "常亮 — 所有已配置连接均正常。",
  /* board.led_gpio_bus_down */ "双闪 — X10A 已断开。",
  /* board.led_gpio_mqtt_down */ "中速闪烁 — X10A 已连接，MQTT 已断开。",
  /* board.led_gpio_wipe_armed */ "极速闪烁 — 已准备清除；松开可取消。",
  /* board.led_gpio_wiping */ "极速闪烁后常亮 — 正在恢复出厂设置/清除数据；请勿断电。",
  /* board.ledinv */ "低电平有效（引脚为 LOW 时 LED 点亮）",
  /* board.btninv */ "低电平有效（按钮将引脚接到 GND）",
  /* board.hint */ "恢复出厂设置：按住 5 秒，永久清除 Wi-Fi/全部设置、历史/趋势、状态持续时间和原始核心转储。全部清除成功后才打开配置门户；否则松开后再按 5 秒重试。未接按钮请选择“无”。",
  /* card.hardware */ "硬件",
  /* card.hw_off */ "无",
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
  /* card.diagnostics_help */ "启用 24 小时设备检查、气候补偿曲线诊断，以及室温、天气预报和循环泵功率等附加来源。",
  /* diagnostics.off */ "已停用",
  /* diagnostics.on */ "已启用",
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
  /* hist.cop_none */ "CT 供电功率时不画 COP：所含负载取决于接线，而热功率止于 BUH 前且不含 BSH，电热边界可能不一致。",
]);
INSPECT_I18N.zh = inspectValues(
  ["无当前读数：", "压缩机已停；仅运行时更新的室外传感器会隐藏旧值。"],
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
      ? "待机：X10A 室外值停更；室外空气改用 HomeHub，Modbus 测量时间未知。"
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
      : `${fmt1(d.dt)} K${d.dtSet != null ? `；目标 ${fmt1(d.dtSet)} K` : ""}；正值表示 PHE 向水供热。`], // dt
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
      : d.copBlock === "mb_scope" ? "无 COP：HomeHub 测整机电功率，而热量只算 PHE，边界不一致。"
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
    ["循环泵", "循环泵速度", "驱动公共回路及 3WV 支路；停机后也可延时/保护运行，须结合流量。", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `水泵报停但测得 ${fmt1(d.flow)} l/min；可能为外泵、延时或信号冲突。`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `${fmt0(d.pump)}%；${fmt1(d.flow)} l/min。` : `${fmt0(d.pump)}%，无流量；循环未确认。`
      : waterMoving(d) ? `无泵速；测得 ${fmt1(d.flow)} l/min。`
      : d.pumpOn === true ? d.flow != null ? `泵启动但仅 ${fmt1(d.flow)} l/min；循环未确认。` : "泵启动但无流量。"
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `泵停止；显示 ${fmt1(d.flow)} l/min，未证明循环。` : "泵停止，无流量。"
      : `泵状态不可靠；${fmt1(d.flow)} l/min 未证明循环。`], // pump
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
    ["水压", "水路压力", "水压，非制冷剂压力；范围取决于型号/安装。"], // wp
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
  "机组诊断状态", // 21
  "机组故障代码", // 22
  "机组故障子代码", // 23
  "循环泵运行", // 30
  "压缩机运行", // 31
  "BSH 运行", // 32
  "水箱消毒运行", // 33
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
  ["水箱低于启动阈值后再加热至目标。"], // 23
  ["定时预设：舒适目标较高，经济目标较低。"], // 24
  ["混合系统向锅炉发出的热水请求。"], // 25
  ["3WV：1=热水、0=空间；阀位不证明运行。"], // 26
  ["2WV 的 X10A 输出；不证明模式、电压或位置。"], // 27
  ["第二区域混水阀开度。"], // 28
  ["当前冷暖模式的出水目标。"], // 29
  ["第二区域混水阀下游温度。"], // 30
  ["BUH 后 R2T；可含电热，但非建筑末端温度。"], // 31
  ["PHE 后、BUH 前 R1T；配合 R4T/流量估算功率，位置随型号。"], // 32
  ["PHE 回水 R4T；须结合流量/压缩机/模式，无统一 5 K。"], // 33
  ["公共水流量；最低值随型号/模式，过低可触发 7H。"], // 34
  ["水压；许多手册要求 >1 bar，≤1.0 bar 时查确切型号手册。"], // 35
  ["反向水泵速度命令：0 表示最高转速，100 表示停止。"], // 36
  ["泵状态；须结合流量，运行不证明换热。"], // 37
  ["太阳能回路泵状态；不同于热泵水路泵。"], // 38
  ["配置所命名泵速；刻度/回路随型号。"], // 39
  ["X10A 流量开关：ON=检测流动，非 l/min/最低流量；部分型号无实体触点。"], // 40
  ["水路/室内模式：停、暖、冷、热水或组合；不证明运行。"], // 41
  ["HomeHub 或两个 X10A 触点的四态 Smart Grid 指令；非冷暖模式。"], // 42
  ["当前空间冷暖模式；不证明压缩机启动。"], // 43
  ["HomeHub 配置的自动/暖/冷选择；非室外机当前状态。"], // 44
  ["室外机停/暖/冷状态；停机仍可保留选择，不证明供热。"], // 45
  ["室外机除霜；寒湿时正常，单个位不能诊断过多。"], // 46
  ["当前故障严重级别：正常、错误、警告或提醒。"], // 47
  ["当前所报告故障代码的含义"], // 48
  ["故障后应急运行，可使用 BUH/锅炉。"], // 49
  ["报警继电器向外部系统报告机组故障。"], // 50
  ["主区域冷暖目标室温。"], // 51
  ["内部 thermo ON 需求；不说明负载或压缩机；Space heating Operation 输出也非需求。"], // 52
  ["Space H Operation 电气输出，非正常空间运行状态。"], // 53
  ["正常空间冷暖启用/运行；非温控需求，制冷待机也可 ON。"], // 54
  ["机组自身传感器控制区的目标室温。"], // 55
  ["内置/有线传感器室温；用途取决于控制方式。"], // 56
  ["排温保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 57
  ["逆变器电流保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 58
  ["高压保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 59
  ["低压保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 60
  ["逆变器温度保护 ON/OFF+0–7 计数；仅可比读数增加证明事件，不说明原因；阈值、复位、7→0 未公开。"], // 61
  ["其他内部限功率位；不能诊断原因。"], // 62
  ["PHE 入口或出口水温；PHE 在制冷剂与水路之间传热。"], // 63
  ["室外换热器温度；低于 0 °C 可正常，单值不证明结冰。"], // 64
  ["机组测得的室外温度，用于气候补偿和运行决策；日照、安装位置和风会使其不同于天气观测值。"], // 65
  ["压缩机出口热气；随压力、转速、模式和负荷变化。单值或其他系列的范围不能证明故障或制冷剂不足。"], // 66
  ["返回压缩机的低温低压吸气制冷剂温度。"], // 67
  ["两个换热器之间液管内的制冷剂温度。"], // 68
  ["蒸发器入口或出口的制冷剂温度。"], // 69
  ["制冷剂喷气管温度，供机组控制喷气和保护循环。"], // 70
  ["制冷剂回路气液两相区温度，不是设定值。"], // 71
  ["室外除霜传感器；位置和控制因型号而异。单点不能证明整盘管结冰或除霜结束。"], // 72
  ["由压力换算的饱和温度；不是独立传感器，也不是 bar 压力。"], // 73
  ["高/低压应看同型号同模式的稳定趋势；启动、回油和除霜会改变压力。没有通用正常范围。"], // 74
  ["压缩机转速 rps；范围随型号，不等于热功率。"], // 75
  ["EEV 步数是命令，无机械反馈，不是开度%或流量；单独不能证明动作、卡滞或制冷剂不足。"], // 76
  ["室外风机电机控制电子器件的温度。"], // 77
  ["室外风机速度，以级别或 rpm 表示。"], // 78
  ["内部目标随型号/模式变化；与对应压力换算的饱和温度比较。偏差不能诊断原因或充注量。"], // 79
  ["保护逻辑的压缩机排气/端口目标温度。"], // 80
  ["供回水目标 ΔT 随型号/模式/末端，无统一 5 K。"], // 81
  ["机组所充制冷剂，如 R32 或 R410A；决定压力—温度曲线。"], // 82
  ["压缩机端口测得的温度，用于内部监控和保护。"], // 83
  ["室外机制冷剂回路压力读数。"], // 84
  ["CT 的 L1/L2/L3 电流；仅完整相组按 230 V 粗估，未校准且忽略真实电压/功率因数。"], // 85
  ["压缩机逆变器电流；仅近似反映压缩机负载。"], // 86
  ["室外逆变器/功率电子散热器温度。"], // 87
  ["BUH 启动级；0=无，可用于低温、除霜、热水、消毒或应急。"], // 88
  ["水力模块 BUH 电阻级；0=无，允许原因/均衡温度取决于型号/设置。"], // 89
  ["HomeHub 输入 32 是 BSH 状态非功率；输入 51 也非 BSH 自身功率。"], // 90
  ["水箱浸入式 BSH，可独立加热；X10A 只报 ON/OFF，不报功率。"], // 91
  ["电加热器热保护链状态；开路时需结合故障代码并检查电气回路。"], // 92
  ["水管防冻范围/触发随型号；须持续供电，停电不保证。"], // 93
  ["X10A 防冻状态；无确切型号资料则未知涉及的泵/加热器/区域。"], // 94
  ["地源盐水回路/泵；介质、浓度、压力、温度限值取决于安装和手册。"], // 95
  ["混合热源选择：热泵/联合/锅炉；非实测供热。"], // 96
  ["混合供暖出水目标，非实测水温；须结合模式/实温。"], // 97
  ["第二热源双价许可/状态；ON 不证明锅炉燃烧。"], // 98
  ["向锅炉的双价/混合请求；不证明燃烧或供热。"], // 99
  ["锅炉请求水温目标，非实测；范围取决于安装。"], // 100
  ["内部双价比较值 BE_COP；X10A 含义和刻度未公开，不是当前 COP。"], // 101
  ["电网/Smart Grid/太阳能输入；动作取决于配置，ON 仅表示触点有效。"], // 102
  ["室内/外机固定额定容量或代码；非当前测量。"], // 103
  ["静音模式降低室外噪声，也可能限制可用供暖或制冷容量。"], // 104
  ["HomeHub 诊断状态：无错误、故障或警告；状态本身不能说明原因。"], // 105
  ["当前所报告故障代码的含义"], // 106
  ["Daikin 数字故障子码；须与状态/主码同读，不可用时隐藏。"], // 107
  ["HomeHub 压缩机 ON/OFF；无转速/容量，须结合运行、阀位、流量。"], // 108
  ["正常生活热水运行是否启动，不说明启动原因。"], // 109
  ["正常空间供暖或制冷运行是否启动。"], // 110
  ["PHE 后、BUH 前水温；仅有循环时可与回水算 ΔT。"], // 111
  ["BUH 后出水；比 PHE 高可表示电热，但须由 BUH 状态确认。"], // 112
  ["生活热水箱内测得的水温。"], // 113
  ["液管制冷剂温度；关系随模式，孤立值不能诊断。"], // 114
  ["遥控器报告的主区域室温。"], // 115
  ["HomeHub 整机耗电；随模式/负载，不能全归于压缩机。"], // 116
  ["HomeHub 只读供暖出水目标；固定或气候补偿，仅保持室温时降低才可能增效。"], // 117
  ["HomeHub 只读制冷出水目标；仅支持并启用制冷时相关，否则仍可显示配置值。"], // 118
  ["空间回路是否启用：这是总开关，不是当前运行状态。"], // 119
  ["静音运行降低噪声，也可能限制可用容量。"], // 120
  ["热水再加热目标，非启动阈值；启动还取决于回差/程序。"], // 121
  ["供暖出水目标 −10…+10 K 修正；只读，非零且未运行不证明供热。"], // 122
  ["Smart Grid“建议开启”蓄热上限；与总上限取低值，非当前耗电。"], // 123
  ["HomeHub 总功率上限，自由运行也适用；是配置非实测，调低会限制各 Smart Grid 模式。"], // 124
]);

MODEL_DESCRIPTION_I18N.zh = modelDescriptionValues([
  ["机组自身状态：当前错误给出“警告”；当前警示或 24 小时内已清除的消息给出“说明”，不是项目推断。"], // health_fault
  ["静置降温：项目阈值 ≥0.8 K/h 为“说明”；水箱容积和内外温差会影响结果，>≈1.85 K/h 可能被当作用水过滤，“正常”不证明保温良好。"], // health_dhw_loss
  ["≥12 个供暖循环且平均 <10 分钟时给出“说明”；排除生活热水/制冷，不是 Daikin 限值；若过多循环无法分类，则合并评估全部循环。"], // health_cycling
  ["除霜 >15% 且 ≥3 次时提示；不是 Daikin 限值。R4T 仅是实时背景，不参与判定，单点不代表整盘管。"], // health_defrost
  ["最低水压应 >1.0 bar；≤1.0 为“说明”，持续 60 秒为“警告”，但允许范围随型号而异。"], // health_pressure
  ["水泵运行 60 秒后的流量只代表测量支路，不是设计流量；孤立值意义有限，应在相同型号、模式和条件下比较，没有通用限值。"], // health_flow
  ["只观察 BUH/BSH 运行时间；低温、应急、除霜、生活热水或富余电力都可能解释运行，没有通用限值。"], // health_heater
  ["5 个公开资料不足的实验计数器：只有可比读数增加才给出“说明”，并非诊断；不增加也不能排除机组曾限功率。"], // health_retries
  ["当前及 24 小时可用 RAM：WiFi、MQTT 和网页的临时分配会造成可恢复的短暂下降，属正常现象；持续下降可能表示分配未释放。持续供电的热复位会延续 RAM 趋势；普通重启、固件更新或断电仅从 flash 恢复已完成的 5 分钟桶，开放桶可能缺失。"], // free_heap
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
