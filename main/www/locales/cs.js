// translation-source: 71b2f4e8fef501786c9092a73e6c069ef83ff466da6391c989487a288f412c7b
I18N.cs = localeValues([
  /* sys.nodata */ "Žádná data",
  /* sys.unreachable */ "Nedostupné",
  /* sys.x10a_down */ "X10A není v síti",
  /* sys.mb_carrying */ "Provozní režim není znám — hodnoty z Modbusu",
  /* sys.mb_only */ "X10A není v síti — hodnoty z Modbusu",
  /* sys.mb_source */ "X10A není v síti · Modbus",
  /* mode.stop */ "Zastaveno",
  /* mode.heat */ "Vytápění",
  /* mode.cool */ "Chlazení",
  /* mode.space */ "Vytápění/chlazení prostoru",
  /* mode.dhw */ "Teplá voda",
  /* mode.heat_dhw */ "Vytápění + teplá voda",
  /* mode.cool_dhw */ "Chlazení + teplá voda",
  /* mode.space_dhw */ "Vytápění/chlazení prostoru + teplá voda",
  /* sys.unreachable_sub */ "Zařízení není dostupné — opakuji pokus…",
  /* sys.waiting */ "Čekám na tepelné čerpadlo…",
  /* sys.operating */ "V provozu",
  /* sys.standby */ "Pohotovostní režim — neběží",
  /* sys.defrosting */ "Odmrazování",
  /* sys.circulating */ "Oběh vody — kompresor je vypnutý",
  /* sys.cool_mode */ "Režim chlazení",
  /* sys.residual_circulating */ "Oběh zbytkového tepla — bez chladicího výkonu",
  /* sys.bsh_active */ "Elektrické topné těleso zásobníku je aktivní",
  /* sys.online */ "V síti",
  /* sys.fault */ "Porucha",
  /* sys.warning */ "Varování",
  /* sys.fault_line */ (c) => "Porucha · " + c + " — zkontrolujte kód poruchy Daikin.",
  /* sys.warning_line */ (c) => "Varování · " + c + " — zkontrolujte tepelné čerpadlo.",
  /* sys.polled */ (s) => `Naposledy načteno před ${s} s`,
  /* recovery.title */ "Režim obnovení",
  /* recovery.meta_heap */ "Zařízení opakovaně vyčerpalo paměť a samo se restartovalo. Nyní běží s vypnutým připojením k tepelnému čerpadlu a MQTT, aby zůstalo dostupné webové rozhraní. Konfigurace je s největší pravděpodobností v pořádku — v Nastavení nainstalujte novější verzi firmwaru. Vypnutí a zapnutí napájení zkusí znovu spustit celý systém.",
  /* recovery.meta */ "Zařízení se opakovaně restartovalo a přešlo do režimu obnovení. Komunikace s tepelným čerpadlem a MQTT je pozastavena. Zkontrolujte konfiguraci — zejména piny RX/TX na kartě Protokol v Nastavení — a poté zařízení restartujte.",
  /* rollback.title */ "Změna WiFi selhala — obnoveno původní nastavení",
  /* rollback.meta */ (back) => `Zařízení se s novým nastavením WiFi nemohlo připojit. Obnovilo předchozí síť${back} a restartovalo se. V Nastavení → Připojení zkontrolujte název sítě a heslo a zkuste to znovu.`,
  /* crash.title_fault */ "Zařízení se restartovalo po pádu",
  /* crash.title_orphan */ "Čeká zde hlášení o pádu z dřívějšího restartu",
  /* crash.reset */ "Reset",
  /* crash.task */ "úloha",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "poškozeno",
  /* crash.download */ "Stáhnout hlášení o pádu",
  /* crash.copy */ "Kopírovat diagnostiku",
  /* crash.dismiss */ "Smazat hlášení",
  /* crash.copied */ "Diagnostika zkopírována — vložte ji do hlášení chyby",
  /* crash.copy_fail */ "Kopírování selhalo — otevřete /coredump a /diag ručně",
  /* crash.ask_dump */ "Smazat ze zařízení? Smaže se i výpis paměti — nejprve jej stáhněte pro hlášení chyby.",
  /* crash.ask */ "Smazat toto hlášení ze zařízení?",
  /* crash.ask_yes */ "Smazat",
  /* crash.ask_no */ "Ponechat",
  /* crash.deleted */ "Hlášení o pádu smazáno",
  /* crash.delete_fail */ "Zařízení je nemohlo smazat — hlášení je stále k dispozici",
  /* bug.row */ "Nahlásit chybu",
  /* bug.title */ "Nahlásit chybu",
  /* bug.intro */ "Stručně popište problém. Zařízení přidá svůj stav, naměřené hodnoty a protokol po odstranění názvů sítí, adres a názvů serverů.",
  /* bug.what */ "Co se děje",
  /* bug.what_ph */ "Teplota zásobníku se od dnešního rána v Home Assistant zobrazuje jako 12800 °C.",
  /* bug.need_text */ "Nejprve popište, co se děje — stačí jedna nebo dvě věty.",
  /* bug.continue */ "Připravit hlášení",
  /* bug.step2_title */ "Zkontrolujte hlášení",
  /* bug.step2 */ "Zkontrolujte níže uvedené hlášení. Tlačítko je zkopíruje a otevře formulář hlášení na GitHubu s již vyplněným popisem. Vložte hlášení do pole „Device report“, odpovězte na zbývající otázky a odešlete problém.",
  /* bug.collecting */ "Shromažďuji data zařízení…",
  /* bug.collect_fail */ "Zařízení se nepodařilo načíst — níže uvedené hlášení uvádí, které části chybějí.",
  /* bug.copy */ "Kopírovat a otevřít GitHub",
  /* bug.download */ "Stáhnout .md",
  /* bug.md_hint */ "Pokud kopírování selže nebo dáváte přednost souboru, stáhněte stejné hlášení ve formátu .md. Namísto vložení textu přetáhněte soubor do pole formuláře „Device report“.",
  /* bug.copied */ "Hlášení zkopírováno — vložte je do pole „Device report“",
  /* bug.copy_fail */ "Kopírování selhalo — označte níže uvedený text a zkopírujte jej ručně",
  /* bug.redacted */ "Název vaší sítě, adresy, broker a názvy serverů již byly odstraněny.",
  /* nav.settings */ "Nastavení",
  /* nav.back */ "Zpět",
  /* nav.settings_alert */ (n) => `Nastavení — ${n} ${n === 1 ? "připojení je nedostupné" : n >= 2 && n <= 4 ? "připojení jsou nedostupná" : "připojení je nedostupných"}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Oba zdroje se shodují",
  /* src.delta */ (d, u) => `Rozdíl ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Oba zdroje se v tomto stavu neshodují",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Hledám…",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Připojení",
  /* conn.offline */ "Mimo síť",
  /* conn.disabled */ "Vypnuto",
  /* conn.connecting */ "Připojuji…",
  /* conn.connected */ "Připojeno",
  /* conn.resolving */ "Překládám adresu…",
  /* conn.eth_no_cable */ "Kabel není připojen",
  /* conn.eth_no_lease */ "Kabel je připojen, ale bez adresy",
  /* conn.eth_fd */ "plný duplex",
  /* conn.enabled */ "Zapnuto",
  /* conn.enabled_noping */ "Zapnuto, hostitel neodpovídá na ping",
  /* conn.synced */ "Synchronizováno",
  /* conn.syncing */ "Synchronizuji…",
  /* conn.error */ (e) => "Chyba: " + e,
  /* conn.connected_to */ (s) => "Připojeno k " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Klepnutím upravíte.`,
  /* modbus.err.mdns_not_found */ "Přes mDNS nebyl nalezen žádný HomeHub.",
  /* modbus.err.no_address */ "Není nastavena žádná adresa HomeHubu.",
  /* modbus.err.resolve_failed */ "Adresu HomeHubu se nepodařilo přeložit.",
  /* modbus.err.connect_timeout */ "Vypršel časový limit připojení — HomeHub není dostupný.",
  /* modbus.err.connection_refused */ "HomeHub je dostupný, ale port Modbus TCP je zavřený.",
  /* modbus.err.network_unreachable */ "K HomeHubu nevede žádná síťová trasa.",
  /* modbus.err.host_unreachable */ "HomeHub není v síti dostupný.",
  /* modbus.err.connect_failed */ "Připojení k HomeHubu selhalo.",
  /* modbus.err.request_failed */ (r) => `Požadavek Modbus se nepodařilo sestavit${r ? ` pro registr ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Při odesílání požadavku Modbus vypršel časový limit${r ? ` u registru ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `Požadavek Modbus se nepodařilo odeslat${r ? ` u registru ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Při čekání na odpověď HomeHubu vypršel časový limit${r ? ` u registru ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `HomeHub ukončil připojení${r ? ` u registru ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `Odpověď HomeHubu se nepodařilo přečíst${r ? ` u registru ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Neplatná odpověď Modbus${r ? ` u registru ${r}` : ""}.`,
  /* modbus.err.internal_error */ "Cyklus dotazování Modbus selhal kvůli interní chybě.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub odmítl registr ${r || "?"} (výjimka ${n}: ${why}).`,
  /* modbus.exc.1 */ "nepovolená funkce",
  /* modbus.exc.2 */ "nepovolená datová adresa",
  /* modbus.exc.3 */ "nepovolená datová hodnota",
  /* modbus.exc.4 */ "selhání zařízení",
  /* modbus.exc.5 */ "požadavek potvrzen",
  /* modbus.exc.6 */ "zařízení je zaneprázdněné",
  /* modbus.exc.8 */ "chyba parity paměti",
  /* modbus.exc.10 */ "cesta brány není dostupná",
  /* modbus.exc.11 */ "cílové zařízení neodpovědělo",
  /* modbus.exc.unknown */ "neznámý důvod",
  /* card.model */ "Model",
  /* card.hplink */ "Spojení s tepelným čerpadlem",
  /* card.online */ "V síti",
  /* card.uptime */ "Doba běhu",
  /* card.freeheap */ "Volná paměť",
  /* card.maxalloc */ "Největší volný blok",
  /* card.offline */ "Mimo síť",
  /* card.protocol */ "Protokol",
  /* card.rxpin */ "Pin RX",
  /* card.txpin */ "Pin TX",
  /* card.capacity */ "Výkon",
  /* card.hplink_help */ "Ukazuje, zda ESP32 právě přijímá platné odpovědi z tepelného čerpadla přes X10A.",
  /* card.protocol_help */ "X10A-I a X10A-S jsou dva podporované formáty rámců servisního rozhraní. Firmware rozpozná formát z platných odpovědí.",
  /* card.rxpin_help */ "GPIO, na kterém ESP32 přijímá data X10A z tepelného čerpadla. Když je spojení mimo síť, výběr spustí nový pokus o automatickou detekci se zvolenou dvojicí.",
  /* card.txpin_help */ "GPIO, na kterém ESP32 odesílá požadavky X10A tepelnému čerpadlu. RX a TX musí být odlišné a odpovídat fyzickému zapojení.",
  /* card.capacity_iu */ "Výkon (vnitřní jednotka)",
  /* card.candidates */ "Možné modely",
  /* card.oueeprom */ "ID venkovní jednotky",
  /* card.checkup */ "Diagnostika soustavy · 24 h",
  /* check.fault */ "Porucha jednotky",
  /* check.dhw_loss */ "Tepelná ztráta zásobníku TUV",
  /* check.cycling */ "Starty kompresoru",
  /* check.defrost */ "Cykly odmrazování",
  /* check.pressure */ "Nejnižší tlak vody",
  /* check.flow */ "Nejnižší průtok",
  /* check.heater */ "Záložní topné těleso",
  /* check.retries */ "Opakování ochrany",
  /* check.status.ok */ "V POŘÁDKU",
  /* check.status.info */ "POZNÁMKA",
  /* check.status.warn */ "VAROVÁNÍ",
  /* check.status.collecting */ "KONTROLA",
  /* check.status.observation */ "POUZE MĚŘENÍ",
  /* check.status.experimental */ "EXPERIMENTÁLNÍ",
  /* check.status.unavailable */ "NENÍ K DISPOZICI",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · vyhodnoceno ${n}/${a}` : s,
  /* check.detail.value_label */ "Hodnota:",
  /* check.detail.assessment_label */ "Vyhodnocení:",
  /* check.detail.ok */ "Vyhodnocení dokončeno; v pozorovaných datech soustavy nebyl nalezen žádný problém.",
  /* check.detail.info */ "Je dobré o tom vědět, ale nejde o důkaz závady. Co se zde považuje za pozoruhodné, je uvedeno níže u položky „Normální“.",
  /* check.detail.warn */ "Pozornost vyžaduje nález zařízení nebo zdokumentovaný limit.",
  /* check.detail.fault.error */ "Jednotka právě hlásí chybu. Přesný kód je na kartě „Provoz“.",
  /* check.detail.fault.warning */ "Jednotka právě hlásí varování nebo upozornění, nikoli chybu. Přesný kód je na kartě „Provoz“.",
  /* check.detail.fault.past */ "Právě teď se nic nehlásí. Během posledních 24 hodin se objevilo hlášení, které samo zmizelo, proto tento řádek není v pořádku. Kvůli hlášení, které zmizelo, není třeba nic dělat; pokud se vrací, poznamenejte si, kdy se objevuje.",
  /* check.detail.fault.past_unknown */ "Během posledních 24 hodin se objevilo hlášení. Zda je právě aktivní, nelze zjistit — řádek poruch neodpovídá, proto zkontrolujte spojení X10A.",
  /* check.detail.collecting */ (n, r) => `Zachyceno ${n} z ${r}; vyhodnocení zatím není možné.`,
  /* check.detail.cycling_split */ " Zde se vyhodnocuje pouze potvrzené vytápění prostoru. Ohřev teplé vody podléhá jiným omezením; jednoznačně rozpoznané chlazení je vyloučeno. Počítá se každý úplný běh: trojcestný ventil a u prostorového okruhu i provozní režim I/U musí zůstat po celý běh čitelné a beze změny. Vše ostatní zůstává nezařazené a není posuzováno ani jedním způsobem.",
  /* check.detail.cycling_pooled */ " Všechny běhy byly vyhodnoceny společně, protože nebyl dostatek důkazů pro zařazení: některý vstup byl příliš řídký, bylo zařazeno méně než 12 běhů nebo více než 10 % dokončených běhů zůstalo nezařazených. Ohřev teplé vody nebo chlazení proto mohou zakrýt krátké topné běhy. Údaje o třídách vedle tohoto textu jsou pouze pozorování, nerozhodovaly o výsledku.",
  /* check.detail.outdoor_cycling */ " Venkovní hodnoty X10A obsahují jen čerstvé vzorky z dokončených a konzistentně zařazených běhů vytápění prostoru. Slouží jako kontext a nemění práh ani výsledek hodnocení cyklování.",
  /* check.detail.outdoor_defrost */ " Venkovní hodnoty X10A obsahují jen čerstvé vzorky, kdy byly čitelné stav odmrazování i stav kompresoru a kompresor běžel. Slouží jako kontext a nemění práh ani výsledek hodnocení odmrazování.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} z ${r} dokončeno v čistých hodinových oknech; aktuální čisté okno: ${c} z ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} z ${r} dokončeno v čistých hodinových oknech; bylo zjištěno nabíjení zásobníku nebo BSH, do konce ustálení zbývá ${s}.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} z ${r} dokončeno v čistých hodinových oknech; zatím není k dispozici celé čisté hodinové okno.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "kandidátní okno bylo vyřazeno" : n >= 2 && n <= 4 ? "kandidátní okna byla vyřazena" : "kandidátních oken bylo vyřazeno"} (${reasons}); nejdelší dosáhlo ${best} z 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `Touto metodou nelze vyhodnotit: za celých 24 hodin nebylo dokončeno ani jedno čisté hodinové okno a ${n} ${n === 1 ? "kandidátní okno bylo vyřazeno" : n >= 2 && n <= 4 ? "kandidátní okna byla vyřazena" : "kandidátních oken bylo vyřazeno"} (${reasons}); nejdelší dosáhlo ${best} z 60 min. Nabíjení zásobníku vyžaduje 105 nerušených minut (45 min ustálení a 60minutové okno); čisté hodině mohou zabránit také odběry, činnost čerpadla, nečitelná data nebo souvislá tepelná ztráta dostatečně rychlá, aby vypadala jako odběr. Uložené součty neukazují, která příčina převládala, proto nelze vyloučit rychlou souvislou tepelnou ztrátu.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `Nelze vyhodnotit: za celých 24 hodin nebylo dokončeno ani jedno čisté hodinové okno a ${n === 1 ? "jedno kandidátní okno bylo vyřazeno" : n >= 2 && n <= 4 ? `všechna ${n} kandidátní okna byla vyřazena` : `všech ${n} kandidátních oken bylo vyřazeno`}, protože spojení X10A uprostřed okna přestalo odpovídat; nejdelší dosáhlo ${best} z 60 min. Jde o spojení, nikoli soustavu — zkontrolujte zapojení X10A a piny RX/TX.`,
  /* check.detail.dhw_reason.charge */ "nabíjení zásobníku",
  /* check.detail.dhw_reason.pump */ "vnitřní čerpadlo",
  /* check.detail.dhw_reason.draw */ "pokles podobný odběru",
  /* check.detail.dhw_reason.reading */ "nevěrohodná hodnota R5T",
  /* check.detail.dhw_reason.blind */ "X10A neodpovídá",
  /* check.detail.collecting_unknown */ "Pro vyhodnocení zatím není dostatek použitelných důkazů.",
  /* check.detail.observation */ "Pouze naměřená hodnota; neexistuje univerzální limit V POŘÁDKU/VAROVÁNÍ.",
  /* check.detail.experimental */ "Experimentální pozorování; stabilní čítač nedokazuje, že nedošlo k omezení.",
  /* check.detail.unavailable */ "Aktivní profil neposkytuje pro tuto kontrolu žádná vyhodnotitelná data.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "start" : n >= 2 && n <= 4 ? "starty" : "startů"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "cyklus" : n >= 2 && n <= 4 ? "cykly" : "cyklů"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "spárovaný" : n >= 2 && n <= 4 ? "spárované" : "spárovaných"}`,
  /* check.mean */ (d) => `${d}/start`,
  /* check.cycling_space */ (n, d) => d ? `prostor ${n} × ${d}` : `prostor ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `teplá voda ${n} × ${d}` : `teplá voda ${n}`,
  /* check.cycling_cooling */ (n) => `chlazení ${n} vyloučeno`,
  /* check.cycling_censored */ (n) => `${n} ${n === 1 ? "nezařazený" : n >= 2 && n <= 4 ? "nezařazené" : "nezařazených"}`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · průměr ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `zásobník ${m} min`,
  /* check.tank_runtime */ (d) => `zásobník ${d}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "okno" : n >= 2 && n <= 4 ? "okna" : "oken"}`,
  /* check.loss_pump_off */ "také při vypnutém oběhovém čerpadle",
  /* check.loss_with_pump */ "během provozu oběhového čerpadla",
  /* check.loss_unattributed */ "přiřazení čerpadlu není úplné",
  /* check.fault_err */ "Aktivní porucha",
  /* check.fault_warn */ "Aktivní varování",
  /* check.fault_past */ "Výskyt během posledních 24 h · nyní neaktivní",
  /* check.fault_none */ "Nic není aktivní",
  /* check.fault_unknown */ "Aktuální stav není znám",
  /* check.fault_past_unknown */ "Výskyt během posledních 24 h · aktuální stav není znám",
  /* check.retry_seen */ "Zjištěn nárůst čítače",
  /* check.retry_none */ "Nebyl zjištěn žádný nárůst",
  /* values.waiting */ "Čekám na první dotaz…",
  /* values.sg_x10a_mode */ "Režim Smart Grid (kontakty X10A)",
  /* group.Operation */ "Provoz",
  /* group.Domestic hot water */ "Teplá užitková voda",
  /* group.Water circuit */ "Vodní okruh",
  /* group.Refrigerant / outdoor */ "Chladivo / venkovní jednotka",
  /* group.Electrical */ "Elektrická část",
  /* group.Device */ "Zařízení",
  /* group.Other values */ "Ostatní hodnoty",
  /* group.Protection */ "Ochrana",
  /* protect.limiting */ "právě omezuje",
  /* group.Values */ "Hodnoty",
  /* state.on */ "ZAP",
  /* state.off */ "VYP",
  /* enum.auto */ "Automaticky",
  /* enum.heating */ "Vytápění",
  /* enum.cooling */ "Chlazení",
  /* enum.no_error */ "Bez chyby",
  /* enum.fault */ "Porucha",
  /* enum.warning */ "Varování",
  /* enum.space_heating */ "Vytápění prostoru",
  /* enum.dhw */ "TUV",
  /* enum.free_running */ "Volný provoz",
  /* enum.forced_off */ "Vynuceně vypnuto",
  /* enum.recommended_on */ "Doporučeno zapnout",
  /* enum.forced_on */ "Vynuceně zapnuto",
  /* enum.unknown */ (n) => `Neznámé (${n})`,
  /* chip.space_on */ "Okruh ZAP",
  /* chip.space_off */ "Okruh VYP",
  /* chip.quiet */ "Tichý",
  /* schem.sg_boost */ "POSÍLENÍ",
  /* sg.mode0 */ "Volný provoz",
  /* sg.mode1 */ "Vynuceně vypnuto",
  /* sg.mode2 */ "Doporučeno zapnout",
  /* sg.mode3 */ "Vynuceně zapnuto",
  /* schem.to_dhw */ "3WV → TUV",
  /* schem.to_space */ "3WV → dům",
  /* normal.label */ "Normální:",
  /* meaning.label */ "Jak hodnotu číst:",
  /* hist.title */ "Posledních 24 hodin",
  /* hist.recorded */ (h) => `Zaznamenáno · ${h} h`,
  /* hist.now */ "nyní",
  /* hist.ago */ (h) => `před ${h} h`,
  /* hist.loading */ "Načítám průběh…",
  /* hist.none */ "Dosud nebyly zaznamenány žádné hodnoty.",
  /* hist.err */ "Průběh není dostupný.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "mezera" : n >= 2 && n <= 4 ? "mezery" : "mezer"} — neměřeno`,
  /* hist.nm */ "neměřeno",
  /* hist.rel */ (h) => `před ${h} h`,
  /* hist.held */ "venkovní jednotka stojí",
  /* hist.heldnote */ (h) => `${h} h v klidu — neměřeno`,
  /* hist.forecast */ "Open-Meteo · předpověď",
  /* hist.in_hours */ (h) => `za ${h} h`,
  /* hist.aria */ (l) => `${l} — průběh za 24 hodin. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.aria_pinned */ (l, r) => `${l} — průběh za 24 hodin. Připnutá hodnota: ${r}. Dalším klepnutím ji zrušíte.`,
  /* hist.pin_hint */ "klepnutím připnout",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} h`,
  /* hist.duration_hm */ (h, m) => `${h} h ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · přibl. ${d}`,
  /* hist.state_active */ "Aktivní",
  /* hist.state_off */ "Vypnuto",
  /* val.since */ (d) => `po dobu ${d}`,
  /* val.since_min */ (d) => `≥ ${d}`,
  /* val.since_gap */ (d) => `${d} z této doby nebylo pozorováno`,
  /* hist.modbus_plateau */ (when, d) => `registr beze změny ${when} · přibl. ${d} · stáří měření není známé`,
  /* hist.boost_total */ (d) => `Posílení aktivní · ${d}`,
  /* hist.boost_none */ "V zaznamenaném období nebylo posílení aktivní.",
  /* hist.boost_ago_range */ (a, b) => `před ${a}–${b} h`,
  /* hist.boost_active */ "Posílení aktivní",
  /* hist.boost_inactive */ "Posílení vypnuté",
  /* hist.boost_aria */ (l, d) => `${l} — časová osa stavu Smart Grid se všemi čtyřmi režimy. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.defrost_total */ (d) => `Odmrazování pozorováno jako aktivní · ${d} vzorkovaného času rastru`,
  /* hist.defrost_none */ "V zaznamenaném období nebyl pozorován žádný cyklus odmrazování.",
  /* hist.defrost_active */ "Odmrazování aktivní",
  /* hist.defrost_inactive */ "Odmrazování vypnuté",
  /* hist.defrost_aria */ (l, d) => `${l} — časová osa odmrazování. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.quiet_total */ (d) => `Tichý režim pozorován jako aktivní · ${d} vzorkovaného času rastru`,
  /* hist.quiet_none */ "V zaznamenaném období nebyl pozorován žádný interval tichého režimu.",
  /* hist.quiet_active */ "Tichý režim aktivní",
  /* hist.quiet_inactive */ "Tichý režim vypnutý",
  /* hist.quiet_aria */ (l, d) => `${l} — časová osa tichého režimu. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.heater_total */ (d) => `Ohřívač pozorován jako aktivní · ${d} vzorkovaného času rastru`,
  /* hist.heater_none */ "V zaznamenaném období nebylo pozorováno použití topného tělesa zásobníku.",
  /* hist.heater_active */ "Topné těleso aktivní",
  /* hist.heater_inactive */ "Topné těleso vypnuté",
  /* hist.heater_aria */ (l, d) => `${l} — časová osa topného tělesa zásobníku. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.preheat_total */ (d) => `Předehřev zásobníku pozorován jako aktivní · ${d} vzorkovaného času rastru`,
  /* hist.preheat_none */ "V zaznamenaném období nebyl pozorován žádný interval předehřevu zásobníku.",
  /* hist.preheat_active */ "Předehřev zásobníku aktivní",
  /* hist.preheat_inactive */ "Předehřev zásobníku vypnutý",
  /* hist.preheat_aria */ (l, d) => `${l} — časová osa předehřevu zásobníku X10A. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.disinfection_total */ (d) => `Dezinfekce pozorována jako aktivní · ${d} vzorkovaného času rastru`,
  /* hist.disinfection_none */ "V zaznamenaném období nebyl pozorován žádný dezinfekční provoz.",
  /* hist.disinfection_active */ "Dezinfekce aktivní",
  /* hist.disinfection_inactive */ "Dezinfekce vypnutá",
  /* hist.disinfection_aria */ (l, d) => `${l} — časová osa dezinfekce HomeHub. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.buh_total */ (d) => `Záložní topné těleso pozorováno jako aktivní · ${d} vzorkovaného času rastru`,
  /* hist.buh_none */ "V zaznamenaném období nebylo pozorováno použití záložního topného tělesa.",
  /* hist.buh_active */ "Záložní topné těleso aktivní",
  /* hist.buh_inactive */ "Záložní topné těleso vypnuté",
  /* hist.buh_step1 */ "Stupeň 1",
  /* hist.buh_step2 */ "Stupeň 2",
  /* hist.buh_aria */ (l, d) => `${l} — časová osa záložního topného tělesa. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.valve_dhw_total */ (d) => `TUV · ${d}`,
  /* hist.valve_space_total */ (d) => `Prostorový okruh · ${d}`,
  /* hist.valve_none */ "V zaznamenaném období nebyla zaznamenána poloha TUV.",
  /* hist.valve_dhw */ "TUV",
  /* hist.valve_space */ "Prostorový okruh",
  /* hist.valve_aria */ (l, d) => `${l} — časová osa trojcestného ventilu. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.circ_total */ (d) => `Čerpadlo pozorováno v chodu · ${d} vzorkovaného času rastru`,
  /* hist.circ_none */ "V zaznamenaném období nebyl pozorován žádný běh čerpadla.",
  /* hist.circ_on */ "Běží",
  /* hist.circ_off */ "Zastaveno",
  /* hist.circ_unavailable */ "Nedostupné",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "nedostupný interval" : n >= 2 && n <= 4 ? "nedostupné intervaly" : "nedostupných intervalů"}`,
  /* hist.circ_aria */ (l, d) => `${l} — časová osa oběhového čerpadla. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.valve2_on_total */ (d) => `Výstup 2WV ZAP · ${d}`,
  /* hist.valve2_off_total */ (d) => `Výstup 2WV VYP · ${d}`,
  /* hist.valve2_on */ "Výstup 2WV ZAP",
  /* hist.valve2_off */ "Výstup 2WV VYP",
  /* hist.valve2_none */ "Ve zvoleném období nebyl pro výstup dvoucestného ventilu zaznamenán stav ZAP.",
  /* hist.valve2_aria */ (l, d) => `${l} — časová osa výstupu dvoucestného ventilu. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* hist.flow_switch_total */ (d) => `Stav X10A ZAP · ${d} vzorkovaného času rastru`,
  /* hist.flow_switch_on */ "Stav X10A ZAP",
  /* hist.flow_switch_off */ "Stav X10A VYP",
  /* hist.flow_switch_none */ "Ve zvoleném období nebyl pro tento stav X10A zaznamenán stav ZAP.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — časová osa spínače průtoku vody. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`,
  /* toast.saved */ "Uloženo",
  /* toast.no_changes */ "Žádné změny",
  /* toast.reboot */ "Restartuji — znovu se připojuji…",
  /* toast.rebooted */ "Restartováno — znovu se připojte k zařízení",
  /* toast.busy_retry */ "Zařízení je zaneprázdněné — zkuste to za chvíli",
  /* toast.unreachable */ "Zařízení se nepodařilo kontaktovat",
  /* toast.rejected */ "Odmítnuto",
  /* toast.applying */ "Poslední změna se stále provádí…",
  /* toast.check_wifi */ "Zkontrolujte nastavení WiFi",
  /* toast.check_broker */ "Zkontrolujte adresu brokeru",
  /* toast.check_syslog_port */ "Zkontrolujte port Syslogu",
  /* toast.verifying_mqtt */ "Ověřuji připojení MQTT…",
  /* toast.saving_syslog */ "Ukládám nastavení Syslogu…",
  /* toast.saving_ntp */ "Ukládám nastavení NTP…",
  /* toast.trying_pins */ "Zkouším piny…",
  /* toast.saving_board */ "Ukládám hardware desky…",
  /* ota.uptodate */ "aktuální",
  /* ota.check_failed */ "kontrola selhala",
  /* ota.starting */ "spouštím…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "restartuji…",
  /* ota.failed */ "aktualizace selhala",
  /* ota.timeout */ "vypršel čas",
  /* ota.cancelled */ "zrušeno",
  /* ota.busy */ "zařízení je zaneprázdněné",
  /* ota.replaced */ "Operace aktualizace se změnila — zkontrolujte ji znovu",
  /* ota.unreachable */ "zařízení není dostupné",
  /* ota.active_title */ "Aktualizace firmwaru",
  /* ota.active_sub */ (detail) => `Probíhá instalace · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Probíhá instalace · ${detail} · poslední přijatý stav`,
  /* ota.snapshot_title */ "Aktualizace firmwaru",
  /* ota.snapshot_label */ "Stav dat",
  /* ota.snapshot_value */ "Snímek",
  /* ota.snapshot_help */ "Poslední přijatý stav před tímto načtením stránky. Živá data mohou být během instalace pozastavena; nastavení zůstane uzamčeno do restartu.",
  /* ota.reload_hint */ "nainstalováno — načtěte stránku znovu",
  /* ota.confirm */ (cur, avail) => `Je k dispozici aktualizace: v${cur} → v${avail}\n\nZařízení stáhne a nainstaluje podepsaný obraz a poté se restartuje. Pokud se nový firmware nemůže připojit, automaticky se vrátí k předchozí verzi.`,
  /* aria.ota */ "Zkontrolovat aktualizace firmwaru",
  /* ota.title_check */ "Klepnutím zkontrolujete aktualizace firmwaru",
  /* ota.title_avail */ (v) => `Je k dispozici aktualizace v${v} — klepnutím ji nainstalujete`,
  /* mq.err_format */ "Zadejte hostitel:port — např. 192.168.1.10:1883 — nebo mqtts://hostitel:8883 pro TLS",
  /* sl.err_port */ "Port musí být celé číslo 1–65535 (např. logs.example.com:514).",
  /* btn.saving */ "Ukládám…",
  /* btn.verifying */ "Ověřuji…",
  /* btn.save */ "Uložit",
  /* btn.cancel */ "Zrušit",
  /* btn.close */ "Zavřít",
  /* schem.card_aria */ "Živé schéma soustavy: venkovní jednotka, chladivový okruh, deskový výměník, vodní okruh se záložním ohřívačem a 3cestným ventilem, zásobník TUV a okruh domu",
  /* schem.group_aria */ "Živé schéma soustavy — vyberte hodnotu nebo součást pro vysvětlení",
  /* schem.outdoor_unit */ "VENKOVNÍ JEDNOTKA",
  /* schem.defrost_pill */ "❄ odmraz.",
  /* schem.outdoor */ "Venku",
  /* insp.close */ "Zavřít",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "ZÁSOBNÍK TUV",
  /* schem.set */ "žádaná",
  /* schem.bsh_label */ "El. těleso",
  /* schem.space_circuit */ "OKRUH DOMU",
  /* schem.heating */ "VYTÁPĚNÍ",
  /* schem.cooling */ "CHLAZENÍ",
  /* schem.pump */ "ČERP.",
  /* schem.return */ "R4T",
  /* schem.room */ "Místnost",
  /* schem.flow_rate */ "průtok",
  /* schem.water_press */ "tlak vody",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "SPÍNAČ PRŮT.",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Konfigurace WiFi",
  /* wifi.ssid */ "Síť WiFi (SSID)",
  /* wifi.pass */ "Heslo WiFi",
  /* wifi.err_ssid */ "SSID může mít nejvýše 32 znaků",
  /* wifi.err_pass */ "Heslo musí být prázdné (otevřená síť) nebo mít 8 až 63 znaků",
  /* wifi.hint */ "Zadejte název sítě WiFi. Pokud se zařízení nemůže připojit, automaticky obnoví předchozí nastavení WiFi.",
  /* mqtt.title */ "Broker MQTT",
  /* mqtt.hostport */ "Hostitel : port",
  /* mqtt.user */ "Uživatelské jméno · volitelné",
  /* mqtt.pass */ "Heslo · volitelné",
  /* mqtt.clear */ "Odstranit uložené přihlašovací údaje — připojit anonymně",
  /* mqtt.hint */ "Uživatelské jméno nebo heslo vyžaduje šifrované připojení TLS (mqtts://, například mqtts://hostitel:8883). Ponecháním prázdného hostitele MQTT vypnete.",
  /* mqtt.base */ "Základní téma",
  /* mqtt.base_hint */ "Pro každé zařízení použijte jedno základní téma. Druhá deska na tomto brokeru potřebuje vlastní, jinak budou obě sdílet témata, metriky a zařízení Home Assistant. Změnou se tato instalace v Home Assistant přejmenuje a stará uchovaná témata zůstanou na brokeru.",
  /* err.mqtt_base_too_long */ "Základní téma je příliš dlouhé.",
  /* err.mqtt_base_wildcard */ "Základní téma nesmí obsahovat + ani # — jsou to zástupné znaky odběru a broker do nich odmítne publikovat.",
  /* err.mqtt_base_reserved */ "Základní téma nesmí začínat znakem $ — tento strom patří samotnému brokeru.",
  /* err.mqtt_base_slash */ "Základní téma nesmí začínat ani končit lomítkem.",
  /* err.mqtt_base_control */ "Základní téma nesmí obsahovat řídicí znaky.",
  /* err.mqtt_base_space */ "Základní téma nesmí obsahovat mezery.",
  /* err.mqtt_base_empty_segment */ "Základní téma nesmí obsahovat prázdný úsek (//).",
  /* err.mqtt_base_not_sluggable */ "Základní téma musí obsahovat alespoň jedno písmeno nebo číslici — stane se ID zařízení této instalace v Home Assistant a bez něj by dvě zařízení kolidovala.",
  /* mqtt.err.waiting_x10a */ "Z X10A zatím nepřišla odpověď tepelného čerpadla — zkontrolujte zapojení, GND a piny RX/TX.",
  /* mqtt.err.task_alloc */ "Úlohu MQTT se nepodařilo spustit — restartujte zařízení a zkontrolujte diagnostiku.",
  /* mqtt.err.transport */ "Připojení TLS/TCP k brokeru selhalo.",
  /* mqtt.err.refused */ "Broker odmítl připojení — zkontrolujte uživatelské jméno a heslo.",
  /* mqtt.err.connection */ "Připojení k brokeru MQTT selhalo.",
  /* dyn.card */ "Diagnostika topné křivky",
  /* dyn.state */ "Stav",
  /* dyn.state_recording */ "Zaznamenávání",
  /* dyn.state_recording_nowx */ "Zaznamenávání · bez předpovědi",
  /* dyn.state_waiting */ "Čekám na vytápění prostoru",
  /* dyn.state_cooling */ "Chlazení · nevzorkuje se",
  /* dyn.state_room */ "Zdroj místnosti není použitelný",
  /* dyn.state_x10a */ "X10A není v síti",
  /* dyn.state_homehub */ "HomeHub není v síti",
  /* dyn.state_gate */ "Stav soustavy není znám",
  /* dyn.state_mode */ "Režim vytápění/chlazení není znám",
  /* dyn.state_clock */ "Hodiny nejsou nastaveny",
  /* dyn.state_blocked */ "Nezaznamenává se",
  /* dyn.state_setup_room */ "Nastavte zdroj místnosti",
  /* dyn.state_setup_homehub */ "HomeHub není nastaven",
  /* dyn.state_homehub_disabled */ "Diagnostika vypnuta — HomeHub je vypnutý",
  /* dyn.state_no_broker */ "Nezaznamenává se — chybí broker MQTT",
  /* dyn.state_safe_mode */ "Nezaznamenává se — nouzový režim",
  /* dyn.state_inactive */ "Nezaznamenává se — vzorkovač neběží",
  /* dyn.room_off */ "Pokojový termostat je vypnutý",
  /* dyn.room_not_heating */ "Pokojový termostat není v režimu vytápění",
  /* dyn.room_stale */ "Hodnota z místnosti je příliš stará",
  /* dyn.room_no_value */ "Čekám na hodnotu z místnosti",
  /* dyn.room_invalid_payload */ "Neplatná zpráva MQTT",
  /* dyn.room_invalid_temperature */ "Teplota místnosti je mimo povolený rozsah",
  /* dyn.room_invalid_setpoint */ "Cílová teplota je mimo povolený rozsah",
  /* dyn.room_no_setpoint */ "Cílová teplota chybí",
  /* dyn.room_no_time */ "Čas měření chybí",
  /* dyn.room_retained_no_time */ "Uchovaná hodnota bez času měření",
  /* dyn.room_future_time */ "Čas měření je v budoucnosti",
  /* dyn.room_backward_time */ "Čas měření se posunul zpět",
  /* dyn.room_invalid_time */ "Neplatný čas měření",
  /* dyn.room_no_enabled */ "Chybí stav zapnuto/vypnuto termostatu",
  /* dyn.room_no_hvac_mode */ "Chybí provozní režim termostatu",
  /* dyn.room_source */ "Zdroj teploty místnosti",
  /* dyn.weather */ "Volitelná srovnávací předpověď",
  /* dyn.strategy */ "Diagnostický signál",
  /* dyn.not_configured */ "Nenastaveno",
  /* dyn.outdoor */ "Naměřený venkovní vzduch",
  /* dyn.outdoor_detail_status */ "Stav",
  /* dyn.outdoor_detail_now */ "Aktuální hodnota",
  /* dyn.outdoor_detail_sample */ "Při poslední zaznamenané události",
  /* dyn.outdoor_status_live */ (source) => `${source} má aktuální hodnotu; ta je jako kontext připojena ke každé zaznamenané události.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} je nastaven, ale nemá aktuální hodnotu. Události se nadále ukládají bez této osy.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} není nastaven. Události se nadále ukládají bez této osy.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} je nastaven, ale právě se nic nezaznamenává. Důvod uvádí stavový řádek výše.`,
  /* dyn.outdoor_sample_none */ "Zaznamenáno bez venkovní hodnoty",
  /* dyn.outdoor_help_axis */ "Venkovní teplota dává zaznamenané odchylce místnosti smysl. Bez ní vypadají +0,5 K při −5 °C a +0,5 K při +12 °C stejně, přestože první případ ukazuje na příliš strmou křivku a druhý na příliš vysoko nastavenou křivku. Hodnota je volitelná: záznam pokračuje i bez ní a nikdy se nepoužívá k rozhodnutí, zda se událost zaznamená.",
  /* dyn.outdoor_help_placement */ "Jde o to, co snímač měří v místě instalace. Firmware nepozná, kde je namontován — vedle vnitřní jednotky měří vzduch v místnosti, na zastíněném venkovním místě skutečný venkovní vzduch; smysluplné srovnání poskytuje pouze druhá možnost.",
  /* dyn.outdoor_help_setup */ "Tuto hodnotu může poskytovat M5Stack ENV III na portu Grove desky. Při zastíněné venkovní montáži měří venkovní vzduch nepřetržitě — na rozdíl od vlastního snímače tepelného čerpadla, který se neaktualizuje, když venkovní jednotka stojí. Nastavuje se v části ESP32 → Hardware spolu s deskou, ke které je připojen.",
  /* dyn.plant_outdoor */ "Venkovní vzduch soustavy",
  /* dyn.plant_outdoor_help */ "Jde o vstup HomeHub 44, tedy vlastní údaj tepelného čerpadla o venkovním vzduchu. Zachycuje se ve stejném aktuálním cyklu Modbus jako podmínky topného okna a jeho zdroj se ukládá s událostí. Zůstává oddělený od ENV III a nikdy nemění rozhodnutí, zda se událost zaznamená.",
  /* dyn.shadow_strategy */ "Hrubá odchylka místnosti · 30 min",
  /* dyn.card_help */ "Každých 30 minut během jednoznačně rozpoznaného vytápění prostoru firmware zaznamená rozdíl mezi teplotou referenční místnosti a jejím cílem spolu s venkovní teplotou v daném okamžiku, pokud ji poskytuje některý snímač. Spolu s dobou běhu, minimálními limity výstupní vody a činností termostatu může dlouhodobější průběh ukázat, zda bývá topná křivka příliš vysoká nebo příliš nízká. Odchylka místnosti 1 K automaticky neznamená změnu výstupní vody o 1 K. Tato funkce pouze čte data a nic do tepelného čerpadla nezapisuje.",
  /* dyn.state_help_recording */ "Běží potvrzené vytápění prostoru a vstup místnosti je platný, proto se zaznamenávají hrubé vzorky chyby místnosti. Sezónní trend čtěte spolu s dobou běhu a důkazy o omezení; jeden vzorek není závěr.",
  /* dyn.state_help_waiting */ "Soustava právě není v normálním prostorovém provozu, proto se vzorek nezaznamenává. V létě jde o normální očekávaný stav, nikoli poruchu.",
  /* dyn.state_help_cooling */ "HomeHub hlásí normální prostorový provoz, ale aktuálním režimem je chlazení. Okna chlazení jsou ze souboru dat pro topnou křivku záměrně vyloučena.",
  /* dyn.state_help_blocked */ "Chybí povinný vstup, proto se nic nezaznamenává. Záznam se obnoví, jakmile se vstup vrátí; zastaralé nebo nejednoznačné důkazy se nikdy nevzorkují.",
  /* dyn.state_help_room */ "Hodnota z místnosti se dostává do zařízení, ale právě z ní nelze vytvořit platnou odchylku od cíle. Dokud nebude zdroj opět použitelný, vzorek nevznikne.",
  /* dyn.state_help_setup */ "Diagnostika se spustí po uložení zdroje místnosti MQTT s časovým údajem a cílem. Předpověď je volitelný srovnávací důkaz; není nutné zveřejnit polohu.",
  /* dyn.state_help_inactive */ "Zdroje jsou nastaveny, ale nic je nevyhodnocuje: vzorkovač běží na připojení MQTT a tato deska se po opakovaných pádech spustila v nouzovém režimu, ve kterém jsou všichni volitelní odběratelé vypnuti. Nic se neztratí — záznam se sám obnoví, jakmile se deska znovu spustí normálně.",
  /* dyn.state_help_no_broker */ "Zdroj místnosti je uložen, ale diagnostika jej čte přes MQTT a není nastaven žádný broker. Nastavte broker na kartě Připojení; uložený zdroj místnosti zůstane zachován a záznam se spustí sám.",
  /* dyn.state_help_setup_homehub */ "Diagnostika potřebuje HomeHub, aby poznala, kdy soustava skutečně vytápí; bez něj nerozliší topné okno od ohřevu teplé vody nebo klidu. Nastavte adresu HomeHubu na kartě Protokol.",
  /* dyn.state_help_homehub_disabled */ "Tato diagnostika závisí na dvou signálech soustavy z HomeHubu. Je-li adresa HomeHubu výslovně prázdná, neběží Modbus ani tato závislá diagnostika.",
  /* dyn.strategy_help */ "Vzorek je cílová teplota místnosti minus skutečná teplota místnosti: kladná hodnota znamená, že je místnost pod cílem, záporná že je nad ním. Nepoužívá se žádné neutrální pásmo, zaokrouhlení, omezení ani omezení rychlosti změny. Jde o nekalibrovaný ukazatel, nikoli požadovanou korekci výstupní vody. Referenční místnost musí zastupovat vytápěnou zónu. Její vlastní termostat nebo zavřené ventily tvoří vnitřní regulační smyčku: mohou odstranit požadavek na teplo a skrýt příliš vysokou křivku. Průběh místnosti čtěte spolu s četností, kdy je teplota výstupní vody držena na minimu (podíl omezení D2), a s četností skutečných požadavků zóny na teplo.",
  /* env.title */ "Venkovní snímač",
  /* env.card */ "Venkovní klima",
  /* env.none */ "Žádný snímač",
  /* env.temperature */ "Teplota",
  /* env.humidity */ "Vlhkost",
  /* env.pressure */ "Tlak vzduchu",
  /* env.sensor_state */ "Snímač",
  /* env.live */ "Živě",
  /* env.collecting */ "Shromažďuji…",
  /* env.history_title */ "Měření ENV III",
  /* env.history_help */ "Teplota, vlhkost a tlak vzduchu se na ESP32 uchovávají jako klouzavé průběhy za 24 hodin v pětiminutových intervalech.",
  /* env.history_scales */ "samostatná měřítka",
  /* env.unavailable */ "Snímač není dostupný",
  /* env.err_pins */ "SDA a SCL musí být odlišné platné piny",
  /* env.saving */ "Ukládám konfiguraci venkovního snímače…",
  /* env.checking */ "Kontroluji ENV III…",
  /* env.err_not_reachable */ "ENV III není na těchto pinech SDA/SCL právě dostupný.",
  /* env.err_sht30 */ "Snímač teploty/vlhkosti ENV III není na těchto pinech dostupný.",
  /* env.err_qmp6988 */ "Snímač tlaku ENV III není na těchto pinech dostupný.",
  /* env.err_disable_first */ "Před změnou pinů SDA/SCL vyberte Žádný snímač a nastavení uložte.",
  /* env.pins_hint */ "SDA = data (žlutý vodič Grove); SCL = hodiny (bílý vodič Grove). Pokud jsou dva vybrané GPIO prohozené, firmware ověří opačné pořadí a automaticky uloží funkční přiřazení.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: použijte dva nabízené piny — na konektoru pouzdra jsou GPIO5–GPIO8 a GPIO38. Port Grove (GPIO2/1) se zobrazí pouze tehdy, když na něm není spojení X10A: jeden kontakt nemůže současně přenášet sériové spojení i sběrnici I2C. GPIO39 není pro ENV III k dispozici.",
  /* ref.title */ "Zdroj teploty místnosti",
  /* ref.name */ "Název",
  /* ref.temperature_source */ "Zdroj teploty",
  /* ref.target */ "Cílová teplota",
  /* ref.timestamp_source */ "Zdroj časového údaje · volitelný",
  /* ref.max_age */ "Maximální stáří · sekundy",
  /* ref.temperature_source_help */ "Přesné téma MQTT a volitelná cesta JSON za $. Chybějící nebo nesprávné cesty se ohlásí po přijetí dat.",
  /* ref.target_help */ "Pevná hodnota v °C nebo přesné téma MQTT s volitelnou cestou JSON za $.",
  /* ref.timestamp_source_help */ "Volitelný zdrojový čas RFC3339/Unix ve formátu téma$cesta. Prázdné pole použije čas příchodu živé zprávy MQTT; uchované hodnoty se pak bezpečně odmítnou.",
  /* ref.max_age_help */ "Maximální povolené stáří zdrojové hodnoty od 10 do 3600 sekund.",
  /* ref.error */ "Poslední chyba",
  /* ref.broker_off */ "Broker MQTT je vypnutý",
  /* ref.retained */ "uloženo brokerem",
  /* ref.time_untrusted */ "Uchovaná hodnota bez důvěryhodného času měření",
  /* ref.clock_unsynced */ "Hodiny zařízení nejsou synchronizovány",
  /* ref.now */ "nyní",
  /* ref.ago */ (s) => `před ${s} s`,
  /* ref.age_unknown */ "neznámé",
  /* ref.saved */ "Zdroj teploty místnosti uložen",
  /* ref.detail.status_label */ "Stav:",
  /* ref.detail.diagnosis_label */ "Diagnostika topné křivky:",
  /* ref.status.measurement_valid */ "Měření je platné",
  /* ref.status.not_configured */ "Nenastaveno",
  /* ref.status.usable */ "Použitelné",
  /* ref.status.unusable */ "Nepoužitelné",
  /* ref.status.error */ "Chyba",
  /* ref.status.stale */ "Zastaralé",
  /* ref.status.waiting */ "Čekám",
  /* ref.status.unavailable */ "Nedostupné",
  /* ref.detail.setup */ "Přidejte zdroj MQTT pomocí tužky",
  /* ref.detail.stale */ "Hodnota je starší, než je povoleno",
  /* ref.detail.waiting */ "Dosud nebyla přijata žádná hodnota MQTT",
  /* ref.detail.error */ (e) => `Zpráva MQTT odmítnuta: ${e}`,
  /* ref.detail.temperature_label */ "Teplota místnosti:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Cílová teplota:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Poslední hodnota:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · povoleno: nejvýše ${max} s`,
  /* ref.detail.purpose */ "Diagnostika porovnává teplotu místnosti s cílovou teplotou, aby v čase ukázala, zda je topná křivka příliš vysoká nebo příliš nízká. Tepelné čerpadlo se neovládá.",
  /* ref.delete */ "Smazat",
  /* ref.deleting */ "Mažu…",
  /* ref.deleted */ "Zdroj teploty místnosti a zachycená hodnota byly smazány",
  /* circ.title */ "Zdroj oběhového čerpadla",
  /* circ.row */ "Cirkulační čerpadlo TUV",
  /* circ.default_name */ "Cirkulační čerpadlo",
  /* circ.name */ "Název",
  /* circ.topic */ "Téma MQTT",
  /* circ.power_path */ "Cesta JSON k výkonu",
  /* circ.time_path */ "Cesta JSON k času",
  /* circ.power_help */ "Skutečný činný výkon ve wattech; výstup relé se nepoužívá.",
  /* circ.time_help */ "Čas měření jako RFC3339 nebo sekundy Unix.",
  /* circ.on_threshold */ "ZAP od · W",
  /* circ.off_threshold */ "VYP do · W",
  /* circ.max_age */ "Maximální stáří · sekundy",
  /* circ.confirm */ "Potvrzení · sekundy",
  /* circ.hint */ "Pouze čtení. Uložení nejprve otestuje jednu čerstvou hodnotu MQTT a zásuvku nikdy nepřepne.",
  /* circ.settings_help */ "Deska porovnává skutečný výkon čerpadla s čistými hodinovými okny chladnutí zásobníku. Pouze pozoruje a zásuvku nikdy nepřepíná.",
  /* circ.not_configured */ "Nenastaveno",
  /* circ.unavailable */ "Nedostupné",
  /* circ.broker_off */ "Chybí broker MQTT",
  /* circ.running */ "Běží",
  /* circ.stopped */ "Zastaveno",
  /* circ.checking */ "Kontroluji",
  /* circ.stale */ "Zastaralé",
  /* circ.waiting */ "Čekám na zprávu",
  /* circ.detail.source */ "Zdroj",
  /* circ.detail.power */ "Činný výkon",
  /* circ.detail.state */ "Rozpoznaný stav",
  /* circ.detail.age */ "Stáří měření",
  /* circ.delete */ "Smazat",
  /* circ.deleting */ "Mažu…",
  /* circ.deleted */ "Zdroj oběhového čerpadla smazán",
  /* circ.saved */ "Zdroj oběhového čerpadla uložen",
  /* circ.test_failed */ "Nebyla přijata čitelná čerstvá hodnota výkonu čerpadla",
  /* circ.err_topic */ "Zadejte přesné téma MQTT bez zástupných znaků + nebo #",
  /* circ.err_power_path */ "Zadejte cestu JSON k činnému výkonu, například apower",
  /* circ.err_time_path */ "Zadejte cestu JSON k časovému údaji, například aenergy.minute_ts",
  /* circ.err_max_age */ "Maximální stáří musí být celé číslo mezi 10 a 3600 sekundami",
  /* circ.err_confirm */ "Potvrzení musí být celé číslo mezi 1 a 600 sekundami",
  /* circ.err_threshold */ "Prahy výkonu mohou mít nejvýše jedno desetinné místo",
  /* circ.err_order */ "Práh ZAP musí být vyšší než práh VYP",
  /* wx.title */ "Předpověď počasí Open-Meteo",
  /* wx.latitude */ "Zeměpisná šířka",
  /* wx.longitude */ "Zeměpisná délka",
  /* wx.waiting */ "Čekám na předpověď",
  /* wx.fetching */ "Načítám předpověď Open-Meteo…",
  /* wx.unavailable */ "Nedostupné",
  /* wx.error */ "Chyba předpovědi Open-Meteo",
  /* wx.detail.status */ "Stav:",
  /* wx.status.fresh */ "Aktuální",
  /* wx.status.inactive */ "Vypnuto",
  /* wx.status.fetching */ "Aktualizuji",
  /* wx.status.stale */ "Zastaralé",
  /* wx.status.unavailable */ "Nedostupné",
  /* wx.status.waiting */ "Čekám",
  /* wx.detail.fresh */ "Předpověď byla úspěšně načtena.",
  /* wx.detail.fetching */ "ESP32 načítá nová data předpovědi.",
  /* wx.detail.stale */ "Poslední úspěšné načtení je příliš staré; hodnoty se zobrazují pouze pro diagnostiku.",
  /* wx.detail.unavailable */ "Poslední načtení selhalo; starší hodnota, pokud existuje, se zobrazuje pouze pro diagnostiku.",
  /* wx.detail.waiting */ "Dosud nebyla přijata žádná předpověď.",
  /* wx.detail.temperature_label */ "Teplota:",
  /* wx.detail.temperature */ (v) => `${v} °C je průměrná předpovídaná teplota venkovního vzduchu na další dvě celé hodiny.`,
  /* wx.detail.solar_label */ "Sluneční záření:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² je předpověď globálního horizontálního ozáření za stejné dvouhodinové období.`,
  /* wx.detail.source_label */ "Zdroj:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Pouze pozorování; předpověď nemění řízení tepelného čerpadla.",
  /* wx.err_both */ "Zadejte zeměpisnou šířku i délku, nebo ponechte obě prázdné pro vypnutí",
  /* wx.err_latitude */ "Zeměpisná šířka musí být desetinné číslo mezi -90 a 90",
  /* wx.err_longitude */ "Zeměpisná délka musí být desetinné číslo mezi -180 a 180",
  /* wx.saving */ "Ukládám zdroj počasí…",
  /* wx.hint.configured */ "ESP32 vyžádá novou předpověď každých 45 minut. Každý požadavek odešle souřadnice službě Open-Meteo a odhalí veřejnou IP adresu připojení. Ponecháním obou polí souřadnic prázdných zdroj odstraníte.",
  /* wx.hint.setup */ "Zadejte zeměpisnou šířku a délku. Dvojici souřadnic zkopírovanou z Map Google lze vložit do kteréhokoli pole a automaticky se rozdělí. Po uložení vyžádá ESP32 novou předpověď každých 45 minut. Každý požadavek odešle souřadnice službě Open-Meteo a odhalí veřejnou IP adresu připojení. Předpověď slouží pouze k pozorování a nemění řízení tepelného čerpadla.",
  /* wx.attribution */ "Data o počasí poskytuje Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Zadejte přesné téma MQTT, případně doplněné o $cestu-json",
  /* ref.err_target */ "Zadejte pevnou hodnotu od 5 do 35 °C nebo přesné téma MQTT, případně doplněné o $cestu-json",
  /* ref.err_timestamp_source */ "Zadejte přesné téma MQTT, případně doplněné o $cestu-json",
  /* ref.err_max_age */ "Maximální stáří musí být celé číslo mezi 10 a 3600 sekundami",
  /* ref.save_help */ "Uložením se uloží mapování. K odběru se přihlásí, když je zapnuta Diagnostika soustavy; jinak zůstane nečinné. Stále je vyžadována čitelná čerstvá hodnota MQTT.",
  /* syslog.title */ "Server Syslog",
  /* syslog.hostport */ "Hostitel : port",
  /* syslog.hint */ "Zadejte server Syslog jako název hostitele nebo IP adresu a port. Ponecháním pole prázdného Syslog vypnete.",
  /* ntp.title */ "Server NTP",
  /* ntp.server */ "Server",
  /* ntp.hint */ "Zadejte název hostitele nebo IP adresu časového serveru. Ponecháním pole prázdného se použije výchozí nastavení firmwaru.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Hostitel · IP nebo název .local",
  /* homehub.port */ "Port",
  /* homehub.unit */ "ID jednotky",
  /* homehub.hint */ "Nový firmware při prvním spuštění se sítí jednou automaticky vyhledá HomeHub a výsledek uloží. Vyhledávání lze spustit ručně i zde. Výsledek uložte nebo zadejte adresu ručně. Uložením prázdné adresy se HomeHub trvale vypne: žádné další automatické hledání, požadavky Modbus ani závislá diagnostika. Výchozí port je 502 a ID jednotky 1. Toto dialogové okno nastavuje pouze zdroj dat; neposkytuje žádné ovládání tepelného čerpadla.",
  /* hh.search */ "Hledat",
  /* hh.searching */ "Hledám…",
  /* hh.found */ (host) => `HomeHub nalezen: ${host}`,
  /* hh.not_found */ "Nebyl nalezen žádný HomeHub — zadejte adresu ručně.",
  /* hh.saved */ "Nastavení Modbus uloženo",
  /* hh.err_port */ "Port musí být mezi 1 a 65535",
  /* hh.err_unit */ "ID jednotky musí být mezi 1 a 247",
  /* board.title */ "Hardware desky",
  /* board.ledtype */ "Stavová LED",
  /* board.none */ "Žádná",
  /* board.reset_section */ "Tlačítko reset",
  /* board.env3_section */ "ENV III · Venkovní snímač",
  /* board.preset */ "Deska",
  /* board.preset_custom */ "Vlastní",
  /* board.not_selected */ "Nevybráno",
  /* board.led_gpio */ "Jednobarevná LED (GPIO)",
  /* board.led_ws2812 */ "Adresovatelná RGB (WS2812)",
  /* board.ledpin */ "Pin LED",
  /* board.btnpin */ "Pin tlačítka reset",
  /* board.ledlegend_rgb */ "Barvy LED a vzory blikání",
  /* board.ledlegend_gpio */ "Vzory blikání LED",
  /* board.led_rgb_off */ "Nesvítí — není aktivní žádný režim Wi-Fi.",
  /* board.led_rgb_setup */ "Modrá, pomalu bliká — konfigurační portál je aktivní.",
  /* board.led_rgb_connecting */ "Žlutá, rychle bliká — připojuje se k Wi-Fi.",
  /* board.led_rgb_healthy */ "Zelená, svítí — všechna nastavená připojení jsou připravena.",
  /* board.led_rgb_bus_down */ "Červená, dvojité bliknutí — X10A je odpojeno.",
  /* board.led_rgb_mqtt_down */ "Oranžová, bliká — X10A je připojeno, MQTT odpojeno.",
  /* board.led_rgb_wipe_armed */ "Červená, velmi rychle bliká — mazání připraveno; uvolněním je zrušíte.",
  /* board.led_rgb_wiping */ "Bílá, svítí — nastavení se maže; neodpojujte napájení.",
  /* board.led_gpio_off */ "Nesvítí — není aktivní žádný režim Wi-Fi.",
  /* board.led_gpio_setup */ "Pomalu bliká — konfigurační portál je aktivní.",
  /* board.led_gpio_connecting */ "Rychle bliká — připojuje se k Wi-Fi.",
  /* board.led_gpio_healthy */ "Svítí — všechna nastavená připojení jsou připravena.",
  /* board.led_gpio_bus_down */ "Dvojité bliknutí — X10A je odpojeno.",
  /* board.led_gpio_mqtt_down */ "Bliká střední rychlostí — X10A je připojeno, MQTT odpojeno.",
  /* board.led_gpio_wipe_armed */ "Velmi rychle bliká — mazání připraveno; uvolněním je zrušíte.",
  /* board.led_gpio_wiping */ "Po velmi rychlém blikání svítí — nastavení se maže; neodpojujte napájení.",
  /* board.ledinv */ "Aktivní v nízké úrovni (LED svítí, když je pin buzen na LOW)",
  /* board.btninv */ "Aktivní v nízké úrovni (tlačítko spojí pin s GND)",
  /* board.hint */ "Podržením tlačítka reset po dobu 5 sekund vymažete všechna nastavení a otevřete konfigurační portál. Pokud není připojeno žádné tlačítko, vyberte „Žádná“.",
  /* card.hardware */ "Vybavení",
  /* card.hw_off */ "Žádné",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite je kompaktní deska ESP32-S3 s integrovanou stavovou RGB LED WS2812.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 je kompaktní deska ESP32-S3 od Seeed Studio.",
  /* card.hw_board_other */ (name) => `Vybraná deska: ${name}.`,
  /* card.hw_active_low */ "aktivní v LOW",
  /* card.hw_active_high */ "aktivní v HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} na GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Nenastaveno.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Nenastaveno.",
  /* card.hw_env_detail */ (sda, scl) => `SDA na GPIO${sda}, SCL na GPIO${scl}.`,
  /* card.hw_env_disabled */ "Nenastaveno.",
  /* card.firmware */ "Verze",
  /* card.channel */ "Kanál aktualizací",
  /* card.firmware_help */ "Verze, která právě běží na ESP32. Klepnutím na hodnotu zkontrolujete ve vybraném kanálu aktualizací podepsaný obraz firmwaru.",
  /* card.channel_help */ "Kanál Vydání sleduje ručně publikované stabilní verze. Vývoj sleduje poslední sloučení, které ovlivňuje firmware. Změnou kanálu se tento zdroj okamžitě zkontroluje.",
  /* chan.release */ "Vydání",
  /* chan.dev */ "Vývoj",
  /* chan.saved */ (c) => `Kanál aktualizací: ${c}`,
  /* card.proto_title */ "Protokol",
  /* card.fw_title */ "Firmware",
  /* settings.diagnostics */ "Diagnostika soustavy",
  /* card.language */ "Jazyk",
  /* card.language_help */ "Prohlížeč použije jazykové preference prohlížeče. Výběrem jazyka uložíte pevný jazyk rozhraní pro celé zařízení.",
  /* card.diagnostics */ "Diagnostika soustavy",
  /* card.diagnostics_help */ "Zapne 24hodinovou kontrolu soustavy, diagnostiku topné křivky a další zdroje, například teplotu místnosti, předpověď počasí a výkon cirkulačního čerpadla.",
  /* diagnostics.off */ "Vypnuto",
  /* diagnostics.on */ "Zapnuto",
  /* diagnostics.saved_on */ "Diagnostika soustavy zapnuta — sběr začíná nyní",
  /* diagnostics.saved_off */ "Diagnostika soustavy vypnuta — sběr zastaven",
  /* probe.toggle */ "Diagnostika protokolu",
  /* probe.intro */ "Přímé čtení stránky registrů X10A s volitelným převodem hodnoty.",
  /* probe.request */ "Požadavek",
  /* probe.register */ "Registr",
  /* probe.manual */ "Ruční zadání",
  /* probe.page */ "Stránka registru",
  /* probe.offset */ "Posun v datech",
  /* probe.size */ "Šířka pole",
  /* probe.byte */ "bajt",
  /* probe.bytes */ "bajty",
  /* probe.converter */ "Převodník",
  /* probe.page_help */ "Hexadecimálně nebo desítkově · 0…255",
  /* probe.offset_help */ "Index v datech · 0…31",
  /* probe.size_help */ "Bajty k dekódování",
  /* probe.converter_auto */ "Automaticky",
  /* probe.converter_auto_help */ size=>`Vyzkouší všechny implementované převodníky pro pole o délce ${size} bajtů.`,
  /* probe.conv_raw_byte */ "nezpracovaný bajt · 0…255",
  /* probe.conv_unsigned_byte */ "bajt bez znaménka",
  /* probe.conv_tenth_byte */ "nezpracovaný bajt × 0,1",
  /* probe.conv_unsigned_half_byte */ "bajt bez znaménka × 0,5",
  /* probe.conv_signed_raw_le */ "celé číslo se znaménkem · little-endian",
  /* probe.conv_signed_raw_be */ "celé číslo se znaménkem · big-endian",
  /* probe.conv_signed_256_le */ "se znaménkem ÷ 256 · little-endian",
  /* probe.conv_signed_256_be */ "se znaménkem ÷ 256 · big-endian",
  /* probe.conv_signed_tenth_le */ "se znaménkem × 0,1 · little-endian",
  /* probe.conv_signed_tenth_be */ "se znaménkem × 0,1 · big-endian",
  /* probe.conv_signed_tenth_nodata_le */ "se znaménkem × 0,1 · little-endian · 0x8000 = bez dat",
  /* probe.conv_signed_tenth_nodata_be */ "se znaménkem × 0,1 · big-endian · 0x8000 = bez dat",
  /* probe.conv_signed_128_le */ "se znaménkem ÷ 256 × 2 · little-endian",
  /* probe.conv_signed_128_be */ "se znaménkem ÷ 256 × 2 · big-endian",
  /* probe.conv_signed_half_be */ "se znaménkem × 0,5 · big-endian",
  /* probe.conv_signed_hundredth_be */ "se znaménkem × 0,01 · big-endian",
  /* probe.conv_unsigned_raw_le */ "celé číslo bez znaménka · little-endian",
  /* probe.conv_unsigned_raw_be */ "celé číslo bez znaménka · big-endian",
  /* probe.conv_unsigned_half_be */ "bez znaménka × 0,5 · big-endian",
  /* probe.conv_saturation */ "tlak → teplota sytosti",
  /* probe.conv_raw_fan */ "nezpracovaný bajt / stupeň ventilátoru",
  /* probe.conv_capacity */ "kód výkonu vnitřní jednotky",
  /* probe.conv_eeprom_digit */ "nezpracovaná číslice EEPROM",
  /* probe.conv_eeprom_pair */ "dvojice nezpracovaných číslic EEPROM",
  /* probe.conv_bits_high */ "bity 4–6 · 3bitové počítadlo",
  /* probe.conv_bits_low */ "bity 0–2 · 3bitové počítadlo",
  /* probe.conv_operation_mode */ "provozní režim",
  /* probe.conv_error_class */ "třída chyby",
  /* probe.conv_error_code */ "chybový kód Daikin",
  /* probe.conv_indoor_mode */ "režim vnitřní jednotky · horní nibble",
  /* probe.conv_hybrid_mode */ "hybridní režim",
  /* probe.conv_bit */ bit=>`bit ${bit} · 0 nebo 1`,
  /* probe.conv_unknown */ "neznámý převodník",
  /* probe.send */ "Přečíst registr",
  /* probe.querying */ "Probíhá dotaz…",
  /* probe.action_note */ "Jeden požadavek na cyklus dotazování. Během OTA blokováno.",
  /* probe.catalog_loading */ "Načítání aktivního profilu…",
  /* probe.catalog_empty */ "Nejsou dostupné definice registrů.",
  /* probe.catalog_error */ "Registry profilu se nepodařilo načíst.",
  /* probe.catalog_profile */ profile=>`Profil: ${profile}`,
  /* probe.catalog_fallback */ (definition,profile)=>`main/def: ${definition} · profil: ${profile}`,
  /* probe.response */ "Odpověď",
  /* probe.frame */ "Rámec",
  /* probe.payload */ "Data",
  /* probe.slice */ "Vybrané bajty",
  /* probe.interpretation */ "Interpretace",
  /* probe.response_for */ reg=>`Odpověď registru ${reg}`,
  /* probe.payload_marked */ "Data · vybrané bajty označeny",
  /* probe.slice_note */ (offset,size,slice)=>`Posun ${offset} · ${size} bajtů · 0x${String(slice).replace(/\s+/g,"")}`,
  /* probe.full_frame */ "Úplný rámec",
  /* probe.decode_value */ "Výsledek převodníku",
  /* probe.no_decodes */ "Bez výsledku převodníku.",
  /* probe.refused */ "Hodnota odmítnuta",
  /* probe.unimplemented */ "Neimplementováno",
  /* probe.aliases */ "také",
  /* probe.invalid */ "Zkontrolujte stránku, posun, šířku pole a převodník.",
  /* probe.failed */ "Požadavek selhal.",
  /* probe.status_ok */ "Platná odpověď",
  /* probe.status_busy */ "Obsazeno",
  /* probe.status_no_link */ "Bez spojení X10A",
  /* probe.status_timeout */ "Čas vypršel",
  /* probe.status_no_reply */ "Bez odpovědi",
  /* probe.status_rejected */ "Odmítnuto",
  /* probe.status_bad_crc */ "Chybný kontrolní součet",
  /* probe.status_unexpected_reply */ "Neočekávaná odpověď",
  /* probe.status_invalid_length */ "Neplatná délka",
  /* probe.status_short_reply */ "Částečná odpověď",
  /* probe.status_out_of_bounds */ "Mimo data",
  /* probe.status_error */ "Chyba",
  /* probe.transport_ok */ "Rámec je úplný a platný.",
  /* probe.transport_busy */ "Probíhá jiný požadavek na registr.",
  /* probe.transport_no_link */ "Spojení X10A není dostupné.",
  /* probe.transport_timeout */ "Dotazovací úloha požadavek neprovedla včas.",
  /* probe.transport_no_reply */ "Nebyly přijaty žádné bajty odpovědi.",
  /* probe.transport_rejected */ "Jednotka tuto stránku registrů odmítla.",
  /* probe.transport_bad_crc */ "Odpověď přijata; kontrolní součet je neplatný.",
  /* probe.transport_unexpected_reply */ "Odpověď patří jiné stránce registrů.",
  /* probe.transport_invalid_length */ "Odpověď uvádí neplatnou délku rámce.",
  /* probe.transport_short_reply */ "Byla přijata jen část odpovědi.",
  /* probe.transport_out_of_bounds */ "Požadované bajty leží mimo tato data.",
  /* probe.transport_error */ "Požadavek selhal.",
  /* lang.auto */ "Prohlížeč",
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
  /* lang.saved */ "Jazyk uložen",
  /* ota.downgrade_confirm */ (cur, avail) => `Vrátit se k v${avail}?\n\nNainstalovaná verze v${cur} je novější. Toto starší sestavení se nabízí, protože jste vybrali jiný kanál aktualizací. Před instalací se ověří jeho podpis a pokud se starší verze nemůže připojit, zařízení automaticky obnoví aktuální sestavení.`,
  /* hist.cop_none */ "Graf COP chybí pro příkon z CT: zapojení určuje spotřebiče a teplo před BUH nezahrnuje BSH, takže hranice bilance nemusí souhlasit.",
]);
INSPECT_I18N.cs = inspectValues(
  ["Chybí aktuální hodnota:", "kompresor stojí a venkovní jednotka obnovuje své snímače jen za chodu. Hodnota z minulého běhu je skryta, aby nepůsobila jako aktuální měření."],
  [
    ["Provozní režim", 0, "Režim vnitřní jednotky; sám nepotvrzuje chod kompresoru ani průtok."], // status
    ["Venkovní podmínky", "Venkovní podmínky z ENV III", "Teplota, vlhkost a tlak ze snímače ENV III u ESP32."], // env3
    [(d) => sgInspectIsX10a(d) ? "Požadavek Smart Grid přes X10A" : "Požadavek Smart Grid přes Modbus", "Požadavek Smart Grid", (d) => sgInspectIsX10a(d)
      ? "Externí požadavek z fyzických kontaktů SG-Ready: volně, vynuceně vypnuto, doporučeno zapnout nebo vynuceně zapnuto. Je to povel energetického řízení, nikoli režim vytápění/chlazení ani důkaz ohřevu zásobníku; síťový povel se na kontaktech nemusí objevit."
      : "Externí požadavek přečtený z HomeHub: volně, vynuceně vypnuto, doporučeno zapnout nebo vynuceně zapnuto. Není to režim vytápění/chlazení ani důkaz ohřevu zásobníku.", (d) => !d || d.sgMode == null ? "Aktuální hodnota Smart Grid není dostupná."
      : d.sgMode === 2 && d.sgSrc === "X10A" ? "Kontakty SG-Ready hlásí doporučené zapnutí. Energetické řízení jej používá pro posílení; režim TUV, 3WV a průtok zvlášť ukazují skutečný ohřev zásobníku."
      : d.sgMode === 2 ? "HomeHub hlásí doporučené zapnutí. Energetické řízení jej používá pro posílení; režim TUV, 3WV a průtok zvlášť ukazují skutečný ohřev zásobníku."
      : d.sgMode === 1 ? "Externí energetické řízení hlásí „vynuceně vypnuto“."
      : d.sgMode === 3 ? "Externí energetické řízení hlásí „vynuceně zapnuto“."
      : "Externí požadavek Smart Grid není přítomen; zařízení pracuje samostatně."], // sgrequest
    ["Venkovní jednotka", 0, "Ventilátor vede vzduch přes výměník a kompresor zvyšuje tlak a teplotu chladiva. Schéma je zjednodušené; monoblok, zemní a hybridní systém mají jiné uspořádání.", (d) => d.defrost ? "Odmrazování — obrácený okruh rozpouští led a krátce odebírá teplo z vody."
      : compressorRunning(d) ? d.rps != null ? `Běží — kompresor ${fmt0(d.rps)} rps${d.quiet ? ", omezen tichým režimem" : ""}.` : "Běží — HomeHub potvrzuje kompresor; otáčky a podrobnosti vyžadují X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out") ? "Klid — aktivní přenos neprobíhá. X10A neobnovuje snímače; venkovní teplota je z Modbus bez času zdroje a teplota výtlaku zůstává „—“."
      : "Klid — kompresor stojí a aktivní vytápění ani chlazení neprobíhá. Neobnovované hodnoty se místo opakování zobrazí jako „—“."], // ou
    ["Kompresor", 0, "Stlačuje chladivo. Otáčky v rps potvrzují chod, ale nejsou tepelným výkonem."], // comp
    ["Venkovní teplota", 0, "Teplota u snímače venkovní jednotky; ovlivňuje ji slunce a umístění."], // out
    ["Teplota venkovního výměníku (R4T)", "Teplota venkovního výměníku R4T", "Při vytápění může výměník klesnout pod 0 °C. Teplota spolu se stavem odmrazování popisuje námrazu a její odstranění."], // ouhx
    ["Vysoký tlak", 0, "Tlak chladiva na vysokotlaké straně. Vyhodnocujte jej s režimem a teplotou výtlaku; nejde o tlak vody."], // hp
    ["Teplota výtlaku", 0, "Teplota horkého chladiva za kompresorem. Závisí na zatížení a režimu; při stání se stará hodnota skrývá."], // disch
    ["Nízký tlak", 0, "Tlak chladiva na nízkotlaké straně kompresoru. Ne každý profil tento snímač poskytuje."], // lp
    ["Expanzní ventil", 0, "Požadovaná poloha elektronického ventilu v impulzech; číslo není procento otevření."], // eev
    ["Teplota kapalného chladiva (R3T)", "Teplota kapalného chladiva R3T", "Teplota chladiva na kapalné straně vnitřního výměníku; nejde o teplotu vratné vody."], // r3t
    ["Deskový výměník tepla", 0, "PHE předává energii mezi chladivem a vodou bez smíchání. Výkon se odhaduje z průtoku a R1T/R4T; poloha snímačů závisí na modelu.", (d) => !compressorRunning(d, 5) ? "Aktivní přenos chladivem neprobíhá — kompresor stojí. Samotný oběh čerpadla může rozvádět zbytkové teplo, ale není topným ani chladicím výkonem."
      : d.dtStale ? "Přenos na straně vody nelze spočítat — čerpadlo a průtok nepotvrzují pohyb vody přes PHE."
      : d.pth == null ? "Chybí směrový odhad — hodnoty nepotvrzují užitečný přenos ve zvoleném režimu."
      : d.pthKind === "cooling" ? `Z vody se odebírá asi ${fmt1(d.pth)} kW (${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K).`
      : `Do vody se předává asi ${fmt1(d.pth)} kW (${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K).`], // phe
    ["Výstup vody z PHE před BUH (R1T)", "Výstup vody z PHE před BUH R1T", "Teplota vody opouštějící PHE před BUH. Při vytápění/TUV bývá nad R4T, při chlazení pod ní."], // lwt
    ["Výstupní voda za BUH (R2T)", "Výstupní voda za BUH R2T", "Teplota vody za BUH; na rozdíl od R1T může obsahovat elektricky přidané teplo."], // r2t
    ["Vstup vody do PHE (R4T)", "Vstup vody do PHE R4T", "Teplota vody vracející se do PHE. Vyhodnocujte ji s R1T, průtokem, kompresorem a režimem."], // rwt
    ["ΔT vody na PHE", "Rozdíl teplot vody na PHE", "R1T na výstupu minus R4T na vstupu. Počítá se ze dvou snímačů; s průtokem popisuje výměnu, ale neměří teploty u spotřebičů domu.", (d) => d.dtStale ? "Chybí pracovní ΔT — čerpadlo a průtok nepotvrzují pohyb vody. Rozdíl chladnoucích snímačů není pracovní bod."
      : d.dt == null ? null : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K při chodu samotného čerpadla — vyrovnávání zbytkového tepla, ne výkon.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. Při chlazení má být R1T pod R4T, proto je rozdíl záporný.`
      : `${fmt1(d.dt)} K${d.dtSet != null ? ` proti cíli ${fmt1(d.dtSet)} K` : ""}. Kladná hodnota znamená předávání tepla vodě.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Chladicí výkon (odhad)" : "Tepelný výkon (odhad)", "Odhadovaný tepelný výkon na PHE", (d) => d && d.pthKind === "cooling" ? "Odhad tepla odebraného vodě: průtok × (R4T−R1T) × 4,186 při předpokladu vody. Snímače a glykol omezují přesnost; hodnota se ukáže jen při potvrzeném chlazení." : "Odhad tepla předaného vodě: průtok × (R1T−R4T) × 4,186 při předpokladu vody. Snímače a glykol omezují přesnost; BUH za R1T není zahrnut.", (d) => d.dtStale ? d.bsh === true ? "Přenos na PHE nelze spočítat bez potvrzeného oběhu. Těleso může dál ohřívat zásobník, ale jeho teplo míjí snímače PHE a sběrnice neudává jeho výkon." : "Výkon nelze spočítat bez potvrzeného pohybu vody přes PHE. Jde o chybějící pracovní bod, ne nulový výkon."
      : d.pth == null ? null : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW chlazení${d.cop != null ? `, EER ${fmt1(d.cop)}` : ""}.` : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER tepelného čerpadla (odhad)" : d && d.copScope === "plant" ? "COP za BUH (odhad)" : "COP tepelného čerpadla (odhad)", "Odhadovaná účinnost", (d) => d && d.efficiencyKind === "eer" ? "Odhadovaný chladicí výkon dělený odhadovaným příkonem. Výsledek přebírá předpoklady o kapalině, snímačích, napětí a účiníku; je okamžitý, ne sezonní." : "Odhadovaný tepelný výkon dělený příkonem se stejnou bilanční hranicí. U CT může být teplo za BUH, u proudu měniče jen tepelné čerpadlo; zapojení CT určuje zahrnuté spotřebiče. Výsledek přebírá předpoklady o kapalině, snímačích, napětí a účiníku a je okamžitý, nikoli sezonní.", (d) => d.copBlock === "tank_heater" ? "COP není dostupný — těleso zásobníku je zapnuté. Jeho příkon může být v elektrické bilanci, ale teplo jde přímo do zásobníku a míjí vodní snímače."
      : d.copBlock === "buh_no_r2t" ? "COP není dostupný — BUH topí, ale profil nemá snímač za ním; elektrická a tepelná hranice si neodpovídají."
      : d.copBlock === "mb_scope" ? "COP není dostupný — HomeHub udává příkon celé jednotky včetně těles, ale tepelný výkon jen PHE. Bez stavu těles a snímače za nimi nelze hranice sladit."
      : d.copBlock === "no_pel" ? d.pelHeld ? "COP není dostupný — proud měniče je při stojícím kompresoru z minulého běhu." : "COP není dostupný — profil neudává CT ani proud měniče."
      : d.cop == null ? null : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW chlazení na 1 kW elektřiny — ≈ ${fmt1(d.copPth)} kW při ≈ ${fmt1(d.pel)} kW příkonu.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW tepla za BUH na 1 kW příkonu CT — ≈ ${fmt1(d.copPth)} kW při ≈ ${fmt1(d.pel)} kW. Rozsah určuje zapojení CT.`
      : `${fmt1(d.cop)} kW tepla na 1 kW elektřiny v hranici čerpadla — ≈ ${fmt1(d.copPth)} kW při ≈ ${fmt1(d.pel)} kW. BUH je mimo obě veličiny.`], // cop
    ["Záložní topné těleso (BUH)", "Záložní topné těleso BUH", "Elektrické těleso ve vodním okruhu pro mráz, odmrazování nebo nouzový provoz. Stupeň není samostatné měření kW.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Stupeň 2 — pracují oba stupně." : d.buh1 ? "Stupeň 1 — pracuje jeden stupeň." : "Vypnuto — žádný stupeň BUH není aktivní."], // buh
    ["Elektrické těleso zásobníku", 0, "Ponorné těleso BSH ohřívá zásobník bez kompresoru a oběhu vody. X10A udává jen stav, ne výkon.", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "Elektrické těleso zásobníku je aktivní." : "Vypnuto — zásobník těleso nepoužívá."; }], // bsh
    ["Trojcestný ventil", 0, "Volí cestu k zásobníku nebo domu. Jde o hlášený povel, ne mechanické potvrzení polohy ani průtoku.", (d) => d.valveDhw == null ? null : d.valveDhw ? "Zvolena cesta k zásobníku; samo hlášení nepotvrzuje průtok ani ohřev." : "Zvolena cesta do domu; samo hlášení nepotvrzuje oběh."], // valve
    ["Výstup dvoucestného ventilu", 0, "Binární výstup X10A; není mechanickým potvrzením polohy ani důkazem vytápění/chlazení.", (d) => d.valve2On == null ? null : d.valve2On ? "X10A hlásí 2WV ZAP; režim a provoz domu ověřte zvlášť." : "X10A hlásí 2WV VYP; samo to neznamená chlazení ani rozpor s vytápěním při klidu domu."], // valve2
    ["Zásobník TUV / akumulace", "Zásobník TUV nebo akumulace", "Zásobník popisují R5T, nastavení a cesta 3WV; teplota sama nepotvrzuje ohřev."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Chladicí okruh" : activeSpaceKind(d) === "heat" ? "Topný okruh" : "Okruh domu", "Okruh domu", "Radiátory, podlahové smyčky nebo fancoily. R1T/R4T jsou uvnitř čerpadla a nepotvrzují teplotu za venkovním potrubím.", (d) => d.valveDhw === true ? "Cesta do domu není zvolena; skutečný průtok k zásobníku ukazují čerpadlo a průtok."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `Zbytkově teplá voda proudí do domu. R1T ${degC(d.lwt)}; za spotřebiči není snímač. Nejde o aktivní chlazení.` : `Voda proudí do ${activeSpaceKind(d) === "cool" ? "chladicího" : activeSpaceKind(d) === "heat" ? "topného" : "domovního"} okruhu. R1T ${degC(d.lwt)}; za spotřebiči není snímač.` : "Čerpadlo a průtok nepotvrzují oběh domem."], // heat
    ["Provoz vytápění/chlazení domu", "Provoz vytápění nebo chlazení domu", "Stav běžného provozu domu. Není to požadavek termostatu a sám nepotvrzuje kompresor."], // spaceh
    ["Teplota místnosti", 0, "Teplota referenční zóny; porovnejte ji s nastavením a režimem."], // room
    ["Oběhové čerpadlo", "Otáčky oběhového čerpadla", "Pohání vodu společným okruhem a cestou zvolenou 3WV. Může běžet při stojícím kompresoru kvůli doběhu nebo ochraně; otáčky samy nepotvrzují průtok.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `Čerpadlo hlásí stání, ale snímač ${fmt1(d.flow)} l/min. Možný je vnější oběh, doběh nebo rozporný/starý signál; ověřte oba údaje.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Otáčky ${fmt0(d.pump)} %; průtok ${fmt1(d.flow)} l/min.` : `Otáčky ${fmt0(d.pump)} %, ale průtok chybí; oběh není potvrzen.`
      : waterMoving(d) ? `Průtok ${fmt1(d.flow)} l/min při chybějící použitelné hodnotě otáček.`
      : d.pumpOn === true ? d.flow != null ? `Čerpadlo ZAP, ale průtok jen ${fmt1(d.flow)} l/min; oběh není potvrzen.` : "Čerpadlo ZAP, ale průtok chybí; oběh není potvrzen."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Čerpadlo stojí; snímač ${fmt1(d.flow)} l/min. Hodnoty oběh nepotvrzují.` : "Čerpadlo stojí a průtok chybí."
      : `Spolehlivý stav čerpadla chybí; ${fmt1(d.flow)} l/min nepotvrzuje oběh.`], // pump
    [(d) => pelMeasured(d) ? "Elektrický příkon (HomeHub)" : "Elektrický příkon (odhad)", "Elektrický příkon", (d) => pelMeasured(d) ? "Příkon z registru HomeHub 51. Dokumentace nepotvrzuje kalibraci, bod měření ani zahrnutí všech těles; nejde o certifikovaný elektroměr soustavy." : "Odhad pro COP/EER: součet fází CT × předpokládaných 230 V. Napětí a účiník nejsou známy; proud měniče zahrnuje jen kompresor a rozsah CT určuje zapojení.", (d) => d.pelHeld ? "Kompresor stojí, takže proud měniče je z minulého běhu, ne aktuální; příkon ani účinnost nelze uvést."
      : d.pel == null ? "Profil nemá aktuální proud, proto nelze odvodit COP/EER."
      : d.pelSrc === "MB" ? "Hodnota z registru HomeHub 51; přesná hranice měření není zdokumentována."
      : d.pelSrc === "CT" ? "Odhad z CT; zahrnuté spotřebiče závisejí na zapojení." : "Z proudu měniče — pouze kompresor."], // pel
    ["Odmrazování", 0, "Obrácený cyklus rozpouští led na venkovním výměníku; vytápění se krátce přeruší.", (d) => d.defrost == null ? null : d.defrost ? "Odmrazování je aktivní." : "Vypnuto — odmrazování není aktivní."], // defrost
    ["Tichý režim", 0, "Omezuje hluk zpravidla omezením ventilátoru nebo kompresoru, a tím může snížit výkon.", (d) => d.quiet == null ? null : d.quiet ? "Tichý režim je aktivní." : "Vypnuto — tichý režim není aktivní."], // quiet
    ["Plynové potrubí", 0, "Potrubí split mezi jednotkami. Při vytápění vede horký plyn pod vysokým tlakem k PHE; při chlazení se směr obrátí. Monoblok je nemá.", (d) => compressorRunning(d) ? d.rps != null ? `Průtok — ${fmt1(d.circP)} bar při ${fmt0(d.disch)} °C.` : "Průtok — HomeHub potvrzuje kompresor; tlak a teplota vyžadují X10A." : "Aktivní oběh chladiva neprobíhá — kompresor stojí; vyrovnání tlaků závisí na okruhu a době stání."], // rhot
    ["Kapalinové potrubí", 0, "Potrubí kapalného chladiva mezi jednotkami split. Při vytápění se vrací k expanznímu ventilu venkovní jednotky; při chlazení se směr obrátí. Monoblok je nemá.", (d) => compressorRunning(d) ? d.rps != null ? `Průtok — expanzní ventil ${fmt0(d.eev)} impulzů.` : "Průtok — HomeHub potvrzuje kompresor; poloha ventilu vyžaduje X10A." : "Stojí — kompresor je vypnutý."], // rcold
    ["Výstupní potrubí PHE", 0, "Voda z R1T prochází BUH a čerpadlem; 3WV ji vede do domu nebo zásobníku. Při chlazení je studenou stranou; snímač za BUH může zahrnout elektrické teplo.", (d) => waterMoving(d) ? `R1T před BUH ${degC(d.lwt)} při ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; dále aktivní BUH" : ""}.` : "Čerpadlo a průtok nepotvrzují oběh v potrubí."], // wsup
    ["Okruh zásobníku", 0, "Hydraulická větev ohřevu TUV nebo akumulace. Výměník závisí na konstrukci; schéma ukazuje funkci, ne vnitřek modelu.", (d) => d.valveDhw === true ? waterMoving(d) ? `Zvolen zásobník, ${fmt1(d.flow)} l/min; PHE ${degC(d.lwt)}, zásobník ${degC(d.tank)}.` : "Zvolen zásobník, ale oběh nepotvrzuje aktivní ohřev." : "Cesta k zásobníku není zvolena; řízení hlásí dům."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Chladicí větev" : activeSpaceKind(d) === "heat" ? "Topná větev" : "Větev domu", "Větev domu", "Větev k radiátorům, podlahovce nebo fancoilům. R1T/R4T měří uvnitř čerpadla, ne tuto větev; ΔT zahrnuje i potrubí.", (d) => d.valveDhw === true ? "Větev domu není zvolena; řízení hlásí zásobník." : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `Oběh zbytkového tepla ${fmt1(d.flow)} l/min; bez aktivního chlazení. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.` : `Oběh do domu ${fmt1(d.flow)} l/min. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.` : "Oběh větví domu není potvrzen."], // wheat
    ["Vratné potrubí k PHE", 0, "Společný návrat do R4T po spojení zásobníku a domu. Při vytápění je obvykle chladnější než R1T, při chlazení teplejší; R4T není u spotřebičů.", (d) => waterMoving(d) ? `Návrat ${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` : "Oběh ve vratném potrubí není potvrzen."], // wret
    ["Průtok vody", 0, "Průtok společným okruhem; minimum závisí na modelu a režimu."], // flow
    ["Stav spínače průtoku", 0, "Binární stav X10A; neměří l/min ani nepotvrzuje minimum modelu.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A ZAP; porovnejte s čerpadlem a ${fmt1(d.flow)} l/min.` : `X10A VYP; při chodu čerpadla porovnejte ${fmt1(d.flow)} l/min a chybu 7H/C0.`], // flow_switch
    ["Tlak vody", 0, "Tlak v uzavřeném hydraulickém okruhu. Povolený rozsah závisí na modelu, výšce a expanzní nádobě; viz návod."], // wp
  ],
);

HOMEHUB_LABEL_I18N.cs = homeHubValues([
  "Nastavení výstupní vody vytápění hlavní zóny", // 1
  "Nastavení výstupní vody chlazení hlavní zóny", // 2
  "Režim vytápění/chlazení", // 3
  "Vytápění/chlazení domu povoleno", // 4
  "Nastavení vytápění hlavní zóny", // 6
  "Nastavení chlazení hlavní zóny", // 7
  "Tichý režim", // 9
  "Nastavení dohřevu TUV", // 10
  "Diagnostický stav jednotky", // 21
  "Kód chyby jednotky", // 22
  "Podkód chyby jednotky", // 23
  "Oběhové čerpadlo aktivní", // 30
  "Kompresor aktivní", // 31
  "Těleso zásobníku aktivní", // 32
  "Dezinfekce zásobníku aktivní", // 33
  "Poloha trojcestného ventilu", // 37
  "Aktuální režim vytápění/chlazení", // 38
  "Teplota výstupu PHE", // 40
  "Teplota výstupu za BUH", // 41
  "Teplota vratné vody", // 42
  "Teplota zásobníku TUV", // 43
  "Venkovní teplota", // 44
  "Teplota kapalného chladiva", // 45
  "Průtok vody", // 49
  "Pokojová teplota hlavní zóny", // 50
  "Elektrický příkon", // 51
  "Provoz TUV", // 52
  "Provoz vytápění/chlazení domu", // 53
  "Korekce výstupu hlavní topné zóny", // 54
  "Režim Smart Grid", // 56
  "Limit výkonu akumulace", // 57
  "Celkový limit výkonu", // 58
]);

DESCRIPTION_I18N.cs = descriptionValues([
  ["Cílová teplota zásobníku TUV nebo akumulační nádrže."], // 0
  ["Hodnota druhého teplotního čidla v zásobníku TUV, například dolního čidla nádrže."], // 1
  ["Teplota z čidla R5T. Podle konstrukce jde o TUV nebo vodu v akumulační nádrži."], // 2
  ["Režim Powerful ihned spustí ohřev zásobníku na komfortní cílovou teplotu."], // 3
  ["Předehřev X10A není přímý příznak dezinfekce HomeHub ani důkaz jejího běhu."], // 4
  ["Vstup HomeHub 33 hlásí dezinfekci; impuls mezi úplnými dotazy Modbus může uniknout."], // 5
  ["Venkovní termostatický bit je oddělen od vnitřního požadavku a nedokazuje kompresor."], // 6
  ["Bit venkovního omezení hluku; úroveň a spouštěč nejsou ověřeny."], // 7
  ["Bit solárního vstupu vodního okruhu; funkce a polarita nejsou ověřeny."], // 8
  ["Příznak fáze čekání po restartu nebo řízení rozběhu."], // 9
  ["Návrat oleje je vnitřní fáze chladivového okruhu, ne porucha sama o sobě."], // 10
  ["Vyrovnávání tlaku je řídicí fáze, ne měření ani potvrzení polohy ventilu."], // 11
  ["Proprietární příznak požadavku má veřejně neurčený význam."], // 12
  ["Povel/stav 4cestného ventilu pro obrácení okruhu."], // 13
  ["Povel/stav ohřevu klikové skříně. Neměří proud tělesa ani teplotu kompresoru."], // 14
  ["Proprietární výstupní bit nedokazuje pohyb ventilu ani aktivní polaritu."], // 15
  ["Podkód doplňuje hlavní chybu; hodnoty podle modelu nemají ověřený výklad."], // 16
  ["Příznak volitelného uzávěru podlahové smyčky."], // 17
  ["ZAP. znamená System off, ale nedokazuje vypnutí všech čerpadel, těles a ochran."], // 18
  ["Externí termostatický vstup je požadavek, ne pokojová teplota ani stav kompresoru."], // 19
  ["Bit požadavku pokojového termostatu hlavní zóny pro chlazení či vytápění."], // 20
  ["Čtyři syrové bity limitu zůstávají zvlášť; jejich kódování není ověřeno."], // 21
  ["Bit povelu/stavu ohřevu PHE. Katalog neurčuje, zda jde o povel či zpětnou vazbu."], // 22
  ["Dohřev vrací nádrž na nastavenou teplotu po poklesu pod spínací mez."], // 23
  ["Aktivní plánovaná předvolba nádrže: Storage comfort používá vyšší cíl, Storage eco nižší."], // 24
  ["V hybridu regulátor žádá kotel o TUV."], // 25
  ["Přepínací ventil vede vodu do zásobníku TUV nebo domu."], // 26
  ["Výstup 2WV zůstává ZAP./VYP.; VYP. nedokazuje chlazení ani polohu ventilu."], // 27
  ["Otevření směšovacího ventilu druhé zóny."], // 28
  ["Cílová výstupní teplota pro zvolený režim vytápění či chlazení."], // 29
  ["Smíšená výstupní teplota za ventilem druhé topné zóny, obvykle chladnější."], // 30
  ["R2T měří vodu za BUH; umístění závisí na hydraulice, ne na otopných tělesech."], // 31
  ["R1T měří vodu z PHE před BUH; režim, R4T a průtok určují význam i odhad výkonu."], // 32
  ["R4T je společná vratka do PHE; R1T−R4T je ΔT PHE, ne přímo otopných těles."], // 33
  ["Rychlost oběhu vody ve společném okruhu vytápění/chlazení a TUV."], // 34
  ["Tlak vody; rozsah závisí na modelu, při ≤1,0 bar použijte přesný návod."], // 35
  ["Povel rychlosti oběhového čerpadla s obrácenou stupnicí: 0 = plná rychlost, 100 = stojí."], // 36
  ["Běh oběhového čerpadla nedokazuje přenos tepla; potvrďte jej průtokem."], // 37
  ["Stav čerpadla nakonfigurovaného solárního termického okruhu."], // 38
  ["Hlášená rychlost čerpadla pojmenovaného profilem."], // 39
  ["Flow switch X10A hlásí jen pohyb; neměří průtok ani splnění minima modelu."], // 40
  ["Aktuální režim vodní strany: zastaveno, vytápění, chlazení, TUV nebo kombinace."], // 41
  ["Smart Grid hlásí čtyřstavový energetický povel, ne režim vytápění/chlazení."], // 42
  ["Živý režim domu je vytápění/chlazení bez automatiky a sám nedokazuje běh kompresoru."], // 43
  ["Nastavená volba HomeHub Auto/vytápění/chlazení z registru 3."], // 44
  ["Stav venkovní jednotky: zastaveno, vytápění nebo chlazení; sám nedokazuje přenos tepla."], // 45
  ["Odmrazování je v chladu a vlhku normální; samotný bit bez vlhkosti neurčuje četnost."], // 46
  ["Třída aktivní poruchy: normální stav, chyba, varování nebo upozornění."], // 47
  ["Význam právě hlášeného kódu poruchy."], // 48
  ["Nouzový provoz po poruše tepelného čerpadla."], // 49
  ["Poplachové relé jednotky, sepnuté při poruše pro připojený externí alarm nebo dohled."], // 50
  ["Cílová pokojová teplota hlavní zóny při vytápění či chlazení."], // 51
  ["„Thermo ON“ je vnitřní požadavek, ne určení zátěže ani důkaz běhu kompresoru."], // 52
  ["Stav výstupní svorky „Space H Operation“."], // 53
  ["Běžný provoz domu není jen vytápění ani termostat; skutečnost ukazuje I/U a pohony."], // 54
  ["Nastavená cílová pokojová teplota zóny řízené vlastním pokojovým čidlem jednotky."], // 55
  ["Pokojová teplota měřená vestavěným nebo kabelovým čidlem jednotky."], // 56
  ["Ochrana výtlaku: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 57
  ["Ochrana proudu invertoru: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 58
  ["Ochrana vysokého tlaku: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 59
  ["Ochrana nízkého tlaku: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 60
  ["Ochrana teploty chladiče invertoru: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 61
  ["Vnitřní souhrnný příznak omezení mimo pět pojmenovaných ochran."], // 62
  ["Teplota vody na vstupu či výstupu PHE mezi chladivem a vodním okruhem."], // 63
  ["Teplota venkovního výměníku; pod 0 °C bez vlhkosti sama nedokazuje námrazu."], // 64
  ["Venkovní teplota měřená u jednotky pro ekvitermní řízení a provozní rozhodnutí."], // 65
  ["Teplota horkého stlačeného chladiva za kompresorem."], // 66
  ["Teplota chladného nízkotlakého chladiva vracejícího se do kompresoru."], // 67
  ["Teplota chladiva v kapalinovém potrubí mezi výměníky."], // 68
  ["Teplota chladiva u vstupu či výstupu výparníku, který odebírá teplo."], // 69
  ["Teplota vstřikovacího potrubí chladiva pro řízení vstřiku a ochranu okruhu."], // 70
  ["Teplota dvoufázové směsi chladiva; vnitřní regulační vstup, ne uživatelský cíl."], // 71
  ["Teplota čidla odmrazování venkovního výměníku, jeden z podkladů pro ochranu a odmrazení."], // 72
  ["Sytostní teplota vypočtená z tlaku pro nastavené chladivo; není z čidla ani tlakem v bar."], // 73
  ["Tlak chladiva na vysokotlaké nebo nízkotlaké straně; nejde o jejich rozdíl."], // 74
  ["Otáčky invertorového kompresoru za sekundu, hlavní regulační veličina výkonu."], // 75
  ["Povel elektronického expanzního ventilu v krocích/pulsech."], // 76
  ["Teplota výkonové elektroniky motoru venkovního ventilátoru."], // 77
  ["Rychlost venkovního ventilátoru jako stupeň nebo ot/min."], // 78
  ["Vnitřní cílová vypařovací/kondenzační teplota, nikoli uživatelské nastavení."], // 79
  ["Vnitřní cíl teploty výtlaku/portu kompresoru pro ochrannou logiku."], // 80
  ["Cílové ΔT závisí na modelu a režimu; může být 8 či 10 K, obecné pravidlo 5 K neplatí."], // 81
  ["Chladivo jednotky, např. R32/R410A, určující tlakově-teplotní křivku sytosti."], // 82
  ["Teplota u portu kompresoru pro vnitřní ochranný dohled."], // 83
  ["Tlak v chladivovém okruhu hlášený venkovní jednotkou."], // 84
  ["Jen úplná sada CT × 230 V dává nekalibrovaný odhad; zapojení, napětí a účiník výsledek omezují."], // 85
  ["Proud invertoru kompresoru jako přibližná míra jeho zatížení."], // 86
  ["Teplota chladiče invertoru/výkonové elektroniky venkovní jednotky."], // 87
  ["Aktivní stupně elektrického BUH jako výkonový stupeň."], // 88
  ["Stupeň odporového BUH přidávající teplo přímo do vody."], // 89
  ["HomeHub 32: stav BSH, ne výkon; registr 51 je zvláštní příkon „tepelného čerpadla“, ne výkon BSH, a jeho rozsah není potvrzen."], // 90
  ["BSH může topit bez kompresoru a čerpadla; X10A hlásí jen ZAP./VYP., ne výkon."], // 91
  ["Stav tepelného ochranného řetězce elektrického tělesa."], // 92
  ["Ochrana potrubí závisí na modelu a napájení; při výpadku ji nelze zaručit."], // 93
  ["Příznak mrazu X10A není veřejně přiřazen jednoznačně ochraně místnosti či potrubí."], // 94
  ["Hodnota zemního solankového okruhu geotermální jednotky nebo jeho čerpadla."], // 95
  ["Zvolený zdroj hybridu: tepelné čerpadlo, kombinace nebo kotel."], // 96
  ["Cílová výstupní teplota hybridního vytápění, nikoli měřená voda."], // 97
  ["Zda je bivalentní provoz druhého zdroje aktivní či povolený."], // 98
  ["Aktuální požadavek regulátoru na kotel v bivalentním/hybridním systému."], // 99
  ["Cílová teplota vody požadovaná pro kotel, ne měřená teplota."], // 100
  ["BE_COP porovnává hybridní zdroje; není měřený COP a škála X10A není popsána."], // 101
  ["Externí tarif, Smart Grid či solar může omezit nebo žádat teplo; akci určuje nastavení."], // 102
  ["Jmenovitý výkon/velikostní třída vnitřní či venkovní jednotky."], // 103
  ["Tichý režim snižuje hluk venkovní jednotky a může snížit dostupný výkon."], // 104
  ["Aktuální diagnostický stav HomeHub: bez chyby, porucha nebo varování."], // 105
  ["Význam právě hlášeného kódu poruchy."], // 106
  ["Číselný podkód upřesňující sousední diagnostický kód Daikin."], // 107
  ["HomeHub hlásí jen běh kompresoru, ne otáčky ani výkon; význam určuje okruh a průtok."], // 108
  ["Provoz TUV: v provozu = ZAP., klid/bufrování = VYP.; příznak neuvádí důvod."], // 109
  ["Provoz domu: v provozu = ZAP., klid/bufrování = VYP.; režim určí vytápění/chlazení."], // 110
  ["Teplota vody z PHE před BUH."], // 111
  ["Výstupní teplota vody za BUH."], // 112
  ["Teplota vody v zásobníku TUV."], // 113
  ["Teplota chladiva v kapalinovém potrubí mezi venkovní jednotkou a vnitřním výměníkem."], // 114
  ["Pokojová teplota hlavní zóny z dálkového ovladače."], // 115
  ["Elektrický příkon systému hlášený HomeHub; X10A poskytuje jen odhad z fázových proudů."], // 116
  ["Cílová výstupní teplota hlavní topné zóny čtená z HomeHub; firmware ji nemění."], // 117
  ["Cílová výstupní teplota hlavní chladicí zóny čtená z HomeHub; firmware ji nemění."], // 118
  ["Zda je prostorový okruh vůbec POVOLEN — přepínač, ne aktuální aktivita."], // 119
  ["Tichý provoz snižuje hluk a může snížit dostupný výkon."], // 120
  ["Cíl dohřevu TUV není spínací teplota; start závisí i na hysterezi a plánu."], // 121
  ["Čtená korekce cíle vytápění −10…+10 K; nenulová hodnota nedokazuje aktivní provoz."], // 122
  ["Limit Smart Grid „doporučené zapnutí“; platí nižší z něj a obecného limitu, nejde o aktuální příkon."], // 123
  ["Obecný limit HomeHub i při volném provozu; je to nastavený strop, ne měřený příkon."], // 124
]);

MODEL_DESCRIPTION_I18N.cs = modelDescriptionValues([
  ["Hlášení chyby či varování samotné jednotky. Aktivní chyba dává VAROVÁNÍ; varování nebo zpráva vzniklá a zaniklá do 24 h dává POZNÁMKU. Není to odhad projektu. Bez aktuální či zapamatované zprávy po načtení všech polí. Zaniklá zpráva může zůstat 24 h; aktivní kód je v Provozu."], // 0
  ["Měří chladnutí zásobníku v klidných hodinách; vyřazuje nabíjení, odběr a vnitřní ohřev, volitelný elektroměr ukáže cirkulační čerpadlo. POZNÁMKA od 0,8 K/h je heuristika referenční instalace. Objem a rozdíl k místnosti mění rychlost. Rozpoznatelné je asi do 1,85 K/h; rychlejší ztráta může vypadnout jako odběr. OK nedokazuje izolaci ani ventily."], // 1
  ["Počítá starty kompresoru a délku úplných běhů, pokud lze zvlášť pro vytápění, TUV a chlazení; nejasné běhy zůstávají nezařazené. Potvrzené topné běhy mají průměr ≥10 min; při nejméně 12 kratších je POZNÁMKA. TUV/chlazení se vyřadí, při mnoha nejasných se hodnotí vše. Není to limit Daikin."], // 2
  ["Počítá odmrazení a jejich podíl na sledovaném čase kompresoru; v chladu a vlhku jsou normální. Do 15 %. Nad mezí při ≥3 odmrazeních jen POZNÁMKA. Není to limit Daikin; chybí vlhkost a povrchová teplota."], // 3
  ["Nejnižší platný tlak vody v topném okruhu během klouzavého okna. Nad 1,0 bar. Při ≤1,0 bar ihned POZNÁMKA, po 60 s VAROVÁNÍ. Rozsah závisí na modelu; použijte přesný návod."], // 4
  ["Nejnižší průtok po 60 s souvislého běhu vnitřního čerpadla; vyřazuje rozběh, klid a výpadky. JEN MĚŘENÍ: minimum při částečné zátěži, ne jmenovitý ani návrhový průtok. Obecná mez není; návod platí jen pro stejný model, režim a podmínky. Jeden nízký údaj bez poruchy málo dokazuje."], // 5
  ["Odděleně ukazuje dobu běhu BUH pro dům a BSH v zásobníku. JEN MĚŘENÍ. Mráz, nouze, odmrazování, plán TUV či přebytky mohou běh vysvětlit. Obecná mez OK/VAROVÁNÍ není."], // 6
  ["Experimentálně sleduje pět ochranných čítačů. Počítá jen jasný růst mezi srovnatelnými čteními; základ, stálost, pokles, mezera a reset ne. Bez pozorovaného růstu. Růst dává POZNÁMKU, ne diagnózu; bez růstu nelze kvůli neúplné dokumentaci vyloučit omezení."], // 7
  ["Paměť RAM právě nevyužitá firmwarem. Krátké změny WiFi, MQTT a webu jsou normální; důležitější je trend 24 h. Má být přibližně stabilní s vratnými propady. Trvalý pokles může znamenat neuvolněné alokace. Restart s napájením drží trend v RAM; běžný restart, update či výpadek obnoví hotové 5min bloky z flash. Chybět může otevřený."], // 8
  ["Největší souvislý blok volné RAM. TLS a OTA potřebují jeden velký blok i při vyšším celkovém volnu. Je nejvýše roven volné RAM. Klesá-li při stabilní volné RAM, roste fragmentace haldy a velká alokace může selhat před vyčerpáním paměti."], // 9
  ["Jmenovitý výkon venkovní jednotky z její identifikace; třída hardwaru, ne aktuální výroba."], // 10
  ["Jmenovitý výkon VNITŘNÍ jednotky, zobrazený protože identifikace venkovní vlastní výkon nemá. Vnitřní a venkovní jednotka mohou mít různé třídy; nejde o výkon venkovní ani celého systému."], // 11
  ["Stejná třída a registry: volba zástupce nemění dekódované hodnoty."], // 12
  ["Několik rodin Daikin má stejné servisní registry, takže obchodní název nelze rozlišit; nadpis zůstane „Daikin Altherma“. Venkovní jednotka výkon nehlásí, kandidáti tedy mohou mít různé třídy. Firmware volí variantu nejbližší vnitřní jednotce, ne však s plnou jistotou. Ověřte štítkem."], // 13
  ["Syrové ID bajty venkovní jednotky bez veřejné tabulky názvů; při nejasnosti je znak po znaku porovnejte se štítkem."], // 14
]);
