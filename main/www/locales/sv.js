// translation-source: 77ca4babacf8c4b7e16312750ff7ba40e6540a6266219ad6f8cd115855c0a897
const svAria = (x) => (l, d) => `${l} — ${x}. ${d}. Använd piltangenterna.`;
const svMb = (a, p = "på") => (r) => `${a}${r ? ` ${p} register ${r}` : ""}.`;
I18N.sv = localeValues([
  /* sys.nodata */ "Inga data",
  /* sys.unreachable */ "Inte tillgänglig",
  /* sys.mb_only */ "X10A frånkopplad — värden från Modbus",
  /* mode.stop */ "Stopp",
  /* mode.heat */ "Uppvärmning",
  /* mode.cool */ "Kylning",
  /* mode.space */ "Rumsdrift",
  /* mode.dhw */ "Varmvatten",
  /* mode.heat_dhw */ "Uppvärmning + varmvatten",
  /* mode.cool_dhw */ "Kylning + varmvatten",
  /* mode.space_dhw */ "Rumsdrift + varmvatten",
  /* sys.unreachable_sub */ "Enheten svarar inte — försöker igen…",
  /* sys.waiting */ "Väntar på värmepumpen…",
  /* sys.operating */ "I drift",
  /* sys.standby */ "Standby — inte i drift",
  /* sys.defrosting */ "Avfrostning",
  /* sys.circulating */ "Cirkulation — kompressor av",
  /* sys.cool_mode */ "Kylläge",
  /* sys.residual_circulating */ "Restvärme cirkulerar — ingen kyleffekt",
  /* sys.bsh_active */ "Tankvärmare aktiv",
  /* sys.disinfecting */ "Tankdesinfektion aktiv",
  /* sys.online */ "Ansluten",
  /* sys.fault */ "Fel",
  /* sys.warning */ "Varning",
  /* sys.fault_line */ (c) => "Fel · " + c + " — kontrollera Daikin-felkoden.",
  /* sys.warning_line */ (c) => "Varning · " + c + " — kontrollera värmepumpen.",
  /* sys.polled */ (s) => `läst för ${s} s sedan`,
  /* config.unreadable_title */ "Tjänsteinställningar kan inte läsas",
  /* config.unreadable_meta */ "Den här versionen kunde inte läsa sparade tjänsteinställningar. Den använder reservinställningar och har inte ersatt den bevarade kopian. Nyare kompatibel firmware kan kanske återställa den. När tjänsteinställningar sparas utan fel ersätts den; att bara spara X10A-stift eller protokoll gör inte det.",
  /* recovery.title */ "Återställningsläge",
  /* recovery.meta_heap */ "Minnesbrist orsakade flera omstarter. Värmepumpsanslutning och MQTT är pausade så webbsidan fungerar. Installera nyare firmware under Inställningar; en omstart genom att bryta och återansluta strömmen provar alla funktioner igen.",
  /* recovery.meta */ "Flera omstarter utlöste återställningsläge med pausad värmepumpsanslutning och MQTT. Kontrollera konfigurationen, särskilt RX/TX-stiften, och starta om.",
  /* rollback.title */ "Wi-Fi-ändringen misslyckades — återställd",
  /* rollback.meta */ (back) => `Nya Wi-Fi-inställningar fungerade inte. Föregående nätverk${back} återställdes och enheten startades om. Kontrollera namn och lösenord under Inställningar → Anslutningar.`,
  /* crash.title_fault */ "Enheten startades om efter ett fel",
  /* crash.title_orphan */ "Kraschrapport från en tidigare omstart",
  /* crash.reset */ "Återställning",
  /* crash.task */ "Uppgift",
  /* crash.fw */ "FW",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "skadad",
  /* crash.stored_dump */ "Sparad kraschrapport",
  /* crash.stored_hint */ "Rapportens ålder och koppling till denna omstart är okända.",
  /* crash.backtrace */ "Anropsstack",
  /* crash.download */ "Ladda ned kraschrapport",
  /* crash.copy */ "Kopiera diagnos",
  /* crash.dismiss */ "Radera rapport",
  /* crash.copied */ "Diagnosen är kopierad — klistra in den i en felrapport",
  /* crash.copy_fail */ "Kopiering misslyckades — öppna /coredump och /diag manuellt",
  /* crash.ask_dump */ "Radera på enheten? Kärndumpen raderas också — ladda den ned först om den ska användas i en felrapport.",
  /* crash.ask */ "Radera den här rapporten på enheten?",
  /* crash.ask_yes */ "Radera",
  /* crash.ask_no */ "Behåll",
  /* crash.deleted */ "Kraschrapport raderad",
  /* crash.delete_fail */ "Enheten kunde inte radera rapporten — den finns fortfarande",
  /* bug.row */ "Rapportera fel",
  /* bug.title */ "Rapportera fel",
  /* bug.intro */ "Beskriv problemet kort. Status, mätningar och logg bifogas efter att nätverksnamn, adresser och servernamn tagits bort.",
  /* bug.what */ "Vad händer?",
  /* bug.need_text */ "Beskriv först vad som händer — en eller två meningar är nog.",
  /* bug.continue */ "Skapa rapport",
  /* bug.step2_title */ "Kontrollera rapporten",
  /* bug.step2 */ "Kontrollera rapporten. Knappen kopierar den och öppnar GitHub-formuläret. Klistra in den i «Device report», svara och skicka.",
  /* bug.collecting */ "Hämtar enhetsdata…",
  /* bug.collect_fail */ "Alla data kunde inte läses — rapporten nedan visar vad som saknas.",
  /* bug.copy */ "Kopiera och öppna GitHub",
  /* bug.download */ "Ladda ned .md",
  /* bug.md_hint */ "Om kopiering misslyckas, ladda ned .md-filen och dra den till «Device report».",
  /* bug.copied */ "Rapport kopierad — klistra in den i «Device report»",
  /* bug.copy_fail */ "Kopiering misslyckades — markera texten nedan och kopiera manuellt",
  /* bug.redacted */ "Nätverksnamn, adresser, broker och servernamn är redan borttagna.",
  /* nav.settings */ "Inställningar",
  /* nav.back */ "Tillbaka",
  /* nav.cards */ "Översiktskort",
  /* nav.diagnosis */ "Diagnostik",
  /* nav.outdoor */ "Utomhusenhet",
  /* nav.settings_alert */ (n) => `Inställningar — ${n} ${n === 1 ? "anslutning har" : "anslutningar har"} fel`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Båda källorna stämmer överens",
  /* src.delta */ (d, u) => `Avvikelse ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "De två källorna är oense om detta tillstånd",
  /* conn.homehub */ "HomeHub",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Anslutningar",
  /* conn.offline */ "Frånkopplad",
  /* conn.disabled */ "Avaktiverad",
  /* conn.connecting */ "Ansluter…",
  /* conn.connected */ "Ansluten",
  /* conn.resolving */ "Slår upp…",
  /* conn.eth_no_cable */ "Ingen kabel",
  /* conn.eth_no_lease */ "Kabel ansluten, ingen adress",
  /* conn.eth_fd */ "Full duplex",
  /* conn.enabled */ "Aktiv",
  /* conn.enabled_noping */ "Aktiv, värden svarar inte på ping",
  /* conn.synced */ "Synkroniserad",
  /* conn.syncing */ "Synkroniserar…",
  /* conn.error */ (e) => "Fel: " + e,
  /* conn.connected_to */ (s) => "Ansluten " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Tryck för att redigera.`,
  /* modbus.err.mdns_not_found */ "Hittade ingen HomeHub via mDNS.",
  /* modbus.err.no_address */ "Ingen HomeHub-adress är angiven.",
  /* modbus.err.resolve_failed */ "HomeHub-adressen kunde inte slås upp.",
  /* modbus.err.connect_timeout */ "Tidsgräns — HomeHub svarar inte.",
  /* modbus.err.connection_refused */ "HomeHub svarar, men Modbus TCP-porten är stängd.",
  /* modbus.err.network_unreachable */ "Ingen nätverksväg till HomeHub.",
  /* modbus.err.host_unreachable */ "HomeHub är inte tillgänglig på nätverket.",
  /* modbus.err.connect_failed */ "Anslutningen till HomeHub misslyckades.",
  /* modbus.err.request_failed */ svMb("Kunde inte skapa Modbus-begäran", "för"),
  /* modbus.err.send_timeout */ svMb("Tidsgräns vid sändning av Modbus-begäran", "till"),
  /* modbus.err.send_failed */ svMb("Kunde inte skicka Modbus-begäran", "till"),
  /* modbus.err.response_timeout */ svMb("Tidsgräns för svar från HomeHub"),
  /* modbus.err.connection_closed */ svMb("HomeHub stängde anslutningen", "vid"),
  /* modbus.err.receive_failed */ svMb("Kunde inte läsa svar från HomeHub"),
  /* modbus.err.invalid_response */ svMb("Ogiltigt Modbus-svar"),
  /* modbus.err.internal_error */ "Internt fel i Modbus-avläsningen.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub avvisar register ${r || "?"} — undantag ${n}: ${why}.`,
  /* modbus.exc.1 */ "ogiltig funktion",
  /* modbus.exc.2 */ "ogiltig registeradress",
  /* modbus.exc.3 */ "ogiltigt värde",
  /* modbus.exc.4 */ "enhetsfel",
  /* modbus.exc.5 */ "begäran bekräftad",
  /* modbus.exc.6 */ "enheten är upptagen",
  /* modbus.exc.8 */ "minnesparitetsfel",
  /* modbus.exc.10 */ "gateway-väg otillgänglig",
  /* modbus.exc.11 */ "målet svarar inte",
  /* modbus.exc.unknown */ "okänd orsak",
  /* card.model */ "Modell",
  /* card.hplink */ "Värmepumpsanslutning",
  /* card.online */ "Ansluten",
  /* card.uptime */ "Drifttid",
  /* card.freeheap */ "Ledigt minne",
  /* card.maxalloc */ "Största lediga block",
  /* card.offline */ "Frånkopplad",
  /* card.protocol */ "Protokoll",
  /* card.rxpin */ "RX-stift",
  /* card.txpin */ "TX-stift",
  /* card.capacity */ "Nominell effekt, utomhusenhet",
  /* card.hplink_help */ "Visar om ESP32 tar emot giltiga svar från värmepumpen via X10A.",
  /* card.protocol_help */ "X10A-I och X10A-S är servicegränssnittets stödda ramformat; firmware identifierar dem från giltiga svar.",
  /* card.rxpin_help */ "GPIO där ESP32 tar emot X10A-data. När anslutningen är frånkopplad startar ett nytt stiftpar automatisk identifiering.",
  /* card.txpin_help */ "GPIO där ESP32 skickar X10A-förfrågningar. RX och TX måste vara olika och stämma med kabeldragningen.",
  /* card.capacity_iu */ "Nominell effekt, inomhusenhet",
  /* card.candidates */ "Möjliga modeller",
  /* card.oueeprom */ "ID för utomhusenhet",
  /* card.checkup */ "Anläggningsdiagnos · 24 t",
  /* service.title */ "Köldkrets vid värme",
  /* service.state.waiting */ "VÄNTAR",
  /* service.state.observing */ "MÄTER",
  /* service.state.limited */ "DELVIS",
  /* service.state.interrupted */ "PAUSAD",
  /* service.short.observing */ (d) => `MÄTER · ${d}`,
  /* service.short.limited */ (d) => `MÄTER · ${d} · Delvis`,
  /* service.reason.unsupported_profile */ "Den här modellen ger inte alla mätvärden som behövs.",
  /* service.reason.compressor_not_running */ "Kompressorn är inte igång.",
  /* service.reason.unsupported_or_unknown_mode */ "Normal rumsuppvärmning är inte bekräftad.",
  /* service.reason.dhw_path */ "Värmepumpen värmer tappvarmvatten.",
  /* service.reason.defrost */ "Utomhusenheten avfrostas.",
  /* service.reason.unit_fault */ "Värmepumpen rapporterar ett fel eller en varning.",
  /* service.reason.special_controller_phase */ "En kort start- eller särskild regleringsfas är aktiv.",
  /* service.reason.missing_fresh_signal */ "Minst ett nödvändigt aktuellt mätvärde saknas.",
  /* service.reason.poll_gap */ "X10A-anslutningen avbröts eller pausades avsiktligt.",
  /* service.window */ (d, n) => `${d} · ${n} aktuella ${n === 1 ? "mätning" : "mätningar"}`,
  /* service.help.observing */ "Registrerar denna värmekörning.",
  /* service.help.limited */ "Passiv registrering av denna värmekörning; tilläggskontext är ofullständig.",
  /* service.help.interrupted */ "Startar om vid nästa lämpliga värmekörning.",
  /* service.common */ "En värmekörning, separat från 24-timmarskontrollerna. Ingen bedömning av köldmediemängd eller normalområden. Ventil: kommando, inte uppmätt position.",
  /* check.fault */ "Anläggningsfel",
  /* check.dhw_loss */ "Tankavsvalning",
  /* check.cycling */ "Kompressorstarter",
  /* check.defrost */ "Avfrostning",
  /* check.pressure */ "Vattentryck",
  /* check.flow */ "Lägsta vattenflöde",
  /* check.flow.lowest */ "Lägsta flöde vid uppvärmning",
  /* check.flow.runup */ "Mätvärden räknas efter minst tio minuters oavbruten rumsuppvärmning.",
  /* check.flow.assessment */ "Installationshandboken anger minsta flöde för varje modell och driftläge. För lågt flöde kan utlösa fel 7H.",
  /* check.flow.explain */ "Flödet visar hur många liter vatten som passerar genom värmepumpen varje minut.",
  /* check.flow.live */ "Nu",
  /* check.flow.show */ "Visa ett lägsta värde i grafen",
  /* check.flow.readout */ (value) => `Under det här tidsavsnittet uppmättes ${value} minst en gång. Rumsuppvärmningen hade då pågått i minst tio minuter.`,
  /* check.flow.locations_missing */ "Tidpunkten för äldre mätningar med det här värdet sparades inte.",
  /* check.flow.unavailable */ "De mätvärden som behövs för att fastställa det lägsta flödet vid uppvärmning saknas.",
  /* check.flow.waiting */ "Väntar på en uppvärmningsperiod som uppfyller mätvillkoren.",
  /* check.heater */ "Elpatroner",
  /* check.retries */ "Skyddsräknare",
  /* check.status.ok */ "OK",
  /* check.status.info */ "INFO",
  /* check.status.warn */ "VARNING",
  /* check.status.collecting */ "SAMLAR IN",
  /* check.status.observation */ "MÄTVÄRDE",
  /* check.status.experimental */ "TESTVIS",
  /* check.status.unavailable */ "EJ AKTUELL",
  /* check.dhw.maximum */ "Kraftigaste tankavsvalning",
  /* check.dhw.waiting */ "Väntar på ett godkänt entimmesfönster.",
  /* check.dhw.no_window */ "Inget slutfört entimmesfönster under de senaste 24 h.",
  /* check.dhw.locations_missing */ "Det finns inget tidsfönster i det aktuella diagrammet för äldre mätvärden med detta värde.",
  /* check.dhw.stale */ "Aktuella mätvärden för tankavsvalningen saknas eller är inaktuella; markerade fönster är historiska.",
  /* check.dhw.shape_step */ "Plötsligt temperaturfall denna timme — passar med varmvattentappning eller snabb omblandning.",
  /* check.dhw.shape_steady */ "Jämn avsvalning utan språng — passar med stilleståndsförlust, självcirkulation eller aktiv cirkulation.",
  /* check.dhw.circ_on */ "Den externa cirkulationspumpen gick denna timme (≥ 5 min), vilket passar med cirkulationsförlust.",
  /* check.dhw.circ_off */ "Den externa cirkulationspumpen var avstängd i minst 2 timmar, vilket gör extern cirkulationsförlust osannolik här.",
  /* check.dhw.pump_off */ "Den interna pumpen stod stilla, så värmeuttag via 3-vägsventilen är osannolikt; R5T ensam bevisar inte orsaken.",
  /* check.dhw.pump_on */ "Den interna värmepumpen gick denna timme, så värmeuttag via 3-vägsventilen förblir möjligt; R5T ensam bevisar inte orsaken.",
  /* check.dhw.circ_label */ "Extern cirkulationspump",
  /* check.dhw.summary_phases */ (n) => `${n} kraftig(a) avsvalningsfas(er) (≥ 0,8 °C/h) på 24 h.`,
  /* check.dhw.summary_circ_on */ (name, withPump, total) => `${name} gick under ${withPump} av ${total} kraftiga faser.`,
  /* check.dhw.summary_circ_off */ (name) => `${name} var avstängd (≥ 2 h) under observerade kraftiga faser.`,
  /* check.detail.value_label */ "Mätning:",
  /* check.detail.assessment_label */ "Bedömning:",
  /* check.detail.ok */ "Regeln utlöstes inte i läsbara data.",
  /* check.detail.info */ "Observerat tips; gränsen förklaras nedan.",
  /* check.detail.warn */ "Enhetsfel eller varaktigt lågtryck observerat.",
  /* check.detail.fault.error */ "Anläggningen rapporterar ett fel nu. Koden visas på kortet «Drift».",
  /* check.detail.fault.warning */ "Anläggningen rapporterar en varning nu, inte ett fel. Koden visas på kortet «Drift».",
  /* check.detail.fault.past */ "Inget meddelande är aktivt nu; ett registrerades under perioden. Att det försvann bevisar varken orsak eller lösning.",
  /* check.detail.fault.past_unknown */ "Ett meddelande registrerades; aktuellt feltillstånd kan inte läsas.",
  /* check.detail.collecting */ (a, b) => `Läsbara signaler: ${a} av ${b} krävs.`,
  /* check.detail.collecting_unknown */ "Ingen aktuell bedömning.",
  /* check.detail.observation */ "Bara observation; ingen allmän OK/VARNING-gräns.",
  /* check.detail.experimental */ "Experimentella räknare; stabilitet utesluter inte begränsning.",
  /* check.detail.unavailable */ "Ingen bedömbar signal i denna profil.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "start" : "starter"}`,
  /* check.cycling.runs */ (n) => `${n} ${n === 1 ? "körning" : "körningar"}`,
  /* check.cycling.mean */ (d) => `Snitt ${d}`,
  /* check.cycling.completed */ "Avslutade körningar",
  /* check.cycling.unclear */ "Oklart syfte",
  /* check.cycling.unclear_hint */ "En körning kan byta driftläge eller bara ha registrerats delvis.",
  /* check.cycling.short */ "Värmekörningarna är korta i genomsnitt.",
  /* check.cycling.normal */ "Värmekörningarna är tillräckligt långa i genomsnitt.",
  /* check.cycling.few */ "För få värmekörningar än så länge.",
  /* check.cycling.waiting */ "Mer data behövs.",
  /* check.cycling.class_unavailable */ "Anläggningen ger för lite information om värmekörningarna.",
  /* check.cycling.unavailable */ "Inga kompressordata.",
  /* check.cycling.stale */ "Mätvärden saknas just nu.",
  /* check.cycling.history_empty */ "Ingen historik ännu.",
  /* check.cycling.timed_starts */ (s) => `${s} med registrerat klockslag`,
  /* check.cycling.run_start */ "Start",
  /* check.cycling.run_stop */ "Stopp",
  /* check.cycling.run_duration */ "Varaktighet",
  /* check.cycling.run_ongoing */ "Pågår",
  /* check.cycling.run_stop_unknown */ "Okänd stopptid",
  /* check.cycling.no_timed_runs */ "Inga starttider har registrerats under den här timmen.",
  /* check.cycling.run_details_unavailable */ "Tider för enskilda körningar saknas för den här timmen.",
  /* check.cycling.saved_starts */ (s) => `Av dessa kommer ${s} från timvärden före omstarten.`,
  /* check.cycling.short_runs */ (n) => `${n} < 5 min`,
  /* check.cycling.col_stop */ "Varför den stannade",
  /* check.cycling.stop_low_flow */ "Framledning över mål · lågt flöde",
  /* check.cycling.stop_low_rps */ "Framledning över mål · lågt varvtal",
  /* check.cycling.stop_req_off */ "Kompressorbehov upphörde",
  /* check.cycling.stop_tgt_drop */ "Måltemperatur sänkt",
  /* check.cycling.stop_defrost */ "Pausad för avfrostning",
  /* check.cycling.stop_defrost_done */ "Avfrostning klar",
  /* check.cycling.stop_dhw */ "Växlade till varmvatten",
  /* check.cycling.stop_normal_dhw */ "Varmvattenkörning avslutad",
  /* check.cycling.stop_normal */ "Normalt stopp",
  /* check.cycling.out_cond */ (v) => ` (${v} ute)`,
  /* check.cycling.find_low_flow */ (minFlow, typ) => `Korta körningar, lågt flöde: över mål på min (${minFlow}${typ}).`,
  /* check.cycling.find_low_rps */ (flow, cond) => `Korta körningar, lågt varv${cond}: över mål tidigt (${flow}).`,
  /* check.cycling.find_control */ "Styrstopp: behov av eller mål sänkt.",
  /* check.cycling.find_defrost_dhw */ (cond) => `Avfrostn. & VV${cond}: paus för avfrostning och VV.`,
  /* check.cycling.find_defrost */ (cond) => `Avfrostning${cond}: paus för avfrostning.`,
  /* check.cycling.find_dhw */ "Varmvatten: paus för VV.",
  /* check.cycling.find_steady */ (flow) => flow ? `Stadig värme: min. ${flow}.` : "Stadig värme.",
  /* check.cycling.pause_tag */ (d) => ` efter ${d} paus`,
  /* check.cycling.cond_tag */ (lwt, tgt) => tgt ? `framledning ${lwt}, mål ${tgt}` : `framledning ${lwt}`,
  /* check.cycling.from_tag */ (prev) => ` från ${prev}`,
  /* check.cycling.rwt_tag */ (rwt) => `retur ${rwt}`,
  /* check.cycling.typ_tag */ (typ) => `, vanligtvis ${typ}`,
  /* check.cycling.s_cool */ (at, pause, lwt, tgt) => `Start ${at}${pause}: framledning ${lwt}, mål ${tgt}, behov på.`,
  /* check.cycling.s_req */ (at, pause, cond) => `Start ${at}${pause} med behov på${cond}.`,
  /* check.cycling.s_tgt */ (at, pause, prev, tgt, cond) => `Start ${at}${pause}: mål höjt${prev} till ${tgt}${cond}.`,
  /* check.cycling.s_defrost_after */ (at, pause, cond) => `Fortsatte ${at}${pause}, avfrostning klar${cond}.`,
  /* check.cycling.s_dhw_after */ (at, pause, cond) => `Fortsatte ${at}${pause}, varmvatten klart${cond}.`,
  /* check.cycling.s_defrost */ (at, pause) => `Start ${at}${pause} för avfrostning.`,
  /* check.cycling.s_dhw */ (at, pause, cond) => `Start ${at}${pause} för varmvatten${cond}.`,
  /* check.cycling.s_gen */ (at, pause, cond) => `Start ${at}${pause}${cond}.`,
  /* check.cycling.e_low_flow */ (to, lwt, tgt, rwt, flow, typ) => `Stopp ${to}: framledning ${lwt} över mål ${tgt}${rwt} vid ${flow}${typ}.`,
  /* check.cycling.e_low_rps */ (to, lwt, tgt, rwt, flow, rps) => `Stopp ${to}: framledning ${lwt} över mål ${tgt}${rwt} vid ${flow} och ${rps}.`,
  /* check.cycling.e_req */ (to, vals) => `Stopp ${to}: behov av${vals}.`,
  /* check.cycling.e_tgt */ (to, prev, tgt, vals) => `Stopp ${to}: mål sänkt${prev} till ${tgt}${vals}.`,
  /* check.cycling.e_defrost_run */ (to, vals) => `Avfrostning klar ${to}${vals}.`,
  /* check.cycling.e_defrost_pause */ (to, vals) => `Stopp ${to} för avfrostning${vals}.`,
  /* check.cycling.e_dhw */ (to, vals) => `Stopp ${to}: byte till varmvatten${vals}.`,
  /* check.cycling.e_norm */ (to, vals) => `Slut ${to}${vals}.`,
  /* check.cycling.e_ongoing */ "Aktiv vid senaste mätning.",
  /* check.cycling.cause_unavailable */ "Inga detaljer",
  /* check.cycling.cause_older_unavailable */ "Sparade start- och stoppuppgifter saknas för de här äldre körningarna.",
  /* check.heater_context.categories */ "nöddriftsflagga|felstatus|avfrostning/återhämtning|varmvattenväg|Silent Mode-flagga|uteluft ≤+2°C|uteluft >+2°C|kompressorn rapporterad stoppad|Silent Mode + uppvärmning vid milt väder",
  /* check.heater_context.notice */ "Minst 15 minuter rapporterad värmartid med Silent Mode, uppvärmning och mild uteluft: preliminär projektanmärkning.",
  /* check.heater_insp.runtime */ "Rapporterad ON-tid (24 h)",
  /* check.heater_insp.zero */ "Ingen ON-tid rapporterad under de senaste 24 h.",
  /* check.heater_insp.zero_cov */ (d) => `Ingen ON-tid rapporterad under ${d} observationstid de senaste 24 h.`,
  /* check.heater_insp.active */ "Rapporterad aktiv under de senaste 24 h.",
  /* check.heater_insp.active_cov */ (d) => `Rapporterad aktiv under ${d} observationstid de senaste 24 h.`,
  /* check.heater_insp.active_ctx */ (list) => `Observerad samtidigt med: ${list}.`,
  /* check.heater_insp.active_unclassified */ "Rapporterad aktiv under de senaste 24 h utan klassificerat sammanhang.",
  /* check.heater_insp.active_unclassified_cov */ (d) => `Rapporterad aktiv under ${d} observationstid de senaste 24 h utan klassificerat sammanhang.`,
  /* check.heater_insp.archive_incomplete */ "24-timmars sammanhangsarkiv är ofullständigt.",
  /* check.heater_insp.stale */ "Aktuella mätvärden saknas eller är inaktuella.",
  /* check.heater_insp.limit */ "Flaggvaraktighet är inte elektrisk energi och fastställer varken orsak eller nödvändighet; saknade signaler eller tillstånd mellan mätpunkter förblir okända.",
  /* check.heater_insp.waiting */ "Väntar på 24-timmars värmarobservationer.",
  /* check.heater_insp.unavailable */ "24-timmars värmardiagnos är inte tillgänglig för denna källa.",
  /* check.min */ (m) => `${m} min`,
  /* check.hour.latest */ "Senaste intervallet",
  /* check.hour.earlier */ (h) => `${h} t tidigare`,
  /* check.hour.other */ "Annat / okänt",
  /* check.hour.gap */ "Mätlucka",
  /* check.hour.coverage */ (observed, possible) => possible ? `${observed} av ${possible} observerat` : `${observed} observerat · förfluten tid okänd`,
  /* check.hour.ending */ (time) => `Intervallslut ${time}`,
  /* check.hour.saved */ (time) => `Sparad tid ${time}`,
  /* check.fault_err */ "Fel aktivt",
  /* check.fault_warn */ "Varning aktiv",
  /* check.fault_past */ "Tidigare aktiv",
  /* check.fault_none */ "Ingen nu",
  /* check.fault_unknown */ "Okänd",
  /* check.fault_past_unknown */ "Tidigare · okänt",
  /* check.fault_since_short */ (d) => `i ${d}`,
  /* check.fault_ago_short */ (d) => `för ${d} sedan`,
  /* check.fault_hero_ok */ (d) => `Inga fel eller varningar rapporterades under ${d} av 24 timmars observation.`,
  /* check.fault_latched_only */ "Lagrad felflagga rapporterad av värmepumpen; ingen tidsstämplad händelse föll inom det registrerade 24-timmarsfönstret.",
  /* check.fault_unit_outdoor */ "Utomhusdel",
  /* check.fault_unit_indoor */ "Inomhusdel",
  /* check.fault_unit_both */ "Ute + innedel",
  /* check.fault_secondary */ (s) => `Även aktivt: ${s}`,
  /* check.fault_stop_ongoing */ "aktiv",
  /* check.fault_stop_unknown */ "oklart",
  /* check.fault_col_code */ "Kod",
  /* check.fault_col_meaning */ "Betydelse",
  /* check.fault_ok_label */ "Felfri",
  /* check.fault_gap_label */ "Omätt",
  /* check.fault_severity_caution */ "Aktsamhet",
  /* check.retry_seen */ "Ökning",
  /* check.retry_none */ "Ingen ökning",
  /* check.retry_hero_none */ (d) => `Ingen av de fem skyddsräknarna ökade under ${d} jämförbar observation.`,
  /* check.retry_hero_none_short */ "Ingen av de fem skyddsräknarna ökade i jämförbara mätningar.",
  /* check.retry_hero_seen */ (d) => `Ökning av en skyddsräknare registrerad under ${d} jämförbar observation.`,
  /* check.retry_hero_seen_short */ "Ökning av en skyddsräknare registrerad i jämförbara mätningar.",
  /* check.retry_hero_collecting */ "Väntar på sammanhängande läsbara värden för alla fem räknare och kompressorstatus.",
  /* check.retry_counters_legacy */ "Minst en räknare ökade, men den här ögonblicksbilden anger inte vilken.",
  /* check.retry_monitored */ "Övervakade skyddsområden",
  /* check.retry_counter.discharge_temp */ "Hetgastemperatur",
  /* check.retry_counter.inv_current */ "Inverterström",
  /* check.retry_counter.high_pressure */ "Högtryck",
  /* check.retry_counter.low_pressure */ "Lågtryck",
  /* check.retry_counter.fin_temp */ "Inverterkylfläns",
  /* service.flow.comp */ "1. Kompressor",
  /* service.flow.high */ "2. Högtryck",
  /* service.flow.valve */ "3. Ventil",
  /* service.flow.low */ "4. Lågtryck",
  /* service.stage.comp */ "1. Kompressor",
  /* service.stage.high */ "2. Högtryckssida",
  /* service.stage.valve */ "3. Expansionsventil",
  /* service.stage.low */ "4. Lågtryckssida",
  /* service.metric.comp */ "Kompressor",
  /* service.metric.disch */ "Hetgastemperatur",
  /* service.metric.eev */ "Expansionsventilkommando",
  /* service.metric.hp */ "Högtryck",
  /* service.metric.lp */ "Lågtryck",
  /* check.hydronic.agree_labels */ "Endast pump R1T−R4T|Endast pump R2T−R1T|Överensstämmelse|Begränsningar",
  /* check.hydronic.agree_reasons */ "Flöde under 5,0 l/min|Kompressor igång|Värmare aktiv eller oklar|3-vägsventil ändrad|Temperaturer ej stabila",
  /* check.hydronic.agree_limits */ "R2T ej tillgänglig|VV-väg inkluderad",
  /* check.hydronic.agree_meta */ "fönster|mätvärden|Endast passiv jämförelse; ej kalibrering; extern värme ej utesluten.",
  /* service.metric.range */ (a, b, c, d) => `min. ${a} · medel ${b} · max. ${c} ${d}`,
  /* service.metric.mean */ (v, u) => `medel ${v} ${u}`,
  /* service.metric.minmax */ (a, b, u) => `min. ${a} · max. ${b} ${u}`,
  /* service.metric.samples */ n => `${n} ${n === 1 ? "inkluderad avläsning" : "inkluderade avläsningar"}`,
  /* service.metric.input_none */ "Ingen vald ingång",
  /* service.metric.meta_limit */ "Antalen är inkluderade avläsningar, inte tidstäckning. En vald ingång bevisar inte en aktuell avläsning.",
  /* service.eev.note */ "Endast kommando · ej uppmätt läge",
  /* service.limits.title */ "Avläsningsantal & gränser",
  /* service.limit.special_phases_unavailable */ "Reglerfassignaler",
  /* service.limit.temperature_context_incomplete */ "Sug-/vätsketemperaturer",
  /* service.limit.pressure_sides_incomplete */ "Båda trycksidor",
  /* service.limit.outdoor_context_incomplete */ "Uteluft-/förångartemp.",
  /* service.row.limits */ "Ofullständig kontext:",
  /* check.detail.period_label */ "Dataperiod:",
  /* check.detail.period */ (a) => `${a}, högst 24 h; möjliga luckor`,
  /* check.detail.age_label */ "Senaste mätningens ålder:",
  /* check.detail.fault.ok */ "Inget aktuellt eller sparat meddelande i läsbara felsignaler.",
  /* check.defrost.normal */ "Kort avfrostning är vanligt i kallt, fuktigt väder. Avfrostningsandelen visar hur stor del av kompressorns drifttid med känd avfrostningsstatus som gick till avfrostning.",
  /* check.defrost.modbus.about */ "Modbus använder samma signal för avfrostning och förberedelse för omstart av kompressorn.",
  /* check.defrost.modbus.normal */ "Signalen är av vid stabil drift. Båda faserna kan aktivera den.",
  /* check.defrost.starts_label */ "Registrerade avfrostningsstarter",
  /* check.defrost.share */ "Avfrostningsandel",
  /* check.defrost.notice */ "Hög avfrostningsandel",
  /* check.detail.pressure.info */ "Lågt",
  /* check.detail.pressure.warn */ "Kritiskt",
  /* check.detail.pressure.ok */ "Normalt",
  /* check.pressure.finding */ "Bekräftat fynd",
  /* check.pressure.sustained */ (a) => `Tryck på ${a} eller lägre i minst 60 sekunder i följd.`,
  /* check.pressure.clear */ "Inget ihållande lågt tryck har bekräftats.",
  /* check.pressure.rules */ "Hur bedöms trycket?",
  /* check.pressure.unavailable */ "X10A-tryckdiagnosen är inte tillgänglig.",
  /* check.pressure.pending */ "Mätvärdet ligger i det kritiska området. Varaktigheten är fortfarande okänd.",
  /* check.detail.source_stale */ "Inget färskt X10A-prov; aktuellt tillstånd okänt. Historik behålls.",
  /* check.detail.current_label */ "≤1,0 bar lågt",
  /* check.detail.minimum_time_label */ "≤0,5 bar kritiskt",
  /* check.detail.coverage_missing */ (a) => `Saknad läsbar tid: ${a} s.`,
  /* values.waiting */ "Väntar på första avläsning…",
  /* values.sg_x10a_mode */ "Smart Grid-läge (X10A-kontakter)",
  /* group.Operation */ "Drift",
  /* group.Domestic hot water */ "Varmvatten",
  /* group.Water circuit */ "Vattenkrets",
  /* group.Refrigerant / outdoor */ "Köldmedium och utomhusenhet",
  /* group.Electrical */ "Elektrisk",
  /* group.Device */ "Enhet",
  /* group.Other values */ "Andra värden",
  /* group.Protection */ "Skydd",
  /* group.Values */ "Värden",
  /* state.on */ "PÅ",
  /* state.off */ "AV",
  /* enum.auto */ "Auto",
  /* enum.heating */ "Uppvärmning",
  /* enum.cooling */ "Kylning",
  /* enum.no_error */ "Inget fel",
  /* enum.fault */ "Fel",
  /* enum.warning */ "Varning",
  /* enum.space_heating */ "Rumsuppvärmning",
  /* enum.dhw */ "Varmvatten",
  /* enum.free_running */ "Fri drift",
  /* enum.forced_off */ "Tvingad av",
  /* enum.recommended_on */ "Rekommenderad på",
  /* enum.forced_on */ "Tvingad på",
  /* enum.space_cooling */ "Rumskylning",
  /* enum.none */ "Ingen",
  /* enum.reduced */ "Reducerad",
  /* enum.automatic */ "Automatisk",
  /* enum.manual */ "Manuell",
  /* enum.actuator */ "Ställdon",
  /* enum.tank_heat_up */ "Tankuppvärmning",
  /* a4.quiet_selection */ "Val av tyst läge",
  /* a4.heating_offset */ "Väderberoende värmekorrigering, huvudzon",
  /* a4.imposed_power_limit */ "Pålagd effektgräns",
  /* a4.pre_phe_outdoor */ "Vattentemperatur före utomhusdelens plattvärmeväxlare",
  /* a4.main_target */ "Värme-/kylmål, huvudzon",
  /* a4.quiet_help */ "Väljer Av, Automatisk eller Manuell tyst drift. Detta visar inte om tyst läge är aktivt nu; vald nivå eller valt schema kan fortfarande ange Av.",
  /* a4.current_help */ "Rapporterar Ingen, Uppvärmning eller Kylning för rumsklimatisering. Läs tillsammans med flaggan för normal drift; detta bevisar inte att kompressorn går.",
  /* a4.limit_help */ "Den pålagda gränsen för elektrisk effekt, inte uppmätt förbrukning. Skyddsdrift kan överskrida denna inställning.",
  /* a4.demand_help */ "Rapporterar Fri drift, Tvingad av, Tvingad på, Rekommenderad på eller Reducerad som svar på energibehov. Dessa sifferkoder skiljer sig från det konfigurerade Smart Grid-valet.",
  /* a4.operation_help */ "Rapporterar Stopp, Tankuppvärmning, Rumsuppvärmning, Rumskylning eller Ställdonsdrift. Detta är ett rapporterat tillstånd, inte bevis på nyttig värmeöverföring.",
  /* a4.heating_offset_help */ "Förskjuter huvudzonens väderberoende värmekurva i kelvin. Detta är en förskjutning, inte en uppmätt temperatur eller hela börvärdet för vattentemperaturen.",
  /* a4.pre_phe_outdoor_help */ "Vattentemperatur före den utomhusplacerade plattvärmeväxlaren. Detta är en sensor på vattensidan, inte uteluftens eller köldmediets temperatur.",
  /* a4.flow_help */ "Flödesskalningen för Altherma 4 är inte verifierad. Värdet i L/min använder befintlig omräkning; jämför med enhetens egen avläsning innan prestandan bedöms.",
  /* a4.pump_help */ "Altherma 4-guiden anger pumphastighet men listar L/min. Enheten % som visas här är ett overifierat antagande; jämför med enhetens egen avläsning.",
  /* a4.pressure_help */ "Tryckskalningen för Altherma 4 är inte verifierad. Värdet i bar använder befintlig omräkning; jämför med enhetens egen avläsning innan trycket bedöms.",
  /* a4.demand_response */ "Läge för efterfrågerespons",
  /* a4.unit_operation */ "Enhetens drifttillstånd",
  /* a4.cooling_offset */ "Väderberoende kylkorrigering, huvudzon",
  /* a4.add_target */ "Värme-/kylmål, extrazon",
  /* a4.abnormality_counter */ "Användarfelräknare",
  /* a4.cooling_offset_help */ "Förskjuter huvudzonens väderberoende kylkurva i kelvin. Detta är en justering, inte en uppmätt temperatur eller det fullständiga framledningsmålet.",
  /* a4.abnormality_help */ "Ackumulerat antal användaravvikelser registrerade av enheten. Ett oförändrat nollskilt värde speglar tidigare händelser, inte ett aktivt fel; kontrollera enhetsstatus och felkod.",
  /* enum.unknown */ (n) => `Okänd (${n})`,
  /* chip.space_on */ "Rumsdrift PÅ",
  /* chip.space_off */ "Rumsdrift AV",
  /* chip.quiet */ "Tyst",
  /* schem.sg_boost */ "BOOST",
  /* sg.mode0 */ "Fri drift",
  /* sg.mode1 */ "Tvingad av",
  /* sg.mode2 */ "Rekommenderad på",
  /* sg.mode3 */ "Tvingad på",
  /* schem.to_dhw */ "3WV → tank",
  /* schem.to_space */ "3WV → rum",
  /* normal.label */ "Normalt:",
  /* meaning.label */ "Tolkning:",
  /* hist.title */ "Senaste 24 timmar",
  /* hist.recorded */ (h) => `Registrerad · ${h} t`,
  /* hist.now */ "nu",
  /* hist.ago */ (h) => `för ${h} t sedan`,
  /* hist.retained */ "Senaste mottagna mätvärdet",
  /* hist.before_retained */ (h) => `${h} h före det senaste mottagna mätvärdet`,
  /* hist.loading */ "Laddar historik…",
  /* hist.none */ "Inga mätningar är registrerade ännu.",
  /* hist.err */ "Historiken är otillgänglig.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "mätlucka" : "mätluckor"} — inte mätt`,
  /* hist.nm */ "inte mätt",
  /* hist.rel */ (h) => `för ${h} t sedan`,
  /* hist.held */ "Utomhusenhet i vila",
  /* hist.heldnote */ (h) => `${h} t i vila — inte mätt`,
  /* hist.aria */ (l) => `${l} — 24-timmars historik. Använd piltangenterna för att läsa mätpunkter.`,
  /* hist.aria_pinned */ (l, r) => `${l} — 24-timmars historik. Fäst värde: ${r}. Tryck igen för att lossa.`,
  /* hist.pin_hint */ "tryck för att fästa",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} t`,
  /* hist.duration_hm */ (h, m) => `${h} t ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · ca. ${d}`,
  /* hist.state_active */ "Aktiv",
  /* hist.state_off */ "Av",
  /* val.since */ (d) => `i ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} inte observerad`,
  /* hist.modbus_plateau */ (when, d) => `Register oförändrat ${when} · ca ${d} · okänd mätålder`,
  /* hist.boost_total */ (d) => `Boost aktiv · ${d}`,
  /* hist.boost_none */ "Ingen boost i perioden.",
  /* hist.boost_ago_range */ (a, b) => `för ${a}–${b} t sedan`,
  /* hist.boost_active */ "Boost aktiv",
  /* hist.boost_inactive */ "Boost av",
  /* hist.boost_aria */ svAria("Smart Grid-historik med fyra lägen"),
  /* hist.defrost_total */ (d) => `5-minutersblock med avfrostning · ${d}`,
  /* hist.defrost_none */ "Ingen avfrostning registrerad i perioden.",
  /* hist.defrost_active */ "Avfrostning aktiv",
  /* hist.defrost_inactive */ "Avfrostning av",
  /* hist.defrost_aria */ svAria("avfrostningshistorik"),
  /* hist.quiet_total */ (d) => `Tyst läge registrerat · ${d} i 5-minutersintervall`,
  /* hist.quiet_none */ "Inget tyst läge registrerat under perioden.",
  /* hist.quiet_active */ "Tyst läge aktivt",
  /* hist.quiet_inactive */ "Tyst läge av",
  /* hist.quiet_aria */ svAria("historik för tyst läge"),
  /* hist.heater_total */ (d) => `Tankvärmare registrerad · ${d} i 5-minutersintervall`,
  /* hist.heater_none */ "Ingen tankvärmare registrerad i perioden.",
  /* hist.heater_active */ "Tankvärmare aktiv",
  /* hist.heater_inactive */ "Tankvärmare av",
  /* hist.heater_aria */ svAria("historik för tankvärmare"),
  /* hist.preheat_total */ (d) => `Förvärmning av tank registrerad · ${d} i 5-minutersintervall`,
  /* hist.preheat_none */ "Ingen förvärmning av tank registrerad i perioden.",
  /* hist.preheat_active */ "Förvärmning aktiv",
  /* hist.preheat_inactive */ "Förvärmning av",
  /* hist.preheat_aria */ svAria("X10A-historik för tankförvärmning"),
  /* hist.disinfection_total */ (d) => `Desinfektion registrerad · ${d} i 5-minutersintervall`,
  /* hist.disinfection_none */ "Ingen tankdesinfektion registrerad i perioden.",
  /* hist.disinfection_active */ "Desinfektion aktiv",
  /* hist.disinfection_inactive */ "Desinfektion av",
  /* hist.disinfection_aria */ svAria("HomeHub-historik för tankdesinfektion"),
  /* hist.buh_total */ (d) => `Tillsatsvärmare registrerad · ${d} i 5-minutersintervall`,
  /* hist.buh_none */ "Ingen användning av tillsatsvärmare registrerad under perioden.",
  /* hist.buh_active */ "Tillsatsvärmare aktiv",
  /* hist.buh_inactive */ "Tillsatsvärmare av",
  /* hist.buh_step1 */ "Steg 1",
  /* hist.buh_step2 */ "Steg 2",
  /* hist.buh_aria */ svAria("historik för tillsatsvärmare"),
  /* hist.valve_dhw_total */ (d) => `Varmvatten · ${d}`,
  /* hist.valve_space_total */ (d) => `Rumskrets · ${d}`,
  /* hist.valve_none */ "Inget varmvattenläge under perioden.",
  /* hist.valve_dhw */ "Varmvatten",
  /* hist.valve_space */ "Rumskrets",
  /* hist.valve_aria */ svAria("historik för 3-vägsventil"),
  /* hist.circ_total */ (d) => `Pumpdrift registrerad · ${d} i 5-minutersintervall`,
  /* hist.circ_none */ "Ingen pumpdrift registrerad i perioden.",
  /* hist.circ_on */ "Går",
  /* hist.circ_off */ "Stoppad",
  /* hist.circ_unavailable */ "Otillgänglig",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "fas" : "faser"} · otillgänglig`,
  /* hist.circ_aria */ svAria("historik för cirkulationspump"),
  /* hist.valve2_on_total */ (d) => `2WV-utgång PÅ · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV-utgång AV · ${d}`,
  /* hist.valve2_on */ "2WV-utgång PÅ",
  /* hist.valve2_off */ "2WV-utgång AV",
  /* hist.valve2_none */ "Inget PÅ-tillstånd för 2WV-utgången under perioden.",
  /* hist.valve2_aria */ svAria("historik för 2WV-utgång"),
  /* hist.flow_switch_total */ (d) => `X10A-status PÅ · ${d} i 5-minutersintervall`,
  /* hist.flow_switch_on */ "X10A-status PÅ",
  /* hist.flow_switch_off */ "X10A-status AV",
  /* hist.flow_switch_none */ "Inget PÅ-tillstånd för denna X10A-status under perioden.",
  /* hist.flow_switch_aria */ svAria("historik för flödesvakt"),
  /* hist.comp_total */ (d, n) => `Kompressor · ${d} · ${n} ${n === 1 ? "fas" : "faser"}`,
  /* hist.comp_none */ "Ingen kompressordrift observerades under den registrerade perioden.",
  /* hist.comp_active */ "Kompressor igång",
  /* hist.comp_inactive */ "Kompressor av",
  /* hist.comp_aria */ svAria("HomeHub-kompressorhistorik"),
  /* hist.mb_defrost_total */ (d) => `Avfrostning / omstart · ${d}`,
  /* hist.mb_defrost_none */ "Ingen avfrostnings- eller omstartsfas observerades under den registrerade perioden.",
  /* hist.mb_defrost_active */ "Avfrostning / omstart",
  /* hist.mb_defrost_inactive */ "Normal / stillestånd",
  /* hist.mb_defrost_aria */ svAria("HomeHub-historik för avfrostning/omstart"),
  /* hist.pump_total */ (d) => `Pump · ${d}`,
  /* hist.pump_none */ "Ingen cirkulationspumpsdrift observerades under den registrerade perioden.",
  /* hist.pump_active */ "Pump igång",
  /* hist.pump_inactive */ "Pump av",
  /* hist.pump_aria */ svAria("HomeHub-historik för cirkulationspump"),
  /* toast.saved */ "Sparad",
  /* toast.no_changes */ "Inga ändringar",
  /* toast.reboot */ "Startar på nytt — ansluter igen…",
  /* toast.rebooted */ "Startades om — anslut enheten igen",
  /* board.draft_stale */ "Kortets inställningar har ändrats. Öppna redigeraren igen innan du sparar.",
  /* toast.busy_retry */ "Enheten är upptagen — försök direkt igen",
  /* toast.unreachable */ "Enheten svarar inte",
  /* toast.rejected */ "Avvisad",
  /* toast.applying */ "Föregående ändring tillämpas fortfarande…",
  /* toast.check_wifi */ "Kontrollera Wi-Fi-inställningarna",
  /* toast.check_broker */ "Kontrollera broker-adressen",
  /* toast.check_syslog_port */ "Kontrollera Syslog-porten",
  /* toast.verifying_mqtt */ "Kontrollerar MQTT-anslutningen…",
  /* toast.saving_syslog */ "Sparar Syslog-inställningar…",
  /* toast.saving_ntp */ "Sparar NTP-inställningar…",
  /* toast.trying_pins */ "Försöker stift…",
  /* toast.saving_board */ "Sparar kortmaskinvara…",
  /* ota.uptodate */ "uppdaterad",
  /* ota.check_failed */ "Kontroll misslyckades",
  /* ota.starting */ "startar…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "Startar på nytt…",
  /* ota.failed */ "Uppdatering misslyckades",
  /* ota.timeout */ "Tidsgräns",
  /* ota.cancelled */ "avbruten",
  /* ota.busy */ "Enheten är upptagen",
  /* ota.replaced */ "Uppdateringsjobbet har ändrats — kontrollera igen",
  /* ota.unreachable */ "Enheten svarar inte",
  /* ota.active_title */ "Firmwareuppdatering",
  /* ota.active_sub */ (detail) => `Installerar · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Installerar · ${detail} · senast mottagna status`,
  /* ota.snapshot_title */ "Firmwareuppdatering",
  /* ota.snapshot_label */ "Datastatus",
  /* ota.snapshot_value */ "Cachad",
  /* ota.snapshot_help */ "Senast mottagna status före denna sidladdning. Direktdata kan stoppas under installationen; inställningarna är låsta fram till omstart.",
  /* ota.reload_hint */ "installerad — ladda sedan på nytt",
  /* ota.dialog_title */ "Firmwareuppdatering",
  /* ota.switch_title */ "Byt firmwareversion",
  /* ota.changes_title */ "Ändringar i den här uppdateringen",
  /* ota.no_changes */ "Ingen ändringslogg tillhandahölls för den här uppdateringen.",
  /* ota.install_help */ "Enheten laddar ned och installerar den signerade avbildningen och startar om. Om den nya firmwareversionen inte ansluter till nätet återställer enheten automatiskt den aktuella versionen.",
  /* ota.switch_help */ "Den här versionen är äldre eftersom en annan uppdateringskanal har valts. Signaturen verifieras före installationen. Om den äldre versionen inte ansluter till nätet återställer enheten automatiskt den aktuella versionen.",
  /* ota.install */ "Installera uppdatering",
  /* ota.switch */ "Installera äldre version",
  /* aria.ota */ "Sök efter firmwareuppdateringar",
  /* ota.title_check */ "Tryck för att söka efter firmwareuppdateringar",
  /* ota.title_avail */ (v) => `Uppdatering v${v} tillgänglig — tryck för att installera`,
  /* mq.err_format */ "Ange värd:port, t.ex. 192.168.1.10:1883, eller mqtts://värd:8883 för TLS",
  /* sl.err_port */ "Porten måste vara ett heltal från 1 till 65535, till exempel logs.example.com:514.",
  /* btn.saving */ "Sparar…",
  /* btn.verifying */ "Kontrollerar…",
  /* btn.save */ "Spara",
  /* btn.cancel */ "Avbryt",
  /* btn.close */ "Stäng",
  /* schem.card_aria */ "Live systemschema: utomhusenhet, köldmediekrets, plattvärmeväxlare, vattenkrets med tillsatsvärmare och 3-vägsventil, varmvattentank och rumskrets",
  /* schem.group_aria */ "Live systemschema — välj ett värde eller en komponent för en förklaring",
  /* schem.outdoor_unit */ "Utomhusenhet",
  /* schem.defrost_pill */ "Avfrostning",
  /* schem.outdoor */ "Ute",
  /* insp.close */ "Stäng",
  /* schem.defrost_transfer */ "Vid bekräftad avfrostning kan värme överföras från vattnet till köldmediet. Rören visar den riktningen bara när flödet och temperaturerna just nu stöder den.",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "VV-TANK",
  /* schem.set */ "Mål",
  /* schem.bsh_label */ "Tankvärmare",
  /* schem.space_circuit */ "Rumskrets",
  /* schem.heating */ "Värme",
  /* schem.cooling */ "Kylning",
  /* schem.pump */ "Pump",
  /* schem.return */ "R4T",
  /* schem.room */ "Rum",
  /* schem.flow_rate */ "Vattenflöde",
  /* schem.water_press */ "Vattentryck",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "Flödesv.",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Wi-Fi-konfiguration",
  /* wifi.ssid */ "Wi-Fi-nätverk · SSID",
  /* wifi.pass */ "Wi-Fi-lösenord",
  /* wifi.err_ssid */ "SSID måste vara 1–32 UTF-8-byte",
  /* wifi.err_pass */ "Lösenordet måste vara tomt för öppna nätverk, annars 8–63 UTF-8-byte",
  /* wifi.hint */ "Ange Wi-Fi-namnet. Om anslutningen misslyckas återställer enheten automatiskt de föregående inställningarna.",
  /* mqtt.title */ "MQTT-broker",
  /* mqtt.hostport */ "Värd : port",
  /* mqtt.user */ "Användarnamn · valfritt",
  /* mqtt.pass */ "Lösenord · valfritt",
  /* mqtt.clear */ "Ta bort sparad inloggning — anslut anonymt",
  /* mqtt.hint */ "Användarnamn eller lösenord kräver krypterad TLS (mqtts://, t.ex. mqtts://värd:8883). Låt värden stå tom för att avaktivera MQTT.",
  /* mqtt.base */ "Basistopic",
  /* mqtt.base_hint */ "Använd ett unikt basistopic per enhet. Delat topic blandar tidsserier och Home Assistant-enhet; ett byte ger nytt namn och lämnar gamla kvarhållna MQTT-topic kvar.",
  /* err.mqtt_base_too_long */ "Basistopic är för långt.",
  /* err.mqtt_base_wildcard */ "Basistopic får inte innehålla + eller # — brokern publicerar inte till sådana prenumerationsjokertecken.",
  /* err.mqtt_base_reserved */ "Basistopic får inte börja med $ — den grenen tillhör brokern.",
  /* err.mqtt_base_slash */ "Basistopic får inte börja eller sluta med snedstreck.",
  /* err.mqtt_base_control */ "Basistopic får inte innehålla kontrolltecken.",
  /* err.mqtt_base_space */ "Basistopic får inte innehålla blanksteg.",
  /* err.mqtt_base_empty_segment */ "Basistopic får inte innehålla ett tomt segment (//).",
  /* err.mqtt_base_not_sluggable */ "Basistopic måste innehålla minst en bokstav eller siffra. Det används i Home Assistant-ID:n för att skilja enheter åt.",
  /* mqtt.err.waiting_x10a */ "Inget svar från värmepumpen via X10A ännu — kontrollera kabeldragning, GND och RX/TX-stift.",
  /* mqtt.err.task_alloc */ "MQTT-uppgiften kunde inte starta — starta om enheten och kontrollera diagnosen.",
  /* mqtt.err.transport */ "TLS-/TCP-anslutningen till brokern misslyckades.",
  /* mqtt.err.refused */ "Brokern avvisade anslutningen — kontrollera användarnamn och lösenord.",
  /* mqtt.err.connection */ "Anslutningen till MQTT-brokern misslyckades.",
  /* dyn.state_gate */ "Okänt anläggningstillstånd",
  /* dyn.state_mode */ "Okänt värme-/kylläge",
  /* env.title */ "Utomhussensor",
  /* env.card */ "Uteklimat",
  /* env.none */ "Ingen sensor",
  /* env.temperature */ "Temperatur",
  /* env.humidity */ "Luftfuktighet",
  /* env.pressure */ "Lufttryck",
  /* env.sensor_state */ "Sensor",
  /* env.live */ "Nu",
  /* env.collecting */ "Mäter…",
  /* env.history_title */ "ENV III-mätningar",
  /* env.history_help */ "ESP32 sparar temperatur, fukt och tryck i rullande 24-timmarsserier med fem minuters upplösning.",
  /* env.history_scales */ "egna skalor",
  /* env.unavailable */ "Sensorn svarar inte",
  /* env.err_pins */ "SDA och SCL måste vara olika, giltiga stift",
  /* env.saving */ "Sparar inställning för utomhussensor…",
  /* env.checking */ "Kontrollerar ENV III…",
  /* env.err_not_reachable */ "ENV III svarar inte på de valda SDA/SCL-stiften.",
  /* env.err_sht30 */ "Temperatur-/fuktgivaren i ENV III svarar inte på dessa stift.",
  /* env.err_qmp6988 */ "Tryckgivaren i ENV III svarar inte på dessa stift.",
  /* env.err_disable_first */ "Välj först «Ingen sensor» och spara innan du ändrar SDA/SCL.",
  /* env.pins_hint */ "SDA är datalinjen (gul Grove-ledare), SCL är klocklinjen (vit). Om valda GPIO är omkastade provar firmware motsatt riktning och sparar den som fungerar.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: välj två stift bland GPIO5–GPIO8 och GPIO38. Grove GPIO2/1 visas bara när X10A inte använder dem; serie och I²C kan inte dela stift. GPIO39 stöds inte.",
  /* circ.title */ "Källa för cirkulationspump",
  /* circ.row */ "Cirkulationspump för varmvatten",
  /* circ.default_name */ "Cirkulationspump",
  /* circ.name */ "Namn",
  /* circ.topic */ "MQTT-topic",
  /* circ.power_path */ "JSON-sökväg för effekt",
  /* circ.time_path */ "JSON-sökväg för tidsstämpel",
  /* circ.power_help */ "Faktisk aktiv effekt i watt; reläutgången används inte.",
  /* circ.time_help */ "Mättid som RFC3339 eller Unix-sekunder.",
  /* circ.on_threshold */ "PÅ från · W",
  /* circ.off_threshold */ "AV till · W",
  /* circ.max_age */ "Maximal ålder · sekunder",
  /* circ.confirm */ "Bekräftelse · sekunder",
  /* circ.hint */ "Endast avläsning. Vid lagring kontrolleras först ett aktuellt MQTT-värde; kontakten styrs aldrig.",
  /* circ.settings_help */ "Kortet kopplar faktisk pumpeffekt till rensade timslånga tankfönster. Det observerar bara och styr aldrig kontakten.",
  /* circ.not_configured */ "Inte konfigurerad",
  /* circ.unavailable */ "Otillgänglig",
  /* circ.broker_off */ "Ingen MQTT-broker",
  /* circ.running */ "Går",
  /* circ.stopped */ "Stoppad",
  /* circ.checking */ "Kontrollerar",
  /* circ.stale */ "För gammal",
  /* circ.waiting */ "Väntar på meddelande",
  /* circ.detail.source */ "Källa",
  /* circ.detail.power */ "Aktiv effekt",
  /* circ.detail.state */ "Registrerat tillstånd",
  /* circ.detail.age */ "Mätningens ålder",
  /* circ.delete */ "Radera",
  /* circ.deleting */ "Raderar…",
  /* circ.deleted */ "Källan för cirkulationspumpen är raderad",
  /* circ.saved */ "Källan för cirkulationspumpen är sparad",
  /* circ.test_failed */ "Ingen läsbar, aktuell pumpeffekt mottagen",
  /* circ.err_topic */ "Ange ett exakt MQTT-topic utan jokertecknen + eller #",
  /* circ.err_power_path */ "Ange JSON-sökvägen för aktiv effekt, t.ex. apower",
  /* circ.err_time_path */ "Ange JSON-sökvägen för tidsstämpel, t.ex. aenergy.minute_ts",
  /* circ.err_max_age */ "Maximal ålder måste vara ett heltal från 10 till 3600 sekunder",
  /* circ.err_confirm */ "Bekräftelsen måste vara ett heltal från 1 till 600 sekunder",
  /* circ.err_threshold */ "Effektgränserna kan ha högst en decimal",
  /* circ.err_order */ "PÅ-gränsen måste vara högre än AV-gränsen",
  /* syslog.title */ "Syslog-server",
  /* syslog.hostport */ "Värd : port",
  /* syslog.hint */ "Ange Syslog-server som värdnamn eller IP med port. Lämna fältet tomt för att avaktivera Syslog.",
  /* ntp.title */ "NTP-server",
  /* ntp.server */ "Server",
  /* ntp.hint */ "Värdnamn eller IP till NTP-servern som synkroniserar klockan. Tomt fält återställer firmwarestandard.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Värd · IP eller .local-namn",
  /* homehub.port */ "Port",
  /* homehub.unit */ "Enhetens-ID",
  /* homehub.hint */ "Ny firmware söker HomeHub en gång vid första nätverksstart. Sök här eller ange adressen. Sparad tom adress avaktiverar sökning, Modbus och beroende diagnoser. Standard: port 502, enhets-ID 1. Endast avläsning.",
  /* hh.search */ "Sök",
  /* hh.searching */ "Söker…",
  /* hh.found */ (host) => `Hittade HomeHub: ${host}`,
  /* hh.not_found */ "Hittade ingen HomeHub — ange adressen manuellt.",
  /* hh.saved */ "Modbus-inställningar sparade",
  /* hh.err_port */ "Porten måste vara från 1 till 65535",
  /* hh.err_unit */ "Enhetens-ID måste vara från 1 till 247",
  /* board.title */ "Kortmaskinvara",
  /* board.ledtype */ "Status-LED",
  /* board.none */ "Ingen",
  /* board.reset_section */ "Återställningsknapp",
  /* board.env3_section */ "ENV III · utomhussensor",
  /* board.preset */ "Kort",
  /* board.preset_custom */ "Egendefinierat",
  /* board.not_selected */ "Inte valt",
  /* board.led_gpio */ "Enkel LED · GPIO",
  /* board.led_ws2812 */ "Adresserbar RGB-LED · WS2812",
  /* board.ledpin */ "LED-stift",
  /* board.btnpin */ "Stift för återställningsknapp",
  /* board.ledlegend_rgb */ "LED-färger och blinkmönster",
  /* board.ledlegend_gpio */ "LED-blinkmönster",
  /* board.led_rgb_off */ "Av — inget nätverk aktivt.",
  /* board.led_rgb_setup */ "Blå, blinkar långsamt — installationsportal aktiv.",
  /* board.led_rgb_connecting */ "Gul, blinkar snabbt — ansluter till nätverket.",
  /* board.led_rgb_healthy */ "Grön, fast — X10A och, om konfigurerat, MQTT anslutna.",
  /* board.led_rgb_bus_down */ "Röd, dubbelblinkning — X10A frånkopplad eller återställningsläge.",
  /* board.led_rgb_mqtt_down */ "Orange, blinkar — X10A ansluten, MQTT frånkopplad.",
  /* board.led_rgb_wipe_armed */ "Röd, mycket snabb blinkning — radering redo; släpp för att avbryta.",
  /* board.led_rgb_wiping */ "Vit, fast — fabriksåterställning/dataradering; koppla inte från strömmen.",
  /* board.led_gpio_off */ "Av — inget nätverk aktivt.",
  /* board.led_gpio_setup */ "Långsam blinkning — installationsportal aktiv.",
  /* board.led_gpio_connecting */ "Snabb blinkning — ansluter till nätverket.",
  /* board.led_gpio_healthy */ "Fast sken — X10A och, om konfigurerat, MQTT anslutna.",
  /* board.led_gpio_bus_down */ "Dubbelblinkning — X10A frånkopplad eller återställningsläge.",
  /* board.led_gpio_mqtt_down */ "Medelsnabb blinkning — X10A ansluten, MQTT frånkopplad.",
  /* board.led_gpio_wipe_armed */ "Mycket snabb blinkning — radering redo; släpp för att avbryta.",
  /* board.led_gpio_wiping */ "Fast sken efter snabb blinkning — fabriksåterställning/dataradering; koppla inte från strömmen.",
  /* board.ledinv */ "Aktiv vid LOW — LED lyser vid låg stiftnivå",
  /* board.btninv */ "Aktiv vid LOW — knappen drar stiftet till GND",
  /* board.hint */ "Håll knappen intryckt i 5 sekunder för att återställa fabriksinställningarna. Om historikjournalen inte är redo raderas ingenting. Återställningen raderar Wi-Fi-inställningar och övriga inställningar, sparad historik, tillståndstider, den råa kraschdumpen och den sparade posten för MQTT-rensning. Inställningarna för kort, LED och knapp behålls om möjligt. Om raderingen misslyckas kan en del data redan ha raderats. Enheten startar om först när all radering har lyckats. Kontrollera /diag om återställningen inte startar eller slutförs. Välj «Ingen» om ingen knapp är ansluten.",
  /* card.hardware */ "Maskinvara",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite är ett kompakt ESP32-S3-kort med inbyggd WS2812 RGB-status-LED.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 är ett kompakt ESP32-S3-kort från Seeed Studio.",
  /* card.hw_board_other */ (name) => `Valt kort: ${name}.`,
  /* card.hw_active_low */ "aktiv vid LOW",
  /* card.hw_active_high */ "aktiv vid HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} på GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Inte konfigurerad.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Inte konfigurerad.",
  /* card.hw_env_detail */ (sda, scl) => `SDA på GPIO${sda}, SCL på GPIO${scl}.`,
  /* card.hw_env_disabled */ "Inte konfigurerad.",
  /* card.firmware */ "Version",
  /* card.channel */ "Uppdateringskanal",
  /* card.firmware_help */ "Versionen som körs på ESP32. Tryck på värdet för att söka efter en signerad firmwareavbildning på vald kanal.",
  /* card.channel_help */ "Stabil följer utgivna versioner; Utveckling följer senaste firmware-relevanta sammanslagning. Kanalbyte kontrolleras direkt.",
  /* chan.release */ "Stabil",
  /* chan.dev */ "Utveckling",
  /* chan.saved */ (c) => `Uppdateringskanal: ${c}`,
  /* card.proto_title */ "Protokoll",
  /* card.fw_title */ "Firmware",
  /* settings.diagnostics */ "Anläggningsdiagnos",
  /* card.language */ "Språk",
  /* card.language_help */ "Webbläsare använder webbläsarens språk. Ett språkval sparar ett fast gränssnittsspråk för hela enheten.",
  /* card.diagnostics */ "Anläggningsdiagnos",
  /* card.diagnostics_help */ "Aktiverar 24-timmars anläggningsdiagnos och valfri övervakning av cirkulationspumpens effekt.",
  /* diagnostics.off */ "Av",
  /* diagnostics.saved_on */ "Anläggningsdiagnos aktiverad — insamling startar nu",
  /* diagnostics.saved_off */ "Anläggningsdiagnos avaktiverad — insamling stoppad",
  /* probe.toggle */ "Protokolldiagnos",
  /* probe.intro */ "Direkt avläsning av en X10A-registersida med valfri omvandlare-tolkning.",
  /* probe.request */ "Begäran",
  /* probe.register */ "Register",
  /* probe.manual */ "Manuell inmatning",
  /* probe.page */ "Registersida",
  /* probe.offset */ "Nyttolastförskjutning",
  /* probe.size */ "Fältbredd",
  /* probe.byte */ "Byte",
  /* probe.bytes */ "Byte",
  /* probe.converter */ "Omvandlare",
  /* probe.page_help */ "Hex eller decimal · 0…255",
  /* probe.offset_help */ "Index i nyttolast · 0…31",
  /* probe.size_help */ "Byte som ska avkodas",
  /* probe.converter_auto */ "Automatisk",
  /* probe.converter_auto_help */ (size) => `Provar alla implementerade omvandlare för ${size} byte.`,
  /* probe.conv_raw_byte */ "Råbyte · 0…255",
  /* probe.conv_unsigned_byte */ "råbyte utan tecken",
  /* probe.conv_tenth_byte */ "råbyte × 0,1",
  /* probe.conv_unsigned_half_byte */ "byte utan tecken × 0,5",
  /* probe.conv_signed_raw_le */ "heltal med tecken · Little-Endian",
  /* probe.conv_signed_raw_be */ "heltal med tecken · Big-Endian",
  /* probe.conv_signed_256_le */ "med tecken ÷ 256 · Little-Endian",
  /* probe.conv_signed_256_be */ "med tecken ÷ 256 · Big-Endian",
  /* probe.conv_signed_tenth_le */ "med tecken × 0,1 · Little-Endian",
  /* probe.conv_signed_tenth_be */ "med tecken × 0,1 · Big-Endian",
  /* probe.conv_signed_tenth_nodata_le */ "med tecken × 0,1 · Little-Endian · 0x8000 = Inga data",
  /* probe.conv_signed_tenth_nodata_be */ "med tecken × 0,1 · Big-Endian · 0x8000 = Inga data",
  /* probe.conv_signed_128_le */ "med tecken ÷ 256 × 2 · Little-Endian",
  /* probe.conv_signed_128_be */ "med tecken ÷ 256 × 2 · Big-Endian",
  /* probe.conv_signed_half_be */ "med tecken × 0,5 · Big-Endian",
  /* probe.conv_signed_hundredth_be */ "med tecken × 0,01 · Big-Endian",
  /* probe.conv_unsigned_raw_le */ "heltal utan tecken · Little-Endian",
  /* probe.conv_unsigned_raw_be */ "heltal utan tecken · Big-Endian",
  /* probe.conv_unsigned_half_be */ "utan tecken × 0,5 · Big-Endian",
  /* probe.conv_saturation */ "tryck → mättnadstemperatur",
  /* probe.conv_raw_fan */ "råbyte / fläktsteg",
  /* probe.conv_capacity */ "effektklass för inomhusenhet",
  /* probe.conv_eeprom_digit */ "rått EEPROM-siffer",
  /* probe.conv_eeprom_pair */ "rått EEPROM-sifferpar",
  /* probe.conv_bits_high */ "bit 4–6 · 3-bits räknare",
  /* probe.conv_bits_low */ "bit 0–2 · 3-bits räknare",
  /* probe.conv_operation_mode */ "driftläge",
  /* probe.conv_error_class */ "felklass",
  /* probe.conv_error_code */ "Daikin-felkod",
  /* probe.conv_indoor_mode */ "inomhusenhetsläge · övre nibble",
  /* probe.conv_hybrid_mode */ "hybriddrift",
  /* probe.conv_bit */ (bit) => `Bit ${bit} · 0 eller 1`,
  /* probe.conv_unknown */ "okänd omvandlare",
  /* probe.send */ "Läs register",
  /* probe.querying */ "Frågar…",
  /* probe.action_note */ "En begäran per avläsningscykel. Låst under OTA.",
  /* probe.catalog_loading */ "Laddar aktiv profil…",
  /* probe.catalog_empty */ "Inga registerdefinitioner tillgängliga.",
  /* probe.catalog_error */ "Kunde inte läsa profilregister.",
  /* probe.catalog_profile */ (profile) => `Profil: ${profile}`,
  /* probe.catalog_fallback */ (definition, profile) => `main/def: ${definition} · profil: ${profile}`,
  /* probe.response */ "Svar",
  /* probe.frame */ "Ram",
  /* probe.payload */ "Nyttolast",
  /* probe.slice */ "Valde byte",
  /* probe.interpretation */ "Tolkning",
  /* probe.response_for */ (reg) => `Svar från register ${reg}`,
  /* probe.payload_marked */ "Nyttolast · markerat urval",
  /* probe.slice_note */ (offset, size, slice) => `Förskjutning ${offset} · ${size} byte · 0x${String(slice).replace(/\s+/g, "")}`,
  /* probe.full_frame */ "Full ram",
  /* probe.decode_value */ "Omvandlarresultat",
  /* probe.no_decodes */ "Inga omvandlarresultat.",
  /* probe.refused */ "Värde avvisat",
  /* probe.unimplemented */ "Inte implementerad",
  /* probe.aliases */ "också",
  /* probe.invalid */ "Kontrollera registersida, förskjutning, fältbredd och omvandlare.",
  /* probe.failed */ "Begäran misslyckades.",
  /* probe.status_ok */ "Giltigt svar",
  /* probe.status_busy */ "Upptagen",
  /* probe.status_no_link */ "Ingen X10A-anslutning",
  /* probe.status_timeout */ "Tidsgräns",
  /* probe.status_no_reply */ "Inget svar",
  /* probe.status_rejected */ "Avvisad",
  /* probe.status_bad_crc */ "Fel kontrollsumma",
  /* probe.status_unexpected_reply */ "Oväntat svar",
  /* probe.status_invalid_length */ "Ogiltig längd",
  /* probe.status_short_reply */ "Delsvar",
  /* probe.status_out_of_bounds */ "Utanför nyttolasten",
  /* probe.status_error */ "Fel",
  /* probe.transport_ok */ "Ramen är fullständig och giltig.",
  /* probe.transport_busy */ "En annan registerbegäran är aktiv.",
  /* probe.transport_no_link */ "X10A-anslutningen är otillgänglig.",
  /* probe.transport_timeout */ "Avläsningsuppgiften utförde inte begäran i tid.",
  /* probe.transport_no_reply */ "Ingen svarsbyte mottogs.",
  /* probe.transport_rejected */ "Anläggningen avvisade registersidan.",
  /* probe.transport_bad_crc */ "Svar mottogs med ogiltig kontrollsumma.",
  /* probe.transport_unexpected_reply */ "Svaret tillhör en annan registersida.",
  /* probe.transport_invalid_length */ "Svaret har ogiltig ramlängd.",
  /* probe.transport_short_reply */ "Endast en del av svaret blev mottagen.",
  /* probe.transport_out_of_bounds */ "Valda byte ligger utanför nyttolasten.",
  /* probe.transport_error */ "Begäran misslyckades.",
  /* lang.auto */ "Webbläsare",
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
  /* lang.saved */ "Språk sparat",
  /* check.detail.source_stale_modbus */ "Inget färskt Modbus-prov; aktuellt tillstånd okänt. Historik behålls.",
  /* mb.flow_scale_help */ "Obekräftad /100-skalning (sökning/reserv); jämför L/min med enheten. Undantagen från flödesanimation, ΔT, effekt och 24h-test.",
  /* hist.modbus_flow_unverified */ "Obekräftad Modbus /100-skalning (väntar/reserv); jämför med enheten.",
  /* wf.label */ "Värmefaktor",
  /* wf.state.unsupported */ "Stöds ej",
  /* wf.state.collecting */ "Samlar in",
  /* wf.state.standby */ "Viloläge",
  /* wf.verdict.cheaper */ "billigare än gas",
  /* wf.verdict.similar */ "som gas",
  /* wf.verdict.more_expensive */ "dyrare än gas",
  /* wf.verdict.limited */ "begränsad",
  /* wf.verdict.measured */ "uppmätt",
  /* wf.verdict.partial */ "preliminär",
  /* wf.aria.estimate */ (v) => `uppskattad ${v}`,
  /* wf.kpi.breakeven */ (be) => `Brytpunkt ${be}`,
  /* wf.kpi.hp_cost */ "Värmepump",
  /* wf.kpi.gas_cost */ "Gas · 88 %",
  /* wf.kpi.delta */ "Skillnad",
  /* wf.kpi.energy */ "24 h värme",
  /* wf.kpi.heat_elec */ (e) => `el ${e} kWh`,
  /* wf.scope.est */ "uppsk.",
  /* wf.scope.comp */ "endast kompr.",
  /* wf.scale.label */ "Brytpunkt",
  /* wf.scale.band */ (p) => `±${p} %`,
  /* wf.scale.cheaper */ "Billigare →",
  /* wf.scale.expensive */ "← Dyrare",
  /* wf.desc.collecting */ (o) => `Första värdet efter 2 h · hittills ${o}`,
  /* wf.desc.standby */ (o) => `För lite drift för ett värde · ${o} observerat`,
  /* wf.desc.unsupported */ "Nödvändiga data för flöde, temperatur eller el saknas.",
  /* wf.banner.stale */ "Källsignal inaktuell — värdet pausat.",
  /* wf.banner.buh_limited */ "Tillsats aktiv utanför elmätningen — begränsat värde.",
  /* wf.banner.buh_unpaired */ "Tillsats aktiv utan givare efter värmare — undantagen.",
  /* wf.banner.bsh_excluded */ (d) => `Varmvattenpatron ${d} undantagen.`,
  /* wf.banner.ct_unwired */ "Strömtång 0 A — använder endast kompressorn.",
  /* wf.ctx.window */ "Period",
  /* wf.ctx.power */ "Elmätning",
  /* wf.ctx.outdoor */ "Ute",
  /* wf.ctx.outdoor_range */ (avg, min) => `medel ${avg} °C · min ${min} °C`,
  /* wf.ctx.defrost */ "Avfrostning",
  /* wf.ctx.buh */ "Eltillsats",
  /* wf.ctx.buh_inc */ (d) => `${d} · inkluderad`,
  /* wf.ctx.cooling */ "Kyla",
  /* wf.ctx.excluded */ (d) => `${d} undantagen`,
  /* wf.src.x10a_ct */ "Strömtång · hela enheten",
  /* wf.src.x10a_inv */ "Inverter · endast kompr.",
  /* wf.foot.base */ "24 h värme & varmvatten · rent vatten · uppskattning.",
  /* wf.foot.gas */ "24 h värme & varmvatten · rent vatten · gaskondenserande 88 %, utan fasta avgifter · uppskattning.",
  /* wf.gas.row */ "Gasjämförelse",
  /* wf.gas.title */ "Gastariffer",
  /* wf.not_configured */ "Inga tariffer",
  /* wf.gas.detail.elec */ "El",
  /* wf.gas.detail.gas */ "Gas",
  /* wf.gas.detail.breakeven */ "Brytpunkt",
  /* wf.gas.settings_help */ "24 t VP mot fast modern kondenserande gaspanna (88% Hs, rent vatten 4,186 kJ/(L·K), utan fasta avgifter).",
  /* wf.gas.elec_price */ "El / kWh",
  /* wf.gas.gas_price */ "Gas / kWh",
  /* wf.gas.currency */ "Valuta",
  /* wf.gas.preview */ (b) => `Brytpunkt: ${b} (±20%)`,
  /* wf.gas.preview_empty */ "Ange priser för brytpunkt.",
  /* wf.gas.hint */ "Fast modern kondenserande gaspanna (88% Hs) & rent vatten (4,186 kJ/(L·K)), uppvärmning + varmvatten, utan fast avg. Uppdaterar 24 t.",
  /* wf.gas.delete */ "Rensa",
  /* wf.gas.deleting */ "Rensar…",
  /* wf.gas.saved */ "Tariffer sparade",
  /* wf.gas.deleted */ "Tariffer rensade",
  /* wf.gas.err_price */ "0,0001–99,9999.",
  /* wf.gas.err_currency */ "Välj en valuta som stöds.",
]);

INSPECT_I18N.sv = inspectValues(
  ["Ingen aktuell mätning:", "Kompressorn står; utomhusgivare som bara uppdateras i drift döljer gamla värden.", "Kompressorvarvtalet kan inte läsas, så utomhusenhetens värden kan vara från den senaste körningen."],
  [
    ["Driftläge", 0, "Inomhusenhetens läge; bevisar inte kompressor- eller vattendrift."], // status
    ["Uteklimat", "Uteklimat från ENV III", "ENV III mäter temperatur, fukt och tryck; placeringen avgör om värdet är uteluft."], // env3
    [(d) => d && d.sgSrc === "X10A" ? "Smart Grid-begäran · X10A" : "Smart Grid-begäran · Modbus", "Smart Grid-begäran", (d) => d && d.sgSrc === "X10A"
      ? "Fyralägesbegäran via SG-Ready-kontakter; inte driftläge eller bevis på tankladdning. Nätverksbegäran kan skilja sig."
      : "Fyralägesbegäran via HomeHub; inte driftläge eller bevis på tankladdning.", (d) => !d || d.sgMode == null
      ? "Inget aktuellt Smart Grid-värde."
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "SG-Ready rekommenderar last; varmvattenläge, 3WV och flöde visar faktisk tankladdning."
      : d.sgMode === 2
      ? "HomeHub rekommenderar last; varmvattenläge, 3WV och flöde visar faktisk tankladdning."
      : d.sgMode === 1 ? "Energistyrningen begär tvingad avstängning."
      : d.sgMode === 3 ? "Energistyrningen begär tvingad drift."
      : "Ingen extern Smart Grid-begäran; enheten styr sig själv."], // sgrequest
    ["Utomhusenhet", 0, "Värmekällans fläkt/värmeväxlare; skissen är funktionell, inte modelltroget hydraulisk.", (d) => d.defrost
      ? "Avfrostning vänder köldmediekretsen, smälter is och tar kortvarigt vattenvärme."
      : compressorRunning(d)
      ? d.rps != null
        ? `I drift: kompressor ${fmt0(d.rps)} rps${d.quiet ? ", begränsad av tyst läge" : ""}.`
        : "I drift: HomeHub bekräftar kompressorn; varvtal och detaljer kräver X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "Standby: X10A står; Modbus ger uteluft utan känt mättidsstempel."
      : "Standby utan aktiv värmeöverföring; gamla utomhusvärden döljs."], // ou
    ["Kompressor", 0, "Komprimerar köldmediet; rps är varvtal, inte värme- eller eleffekt."], // comp
    ["Uteluft", 0, "Utomhusenhetens givare; gamla X10A-värden döljs i vila eller ersätts tydligt av HomeHub."], // out
    ["Utomhusväxlare · R4T", "Utomhusväxlarens R4T-temperatur", "Kan ligga under 0 °C och isa vid värme; tolka med avfrostningsstatus."], // ouhx
    ["Högtryck", 0, "Köldmediets högtryck, inte vattentryck; kan vara tillgängligt även i vila."], // hp
    ["Hetgastemperatur", 0, "Gas vid kompressorutloppet; X10A:s gamla värde döljs i vila."], // disch
    ["Lågtryck", 0, "Köldmediets lågtryck; vissa profiler saknar giltig givare."], // lp
    ["Expansionsventil", 0, "Styrpulser reglerar köldmediet; inte öppningsprocent eller lägesåterkoppling."], // eev
    ["Flytande köldmedium · R3T", "Köldmediets R3T-temperatur", "Köldmedium på inomhusväxlarens vätskesida, inte returvatten."], // r3t
    ["Plattvärmeväxlare", "Plattvärmeväxlare PHE", "PHE överför värme utan blandning; effekt uppskattas från flöde och R1T/R4T.", (d) => !compressorRunning(d, 5)
      ? "Kompressorn står; pumpad restvärme är inte aktiv värme-/kyleffekt."
      : d.dtStale ? "Flöde genom PHE är inte bekräftat; effekt kan inte beräknas."
      : d.pth == null ? "Mätningarna ger ingen giltig effekt i valt driftläge."
      : d.pthKind === "cooling"
      ? `Cirka ${fmt1(d.pth)} kW tas ur vattnet: ${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K.`
      : `Cirka ${fmt1(d.pth)} kW tillförs vattnet: ${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K.`], // phe
    ["PHE ut · före BUH · R1T", "PHE-utlopp före BUH, R1T", "PHE-utloppets vattentemperatur före BUH; inkluderar inte BUH-värme."], // lwt
    ["Efter BUH · R2T", "Vattentemperatur efter BUH, R2T", "Vatten efter BUH, möjligtvis med elvärme; exakt placering beror på hydraulmodulen."], // r2t
    ["PHE in · R4T", "PHE-inlopp, R4T", "PHE:s interna returvattentemperatur, inte en särskild givare vid värmeavgivarna."], // rwt
    ["Vatten-ΔT över PHE", "Vattnets temperaturdifferens över PHE", "R1T−R4T beskriver PHE med flödet, inte byggnadens framledning/retur.", (d) => d.dtStale
      ? "Cirkulation är inte bekräftad; ingen arbets-ΔT."
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K med endast pump: restvärmeutjämning, inte värmeeffekt.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K; vid kylning ska R1T<R4T och värdet vara negativt.`
      : `${fmt1(d.dt)} K; positivt betyder att PHE värmer vattnet.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Uppskattad kyleffekt" : "Uppskattad värmeeffekt", "Uppskattad PHE-effekt", (d) => d && d.pthKind === "cooling"
      ? "Flöde × (R4T−R1T) × 4,186 uppskattar vattenkylning med givar-/vätskeosäkerhet."
      : "Flöde × (R1T−R4T) × 4,186 uppskattar vattenvärme med givar-/vätskeosäkerhet; BUH saknas.", (d) => d.dtStale
      ? d.bsh === true
        ? "PHE-flöde saknas; BSH kan ändå värma tanken men mäts inte här."
        : "Flöde genom PHE är inte bekräftat; utebliven beräkning betyder inte 0 kW."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW kylning${d.cop != null ? `; EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "Uppskattad EER"
      : d && d.copScope === "plant" ? "Uppskattad COP efter BUH" : "Uppskattad COP", "Uppskattad verkningsgrad", (d) => d && d.efficiencyKind === "eer"
      ? "Kyleffekt ÷ eleffekt; momentan EER med osäkerhet i givare, vätska, spänning och effektfaktor."
      : "Gränsmatchad värme ÷ el: CT+R2T efter BUH, annars växelriktarström för värmepumpen.", (d) => d.copBlock === "tank_heater"
      ? "Ingen COP: el kan omfatta BSH, men tankvärmen passerar inte framledningsgivaren."
      : d.copBlock === "buh_no_r2t" ? "Ingen COP: BUH är aktiv utan efterföljande givare; el- och värmegränsen skiljer sig."
      : d.copBlock === "mb_scope" ? "COP är inte tillgängligt. HomeHub-guiden anger inte vilka elförbrukare som ingår. Den uppskattade värmen gäller plattvärmeväxlaren. COP kräver att båda värdena bevisligen täcker samma utrustning."
      : d.copBlock === "no_pel"
      ? d.pelHeld ? "Ingen COP: växelriktarströmmen är ett gammalt värde efter stopp."
        : "Ingen COP: varken CT- eller växelriktarström finns."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW kylning/kW el: ${fmt1(d.copPth)} / ${fmt1(d.pel)} kW.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW värme/kW CT-el efter BUH: ${fmt1(d.copPth)} / ${fmt1(d.pel)} kW; lasten beror på inkopplingen.`
      : `${fmt1(d.cop)} kW värme/kW el inom värmepumpens gräns: ${fmt1(d.copPth)} / ${fmt1(d.pel)} kW; BUH ingår inte.`], // cop
    ["Tillsatsvärmare · BUH", "Tillsatsvärmare BUH", "Elvärmare i vattenkretsen efter R1T, inte tankens BSH.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Steg 2: båda stegen värmer." : d.buh1 ? "Steg 1 värmer." : "Alla BUH-steg är av."], // buh
    ["Tankvärmare", "Tankvärmare BSH", "Tankens doppvärmare BSH kan värma självständigt; X10A mäter inte effekten.", () => {
      const on = x10aDown() ? null : vOn(/^bsh$/i);
      return on == null ? null : on ? "BSH är aktiv." : "BSH är av.";
    }], // bsh
    ["3-vägsventil", "3-vägsventil 3WV", "Logikutgång väljer tank/rum utan återkoppling av mekaniskt läge/flöde.", (d) => d.valveDhw == null ? null : d.valveDhw
      ? "Tankväg anges; bevisar inte läge, flöde eller tankladdning."
      : "Rumsväg anges; bevisar inte läge eller cirkulation."], // valve
    ["2-vägsventil", "2-vägsventil 2WV", "X10A-utgång för 2WV; bevisar inte läge eller värme-/kyldrift.", (d) => d.valve2On == null ? null : d.valve2On
      ? "2WV-utgången är aktiv; bevisar inte värme eller mekaniskt läge."
      : "2WV-utgången är av; betyder inte ensam kylning och motsäger inte värmeläge i vila."], // valve2
    ["Varmvattentank", "Varmvatten- eller ackumulatortank", "R5T mäter tanken; laddning, mål och BSH visas separat."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Kylkrets" : activeSpaceKind(d) === "heat" ? "Värmekrets" : "Rumskrets", "Rumskrets", "Byggnadens avgivare; interna R1T/R4T bevisar inte avgivartemperatur.", (d) => d.valveDhw === true
      ? "Rumsvägen är inte vald; pump/flöde visar separat eventuell tankcirkulation."
      : waterMoving(d)
      ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Restvärme går mot rumskretsen; R1T ${degC(d.lwt)}, ingen givare vid avgivarna. Inte aktiv kylning.`
        : `Vatten går mot ${activeSpaceKind(d) === "cool" ? "kyl" : activeSpaceKind(d) === "heat" ? "värme" : "rums"}kretsen; intern R1T ${degC(d.lwt)}, avgivarna är inte mätta.`
      : "Pump/flöde bevisar inte cirkulation i rumsgrenen."], // heat
    ["Rumsdrift", "Rumsuppvärmning eller -kylning", "Normal rumsdriftssignal; inte termostatbegäran eller bevis på kompressordrift."], // spaceh
    ["Rumstemperatur", 0, "Referenszonens temperatur och mål; betydelsen beror på givarplaceringen."], // room
    ["Cirkulationspump", "Cirkulationspump", "Inverterad X10A-signal (0 = max, 100 = stopp, [0, 100] → 100–0 %) mäter inga RPM och bevisar inte rotation, tryckhöjd eller flöde; läs PÅ/AV och flöde separat.", (d) => pumpNowText(d, [(n) => `Pumpkommando ${n} %.`, "Pumpstatus är PÅ.", "Pumpen rapporterar stopp (AV).", "Pumpens PÅ/AV-status är okänd.", (n) => `Uppmätt flöde ${n} l/min.`, "Ingen flödesmätning.", "Rapporterat AV motsäger flödet; extern pump, eftergång eller föråldrade signaler möjlig.", "Cirkulation är inte bekräftad."])], // pump
    [(d) => pelMeasured(d) ? "Eleffekt · HomeHub" : "Uppskattad eleffekt", "Eleffekt", (d) => pelMeasured(d)
      ? "HomeHub-ingång 51; kalibrering, mätpunkt och inkluderade värmare är inte offentligt belagda."
      : "COP/EER-underlag: CT antar 230 V/fas utan känd spänning/effektfaktor; växelriktarström avser kompressorn.", (d) => d.pelHeld ? "Växelriktarströmmen är gammal efter stopp; el/verkningsgrad döljs."
      : d.pel == null ? "Ingen aktuell elmätning; COP/EER kan inte beräknas."
      : d.pelSrc === "MB" ? "HomeHub-ingång 51; exakt mätgräns är inte publicerad."
      : d.pelSrc === "CT" ? "CT-uppskattning; lasten beror på inkopplingen."
      : "Beräknad från växelriktarström, endast kompressorn."], // pel
    ["Avfrostning", 0, "Vänder köldmediekretsen för att smälta is; normalt i kallt/fuktigt väder och tar kortvarigt vattenvärme.", (d) => d.defrost == null ? null : d.defrost ? "Avfrostning pågår." : "Ingen avfrostning."], // defrost
    ["Tyst läge", 0, "Minskar buller och ofta varvtal/effekt; signalen anger inte nivå eller värmepåverkan.", (d) => d.quiet == null ? null : d.quiet ? "Tyst läge är aktivt." : "Tyst läge är av."], // quiet
    ["Gasrör", "Köldmediets gasrör", "Split-systemets gasrör: hetgas går mot PHE vid värme, omvänt vid kylning; monoblock saknar fältrör.", (d) => compressorRunning(d) ? d.rps != null ? `${fmt1(d.circP)} bar, ${fmt0(d.disch)} °C.` : "HomeHub bekräftar kompressordrift; tryck/hetgas kräver X10A." : "Kompressorn står; ingen aktiv köldmediecirkulation."], // rhot
    ["Vätskerör", "Köldmediets vätskerör", "Split-systemets vätskerör: kondenserat köldmedium går mot utomhusventilen vid värme, omvänt vid kylning.", (d) => compressorRunning(d) ? d.rps != null ? `Expansionsventil ${fmt0(d.eev)} pulser.` : "HomeHub bekräftar kompressordrift; ventilläge kräver X10A." : "Kompressorn står; ingen cirkulation."], // rcold
    ["PHE-utloppsrör", "Utloppsrör från PHE", "R1T följs av BUH, pump och 3WV; R1T sitter före BUH och grenarna.", (d) => waterMoving(d) ? `R1T före BUH ${degC(d.lwt)}, ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; BUH aktiv" : ""}.` : "Pump/flöde bevisar inte cirkulation."], // wsup
    ["Tankkrets", "Hydraulisk tankkrets", "Gren till varmvatten-/ackumulatortank; intern konstruktion beror på modell.", (d) => d.valveDhw === true ? waterMoving(d) ? `Tankväg: ${fmt1(d.flow)} l/min, PHE ${degC(d.lwt)}, tank ${degC(d.tank)}.` : "Tankväg vald, men pump/flöde bevisar inte laddning." : "Tankväg inte vald; rumskrets anges."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Kylgren" : activeSpaceKind(d) === "heat" ? "Värmegren" : "Rumsgren", "Hydraulisk rumsgren", "Gren till byggnadens avgivare; R1T/R4T i enheten bevisar inte grenens temperatur eller last.", (d) => d.valveDhw === true ? "Rumsgrenen är inte vald; tank anges."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Restvärme ${fmt1(d.flow)} l/min; inte aktiv kylning. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}; avgivarna ej mätta.`
        : `${fmt1(d.flow)} l/min; interna R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.`
      : "Pump/flöde bevisar inte cirkulation i rumsgrenen."], // wheat
    ["PHE-inloppsrör", "Inloppsrör till PHE", "Gemensam retur via R4T; inte en särskild givare vid avgivarna.", (d) => waterMoving(d) ? `${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` : "Pump/flöde bevisar inte returcirkulation."], // wret
    ["Vattenflöde", 0, "Gemensamt vattenflöde; miniminivån beror på modell och ska tolkas med pump/tryck."], // flow
    ["Flödesvakt", 0, "Binär X10A-status; mäter inte l/min eller bekräftar minimiflöde.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? d.flow == null ? "X10A-status aktiv; flödesmätning saknas." : `X10A-status aktiv; jämför pump och ${fmt1(d.flow)} l/min.` : d.flow == null ? "X10A-status inaktiv; flödesmätning saknas." : `X10A-status inaktiv; jämför ${fmt1(d.flow)} l/min och 7H/C0.`], // flow_switch
    ["Vattentryck", 0], // wp
  ],
);

HOMEHUB_LABEL_I18N.sv = homeHubValues([
  "Framledningsmål värme · huvudzon", // 1
  "Framledningsmål kyla · huvudzon", // 2
  "Värme-/kylläge", // 3
  "Rumsdrift aktiverad", // 4
  "Värmemål · huvudzon", // 6
  "Kylmål · huvudzon", // 7
  "Tyst läge", // 9
  "Återvärmningsmål varmvatten", // 10
  "Återvärmning varmvatten på", // 12
  "Boosterläge varmvatten", // 13
  "Enhetens diagnosstatus", // 21
  "Enhetens felkod", // 22
  "Enhetens felunderkod", // 23
  "Cirkulationspump aktiv", // 30
  "Kompressor aktiv", // 31
  "Tankvärmare aktiv", // 32
  "Tankdesinfektion aktiv", // 33
  "Avfrostning eller omstart", // 35
  "Varmstart", // 36
  "3-vägsventilens läge", // 37
  "Aktuellt värme-/kylläge", // 38
  "Framledning från PHE", // 40
  "Framledning efter BUH", // 41
  "Returtemperatur", // 42
  "Tanktemperatur", // 43
  "Utetemperatur", // 44
  "Temperatur på flytande köldmedium", // 45
  "Vattenflöde", // 49
  "Rumstemperatur · huvudzon", // 50
  "Elförbrukning", // 51
  "Varmvattendrift", // 52
  "Rumsdrift", // 53
  "Framledningskorr. · huvudzon", // 54
  "Kylkorrigering · huvudzon", // 55
  "Smart Grid-läge", // 56
  "Effektgräns för lagring", // 57
  "Allmän effektgräns", // 58
]);

DESCRIPTION_I18N.sv = descriptionValues([
  ["Måltemperatur för varmvatten- eller ackumulatortank."], // 0
  ["Avläsning från en extra tanksensor, t.ex. nedre givaren i en tank med två givare."], // 1
  ["Temperaturen som R5T rapporterar."], // 2
  ["Kraftläge startar omedelbar tankladdning mot komfort-/lagringsmålet."], // 3
  ["X10A-förvärmning före behov/program; inte HomeHub-desinfektion och bevisar inte sådan."], // 4
  ["HomeHub-ingång 33 visar aktiv desinfektion; en hel puls mellan Modbus-avläsningar kan missas."], // 5
  ["Bit för extern termostat; inte internt behov och inget bevis på kompressordrift."], // 6
  ["Extern bit för låg ljudnivå; varken nivå eller kommandots ursprung är dokumenterat."], // 7
  ["Solvärmeingång i vattenkretsen; funktion och polaritet är inte dokumenterade."], // 8
  ["Intern vänt-/startfas, inte nyttig värme; kort PÅ vid start kan vara normalt."], // 9
  ["Utomhusstyrningen rapporterar en intern process som återför köldmedieolja till kompressorn."], // 10
  ["Köldmedieutjämning, inte mätt tryck eller bekräftat ventilläge."], // 11
  ["Särskild Daikin-begäran utan dokumenterad betydelse; använd bara för korrelation."], // 12
  ["4WV-kommando/status; bekräftar inte läge och polariteten måste tolkas med drift/temperaturer."], // 13
  ["Kommando/status för vevhusvärmare, inte ström eller temperatur; kan vara aktiv med kompressorn av."], // 14
  ["Särskild utgångsbit; bevisar inte rörelse/polaritet. Jämför tryck och temperaturer."], // 15
  ["Inomhusunderkod utan validerad modelltabell; null utesluter inte huvudfel."], // 16
  ["Golvventilkommando/status, inte läge eller vattenflöde; polariteten är obekräftad."], // 17
  ["PÅ betyder system av, men skydd, pumpar eller värmare kan fortfarande vara aktiva."], // 18
  ["Extra extern termostatingång, inte temperatur/kompressor; jämför konfigurerad kontakt."], // 19
  ["Huvudtermostatens värme-/kylbehov; bekräfta respons med läge, pump, ventil och kompressor."], // 20
  ["En av fyra råa begränsningsbitar; härled inte steg innan observerad kodning är dokumenterad."], // 21
  ["Bit för PHE-värmare; okänt om kommando eller återkoppling och inget bevis på ström."], // 22
  ["Aktivering av automatisk återvärmning av varmvatten i register 12; ON = tillåten, OFF = avstängd, bevisar inte pågående laddning."], // 23
  ["Begäran om snabbladdning/booster av varmvatten i register 13; ON = begärd eller aktiv, OFF = normal drift."], // 24
  ["Återvärmning höjer tanken till målet när temperaturen sjunker under startgränsen."], // 25
  ["Schemalagt förval: Komfort använder högt mål, Eco lågt."], // 26
  ["I hybridsystem begär styrningen varmvatten från pannan."], // 27
  ["3WV leder vatten till tank eller rum; 1=tank, 0=rum, men läget bevisar inte aktivitet."], // 28
  ["X10A PÅ/AV-utgång för valfri 2WV; bevisar inte spänning eller mekaniskt läge."], // 29
  ["Blandningsventilens öppning för en extra zon."], // 30
  ["Framledningstemperaturens mål för valt värme- eller kylläge."], // 31
  ["Blandad framledningstemperatur för sekundärzonen efter blandningsventilen."], // 32
  ["Temperatur efter BUH, oftast R2T; kan omfatta BUH-värme men bevisar inte avgivartemperatur."], // 33
  ["R1T från PHE före BUH; R4T/flöde ger en uppskattning vars placering är modellberoende."], // 34
  ["R4T-retur till PHE; bedöm ΔT med flöde, kompressor och läge, inte en universell 5 K-regel."], // 35
  ["Vattenflöde i gemensam krets; minimum beror på modell/läge och lågt värde kan utlösa 7H."], // 36
  ["Vattentrycket i den slutna vattenkretsen.","Många Altherma-handböcker kräver över 1 bar vid pumpinloppet. Tillåtet tryckintervall beror på modell, installationshöjd och expansionskärl. Vid 1,0 bar eller lägre, läs handboken för den aktuella enheten."], // 37
  ["Inverterat X10A-kommando: 0 = max, 100 = stopp ([0, 100] → 100–0 %). Mäter inga RPM och bevisar inte rotation, tryckhöjd eller flöde; läs PÅ/AV och flöde separat."], // 38
  ["Pumpstatus; bevisar inte nyttig värme och kan vara aktiv utan kompressor. Jämför flödet."], // 39
  ["Status för pumpen i en konfigurerad solvärmekrets."], // 40
  ["Angiven hastighet för pumpen som profilen namnger."], // 41
  ["Binär X10A-status «Water flow switch». På modeller med dokumenterad flödesvakt betyder PÅ att vattenrörelse upptäckts; statusen mäter inte l/min och bevisar inte modellens miniminivå. Vissa stödda modeller visar statusen utan dokumenterad separat fysisk brytare. Jämför med uppmätt flöde och 7H/C0 när pumpen går."], // 42
  ["Hydrauliskt läge: stopp, värme, kyla, varmvatten eller kombinerat; bevisar inte kompressordrift."], // 43
  ["Smart Grid-kommando med fyra lägen från HomeHub eller två X10A-kontakter; inte värme-/kylläge."], // 44
  ["Aktuellt rumsläge värme/kyla utan Auto; kräver aktivitetssignal och bevisar inte kompressordrift."], // 45
  ["HomeHub-val Auto/värme/kyla; konfiguration, inte aktuell drift eller bevis på aktivitet."], // 46
  ["Utomhusstatus stopp/värme/kyla; kan stå kvar med kompressorn av och bevisar inte värme."], // 47
  ["HomeHub-register 35 kombinerar avfrostning och förberedelse för kompressorns omstart.", "Vid stabil drift är signalen av. En aktiv signal betyder avfrostning eller omstartsförberedelse."], // 48
  ["Varmstartsflagga i register 36; OFF = stabil drift, ON = kort förvärmning av värmeväxlaren innan värmedrift fortsätter."], // 49
  ["Avfrostning tar bort frost från utomhusenhetens värmeväxlare.", "Avfrostning är normalt vid kallt och fuktigt väder. Signalen ensam kan inte avgöra om cyklerna är för täta."], // 50
  ["Allvarlighetsklass för aktivt meddelande: Normal, Fel, Varning eller Försiktighet."], // 51
  ["Betydelsen av felkoden som rapporteras nu."], // 52
  ["Nöddrift efter värmepumpsfel."], // 53
  ["Enhetens larmrelä; signalerar fel till anslutet externt larm/övervakning."], // 54
  ["Målrumstemperatur för huvudzonen i värme- eller kylläge."], // 55
  ["Intern «thermo ON»-begäran; identifierar inte last/kompressor, och «Space heating Operation» är inte behov."], // 56
  ["Elektrisk «Space H Operation»-utgång; inte normal aktivitet eller bevis på kompressor/värme."], // 57
  ["Normal rumsuppvärmnings/-kylaktivitet, inte behov; kan vara PÅ i kyla med kompressorn av."], // 58
  ["Konfigurerad målrumstemperatur för zonen som styrs av enhetens egen givare."], // 59
  ["Rumstemperatur från enhetens inbyggda eller kabelanslutna givare."], // 60
  ["Utloppsskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 61
  ["Växelriktarströmskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 62
  ["Högtrycksskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 63
  ["Lågtrycksskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 64
  ["Växelriktartemperaturskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 65
  ["Generisk intern begränsningsbit, inte kopplad till de fem namngivna skydden."], // 66
  ["Vatten vid plattvärmeväxlarens in-/utlopp, där energi överförs mellan köldmedium och vatten."], // 67
  ["Givare på utomhusvärmeväxlaren; <0 °C kan vara normalt och bevisar inte is utan fuktdata."], // 68
  ["Utetemperatur uppmätt av enheten för väderkompensering och driftval."], // 69
  ["Varm gas från kompressorn; beror på tryck, varvtal, läge och last. Ett värde eller intervall från annan serie bevisar inte fel eller köldmediebrist."], // 70
  ["Temperatur på kall lågtrycksgas tillbaka till kompressorn."], // 71
  ["Köldmedietemperatur i vätskeröret mellan värmeväxlarna."], // 72
  ["Köldmedium vid förångarens in-/utlopp, där värme tas upp."], // 73
  ["Köldmediets insprutningstemperatur för intern reglering och skydd."], // 74
  ["Temperatur i köldmediekretsens tvåfasdel med både vätska och ånga."], // 75
  ["Avfrostningsgivare ute; placering och styrning är modellspecifika. En punkt bevisar inte is på hela batteriet eller avslutad avfrostning."], // 76
  ["Mättnadstemperatur beräknad från tryck; inte en egen givare eller tryck i bar."], // 77
  ["Hög-/lågtryck: bedöm stabil trend i samma läge/modell; start, oljeretur och avfrostning ändrar det. Inget allmänt normalområde."], // 78
  ["Kompressorhastighet i rps; högre betyder ofta större behov men mäter inte värme."], // 79
  ["EEV-steg är kommando utan mekanisk återkoppling, inte % eller flöde. Ensamt bevisar det inte rörelse, fast ventil eller köldmediebrist."], // 80
  ["Temperatur på elektroniken som styr utomhusfläktmotorn."], // 81
  ["Utomhusfläktens hastighet som steg eller rpm."], // 82
  ["Internt mål efter modell/läge; jämför med motsvarande mättnadstemperatur från tryck. Avvikelsen diagnostiserar inte orsak eller fyllning."], // 83
  ["Internt mål för kompressorns utlopps-/porttemperatur som används av skyddet."], // 84
  ["Önskad ΔT mellan framledning och retur; modell-/lägesberoende, inte en universell 5 K-regel."], // 85
  ["Köldmediet som enheten fyllts med, t.ex. R32 eller R410A."], // 86
  ["Temperatur vid en kompressorport för intern övervakning och skydd."], // 87
  ["Tryckmätning i utomhusenhetens köldmediekrets."], // 88
  ["Fasström från CT; 230 V-uppskattningen är okalibrerad och bortser från verklig spänning/effektfaktor."], // 89
  ["Ström som kompressorväxelriktaren drar; grov belastningsindikator."], // 90
  ["Temperatur i kylflänsen för utomhusenhetens växelriktare/kraftelektronik."], // 91
  ["Aktiva steg i elektrisk tillsatsvärme, uttryckta som effektnivå."], // 92
  ["BUH-steg: 0=inget; högre steg kan stödja vid kyla, avfrostning, varmvatten eller nödläge."], // 93
  ["HomeHub-ingång 32: BSH PÅ/AV, inte effekt; ingång 51 är värmepumpsförbrukning, inte BSH."], // 94
  ["BSH i tanken kan värma utan kompressor/pump; X10A ger PÅ/AV, inte effekt."], // 95
  ["Status för en elektrisk värmares termiska skyddskedja; öppen kedja stoppar driften."], // 96
  ["Rörfrostskydd; modellberoende, kräver ström och täcker inte strömavbrott."], // 97
  ["X10A-frostskyddsstatus; utan modelldata identifierar den inte pump, värmare eller skyddad zon."], // 98
  ["Markslinga med frostskyddsvätska och pump; vätska, tryck och gränser beror på konstruktion/handbok."], // 99
  ["Hybridkälla värmepump/kombinerat/panna; ett val, inte uppmätt värme."], // 100
  ["Hybridens framledningsmål, inte mätt temperatur; tolka med läge och faktiska värden."], // 101
  ["Bivalent tillåtelse/status; PÅ bevisar inte att pannan brinner."], // 102
  ["Begäran till pannan; bevisar inte förbränning eller levererad värme."], // 103
  ["Pannans vattenmål, inte mätt temperatur; beror på behov och anläggning."], // 104
  ["Bivalent BE_COP-värde; X10A-betydelse/skala är odokumenterad och inte aktuell COP."], // 105
  ["Tariff-, Smart Grid- eller solingång; åtgärden är konfigurationsberoende, PÅ visar bara kontakten."], // 106
  ["Fast nominell inne-/uteeffektklass i kW eller kod; inte aktuell mätning."], // 107
  ["Tyst läge sänker utomhusbuller och kan begränsa tillgänglig värme-/kyleffekt."], // 108
  ["HomeHub-status Inget fel/Fel/Varning; identifierar inte ensam orsaken."], // 109
  ["Betydelsen av felkoden som rapporteras nu."], // 110
  ["Extra underkod; giltig bara med huvudstatus/-kod och dold när den saknas."], // 111
  ["HomeHub visar kompressor PÅ/AV, inte hastighet/kapacitet; tolka med drift och vattenflöde."], // 112
  ["Visar om normal varmvattendrift är aktiv."], // 113
  ["Visar om normal rumsuppvärmning eller -kylning är aktiv."], // 114
  ["PHE-utlopp före BUH; jämför med retur bara vid cirkulation för att få ΔT."], // 115
  ["Framledning efter BUH; ökning kan bero på elvärme men måste bekräftas med BUH-status."], // 116
  ["Vattnets uppmätta temperatur i varmvattentanken."], // 117
  ["Vätskerörstemperatur; förhållandet är lägesberoende och ett värde räcker inte för diagnos."], // 118
  ["Huvudzonens rumstemperatur rapporterad av fjärrkontrollen."], // 119
  ["Elförbrukning via HomeHub; beror på läge/laster och ska inte tillskrivas bara kompressorn."], // 120
  ["HomeHubs framledningsmål för värme, endast avläsning; sänkning hjälper bara om rumsmålet nås."], // 121
  ["HomeHubs framledningsmål för kyla, endast avläsning; relevant när kyla är tillåten/aktiv."], // 122
  ["Visar om rumskretsen är aktiverad: brytarläge, inte aktuell aktivitet."], // 123
  ["Tyst läge sänker utomhusbuller enligt vald nivå och kan minska tillgänglig effekt."], // 124
  ["Återvärmningsmål för varmvatten, inte startgräns; hysteres och program gäller också."], // 125
  ["Korrigering −10…+10 K av värmemålet; bevisar inte värme utan aktiv rumsdrift."], // 126
  ["Korrigering −10…+10 K av kylmålet; bevisar inte kyla utan aktiv rumsdrift och kylläge."], // 127
  ["Lagringsgräns vid Rekommenderad på; lägsta av denna och allmän gräns gäller. Inte förbrukning."], // 128
  ["Allmän HomeHub-gräns: ett tak, inte förbrukning; lägre värde begränsar effekt i Smart Grid-läge."], // 129
]);

MODEL_DESCRIPTION_I18N.sv = modelDescriptionValues([
  ["Visar fel- och varningskoder som värmepumpen rapporterat; korta beskrivningar är allmänna Daikin-råd och en rensad kod bevisar inte att orsaken åtgärdats."], // health_fault
  ["Största godkända temperaturfall per timme vid tankgivaren R5T i tankvisningen.", "Fönster ≥0,8 K/h markeras i tankdiagrammet. R5T är en punkt i en skiktad tank, inte uppmätt tankenergi. Markörer för intern pump och tappningsliknande fall antyder möjliga orsaker utan att bevisa någon eller utesluta andra förluster."], // health_dhw_loss
  ["Vid luckor i mätningarna kan vissa starter saknas i räkningen.", "Det finns inget fast normalt antal starter. Med tillräckliga data bedömer den här kontrollen avslutade värmekörningar på minst 10 minuter i genomsnitt som tillräckligt långa."], // health_cycling
  ["Avfrostning", "≥3 parade, >15% av kompressorns drifttid där både kompressor- och avfrostningsstatus kan läsas. Intern regel, inte Daikin; fuktighet och hela värmeväxlarens temperatur saknas."], // health_defrost
  ["24-timmars vattentryckskurva i sluten hydraulkrets (X10A, 5-minutersminima).", "Kurvhänvisning: >1,0 bar normalt, ≤1,0 bar lågt, ≤0,5 bar kritiskt (diagnos vid ≥60 s i följd). Tillåtet påfyllnings- och drifttryck beror på exakt modellmanual och anläggningshöjd; värdet ensamt bevisar varken läckage eller fel."], // health_pressure
  ["Lägsta flöde efter 60 s kontinuerlig drift av intern pump; separat: stickprovsviktad statistik för vattentemperaturskillnad, flöde och pumpkommando efter 600 s uppvärmningsstart.", "Inte nominellt flöde eller bevis på dellast. Avser den gemensamma vattenvärmeväxlaren. Pumpkommando mäter inte varvtal eller lyfthöjd. 600 s projektfilter (luckor ≤15 s) visar inte stabil drift; ingen måljämförelse eller hydraulisk orsak."], // health_flow
  ["BUH/BSH ON-tid", "inte energi eller bevis på onödig värme."], // health_heater
  ["Experimentella interna Daikin-skyddsräknare (0–7) jämförda mellan på varandra följande mätningar, även vid stopp och kompressorväxlingar. Daikin dokumenterar inte trösklar eller återställningar; luckor och återställningar utesluts. Stabila räknare utesluter inte begränsning och en ökning bevisar varken fel eller orsak."], // health_retries
  ["RAM 24 h: stabilt eller återhämtade fall; varaktigt fall, möjlig läcka; kompatibel omstart med ström kan behålla RAM-kurvan. Annars bara daterade kompatibla 5 min från flashjournal efter tidssynk; steg på 5 min kan dölja korta stopp; öppna/senaste osparade kan saknas."], // free_heap
  ["Största sammanhängande block som TLS/OTA behöver; fall med stabilt total-RAM tyder på fragmentering."], // max_alloc
  ["Utomhusenhetens nominella effekt, inte aktuell produktion."], // capacity
  ["Inomhusenhetens nominella effekt; inte utomhusenheten eller hela anläggningen."], // capacity_iu
  ["Flera familjer delar register/effekt: mätningarna är giltiga, men exakt modell kräver ID mot märkskylt."], // candidates
  ["Utan utomhuskapacitet kan kandidaterna avvika; bästa inomhusenhetsmatchning används utan säkerhet och måste kontrolleras mot märkskylten."], // candidates_nocap
  ["Ute-ID-byte utan offentlig namntabell; vid tvekan, jämför med märkskylt."], // oueeprom
]);

FAULT_CODE_I18N.sv = faultCodeValues([
  "Problem med vattenflödet", // 7H
  "Fel på returvattentemperaturgivaren", // 80
  "Fel på framledningstemperaturgivaren", // 81
  "Värmeväxlarens frostskydd aktiverat", // 89
  "Onormal temperaturökning vid varmvattenutloppet", // 8F
  "Onormal ökning av framledningstemperaturen", // 8H
  "Fel på nollgenomgångsdetekteringen", // A1
  "Problem med högtrycksbegränsning eller frostskydd", // A5
  "Tillsatsvärmare (BUH) överhettad eller inte ansluten", // AA
  "Tankvärmare (BSH) överhettad", // AC
  "Tankdesinfektion mot legionella slutfördes inte", // AH
  "Uppvärmningstiden för varmvatten överskreds", // AJ
  "Fel på flödesgivaren", // C0
  "Fel på värmeväxlarens temperaturgivare", // C4
  "Fel på värmeväxlargivaren", // C5
  "Fel på rumstemperaturgivaren", // CJ
  "Fel på utomhusenhetens kretskort", // E1
  "Fel på läckströmsdetekteringen", // E2
  "Utomhusenhetens högtrycksbrytare aktiverad", // E3
  "Fel på sugtrycket", // E4
  "Utomhusenhetens växelriktarkompressormotor överhettad", // E5
  "Utomhusenhetens kompressor startar inte", // E6
  "Fel på utomhusenhetens fläktmotor", // E7
  "Överspänning vid utomhusenhetens ingång", // E8
  "Fel på den elektroniska expansionsventilen", // E9
  "Problem med omkoppling kylning/värme i utomhusenheten", // EA
  "Onormal temperaturökning i tanken", // EC
  "Onormal temperatur i utomhusenhetens hetgasrör", // F3
  "Onormalt högt tryck i utomhusenheten under kylning", // F6
  "Onormalt högt tryck i utomhusenheten; högtrycksbrytaren aktiverad", // FA
  "Fel på utomhusenhetens spännings-/strömgivare", // H0
  "Fel på extern temperaturgivare", // H1
  "Fel på utomhusenhetens högtrycksbrytare", // H3
  "Fel på kompressorns överbelastningsskydd", // H5
  "Fel på utomhusenhetens positionsgivare", // H6
  "Fel på utomhusenhetens mätning av kompressorns ingångsström (CT)", // H8
  "Fel på utomhusenhetens uteluftsgivare", // H9
  "Fel på tanktemperaturgivaren", // HC
  "Fel på vattentrycksgivaren", // HJ
  "Fel på utomhusenhetens hetgasrörsgivare", // J3
  "Fel på utomhusenhetens värmeväxlargivare", // J6
  "Fel på utomhusenhetens högtrycksgivare", // JA
  "Fel på växelriktarkortet", // L1
  "För hög temperatur i utomhusenhetens styrbox", // L3
  "För hög temperatur i utomhusenhetens växelriktarkylfläns", // L4
  "Likströmsöverström registrerad i utomhusenhetens växelriktare", // L5
  "Växelriktarkortets temperaturskydd utlöst", // L8
  "Kompressorns låsskydd", // L9
  "Fel i utomhusenhetens kommunikationssystem", // LC
  "Fasobalans eller fasavbrott i strömförsörjningen", // P1
  "Onormal likström registrerad", // P3
  "Fel på utomhusenhetens kylflänstemperaturgivare", // P4
  "Kapacitetsinställningen stämmer inte", // PJ
  "För lite köldmedium i utomhusenheten", // U0
  "Fel fasföljd eller fasavbrott", // U1
  "Fel på utomhusenhetens nätspänning", // U2
  "Golvtorkningsfunktionen slutfördes inte korrekt", // U3
  "Kommunikationsproblem mellan inom- och utomhusenheten", // U4
  "Kommunikationsproblem med användargränssnittet", // U5
  "Överföringsfel mellan huvud-CPU och växelriktar-CPU i utomhusenheten", // U7
  "Kommunikationsproblem med extern enhet (LAN-adapter, rumstermostat eller USB)", // U8
  "Problem med kombination eller kompatibilitet mellan inom- och utomhusenheten", // UA
  "Omvänd rördragning eller felaktig kommunikationskabel registrerad", // UF
], "Ingen felkod överförs just nu.", "Ingen kort förklaring har sparats för den här koden.");

MB_DELTA_I18N.sv = mbDeltaValues([
  "När kompressorn står behåller X10A värdet från den senaste körningen. HomeHub-registret läses oberoende och kan ändras, men saknar mättidsstämpel.",
  "De två värdena läser rumstemperaturen från olika regulatorer.",
]);
