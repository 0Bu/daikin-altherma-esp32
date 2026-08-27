// translation-source: 5d871d5ac649125e5dd02c251c9b45a34dc6cedbda5e9c48c95895bed7694182
I18N.sv = localeValues([
  /* sys.nodata */ "Inga data",
  /* sys.unreachable */ "Inte tillgänglig",
  /* sys.x10a_down */ "X10A frånkopplad",
  /* sys.mb_carrying */ "Okänt driftläge — värden från Modbus",
  /* sys.mb_only */ "X10A frånkopplad — värden från Modbus",
  /* sys.mb_source */ "X10A frånkopplad · Modbus",
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
  /* sys.online */ "Ansluten",
  /* sys.fault */ "Fel",
  /* sys.warning */ "Varning",
  /* sys.fault_line */ (c) => "Fel · " + c + " — kontrollera Daikin-felkoden.",
  /* sys.warning_line */ (c) => "Varning · " + c + " — kontrollera värmepumpen.",
  /* sys.polled */ (s) => `läst för ${s} s sedan`,
  /* recovery.title */ "Återställningsläge",
  /* recovery.meta_heap */ "Minnesbrist orsakade flera omstarter. Värmepumpsanslutning och MQTT är pausade så webbsidan fungerar. Installera nyare firmware under Inställningar; ett strömavbrott provar alla funktioner igen.",
  /* recovery.meta */ "Flera omstarter utlöste återställningsläge med pausad värmepumpsanslutning och MQTT. Kontrollera konfigurationen, särskilt RX/TX-stiften, och starta om.",
  /* rollback.title */ "Wi-Fi-ändringen misslyckades — återställd",
  /* rollback.meta */ (back) => `Nya Wi-Fi-inställningar fungerade inte. Föregående nätverk${back} återställdes och enheten startades om. Kontrollera namn och lösenord under Inställningar → Anslutningar.`,
  /* crash.title_fault */ "Enheten startades om efter en krasch",
  /* crash.title_orphan */ "Kraschrapport från en tidigare omstart",
  /* crash.reset */ "Återställning",
  /* crash.task */ "Uppgift",
  /* crash.fw */ "FW",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "skadad",
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
  /* bug.what_ph */ "Tanktemperaturen har visats 12800 °C i Home Assistant sedan i morse.",
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
  /* nav.settings_alert */ (n) => `Inställningar — ${n} ${n === 1 ? "anslutning har" : "anslutningar har"} fel`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Båda källorna stämmer överens",
  /* src.delta */ (d, u) => `Avvikelse ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "De två källorna är oense om detta tillstånd",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Söker…",
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
  /* modbus.err.request_failed */ (r) => `Kunde inte skapa Modbus-begäran${r ? ` för register ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Tidsgräns vid sändning av Modbus-begäran${r ? ` till register ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `Kunde inte skicka Modbus-begäran${r ? ` till register ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Tidsgräns för svar från HomeHub${r ? ` på register ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `HomeHub stängde anslutningen${r ? ` vid register ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `Kunde inte läsa svar från HomeHub${r ? ` på register ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Ogiltigt Modbus-svar${r ? ` på register ${r}` : ""}.`,
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
  /* service.title */ "Köldmediekrets under uppvärmning",
  /* service.state.waiting */ "VÄNTAR PÅ UPPVÄRMNING",
  /* service.state.observing */ "REGISTRERAR",
  /* service.state.limited */ "REGISTRERAR · DATA SAKNAS",
  /* service.state.interrupted */ "PAUSAD",
  /* service.row.window */ "Registrerat hittills",
  /* service.row.reason */ "Varför denna status?",
  /* service.reason.unsupported_profile */ "Den här modellen ger inte alla mätvärden som behövs.",
  /* service.reason.compressor_not_running */ "Kompressorn är inte igång.",
  /* service.reason.unsupported_or_unknown_mode */ "Värmepumpen är inte i vanlig rumsuppvärmning eller läget kan inte läsas.",
  /* service.reason.dhw_path */ "Värmepumpen värmer tappvarmvatten.",
  /* service.reason.defrost */ "Utomhusenheten avfrostas.",
  /* service.reason.unit_fault */ "Värmepumpen rapporterar ett fel.",
  /* service.reason.special_controller_phase */ "En kort start- eller särskild regleringsfas är aktiv.",
  /* service.reason.missing_fresh_signal */ "Minst ett nödvändigt aktuellt mätvärde saknas.",
  /* service.reason.poll_gap */ "X10A-anslutningen avbröts eller pausades avsiktligt.",
  /* service.window */ (d, n) => `${d} · ${n} aktuella ${n === 1 ? "mätning" : "mätningar"}`,
  /* service.help.observing */ "Mätvärden registreras nu kontinuerligt under vanlig uppvärmning.",
  /* service.help.limited */ "Registreringen är aktiv, men några extra jämförelsevärden saknas.",
  /* service.help.interrupted */ "Registreringen avslutades och startar automatiskt vid nästa lämpliga uppvärmning.",
  /* service.common */ "På modeller med stöd startar den automatiskt vid vanlig uppvärmning; utan serviceläge eller inställningsändring. Bedömer inte köldmedium eller normalområde. Ventilvärde: kommando, inte uppmätt position.",
  /* check.fault */ "Anläggningsfel",
  /* check.dhw_loss */ "Värmeförlust från tank",
  /* check.cycling */ "Kompressorstarter",
  /* check.defrost */ "Avfrostningar",
  /* check.pressure */ "Lägsta vattentryck",
  /* check.flow */ "Lägsta vattenflöde",
  /* check.heater */ "Elektrisk tillsatsvärme",
  /* check.retries */ "Skyddsingrepp",
  /* check.status.ok */ "OK",
  /* check.status.info */ "INFO",
  /* check.status.warn */ "Varning",
  /* check.status.collecting */ "SAMLAR IN",
  /* check.status.observation */ "Endast mätning",
  /* check.status.experimental */ "Experimentell",
  /* check.status.unavailable */ "Otillgänglig",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · ${n}/${a} ${n === 1 ? "bedömd" : "bedömda"}` : s,
  /* check.detail.value_label */ "Mätning:",
  /* check.detail.assessment_label */ "Bedömning:",
  /* check.detail.ok */ "Bedömningen är klar utan avvikelse i observerade anläggningsdata.",
  /* check.detail.info */ "Nyttig information, inte bevis på fel. Gränsen för avvikelse står under «Normalt».",
  /* check.detail.warn */ "Ett enhetsfynd eller en dokumenterad gräns kräver kontroll.",
  /* check.detail.fault.error */ "Anläggningen rapporterar ett fel nu. Koden visas på kortet «Drift».",
  /* check.detail.fault.warning */ "Anläggningen rapporterar en varning nu, inte ett fel. Koden visas på kortet «Drift».",
  /* check.detail.fault.past */ "Anläggningen rapporterar inget nu, men ett meddelande inträffade och försvann de senaste 24 timmarna. Det kräver ingen åtgärd ensamt; notera tiden om det upprepas.",
  /* check.detail.fault.past_unknown */ "Ett meddelande inträffade de senaste 24 timmarna, men aktuellt tillstånd kan inte läsas. Kontrollera X10A-anslutningen.",
  /* check.detail.collecting */ (n, r) => `${n} av ${r} registrerade; kan inte bedömas ännu.`,
  /* check.detail.cycling_split */ " Endast bekräftad rumsuppvärmning bedöms. Varmvatten har andra villkor och säker kylning utelämnas. En hel körning klassificeras bara när 3-vägsventil och I/U-läge är läsbara och oförändrade; övriga bedöms inte.",
  /* check.detail.cycling_pooled */ " Alla körningar bedöms gemensamt när klassdata är otillräckliga: ingången var ofta oläsbar, färre än 12 körningar klassificerades eller över 10 % saknade klass. Varmvatten/kylning kan dölja korta värmekörningar; klassvärdena är endast observationer.",
  /* check.detail.outdoor_cycling */ " X10A-utomhusdata är endast aktuella mätningar från slutförda körningar som hela tiden var rumsuppvärmning. De är sammanhang och ändrar inte gränsen eller bedömningen.",
  /* check.detail.outdoor_defrost */ " X10A-utomhusdata är endast aktuella mätningar medan avfrostning och kompressorstatus var läsbara och kompressorn gick. De är sammanhang och ändrar inte gränsen eller bedömningen.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} av ${r} hela, rensade timfönster; pågående fönster: ${c} av ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} av ${r} hela, rensade timfönster; tankladdning eller BSH registrerad, ${s} stabilisering återstår.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} av ${r} hela, rensade timfönster; väntar på det första hela fönstret.`,
  /* check.detail.dhw_aborted */ (n, reasons, bäst) => ` ${n} ${n === 1 ? "kandidat blev förkastad" : "kandidater blev förkastade"} (${reasons}); längsta nådde ${bäst} av 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, bäst) => `Kan inte bedömas: ingen rensad timme på 24 t; ${n} ${n === 1 ? "kandidat förkastades" : "kandidater förkastades"} (${reasons}), längst ${bäst}/60 min. Tankladdning kräver 105 lugna min (45 + 60); tappning, pump, oläsbara data eller snabb jämn förlust kan bryta fönstret. Orsaken kan inte rangordnas, så kontinuerlig förlust utesluts inte.`,
  /* check.detail.dhw_blocked_link */ (n, bäst) => `Kan inte bedömas: ${n === 1 ? "enda kandidaten" : `alla ${n} kandidater`} förkastades när X10A slutade svara; längst ${bäst}/60 min. Anslutningen, inte anläggningen, är orsaken — kontrollera kabel och RX/TX.`,
  /* check.detail.dhw_reason.charge */ "tankladdning",
  /* check.detail.dhw_reason.pump */ "intern pump",
  /* check.detail.dhw_reason.draw */ "tappningsliknande fall",
  /* check.detail.dhw_reason.reading */ "osannolik R5T",
  /* check.detail.dhw_reason.blind */ "X10A svarar inte",
  /* check.detail.collecting_unknown */ "Ännu saknas tillräckliga användbara data för bedömning.",
  /* check.detail.observation */ "Endast mätning; det finns ingen generell OK-/Varning-gräns.",
  /* check.detail.experimental */ "Experimentell observation; en stabil räknare bevisar inte att ingen begränsning inträffade.",
  /* check.detail.unavailable */ "Den aktiva profilen ger inga data som kan bedömas här.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "start" : "starter"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "cykel" : "cykler"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "klassificerad" : "klassificerade"}`,
  /* check.mean */ (d) => `${d}/start`,
  /* check.cycling_space */ (n, d) => d ? `Rum ${n} × ${d}` : `Rum ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `Varmvatten ${n} × ${d}` : `Varmvatten ${n}`,
  /* check.cycling_cooling */ (n) => `Kylning ${n} ${n === 1 ? "utelämnad" : "utelämnade"}`,
  /* check.cycling_censored */ (n) => `${n} utan klass`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · medel ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `Tank ${m} min`,
  /* check.tank_runtime */ (d) => `Tank ${d}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "fönster" : "fönster"}`,
  /* check.loss_pump_off */ "också med cirkulationspumpen av",
  /* check.loss_with_pump */ "medan cirkulationspumpen gick",
  /* check.loss_unattributed */ "ofullständig pumpkoppling",
  /* check.fault_err */ "Fel aktivt",
  /* check.fault_warn */ "Varning aktiv",
  /* check.fault_past */ "Inträffade senaste 24 t · inte aktiv nu",
  /* check.fault_none */ "Ingen nu",
  /* check.fault_unknown */ "Aktuellt tillstånd okänt",
  /* check.fault_past_unknown */ "Inträffade senaste 24 t · aktuellt tillstånd okänt",
  /* check.retry_seen */ "Räknarökning observerad",
  /* check.retry_none */ "Ingen ökning observerad",
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
  /* protect.limiting */ "begränsar",
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
  /* hist.loading */ "Laddar historik…",
  /* hist.none */ "Inga mätningar är registrerade ännu.",
  /* hist.err */ "Historiken är otillgänglig.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "mätlucka" : "mätluckor"} — inte mätt`,
  /* hist.nm */ "inte mätt",
  /* hist.rel */ (h) => `för ${h} t sedan`,
  /* hist.held */ "Utomhusenhet i vila",
  /* hist.heldnote */ (h) => `${h} t i vila — inte mätt`,
  /* hist.forecast */ "Open-Meteo · prognos",
  /* hist.in_hours */ (h) => `om ${h} t`,
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
  /* hist.boost_aria */ (l, d) => `${l} — Smart Grid-historik med fyra lägen. ${d}. Använd piltangenterna.`,
  /* hist.defrost_total */ (d) => `Avfrostning registrerad · ${d} rutnätstid`,
  /* hist.defrost_none */ "Ingen avfrostning registrerad i perioden.",
  /* hist.defrost_active */ "Avfrostning aktiv",
  /* hist.defrost_inactive */ "Avfrostning av",
  /* hist.defrost_aria */ (l, d) => `${l} — avfrostningshistorik. ${d}. Använd piltangenterna.`,
  /* hist.quiet_total */ (d) => `Tyst läge registrerat · ${d} rutnätstid`,
  /* hist.quiet_none */ "Inget tyst läge registrerat under perioden.",
  /* hist.quiet_active */ "Tyst läge aktivt",
  /* hist.quiet_inactive */ "Tyst läge av",
  /* hist.quiet_aria */ (l, d) => `${l} — historik för tyst läge. ${d}. Använd piltangenterna.`,
  /* hist.heater_total */ (d) => `Tankvärmare registrerad · ${d} rutnätstid`,
  /* hist.heater_none */ "Ingen tankvärmare registrerad i perioden.",
  /* hist.heater_active */ "Tankvärmare aktiv",
  /* hist.heater_inactive */ "Tankvärmare av",
  /* hist.heater_aria */ (l, d) => `${l} — historik för tankvärmare. ${d}. Använd piltangenterna.`,
  /* hist.preheat_total */ (d) => `Förvärmning av tank registrerad · ${d} rutnätstid`,
  /* hist.preheat_none */ "Ingen förvärmning av tank registrerad i perioden.",
  /* hist.preheat_active */ "Förvärmning aktiv",
  /* hist.preheat_inactive */ "Förvärmning av",
  /* hist.preheat_aria */ (l, d) => `${l} — X10A-historik för tankförvärmning. ${d}. Använd piltangenterna.`,
  /* hist.disinfection_total */ (d) => `Desinfektion registrerad · ${d} rutnätstid`,
  /* hist.disinfection_none */ "Ingen tankdesinfektion registrerad i perioden.",
  /* hist.disinfection_active */ "Desinfektion aktiv",
  /* hist.disinfection_inactive */ "Desinfektion av",
  /* hist.disinfection_aria */ (l, d) => `${l} — HomeHub-historik för tankdesinfektion. ${d}. Använd piltangenterna.`,
  /* hist.buh_total */ (d) => `Tillsatsvärmare registrerad · ${d} rutnätstid`,
  /* hist.buh_none */ "Ingen användning av tillsatsvärmare registrerad under perioden.",
  /* hist.buh_active */ "Tillsatsvärmare aktiv",
  /* hist.buh_inactive */ "Tillsatsvärmare av",
  /* hist.buh_step1 */ "Steg 1",
  /* hist.buh_step2 */ "Steg 2",
  /* hist.buh_aria */ (l, d) => `${l} — historik för tillsatsvärmare. ${d}. Använd piltangenterna.`,
  /* hist.valve_dhw_total */ (d) => `Varmvatten · ${d}`,
  /* hist.valve_space_total */ (d) => `Rumskrets · ${d}`,
  /* hist.valve_none */ "Inget varmvattenläge under perioden.",
  /* hist.valve_dhw */ "Varmvatten",
  /* hist.valve_space */ "Rumskrets",
  /* hist.valve_aria */ (l, d) => `${l} — historik för 3-vägsventil. ${d}. Använd piltangenterna.`,
  /* hist.circ_total */ (d) => `Pumpdrift registrerad · ${d} rutnätstid`,
  /* hist.circ_none */ "Ingen pumpdrift registrerad i perioden.",
  /* hist.circ_on */ "Går",
  /* hist.circ_off */ "Stoppad",
  /* hist.circ_unavailable */ "Otillgänglig",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "fas" : "faser"} · otillgänglig`,
  /* hist.circ_aria */ (l, d) => `${l} — historik för cirkulationspump. ${d}. Använd piltangenterna.`,
  /* hist.valve2_on_total */ (d) => `2WV-utgång PÅ · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV-utgång AV · ${d}`,
  /* hist.valve2_on */ "2WV-utgång PÅ",
  /* hist.valve2_off */ "2WV-utgång AV",
  /* hist.valve2_none */ "Inget PÅ-tillstånd för 2WV-utgången under perioden.",
  /* hist.valve2_aria */ (l, d) => `${l} — historik för 2WV-utgång. ${d}. Använd piltangenterna.`,
  /* hist.flow_switch_total */ (d) => `X10A-status PÅ · ${d} rutnätstid`,
  /* hist.flow_switch_on */ "X10A-status PÅ",
  /* hist.flow_switch_off */ "X10A-status AV",
  /* hist.flow_switch_none */ "Inget PÅ-tillstånd för denna X10A-status under perioden.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — historik för flödesvakt. ${d}. Använd piltangenterna.`,
  /* toast.saved */ "Sparad",
  /* toast.no_changes */ "Inga ändringar",
  /* toast.reboot */ "Startar på nytt — ansluter igen…",
  /* toast.rebooted */ "Startades om — anslut enheten igen",
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
  /* schem.defrost_pill */ "❄ Avfrostning",
  /* schem.outdoor */ "Ute",
  /* insp.close */ "Stäng",
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
  /* wifi.err_ssid */ "SSID kan ha högst 32 tecken",
  /* wifi.err_pass */ "Lösenordet måste vara tomt för öppna nätverk, annars 8–63 tecken",
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
  /* dyn.card */ "Värmekurvediagnos",
  /* dyn.state */ "Status",
  /* dyn.state_recording */ "Registrerar",
  /* dyn.state_recording_nowx */ "Registrerar · utan prognos",
  /* dyn.state_waiting */ "Väntar på uppvärmning",
  /* dyn.state_cooling */ "Kylning · registreras inte",
  /* dyn.state_room */ "Rumskällan kan inte användas",
  /* dyn.state_x10a */ "X10A frånkopplad",
  /* dyn.state_homehub */ "HomeHub frånkopplad",
  /* dyn.state_gate */ "Okänt anläggningstillstånd",
  /* dyn.state_mode */ "Okänt värme-/kylläge",
  /* dyn.state_clock */ "Klockan är inte inställd",
  /* dyn.state_blocked */ "Registrerar inte",
  /* dyn.state_setup_room */ "Konfigurera rumskälla",
  /* dyn.state_setup_homehub */ "HomeHub är inte konfigurerad",
  /* dyn.state_homehub_disabled */ "Diagnos av — HomeHub avaktiverad",
  /* dyn.state_no_broker */ "Registrerar inte — ingen MQTT-broker",
  /* dyn.state_safe_mode */ "Registrerar inte — säkert läge",
  /* dyn.state_inactive */ "Registrerar inte — insamling kör inte",
  /* dyn.room_off */ "Rumstermostaten är av",
  /* dyn.room_not_heating */ "Rumstermostaten står inte på värme",
  /* dyn.room_stale */ "Rumsvärdet är för gammalt",
  /* dyn.room_no_value */ "Väntar på rumsvärde",
  /* dyn.room_invalid_payload */ "Ogiltigt MQTT-meddelande",
  /* dyn.room_invalid_temperature */ "Rumstemperaturen är utanför tillåtet intervall",
  /* dyn.room_invalid_setpoint */ "Måltemperaturen är utanför tillåtet intervall",
  /* dyn.room_no_setpoint */ "Måltemperatur saknas",
  /* dyn.room_no_time */ "Mättid saknas",
  /* dyn.room_retained_no_time */ "Kvarhållet värde utan mättid",
  /* dyn.room_future_time */ "Mättiden ligger i framtiden",
  /* dyn.room_backward_time */ "Mättiden hoppade bakåt",
  /* dyn.room_invalid_time */ "Mättiden är osannolik",
  /* dyn.room_no_enabled */ "Termostatens av/på-status saknas",
  /* dyn.room_no_hvac_mode */ "Termostatläge saknas",
  /* dyn.room_source */ "Källa för rumstemperatur",
  /* dyn.weather */ "Valfri jämförelseprognos",
  /* dyn.strategy */ "Diagnosesignal",
  /* dyn.not_configured */ "Inte konfigurerad",
  /* dyn.outdoor */ "Uppmätt uteluft",
  /* dyn.outdoor_detail_status */ "Status",
  /* dyn.outdoor_detail_now */ "Aktuell mätning",
  /* dyn.outdoor_detail_sample */ "Vid senaste registrerade händelse",
  /* dyn.outdoor_status_live */ (source) => `${source} har en aktuell mätning som läggs till vid varje registrerad händelse.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} är konfigurerad men saknar aktuell mätning. Händelser registreras utan denna axel.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} är inte konfigurerad. Händelser registreras utan denna axel.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} är konfigurerad, men inget registreras nu. Statusraden ovan förklarar varför.`,
  /* dyn.outdoor_sample_none */ "Registrerad utan utetemperatur",
  /* dyn.outdoor_help_axis */ "Utetemperaturen sätter rumsavvikelsen i sammanhang. Den är valfri, avgör aldrig om en händelse sparas och stoppar inte registreringen.",
  /* dyn.outdoor_help_placement */ "Värdet gäller luften där sensorn sitter. Firmware känner inte placeringen: vid inomhusenheten är det rumsluft; i skugga ute är det uteluft för jämförelse.",
  /* dyn.outdoor_help_setup */ "En M5Stack ENV III på Grove-porten kan mäta uteluft kontinuerligt i skugga, även när värmepumpens egen sensor inte uppdateras. Ställ in den under ESP32 → Maskinvara.",
  /* dyn.plant_outdoor */ "Anläggningens uteluft",
  /* dyn.plant_outdoor_help */ "HomeHub-ingång 44 ger värmepumpens uteluftsvärde från samma Modbus-cykel. Det sparas separat från ENV III och styr inte registreringen.",
  /* dyn.shadow_strategy */ "Rått rumsavvikelse · 30 min",
  /* dyn.card_help */ "Var 30:e minut i säker rumsuppvärmning sparas rumsmål minus rumstemperatur, med valfri utetemperatur. Bedöm bara säsongstrenden med drifttid, minsta framledning och termostat; 1 K här är inte 1 K framledning. Endast avläsning.",
  /* dyn.state_help_recording */ "Bekräftad rumsuppvärmning och giltig rumskälla registrerar rå avvikelse. Bedöm säsongstrenden med drifttid och begränsning, inte ett värde.",
  /* dyn.state_help_waiting */ "Anläggningen är inte i normal rumsdrift, så inget värde sparas. På sommaren är detta normalt.",
  /* dyn.state_help_cooling */ "HomeHub rapporterar rumsdrift, men läget är kylning. Kylfönster utelämnas avsiktligt från värmekurvdata.",
  /* dyn.state_help_blocked */ "En nödvändig ingång saknas. Registreringen fortsätter när den återkommer; gamla eller tvetydiga data används aldrig.",
  /* dyn.state_help_room */ "Rumsvärdet når enheten men ger ingen giltig avvikelse från målet. Registreringen fortsätter först när källan kan användas.",
  /* dyn.state_help_setup */ "Diagnosen startar när en tidsstämplad MQTT-rumskälla med målvärde har sparats. Prognosen är valfri; platsen behöver inte delas.",
  /* dyn.state_help_inactive */ "Källorna finns men MQTT-insamlingen är stoppad av säkert läge efter upprepade krascher. Normal start återupptar registreringen.",
  /* dyn.state_help_no_broker */ "Rumskällan är sparad men ingen MQTT-broker är konfigurerad. Ange en broker under Anslutningar; källan behålls och registreringen startar automatiskt.",
  /* dyn.state_help_setup_homehub */ "Diagnosen behöver HomeHub för att skilja uppvärmning från varmvatten och stillestånd. Ange HomeHub-adressen på protokollkortet.",
  /* dyn.state_help_homehub_disabled */ "Diagnosen behöver två HomeHub-signaler. En uttryckligen tom HomeHub-adress stänger av både Modbus och denna diagnos.",
  /* dyn.strategy_help */ "Rumsmål minus rumstemperatur: positivt är för kallt, negativt för varmt; ingen dödzon eller avrundning. Det är en okalibrerad indikator, inte framledningsförskjutning. Läs trenden med D2-begränsning och värmebehov; termostat/ventiler kan dölja en hög kurva.",
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
  /* ref.title */ "Rumstemperaturkälla",
  /* ref.name */ "Namn",
  /* ref.temperature_source */ "Temperaturkälla",
  /* ref.target */ "Måltemperatur",
  /* ref.timestamp_source */ "Källa för tidsstämpel · valfri",
  /* ref.max_age */ "Maximal ålder · sekunder",
  /* ref.temperature_source_help */ "Exakt MQTT-topic och valfri JSON-sökväg efter $. Saknad eller felaktig sökväg rapporteras när ett meddelande kommer.",
  /* ref.target_help */ "Fast °C-värde eller exakt MQTT-topic med valfri JSON-sökväg efter $.",
  /* ref.timestamp_source_help */ "Valfri RFC3339-/Unix-källtid som topic$sökväg. Tomt fält använder MQTT-mottagningstiden; kvarhållna värden avvisas då.",
  /* ref.max_age_help */ "Högsta tillåtna ålder för källmätningen (10–3600 s).",
  /* ref.error */ "Senaste fel",
  /* ref.broker_off */ "MQTT-broker avaktiverad",
  /* ref.retained */ "sparad av brokern",
  /* ref.time_untrusted */ "Kvarhållet värde utan tillförlitlig mättid",
  /* ref.clock_unsynced */ "Enhetsklockan är inte synkroniserad",
  /* ref.now */ "nu",
  /* ref.ago */ (s) => `för ${s} s sedan`,
  /* ref.age_unknown */ "okänd",
  /* ref.saved */ "Rumstemperaturkälla sparad",
  /* ref.detail.status_label */ "Status:",
  /* ref.detail.diagnosis_label */ "Värmekurvediagnos:",
  /* ref.status.measurement_valid */ "Giltig mätning",
  /* ref.status.not_configured */ "Inte konfigurerad",
  /* ref.status.usable */ "Kan användas",
  /* ref.status.unusable */ "Kan inte användas",
  /* ref.status.error */ "Fel",
  /* ref.status.stale */ "För gammal",
  /* ref.status.waiting */ "Väntar",
  /* ref.status.unavailable */ "Otillgänglig",
  /* ref.detail.setup */ "Lägg till en MQTT-källa med knappen ovan",
  /* ref.detail.stale */ "Mätningen är äldre än tillåten",
  /* ref.detail.waiting */ "Ingen MQTT-mätning mottagen ännu",
  /* ref.detail.error */ (e) => `MQTT-meddelande avvisat: ${e}`,
  /* ref.detail.temperature_label */ "Rumstemperatur:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Måltemperatur:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Senaste mätning:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · tillåten: högst ${max} s`,
  /* ref.detail.purpose */ "Diagnosen jämför rum- och måltemperatur för att hitta långsiktiga tecken på för hög/låg värmekurva. Den styr inte värmepumpen.",
  /* ref.delete */ "Radera",
  /* ref.deleting */ "Raderar…",
  /* ref.deleted */ "Rumstemperaturkällan och mätningen är raderade",
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
  /* wx.title */ "Open-Meteo-väderprognos",
  /* wx.latitude */ "Latitud",
  /* wx.longitude */ "Longitud",
  /* wx.waiting */ "Väntar på prognos",
  /* wx.fetching */ "Hämtar Open-Meteo-prognos…",
  /* wx.unavailable */ "Otillgänglig",
  /* wx.error */ "Fel i Open-Meteo-prognosen",
  /* wx.detail.status */ "Status:",
  /* wx.status.fresh */ "Uppdaterad",
  /* wx.status.inactive */ "Av",
  /* wx.status.fetching */ "Uppdaterar",
  /* wx.status.stale */ "För gammal",
  /* wx.status.unavailable */ "Otillgänglig",
  /* wx.status.waiting */ "Väntar",
  /* wx.detail.fresh */ "Prognosen har hämtats.",
  /* wx.detail.fetching */ "ESP32 hämtar nya prognosedata.",
  /* wx.detail.stale */ "Senaste lyckade hämtning är för gammal; värdena visas endast för diagnos.",
  /* wx.detail.unavailable */ "Senaste hämtningen misslyckades; ett äldre värde kan visas endast för diagnos.",
  /* wx.detail.waiting */ "Ingen prognos är mottagen ännu.",
  /* wx.detail.temperature_label */ "Temperatur:",
  /* wx.detail.temperature */ (v) => `${v} °C är medelprognosen för uteluften under de två närmaste hela timmarna.`,
  /* wx.detail.solar_label */ "Globalstrålning:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² är prognosen för globalstrålning på en horisontell yta i samma tvåtimmarsperiod.`,
  /* wx.detail.source_label */ "Källa:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Endast observation; prognosen ändrar inte värmepumpsstyrningen.",
  /* wx.err_both */ "Ange både latitud och longitud, eller lämna båda tomma för att avaktivera",
  /* wx.err_latitude */ "Latitud måste vara ett decimaltal från -90 till 90",
  /* wx.err_longitude */ "Longitud måste vara ett decimaltal från -180 till 180",
  /* wx.saving */ "Sparar väderkälla…",
  /* wx.hint.configured */ "ESP32 hämtar var 45:e minut; koordinater och offentlig IP syns då för Open-Meteo. Töm båda fälten för att ta bort källan.",
  /* wx.hint.setup */ "Ange latitud/longitud; ett inklistrat par delas automatiskt. Hämtning sker var 45:e minut och visar koordinater/offentlig IP för Open-Meteo. Prognosen styr inte anläggningen.",
  /* wx.attribution */ "Väderdata från Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Ange exakt MQTT-topic, eventuellt följt av $json-sökväg",
  /* ref.err_target */ "Ange fast värde 5–35 °C eller exakt MQTT-topic, eventuellt med $json-sökväg",
  /* ref.err_timestamp_source */ "Ange exakt MQTT-topic, eventuellt följt av $json-sökväg",
  /* ref.err_max_age */ "Maximal ålder måste vara ett heltal från 10 till 3600 sekunder",
  /* ref.save_help */ "Lagring säkrar kopplingen. Prenumerationen är aktiv bara när anläggningsdiagnosen är på. Ett läsbart, aktuellt MQTT-värde krävs fortfarande.",
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
  /* board.led_rgb_off */ "Av — inget Wi-Fi-läge aktivt.",
  /* board.led_rgb_setup */ "Blå, blinkar långsamt — installationsportal aktiv.",
  /* board.led_rgb_connecting */ "Gul, blinkar snabbt — ansluter Wi-Fi.",
  /* board.led_rgb_healthy */ "Grön, fast — alla konfigurerade anslutningar redo.",
  /* board.led_rgb_bus_down */ "Röd, dubbelblinkning — X10A frånkopplad.",
  /* board.led_rgb_mqtt_down */ "Orange, blinkar — X10A ansluten, MQTT frånkopplad.",
  /* board.led_rgb_wipe_armed */ "Röd, mycket snabb blinkning — radering redo; släpp för att avbryta.",
  /* board.led_rgb_wiping */ "Vit, fast — fabriksåterställning/dataradering; koppla inte från strömmen.",
  /* board.led_gpio_off */ "Av — inget Wi-Fi-läge aktivt.",
  /* board.led_gpio_setup */ "Långsam blinkning — installationsportal aktiv.",
  /* board.led_gpio_connecting */ "Snabb blinkning — ansluter Wi-Fi.",
  /* board.led_gpio_healthy */ "Fast sken — alla konfigurerade anslutningar redo.",
  /* board.led_gpio_bus_down */ "Dubbelblinkning — X10A frånkopplad.",
  /* board.led_gpio_mqtt_down */ "Medelsnabb blinkning — X10A ansluten, MQTT frånkopplad.",
  /* board.led_gpio_wipe_armed */ "Mycket snabb blinkning — radering redo; släpp för att avbryta.",
  /* board.led_gpio_wiping */ "Fast sken efter snabb blinkning — fabriksåterställning/dataradering; koppla inte från strömmen.",
  /* board.ledinv */ "Aktiv vid LOW — LED lyser vid låg stiftnivå",
  /* board.btninv */ "Aktiv vid LOW — knappen drar stiftet till GND",
  /* board.hint */ "Fabriksåterställning: håll 5 s. Raderar permanent Wi-Fi/alla inställningar, historik/trender, tillståndstider och rå kärndump. Portalen öppnas bara efter fullständig radering. Annars släpp och håll igen i 5 s. Välj «Ingen» utan knapp.",
  /* card.hardware */ "Maskinvara",
  /* card.hw_off */ "Ingen",
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
  /* card.diagnostics_help */ "Aktiverar 24-timmars anläggningsdiagnos, värmekurvediagnos och tilläggskällor som rumstemperatur, väderprognos och cirkulationspumpens effekt.",
  /* diagnostics.off */ "Av",
  /* diagnostics.on */ "På",
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
  /* hist.cop_none */ "Ingen COP-historik när strömvärdet kommer från CT-klämmor. Kabeldragningen avgör vilka laster de täcker; värmemätningen slutar före BUH och omfattar inte direkt BSH-värme. Systemgränserna kan därför avvika.",
]);

INSPECT_I18N.sv = inspectValues(
  ["Ingen aktuell mätning:", "Kompressorn står; utomhusgivare som bara uppdateras i drift döljer gamla värden."],
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
      ? "Standby: X10A står; HomeHub ger uteluft utan känt mättidsstempel."
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
      : `${fmt1(d.dt)} K${d.dtSet != null ? `; mål ${fmt1(d.dtSet)} K` : ""}; positivt betyder att PHE värmer vattnet.`], // dt
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
      : d.copBlock === "mb_scope" ? "Ingen COP: HomeHub mäter enhetens el men värmen bara PHE."
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
    ["Cirkulationspump", "Cirkulationspumpens hastighet", "Driver gemensam krets/vald 3WV-gren och kan gå efter kompressorstopp; tolka med flödet.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `Pumpen rapporterar stopp men ${fmt1(d.flow)} l/min mäts; extern pump, eftergång eller signalmotsägelse är möjlig.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `${fmt0(d.pump)} %; ${fmt1(d.flow)} l/min.` : `${fmt0(d.pump)} %; flödesmätning saknas och cirkulation är inte bekräftad.`
      : waterMoving(d) ? `Inget pumpvarvtal; ${fmt1(d.flow)} l/min mäts.`
      : d.pumpOn === true ? d.flow != null ? `Pump aktiv, men bara ${fmt1(d.flow)} l/min; cirkulation ej bekräftad.` : "Pump aktiv; flödesmätning saknas."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Pump stoppad; ${fmt1(d.flow)} l/min visas, cirkulation ej bekräftad.` : "Pump stoppad; flödesmätning saknas."
      : `Pumpstatus osäker; ${fmt1(d.flow)} l/min bevisar inte cirkulation.`], // pump
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
    ["Vattentryck", 0, "Vattentryck, inte köldmedietryck; tillåtet intervall beror på modell/installation."], // wp
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
  "Enhetens diagnosstatus", // 21
  "Enhetens felkod", // 22
  "Enhetens felunderkod", // 23
  "Cirkulationspump aktiv", // 30
  "Kompressor aktiv", // 31
  "Tankvärmare aktiv", // 32
  "Tankdesinfektion aktiv", // 33
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
  ["Återvärmning höjer tanken till målet när temperaturen sjunker under startgränsen."], // 23
  ["Schemalagt förval: Komfort använder högt mål, Eco lågt."], // 24
  ["I hybridsystem begär styrningen varmvatten från pannan."], // 25
  ["3WV leder vatten till tank eller rum; 1=tank, 0=rum, men läget bevisar inte aktivitet."], // 26
  ["X10A PÅ/AV-utgång för valfri 2WV; bevisar inte spänning eller mekaniskt läge."], // 27
  ["Blandningsventilens öppning för en extra zon."], // 28
  ["Framledningstemperaturens mål för valt värme- eller kylläge."], // 29
  ["Blandad framledningstemperatur för sekundärzonen efter blandningsventilen."], // 30
  ["Temperatur efter BUH, oftast R2T; kan omfatta BUH-värme men bevisar inte avgivartemperatur."], // 31
  ["R1T från PHE före BUH; R4T/flöde ger en uppskattning vars placering är modellberoende."], // 32
  ["R4T-retur till PHE; bedöm ΔT med flöde, kompressor och läge, inte en universell 5 K-regel."], // 33
  ["Vattenflöde i gemensam krets; minimum beror på modell/läge och lågt värde kan utlösa 7H."], // 34
  ["Hydraultryck: många handböcker kräver >1 bar; vid ≤1,0 bar gäller handboken för exakt modell."], // 35
  ["Inverterat pumpkommando: 0 är maxhastighet och 100 är stopp."], // 36
  ["Pumpstatus; bevisar inte nyttig värme och kan vara aktiv utan kompressor. Jämför flödet."], // 37
  ["Status för pumpen i en konfigurerad solvärmekrets."], // 38
  ["Angiven hastighet för pumpen som profilen namnger."], // 39
  ["Binär X10A-status «Water flow switch». På modeller med dokumenterad flödesvakt betyder PÅ att vattenrörelse upptäckts; statusen mäter inte l/min och bevisar inte modellens miniminivå. Vissa stödda modeller visar statusen utan dokumenterad separat fysisk brytare. Jämför med uppmätt flöde och 7H/C0 när pumpen går."], // 40
  ["Hydrauliskt läge: stopp, värme, kyla, varmvatten eller kombinerat; bevisar inte kompressordrift."], // 41
  ["Smart Grid-kommando med fyra lägen från HomeHub eller två X10A-kontakter; inte värme-/kylläge."], // 42
  ["Aktuellt rumsläge värme/kyla utan Auto; kräver aktivitetssignal och bevisar inte kompressordrift."], // 43
  ["HomeHub-val Auto/värme/kyla; konfiguration, inte aktuell drift eller bevis på aktivitet."], // 44
  ["Utomhusstatus stopp/värme/kyla; kan stå kvar med kompressorn av och bevisar inte värme."], // 45
  ["Avfrostning av utomhusenheten; normalt i kallt/fuktigt väder, men biten diagnostiserar inte frekvens."], // 46
  ["Allvarlighetsklass för aktivt meddelande: Normal, Fel, Varning eller Försiktighet."], // 47
  ["Betydelsen av felkoden som rapporteras nu."], // 48
  ["Nöddrift efter värmepumpsfel."], // 49
  ["Enhetens larmrelä; signalerar fel till anslutet externt larm/övervakning."], // 50
  ["Målrumstemperatur för huvudzonen i värme- eller kylläge."], // 51
  ["Intern «thermo ON»-begäran; identifierar inte last/kompressor, och «Space heating Operation» är inte behov."], // 52
  ["Elektrisk «Space H Operation»-utgång; inte normal aktivitet eller bevis på kompressor/värme."], // 53
  ["Normal rumsuppvärmnings/-kylaktivitet, inte behov; kan vara PÅ i kyla med kompressorn av."], // 54
  ["Konfigurerad målrumstemperatur för zonen som styrs av enhetens egen givare."], // 55
  ["Rumstemperatur från enhetens inbyggda eller kabelanslutna givare."], // 56
  ["Utloppsskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 57
  ["Växelriktarströmskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 58
  ["Högtrycksskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 59
  ["Lågtrycksskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 60
  ["Växelriktartemperaturskydd: PÅ/AV + räknare 0–7; bara jämförbar ökning visar aktivitet, inte orsak. Gräns/återställning/7→0 är odokumenterat."], // 61
  ["Generisk intern begränsningsbit, inte kopplad till de fem namngivna skydden."], // 62
  ["Vatten vid plattvärmeväxlarens in-/utlopp, där energi överförs mellan köldmedium och vatten."], // 63
  ["Givare på utomhusvärmeväxlaren; <0 °C kan vara normalt och bevisar inte is utan fuktdata."], // 64
  ["Utetemperatur uppmätt av enheten för väderkompensering och driftval."], // 65
  ["Varm gas från kompressorn; beror på tryck, varvtal, läge och last. Ett värde eller intervall från annan serie bevisar inte fel eller köldmediebrist."], // 66
  ["Temperatur på kall lågtrycksgas tillbaka till kompressorn."], // 67
  ["Köldmedietemperatur i vätskeröret mellan värmeväxlarna."], // 68
  ["Köldmedium vid förångarens in-/utlopp, där värme tas upp."], // 69
  ["Köldmediets insprutningstemperatur för intern reglering och skydd."], // 70
  ["Temperatur i köldmediekretsens tvåfasdel med både vätska och ånga."], // 71
  ["Avfrostningsgivare ute; placering och styrning är modellspecifika. En punkt bevisar inte is på hela batteriet eller avslutad avfrostning."], // 72
  ["Mättnadstemperatur beräknad från tryck; inte en egen givare eller tryck i bar."], // 73
  ["Hög-/lågtryck: bedöm stabil trend i samma läge/modell; start, oljeretur och avfrostning ändrar det. Inget allmänt normalområde."], // 74
  ["Kompressorhastighet i rps; högre betyder ofta större behov men mäter inte värme."], // 75
  ["EEV-steg är kommando utan mekanisk återkoppling, inte % eller flöde. Ensamt bevisar det inte rörelse, fast ventil eller köldmediebrist."], // 76
  ["Temperatur på elektroniken som styr utomhusfläktmotorn."], // 77
  ["Utomhusfläktens hastighet som steg eller rpm."], // 78
  ["Internt mål efter modell/läge; jämför med motsvarande mättnadstemperatur från tryck. Avvikelsen diagnostiserar inte orsak eller fyllning."], // 79
  ["Internt mål för kompressorns utlopps-/porttemperatur som används av skyddet."], // 80
  ["Önskad ΔT mellan framledning och retur; modell-/lägesberoende, inte en universell 5 K-regel."], // 81
  ["Köldmediet som enheten fyllts med, t.ex. R32 eller R410A."], // 82
  ["Temperatur vid en kompressorport för intern övervakning och skydd."], // 83
  ["Tryckmätning i utomhusenhetens köldmediekrets."], // 84
  ["Fasström från CT; 230 V-uppskattningen är okalibrerad och bortser från verklig spänning/effektfaktor."], // 85
  ["Ström som kompressorväxelriktaren drar; grov belastningsindikator."], // 86
  ["Temperatur i kylflänsen för utomhusenhetens växelriktare/kraftelektronik."], // 87
  ["Aktiva steg i elektrisk tillsatsvärme, uttryckta som effektnivå."], // 88
  ["BUH-steg: 0=inget; högre steg kan stödja vid kyla, avfrostning, varmvatten eller nödläge."], // 89
  ["HomeHub-ingång 32: BSH PÅ/AV, inte effekt; ingång 51 är värmepumpsförbrukning, inte BSH."], // 90
  ["BSH i tanken kan värma utan kompressor/pump; X10A ger PÅ/AV, inte effekt."], // 91
  ["Status för en elektrisk värmares termiska skyddskedja; öppen kedja stoppar driften."], // 92
  ["Rörfrostskydd; modellberoende, kräver ström och täcker inte strömavbrott."], // 93
  ["X10A-frostskyddsstatus; utan modelldata identifierar den inte pump, värmare eller skyddad zon."], // 94
  ["Markslinga med frostskyddsvätska och pump; vätska, tryck och gränser beror på konstruktion/handbok."], // 95
  ["Hybridkälla värmepump/kombinerat/panna; ett val, inte uppmätt värme."], // 96
  ["Hybridens framledningsmål, inte mätt temperatur; tolka med läge och faktiska värden."], // 97
  ["Bivalent tillåtelse/status; PÅ bevisar inte att pannan brinner."], // 98
  ["Begäran till pannan; bevisar inte förbränning eller levererad värme."], // 99
  ["Pannans vattenmål, inte mätt temperatur; beror på behov och anläggning."], // 100
  ["Bivalent BE_COP-värde; X10A-betydelse/skala är odokumenterad och inte aktuell COP."], // 101
  ["Tariff-, Smart Grid- eller solingång; åtgärden är konfigurationsberoende, PÅ visar bara kontakten."], // 102
  ["Fast nominell inne-/uteeffektklass i kW eller kod; inte aktuell mätning."], // 103
  ["Tyst läge sänker utomhusbuller och kan begränsa tillgänglig värme-/kyleffekt."], // 104
  ["HomeHub-status Inget fel/Fel/Varning; identifierar inte ensam orsaken."], // 105
  ["Betydelsen av felkoden som rapporteras nu."], // 106
  ["Extra underkod; giltig bara med huvudstatus/-kod och dold när den saknas."], // 107
  ["HomeHub visar kompressor PÅ/AV, inte hastighet/kapacitet; tolka med drift och vattenflöde."], // 108
  ["Visar om normal varmvattendrift är aktiv."], // 109
  ["Visar om normal rumsuppvärmning eller -kylning är aktiv."], // 110
  ["PHE-utlopp före BUH; jämför med retur bara vid cirkulation för att få ΔT."], // 111
  ["Framledning efter BUH; ökning kan bero på elvärme men måste bekräftas med BUH-status."], // 112
  ["Vattnets uppmätta temperatur i varmvattentanken."], // 113
  ["Vätskerörstemperatur; förhållandet är lägesberoende och ett värde räcker inte för diagnos."], // 114
  ["Huvudzonens rumstemperatur rapporterad av fjärrkontrollen."], // 115
  ["Elförbrukning via HomeHub; beror på läge/laster och ska inte tillskrivas bara kompressorn."], // 116
  ["HomeHubs framledningsmål för värme, endast avläsning; sänkning hjälper bara om rumsmålet nås."], // 117
  ["HomeHubs framledningsmål för kyla, endast avläsning; relevant när kyla är tillåten/aktiv."], // 118
  ["Visar om rumskretsen är aktiverad: brytarläge, inte aktuell aktivitet."], // 119
  ["Tyst läge sänker utomhusbuller enligt vald nivå och kan minska tillgänglig effekt."], // 120
  ["Återvärmningsmål för varmvatten, inte startgräns; hysteres och program gäller också."], // 121
  ["Korrigering −10…+10 K av värmemålet; bevisar inte värme utan aktiv rumsdrift."], // 122
  ["Lagringsgräns vid Rekommenderad på; lägsta av denna och allmän gräns gäller. Inte förbrukning."], // 123
  ["Allmän HomeHub-gräns: ett tak, inte förbrukning; lägre värde begränsar effekt i Smart Grid-läge."], // 124
]);

MODEL_DESCRIPTION_I18N.sv = modelDescriptionValues([
  ["Egen fel-/varningsstatus: aktivt fel ger Varning; varning eller meddelande senaste 24 t ger INFO utan projektslutsats."], // health_fault
  ["R5T skiktad;K/t=MAX≠Ø/dygn;cirk.≠orsak;proj.band 0,8–1,85.Ant.:200l jämnt;giltiga=MAX;COP;utesl./sakn.h utanför;el≠mätt."], // health_dhw_loss
  ["INFO vid ≥12 värmekörningar och medel <10 min; varmvatten/kyla utelämnas. Inte Daikin-gräns; vid många oklassificerade bedöms alla gemensamt."], // health_cycling
  ["Avfrostning: INFO över 15 % vid ≥3 cykler; inte Daikin-gräns. R4T är livekontext utanför bedömningen och en punkt beskriver inte hela batteriet."], // health_defrost
  ["Lägsta tryck: >1,0 bar; ≤1,0 ger INFO och efter 60 s Varning, men tillåtet intervall är modellberoende."], // health_pressure
  ["Vattenflöde efter 60 s pumpdrift: endast uppmätt avsnitt; jämför samma modell/läge/villkor, ingen universell gräns."], // health_flow
  ["Observerad BUH-/BSH-tid: kyla, nödläge, avfrostning, varmvatten eller överskott kan förklara; ingen universell gräns."], // health_heater
  ["Experimentell bevakning av fem interna skyddsräknare. Endast en tydlig ökning mellan jämförbara avläsningar räknas, även om den först syns vid stopp eller övergång i kompressorstatus; baslinje, stabila/fallande värden, luckor och återställningar räknas inte. En ökning är information, inte diagnos, och ingen ökning bevisar inte att ingen begränsning skett."], // health_retries
  ["Ledigt RAM/24 h: varaktig nedgång kan visa kvarhållna allokeringar. En varm omstart med kvarvarande matning fortsätter RAM-trenden; normal omstart, firmwareuppdatering eller strömavbrott återläser endast avslutade 5-minutersintervall från flash, och öppet intervall kan saknas."], // free_heap
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
