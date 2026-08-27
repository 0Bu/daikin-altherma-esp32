// translation-source: 5d871d5ac649125e5dd02c251c9b45a34dc6cedbda5e9c48c95895bed7694182
I18N.ja = localeValues([
  /* sys.nodata */ "データなし",
  /* sys.unreachable */ "接続不可",
  /* sys.x10a_down */ "X10A オフライン",
  /* sys.mb_carrying */ "運転モード不明 — Modbus値",
  /* sys.mb_only */ "X10A オフライン — Modbus値",
  /* sys.mb_source */ "X10A オフライン · Modbus",
  /* mode.stop */ "停止",
  /* mode.heat */ "暖房",
  /* mode.cool */ "冷房",
  /* mode.space */ "室内空調",
  /* mode.dhw */ "給湯",
  /* mode.heat_dhw */ "暖房 + 給湯",
  /* mode.cool_dhw */ "冷房 + 給湯",
  /* mode.space_dhw */ "室内空調 + 給湯",
  /* sys.unreachable_sub */ "機器に接続できません — 再試行中…",
  /* sys.waiting */ "ヒートポンプを待機中…",
  /* sys.operating */ "運転中",
  /* sys.standby */ "待機 — 停止中",
  /* sys.defrosting */ "霜取り中",
  /* sys.circulating */ "循環中 — 圧縮機停止",
  /* sys.cool_mode */ "冷房モード",
  /* sys.residual_circulating */ "残熱循環 — 冷却出力なし",
  /* sys.bsh_active */ "タンク電気ヒーター作動中",
  /* sys.online */ "オンライン",
  /* sys.fault */ "異常",
  /* sys.warning */ "警告",
  /* sys.fault_line */ (c) => "異常 · " + c + " — Daikin異常コードを確認してください。",
  /* sys.warning_line */ (c) => "警告 · " + c + " — ヒートポンプを確認してください。",
  /* sys.polled */ (s) => `${s}秒前に取得`,
  /* recovery.title */ "復旧モード",
  /* recovery.meta_heap */ "メモリ不足で再起動を繰り返したため、画面を維持できるようヒートポンプ接続とMQTTを停止しています。設定は通常そのままで問題ありません。設定画面から新しいファームウェアを導入してください。電源を入れ直すと全機能を再試行します。",
  /* recovery.meta */ "再起動を繰り返したため復旧モードに入り、ヒートポンプ通信とMQTTを停止しています。設定、特に設定のプロトコル欄にあるRX/TXピンを確認して再起動してください。",
  /* rollback.title */ "WiFi変更失敗 — 元に戻しました",
  /* rollback.meta */ (back) => `新しいWiFiに接続できなかったため、以前のネットワーク${back}へ戻して再起動しました。設定 → 接続でネットワーク名とパスワードを確認し、再試行してください。`,
  /* crash.title_fault */ "クラッシュ後に再起動しました",
  /* crash.title_orphan */ "以前のクラッシュ報告があります",
  /* crash.reset */ "リセット",
  /* crash.task */ "タスク",
  /* crash.fw */ "FW",
  /* crash.elf */ "ELF",
  /* crash.corrupted */ "破損",
  /* crash.download */ "クラッシュ報告を保存",
  /* crash.copy */ "診断情報をコピー",
  /* crash.dismiss */ "報告を削除",
  /* crash.copied */ "診断情報をコピーしました — 不具合報告へ貼り付けてください",
  /* crash.copy_fail */ "コピー失敗 — /coredump と /diag を手動で開いてください",
  /* crash.ask_dump */ "機器から削除しますか？コアダンプも消えます。不具合報告用に先に保存してください。",
  /* crash.ask */ "この報告を機器から削除しますか？",
  /* crash.ask_yes */ "削除",
  /* crash.ask_no */ "保持",
  /* crash.deleted */ "クラッシュ報告を削除しました",
  /* crash.delete_fail */ "削除できませんでした — 報告は残っています",
  /* bug.row */ "不具合を報告",
  /* bug.title */ "不具合を報告",
  /* bug.intro */ "問題を短く説明してください。ネットワーク名、アドレス、サーバー名を除去した状態、測定値、ログを機器が追加します。",
  /* bug.what */ "症状",
  /* bug.what_ph */ "今朝からHome Assistantのタンク温度が12800 °Cと表示されます。",
  /* bug.need_text */ "まず症状を1～2文で入力してください。",
  /* bug.continue */ "報告を作成",
  /* bug.step2_title */ "報告内容を確認",
  /* bug.step2 */ "以下を確認してください。ボタンで内容をコピーし、説明を入力済みのGitHubフォームを開きます。「Device report」へ貼り付け、残りを回答して送信してください。",
  /* bug.collecting */ "機器データを収集中…",
  /* bug.collect_fail */ "機器を読めませんでした — 不足項目は以下の報告に示されます。",
  /* bug.copy */ "コピーしてGitHubを開く",
  /* bug.download */ ".mdを保存",
  /* bug.md_hint */ "コピーできない場合は同じ報告を.mdで保存し、テキストの代わりに「Device report」欄へファイルを追加してください。",
  /* bug.copied */ "報告をコピーしました — 「Device report」へ貼り付けてください",
  /* bug.copy_fail */ "コピー失敗 — 以下を選択して手動でコピーしてください",
  /* bug.redacted */ "ネットワーク名、アドレス、ブローカー名、サーバー名は除去済みです。",
  /* nav.settings */ "設定",
  /* nav.back */ "戻る",
  /* nav.settings_alert */ (n) => `設定 — 接続エラー ${n}件`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "両方の値が一致",
  /* src.delta */ (d, u) => `差 ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "両方の状態が不一致",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "検索中…",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "接続",
  /* conn.offline */ "オフライン",
  /* conn.disabled */ "無効",
  /* conn.connecting */ "接続中…",
  /* conn.connected */ "接続済み",
  /* conn.resolving */ "名前解決中…",
  /* conn.eth_no_cable */ "ケーブル未接続",
  /* conn.eth_no_lease */ "ケーブル接続済み・アドレスなし",
  /* conn.eth_fd */ "全二重",
  /* conn.enabled */ "有効",
  /* conn.enabled_noping */ "有効・ホスト応答なし",
  /* conn.synced */ "同期済み",
  /* conn.syncing */ "同期中…",
  /* conn.error */ (e) => "エラー: " + e,
  /* conn.connected_to */ (s) => "接続先 " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}。タップして編集。`,
  /* modbus.err.mdns_not_found */ "mDNSでHomeHubが見つかりません。",
  /* modbus.err.no_address */ "HomeHubのアドレスが未設定です。",
  /* modbus.err.resolve_failed */ "HomeHubのアドレスを解決できません。",
  /* modbus.err.connect_timeout */ "接続タイムアウト — HomeHubに到達できません。",
  /* modbus.err.connection_refused */ "HomeHubには到達しましたが、Modbus TCPポートが閉じています。",
  /* modbus.err.network_unreachable */ "HomeHubへのネットワーク経路がありません。",
  /* modbus.err.host_unreachable */ "ネットワーク上のHomeHubに到達できません。",
  /* modbus.err.connect_failed */ "HomeHubへの接続に失敗しました。",
  /* modbus.err.request_failed */ (r) => `Modbus要求を作成できません${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.send_timeout */ (r) => `Modbus要求の送信がタイムアウトしました${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.send_failed */ (r) => `Modbus要求を送信できません${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.response_timeout */ (r) => `HomeHubの応答がタイムアウトしました${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.connection_closed */ (r) => `HomeHubが接続を閉じました${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.receive_failed */ (r) => `HomeHubの応答を読めません${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.invalid_response */ (r) => `無効なModbus応答です${r ? `（レジスタ ${r}）` : ""}。`,
  /* modbus.err.internal_error */ "Modbusポーリング内部エラーです。",
  /* modbus.err.exception */ (r, n, why) => `HomeHubがレジスタ ${r || "?"} を拒否しました（例外 ${n}: ${why}）。`,
  /* modbus.exc.1 */ "未対応の機能",
  /* modbus.exc.2 */ "無効なデータアドレス",
  /* modbus.exc.3 */ "無効なデータ値",
  /* modbus.exc.4 */ "機器エラー",
  /* modbus.exc.5 */ "要求を受理",
  /* modbus.exc.6 */ "機器がビジー",
  /* modbus.exc.8 */ "メモリパリティエラー",
  /* modbus.exc.10 */ "ゲートウェイ経路なし",
  /* modbus.exc.11 */ "対象から応答なし",
  /* modbus.exc.unknown */ "原因不明",
  /* card.model */ "機種",
  /* card.hplink */ "ヒートポンプ接続",
  /* card.online */ "オンライン",
  /* card.uptime */ "稼働時間",
  /* card.freeheap */ "空きメモリ",
  /* card.maxalloc */ "最大連続空き領域",
  /* card.offline */ "オフライン",
  /* card.protocol */ "プロトコル",
  /* card.rxpin */ "RXピン",
  /* card.txpin */ "TXピン",
  /* card.capacity */ "能力",
  /* card.hplink_help */ "ESP32がX10A経由でヒートポンプから有効な応答を受信中か示します。",
  /* card.protocol_help */ "X10A-IとX10A-Sは対応する2種類のサービス通信形式です。有効な応答から自動判定します。",
  /* card.rxpin_help */ "ヒートポンプのX10AデータをESP32が受信するGPIOです。オフライン時に組み合わせを選ぶと自動検出を再開します。",
  /* card.txpin_help */ "ESP32がX10A要求を送るGPIOです。RXとTXは別のピンとし、実配線に合わせてください。",
  /* card.capacity_iu */ "能力（室内機）",
  /* card.candidates */ "候補機種",
  /* card.oueeprom */ "室外機ID",
  /* card.checkup */ "設備診断 · 24時間",
  /* service.title */ "暖房運転中の冷媒回路",
  /* service.state.waiting */ "暖房運転を待機",
  /* service.state.observing */ "記録中",
  /* service.state.limited */ "記録中・一部データ不足",
  /* service.state.interrupted */ "一時停止",
  /* service.row.window */ "これまでの記録",
  /* service.row.reason */ "この状態の理由",
  /* service.reason.unsupported_profile */ "この機種では必要な測定値をすべて取得できません。",
  /* service.reason.compressor_not_running */ "圧縮機が運転していません。",
  /* service.reason.unsupported_or_unknown_mode */ "通常の暖房運転ではないか、運転モードを取得できません。",
  /* service.reason.dhw_path */ "給湯を加熱しています。",
  /* service.reason.defrost */ "室外機が除霜中です。",
  /* service.reason.unit_fault */ "ヒートポンプが異常を報告しています。",
  /* service.reason.special_controller_phase */ "短い起動または特別制御中です。",
  /* service.reason.missing_fresh_signal */ "必要な現在値が少なくとも1つ不足しています。",
  /* service.reason.poll_gap */ "X10A 接続が中断または意図的に一時停止されました。",
  /* service.window */ (d, n) => `${d} · 現在値 ${n} 件`,
  /* service.help.observing */ "通常の暖房運転中の値を連続して記録しています。",
  /* service.help.limited */ "記録中ですが、比較用の追加測定値が一部ありません。",
  /* service.help.interrupted */ "記録を終了し、次の対象暖房運転で自動的に再開します。",
  /* service.common */ "対応機種では通常暖房で自動開始し、サービスモードも設定変更も不要です。冷媒量や正常範囲は判定しません。弁の値は制御指令で、実測位置ではありません。",
  /* check.fault */ "機器異常",
  /* check.dhw_loss */ "給湯タンク熱損失",
  /* check.cycling */ "圧縮機起動",
  /* check.defrost */ "霜取り回数",
  /* check.pressure */ "最低水圧",
  /* check.flow */ "最低流量",
  /* check.heater */ "補助ヒーター",
  /* check.retries */ "保護再試行",
  /* check.status.ok */ "OK",
  /* check.status.info */ "参考",
  /* check.status.warn */ "警告",
  /* check.status.collecting */ "確認中",
  /* check.status.observation */ "測定のみ",
  /* check.status.experimental */ "試験的",
  /* check.status.unavailable */ "利用不可",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · ${n}/${a}件を評価` : s,
  /* check.detail.value_label */ "値:",
  /* check.detail.assessment_label */ "評価:",
  /* check.detail.ok */ "評価完了。観測データに所見はありません。",
  /* check.detail.info */ "参考情報であり、故障の証明ではありません。注目範囲は下の「正常」を参照してください。",
  /* check.detail.warn */ "機器の所見または文書上の限界に注意が必要です。",
  /* check.detail.fault.error */ "現在エラーを報告中です。正確なコードは「運転」カードにあります。",
  /* check.detail.fault.warning */ "現在はエラーではなく警告を報告中です。正確なコードは「運転」カードにあります。",
  /* check.detail.fault.past */ "現在の報告はありません。過去24時間に発生して自然復旧したためOKではありません。解消済みなら対応不要ですが、再発時刻を記録してください。",
  /* check.detail.fault.past_unknown */ "過去24時間に通知がありました。異常行が応答せず現在状態は不明です。X10A接続を確認してください。",
  /* check.detail.collecting */ (n, r) => `${r}件中${n}件取得。まだ評価できません。`,
  /* check.detail.cycling_split */ " 確認済みの室内暖房だけを評価します。給湯は条件が異なり、確認済み冷房は除外します。各運転全体で3WVと室内回路のI/U運転モードが読取可能かつ不変な場合のみ分類し、それ以外は未分類で評価しません。",
  /* check.detail.cycling_pooled */ " 分類根拠が不足（入力不足、分類済み12運転未満、または未分類が完了運転の10%超）のため全運転をまとめて評価します。給湯や冷房が短い暖房運転を隠す場合があります。併記の分類値は観測であり判定根拠ではありません。",
  /* check.detail.outdoor_cycling */ " X10A室外値は、完了し一貫して室内暖房と分類された運転の新鮮な試料だけです。参考情報で、しきい値や判定は変えません。",
  /* check.detail.outdoor_defrost */ " X10A室外値は、霜取り・圧縮機状態を読めて圧縮機が運転中の新鮮な試料だけです。参考情報で、しきい値や判定は変えません。",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `正常な1時間窓 ${r}件中${n}件完了。現在 ${w}件中${c}件。`,
  /* check.detail.dhw_settling */ (n, r, s) => `正常な1時間窓 ${r}件中${n}件完了。タンク加熱またはBSHを検出し、安定待ち残り${s}。`,
  /* check.detail.dhw_waiting */ (n, r) => `正常な1時間窓 ${r}件中${n}件完了。まだ完全な1時間窓がありません。`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` 候補窓${n}件を除外（${reasons}）。最長 ${best}/60分。`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `この方法では評価不能です。24時間で正常な1時間窓が完成せず、候補${n}件を除外（${reasons}）、最長 ${best}/60分でした。タンク加熱には連続105分（安定45分＋評価60分）が必要です。取湯、ポンプ動作、読取不能、取湯に見える速い連続熱損失でも窓が成立しません。保存集計では主因を特定できず、速い連続熱損失も除外できません。`,
  /* check.detail.dhw_blocked_link */ (n, best) => `評価不能です。24時間で正常な1時間窓が完成せず、候補${n}件は途中でX10A応答が止まり全て除外、最長 ${best}/60分でした。設備ではなく接続の問題です。X10A配線とRX/TXピンを確認してください。`,
  /* check.detail.dhw_reason.charge */ "タンク加熱",
  /* check.detail.dhw_reason.pump */ "内部ポンプ",
  /* check.detail.dhw_reason.draw */ "取湯様の低下",
  /* check.detail.dhw_reason.reading */ "不自然なR5T",
  /* check.detail.dhw_reason.blind */ "X10A応答なし",
  /* check.detail.collecting_unknown */ "評価に使える根拠がまだ不足しています。",
  /* check.detail.observation */ "測定値のみ。共通のOK/警告限界はありません。",
  /* check.detail.experimental */ "試験的観測です。カウンタが安定していても制限なしとは証明できません。",
  /* check.detail.unavailable */ "現在のプロファイルには、この確認を評価できるデータがありません。",
  /* check.starts */ (n) => `${n}回起動`,
  /* check.cycles */ (n) => `${n}サイクル`,
  /* check.paired_cycles */ (n) => `${n}組`,
  /* check.mean */ (d) => `${d}/起動`,
  /* check.cycling_space */ (n, d) => d ? `暖房 ${n} × ${d}` : `暖房 ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `給湯 ${n} × ${d}` : `給湯 ${n}`,
  /* check.cycling_cooling */ (n) => `冷房${n}件を除外`,
  /* check.cycling_censored */ (n) => `未分類${n}件`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} 最低 ${min} °C · 平均 ${mean} °C`,
  /* check.min */ (m) => `${m}分`,
  /* check.tank */ (m) => `タンク ${m}分`,
  /* check.tank_runtime */ (d) => `タンク ${d}`,
  /* check.loss_windows */ (n) => `${n}窓`,
  /* check.loss_pump_off */ "循環ポンプ停止中も発生",
  /* check.loss_with_pump */ "循環ポンプ運転中",
  /* check.loss_unattributed */ "ポンプとの対応が不完全",
  /* check.fault_err */ "異常作動中",
  /* check.fault_warn */ "警告作動中",
  /* check.fault_past */ "過去24時間に発生 · 現在は解消",
  /* check.fault_none */ "現在なし",
  /* check.fault_unknown */ "現在状態不明",
  /* check.fault_past_unknown */ "過去24時間に発生 · 現在状態不明",
  /* check.retry_seen */ "カウンタ増加あり",
  /* check.retry_none */ "増加なし",
  /* values.waiting */ "初回取得を待機中…",
  /* values.sg_x10a_mode */ "Smart-Gridモード（X10A接点）",
  /* group.Operation */ "運転",
  /* group.Domestic hot water */ "給湯",
  /* group.Water circuit */ "水回路",
  /* group.Refrigerant / outdoor */ "冷媒・室外",
  /* group.Electrical */ "電気",
  /* group.Device */ "機器",
  /* group.Other values */ "その他の値",
  /* group.Protection */ "保護",
  /* protect.limiting */ "現在制限中",
  /* group.Values */ "値",
  /* state.on */ "入",
  /* state.off */ "切",
  /* enum.auto */ "自動",
  /* enum.heating */ "暖房",
  /* enum.cooling */ "冷房",
  /* enum.no_error */ "異常なし",
  /* enum.fault */ "異常",
  /* enum.warning */ "警告",
  /* enum.space_heating */ "室内暖房",
  /* enum.dhw */ "給湯",
  /* enum.free_running */ "通常運転",
  /* enum.forced_off */ "強制停止",
  /* enum.recommended_on */ "運転推奨",
  /* enum.forced_on */ "強制運転",
  /* enum.unknown */ (n) => `不明 (${n})`,
  /* chip.space_on */ "室内空調 入",
  /* chip.space_off */ "室内空調 切",
  /* chip.quiet */ "静音",
  /* schem.sg_boost */ "ブースト",
  /* sg.mode0 */ "通常運転",
  /* sg.mode1 */ "強制停止",
  /* sg.mode2 */ "運転推奨",
  /* sg.mode3 */ "強制運転",
  /* schem.to_dhw */ "3WV → 給湯",
  /* schem.to_space */ "3WV → 室内",
  /* normal.label */ "正常:",
  /* meaning.label */ "見方:",
  /* hist.title */ "過去24時間",
  /* hist.recorded */ (h) => `記録 · ${h}時間`,
  /* hist.now */ "現在",
  /* hist.ago */ (h) => `${h}時間前`,
  /* hist.loading */ "推移を読込中…",
  /* hist.none */ "記録はまだありません。",
  /* hist.err */ "推移を表示できません。",
  /* hist.gaps */ (n) => `未測定 ${n}区間`,
  /* hist.nm */ "未測定",
  /* hist.rel */ (h) => `${h}時間前`,
  /* hist.held */ "室外機停止中",
  /* hist.heldnote */ (h) => `${h}時間停止 — 未測定`,
  /* hist.forecast */ "Open-Meteo · 予報",
  /* hist.in_hours */ (h) => `${h}時間後`,
  /* hist.aria */ (l) => `${l} — 24時間推移。矢印キーで各試料を読み上げます。`,
  /* hist.aria_pinned */ (l, r) => `${l} — 24時間推移。固定値: ${r}。再度タップで解除。`,
  /* hist.pin_hint */ "タップで固定",
  /* hist.duration_min */ (m) => `${m}分`,
  /* hist.duration_h */ (h) => `${h}時間`,
  /* hist.duration_hm */ (h, m) => `${h}時間${m}分`,
  /* hist.duration_sec */ (s) => `${s}秒`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · 約${d}`,
  /* hist.state_active */ "作動中",
  /* hist.state_off */ "停止",
  /* val.since */ (d) => `${d}継続`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `うち${d}は未観測`,
  /* hist.modbus_plateau */ (when, d) => `レジスタ値不変 ${when} · 約${d} · 測定時刻不明`,
  /* hist.boost_total */ (d) => `ブースト作動 · ${d}`,
  /* hist.boost_none */ "記録期間にブーストなし。",
  /* hist.boost_ago_range */ (a, b) => `${a}～${b}時間前`,
  /* hist.boost_active */ "ブースト作動",
  /* hist.boost_inactive */ "ブースト停止",
  /* hist.boost_aria */ (l, d) => `${l} — Smart-Grid 4モードの推移。${d}。矢印キーで各試料を確認。`,
  /* hist.defrost_total */ (d) => `霜取り作動を観測 · 標本時間 ${d}`,
  /* hist.defrost_none */ "記録期間に霜取りを観測せず。",
  /* hist.defrost_active */ "霜取り作動",
  /* hist.defrost_inactive */ "霜取り停止",
  /* hist.defrost_aria */ (l, d) => `${l} — 霜取り推移。${d}。矢印キーで各試料を確認。`,
  /* hist.quiet_total */ (d) => `静音モードを観測 · 標本時間 ${d}`,
  /* hist.quiet_none */ "記録期間に静音モードを観測せず。",
  /* hist.quiet_active */ "静音モード作動",
  /* hist.quiet_inactive */ "静音モード停止",
  /* hist.quiet_aria */ (l, d) => `${l} — 静音モード推移。${d}。矢印キーで各試料を確認。`,
  /* hist.heater_total */ (d) => `タンクヒーターを観測 · 標本時間 ${d}`,
  /* hist.heater_none */ "記録期間にタンクヒーターを観測せず。",
  /* hist.heater_active */ "ヒーター作動",
  /* hist.heater_inactive */ "ヒーター停止",
  /* hist.heater_aria */ (l, d) => `${l} — タンクヒーター推移。${d}。矢印キーで各試料を確認。`,
  /* hist.preheat_total */ (d) => `タンク予熱を観測 · 標本時間 ${d}`,
  /* hist.preheat_none */ "記録期間にタンク予熱を観測せず。",
  /* hist.preheat_active */ "タンク予熱作動",
  /* hist.preheat_inactive */ "タンク予熱停止",
  /* hist.preheat_aria */ (l, d) => `${l} — X10Aタンク予熱推移。${d}。矢印キーで各試料を確認。`,
  /* hist.disinfection_total */ (d) => `除菌運転を観測 · 標本時間 ${d}`,
  /* hist.disinfection_none */ "記録期間に除菌運転を観測せず。",
  /* hist.disinfection_active */ "除菌作動",
  /* hist.disinfection_inactive */ "除菌停止",
  /* hist.disinfection_aria */ (l, d) => `${l} — HomeHub除菌推移。${d}。矢印キーで各試料を確認。`,
  /* hist.buh_total */ (d) => `補助ヒーターを観測 · 標本時間 ${d}`,
  /* hist.buh_none */ "記録期間に補助ヒーターを観測せず。",
  /* hist.buh_active */ "補助ヒーター作動",
  /* hist.buh_inactive */ "補助ヒーター停止",
  /* hist.buh_step1 */ "段1",
  /* hist.buh_step2 */ "段2",
  /* hist.buh_aria */ (l, d) => `${l} — 補助ヒーター推移。${d}。矢印キーで各試料を確認。`,
  /* hist.valve_dhw_total */ (d) => `給湯 · ${d}`,
  /* hist.valve_space_total */ (d) => `室内回路 · ${d}`,
  /* hist.valve_none */ "記録期間に給湯位置なし。",
  /* hist.valve_dhw */ "給湯",
  /* hist.valve_space */ "室内回路",
  /* hist.valve_aria */ (l, d) => `${l} — 3方弁推移。${d}。矢印キーで各試料を確認。`,
  /* hist.circ_total */ (d) => `ポンプ運転を観測 · 標本時間 ${d}`,
  /* hist.circ_none */ "記録期間にポンプ運転を観測せず。",
  /* hist.circ_on */ "運転中",
  /* hist.circ_off */ "停止",
  /* hist.circ_unavailable */ "利用不可",
  /* hist.circ_gaps */ (n) => `利用不可 ${n}区間`,
  /* hist.circ_aria */ (l, d) => `${l} — 循環ポンプ推移。${d}。矢印キーで各試料を確認。`,
  /* hist.valve2_on_total */ (d) => `2WV出力 入 · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV出力 切 · ${d}`,
  /* hist.valve2_on */ "2WV出力 入",
  /* hist.valve2_off */ "2WV出力 切",
  /* hist.valve2_none */ "選択期間に2WV出力の入状態なし。",
  /* hist.valve2_aria */ (l, d) => `${l} — 2WV出力推移。${d}。矢印キーで各試料を確認。`,
  /* hist.flow_switch_total */ (d) => `X10A状態 入 · 標本時間 ${d}`,
  /* hist.flow_switch_on */ "X10A状態 入",
  /* hist.flow_switch_off */ "X10A状態 切",
  /* hist.flow_switch_none */ "選択期間にこのX10A状態の入記録なし。",
  /* hist.flow_switch_aria */ (l, d) => `${l} — 流量スイッチ推移。${d}。矢印キーで各試料を確認。`,
  /* toast.saved */ "保存しました",
  /* toast.no_changes */ "変更なし",
  /* toast.reboot */ "再起動中 — 再接続中…",
  /* toast.rebooted */ "再起動完了 — 機器へ再接続してください",
  /* toast.busy_retry */ "機器がビジー — 少し待って再試行してください",
  /* toast.unreachable */ "機器に接続できません",
  /* toast.rejected */ "拒否されました",
  /* toast.applying */ "前回の変更を適用中…",
  /* toast.check_wifi */ "WiFi設定を確認してください",
  /* toast.check_broker */ "ブローカーアドレスを確認してください",
  /* toast.check_syslog_port */ "syslogポートを確認してください",
  /* toast.verifying_mqtt */ "MQTT接続を確認中…",
  /* toast.saving_syslog */ "syslog設定を保存中…",
  /* toast.saving_ntp */ "NTP設定を保存中…",
  /* toast.trying_pins */ "ピンを試行中…",
  /* toast.saving_board */ "基板設定を保存中…",
  /* ota.uptodate */ "最新です",
  /* ota.check_failed */ "確認失敗",
  /* ota.starting */ "開始中…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "再起動中…",
  /* ota.failed */ "更新失敗",
  /* ota.timeout */ "タイムアウト",
  /* ota.cancelled */ "中止しました",
  /* ota.busy */ "機器がビジー",
  /* ota.replaced */ "更新処理が変わりました — 再確認してください",
  /* ota.unreachable */ "機器に接続不可",
  /* ota.active_title */ "ファームウェア更新",
  /* ota.active_sub */ (detail) => `インストール中 · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `インストール中 · ${detail} · 最終受信状態`,
  /* ota.snapshot_title */ "ファームウェア更新",
  /* ota.snapshot_label */ "データ状態",
  /* ota.snapshot_value */ "スナップショット",
  /* ota.snapshot_help */ "再読込前の最終受信状態です。インストール中はライブデータが止まる場合があり、再起動まで設定はロックされます。",
  /* ota.reload_hint */ "導入済み — ページを再読込",
  /* ota.dialog_title */ "ファームウェア更新",
  /* ota.switch_title */ "ファームウェア版を切り替える",
  /* ota.changes_title */ "このアップデートの変更内容",
  /* ota.no_changes */ "このアップデートの変更履歴は提供されていません。",
  /* ota.install_help */ "署名済みイメージを取得・導入して再起動します。新しいファームウェアがオンラインにならない場合、現在のビルドを自動的に復元します。",
  /* ota.switch_help */ "別の更新チャンネルが選択されているため、このビルドは古い版です。導入前に署名を検証し、オンラインにならない場合は現在のビルドを自動的に復元します。",
  /* ota.install */ "更新をインストール",
  /* ota.switch */ "古いビルドをインストール",
  /* aria.ota */ "ファームウェア更新を確認",
  /* ota.title_check */ "タップして更新を確認",
  /* ota.title_avail */ (v) => `v${v}を利用可能 — タップして導入`,
  /* mq.err_format */ "host:portを入力（例 192.168.1.10:1883）、TLSは mqtts://host:8883",
  /* sl.err_port */ "ポートは1～65535の整数です（例 logs.example.com:514）。",
  /* btn.saving */ "保存中…",
  /* btn.verifying */ "確認中…",
  /* btn.save */ "保存",
  /* btn.cancel */ "キャンセル",
  /* btn.close */ "閉じる",
  /* schem.card_aria */ "システムのライブ図：室外機、冷媒回路、プレート式熱交換器、補助ヒーターと3方弁を備えた水回路、給湯タンク、室内回路",
  /* schem.group_aria */ "システムのライブ図——値または部品を選ぶと説明を表示します",
  /* schem.outdoor_unit */ "室外機",
  /* schem.defrost_pill */ "❄ 霜取り",
  /* schem.outdoor */ "外気",
  /* insp.close */ "閉じる",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "給湯タンク",
  /* schem.set */ "設定",
  /* schem.bsh_label */ "電気ヒーター",
  /* schem.space_circuit */ "室内回路",
  /* schem.heating */ "暖房",
  /* schem.cooling */ "冷房",
  /* schem.pump */ "ポンプ",
  /* schem.return */ "R4T",
  /* schem.room */ "室温",
  /* schem.flow_rate */ "流量",
  /* schem.water_press */ "水圧",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "流量スイッチ",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "WiFi設定",
  /* wifi.ssid */ "WiFiネットワーク（SSID）",
  /* wifi.pass */ "WiFiパスワード",
  /* wifi.err_ssid */ "SSIDは32文字以内です",
  /* wifi.err_pass */ "パスワードは空（公開ネットワーク）または8～63文字です",
  /* wifi.hint */ "WiFi名を入力してください。接続できない場合は以前のWiFi設定へ自動で戻します。",
  /* mqtt.title */ "MQTTブローカー",
  /* mqtt.hostport */ "ホスト : ポート",
  /* mqtt.user */ "ユーザー名 · 任意",
  /* mqtt.pass */ "パスワード · 任意",
  /* mqtt.clear */ "保存済み認証情報を削除 — 匿名接続",
  /* mqtt.hint */ "ユーザー名またはパスワードを使う場合はTLS暗号化接続が必要です（例 mqtts://host:8883）。ホストを空にするとMQTTを無効化します。",
  /* mqtt.base */ "ベーストピック",
  /* mqtt.base_hint */ "機器ごとに固有のベーストピックが必要です。同じブローカーで重複するとトピック、メトリクス、Home Assistant機器を共有します。変更するとHome Assistant上の名前が変わり、古い保持トピックはブローカーに残ります。",
  /* err.mqtt_base_too_long */ "ベーストピックが長すぎます。",
  /* err.mqtt_base_wildcard */ "ベーストピックに + や # は使えません。これらは購読用ワイルドカードで、配信先には使えません。",
  /* err.mqtt_base_reserved */ "ベーストピックを $ で始められません。この領域はブローカー用です。",
  /* err.mqtt_base_slash */ "ベーストピックの先頭・末尾に / は使えません。",
  /* err.mqtt_base_control */ "ベーストピックに制御文字は使えません。",
  /* err.mqtt_base_space */ "ベーストピックに空白は使えません。",
  /* err.mqtt_base_empty_segment */ "ベーストピックに空区間（//）は使えません。",
  /* err.mqtt_base_not_sluggable */ "ベーストピックには英数字が1文字以上必要です。Home Assistantの機器IDに使うため、ないと機器同士が衝突します。",
  /* mqtt.err.waiting_x10a */ "X10Aから応答がありません。配線、GND、RX/TX端子を確認してください。",
  /* mqtt.err.task_alloc */ "MQTTタスクを起動できません。機器を再起動し、診断を確認してください。",
  /* mqtt.err.transport */ "ブローカーへのTLS/TCP接続に失敗しました。",
  /* mqtt.err.refused */ "ブローカーが接続を拒否しました。ユーザー名とパスワードを確認してください。",
  /* mqtt.err.connection */ "MQTTブローカーへの接続に失敗しました。",
  /* dyn.card */ "暖房曲線診断",
  /* dyn.state */ "状態",
  /* dyn.state_recording */ "記録中",
  /* dyn.state_recording_nowx */ "記録中 · 予報なし",
  /* dyn.state_waiting */ "暖房待機中",
  /* dyn.state_cooling */ "冷房中 · 採取なし",
  /* dyn.state_room */ "室温ソース使用不可",
  /* dyn.state_x10a */ "X10Aオフライン",
  /* dyn.state_homehub */ "HomeHubオフライン",
  /* dyn.state_gate */ "設備状態不明",
  /* dyn.state_mode */ "暖房／冷房モード不明",
  /* dyn.state_clock */ "時計未設定",
  /* dyn.state_blocked */ "記録停止",
  /* dyn.state_setup_room */ "室温ソースを設定",
  /* dyn.state_setup_homehub */ "HomeHub未設定",
  /* dyn.state_homehub_disabled */ "診断停止 · HomeHub無効",
  /* dyn.state_no_broker */ "記録停止 · MQTTなし",
  /* dyn.state_safe_mode */ "記録停止 · セーフモード",
  /* dyn.state_inactive */ "記録停止 · 採取器停止",
  /* dyn.room_off */ "室温サーモ停止",
  /* dyn.room_not_heating */ "室温サーモが暖房モードではありません",
  /* dyn.room_stale */ "室温データが古すぎます",
  /* dyn.room_no_value */ "室温データ待ち",
  /* dyn.room_invalid_payload */ "MQTTメッセージが無効です",
  /* dyn.room_invalid_temperature */ "室温が許容範囲外です",
  /* dyn.room_invalid_setpoint */ "目標温度が許容範囲外です",
  /* dyn.room_no_setpoint */ "目標温度がありません",
  /* dyn.room_no_time */ "測定時刻がありません",
  /* dyn.room_retained_no_time */ "測定時刻のない保持値",
  /* dyn.room_future_time */ "測定時刻が未来です",
  /* dyn.room_backward_time */ "測定時刻が逆行しました",
  /* dyn.room_invalid_time */ "測定時刻が無効です",
  /* dyn.room_no_enabled */ "サーモON/OFF状態がありません",
  /* dyn.room_no_hvac_mode */ "サーモ運転モードがありません",
  /* dyn.room_source */ "室温ソース",
  /* dyn.weather */ "任意の比較予報",
  /* dyn.strategy */ "診断信号",
  /* dyn.not_configured */ "未設定",
  /* dyn.outdoor */ "外気実測値",
  /* dyn.outdoor_detail_status */ "状態",
  /* dyn.outdoor_detail_now */ "現在値",
  /* dyn.outdoor_detail_sample */ "直近の記録イベント時",
  /* dyn.outdoor_status_live */ (source) => `${source}に現在値があります。各イベントへ参考値として記録します。`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source}は設定済みですが現在値がありません。この軸なしで記録を続けます。`,
  /* dyn.outdoor_status_absent */ (source) => `${source}は未設定です。この軸なしで記録を続けます。`,
  /* dyn.outdoor_status_idle */ (source) => `${source}は設定済みですが現在は記録していません。理由は上の状態欄に表示されます。`,
  /* dyn.outdoor_sample_none */ "外気値なしで記録",
  /* dyn.outdoor_help_axis */ "外気温があると室温偏差を状況別に読めます。−5 °Cと+12 °Cでの+0.5 Kは原因が異なり得ます。外気値は任意で、記録可否の判定には使いません。",
  /* dyn.outdoor_help_placement */ "表示値はセンサー設置場所の温度です。室内機付近なら室温、日陰の屋外なら外気温です。ファームウェアは設置場所を判別できません。",
  /* dyn.outdoor_help_setup */ "基板のGrove端子に接続したM5Stack ENV IIIも利用できます。屋外の日陰なら、室外機休止中も外気を連続測定します。ESP32 → ハードウェアで基板と共に設定します。",
  /* dyn.plant_outdoor */ "設備外気温",
  /* dyn.plant_outdoor_help */ "HomeHub入力44の外気温です。暖房判定と同じModbus周期から取得し、ソースも保存します。ENV IIIとは別で、記録可否には影響しません。",
  /* dyn.shadow_strategy */ "室温偏差（生値）· 30分",
  /* dyn.card_help */ "暖房と明確に判定できる間、30分ごとに基準室温と目標の差を外気温と共に記録します。運転時間、最低往水制限、サーモ動作と合わせて暖房曲線の高低傾向を読みます。1 Kの室温差が1 Kの往水変更を意味するわけではなく、ヒートポンプへは書き込みません。",
  /* dyn.state_help_recording */ "暖房運転と有効な室温入力を確認できたため、生の室温誤差を記録中です。季節傾向を運転時間と制限証拠と共に読み、単発値で判定しません。",
  /* dyn.state_help_waiting */ "現在は通常の暖房運転ではないため採取しません。夏季は正常な待機状態で、故障ではありません。",
  /* dyn.state_help_cooling */ "HomeHubは通常室内運転を示しますが、現在は冷房です。暖房曲線のデータから冷房時間を除外します。",
  /* dyn.state_help_blocked */ "必要な入力がないため記録していません。入力が戻れば再開し、古い／曖昧な証拠は採取しません。",
  /* dyn.state_help_room */ "室温値は届いていますが、現在は目標との差を有効に算出できません。ソースが有効になるまで採取しません。",
  /* dyn.state_help_setup */ "時刻付きMQTT室温ソースと目標を保存すると診断を開始します。予報は任意で、位置情報の提供は不要です。",
  /* dyn.state_help_inactive */ "ソースは設定済みですが評価処理が動いていません。採取器はMQTT接続上で動作し、反復クラッシュ後のセーフモードでは任意機能を停止します。通常起動すれば自動再開します。",
  /* dyn.state_help_no_broker */ "室温ソースは保存済みですがMQTTブローカーが未設定です。接続カードで設定すると自動で記録を開始します。",
  /* dyn.state_help_setup_homehub */ "実際の暖房時間を判別するにはHomeHubが必要です。ないとDHWや停止と区別できません。プロトコルカードでアドレスを設定してください。",
  /* dyn.state_help_homehub_disabled */ "この診断はHomeHubの2信号に依存します。アドレスが空ならModbusも診断も動作しません。",
  /* dyn.strategy_help */ "採取値は目標室温−実室温です。正なら目標未満、負なら超過。デッドバンド、丸め、制限はなく、校正済みの往水補正値ではありません。基準室は暖房ゾーンを代表する必要があり、サーモや閉弁が過高な曲線を隠す場合があります。往水最低値での制限割合と熱要求も合わせて読みます。",
  /* env.title */ "外気センサー",
  /* env.card */ "屋外環境",
  /* env.none */ "センサーなし",
  /* env.temperature */ "温度",
  /* env.humidity */ "湿度",
  /* env.pressure */ "気圧",
  /* env.sensor_state */ "センサー",
  /* env.live */ "現在値",
  /* env.collecting */ "収集中…",
  /* env.history_title */ "ENV III測定値",
  /* env.history_help */ "温度・湿度・気圧を5分間隔の24時間推移としてESP32に保持します。",
  /* env.history_scales */ "個別目盛",
  /* env.unavailable */ "センサー使用不可",
  /* env.err_pins */ "SDAとSCLには異なる有効端子を指定してください",
  /* env.saving */ "外気センサー設定を保存中…",
  /* env.checking */ "ENV IIIを確認中…",
  /* env.err_not_reachable */ "指定したSDA/SCL端子でENV IIIに接続できません。",
  /* env.err_sht30 */ "指定端子でENV III温湿度センサーに接続できません。",
  /* env.err_qmp6988 */ "指定端子でENV III気圧センサーに接続できません。",
  /* env.err_disable_first */ "SDA/SCL端子を変更する前に「センサーなし」を選んで保存してください。",
  /* env.pins_hint */ "SDA＝データ（Grove黄線）、SCL＝クロック（白線）。選んだGPIOが逆なら反対順も検証し、動作する割当てを自動保存します。",
  /* env.atoms3_header_hint */ "AtomS3 Liteでは本体端子のGPIO5～8またはGPIO38を選びます。Grove端子（GPIO2/1）はX10Aが未使用のときだけ表示されます。同じ端子をX10AとI2Cで共有できません。GPIO39はENV IIIに使えません。",
  /* ref.title */ "室温ソース",
  /* ref.name */ "名前",
  /* ref.temperature_source */ "温度ソース",
  /* ref.target */ "目標温度",
  /* ref.timestamp_source */ "時刻ソース · 任意",
  /* ref.max_age */ "最大経過時間 · 秒",
  /* ref.temperature_source_help */ "正確なMQTTトピックと、任意で $ 以降のJSONパスを指定します。欠落／誤ったパスは受信時に報告します。",
  /* ref.target_help */ "固定温度（°C）、または任意の $ 以降のJSONパスを含む正確なMQTTトピック。",
  /* ref.timestamp_source_help */ "任意のRFC3339/Unix測定時刻をtopic$pathで指定。空ならMQTT到着時刻を使い、保持値は安全側で拒否します。",
  /* ref.max_age_help */ "ソース値の最大許容経過時間（10～3600秒）。",
  /* ref.error */ "直近エラー",
  /* ref.broker_off */ "MQTTブローカー無効",
  /* ref.retained */ "ブローカー保持値",
  /* ref.time_untrusted */ "信頼できる測定時刻のない保持値",
  /* ref.clock_unsynced */ "機器時計未同期",
  /* ref.now */ "現在",
  /* ref.ago */ (s) => `${s}秒前`,
  /* ref.age_unknown */ "不明",
  /* ref.saved */ "室温ソースを保存しました",
  /* ref.detail.status_label */ "状態：",
  /* ref.detail.diagnosis_label */ "暖房曲線診断：",
  /* ref.status.measurement_valid */ "測定有効",
  /* ref.status.not_configured */ "未設定",
  /* ref.status.usable */ "使用可能",
  /* ref.status.unusable */ "使用不可",
  /* ref.status.error */ "エラー",
  /* ref.status.stale */ "古い値",
  /* ref.status.waiting */ "待機中",
  /* ref.status.unavailable */ "使用不可",
  /* ref.detail.setup */ "鉛筆からMQTTソースを追加",
  /* ref.detail.stale */ "値が許容経過時間を超えています",
  /* ref.detail.waiting */ "MQTT値をまだ受信していません",
  /* ref.detail.error */ (e) => `MQTTメッセージを拒否：${e}`,
  /* ref.detail.temperature_label */ "室温：",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "目標温度：",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "最新値：",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · 許容：最大${max}秒`,
  /* ref.detail.purpose */ "室温と目標を比較し、暖房曲線が高すぎる／低すぎる傾向を時間と共に示します。ヒートポンプは制御しません。",
  /* ref.delete */ "削除",
  /* ref.deleting */ "削除中…",
  /* ref.deleted */ "室温ソースと取得値を削除しました",
  /* circ.title */ "循環ポンプソース",
  /* circ.row */ "DHW循環ポンプ",
  /* circ.default_name */ "循環ポンプ",
  /* circ.name */ "名前",
  /* circ.topic */ "MQTTトピック",
  /* circ.power_path */ "電力JSONパス",
  /* circ.time_path */ "時刻JSONパス",
  /* circ.power_help */ "実有効電力（W）を使い、リレー出力は使いません。",
  /* circ.time_help */ "RFC3339またはUnix秒の測定時刻。",
  /* circ.on_threshold */ "ONしきい値 · W",
  /* circ.off_threshold */ "OFFしきい値 · W",
  /* circ.max_age */ "最大経過時間 · 秒",
  /* circ.confirm */ "確認時間 · 秒",
  /* circ.hint */ "読取専用。保存時は新しいMQTT値を1件検査するだけで、プラグは操作しません。",
  /* circ.settings_help */ "基板は実ポンプ電力と、汚染のない1時間タンク冷却区間を対応付けます。監視のみでプラグは操作しません。",
  /* circ.not_configured */ "未設定",
  /* circ.unavailable */ "使用不可",
  /* circ.broker_off */ "MQTTブローカーなし",
  /* circ.running */ "運転中",
  /* circ.stopped */ "停止中",
  /* circ.checking */ "確認中",
  /* circ.stale */ "古い値",
  /* circ.waiting */ "メッセージ待ち",
  /* circ.detail.source */ "ソース",
  /* circ.detail.power */ "有効電力",
  /* circ.detail.state */ "検出状態",
  /* circ.detail.age */ "測定経過時間",
  /* circ.delete */ "削除",
  /* circ.deleting */ "削除中…",
  /* circ.deleted */ "循環ポンプソースを削除しました",
  /* circ.saved */ "循環ポンプソースを保存しました",
  /* circ.test_failed */ "読み取り可能な新しいポンプ電力値を受信できません",
  /* circ.err_topic */ "+ や # を含まない正確なMQTTトピックを入力してください",
  /* circ.err_power_path */ "有効電力JSONパスを入力してください（例：apower）",
  /* circ.err_time_path */ "時刻JSONパスを入力してください（例：aenergy.minute_ts）",
  /* circ.err_max_age */ "最大経過時間は10～3600秒の整数にしてください",
  /* circ.err_confirm */ "確認時間は1～600秒の整数にしてください",
  /* circ.err_threshold */ "電力しきい値は小数1桁以内にしてください",
  /* circ.err_order */ "ONしきい値はOFFしきい値より大きくしてください",
  /* wx.title */ "Open-Meteo天気予報",
  /* wx.latitude */ "緯度",
  /* wx.longitude */ "経度",
  /* wx.waiting */ "予報待ち",
  /* wx.fetching */ "Open-Meteo予報を取得中…",
  /* wx.unavailable */ "使用不可",
  /* wx.error */ "Open-Meteo予報エラー",
  /* wx.detail.status */ "状態：",
  /* wx.status.fresh */ "最新",
  /* wx.status.inactive */ "停止",
  /* wx.status.fetching */ "更新中",
  /* wx.status.stale */ "古い値",
  /* wx.status.unavailable */ "使用不可",
  /* wx.status.waiting */ "待機中",
  /* wx.detail.fresh */ "予報を正常に取得しました。",
  /* wx.detail.fetching */ "ESP32が新しい予報を取得中です。",
  /* wx.detail.stale */ "直近の取得が古いため、値は診断参考用にのみ表示します。",
  /* wx.detail.unavailable */ "直近の取得に失敗しました。古い値があれば診断参考用にのみ表示します。",
  /* wx.detail.waiting */ "予報をまだ受信していません。",
  /* wx.detail.temperature_label */ "温度：",
  /* wx.detail.temperature */ (v) => `${v} °Cは、次の完結した2時間の平均外気温予報です。`,
  /* wx.detail.solar_label */ "日射量：",
  /* wx.detail.solar */ (v) => `${v} Wh/m²は、同じ2時間の全天日射量予報です。`,
  /* wx.detail.source_label */ "ソース：",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless。観測専用で、予報はヒートポンプ制御を変更しません。",
  /* wx.err_both */ "緯度と経度を両方入力するか、両方空にして無効化してください",
  /* wx.err_latitude */ "緯度は−90～90の小数にしてください",
  /* wx.err_longitude */ "経度は−180～180の小数にしてください",
  /* wx.saving */ "天気ソースを保存中…",
  /* wx.hint.configured */ "ESP32は45分ごとに予報を取得します。座標がOpen-Meteoへ送信され、接続元の公開IPアドレスも伝わります。両座標を空にすると削除できます。",
  /* wx.hint.setup */ "緯度と経度を入力します。Google Mapsの座標組はどちらの欄にも貼り付けでき、自動分割します。保存後は45分ごとに座標をOpen-Meteoへ送り、公開IPアドレスも伝わります。予報は観測専用で制御を変更しません。",
  /* wx.attribution */ "天気データ：Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "正確なMQTTトピックと、任意で $json-path を入力してください",
  /* ref.err_target */ "5～35 °Cの固定値、または任意で $json-path を伴う正確なMQTTトピックを入力してください",
  /* ref.err_timestamp_source */ "正確なMQTTトピックと、任意で $json-path を入力してください",
  /* ref.err_max_age */ "最大経過時間は10～3600秒の整数にしてください",
  /* ref.save_help */ "保存すると対応付けを記憶します。設備診断が有効な間だけ購読し、それ以外は休止します。読み取れる新しいMQTT値が必要です。",
  /* syslog.title */ "Syslogサーバー",
  /* syslog.hostport */ "ホスト：ポート",
  /* syslog.hint */ "Syslogサーバーをホスト名またはIPアドレスとポートで入力します。空にすると無効です。",
  /* ntp.title */ "NTPサーバー",
  /* ntp.server */ "サーバー",
  /* ntp.hint */ "時刻サーバーのホスト名またはIPアドレスを入力します。空ならファームウェア既定値を使います。",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "ホスト · IPまたは.local名",
  /* homehub.port */ "ポート",
  /* homehub.unit */ "ユニットID",
  /* homehub.hint */ "新しいファームウェアは初回ネットワーク起動時に一度自動検索し、結果を保存します。手動検索や直接入力も可能です。空のアドレスを保存するとHomeHubを恒久無効化し、以後の自動検索、Modbus要求、依存診断を停止します。既定はポート502、ユニットID 1。データソースのみを設定し、ヒートポンプ操作は提供しません。",
  /* hh.search */ "検索",
  /* hh.searching */ "検索中…",
  /* hh.found */ (host) => `HomeHubを検出：${host}`,
  /* hh.not_found */ "HomeHubが見つかりません。アドレスを手動入力してください。",
  /* hh.saved */ "Modbus設定を保存しました",
  /* hh.err_port */ "ポートは1～65535にしてください",
  /* hh.err_unit */ "ユニットIDは1～247にしてください",
  /* board.title */ "基板ハードウェア",
  /* board.ledtype */ "状態LED",
  /* board.none */ "なし",
  /* board.reset_section */ "リセットボタン",
  /* board.env3_section */ "ENV III · 外気センサー",
  /* board.preset */ "基板",
  /* board.preset_custom */ "カスタム",
  /* board.not_selected */ "未選択",
  /* board.led_gpio */ "単色LED（GPIO）",
  /* board.led_ws2812 */ "アドレス指定RGB（WS2812）",
  /* board.ledpin */ "LED端子",
  /* board.btnpin */ "リセットボタン端子",
  /* board.ledlegend_rgb */ "LED色と点滅パターン",
  /* board.ledlegend_gpio */ "LED点滅パターン",
  /* board.led_rgb_off */ "消灯 — Wi-Fiモードなし。",
  /* board.led_rgb_setup */ "青・低速点滅 — 設定ポータル動作中。",
  /* board.led_rgb_connecting */ "黄・高速点滅 — Wi-Fi接続中。",
  /* board.led_rgb_healthy */ "緑・点灯 — 設定済み接続はすべて正常。",
  /* board.led_rgb_bus_down */ "赤・2回点滅 — X10A切断。",
  /* board.led_rgb_mqtt_down */ "橙・点滅 — X10A接続、MQTT切断。",
  /* board.led_rgb_wipe_armed */ "赤・超高速点滅 — 消去準備完了。中止するには離します。",
  /* board.led_rgb_wiping */ "白・点灯 — 初期化/データ完全消去中。電源を切らないでください。",
  /* board.led_gpio_off */ "消灯 — Wi-Fiモードなし。",
  /* board.led_gpio_setup */ "低速点滅 — 設定ポータル動作中。",
  /* board.led_gpio_connecting */ "高速点滅 — Wi-Fi接続中。",
  /* board.led_gpio_healthy */ "点灯 — 設定済み接続はすべて正常。",
  /* board.led_gpio_bus_down */ "2回点滅 — X10A切断。",
  /* board.led_gpio_mqtt_down */ "中速点滅 — X10A接続、MQTT切断。",
  /* board.led_gpio_wipe_armed */ "超高速点滅 — 消去準備完了。中止するには離します。",
  /* board.led_gpio_wiping */ "超高速点滅後に点灯 — 初期化/データ完全消去中。電源を切らないでください。",
  /* board.ledinv */ "アクティブLOW（端子LOWでLED点灯）",
  /* board.btninv */ "アクティブLOW（ボタンで端子をGNDへ短絡）",
  /* board.hint */ "工場出荷時リセット：ボタンを5秒押す。Wi-Fi/全設定、履歴/トレンド、状態継続時間、未加工コアダンプを完全消去。全消去成功時のみ設定ポータルが開く。開かなければ離して再度5秒押す。未接続なら「なし」。",
  /* card.hardware */ "ハードウェア",
  /* card.hw_off */ "なし",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 LiteはWS2812 RGB状態LEDを内蔵した小型ESP32-S3基板です。",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3はSeeed Studio製の小型ESP32-S3基板です。",
  /* card.hw_board_other */ (name) => `選択中の基板：${name}。`,
  /* card.hw_active_low */ "アクティブLOW",
  /* card.hw_active_high */ "アクティブHIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `GPIO${pin}の${kind}${active ? `、${active}` : ""}。`,
  /* card.hw_led_disabled */ "未設定。",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}、${active}。`,
  /* card.hw_btn_disabled */ "未設定。",
  /* card.hw_env_detail */ (sda, scl) => `SDA＝GPIO${sda}、SCL＝GPIO${scl}。`,
  /* card.hw_env_disabled */ "未設定。",
  /* card.firmware */ "バージョン",
  /* card.channel */ "更新チャンネル",
  /* card.firmware_help */ "ESP32で現在動作中のバージョン。値をタップすると、選択チャンネルの署名済みファームウェアを確認します。",
  /* card.channel_help */ "リリースは手動公開の安定版、開発版は最新のファームウェア関連マージを追跡します。変更すると直ちにその配信を確認します。",
  /* chan.release */ "リリース",
  /* chan.dev */ "開発版",
  /* chan.saved */ (c) => `更新チャンネル：${c}`,
  /* card.proto_title */ "プロトコル",
  /* card.fw_title */ "ファームウェア",
  /* settings.diagnostics */ "設備診断",
  /* card.language */ "言語",
  /* card.language_help */ "ブラウザーはブラウザーの優先言語を使います。言語を選ぶと機器全体の表示言語として保存します。",
  /* card.diagnostics */ "設備診断",
  /* card.diagnostics_help */ "24時間設備点検、暖房曲線診断、室温・天気予報・循環ポンプ電力などの追加ソースを有効にします。",
  /* diagnostics.off */ "OFF",
  /* diagnostics.on */ "ON",
  /* diagnostics.saved_on */ "設備診断を有効化しました · 収集開始",
  /* diagnostics.saved_off */ "設備診断を無効化しました · 収集停止",
  /* probe.toggle */ "プロトコル診断",
  /* probe.intro */ "任意の変換評価を伴うX10Aレジスターページ直接要求。",
  /* probe.request */ "要求",
  /* probe.register */ "レジスター",
  /* probe.manual */ "手動入力",
  /* probe.page */ "レジスターページ",
  /* probe.offset */ "ペイロードオフセット",
  /* probe.size */ "フィールド幅",
  /* probe.byte */ "バイト",
  /* probe.bytes */ "バイト",
  /* probe.converter */ "変換器",
  /* probe.page_help */ "16進または10進 · 0～255",
  /* probe.offset_help */ "ペイロード位置 · 0～31",
  /* probe.size_help */ "デコードするバイト数",
  /* probe.converter_auto */ "自動",
  /* probe.converter_auto_help */ (size) => `実装済みの全変換器を${size}バイトで試します。`,
  /* probe.conv_raw_byte */ "生バイト · 0～255",
  /* probe.conv_unsigned_byte */ "符号なし生バイト",
  /* probe.conv_tenth_byte */ "生バイト × 0.1",
  /* probe.conv_unsigned_half_byte */ "符号なしバイト × 0.5",
  /* probe.conv_signed_raw_le */ "符号付き整数 · リトルエンディアン",
  /* probe.conv_signed_raw_be */ "符号付き整数 · ビッグエンディアン",
  /* probe.conv_signed_256_le */ "符号付き ÷ 256 · リトルエンディアン",
  /* probe.conv_signed_256_be */ "符号付き ÷ 256 · ビッグエンディアン",
  /* probe.conv_signed_tenth_le */ "符号付き × 0.1 · リトルエンディアン",
  /* probe.conv_signed_tenth_be */ "符号付き × 0.1 · ビッグエンディアン",
  /* probe.conv_signed_tenth_nodata_le */ "符号付き × 0.1 · リトルエンディアン · 0x8000＝データなし",
  /* probe.conv_signed_tenth_nodata_be */ "符号付き × 0.1 · ビッグエンディアン · 0x8000＝データなし",
  /* probe.conv_signed_128_le */ "符号付き ÷ 256 × 2 · リトルエンディアン",
  /* probe.conv_signed_128_be */ "符号付き ÷ 256 × 2 · ビッグエンディアン",
  /* probe.conv_signed_half_be */ "符号付き × 0.5 · ビッグエンディアン",
  /* probe.conv_signed_hundredth_be */ "符号付き × 0.01 · ビッグエンディアン",
  /* probe.conv_unsigned_raw_le */ "符号なし整数 · リトルエンディアン",
  /* probe.conv_unsigned_raw_be */ "符号なし整数 · ビッグエンディアン",
  /* probe.conv_unsigned_half_be */ "符号なし × 0.5 · ビッグエンディアン",
  /* probe.conv_saturation */ "圧力 → 飽和温度",
  /* probe.conv_raw_fan */ "生バイト／ファン段",
  /* probe.conv_capacity */ "室内機容量コード",
  /* probe.conv_eeprom_digit */ "生EEPROM桁",
  /* probe.conv_eeprom_pair */ "生EEPROM 2桁",
  /* probe.conv_bits_high */ "ビット4～6 · 3ビットカウンター",
  /* probe.conv_bits_low */ "ビット0～2 · 3ビットカウンター",
  /* probe.conv_operation_mode */ "運転モード",
  /* probe.conv_error_class */ "異常区分",
  /* probe.conv_error_code */ "Daikin故障コード",
  /* probe.conv_indoor_mode */ "室内モード · 上位ニブル",
  /* probe.conv_hybrid_mode */ "ハイブリッドモード",
  /* probe.conv_bit */ (bit) => `ビット${bit} · 0または1`,
  /* probe.conv_unknown */ "不明な変換器",
  /* probe.send */ "レジスター読取",
  /* probe.querying */ "照会中…",
  /* probe.action_note */ "ポーリング周期ごとに1要求。OTA中は実行できません。",
  /* probe.catalog_loading */ "有効プロファイルを読込中…",
  /* probe.catalog_empty */ "レジスター定義がありません。",
  /* probe.catalog_error */ "プロファイルのレジスターを読み込めません。",
  /* probe.catalog_profile */ (profile) => `プロファイル：${profile}`,
  /* probe.catalog_fallback */ (definition, profile) => `main/def：${definition} · プロファイル：${profile}`,
  /* probe.response */ "応答",
  /* probe.frame */ "フレーム",
  /* probe.payload */ "ペイロード",
  /* probe.slice */ "選択バイト",
  /* probe.interpretation */ "解釈",
  /* probe.response_for */ (reg) => `レジスター${reg}の応答`,
  /* probe.payload_marked */ "ペイロード · 選択バイトを表示",
  /* probe.slice_note */ (offset, size, slice) => `オフセット${offset} · ${size}バイト · 0x${String(slice).replace(/\s+/g, "")}`,
  /* probe.full_frame */ "完全フレーム",
  /* probe.decode_value */ "変換結果",
  /* probe.no_decodes */ "変換結果なし。",
  /* probe.refused */ "値を拒否",
  /* probe.unimplemented */ "未実装",
  /* probe.aliases */ "別名",
  /* probe.invalid */ "レジスターページ、オフセット、幅、変換器を確認してください。",
  /* probe.failed */ "照会失敗。",
  /* probe.status_ok */ "有効な応答",
  /* probe.status_busy */ "使用中",
  /* probe.status_no_link */ "X10A接続なし",
  /* probe.status_timeout */ "時間切れ",
  /* probe.status_no_reply */ "応答なし",
  /* probe.status_rejected */ "拒否",
  /* probe.status_bad_crc */ "チェックサム不正",
  /* probe.status_unexpected_reply */ "想定外の応答",
  /* probe.status_invalid_length */ "長さ不正",
  /* probe.status_short_reply */ "応答不完全",
  /* probe.status_out_of_bounds */ "ペイロード範囲外",
  /* probe.status_error */ "エラー",
  /* probe.transport_ok */ "フレームは完全で有効です。",
  /* probe.transport_busy */ "別のレジスター要求を実行中です。",
  /* probe.transport_no_link */ "X10A接続を利用できません。",
  /* probe.transport_timeout */ "ポーリング処理が時間内に要求を実行しませんでした。",
  /* probe.transport_no_reply */ "応答バイトを受信しませんでした。",
  /* probe.transport_rejected */ "機器がこのレジスターページを拒否しました。",
  /* probe.transport_bad_crc */ "応答を受信しましたがチェックサムが不正です。",
  /* probe.transport_unexpected_reply */ "応答は別のレジスターページのものです。",
  /* probe.transport_invalid_length */ "応答フレーム長が無効です。",
  /* probe.transport_short_reply */ "応答の一部だけを受信しました。",
  /* probe.transport_out_of_bounds */ "要求バイトがペイロード範囲外です。",
  /* probe.transport_error */ "要求に失敗しました。",
  /* lang.auto */ "ブラウザー",
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
  /* lang.saved */ "言語を保存しました",
  /* hist.cop_none */ "電力入力がCTクランプ由来の場合、COP曲線は表示しません。配線で対象負荷が決まり、蓄熱した熱量はBUH前まででBSHが直接加えた熱を含まないため、収支境界が一致するとは限りません。",
]);

DESCRIPTION_I18N.ja = descriptionValues([
  ["DHWタンク／蓄熱槽の目標温度。高温設定ほど消費電力が増え、電気ヒーターを使う場合があります。"], // 0
  ["DHWタンクの第2温度センサー値。上下2センサー構成では下側などを示します。"], // 1
  ["タンクセンサーR5Tの温度。加熱中に上がらない場合は他のセンサーと熱源も確認します。"], // 2
  ["強力DHWは直ちにタンクを目標まで加熱します。多用すると消費電力が増え、暖房停止が長引く場合があります。"], // 3
  ["X10Aの予熱状態。HomeHubの除菌運転フラグではなく、除菌中の証拠にもなりません。"], // 4
  ["HomeHub入力33の除菌運転状態。Modbus全体読取りの間だけの短いONは記録されない場合があります。"], // 5
  ["室外制御側のサーモ状態。室内側の同名要求とは別で、圧縮機運転を証明しません。"], // 6
  ["室外低騒音ビット。静音レベルと作動要因は未確認です。"], // 7
  ["水回路のソーラー入力ビット。機能と極性は未確認です。"], // 8
  ["再起動待機／起動制御の内部シーケンス。熱供給を示す値ではありません。"], // 9
  ["冷媒油を圧縮機へ戻す内部の油戻し運転。一時的なONは正常な場合があります。"], // 10
  ["冷媒回路の圧力均等化段階。圧力測定や弁位置の確認値ではありません。"], // 11
  ["室外制御の独自要求ビット。どの要求層が設定するか公開資料では不明です。"], // 12
  ["冷媒回路を反転する4方弁の指令／状態ビット。機械的位置の確認ではありません。"], // 13
  ["クランクケースヒーターの指令／状態。電流や圧縮機温度の測定ではありません。"], // 14
  ["室外アクチュエータ用の独自出力ビット。弁の実動作や有効極性は確認できません。"], // 15
  ["室内制御の詳細エラー副コード。機種別の公開済み対応表はなく、0でも主故障なしとは限りません。"], // 16
  ["任意の床暖房ループ遮断弁の論理指令／状態。位置や流量の確認ではありません。"], // 17
  ["システム停止ビットはONで停止。ただし凍結防止など全ポンプ／ヒーター停止の証拠ではありません。"], // 18
  ["追加ゾーンの外部室温サーモ入力。電気的要求であり、室温や圧縮機状態ではありません。"], // 19
  ["主ゾーンの暖房／冷房サーモ要求。要求モードが実際に供給された証拠ではありません。"], // 20
  ["4個の生電力制限ビット。符号化が実測で確定するまでは単一段へ変換しません。"], // 21
  ["PHEヒーターの指令／状態ビット。指令か帰還か未確認で、通電を証明しません。"], // 22
  ["再加熱はタンク温度が開始しきい値を下回ると再加熱目標まで上げます。"], // 23
  ["現在のタンク予約設定。快適蓄熱は高め、省エネ蓄熱は低めの目標です。"], // 24
  ["ハイブリッド設備で制御器がボイラーへDHW運転を要求している状態。要求は燃焼の証拠ではありません。"], // 25
  ["切替弁は水をDHWタンクまたは室内回路へ送ります。位置だけでは回路運転を証明しません。"], // 26
  ["任意2WVのX10A出力ON/OFF。OFFだけで冷房や機械的位置、端子電圧は証明できません。"], // 27
  ["第2ゾーン混合弁の開度。高温往水と低温戻り水を混ぜて目標を保ちます。"], // 28
  ["選択中の暖房／冷房モードの往水目標。固定または外気補償で決まります。"], // 29
  ["混合弁後の第2ゾーン混合往水温度。低温床暖房回路などに使われます。"], // 30
  ["BUH後の水温（通常R2T）。BUHの加熱を含みますが、放熱器位置の温度ではありません。"], // 31
  ["PHE後・BUH前のR1T。R4Tと流量、運転モードを合わせて熱出力を推定します。残熱にも注意します。"], // 32
  ["PHE共通戻りのR4T。R1T−R4TはPHEのΔTで、放熱器のΔTではなく一律5 K基準も使えません。"], // 33
  ["共通水回路の流量。必要最小値は機種とモードで異なり、低流量は7Hの原因になり得ます。"], // 34
  ["閉水回路の圧力。許容範囲は機種依存で、≤1.0 barなら該当機種の説明書を確認します。"], // 35
  ["循環ポンプ速度指令は逆目盛です。0＝全速、100＝停止。"], // 36
  ["水循環ポンプの状態。運転だけでは有効な熱移動を証明せず、実流量と照合します。"], // 37
  ["設定済み太陽熱回路のポンプ状態。ヒートポンプ側の水循環ポンプとは別です。"], // 38
  ["このプロファイルのポンプ速度。目盛と対象回路は機種依存で、実流量は別値です。"], // 39
  ["X10Aフロースイッチ。ONは水移動の検出で、l/min測定や機種別最小流量の達成確認ではありません。"], // 40
  ["水側の現在モード：停止、暖房、冷房、DHWまたは複合。圧縮機運転は証明しません。"], // 41
  ["Smart Gridの4状態エネルギー指令。HomeHubまたはX10A接点から得られ、暖房／冷房モードではありません。"], // 42
  ["現在の室内モードは暖房または冷房（自動なし）。圧縮機運転は証明しません。"], // 43
  ["HomeHubに設定された自動／暖房／冷房の選択。現在の室外運転状態ではありません。"], // 44
  ["室外機が報告する停止／暖房／冷房状態。選択中でも圧縮機停止や熱移動なしの場合があります。"], // 45
  ["室外熱交換器の除霜。低温多湿時は正常ですが、湿度なしでは1ビットだけで頻度を評価できません。"], // 46
  ["現在の異常区分：正常、エラー、警告、注意。正常以外なら故障コードを確認します。"], // 47
  ["現在報告中の故障コードの意味。"], // 48
  ["ヒートポンプ故障後の非常運転。設定によりBUHまたはボイラーが暖房／DHWを補います。"], // 49
  ["外部警報／監視へ故障を伝える本体の警報リレー。"], // 50
  ["主ゾーンの暖房／冷房室温目標。ON/OFFのサーモ要求ではありません。"], // 51
  ["室内機の「thermo ON」要求。負荷種別や圧縮機運転の証拠ではありません。"], // 52
  ["「Space H Operation」出力端子の状態。通常の室内運転状態ではありません。"], // 53
  ["通常の室内暖房／冷房が許可中または運転中かを示し、サーモ要求そのものではありません。"], // 54
  ["本体の室温センサーで制御するゾーンの設定室温。"], // 55
  ["内蔵または有線室温センサーの測定値。制御への使用可否は設定方式で決まります。"], // 56
  ["吐出温度保護：Drop=ON/OFF、Retry=0…7。連続した比較可能値の増加だけが作動を示し、原因や絶対値の異常は示しません。しきい値、リセット、7→0の扱いは不明です。"], // 57
  ["インバーター電流保護：Drop=ON/OFF、Retry=0…7。連続した比較可能値の増加だけが作動を示し、原因や絶対値の異常は示しません。しきい値、リセット、7→0の扱いは不明です。"], // 58
  ["高圧保護：Drop=ON/OFF、Retry=0…7。連続した比較可能値の増加だけが作動を示し、原因や絶対値の異常は示しません。しきい値、リセット、7→0の扱いは不明です。"], // 59
  ["低圧保護：Drop=ON/OFF、Retry=0…7。連続した比較可能値の増加だけが作動を示し、原因や絶対値の異常は示しません。しきい値、リセット、7→0の扱いは不明です。"], // 60
  ["インバーター放熱器温度保護：Drop=ON/OFF、Retry=0…7。連続した比較可能値の増加だけが作動を示し、原因や絶対値の異常は示しません。しきい値、リセット、7→0の扱いは不明です。"], // 61
  ["5種類以外の内部抑制ビット。ONは未特定の抑制だけを示し、原因診断ではありません。"], // 62
  ["冷媒と水の間で熱交換するPHE入口または出口の水温。"], // 63
  ["室外熱交換器の温度。暖房時に0 °C未満でも、湿度なしでは着霜を証明しません。"], // 64
  ["本体付近の外気温。日射、設置位置、風で近隣気象値と異なる場合があります。"], // 65
  ["圧縮機出口の高温ガス。圧力、回転数、モード、負荷で変化します。単一値や別製品群の範囲だけで異常や冷媒不足は証明できません。"], // 66
  ["圧縮機へ戻る低温・低圧冷媒ガスの温度。"], // 67
  ["熱交換器間の液管冷媒温度。"], // 68
  ["熱を吸収する蒸発器の入口／出口冷媒温度。"], // 69
  ["圧縮機噴射制御と冷媒回路保護に使うインジェクション管温度。"], // 70
  ["液と蒸気が共存する二相冷媒の温度。内部制御値で、利用者の設定値ではありません。"], // 71
  ["室外除霜センサー。位置と制御は機種固有です。1点の値ではコイル全体の着氷や除霜終了を証明できません。"], // 72
  ["冷媒圧力から計算した飽和温度。別の温度センサーでもbar単位の圧力でもありません。"], // 73
  ["高圧／低圧は同一機種・モードの安定傾向で判断します。起動、油戻し、除霜で変わり、共通の正常範囲はありません。"], // 74
  ["インバーター圧縮機速度（rps）。主な出力制御値ですが、熱出力の直接測定ではありません。"], // 75
  ["EEVステップは指令で機械的フィードバックではなく、開度%や流量でもありません。単独では動作、固着、冷媒不足を証明しません。"], // 76
  ["室外ファンモーター駆動電子回路の温度。"], // 77
  ["室外ファン速度（段階またはrpm）。停止／除霜の一部では0になります。"], // 78
  ["機種・モード固有の内部目標。対応する圧力換算飽和温度と比較します。差だけで原因や冷媒量は診断できません。"], // 79
  ["圧縮機吐出／ポート温度の内部目標。保護制御に使われます。"], // 80
  ["往水と戻り水の目標ΔT。機種とモードにより8/10 K等もあり、一律5 Kではありません。"], // 81
  ["充填冷媒（R32、R410A等）。飽和圧力―温度曲線を決めます。"], // 82
  ["圧縮機ポートで測る温度。内部保護監視に使われます。"], // 83
  ["室外機が報告する冷媒回路圧力。"], // 84
  ["完全なCT組だけを230 V仮定で合算する概算。配線範囲、実電圧、力率を反映しない非校正値です。"], // 85
  ["圧縮機インバーター電流。圧縮機負荷の目安で、熱出力の測定ではありません。"], // 86
  ["室外インバーター／電力電子部の放熱器温度。過高温では保護抑制します。"], // 87
  ["有効なBUH段数。0は停止で、低外気、除霜、DHW、非常時等に高段を使う場合があります。"], // 88
  ["水へ直接加熱するBUH抵抗ヒーター段。許可条件とバランス温度は施工設定です。"], // 89
  ["HomeHub 32はBSHのON/OFFで電力ではありません。51は別のヒートポンプ消費電力値で、BSH電力にはできません。"], // 90
  ["DHWタンクの浸漬ヒーターBSH。圧縮機や循環ポンプなしでも動き、X10Aは電力を示しません。"], // 91
  ["電気ヒーターの温度保護回路。開放は過熱、配線断、未接続ヒーター等を区別して確認します。"], // 92
  ["水配管凍結防止。機種と電源に依存し、停電中の保護は保証できません。"], // 93
  ["X10A凍結防止状態。正確な機種設定なしでは対象ポンプ、ヒーター、保護範囲を特定できません。"], // 94
  ["地中熱機のブライン回路／ポンプ値。液種、濃度、圧力、温度範囲は設備設計に依存します。"], // 95
  ["ハイブリッドの熱源選択（ヒートポンプ、併用、ボイラー）。実測熱出力ではありません。"], // 96
  ["ハイブリッド暖房時の往水目標。実測水温ではありません。"], // 97
  ["第2熱源との二価運転が有効／許可かを示します。ONでもボイラー燃焼を証明しません。"], // 98
  ["二価／ハイブリッド設備のボイラー運転要求。燃焼や供給熱の証拠ではありません。"], // 99
  ["ボイラー暖房へ要求する水温目標。ボイラー／回路の実測温度ではありません。"], // 100
  ["内部二価比較値BE_COP。現在の実測COPではなく、意味とX10A尺度は公開されていません。"], // 101
  ["電力会社、Smart Gridまたはソーラーの外部入力。動作内容は接点設定に依存します。"], // 102
  ["室内機／室外機の定格容量クラス。機種の固定情報で、現在出力ではありません。"], // 103
  ["静音モードは室外騒音を下げますが、利用可能な暖房／冷房能力も下がる場合があります。"], // 104
  ["HomeHubの診断状態：異常なし、故障、警告。原因は隣接コード／副コードで確認します。"], // 105
  ["現在報告中の故障コードの意味。"], // 106
  ["隣接するDaikin故障コードを絞る数値副コード。状態と主コードを併せて読みます。"], // 107
  ["HomeHubが報告する圧縮機運転。速度や容量は示さず、流量や回路状態と併読します。"], // 108
  ["通常DHW運転：運転中＝ON、待機／蓄熱＝OFF。開始理由までは示しません。"], // 109
  ["通常室内運転：運転中＝ON、待機／蓄熱＝OFF。モードと3WVで暖房／冷房と流路を確認します。"], // 110
  ["BUH前のPHE出口水温。水循環中だけ戻り温度と比較し、その差が水側ΔTです。"], // 111
  ["BUH後の往水温度。PHEとの差だけでなくBUH状態でもヒーター寄与を確認します。"], // 112
  ["DHWタンク水温。DHW運転中に上がらない場合は運転、流量、診断値を確認します。"], // 113
  ["室外機―室内熱交換器間の液管冷媒温度。運転状況なしの単独値では故障診断できません。"], // 114
  ["リモコンが報告する主ゾーン室温。未設定／センサーなしでは値がないのが正常です。"], // 115
  ["HomeHubのヒートポンプ消費電力。モードとヒーター状態に依存し、全量を圧縮機へ帰属できません。"], // 116
  ["HomeHubから読む主暖房ゾーン往水目標。固定／外気補償があり、ファームウェアは読取専用です。"], // 117
  ["HomeHubから読む主冷房ゾーン往水目標。冷房無効でも設定値が残る場合があり、読取専用です。"], // 118
  ["室内回路全体の許可スイッチ。現在運転中かを示す値ではありません。"], // 119
  ["静音運転は騒音を下げますが利用可能能力も下げます。手動、予定、施工制限で有効になります。"], // 120
  ["DHW再加熱のタンク目標で、開始温度ではありません。開始はヒステリシスと予定にも依存します。"], // 121
  ["暖房往水目標の読取専用補正−10…+10 K。非ゼロでも室内運転中の証拠ではありません。"], // 122
  ["Smart Grid「推奨ON」蓄熱時の電力上限。本値と一般上限の低い方が有効で、現在消費ではありません。"], // 123
  ["HomeHubの一般電力上限（自由運転時も適用）。設定上限で、実測消費電力ではありません。"], // 124
]);

MODEL_DESCRIPTION_I18N.ja = modelDescriptionValues([
  ["本体の故障／警告状態。現在エラーは警告、警告・注意または24時間内に消えた通知は注記です。装置の報告で、推測ではありません。"], // health_fault
  ["R5T成層点;K/h=最大≠Ø/日;循環≠原因;プロジェクト帯0.8–1.85.仮定:200l均一;有効窓=最大;COP;除外/欠測hは外;電力≠測定。"], // health_dhw_loss
  ["圧縮機起動と完了運転時間を集計。暖房運転が12回以上かつ平均10分未満で注記。DHW／冷房は除外しますが、分類不能が多い場合は全運転を評価します。Daikin限界値ではありません。"], // health_cycling
  ["除霜が3回以上かつ15%超で注記。Daikin限界値ではありません。R4Tは判定外のライブ情報で、1点はコイル全体を示しません。"], // health_defrost
  ["移動窓内の最低有効水圧。>1.0 barが基準、≤1.0 barで注記、60秒継続で警告。許容範囲は機種依存です。"], // health_pressure
  ["内部ポンプ連続60秒後の最低流量。部分負荷の実測値のみで、設計流量ではありません。普遍的限界はなく、単発低値だけでは異常を証明しません。"], // health_flow
  ["BUHとBSHの観測運転時間。寒冷、非常、除霜、DHW、余剰制御で正常な場合があり、共通のOK／警告限界はありません。"], // health_heater
  ["5個の保護カウンターを実験監視。連続した比較可能値の明確な増加だけが作動を示し、原因や絶対値は示しません。しきい値、リセット、7→0は不明で、増加なしでも制限なしは証明できません。"], // health_retries
  ["現在の未使用RAMと24時間傾向。回復する短い低下は正常、持続低下は未解放割当ての疑いです。通電中のウォームリセットではRAM履歴を保持し、通常再起動・更新・停電後は完了した5分区間をフラッシュから復元しますが、未完了区間は欠ける場合があります。"], // free_heap
  ["最大の連続空きRAM。TLS/OTAは大きな1ブロックを必要とします。総空きRAMが安定して本値だけ低下すれば断片化と割当て失敗の恐れがあります。"], // max_alloc
  ["室外機IDページから読んだ定格容量クラス。現在の熱出力ではありません。"], // capacity
  ["室内機の定格容量。室外機やシステム全体の容量として読めません。"], // capacity_iu
  ["残る候補は同じ容量クラスとレジスター構成で、代表候補の選択はデコード値を変えません。"], // candidates
  ["室外容量が不明なため候補クラスが異なる場合があります。室内機に最も合う候補でデコードしますが確実ではなく、銘板確認が必要です。"], // candidates_nocap
  ["室外機サービスIFの生IDバイト。公開された商品名対応表はなく、曖昧時は銘板と1文字ずつ照合します。"], // oueeprom
]);

FAULT_CODE_I18N.ja = faultCodeValues([
  "水流異常", // 7H
  "戻り水温センサー異常", // 80
  "往水温センサー異常", // 81
  "熱交換器の凍結防止が作動", // 89
  "DHW出口水温の異常上昇", // 8F
  "往水温の異常上昇", // 8H
  "ゼロクロス検出異常", // A1
  "高圧ピークカット／凍結防止異常", // A5
  "BUH過熱または未接続", // AA
  "BSH過熱", // AC
  "タンク除菌（レジオネラ対策）未完了", // AH
  "DHW加熱時間超過", // AJ
  "流量センサー異常", // C0
  "熱交換器温度センサー異常", // C4
  "熱交換器センサー異常", // C5
  "室温センサー異常", // CJ
  "室外機PCB異常", // E1
  "漏電電流検出異常", // E2
  "室外機高圧スイッチ作動", // E3
  "吸入圧力異常", // E4
  "室外インバーター圧縮機モーター過熱", // E5
  "室外圧縮機の起動失敗", // E6
  "室外ファンモーター異常", // E7
  "室外機入力過電圧", // E8
  "電子膨張弁異常", // E9
  "室外機の冷房／暖房切替異常", // EA
  "タンク温度の異常上昇", // EC
  "室外機吐出管温度異常", // F3
  "冷房中の室外機高圧異常", // F6
  "室外機高圧異常／高圧スイッチ作動", // FA
  "室外機電圧／電流センサー異常", // H0
  "外部温度センサー異常", // H1
  "室外機高圧スイッチ異常", // H3
  "圧縮機過負荷保護異常", // H5
  "室外機位置検出センサー異常", // H6
  "室外圧縮機入力（CT）系統異常", // H8
  "室外機外気温センサー異常", // H9
  "タンク温度センサー異常", // HC
  "水圧センサー異常", // HJ
  "室外機吐出管センサー異常", // J3
  "室外機熱交換器センサー異常", // J6
  "室外機高圧センサー異常", // JA
  "インバーターPCB異常", // L1
  "室外機制御箱温度上昇異常", // L3
  "室外インバーター放熱器温度上昇異常", // L4
  "室外インバーター過電流（DC）検出", // L5
  "インバーターPCB温度保護作動", // L8
  "圧縮機ロック保護", // L9
  "室外機通信系統異常", // LC
  "電源相不平衡／欠相", // P1
  "DC異常検出", // P3
  "室外機放熱器温度センサー異常", // P4
  "容量設定不一致", // PJ
  "室外機冷媒不足", // U0
  "逆相／欠相異常", // U1
  "室外機主電源電圧異常", // U2
  "床暖房スクリード乾燥運転が正常に完了していません", // U3
  "室内機／室外機間の通信異常", // U4
  "ユーザーインターフェース通信異常", // U5
  "室外機メインCPU／インバーターCPU間の通信異常", // U7
  "外部機器（LANアダプター／室温サーモ／USB）通信異常", // U8
  "室内機／室外機の組合せまたは互換性異常", // UA
  "配管逆接続または通信配線異常を検出", // UF
], "故障コードは報告されていません。", "このコードの短い説明は登録されていません。");

MB_DELTA_I18N.ja = mbDeltaValues([
  "圧縮機停止中はX10Aが直前運転時の値を保持します。独立して読むHomeHubレジスターは変化し得ますが、測定時刻はありません。", // outdoor_air
  "2つの値は異なる室温制御器から取得されます。", // room_temp
]);

INSPECT_I18N.ja = inspectValues(
  ["現在値なし:", "圧縮機停止中は室外機センサーが更新されません。前回運転値を現在の測定値と誤認しないよう非表示にします。"],
  [
    ["運転モード", "運転モード", "室内機のモードです。これだけでは圧縮機運転や流量を確認できません。"], // status
    ["外気環境", "ENV IIIの外気環境", "接続したENV IIIが測る温度、湿度、気圧です。設置場所によって室内値か屋外値かが決まります。"], // env3
    [(d) => sgInspectIsX10a(d) ? "Smart Grid要求 · X10A" : "Smart Grid要求 · Modbus", "Smart Grid要求", (d) => sgInspectIsX10a(d)
      ? "SG-Ready物理接点の外部要求（通常運転、強制停止、運転推奨、強制運転）です。暖冷房モードでもタンク加熱開始の証明でもなく、ネットワーク経由の要求は接点に現れない場合があります。"
      : "HomeHubから読み戻した外部要求（通常運転、強制停止、運転推奨、強制運転）です。暖冷房モードでもタンク加熱開始の証明でもありません。", (d) => !d || d.sgMode == null ? "現在のSmart Grid値はありません。"
      : d.sgMode === 2 && d.sgSrc === "X10A" ? "SG-Ready接点は運転推奨です。エネルギー管理がブーストに使う状態で、実際のタンク加熱は給湯モード、3WV、流量で別に確認します。"
      : d.sgMode === 2 ? "HomeHubは運転推奨です。エネルギー管理がブーストに使う状態で、実際のタンク加熱は給湯モード、3WV、流量で別に確認します。"
      : d.sgMode === 1 ? "外部エネルギー管理は強制停止を要求しています。"
      : d.sgMode === 3 ? "外部エネルギー管理は強制運転を要求しています。"
      : "外部Smart Grid要求なし。機器は自律運転中です。"], // sgrequest
    ["室外機", "室外機", "ファンが熱交換器へ空気を送り、圧縮機が冷媒の圧力と温度を上げます。簡略図であり、モノブロック、地中熱、ハイブリッドは構成が異なります。", (d) => d.defrost ? "霜取り中 — 逆サイクルで氷を溶かし、短時間だけ水側から熱を取ります。"
      : compressorRunning(d) ? d.rps != null ? `運転中 — 圧縮機 ${fmt0(d.rps)} rps${d.quiet ? "、静音モードで制限" : ""}。` : "運転中 — HomeHubが圧縮機を確認。速度と詳細値にはX10Aが必要です。"
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out") ? "待機中 — 熱移動なし。X10Aセンサーは更新停止、外気温は時刻情報のないModbus値、吐出温度は「—」です。"
      : "待機中 — 圧縮機停止、暖冷房の熱移動なし。更新されない値は前回値でなく「—」表示です。"], // ou
    ["圧縮機", "圧縮機", "冷媒を圧縮します。rpsは運転を示しますが、それだけで熱出力を示しません。"], // comp
    ["外気温", "外気温", "室外機センサー付近の温度で、日射や設置条件の影響を受けます。"], // out
    ["室外熱交温度 · R4T", "室外熱交換器温度 R4T", "暖房時は0 °C未満になり得ます。温度と霜取り状態を合わせて着霜と除去を見ます。"], // ouhx
    ["高圧", "高圧", "冷媒回路の高圧側です。モードと吐出温度も合わせて見てください。水圧ではありません。"], // hp
    ["吐出温度", "吐出温度", "圧縮機後の高温冷媒温度です。負荷とモードで変わり、停止中は古い値を隠します。"], // disch
    ["低圧", "低圧", "圧縮機の冷媒低圧側です。対応センサーがないプロファイルもあります。"], // lp
    ["膨張弁", "膨張弁", "電子膨張弁の指令位置（パルス）です。開度率ではありません。"], // eev
    ["液側冷媒温度 · R3T", "液側冷媒温度 R3T", "室内熱交換器の液側冷媒温度です。戻り水温ではありません。"], // r3t
    ["プレート熱交換器", "プレート熱交換器", "PHEは混合せず冷媒と水の間で熱を移します。出力は流量とR1T/R4Tから推定し、センサー位置は機種で異なります。", (d) => !compressorRunning(d, 5) ? "冷媒側の熱移動なし — 圧縮機停止。ポンプが残熱を運んでも暖冷房出力ではありません。"
      : d.dtStale ? "水側熱移動を計算できません — ポンプと流量がPHE通水を確認していません。"
      : d.pth == null ? "方向別推定なし — 選択モードで有効な熱移動を測定値が確認していません。"
      : d.pthKind === "cooling" ? `水から約 ${fmt1(d.pth)} kW除去（${fmt1(d.flow)} l/min、ΔT ${fmt1(d.dt)} K）。`
      : `水へ約 ${fmt1(d.pth)} kW移動（${fmt1(d.flow)} l/min、ΔT ${fmt1(d.dt)} K）。`], // phe
    ["PHE出口・BUH前 · R1T", "PHE出口・BUH前の水温 R1T", "PHE出口、BUH前の水温です。通常、暖房・給湯ではR4Tより高く、冷房では低くなります。"], // lwt
    ["BUH後水温 · R2T", "BUH後水温 R2T", "BUH後の水温です。R1Tと違い、追加された電気熱を含む場合があります。"], // r2t
    ["PHE入口 · R4T", "PHE入口水温 R4T", "PHEへ戻る水温です。R1T、流量、圧縮機、モードと合わせて見ます。"], // rwt
    ["PHE水側ΔT", "PHE水側温度差", "出口R1T−入口R4T。2センサーから算出し、流量と合わせて熱移動を示しますが、室内端末の送戻水温を直接測りません。", (d) => d.dtStale ? "運転中のΔTなし — ポンプと流量が通水を確認していません。停止中センサー差は運転点ではありません。"
      : d.dt == null ? null : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K、ポンプのみ — 残熱の均一化であり出力ではありません。`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K。冷房時はR1TがR4Tより低いため負値になります。`
      : `${fmt1(d.dt)} K${d.dtSet != null ? `、目標 ${fmt1(d.dtSet)} K` : ""}。正値は水への熱移動を示します。`], // dt
    [(d) => d && d.pthKind === "cooling" ? "冷却出力（推定）" : "熱出力（推定）", "PHE熱出力推定", (d) => d && d.pthKind === "cooling" ? "水から除いた熱の推定: 流量 × (R4T−R1T) × 4.186（水を仮定）。センサーとグリコールが精度を制限し、確認済み冷房時だけ表示します。" : "水へ渡した熱の推定: 流量 × (R1T−R4T) × 4.186（水を仮定）。センサーとグリコールが精度を制限し、R1T後のBUHは含みません。", (d) => d.dtStale ? d.bsh === true ? "通水未確認のためPHE熱移動を計算できません。BSHはタンクを加熱できても、その熱はPHEセンサーを通らず、バスは出力を報告しません。" : "PHE通水未確認のため出力を計算できません。運転点がないのであり、0 kWではありません。"
      : d.pth == null ? null : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW冷却${d.cop != null ? `、EER ${fmt1(d.cop)}` : ""}。` : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `、COP ${fmt1(d.cop)}` : ""}。`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "ヒートポンプEER（推定）" : d && d.copScope === "plant" ? "BUH後COP（推定）" : "ヒートポンプCOP（推定）", "効率推定", (d) => d && d.efficiencyKind === "eer" ? "推定冷却出力÷推定電力。流体、センサー、電圧、力率の仮定を含む瞬時EERで、季節効率ではありません。" : "同じ収支境界の推定熱出力÷電力。CTではBUH後、インバータ電流ではヒートポンプのみになり得て、CT配線が含む負荷を決めます。流体、センサー、電圧、力率の仮定を含む瞬時値で季節効率ではありません。", (d) => d.copBlock === "tank_heater" ? "COPなし — タンクヒーター作動中。電力収支に含まれても、熱は水側センサーを通らず直接タンクへ入ります。"
      : d.copBlock === "buh_no_r2t" ? "COPなし — BUH作動中ですが後段センサーがなく、電気と熱の境界が一致しません。"
      : d.copBlock === "mb_scope" ? "COPなし — HomeHubはヒーター込み機器電力、熱はPHEのみです。ヒーター状態と後段センサーがなく境界を揃えられません。"
      : d.copBlock === "no_pel" ? d.pelHeld ? "COPなし — 圧縮機停止中のインバータ電流は前回運転値です。" : "COPなし — CT電流もインバータ電流もありません。"
      : d.cop == null ? null : d.efficiencyKind === "eer" ? `電力1 kW当たり冷却 ${fmt1(d.cop)} kW — 約${fmt1(d.pel)} kW入力で約${fmt1(d.copPth)} kW。`
      : d.copScope === "plant" ? `CT電力1 kW当たりBUH後熱 ${fmt1(d.cop)} kW — 約${fmt1(d.pel)} kW入力で約${fmt1(d.copPth)} kW。境界はCT配線次第です。`
      : `ヒートポンプ境界で電力1 kW当たり熱 ${fmt1(d.cop)} kW — 約${fmt1(d.pel)} kW入力で約${fmt1(d.copPth)} kW。BUHは両方に含みません。`], // cop
    ["補助ヒーター · BUH", "補助ヒーター BUH", "凍結、霜取り、非常運転用の水回路電気ヒーターです。段数は個別のkW測定ではありません。", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "段2 — 両段作動。" : d.buh1 ? "段1 — 1段作動。" : "停止 — BUH作動なし。"], // buh
    ["タンク電気ヒーター", "タンク電気ヒーター", "浸漬式BSHは圧縮機や水循環なしでもタンクを加熱します。X10Aは状態だけで出力は報告しません。", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "タンク電気ヒーター作動中。" : "停止 — BSHは作動していません。"; }], // bsh
    ["3方弁", "3方弁", "タンクまたは室内への経路指令です。機械的位置や流量の確認信号ではありません。", (d) => d.valveDhw == null ? null : d.valveDhw ? "タンク経路を指令。これだけで流量や加熱を確認できません。" : "室内経路を指令。これだけで循環を確認できません。"], // valve
    ["2方弁出力", "2方弁出力", "X10Aの2値出力です。機械的位置や暖冷房の証明ではありません。", (d) => d.valve2On == null ? null : d.valve2On ? "X10Aは2WV出力 入。モードと室内回路運転は別に確認してください。" : "X10Aは2WV出力 切。これだけで冷房を意味せず、待機中の暖房設定とも矛盾しません。"], // valve2
    ["給湯・蓄熱タンク", "給湯または蓄熱タンク", "R5T、設定温度、3WV経路で示します。温度だけでは加熱中と確認できません。"], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "冷房回路" : activeSpaceKind(d) === "heat" ? "暖房回路" : "室内回路", "室内回路", "ラジエーター、床暖房、ファンコイル等です。R1T/R4Tはヒートポンプ内部で測り、現地配管後の温度を確認しません。", (d) => d.valveDhw === true ? "室内経路は未選択。実際のタンク流量はポンプと流量で別に確認します。"
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `残熱水が室内へ循環。R1T ${degC(d.lwt)}、端末後センサーなし。能動冷房ではありません。` : `水は${activeSpaceKind(d) === "cool" ? "冷房" : activeSpaceKind(d) === "heat" ? "暖房" : "室内"}回路へ。R1T ${degC(d.lwt)}、端末後センサーなし。` : "ポンプと流量が室内回路の循環を確認していません。"], // heat
    ["室内空調運転", "室内暖房または冷房運転", "室内回路の通常運転状態です。サーモスタット要求ではなく、単独で圧縮機運転を確認しません。"], // spaceh
    ["室温", "室温", "基準ゾーンの温度です。設定温度とモードと合わせて見ます。"], // room
    ["循環ポンプ", "循環ポンプ速度", "共通水回路と3WVで選んだ経路を循環させます。圧縮機停止中も余熱や保護で動き、速度だけでは流量を確認しません。", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `ポンプは停止報告ですが流量 ${fmt1(d.flow)} l/min。外部循環、余運転、矛盾または古い信号があり得るため両方を確認してください。`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `速度 ${fmt0(d.pump)} %、流量 ${fmt1(d.flow)} l/min。` : `速度 ${fmt0(d.pump)} %、流量測定なし。循環未確認です。`
      : waterMoving(d) ? `有効なポンプ速度なし、流量 ${fmt1(d.flow)} l/min。`
      : d.pumpOn === true ? d.flow != null ? `ポンプ 入、流量は ${fmt1(d.flow)} l/minのみ。循環未確認です。` : "ポンプ 入、流量測定なし。循環未確認です。"
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `ポンプ停止、センサー ${fmt1(d.flow)} l/min。循環を確認できません。` : "ポンプ停止、流量測定なし。"
      : `信頼できるポンプ状態なし。${fmt1(d.flow)} l/minだけでは循環を確認できません。`], // pump
    [(d) => pelMeasured(d) ? "電力 · HomeHub" : "電力（推定）", "電力", (d) => pelMeasured(d) ? "HomeHubレジスタ51の電力です。資料では校正、測定点、全ヒーターを含むか確認できず、認証済み設備メーターではありません。" : "COP/EER用推定: CT各相の合計 × 仮定230 V。実電圧と力率は不明で、インバータ電流は圧縮機のみ、CT境界は配線次第です。", (d) => d.pelHeld ? "圧縮機停止中のインバータ電流は前回値です。電力と効率を示せません。"
      : d.pel == null ? "現在の電流測定がなく、COP/EERを算出できません。"
      : d.pelSrc === "MB" ? "HomeHubレジスタ51の値。正確な測定境界は未記載です。"
      : d.pelSrc === "CT" ? "CT推定。含む負荷は配線次第です。" : "インバータ電流から算出 — 圧縮機のみ。"], // pel
    ["霜取り", "霜取り", "逆サイクルで室外熱交換器の氷を溶かし、暖房を短時間中断します。", (d) => d.defrost == null ? null : d.defrost ? "霜取り作動中。" : "停止 — 霜取りなし。"], // defrost
    ["静音モード", "静音モード", "通常はファンや圧縮機を制限して騒音を下げ、利用可能な出力も下がる場合があります。", (d) => d.quiet == null ? null : d.quiet ? "静音モード作動中。" : "停止 — 静音モードなし。"], // quiet
    ["ガス配管", "ガス側冷媒配管", "分離型の機器間冷媒配管です。暖房では高温高圧ガスがPHEへ流れ、冷房では逆向きです。モノブロックにはありません。", (d) => compressorRunning(d) ? d.rps != null ? `循環中 — ${fmt1(d.circP)} bar、${fmt0(d.disch)} °C。` : "循環中 — HomeHubが圧縮機を確認。圧力と温度にはX10Aが必要です。" : "冷媒循環なし — 圧縮機停止。圧力均一化は回路と停止時間次第です。"], // rhot
    ["液配管", "液側冷媒配管", "分離型の機器間液冷媒配管です。暖房では室外膨張弁へ戻り、冷房では逆向きです。モノブロックにはありません。", (d) => compressorRunning(d) ? d.rps != null ? `循環中 — 膨張弁 ${fmt0(d.eev)}パルス。` : "循環中 — HomeHubが圧縮機を確認。弁位置にはX10Aが必要です。" : "停止 — 圧縮機停止。"], // rcold
    ["PHE出口配管", "PHE出口配管", "R1Tからの水はBUHとポンプを通り、3WVが室内またはタンクへ送ります。冷房では低温側で、BUH後センサーは電気熱を含み得ます。", (d) => waterMoving(d) ? `BUH前R1T ${degC(d.lwt)}、${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "、後段BUH作動" : ""}。` : "ポンプと流量がこの配管の循環を確認していません。"], // wsup
    ["タンク回路", "タンク回路", "給湯・蓄熱タンクを加熱する水回路です。熱交換器構造は機種次第で、図は機能を示し実構造ではありません。", (d) => d.valveDhw === true ? waterMoving(d) ? `タンク選択、${fmt1(d.flow)} l/min。PHE ${degC(d.lwt)}、タンク ${degC(d.tank)}。` : "タンク選択中ですが、循環だけでは加熱中と確認できません。" : "タンク経路未選択。制御は室内回路を報告しています。"], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "冷房分岐" : activeSpaceKind(d) === "heat" ? "暖房分岐" : "室内分岐", "室内分岐", "ラジエーター、床暖房、ファンコイルへの分岐です。R1T/R4Tはヒートポンプ内部で測り、この分岐ではなく、ΔTには配管影響も含みます。", (d) => d.valveDhw === true ? "室内分岐は未選択。制御はタンクを報告しています。" : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `残熱循環 ${fmt1(d.flow)} l/min、能動冷房なし。R1T ${degC(d.lwt)}、R4T ${degC(d.ret)}。` : `室内へ循環 ${fmt1(d.flow)} l/min。R1T ${degC(d.lwt)}、R4T ${degC(d.ret)}。` : "室内分岐の循環は未確認です。"], // wheat
    ["PHE戻り配管", "PHE戻り配管", "タンクと室内分岐の合流後、R4Tへ戻る共通配管です。通常、暖房ではR1Tより低く、冷房では高く、R4Tは端末付近ではありません。", (d) => waterMoving(d) ? `戻り ${degC(d.ret)}、${fmt1(d.flow)} l/min、${fmt1(d.wp)} bar。` : "戻り配管の循環は未確認です。"], // wret
    ["水流量", "水流量", "共通水回路の流量です。必要最小値は機種とモードで異なります。"], // flow
    ["流量スイッチ", "流量スイッチ状態", "X10Aの2値状態です。l/minを測らず、機種の最小流量も確認しません。", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A 入。ポンプと ${fmt1(d.flow)} l/minを比較してください。` : `X10A 切。ポンプ運転中は ${fmt1(d.flow)} l/minと7H/C0異常を確認してください。`], // flow_switch
    ["水圧", "水圧", "閉じた水回路の圧力です。許容範囲は機種、高低差、膨張タンクで異なるため取扱説明書を参照してください。"], // wp
  ],
);

HOMEHUB_LABEL_I18N.ja = homeHubValues([
  "主ゾーン暖房送水目標", // 1
  "主ゾーン冷房送水目標", // 2
  "暖房・冷房モード", // 3
  "室内空調有効", // 4
  "主ゾーン暖房目標", // 6
  "主ゾーン冷房目標", // 7
  "静音モード", // 9
  "給湯再加熱目標", // 10
  "機器診断状態", // 21
  "機器異常コード", // 22
  "機器異常サブコード", // 23
  "循環ポンプ作動", // 30
  "圧縮機作動", // 31
  "タンクヒーター作動", // 32
  "タンク除菌作動", // 33
  "3方弁位置", // 37
  "現在の暖房・冷房モード", // 38
  "PHE出口温度", // 40
  "BUH後送水温度", // 41
  "戻り水温", // 42
  "給湯タンク温度", // 43
  "外気温", // 44
  "液側冷媒温度", // 45
  "水流量", // 49
  "主ゾーン室温", // 50
  "電力", // 51
  "給湯運転", // 52
  "室内空調運転", // 53
  "主ゾーン暖房送水補正", // 54
  "Smart Gridモード", // 56
  "蓄熱電力上限", // 57
  "総電力上限", // 58
]);
