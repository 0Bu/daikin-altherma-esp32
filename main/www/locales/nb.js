// translation-source: 880b8b2cbfd200117fae74020a6ff172c175f8793429a72abee92f49af703b01
I18N.nb = localeValues([
  /* sys.nodata */ "Ingen data",
  /* sys.unreachable */ "Ikke tilgjengelig",
  /* sys.x10a_down */ "X10A frakoblet",
  /* sys.mb_carrying */ "Ukjent driftsmodus — verdier fra Modbus",
  /* sys.mb_only */ "X10A frakoblet — verdier fra Modbus",
  /* sys.mb_source */ "X10A frakoblet · Modbus",
  /* mode.stop */ "Stopp",
  /* mode.heat */ "Oppvarming",
  /* mode.cool */ "Kjøling",
  /* mode.space */ "Romdrift",
  /* mode.dhw */ "Tappevann",
  /* mode.heat_dhw */ "Oppvarming + tappevann",
  /* mode.cool_dhw */ "Kjøling + tappevann",
  /* mode.space_dhw */ "Romdrift + tappevann",
  /* sys.unreachable_sub */ "Enheten svarer ikke — prøver igjen…",
  /* sys.waiting */ "Venter på varmepumpen…",
  /* sys.operating */ "I drift",
  /* sys.standby */ "Standby — ikke i drift",
  /* sys.defrosting */ "Avriming",
  /* sys.circulating */ "Sirkulasjon — kompressor av",
  /* sys.cool_mode */ "Kjølemodus",
  /* sys.residual_circulating */ "Restvarme sirkulerer — ingen kjøleeffekt",
  /* sys.bsh_active */ "Tankvarmer aktiv",
  /* sys.online */ "Tilkoblet",
  /* sys.fault */ "Feil",
  /* sys.warning */ "Advarsel",
  /* sys.fault_line */ (c) => "Feil · " + c + " — kontroller Daikin-feilkoden.",
  /* sys.warning_line */ (c) => "Advarsel · " + c + " — kontroller varmepumpen.",
  /* sys.polled */ (s) => `lest for ${s} s siden`,
  /* recovery.title */ "Gjenopprettingsmodus",
  /* recovery.meta_heap */ "Enheten gikk flere ganger tom for minne og startet på nytt. Den kjører nå uten varmepumpeforbindelse og MQTT, slik at nettsiden er tilgjengelig. Konfigurasjonen er trolig i orden — installer nyere fastvare under Innstillinger. Et strømbrudd prøver alle funksjoner på nytt.",
  /* recovery.meta */ "Enheten har startet på nytt flere ganger og er i gjenopprettingsmodus. Varmepumpeforbindelsen og MQTT er satt på pause. Kontroller konfigurasjonen, særlig RX/TX-pinnene på protokollkortet, og start enheten på nytt.",
  /* rollback.title */ "Wi-Fi-endringen mislyktes — tilbakestilt",
  /* rollback.meta */ (back) => `Enheten kunne ikke koble til med de nye Wi-Fi-innstillingene. Det forrige nettverket${back} ble gjenopprettet, og enheten startet på nytt. Kontroller nettverksnavn og passord under Innstillinger → Tilkoblinger og prøv igjen.`,
  /* crash.title_fault */ "Enheten startet på nytt etter et krasj",
  /* crash.title_orphan */ "Krasjrapport fra en tidligere omstart",
  /* crash.reset */ "Tilbakestilling",
  /* crash.task */ "Oppgave",
  /* crash.fw */ "FW",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "skadet",
  /* crash.download */ "Last ned krasjrapport",
  /* crash.copy */ "Kopier diagnose",
  /* crash.dismiss */ "Slett rapport",
  /* crash.copied */ "Diagnosen er kopiert — lim den inn i en feilrapport",
  /* crash.copy_fail */ "Kopiering mislyktes — åpne /coredump og /diag manuelt",
  /* crash.ask_dump */ "Slette på enheten? Kjernedumpen slettes også — last den ned først hvis den skal brukes i en feilrapport.",
  /* crash.ask */ "Slette denne rapporten på enheten?",
  /* crash.ask_yes */ "Slett",
  /* crash.ask_no */ "Behold",
  /* crash.deleted */ "Krasjrapport slettet",
  /* crash.delete_fail */ "Enheten kunne ikke slette rapporten — den finnes fortsatt",
  /* bug.row */ "Rapporter feil",
  /* bug.title */ "Rapporter feil",
  /* bug.intro */ "Beskriv problemet kort. Enheten legger ved status, målinger og logg. Nettverksnavn, adresser og servernavn fjernes først.",
  /* bug.what */ "Hva skjer?",
  /* bug.what_ph */ "Tanktemperaturen har vist 12800 °C i Home Assistant siden i morges.",
  /* bug.need_text */ "Beskriv først hva som skjer — én eller to setninger er nok.",
  /* bug.continue */ "Opprett rapport",
  /* bug.step2_title */ "Kontroller rapporten",
  /* bug.step2 */ "Kontroller rapporten nedenfor. Knappen kopierer den og åpner GitHub-skjemaet med beskrivelsen din. Lim rapporten inn i «Device report», svar på resten og send inn.",
  /* bug.collecting */ "Henter enhetsdata…",
  /* bug.collect_fail */ "Alle data kunne ikke leses — rapporten nedenfor viser hva som mangler.",
  /* bug.copy */ "Kopier og åpne GitHub",
  /* bug.download */ "Last ned .md",
  /* bug.md_hint */ "Hvis kopiering ikke virker, kan du laste ned samme rapport som .md og dra filen til «Device report» i stedet for å lime inn teksten.",
  /* bug.copied */ "Rapport kopiert — lim den inn i «Device report»",
  /* bug.copy_fail */ "Kopiering mislyktes — merk teksten nedenfor og kopier manuelt",
  /* bug.redacted */ "Nettverksnavn, adresser, broker og servernavn er allerede fjernet.",
  /* nav.settings */ "Innstillinger",
  /* nav.back */ "Tilbake",
  /* nav.settings_alert */ (n) => `Innstillinger — ${n} ${n === 1 ? "tilkobling har" : "tilkoblinger har"} feil`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Begge kilder er enige",
  /* src.delta */ (d, u) => `Avvik ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "De to kildene er uenige om denne tilstanden",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Søker…",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Tilkoblinger",
  /* conn.offline */ "Frakoblet",
  /* conn.disabled */ "Deaktivert",
  /* conn.connecting */ "Kobler til…",
  /* conn.connected */ "Tilkoblet",
  /* conn.resolving */ "Slår opp…",
  /* conn.eth_no_cable */ "Ingen kabel",
  /* conn.eth_no_lease */ "Kabel tilkoblet, ingen adresse",
  /* conn.eth_fd */ "Full dupleks",
  /* conn.enabled */ "Aktiv",
  /* conn.enabled_noping */ "Aktiv, verten svarer ikke på ping",
  /* conn.synced */ "Synkronisert",
  /* conn.syncing */ "Synkroniserer…",
  /* conn.error */ (e) => "Feil: " + e,
  /* conn.connected_to */ (s) => "Tilkoblet " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Trykk for å redigere.`,
  /* modbus.err.mdns_not_found */ "Fant ingen HomeHub via mDNS.",
  /* modbus.err.no_address */ "Ingen HomeHub-adresse er angitt.",
  /* modbus.err.resolve_failed */ "HomeHub-adressen kunne ikke slås opp.",
  /* modbus.err.connect_timeout */ "Tidsavbrudd — HomeHub svarer ikke.",
  /* modbus.err.connection_refused */ "HomeHub svarer, men Modbus TCP-porten er stengt.",
  /* modbus.err.network_unreachable */ "Ingen nettverksrute til HomeHub.",
  /* modbus.err.host_unreachable */ "HomeHub er ikke tilgjengelig på nettverket.",
  /* modbus.err.connect_failed */ "Tilkoblingen til HomeHub mislyktes.",
  /* modbus.err.request_failed */ (r) => `Kunne ikke opprette Modbus-forespørsel${r ? ` for register ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Tidsavbrudd ved sending av Modbus-forespørsel${r ? ` til register ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `Kunne ikke sende Modbus-forespørsel${r ? ` til register ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Tidsavbrudd for svar fra HomeHub${r ? ` på register ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `HomeHub lukket forbindelsen${r ? ` ved register ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `Kunne ikke lese svar fra HomeHub${r ? ` på register ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Ugyldig Modbus-svar${r ? ` på register ${r}` : ""}.`,
  /* modbus.err.internal_error */ "Intern feil i Modbus-avlesningen.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub avviser register ${r || "?"} — unntak ${n}: ${why}.`,
  /* modbus.exc.1 */ "ugyldig funksjon",
  /* modbus.exc.2 */ "ugyldig registeradresse",
  /* modbus.exc.3 */ "ugyldig verdi",
  /* modbus.exc.4 */ "enhetsfeil",
  /* modbus.exc.5 */ "forespørsel bekreftet",
  /* modbus.exc.6 */ "enheten er opptatt",
  /* modbus.exc.8 */ "minneparitetsfeil",
  /* modbus.exc.10 */ "gateway-bane utilgjengelig",
  /* modbus.exc.11 */ "målet svarer ikke",
  /* modbus.exc.unknown */ "ukjent årsak",
  /* card.model */ "Modell",
  /* card.hplink */ "Varmepumpeforbindelse",
  /* card.online */ "Tilkoblet",
  /* card.uptime */ "Oppetid",
  /* card.freeheap */ "Ledig minne",
  /* card.maxalloc */ "Største ledige blokk",
  /* card.offline */ "Frakoblet",
  /* card.protocol */ "Protokoll",
  /* card.rxpin */ "RX-pinne",
  /* card.txpin */ "TX-pinne",
  /* card.capacity */ "Nominell effekt, utedel",
  /* card.hplink_help */ "Viser om ESP32 mottar gyldige svar fra varmepumpen via X10A.",
  /* card.protocol_help */ "X10A-I og X10A-S er de støttede rammeformatene for servicegrensesnittet. Fastvaren gjenkjenner formatet fra gyldige svar.",
  /* card.rxpin_help */ "GPIO der ESP32 mottar X10A-data. Når forbindelsen er frakoblet, starter valg av pinnepar en ny automatisk gjenkjenning.",
  /* card.txpin_help */ "GPIO der ESP32 sender X10A-forespørsler. RX og TX må være forskjellige og stemme med kablingen.",
  /* card.capacity_iu */ "Nominell effekt, innedel",
  /* card.candidates */ "Mulige modeller",
  /* card.oueeprom */ "ID for utedel",
  /* card.checkup */ "Anleggsdiagnose · 24 t",
  /* service.title */ "Serviceobservasjon av kjølekretsen",
  /* service.state.waiting */ "VENTER",
  /* service.state.observing */ "OBSERVERER",
  /* service.state.limited */ "BEGRENSET",
  /* service.state.interrupted */ "AVBRUTT",
  /* service.row.window */ "Gjeldende vindu",
  /* service.row.reason */ "Årsak",
  /* service.reason.unsupported_profile */ "Profilen mangler nødvendige signaler.",
  /* service.reason.compressor_not_running */ "Kompressoren står.",
  /* service.reason.unsupported_or_unknown_mode */ "Ikke romoppvarming, eller ukjent modus.",
  /* service.reason.dhw_path */ "Tappevann aktivt.",
  /* service.reason.defrost */ "Avriming aktiv.",
  /* service.reason.unit_fault */ "Enhetsfeil aktiv.",
  /* service.reason.special_controller_phase */ "Oppstart, omstart, oljeretur eller trykkutjevning aktiv.",
  /* service.reason.missing_fresh_signal */ "Nødvendig ferskt signal mangler.",
  /* service.reason.poll_gap */ "X10A-avbrudd eller bevisst pause.",
  /* service.window */ (d, n) => `${d} · ${n} ferske ${n === 1 ? "prøve" : "prøver"}`,
  /* service.help.observing */ "Ferske verdier fra samme X10A-avlesning er sammenhengende under disse forholdene.",
  /* service.help.limited */ "Vinduet er sammenhengende; valgfri temperatur-, trykk-, ute- eller fasekontekst mangler.",
  /* service.help.interrupted */ "Vinduet er avsluttet; neste kvalifiserte avlesning starter på null.",
  /* service.common */ "Kun observasjon: ingen service-/fullasttest; intet bevis på stabilitet eller kjølemiddelfylling; ingen normalvurdering. EEV-pulser er kommandoer, ikke ventiltilbakemelding.",
  /* check.fault */ "Anleggsfeil",
  /* check.dhw_loss */ "Varmetap fra tank",
  /* check.cycling */ "Kompressorstarter",
  /* check.defrost */ "Avriminger",
  /* check.pressure */ "Laveste vanntrykk",
  /* check.flow */ "Laveste vannmengde",
  /* check.heater */ "Elektrisk tilleggsvarme",
  /* check.retries */ "Beskyttelsesinngrep",
  /* check.status.ok */ "OK",
  /* check.status.info */ "INFO",
  /* check.status.warn */ "ADVARSEL",
  /* check.status.collecting */ "SAMLER",
  /* check.status.observation */ "KUN MÅLING",
  /* check.status.experimental */ "EKSPERIMENTELL",
  /* check.status.unavailable */ "UTILGJENGELIG",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · ${n}/${a} vurdert` : s,
  /* check.detail.value_label */ "Måling:",
  /* check.detail.assessment_label */ "Vurdering:",
  /* check.detail.ok */ "Vurderingen er fullført uten funn i de observerte anleggsdataene.",
  /* check.detail.info */ "Nyttig informasjon, ikke bevis på feil. Grensen for avvik står under «Normalt».",
  /* check.detail.warn */ "Et enhetsfunn eller en dokumentert grense krever kontroll.",
  /* check.detail.fault.error */ "Anlegget melder en feil nå. Koden vises på kortet «Drift».",
  /* check.detail.fault.warning */ "Anlegget melder en advarsel nå, ikke en feil. Koden vises på kortet «Drift».",
  /* check.detail.fault.past */ "Anlegget melder ingenting nå, men en melding oppstod og forsvant de siste 24 timene. Det krever ingen handling alene; noter tidspunktet hvis det gjentar seg.",
  /* check.detail.fault.past_unknown */ "En melding oppstod de siste 24 timene, men nåværende tilstand kan ikke leses. Kontroller X10A-forbindelsen.",
  /* check.detail.collecting */ (n, r) => `${n} av ${r} registrert; kan ikke vurderes ennå.`,
  /* check.detail.cycling_split */ " Bare bekreftet romoppvarming vurderes. Tappevann har andre vilkår, og sikker kjøling utelates. En hel kjøring klassifiseres bare når 3-veisventil og I/U-modus er lesbare og uendret; resten vurderes ikke.",
  /* check.detail.cycling_pooled */ " Alle kjøringer vurderes samlet fordi klassedataene er utilstrekkelige: inngangen var ofte uleselig, færre enn 12 kjøringer ble klassifisert eller over 10 % manglet klasse. Tappevann/kjøling kan skjule korte varmekjøringer; klasseverdiene er bare observasjoner.",
  /* check.detail.outdoor_cycling */ " X10A-utedata er bare ferske målinger fra fullførte kjøringer som hele tiden var romoppvarming. De er kontekst og endrer ikke grensen eller vurderingen.",
  /* check.detail.outdoor_defrost */ " X10A-utedata er bare ferske målinger mens avriming og kompressorstatus var lesbare og kompressoren gikk. De er kontekst og endrer ikke grensen eller vurderingen.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} av ${r} hele, rensede timevinduer; pågående vindu: ${c} av ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} av ${r} hele, rensede timevinduer; tanklading eller BSH registrert, ${s} stabilisering gjenstår.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} av ${r} hele, rensede timevinduer; venter på første hele vindu.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "kandidat ble" : "kandidater ble"} forkastet (${reasons}); lengste nådde ${best} av 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `Kan ikke vurderes: ingen renset time ble fullført på 24 timer; ${n} ${n === 1 ? "kandidat ble" : "kandidater ble"} forkastet (${reasons}), lengste nådde ${best}/60 min. Tanklading krever 105 rolige minutter (45 + 60); tapping, pumpe, uleselige data eller raskt, jevnt varmetap kan bryte vinduet. Summene viser ikke hvilken årsak som dominerte, så raskt kontinuerlig varmetap kan ikke utelukkes.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `Kan ikke vurderes: ${n === 1 ? "den eneste kandidaten ble" : `alle ${n} kandidater ble`} forkastet fordi X10A sluttet å svare midt i vinduet; lengste nådde ${best}/60 min. Dette skyldes forbindelsen, ikke anlegget — kontroller kabling og RX/TX-pinner.`,
  /* check.detail.dhw_reason.charge */ "tanklading",
  /* check.detail.dhw_reason.pump */ "intern pumpe",
  /* check.detail.dhw_reason.draw */ "tappelignende fall",
  /* check.detail.dhw_reason.reading */ "usannsynlig R5T",
  /* check.detail.dhw_reason.blind */ "X10A svarer ikke",
  /* check.detail.collecting_unknown */ "Ikke nok brukbar dokumentasjon for en vurdering ennå.",
  /* check.detail.observation */ "Kun måling; det finnes ingen generell OK-/ADVARSEL-grense.",
  /* check.detail.experimental */ "Eksperimentell observasjon; en stabil teller beviser ikke at ingen begrensning skjedde.",
  /* check.detail.unavailable */ "Den aktive profilen gir ingen data som kan vurderes her.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "start" : "starter"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "syklus" : "sykluser"}`,
  /* check.paired_cycles */ (n) => `${n} klassifisert`,
  /* check.mean */ (d) => `${d}/start`,
  /* check.cycling_space */ (n, d) => d ? `Rom ${n} × ${d}` : `Rom ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `Tappevann ${n} × ${d}` : `Tappevann ${n}`,
  /* check.cycling_cooling */ (n) => `Kjøling ${n} utelatt`,
  /* check.cycling_censored */ (n) => `${n} uten klasse`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · snitt ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `Tank ${m} min`,
  /* check.tank_runtime */ (d) => `Tank ${d}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "vindu" : "vinduer"}`,
  /* check.loss_pump_off */ "også med sirkulasjonspumpen av",
  /* check.loss_with_pump */ "mens sirkulasjonspumpen gikk",
  /* check.loss_unattributed */ "ufullstendig pumpetilknytning",
  /* check.fault_err */ "Feil aktiv",
  /* check.fault_warn */ "Advarsel aktiv",
  /* check.fault_past */ "Oppstod siste 24 t · ikke aktiv nå",
  /* check.fault_none */ "Ingen nå",
  /* check.fault_unknown */ "Nåværende tilstand ukjent",
  /* check.fault_past_unknown */ "Oppstod siste 24 t · nåværende tilstand ukjent",
  /* check.retry_seen */ "Tellerøkning observert",
  /* check.retry_none */ "Ingen økning observert",
  /* values.waiting */ "Venter på første avlesning…",
  /* values.sg_x10a_mode */ "Smart Grid-modus (X10A-kontakter)",
  /* group.Operation */ "Drift",
  /* group.Domestic hot water */ "Tappevann",
  /* group.Water circuit */ "Vannkrets",
  /* group.Refrigerant / outdoor */ "Kjølemedium og utedel",
  /* group.Electrical */ "Elektrisk",
  /* group.Device */ "Enhet",
  /* group.Other values */ "Andre verdier",
  /* group.Protection */ "Beskyttelse",
  /* protect.limiting */ "begrenser",
  /* group.Values */ "Verdier",
  /* state.on */ "PÅ",
  /* state.off */ "AV",
  /* enum.auto */ "Auto",
  /* enum.heating */ "Oppvarming",
  /* enum.cooling */ "Kjøling",
  /* enum.no_error */ "Ingen feil",
  /* enum.fault */ "Feil",
  /* enum.warning */ "Advarsel",
  /* enum.space_heating */ "Romoppvarming",
  /* enum.dhw */ "Tappevann",
  /* enum.free_running */ "Fri drift",
  /* enum.forced_off */ "Tvunget av",
  /* enum.recommended_on */ "Anbefalt på",
  /* enum.forced_on */ "Tvunget på",
  /* enum.unknown */ (n) => `Ukjent (${n})`,
  /* chip.space_on */ "Romdrift PÅ",
  /* chip.space_off */ "Romdrift AV",
  /* chip.quiet */ "Stille",
  /* schem.sg_boost */ "BOOST",
  /* sg.mode0 */ "Fri drift",
  /* sg.mode1 */ "Tvunget av",
  /* sg.mode2 */ "Anbefalt på",
  /* sg.mode3 */ "Tvunget på",
  /* schem.to_dhw */ "3WV → tank",
  /* schem.to_space */ "3WV → rom",
  /* normal.label */ "Normalt:",
  /* meaning.label */ "Tolkning:",
  /* hist.title */ "Siste 24 timer",
  /* hist.recorded */ (h) => `Registrert · ${h} t`,
  /* hist.now */ "nå",
  /* hist.ago */ (h) => `for ${h} t siden`,
  /* hist.loading */ "Laster historikk…",
  /* hist.none */ "Ingen målinger er registrert ennå.",
  /* hist.err */ "Historikken er utilgjengelig.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "målehull" : "målehull"} — ikke målt`,
  /* hist.nm */ "ikke målt",
  /* hist.rel */ (h) => `for ${h} t siden`,
  /* hist.held */ "Utedel i ro",
  /* hist.heldnote */ (h) => `${h} t i ro — ikke målt`,
  /* hist.forecast */ "Open-Meteo · prognose",
  /* hist.in_hours */ (h) => `om ${h} t`,
  /* hist.aria */ (l) => `${l} — 24-timershistorikk. Bruk piltastene for å lese målepunkter.`,
  /* hist.aria_pinned */ (l, r) => `${l} — 24-timershistorikk. Festet verdi: ${r}. Trykk igjen for å løsne.`,
  /* hist.pin_hint */ "trykk for å feste",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} t`,
  /* hist.duration_hm */ (h, m) => `${h} t ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · ca. ${d}`,
  /* hist.state_active */ "Aktiv",
  /* hist.state_off */ "Av",
  /* val.since */ (d) => `i ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} ikke observert`,
  /* hist.modbus_plateau */ (when, d) => `Register uendret ${when} · ca. ${d} · ukjent målealder`,
  /* hist.boost_total */ (d) => `Boost aktiv · ${d}`,
  /* hist.boost_none */ "Ingen boost i perioden.",
  /* hist.boost_ago_range */ (a, b) => `for ${a}–${b} t siden`,
  /* hist.boost_active */ "Boost aktiv",
  /* hist.boost_inactive */ "Boost av",
  /* hist.boost_aria */ (l, d) => `${l} — Smart Grid-historikk med fire moduser. ${d}. Bruk piltastene.`,
  /* hist.defrost_total */ (d) => `Avriming registrert · ${d} rutenettid`,
  /* hist.defrost_none */ "Ingen avriming registrert i perioden.",
  /* hist.defrost_active */ "Avriming aktiv",
  /* hist.defrost_inactive */ "Avriming av",
  /* hist.defrost_aria */ (l, d) => `${l} — avrimingshistorikk. ${d}. Bruk piltastene.`,
  /* hist.quiet_total */ (d) => `Stillemodus registrert · ${d} rutenettid`,
  /* hist.quiet_none */ "Ingen stillemodus registrert i perioden.",
  /* hist.quiet_active */ "Stillemodus aktiv",
  /* hist.quiet_inactive */ "Stillemodus av",
  /* hist.quiet_aria */ (l, d) => `${l} — historikk for stillemodus. ${d}. Bruk piltastene.`,
  /* hist.heater_total */ (d) => `Tankvarmer registrert · ${d} rutenettid`,
  /* hist.heater_none */ "Ingen tankvarmer registrert i perioden.",
  /* hist.heater_active */ "Tankvarmer aktiv",
  /* hist.heater_inactive */ "Tankvarmer av",
  /* hist.heater_aria */ (l, d) => `${l} — historikk for tankvarmer. ${d}. Bruk piltastene.`,
  /* hist.preheat_total */ (d) => `Forvarming av tank registrert · ${d} rutenettid`,
  /* hist.preheat_none */ "Ingen forvarming av tank registrert i perioden.",
  /* hist.preheat_active */ "Forvarming aktiv",
  /* hist.preheat_inactive */ "Forvarming av",
  /* hist.preheat_aria */ (l, d) => `${l} — X10A-historikk for tankforvarming. ${d}. Bruk piltastene.`,
  /* hist.disinfection_total */ (d) => `Desinfeksjon registrert · ${d} rutenettid`,
  /* hist.disinfection_none */ "Ingen tankdesinfeksjon registrert i perioden.",
  /* hist.disinfection_active */ "Desinfeksjon aktiv",
  /* hist.disinfection_inactive */ "Desinfeksjon av",
  /* hist.disinfection_aria */ (l, d) => `${l} — HomeHub-historikk for tankdesinfeksjon. ${d}. Bruk piltastene.`,
  /* hist.buh_total */ (d) => `Tilleggsvarmer registrert · ${d} rutenettid`,
  /* hist.buh_none */ "Ingen bruk av tilleggsvarmer registrert i perioden.",
  /* hist.buh_active */ "Tilleggsvarmer aktiv",
  /* hist.buh_inactive */ "Tilleggsvarmer av",
  /* hist.buh_step1 */ "Trinn 1",
  /* hist.buh_step2 */ "Trinn 2",
  /* hist.buh_aria */ (l, d) => `${l} — historikk for tilleggsvarmer. ${d}. Bruk piltastene.`,
  /* hist.valve_dhw_total */ (d) => `Tappevann · ${d}`,
  /* hist.valve_space_total */ (d) => `Romkrets · ${d}`,
  /* hist.valve_none */ "Ingen tappevannsstilling i perioden.",
  /* hist.valve_dhw */ "Tappevann",
  /* hist.valve_space */ "Romkrets",
  /* hist.valve_aria */ (l, d) => `${l} — historikk for 3-veisventil. ${d}. Bruk piltastene.`,
  /* hist.circ_total */ (d) => `Pumpedrift registrert · ${d} rutenettid`,
  /* hist.circ_none */ "Ingen pumpedrift registrert i perioden.",
  /* hist.circ_on */ "Går",
  /* hist.circ_off */ "Stoppet",
  /* hist.circ_unavailable */ "Utilgjengelig",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "fase" : "faser"} · utilgjengelig`,
  /* hist.circ_aria */ (l, d) => `${l} — historikk for sirkulasjonspumpe. ${d}. Bruk piltastene.`,
  /* hist.valve2_on_total */ (d) => `2WV-utgang PÅ · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV-utgang AV · ${d}`,
  /* hist.valve2_on */ "2WV-utgang PÅ",
  /* hist.valve2_off */ "2WV-utgang AV",
  /* hist.valve2_none */ "Ingen PÅ-tilstand for 2WV-utgangen i perioden.",
  /* hist.valve2_aria */ (l, d) => `${l} — historikk for 2WV-utgang. ${d}. Bruk piltastene.`,
  /* hist.flow_switch_total */ (d) => `X10A-status PÅ · ${d} rutenettid`,
  /* hist.flow_switch_on */ "X10A-status PÅ",
  /* hist.flow_switch_off */ "X10A-status AV",
  /* hist.flow_switch_none */ "Ingen PÅ-tilstand for denne X10A-statusen i perioden.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — historikk for vannstrømningsbryter. ${d}. Bruk piltastene.`,
  /* toast.saved */ "Lagret",
  /* toast.no_changes */ "Ingen endringer",
  /* toast.reboot */ "Starter på nytt — kobler til igjen…",
  /* toast.rebooted */ "Startet på nytt — koble til enheten igjen",
  /* toast.busy_retry */ "Enheten er opptatt — prøv straks igjen",
  /* toast.unreachable */ "Enheten svarer ikke",
  /* toast.rejected */ "Avvist",
  /* toast.applying */ "Forrige endring blir fortsatt tatt i bruk…",
  /* toast.check_wifi */ "Kontroller Wi-Fi-innstillingene",
  /* toast.check_broker */ "Kontroller broker-adressen",
  /* toast.check_syslog_port */ "Kontroller Syslog-porten",
  /* toast.verifying_mqtt */ "Kontrollerer MQTT-forbindelsen…",
  /* toast.saving_syslog */ "Lagrer Syslog-innstillinger…",
  /* toast.saving_ntp */ "Lagrer NTP-innstillinger…",
  /* toast.trying_pins */ "Prøver pinner…",
  /* toast.saving_board */ "Lagrer kortmaskinvare…",
  /* ota.uptodate */ "oppdatert",
  /* ota.check_failed */ "Kontroll mislyktes",
  /* ota.starting */ "starter…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "Starter på nytt…",
  /* ota.failed */ "Oppdatering mislyktes",
  /* ota.timeout */ "Tidsavbrudd",
  /* ota.cancelled */ "avbrutt",
  /* ota.busy */ "Enheten er opptatt",
  /* ota.replaced */ "Oppdateringsjobben er endret — kontroller igjen",
  /* ota.unreachable */ "Enheten svarer ikke",
  /* ota.active_title */ "Fastvareoppdatering",
  /* ota.active_sub */ (detail) => `Installerer · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Installerer · ${detail} · sist mottatte status`,
  /* ota.snapshot_title */ "Fastvareoppdatering",
  /* ota.snapshot_label */ "Datastatus",
  /* ota.snapshot_value */ "Mellomlagret",
  /* ota.snapshot_help */ "Sist mottatte status før denne innlastingen. Direkte data kan stoppe under installasjonen; innstillinger er låst til omstart.",
  /* ota.reload_hint */ "installert — last siden på nytt",
  /* ota.confirm */ (cur, avail) => `Oppdatering tilgjengelig: v${cur} → v${avail}\n\nEnheten laster ned det signerte avbildet, installerer det og starter på nytt. Hvis ny fastvare ikke kommer på nett, tilbakestilles den automatisk.`,
  /* aria.ota */ "Søk etter fastvareoppdateringer",
  /* ota.title_check */ "Trykk for å søke etter fastvareoppdateringer",
  /* ota.title_avail */ (v) => `Oppdatering v${v} tilgjengelig — trykk for å installere`,
  /* mq.err_format */ "Angi vert:port, f.eks. 192.168.1.10:1883, eller mqtts://vert:8883 for TLS",
  /* sl.err_port */ "Porten må være et heltall fra 1 til 65535, for eksempel logs.example.com:514.",
  /* btn.saving */ "Lagrer…",
  /* btn.verifying */ "Kontrollerer…",
  /* btn.save */ "Lagre",
  /* btn.cancel */ "Avbryt",
  /* btn.close */ "Lukk",
  /* schem.card_aria */ "Live systemskjema: utedel, kuldemediekrets, platevarmeveksler, vannkrets med tilleggsvarmer og 3-veisventil, varmtvannstank og romkrets",
  /* schem.group_aria */ "Live systemskjema — velg en verdi eller komponent for en forklaring",
  /* schem.outdoor_unit */ "UTEDEL",
  /* schem.defrost_pill */ "❄ Avriming",
  /* schem.outdoor */ "Ute",
  /* insp.close */ "Lukk",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "VV-TANK",
  /* schem.set */ "Mål",
  /* schem.bsh_label */ "Tankvarmer",
  /* schem.space_circuit */ "ROMKRETS",
  /* schem.heating */ "VARME",
  /* schem.cooling */ "KJØLING",
  /* schem.pump */ "PUMPE",
  /* schem.return */ "R4T",
  /* schem.room */ "Rom",
  /* schem.flow_rate */ "Vannmengde",
  /* schem.water_press */ "Vanntrykk",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "STRØMNING",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Wi-Fi-oppsett",
  /* wifi.ssid */ "Wi-Fi-nettverk · SSID",
  /* wifi.pass */ "Wi-Fi-passord",
  /* wifi.err_ssid */ "SSID kan ha høyst 32 tegn",
  /* wifi.err_pass */ "Passordet må være tomt for åpne nettverk, ellers 8–63 tegn",
  /* wifi.hint */ "Angi Wi-Fi-navnet. Hvis tilkoblingen mislykkes, gjenoppretter enheten automatisk de forrige innstillingene.",
  /* mqtt.title */ "MQTT-broker",
  /* mqtt.hostport */ "Vert : port",
  /* mqtt.user */ "Brukernavn · valgfritt",
  /* mqtt.pass */ "Passord · valgfritt",
  /* mqtt.clear */ "Fjern lagret pålogging — koble til anonymt",
  /* mqtt.hint */ "Brukernavn eller passord krever kryptert TLS (mqtts://, f.eks. mqtts://vert:8883). La verten stå tom for å deaktivere MQTT.",
  /* mqtt.base */ "Basistopic",
  /* mqtt.base_hint */ "Bruk ett basistopic per enhet. Et annet kort på samme broker må ha et eget; ellers deler de topics, tidsserier og Home Assistant-enhet. En endring gir installasjonen nytt navn i Home Assistant og lar gamle retained topics bli igjen.",
  /* err.mqtt_base_too_long */ "Basistopic er for langt.",
  /* err.mqtt_base_wildcard */ "Basistopic kan ikke inneholde + eller # — dette er abonnementjokertegn som en broker ikke publiserer til.",
  /* err.mqtt_base_reserved */ "Basistopic kan ikke begynne med $ — denne grenen tilhører brokeren.",
  /* err.mqtt_base_slash */ "Basistopic kan ikke begynne eller slutte med skråstrek.",
  /* err.mqtt_base_control */ "Basistopic kan ikke inneholde kontrolltegn.",
  /* err.mqtt_base_space */ "Basistopic kan ikke inneholde mellomrom.",
  /* err.mqtt_base_empty_segment */ "Basistopic kan ikke inneholde et tomt ledd (//).",
  /* err.mqtt_base_not_sluggable */ "Basistopic må ha minst én bokstav eller ett siffer. Det brukes i Home Assistant-ID-en som hindrer kollisjon mellom enheter.",
  /* mqtt.err.waiting_x10a */ "Ingen svar fra varmepumpen via X10A ennå — kontroller kabling, GND og RX/TX-pinner.",
  /* mqtt.err.task_alloc */ "MQTT-oppgaven kunne ikke starte — start enheten på nytt og kontroller diagnosen.",
  /* mqtt.err.transport */ "TLS-/TCP-forbindelsen til brokeren mislyktes.",
  /* mqtt.err.refused */ "Brokeren avviste tilkoblingen — kontroller brukernavn og passord.",
  /* mqtt.err.connection */ "Tilkoblingen til MQTT-brokeren mislyktes.",
  /* dyn.card */ "Varmekurvediagnose",
  /* dyn.state */ "Status",
  /* dyn.state_recording */ "Registrerer",
  /* dyn.state_recording_nowx */ "Registrerer · uten prognose",
  /* dyn.state_waiting */ "Venter på oppvarming",
  /* dyn.state_cooling */ "Kjøling · registreres ikke",
  /* dyn.state_room */ "Romkilden kan ikke brukes",
  /* dyn.state_x10a */ "X10A frakoblet",
  /* dyn.state_homehub */ "HomeHub frakoblet",
  /* dyn.state_gate */ "Ukjent anleggstilstand",
  /* dyn.state_mode */ "Ukjent varme-/kjølemodus",
  /* dyn.state_clock */ "Klokken er ikke stilt",
  /* dyn.state_blocked */ "Registrerer ikke",
  /* dyn.state_setup_room */ "Sett opp romkilde",
  /* dyn.state_setup_homehub */ "HomeHub er ikke satt opp",
  /* dyn.state_homehub_disabled */ "Diagnose av — HomeHub deaktivert",
  /* dyn.state_no_broker */ "Registrerer ikke — ingen MQTT-broker",
  /* dyn.state_safe_mode */ "Registrerer ikke — sikker modus",
  /* dyn.state_inactive */ "Registrerer ikke — innsamling kjører ikke",
  /* dyn.room_off */ "Romtermostaten er av",
  /* dyn.room_not_heating */ "Romtermostaten står ikke på varme",
  /* dyn.room_stale */ "Romverdien er for gammel",
  /* dyn.room_no_value */ "Venter på romverdi",
  /* dyn.room_invalid_payload */ "Ugyldig MQTT-melding",
  /* dyn.room_invalid_temperature */ "Romtemperaturen er utenfor tillatt område",
  /* dyn.room_invalid_setpoint */ "Måltemperaturen er utenfor tillatt område",
  /* dyn.room_no_setpoint */ "Måltemperatur mangler",
  /* dyn.room_no_time */ "Måletid mangler",
  /* dyn.room_retained_no_time */ "Retained verdi uten måletid",
  /* dyn.room_future_time */ "Måletiden ligger i fremtiden",
  /* dyn.room_backward_time */ "Måletiden hoppet bakover",
  /* dyn.room_invalid_time */ "Måletiden er usannsynlig",
  /* dyn.room_no_enabled */ "Termostatens av/på-status mangler",
  /* dyn.room_no_hvac_mode */ "Termostatmodus mangler",
  /* dyn.room_source */ "Kilde for romtemperatur",
  /* dyn.weather */ "Valgfri sammenligningsprognose",
  /* dyn.strategy */ "Diagnosesignal",
  /* dyn.not_configured */ "Ikke konfigurert",
  /* dyn.outdoor */ "Målt uteluft",
  /* dyn.outdoor_detail_status */ "Status",
  /* dyn.outdoor_detail_now */ "Nåværende måling",
  /* dyn.outdoor_detail_sample */ "Ved siste registrerte hendelse",
  /* dyn.outdoor_status_live */ (source) => `${source} har en fersk måling som legges til hver registrerte hendelse.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} er satt opp, men har ingen fersk måling. Hendelser registreres uten denne aksen.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} er ikke satt opp. Hendelser registreres uten denne aksen.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} er satt opp, men ingenting registreres nå. Statuslinjen ovenfor forklarer hvorfor.`,
  /* dyn.outdoor_sample_none */ "Registrert uten uteverdi",
  /* dyn.outdoor_help_axis */ "Utetemperatur gir romavviket mening: +0,5 K ved −5 °C og +12 °C kan peke på ulike kurvefeil. Den er valgfri; registreringen fortsetter uten, og verdien avgjør aldri om en hendelse lagres.",
  /* dyn.outdoor_help_placement */ "Verdien er luften der sensoren henger. Fastvaren kjenner ikke plasseringen: ved innedelen er det romluft; i skygge ute er det uteluft og egnet for sammenligning.",
  /* dyn.outdoor_help_setup */ "En M5Stack ENV III på Grove-porten kan måle uteluft kontinuerlig i skygge, også når varmepumpens egen sensor ikke oppdateres. Sett den opp under ESP32 → Maskinvare.",
  /* dyn.plant_outdoor */ "Anleggets uteluft",
  /* dyn.plant_outdoor_help */ "HomeHub-inngang 44 er varmepumpens egen uteluftverdi fra samme Modbus-syklus som varmevinduet. Kilden lagres med hendelsen, holdes adskilt fra ENV III og avgjør aldri om hendelsen registreres.",
  /* dyn.shadow_strategy */ "Rått romavvik · 30 min",
  /* dyn.card_help */ "Hvert 30. minutt i sikkert identifisert romoppvarming lagres avviket mellom referanserom og mål, med utetemperatur når tilgjengelig. Sesongtrenden sammen med driftstid, minste turtemperatur og termostataktivitet kan vise om varmekurven ligger høyt eller lavt. 1 K romavvik betyr ikke 1 K turendring. Funksjonen er skrivebeskyttet.",
  /* dyn.state_help_recording */ "Bekreftet romoppvarming og gyldig rominngang gjør at rå romavvik registreres. Bare en sesongtrend sammen med driftstid og klipping er meningsfull, ikke én verdi.",
  /* dyn.state_help_waiting */ "Anlegget er ikke i normal romdrift, så ingen verdi lagres. Om sommeren er dette normalt.",
  /* dyn.state_help_cooling */ "HomeHub melder romdrift, men modusen er kjøling. Kjølevinduer utelates bevisst fra varmekurvedataene.",
  /* dyn.state_help_blocked */ "En nødvendig inngang mangler. Registreringen fortsetter når den kommer tilbake; gamle eller tvetydige data brukes aldri.",
  /* dyn.state_help_room */ "Romverdien når enheten, men gir ikke et gyldig avvik fra målet. Registreringen fortsetter først når kilden kan brukes.",
  /* dyn.state_help_setup */ "Diagnosen starter når en tidsstemplet MQTT-romkilde med målverdi er lagret. Prognosen er valgfri; sted trenger ikke deles.",
  /* dyn.state_help_inactive */ "Kildene er konfigurert, men innsamlingen via MQTT kjører ikke fordi kortet startet i sikker modus etter gjentatte krasj. Registreringen fortsetter automatisk etter normal oppstart.",
  /* dyn.state_help_no_broker */ "Romkilden er lagret, men ingen MQTT-broker er konfigurert. Angi broker under Tilkoblinger; kilden beholdes og registrering starter automatisk.",
  /* dyn.state_help_setup_homehub */ "Diagnosen trenger HomeHub for å skille oppvarming fra tappevann og stillstand. Angi HomeHub-adressen på protokollkortet.",
  /* dyn.state_help_homehub_disabled */ "Diagnosen trenger to HomeHub-signaler. En uttrykkelig tom HomeHub-adresse slår av både Modbus og denne diagnosen.",
  /* dyn.strategy_help */ "Signalet er rommål minus målt romtemperatur: positivt er for kaldt, negativt for varmt. Ingen dødsone, avrunding, grense eller trinn brukes. Det er en ukalibrert indikator, ikke ønsket turtemperaturforskyvning. Referanserommet må representere sonen; egen termostat eller stengte ventiler kan stoppe behovet og skjule en for høy kurve. Les derfor trenden sammen med D2-klipping ved minste turtemperatur og faktisk varmebehov.",
  /* env.title */ "Utesensor",
  /* env.card */ "Uteklima",
  /* env.none */ "Ingen sensor",
  /* env.temperature */ "Temperatur",
  /* env.humidity */ "Luftfuktighet",
  /* env.pressure */ "Lufttrykk",
  /* env.sensor_state */ "Sensor",
  /* env.live */ "Nå",
  /* env.collecting */ "Måler…",
  /* env.history_title */ "ENV III-målinger",
  /* env.history_help */ "Temperatur, luftfuktighet og lufttrykk lagres i ESP32 som rullerende 24-timersserier med fem minutters oppløsning.",
  /* env.history_scales */ "egne skalaer",
  /* env.unavailable */ "Sensoren svarer ikke",
  /* env.err_pins */ "SDA og SCL må være ulike, gyldige pinner",
  /* env.saving */ "Lagrer utesensoroppsett…",
  /* env.checking */ "Kontrollerer ENV III…",
  /* env.err_not_reachable */ "ENV III svarer ikke på disse SDA/SCL-pinnene.",
  /* env.err_sht30 */ "Temperatur-/fuktighetssensoren i ENV III svarer ikke på disse pinnene.",
  /* env.err_qmp6988 */ "Trykksensoren i ENV III svarer ikke på disse pinnene.",
  /* env.err_disable_first */ "Velg først «Ingen sensor» og lagre før du endrer SDA/SCL.",
  /* env.pins_hint */ "SDA er datalinjen (gul Grove-leder), SCL er klokkelinjen (hvit). Hvis valgte GPIO-er er byttet, prøver fastvaren motsatt retning og lagrer den som virker.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: bruk to tilbudte pinner; headeren har GPIO5–GPIO8 og GPIO38. Grove-porten (GPIO2/1) vises bare når X10A ikke bruker den. En pinne kan ikke brukes til både serieforbindelse og I²C. GPIO39 er ikke tilgjengelig for ENV III.",
  /* ref.title */ "Romtemperaturkilde",
  /* ref.name */ "Navn",
  /* ref.temperature_source */ "Temperaturkilde",
  /* ref.target */ "Måltemperatur",
  /* ref.timestamp_source */ "Kilde for tidsstempel · valgfri",
  /* ref.max_age */ "Maksimal alder · sekunder",
  /* ref.temperature_source_help */ "Nøyaktig MQTT-topic og valgfri JSON-sti etter $. Manglende/feil sti meldes når en melding kommer.",
  /* ref.target_help */ "Fast °C-verdi eller nøyaktig MQTT-topic med valgfri JSON-sti etter $.",
  /* ref.timestamp_source_help */ "Valgfri RFC3339-/Unix-kildetid som topic$sti. Tomt bruker direkte MQTT-mottakstid; retained verdier avvises da.",
  /* ref.max_age_help */ "Hvor gammel kildemålingen maksimalt kan være (10–3600 s).",
  /* ref.error */ "Siste feil",
  /* ref.broker_off */ "MQTT-broker deaktivert",
  /* ref.retained */ "lagret av brokeren",
  /* ref.time_untrusted */ "Retained verdi uten pålitelig måletid",
  /* ref.clock_unsynced */ "Enhetsklokken er ikke synkronisert",
  /* ref.now */ "nå",
  /* ref.ago */ (s) => `for ${s} s siden`,
  /* ref.age_unknown */ "ukjent",
  /* ref.saved */ "Romtemperaturkilde lagret",
  /* ref.detail.status_label */ "Status:",
  /* ref.detail.diagnosis_label */ "Varmekurvediagnose:",
  /* ref.status.measurement_valid */ "Gyldig måling",
  /* ref.status.not_configured */ "Ikke satt opp",
  /* ref.status.usable */ "Kan brukes",
  /* ref.status.unusable */ "Kan ikke brukes",
  /* ref.status.error */ "Feil",
  /* ref.status.stale */ "For gammel",
  /* ref.status.waiting */ "Venter",
  /* ref.status.unavailable */ "Utilgjengelig",
  /* ref.detail.setup */ "Legg til MQTT-kilde med knappenålen",
  /* ref.detail.stale */ "Målingen er eldre enn tillatt",
  /* ref.detail.waiting */ "Ingen MQTT-måling mottatt ennå",
  /* ref.detail.error */ (e) => `MQTT-melding avvist: ${e}`,
  /* ref.detail.temperature_label */ "Romtemperatur:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Måltemperatur:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Siste måling:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · tillatt: høyst ${max} s`,
  /* ref.detail.purpose */ "Diagnosen sammenligner rom- og måltemperatur for å finne langsiktige tegn på for høy/lav varmekurve. Den styrer ikke varmepumpen.",
  /* ref.delete */ "Slett",
  /* ref.deleting */ "Sletter…",
  /* ref.deleted */ "Romtemperaturkilden og målingen er slettet",
  /* circ.title */ "Kilde for sirkulasjonspumpe",
  /* circ.row */ "Sirkulasjonspumpe for tappevann",
  /* circ.default_name */ "Sirkulasjonspumpe",
  /* circ.name */ "Navn",
  /* circ.topic */ "MQTT-topic",
  /* circ.power_path */ "JSON-sti for effekt",
  /* circ.time_path */ "JSON-sti for tidsstempel",
  /* circ.power_help */ "Faktisk aktiv effekt i watt; reléutgangen brukes ikke.",
  /* circ.time_help */ "Måletid som RFC3339 eller Unix-sekunder.",
  /* circ.on_threshold */ "PÅ fra · W",
  /* circ.off_threshold */ "AV til · W",
  /* circ.max_age */ "Maksimal alder · sekunder",
  /* circ.confirm */ "Bekreftelse · sekunder",
  /* circ.hint */ "Kun lesing. Lagring kontrollerer først en fersk MQTT-verdi og slår aldri pluggen.",
  /* circ.settings_help */ "Kortet knytter faktisk pumpeeffekt til rensede, én time lange kjølevinduer for tanken. Det observerer bare og slår aldri pluggen.",
  /* circ.not_configured */ "Ikke konfigurert",
  /* circ.unavailable */ "Utilgjengelig",
  /* circ.broker_off */ "Ingen MQTT-broker",
  /* circ.running */ "Går",
  /* circ.stopped */ "Stoppet",
  /* circ.checking */ "Kontrollerer",
  /* circ.stale */ "For gammel",
  /* circ.waiting */ "Venter på melding",
  /* circ.detail.source */ "Kilde",
  /* circ.detail.power */ "Aktiv effekt",
  /* circ.detail.state */ "Registrert tilstand",
  /* circ.detail.age */ "Målingens alder",
  /* circ.delete */ "Slett",
  /* circ.deleting */ "Sletter…",
  /* circ.deleted */ "Kilden for sirkulasjonspumpen er slettet",
  /* circ.saved */ "Kilden for sirkulasjonspumpen er lagret",
  /* circ.test_failed */ "Ingen lesbar, fersk pumpeeffekt mottatt",
  /* circ.err_topic */ "Angi et nøyaktig MQTT-topic uten jokertegnene + eller #",
  /* circ.err_power_path */ "Angi JSON-stien for aktiv effekt, f.eks. apower",
  /* circ.err_time_path */ "Angi JSON-stien for tidsstempel, f.eks. aenergy.minute_ts",
  /* circ.err_max_age */ "Maksimal alder må være et heltall fra 10 til 3600 sekunder",
  /* circ.err_confirm */ "Bekreftelsen må være et heltall fra 1 til 600 sekunder",
  /* circ.err_threshold */ "Effektgrensene kan ha høyst én desimal",
  /* circ.err_order */ "PÅ-grensen må være høyere enn AV-grensen",
  /* wx.title */ "Open-Meteo-værprognose",
  /* wx.latitude */ "Breddegrad",
  /* wx.longitude */ "Lengdegrad",
  /* wx.waiting */ "Venter på prognose",
  /* wx.fetching */ "Henter Open-Meteo-prognose…",
  /* wx.unavailable */ "Utilgjengelig",
  /* wx.error */ "Feil i Open-Meteo-prognosen",
  /* wx.detail.status */ "Status:",
  /* wx.status.fresh */ "Oppdatert",
  /* wx.status.inactive */ "Av",
  /* wx.status.fetching */ "Oppdaterer",
  /* wx.status.stale */ "For gammel",
  /* wx.status.unavailable */ "Utilgjengelig",
  /* wx.status.waiting */ "Venter",
  /* wx.detail.fresh */ "Prognosen ble hentet.",
  /* wx.detail.fetching */ "ESP32 henter nye prognosedata.",
  /* wx.detail.stale */ "Siste vellykkede henting er for gammel; verdiene vises bare for diagnose.",
  /* wx.detail.unavailable */ "Siste henting mislyktes; en eldre verdi vises eventuelt bare for diagnose.",
  /* wx.detail.waiting */ "Ingen prognose er mottatt ennå.",
  /* wx.detail.temperature_label */ "Temperatur:",
  /* wx.detail.temperature */ (v) => `${v} °C er gjennomsnittlig prognose for uteluften de neste to hele timene.`,
  /* wx.detail.solar_label */ "Globalstråling:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² er prognosen for globalstråling på en vannrett flate i samme totimersperiode.`,
  /* wx.detail.source_label */ "Kilde:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Kun observasjon; prognosen endrer ikke varmepumpestyringen.",
  /* wx.err_both */ "Angi både bredde- og lengdegrad, eller la begge stå tomme for å deaktivere",
  /* wx.err_latitude */ "Breddegrad må være et desimaltall fra -90 til 90",
  /* wx.err_longitude */ "Lengdegrad må være et desimaltall fra -180 til 180",
  /* wx.saving */ "Lagrer værkilde…",
  /* wx.hint.configured */ "ESP32 henter en ny prognose hvert 45. minutt. Koordinatene og forbindelsens offentlige IP blir synlige for Open-Meteo ved hver henting. Tøm begge koordinatfeltene for å fjerne kilden.",
  /* wx.hint.setup */ "Angi bredde- og lengdegrad; et koordinatpar kan limes inn i ett felt og deles automatisk. ESP32 henter deretter hvert 45. minutt. Koordinatene og offentlig IP blir synlige for Open-Meteo. Prognosen er bare observasjon og endrer ikke styringen.",
  /* wx.attribution */ "Værdata fra Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Angi nøyaktig MQTT-topic, eventuelt etterfulgt av $json-sti",
  /* ref.err_target */ "Angi fast verdi 5–35 °C eller nøyaktig MQTT-topic, eventuelt med $json-sti",
  /* ref.err_timestamp_source */ "Angi nøyaktig MQTT-topic, eventuelt etterfulgt av $json-sti",
  /* ref.err_max_age */ "Maksimal alder må være et heltall fra 10 til 3600 sekunder",
  /* ref.save_help */ "Lagring sikrer koblingen. Den abonneres bare når anleggsdiagnosen er på; ellers hviler den. En lesbar, fersk MQTT-verdi kreves fortsatt.",
  /* syslog.title */ "Syslog-server",
  /* syslog.hostport */ "Vert : port",
  /* syslog.hint */ "Angi Syslog-server som vertsnavn eller IP med port. La feltet stå tomt for å deaktivere Syslog.",
  /* ntp.title */ "NTP-server",
  /* ntp.server */ "Server",
  /* ntp.hint */ "Vertsnavn eller IP til NTP-serveren som synkroniserer klokken. Tomt felt gjenoppretter fastvarens standard.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Vert · IP eller .local-navn",
  /* homehub.port */ "Port",
  /* homehub.unit */ "Enhets-ID",
  /* homehub.hint */ "Ved første nettverksoppstart søker ny fastvare én gang etter HomeHub og lagrer resultatet. Du kan også søke her, lagre funnet eller skrive adressen. En lagret tom adresse deaktiverer HomeHub varig: ingen nye søk, Modbus-forespørsler eller avhengig diagnose. Standard er port 502 og enhets-ID 1. Dialogen setter bare opp datakilden og styrer ikke varmepumpen.",
  /* hh.search */ "Søk",
  /* hh.searching */ "Søker…",
  /* hh.found */ (host) => `Fant HomeHub: ${host}`,
  /* hh.not_found */ "Fant ingen HomeHub — angi adressen manuelt.",
  /* hh.saved */ "Modbus-innstillinger lagret",
  /* hh.err_port */ "Porten må være fra 1 til 65535",
  /* hh.err_unit */ "Enhets-ID må være fra 1 til 247",
  /* board.title */ "Kortmaskinvare",
  /* board.ledtype */ "Status-LED",
  /* board.none */ "Ingen",
  /* board.reset_section */ "Tilbakestillingsknapp",
  /* board.env3_section */ "ENV III · utesensor",
  /* board.preset */ "Kort",
  /* board.preset_custom */ "Egendefinert",
  /* board.not_selected */ "Ikke valgt",
  /* board.led_gpio */ "Enkel LED · GPIO",
  /* board.led_ws2812 */ "Adresserbar RGB-LED · WS2812",
  /* board.ledpin */ "LED-pinne",
  /* board.btnpin */ "Pinne for tilbakestillingsknapp",
  /* board.ledlegend_rgb */ "LED-farger og blinkemønstre",
  /* board.ledlegend_gpio */ "LED-blinkemønstre",
  /* board.led_rgb_off */ "Av — ingen Wi-Fi-modus aktiv.",
  /* board.led_rgb_setup */ "Blå, blinker sakte — oppsettportal aktiv.",
  /* board.led_rgb_connecting */ "Gul, blinker raskt — kobler til Wi-Fi.",
  /* board.led_rgb_healthy */ "Grønn, fast — alle konfigurerte forbindelser klare.",
  /* board.led_rgb_bus_down */ "Rød, dobbeltblink — X10A frakoblet.",
  /* board.led_rgb_mqtt_down */ "Oransje, blinker — X10A tilkoblet, MQTT frakoblet.",
  /* board.led_rgb_wipe_armed */ "Rød, svært rask blinking — sletting klargjort; slipp for å avbryte.",
  /* board.led_rgb_wiping */ "Hvit, fast — innstillinger slettes; ikke koble fra strømmen.",
  /* board.led_gpio_off */ "Av — ingen Wi-Fi-modus aktiv.",
  /* board.led_gpio_setup */ "Sakte blinking — oppsettportal aktiv.",
  /* board.led_gpio_connecting */ "Rask blinking — kobler til Wi-Fi.",
  /* board.led_gpio_healthy */ "Fast lys — alle konfigurerte forbindelser klare.",
  /* board.led_gpio_bus_down */ "Dobbeltblink — X10A frakoblet.",
  /* board.led_gpio_mqtt_down */ "Middels rask blinking — X10A tilkoblet, MQTT frakoblet.",
  /* board.led_gpio_wipe_armed */ "Svært rask blinking — sletting klargjort; slipp for å avbryte.",
  /* board.led_gpio_wiping */ "Fast lys etter rask blinking — innstillinger slettes; ikke koble fra strømmen.",
  /* board.ledinv */ "Aktiv ved LOW — LED lyser ved lavt pinnenivå",
  /* board.btninv */ "Aktiv ved LOW — knappen trekker pinnen til GND",
  /* board.hint */ "Hold tilbakestillingsknappen i 5 sekunder: Alle innstillinger slettes og oppsettportalen starter. Velg «Ingen» uten tilkoblet knapp.",
  /* card.hardware */ "Maskinvare",
  /* card.hw_off */ "Ingen",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite er et kompakt ESP32-S3-kort med innebygd WS2812 RGB-status-LED.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 er et kompakt ESP32-S3-kort fra Seeed Studio.",
  /* card.hw_board_other */ (name) => `Valgt kort: ${name}.`,
  /* card.hw_active_low */ "aktiv ved LOW",
  /* card.hw_active_high */ "aktiv ved HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} på GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Ikke konfigurert.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Ikke konfigurert.",
  /* card.hw_env_detail */ (sda, scl) => `SDA på GPIO${sda}, SCL på GPIO${scl}.`,
  /* card.hw_env_disabled */ "Ikke konfigurert.",
  /* card.firmware */ "Versjon",
  /* card.channel */ "Oppdateringskanal",
  /* card.firmware_help */ "Versjonen som kjører på ESP32. Trykk på verdien for å søke valgt kanal etter et signert fastvareavbilde.",
  /* card.channel_help */ "Stabil følger manuelt utgitte versjoner. Utvikling følger siste innarbeidede fastvareendring. Et kanalbytte kontrolleres straks.",
  /* chan.release */ "Stabil",
  /* chan.dev */ "Utvikling",
  /* chan.saved */ (c) => `Oppdateringskanal: ${c}`,
  /* card.proto_title */ "Protokoll",
  /* card.fw_title */ "Fastvare",
  /* settings.diagnostics */ "Anleggsdiagnose",
  /* card.language */ "Språk",
  /* card.language_help */ "Nettleser bruker nettleserens språk. Et språkvalg lagrer et fast grensesnittspråk for hele enheten.",
  /* card.diagnostics */ "Anleggsdiagnose",
  /* card.diagnostics_help */ "Aktiverer 24-timers anleggsdiagnose, varmekurvediagnose og tilleggskilder som romtemperatur, værprognose og effekt for sirkulasjonspumpe.",
  /* diagnostics.off */ "Av",
  /* diagnostics.on */ "På",
  /* diagnostics.saved_on */ "Anleggsdiagnose aktivert — innsamling starter nå",
  /* diagnostics.saved_off */ "Anleggsdiagnose deaktivert — innsamling stoppet",
  /* probe.toggle */ "Protokolldiagnose",
  /* probe.intro */ "Direkte lesing av en X10A-registerside med valgfri konvertertolkning.",
  /* probe.request */ "Forespørsel",
  /* probe.register */ "Register",
  /* probe.manual */ "Manuell inndata",
  /* probe.page */ "Registerside",
  /* probe.offset */ "Nyttelastforskyvning",
  /* probe.size */ "Feltbredde",
  /* probe.byte */ "Byte",
  /* probe.bytes */ "Byte",
  /* probe.converter */ "Konverter",
  /* probe.page_help */ "Hex eller desimal · 0…255",
  /* probe.offset_help */ "Indeks i nyttelasten · 0…31",
  /* probe.size_help */ "Byte som skal dekodes",
  /* probe.converter_auto */ "Automatisk",
  /* probe.converter_auto_help */ (size) => `Prøver alle implementerte konvertere for ${size} byte.`,
  /* probe.conv_raw_byte */ "Råbyte · 0…255",
  /* probe.conv_unsigned_byte */ "råbyte uten fortegn",
  /* probe.conv_tenth_byte */ "råbyte × 0,1",
  /* probe.conv_unsigned_half_byte */ "byte uten fortegn × 0,5",
  /* probe.conv_signed_raw_le */ "heltall med fortegn · Little-Endian",
  /* probe.conv_signed_raw_be */ "heltall med fortegn · Big-Endian",
  /* probe.conv_signed_256_le */ "med fortegn ÷ 256 · Little-Endian",
  /* probe.conv_signed_256_be */ "med fortegn ÷ 256 · Big-Endian",
  /* probe.conv_signed_tenth_le */ "med fortegn × 0,1 · Little-Endian",
  /* probe.conv_signed_tenth_be */ "med fortegn × 0,1 · Big-Endian",
  /* probe.conv_signed_tenth_nodata_le */ "med fortegn × 0,1 · Little-Endian · 0x8000 = ingen data",
  /* probe.conv_signed_tenth_nodata_be */ "med fortegn × 0,1 · Big-Endian · 0x8000 = ingen data",
  /* probe.conv_signed_128_le */ "med fortegn ÷ 256 × 2 · Little-Endian",
  /* probe.conv_signed_128_be */ "med fortegn ÷ 256 × 2 · Big-Endian",
  /* probe.conv_signed_half_be */ "med fortegn × 0,5 · Big-Endian",
  /* probe.conv_signed_hundredth_be */ "med fortegn × 0,01 · Big-Endian",
  /* probe.conv_unsigned_raw_le */ "heltall uten fortegn · Little-Endian",
  /* probe.conv_unsigned_raw_be */ "heltall uten fortegn · Big-Endian",
  /* probe.conv_unsigned_half_be */ "uten fortegn × 0,5 · Big-Endian",
  /* probe.conv_saturation */ "trykk → metningstemperatur",
  /* probe.conv_raw_fan */ "råbyte / viftetrinn",
  /* probe.conv_capacity */ "effektklasse for innedel",
  /* probe.conv_eeprom_digit */ "rått EEPROM-siffer",
  /* probe.conv_eeprom_pair */ "rått EEPROM-sifferpar",
  /* probe.conv_bits_high */ "bit 4–6 · 3-bits teller",
  /* probe.conv_bits_low */ "bit 0–2 · 3-bits teller",
  /* probe.conv_operation_mode */ "driftsmodus",
  /* probe.conv_error_class */ "feilklasse",
  /* probe.conv_error_code */ "Daikin-feilkode",
  /* probe.conv_indoor_mode */ "innedelmodus · øvre nibble",
  /* probe.conv_hybrid_mode */ "hybriddrift",
  /* probe.conv_bit */ (bit) => `Bit ${bit} · 0 eller 1`,
  /* probe.conv_unknown */ "ukjent konverter",
  /* probe.send */ "Les register",
  /* probe.querying */ "Spør…",
  /* probe.action_note */ "Én forespørsel per avlesningssyklus. Låst under OTA.",
  /* probe.catalog_loading */ "Laster aktiv profil…",
  /* probe.catalog_empty */ "Ingen registerdefinisjoner tilgjengelige.",
  /* probe.catalog_error */ "Kunne ikke laste profilregistre.",
  /* probe.catalog_profile */ (profile) => `Profil: ${profile}`,
  /* probe.catalog_fallback */ (definition, profile) => `main/def: ${definition} · profil: ${profile}`,
  /* probe.response */ "Svar",
  /* probe.frame */ "Ramme",
  /* probe.payload */ "Nyttelast",
  /* probe.slice */ "Valgte byte",
  /* probe.interpretation */ "Tolkning",
  /* probe.response_for */ (reg) => `Svar fra register ${reg}`,
  /* probe.payload_marked */ "Nyttelast · utvalg markert",
  /* probe.slice_note */ (offset, size, slice) => `Forskyvning ${offset} · ${size} byte · 0x${String(slice).replace(/\s+/g, "")}`,
  /* probe.full_frame */ "Full ramme",
  /* probe.decode_value */ "Konverterresultat",
  /* probe.no_decodes */ "Ingen konverterresultater.",
  /* probe.refused */ "Verdi avvist",
  /* probe.unimplemented */ "Ikke implementert",
  /* probe.aliases */ "også",
  /* probe.invalid */ "Kontroller registerside, forskyvning, feltbredde og konverter.",
  /* probe.failed */ "Forespørselen mislyktes.",
  /* probe.status_ok */ "Gyldig svar",
  /* probe.status_busy */ "Opptatt",
  /* probe.status_no_link */ "Ingen X10A-forbindelse",
  /* probe.status_timeout */ "Tidsavbrudd",
  /* probe.status_no_reply */ "Ingen svar",
  /* probe.status_rejected */ "Avvist",
  /* probe.status_bad_crc */ "Feil kontrollsum",
  /* probe.status_unexpected_reply */ "Uventet svar",
  /* probe.status_invalid_length */ "Ugyldig lengde",
  /* probe.status_short_reply */ "Delsvar",
  /* probe.status_out_of_bounds */ "Utenfor nyttelasten",
  /* probe.status_error */ "Feil",
  /* probe.transport_ok */ "Rammen er fullstendig og gyldig.",
  /* probe.transport_busy */ "En annen registerforespørsel er aktiv.",
  /* probe.transport_no_link */ "X10A-forbindelsen er utilgjengelig.",
  /* probe.transport_timeout */ "Avlesningsoppgaven utførte ikke forespørselen i tide.",
  /* probe.transport_no_reply */ "Ingen svarbyte mottatt.",
  /* probe.transport_rejected */ "Anlegget avviste registersiden.",
  /* probe.transport_bad_crc */ "Svar mottatt med ugyldig kontrollsum.",
  /* probe.transport_unexpected_reply */ "Svaret tilhører en annen registerside.",
  /* probe.transport_invalid_length */ "Svaret har ugyldig rammelengde.",
  /* probe.transport_short_reply */ "Bare en del av svaret ble mottatt.",
  /* probe.transport_out_of_bounds */ "De valgte bytene ligger utenfor nyttelasten.",
  /* probe.transport_error */ "Forespørselen mislyktes.",
  /* lang.auto */ "Nettleser",
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
  /* lang.saved */ "Språk lagret",
  /* ota.downgrade_confirm */ (cur, avail) => `Bytte tilbake til v${avail}?\n\nInstallert v${cur} er nyere. Denne eldre versjonen tilbys fordi du valgte en annen kanal. Signaturen kontrolleres før installasjon, og enheten gjenoppretter automatisk dagens versjon hvis den eldre ikke kommer på nett.`,
  /* hist.cop_none */ "Ingen COP-historikk når strømverdien kommer fra CT-klemmer. Kablingen avgjør hvilke laster de dekker; varmemålingen slutter før BUH og omfatter ikke direkte BSH-varme. Balansegrensene kan derfor avvike.",
]);

INSPECT_I18N.nb = inspectValues(
  ["Ingen aktuell måling:", "kompressoren står, og utedelen oppdaterer bare egne sensorer når den går. Siste syklus skjules, så den ikke vises som fersk."],
  [
    ["Driftsmodus", 0, "Innedelens modus; bekrefter ikke alene kompressor eller vannmengde."], // status
    ["Uteklima", "Uteklima fra ENV III", "Temperatur, fuktighet og trykk fra ENV III; plasseringen avgjør om verdien er uteluft."], // env3
    [(d) => d && d.sgSrc === "X10A" ? "Smart Grid-ønske · X10A" : "Smart Grid-ønske · Modbus", "Smart Grid-ønske", (d) => d && d.sgSrc === "X10A"
      ? "Ekstern kommando fra fysiske SG-Ready-kontakter: Fri, Tvunget av, Anbefalt på eller Tvunget på. Det er ikke varme-/kjølemodus og beviser ikke tanklading; nettkommandoer vises ikke nødvendigvis her."
      : "Ekstern kommando lest fra HomeHub: Fri, Tvunget av, Anbefalt på eller Tvunget på. Det er ikke varme-/kjølemodus og beviser ikke tanklading.", (d) => !d || d.sgMode == null
      ? "Ingen aktuell Smart Grid-verdi."
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "SG-Ready viser Anbefalt på, brukt som boost av f.eks. evcc. Tappevannsmodus, 3WV og vannmengde viser separat om tanken lades."
      : d.sgMode === 2
      ? "HomeHub viser Anbefalt på, brukt som boost av f.eks. evcc. Tappevannsmodus, 3WV og vannmengde viser separat om tanken lades."
      : d.sgMode === 1 ? "Energistyringen melder «Tvunget av»."
      : d.sgMode === 3 ? "Energistyringen melder «Tvunget på»."
      : "Ingen ekstern Smart Grid-kommando; enheten går autonomt."], // sgrequest
    ["Utedel", 0, "Varmekilden i et luft/vann-anlegg. Viften flytter luft gjennom varmeveksleren, og kompressoren øker kjølemediets trykk og temperatur. Skissen er forenklet; monoblokk-, bergvarme- og hybridanlegg er annerledes.", (d) => d.defrost
      ? "Avriming aktiv: kretsen reverseres, fjerner is fra fordamperen og tar kortvarig varme fra vannet."
      : compressorRunning(d)
      ? d.rps != null
        ? `I drift: kompressor ${fmt0(d.rps)} rps${d.quiet ? ", begrenset av stillemodus" : ""}.`
        : "I drift: HomeHub bekrefter kompressoren; hastighet og detaljmålinger krever X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "Standby: kompressoren står. X10A oppdaterer ikke utesensorene; uteluft kommer fra HomeHub, utløp vises som «—», og faktisk alder på Modbus-verdien er ukjent."
      : "Standby: kompressoren står uten aktiv overføring. Utedelens egne målinger vises som «—», ikke som verdier fra siste syklus."], // ou
    ["Kompressor", 0, "Komprimerer kjølemediet. rps er hastighet, ikke alene termisk eller elektrisk effekt."], // comp
    ["Uteluft", 0, "Utesensorens temperatur. X10A kan holde siste verdi i ro; da skjules den eller merkes HomeHub."], // out
    ["Uteveksler · R4T", "Temperatur i uteveksler R4T", "Utevekslerens temperatur. Under oppvarming kan den være under null og ise; tolk sammen med avriming."], // ouhx
    ["Høytrykk", 0, "Kjølemediets høytrykk, fra aktiv kompressortransduser eller en sensor som kan brukes i ro; ikke vanntrykk."], // hp
    ["Utløpstemperatur", 0, "Gass ved kompressorutløpet. X10A holder siste syklus når kompressoren stopper, så verdien skjules i ro."], // disch
    ["Lavtrykk", 0, "Kjølemediets lavtrykk ved kompressorens sugeside. Noen profiler har ingen gyldig sensor og viser «—»."], // lp
    ["Ekspansjonsventil", 0, "Doserer kjølemedium og senker trykket. Posisjonen er styrepulser, ikke prosent eller bekreftet mekanisk åpning."], // eev
    ["Flytende kjølemedium · R3T", "Temperatur på flytende kjølemedium R3T", "Kjølemediet på væskesiden av inneveksleren; ikke vannets returtemperatur."], // r3t
    ["Platevarmeveksler", 0, "Overfører energi mellom kjølemedium og vann uten blanding. Effekt anslås fra vannmengde og R1T/R4T; sensorplasseringen avhenger av modell.", (d) => !compressorRunning(d, 5)
      ? "Ingen aktiv kjølemedieoverføring: kompressoren står. Pumpen kan flytte restvarme, men det er ikke varme-/kjøleeffekt."
      : d.dtStale ? "Kan ikke beregne vannoverføring: pumpe og vannmengde bekrefter ikke strømning gjennom platene."
      : d.pth == null ? "Målingene gir ikke et nyttig effektanslag i valgt retning."
      : d.pthKind === "cooling"
      ? `Ca. ${fmt1(d.pth)} kW tas fra vannet: ${fmt1(d.flow)} l/min og ΔT ${fmt1(d.dt)} K.`
      : `Ca. ${fmt1(d.pth)} kW tilføres vannet: ${fmt1(d.flow)} l/min og ΔT ${fmt1(d.dt)} K.`], // phe
    ["PHE ut · før BUH · R1T", "PHE-vannutløp før BUH R1T", "Vann etter PHE, før tilleggsvarmeren; omfatter ikke BUH-varme som tilføres senere."], // lwt
    ["Tur etter BUH · R2T", "Turvann etter BUH R2T", "Vann målt etter BUH. I motsetning til R1T kan det omfatte tilleggsvarme; plasseringen mot pumpe/ventiler avhenger av hydraulikkmodulen."], // r2t
    ["PHE inn · R4T", "PHE-vanninntak R4T", "Vann tilbake til PHE. En intern hydraulikksensor, ikke en egen sensor ved byggets varmeavgivere."], // rwt
    ["Vann-ΔT over PHE", "Vannets delta T over PHE", "R1T ved PHE-utløp minus R4T ved innløp. To sensorer og vannmengden beskriver overføring, men måler ikke tur/retur direkte ved avgiverne.", (d) => d.dtStale
      ? "Ingen arbeids-ΔT: pumpe og vannmengde bekrefter ikke sirkulasjon; sensoravvik uten strømning er ikke et driftspunkt."
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K med bare pumpedrift: utjevning av restvarme, ikke varmeeffekt.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. Ved aktiv kjøling skal R1T være lavere enn R4T, derfor negativ verdi.`
      : `${fmt1(d.dt)} K${d.dtSet != null ? ` mot varmemål ${fmt1(d.dtSet)} K` : ""}. Positiv verdi betyr at PHE tilfører vannet varme.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Anslått kjøleeffekt" : "Anslått varmeeffekt", "Anslått varmeeffekt ved PHE", (d) => d && d.pthKind === "cooling"
      ? "Anslag for uttatt varme: vannmengde × (R4T−R1T) × 4,186 kJ/kg·K, antatt vann. Avhenger av vannmengde, sensorer og væske; glykol endrer resultatet. Vises bare med kompressor og kjølerettet ΔT."
      : "Anslag for levert varme: vannmengde × (R1T−R4T) × 4,186 kJ/kg·K, antatt vann. Avhenger av vannmengde, sensorer og væske; glykol endrer resultatet. BUH etter R1T er utenfor.", (d) => d.dtStale
      ? d.bsh === true
        ? "Ingen PHE-beregning uten bekreftet sirkulasjon. BSH kan fortsatt varme tanken direkte, men denne varmen krysser ikke R1T/R4T og kan ikke måles på bussen."
        : "Ingen effektberegning uten bekreftet vannstrøm gjennom PHE. Manglende driftspunkt betyr ikke 0 kW."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW kjøling${d.cop != null ? `; EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "Anslått EER for varmepumpen"
      : d && d.copScope === "plant" ? "Anslått COP etter BUH" : "Anslått COP for varmepumpen", "Anslått virkningsgrad", (d) => d && d.efficiencyKind === "eer"
      ? "Anslått kjøleeffekt delt på anslått elektrisk effekt. Arver usikkerhet i væske, sensorer, spenning og effektfaktor. Øyeblikkelig EER, ikke sesongverdi."
      : "Anslått varme delt på anslått strøm med samsvarende grenser: etter BUH med CT og R2T, ellers bare varmepumpen med inverterstrøm. CT-kabling avgjør laster. Øyeblikksindikasjon, ikke sertifisert måler.", (d) => d.copBlock === "tank_heater"
      ? "Ingen COP: strøm kan omfatte BSH, men varmen går direkte i tanken og krysser ikke tursensorene; grensene er ulike."
      : d.copBlock === "buh_no_r2t" ? "Ingen COP: BUH er aktiv, men sensor etter den mangler; strøm kan omfatte varme beregnet før BUH."
      : d.copBlock === "mb_scope" ? "Ingen COP: HomeHub måler hele enhetens strøm, men varme bare ved PHE og mangler varmerstatus/sensor etter BUH for like grenser."
      : d.copBlock === "no_pel"
      ? d.pelHeld ? "Ingen COP: kompressoren står, og inverterstrømmen er fra siste syklus."
        : "Ingen COP: profilen gir verken CT-effekt eller inverterstrøm."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW kjøling/kW strøm: ≈ ${fmt1(d.copPth)} kW ut med ≈ ${fmt1(d.pel)} kW inn.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW varme etter BUH/kW CT-strøm: ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. CT-kabling avgjør laster.`
      : `${fmt1(d.cop)} kW varme/kW strøm innen varmepumpegrensen: ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. BUH er utenfor begge.`], // cop
    ["Tilleggsvarmer · BUH", "Tilleggsvarmer BUH", "Elektrisk vannkretsvarmer etter R1T. Trinnene kan øke turtemperatur og forbruk; ikke tankvarmeren BSH.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Trinn 2: begge trinn varmer." : d.buh1 ? "Trinn 1: ett trinn varmer." : "Inaktiv: ingen BUH-trinn aktive."], // buh
    ["Tankvarmer", "Elektrisk tankvarmer", "Elektrisk BSH-element i tanken. Kan varme med kompressor, pumpe og vannmengde på null; X10A-statusen viser ikke effekt.", () => {
      const on = x10aDown() ? null : vOn(/^bsh$/i);
      return on == null ? null : on ? "Tankvarmer aktiv." : "Inaktiv: tankvarmeren er av.";
    }], // bsh
    ["3-veisventil", 0, "Den logiske utgangen velger tank- eller romkrets. Den bekrefter ikke mekanisk posisjon eller vannmengde.", (d) => d.valveDhw == null ? null : d.valveDhw
      ? "Styringen viser tankvei; det beviser ikke mekanisk posisjon, vannmengde eller aktiv lading."
      : "Styringen viser romvei; det beviser ikke mekanisk posisjon eller sirkulasjon."], // valve
    ["2-veisventilutgang", 0, "Binær X10A-utgang for valgfri 2WV i romkretsen. Viser ikke mekanisk posisjon og er ikke varme-/kjølemodus.", (d) => d.valve2On == null ? null : d.valve2On
      ? "X10A viser 2WV-utgangen aktiv. Det beviser ikke aktiv oppvarming eller ventilposisjon; kontroller modus og romdrift."
      : "X10A viser 2WV-utgangen av. Det betyr ikke alene kjøling og motsier ikke valgt varme, særlig i ro."], // valve2
    ["Varmtvannstank", "Varmtvanns- eller akkumulatortank", "Tank målt av R5T. Lading, mål og BSH vises separat."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Kjølekrets" : activeSpaceKind(d) === "heat" ? "Varmekrets" : "Romkrets", "Romkrets", "Byggets radiatorer, gulvvarme eller viftekonvektorer. Anlegget avgjør varme/kjøling; R1T/R4T måles inne i varmepumpen og bekrefter ikke avgivertemperatur.", (d) => d.valveDhw === true
      ? "Romveien er ikke valgt; pumpe og vannmengde viser separat om vann går gjennom tanken."
      : waterMoving(d)
      ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Varmt restvann sirkulerer mot romkretsen. Intern R1T: ${degC(d.lwt)}; ingen sensor etterpå bekrefter avgivertemperatur. Ikke aktiv kjøling.`
        : `Vann går til ${activeSpaceKind(d) === "cool" ? "kjølekretsen" : activeSpaceKind(d) === "heat" ? "varmekretsen" : "romkretsen"}. Intern R1T: ${degC(d.lwt)}; ingen sensor etterpå ved avgiverne.`
      : "Pumpe og vannmengde bekrefter ikke sirkulasjon i romgrenen."], // heat
    ["Romdrift aktiv", "Romoppvarming/-kjøling", "Signal for normal romdrift. Ikke termostatbehov og bekrefter ikke alene kompressor."], // spaceh
    ["Romtemperatur", 0, "Temperatur og mål for referansesonen; avhenger av sensorplassering."], // room
    ["Sirkulasjonspumpe", "Hastighet på sirkulasjonspumpe", "Flytter vann i felleskretsen og grenen valgt av 3WV. Kan gå etter kompressorstopp for etterløp, vern eller utjevning; tolk hastighet og vannmengde sammen.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `Intern pumpe melder stopp, men sensoren måler ${fmt1(d.flow)} l/min. Ekstern sirkulasjon, etterløp eller motstridende signaler er mulig.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Hastighet ${fmt0(d.pump)} %; målt ${fmt1(d.flow)} l/min.` : `Hastighet ${fmt0(d.pump)} %, men vannmengde mangler; sirkulasjon er ikke bekreftet.`
      : waterMoving(d) ? `Sensoren måler ${fmt1(d.flow)} l/min uten brukbar pumpehastighet.`
      : d.pumpOn === true ? d.flow != null ? `Pumpe aktiv, men bare ${fmt1(d.flow)} l/min; sirkulasjon er ikke bekreftet.` : "Pumpe aktiv, men vannmengde mangler; sirkulasjon er ikke bekreftet."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Pumpe stoppet; sensoren viser ${fmt1(d.flow)} l/min. Signalene bekrefter ikke sirkulasjon.` : "Pumpe stoppet uten vannmengdemåling."
      : `Ingen pålitelig pumpestatus; ${fmt1(d.flow)} l/min alene bekrefter ikke sirkulasjon.`], // pump
    [(d) => pelMeasured(d) ? "Strømforbruk · HomeHub" : "Anslått strømforbruk", "Strømforbruk", (d) => pelMeasured(d)
      ? "Forbruk fra HomeHub-inngang 51. UI beregner det ikke, men offentlig dokumentasjon beviser ikke kalibrering, målepunkt eller hvilke varmere som inngår; ikke en sertifisert anleggsmåler."
      : "Anslag for COP/EER. CT summerer oppgitte faser med antatt strøm × 230 V; virkelig spenning og effektfaktor er ukjent. Inverterstrøm dekker bare kompressoren.", (d) => d.pelHeld ? "Kompressoren står; inverterstrømmen er fra siste syklus, så forbruk/virkningsgrad kan ikke vises."
      : d.pel == null ? "Profilen gir ingen aktuell elektrisk måling; COP/EER kan ikke beregnes."
      : d.pelSrc === "MB" ? "Meldt av HomeHub-inngang 51; nøyaktig målegrense er ikke dokumentert."
      : d.pelSrc === "CT" ? "Anslått med CT-klemmer; kablingen avgjør inkluderte laster."
      : "Beregnet fra inverterstrøm, bare for kompressoren."], // pel
    ["Avriming", 0, "Reverserer kretsen midlertidig for å fjerne is fra uteveksleren. Normalt i kaldt/fuktig vær og tar kortvarig varme fra vannet.", (d) => d.defrost == null ? null : d.defrost ? "Avriming aktiv." : "Inaktiv: ingen avriming."], // defrost
    ["Stillemodus", 0, "Begrenser støy og vanligvis utedelens hastighet/effekt. Signalet viser modus, ikke nivå eller termisk virkning.", (d) => d.quiet == null ? null : d.quiet ? "Stillemodus aktiv." : "Inaktiv: stillemodus er av."], // quiet
    ["Gassrør", "Kjølemediets gassrør", "Kjølemedierør mellom enhetene i split-anlegg. Ved varme fører det varm høytrykksgass til PHE; ved kjøling reverseres strømmen. Monoblokk har ikke dette feltrøret.", (d) => compressorRunning(d) ? d.rps != null ? `Sirkulerer: ${fmt1(d.circP)} bar ved ${fmt0(d.disch)} °C.` : "Sirkulerer: HomeHub bekrefter kompressor; trykk/utløp krever X10A." : "Ingen aktiv kjølemediestrøm: kompressoren står. Trykkutjevning avhenger av krets og hviletid."], // rhot
    ["Væskerør", "Kjølemediets væskerør", "Kjølemedierør mellom enhetene i split-anlegg. Ved varme returnerer kondensert høytrykksmedium mot ekspansjonsventilen; ved kjøling reverseres det. Monoblokk har ikke feltrøret.", (d) => compressorRunning(d) ? d.rps != null ? `Sirkulerer: ekspansjonsventil ${fmt0(d.eev)} pulser.` : "Sirkulerer: HomeHub bekrefter kompressor; ventilposisjon krever X10A." : "Ingen sirkulasjon: kompressoren står."], // rcold
    ["PHE-utløpsrør", "Utløpsrør fra PHE", "Vann fra PHE via R1T, BUH, pumpe og 3WV. Varm side ved varme/tappevann og kald ved aktiv kjøling; R1T er før BUH og grenene.", (d) => waterMoving(d) ? `R1T før BUH: ${degC(d.lwt)} ved ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; BUH-trinn aktivt etterpå" : ""}.` : "Pumpe og vannmengde bekrefter ikke sirkulasjon her."], // wsup
    ["Tankkrets", "Hydraulisk tankkrets", "Gren som lader varmtvanns-/akkumulatortanken. Intern veksler avhenger av modell; tegningen viser funksjon, ikke konstruksjon. I denne omkoblingen pauser tanklading direkte romstrøm.", (d) => d.valveDhw === true ? waterMoving(d) ? `Tankvei valgt: ${fmt1(d.flow)} l/min, PHE ut ${degC(d.lwt)}, tank ${degC(d.tank)}.` : "Tankvei valgt, men pumpe/vannmengde bekrefter ikke aktiv lading." : "Tankvei ikke valgt; styringen viser romkrets."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Kjølegren" : activeSpaceKind(d) === "heat" ? "Varmegren" : "Romgren", "Hydraulisk romgren", "Gren til radiatorer, gulvvarme, viftekonvektorer osv. R1T/R4T måles i hydraulikkmodulen og beviser ikke temperatur eller last ute i grenen.", (d) => d.valveDhw === true ? "Romgrenen er ikke valgt; styringen viser tank."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Restvarme sirkulerer mot romkretsen ved ${fmt1(d.flow)} l/min; ikke aktiv kjøling. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}; feltsiden måles ikke.`
        : `Sirkulasjon mot romkretsen ved ${fmt1(d.flow)} l/min. Interne sensorer: R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.`
      : "Pumpe og vannmengde bekrefter ikke sirkulasjon i romgrenen."], // wheat
    ["PHE-innløpsrør", "Innløpsrør til PHE", "Felles retur til PHE via R4T etter at grenene møtes. Vanligvis kaldere enn R1T ved varme og varmere ved aktiv kjøling; R4T sitter ikke ved avgiverne.", (d) => waterMoving(d) ? `Retur ${degC(d.ret)}, ${fmt1(d.flow)} l/min og ${fmt1(d.wp)} bar.` : "Pumpe og vannmengde bekrefter ikke retursirkulasjon."], // wret
    ["Vannmengde", "Vannmengde", "Vannmengde i felleskretsen. Minstekravet avhenger av modell; tolk med pumpe og trykk."], // flow
    ["Strømningsbryter", 0, "Binær X10A-status; måler ikke l/min og bekrefter ikke minste vannmengde.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A aktiv; sammenlign med pumpe og ${fmt1(d.flow)} l/min.` : `X10A inaktiv; med aktiv pumpe, sammenlign ${fmt1(d.flow)} l/min og feil 7H/C0.`], // flow_switch
    ["Vanntrykk", 0, "Trykk i vannkretsen, ikke kjølemediet. Tillatt område avhenger av modell/anlegg; bruk riktig håndbok."], // wp
  ],
);

HOMEHUB_LABEL_I18N.nb = homeHubValues([
  "Turmål varme · hovedsone", // 1
  "Turmål kjøling · hovedsone", // 2
  "Varme-/kjølemodus", // 3
  "Romdrift aktivert", // 4
  "Varmemål · hovedsone", // 6
  "Kjølemål · hovedsone", // 7
  "Stillemodus", // 9
  "Ettervarmingsmål for tappevann", // 10
  "Enhetens diagnosestatus", // 21
  "Enhetens feilkode", // 22
  "Enhetens feilunderkode", // 23
  "Sirkulasjonspumpe aktiv", // 30
  "Kompressor aktiv", // 31
  "Tankvarmer aktiv", // 32
  "Tankdesinfeksjon aktiv", // 33
  "3-veisventilens stilling", // 37
  "Aktuell varme-/kjølemodus", // 38
  "Tur ut av PHE", // 40
  "Tur etter BUH", // 41
  "Returtemperatur", // 42
  "Tanktemperatur", // 43
  "Utetemperatur", // 44
  "Temperatur på flytende kjølemedium", // 45
  "Vannmengde", // 49
  "Romtemperatur · hovedsone", // 50
  "Strømforbruk", // 51
  "Tappevannsdrift", // 52
  "Romdrift", // 53
  "Turkorreksjon · hovedsone", // 54
  "Smart Grid-modus", // 56
  "Effektgrense for lagring", // 57
  "Generell effektgrense", // 58
]);

DESCRIPTION_I18N.nb = descriptionValues([
  ["Måltemperatur for varmtvanns- eller akkumulatortank."], // 0
  ["Avlesning fra en ekstra tanksensor, f.eks. nedre sensor når tanken har øvre og nedre."], // 1
  ["Temperaturen som R5T melder."], // 2
  ["Kraftig modus starter straks tanklading mot komfort-/lagringsmålet."], // 3
  ["X10A-forvarming før behov/program; ikke HomeHub-desinfeksjon og beviser den ikke."], // 4
  ["HomeHub-inngang 33 viser aktiv desinfeksjon; en hel puls mellom Modbus-avlesninger kan overses."], // 5
  ["Bit for ekstern termostat; ikke internt behov og beviser ikke kompressordrift."], // 6
  ["Ekstern bit for lavt støynivå; verken nivå eller kommandoens opphav er dokumentert."], // 7
  ["Solvarmeinngang i vannkretsen; funksjon og polaritet er ikke dokumentert."], // 8
  ["Intern vente-/startfase, ikke nyttig varme; kort PÅ ved start kan være normalt."], // 9
  ["Utestyringen melder en intern prosess som fører kjølemedieolje tilbake til kompressoren."], // 10
  ["Kjølemedieutjevning, ikke målt trykk eller bekreftet ventilposisjon."], // 11
  ["Egen Daikin-forespørsel uten dokumentert betydning; bruk bare til korrelasjon."], // 12
  ["4WV-kommando/status; bekrefter ikke posisjon, og polaritet må tolkes med modus/temperaturer."], // 13
  ["Kommando/status for veivhusvarmer, ikke strøm eller temperatur; kan gå med kompressoren av."], // 14
  ["Egen utgangsbit; beviser ikke bevegelse/polaritet. Sammenlign trykk og temperaturer."], // 15
  ["Inneunderkode uten validert modelltabell; null utelukker ikke hovedfeil."], // 16
  ["Gulvventilkommando/status, ikke posisjon eller vannmengde; polaritet ubekreftet."], // 17
  ["PÅ betyr system av, men vern, pumper eller varmere kan fortsatt gå."], // 18
  ["Ekstra ekstern termostatinngang, ikke temperatur/kompressor; sammenlign konfigurert kontakt."], // 19
  ["Hovedtermostatens varme-/kjølebehov; bekreft respons med modus, pumpe, ventil og kompressor."], // 20
  ["Én av fire rå grensebiter; utled ikke trinn før observert koding er dokumentert."], // 21
  ["Bit for PHE-varmer; ukjent om kommando eller tilbakemelding, og beviser ikke strøm."], // 22
  ["Ettervarming løfter tanken til målet igjen når temperaturen går under startgrensen."], // 23
  ["Planlagt forhåndsvalg: Komfort bruker høyt mål, Eco lavt."], // 24
  ["I hybridsystem ber styringen kjelen om tappevann."], // 25
  ["3WV leder vann til tank eller rom; 1=tank, 0=rom, men posisjonen beviser ikke aktivitet."], // 26
  ["X10A PÅ/AV-utgang for valgfri 2WV; beviser ikke modus, spenning eller mekanisk posisjon."], // 27
  ["Åpning på blandeventilen for en ekstra sone."], // 28
  ["Turtemperaturmål for valgt varme- eller kjølemodus."], // 29
  ["Blandet turtemperatur for sekundærsone etter blandeventilen."], // 30
  ["Temperatur etter BUH, vanligvis R2T; kan omfatte BUH-varme, men beviser ikke avgivertemperatur."], // 31
  ["R1T ut av PHE før BUH; med R4T/vannmengde anslås moduseffekt, men plasseringen er modellavhengig."], // 32
  ["R4T-retur til PHE; vurder ΔT med vannmengde, kompressor og modus, ikke en universell 5 K-regel."], // 33
  ["Vannmengde i felleskretsen; minimum avhenger av modell/modus, og lav verdi kan utløse 7H."], // 34
  ["Hydraulikktrykk: mange håndbøker krever >1 bar; ved ≤1,0 bar, bruk håndboken for nøyaktig modell."], // 35
  ["Invertert pumpekommando: 0 er maksimal hastighet, 100 er stopp."], // 36
  ["Pumpestatus; beviser ikke nyttig varme og kan være aktiv uten kompressor. Sammenlign vannmengde."], // 37
  ["Status for pumpen i en konfigurert solvarmekrets."], // 38
  ["Oppgitt hastighet for pumpen som profilen navngir."], // 39
  ["X10A-strømningsbryter: PÅ betyr registrert bevegelse, ikke l/min/minimum; noen modeller dokumenterer ingen fysisk kontakt."], // 40
  ["Hydraulisk modus: stopp, varme, kjøling, tappevann eller kombinert; beviser ikke kompressor/overføring."], // 41
  ["Firetrinns Smart Grid-kommando fra HomeHub eller to X10A-kontakter; ikke varme-/kjølemodus."], // 42
  ["Aktuell rommodus varme/kjøling uten Auto; beviser ikke kompressor og krever aktivitetssignal."], // 43
  ["HomeHub-valg Auto/varme/kjøling; konfigurasjon, ikke aktuell drift eller bevis på aktivitet."], // 44
  ["Utestatus stopp/varme/kjøling; kan forbli valgt med kompressoren av og beviser ikke varme."], // 45
  ["Avriming av utedel; normalt i kaldt/fuktig vær, men biten alene diagnostiserer ikke for mange sykluser."], // 46
  ["Alvorlighetsklasse for aktiv melding: Normal, Feil, Advarsel eller Forsiktig."], // 47
  ["Betydningen av feilkoden som meldes nå."], // 48
  ["Nøddrift etter varmepumpefeil."], // 49
  ["Enhetens alarmrelé; signaliserer feil til tilkoblet ekstern alarm/overvåking."], // 50
  ["Romtemperaturmål for hovedsonen i varme- eller kjølemodus."], // 51
  ["Intern «thermo ON»-forespørsel; identifiserer ikke last/kompressor, og «Space heating Operation» er ikke behov."], // 52
  ["Elektrisk «Space H Operation»-utgang; ikke normal aktivitet eller bevis på kompressor/varme."], // 53
  ["Normal romvarme/-kjøleaktivitet, ikke behov; kan være PÅ i kjøling med kompressoren av."], // 54
  ["Konfigurert romtemperaturmål for sonen styrt av enhetens egen sensor."], // 55
  ["Romtemperatur fra enhetens innebygde eller kablede sensor."], // 56
  ["Utløpsvern: PÅ/AV + teller 0–7; bare sammenlignbar økning viser aktivitet, ikke årsak. Grense/nullstilling/7→0 er udokumentert."], // 57
  ["Inverterstrømvern: PÅ/AV + teller 0–7; bare sammenlignbar økning viser aktivitet, ikke årsak. Grense/nullstilling/7→0 er udokumentert."], // 58
  ["Høytrykksvern: PÅ/AV + teller 0–7; bare sammenlignbar økning viser aktivitet, ikke årsak. Grense/nullstilling/7→0 er udokumentert."], // 59
  ["Lavtrykksvern: PÅ/AV + teller 0–7; bare sammenlignbar økning viser aktivitet, ikke årsak. Grense/nullstilling/7→0 er udokumentert."], // 60
  ["Invertertemperaturvern: PÅ/AV + teller 0–7; bare sammenlignbar økning viser aktivitet, ikke årsak. Grense/nullstilling/7→0 er udokumentert."], // 61
  ["Generisk intern begrensningsbit som ikke er knyttet til de fem navngitte vernene."], // 62
  ["Vann ved inn-/utløpet av platevarmeveksleren som overfører energi mellom kjølemedium og vannkrets."], // 63
  ["Sensor på uteveksleren; <0 °C kan være normalt og beviser ikke is uten fuktighetsdata."], // 64
  ["Utetemperatur målt av enheten, brukt til værkompensering og driftsvalg."], // 65
  ["Varm gass ut av kompressoren; avhenger av trykk, hastighet, modus og last. Én verdi eller område fra annen serie beviser ikke feil eller lite kjølemedium."], // 66
  ["Temperatur på kald lavtrykksgass tilbake til kompressoren."], // 67
  ["Kjølemedietemperatur i væskerøret mellom varmevekslerne."], // 68
  ["Kjølemedium ved inn-/utløpet av fordamperen, varmeveksleren som tar opp varme."], // 69
  ["Kjølemediets innsprøytningstemperatur, brukt internt til regulering og vern."], // 70
  ["Temperatur i en tofasedel av kjølemediekretsen med både væske og damp."], // 71
  ["Avrimingssensor ute; plassering og styring er modellavhengig. Ett punkt beviser ikke is på hele batteriet eller at avriming er ferdig."], // 72
  ["Metningstemperatur beregnet fra trykk; ikke egen sensor eller trykk i bar."], // 73
  ["Høy-/lavtrykk: vurder stabil trend i samme modus/modell; start, oljeretur og avriming endrer det. Intet universelt normalområde."], // 74
  ["Kompressorhastighet i rps; høyere betyr ofte større behov, men måler ikke varme."], // 75
  ["EEV-trinn er kommando uten mekanisk respons, ikke % eller flow. Alene beviser det ikke bevegelse, fast ventil eller lite kjølemedium."], // 76
  ["Temperatur på elektronikken som styrer uteviftemotoren."], // 77
  ["Uteviftens hastighet som trinn eller rpm."], // 78
  ["Internt mål etter modell/modus; sammenlign med tilsvarende metningstemperatur fra trykk. Avviket diagnostiserer ikke årsak eller fylling."], // 79
  ["Internt mål for kompressorens utløps-/porttemperatur, brukt av enhetens vern."], // 80
  ["Ønsket ΔT mellom tur og retur; avhenger av modell/modus, ikke en universell 5 K-regel."], // 81
  ["Kjølemediet som er fylt på enheten, f.eks. R32 eller R410A."], // 82
  ["Temperatur ved en kompressorport for intern overvåking og vern."], // 83
  ["Trykkmåling i utedelens kjølemediekrets."], // 84
  ["Fasestrøm fra CT; 230 V-anslaget er ukalibrert og ser bort fra virkelig spenning/effektfaktor."], // 85
  ["Strøm trukket av kompressorinverteren; grov indikator på belastning."], // 86
  ["Temperatur i kjøleribben til utedelens inverter/kraftelektronikk."], // 87
  ["Aktivt trinn/trinnene i elektrisk tilleggsvarmer, uttrykt som effektnivå."], // 88
  ["BUH-trinn: 0=ingen; høyere trinn kan støtte ved kulde, avriming, tappevann eller nød iht. oppsett."], // 89
  ["HomeHub-inngang 32: BSH PÅ/AV, ikke effekt; inngang 51 er varmepumpeforbruk, ikke BSH."], // 90
  ["BSH i tanken kan varme uten kompressor/pumpe; X10A gir PÅ/AV, ikke effekt."], // 91
  ["Status for termisk vernekjede i en elektrisk varmer; åpen kjede stopper drift."], // 92
  ["Frostvern av rør; modellavhengig, krever strøm og dekker ikke strømbrudd."], // 93
  ["X10A-frostvernstatus; uten modelldata identifiserer den ikke pumpe, varmer eller beskyttet sone."], // 94
  ["Jordsløyfe med frostvæske og pumpe; væske, trykk og grenser avhenger av design/håndbok."], // 95
  ["Hybridkilde varmepumpe/kombinert/kjel; et valg, ikke målt varme."], // 96
  ["Hybridt turmål, ikke målt temperatur; tolk med modus og faktiske verdier."], // 97
  ["Bivalent tillatelse/status; PÅ beviser ikke at kjelen brenner."], // 98
  ["Forespørsel til kjele; beviser ikke brenner eller levert varme."], // 99
  ["Kjelens vannmål, ikke målt temperatur; avhenger av behov/anlegg."], // 100
  ["Bivalent BE_COP-verdi; X10A-betydning/skala udokumentert, ikke aktuell COP."], // 101
  ["Tariff-, Smart Grid- eller solinngang; handlingen er konfigurasjonsavhengig, PÅ viser bare kontakten."], // 102
  ["Fast nominell inne-/uteeffektklasse i kW eller kode; ikke aktuell måling."], // 103
  ["Stillemodus senker utestøy og kan begrense tilgjengelig varme-/kjøleeffekt."], // 104
  ["HomeHub-status Ingen feil/Feil/Advarsel; identifiserer ikke alene årsaken."], // 105
  ["Betydningen av feilkoden som meldes nå."], // 106
  ["Tilleggsunderkode; gyldig bare med hovedstatus/-kode og skjules når utilgjengelig."], // 107
  ["HomeHub viser kompressor PÅ/AV, ikke hastighet/kapasitet; tolk med drift og vannmengde."], // 108
  ["Viser om normal tappevannsdrift er aktiv."], // 109
  ["Viser om normal romoppvarming eller -kjøling er aktiv."], // 110
  ["PHE-utløp før BUH; sammenlign med retur bare ved sirkulasjon for å få ΔT."], // 111
  ["Tur etter BUH; økning kan skyldes elektrisk varme, men bekreft med BUH-status."], // 112
  ["Vannets målte temperatur i tappevannstanken."], // 113
  ["Væskerørtemperatur; forholdet er modusavhengig, og én verdi diagnostiserer ikke."], // 114
  ["Hovedsonens romtemperatur meldt av fjernkontrollen."], // 115
  ["Strømforbruk via HomeHub; avhenger av modus/laster og skal ikke tilskrives kompressoren alene."], // 116
  ["HomeHub-turmål for varme, kun lesing; fast/værstyrt. Senking hjelper bare hvis rommålet fortsatt nås."], // 117
  ["HomeHub-turmål for kjøling, kun lesing; relevant bare når kjøling er tillatt/aktiv, men kan fortsatt vises."], // 118
  ["Viser om romkretsen er aktivert: bryteren, ikke nåværende aktivitet."], // 119
  ["Stillemodus senker utestøy etter valgt nivå og kan redusere tilgjengelig effekt."], // 120
  ["Ettervarmingsmål for tappevann, ikke startgrense; hysterese og program gjelder også."], // 121
  ["Korreksjon −10…+10 K av varmemålet; beviser ikke varme uten aktiv romdrift."], // 122
  ["Lagringsgrense ved Anbefalt på; den laveste av denne og generell grense gjelder. Ikke forbruk."], // 123
  ["Generell HomeHub-grense: tak, ikke forbruk; lavere verdi begrenser effekt i Smart Grid-modus."], // 124
]);

MODEL_DESCRIPTION_I18N.nb = modelDescriptionValues([
  ["Egen feil-/advarselsstatus: aktiv feil gir ADVARSEL; advarsel eller melding siste 24 t gir INFO, uten prosjektinferens."], // health_fault
  ["Rolig tanktap: prosjektregel INFO ved ≥0,8 K/t; volum og ΔT påvirker, >≈1,85 K/t kan filtreres som tapping, og OK beviser ikke isolasjon."], // health_dhw_loss
  ["INFO ved ≥12 varmekjøringer og snitt <10 min; tappevann/kjøling utelates. Ikke Daikin-grense; ved mye uklassert vurderes alle samlet."], // health_cycling
  ["Avriming: INFO over 15 % ved ≥3 sykluser; ikke Daikin-grense. R4T er live-kontekst utenfor vurderingen, og ett punkt beskriver ikke hele batteriet."], // health_defrost
  ["Laveste trykk: >1,0 bar; ≤1,0 gir INFO og etter 60 s ADVARSEL, men tillatt område er modellavhengig."], // health_pressure
  ["Vannmengde etter 60 s pumpedrift: bare målt utsnitt; sammenlign samme modell/modus/vilkår, ingen universell grense."], // health_flow
  ["Observert BUH-/BSH-tid: kulde, nød, avriming, tappevann eller overskudd kan forklare; ingen universell grense."], // health_heater
  ["Eksperimentell overvåking av fem interne vernetellere: bare klar økning mellom sammenlignbare avlesninger teller, også når den først blir synlig ved stans eller en overgang i kompressorstatus. Basisverdi, stabile eller fallende verdier, hull og nullstillinger teller ikke. Økning gir INFO, ikke diagnose; ingen økning beviser ikke fravær av begrensning."], // health_retries
  ["Ledig RAM/24 t: varig fall kan vise beholdte allokeringer. En omstart med fortsatt strømforsyning viderefører trenden i RAM; normal omstart, fastvareoppdatering eller strømbrudd gjenoppretter fullførte 5-minuttersintervaller fra flash. Bare det åpne intervallet kan mangle."], // free_heap
  ["Største sammenhengende blokk som TLS/OTA trenger; fall med stabil total-RAM tyder på fragmentering."], // max_alloc
  ["Utedelens nominelle effekt, ikke aktuell produksjon."], // capacity
  ["INNEDELENS nominelle effekt; ikke utedel eller komplett anlegg."], // capacity_iu
  ["Flere familier deler registre/effekt: målingene er gyldige, men nøyaktig modell krever ID mot merkeskilt."], // candidates
  ["Uten utekapasitet kan kandidatene avvike; beste innedelstreff brukes uten sikkerhet og må kontrolleres mot skiltet."], // candidates_nocap
  ["Ute-ID-byte uten offentlig navnekart; ved tvil, sammenlign med merkeskilt."], // oueeprom
]);

FAULT_CODE_I18N.nb = faultCodeValues([
  "Problem med vannmengden", // 7H
  "Feil på returtemperatursensor", // 80
  "Feil på turtemperatursensor", // 81
  "Frostvern for varmeveksler aktivert", // 89
  "Unormal temperaturøkning ved tappevannsutløp", // 8F
  "Unormal økning i turtemperatur", // 8H
  "Feil i nullgjennomgangsdeteksjon", // A1
  "Problem med høytrykksbegrensning eller frostvern", // A5
  "Tilleggsvarmer overopphetet eller ikke tilkoblet", // AA
  "Tankvarmer overopphetet", // AC
  "Tankdesinfeksjon mot legionella ikke fullført", // AH
  "Oppvarmingstiden for tappevann overskredet", // AJ
  "Feil på vannmengdesensor", // C0
  "Feil på varmevekslerens temperatursensor", // C4
  "Feil på varmevekslersensor", // C5
  "Feil på romtemperatursensor", // CJ
  "Defekt kretskort i utedel", // E1
  "Feil i lekkasjestrømdeteksjon", // E2
  "Utedelens høytrykksbryter aktivert", // E3
  "Feil ved sugetrykk", // E4
  "Overopphetet inverterkompressormotor i utedel", // E5
  "Kompressoren i utedelen starter ikke", // E6
  "Feil på utedelens viftemotor", // E7
  "Overspenning på utedelens inngang", // E8
  "Feil på elektronisk ekspansjonsventil", // E9
  "Problem med bytte mellom kjøling og varme i utedel", // EA
  "Unormal temperaturøkning i tank", // EC
  "Temperaturfeil i utedelens utløpsrør", // F3
  "Unormalt høyt trykk i utedel under kjøling", // F6
  "Unormalt høyt trykk i utedel; høytrykksbryter aktivert", // FA
  "Feil på spennings-/strømsensor i utedel", // H0
  "Feil på ekstern temperatursensor", // H1
  "Feil på utedelens høytrykksbryter", // H3
  "Feil i kompressorens overbelastningsvern", // H5
  "Feil på utedelens posisjonsdeteksjonssensor", // H6
  "Feil i systemet for kompressorinngang (CT) i utedel", // H8
  "Feil på utedelens uteluftsensor", // H9
  "Feil på tanktemperatursensor", // HC
  "Feil på vanntrykksensor", // HJ
  "Feil på utedelens utløpsrørsensor", // J3
  "Feil på utedelens varmevekslersensor", // J6
  "Feil på utedelens høytrykksensor", // JA
  "Feil på inverterkretskort", // L1
  "For høy temperatur i utedelens styreboks", // L3
  "For høy temperatur i utedelens inverterkjøleribbe", // L4
  "Likestrømsoverstrøm registrert i utedelsinverter", // L5
  "Inverterkretskortets temperaturvern utløst", // L8
  "Kompressorlåsvern", // L9
  "Feil i utedelens kommunikasjonssystem", // LC
  "Faseubalanse eller fasebrudd i strømforsyningen", // P1
  "Unormal likestrøm registrert", // P3
  "Feil på utedelens kjøleribbetemperatursensor", // P4
  "Feil samsvar i kapasitetsinnstilling", // PJ
  "For lite kjølemedium i utedel", // U0
  "Feil faserekkefølge eller fasebrudd", // U1
  "Feil på utedelens nettspenning", // U2
  "Gulvtørkingsfunksjonen ble ikke fullført riktig", // U3
  "Kommunikasjonsproblem mellom inne- og utedel", // U4
  "Kommunikasjonsproblem med brukergrensesnitt", // U5
  "Overføringsfeil mellom hoved-CPU og inverter-CPU i utedel", // U7
  "Kommunikasjonsproblem med ekstern enhet (LAN-adapter, romtermostat eller USB)", // U8
  "Problem med kombinasjon eller kompatibilitet mellom inne- og utedel", // UA
  "Omvendt rørføring eller feil kommunikasjonskabling registrert", // UF
], "Ingen feilkode overføres nå.", "Ingen kort forklaring er lagret for denne koden.");

MB_DELTA_I18N.nb = mbDeltaValues([
  "når kompressoren står, beholder X10A verdien fra siste kjøring. HomeHub-registeret leses uavhengig og kan endre seg, men har ikke måletidsstempel",
  "de to leser rommet fra ulike regulatorer",
]);
