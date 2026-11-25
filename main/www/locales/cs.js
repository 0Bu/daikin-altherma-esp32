// translation-source: 2184623468cb624eb00615b57fd546691e441326cd7410c1088c6d7a0bba225c
const csAria = (x) => (l, d) => `${l} — časová osa ${x}. ${d}. Jednotlivé vzorky lze přečíst klávesami se šipkami.`;
const csMb = (a, p = "u registru") => (r) => `${a}${r ? ` ${p} ${r}` : ""}.`;
I18N.cs = localeValues([
  /* sys.nodata */ "Žádná data",
  /* sys.unreachable */ "Nedostupné",
  /* sys.mb_only */ "X10A není v síti — hodnoty z Modbusu",
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
  /* sys.disinfecting */ "Dezinfekce zásobníku aktivní",
  /* sys.online */ "V síti",
  /* sys.fault */ "Porucha",
  /* sys.warning */ "Varování",
  /* sys.fault_line */ (c) => "Porucha · " + c + " — zkontrolujte kód poruchy Daikin.",
  /* sys.warning_line */ (c) => "Varování · " + c + " — zkontrolujte tepelné čerpadlo.",
  /* sys.polled */ (s) => `Naposledy načteno před ${s} s`,
  /* config.unreadable_title */ "Nečitelné nastavení služeb",
  /* config.unreadable_meta */ "Tato verze nedokázala přečíst uložené nastavení služeb. Používá náhradní nastavení a zachovanou kopii nenahradila. Novější kompatibilní firmware ji možná obnoví. Úspěšné uložení nastavení služeb ji nahradí; uložení pouze pinů X10A nebo protokolu ne.",
  /* recovery.title */ "Režim obnovení",
  /* recovery.meta_heap */ "Zařízení opakovaně vyčerpalo paměť a samo se restartovalo. Nyní běží s vypnutým připojením k tepelnému čerpadlu a MQTT, aby zůstalo dostupné webové rozhraní. Konfigurace je s největší pravděpodobností v pořádku — v Nastavení nainstalujte novější verzi firmwaru. Vypnutí a zapnutí napájení zkusí znovu spustit celý systém.",
  /* recovery.meta */ "Zařízení se opakovaně restartovalo a přešlo do režimu obnovení. Komunikace s tepelným čerpadlem a MQTT je pozastavena. Zkontrolujte konfiguraci — zejména piny RX/TX na kartě Protokol v Nastavení — a poté zařízení restartujte.",
  /* rollback.title */ "Změna WiFi selhala — obnoveno původní nastavení",
  /* rollback.meta */ (back) => `Zařízení se s novým nastavením WiFi nemohlo připojit. Obnovilo předchozí síť${back} a restartovalo se. V Nastavení → Připojení zkontrolujte název sítě a heslo a zkuste to znovu.`,
  /* crash.title_fault */ "Zařízení se restartovalo po chybě",
  /* crash.title_orphan */ "Čeká zde hlášení o pádu z dřívějšího restartu",
  /* crash.reset */ "Reset",
  /* crash.task */ "úloha",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "poškozeno",
  /* crash.stored_dump */ "Uložené hlášení o pádu",
  /* crash.stored_hint */ "Stáří hlášení a jeho souvislost s tímto restartem nejsou známy.",
  /* crash.backtrace */ "Zásobník volání",
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
  /* nav.cards */ "Karty přehledu",
  /* nav.diagnosis */ "Diagnostika",
  /* nav.outdoor */ "Venkovní jednotka",
  /* nav.settings_alert */ (n) => `Nastavení — ${n} ${n === 1 ? "připojení je nedostupné" : n >= 2 && n <= 4 ? "připojení jsou nedostupná" : "připojení je nedostupných"}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Oba zdroje se shodují",
  /* src.delta */ (d, u) => `Rozdíl ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Oba zdroje se v tomto stavu neshodují",
  /* conn.homehub */ "HomeHub",
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
  /* modbus.err.request_failed */ csMb("Požadavek Modbus se nepodařilo sestavit", "pro registr"),
  /* modbus.err.send_timeout */ csMb("Při odesílání požadavku Modbus vypršel časový limit"),
  /* modbus.err.send_failed */ csMb("Požadavek Modbus se nepodařilo odeslat"),
  /* modbus.err.response_timeout */ csMb("Při čekání na odpověď HomeHubu vypršel časový limit"),
  /* modbus.err.connection_closed */ csMb("HomeHub ukončil připojení"),
  /* modbus.err.receive_failed */ csMb("Odpověď HomeHubu se nepodařilo přečíst"),
  /* modbus.err.invalid_response */ csMb("Neplatná odpověď Modbus"),
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
  /* service.title */ "Chladivo při vytápění",
  /* service.state.waiting */ "ČEKÁ",
  /* service.state.observing */ "ZÁZNAM",
  /* service.state.limited */ "ČÁSTEČNĚ",
  /* service.state.interrupted */ "PAUZA",
  /* service.reason.unsupported_profile */ "Tento model neposkytuje všechny potřebné hodnoty.",
  /* service.reason.compressor_not_running */ "Kompresor neběží.",
  /* service.reason.unsupported_or_unknown_mode */ "Běžné vytápění prostoru není potvrzeno.",
  /* service.reason.dhw_path */ "Tepelné čerpadlo ohřívá teplou vodu.",
  /* service.reason.defrost */ "Venkovní jednotka se odmrazuje.",
  /* service.reason.unit_fault */ "Tepelné čerpadlo hlásí poruchu nebo varování.",
  /* service.reason.special_controller_phase */ "Je aktivní krátká fáze spuštění nebo zvláštní regulace.",
  /* service.reason.missing_fresh_signal */ "Chybí alespoň jedna potřebná aktuální hodnota.",
  /* service.reason.poll_gap */ "Připojení X10A bylo přerušeno nebo záměrně pozastaveno.",
  /* service.window */ (d, n) => `${d} · ${n} aktuálních měření`,
  /* service.help.observing */ "Záznam tohoto běhu vytápění.",
  /* service.help.limited */ "Záznam běží; chybějící kontext je uveden výše.",
  /* service.help.interrupted */ "Začne znovu při dalším vhodném běhu vytápění.",
  /* service.common */ "Jeden běh vytápění, oddělený od kontrol 24 h. Bez hodnocení náplně chladiva nebo běžných rozmezí. Ventil: povel, ne měřená poloha.",
  /* check.fault */ "Porucha jednotky",
  /* check.dhw_loss */ "Chladnutí zásobníku",
  /* check.cycling */ "Starty kompresoru",
  /* check.defrost */ "Cykly odmrazování",
  /* check.pressure */ "Tlak vody",
  /* check.flow */ "Min. průtok",
  /* check.flow.lowest */ "Nejnižší průtok při vytápění",
  /* check.flow.runup */ "Měření se započítávají po nejméně deseti minutách nepřetržitého vytápění místností.",
  /* check.flow.assessment */ "V instalační příručce najdete minimální průtok pro svůj model a provozní režim. Příliš malý průtok může vyvolat chybu 7H.",
  /* check.flow.explain */ "Průtok udává, kolik litrů vody projde tepelným čerpadlem za minutu.",
  /* check.flow.live */ "Nyní",
  /* check.flow.show */ "Zobrazit nejnižší hodnotu v grafu",
  /* check.flow.readout */ (value) => `V tomto úseku byla alespoň jednou naměřena hodnota ${value}. Vytápění místností už běželo nejméně deset minut.`,
  /* check.flow.locations_missing */ "Čas starších měření této hodnoty nebyl uložen.",
  /* check.flow.unavailable */ "Pro určení nejnižšího průtoku při vytápění chybí potřebné údaje.",
  /* check.flow.waiting */ "Čeká se na úsek vytápění vhodný k vyhodnocení.",
  /* check.heater */ "Topná tělesa",
  /* check.retries */ "Ochranné čítače",
  /* check.status.ok */ "V POŘÁDKU",
  /* check.status.info */ "POZNÁMKA",
  /* check.status.warn */ "VAROVÁNÍ",
  /* check.status.collecting */ "KONTROLA",
  /* check.status.observation */ "MĚŘENÍ",
  /* check.status.experimental */ "ZKUŠEBNĚ",
  /* check.status.unavailable */ "N/A",
  /* check.status.no_window */ "BEZ OKNA",
  /* check.dhw.maximum */ "Největší hodinový pokles teploty u čidla zásobníku",
  /* check.dhw.hour_unit */ "°C za hodinu",
  /* check.dhw.timeline */ "Průběh za 24 hodin",
  /* check.dhw.context_title */ "Příčina není jasná",
  /* check.dhw.context_hour */ "Hodina měření se stejnou hodnotou",
  /* check.dhw.context_missing */ "Čas a okolnosti tohoto měření nejsou k dispozici.",
  /* check.dhw.context_pump */ "V této hodině běželo vnitřní vodní čerpadlo tepelného čerpadla.",
  /* check.dhw.context_draw */ "Rychlý pokles teploty může souviset s odběrem teplé vody nebo s rychlým ochlazováním.",
  /* check.dhw.context_quiet */ "Nebyl zaznamenán chod čerpadla ani pokles typický pro odběr. Odběr teplé vody je přesto možný.",
  /* check.dhw.context_selected */ "Příčina tohoto poklesu zůstává nejasná.",
  /* check.dhw.hint */ "Hodina bez zaznamenané značky čerpadla nebo odběru dosáhla orientačního prahu projektu.",
  /* check.dhw.before_snapshot */ (d) => `${d} před snímkem`,
  /* check.dhw.marker_yes */ "zaznamenáno",
  /* check.dhw.marker_no */ "nezaznamenáno",
  /* check.dhw.pump */ "Vnitřní čerpadlo",
  /* check.dhw.draw */ "Pokles podobný odběru",
  /* check.dhw.previous */ "Předchozí dokončené okno",
  /* check.dhw.next */ "Následující dokončené okno",
  /* check.dhw.timeline_unavailable */ "Okna s časovými údaji nejsou dostupná. Ze součtů se historie neodvozuje.",
  /* check.dhw.timeline_empty */ "V tomto 24hodinovém přehledu nejsou dostupná dokončená okna s časovými údaji.",
  /* check.dhw.chart_title */ "Ochlazení v dokončeném okně",
  /* check.dhw.timed_scope */ (n) => `Naměřené hodiny v grafu: ${n} (posledních 24 h). Maximum i počty mohou vycházet také z uložených hodinových údajů, nejen z vykreslených oken.`,
  /* check.dhw.blank */ "Šrafované úseky: není dostupné dokončené okno s časovými údaji, nikoli nulové ochlazení. Značky ukazují výskyt, ne dobu trvání.",
  /* check.dhw.snapshot */ "Snímek",
  /* check.dhw.stale */ "Aktuální údaje o chladnutí zásobníku chybí nebo jsou zastaralé; dokončená okna zůstávají historickými pozorováními.",
  /* check.dhw.limit */ "R5T měří jeden bod ve vrstveném zásobníku, nikoli jeho energii. Značky čerpadla a odběru neprokazují příčinu ani odběr vody.",
  /* check.dhw.basis */ "Podrobnosti dat",
  /* check.dhw.energy */ "Příklad výpočtu · nejde o měření energie",
  /* check.detail.dhw_energy */ (a, b, c, d) => `Příklad jedné hodiny: 200 l rovnoměrně chladnoucí vody při ${a} K/h → ${b} kWh tepla; doplnění ${c}–${d} kWh elektřiny při předpokládaném COP 2,5–3 (teplo ÷ elektřina). Nejde o měření energie.`,
  /* check.detail.dhw_context */ (a, b, c) => `Okna: vnitřní čerpadlo ${a}; pokles podobný odběru ${b}; bez značek ≥0,8 K/h ${c}. Mohou se překrývat.`,
  /* check.detail.value_label */ "Hodnota:",
  /* check.detail.assessment_label */ "Vyhodnocení:",
  /* check.detail.ok */ "Pravidlo se v čitelných datech neaktivovalo.",
  /* check.detail.info */ "Pozorované upozornění; mez je popsána níže.",
  /* check.detail.warn */ "Porucha jednotky nebo pozorovaný trvale nízký tlak.",
  /* check.detail.fault.error */ "Jednotka právě hlásí chybu. Přesný kód je na kartě „Provoz“.",
  /* check.detail.fault.warning */ "Jednotka právě hlásí varování nebo upozornění, nikoli chybu. Přesný kód je na kartě „Provoz“.",
  /* check.detail.fault.past */ "Nyní není hlášení aktivní; v tomto období bylo zaznamenáno. Zmizení neprokazuje příčinu ani odstranění problému.",
  /* check.detail.fault.past_unknown */ "Bylo zaznamenáno hlášení; aktuální stav poruchy nelze přečíst.",
  /* check.detail.collecting */ (a, b) => `Čitelné signály: ${a} z požadovaných ${b}.`,
  /* check.detail.outdoor_defrost */ " Venkovní hodnoty X10A obsahují jen čerstvé vzorky, kdy byly čitelné stav odmrazování i stav kompresoru a kompresor běžel. Slouží jako kontext a nemění práh ani výsledek hodnocení odmrazování.",
  /* check.detail.dhw_candidate */ (a, b, c, d) => `Přijatá hodinová okna: ${a}; aktuální kandidát: ${c} z ${d}.`,
  /* check.detail.dhw_settling */ (a, b, c) => `Přijatá hodinová okna: ${a}; zjištěn ohřev nebo topná tyč zásobníku. Zbývá ustálení: ${c}.`,
  /* check.detail.dhw_waiting */ (a, b) => `Přijatá hodinová okna: ${a}; čekání na další vhodnou hodinu.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "kandidátní okno bylo vyřazeno" : n >= 2 && n <= 4 ? "kandidátní okna byla vyřazena" : "kandidátních oken bylo vyřazeno"} (${reasons}); nejdelší dosáhlo ${best} z 60 min.`,
  /* check.detail.dhw_blocked */ (a, b, c) => "Žádné dokončené hodinové okno za 24 h." + (a > 0 ? ` Vyřazená okna: ${a} (${b}); nejdelší ${c}.` : ""),
  /* check.detail.dhw_blocked_link */ (a, b) => `Žádné vhodné hodinové okno za 24 h: Přerušená okna: ${a}, pro dlouho nečtené nutné hodnoty; nejdelší ${b} z 60 min. Chybějící odpovědi či pauzy dotazování vytvářejí mezery. Nic to neprokazuje o zásobníku.`,
  /* check.detail.dhw_reason.charge */ "nabíjení zásobníku",
  /* check.detail.dhw_reason.pump */ "vnitřní čerpadlo",
  /* check.detail.dhw_reason.draw */ "pokles podobný odběru",
  /* check.detail.dhw_reason.reading */ "R5T nepotvrzené",
  /* check.detail.dhw_reason.blind */ "chybí údaje: X10A neodpovídá nebo je dotazování pozastaveno",
  /* check.detail.collecting_unknown */ "Žádné aktuální hodnocení.",
  /* check.detail.observation */ "Jen pozorování; bez obecné meze OK/VAROVÁNÍ.",
  /* check.detail.experimental */ "Experimentální čítače; stabilita nevylučuje omezení.",
  /* check.detail.unavailable */ "Žádný hodnotitelný signál v tomto profilu.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "start" : n >= 2 && n <= 4 ? "starty" : "startů"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "cyklus" : n >= 2 && n <= 4 ? "cykly" : "cyklů"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "spárovaný" : n >= 2 && n <= 4 ? "spárované" : "spárovaných"}`,
  /* check.cycling.runs */ (n) => `${n} ${n === 1 ? "cyklus" : n >= 2 && n <= 4 ? "cykly" : "cyklů"}`,
  /* check.cycling.mean */ (d) => `Průměr ${d}`,
  /* check.cycling.completed */ "Dokončené cykly",
  /* check.cycling.unclear */ "Nejasný účel",
  /* check.cycling.unclear_hint */ "Během cyklu se může změnit režim nebo může část záznamu chybět.",
  /* check.cycling.short */ "Cykly vytápění jsou v průměru krátké.",
  /* check.cycling.normal */ "Cykly vytápění trvají v průměru dostatečně dlouho.",
  /* check.cycling.few */ "Zatím málo cyklů vytápění.",
  /* check.cycling.waiting */ "Zatím chybí údaje.",
  /* check.cycling.class_unavailable */ "Tato soustava poskytuje příliš málo údajů o cyklech vytápění.",
  /* check.cycling.unavailable */ "Chybí údaje o kompresoru.",
  /* check.cycling.stale */ "Aktuálně chybí měření.",
  /* check.cycling.history_empty */ "Zatím bez historie.",
  /* check.cycling.timed_starts */ (s) => `${s} se zaznamenaným časem`,
  /* check.cycling.run_start */ "Start",
  /* check.cycling.run_stop */ "Zastavení",
  /* check.cycling.run_duration */ "Délka běhu",
  /* check.cycling.run_ongoing */ "V chodu",
  /* check.cycling.run_stop_unknown */ "Čas zastavení neznámý",
  /* check.cycling.no_timed_runs */ "V této hodině nebyl zaznamenán čas žádného startu.",
  /* check.cycling.run_details_unavailable */ "Časy jednotlivých běhů pro tuto hodinu nejsou k dispozici.",
  /* check.cycling.saved_starts */ (s) => `Z toho ${s} pochází z hodinových záznamů před restartem.`,
  /* check.cycling.short_runs */ (n) => `${n} < 5 min`,
  /* check.cycling.col_stop */ "Proč se zastavil",
  /* check.cycling.stop_low_flow */ "Výstup nad cílem · nízký průtok",
  /* check.cycling.stop_low_rps */ "Výstup nad cílem · nízké otáčky",
  /* check.cycling.stop_req_off */ "Požadavek kompresoru ukončen",
  /* check.cycling.stop_tgt_drop */ "Cílová teplota snížena",
  /* check.cycling.stop_defrost */ "Pauza pro odmrazování",
  /* check.cycling.stop_defrost_done */ "Odmrazování dokončeno",
  /* check.cycling.stop_dhw */ "Přepnuto na TUV",
  /* check.cycling.stop_normal_dhw */ "Ohřev TUV ukončen",
  /* check.cycling.stop_normal */ "Běžné zastavení",
  /* check.cycling.out_cond */ (v) => ` (${v} venku)`,
  /* check.cycling.find_low_flow */ (minFlow, typ) => `Krátké chody, malý průtok: nad cíl za min (${minFlow}${typ}).`,
  /* check.cycling.find_low_rps */ (flow, cond) => `Krátké chody, nízké ot.${cond}: nad cíl brzy (${flow}).`,
  /* check.cycling.find_control */ "Stop řízením: požadavek vyp. nebo nižší cíl.",
  /* check.cycling.find_defrost_dhw */ (cond) => `Odmraz. & TUV${cond}: pauza na odmrazování a TUV.`,
  /* check.cycling.find_defrost */ (cond) => `Odmrazování${cond}: pauza na odmrazování.`,
  /* check.cycling.find_dhw */ "TUV: pauza pro TUV.",
  /* check.cycling.find_steady */ (flow) => flow ? `Klidné topení: min. ${flow}.` : "Klidné topení.",
  /* check.cycling.pause_tag */ (d) => ` po pauze ${d}`,
  /* check.cycling.cond_tag */ (lwt, tgt) => tgt ? `výstup ${lwt}, cíl ${tgt}` : `výstup ${lwt}`,
  /* check.cycling.from_tag */ (prev) => ` z ${prev}`,
  /* check.cycling.rwt_tag */ (rwt) => `zpátečka ${rwt}`,
  /* check.cycling.typ_tag */ (typ) => `, obvykle ${typ}`,
  /* check.cycling.s_cool */ (at, pause, lwt, tgt) => `Start ${at}${pause}: výstup ${lwt}, cíl ${tgt}, požadavek zapnut.`,
  /* check.cycling.s_req */ (at, pause, cond) => `Start ${at}${pause}: požadavek zapnut${cond}.`,
  /* check.cycling.s_tgt */ (at, pause, prev, tgt, cond) => `Start ${at}${pause}: cíl zvýšen${prev} na ${tgt}${cond}.`,
  /* check.cycling.s_defrost_after */ (at, pause, cond) => `Obnoveno ${at}${pause}, odmrazování skončilo${cond}.`,
  /* check.cycling.s_dhw_after */ (at, pause, cond) => `Obnoveno ${at}${pause}, ohřev TUV skončil${cond}.`,
  /* check.cycling.s_defrost */ (at, pause) => `Start ${at}${pause} pro odmrazování.`,
  /* check.cycling.s_dhw */ (at, pause, cond) => `Start ${at}${pause} pro TUV${cond}.`,
  /* check.cycling.s_gen */ (at, pause, cond) => `Start ${at}${pause}${cond}.`,
  /* check.cycling.e_low_flow */ (to, lwt, tgt, rwt, flow, typ) => `Stop ${to}: výstup ${lwt} nad cílem ${tgt}${rwt} při ${flow}${typ}.`,
  /* check.cycling.e_low_rps */ (to, lwt, tgt, rwt, flow, rps) => `Stop ${to}: výstup ${lwt} nad cílem ${tgt}${rwt} při ${flow} a ${rps}.`,
  /* check.cycling.e_req */ (to, vals) => `Stop ${to}: požadavek vypnut${vals}.`,
  /* check.cycling.e_tgt */ (to, prev, tgt, vals) => `Stop ${to}: cíl snížen${prev} na ${tgt}${vals}.`,
  /* check.cycling.e_defrost_run */ (to, vals) => `Odmrazování skončilo ${to}${vals}.`,
  /* check.cycling.e_defrost_pause */ (to, vals) => `Stop ${to} pro odmrazování${vals}.`,
  /* check.cycling.e_dhw */ (to, vals) => `Stop ${to}: přepnuto na TUV${vals}.`,
  /* check.cycling.e_norm */ (to, vals) => `Konec ${to}${vals}.`,
  /* check.cycling.e_ongoing */ "Běžel při posledním odečtu.",
  /* check.cycling.cause_unavailable */ "Bez podrobností",
  /* check.cycling.cause_older_unavailable */ "Pro tyto starší cykly nejsou k dispozici uložené podrobnosti o spuštění a zastavení.",
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · průměr ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank_runtime */ (d) => `zásobník ${d}`,
  /* check.buh_runtime */ (d) => `záložní ${d}`,
  /* check.buh_short */ "Pom.",
  /* check.tank_short */ "Zás.",
  /* check.hour.latest */ "Poslední interval",
  /* check.hour.earlier */ (h) => `o ${h} h dříve`,
  /* check.hour.other */ "Jiné / neznámé",
  /* check.hour.gap */ "Mezera v měření",
  /* check.hour.coverage */ (observed, possible) => possible ? `Pozorováno ${observed} z ${possible}` : `Pozorováno ${observed} · uplynulá doba neznámá`,
  /* check.hour.ending */ (time) => `Konec intervalu ${time}`,
  /* check.hour.saved */ (time) => `Uložený čas ${time}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "okno" : n >= 2 && n <= 4 ? "okna" : "oken"}`,
  /* check.fault_err */ "Aktivní porucha",
  /* check.fault_warn */ "Aktivní varování",
  /* check.fault_past */ "Dříve aktivní",
  /* check.fault_none */ "Nic není aktivní",
  /* check.fault_unknown */ "Neznámý",
  /* check.fault_past_unknown */ "Dříve · stav neznámý",
  /* check.fault_since_short */ (d) => `už ${d}`,
  /* check.fault_ago_short */ (d) => `před ${d}`,
  /* check.fault_hero_ok */ (d) => `Během ${d} ze 24 h pozorování nebyla hlášena žádná porucha ani varování.`,
  /* check.fault_latched_only */ "Tepelné čerpadlo hlásí uložený příznak poruchy; do zaznamenaného 24h okna nespadla žádná časově určená epizoda.",
  /* check.fault_unit_outdoor */ "Venkovní jednotka",
  /* check.fault_unit_indoor */ "Vnitřní jednotka",
  /* check.fault_unit_both */ "Venkovní + vnitřní",
  /* check.fault_secondary */ (s) => `Současně aktivní: ${s}`,
  /* check.fault_stop_ongoing */ "aktivní",
  /* check.fault_stop_unknown */ "nejasné",
  /* check.fault_col_code */ "Kód",
  /* check.fault_col_meaning */ "Význam",
  /* check.fault_ok_label */ "Bez poruchy",
  /* check.fault_gap_label */ "Neměřeno",
  /* check.fault_severity_caution */ "Upozornění",
  /* check.retry_seen */ "Nárůst",
  /* check.retry_none */ "Bez nárůstu",
  /* service.metric.comp */ "Kompresor",
  /* service.metric.disch */ "Teplota výtlaku",
  /* service.metric.eev */ "Povel expanzního ventilu",
  /* service.metric.hp */ "Vysoký tlak",
  /* service.metric.lp */ "Nízký tlak",
  /* check.hydronic.agree_labels */ "Jen čerpadlo R1T−R4T|Jen čerpadlo R2T−R1T|Stav shody|Omezení shody",
  /* check.hydronic.agree_reasons */ "Průtok pod 5,0 l/min|Kompresor běží|Ohřívač aktivní nebo nejasný|3cestný ventil přepnut|Teploty nejsou ustálené",
  /* check.hydronic.agree_limits */ "R2T nedostupné|Včetně okruhu TUV",
  /* check.hydronic.agree_meta */ "oken|měření|Pouze pasivní shoda; ne kalibrace; cizí teplo není vyloučeno.",
  /* service.metric.range */ (a, b, c, d) => `min. ${a} · průměr ${b} · max. ${c} ${d}`,
  /* service.metric.samples */ n => `Počet přijatých odečtů: ${n}`,
  /* service.metric.input_none */ "Žádný zvolený vstup",
  /* service.metric.meta_limit */ "Počty jsou přijaté odečty, nikoli časové pokrytí. Zvolený vstup nedokazuje aktuální odečet.",
  /* service.limit.special_phases_unavailable */ "Fáze regulace",
  /* service.limit.temperature_context_incomplete */ "Teplotní kontext",
  /* service.limit.pressure_sides_incomplete */ "Tlaková strana/y",
  /* service.limit.outdoor_context_incomplete */ "Venkovní kontext",
  /* service.row.limits */ "Chybějící kontext:",
  /* check.loss_max */ (a) => `maximum ${a} K/h`,
  /* check.loss_high */ (a, b) => `${a}/${b} oken: práh dosažen`,
  /* check.detail.period_label */ "Období dat:",
  /* check.detail.period */ (a) => `${a}, nejvýše 24 h; možné mezery`,
  /* check.detail.age_label */ "Stáří posledního měření:",
  /* check.detail.horizon_wait */ (a) => `Úplné 24hodinové okno ještě chybí: zbývá ${a}.`,
  /* check.detail.fault.ok */ "Žádné aktuální ani uložené hlášení v čitelných signálech poruch.",
  /* check.detail.defrost.info */ "≥3 spárovaná odmrazení přesahují 15 % čitelné doby kompresoru: upozornění projektu.",
  /* check.detail.defrost.ok */ "Žádné upozornění podílu; počasí a mezery nehodnoceny.",
  /* check.defrost.last_start */ (date, route, outdoor) => `Poslední zaznamenaný začátek odmrazování · ${date} · Okruh ${route} · Venkovní vzduch ${outdoor}`,
  /* check.defrost.route_space */ "Vytápění",
  /* check.defrost.route_dhw */ "Zásobník teplé vody",
  /* check.detail.pressure.info */ "Nízký",
  /* check.detail.pressure.warn */ "Kritický",
  /* check.detail.pressure.ok */ "Normální",
  /* check.pressure.finding */ "Potvrzený nález",
  /* check.pressure.sustained */ (a) => `Tlak nejvýše ${a} po dobu alespoň 60 sekund bez přerušení.`,
  /* check.pressure.clear */ "Trvale nízký tlak nebyl potvrzen.",
  /* check.pressure.rules */ "Jak se vyhodnocuje tlak?",
  /* check.pressure.unavailable */ "Diagnostika tlaku X10A není dostupná.",
  /* check.pressure.pending */ "Hodnota je v kritickém rozsahu. Doba trvání zatím není známá.",
  /* check.detail.defrost_events_insufficient */ "Méně než tři spárovaná odmrazení; bez verdiktu podílu.",
  /* check.detail.source_stale */ "Žádný čerstvý vzorek X10A; aktuální stav neznámý. Historie zachována.",
  /* check.detail.no_paired_runtime */ "Žádná spárovaná čitelná doba; pouze počet.",
  /* check.detail.current_label */ "≤1,0 bar nízký",
  /* check.detail.minimum_time_label */ "≤0,5 bar kritický",
  /* check.detail.coverage_missing */ (a) => `Chybějící čitelná doba: ${a} s.`,
  /* check.detail.channel_coverage */ (a, b) => `${a}: pokrytí ${b}`,
  /* check.summary.warnings */ (n) => `${n} ${n === 1 ? "varování" : "varování"}`,
  /* check.summary.notes */ (n) => `${n} ${n === 1 ? "upozornění" : "upozornění"}`,
  /* check.summary.ok */ "Bez upozornění v hodnocených datech",
  /* check.summary.collecting */ "Sběr dat",
  /* check.summary.observations */ "Pozorování",
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
  /* enum.space_cooling */ "Chlazení prostoru",
  /* enum.none */ "Žádný",
  /* enum.reduced */ "Omezený",
  /* enum.automatic */ "Automatický",
  /* enum.manual */ "Ruční",
  /* enum.actuator */ "Pohon",
  /* enum.tank_heat_up */ "Ohřev zásobníku",
  /* a4.quiet_selection */ "Volba tichého režimu",
  /* a4.heating_offset */ "Korekce vytápění podle venkovní teploty, hlavní zóna",
  /* a4.imposed_power_limit */ "Vynucený limit výkonu",
  /* a4.pre_phe_outdoor */ "Teplota vody před venkovním deskovým výměníkem",
  /* a4.main_target */ "Cílová teplota vytápění/chlazení, hlavní zóna",
  /* a4.quiet_help */ "Volí Vypnuto, Automatický nebo Ruční tichý provoz. Nehlásí, zda je tichý režim právě aktivní; vybraná úroveň nebo časový plán mohou stále určovat Vypnuto.",
  /* a4.current_help */ "Hlásí Žádný, Vytápění nebo Chlazení pro úpravu teploty prostoru. Čtěte společně s příznakem normálního provozu; nedokazuje to, že běží kompresor.",
  /* a4.limit_help */ "Vynucený limit elektrického výkonu, nikoli změřená spotřeba. Ochranný provoz může toto nastavení překročit.",
  /* a4.demand_help */ "Hlásí Volný provoz, Vynuceně vypnuto, Vynuceně zapnuto, Doporučeno zapnout nebo Omezený jako reakci na energetický požadavek. Tyto číselné kódy se liší od nastavené volby Smart Grid.",
  /* a4.operation_help */ "Hlásí Zastaveno, Ohřev zásobníku, Vytápění prostoru, Chlazení prostoru nebo Provoz pohonu. Jde o hlášený stav, nikoli důkaz užitečného přenosu tepla.",
  /* a4.heating_offset_help */ "Posouvá ekvitermní topnou křivku hlavní zóny v kelvinech. Jde o posun, nikoli naměřenou teplotu ani úplnou požadovanou teplotu vody.",
  /* a4.pre_phe_outdoor_help */ "Teplota vody před venkovním deskovým výměníkem tepla. Jde o snímač na straně vody, nikoli teplotu venkovního vzduchu nebo chladiva.",
  /* a4.flow_help */ "Přepočet průtoku Altherma 4 není ověřen. Hodnota v L/min používá dosavadní přepočet; před hodnocením výkonu ji porovnejte s údajem jednotky.",
  /* a4.pump_help */ "Příručka Altherma 4 uvádí otáčky čerpadla, ale jednotku L/min. Zobrazená jednotka % je neověřený předpoklad; porovnejte s údajem jednotky.",
  /* a4.pressure_help */ "Přepočet tlaku Altherma 4 není ověřen. Hodnota v bar používá dosavadní přepočet; před hodnocením tlaku ji porovnejte s údajem jednotky.",
  /* a4.demand_response */ "Režim odezvy na poptávku",
  /* a4.unit_operation */ "Provozní stav jednotky",
  /* a4.cooling_offset */ "Ekvitermní korekce chlazení, hlavní zóna",
  /* a4.add_target */ "Cíl vytápění/chlazení, přídavná zóna",
  /* a4.abnormality_counter */ "Počítadlo uživatelských poruch",
  /* a4.cooling_offset_help */ "Posouvá ekvitermní chladicí křivku hlavní zóny v kelvinech. Jde o korekci, nikoli naměřenou teplotu ani celý cíl výstupní vody.",
  /* a4.abnormality_help */ "Kumulovaný počet uživatelských odchylek zaznamenaných jednotkou. Neměnná nenulová hodnota odráží minulé události, nikoli aktivní poruchu; zkontrolujte diagnostický stav a kód chyby.",
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
  /* hist.retained */ "Poslední přijatý vzorek",
  /* hist.before_retained */ (h) => `${h} h před posledním přijatým vzorkem`,
  /* hist.loading */ "Načítám průběh…",
  /* hist.none */ "Dosud nebyly zaznamenány žádné hodnoty.",
  /* hist.err */ "Průběh není dostupný.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "mezera" : n >= 2 && n <= 4 ? "mezery" : "mezer"} — neměřeno`,
  /* hist.nm */ "neměřeno",
  /* hist.rel */ (h) => `před ${h} h`,
  /* hist.held */ "venkovní jednotka stojí",
  /* hist.heldnote */ (h) => `${h} h v klidu — neměřeno`,
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
  /* hist.boost_aria */ csAria("stavu Smart Grid se všemi čtyřmi režimy"),
  /* hist.defrost_total */ (d) => `Odmrazování aktivní · ${d} v 5minutovém rastru`,
  /* hist.defrost_none */ "V zaznamenaném období nebyl pozorován žádný cyklus odmrazování.",
  /* hist.defrost_active */ "Odmrazování aktivní",
  /* hist.defrost_inactive */ "Odmrazování vypnuté",
  /* hist.defrost_aria */ csAria("odmrazování"),
  /* hist.quiet_total */ (d) => `Tichý režim aktivní · ${d} v 5minutovém rastru`,
  /* hist.quiet_none */ "V zaznamenaném období nebyl pozorován žádný interval tichého režimu.",
  /* hist.quiet_active */ "Tichý režim aktivní",
  /* hist.quiet_inactive */ "Tichý režim vypnutý",
  /* hist.quiet_aria */ csAria("tichého režimu"),
  /* hist.heater_total */ (d) => `Topné těleso aktivní · ${d} v 5minutovém rastru`,
  /* hist.heater_none */ "V zaznamenaném období nebylo pozorováno použití topného tělesa zásobníku.",
  /* hist.heater_active */ "Topné těleso aktivní",
  /* hist.heater_inactive */ "Topné těleso vypnuté",
  /* hist.heater_aria */ csAria("topného tělesa zásobníku"),
  /* hist.preheat_total */ (d) => `Předehřev zásobníku aktivní · ${d} v 5minutovém rastru`,
  /* hist.preheat_none */ "V zaznamenaném období nebyl pozorován žádný interval předehřevu zásobníku.",
  /* hist.preheat_active */ "Předehřev zásobníku aktivní",
  /* hist.preheat_inactive */ "Předehřev zásobníku vypnutý",
  /* hist.preheat_aria */ csAria("předehřevu zásobníku X10A"),
  /* hist.disinfection_total */ (d) => `Dezinfekce aktivní · ${d} v 5minutovém rastru`,
  /* hist.disinfection_none */ "V zaznamenaném období nebyl pozorován žádný dezinfekční provoz.",
  /* hist.disinfection_active */ "Dezinfekce aktivní",
  /* hist.disinfection_inactive */ "Dezinfekce vypnutá",
  /* hist.disinfection_aria */ csAria("dezinfekce HomeHub"),
  /* hist.buh_total */ (d) => `Záložní topné těleso aktivní · ${d} v 5minutovém rastru`,
  /* hist.buh_none */ "V zaznamenaném období nebylo pozorováno použití záložního topného tělesa.",
  /* hist.buh_active */ "Záložní topné těleso aktivní",
  /* hist.buh_inactive */ "Záložní topné těleso vypnuté",
  /* hist.buh_step1 */ "Stupeň 1",
  /* hist.buh_step2 */ "Stupeň 2",
  /* hist.buh_aria */ csAria("záložního topného tělesa"),
  /* hist.valve_dhw_total */ (d) => `TUV · ${d}`,
  /* hist.valve_space_total */ (d) => `Prostorový okruh · ${d}`,
  /* hist.valve_none */ "V zaznamenaném období nebyla zaznamenána poloha TUV.",
  /* hist.valve_dhw */ "TUV",
  /* hist.valve_space */ "Prostorový okruh",
  /* hist.valve_aria */ csAria("trojcestného ventilu"),
  /* hist.circ_total */ (d) => `Čerpadlo v chodu · ${d} v 5minutovém rastru`,
  /* hist.circ_none */ "V zaznamenaném období nebyl pozorován žádný běh čerpadla.",
  /* hist.circ_on */ "Běží",
  /* hist.circ_off */ "Zastaveno",
  /* hist.circ_unavailable */ "Nedostupné",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "nedostupný interval" : n >= 2 && n <= 4 ? "nedostupné intervaly" : "nedostupných intervalů"}`,
  /* hist.circ_aria */ csAria("oběhového čerpadla"),
  /* hist.valve2_on_total */ (d) => `Výstup 2WV ZAP · ${d}`,
  /* hist.valve2_off_total */ (d) => `Výstup 2WV VYP · ${d}`,
  /* hist.valve2_on */ "Výstup 2WV ZAP",
  /* hist.valve2_off */ "Výstup 2WV VYP",
  /* hist.valve2_none */ "Ve zvoleném období nebyl pro výstup dvoucestného ventilu zaznamenán stav ZAP.",
  /* hist.valve2_aria */ csAria("výstupu dvoucestného ventilu"),
  /* hist.flow_switch_total */ (d) => `Stav X10A ZAP · ${d} v 5minutovém rastru`,
  /* hist.flow_switch_on */ "Stav X10A ZAP",
  /* hist.flow_switch_off */ "Stav X10A VYP",
  /* hist.flow_switch_none */ "Ve zvoleném období nebyl pro tento stav X10A zaznamenán stav ZAP.",
  /* hist.flow_switch_aria */ csAria("spínače průtoku vody"),
  /* hist.comp_total */ (d, n) => `Kompresor · ${d} · ${n} ${n === 1 ? "fáze" : "fází"}`,
  /* hist.comp_none */ "V zaznamenaném období nebyl pozorován provoz kompresoru.",
  /* hist.comp_active */ "Kompresor v chodu",
  /* hist.comp_inactive */ "Kompresor vypnutý",
  /* hist.comp_aria */ csAria("kompresoru HomeHub"),
  /* hist.mb_defrost_total */ (d) => `Odtávání / restart · ${d}`,
  /* hist.mb_defrost_none */ "V zaznamenaném období nebyla pozorována fáze odtávání ani restartu.",
  /* hist.mb_defrost_active */ "Odtávání / restart",
  /* hist.mb_defrost_inactive */ "Normální / klid",
  /* hist.mb_defrost_aria */ csAria("odtávání/restartu HomeHub"),
  /* hist.pump_total */ (d) => `Čerpadlo · ${d}`,
  /* hist.pump_none */ "V zaznamenaném období nebyl pozorován provoz oběhového čerpadla.",
  /* hist.pump_active */ "Čerpadlo v chodu",
  /* hist.pump_inactive */ "Čerpadlo vypnuté",
  /* hist.pump_aria */ csAria("oběhového čerpadla HomeHub"),
  /* toast.saved */ "Uloženo",
  /* toast.no_changes */ "Žádné změny",
  /* toast.reboot */ "Restartuji — znovu se připojuji…",
  /* toast.rebooted */ "Restartováno — znovu se připojte k zařízení",
  /* board.draft_stale */ "Nastavení desky se změnilo. Před uložením znovu otevřete editor.",
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
  /* ota.dialog_title */ "Aktualizace firmwaru",
  /* ota.switch_title */ "Přepnout verzi firmwaru",
  /* ota.changes_title */ "Změny v této aktualizaci",
  /* ota.no_changes */ "Pro tuto aktualizaci nebyl dodán žádný přehled změn.",
  /* ota.install_help */ "Zařízení stáhne a nainstaluje podepsaný obraz a poté se restartuje. Pokud se nový firmware nepřipojí, zařízení automaticky obnoví aktuální sestavení.",
  /* ota.switch_help */ "Toto sestavení je starší, protože je vybrán jiný kanál aktualizací. Před instalací se ověří jeho podpis. Pokud se starší sestavení nepřipojí, zařízení automaticky obnoví aktuální sestavení.",
  /* ota.install */ "Nainstalovat aktualizaci",
  /* ota.switch */ "Nainstalovat starší sestavení",
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
  /* schem.defrost_transfer */ "Při potvrzeném odmrazování může teplo přecházet z vody do chladiva. Potrubí tento směr zobrazuje jen tehdy, když ho potvrzuje aktuální průtok a teploty.",
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
  /* wifi.err_ssid */ "SSID musí mít 1 až 32 bajtů UTF-8",
  /* wifi.err_pass */ "Heslo musí být prázdné (otevřená síť) nebo mít 8 až 63 bajtů UTF-8",
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
  /* dyn.state_gate */ "Stav soustavy není znám",
  /* dyn.state_mode */ "Režim vytápění/chlazení není znám",
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
  /* board.led_rgb_off */ "Nesvítí — není aktivní žádná síť.",
  /* board.led_rgb_setup */ "Modrá, pomalu bliká — konfigurační portál je aktivní.",
  /* board.led_rgb_connecting */ "Žlutá, rychle bliká — připojuje se k síti.",
  /* board.led_rgb_healthy */ "Zelená, svítí — X10A a, je-li nastaveno, MQTT připojena.",
  /* board.led_rgb_bus_down */ "Červená, dvojité bliknutí — X10A je odpojeno nebo režim obnovení.",
  /* board.led_rgb_mqtt_down */ "Oranžová, bliká — X10A je připojeno, MQTT odpojeno.",
  /* board.led_rgb_wipe_armed */ "Červená, velmi rychle bliká — mazání připraveno; uvolněním je zrušíte.",
  /* board.led_rgb_wiping */ "Bílá, svítí — reset/mazání dat; neodpojujte napájení.",
  /* board.led_gpio_off */ "Nesvítí — není aktivní žádná síť.",
  /* board.led_gpio_setup */ "Pomalu bliká — konfigurační portál je aktivní.",
  /* board.led_gpio_connecting */ "Rychle bliká — připojuje se k síti.",
  /* board.led_gpio_healthy */ "Svítí — X10A a, je-li nastaveno, MQTT připojena.",
  /* board.led_gpio_bus_down */ "Dvojité bliknutí — X10A je odpojeno nebo režim obnovení.",
  /* board.led_gpio_mqtt_down */ "Bliká střední rychlostí — X10A je připojeno, MQTT odpojeno.",
  /* board.led_gpio_wipe_armed */ "Velmi rychle bliká — mazání připraveno; uvolněním je zrušíte.",
  /* board.led_gpio_wiping */ "Po rychlém blikání svítí — reset/mazání dat; neodpojujte napájení.",
  /* board.ledinv */ "Aktivní v nízké úrovni (LED svítí, když je pin buzen na LOW)",
  /* board.btninv */ "Aktivní v nízké úrovni (tlačítko spojí pin s GND)",
  /* board.hint */ "Tovární reset: podržte tlačítko 5 s. Pokud deník historie není připravený, nic se nesmaže. Smaže nastavení Wi-Fi i další nastavení, zaznamenanou historii, doby trvání stavů, nezpracovaný výpis paměti po pádu a uložený záznam pro úklid MQTT. Nastavení desky, LED a tlačítka se zachovají, pokud to bude možné. Při chybě mazání může být smazána jen část dat. Zařízení se restartuje jen po úspěšném dokončení všech kroků mazání. Pokud reset nezačne nebo se nedokončí, zkontrolujte /diag. Bez připojeného tlačítka vyberte „Žádná“.",
  /* card.hardware */ "Vybavení",
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
  /* card.diagnostics_help */ "Zapne 24hodinovou kontrolu soustavy a volitelné sledování výkonu cirkulačního čerpadla.",
  /* diagnostics.off */ "Vypnuto",
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
  /* check.detail.dhw_reason.blind_modbus */ "chybí údaje: Modbus neodpovídá nebo je dotazování pozastaveno",
  /* check.detail.source_stale_modbus */ "Žádný čerstvý vzorek Modbus; aktuální stav neznámý. Historie zachována.",
  /* mb.flow_scale_help */ "Neověřené škálování /100 (čeká sonda/náhradní profil); porovnejte L/min s displejem. Bez animace, ΔT, výkonu a 24h kontroly.",
  /* hist.modbus_flow_unverified */ "Neověřené škálování Modbus /100 (čeká sonda/náhradní profil); porovnejte s displejem.",
  /* wf.label */ "Topný faktor",
  /* wf.short.partial */ "předb.",
  /* wf.short.limited */ "omez.",
  /* wf.state.unsupported */ "Nepodporováno",
  /* wf.state.collecting */ "Sběr dat",
  /* wf.state.standby */ "Pohotovost",
  /* wf.verdict.cheaper */ "levnější než plyn",
  /* wf.verdict.similar */ "jako plyn",
  /* wf.verdict.more_expensive */ "dražší než plyn",
  /* wf.verdict.limited */ "omezeně",
  /* wf.verdict.measured */ "změřeno",
  /* wf.verdict.partial */ "předběžné",
  /* wf.aria.estimate */ (v) => `odhadnuto ${v}`,
  /* wf.kpi.breakeven */ (be) => `Bod zlomu ${be}`,
  /* wf.kpi.hp_cost */ "Tepelné čerpadlo",
  /* wf.kpi.gas_cost */ "Plyn · 88 %",
  /* wf.kpi.delta */ "Rozdíl",
  /* wf.kpi.energy */ "24h teplo",
  /* wf.kpi.heat_elec */ (e) => `el. ${e} kWh`,
  /* wf.scope.est */ "odhad",
  /* wf.scope.comp */ "jen kompresor",
  /* wf.scale.label */ "Bod zlomu",
  /* wf.scale.band */ (p) => `±${p} %`,
  /* wf.scale.cheaper */ "Levnější →",
  /* wf.scale.expensive */ "← Dražší",
  /* wf.cta.tariffs */ "Nastavit tarify",
  /* wf.cta.edit_tariffs */ "Upravit tarify",
  /* wf.desc.collecting */ (o) => `První hodnota od 2 h · zatím ${o}`,
  /* wf.desc.standby */ (o) => `Příliš krátký provoz pro výpočet · ${o}`,
  /* wf.desc.unsupported */ "Chybí potřebné údaje o průtoku, teplotě nebo elektřině.",
  /* wf.banner.stale */ "Signál zdroje je zastaralý — údaj pozastaven.",
  /* wf.banner.buh_limited */ "Záložní ohřev mimo měření proudu — údaj omezen.",
  /* wf.banner.buh_unpaired */ "Záložní ohřev aktivní bez výstupního čidla — vyloučeno.",
  /* wf.banner.bsh_excluded */ (d) => `Patrona zásobníku ${d} vyloučena.`,
  /* wf.banner.ct_unwired */ "Proudová kleště 0 A — měří se jen kompresor.",
  /* wf.ctx.window */ "Období",
  /* wf.ctx.power */ "Měření el.",
  /* wf.ctx.outdoor */ "Venkovní",
  /* wf.ctx.outdoor_range */ (avg, min) => `prům. ${avg} °C · min. ${min} °C`,
  /* wf.ctx.defrost */ "Odtávání",
  /* wf.ctx.buh */ "Záložní ohřev",
  /* wf.ctx.buh_inc */ (d) => `${d} · zahrnuto`,
  /* wf.ctx.cooling */ "Chlazení",
  /* wf.ctx.excluded */ (d) => `${d} vyloučeno`,
  /* wf.src.x10a_ct */ "Proudová kleště · celek",
  /* wf.src.x10a_inv */ "Invertor · jen kompresor",
  /* wf.foot.base */ "24 h vytápění a TUV · čistá voda · odhad.",
  /* wf.foot.gas */ "24 h vytápění a TUV · čistá voda · plyn 88 % kondenzační kotel bez paušálů · odhad.",
  /* wf.gas.row */ "Porovnání s plynem",
  /* wf.gas.title */ "Tarify plynu",
  /* wf.not_configured */ "Bez tarifů",
  /* wf.gas.detail.elec */ "Elektřina",
  /* wf.gas.detail.gas */ "Plyn",
  /* wf.gas.detail.breakeven */ "Bod zlomu",
  /* wf.gas.settings_help */ "24 h TČ vs. pevný moderní kondenzační plynový kotel (88 % Hs, čistá voda 4,186 kJ/(L·K), bez paušálů).",
  /* wf.gas.elec_price */ "El. / kWh",
  /* wf.gas.gas_price */ "Plyn / kWh",
  /* wf.gas.currency */ "Měna",
  /* wf.gas.preview */ (b) => `Bod zlomu: ${b} (±20 %)`,
  /* wf.gas.preview_empty */ "Zadejte ceny pro bod zlomu.",
  /* wf.gas.hint */ "Pevný moderní kondenzační plynový kotel (88 % Hs) a čistá voda (4,186 kJ/(L·K)), vytápění + TV, bez paušálů. Přepočte 24 h.",
  /* wf.gas.delete */ "Vymazat",
  /* wf.gas.deleting */ "Mažu…",
  /* wf.gas.saved */ "Tarify uloženy",
  /* wf.gas.deleted */ "Tarify vymazány",
  /* wf.gas.err_price */ "0,0001–99,9999.",
  /* wf.gas.err_currency */ "Vyberte podporovanou měnu.",
]);
INSPECT_I18N.cs = inspectValues(
  ["Chybí aktuální hodnota:", "kompresor stojí a venkovní jednotka obnovuje své snímače jen za chodu. Hodnota z minulého běhu je skryta, aby nepůsobila jako aktuální měření.", "Otáčky kompresoru nelze přečíst, takže hodnoty venkovní jednotky mohou být z minulého běhu."],
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
      : `${fmt1(d.dt)} K. Kladná hodnota znamená předávání tepla vodě.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Chladicí výkon (odhad)" : "Tepelný výkon (odhad)", "Odhadovaný tepelný výkon na PHE", (d) => d && d.pthKind === "cooling" ? "Odhad tepla odebraného vodě: průtok × (R4T−R1T) × 4,186 při předpokladu vody. Snímače a glykol omezují přesnost; hodnota se ukáže jen při potvrzeném chlazení." : "Odhad tepla předaného vodě: průtok × (R1T−R4T) × 4,186 při předpokladu vody. Snímače a glykol omezují přesnost; BUH za R1T není zahrnut.", (d) => d.dtStale ? d.bsh === true ? "Přenos na PHE nelze spočítat bez potvrzeného oběhu. Těleso může dál ohřívat zásobník, ale jeho teplo míjí snímače PHE a sběrnice neudává jeho výkon." : "Výkon nelze spočítat bez potvrzeného pohybu vody přes PHE. Jde o chybějící pracovní bod, ne nulový výkon."
      : d.pth == null ? null : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW chlazení${d.cop != null ? `, EER ${fmt1(d.cop)}` : ""}.` : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER tepelného čerpadla (odhad)" : d && d.copScope === "plant" ? "COP za BUH (odhad)" : "COP tepelného čerpadla (odhad)", "Odhadovaná účinnost", (d) => d && d.efficiencyKind === "eer" ? "Odhadovaný chladicí výkon dělený odhadovaným příkonem. Výsledek přebírá předpoklady o kapalině, snímačích, napětí a účiníku; je okamžitý, ne sezonní." : "Odhadovaný tepelný výkon dělený příkonem se stejnou bilanční hranicí. U CT může být teplo za BUH, u proudu měniče jen tepelné čerpadlo; zapojení CT určuje zahrnuté spotřebiče. Výsledek přebírá předpoklady o kapalině, snímačích, napětí a účiníku a je okamžitý, nikoli sezonní.", (d) => d.copBlock === "tank_heater" ? "COP není dostupný — těleso zásobníku je zapnuté. Jeho příkon může být v elektrické bilanci, ale teplo jde přímo do zásobníku a míjí vodní snímače."
      : d.copBlock === "buh_no_r2t" ? "COP není dostupný — BUH topí, ale profil nemá snímač za ním; elektrická a tepelná hranice si neodpovídají."
      : d.copBlock === "mb_scope" ? "COP není dostupný. Příručka HomeHub neuvádí, které elektrické spotřebiče zahrnuje údaj o příkonu. Odhad tepla se týká deskového výměníku. Pro výpočet COP je třeba ověřit shodu obou rozsahů měření."
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
    ["Oběhové čerpadlo", "Oběhové čerpadlo", "Obrácený signál X10A (0 = max, 100 = stop, [0, 100] → 100–0 %) neměří RPM ani neprokazuje otáčení, výtlak nebo průtok; čtěte ZAP/VYP a průtok zvlášť, i v klidu.", (d) => pumpNowText(d, [(n) => `Povel čerpadla ${n} %.`, "Stav čerpadla je ZAP.", "Čerpadlo hlásí zastavení (VYP).", "Stav čerpadla ZAP/VYP neznámý.", (n) => `Měřený průtok ${n} l/min.`, "Žádné měření průtoku.", "Hlášené VYP je v rozporu s průtokem; možný vnější oběh, doběh nebo zastaralý signál.", "Oběh vody není prokázán."])], // pump
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
    ["Tlak vody", 0], // wp
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
  "Dohřev TUV povolen", // 12
  "Booster režim TUV zapnut", // 13
  "Diagnostický stav jednotky", // 21
  "Kód chyby jednotky", // 22
  "Podkód chyby jednotky", // 23
  "Oběhové čerpadlo aktivní", // 30
  "Kompresor aktivní", // 31
  "Těleso zásobníku aktivní", // 32
  "Dezinfekce zásobníku aktivní", // 33
  "Odtávání nebo restart", // 35
  "Teplý start", // 36
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
  "Korekce výstupu hlavní chladicí zóny", // 55
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
  ["Povolení automatického dohřevu TUV v registru 12; ON = povoleno, OFF = zakázáno, nedokazuje aktivní ohřev."], // 23
  ["Požadavek rychlého ohřevu TUV (booster) v registru 13; ON = požadováno či aktivní, OFF = běžný provoz."], // 24
  ["Dohřev vrací nádrž na nastavenou teplotu po poklesu pod spínací mez."], // 25
  ["Aktivní plánovaná předvolba nádrže: Storage comfort používá vyšší cíl, Storage eco nižší."], // 26
  ["V hybridu regulátor žádá kotel o TUV."], // 27
  ["Přepínací ventil vede vodu do zásobníku TUV nebo domu."], // 28
  ["Výstup 2WV zůstává ZAP./VYP.; VYP. nedokazuje chlazení ani polohu ventilu."], // 29
  ["Otevření směšovacího ventilu druhé zóny."], // 30
  ["Cílová výstupní teplota pro zvolený režim vytápění či chlazení."], // 31
  ["Smíšená výstupní teplota za ventilem druhé topné zóny, obvykle chladnější."], // 32
  ["R2T měří vodu za BUH; umístění závisí na hydraulice, ne na otopných tělesech."], // 33
  ["R1T měří vodu z PHE před BUH; režim, R4T a průtok určují význam i odhad výkonu."], // 34
  ["R4T je společná vratka do PHE; R1T−R4T je ΔT PHE, ne přímo otopných těles."], // 35
  ["Rychlost oběhu vody ve společném okruhu vytápění/chlazení a TUV."], // 36
  ["Tlak v uzavřeném hydraulickém okruhu.","Povolený rozsah závisí na modelu, výšce instalace a expanzní nádobě. Při tlaku 1,0 bar nebo méně zkontrolujte návod konkrétní jednotky."], // 37
  ["Obrácený X10A povel: 0 = max, 100 = stop ([0, 100] → 100–0 %). Neměří RPM ani neprokazuje otáčení, výtlak nebo průtok; čtěte ZAP/VYP a průtok zvlášť."], // 38
  ["Běh oběhového čerpadla nedokazuje přenos tepla; potvrďte jej průtokem."], // 39
  ["Stav čerpadla nakonfigurovaného solárního termického okruhu."], // 40
  ["Hlášená rychlost čerpadla pojmenovaného profilem."], // 41
  ["Flow switch X10A hlásí jen pohyb; neměří průtok ani splnění minima modelu."], // 42
  ["Aktuální režim vodní strany: zastaveno, vytápění, chlazení, TUV nebo kombinace."], // 43
  ["Smart Grid hlásí čtyřstavový energetický povel, ne režim vytápění/chlazení."], // 44
  ["Živý režim domu je vytápění/chlazení bez automatiky a sám nedokazuje běh kompresoru."], // 45
  ["Nastavená volba HomeHub Auto/vytápění/chlazení z registru 3."], // 46
  ["Stav venkovní jednotky: zastaveno, vytápění nebo chlazení; sám nedokazuje přenos tepla."], // 47
  ["Sdílený příznak odtávání a přípravy restartu kompresoru v registru 35; OFF = běžný chod, ON = odtávání nebo příprava restartu."], // 48
  ["Příznak teplého startu v registru 36; OFF = ustálený chod, ON = krátký předehřev výměníku."], // 49
  ["Odmrazování je v chladu a vlhku normální; samotný bit bez vlhkosti neurčuje četnost."], // 50
  ["Třída aktivní poruchy: normální stav, chyba, varování nebo upozornění."], // 51
  ["Význam právě hlášeného kódu poruchy."], // 52
  ["Nouzový provoz po poruše tepelného čerpadla."], // 53
  ["Poplachové relé jednotky, sepnuté při poruše pro připojený externí alarm nebo dohled."], // 54
  ["Cílová pokojová teplota hlavní zóny při vytápění či chlazení."], // 55
  ["„Thermo ON“ je vnitřní požadavek, ne určení zátěže ani důkaz běhu kompresoru."], // 56
  ["Stav výstupní svorky „Space H Operation“."], // 57
  ["Běžný provoz domu není jen vytápění ani termostat; skutečnost ukazuje I/U a pohony."], // 58
  ["Nastavená cílová pokojová teplota zóny řízené vlastním pokojovým čidlem jednotky."], // 59
  ["Pokojová teplota měřená vestavěným nebo kabelovým čidlem jednotky."], // 60
  ["Ochrana výtlaku: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 61
  ["Ochrana proudu invertoru: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 62
  ["Ochrana vysokého tlaku: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 63
  ["Ochrana nízkého tlaku: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 64
  ["Ochrana teploty chladiče invertoru: Drop=ON/OFF, Retry=0…7; jen růst v souvislých srovnatelných vzorcích dokládá událost, ne absolutní hodnota."], // 65
  ["Vnitřní souhrnný příznak omezení mimo pět pojmenovaných ochran."], // 66
  ["Teplota vody na vstupu či výstupu PHE mezi chladivem a vodním okruhem."], // 67
  ["Teplota venkovního výměníku; pod 0 °C bez vlhkosti sama nedokazuje námrazu."], // 68
  ["Venkovní teplota měřená u jednotky pro ekvitermní řízení a provozní rozhodnutí."], // 69
  ["Horký plyn za kompresorem; závisí na tlaku, otáčkách, režimu a zátěži. Jeden údaj či rozsah jiné řady nedokazuje závadu ani nedostatek chladiva."], // 70
  ["Teplota chladného nízkotlakého chladiva vracejícího se do kompresoru."], // 71
  ["Teplota chladiva v kapalinovém potrubí mezi výměníky."], // 72
  ["Teplota chladiva u vstupu či výstupu výparníku, který odebírá teplo."], // 73
  ["Teplota vstřikovacího potrubí chladiva pro řízení vstřiku a ochranu okruhu."], // 74
  ["Teplota dvoufázové směsi chladiva; vnitřní regulační vstup, ne uživatelský cíl."], // 75
  ["Čidlo odmrazování venkovního výměníku; poloha i řízení závisí na modelu. Jeden bod nedokazuje led na celé ploše ani konec odmrazení."], // 76
  ["Sytostní teplota vypočtená z tlaku pro nastavené chladivo; není z čidla ani tlakem v bar."], // 77
  ["Vysoký/nízký tlak: hodnoťte stabilní trend stejného režimu/modelu; rozběh, návrat oleje a odmrazení jej mění. Obecný rozsah není."], // 78
  ["Otáčky invertorového kompresoru za sekundu, hlavní regulační veličina výkonu."], // 79
  ["Povel EEV v krocích bez mechanické zpětné vazby; není to % ani průtok. Sám nedokazuje pohyb, zadření či nedostatek chladiva."], // 80
  ["Teplota výkonové elektroniky motoru venkovního ventilátoru."], // 81
  ["Rychlost venkovního ventilátoru jako stupeň nebo ot/min."], // 82
  ["Vnitřní cíl dle modelu/režimu; porovnejte s odpovídající saturační teplotou z tlaku. Rozdíl neurčuje příčinu ani náplň."], // 83
  ["Vnitřní cíl teploty výtlaku/portu kompresoru pro ochrannou logiku."], // 84
  ["Cílové ΔT závisí na modelu a režimu; může být 8 či 10 K, obecné pravidlo 5 K neplatí."], // 85
  ["Chladivo jednotky, např. R32/R410A, určující tlakově-teplotní křivku sytosti."], // 86
  ["Teplota u portu kompresoru pro vnitřní ochranný dohled."], // 87
  ["Tlak v chladivovém okruhu hlášený venkovní jednotkou."], // 88
  ["Jen úplná sada CT × 230 V dává nekalibrovaný odhad; zapojení, napětí a účiník výsledek omezují."], // 89
  ["Proud invertoru kompresoru jako přibližná míra jeho zatížení."], // 90
  ["Teplota chladiče invertoru/výkonové elektroniky venkovní jednotky."], // 91
  ["Aktivní stupně elektrického BUH jako výkonový stupeň."], // 92
  ["Stupeň odporového BUH přidávající teplo přímo do vody."], // 93
  ["HomeHub 32: stav BSH, ne výkon; registr 51 je zvláštní příkon „tepelného čerpadla“, ne výkon BSH, a jeho rozsah není potvrzen."], // 94
  ["BSH může topit bez kompresoru a čerpadla; X10A hlásí jen ZAP./VYP., ne výkon."], // 95
  ["Stav tepelného ochranného řetězce elektrického tělesa."], // 96
  ["Ochrana potrubí závisí na modelu a napájení; při výpadku ji nelze zaručit."], // 97
  ["Příznak mrazu X10A není veřejně přiřazen jednoznačně ochraně místnosti či potrubí."], // 98
  ["Hodnota zemního solankového okruhu geotermální jednotky nebo jeho čerpadla."], // 99
  ["Zvolený zdroj hybridu: tepelné čerpadlo, kombinace nebo kotel."], // 100
  ["Cílová výstupní teplota hybridního vytápění, nikoli měřená voda."], // 101
  ["Zda je bivalentní provoz druhého zdroje aktivní či povolený."], // 102
  ["Aktuální požadavek regulátoru na kotel v bivalentním/hybridním systému."], // 103
  ["Cílová teplota vody požadovaná pro kotel, ne měřená teplota."], // 104
  ["BE_COP porovnává hybridní zdroje; není měřený COP a škála X10A není popsána."], // 105
  ["Externí tarif, Smart Grid či solar může omezit nebo žádat teplo; akci určuje nastavení."], // 106
  ["Jmenovitý výkon/velikostní třída vnitřní či venkovní jednotky."], // 107
  ["Tichý režim snižuje hluk venkovní jednotky a může snížit dostupný výkon."], // 108
  ["Aktuální diagnostický stav HomeHub: bez chyby, porucha nebo varování."], // 109
  ["Význam právě hlášeného kódu poruchy."], // 110
  ["Číselný podkód upřesňující sousední diagnostický kód Daikin."], // 111
  ["HomeHub hlásí jen běh kompresoru, ne otáčky ani výkon; význam určuje okruh a průtok."], // 112
  ["Provoz TUV: v provozu = ZAP., klid/bufrování = VYP.; příznak neuvádí důvod."], // 113
  ["Provoz domu: v provozu = ZAP., klid/bufrování = VYP.; režim určí vytápění/chlazení."], // 114
  ["Teplota vody z PHE před BUH."], // 115
  ["Výstupní teplota vody za BUH."], // 116
  ["Teplota vody v zásobníku TUV."], // 117
  ["Teplota chladiva v kapalinovém potrubí mezi venkovní jednotkou a vnitřním výměníkem."], // 118
  ["Pokojová teplota hlavní zóny z dálkového ovladače."], // 119
  ["Elektrický příkon systému hlášený HomeHub; X10A poskytuje jen odhad z fázových proudů."], // 120
  ["Cílová výstupní teplota hlavní topné zóny čtená z HomeHub; firmware ji nemění."], // 121
  ["Cílová výstupní teplota hlavní chladicí zóny čtená z HomeHub; firmware ji nemění."], // 122
  ["Zda je prostorový okruh vůbec POVOLEN — přepínač, ne aktuální aktivita."], // 123
  ["Tichý provoz snižuje hluk a může snížit dostupný výkon."], // 124
  ["Cíl dohřevu TUV není spínací teplota; start závisí i na hysterezi a plánu."], // 125
  ["Čtená korekce cíle vytápění −10…+10 K; nenulová hodnota nedokazuje aktivní provoz."], // 126
  ["Čtená korekce cíle chlazení −10…+10 K; nenulová hodnota nedokazuje aktivní chlazení."], // 127
  ["Limit Smart Grid „doporučené zapnutí“; platí nižší z něj a obecného limitu, nejde o aktuální příkon."], // 128
  ["Obecný limit HomeHub i při volném provozu; je to nastavený strop, ne měřený příkon."], // 129
]);

MODEL_DESCRIPTION_I18N.cs = modelDescriptionValues([
  ["Zobrazuje chybové a výstražné kódy hlášené tepelným čerpadlem; krátké popisy jsou obecné pokyny Daikin a zmizení kódu neprokazuje odstranění příčiny."], // health_fault
  ["R5T: bod vrstveného zásobníku, ne energie.", "Interní práh ≥0,8 K/h bez značek čerpadla/odběru. Odběr možný i bez značek; 0 K/h nevylučuje ztráty. Cirkulace neprokazuje příčinu."], // health_dhw_loss
  ["Při výpadcích měření mohou některé starty chybět.", "Pevný běžný počet startů neexistuje. Při dostatku dat tato kontrola považuje průměrnou délku dokončených cyklů vytápění alespoň 10 minut za dostatečnou."], // health_cycling
  ["Odmrazení", "≥3 spárovaná, >15% doby chodu kompresoru při čitelném stavu kompresoru i odmrazení. Interní pravidlo, ne Daikin; chybí vlhkost a teplota celého výměníku."], // health_defrost
  ["24h průběh tlaku vody v uzavřeném hydraulickém okruhu (X10A, 5min minima).", "Průběh: >1,0 bar normální, ≤1,0 bar nízký, ≤0,5 bar kritický (diagnóza od 60 s souvisle). Přípustný plnicí a provozní tlak určuje přesný návod modelu a výška soustavy; samotný údaj neprokazuje únik ani závadu."], // health_pressure
  ["Nejnižší průtok po 60 s souvislého chodu vnitřního čerpadla; samostatně: podle vzorků vážené statistiky rozdílu teplot vody, průtoku a povelu čerpadla po 600 s náběhu vytápění.", "Není jmenovitý průtok ani důkaz částečného zatížení. Platí pro společný vodní výměník tepla. Povel čerpadla není otáčkami ani dopravní výškou. Projektový filtr 600 s (mezery ≤15 s) neprokazuje ustálený stav; bez srovnání s cílem či hydraulické příčiny."], // health_flow
  ["Doba ON BUH/BSH", "ne energie ani důkaz zbytečného topení."], // health_heater
  ["5 experimentálních čítačů", "srovnatelné nárůsty; mezery/reset vyloučeny. Stabilita nevylučuje omezení ani neprokazuje příčinu."], // health_retries
  ["RAM 24 h stabilní, poklesy mizí; trvalý pokles: možný únik; napájený kompatibilní restart: průběh RAM možný. Jinak jen datované kompatibilní 5 min z flash žurnálu po seřízení hodin. Rastr 5 min může skrýt krátké pauzy; otevřené/nové neuložené mohou chybět."], // 8
  ["Největší souvislý blok volné RAM. TLS a OTA potřebují jeden velký blok i při vyšším celkovém volnu. Je nejvýše roven volné RAM. Klesá-li při stabilní volné RAM, roste fragmentace haldy a velká alokace může selhat před vyčerpáním paměti."], // 9
  ["Jmenovitý výkon venkovní jednotky z její identifikace; třída hardwaru, ne aktuální výroba."], // 10
  ["Jmenovitý výkon VNITŘNÍ jednotky, zobrazený protože identifikace venkovní vlastní výkon nemá. Vnitřní a venkovní jednotka mohou mít různé třídy; nejde o výkon venkovní ani celého systému."], // 11
  ["Stejná třída a registry: volba zástupce nemění dekódované hodnoty."], // 12
  ["Několik rodin Daikin má stejné servisní registry, takže obchodní název nelze rozlišit; nadpis zůstane „Daikin Altherma“. Venkovní jednotka výkon nehlásí, kandidáti tedy mohou mít různé třídy. Firmware volí variantu nejbližší vnitřní jednotce, ne však s plnou jistotou. Ověřte štítkem."], // 13
  ["Syrové ID bajty venkovní jednotky bez veřejné tabulky názvů; při nejasnosti je znak po znaku porovnejte se štítkem."], // 14
]);

FAULT_CODE_I18N.cs = faultCodeValues([
  "Problém s průtokem vody", // 7H
  "Porucha snímače teploty vratné vody", // 80
  "Porucha snímače teploty výstupní vody", // 81
  "Aktivována protimrazová ochrana výměníku", // 89
  "Neobvyklý nárůst teploty na výstupu TUV", // 8F
  "Neobvyklý nárůst teploty výstupní vody", // 8H
  "Porucha detekce průchodu nulou", // A1
  "Problém s omezením vysokého tlaku nebo protimrazovou ochranou", // A5
  "Pomocný ohřívač je přehřátý nebo nepřipojený", // AA
  "Topné těleso zásobníku je přehřáté", // AC
  "Dezinfekce zásobníku proti legionelle nebyla dokončena", // AH
  "Překročena doba ohřevu TUV", // AJ
  "Porucha snímače průtoku", // C0
  "Porucha snímače teploty výměníku", // C4
  "Porucha snímače výměníku", // C5
  "Porucha snímače pokojové teploty", // CJ
  "Vadná deska elektroniky venkovní jednotky", // E1
  "Porucha detekce svodového proudu", // E2
  "Sepnul vysokotlaký spínač venkovní jednotky", // E3
  "Porucha sacího tlaku", // E4
  "Přehřátý motor invertorového kompresoru venkovní jednotky", // E5
  "Kompresor venkovní jednotky se nespustil", // E6
  "Porucha motoru ventilátoru venkovní jednotky", // E7
  "Přepětí na vstupu venkovní jednotky", // E8
  "Porucha elektronického expanzního ventilu", // E9
  "Problém přepnutí chlazení/topení venkovní jednotky", // EA
  "Neobvyklý nárůst teploty zásobníku", // EC
  "Porucha teploty výtlačného potrubí venkovní jednotky", // F3
  "Neobvykle vysoký tlak venkovní jednotky při chlazení", // F6
  "Neobvykle vysoký tlak; sepnut vysokotlaký spínač", // FA
  "Porucha snímače napětí nebo proudu venkovní jednotky", // H0
  "Porucha externího snímače teploty", // H1
  "Porucha vysokotlakého spínače venkovní jednotky", // H3
  "Porucha ochrany kompresoru proti přetížení", // H5
  "Porucha snímače polohy venkovní jednotky", // H6
  "Porucha systému CT vstupního proudu venkovního kompresoru", // H8
  "Porucha snímače venkovní teploty venkovní jednotky", // H9
  "Porucha snímače teploty zásobníku", // HC
  "Porucha snímače tlaku vody", // HJ
  "Porucha snímače výtlačného potrubí venkovní jednotky", // J3
  "Porucha snímače výměníku venkovní jednotky", // J6
  "Porucha snímače vysokého tlaku venkovní jednotky", // JA
  "Porucha desky invertoru", // L1
  "Neobvyklý nárůst teploty v řídicí skříni venkovní jednotky", // L3
  "Neobvyklý nárůst teploty chladiče invertoru venkovní jednotky", // L4
  "Detekován nadproud DC v invertoru venkovní jednotky", // L5
  "Sepnula tepelná ochrana desky invertoru", // L8
  "Sepnula ochrana proti zablokování kompresoru", // L9
  "Porucha komunikačního systému venkovní jednotky", // LC
  "Nesymetrie nebo výpadek fáze napájení", // P1
  "Detekováno neobvyklé stejnosměrné napětí", // P3
  "Porucha snímače teploty chladiče venkovní jednotky", // P4
  "Nesoulad nastavení výkonu", // PJ
  "Nedostatek chladiva ve venkovní jednotce", // U0
  "Obrácený sled nebo výpadek fáze", // U1
  "Porucha síťového napětí venkovní jednotky", // U2
  "Vysoušení potěru podlahového topení nebylo správně dokončeno", // U3
  "Problém komunikace mezi vnitřní a venkovní jednotkou", // U4
  "Problém komunikace s uživatelským rozhraním", // U5
  "Porucha přenosu mezi hlavním CPU a CPU invertoru venkovní jednotky", // U7
  "Problém komunikace s LAN adaptérem, pokojovým termostatem nebo USB", // U8
  "Nesprávná kombinace nebo kompatibilita jednotek", // UA
  "Detekováno prohozené potrubí nebo vadné komunikační vedení", // UF
], "Není přenášen žádný chybový kód.", "Pro tento kód není uložen stručný popis.");

MB_DELTA_I18N.cs = mbDeltaValues([
  "při stojícím kompresoru X10A drží hodnotu z posledního běhu; registr HomeHub se dál čte, ale nemá čas měření", // outdoor_air
  "obě hodnoty pocházejí z různých prostorových regulátorů", // room_temp
]);
