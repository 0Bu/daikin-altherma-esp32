// translation-source: 7ddd2bdc4af2c24576c6d0f192e66a26b1cd1c7d85109329fd9d17a11aa51ee5
I18N.it = localeValues([
  /* sys.nodata */ "Nessun dato",
  /* sys.unreachable */ "Non raggiungibile",
  /* sys.x10a_down */ "X10A non in linea",
  /* sys.mb_carrying */ "Modalità operativa sconosciuta — letture da Modbus",
  /* sys.mb_only */ "X10A non in linea — letture da Modbus",
  /* sys.mb_source */ "X10A non in linea · Modbus",
  /* mode.stop */ "Arresto",
  /* mode.heat */ "Riscaldamento",
  /* mode.cool */ "Raffrescamento",
  /* mode.space */ "Climatizzazione",
  /* mode.dhw */ "Acqua calda",
  /* mode.heat_dhw */ "Riscaldamento + acqua calda",
  /* mode.cool_dhw */ "Raffrescamento + acqua calda",
  /* mode.space_dhw */ "Climatizzazione + acqua calda",
  /* sys.unreachable_sub */ "Impossibile raggiungere il dispositivo — nuovo tentativo…",
  /* sys.waiting */ "In attesa della pompa di calore…",
  /* sys.operating */ "In funzione",
  /* sys.standby */ "Standby — non in funzione",
  /* sys.defrosting */ "Sbrinamento",
  /* sys.circulating */ "Circolazione — compressore spento",
  /* sys.cool_mode */ "Modalità raffrescamento",
  /* sys.residual_circulating */ "Circolazione del calore residuo — nessuna resa frigorifera",
  /* sys.bsh_active */ "Riscaldatore elettrico del serbatoio attivo",
  /* sys.online */ "In linea",
  /* sys.fault */ "Guasto",
  /* sys.warning */ "Avviso",
  /* sys.fault_line */ (c) => "Guasto · " + c + " — controllare il codice di guasto Daikin.",
  /* sys.warning_line */ (c) => "Avviso · " + c + " — controllare la pompa di calore.",
  /* sys.polled */ (s) => `Interrogato ${s} s fa`,
  /* recovery.title */ "Modalità di ripristino",
  /* recovery.meta_heap */ "Il dispositivo ha esaurito ripetutamente la memoria e si è riavviato. Ora funziona con il collegamento alla pompa di calore e MQTT disattivati, così l'interfaccia web resta raggiungibile. La configurazione è molto probabilmente corretta — installare una versione firmware più recente in Impostazioni. Spegnendo e riaccendendo viene ritentato l'avvio completo.",
  /* recovery.meta */ "Il dispositivo si è riavviato ripetutamente ed è entrato in modalità di ripristino. La comunicazione con la pompa di calore e MQTT è in pausa. Controllare la configurazione — in particolare i pin RX/TX nella scheda Protocollo delle Impostazioni — quindi riavviare il dispositivo.",
  /* rollback.title */ "Modifica WiFi non riuscita — configurazione precedente ripristinata",
  /* rollback.meta */ (back) => `Il dispositivo non è riuscito a connettersi con le nuove impostazioni WiFi. Ha ripristinato la rete precedente${back} e si è riavviato. Controllare il nome della rete e la password in Impostazioni → Connessioni, quindi riprovare.`,
  /* crash.title_fault */ "Dispositivo riavviato dopo un arresto anomalo",
  /* crash.title_orphan */ "Rapporto di arresto anomalo in attesa da un riavvio precedente",
  /* crash.reset */ "Reset",
  /* crash.task */ "attività",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "danneggiato",
  /* crash.download */ "Scarica rapporto di arresto anomalo",
  /* crash.copy */ "Copia diagnostica",
  /* crash.dismiss */ "Elimina rapporto",
  /* crash.copied */ "Diagnostica copiata — incollarla in una segnalazione di bug",
  /* crash.copy_fail */ "Copia non riuscita — aprire manualmente /coredump e /diag",
  /* crash.ask_dump */ "Eliminare dal dispositivo? Verrà eliminato anche il core dump — scaricarlo prima per una segnalazione di bug.",
  /* crash.ask */ "Eliminare questo rapporto dal dispositivo?",
  /* crash.ask_yes */ "Elimina",
  /* crash.ask_no */ "Conserva",
  /* crash.deleted */ "Rapporto di arresto anomalo eliminato",
  /* crash.delete_fail */ "Il dispositivo non è riuscito a eliminarlo — il rapporto è ancora presente",
  /* bug.row */ "Segnala un bug",
  /* bug.title */ "Segnala un bug",
  /* bug.intro */ "Descrivere brevemente il problema. Il dispositivo aggiungerà stato, letture e registro dopo aver rimosso nomi di rete, indirizzi e nomi dei server.",
  /* bug.what */ "Cosa succede",
  /* bug.what_ph */ "Da questa mattina la temperatura del serbatoio indica 12800 °C in Home Assistant.",
  /* bug.need_text */ "Descrivere prima cosa succede — bastano una o due frasi.",
  /* bug.continue */ "Prepara il rapporto",
  /* bug.step2_title */ "Controlla il rapporto",
  /* bug.step2 */ "Controllare il rapporto qui sotto. Il pulsante lo copia e apre il modulo per le issue di GitHub con la descrizione già inserita. Incollare il rapporto in “Device report”, rispondere alle domande restanti e inviare la segnalazione.",
  /* bug.collecting */ "Raccolta dei dati del dispositivo…",
  /* bug.collect_fail */ "Impossibile leggere il dispositivo — il rapporto qui sotto indica quali parti mancano.",
  /* bug.copy */ "Copia e apri GitHub",
  /* bug.download */ "Scarica .md",
  /* bug.md_hint */ "Se la copia non riesce o si preferisce un file, scaricare lo stesso rapporto in formato .md. Trascinare il file nel campo “Device report” del modulo invece di incollare il testo.",
  /* bug.copied */ "Rapporto copiato — incollarlo nel campo “Device report”",
  /* bug.copy_fail */ "Copia non riuscita — selezionare il testo qui sotto e copiarlo manualmente",
  /* bug.redacted */ "Il nome della rete, gli indirizzi, il broker e i nomi dei server sono già stati rimossi.",
  /* nav.settings */ "Impostazioni",
  /* nav.back */ "Indietro",
  /* nav.settings_alert */ (n) => `Impostazioni — ${n} ${n === 1 ? "connessione non disponibile" : "connessioni non disponibili"}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Le due sorgenti concordano",
  /* src.delta */ (d, u) => `Differenza ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Le due sorgenti non concordano su questo stato",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Ricerca…",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Connessioni",
  /* conn.offline */ "Non in linea",
  /* conn.disabled */ "Disattivata",
  /* conn.connecting */ "Connessione…",
  /* conn.connected */ "Connessa",
  /* conn.resolving */ "Risoluzione…",
  /* conn.eth_no_cable */ "Nessun cavo",
  /* conn.eth_no_lease */ "Cavo collegato, nessun indirizzo",
  /* conn.eth_fd */ "duplex completo",
  /* conn.enabled */ "Attivata",
  /* conn.enabled_noping */ "Attivata, l'host non risponde al ping",
  /* conn.synced */ "Sincronizzata",
  /* conn.syncing */ "Sincronizzazione…",
  /* conn.error */ (e) => "Errore: " + e,
  /* conn.connected_to */ (s) => "Connesso a " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Toccare per modificare.`,
  /* modbus.err.mdns_not_found */ "Nessun HomeHub trovato tramite mDNS.",
  /* modbus.err.no_address */ "Non è configurato alcun indirizzo HomeHub.",
  /* modbus.err.resolve_failed */ "Impossibile risolvere l'indirizzo HomeHub.",
  /* modbus.err.connect_timeout */ "Connessione scaduta — HomeHub non è raggiungibile.",
  /* modbus.err.connection_refused */ "HomeHub è raggiungibile, ma la porta Modbus TCP è chiusa.",
  /* modbus.err.network_unreachable */ "Nessun percorso di rete verso HomeHub.",
  /* modbus.err.host_unreachable */ "HomeHub non è raggiungibile in rete.",
  /* modbus.err.connect_failed */ "Connessione a HomeHub non riuscita.",
  /* modbus.err.request_failed */ (r) => `Impossibile creare la richiesta Modbus${r ? ` per il registro ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Tempo scaduto durante l'invio della richiesta Modbus${r ? ` al registro ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `Impossibile inviare la richiesta Modbus${r ? ` al registro ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Tempo scaduto in attesa della risposta di HomeHub${r ? ` al registro ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `HomeHub ha chiuso la connessione${r ? ` al registro ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `Impossibile leggere la risposta di HomeHub${r ? ` al registro ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Risposta Modbus non valida${r ? ` al registro ${r}` : ""}.`,
  /* modbus.err.internal_error */ "Errore interno del ciclo di polling Modbus.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub ha rifiutato il registro ${r || "?"} (eccezione ${n}: ${why}).`,
  /* modbus.exc.1 */ "funzione non consentita",
  /* modbus.exc.2 */ "indirizzo dati non consentito",
  /* modbus.exc.3 */ "valore dati non consentito",
  /* modbus.exc.4 */ "guasto del dispositivo",
  /* modbus.exc.5 */ "richiesta confermata",
  /* modbus.exc.6 */ "dispositivo occupato",
  /* modbus.exc.8 */ "errore di parità della memoria",
  /* modbus.exc.10 */ "percorso gateway non disponibile",
  /* modbus.exc.11 */ "il destinatario non ha risposto",
  /* modbus.exc.unknown */ "motivo sconosciuto",
  /* card.model */ "Modello",
  /* card.hplink */ "Collegamento pompa di calore",
  /* card.online */ "In linea",
  /* card.uptime */ "Tempo di attività",
  /* card.freeheap */ "Memoria libera",
  /* card.maxalloc */ "Blocco libero più grande",
  /* card.offline */ "Non in linea",
  /* card.protocol */ "Protocollo",
  /* card.rxpin */ "Pin RX",
  /* card.txpin */ "Pin TX",
  /* card.capacity */ "Capacità",
  /* card.hplink_help */ "Indica se l'ESP32 sta ricevendo risposte valide dalla pompa di calore tramite X10A.",
  /* card.protocol_help */ "X10A-I e X10A-S sono i due formati di trama supportati dall'interfaccia di servizio. Il firmware rileva il formato dalle risposte valide.",
  /* card.rxpin_help */ "GPIO su cui l'ESP32 riceve i dati X10A dalla pompa di calore. Quando il collegamento è offline, il selettore avvia un nuovo tentativo di rilevamento automatico con la coppia scelta.",
  /* card.txpin_help */ "GPIO su cui l'ESP32 invia le richieste X10A alla pompa di calore. RX e TX devono essere diversi e corrispondere al cablaggio fisico.",
  /* card.capacity_iu */ "Capacità (unità interna)",
  /* card.candidates */ "Modelli possibili",
  /* card.oueeprom */ "ID unità esterna",
  /* card.checkup */ "Diagnostica impianto · 24 h",
  /* check.fault */ "Guasto dell'unità",
  /* check.dhw_loss */ "Perdita di calore del serbatoio ACS",
  /* check.cycling */ "Avvii del compressore",
  /* check.defrost */ "Cicli di sbrinamento",
  /* check.pressure */ "Pressione dell'acqua, minima",
  /* check.flow */ "Portata, minima",
  /* check.heater */ "Riscaldatore ausiliario",
  /* check.retries */ "Tentativi di protezione",
  /* check.status.ok */ "OK",
  /* check.status.info */ "NOTA",
  /* check.status.warn */ "AVVISO",
  /* check.status.collecting */ "VERIFICA",
  /* check.status.observation */ "SOLO MISURA",
  /* check.status.experimental */ "SPERIMENTALE",
  /* check.status.unavailable */ "NON DISPONIBILE",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · ${n}/${a} valutati` : s,
  /* check.detail.value_label */ "Valore:",
  /* check.detail.assessment_label */ "Valutazione:",
  /* check.detail.ok */ "Valutazione completata; nessun rilievo nei dati dell'impianto osservati.",
  /* check.detail.info */ "Informazione utile, ma non prova di un difetto. Ciò che qui è considerato degno di nota è indicato sotto “Normale”.",
  /* check.detail.warn */ "Un rilievo del dispositivo o un limite documentato richiede attenzione.",
  /* check.detail.fault.error */ "L'unità sta segnalando un errore. Il codice esatto è nella scheda “Funzionamento”.",
  /* check.detail.fault.warning */ "L'unità sta segnalando un avviso o una precauzione, non un errore. Il codice esatto è nella scheda “Funzionamento”.",
  /* check.detail.fault.past */ "Al momento non viene segnalato nulla. Nelle ultime 24 ore è comparso un messaggio che si è risolto da solo, per questo la riga non è OK. Non occorre intervenire su un messaggio risolto; se ricompare, annotare quando avviene.",
  /* check.detail.fault.past_unknown */ "Nelle ultime 24 ore è comparso un messaggio. Non è possibile leggere se sia ancora attivo — la riga dei guasti non risponde, quindi controllare il collegamento X10A.",
  /* check.detail.collecting */ (n, r) => `${n} di ${r} acquisiti; non è ancora possibile effettuare una valutazione.`,
  /* check.detail.cycling_split */ " Qui viene valutato solo il riscaldamento ambienti confermato. I cicli dell'acqua calda rispondono a vincoli diversi; il raffrescamento identificato con certezza è escluso. Conteggio per ciclo completo: la valvola a 3 vie e, sul circuito ambiente, la modalità operativa I/U devono restare leggibili e invariate per l'intero ciclo. Tutto il resto non viene classificato né valutato.",
  /* check.detail.cycling_pooled */ " Valutazione con tutti i cicli raggruppati perché le prove di classificazione erano insufficienti: un ingresso era troppo sporadico, sono stati classificati meno di 12 cicli o più del 10% dei cicli completati non era classificato. L'acqua calda o il raffrescamento possono quindi mascherare cicli di riscaldamento brevi. I dati di classe riportati accanto sono osservazioni, non hanno determinato il verdetto.",
  /* check.detail.outdoor_cycling */ " I dati esterni X10A comprendono solo campioni recenti di cicli di riscaldamento ambienti completati e classificati in modo coerente. Forniscono contesto e non modificano la soglia o il verdetto sui cicli.",
  /* check.detail.outdoor_defrost */ " I dati esterni X10A comprendono solo campioni recenti mentre lo stato di sbrinamento e del compressore erano leggibili e il compressore era in funzione. Forniscono contesto e non modificano la soglia o il verdetto sullo sbrinamento.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} di ${r} completati in finestre pulite di un'ora; finestra pulita attuale: ${c} di ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} di ${r} completati in finestre pulite di un'ora; rilevata carica del serbatoio o BSH, restano ${s} di assestamento.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} di ${r} completati in finestre pulite di un'ora; nessuna finestra pulita completa di un'ora.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "finestra candidata scartata" : "finestre candidate scartate"} (${reasons}); la più lunga ha raggiunto ${best} di 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `Non valutabile con questo metodo: in 24 ore complete non si è conclusa alcuna finestra pulita di un'ora e ${n} ${n === 1 ? "finestra candidata è stata scartata" : "finestre candidate sono state scartate"} (${reasons}); la più lunga ha raggiunto ${best} di 60 min. La carica del serbatoio richiede 105 minuti indisturbati (45 min di assestamento più una finestra di 60 min); anche prelievi, attività della pompa, dati illeggibili o una perdita di calore continua abbastanza rapida da sembrare un prelievo possono impedire un'ora pulita. I totali memorizzati non mostrano quale causa abbia prevalso, quindi non si può escludere una rapida perdita di calore continua.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `Non valutabile: in 24 ore complete non si è conclusa alcuna finestra pulita di un'ora e ${n} ${n === 1 ? "finestra candidata è stata scartata" : "finestre candidate sono state tutte scartate"} perché il collegamento X10A ha smesso di rispondere durante la finestra; la più lunga ha raggiunto ${best} di 60 min. Il problema riguarda il collegamento, non l'impianto — controllare il cablaggio X10A e i pin RX/TX.`,
  /* check.detail.dhw_reason.charge */ "carica del serbatoio",
  /* check.detail.dhw_reason.pump */ "pompa interna",
  /* check.detail.dhw_reason.draw */ "calo simile a un prelievo",
  /* check.detail.dhw_reason.reading */ "R5T non plausibile",
  /* check.detail.dhw_reason.blind */ "X10A non risponde",
  /* check.detail.collecting_unknown */ "Non ci sono ancora dati utilizzabili sufficienti per una valutazione.",
  /* check.detail.observation */ "Solo valore misurato; non esiste un limite universale OK/AVVISO.",
  /* check.detail.experimental */ "Osservazione sperimentale; un contatore stabile non dimostra che non si sia verificata alcuna limitazione.",
  /* check.detail.unavailable */ "Il profilo attivo non fornisce dati valutabili per questo controllo.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "avvio" : "avvii"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "ciclo" : "cicli"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "abbinato" : "abbinati"}`,
  /* check.mean */ (d) => `${d}/avvio`,
  /* check.cycling_space */ (n, d) => d ? `ambienti ${n} × ${d}` : `ambienti ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `acqua calda ${n} × ${d}` : `acqua calda ${n}`,
  /* check.cycling_cooling */ (n) => `raffrescamento: ${n} ${n === 1 ? "escluso" : "esclusi"}`,
  /* check.cycling_censored */ (n) => `${n} ${n === 1 ? "non classificato" : "non classificati"}`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min ${min} °C · media ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `serbatoio ${m} min`,
  /* check.tank_runtime */ (d) => `serbatoio ${d}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "finestra" : "finestre"}`,
  /* check.loss_pump_off */ "anche con la pompa di circolazione spenta",
  /* check.loss_with_pump */ "durante il funzionamento della pompa di circolazione",
  /* check.loss_unattributed */ "attribuzione alla pompa incompleta",
  /* check.fault_err */ "Guasto attivo",
  /* check.fault_warn */ "Avviso attivo",
  /* check.fault_past */ "Si è verificato nelle ultime 24 h · ora non attivo",
  /* check.fault_none */ "Nessuno attivo",
  /* check.fault_unknown */ "Stato attuale sconosciuto",
  /* check.fault_past_unknown */ "Si è verificato nelle ultime 24 h · stato attuale sconosciuto",
  /* check.retry_seen */ "Rilevato aumento del contatore",
  /* check.retry_none */ "Nessun aumento rilevato",
  /* values.waiting */ "In attesa del primo polling…",
  /* values.sg_x10a_mode */ "Modalità Smart Grid (contatti X10A)",
  /* group.Operation */ "Funzionamento",
  /* group.Domestic hot water */ "Acqua calda sanitaria",
  /* group.Water circuit */ "Circuito idraulico",
  /* group.Refrigerant / outdoor */ "Refrigerante / esterno",
  /* group.Electrical */ "Elettrico",
  /* group.Device */ "Dispositivo",
  /* group.Other values */ "Altri valori",
  /* group.Protection */ "Protezione",
  /* protect.limiting */ "limitazione in corso",
  /* group.Values */ "Valori",
  /* state.on */ "ACCESO",
  /* state.off */ "SPENTO",
  /* enum.auto */ "Auto",
  /* enum.heating */ "Riscaldamento",
  /* enum.cooling */ "Raffrescamento",
  /* enum.no_error */ "Nessun errore",
  /* enum.fault */ "Guasto",
  /* enum.warning */ "Avviso",
  /* enum.space_heating */ "Riscaldamento ambienti",
  /* enum.dhw */ "ACS",
  /* enum.free_running */ "Funzionamento libero",
  /* enum.forced_off */ "Spegnimento forzato",
  /* enum.recommended_on */ "Accensione consigliata",
  /* enum.forced_on */ "Accensione forzata",
  /* enum.unknown */ (n) => `Sconosciuto (${n})`,
  /* chip.space_on */ "Clima acceso",
  /* chip.space_off */ "Clima spento",
  /* chip.quiet */ "Silenzioso",
  /* schem.sg_boost */ "RINFORZO",
  /* sg.mode0 */ "Libero",
  /* sg.mode1 */ "Arresto forzato",
  /* sg.mode2 */ "Avvio consigliato",
  /* sg.mode3 */ "Avvio forzato",
  /* schem.to_dhw */ "3WV → ACS",
  /* schem.to_space */ "3WV → ambienti",
  /* normal.label */ "Normale:",
  /* meaning.label */ "Come interpretarlo:",
  /* hist.title */ "Ultime 24 ore",
  /* hist.recorded */ (h) => `Registrato · ${h} h`,
  /* hist.now */ "ora",
  /* hist.ago */ (h) => `${h} h fa`,
  /* hist.loading */ "Caricamento andamento…",
  /* hist.none */ "Nessuna lettura ancora registrata.",
  /* hist.err */ "Andamento non disponibile.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "intervallo" : "intervalli"} senza dati — non misurato`,
  /* hist.nm */ "non misurato",
  /* hist.rel */ (h) => `${h} h fa`,
  /* hist.held */ "unità esterna a riposo",
  /* hist.heldnote */ (h) => `${h} h a riposo — non misurato`,
  /* hist.forecast */ "Open-Meteo · previsione",
  /* hist.in_hours */ (h) => `tra ${h} h`,
  /* hist.aria */ (l) => `${l} — andamento su 24 ore. I tasti freccia leggono i singoli campioni.`,
  /* hist.aria_pinned */ (l, r) => `${l} — andamento su 24 ore. Lettura fissata: ${r}. Toccare di nuovo per cancellarla.`,
  /* hist.pin_hint */ "toccare per fissare",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} h`,
  /* hist.duration_hm */ (h, m) => `${h} h ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · circa ${d}`,
  /* hist.state_active */ "Attivo",
  /* hist.state_off */ "Spento",
  /* val.since */ (d) => `da ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} non osservati`,
  /* hist.modbus_plateau */ (when, d) => `registro invariato ${when} · circa ${d} · età della misura sconosciuta`,
  /* hist.boost_total */ (d) => `Potenziamento · ${d}`,
  /* hist.boost_none */ "Nessun potenziamento nel periodo registrato.",
  /* hist.boost_ago_range */ (a, b) => `${a}–${b} h fa`,
  /* hist.boost_active */ "Potenziamento attivo",
  /* hist.boost_inactive */ "Potenziamento inattivo",
  /* hist.boost_aria */ (l, d) => `${l} — cronologia dello stato Smart Grid con tutte e quattro le modalità. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.defrost_total */ (d) => `Sbrinamento · ${d}`,
  /* hist.defrost_none */ "Nessun ciclo di sbrinamento osservato nel periodo registrato.",
  /* hist.defrost_active */ "Sbrinamento",
  /* hist.defrost_inactive */ "Nessuno sbrinamento",
  /* hist.defrost_aria */ (l, d) => `${l} — cronologia dello sbrinamento. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.quiet_total */ (d) => `Silenzioso · ${d}`,
  /* hist.quiet_none */ "Nessun intervallo in modalità silenziosa osservato nel periodo registrato.",
  /* hist.quiet_active */ "Silenzioso attivo",
  /* hist.quiet_inactive */ "Silenzioso inattivo",
  /* hist.quiet_aria */ (l, d) => `${l} — cronologia della modalità silenziosa. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.heater_total */ (d) => `Resistenza · ${d}`,
  /* hist.heater_none */ "Nessun uso del riscaldatore del serbatoio osservato nel periodo registrato.",
  /* hist.heater_active */ "Resistenza attiva",
  /* hist.heater_inactive */ "Resistenza inattiva",
  /* hist.heater_aria */ (l, d) => `${l} — cronologia del riscaldatore del serbatoio. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.preheat_total */ (d) => `Preriscaldo · ${d}`,
  /* hist.preheat_none */ "Nessun intervallo di preriscaldamento del serbatoio osservato nel periodo registrato.",
  /* hist.preheat_active */ "Preriscaldo attivo",
  /* hist.preheat_inactive */ "Preriscaldo inattivo",
  /* hist.preheat_aria */ (l, d) => `${l} — cronologia del preriscaldamento serbatoio X10A. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.disinfection_total */ (d) => `Disinfezione · ${d}`,
  /* hist.disinfection_none */ "Nessuna operazione di disinfezione osservata nel periodo registrato.",
  /* hist.disinfection_active */ "Disinfezione attiva",
  /* hist.disinfection_inactive */ "Disinfezione inattiva",
  /* hist.disinfection_aria */ (l, d) => `${l} — cronologia della disinfezione HomeHub. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.buh_total */ (d) => `Ausiliario · ${d}`,
  /* hist.buh_none */ "Nessun uso del riscaldatore ausiliario osservato nel periodo registrato.",
  /* hist.buh_active */ "Ausiliario attivo",
  /* hist.buh_inactive */ "Ausiliario inattivo",
  /* hist.buh_step1 */ "Stadio 1",
  /* hist.buh_step2 */ "Stadio 2",
  /* hist.buh_aria */ (l, d) => `${l} — cronologia del riscaldatore ausiliario. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.valve_dhw_total */ (d) => `ACS · ${d}`,
  /* hist.valve_space_total */ (d) => `Ambienti · ${d}`,
  /* hist.valve_none */ "Nessuna posizione ACS nel periodo registrato.",
  /* hist.valve_dhw */ "ACS",
  /* hist.valve_space */ "Ambienti",
  /* hist.valve_aria */ (l, d) => `${l} — cronologia della valvola a 3 vie. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.circ_total */ (d) => `Pompa · ${d}`,
  /* hist.circ_none */ "Nessun funzionamento della pompa osservato nel periodo registrato.",
  /* hist.circ_on */ "In funzione",
  /* hist.circ_off */ "Arrestata",
  /* hist.circ_unavailable */ "Non disponibile",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "intervallo non disponibile" : "intervalli non disponibili"}`,
  /* hist.circ_aria */ (l, d) => `${l} — cronologia della pompa di circolazione. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.valve2_on_total */ (d) => `2WV attiva · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV inattiva · ${d}`,
  /* hist.valve2_on */ "2WV attiva",
  /* hist.valve2_off */ "2WV inattiva",
  /* hist.valve2_none */ "Nessuno stato attivo registrato per l'uscita della valvola a 2 vie nel periodo selezionato.",
  /* hist.valve2_aria */ (l, d) => `${l} — cronologia dell'uscita della valvola a 2 vie. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* hist.flow_switch_total */ (d) => `Flussostato attivo · ${d}`,
  /* hist.flow_switch_on */ "Flussostato attivo",
  /* hist.flow_switch_off */ "Flussostato inattivo",
  /* hist.flow_switch_none */ "Nessuno stato attivo registrato per questo segnale X10A nel periodo selezionato.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — cronologia del flussostato dell'acqua. ${d}. I tasti freccia leggono i singoli campioni.`,
  /* toast.saved */ "Salvato",
  /* toast.no_changes */ "Nessuna modifica",
  /* toast.reboot */ "Riavvio — riconnessione…",
  /* toast.rebooted */ "Riavviato — riconnettersi al dispositivo",
  /* toast.busy_retry */ "Dispositivo occupato — riprovare tra poco",
  /* toast.unreachable */ "Impossibile raggiungere il dispositivo",
  /* toast.rejected */ "Rifiutato",
  /* toast.applying */ "Applicazione dell'ultima modifica ancora in corso…",
  /* toast.check_wifi */ "Controllare le impostazioni WiFi",
  /* toast.check_broker */ "Controllare l'indirizzo del broker",
  /* toast.check_syslog_port */ "Controllare la porta Syslog",
  /* toast.verifying_mqtt */ "Verifica della connessione MQTT…",
  /* toast.saving_syslog */ "Salvataggio delle impostazioni Syslog…",
  /* toast.saving_ntp */ "Salvataggio delle impostazioni NTP…",
  /* toast.trying_pins */ "Prova dei pin…",
  /* toast.saving_board */ "Salvataggio dell'hardware della scheda…",
  /* ota.uptodate */ "aggiornato",
  /* ota.check_failed */ "verifica non riuscita",
  /* ota.starting */ "avvio…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "riavvio…",
  /* ota.failed */ "aggiornamento non riuscito",
  /* ota.timeout */ "tempo scaduto",
  /* ota.cancelled */ "annullato",
  /* ota.busy */ "dispositivo occupato",
  /* ota.replaced */ "L’operazione di aggiornamento è cambiata — verifica di nuovo",
  /* ota.unreachable */ "dispositivo non raggiungibile",
  /* ota.active_title */ "Aggiornamento firmware",
  /* ota.active_sub */ (detail) => `Installazione in corso · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Installazione in corso · ${detail} · ultimo stato ricevuto`,
  /* ota.snapshot_title */ "Aggiornamento firmware",
  /* ota.snapshot_label */ "Stato dei dati",
  /* ota.snapshot_value */ "Istantanea",
  /* ota.snapshot_help */ "Ultimo stato ricevuto prima di questo ricaricamento. I dati in tempo reale possono interrompersi durante l'installazione; le impostazioni restano bloccate fino al riavvio.",
  /* ota.reload_hint */ "installato — ricaricare la pagina",
  /* ota.confirm */ (cur, avail) => `Aggiornamento disponibile: v${cur} → v${avail}\n\nIl dispositivo scarica e installa l'immagine firmata, quindi si riavvia. Se il nuovo firmware non riesce a collegarsi, viene ripristinato automaticamente quello precedente.`,
  /* aria.ota */ "Verifica la disponibilità di aggiornamenti firmware",
  /* ota.title_check */ "Toccare per verificare gli aggiornamenti firmware",
  /* ota.title_avail */ (v) => `Aggiornamento v${v} disponibile — toccare per installare`,
  /* mq.err_format */ "Inserire host:porta — ad es. 192.168.1.10:1883 — oppure mqtts://host:8883 per TLS",
  /* sl.err_port */ "La porta deve essere un numero intero da 1 a 65535 (ad es. logs.example.com:514).",
  /* btn.saving */ "Salvataggio…",
  /* btn.verifying */ "Verifica…",
  /* btn.save */ "Salva",
  /* btn.cancel */ "Annulla",
  /* btn.close */ "Chiudi",
  /* schem.outdoor_unit */ "UNITÀ ESTERNA",
  /* schem.defrost_pill */ "❄ sbrinamento",
  /* schem.outdoor */ "Esterno",
  /* insp.close */ "Chiudi",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "SERBATOIO ACS",
  /* schem.set */ "obiettivo",
  /* schem.bsh_label */ "Resistenza",
  /* schem.space_circuit */ "AMBIENTI",
  /* schem.heating */ "RISCALDAMENTO",
  /* schem.cooling */ "RAFFRESCAMENTO",
  /* schem.pump */ "POMPA",
  /* schem.return */ "R4T",
  /* schem.room */ "Ambiente",
  /* schem.flow_rate */ "portata",
  /* schem.water_press */ "pressione",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "FLUSSOST.",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Configurazione WiFi",
  /* wifi.ssid */ "Rete WiFi (SSID)",
  /* wifi.pass */ "Password WiFi",
  /* wifi.err_ssid */ "L'SSID deve contenere al massimo 32 caratteri",
  /* wifi.err_pass */ "La password deve essere vuota (rete aperta) oppure contenere da 8 a 63 caratteri",
  /* wifi.hint */ "Inserire il nome della rete WiFi. Se il dispositivo non riesce a connettersi, ripristina automaticamente le impostazioni WiFi precedenti.",
  /* mqtt.title */ "Broker MQTT",
  /* mqtt.hostport */ "Host : porta",
  /* mqtt.user */ "Nome utente · facoltativo",
  /* mqtt.pass */ "Password · facoltativa",
  /* mqtt.clear */ "Rimuovi le credenziali memorizzate — connetti in modo anonimo",
  /* mqtt.hint */ "Nome utente o password richiedono una connessione TLS crittografata (mqtts://, ad esempio mqtts://host:8883). Lasciare vuoto l'host per disattivare MQTT.",
  /* mqtt.base */ "Topic di base",
  /* mqtt.base_hint */ "Un topic di base per ogni dispositivo. Una seconda scheda su questo broker deve averne uno proprio, altrimenti le due condividono topic, metriche e dispositivo Home Assistant. Modificarlo rinomina questa installazione in Home Assistant e lascia sul broker i vecchi topic retained.",
  /* err.mqtt_base_too_long */ "Il topic di base è troppo lungo.",
  /* err.mqtt_base_wildcard */ "Un topic di base non può contenere + o # — sono caratteri jolly di sottoscrizione e il broker rifiuta di pubblicarvi.",
  /* err.mqtt_base_reserved */ "Un topic di base non può iniziare con $ — quella gerarchia appartiene al broker.",
  /* err.mqtt_base_slash */ "Un topic di base non può iniziare o terminare con una barra.",
  /* err.mqtt_base_control */ "Un topic di base non può contenere caratteri di controllo.",
  /* err.mqtt_base_space */ "Un topic di base non può contenere spazi.",
  /* err.mqtt_base_empty_segment */ "Un topic di base non può contenere un segmento vuoto (//).",
  /* err.mqtt_base_not_sluggable */ "Un topic di base deve contenere almeno una lettera o una cifra — diventa l'id dispositivo di questa installazione in Home Assistant; senza, due dispositivi entrerebbero in conflitto.",
  /* mqtt.err.waiting_x10a */ "Nessuna risposta dalla pompa di calore su X10A — controllare cablaggio, GND e pin RX/TX.",
  /* mqtt.err.task_alloc */ "Impossibile avviare il processo MQTT — riavviare il dispositivo e controllare la diagnostica.",
  /* mqtt.err.transport */ "Connessione TLS/TCP al broker non riuscita.",
  /* mqtt.err.refused */ "Il broker ha rifiutato la connessione — controllare nome utente e password.",
  /* mqtt.err.connection */ "Connessione al broker MQTT non riuscita.",
  /* dyn.card */ "Diagnosi della curva climatica",
  /* dyn.state */ "Stato",
  /* dyn.state_recording */ "Registrazione",
  /* dyn.state_recording_nowx */ "Registrazione · nessuna previsione",
  /* dyn.state_waiting */ "In attesa del riscaldamento ambienti",
  /* dyn.state_cooling */ "Raffrescamento · non campionato",
  /* dyn.state_room */ "Sorgente ambiente inutilizzabile",
  /* dyn.state_x10a */ "X10A non in linea",
  /* dyn.state_homehub */ "HomeHub non in linea",
  /* dyn.state_gate */ "Stato dell'impianto sconosciuto",
  /* dyn.state_mode */ "Modalità riscaldamento/raffrescamento sconosciuta",
  /* dyn.state_clock */ "Orologio non impostato",
  /* dyn.state_blocked */ "Registrazione non attiva",
  /* dyn.state_setup_room */ "Configurare una sorgente ambiente",
  /* dyn.state_setup_homehub */ "HomeHub non configurato",
  /* dyn.state_homehub_disabled */ "Diagnosi disattivata — HomeHub disattivato",
  /* dyn.state_no_broker */ "Registrazione non attiva — nessun broker MQTT",
  /* dyn.state_safe_mode */ "Registrazione non attiva — modalità provvisoria",
  /* dyn.state_inactive */ "Registrazione non attiva — campionatore fermo",
  /* dyn.room_off */ "Termostato ambiente spento",
  /* dyn.room_not_heating */ "Termostato ambiente non in riscaldamento",
  /* dyn.room_stale */ "Lettura ambiente troppo vecchia",
  /* dyn.room_no_value */ "In attesa di una lettura ambiente",
  /* dyn.room_invalid_payload */ "Messaggio MQTT non valido",
  /* dyn.room_invalid_temperature */ "Temperatura ambiente fuori dall'intervallo consentito",
  /* dyn.room_invalid_setpoint */ "Temperatura obiettivo fuori dall'intervallo consentito",
  /* dyn.room_no_setpoint */ "Temperatura obiettivo mancante",
  /* dyn.room_no_time */ "Ora della misura mancante",
  /* dyn.room_retained_no_time */ "Valore retained senza ora della misura",
  /* dyn.room_future_time */ "L'ora della misura è nel futuro",
  /* dyn.room_backward_time */ "L'ora della misura è tornata indietro",
  /* dyn.room_invalid_time */ "Ora della misura non valida",
  /* dyn.room_no_enabled */ "Stato acceso/spento del termostato mancante",
  /* dyn.room_no_hvac_mode */ "Modalità operativa del termostato mancante",
  /* dyn.room_source */ "Sorgente della temperatura ambiente",
  /* dyn.weather */ "Previsione comparativa facoltativa",
  /* dyn.strategy */ "Segnale diagnostico",
  /* dyn.not_configured */ "Non configurato",
  /* dyn.outdoor */ "Aria esterna misurata",
  /* dyn.outdoor_detail_status */ "Stato",
  /* dyn.outdoor_detail_now */ "Lettura attuale",
  /* dyn.outdoor_detail_sample */ "All'ultimo evento registrato",
  /* dyn.outdoor_status_live */ (source) => `${source} dispone di una lettura attuale; viene associata a ogni evento registrato come contesto.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} è configurato ma non dispone di una lettura attuale. Gli eventi continuano senza questo asse.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} non è configurato. Gli eventi continuano senza questo asse.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} è configurato, ma al momento non viene registrato nulla. La riga di stato sopra ne indica il motivo.`,
  /* dyn.outdoor_sample_none */ "Registrato senza un valore esterno",
  /* dyn.outdoor_help_axis */ "La temperatura esterna rende interpretabile una deviazione ambiente registrata. Senza, +0,5 K a −5 °C e +0,5 K a +12 °C sembrano uguali, anche se il primo indica una curva troppo ripida e il secondo una curva impostata troppo in alto. È facoltativa: la registrazione continua senza e il valore non viene mai usato per decidere se registrare un evento.",
  /* dyn.outdoor_help_placement */ "Il valore corrisponde a ciò che il sensore misura nel punto in cui è installato. Il firmware non può sapere dove sia — accanto all'unità interna misura l'aria ambiente, in un punto esterno ombreggiato misura davvero l'aria esterna, e solo quest'ultima rende significativo il confronto.",
  /* dyn.outdoor_help_setup */ "Un M5Stack ENV III collegato alla porta Grove della scheda può fornire questo dato. Installato all'esterno e all'ombra, misura continuamente l'aria esterna — a differenza del sensore della pompa di calore, che smette di aggiornarsi quando l'unità esterna è a riposo. Si configura in ESP32 → Hardware insieme alla scheda a cui è collegato.",
  /* dyn.plant_outdoor */ "Aria esterna dell'impianto",
  /* dyn.plant_outdoor_help */ "È l'ingresso HomeHub 44, il valore di aria esterna proprio della pompa di calore. Viene acquisito nello stesso ciclo Modbus corrente dei criteri della finestra di riscaldamento e la sua sorgente viene memorizzata con l'evento. Resta separato da ENV III e non modifica mai la decisione di registrare un evento.",
  /* dyn.shadow_strategy */ "Deviazione ambiente grezza · 30 min",
  /* dyn.card_help */ "Ogni 30 minuti, durante un riscaldamento ambienti chiaramente identificato, il firmware registra di quanto la temperatura dell'ambiente di riferimento si discosta dall'obiettivo, insieme alla temperatura esterna di quel momento se un sensore la fornisce. Insieme a durata di funzionamento, limiti minimi della temperatura di mandata e attività del termostato, l'andamento nel lungo periodo può indicare se la curva climatica tende a essere troppo alta o troppo bassa. Una deviazione ambiente di 1 K non implica automaticamente una variazione di 1 K dell'acqua di mandata. Questa funzione legge soltanto i dati e non scrive nulla nella pompa di calore.",
  /* dyn.state_help_recording */ "Il riscaldamento ambienti confermato è in funzione e l'ingresso ambiente è valido, quindi vengono registrati campioni grezzi dell'errore ambiente. Valutare l'andamento stagionale insieme a durata di funzionamento e prove di limitazione; un singolo campione non è un verdetto.",
  /* dyn.state_help_waiting */ "Al momento l'impianto non è in normale funzionamento ambienti, quindi non viene registrato alcun campione. Durante l'estate questo è lo stato normale previsto, non un guasto.",
  /* dyn.state_help_cooling */ "HomeHub segnala il normale funzionamento ambienti, ma la modalità attuale è il raffrescamento. Le finestre di raffrescamento sono escluse intenzionalmente dai dati della curva climatica.",
  /* dyn.state_help_blocked */ "Manca un ingresso necessario, quindi non viene registrato nulla. La registrazione riprende quando torna disponibile; dati vecchi o ambigui non vengono mai campionati.",
  /* dyn.state_help_room */ "La lettura ambiente raggiunge il dispositivo, ma al momento non può fornire una deviazione valida dall'obiettivo. Non viene creato alcun campione finché la sorgente non torna utilizzabile.",
  /* dyn.state_help_setup */ "La diagnosi inizia quando viene salvata una sorgente ambiente MQTT con indicazione temporale e obiettivo. La previsione è un confronto facoltativo; non è necessario comunicare la posizione.",
  /* dyn.state_help_inactive */ "Le sorgenti sono configurate, ma non vengono valutate: il campionatore funziona sulla connessione MQTT e questa scheda si è avviata in modalità provvisoria dopo ripetuti arresti anomali, nella quale ogni componente facoltativo resta inattivo. Non si perde nulla — la registrazione riprende da sola quando la scheda torna ad avviarsi normalmente.",
  /* dyn.state_help_no_broker */ "È salvata una sorgente ambiente, ma la diagnosi la legge tramite MQTT e non è configurato alcun broker. Impostare il broker nella scheda Connessioni; la sorgente ambiente salvata viene conservata e la registrazione si avvia automaticamente.",
  /* dyn.state_help_setup_homehub */ "La diagnosi necessita di HomeHub per sapere quando l'impianto sta realmente riscaldando; senza non può distinguere una finestra di riscaldamento dall'acqua calda o da un arresto. Impostare l'indirizzo HomeHub nella scheda Protocollo.",
  /* dyn.state_help_homehub_disabled */ "Questa diagnosi dipende da due segnali dell'impianto HomeHub. Se l'indirizzo HomeHub è esplicitamente vuoto, non vengono eseguiti né Modbus né questa diagnosi dipendente.",
  /* dyn.strategy_help */ "Il campione è la temperatura obiettivo ambiente meno la temperatura ambiente effettiva: positivo significa che l'ambiente è sotto l'obiettivo, negativo che è sopra. Non vengono applicati banda morta, arrotondamento, limitazione o limite di variazione. È un indicatore non calibrato, non una correzione richiesta della temperatura di mandata. L'ambiente di riferimento deve rappresentare la zona riscaldata. Il suo termostato o valvole chiuse formano un anello di regolazione interno: possono eliminare la richiesta di calore e nascondere una curva troppo alta. Valutare l'andamento ambiente insieme alla frequenza con cui la temperatura di mandata resta al minimo (quota di limitazione D2) e alla frequenza con cui la zona richiede effettivamente calore.",
  /* env.title */ "Sensore esterno",
  /* env.card */ "Clima esterno",
  /* env.none */ "Nessun sensore",
  /* env.temperature */ "Temperatura",
  /* env.humidity */ "Umidità",
  /* env.pressure */ "Pressione atmosferica",
  /* env.sensor_state */ "Sensore",
  /* env.live */ "In tempo reale",
  /* env.collecting */ "Raccolta…",
  /* env.history_title */ "Misure ENV III",
  /* env.history_help */ "Temperatura, umidità e pressione atmosferica vengono conservate sull'ESP32 come andamenti mobili di 24 ore a intervalli di cinque minuti.",
  /* env.history_scales */ "scale separate",
  /* env.unavailable */ "Sensore non disponibile",
  /* env.err_pins */ "SDA e SCL devono essere pin validi e diversi",
  /* env.saving */ "Salvataggio della configurazione del sensore esterno…",
  /* env.checking */ "Verifica di ENV III…",
  /* env.err_not_reachable */ "ENV III non è attualmente raggiungibile su questi pin SDA/SCL.",
  /* env.err_sht30 */ "Il sensore di temperatura/umidità ENV III non è raggiungibile su questi pin.",
  /* env.err_qmp6988 */ "Il sensore di pressione ENV III non è raggiungibile su questi pin.",
  /* env.err_disable_first */ "Selezionare Nessun sensore e salvare prima di modificare i pin SDA/SCL.",
  /* env.pins_hint */ "SDA = dati (filo Grove giallo); SCL = clock (filo Grove bianco). Se i due GPIO selezionati sono invertiti, il firmware verifica l'ordine opposto e salva automaticamente l'assegnazione funzionante.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: usare due dei pin proposti — il connettore del case porta GPIO5–GPIO8 e GPIO38. La porta Grove (GPIO2/1) compare solo quando il collegamento X10A non la utilizza: uno stesso contatto non può gestire sia il collegamento seriale sia il bus I2C. GPIO39 non è disponibile per ENV III.",
  /* ref.title */ "Sorgente della temperatura ambiente",
  /* ref.name */ "Nome",
  /* ref.temperature_source */ "Sorgente temperatura",
  /* ref.target */ "Temperatura obiettivo",
  /* ref.timestamp_source */ "Sorgente data/ora · facoltativa",
  /* ref.max_age */ "Età massima · secondi",
  /* ref.temperature_source_help */ "Topic MQTT esatto e percorso JSON facoltativo dopo $. Percorsi mancanti o errati vengono segnalati alla ricezione di un payload.",
  /* ref.target_help */ "Un valore fisso in °C oppure un topic MQTT esatto con percorso JSON facoltativo dopo $.",
  /* ref.timestamp_source_help */ "Ora sorgente RFC3339/Unix facoltativa nel formato topic$path. Se vuoto, usa l'ora di arrivo MQTT in tempo reale; i valori retained vengono quindi rifiutati in sicurezza.",
  /* ref.max_age_help */ "Età massima consentita della lettura sorgente, da 10 a 3600 secondi.",
  /* ref.error */ "Ultimo errore",
  /* ref.broker_off */ "Broker MQTT disattivato",
  /* ref.retained */ "memorizzato nella cache del broker",
  /* ref.time_untrusted */ "Valore retained senza ora di misura attendibile",
  /* ref.clock_unsynced */ "Orologio del dispositivo non sincronizzato",
  /* ref.now */ "ora",
  /* ref.ago */ (s) => `${s} s fa`,
  /* ref.age_unknown */ "sconosciuta",
  /* ref.saved */ "Sorgente della temperatura ambiente salvata",
  /* ref.detail.status_label */ "Stato:",
  /* ref.detail.diagnosis_label */ "Diagnosi della curva climatica:",
  /* ref.status.measurement_valid */ "Misura valida",
  /* ref.status.not_configured */ "Non configurata",
  /* ref.status.usable */ "Utilizzabile",
  /* ref.status.unusable */ "Non utilizzabile",
  /* ref.status.error */ "Errore",
  /* ref.status.stale */ "Obsoleta",
  /* ref.status.waiting */ "In attesa",
  /* ref.status.unavailable */ "Non disponibile",
  /* ref.detail.setup */ "Aggiungere una sorgente MQTT usando la matita",
  /* ref.detail.stale */ "La lettura è più vecchia del consentito",
  /* ref.detail.waiting */ "Nessuna lettura MQTT ancora ricevuta",
  /* ref.detail.error */ (e) => `Messaggio MQTT rifiutato: ${e}`,
  /* ref.detail.temperature_label */ "Temperatura ambiente:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Temperatura obiettivo:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Ultima lettura:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · consentita: massimo ${max} s`,
  /* ref.detail.purpose */ "La diagnosi confronta temperatura ambiente e obiettivo per mostrare nel tempo se la curva climatica è troppo alta o troppo bassa. La pompa di calore non viene controllata.",
  /* ref.delete */ "Elimina",
  /* ref.deleting */ "Eliminazione…",
  /* ref.deleted */ "Sorgente della temperatura ambiente e lettura acquisita eliminate",
  /* circ.title */ "Sorgente della pompa di circolazione",
  /* circ.row */ "Pompa di circolazione ACS",
  /* circ.default_name */ "Pompa di circolazione",
  /* circ.name */ "Nome",
  /* circ.topic */ "Topic MQTT",
  /* circ.power_path */ "Percorso JSON potenza",
  /* circ.time_path */ "Percorso JSON data/ora",
  /* circ.power_help */ "Potenza attiva effettiva in watt; l'uscita del relè non viene utilizzata.",
  /* circ.time_help */ "Ora della misura come RFC3339 o secondi Unix.",
  /* circ.on_threshold */ "Accendi da · W",
  /* circ.off_threshold */ "Spegni fino a · W",
  /* circ.max_age */ "Età massima · secondi",
  /* circ.confirm */ "Conferma · secondi",
  /* circ.hint */ "Sola lettura. Il salvataggio verifica prima un valore MQTT recente e non aziona mai la presa.",
  /* circ.settings_help */ "La scheda mette in relazione la potenza effettiva della pompa con finestre pulite di un'ora di raffreddamento del serbatoio. Osserva soltanto e non aziona mai la presa.",
  /* circ.not_configured */ "Non configurata",
  /* circ.unavailable */ "Non disponibile",
  /* circ.broker_off */ "Nessun broker MQTT",
  /* circ.running */ "In funzione",
  /* circ.stopped */ "Arrestata",
  /* circ.checking */ "Verifica",
  /* circ.stale */ "Obsoleta",
  /* circ.waiting */ "In attesa di un messaggio",
  /* circ.detail.source */ "Sorgente",
  /* circ.detail.power */ "Potenza attiva",
  /* circ.detail.state */ "Stato rilevato",
  /* circ.detail.age */ "Età della misura",
  /* circ.delete */ "Elimina",
  /* circ.deleting */ "Eliminazione…",
  /* circ.deleted */ "Sorgente della pompa di circolazione eliminata",
  /* circ.saved */ "Sorgente della pompa di circolazione salvata",
  /* circ.test_failed */ "Nessun valore di potenza della pompa leggibile e recente ricevuto",
  /* circ.err_topic */ "Inserire un topic MQTT esatto senza caratteri jolly + o #",
  /* circ.err_power_path */ "Inserire il percorso JSON della potenza attiva, ad esempio apower",
  /* circ.err_time_path */ "Inserire il percorso JSON della data/ora, ad esempio aenergy.minute_ts",
  /* circ.err_max_age */ "L'età massima deve essere un numero intero tra 10 e 3600 secondi",
  /* circ.err_confirm */ "La conferma deve essere un numero intero tra 1 e 600 secondi",
  /* circ.err_threshold */ "Le soglie di potenza possono avere al massimo una cifra decimale",
  /* circ.err_order */ "La soglia di accensione deve superare quella di spegnimento",
  /* wx.title */ "Previsioni meteo Open-Meteo",
  /* wx.latitude */ "Latitudine",
  /* wx.longitude */ "Longitudine",
  /* wx.waiting */ "In attesa delle previsioni",
  /* wx.fetching */ "Acquisizione delle previsioni Open-Meteo…",
  /* wx.unavailable */ "Non disponibile",
  /* wx.error */ "Errore delle previsioni Open-Meteo",
  /* wx.detail.status */ "Stato:",
  /* wx.status.fresh */ "Attuale",
  /* wx.status.inactive */ "Disattivata",
  /* wx.status.fetching */ "Aggiornamento",
  /* wx.status.stale */ "Obsoleta",
  /* wx.status.unavailable */ "Non disponibile",
  /* wx.status.waiting */ "In attesa",
  /* wx.detail.fresh */ "Le previsioni sono state acquisite correttamente.",
  /* wx.detail.fetching */ "L'ESP32 sta acquisendo nuovi dati previsionali.",
  /* wx.detail.stale */ "L'ultima acquisizione riuscita è troppo vecchia; i valori sono mostrati solo a scopo diagnostico.",
  /* wx.detail.unavailable */ "L'ultima acquisizione non è riuscita; un valore precedente, se presente, viene mostrato solo a scopo diagnostico.",
  /* wx.detail.waiting */ "Non è stata ancora ricevuta alcuna previsione.",
  /* wx.detail.temperature_label */ "Temperatura:",
  /* wx.detail.temperature */ (v) => `${v} °C è la temperatura media prevista dell'aria esterna per le prossime due ore complete.`,
  /* wx.detail.solar_label */ "Irraggiamento solare:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² è l'irraggiamento globale orizzontale previsto nello stesso periodo di due ore.`,
  /* wx.detail.source_label */ "Sorgente:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Sola osservazione; le previsioni non modificano il controllo della pompa di calore.",
  /* wx.err_both */ "Inserire sia latitudine sia longitudine oppure lasciare entrambi i campi vuoti per disattivare",
  /* wx.err_latitude */ "La latitudine deve essere un numero decimale tra -90 e 90",
  /* wx.err_longitude */ "La longitudine deve essere un numero decimale tra -180 e 180",
  /* wx.saving */ "Salvataggio della sorgente meteo…",
  /* wx.hint.configured */ "L'ESP32 richiede una nuova previsione ogni 45 minuti. Ogni richiesta invia le coordinate a Open-Meteo e rivela l'indirizzo IP pubblico della connessione. Lasciare vuoti entrambi i campi delle coordinate per rimuovere la sorgente.",
  /* wx.hint.setup */ "Inserire latitudine e longitudine. Una coppia di coordinate copiata da Google Maps può essere incollata in uno dei due campi e viene separata automaticamente. Dopo il salvataggio, l'ESP32 richiede una nuova previsione ogni 45 minuti. Ogni richiesta invia le coordinate a Open-Meteo e rivela l'indirizzo IP pubblico della connessione. La previsione è di sola osservazione e non modifica il controllo della pompa di calore.",
  /* wx.attribution */ "Dati meteo di Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Inserire un topic MQTT esatto, seguito facoltativamente da $json-path",
  /* ref.err_target */ "Inserire un valore fisso da 5 a 35 °C o un topic MQTT esatto, seguito facoltativamente da $json-path",
  /* ref.err_timestamp_source */ "Inserire un topic MQTT esatto, seguito facoltativamente da $json-path",
  /* ref.err_max_age */ "L'età massima deve essere un numero intero tra 10 e 3600 secondi",
  /* ref.save_help */ "Salva memorizza la mappatura. La sottoscrizione è attiva mentre Diagnostica impianto è abilitata; altrimenti resta inattiva. È comunque necessario un valore MQTT leggibile e recente.",
  /* syslog.title */ "Server Syslog",
  /* syslog.hostport */ "Host : porta",
  /* syslog.hint */ "Inserire il server Syslog come nome host o indirizzo IP più porta. Lasciare vuoto il campo per disattivare Syslog.",
  /* ntp.title */ "Server NTP",
  /* ntp.server */ "Server",
  /* ntp.hint */ "Inserire il nome host o l'indirizzo IP del server dell'ora. Lasciare vuoto il campo per usare il valore predefinito del firmware.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Host · IP o nome .local",
  /* homehub.port */ "Porta",
  /* homehub.unit */ "ID unità",
  /* homehub.hint */ "Un firmware appena installato esegue automaticamente una ricerca una volta al primo avvio in rete e salva il risultato. La ricerca può essere avviata anche manualmente qui. Salvare il risultato o inserire manualmente un indirizzo. Salvando un indirizzo vuoto si disattiva HomeHub in modo permanente: nessuna futura ricerca automatica, nessuna richiesta Modbus e nessuna diagnosi dipendente. La porta predefinita è 502, l'ID unità 1. Questa finestra configura soltanto la sorgente dati; non consente alcun controllo della pompa di calore.",
  /* hh.search */ "Cerca",
  /* hh.searching */ "Ricerca…",
  /* hh.found */ (host) => `HomeHub trovato: ${host}`,
  /* hh.not_found */ "Nessun HomeHub trovato — inserire manualmente l'indirizzo.",
  /* hh.saved */ "Impostazioni Modbus salvate",
  /* hh.err_port */ "La porta deve essere compresa tra 1 e 65535",
  /* hh.err_unit */ "L'ID unità deve essere compreso tra 1 e 247",
  /* board.title */ "Hardware della scheda",
  /* board.ledtype */ "LED di stato",
  /* board.none */ "Nessuno",
  /* board.reset_section */ "Pulsante di reset",
  /* board.env3_section */ "ENV III · Sensore esterno",
  /* board.preset */ "Scheda",
  /* board.preset_custom */ "Personalizzata",
  /* board.not_selected */ "Non selezionata",
  /* board.led_gpio */ "LED semplice (GPIO)",
  /* board.led_ws2812 */ "RGB indirizzabile (WS2812)",
  /* board.ledpin */ "Pin LED",
  /* board.btnpin */ "Pin pulsante di reset",
  /* board.ledlegend_rgb */ "Colori e sequenze di lampeggio del LED",
  /* board.ledlegend_gpio */ "Sequenze di lampeggio del LED",
  /* board.led_rgb_off */ "Spento — nessuna modalità Wi-Fi attiva.",
  /* board.led_rgb_setup */ "Blu, lampeggio lento — portale di configurazione attivo.",
  /* board.led_rgb_connecting */ "Giallo, lampeggio rapido — connessione al Wi-Fi.",
  /* board.led_rgb_healthy */ "Verde, fisso — tutte le connessioni configurate sono pronte.",
  /* board.led_rgb_bus_down */ "Rosso, doppio lampeggio — X10A scollegato.",
  /* board.led_rgb_mqtt_down */ "Arancione, lampeggiante — X10A connesso, MQTT disconnesso.",
  /* board.led_rgb_wipe_armed */ "Rosso, lampeggio molto rapido — cancellazione predisposta; rilasciare per annullare.",
  /* board.led_rgb_wiping */ "Bianco, fisso — cancellazione delle impostazioni; non scollegare l'alimentazione.",
  /* board.led_gpio_off */ "Spento — nessuna modalità Wi-Fi attiva.",
  /* board.led_gpio_setup */ "Lampeggio lento — portale di configurazione attivo.",
  /* board.led_gpio_connecting */ "Lampeggio rapido — connessione al Wi-Fi.",
  /* board.led_gpio_healthy */ "Fisso — tutte le connessioni configurate sono pronte.",
  /* board.led_gpio_bus_down */ "Doppio lampeggio — X10A scollegato.",
  /* board.led_gpio_mqtt_down */ "Lampeggio a velocità media — X10A connesso, MQTT disconnesso.",
  /* board.led_gpio_wipe_armed */ "Lampeggio molto rapido — cancellazione predisposta; rilasciare per annullare.",
  /* board.led_gpio_wiping */ "Fisso dopo un lampeggio molto rapido — cancellazione delle impostazioni; non scollegare l'alimentazione.",
  /* board.ledinv */ "Attivo basso (il LED si accende quando il pin è portato a LOW)",
  /* board.btninv */ "Attivo basso (il pulsante collega il pin a GND)",
  /* board.hint */ "Tenere premuto il pulsante di reset per 5 secondi per cancellare tutte le impostazioni e aprire il portale di configurazione. Selezionare “Nessuno” quando non è collegato alcun pulsante.",
  /* card.hardware */ "Hardware",
  /* card.hw_off */ "Nessuno",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite è una scheda ESP32-S3 compatta con LED di stato RGB WS2812 integrato.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 è una scheda ESP32-S3 compatta di Seeed Studio.",
  /* card.hw_board_other */ (name) => `Scheda selezionata: ${name}.`,
  /* card.hw_active_low */ "attivo LOW",
  /* card.hw_active_high */ "attivo HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} su GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Non configurato.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Non configurato.",
  /* card.hw_env_detail */ (sda, scl) => `SDA su GPIO${sda}, SCL su GPIO${scl}.`,
  /* card.hw_env_disabled */ "Non configurato.",
  /* card.firmware */ "Versione",
  /* card.channel */ "Canale di aggiornamento",
  /* card.firmware_help */ "La versione attualmente in esecuzione sull'ESP32. Toccare il valore per cercare un'immagine firmware firmata nel canale di aggiornamento selezionato.",
  /* card.channel_help */ "Stabile segue le versioni pubblicate manualmente. Sviluppo segue l'ultima integrazione rilevante per il firmware. Cambiando canale, quel flusso viene controllato immediatamente.",
  /* chan.release */ "Stabile",
  /* chan.dev */ "Sviluppo",
  /* chan.saved */ (c) => `Canale di aggiornamento: ${c}`,
  /* card.proto_title */ "Protocollo",
  /* card.fw_title */ "Firmware",
  /* settings.diagnostics */ "Diagnostica impianto",
  /* card.language */ "Lingua",
  /* card.language_help */ "Browser usa la preferenza linguistica del browser. Scegliendo una lingua si memorizza una lingua fissa per l'interfaccia dell'intero dispositivo.",
  /* card.diagnostics */ "Diagnostica impianto",
  /* card.diagnostics_help */ "Abilita il controllo dell'impianto su 24 ore, la diagnosi della curva climatica e sorgenti aggiuntive come temperatura ambiente, previsioni meteo e potenza della pompa di circolazione.",
  /* diagnostics.off */ "Disattivata",
  /* diagnostics.on */ "Attivata",
  /* diagnostics.saved_on */ "Diagnostica impianto attivata — la raccolta inizia ora",
  /* diagnostics.saved_off */ "Diagnostica impianto disattivata — raccolta interrotta",
  /* probe.toggle */ "Diagnostica del protocollo",
  /* probe.intro */ "Lettura diretta di una pagina di registri X10A con valutazione facoltativa del convertitore.",
  /* probe.request */ "Richiesta",
  /* probe.register */ "Registro",
  /* probe.manual */ "Inserimento manuale",
  /* probe.page */ "Pagina registri",
  /* probe.offset */ "Offset nel payload",
  /* probe.size */ "Larghezza campo",
  /* probe.byte */ "byte",
  /* probe.bytes */ "byte",
  /* probe.converter */ "Convertitore",
  /* probe.page_help */ "Esadecimale o decimale · 0…255",
  /* probe.offset_help */ "Indice nel payload · 0…31",
  /* probe.size_help */ "Byte da decodificare",
  /* probe.converter_auto */ "Automatico",
  /* probe.converter_auto_help */ size=>`Prova tutti i convertitori implementati per ${size} byte.`,
  /* probe.conv_raw_byte */ "byte grezzo · 0…255",
  /* probe.conv_unsigned_byte */ "byte senza segno",
  /* probe.conv_tenth_byte */ "byte grezzo × 0,1",
  /* probe.conv_unsigned_half_byte */ "byte senza segno × 0,5",
  /* probe.conv_signed_raw_le */ "intero con segno · little-endian",
  /* probe.conv_signed_raw_be */ "intero con segno · big-endian",
  /* probe.conv_signed_256_le */ "con segno ÷ 256 · little-endian",
  /* probe.conv_signed_256_be */ "con segno ÷ 256 · big-endian",
  /* probe.conv_signed_tenth_le */ "con segno × 0,1 · little-endian",
  /* probe.conv_signed_tenth_be */ "con segno × 0,1 · big-endian",
  /* probe.conv_signed_tenth_nodata_le */ "con segno × 0,1 · little-endian · 0x8000 = nessun dato",
  /* probe.conv_signed_tenth_nodata_be */ "con segno × 0,1 · big-endian · 0x8000 = nessun dato",
  /* probe.conv_signed_128_le */ "con segno ÷ 256 × 2 · little-endian",
  /* probe.conv_signed_128_be */ "con segno ÷ 256 × 2 · big-endian",
  /* probe.conv_signed_half_be */ "con segno × 0,5 · big-endian",
  /* probe.conv_signed_hundredth_be */ "con segno × 0,01 · big-endian",
  /* probe.conv_unsigned_raw_le */ "intero senza segno · little-endian",
  /* probe.conv_unsigned_raw_be */ "intero senza segno · big-endian",
  /* probe.conv_unsigned_half_be */ "senza segno × 0,5 · big-endian",
  /* probe.conv_saturation */ "pressione → temperatura di saturazione",
  /* probe.conv_raw_fan */ "byte grezzo / livello ventilatore",
  /* probe.conv_capacity */ "codice capacità unità interna",
  /* probe.conv_eeprom_digit */ "cifra EEPROM grezza",
  /* probe.conv_eeprom_pair */ "coppia di cifre EEPROM grezze",
  /* probe.conv_bits_high */ "bit 4–6 · contatore a 3 bit",
  /* probe.conv_bits_low */ "bit 0–2 · contatore a 3 bit",
  /* probe.conv_operation_mode */ "modalità di funzionamento",
  /* probe.conv_error_class */ "classe errore",
  /* probe.conv_error_code */ "codice errore Daikin",
  /* probe.conv_indoor_mode */ "modalità unità interna · nibble alto",
  /* probe.conv_hybrid_mode */ "modalità ibrida",
  /* probe.conv_bit */ bit=>`bit ${bit} · 0 o 1`,
  /* probe.conv_unknown */ "convertitore sconosciuto",
  /* probe.send */ "Leggi registro",
  /* probe.querying */ "Interrogazione…",
  /* probe.action_note */ "Una richiesta per ciclo di polling. Bloccata durante l’OTA.",
  /* probe.catalog_loading */ "Caricamento profilo attivo…",
  /* probe.catalog_empty */ "Nessuna definizione di registro disponibile.",
  /* probe.catalog_error */ "Impossibile caricare i registri del profilo.",
  /* probe.catalog_profile */ profile=>`Profilo: ${profile}`,
  /* probe.catalog_fallback */ (definition,profile)=>`main/def: ${definition} · profilo: ${profile}`,
  /* probe.response */ "Risposta",
  /* probe.frame */ "Frame",
  /* probe.payload */ "Payload",
  /* probe.slice */ "Byte selezionati",
  /* probe.interpretation */ "Interpretazione",
  /* probe.response_for */ reg=>`Risposta dal registro ${reg}`,
  /* probe.payload_marked */ "Payload · byte selezionati evidenziati",
  /* probe.slice_note */ (offset,size,slice)=>`Offset ${offset} · ${size} byte · 0x${String(slice).replace(/\s+/g,"")}`,
  /* probe.full_frame */ "Frame completo",
  /* probe.decode_value */ "Risultato del convertitore",
  /* probe.no_decodes */ "Nessun risultato del convertitore.",
  /* probe.refused */ "Valore scartato",
  /* probe.unimplemented */ "Non implementato",
  /* probe.aliases */ "anche",
  /* probe.invalid */ "Controlla pagina, offset, larghezza campo e convertitore.",
  /* probe.failed */ "Richiesta non riuscita.",
  /* probe.status_ok */ "Risposta valida",
  /* probe.status_busy */ "Occupato",
  /* probe.status_no_link */ "Nessun collegamento X10A",
  /* probe.status_timeout */ "Tempo scaduto",
  /* probe.status_no_reply */ "Nessuna risposta",
  /* probe.status_rejected */ "Rifiutato",
  /* probe.status_bad_crc */ "Checksum errato",
  /* probe.status_unexpected_reply */ "Risposta inattesa",
  /* probe.status_invalid_length */ "Lunghezza non valida",
  /* probe.status_short_reply */ "Risposta parziale",
  /* probe.status_out_of_bounds */ "Fuori dal payload",
  /* probe.status_error */ "Errore",
  /* probe.transport_ok */ "Frame completo e valido.",
  /* probe.transport_busy */ "È attiva un’altra richiesta di registro.",
  /* probe.transport_no_link */ "Il collegamento X10A non è disponibile.",
  /* probe.transport_timeout */ "Il task di polling non ha eseguito la richiesta in tempo.",
  /* probe.transport_no_reply */ "Nessun byte di risposta ricevuto.",
  /* probe.transport_rejected */ "L’unità ha rifiutato questa pagina di registri.",
  /* probe.transport_bad_crc */ "Risposta ricevuta; checksum non valido.",
  /* probe.transport_unexpected_reply */ "La risposta appartiene a un’altra pagina di registri.",
  /* probe.transport_invalid_length */ "La risposta dichiara una lunghezza frame non valida.",
  /* probe.transport_short_reply */ "È stata ricevuta solo una parte della risposta.",
  /* probe.transport_out_of_bounds */ "I byte richiesti sono fuori da questo payload.",
  /* probe.transport_error */ "Richiesta non riuscita.",
  /* lang.auto */ "Browser",
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
  /* lang.saved */ "Lingua salvata",
  /* ota.downgrade_confirm */ (cur, avail) => `Tornare alla v${avail}?\n\nLa versione installata v${cur} è più recente. Questa build precedente viene proposta perché è stato selezionato un altro canale di aggiornamento. La firma viene verificata prima dell'installazione e il dispositivo ripristina automaticamente la build attuale se quella precedente non riesce a collegarsi.`,
  /* hist.cop_none */ "Nessuna curva COP quando la potenza elettrica proviene dalle pinze CT. I carichi inclusi dipendono dal cablaggio; la potenza termica registrata termina prima di BUH e non comprende il calore diretto di BSH, quindi non è garantito lo stesso confine di bilancio.",
]);
INSPECT_I18N.it = inspectValues(
  ["Nessuna lettura attuale:", "il compressore è fermo e l’unità esterna aggiorna i propri sensori solo durante il funzionamento. Il valore dell’ultimo ciclo viene nascosto per non mostrarlo come attuale."],
  [
    ["Modalità di funzionamento", 0, "Modalità dell’unità interna. Da sola non conferma compressore né portata."], // status
    ["Clima esterno", "Clima esterno da ENV III", "Temperatura, umidità e pressione di ENV III; la posizione condiziona la misura esterna."], // env3
    [(d) => d && d.sgSrc === "X10A" ? "Richiesta Smart Grid · X10A" : "Richiesta Smart Grid · Modbus", "Richiesta Smart Grid", (d) => d && d.sgSrc === "X10A"
      ? "Comando esterno indicato dai contatti fisici SG-Ready: Libero, Arresto forzato, Avvio consigliato o Avvio forzato. Non è la modalità caldo/freddo e non dimostra che sia iniziata una carica del serbatoio; un comando inviato in rete può non apparire sui contatti."
      : "Comando esterno letto dal HomeHub: Libero, Arresto forzato, Avvio consigliato o Avvio forzato. Non è la modalità caldo/freddo e non dimostra che sia iniziata una carica del serbatoio.", (d) => !d || d.sgMode == null
      ? "Nessun valore Smart Grid attuale."
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "I contatti SG-Ready indicano Avvio consigliato, lo stato usato da gestori come evcc per il rinforzo. Modalità ACS, 3WV e portata mostrano separatamente se il serbatoio viene davvero caricato."
      : d.sgMode === 2
      ? "HomeHub indica Avvio consigliato, lo stato usato da gestori come evcc per il rinforzo. Modalità ACS, 3WV e portata mostrano separatamente se il serbatoio viene davvero caricato."
      : d.sgMode === 1 ? "Il gestore energetico segnala «arresto forzato»."
      : d.sgMode === 3 ? "Il gestore energetico segnala «avvio forzato»."
      : "Nessuna richiesta Smart Grid esterna; l’unità funziona autonomamente."], // sgrequest
    ["Unità esterna", 0, "Lato sorgente termica di un impianto aria-acqua. La ventola muove aria sullo scambiatore e il compressore aumenta pressione e temperatura del refrigerante. È uno schema funzionale semplificato; monoblocco, geotermiche e ibride hanno una disposizione diversa.", (d) => d.defrost
      ? "Sbrinamento attivo: il circuito si inverte per sciogliere il ghiaccio sull’evaporatore e preleva brevemente calore dall’acqua."
      : compressorRunning(d)
      ? d.rps != null
        ? `In funzione: compressore a ${fmt0(d.rps)} rps${d.quiet ? ", limitato dalla modalità silenziosa" : ""}.`
        : "In funzione: HomeHub conferma il compressore attivo; velocità e letture dettagliate richiedono X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "In attesa: compressore fermo. X10A non aggiorna più i sensori esterni; l’aria esterna proviene da HomeHub, lo scarico resta «—» e l’età reale della lettura Modbus è sconosciuta."
      : "In attesa: compressore fermo, senza trasferimento attivo. I sensori propri dell’unità esterna restano «—» per non ripetere i valori dell’ultimo ciclo."], // ou
    ["Compressore", 0, "Comprime il refrigerante per aumentarne pressione e temperatura. La frequenza in rps indica la velocità, non da sola la potenza termica o elettrica."], // comp
    ["Aria esterna", 0, "Temperatura al sensore esterno. A riposo X10A può trattenerla; viene nascosta o HomeHub è identificato."], // out
    ["Scambiatore esterno · R4T", "Temperatura scambiatore esterno R4T", "Temperatura dello scambiatore esterno. In riscaldamento può scendere sotto zero e ghiacciare; va letta insieme allo stato di sbrinamento."], // ouhx
    ["Alta pressione", 0, "Pressione del lato alta del circuito frigorifero. Il valore può provenire dal trasduttore del compressore in marcia o dal sensore utilizzabile a riposo; non è pressione dell’acqua."], // hp
    ["Temperatura di scarico", 0, "Temperatura del gas all’uscita del compressore. X10A conserva il valore dell’ultimo ciclo a compressore fermo, quindi la lettura attuale viene nascosta a riposo."], // disch
    ["Bassa pressione", 0, "Pressione del refrigerante sul lato bassa del compressore, dopo l’espansione in riscaldamento. Alcuni profili non offrono un trasduttore valido; in tal caso appare «—»."], // lp
    ["Valvola di espansione", 0, "Dosa il refrigerante e ne riduce la pressione. La posizione è espressa in impulsi di comando, non in percentuale né come conferma meccanica dell’apertura."], // eev
    ["Refrigerante lato liquido · R3T", "Temperatura refrigerante lato liquido R3T", "Temperatura del refrigerante sul lato liquido dello scambiatore interno. Non è la temperatura di ritorno dell’acqua."], // r3t
    ["Scambiatore a piastre", 0, "Trasferisce energia tra refrigerante e acqua senza mescolarli. La potenza mostrata è stimata con portata e R1T/R4T; la posizione fisica esatta dei sensori dipende dal modello.", (d) => !compressorRunning(d, 5)
      ? "Nessun trasferimento frigorifero attivo: compressore fermo. La pompa può ridistribuire calore residuo, ma non è potenza di riscaldamento o raffrescamento."
      : d.dtStale ? "Trasferimento all’acqua non calcolabile: pompa e portata non dimostrano movimento nelle piastre."
      : d.pth == null ? "Le letture non permettono di stimare un trasferimento utile nella direzione della modalità selezionata."
      : d.pthKind === "cooling" ? `Circa ${fmt1(d.pth)} kW sottratti all’acqua: ${fmt1(d.flow)} l/min con ΔT ${fmt1(d.dt)} K.`
      : `Circa ${fmt1(d.pth)} kW trasferiti all’acqua: ${fmt1(d.flow)} l/min con ΔT ${fmt1(d.dt)} K.`], // phe
    ["Uscita PHE · prima BUH · R1T", "Uscita acqua PHE prima BUH R1T", "Temperatura dell’acqua in uscita dal PHE prima del riscaldatore ausiliario. Non include il calore elettrico aggiunto dopo dal BUH."], // lwt
    ["Mandata dopo BUH · R2T", "Mandata acqua dopo BUH R2T", "Temperatura acqua misurata dopo BUH. A differenza di R1T può includerne il calore elettrico; la posizione esatta rispetto a pompa e valvole dipende dall’unità idronica."], // r2t
    ["Ingresso PHE · R4T", "Ingresso acqua PHE R4T", "Temperatura dell’acqua che ritorna al PHE. È un sensore interno del circuito idraulico, non un sensore dedicato sugli emettitori dell’edificio."], // rwt
    ["ΔT acqua sul PHE", "Delta T acqua sul PHE", "R1T all’uscita del PHE meno R4T all’ingresso. È calcolato da due sensori; insieme alla portata descrive il trasferimento, ma non misura direttamente mandata e ritorno sugli emettitori.", (d) => d.dtStale ? "Nessun ΔT di lavoro: pompa e portata non dimostrano circolazione. Senza movimento, la differenza tra sensori non è un punto operativo."
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K con sola pompa: equalizzazione del calore residuo, non potenza termica.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. Nel raffrescamento attivo R1T deve essere sotto R4T; la differenza con segno è quindi negativa.`
      : `${fmt1(d.dt)} K${d.dtSet != null ? ` rispetto all’obiettivo di riscaldamento di ${fmt1(d.dtSet)} K` : ""}. Positivo significa che il PHE cede calore all’acqua.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Potenza frigorifera stimata" : "Potenza termica stimata", "Potenza termica stimata sul PHE", (d) => d && d.pthKind === "cooling"
      ? "Stima del calore sottratto: portata × (R4T−R1T) × 4,186 kJ/kg·K assumendo acqua. Dipende da portata, sensori e fluido; il glicole cambia il calcolo. Mostrata solo con compressore in marcia e differenza nella direzione di raffrescamento."
      : "Stima del calore ceduto: portata × (R1T−R4T) × 4,186 kJ/kg·K assumendo acqua. Dipende da portata, sensori e fluido; il glicole cambia il calcolo. BUH è dopo R1T e resta fuori dal valore.", (d) => d.dtStale ? d.bsh === true
      ? "Nessun trasferimento calcolabile sul PHE perché la circolazione non è dimostrata. La resistenza interna può ancora scaldare il serbatoio, ma il suo calore non attraversa R1T/R4T e questo bus non può quantificarlo."
      : "Nessuna potenza calcolabile perché non è dimostrato movimento d’acqua sul PHE. Manca un punto operativo; non significa 0 kW."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW frigoriferi${d.cop != null ? `; EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER stimato della pompa di calore" : d && d.copScope === "plant" ? "COP stimato dopo BUH" : "COP stimato della pompa di calore", "Efficienza stimata", (d) => d && d.efficiencyKind === "eer"
      ? "Potenza frigorifera stimata divisa per assorbimento elettrico stimato. Eredita le incertezze di fluido, sensori, tensione e fattore di potenza. È un EER istantaneo, non stagionale; l’energia misurata su una stagione è più significativa."
      : "Potenza termica stimata divisa per assorbimento elettrico stimato con confini compatibili: dopo BUH con CT e R2T, oppure sola pompa di calore con corrente inverter. Il cablaggio CT decide i carichi inclusi. Indicazione istantanea, non contatore certificato.", (d) => d.copBlock === "tank_heater" ? "Nessun COP: la resistenza del serbatoio può essere inclusa nell’elettricità, ma il calore va direttamente al serbatoio senza attraversare i sensori di mandata; i confini non coincidono."
      : d.copBlock === "buh_no_r2t" ? "Nessun COP: BUH attivo senza sensore successivo. L’elettricità può includere il riscaldatore mentre il calore viene stimato prima di esso."
      : d.copBlock === "mb_scope" ? "Nessun COP: HomeHub misura l’elettricità dell’intera unità, ma il calore del solo PHE e non fornisce né stati dei riscaldatori né sensore a valle per allineare i confini."
      : d.copBlock === "no_pel" ? d.pelHeld ? "Nessun COP: compressore fermo, la corrente inverter è dell’ultimo ciclo e non è attuale." : "Nessun COP: il profilo non fornisce né correnti CT né corrente inverter."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW frigoriferi per kW elettrico: ≈ ${fmt1(d.copPth)} kW sottratti con ≈ ${fmt1(d.pel)} kW assorbiti.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW termici dopo BUH per kW elettrico stimato da CT: ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. Il cablaggio CT determina i carichi inclusi.`
      : `${fmt1(d.cop)} kW termici per kW elettrico nel confine pompa di calore: ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. BUH è fuori da entrambi i valori.`], // cop
    ["Riscaldatore ausiliario · BUH", "Riscaldatore ausiliario BUH", "Riscaldatore elettrico del circuito acqua posto dopo R1T. Gli stadi possono aumentare mandata e consumo; non è la resistenza interna BSH del serbatoio.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Stadio 2: entrambi gli stadi scaldano." : d.buh1 ? "Stadio 1: uno stadio scalda." : "Inattivo: nessuno stadio BUH riscalda."], // buh
    ["Resistenza serbatoio", "Resistenza elettrica del serbatoio", "Resistenza a immersione BSH nel serbatoio. Può scaldare con compressore, pompa e portata a zero; il contatto X10A non misura la potenza.", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "Resistenza del serbatoio attiva." : "Inattiva: resistenza del serbatoio spenta."; }], // bsh
    ["Valvola a 3 vie", 0, "L’uscita logica seleziona il serbatoio o gli ambienti. Non è un ritorno meccanico di posizione né una prova di portata.", (d) => d.valveDhw == null ? null : d.valveDhw ? "Il controllo indica il percorso serbatoio. Non dimostra posizione meccanica, portata o carica attiva." : "Il controllo indica il percorso ambienti. Non dimostra posizione meccanica o circolazione."], // valve
    ["Uscita valvola a 2 vie", 0, "Uscita binaria X10A per una 2WV del circuito ambienti. Non indica la posizione meccanica e non equivale alla modalità caldo/freddo.", (d) => d.valve2On == null ? null : d.valve2On ? "X10A indica l’uscita 2WV attiva. Non dimostra riscaldamento attivo o posizione meccanica; verificare modalità e funzionamento ambienti." : "X10A indica l’uscita 2WV inattiva. Da sola non significa raffrescamento e non contraddice una modalità riscaldamento configurata, soprattutto a riposo."], // valve2
    ["Serbatoio ACS", "Serbatoio ACS o accumulo termico", "Serbatoio misurato da R5T. Carica, obiettivo e resistenza BSH sono mostrati separatamente."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Circuito raffrescamento" : activeSpaceKind(d) === "heat" ? "Circuito riscaldamento" : "Circuito ambienti", "Circuito ambienti", "Emettitori dell’edificio: radiatori, pavimento o ventilconvettori. L’impianto decide se riscaldano, raffrescano o entrambi; R1T/R4T sono misurati nella pompa e non confermano la loro temperatura.", (d) => d.valveDhw === true ? "Il percorso ambienti non è selezionato; pompa e portata mostrano separatamente un’eventuale circolazione nel serbatoio."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Acqua residua calda circola verso gli ambienti. R1T interno: ${degC(d.lwt)}; nessun sensore a valle conferma la temperatura degli emettitori. Non è raffrescamento attivo.`
        : `L’acqua va al circuito ${activeSpaceKind(d) === "cool" ? "raffrescamento" : activeSpaceKind(d) === "heat" ? "riscaldamento" : "ambienti"}. R1T interno: ${degC(d.lwt)}; nessun sensore sugli emettitori.`
      : "Pompa e portata attuali non dimostrano circolazione nel ramo ambienti."], // heat
    ["Funzionamento ambienti", "Funzionamento caldo o freddo degli ambienti", "Segnale di normale funzionamento caldo/freddo degli ambienti. Non è la richiesta del termostato e non dimostra da solo che il compressore sia attivo."], // spaceh
    ["Temperatura ambiente", 0, "Temperatura e obiettivo della zona di riferimento; dipendono dalla posizione del sensore."], // room
    ["Pompa di circolazione", "Velocità pompa di circolazione", "Muove l’acqua nell’anello comune e nel ramo scelto dalla 3WV. Può restare attiva con compressore fermo per post-circolazione, protezione o equalizzazione; velocità e portata vanno lette insieme.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `La pompa interna risulta ferma, ma il sensore misura ${fmt1(d.flow)} l/min. Sono possibili circolazione esterna, post-circolazione o segnali discordanti; verificare entrambi.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Velocità ${fmt0(d.pump)} %; portata misurata ${fmt1(d.flow)} l/min.` : `Velocità ${fmt0(d.pump)} %, ma manca la portata; circolazione non confermata.`
      : waterMoving(d) ? `Il sensore misura ${fmt1(d.flow)} l/min senza una velocità pompa utilizzabile.`
      : d.pumpOn === true ? d.flow != null ? `Pompa attiva, ma solo ${fmt1(d.flow)} l/min; circolazione non dimostrata.` : "Pompa attiva, ma manca la portata; circolazione non confermata."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Pompa ferma; il sensore indica ${fmt1(d.flow)} l/min. I segnali non dimostrano circolazione.` : "Pompa ferma e nessuna misura di portata."
      : `Stato pompa non affidabile; ${fmt1(d.flow)} l/min non basta a dimostrare circolazione.`], // pump
    [(d) => pelMeasured(d) ? "Assorbimento elettrico · HomeHub" : "Assorbimento elettrico stimato", "Assorbimento elettrico", (d) => pelMeasured(d)
      ? "Consumo comunicato dall’ingresso HomeHub 51. La UI non lo calcola, ma la guida pubblica non prova calibrazione, punto di misura o riscaldatori inclusi; non è un contatore certificato dell’impianto."
      : "Stima per COP/EER. Con CT somma tutte le fasi dichiarate e usa corrente × 230 V presunti; tensione e fattore di potenza reali sono ignoti. La corrente inverter copre solo il compressore.", (d) => d.pelHeld ? "Compressore fermo: la corrente inverter è dell’ultimo ciclo e non è attuale; assorbimento ed efficienza non possono essere indicati."
      : d.pel == null ? "Questo profilo non offre una lettura elettrica attuale; COP/EER non può essere calcolato."
      : d.pelSrc === "MB" ? "Comunicato dall’ingresso HomeHub 51; il confine esatto di misura non è documentato."
      : d.pelSrc === "CT" ? "Stimato con pinze CT; i carichi inclusi dipendono dal cablaggio."
      : "Calcolato dalla corrente inverter, solo compressore."], // pel
    ["Sbrinamento", 0, "Inverte temporaneamente il circuito per rimuovere ghiaccio dallo scambiatore esterno. Normale con freddo umido, preleva brevemente calore dall’acqua.", (d) => d.defrost == null ? null : d.defrost ? "Sbrinamento attivo." : "Inattivo: nessuno sbrinamento in corso."], // defrost
    ["Modalità silenziosa", 0, "Modalità che limita rumore e di solito velocità o potenza dell’unità esterna. Il segnale mostra lo stato, non il livello esatto né l’effetto termico.", (d) => d.quiet == null ? null : d.quiet ? "Modalità silenziosa attiva." : "Inattiva: modalità silenziosa spenta."], // quiet
    ["Linea gas", "Linea gas refrigerante", "Linea frigorifera tra unità nello schema split. In riscaldamento porta gas caldo ad alta pressione al PHE; in raffrescamento il flusso si inverte. Un monoblocco non ha questa linea in campo.", (d) => compressorRunning(d) ? d.rps != null ? `In circolazione: ${fmt1(d.circP)} bar a ${fmt0(d.disch)} °C.` : "In circolazione: HomeHub conferma il compressore; pressione e scarico richiedono X10A." : "Nessuna circolazione frigorifera attiva: compressore fermo. L’equalizzazione dipende dal circuito e dal tempo di arresto."], // rhot
    ["Linea liquido", "Linea liquido refrigerante", "Linea frigorifera tra unità nello schema split. In riscaldamento riporta refrigerante condensato ad alta pressione alla valvola esterna; in raffrescamento il flusso si inverte. Un monoblocco non ha questa linea.", (d) => compressorRunning(d) ? d.rps != null ? `In circolazione: valvola di espansione a ${fmt0(d.eev)} impulsi.` : "In circolazione: HomeHub conferma il compressore; la posizione della valvola richiede X10A." : "Ferma: compressore arrestato."], // rcold
    ["Tubo uscita PHE", "Tubo di uscita PHE", "Acqua che esce dal PHE a R1T e passa per BUH, pompa e 3WV. In riscaldamento/ACS è il lato caldo, in raffrescamento attivo il lato freddo; R1T è prima di BUH e dei rami.", (d) => waterMoving(d) ? `R1T prima di BUH: ${degC(d.lwt)} a ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; uno stadio BUH è attivo dopo" : ""}.` : "Pompa e portata non dimostrano circolazione in questo tubo."], // wsup
    ["Circuito serbatoio", "Circuito idraulico serbatoio", "Ramo idraulico che carica il serbatoio ACS o l’accumulo. Lo scambiatore interno dipende dal modello; il disegno mostra la funzione, non la costruzione esatta. In questo schema deviato la carica interrompe il flusso diretto agli ambienti.", (d) => d.valveDhw === true ? waterMoving(d) ? `Percorso serbatoio selezionato: ${fmt1(d.flow)} l/min, uscita PHE ${degC(d.lwt)}, serbatoio ${degC(d.tank)}.` : "Percorso serbatoio selezionato, ma pompa e portata non dimostrano una carica attiva." : "Percorso serbatoio non selezionato; il controllo indica gli ambienti."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Ramo raffrescamento" : activeSpaceKind(d) === "heat" ? "Ramo riscaldamento" : "Ramo ambienti", "Ramo idraulico ambienti", "Ramo verso radiatori, pavimento, ventilconvettori o altri emettitori. R1T/R4T sono misurati nell’unità idronica e non provano la temperatura del ramo o il carico dell’edificio.", (d) => d.valveDhw === true ? "Ramo ambienti non selezionato; il controllo indica il serbatoio."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Circolazione di calore residuo verso gli ambienti a ${fmt1(d.flow)} l/min; nessun raffrescamento attivo. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}; lato campo non misurato.`
        : `Circolazione verso gli ambienti a ${fmt1(d.flow)} l/min. Sensori interni: R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.`
      : "Pompa e portata non dimostrano circolazione nel ramo ambienti."], // wheat
    ["Tubo ingresso PHE", "Tubo di ingresso PHE", "Ritorno comune al PHE tramite R4T dopo l’unione dei rami. In riscaldamento è normalmente più freddo di R1T, in raffrescamento attivo più caldo; R4T non è un sensore dedicato sugli emettitori.", (d) => waterMoving(d) ? `Ritorno a ${degC(d.ret)}, ${fmt1(d.flow)} l/min e ${fmt1(d.wp)} bar.` : "Pompa e portata non dimostrano circolazione nel ritorno."], // wret
    ["Portata", "Portata acqua", "Portata del circuito comune. Il minimo dipende dal modello; leggerla con pompa e pressione."], // flow
    ["Stato flussostato", 0, "Ingresso binario X10A; non misura l/min né conferma la portata minima.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A attivo; confrontare con pompa e ${fmt1(d.flow)} l/min.` : `X10A inattivo; con pompa attiva confrontare ${fmt1(d.flow)} l/min e guasti 7H/C0.`], // flow_switch
    ["Pressione acqua", 0, "Pressione del circuito idraulico, non del refrigerante. L’intervallo ammesso dipende da modello e impianto; consultare il manuale esatto."], // wp
  ],
);

HOMEHUB_LABEL_I18N.it = homeHubValues([
  "Obiettivo mandata riscaldamento · zona principale", // 1
  "Obiettivo mandata raffrescamento · zona principale", // 2
  "Modalità caldo o freddo", // 3
  "Climatizzazione abilitata", // 4
  "Obiettivo riscaldamento · zona principale", // 6
  "Obiettivo raffrescamento · zona principale", // 7
  "Modalità silenziosa", // 9
  "Obiettivo riscaldamento ACS", // 10
  "Stato diagnostico dell’unità", // 21
  "Codice guasto dell’unità", // 22
  "Sottocodice guasto dell’unità", // 23
  "Pompa di circolazione attiva", // 30
  "Compressore attivo", // 31
  "Resistenza serbatoio attiva", // 32
  "Disinfezione serbatoio attiva", // 33
  "Posizione valvola a 3 vie", // 37
  "Modalità attuale caldo o freddo", // 38
  "Mandata all’uscita PHE", // 40
  "Mandata dopo BUH", // 41
  "Temperatura di ritorno", // 42
  "Temperatura serbatoio ACS", // 43
  "Temperatura esterna", // 44
  "Temperatura refrigerante lato liquido", // 45
  "Portata", // 49
  "Temperatura ambiente zona principale", // 50
  "Assorbimento elettrico", // 51
  "Funzionamento ACS", // 52
  "Funzionamento ambienti", // 53
  "Correzione mandata · zona principale", // 54
  "Modalità Smart Grid", // 56
  "Limite potenza per accumulo", // 57
  "Limite generale di potenza", // 58
]);

DESCRIPTION_I18N.it = descriptionValues([
  ["Temperatura obiettivo del serbatoio ACS o dell’accumulo termico."], // 0
  ["Lettura di un secondo sensore del serbatoio, per esempio quello inferiore in un accumulo con due sensori."], // 1
  ["Temperatura indicata dal sensore del serbatoio R5T."], // 2
  ["La modalità potente avvia subito la carica del serbatoio fino all’obiettivo comfort o accumulo."], // 3
  ["Preriscaldamento X10A prima di richiesta/programma; non è la disinfezione HomeHub e non la prova."], // 4
  ["L’ingresso HomeHub 33 indica la disinfezione attiva; un impulso fra due letture Modbus può non essere registrato."], // 5
  ["Stato termostato proprio del controllo esterno, distinto dalla richiesta dell’unità interna e non prova del compressore."], // 6
  ["Bit esterno a bassa rumorosità; livello e causa del comando non sono dimostrati."], // 7
  ["Bit dell’ingresso solare idronico; funzione e polarità non sono dimostrate."], // 8
  ["Bit di fase del controllo per attesa riavvio o sequenza di avvio, non per calore utile."], // 9
  ["Operazione interna che riporta l’olio refrigerante al compressore."], // 10
  ["Fase di equalizzazione della pressione frigorifera, non misura di pressione o posizione valvola."], // 11
  ["Bit proprietario di richiesta del controllo esterno, senza livello di comando documentato."], // 12
  ["Bit di comando/stato della valvola a 4 vie; non conferma la posizione meccanica."], // 13
  ["Bit di comando/stato del riscaldatore carter; non misura corrente o temperatura del compressore."], // 14
  ["Uno di tre bit proprietari di elettrovalvola/uscita; nome, movimento e polarità non sono confermati."], // 15
  ["Sottocodice numerico del controllo interno; integra il guasto principale senza una tabella validata per modello."], // 16
  ["Comando/stato logico di una valvola opzionale del circuito a pavimento, non posizione o portata."], // 17
  ["Bit unità interna «sistema spento»; non prova che pompe, riscaldatori e protezioni siano disalimentati."], // 18
  ["Ingresso termostato esterno della zona aggiuntiva per caldo o freddo, non temperatura o stato compressore."], // 19
  ["Bit di richiesta del termostato ambiente principale per caldo o freddo, non conferma di erogazione."], // 20
  ["Uno di quattro bit grezzi del limite di potenza; non ricavare uno stadio finché la codifica non è dimostrata."], // 21
  ["Bit di comando/stato del riscaldatore PHE; non è noto se sia comando o feedback e non prova corrente."], // 22
  ["Il riscaldamento ripristina il serbatoio al proprio obiettivo dopo la discesa sotto la soglia di avvio."], // 23
  ["Profilo programmato: Comfort usa l’obiettivo alto ed Eco quello basso."], // 24
  ["In un sistema ibrido, richiesta ACS del controllo alla caldaia."], // 25
  ["La valvola deviatrice invia acqua al serbatoio ACS o al circuito ambienti; la posizione non prova attività."], // 26
  ["Stato X10A ON/OFF dell’uscita per una 2WV opzionale; non prova modalità, tensione o posizione meccanica."], // 27
  ["Apertura della valvola miscelatrice di una seconda zona."], // 28
  ["Obiettivo di mandata della modalità riscaldamento o raffrescamento selezionata."], // 29
  ["Temperatura di mandata miscelata di una zona secondaria, dopo la valvola miscelatrice."], // 30
  ["Temperatura dopo BUH, di solito R2T; include il suo apporto ma non prova la temperatura agli emettitori."], // 31
  ["R1T esce dal PHE prima di BUH; con R4T e portata stima la potenza per modo, ma la posizione dipende dall’unità."], // 32
  ["Temperatura R4T in ingresso PHE sul ritorno comune; il ΔT va valutato col modo, non con 5 K universali."], // 33
  ["Portata nel circuito idronico comune; il minimo dipende da modello e modo e una portata bassa può causare 7H."], // 34
  ["Pressione del circuito idronico; molti manuali richiedono >1 bar, ma a ≤1,0 bar va consultato il modello esatto."], // 35
  ["Comando velocità pompa invertito: 0 significa piena velocità e 100 arresto."], // 36
  ["Stato della pompa idronica; il funzionamento non prova da solo uno scambio termico utile."], // 37
  ["Stato della pompa di un circuito solare termico, distinta dalla pompa idronica della pompa di calore."], // 38
  ["Velocità indicata della pompa nominata dal profilo; scala e circuito dipendono dal modello."], // 39
  ["Stato X10A del flussostato: ON indica movimento, non l/min o minimo; alcuni modelli non documentano un contatto fisico."], // 40
  ["Modalità attuale del lato idronico: stop, riscaldamento, raffrescamento, ACS o combinazione; non prova attività."], // 41
  ["Comando Smart Grid a quattro stati letto da HomeHub o da due contatti X10A; non è la modalità caldo/freddo."], // 42
  ["Modalità ambienti attuale, riscaldamento o raffrescamento; non prova che il compressore sia attivo."], // 43
  ["Selezione HomeHub configurata: Auto, Riscaldamento o Raffrescamento; non è lo stato esterno attuale."], // 44
  ["Stato comunicato dall’unità esterna, per esempio Stop, Riscaldamento o Raffrescamento; non prova calore utile."], // 45
  ["Sbrinamento dell’unità esterna; normale col freddo umido, ma il solo bit non diagnostica cicli eccessivi."], // 46
  ["Classe del guasto attivo: Normale, Errore, Avviso o Attenzione."], // 47
  ["Significato del codice guasto comunicato ora"], // 48
  ["Funzionamento di emergenza dopo un guasto della pompa di calore, con eventuale BUH o caldaia."], // 49
  ["Relè di allarme dell’unità, attivo per segnalare un guasto a un sistema esterno collegato."], // 50
  ["Obiettivo di temperatura ambiente della zona principale in riscaldamento o raffrescamento."], // 51
  ["Richiesta interna «thermo ON»; non identifica il carico né prova il compressore, e «Space heating Operation» non è richiesta."], // 52
  ["Stato del terminale di uscita «Space H Operation», non del normale funzionamento ambienti."], // 53
  ["Indica se il normale funzionamento caldo/freddo degli ambienti è abilitato o attivo, non una richiesta termostato."], // 54
  ["Temperatura ambiente obiettivo della zona controllata dal sensore proprio dell’unità."], // 55
  ["Temperatura ambiente misurata dal sensore integrato o cablato; il suo ruolo dipende dal metodo di controllo."], // 56
  ["Protezione scarico: ON/OFF attuale + contatore 0–7; solo aumento comparabile = attività, non causa; soglia, reset e ritorno 7→0 ignoti."], // 57
  ["Protezione corrente inverter: ON/OFF attuale + contatore 0–7; solo aumento comparabile = attività, non causa; soglia, reset e ritorno 7→0 ignoti."], // 58
  ["Protezione alta pressione: ON/OFF attuale + contatore 0–7; solo aumento comparabile = attività, non causa; soglia, reset e ritorno 7→0 ignoti."], // 59
  ["Protezione bassa pressione: ON/OFF attuale + contatore 0–7; solo aumento comparabile = attività, non causa; soglia, reset e ritorno 7→0 ignoti."], // 60
  ["Protezione termica inverter: ON/OFF attuale + contatore 0–7; solo aumento comparabile = attività, non causa; soglia, reset e ritorno 7→0 ignoti."], // 61
  ["Bit interno generico di limitazione non assegnato alle cinque protezioni; non è una diagnosi della causa."], // 62
  ["Temperatura acqua in ingresso o uscita PHE, che trasferisce calore fra refrigerante e circuito idronico."], // 63
  ["Temperatura di un sensore dello scambiatore esterno; da sola non dimostra ghiaccio sulla batteria."], // 64
  ["Temperatura esterna misurata dall’unità per compensazione climatica e controllo."], // 65
  ["Temperatura del gas refrigerante caldo e compresso in uscita dal compressore."], // 66
  ["Temperatura del gas refrigerante freddo a bassa pressione che ritorna al compressore."], // 67
  ["Temperatura del refrigerante nella linea liquido tra gli scambiatori."], // 68
  ["Temperatura del refrigerante all’ingresso/uscita dell’evaporatore."], // 69
  ["Temperatura della linea di iniezione refrigerante usata per controllo e protezione del ciclo."], // 70
  ["Temperatura in una zona bifase, liquido e vapore, del circuito frigorifero; non è un setpoint."], // 71
  ["Temperatura del sensore di sbrinamento dello scambiatore esterno."], // 72
  ["Temperatura di saturazione calcolata dalla pressione; non è un sensore separato né una pressione in bar."], // 73
  ["Pressione refrigerante sul lato alta/scarico o bassa/aspirazione."], // 74
  ["Velocità del compressore inverter in rps; dipende dal modello e non misura direttamente la potenza termica."], // 75
  ["Posizione comandata della valvola di espansione elettronica in passi/impulsi, non percentuale o portata massica."], // 76
  ["Temperatura dell’elettronica di comando del motore ventilatore esterno."], // 77
  ["Velocità del ventilatore esterno in stadio o rpm."], // 78
  ["Obiettivo interno del circuito frigorifero, per esempio temperatura di evaporazione/condensazione."], // 79
  ["Obiettivo interno di temperatura scarico/porta compressore usato dalle protezioni."], // 80
  ["ΔT obiettivo fra mandata e ritorno; dipende da modello e modo e non segue una regola universale di 5 K."], // 81
  ["Refrigerante caricato nell’unità, per esempio R32 o R410A, base della curva pressione-temperatura."], // 82
  ["Temperatura misurata su una porta del compressore per controllo e protezione interni."], // 83
  ["Lettura di pressione del circuito frigorifero dell’unità esterna."], // 84
  ["Corrente di fase L1/L2/L3 da CT; la stima a 230 V non è calibrata e ignora tensione reale e fattore di potenza."], // 85
  ["Corrente assorbita dall’inverter del compressore, indicatore approssimativo del suo carico."], // 86
  ["Temperatura del dissipatore inverter/elettronica di potenza esterna."], // 87
  ["Stadio attivo del riscaldatore ausiliario BUH; 0 significa nessuno e i motivi dipendono dal controllo."], // 88
  ["Stadio della resistenza elettrica dell’unità idronica che aggiunge calore all’acqua."], // 89
  ["Ingresso HomeHub 32: stato ON/OFF BSH, non potenza; l’ingresso 51 è consumo della pompa di calore, non di BSH."], // 90
  ["Resistenza elettrica immersa BSH del serbatoio ACS; X10A indica solo ON/OFF, non la potenza."], // 91
  ["Catena di protezione termica di un riscaldatore; uno stato aperto richiede codice guasto e controllo elettrico."], // 92
  ["Protezione antigelo delle tubazioni; dipende dal modello, richiede alimentazione e non copre un blackout."], // 93
  ["Stato antigelo X10A; senza dati del modello non identifica pompa, riscaldatore o area protetta."], // 94
  ["Lettura del circuito geotermico a salamoia e della sua pompa; limiti e fluido dipendono dall’impianto."], // 95
  ["Modalità sorgente di un sistema ibrido: sola pompa di calore, combinata o sola caldaia; non è calore misurato."], // 96
  ["Obiettivo di mandata durante il riscaldamento ibrido, non temperatura misurata."], // 97
  ["Permesso/stato di funzionamento bivalente con seconda sorgente; ON non prova caldaia accesa."], // 98
  ["Richiesta attuale alla caldaia in un sistema bivalente/ibrido; non prova bruciatore o calore erogato."], // 99
  ["Obiettivo temperatura acqua richiesto per riscaldamento a caldaia, non temperatura misurata."], // 100
  ["Valore bivalente interno BE_COP; significato e scala X10A non documentati, non è il COP attuale."], // 101
  ["Ingresso esterno rete elettrica, Smart Grid o solare; l’azione dipende dalla configurazione del contatto."], // 102
  ["Capacità nominale/classe dell’unità interna o esterna, in kW o codice; non è una misura attuale."], // 103
  ["La modalità silenziosa riduce il rumore esterno e può limitare la capacità disponibile."], // 104
  ["Stato diagnostico HomeHub: Nessun errore, Guasto o Avviso; lo stato solo non identifica la causa."], // 105
  ["Significato del codice guasto comunicato ora"], // 106
  ["Sottocodice numerico del codice Daikin vicino; va letto solo insieme allo stato e al codice principale."], // 107
  ["Indica se HomeHub comunica il compressore attivo; non fornisce velocità o capacità."], // 108
  ["Indica se il normale funzionamento ACS è attivo, non il motivo dell’avvio."], // 109
  ["Indica se il normale funzionamento caldo/freddo degli ambienti è attivo."], // 110
  ["Uscita PHE prima di BUH; confrontarla col ritorno solo con circolazione per ottenere il ΔT."], // 111
  ["Temperatura di mandata dopo BUH; un aumento va confermato dallo stato BUH."], // 112
  ["Temperatura acqua nel serbatoio ACS."], // 113
  ["Temperatura linea liquido; il rapporto dipende dal modo e un valore isolato non diagnostica."], // 114
  ["Temperatura ambiente della zona principale comunicata dal comando remoto."], // 115
  ["Consumo elettrico comunicato via HomeHub; dipende da modo e carichi e non va attribuito tutto al compressore."], // 116
  ["Obiettivo mandata riscaldamento principale letto da HomeHub; il firmware è solo lettura."], // 117
  ["Obiettivo mandata raffrescamento principale letto da HomeHub; può restare visibile senza raffrescamento attivo."], // 118
  ["Abilitazione del circuito ambienti: è l’interruttore, non l’attività attuale."], // 119
  ["Il funzionamento silenzioso riduce il rumore e può limitare la capacità disponibile."], // 120
  ["Obiettivo del serbatoio per riscaldamento ACS; la soglia di avvio dipende anche da isteresi e programma."], // 121
  ["Correzione −10…+10 K dell’obiettivo mandata riscaldamento; non prova calore senza funzionamento ambienti."], // 122
  ["Limite accumulo in Avvio consigliato; prevale il minore col limite generale e non è consumo."], // 123
  ["Limite elettrico generale HomeHub, anche in funzionamento libero; è un tetto, non consumo misurato."], // 124
]);

MODEL_DESCRIPTION_I18N.it = modelDescriptionValues([
  ["Stato proprio dell’unità: errore attivo dà AVVISO; avvertimento o messaggio cancellato entro 24 h dà NOTA, non una deduzione del progetto."], // health_fault
  ["Perdita a riposo: soglia di progetto, NOTA ≥0,8 K/h; volume e ΔT incidono, >≈1,85 K/h può filtrarsi come uso e OK non prova isolamento."], // health_dhw_loss
  ["NOTA con ≥12 cicli riscaldamento medi <10 min; esclude ACS/freddo, non è limite Daikin e se troppi restano non classificati li valuta tutti insieme."], // health_cycling
  ["Conta gli sbrinamenti: NOTA oltre il 15 % del tempo compressore con ≥3 cicli; non è un limite Daikin e mancano umidità e temperatura superficie."], // health_defrost
  ["Minima pressione acqua: >1,0 bar; ≤1,0 dà NOTA e dopo 60 s AVVISO, ma il campo dipende dal modello."], // health_pressure
  ["Portata dopo 60 s di pompa: solo tratto misurato; un dato isolato dice poco, confrontare stesso modello, modo e condizioni, senza soglia universale."], // health_flow
  ["Durata osservata di BUH e BSH: freddo, emergenza, sbrinamento, ACS o surplus possono spiegarla; nessun limite universale."], // health_heater
  ["5 contatori sperimentali poco documentati: solo un aumento comparabile dà NOTA, non diagnosi; senza aumenti le limitazioni non sono escluse."], // health_retries
  ["RAM libera attuale e andamento su 24 h: una discesa persistente può indicare allocazioni non liberate. Un riavvio con alimentazione conserva l’andamento in RAM; un riavvio normale, un aggiornamento o un’interruzione ripristina dal flash gli intervalli chiusi di 5 min. Può mancare solo quello aperto."], // free_heap
  ["Massimo blocco contiguo richiesto da TLS/OTA; se cala con RAM totale stabile indica frammentazione."], // max_alloc
  ["Capacità nominale dell’unità esterna dalla pagina identificativa, non potenza prodotta ora."], // capacity
  ["Capacità nominale dell’UNITÀ INTERNA; non va attribuita all’esterna o all’intero sistema."], // capacity_iu
  ["Più famiglie Daikin condividono registri e capacità, quindi il nome esatto non è distinguibile; i valori restano validi e la targa identifica il modello."], // candidates
  ["Senza capacità esterna i candidati possono differire; il firmware usa la miglior corrispondenza interna senza certezza, da verificare sulla targa."], // candidates_nocap
  ["Byte identificativi dell’unità esterna senza mappa pubblica dei nomi; in caso ambiguo confrontarli con la targa."], // oueeprom
]);
