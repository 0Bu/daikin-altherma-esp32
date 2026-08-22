// translation-source: 1a1e4d9480a8c303fb19c7df082748eb134a71d2c548980f810ec2c06d3bd40e
I18N.fi = localeValues([
  /* sys.nodata */ "Ei tietoja",
  /* sys.unreachable */ "Ei tavoiteta",
  /* sys.x10a_down */ "X10A ei yhteyttä",
  /* sys.mb_carrying */ "Toimintatila tuntematon — arvot Modbusista",
  /* sys.mb_only */ "X10A ei yhteyttä — arvot Modbusista",
  /* sys.mb_source */ "X10A ei yhteyttä · Modbus",
  /* mode.stop */ "Pysäytetty",
  /* mode.heat */ "Lämmitys",
  /* mode.cool */ "Jäähdytys",
  /* mode.space */ "Tilalämmitys/-jäähdytys",
  /* mode.dhw */ "Käyttövesi",
  /* mode.heat_dhw */ "Lämmitys + käyttövesi",
  /* mode.cool_dhw */ "Jäähdytys + käyttövesi",
  /* mode.space_dhw */ "Tilalämmitys/-jäähdytys + käyttövesi",
  /* sys.unreachable_sub */ "Laitetta ei tavoiteta — yritetään uudelleen…",
  /* sys.waiting */ "Odotetaan lämpöpumppua…",
  /* sys.operating */ "Käynnissä",
  /* sys.standby */ "Valmiustila — ei käynnissä",
  /* sys.defrosting */ "Sulatus käynnissä",
  /* sys.circulating */ "Kierto käynnissä — kompressori pois",
  /* sys.cool_mode */ "Jäähdytystila",
  /* sys.residual_circulating */ "Jälkilämmön kierto — ei jäähdytystehoa",
  /* sys.bsh_active */ "Säiliön sähkövastus käytössä",
  /* sys.online */ "Yhteydessä",
  /* sys.fault */ "Vika",
  /* sys.warning */ "Varoitus",
  /* sys.fault_line */ (c) => "Vika · " + c + " — tarkista Daikin-vikakoodi.",
  /* sys.warning_line */ (c) => "Varoitus · " + c + " — tarkista lämpöpumppu.",
  /* sys.polled */ (s) => `Luettu ${s} s sitten`,
  /* recovery.title */ "Palautustila",
  /* recovery.meta_heap */ "Muisti loppui toistuvasti ja laite käynnistyi uudelleen. Lämpöpumppuyhteys ja MQTT on nyt poistettu käytöstä, jotta käyttöliittymä säilyy tavoitettavana. Asetukset ovat todennäköisesti kunnossa — asenna uudempi laiteohjelmisto Asetuksista. Virrankatkaisu yrittää käynnistää kaikki palvelut uudelleen.",
  /* recovery.meta */ "Laite käynnistyi toistuvasti uudelleen ja siirtyi palautustilaan. Lämpöpumppu- ja MQTT-yhteydet on keskeytetty. Tarkista asetukset, erityisesti Asetukset-näkymän Protokolla-kortin RX/TX-nastat, ja käynnistä laite uudelleen.",
  /* rollback.title */ "WiFi-muutos epäonnistui — palautettu",
  /* rollback.meta */ (back) => `Laite ei saanut yhteyttä uusilla WiFi-asetuksilla. Edellinen verkko${back} palautettiin ja laite käynnistyi uudelleen. Tarkista verkon nimi ja salasana kohdasta Asetukset → Yhteydet ja yritä uudelleen.`,
  /* crash.title_fault */ "Laite käynnistyi uudelleen kaatumisen jälkeen",
  /* crash.title_orphan */ "Aiemman käynnistyksen kaatumisraportti odottaa",
  /* crash.reset */ "Nollaus",
  /* crash.task */ "tehtävä",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "vioittunut",
  /* crash.download */ "Lataa kaatumisraportti",
  /* crash.copy */ "Kopioi diagnostiikka",
  /* crash.dismiss */ "Poista raportti",
  /* crash.copied */ "Diagnostiikka kopioitu — liitä vikailmoitukseen",
  /* crash.copy_fail */ "Kopiointi epäonnistui — avaa /coredump ja /diag käsin",
  /* crash.ask_dump */ "Poistetaanko laitteesta? Myös muistivedos poistuu — lataa se ensin vikailmoitusta varten.",
  /* crash.ask */ "Poistetaanko raportti laitteesta?",
  /* crash.ask_yes */ "Poista",
  /* crash.ask_no */ "Säilytä",
  /* crash.deleted */ "Kaatumisraportti poistettu",
  /* crash.delete_fail */ "Laite ei voinut poistaa raporttia — se on yhä tallessa",
  /* bug.row */ "Ilmoita viasta",
  /* bug.title */ "Ilmoita viasta",
  /* bug.intro */ "Kuvaile ongelma lyhyesti. Laite lisää tilansa, mittausarvot ja lokin poistettuaan verkkojen nimet, osoitteet ja palvelinnimet.",
  /* bug.what */ "Mitä tapahtuu",
  /* bug.what_ph */ "Säiliön lämpötila on näyttänyt Home Assistantissa 12800 °C tänä aamuna.",
  /* bug.need_text */ "Kuvaile ensin tapahtuma — yksi tai kaksi lausetta riittää.",
  /* bug.continue */ "Valmistele raportti",
  /* bug.step2_title */ "Tarkista raportti",
  /* bug.step2 */ "Tarkista raportti alta. Painike kopioi sen ja avaa GitHub-lomakkeen kuvauksesi valmiiksi täytettynä. Liitä raportti “Device report” -kenttään, vastaa muihin kysymyksiin ja lähetä ilmoitus.",
  /* bug.collecting */ "Kerätään laitteen tietoja…",
  /* bug.collect_fail */ "Laitetta ei voitu lukea — alla oleva raportti kertoo puuttuvat osat.",
  /* bug.copy */ "Kopioi ja avaa GitHub",
  /* bug.download */ "Lataa .md",
  /* bug.md_hint */ "Jos kopiointi ei onnistu tai haluat tiedoston, lataa sama raportti .md-muodossa ja vedä se “Device report” -kenttään tekstin liittämisen sijaan.",
  /* bug.copied */ "Raportti kopioitu — liitä se “Device report” -kenttään",
  /* bug.copy_fail */ "Kopiointi epäonnistui — valitse alla oleva teksti ja kopioi käsin",
  /* bug.redacted */ "Verkon nimi, osoitteet sekä välittäjän ja palvelimien nimet on jo poistettu.",
  /* nav.settings */ "Asetukset",
  /* nav.back */ "Takaisin",
  /* nav.settings_alert */ (n) => `Asetukset — ${n} ${n === 1 ? "yhteys" : "yhteyttä"} poikki`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Lähteet täsmäävät",
  /* src.delta */ (d, u) => `Ero ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Lähteiden tilat eivät täsmää",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Etsitään…",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Yhteydet",
  /* conn.offline */ "Ei yhteyttä",
  /* conn.disabled */ "Ei käytössä",
  /* conn.connecting */ "Yhdistetään…",
  /* conn.connected */ "Yhdistetty",
  /* conn.resolving */ "Selvitetään osoitetta…",
  /* conn.eth_no_cable */ "Kaapeli irti",
  /* conn.eth_no_lease */ "Kaapeli kytketty, ei osoitetta",
  /* conn.eth_fd */ "kaksisuuntainen",
  /* conn.enabled */ "Käytössä",
  /* conn.enabled_noping */ "Käytössä, palvelin ei vastaa pingiin",
  /* conn.synced */ "Synkronoitu",
  /* conn.syncing */ "Synkronoidaan…",
  /* conn.error */ (e) => "Virhe: " + e,
  /* conn.connected_to */ (s) => "Yhdistetty kohteeseen " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Muokkaa napauttamalla.`,
  /* modbus.err.mdns_not_found */ "HomeHubia ei löytynyt mDNS:llä.",
  /* modbus.err.no_address */ "HomeHub-osoitetta ei ole määritetty.",
  /* modbus.err.resolve_failed */ "HomeHub-osoitetta ei voitu selvittää.",
  /* modbus.err.connect_timeout */ "Yhteys aikakatkaistiin — HomeHubia ei tavoiteta.",
  /* modbus.err.connection_refused */ "HomeHub vastaa, mutta Modbus TCP -portti on suljettu.",
  /* modbus.err.network_unreachable */ "HomeHubiin ei ole verkkoreittiä.",
  /* modbus.err.host_unreachable */ "HomeHubia ei tavoiteta verkossa.",
  /* modbus.err.connect_failed */ "Yhteys HomeHubiin epäonnistui.",
  /* modbus.err.request_failed */ (r) => `Modbus-pyyntöä ei voitu muodostaa${r ? ` rekisterille ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Modbus-pyynnön lähetys aikakatkaistiin${r ? ` rekisterissä ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `Modbus-pyyntöä ei voitu lähettää${r ? ` rekisterissä ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `HomeHub-vastaus aikakatkaistiin${r ? ` rekisterissä ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `HomeHub sulki yhteyden${r ? ` rekisterissä ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `HomeHub-vastausta ei voitu lukea${r ? ` rekisterissä ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Virheellinen Modbus-vastaus${r ? ` rekisterissä ${r}` : ""}.`,
  /* modbus.err.internal_error */ "Modbus-kysely epäonnistui sisäisesti.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub hylkäsi rekisterin ${r || "?"} (poikkeus ${n}: ${why}).`,
  /* modbus.exc.1 */ "kielletty toiminto",
  /* modbus.exc.2 */ "kielletty dataosoite",
  /* modbus.exc.3 */ "kielletty data-arvo",
  /* modbus.exc.4 */ "laitevika",
  /* modbus.exc.5 */ "pyyntö kuitattu",
  /* modbus.exc.6 */ "laite varattu",
  /* modbus.exc.8 */ "muistin pariteettivirhe",
  /* modbus.exc.10 */ "yhdyskäytävän reitti ei käytettävissä",
  /* modbus.exc.11 */ "kohde ei vastannut",
  /* modbus.exc.unknown */ "tuntematon syy",
  /* card.model */ "Malli",
  /* card.hplink */ "Lämpöpumppuyhteys",
  /* card.online */ "Yhteydessä",
  /* card.uptime */ "Käyntiaika",
  /* card.freeheap */ "Vapaa muisti",
  /* card.maxalloc */ "Suurin vapaa lohko",
  /* card.offline */ "Ei yhteyttä",
  /* card.protocol */ "Protokolla",
  /* card.rxpin */ "RX-nasta",
  /* card.txpin */ "TX-nasta",
  /* card.capacity */ "Teho",
  /* card.hplink_help */ "Näyttää, saako ESP32 parhaillaan kelvollisia X10A-vastauksia lämpöpumpulta.",
  /* card.protocol_help */ "X10A-I ja X10A-S ovat tuetut huoltoliitännän kehysmuodot. Laiteohjelmisto tunnistaa muodon kelvollisista vastauksista.",
  /* card.rxpin_help */ "GPIO, jolla ESP32 vastaanottaa X10A-dataa lämpöpumpulta. Yhteyden ollessa poikki valittu nastapari käynnistää uuden automaattisen tunnistuksen.",
  /* card.txpin_help */ "GPIO, jolla ESP32 lähettää X10A-pyyntöjä. RX:n ja TX:n on oltava eri nastoissa ja vastattava kytkentää.",
  /* card.capacity_iu */ "Teho (sisäyksikkö)",
  /* card.candidates */ "Mahdolliset mallit",
  /* card.oueeprom */ "Ulkoyksikön tunnus",
  /* card.checkup */ "Laitteiston diagnostiikka · 24 h",
  /* service.title */ "Kylmäainepiiri lämmityksen aikana",
  /* service.state.waiting */ "ODOTTAA LÄMMITYSTÄ",
  /* service.state.observing */ "TALLENTAA",
  /* service.state.limited */ "TALLENTAA · TIETOJA PUUTTUU",
  /* service.state.interrupted */ "TAUOLLA",
  /* service.row.window */ "Tallennettu tähän asti",
  /* service.row.reason */ "Miksi tämä tila?",
  /* service.reason.unsupported_profile */ "Tämä malli ei tarjoa kaikkia tarvittavia mittauksia.",
  /* service.reason.compressor_not_running */ "Kompressori ei käy.",
  /* service.reason.unsupported_or_unknown_mode */ "Lämpöpumppu ei ole tavallisessa tilalämmityksessä tai käyttötilaa ei voida lukea.",
  /* service.reason.dhw_path */ "Lämpöpumppu lämmittää käyttövettä.",
  /* service.reason.defrost */ "Ulkoyksikköä sulatetaan.",
  /* service.reason.unit_fault */ "Lämpöpumppu ilmoittaa viasta.",
  /* service.reason.special_controller_phase */ "Lyhyt käynnistys- tai erityinen säätövaihe on aktiivinen.",
  /* service.reason.missing_fresh_signal */ "Vähintään yksi tarvittava nykyinen mittaus puuttuu.",
  /* service.reason.poll_gap */ "X10A-yhteys katkesi tai keskeytettiin tarkoituksella.",
  /* service.window */ (d, n) => `${d} · ${n} nykyistä mittausta`,
  /* service.help.observing */ "Mittauksia tallennetaan nyt jatkuvasti tavallisen lämmityksen aikana.",
  /* service.help.limited */ "Tallennus on käynnissä, mutta joitakin lisävertailuarvoja puuttuu.",
  /* service.help.interrupted */ "Tallennus päättyi ja käynnistyy automaattisesti seuraavan sopivan lämmityksen aikana.",
  /* service.common */ "Tuetuissa malleissa käynnistyy automaattisesti tavallisessa lämmityksessä; ilman huoltotilaa tai asetusmuutosta. Ei arvioi kylmäainetta tai normaalialuetta. Venttiiliarvo: komento, ei mitattu asento.",
  /* check.fault */ "Yksikön vika",
  /* check.dhw_loss */ "Käyttövesisäiliön lämpöhäviö",
  /* check.cycling */ "Kompressorin käynnistykset",
  /* check.defrost */ "Sulatusjaksot",
  /* check.pressure */ "Alin vedenpaine",
  /* check.flow */ "Alin virtaama",
  /* check.heater */ "Varalämmitin",
  /* check.retries */ "Suojauksen uusintayritykset",
  /* check.status.ok */ "OK",
  /* check.status.info */ "HUOMIO",
  /* check.status.warn */ "VAROITUS",
  /* check.status.collecting */ "TARKISTETAAN",
  /* check.status.observation */ "VAIN MITTAUS",
  /* check.status.experimental */ "KOKEELLINEN",
  /* check.status.unavailable */ "EI SAATAVILLA",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · arvioitu ${n}/${a}` : s,
  /* check.detail.value_label */ "Arvo:",
  /* check.detail.assessment_label */ "Arvio:",
  /* check.detail.ok */ "Arvio valmis; havaituissa laitetiedoissa ei löydöstä.",
  /* check.detail.info */ "Hyvä tietää, mutta ei todiste viasta. Huomionarvoinen alue on alla kohdassa “Normaali”.",
  /* check.detail.warn */ "Laitelöydös tai dokumentoitu raja vaatii huomiota.",
  /* check.detail.fault.error */ "Yksikkö ilmoittaa parhaillaan virheestä. Tarkka koodi näkyy Toiminta-kortissa.",
  /* check.detail.fault.warning */ "Yksikkö ilmoittaa parhaillaan varoituksesta, ei virheestä. Tarkka koodi näkyy Toiminta-kortissa.",
  /* check.detail.fault.past */ "Nyt ei ole ilmoitusta. Viesti ilmeni viimeisen 24 tunnin aikana ja poistui itsestään, joten rivi ei ole OK. Poistunut viesti ei vaadi toimia; jos se toistuu, kirjaa ajankohta.",
  /* check.detail.fault.past_unknown */ "Viesti ilmeni viimeisen 24 tunnin aikana. Nykytilaa ei voida lukea, koska vikarivi ei vastaa — tarkista X10A-yhteys.",
  /* check.detail.collecting */ (n, r) => `Tallennettu ${n}/${r}; arviota ei voi vielä tehdä.`,
  /* check.detail.cycling_split */ " Tässä arvioidaan vain vahvistettu tilalämmitys. Käyttövesijaksoilla on eri ehdot ja tunnistettu jäähdytys jätetään pois. Koko jakson ajan 3WV:n ja tilapiirin I/U-toimintatilan on oltava luettavissa ja muuttumattomia. Muut jaksot jäävät luokittelematta ja arvioimatta.",
  /* check.detail.cycling_pooled */ " Kaikki jaksot arvioidaan yhdessä, koska luokittelunäyttö ei riittänyt: tulo oli liian harva, luokiteltuja jaksoja oli alle 12 tai yli 10 % valmiista jaksoista jäi luokittelematta. Käyttövesi tai jäähdytys voi siksi peittää lyhyet lämmitysjaksot. Luokkaluvut ovat havaintoja, eivät päätöksen peruste.",
  /* check.detail.outdoor_cycling */ " X10A-ulkoluvut sisältävät vain valmiiden, johdonmukaisesti tilalämmitykseksi luokiteltujen jaksojen tuoreet näytteet. Ne ovat taustatietoa eivätkä muuta rajaa tai arviota.",
  /* check.detail.outdoor_defrost */ " X10A-ulkoluvut sisältävät vain tuoreet näytteet, kun sulatus- ja kompressoritila olivat luettavissa ja kompressori kävi. Ne ovat taustatietoa eivätkä muuta rajaa tai arviota.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n}/${r} ${n === 1 ? "puhdas tunnin ikkuna valmis" : "puhdasta tunnin ikkunaa valmiina"}; nykyinen ikkuna ${c}/${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n}/${r} ${n === 1 ? "puhdas tunnin ikkuna valmis" : "puhdasta tunnin ikkunaa valmiina"}; säiliön lataus tai BSH havaittu, tasaantumista jäljellä ${s}.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n}/${r} ${n === 1 ? "puhdas tunnin ikkuna valmis" : "puhdasta tunnin ikkunaa valmiina"}; yhtään kokonaista ikkunaa ei vielä ole.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n === 1 ? "1 ehdokasikkuna" : `${n} ehdokasikkunaa`} hylätty (${reasons}); pisin ${best}/60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `Ei arvioitavissa tällä menetelmällä: 24 tunnissa ei valmistunut yhtään puhdasta tunnin ikkunaa ja ${n === 1 ? "1 ehdokasikkuna" : `${n} ehdokasikkunaa`} hylättiin (${reasons}); pisin oli ${best}/60 min. Säiliön lataus vaatii 105 häiriötöntä minuuttia (45 min tasaantumista + 60 min ikkuna). Vedenotto, pumppu, lukukelvoton data tai vedenotolta näyttävä nopea jatkuva lämpöhäviö voi estää ikkunan. Tallennetut summat eivät osoita pääsyytä, joten nopeaa jatkuvaa lämpöhäviötä ei voi sulkea pois.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `Ei arvioitavissa: 24 tunnissa ei valmistunut yhtään puhdasta tunnin ikkunaa ja ${n === 1 ? "ainoa ehdokasikkuna" : `kaikki ${n} ehdokasikkunaa`} hylättiin, koska X10A lakkasi vastaamasta kesken ikkunan; pisin oli ${best}/60 min. Vika on yhteydessä, ei laitteistossa — tarkista X10A-johdotus ja RX/TX-nastat.`,
  /* check.detail.dhw_reason.charge */ "säiliön lataus",
  /* check.detail.dhw_reason.pump */ "sisäinen pumppu",
  /* check.detail.dhw_reason.draw */ "vedenottoa muistuttava lasku",
  /* check.detail.dhw_reason.reading */ "epäuskottava R5T",
  /* check.detail.dhw_reason.blind */ "X10A ei vastaa",
  /* check.detail.collecting_unknown */ "Arvioon kelpaavaa näyttöä ei ole vielä tarpeeksi.",
  /* check.detail.observation */ "Vain mitattu arvo; yleistä OK/VAROITUS-rajaa ei ole.",
  /* check.detail.experimental */ "Kokeellinen havainto; vakaa laskuri ei todista, ettei rajoitusta tapahtunut.",
  /* check.detail.unavailable */ "Aktiivinen profiili ei anna arvioitavaa dataa tähän tarkistukseen.",
  /* check.starts */ (n) => `${n} käynnistys${n === 1 ? "" : "tä"}`,
  /* check.cycles */ (n) => `${n} jakso${n === 1 ? "" : "a"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "paritettu" : "paritettua"}`,
  /* check.mean */ (d) => `${d}/käynnistys`,
  /* check.cycling_space */ (n, d) => d ? `tilalämmitys ${n} × ${d}` : `tilalämmitys ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `käyttövesi ${n} × ${d}` : `käyttövesi ${n}`,
  /* check.cycling_cooling */ (n) => `${n} ${n === 1 ? "jäähdytysjakso" : "jäähdytysjaksoa"} jätetty pois`,
  /* check.cycling_censored */ (n) => `${n} ${n === 1 ? "luokittelematon" : "luokittelematonta"}`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min ${min} °C · keskiarvo ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `säiliö ${m} min`,
  /* check.tank_runtime */ (d) => `säiliö ${d}`,
  /* check.loss_windows */ (n) => `${n} ikkuna${n === 1 ? "" : "a"}`,
  /* check.loss_pump_off */ "myös kiertovesipumpun ollessa pois",
  /* check.loss_with_pump */ "kiertovesipumpun käydessä",
  /* check.loss_unattributed */ "pumppukohdistus puutteellinen",
  /* check.fault_err */ "Vika aktiivinen",
  /* check.fault_warn */ "Varoitus aktiivinen",
  /* check.fault_past */ "Ilmeni viimeisen 24 h aikana · ei nyt aktiivinen",
  /* check.fault_none */ "Ei aktiivisia",
  /* check.fault_unknown */ "Nykytila tuntematon",
  /* check.fault_past_unknown */ "Ilmeni viimeisen 24 h aikana · nykytila tuntematon",
  /* check.retry_seen */ "Laskurin nousu havaittu",
  /* check.retry_none */ "Nousua ei havaittu",
  /* values.waiting */ "Odotetaan ensimmäistä kyselyä…",
  /* values.sg_x10a_mode */ "Smart-Grid-tila (X10A-koskettimet)",
  /* group.Operation */ "Toiminta",
  /* group.Domestic hot water */ "Käyttövesi",
  /* group.Water circuit */ "Vesipiiri",
  /* group.Refrigerant / outdoor */ "Kylmäaine / ulkoyksikkö",
  /* group.Electrical */ "Sähkö",
  /* group.Device */ "Laite",
  /* group.Other values */ "Muut arvot",
  /* group.Protection */ "Suojaus",
  /* protect.limiting */ "rajoittaa nyt",
  /* group.Values */ "Arvot",
  /* state.on */ "PÄÄLLÄ",
  /* state.off */ "POIS",
  /* enum.auto */ "Automaattinen",
  /* enum.heating */ "Lämmitys",
  /* enum.cooling */ "Jäähdytys",
  /* enum.no_error */ "Ei virhettä",
  /* enum.fault */ "Vika",
  /* enum.warning */ "Varoitus",
  /* enum.space_heating */ "Tilalämmitys",
  /* enum.dhw */ "Käyttövesi",
  /* enum.free_running */ "Vapaa käyttö",
  /* enum.forced_off */ "Pakotettu pois",
  /* enum.recommended_on */ "Käyttöä suositellaan",
  /* enum.forced_on */ "Pakotettu päälle",
  /* enum.unknown */ (n) => `Tuntematon (${n})`,
  /* chip.space_on */ "Piiri PÄÄLLÄ",
  /* chip.space_off */ "Piiri POIS",
  /* chip.quiet */ "Hiljainen",
  /* schem.sg_boost */ "TEHOSTUS",
  /* sg.mode0 */ "Vapaa käyttö",
  /* sg.mode1 */ "Pakotettu pois",
  /* sg.mode2 */ "Käyttöä suositellaan",
  /* sg.mode3 */ "Pakotettu päälle",
  /* schem.to_dhw */ "3WV → käyttövesi",
  /* schem.to_space */ "3WV → tilat",
  /* normal.label */ "Normaali:",
  /* meaning.label */ "Tulkinta:",
  /* hist.title */ "Viimeiset 24 tuntia",
  /* hist.recorded */ (h) => `Tallennettu · ${h} h`,
  /* hist.now */ "nyt",
  /* hist.ago */ (h) => `${h} h sitten`,
  /* hist.loading */ "Ladataan käyrää…",
  /* hist.none */ "Mittauksia ei ole vielä tallennettu.",
  /* hist.err */ "Käyrä ei ole saatavilla.",
  /* hist.gaps */ (n) => `${n} katko${n === 1 ? "" : "a"} — ei mitattu`,
  /* hist.nm */ "ei mitattu",
  /* hist.rel */ (h) => `${h} h sitten`,
  /* hist.held */ "ulkoyksikkö levossa",
  /* hist.heldnote */ (h) => `${h} h levossa — ei mitattu`,
  /* hist.forecast */ "Open-Meteo · ennuste",
  /* hist.in_hours */ (h) => `${h} h kuluttua`,
  /* hist.aria */ (l) => `${l} — 24 tunnin käyrä. Nuolinäppäimet lukevat yksittäiset näytteet.`,
  /* hist.aria_pinned */ (l, r) => `${l} — 24 tunnin käyrä. Kiinnitetty arvo: ${r}. Poista napauttamalla uudelleen.`,
  /* hist.pin_hint */ "kiinnitä napauttamalla",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} h`,
  /* hist.duration_hm */ (h, m) => `${h} h ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · noin ${d}`,
  /* hist.state_active */ "Aktiivinen",
  /* hist.state_off */ "Pois",
  /* val.since */ (d) => `${d} ajan`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} siitä havaitsematta`,
  /* hist.modbus_plateau */ (when, d) => `rekisteri muuttumaton ${when} · noin ${d} · mittauksen ikä tuntematon`,
  /* hist.boost_total */ (d) => `Tehostus aktiivinen · ${d}`,
  /* hist.boost_none */ "Tallennusjaksolla ei tehostusta.",
  /* hist.boost_ago_range */ (a, b) => `${a}–${b} h sitten`,
  /* hist.boost_active */ "Tehostus aktiivinen",
  /* hist.boost_inactive */ "Tehostus pois",
  /* hist.boost_aria */ (l, d) => `${l} — Smart-Gridin neljän tilan aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.defrost_total */ (d) => `Sulatus havaittu aktiivisena · ${d} näyteaikaa`,
  /* hist.defrost_none */ "Tallennusjaksolla ei havaittu sulatusta.",
  /* hist.defrost_active */ "Sulatus aktiivinen",
  /* hist.defrost_inactive */ "Sulatus pois",
  /* hist.defrost_aria */ (l, d) => `${l} — sulatuksen aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.quiet_total */ (d) => `Hiljainen tila havaittu aktiivisena · ${d} näyteaikaa`,
  /* hist.quiet_none */ "Tallennusjaksolla ei havaittu hiljaista tilaa.",
  /* hist.quiet_active */ "Hiljainen tila aktiivinen",
  /* hist.quiet_inactive */ "Hiljainen tila pois",
  /* hist.quiet_aria */ (l, d) => `${l} — hiljaisen tilan aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.heater_total */ (d) => `Säiliövastus havaittu aktiivisena · ${d} näyteaikaa`,
  /* hist.heater_none */ "Tallennusjaksolla ei havaittu säiliövastuksen käyttöä.",
  /* hist.heater_active */ "Vastus aktiivinen",
  /* hist.heater_inactive */ "Vastus pois",
  /* hist.heater_aria */ (l, d) => `${l} — säiliövastuksen aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.preheat_total */ (d) => `Säiliön esilämmitys havaittu · ${d} näyteaikaa`,
  /* hist.preheat_none */ "Tallennusjaksolla ei havaittu säiliön esilämmitystä.",
  /* hist.preheat_active */ "Säiliön esilämmitys aktiivinen",
  /* hist.preheat_inactive */ "Säiliön esilämmitys pois",
  /* hist.preheat_aria */ (l, d) => `${l} — X10A-säiliön esilämmityksen aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.disinfection_total */ (d) => `Desinfiointi havaittu aktiivisena · ${d} näyteaikaa`,
  /* hist.disinfection_none */ "Tallennusjaksolla ei havaittu desinfiointia.",
  /* hist.disinfection_active */ "Desinfiointi aktiivinen",
  /* hist.disinfection_inactive */ "Desinfiointi pois",
  /* hist.disinfection_aria */ (l, d) => `${l} — HomeHub-desinfioinnin aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.buh_total */ (d) => `Varalämmitin havaittu aktiivisena · ${d} näyteaikaa`,
  /* hist.buh_none */ "Tallennusjaksolla ei havaittu varalämmittimen käyttöä.",
  /* hist.buh_active */ "Varalämmitin aktiivinen",
  /* hist.buh_inactive */ "Varalämmitin pois",
  /* hist.buh_step1 */ "Porras 1",
  /* hist.buh_step2 */ "Porras 2",
  /* hist.buh_aria */ (l, d) => `${l} — varalämmittimen aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.valve_dhw_total */ (d) => `Käyttövesi · ${d}`,
  /* hist.valve_space_total */ (d) => `Tilapiiri · ${d}`,
  /* hist.valve_none */ "Tallennusjaksolla ei käyttövesiasentoa.",
  /* hist.valve_dhw */ "Käyttövesi",
  /* hist.valve_space */ "Tilapiiri",
  /* hist.valve_aria */ (l, d) => `${l} — 3-tieventtiilin aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.circ_total */ (d) => `Pumppu havaittu käynnissä · ${d} näyteaikaa`,
  /* hist.circ_none */ "Tallennusjaksolla ei havaittu pumpun käyntiä.",
  /* hist.circ_on */ "Käynnissä",
  /* hist.circ_off */ "Pysähtynyt",
  /* hist.circ_unavailable */ "Ei saatavilla",
  /* hist.circ_gaps */ (n) => `${n} jakso${n === 1 ? "" : "a"} ilman tietoa`,
  /* hist.circ_aria */ (l, d) => `${l} — kiertovesipumpun aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.valve2_on_total */ (d) => `2WV-lähtö PÄÄLLÄ · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV-lähtö POIS · ${d}`,
  /* hist.valve2_on */ "2WV-lähtö PÄÄLLÄ",
  /* hist.valve2_off */ "2WV-lähtö POIS",
  /* hist.valve2_none */ "Valitulla jaksolla ei tallennettu 2-tieventtiilin PÄÄLLÄ-tilaa.",
  /* hist.valve2_aria */ (l, d) => `${l} — 2-tieventtiilin lähdön aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* hist.flow_switch_total */ (d) => `X10A-tila PÄÄLLÄ · ${d} näyteaikaa`,
  /* hist.flow_switch_on */ "X10A-tila PÄÄLLÄ",
  /* hist.flow_switch_off */ "X10A-tila POIS",
  /* hist.flow_switch_none */ "Valitulla jaksolla ei tallennettu tämän X10A-tilan PÄÄLLÄ-tilaa.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — virtauskytkimen aikajana. ${d}. Nuolinäppäimet lukevat näytteet.`,
  /* toast.saved */ "Tallennettu",
  /* toast.no_changes */ "Ei muutoksia",
  /* toast.reboot */ "Käynnistetään uudelleen — yhdistetään…",
  /* toast.rebooted */ "Käynnistetty uudelleen — yhdistä laitteeseen",
  /* toast.busy_retry */ "Laite varattu — yritä hetken kuluttua",
  /* toast.unreachable */ "Laitetta ei tavoiteta",
  /* toast.rejected */ "Hylätty",
  /* toast.applying */ "Edellistä muutosta toteutetaan yhä…",
  /* toast.check_wifi */ "Tarkista WiFi-asetukset",
  /* toast.check_broker */ "Tarkista välittäjän osoite",
  /* toast.check_syslog_port */ "Tarkista syslog-portti",
  /* toast.verifying_mqtt */ "Tarkistetaan MQTT-yhteyttä…",
  /* toast.saving_syslog */ "Tallennetaan syslog-asetuksia…",
  /* toast.saving_ntp */ "Tallennetaan NTP-asetuksia…",
  /* toast.trying_pins */ "Kokeillaan nastoja…",
  /* toast.saving_board */ "Tallennetaan laitteistoasetuksia…",
  /* ota.uptodate */ "ajan tasalla",
  /* ota.check_failed */ "tarkistus epäonnistui",
  /* ota.starting */ "käynnistetään…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "käynnistetään uudelleen…",
  /* ota.failed */ "päivitys epäonnistui",
  /* ota.timeout */ "aikakatkaistu",
  /* ota.cancelled */ "peruttu",
  /* ota.busy */ "laite varattu",
  /* ota.replaced */ "päivitystoiminto muuttui — tarkista uudelleen",
  /* ota.unreachable */ "laitetta ei tavoiteta",
  /* ota.active_title */ "Laiteohjelmiston päivitys",
  /* ota.active_sub */ (detail) => `Asennus käynnissä · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Asennus käynnissä · ${detail} · viimeksi vastaanotettu tila`,
  /* ota.snapshot_title */ "Laiteohjelmiston päivitys",
  /* ota.snapshot_label */ "Datan tila",
  /* ota.snapshot_value */ "Tilannekuva",
  /* ota.snapshot_help */ "Viimeksi vastaanotettu tila ennen uudelleenlatausta. Reaaliaikainen data voi keskeytyä asennuksessa; asetukset pysyvät lukittuina uudelleenkäynnistykseen asti.",
  /* ota.reload_hint */ "asennettu — lataa sivu uudelleen",
  /* ota.dialog_title */ "Laiteohjelmistopäivitys",
  /* ota.switch_title */ "Vaihda laiteohjelmistoversiota",
  /* ota.changes_title */ "Tämän koontiversion uudistukset",
  /* ota.no_changes */ "Tälle koontiversiolle ei toimitettu muutoslokia.",
  /* ota.install_help */ "Laite lataa ja asentaa allekirjoitetun levykuvan ja käynnistyy uudelleen. Jos uusi laiteohjelmisto ei pääse verkkoon, laite palauttaa nykyisen koontiversion automaattisesti.",
  /* ota.switch_help */ "Tämä koontiversio on vanhempi, koska toinen päivityskanava on valittu. Sen allekirjoitus tarkistetaan ennen asennusta. Jos vanhempi versio ei pääse verkkoon, laite palauttaa nykyisen koontiversion automaattisesti.",
  /* ota.install */ "Asenna päivitys",
  /* ota.switch */ "Asenna vanhempi koontiversio",
  /* aria.ota */ "Tarkista laiteohjelmistopäivitykset",
  /* ota.title_check */ "Tarkista päivitykset napauttamalla",
  /* ota.title_avail */ (v) => `Päivitys v${v} saatavilla — asenna napauttamalla`,
  /* mq.err_format */ "Anna palvelin:portti — esim. 192.168.1.10:1883 — tai TLS:lle mqtts://host:8883",
  /* sl.err_port */ "Portin on oltava kokonaisluku 1–65535 (esim. logs.example.com:514).",
  /* btn.saving */ "Tallennetaan…",
  /* btn.verifying */ "Tarkistetaan…",
  /* btn.save */ "Tallenna",
  /* btn.cancel */ "Peruuta",
  /* btn.close */ "Sulje",
  /* schem.card_aria */ "Järjestelmän reaaliaikainen kaavio: ulkoyksikkö, kylmäainepiiri, levylämmönvaihdin, varalämmittimellä ja 3-tieventtiilillä varustettu vesipiiri, lämminvesivaraaja ja huonepiiri",
  /* schem.group_aria */ "Järjestelmän reaaliaikainen kaavio — valitse arvo tai osa saadaksesi selityksen",
  /* schem.outdoor_unit */ "ULKOYKSIKKÖ",
  /* schem.defrost_pill */ "❄ sulatus",
  /* schem.outdoor */ "Ulkoilma",
  /* insp.close */ "Sulje",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "DHW-SÄILIÖ",
  /* schem.set */ "asetus",
  /* schem.bsh_label */ "Sähkövastus",
  /* schem.space_circuit */ "TILAPIIRI",
  /* schem.heating */ "LÄMMITYS",
  /* schem.cooling */ "JÄÄHDYTYS",
  /* schem.pump */ "PUMPPU",
  /* schem.return */ "R4T",
  /* schem.room */ "Huone",
  /* schem.flow_rate */ "virtaama",
  /* schem.water_press */ "vedenpaine",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "VIRTAUSK.",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "WiFi-asetukset",
  /* wifi.ssid */ "WiFi-verkko (SSID)",
  /* wifi.pass */ "WiFi-salasana",
  /* wifi.err_ssid */ "SSID saa olla enintään 32 merkkiä",
  /* wifi.err_pass */ "Salasanan on oltava tyhjä (avoin verkko) tai 8–63 merkkiä",
  /* wifi.hint */ "Anna WiFi-verkon nimi. Jos yhteys ei onnistu, laite palauttaa aiemmat WiFi-asetukset automaattisesti.",
  /* mqtt.title */ "MQTT-välittäjä",
  /* mqtt.hostport */ "Palvelin : portti",
  /* mqtt.user */ "Käyttäjänimi · valinnainen",
  /* mqtt.pass */ "Salasana · valinnainen",
  /* mqtt.clear */ "Poista tallennetut tunnukset — yhdistä anonyymisti",
  /* mqtt.hint */ "Käyttäjänimi tai salasana vaatii salatun TLS-yhteyden (mqtts://, esim. mqtts://host:8883). Tyhjä palvelin poistaa MQTT:n käytöstä.",
  /* mqtt.base */ "Perusaihe",
  /* mqtt.base_hint */ "Jokaisella laitteella on oltava oma perusaihe. Toinen laite samalla välittäjällä tarvitsee oman, muuten ne jakavat aiheet, mittarit ja Home Assistant -laitteen. Muutos nimeää asennuksen uudelleen Home Assistantissa ja jättää vanhat säilytetyt aiheet välittäjälle.",
  /* err.mqtt_base_too_long */ "Perusaihe on liian pitkä.",
  /* err.mqtt_base_wildcard */ "Perusaihe ei saa sisältää merkkejä + tai #. Ne ovat tilauksen jokerimerkkejä, eikä välittäjä julkaise niihin.",
  /* err.mqtt_base_reserved */ "Perusaihe ei saa alkaa merkillä $, sillä se alue kuuluu välittäjälle.",
  /* err.mqtt_base_slash */ "Perusaihe ei saa alkaa tai päättyä vinoviivaan.",
  /* err.mqtt_base_control */ "Perusaihe ei saa sisältää ohjausmerkkejä.",
  /* err.mqtt_base_space */ "Perusaihe ei saa sisältää välilyöntejä.",
  /* err.mqtt_base_empty_segment */ "Perusaihe ei saa sisältää tyhjää osaa (//).",
  /* err.mqtt_base_not_sluggable */ "Perusaihe tarvitsee vähintään yhden kirjaimen tai numeron. Siitä muodostuu Home Assistant -laitetunnus, jota ilman laitteet törmäävät.",
  /* mqtt.err.waiting_x10a */ "X10A ei ole vielä vastannut. Tarkista johdotus, GND sekä RX/TX-nastat.",
  /* mqtt.err.task_alloc */ "MQTT-tehtävä ei käynnistynyt. Käynnistä laite uudelleen ja tarkista diagnostiikka.",
  /* mqtt.err.transport */ "TLS/TCP-yhteys välittäjään epäonnistui.",
  /* mqtt.err.refused */ "Välittäjä torjui yhteyden. Tarkista käyttäjätunnus ja salasana.",
  /* mqtt.err.connection */ "Yhteys MQTT-välittäjään epäonnistui.",
  /* dyn.card */ "Lämmityskäyrän diagnostiikka",
  /* dyn.state */ "Tila",
  /* dyn.state_recording */ "Tallentaa",
  /* dyn.state_recording_nowx */ "Tallentaa · ei ennustetta",
  /* dyn.state_waiting */ "Odottaa tilalämmitystä",
  /* dyn.state_cooling */ "Jäähdytys · ei näytettä",
  /* dyn.state_room */ "Huonelähde ei kelpaa",
  /* dyn.state_x10a */ "X10A ei verkossa",
  /* dyn.state_homehub */ "HomeHub ei verkossa",
  /* dyn.state_gate */ "Laitteiston tila tuntematon",
  /* dyn.state_mode */ "Lämmitys-/jäähdytystila tuntematon",
  /* dyn.state_clock */ "Kelloa ei asetettu",
  /* dyn.state_blocked */ "Ei tallenna",
  /* dyn.state_setup_room */ "Määritä huonelähde",
  /* dyn.state_setup_homehub */ "HomeHubia ei määritetty",
  /* dyn.state_homehub_disabled */ "Diagnostiikka pois · HomeHub poistettu",
  /* dyn.state_no_broker */ "Ei tallenna · ei MQTT-välittäjää",
  /* dyn.state_safe_mode */ "Ei tallenna · vikasietotila",
  /* dyn.state_inactive */ "Ei tallenna · näytteenotto ei käy",
  /* dyn.room_off */ "Huonetermostaatti pois päältä",
  /* dyn.room_not_heating */ "Huonetermostaatti ei ole lämmitystilassa",
  /* dyn.room_stale */ "Huonelukema on liian vanha",
  /* dyn.room_no_value */ "Odottaa huonelukemaa",
  /* dyn.room_invalid_payload */ "Virheellinen MQTT-viesti",
  /* dyn.room_invalid_temperature */ "Huonelämpötila ei ole sallitulla alueella",
  /* dyn.room_invalid_setpoint */ "Tavoitelämpötila ei ole sallitulla alueella",
  /* dyn.room_no_setpoint */ "Tavoitelämpötila puuttuu",
  /* dyn.room_no_time */ "Mittausaika puuttuu",
  /* dyn.room_retained_no_time */ "Säilytetty arvo ilman mittausaikaa",
  /* dyn.room_future_time */ "Mittausaika on tulevaisuudessa",
  /* dyn.room_backward_time */ "Mittausaika siirtyi taaksepäin",
  /* dyn.room_invalid_time */ "Virheellinen mittausaika",
  /* dyn.room_no_enabled */ "Termostaatin päällä/pois-tila puuttuu",
  /* dyn.room_no_hvac_mode */ "Termostaatin toimintatila puuttuu",
  /* dyn.room_source */ "Huonelämpötilan lähde",
  /* dyn.weather */ "Valinnainen vertailuennuste",
  /* dyn.strategy */ "Diagnostiikkasignaali",
  /* dyn.not_configured */ "Ei määritetty",
  /* dyn.outdoor */ "Mitattu ulkoilma",
  /* dyn.outdoor_detail_status */ "Tila",
  /* dyn.outdoor_detail_now */ "Nykyinen lukema",
  /* dyn.outdoor_detail_sample */ "Viimeksi tallennetussa tapahtumassa",
  /* dyn.outdoor_status_live */ (source) => `${source} antaa nykyisen lukeman, joka liitetään tapahtumiin taustatiedoksi.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} on määritetty mutta ei anna nykyarvoa. Tapahtumia tallennetaan ilman tätä akselia.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} ei ole määritetty. Tapahtumia tallennetaan ilman tätä akselia.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} on määritetty, mutta tallennus ei ole nyt käynnissä. Syy näkyy yllä.`,
  /* dyn.outdoor_sample_none */ "Tallennettu ilman ulkoarvoa",
  /* dyn.outdoor_help_axis */ "Ulkolämpötila tekee huonepoikkeamasta tulkittavan: +0,5 K lämpötiloissa −5 °C ja +12 °C voi viitata eri käyrävirheisiin. Arvo on valinnainen eikä vaikuta tapahtuman tallennuspäätökseen.",
  /* dyn.outdoor_help_placement */ "Arvo on lämpötila anturin asennuspaikassa. Sisäyksikön vieressä se on huoneilmaa, varjoisassa ulkopaikassa ulkoilmaa. Laiteohjelmisto ei tunne sijoitusta.",
  /* dyn.outdoor_help_setup */ "Kortin Grove-portin M5Stack ENV III voi tuottaa arvon. Varjoon ulos asennettuna se mittaa jatkuvasti, myös ulkoyksikön levätessä. Määritä kohdassa ESP32 → Laitteisto.",
  /* dyn.plant_outdoor */ "Laitteiston ulkoilma",
  /* dyn.plant_outdoor_help */ "HomeHub-tulo 44, lämpöpumpun oma ulkoilmakäsite. Arvo luetaan samassa Modbus-jaksossa kuin lämmitysikkunan ehdot ja lähde tallennetaan. Se pysyy erillään ENV III:sta eikä muuta tallennuspäätöstä.",
  /* dyn.shadow_strategy */ "Raaka huonepoikkeama · 30 min",
  /* dyn.card_help */ "Selvästi tunnistetun tilalämmityksen aikana laite tallentaa 30 minuutin välein vertailuhuoneen lämpötilan eron tavoitteesta sekä saatavilla olevan ulkolämpötilan. Pidempi kehitys yhdessä käyntiajan, menoveden alarajan ja termostaatin kanssa näyttää käyrän suuntaa. 1 K huonepoikkeama ei tarkoita 1 K menovesimuutosta. Toiminto ei ohjaa lämpöpumppua.",
  /* dyn.state_help_recording */ "Tilalämmitys ja kelvollinen huonetulo on vahvistettu, joten raaka huonevirhe tallennetaan. Tulkitse kausisuunta käyntiajan ja rajoitusten kanssa; yksi näyte ei ole johtopäätös.",
  /* dyn.state_help_waiting */ "Laitteisto ei ole nyt normaalissa tilalämmityksessä, joten näytettä ei tallenneta. Kesällä tämä on odotettu tila, ei vika.",
  /* dyn.state_help_cooling */ "HomeHub ilmoittaa normaalin tilakäytön, mutta tila on jäähdytys. Jäähdytysikkunat jätetään lämmityskäyräaineiston ulkopuolelle.",
  /* dyn.state_help_blocked */ "Tarvittava tulo puuttuu, joten mitään ei tallenneta. Tallennus jatkuu tulon palattua; vanhaa tai epäselvää näyttöä ei käytetä.",
  /* dyn.state_help_room */ "Huonelukema saapuu, mutta siitä ei nyt saada kelvollista poikkeamaa tavoitteesta. Näytettä ei muodosteta ennen kuin lähde kelpaa.",
  /* dyn.state_help_setup */ "Diagnostiikka alkaa, kun aikaleimallinen MQTT-huonelähde ja tavoite tallennetaan. Ennuste on valinnainen vertailu; sijaintia ei tarvitse luovuttaa.",
  /* dyn.state_help_inactive */ "Lähteet on määritetty, mutta niitä ei arvioida. Näytteenotto toimii MQTT-yhteydessä, ja toistuvien kaatumisten vikasietotila pysäyttää valinnaiset kuluttajat. Tallennus jatkuu normaalin käynnistyksen jälkeen.",
  /* dyn.state_help_no_broker */ "Huonelähde on tallennettu, mutta MQTT-välittäjää ei ole määritetty. Määritä se Yhteydet-kortissa; lähde säilyy ja tallennus alkaa automaattisesti.",
  /* dyn.state_help_setup_homehub */ "HomeHub tarvitaan todellisen tilalämmityksen erottamiseen käyttövedestä ja seisokista. Määritä sen osoite Protokolla-kortissa.",
  /* dyn.state_help_homehub_disabled */ "Diagnostiikka riippuu kahdesta HomeHub-signaalista. Tyhjäksi asetettu osoite pysäyttää sekä Modbusin että tämän diagnostiikan.",
  /* dyn.strategy_help */ "Näyte on huonetavoite miinus huonelämpötila: positiivinen tarkoittaa liian kylmää, negatiivinen liian lämmintä. Kuollutta aluetta, pyöristystä tai rajoitusta ei ole. Arvo ei ole kalibroitu menoveden korjaus. Vertailuhuoneen pitää edustaa lämmitettyä aluetta; sen termostaatti tai suljetut venttiilit voivat peittää liian korkean käyrän. Lue kehitys yhdessä menoveden alarajan ja lämmityspyynnön kanssa.",
  /* env.title */ "Ulkoanturi",
  /* env.card */ "Ulkoilmasto",
  /* env.none */ "Ei anturia",
  /* env.temperature */ "Lämpötila",
  /* env.humidity */ "Kosteus",
  /* env.pressure */ "Ilmanpaine",
  /* env.sensor_state */ "Anturi",
  /* env.live */ "Nykyarvo",
  /* env.collecting */ "Kerätään…",
  /* env.history_title */ "ENV III -mittaukset",
  /* env.history_help */ "ESP32 säilyttää lämpötilan, kosteuden ja ilmanpaineen 24 tunnin liukuvina käyrinä viiden minuutin välein.",
  /* env.history_scales */ "erilliset asteikot",
  /* env.unavailable */ "Anturi ei käytettävissä",
  /* env.err_pins */ "SDA:n ja SCL:n on oltava eri kelvollisia nastoja",
  /* env.saving */ "Tallennetaan ulkoanturin asetuksia…",
  /* env.checking */ "Tarkistetaan ENV III…",
  /* env.err_not_reachable */ "ENV III ei vastaa näillä SDA/SCL-nastoilla.",
  /* env.err_sht30 */ "ENV III:n lämpö-/kosteusanturi ei vastaa näillä nastoilla.",
  /* env.err_qmp6988 */ "ENV III:n paineanturi ei vastaa näillä nastoilla.",
  /* env.err_disable_first */ "Valitse Ei anturia ja tallenna ennen SDA/SCL-nastojen vaihtoa.",
  /* env.pins_hint */ "SDA = data (keltainen Grove-johto), SCL = kello (valkoinen). Jos valitut GPIO:t ovat ristiin, laite kokeilee vastakkaisen järjestyksen ja tallentaa toimivan jaon.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: käytä koteloliittimen GPIO5–GPIO8- tai GPIO38-nastoja. Grove-portti GPIO2/1 näkyy vain, jos X10A ei käytä sitä; sama nasta ei voi palvella sarjaliikennettä ja I2C:tä. GPIO39 ei kelpaa ENV III:lle.",
  /* ref.title */ "Huonelämpötilan lähde",
  /* ref.name */ "Nimi",
  /* ref.temperature_source */ "Lämpötilalähde",
  /* ref.target */ "Tavoitelämpötila",
  /* ref.timestamp_source */ "Aikaleiman lähde · valinnainen",
  /* ref.max_age */ "Enimmäisikä · sekuntia",
  /* ref.temperature_source_help */ "Tarkka MQTT-topic ja valinnainen JSON-polku merkin $ jälkeen. Puuttuva tai väärä polku ilmoitetaan viestin saapuessa.",
  /* ref.target_help */ "Kiinteä °C-arvo tai tarkka MQTT-topic valinnaisella $-alkuisella JSON-polulla.",
  /* ref.timestamp_source_help */ "Valinnainen RFC3339-/Unix-lähdeaika muodossa topic$polku. Tyhjä käyttää MQTT-saapumisaikaa; säilytetty arvo hylätään turvallisesti.",
  /* ref.max_age_help */ "Lähdelukeman sallittu enimmäisikä 10–3600 sekuntia.",
  /* ref.error */ "Viimeisin virhe",
  /* ref.broker_off */ "MQTT-välittäjä poistettu käytöstä",
  /* ref.retained */ "välittäjän säilyttämä",
  /* ref.time_untrusted */ "Säilytetty arvo ilman luotettua mittausaikaa",
  /* ref.clock_unsynced */ "Laitteen kelloa ei ole synkronoitu",
  /* ref.now */ "nyt",
  /* ref.ago */ (s) => `${s} s sitten`,
  /* ref.age_unknown */ "tuntematon",
  /* ref.saved */ "Huonelämpötilan lähde tallennettu",
  /* ref.detail.status_label */ "Tila:",
  /* ref.detail.diagnosis_label */ "Lämmityskäyrän diagnostiikka:",
  /* ref.status.measurement_valid */ "Mittaus kelvollinen",
  /* ref.status.not_configured */ "Ei määritetty",
  /* ref.status.usable */ "Käytettävissä",
  /* ref.status.unusable */ "Ei käytettävissä",
  /* ref.status.error */ "Virhe",
  /* ref.status.stale */ "Vanhentunut",
  /* ref.status.waiting */ "Odottaa",
  /* ref.status.unavailable */ "Ei saatavilla",
  /* ref.detail.setup */ "Lisää MQTT-lähde kynästä",
  /* ref.detail.stale */ "Lukema on sallittua vanhempi",
  /* ref.detail.waiting */ "MQTT-lukemaa ei ole vielä saatu",
  /* ref.detail.error */ (e) => `MQTT-viesti hylätty: ${e}`,
  /* ref.detail.temperature_label */ "Huonelämpötila:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Tavoitelämpötila:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Uusin lukema:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · sallittu enintään ${max} s`,
  /* ref.detail.purpose */ "Diagnostiikka vertaa huone- ja tavoitelämpötilaa ja näyttää ajan myötä, onko lämmityskäyrä liian korkea tai matala. Lämpöpumppua ei ohjata.",
  /* ref.delete */ "Poista",
  /* ref.deleting */ "Poistetaan…",
  /* ref.deleted */ "Huonelähde ja saatu lukema poistettu",
  /* circ.title */ "Kiertopumpun lähde",
  /* circ.row */ "Käyttöveden kiertopumppu",
  /* circ.default_name */ "Kiertopumppu",
  /* circ.name */ "Nimi",
  /* circ.topic */ "MQTT-topic",
  /* circ.power_path */ "Tehon JSON-polku",
  /* circ.time_path */ "Ajan JSON-polku",
  /* circ.power_help */ "Todellinen pätöteho watteina; relelähtöä ei käytetä.",
  /* circ.time_help */ "Mittausaika RFC3339-muodossa tai Unix-sekunteina.",
  /* circ.on_threshold */ "Päällä alkaen · W",
  /* circ.off_threshold */ "Pois enintään · W",
  /* circ.max_age */ "Enimmäisikä · sekuntia",
  /* circ.confirm */ "Vahvistus · sekuntia",
  /* circ.hint */ "Vain luku. Tallennus testaa ensin yhden tuoreen MQTT-arvon eikä koskaan kytke pistoketta.",
  /* circ.settings_help */ "Kortti yhdistää pumpun todellisen tehon puhtaisiin tunnin tankkijäähtymisikkunoihin. Se vain tarkkailee eikä kytke pistoketta.",
  /* circ.not_configured */ "Ei määritetty",
  /* circ.unavailable */ "Ei saatavilla",
  /* circ.broker_off */ "Ei MQTT-välittäjää",
  /* circ.running */ "Käynnissä",
  /* circ.stopped */ "Pysähtynyt",
  /* circ.checking */ "Tarkistetaan",
  /* circ.stale */ "Vanhentunut",
  /* circ.waiting */ "Odottaa viestiä",
  /* circ.detail.source */ "Lähde",
  /* circ.detail.power */ "Pätöteho",
  /* circ.detail.state */ "Tunnistettu tila",
  /* circ.detail.age */ "Mittauksen ikä",
  /* circ.delete */ "Poista",
  /* circ.deleting */ "Poistetaan…",
  /* circ.deleted */ "Kiertopumpun lähde poistettu",
  /* circ.saved */ "Kiertopumpun lähde tallennettu",
  /* circ.test_failed */ "Luettavaa tuoretta pumpun tehoarvoa ei saatu",
  /* circ.err_topic */ "Anna tarkka MQTT-topic ilman jokerimerkkejä + tai #",
  /* circ.err_power_path */ "Anna pätötehon JSON-polku, esimerkiksi apower",
  /* circ.err_time_path */ "Anna aikaleiman JSON-polku, esimerkiksi aenergy.minute_ts",
  /* circ.err_max_age */ "Enimmäisiän on oltava kokonaisluku 10–3600 sekuntia",
  /* circ.err_confirm */ "Vahvistuksen on oltava kokonaisluku 1–600 sekuntia",
  /* circ.err_threshold */ "Tehorajoissa saa olla enintään yksi desimaali",
  /* circ.err_order */ "Päällä-rajan on oltava pois-rajaa suurempi",
  /* wx.title */ "Open-Meteo-sääennuste",
  /* wx.latitude */ "Leveysaste",
  /* wx.longitude */ "Pituusaste",
  /* wx.waiting */ "Odottaa ennustetta",
  /* wx.fetching */ "Haetaan Open-Meteo-ennustetta…",
  /* wx.unavailable */ "Ei saatavilla",
  /* wx.error */ "Open-Meteo-ennustevirhe",
  /* wx.detail.status */ "Tila:",
  /* wx.status.fresh */ "Ajantasainen",
  /* wx.status.inactive */ "Pois",
  /* wx.status.fetching */ "Päivitetään",
  /* wx.status.stale */ "Vanhentunut",
  /* wx.status.unavailable */ "Ei saatavilla",
  /* wx.status.waiting */ "Odottaa",
  /* wx.detail.fresh */ "Ennuste haettiin onnistuneesti.",
  /* wx.detail.fetching */ "ESP32 hakee uutta ennustetta.",
  /* wx.detail.stale */ "Viimeisin onnistunut haku on liian vanha; arvot näkyvät vain diagnostiikkaa varten.",
  /* wx.detail.unavailable */ "Viimeisin haku epäonnistui; mahdollinen vanha arvo näkyy vain diagnostiikkaa varten.",
  /* wx.detail.waiting */ "Ennustetta ei ole vielä saatu.",
  /* wx.detail.temperature_label */ "Lämpötila:",
  /* wx.detail.temperature */ (v) => `${v} °C on seuraavan kahden kokonaisen tunnin ulkoilman keskilämpötilaennuste.`,
  /* wx.detail.solar_label */ "Auringonsäteily:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² on saman kahden tunnin vaakasuoran kokonaissäteilyn ennuste.`,
  /* wx.detail.source_label */ "Lähde:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Vain tarkkailu; ennuste ei muuta lämpöpumpun ohjausta.",
  /* wx.err_both */ "Anna sekä leveys- että pituusaste tai jätä molemmat tyhjiksi poistaaksesi käytöstä",
  /* wx.err_latitude */ "Leveysasteen on oltava desimaaliluku väliltä −90…90",
  /* wx.err_longitude */ "Pituusasteen on oltava desimaaliluku väliltä −180…180",
  /* wx.saving */ "Tallennetaan säälähdettä…",
  /* wx.hint.configured */ "ESP32 hakee uuden ennusteen 45 minuutin välein. Jokainen pyyntö lähettää koordinaatit Open-Meteolle ja paljastaa yhteyden julkisen IP-osoitteen. Tyhjennä molemmat koordinaatit poistaaksesi lähteen.",
  /* wx.hint.setup */ "Anna leveys- ja pituusaste. Google Mapsista kopioidun koordinaattiparin voi liittää kumpaan tahansa kenttään. Tallennuksen jälkeen ESP32 lähettää koordinaatit Open-Meteolle 45 minuutin välein ja paljastaa julkisen IP-osoitteen. Ennuste ei ohjaa lämpöpumppua.",
  /* wx.attribution */ "Säätiedot: Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Anna tarkka MQTT-topic ja valinnainen $json-polku",
  /* ref.err_target */ "Anna kiinteä arvo 5–35 °C tai tarkka MQTT-topic ja valinnainen $json-polku",
  /* ref.err_timestamp_source */ "Anna tarkka MQTT-topic ja valinnainen $json-polku",
  /* ref.err_max_age */ "Enimmäisiän on oltava kokonaisluku 10–3600 sekuntia",
  /* ref.save_help */ "Tallennus säilyttää määrityksen. Tilaus on aktiivinen vain Laitteistodiagnostiikan aikana; muuten lähde lepää. Luettava tuore MQTT-arvo tarvitaan silti.",
  /* syslog.title */ "Syslog-palvelin",
  /* syslog.hostport */ "Palvelin : portti",
  /* syslog.hint */ "Anna Syslog-palvelimen nimi tai IP-osoite ja portti. Tyhjä kenttä poistaa Syslogin käytöstä.",
  /* ntp.title */ "NTP-palvelin",
  /* ntp.server */ "Palvelin",
  /* ntp.hint */ "Anna aikapalvelimen nimi tai IP-osoite. Tyhjä käyttää laiteohjelmiston oletusta.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Palvelin · IP tai .local-nimi",
  /* homehub.port */ "Portti",
  /* homehub.unit */ "Yksikkötunnus",
  /* homehub.hint */ "Tuore laiteohjelmisto hakee HomeHubin kerran ensimmäisessä verkkokäynnistyksessä ja tallentaa tuloksen. Haku tai osoitteen syöttö onnistuu myös käsin. Tyhjän osoitteen tallennus poistaa HomeHubin pysyvästi käytöstä: ei automaattihakua, Modbus-pyyntöjä tai riippuvia diagnooseja. Oletusportti on 502 ja yksikkötunnus 1. Ikkuna määrittää vain tietolähteen eikä ohjaa lämpöpumppua.",
  /* hh.search */ "Hae",
  /* hh.searching */ "Haetaan…",
  /* hh.found */ (host) => `HomeHub löytyi: ${host}`,
  /* hh.not_found */ "HomeHubia ei löytynyt. Anna osoite käsin.",
  /* hh.saved */ "Modbus-asetukset tallennettu",
  /* hh.err_port */ "Portin on oltava 1–65535",
  /* hh.err_unit */ "Yksikkötunnuksen on oltava 1–247",
  /* board.title */ "Korttilaitteisto",
  /* board.ledtype */ "Tila-LED",
  /* board.none */ "Ei mitään",
  /* board.reset_section */ "Nollauspainike",
  /* board.env3_section */ "ENV III · Ulkoanturi",
  /* board.preset */ "Kortti",
  /* board.preset_custom */ "Mukautettu",
  /* board.not_selected */ "Ei valittu",
  /* board.led_gpio */ "Tavallinen LED (GPIO)",
  /* board.led_ws2812 */ "Osoitteellinen RGB (WS2812)",
  /* board.ledpin */ "LED-nasta",
  /* board.btnpin */ "Nollauspainikkeen nasta",
  /* board.ledlegend_rgb */ "LED-värit ja vilkkukuviot",
  /* board.ledlegend_gpio */ "LED-vilkkukuviot",
  /* board.led_rgb_off */ "Pois — ei aktiivista Wi-Fi-tilaa.",
  /* board.led_rgb_setup */ "Sininen, hidas vilkku — asetusportaali aktiivinen.",
  /* board.led_rgb_connecting */ "Keltainen, nopea vilkku — yhdistää Wi-Fiin.",
  /* board.led_rgb_healthy */ "Vihreä, jatkuva — kaikki määritetyt yhteydet valmiina.",
  /* board.led_rgb_bus_down */ "Punainen, kaksoisvilkku — X10A irti.",
  /* board.led_rgb_mqtt_down */ "Oranssi, vilkkuu — X10A yhteydessä, MQTT irti.",
  /* board.led_rgb_wipe_armed */ "Punainen, hyvin nopea vilkku — poisto valmiina; vapauta peruuttaaksesi.",
  /* board.led_rgb_wiping */ "Valkoinen, jatkuva — asetuksia poistetaan; älä katkaise virtaa.",
  /* board.led_gpio_off */ "Pois — ei aktiivista Wi-Fi-tilaa.",
  /* board.led_gpio_setup */ "Hidas vilkku — asetusportaali aktiivinen.",
  /* board.led_gpio_connecting */ "Nopea vilkku — yhdistää Wi-Fiin.",
  /* board.led_gpio_healthy */ "Jatkuva — kaikki määritetyt yhteydet valmiina.",
  /* board.led_gpio_bus_down */ "Kaksoisvilkku — X10A irti.",
  /* board.led_gpio_mqtt_down */ "Keskinopea vilkku — X10A yhteydessä, MQTT irti.",
  /* board.led_gpio_wipe_armed */ "Hyvin nopea vilkku — poisto valmiina; vapauta peruuttaaksesi.",
  /* board.led_gpio_wiping */ "Jatkuva erittäin nopean vilkun jälkeen — asetuksia poistetaan; älä katkaise virtaa.",
  /* board.ledinv */ "Aktiivinen LOW (LED palaa nastan ollessa LOW)",
  /* board.btninv */ "Aktiivinen LOW (painike kytkee nastan GND:hen)",
  /* board.hint */ "Poista kaikki asetukset ja avaa asetusportaali pitämällä nollauspainiketta 5 sekuntia. Valitse Ei mitään, jos painiketta ei ole.",
  /* card.hardware */ "Laitteisto",
  /* card.hw_off */ "Ei mitään",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite on pieni ESP32-S3-kortti, jossa on WS2812 RGB -tila-LED.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 on Seeed Studion pieni ESP32-S3-kortti.",
  /* card.hw_board_other */ (name) => `Valittu kortti: ${name}.`,
  /* card.hw_active_low */ "aktiivinen LOW",
  /* card.hw_active_high */ "aktiivinen HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} nastassa GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Ei määritetty.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Ei määritetty.",
  /* card.hw_env_detail */ (sda, scl) => `SDA nastassa GPIO${sda}, SCL nastassa GPIO${scl}.`,
  /* card.hw_env_disabled */ "Ei määritetty.",
  /* card.firmware */ "Versio",
  /* card.channel */ "Päivityskanava",
  /* card.firmware_help */ "ESP32:ssa nyt toimiva versio. Napauta arvoa tarkistaaksesi valitulta kanavalta allekirjoitetun laiteohjelmiston.",
  /* card.channel_help */ "Julkaisu seuraa käsin julkaistuja vakaita versioita, kehitys uusinta laiteohjelmistoon vaikuttavaa yhdistämistä. Kanavan vaihto tarkistaa syötteen heti.",
  /* chan.release */ "Julkaisu",
  /* chan.dev */ "Kehitys",
  /* chan.saved */ (c) => `Päivityskanava: ${c}`,
  /* card.proto_title */ "Protokolla",
  /* card.fw_title */ "Laiteohjelmisto",
  /* settings.diagnostics */ "Laitteistodiagnostiikka",
  /* card.language */ "Kieli",
  /* card.language_help */ "Selain käyttää selaimen kieliasetusta. Kielen valinta tallentaa koko laitteen kiinteän käyttöliittymäkielen.",
  /* card.diagnostics */ "Laitteistodiagnostiikka",
  /* card.diagnostics_help */ "Ottaa käyttöön 24 tunnin tarkastuksen, lämmityskäyrän diagnostiikan sekä huonelämpötilan, sääennusteen ja kiertopumpun tehon kaltaiset lisälähteet.",
  /* diagnostics.off */ "Pois",
  /* diagnostics.on */ "Päällä",
  /* diagnostics.saved_on */ "Laitteistodiagnostiikka käytössä · keruu alkaa nyt",
  /* diagnostics.saved_off */ "Laitteistodiagnostiikka poistettu · keruu pysäytetty",
  /* probe.toggle */ "Protokolladiagnostiikka",
  /* probe.intro */ "Suora X10A-rekisterisivupyyntö ja valinnainen muunninarviointi.",
  /* probe.request */ "Pyyntö",
  /* probe.register */ "Rekisteri",
  /* probe.manual */ "Käsinsyöttö",
  /* probe.page */ "Rekisterisivu",
  /* probe.offset */ "Hyötykuorman siirtymä",
  /* probe.size */ "Kentän leveys",
  /* probe.byte */ "tavu",
  /* probe.bytes */ "tavua",
  /* probe.converter */ "Muunnin",
  /* probe.page_help */ "Heksa tai desimaali · 0…255",
  /* probe.offset_help */ "Hyötykuorman kohta · 0…31",
  /* probe.size_help */ "Purettavat tavut",
  /* probe.converter_auto */ "Automaattinen",
  /* probe.converter_auto_help */ (size) => `Kokeilee jokaista toteutettua muunninta ${size} tavulla.`,
  /* probe.conv_raw_byte */ "raakatavu · 0…255",
  /* probe.conv_unsigned_byte */ "etumerkitön raakatavu",
  /* probe.conv_tenth_byte */ "raakatavu × 0,1",
  /* probe.conv_unsigned_half_byte */ "etumerkitön tavu × 0,5",
  /* probe.conv_signed_raw_le */ "etumerkillinen kokonaisluku · vähiten merkitsevä tavu ensin",
  /* probe.conv_signed_raw_be */ "etumerkillinen kokonaisluku · eniten merkitsevä tavu ensin",
  /* probe.conv_signed_256_le */ "etumerkillinen ÷ 256 · vähiten merkitsevä tavu ensin",
  /* probe.conv_signed_256_be */ "etumerkillinen ÷ 256 · eniten merkitsevä tavu ensin",
  /* probe.conv_signed_tenth_le */ "etumerkillinen × 0,1 · vähiten merkitsevä tavu ensin",
  /* probe.conv_signed_tenth_be */ "etumerkillinen × 0,1 · eniten merkitsevä tavu ensin",
  /* probe.conv_signed_tenth_nodata_le */ "etumerkillinen × 0,1 · vähiten merkitsevä tavu ensin · 0x8000 = ei tietoa",
  /* probe.conv_signed_tenth_nodata_be */ "etumerkillinen × 0,1 · eniten merkitsevä tavu ensin · 0x8000 = ei tietoa",
  /* probe.conv_signed_128_le */ "etumerkillinen ÷ 256 × 2 · vähiten merkitsevä tavu ensin",
  /* probe.conv_signed_128_be */ "etumerkillinen ÷ 256 × 2 · eniten merkitsevä tavu ensin",
  /* probe.conv_signed_half_be */ "etumerkillinen × 0,5 · eniten merkitsevä tavu ensin",
  /* probe.conv_signed_hundredth_be */ "etumerkillinen × 0,01 · eniten merkitsevä tavu ensin",
  /* probe.conv_unsigned_raw_le */ "etumerkitön kokonaisluku · vähiten merkitsevä tavu ensin",
  /* probe.conv_unsigned_raw_be */ "etumerkitön kokonaisluku · eniten merkitsevä tavu ensin",
  /* probe.conv_unsigned_half_be */ "etumerkitön × 0,5 · eniten merkitsevä tavu ensin",
  /* probe.conv_saturation */ "paine → kyllästymislämpötila",
  /* probe.conv_raw_fan */ "raakatavu / puhallinporras",
  /* probe.conv_capacity */ "sisäyksikön teholuokan koodi",
  /* probe.conv_eeprom_digit */ "raaka EEPROM-numero",
  /* probe.conv_eeprom_pair */ "raaka EEPROM-numeropari",
  /* probe.conv_bits_high */ "bitit 4–6 · 3-bittinen laskuri",
  /* probe.conv_bits_low */ "bitit 0–2 · 3-bittinen laskuri",
  /* probe.conv_operation_mode */ "toimintatila",
  /* probe.conv_error_class */ "vikaluokka",
  /* probe.conv_error_code */ "Daikin-vikakoodi",
  /* probe.conv_indoor_mode */ "sisätila · ylempi puolikas",
  /* probe.conv_hybrid_mode */ "hybriditila",
  /* probe.conv_bit */ (bit) => `bitti ${bit} · 0 tai 1`,
  /* probe.conv_unknown */ "tuntematon muunnin",
  /* probe.send */ "Lue rekisteri",
  /* probe.querying */ "Kysytään…",
  /* probe.action_note */ "Yksi pyyntö kyselyjaksoa kohti. Estetty OTA:n aikana.",
  /* probe.catalog_loading */ "Ladataan aktiivista profiilia…",
  /* probe.catalog_empty */ "Rekisterimäärityksiä ei ole.",
  /* probe.catalog_error */ "Profiilirekistereitä ei voitu ladata.",
  /* probe.catalog_profile */ (profile) => `Profiili: ${profile}`,
  /* probe.catalog_fallback */ (definition, profile) => `main/def: ${definition} · profiili: ${profile}`,
  /* probe.response */ "Vastaus",
  /* probe.frame */ "Kehys",
  /* probe.payload */ "Hyötykuorma",
  /* probe.slice */ "Valitut tavut",
  /* probe.interpretation */ "Tulkinta",
  /* probe.response_for */ (reg) => `Rekisterin ${reg} vastaus`,
  /* probe.payload_marked */ "Hyötykuorma · valitut tavut merkitty",
  /* probe.slice_note */ (offset, size, slice) => `Siirtymä ${offset} · ${size} tavua · 0x${String(slice).replace(/\s+/g, "")}`,
  /* probe.full_frame */ "Koko kehys",
  /* probe.decode_value */ "Muuntimen tulos",
  /* probe.no_decodes */ "Ei muunnostulosta.",
  /* probe.refused */ "Arvo hylätty",
  /* probe.unimplemented */ "Ei toteutettu",
  /* probe.aliases */ "myös",
  /* probe.invalid */ "Tarkista rekisterisivu, siirtymä, kentän leveys ja muunnin.",
  /* probe.failed */ "Kysely epäonnistui.",
  /* probe.status_ok */ "Kelvollinen vastaus",
  /* probe.status_busy */ "Varattu",
  /* probe.status_no_link */ "Ei X10A-yhteyttä",
  /* probe.status_timeout */ "Aikakatkaisu",
  /* probe.status_no_reply */ "Ei vastausta",
  /* probe.status_rejected */ "Hylätty",
  /* probe.status_bad_crc */ "Virheellinen tarkistussumma",
  /* probe.status_unexpected_reply */ "Odottamaton vastaus",
  /* probe.status_invalid_length */ "Virheellinen pituus",
  /* probe.status_short_reply */ "Osittainen vastaus",
  /* probe.status_out_of_bounds */ "Hyötykuorman ulkopuolella",
  /* probe.status_error */ "Virhe",
  /* probe.transport_ok */ "Kehys on kokonainen ja kelvollinen.",
  /* probe.transport_busy */ "Toinen rekisteripyyntö on käynnissä.",
  /* probe.transport_no_link */ "X10A-yhteys ei ole käytettävissä.",
  /* probe.transport_timeout */ "Kyselytehtävä ei suorittanut pyyntöä ajoissa.",
  /* probe.transport_no_reply */ "Vastaustavuja ei saatu.",
  /* probe.transport_rejected */ "Yksikkö torjui tämän rekisterisivun.",
  /* probe.transport_bad_crc */ "Vastaus saatiin, mutta tarkistussumma on väärä.",
  /* probe.transport_unexpected_reply */ "Vastaus kuuluu eri rekisterisivulle.",
  /* probe.transport_invalid_length */ "Vastaus ilmoittaa virheellisen kehyspituuden.",
  /* probe.transport_short_reply */ "Vastauksesta saatiin vain osa.",
  /* probe.transport_out_of_bounds */ "Pyydetyt tavut ovat hyötykuorman ulkopuolella.",
  /* probe.transport_error */ "Pyyntö epäonnistui.",
  /* lang.auto */ "Selain",
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
  /* lang.saved */ "Kieli tallennettu",
  /* hist.cop_none */ "COP-käyrää ei näytetä, kun sähköteho tulee CT-virtamuuntajilta. Johdotus määrää kuormat; lämpölaskenta päättyy ennen BUH:ta eikä sisällä BSH:n suoraan tankkiin lisäämää lämpöä, joten taserajat eivät välttämättä vastaa toisiaan.",
]);

DESCRIPTION_I18N.fi = descriptionValues([
  ["DHW-/varaajatankin tavoitelämpötila; korkea asetus voi lisätä kulutusta ja sähkövastuksen käyttöä."], // 0
  ["DHW-tankin toisen lämpöanturin lukema, kaksanturimallissa esimerkiksi ala-anturi."], // 1
  ["Tankkianturin R5T lämpötila; jos se ei nouse latauksessa, tarkista myös muut anturit ja lämmönlähde."], // 2
  ["Tehokas DHW aloittaa tankin lämmityksen heti tavoitteeseen; käyttö voi lisätä kulutusta ja keskeyttää tilalämmityksen."], // 3
  ["X10A-esilämmitystila, ei HomeHubin desinfiointilippu eikä näyttö käynnissä olevasta desinfioinnista."], // 4
  ["HomeHub-tulo 33 ilmoittaa desinfioinnin; lyhyt tila kahden Modbus-luvun välissä voi jäädä tallentumatta."], // 5
  ["Ulkosäätimen termostaattitila on eri kuin sisäyksikön samanniminen pyyntö eikä todista kompressorin käyntiä."], // 6
  ["Ulkoyksikön hiljaisen tilan bitti; tasoa ja aktivoinnin syytä ei ole vahvistettu."], // 7
  ["Vesipiirin aurinkotulon bitti; toiminto ja napaisuus ovat vahvistamatta."], // 8
  ["Sisäinen uudelleenkäynnistyksen odotus-/käynnistysvaihe, ei hyötylämmön merkki."], // 9
  ["Sisäinen öljynpalautus palauttaa kylmäaineöljyä kompressoriin; lyhyt aktivointi voi olla normaali."], // 10
  ["Kylmäainepiirin paineentasausvaihe, ei painemittaus tai venttiiliasennon vahvistus."], // 11
  ["Ulkosäätimen oma pyyntölippu; sitä asettava ohjaustaso ei selviä julkisista tiedoista."], // 12
  ["Kylmäainepiirin kääntävän 4-tieventtiilin komento-/tilabitti, ei mekaanisen asennon palaute."], // 13
  ["Kampikammion lämmittimen komento-/tila, ei virran tai kompressorin lämpötilan mittaus."], // 14
  ["Ulkotoimilaitteen oma lähtöbitti; liike ja aktiivinen napaisuus ovat vahvistamatta."], // 15
  ["Sisäsäätimen vikalisäkoodi; mallikohtaista vahvistettua taulukkoa ei ole, eikä 0 sulje päävikaa pois."], // 16
  ["Valinnaisen lattialämmityspiirin sulkuventtiilin looginen komento/tila, ei asento- tai virtausvahvistus."], // 17
  ["Järjestelmä pois -bitti ilmoittaa ohjaimen järjestelmätilan olevan pois, mutta ei todista kaikkien pumppujen, vastusten ja suojausten pysähtyneen."], // 18
  ["Lisäalueen ulkoinen huonetermostaattitulo on pyyntö, ei lämpötila tai kompressorin tila."], // 19
  ["Pääalueen lämmitys-/jäähdytystermostaatin pyyntö; pyydetty tila ei todista toteutunutta lämmönsiirtoa."], // 20
  ["Neljä raakaa tehorajoitusbittiä; älä muunna yhdeksi portaaksi ennen koodauksen mittausvahvistusta."], // 21
  ["PHE-lämmittimen komento-/tilabitti; komennon ja palautteen ero on tuntematon eikä bitti todista virtaa."], // 22
  ["Uudelleenlämmitys nostaa tankin tavoitteeseen, kun lämpötila alittaa käynnistysrajan."], // 23
  ["Tankin ajastusprofiili: mukavuusvaraus käyttää korkeampaa ja säästövaraus matalampaa tavoitetta."], // 24
  ["Hybridilaitteessa säätimen DHW-pyyntö kattilalle; pyyntö ei todista palamista."], // 25
  ["Vaihtoventtiili ohjaa veden DHW-tankkiin tai tilapiiriin; asento ei yksin todista piirin toimintaa."], // 26
  ["Valinnaisen 2WV:n X10A-lähtö; pois-tila ei yksin todista jäähdytystä, jännitettä tai mekaanista asentoa."], // 27
  ["Toisen alueen sekoitusventtiilin avautuma, jolla kuuma meno ja viileä paluu sovitetaan tavoitteeseen."], // 28
  ["Valitun lämmitys-/jäähdytystilan menoveden tavoite, kiinteä tai sääkompensoitu."], // 29
  ["Toisen alueen sekoitettu menolämpö venttiilin jälkeen, esimerkiksi matalalämpöiseen lattialämmitykseen."], // 30
  ["Veden lämpö BUH:n jälkeen, yleensä R2T; voi sisältää BUH-lämmön mutta ei ole lämmönluovuttajan anturi."], // 31
  ["R1T PHE:n jälkeen ennen BUH:ta; R4T:n, virtauksen ja tilan kanssa sillä arvioidaan lämpötehoa."], // 32
  ["R4T yhteisessä PHE-paluussa; R1T−R4T on PHE:n ΔT, ei lämmönluovuttajien eikä yleinen 5 K sääntö."], // 33
  ["Yhteisen vesipiirin virtaus; vähimmäinen riippuu mallista ja tilasta, ja pieni virtaus voi aiheuttaa 7H:n."], // 34
  ["Suljetun vesipiirin paine; sallittu alue on mallikohtainen, ja arvolla ≤1,0 bar tarkista kyseisen mallin ohje."], // 35
  ["Pumpun nopeuskomento käyttää käänteistä asteikkoa: 0 = täysi nopeus, 100 = pysäytys."], // 36
  ["Vesikiertopumpun tila; käynti ei yksin todista hyödyllistä lämmönsiirtoa, joten vertaa virtaukseen."], // 37
  ["Määritetyn aurinkolämpöpiirin pumppu, eri kuin lämpöpumpun vesikiertopumppu."], // 38
  ["Profiilin nimeämän pumpun nopeus; asteikko ja piiri ovat mallikohtaisia, todellinen virtaus on eri arvo."], // 39
  ["Binäärinen X10A-tila ”Water flow switch”. Malleissa, joissa virtauskytkin on dokumentoitu, päällä tarkoittaa havaittua veden liikettä; tila ei mittaa l/min eikä osoita mallikohtaista vähimmäisvirtausta. Jotkin tuetut mallit ilmoittavat tilan ilman dokumentoitua erillistä fyysistä kytkintä. Pumpun käydessä vertaa mitattuun virtaukseen ja 7H/C0-vikaan."], // 40
  ["Vesipuolen nykytila: pysäytys, lämmitys, jäähdytys, DHW tai yhdistelmä; ei todista kompressorin käyntiä."], // 41
  ["Smart Gridin nelitilainen energiakäsky HomeHubista tai X10A-koskettimista, ei lämmitys-/jäähdytystila."], // 42
  ["Nykyinen tilakäyttö on lämmitys tai jäähdytys ilman automaattia; ei todista kompressorin käyntiä."], // 43
  ["HomeHubiin määritetty automaatti-/lämmitys-/jäähdytysvalinta, ei ulkoyksikön nykyinen toiminta."], // 44
  ["Ulkoyksikön ilmoittama pysäytys/lämmitys/jäähdytys; valittu tila ei takaa kompressoria tai lämmönsiirtoa."], // 45
  ["Ulkokennon sulatus on normaalia kylmässä kosteassa säässä; bitti ilman kosteutta ei arvioi toistuvuutta."], // 46
  ["Nykyinen vikaluokka: normaali, virhe, varoitus tai huomautus; muu kuin normaali vaatii vikakoodin tarkistuksen."], // 47
  ["Parhaillaan ilmoitetun vikakoodin merkitys."], // 48
  ["Hätäkäyttö lämpöpumpun vian jälkeen; asetuksesta riippuen BUH tai kattila voi hoitaa lämmityksen/DHW:n."], // 49
  ["Yksikön hälytysrele ilmoittaa vian ulkoiselle valvonnalle."], // 50
  ["Pääalueen lämmitys-/jäähdytyshuoneen tavoite, ei termostaatin päällä/pois-pyyntö."], // 51
  ["Sisäyksikön thermo ON -pyyntö; ei yksilöi kuormaa eikä todista kompressorin käyntiä."], // 52
  ["Space H Operation -lähtöliittimen tila, ei tavallinen tilalämmityksen toimintatila."], // 53
  ["Ilmaisee normaalin tilalämmityksen/-jäähdytyksen sallinnan tai toiminnan, ei itse termostaattipyyntöä."], // 54
  ["Yksikön oman huoneanturin ohjaaman alueen huonelämpötilan tavoite."], // 55
  ["Sisäisen tai johdollisen huoneanturin mittaus; käyttö ohjauksessa riippuu valitusta säätötavasta."], // 56
  ["Purkauslämpösuoja: Drop päällä/pois, Retry 0–7. Vain katkeamattomien vertailukelpoisten näytteiden kasvu osoittaa toiminnan, ei syytä tai poikkeavaa absoluuttista arvoa; kynnys, nollaus ja 7→0 ovat tuntemattomat."], // 57
  ["Invertterivirtasuoja: Drop päällä/pois, Retry 0–7. Vain katkeamattomien vertailukelpoisten näytteiden kasvu osoittaa toiminnan, ei syytä tai poikkeavaa absoluuttista arvoa; kynnys, nollaus ja 7→0 ovat tuntemattomat."], // 58
  ["Korkeapainesuoja: Drop päällä/pois, Retry 0–7. Vain katkeamattomien vertailukelpoisten näytteiden kasvu osoittaa toiminnan, ei syytä tai poikkeavaa absoluuttista arvoa; kynnys, nollaus ja 7→0 ovat tuntemattomat."], // 59
  ["Matalapainesuoja: Drop päällä/pois, Retry 0–7. Vain katkeamattomien vertailukelpoisten näytteiden kasvu osoittaa toiminnan, ei syytä tai poikkeavaa absoluuttista arvoa; kynnys, nollaus ja 7→0 ovat tuntemattomat."], // 60
  ["Invertterin jäähdytyselementin lämpösuoja: Drop päällä/pois, Retry 0–7. Vain katkeamattomien vertailukelpoisten näytteiden kasvu osoittaa toiminnan, ei syytä tai poikkeavaa absoluuttista arvoa; kynnys, nollaus ja 7→0 ovat tuntemattomat."], // 61
  ["Muu sisäinen rajoitusbitti kuin viisi nimettyä suojaa; päällä kertoo vain tunnistamattomasta rajoituksesta."], // 62
  ["PHE:n tulo- tai lähtöveden lämpötila kylmäaineen ja veden välisessä lämmönvaihdossa."], // 63
  ["Ulkokennoanturin lämpötila; alle 0 °C lämmityksessä ei ilman kosteustietoa todista huurretta."], // 64
  ["Yksikön läheltä mitattu ulkoilma; aurinko, asennuspaikka ja tuuli voivat erottaa sen säähavainnosta."], // 65
  ["Kuuma kaasu kompressorin jälkeen; riippuu paineesta, nopeudesta, tilasta ja kuormasta. Yksi arvo tai toisen sarjan alue ei osoita vikaa tai kylmäainevajetta."], // 66
  ["Kompressorille palaavan viileän matalapaineisen kylmäainekaasun lämpötila."], // 67
  ["Lämmönvaihtimien välisen nestelinjan kylmäainelämpötila."], // 68
  ["Höyrystimen tulo-/lähtökylmäaineen lämpötila lämmön vastaanottokohdassa."], // 69
  ["Kylmäaineen ruiskutuslinjan lämpötila kompressorin ohjausta ja suojausta varten."], // 70
  ["Kaksifaasisessa neste-höyry-kylmäaineessa mitattu sisäinen ohjauslämpö, ei käyttäjän asetus."], // 71
  ["Ulkokennon sulatusanturi; sijainti ja ohjaus ovat mallikohtaisia. Yksi piste ei osoita koko kennon jäätä tai sulatuksen päättymistä."], // 72
  ["Kylmäainepaineesta laskettu kyllästymislämpötila, ei erillinen lämpöanturi tai bar-paine."], // 73
  ["Korkea-/matalapaine: arvioi saman tilan/mallin vakaa trendi; käynnistys, öljynpalautus ja sulatus muuttavat sitä. Yleistä normaalialuetta ei ole."], // 74
  ["Invertterikompressorin nopeus rps; keskeinen tehonsäätöarvo, ei suora lämpötehomittaus."], // 75
  ["EEV-askeleet ovat komento ilman mekaanista palautetta, eivät % tai virtaus. Yksin ne eivät osoita liikettä, jumia tai kylmäainevajetta."], // 76
  ["Ulkopuhaltimen moottoriohjaimen elektroniikan lämpötila."], // 77
  ["Ulkopuhaltimen nopeus portaana tai rpm; voi olla 0 seisokin tai sulatuksen osassa."], // 78
  ["Mallin/tilan sisäinen tavoite; vertaa vastaavaan paineesta laskettuun kyllästyslämpöön. Ero ei diagnosoi syytä tai täyttöä."], // 79
  ["Kompressorin purkaus-/porttilämpötilan sisäinen suojaustavoite."], // 80
  ["Meno- ja paluuveden tavoite-ΔT; mallista ja tilasta riippuen myös 8/10 K, ei yleinen 5 K."], // 81
  ["Laitteen kylmäaine, kuten R32 tai R410A; määrää paine–lämpötila-kyllästyskäyrän."], // 82
  ["Kompressorin portilta mitattu lämpötila sisäistä ohjausta ja suojausta varten."], // 83
  ["Ulkoyksikön ilmoittama kylmäainepiirin paine."], // 84
  ["Arvio täydellisistä CT-vaiheista oletuksella 230 V; johdotusraja, todellinen jännite ja tehokerroin puuttuvat."], // 85
  ["Kompressorin invertterivirta; karkea kompressorikuorman mitta, ei lämpöteho."], // 86
  ["Ulkoinvertterin/tehoelektroniikan jäähdytyselementin lämpö; korkea arvo voi rajoittaa tehoa."], // 87
  ["Aktiivisten BUH-portaiden määrä; 0 on pois, suurempia portaita voidaan käyttää pakkasella, sulatuksessa, DHW:ssa tai hädässä."], // 88
  ["Vettä suoraan lämmittävän BUH-vastuksen porras; sallinta ja tasapainolämpö ovat asentajan asetuksia."], // 89
  ["HomeHub 32 on BSH:n päällä/pois-tila, ei teho. 51 on erillinen lämpöpumpun sähköteho eikä BSH:n teho."], // 90
  ["DHW-tankin uppovastus BSH voi toimia ilman kompressoria ja kiertoa; X10A ei ilmoita sen tehoa."], // 91
  ["Sähkölämmittimen lämpösuojapiiri; avoin tila voi tarkoittaa ylikuumenemista, johdinvikaa tai puuttuvaa vastusta."], // 92
  ["Vesiputkiston jäätymissuojaus riippuu mallista ja sähköstä eikä takaa suojaa sähkökatkossa."], // 93
  ["X10A-jäätymissuojaustila; ilman tarkkaa malliasetusta pumppua, vastusta ja suoja-aluetta ei voi nimetä."], // 94
  ["Maalämpömallin keruupiirin/pumpun arvo; neste, pitoisuus, paine ja lämpörajat riippuvat suunnittelusta."], // 95
  ["Hybridin lämmönlähdevalinta: lämpöpumppu, yhdistelmä tai kattila; ei mitattu lämpöteho."], // 96
  ["Hybridilämmityksen menoveden tavoite, ei mitattu veden lämpötila."], // 97
  ["Toisen lämmönlähteen rinnakkaiskäytön sallinta/tila; päällä ei todista kattilan palamista."], // 98
  ["Kattilan käyttöpyyntö rinnakkais-/hybridijärjestelmässä; ei todista palamista tai tuotettua lämpöä."], // 99
  ["Kattilalämmitykselle pyydetty veden lämpötavoite, ei kattilan tai piirin mittaus."], // 100
  ["Sisäinen rinnakkaiskäytön BE_COP-vertailuarvo; ei nykyinen mitattu COP, eikä X10A-asteikko ole julkinen."], // 101
  ["Sähköyhtiön, Smart Gridin tai aurinkojärjestelmän ulkoinen tulo; vaikutus riippuu kosketinasetuksesta."], // 102
  ["Sisä-/ulkoyksikön nimellisteholuokka; kiinteä malliarvo, ei nykyinen teho."], // 103
  ["Hiljainen tila vähentää ulkomelua, mutta voi samalla pienentää käytettävissä olevaa lämmitys-/jäähdytystehoa."], // 104
  ["HomeHubin diagnostiikkatila: ei vikaa, vika tai varoitus; syy selviää viereisestä koodista/lisäkoodista."], // 105
  ["Parhaillaan ilmoitetun vikakoodin merkitys."], // 106
  ["Numeerinen lisäkoodi tarkentaa viereistä Daikin-vikakoodia; lue vain tilan ja pääkoodin kanssa."], // 107
  ["HomeHubin ilmoitus kompressorin käynnistä; ei anna nopeutta tai kapasiteettia, joten vertaa virtaukseen ja piiritilaan."], // 108
  ["Normaali DHW-käyttö: käynnissä = päällä, odotus/varaus = pois; ei kerro käynnistyksen syytä."], // 109
  ["Normaali tilakäyttö: käynnissä = päällä, odotus/varaus = pois; tila ja 3WV erottavat lämmityksen/jäähdytyksen ja reitin."], // 110
  ["PHE-lähtövesi ennen BUH:ta; vertaa paluuseen vain kierron aikana, jolloin erotus on vesipuolen ΔT."], // 111
  ["Menovesi BUH:n jälkeen; vastuksen osuus pitää vahvistaa BUH-tilasta, ei vain lämpöerosta."], // 112
  ["DHW-tankin veden lämpö; jos se ei nouse DHW-käytössä, tarkista toiminta, virtaus ja diagnoosit."], // 113
  ["Ulkoyksikön ja sisälämmönvaihtimen välisen nestelinjan kylmäaine; yksittäinen arvo ilman käyttötilaa ei diagnosoi."], // 114
  ["Kaukosäätimen ilmoittama pääalueen huonelämpö; arvo voi puuttua normaalisti ilman sopivaa anturia/asetusta."], // 115
  ["HomeHubin lämpöpumpun sähkönkulutus; tila ja lämmittimet vaikuttavat, joten kaikkea ei voi kohdistaa kompressorille."], // 116
  ["HomeHubista luettu pääalueen lämmitysmenoveden tavoite; voi olla kiinteä tai sääkompensoitu ja on vain luku."], // 117
  ["HomeHubista luettu pääalueen jäähdytysmenoveden tavoite; voi jäädä näkyviin jäähdytyksen ollessa pois ja on vain luku."], // 118
  ["Koko tilapiirin sallintakytkin, ei tieto nykyisestä käynnistä."], // 119
  ["Hiljainen käyttö vähentää melua ja käytettävissä olevaa tehoa; käsiohjaus, ajastus tai asentajaraja voi aktivoida sen."], // 120
  ["DHW-uudelleenlämmityksen tankkitavoite, ei käynnistyslämpö; käynnistys riippuu hystereesistä ja ajastuksesta."], // 121
  ["Lämmitysmenoveden vain luku -korjaus −10…+10 K; muu kuin 0 ei todista käynnissä olevaa tilalämmitystä."], // 122
  ["Smart Gridin suositeltu päällä -varauksen tehoraja; pienempi tästä ja yleisrajasta pätee, eikä arvo ole nykykulutus."], // 123
  ["HomeHubin yleinen tehoraja, voimassa myös vapaassa käytössä; asetusraja, ei mitattu sähkönkulutus."], // 124
]);

MODEL_DESCRIPTION_I18N.fi = modelDescriptionValues([
  ["Yksikön ilmoittama vika/varoitus. Nykyinen virhe on varoitus; varoitus, huomautus tai 24 tunnissa poistunut ilmoitus on tieto. Tämä on laitteen ilmoitus, ei päätelmä."], // health_fault
  ["Mittaa tankin jäähtymistä rauhallisen tunnin aikana. ≥0,8 K/h on vertailulaitteiston huomio, ei Daikin-raja; tunnistus ulottuu noin 1,85 K/h:iin, eikä OK todista eristystä tai venttiilejä ehjiksi."], // health_dhw_loss
  ["Laskee kompressorin käynnit ja täydet käyttöajat. Huomio, kun vahvistettuja lämmityskäyntejä on ≥12 ja keskiarvo <10 min. DHW/jäähdytys rajataan pois, mutta runsas luokittelematon aineisto arvioidaan yhdessä. Ei Daikin-raja."], // health_cycling
  ["Sulatus: huomio yli 15 % ja ≥3 kertaa; ei Daikin-raja. R4T on arvioon kuulumaton live-tausta, eikä yksi piste kuvaa koko kennoa."], // health_defrost
  ["Liukuvan ikkunan pienin kelvollinen vesipaine: >1,0 bar vertailu, ≤1,0 bar huomio ja 60 s jatkuessa varoitus. Sallittu alue on mallikohtainen."], // health_pressure
  ["Pienin virtaus, kun sisäinen pumppu on käynyt 60 s. Mittaa osakuorman käyttöä, ei suunnitteluvirtausta; yleistä rajaa ei ole eikä yksi pieni arvo todista vikaa."], // health_flow
  ["BUH:n ja BSH:n havaittu käyttöaika. Käyttö voi olla normaalia pakkasella, hätätilassa, sulatuksessa, DHW:ssa tai ylijäämäohjauksessa; yhteistä OK-/varoitusrajaa ei ole."], // health_heater
  ["Seuraa viittä suojalaskuria kokeellisesti. Vain selvä kasvu katkeamattomissa vertailukelpoisissa näytteissä osoittaa toiminnan, ei syytä; absoluuttinen arvo ei ole todiste, ja kynnys, nollaus sekä 7→0 ovat tuntemattomat. Kasvun puute ei todista ettei rajoitusta ollut."], // health_retries
  ["Käyttämätön RAM nyt ja 24 h kehitys. Palautuva lyhyt lasku voi olla normaali, jatkuva lasku voi viitata vapautumattomaan varaukseen. Virrallisessa lämpimässä uudelleenkäynnistyksessä RAM-historia säilyy; tavallinen uudelleenkäynnistys, päivitys tai sähkökatko palauttaa flash-muistista valmiit 5 min jaksot, mutta avoin jakso voi puuttua."], // free_heap
  ["Suurin yhtenäinen vapaa RAM-lohko. TLS/OTA tarvitsee suuren yksittäisen lohkon; lasku vakaan kokonaismuistin rinnalla voi tarkoittaa pirstoutumista ja varausvirheitä."], // max_alloc
  ["Ulkoyksikön ID-sivulta luettu nimellisteholuokka, ei nykyinen lämpöteho."], // capacity
  ["Sisäyksikön nimellisteho; sitä ei voi tulkita ulkoyksikön tai koko laitteiston tehoksi."], // capacity_iu
  ["Jäljellä olevilla ehdokkailla on sama teholuokka ja rekisterirakenne; edustavan ehdokkaan valinta ei muuta purettuja arvoja."], // candidates
  ["Ulkoteho puuttuu, joten ehdokkaiden teholuokat voivat erota. Purku käyttää sisäyksikköä parhaiten vastaavaa ehdokasta, mutta valinta ei ole varma ja tyyppikilpi on tarkistettava."], // candidates_nocap
  ["Ulkoyksikön huoltoliitännän raakatunnustavut. Julkista tuotenimitaulukkoa ei ole; epäselvä tunnus verrataan tyyppikilpeen merkki kerrallaan."], // oueeprom
]);

FAULT_CODE_I18N.fi = faultCodeValues([
  "Veden virtausongelma", // 7H
  "Paluuveden lämpötila-anturin vika", // 80
  "Menoveden lämpötila-anturin vika", // 81
  "Lämmönvaihtimen jäätymissuoja aktivoitui", // 89
  "DHW-lähtöveden poikkeava lämpötilan nousu", // 8F
  "Menoveden poikkeava lämpötilan nousu", // 8H
  "Nollakohdan tunnistusvika", // A1
  "Korkeapaineen huippurajoituksen tai jäätymissuojan ongelma", // A5
  "BUH ylikuumentunut tai kytkemättä", // AA
  "BSH ylikuumentunut", // AC
  "Tankin desinfiointi (legionellasuoja) ei valmistunut", // AH
  "DHW:n lämmitysaika ylittyi", // AJ
  "Virtausanturin vika", // C0
  "Lämmönvaihtimen lämpötila-anturin vika", // C4
  "Lämmönvaihdinanturin vika", // C5
  "Huonelämpötila-anturin vika", // CJ
  "Ulkoyksikön piirilevyvika", // E1
  "Vuotovirran tunnistusvika", // E2
  "Ulkoyksikön korkeapainekytkin aktivoitui", // E3
  "Imupainevika", // E4
  "Ulkoyksikön invertterikompressorin moottori ylikuumentunut", // E5
  "Ulkoyksikön kompressori ei käynnistynyt", // E6
  "Ulkoyksikön puhallinmoottorin vika", // E7
  "Ulkoyksikön tulojännite liian korkea", // E8
  "Elektronisen paisuntaventtiilin vika", // E9
  "Ulkoyksikön jäähdytys-/lämmitysvaihdon ongelma", // EA
  "Tankin poikkeava lämpötilan nousu", // EC
  "Ulkoyksikön purkausputken lämpötilavika", // F3
  "Ulkoyksikön korkeapainevika jäähdytyksessä", // F6
  "Ulkoyksikön korkeapainevika tai painekytkin aktivoitui", // FA
  "Ulkoyksikön jännite-/virta-anturin vika", // H0
  "Ulkoisen lämpötila-anturin vika", // H1
  "Ulkoyksikön korkeapainekytkimen vika", // H3
  "Kompressorin ylikuormitussuojan vika", // H5
  "Ulkoyksikön asennontunnistusanturin vika", // H6
  "Ulkokompressorin tulovirran CT-piirin vika", // H8
  "Ulkoyksikön ulkoilma-anturin vika", // H9
  "Tankin lämpötila-anturin vika", // HC
  "Vedenpaineanturin vika", // HJ
  "Ulkoyksikön purkausputkianturin vika", // J3
  "Ulkoyksikön lämmönvaihdinanturin vika", // J6
  "Ulkoyksikön korkeapaineanturin vika", // JA
  "Invertterin piirilevyvika", // L1
  "Ulkoyksikön ohjauskotelon poikkeava lämpeneminen", // L3
  "Ulkoinvertterin jäähdytyselementin poikkeava lämpeneminen", // L4
  "Ulkoinvertterin tasavirran ylivirta havaittu", // L5
  "Invertterin piirilevyn lämpösuoja aktivoitui", // L8
  "Kompressorin lukkiutumissuoja", // L9
  "Ulkoyksikön tiedonsiirtovika", // LC
  "Syöttövaiheiden epätasapaino tai vaihe puuttuu", // P1
  "Tasavirtavika havaittu", // P3
  "Ulkoyksikön jäähdytyselementin lämpötila-anturin vika", // P4
  "Teholuokan asetus ei täsmää", // PJ
  "Ulkoyksikössä liian vähän kylmäainetta", // U0
  "Väärä vaihejärjestys tai vaihe puuttuu", // U1
  "Ulkoyksikön pääsyöttöjännitteen vika", // U2
  "Lattialämmityksen tasoitekuivaus ei valmistunut oikein", // U3
  "Sisä- ja ulkoyksikön tiedonsiirtovika", // U4
  "Käyttöliittymän tiedonsiirtovika", // U5
  "Ulkoyksikön pääsuorittimen ja invertterisuorittimen tiedonsiirtovika", // U7
  "Ulkoisen laitteen (LAN-sovitin, huonetermostaatti tai USB) tiedonsiirtovika", // U8
  "Sisä- ja ulkoyksikön yhdistelmä- tai yhteensopivuusvika", // UA
  "Putket kytketty ristiin tai tiedonsiirtojohdotus virheellinen", // UF
], "Vikakoodia ei ole ilmoitettu.", "Tälle koodille ei ole tallennettu lyhyttä selitystä.");

MB_DELTA_I18N.fi = mbDeltaValues([
  "Kompressorin seistessä X10A säilyttää edellisen käynnin arvon. Erikseen luettu HomeHub-rekisteri voi muuttua, mutta mittauksen aikaleimaa ei ole.", // outdoor_air
  "Arvot tulevat kahdesta eri huonelämpötilasäätimestä.", // room_temp
]);

INSPECT_I18N.fi = inspectValues(
  ["Ei nykyistä mittausta:", "kompressori on pysähtynyt ja ulkoyksikkö päivittää omia antureitaan vain käydessään. Edellisen käynnin arvo piilotetaan, ettei sitä näytetä nykyisenä mittauksena."],
  [
    ["Toimintatila", "Toimintatila", "Sisäyksikön tila. Se ei yksin vahvista kompressorin käyntiä tai virtaamaa."], // status
    ["ENV III", "ENV III -olosuhteet", "Liitetyn ENV III:n lämpötila, kosteus ja ilmanpaine. Sijoitus ratkaisee, kuvaavatko arvot sisä- vai ulko-olosuhteita."], // env3
    [(d) => sgInspectIsX10a(d) ? "Smart Grid -pyyntö · X10A" : "Smart Grid -pyyntö · Modbus", "Smart Grid -pyyntö", (d) => sgInspectIsX10a(d)
      ? "Fyysisten SG-Ready-koskettimien ulkoinen pyyntö: vapaa käyttö, pakotettu pois, käyttöä suositellaan tai pakotettu päälle. Se on energianhallintakomento, ei lämmitys-/jäähdytystila eikä todiste säiliön latauksesta; verkkopyyntö ei välttämättä näy koskettimissa."
      : "HomeHubista takaisin luettu ulkoinen pyyntö: vapaa käyttö, pakotettu pois, käyttöä suositellaan tai pakotettu päälle. Se ei ole lämmitys-/jäähdytystila eikä todiste säiliön latauksen alkamisesta.", (d) => !d || d.sgMode == null ? "Nykyistä Smart Grid -arvoa ei ole."
      : d.sgMode === 2 && d.sgSrc === "X10A" ? "SG-Ready-koskettimet ilmoittavat käyttöä suositeltavan. Energianhallinta käyttää tätä tehostukseen; käyttövesitila, 3WV ja virtaama näyttävät erikseen latautuuko säiliö todella."
      : d.sgMode === 2 ? "HomeHub ilmoittaa käyttöä suositeltavan. Energianhallinta käyttää tätä tehostukseen; käyttövesitila, 3WV ja virtaama näyttävät erikseen latautuuko säiliö todella."
      : d.sgMode === 1 ? "Ulkoinen energianhallinta ilmoittaa pakotetun poiskytkennän."
      : d.sgMode === 3 ? "Ulkoinen energianhallinta ilmoittaa pakotetun päällekytkennän."
      : "Ulkoista Smart Grid -pyyntöä ei ole; yksikkö toimii itsenäisesti."], // sgrequest
    ["Ulkoyksikkö", "Ulkoyksikkö", "Puhallin siirtää ilmaa lämmönvaihtimen läpi ja kompressori nostaa kylmäaineen painetta ja lämpötilaa. Kaavio on yksinkertaistus; monoblock-, maalämpö- ja hybridijärjestelmät ovat rakenteeltaan erilaisia.", (d) => d.defrost ? "Sulatus — käänteinen kierto sulattaa jään ja ottaa hetkeksi lämpöä vedestä."
      : compressorRunning(d) ? d.rps != null ? `Käynnissä — kompressori ${fmt0(d.rps)} rps${d.quiet ? ", hiljainen tila rajoittaa" : ""}.` : "Käynnissä — HomeHub vahvistaa kompressorin; nopeus ja tarkat arvot vaativat X10A:n."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out") ? "Valmiustila — ei aktiivista lämmönsiirtoa. X10A-anturit eivät päivity; ulkolämpötila tulee aikaleimattomasta Modbus-arvosta ja kuumakaasun lämpötila on “—”."
      : "Valmiustila — kompressori pysähtynyt, ei aktiivista lämmitystä tai jäähdytystä. Päivittymättömät arvot näytetään “—”, ei edellisen käynnin arvoina."], // ou
    ["Kompressori", "Kompressori", "Puristaa kylmäainetta. rps vahvistaa käynnin, mutta ei yksin lämpötehoa."], // comp
    ["Ulkolämpötila", "Ulkolämpötila", "Lämpötila ulkoyksikön anturin lähellä; aurinko ja asennus vaikuttavat siihen."], // out
    ["Ulkolämmönvaihdin · R4T", "Ulkolämmönvaihtimen lämpötila R4T", "Lämmityksessä lämmönvaihdin voi jäähtyä alle 0 °C:n. Lämpötila ja sulatustila yhdessä kuvaavat huurtumista ja sulatusta."], // ouhx
    ["Korkeapaine", "Korkeapaine", "Kylmäainepiirin korkeapainepuoli. Tarkastele sitä tilan ja kuumakaasun lämpötilan kanssa; tämä ei ole vedenpaine."], // hp
    ["Kuumakaasun lämpötila", "Kuumakaasun lämpötila", "Kuuman kylmäaineen lämpötila kompressorin jälkeen. Riippuu kuormasta ja tilasta; vanha arvo piilotetaan pysähdyksissä."], // disch
    ["Matalapaine", "Matalapaine", "Kylmäaineen paine kompressorin matalapainepuolella. Kaikissa profiileissa ei ole tätä anturia."], // lp
    ["Paisuntaventtiili", "Paisuntaventtiili", "Elektronisen venttiilin ohjattu asento pulsseina; luku ei ole avautumisprosentti."], // eev
    ["Nestepuolen kylmäaine · R3T", "Nestepuolen kylmäaineen lämpötila R3T", "Kylmäaineen lämpötila sisälämmönvaihtimen nestepuolella; ei paluuveden lämpötila."], // r3t
    ["Levylämmönvaihdin", "Levylämmönvaihdin", "PHE siirtää energiaa kylmäaineen ja veden välillä sekoittamatta niitä. Teho arvioidaan virtaamasta ja R1T/R4T:stä; anturien tarkka sijainti riippuu mallista.", (d) => !compressorRunning(d, 5) ? "Ei aktiivista kylmäainepuolen siirtoa — kompressori pysähtynyt. Pumppu voi siirtää jälkilämpöä, mutta se ei ole lämmitys- tai jäähdytystehoa."
      : d.dtStale ? "Vesipuolen siirtoa ei voi laskea — pumppu ja virtaama eivät vahvista veden liikettä PHE:n läpi."
      : d.pth == null ? "Ei suunnattua arviota — arvot eivät vahvista hyödyllistä siirtoa valitussa tilassa."
      : d.pthKind === "cooling" ? `Vedestä poistuu noin ${fmt1(d.pth)} kW (${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K).`
      : `Veteen siirtyy noin ${fmt1(d.pth)} kW (${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K).`], // phe
    ["PHE ulos · ennen BUH · R1T", "PHE:n lähtövesi ennen BUH:ta R1T", "Veden lämpötila PHE:n lähdössä ennen BUH:ta. Lämmityksessä/käyttövedellä yleensä R4T:tä korkeampi, jäähdytyksessä matalampi."], // lwt
    ["Vesi BUH:n jälkeen · R2T", "Veden lämpötila BUH:n jälkeen R2T", "Veden lämpötila BUH:n jälkeen; toisin kuin R1T, se voi sisältää lisätyn sähköenergian."], // r2t
    ["PHE sisään · R4T", "PHE:n tuloveden lämpötila R4T", "PHE:lle palaavan veden lämpötila. Tarkastele R1T:n, virtaaman, kompressorin ja tilan kanssa."], // rwt
    ["PHE:n veden ΔT", "PHE:n veden lämpötilaero", "Lähdön R1T miinus tulon R4T. Lasketaan kahdesta anturista; virtaaman kanssa se kuvaa lämmönsiirtoa, mutta ei mittaa rakennuksen lämmönluovuttimien meno- ja paluulämpöä.", (d) => d.dtStale ? "Ei toimivaa ΔT:tä — pumppu ja virtaama eivät vahvista veden liikettä. Jäähtyvien anturien ero ei ole toimintapiste."
      : d.dt == null ? null : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K vain pumpulla — jälkilämmön tasaantumista, ei tehoa.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. Jäähdytyksessä R1T:n tulee olla R4T:tä alempi, joten ero on negatiivinen.`
      : `${fmt1(d.dt)} K${d.dtSet != null ? `, tavoite ${fmt1(d.dtSet)} K` : ""}. Positiivinen arvo tarkoittaa lämmön siirtymistä veteen.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Jäähdytysteho (arvio)" : "Lämpöteho (arvio)", "PHE:n arvioitu lämpöteho", (d) => d && d.pthKind === "cooling" ? "Vedestä poistetun lämmön arvio: virtaama × (R4T−R1T) × 4,186 olettaen veden. Anturit ja glykoli rajoittavat tarkkuutta; arvo näytetään vain vahvistetussa jäähdytyksessä." : "Veteen siirtyneen lämmön arvio: virtaama × (R1T−R4T) × 4,186 olettaen veden. Anturit ja glykoli rajoittavat tarkkuutta; R1T:n jälkeinen BUH ei sisälly.", (d) => d.dtStale ? d.bsh === true ? "PHE:n siirtoa ei voi laskea ilman vahvistettua kiertoa. BSH voi yhä lämmittää säiliötä, mutta sen lämpö ohittaa PHE-anturit eikä väylä ilmoita tehoa." : "Tehoa ei voi laskea ilman vahvistettua veden liikettä PHE:n läpi. Toimintapiste puuttuu; teho ei ole 0 kW."
      : d.pth == null ? null : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW jäähdytystä${d.cop != null ? `, EER ${fmt1(d.cop)}` : ""}.` : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "Lämpöpumpun EER (arvio)" : d && d.copScope === "plant" ? "COP BUH:n jälkeen (arvio)" : "Lämpöpumpun COP (arvio)", "Arvioitu hyötysuhde", (d) => d && d.efficiencyKind === "eer" ? "Arvioitu jäähdytysteho jaettuna arvioidulla sähköteholla. Tulos perii nesteen, anturien, jännitteen ja tehokertoimen oletukset; hetkellinen, ei kausittainen EER." : "Arvioitu lämpöteho jaettuna saman taserajan sähköteholla. CT:llä lämpö voidaan laskea BUH:n jälkeen, invertterivirralla vain lämpöpumpulle; CT-kytkentä määrää mukana olevat kuormat. Tulos perii neste-, anturi-, jännite- ja tehokerroinoletukset ja on hetkellinen, ei kausittainen.", (d) => d.copBlock === "tank_heater" ? "COP ei saatavilla — säiliövastus käy. Sen sähkö voi sisältyä taseeseen, mutta lämpö menee suoraan säiliöön vesipuolen anturien ohi."
      : d.copBlock === "buh_no_r2t" ? "COP ei saatavilla — BUH lämmittää, mutta profiilissa ei ole jälkianturia; sähkö- ja lämpöraja eivät täsmää."
      : d.copBlock === "mb_scope" ? "COP ei saatavilla — HomeHub ilmoittaa koko yksikön sähkön lämmittimineen, lämpö koskee vain PHE:tä. Ilman lämmitintiloja ja jälkianturia rajoja ei voi sovittaa."
      : d.copBlock === "no_pel" ? d.pelHeld ? "COP ei saatavilla — pysähtyneen kompressorin invertterivirta on edelliseltä käynniltä." : "COP ei saatavilla — profiili ei ilmoita CT- eikä invertterivirtaa."
      : d.cop == null ? null : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW jäähdytystä / 1 kW sähköä — ≈ ${fmt1(d.copPth)} kW teholla ≈ ${fmt1(d.pel)} kW.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW lämpöä BUH:n jälkeen / 1 kW CT-sähköä — ≈ ${fmt1(d.copPth)} kW teholla ≈ ${fmt1(d.pel)} kW. CT-kytkentä määrää rajan.`
      : `${fmt1(d.cop)} kW lämpöä / 1 kW sähköä lämpöpumpun rajalla — ≈ ${fmt1(d.copPth)} kW teholla ≈ ${fmt1(d.pel)} kW. BUH ei sisälly kumpaankaan.`], // cop
    ["Varalämmitin · BUH", "Varalämmitin BUH", "Vesipiirin sähkövastus pakkaselle, sulatukselle tai varakäytölle. Porras ei ole erillinen kW-mittaus.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Porras 2 — molemmat portaat lämmittävät." : d.buh1 ? "Porras 1 — yksi porras lämmittää." : "Pois — BUH-portaita ei käytössä."], // buh
    ["Säiliön sähkövastus", "Säiliön sähkövastus", "Uppovastus BSH lämmittää säiliötä ilman kompressoria tai vesikiertoa. X10A ilmoittaa vain tilan, ei tehoa.", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "Säiliön sähkövastus aktiivinen." : "Pois — säiliön vastus ei ole käytössä."; }], // bsh
    ["3-tieventtiili", "3-tieventtiili", "Valitsee reitin säiliöön tai tilapiiriin. Ilmoitettu käsky ei vahvista mekaanista asentoa tai virtaamaa.", (d) => d.valveDhw == null ? null : d.valveDhw ? "Säiliöreitti valittu; ilmoitus ei yksin vahvista virtaamaa tai lämmitystä." : "Tilapiiri valittu; ilmoitus ei yksin vahvista kiertoa."], // valve
    ["2-tieventtiilin lähtö", "2-tieventtiilin lähtö", "X10A:n binäärilähtö; ei mekaaninen asentopalaute eikä todiste lämmityksestä/jäähdytyksestä.", (d) => d.valve2On == null ? null : d.valve2On ? "X10A ilmoittaa 2WV-lähdön PÄÄLLÄ; tarkista tila ja tilapiirin toiminta erikseen." : "X10A ilmoittaa 2WV-lähdön POIS; se ei yksin tarkoita jäähdytystä eikä kumoa lämmitystilaa levossa."], // valve2
    ["Käyttövesi-/varaajasäiliö", "Käyttövesi- tai varaajasäiliö", "Säiliötä kuvaavat R5T, tavoitelämpötila ja 3WV-reitti; lämpötila ei yksin vahvista latausta."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Jäähdytyspiiri" : activeSpaceKind(d) === "heat" ? "Lämmityspiiri" : "Tilapiiri", "Tilapiiri", "Patterit, lattialämmitys tai puhallinkonvektorit. R1T/R4T mitataan lämpöpumpun sisällä eivätkä ne vahvista kenttäputkien jälkeistä lämpötilaa.", (d) => d.valveDhw === true ? "Tilapiirin reittiä ei ole valittu; pumppu ja virtaama näyttävät todellisen säiliökierron erikseen."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `Jälkilämmin vesi kiertää tiloihin. R1T ${degC(d.lwt)}; luovuttimien jälkeen ei ole anturia. Tämä ei ole aktiivista jäähdytystä.` : `Vesi menee ${activeSpaceKind(d) === "cool" ? "jäähdytys" : activeSpaceKind(d) === "heat" ? "lämmitys" : "tila"}piiriin. R1T ${degC(d.lwt)}; luovuttimien jälkeen ei ole anturia.` : "Pumppu ja virtaama eivät vahvista tilapiirin kiertoa."], // heat
    ["Tilalämmitys/-jäähdytys", "Tilalämmityksen tai -jäähdytyksen toiminta", "Tilapiirin normaalin lämmityksen/jäähdytyksen tila. Ei termostaattipyyntö eikä yksin vahvista kompressoria."], // spaceh
    ["Huonelämpötila", "Huonelämpötila", "Vertailuvyöhykkeen lämpötila; tarkastele tavoitteen ja tilan kanssa."], // room
    ["Kiertovesipumppu", "Kiertovesipumpun nopeus", "Siirtää vettä yhteisessä piirissä ja 3WV:n valitsemalla reitillä. Voi käydä kompressorin seistessä jälkikierron tai suojauksen vuoksi; nopeus ei yksin vahvista virtaamaa.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `Pumppu ilmoittaa pysähtyneensä, mutta anturi näyttää ${fmt1(d.flow)} l/min. Syynä voi olla ulkoinen kierto, jälkikäynti tai ristiriitainen/vanha signaali; tarkista molemmat.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Nopeus ${fmt0(d.pump)} %; virtaama ${fmt1(d.flow)} l/min.` : `Nopeus ${fmt0(d.pump)} %, mutta virtaamamittausta ei ole; kiertoa ei vahvistettu.`
      : waterMoving(d) ? `Virtaama ${fmt1(d.flow)} l/min ilman käyttökelpoista pumppunopeutta.`
      : d.pumpOn === true ? d.flow != null ? `Pumppu PÄÄLLÄ, mutta virtaama vain ${fmt1(d.flow)} l/min; kiertoa ei vahvistettu.` : "Pumppu PÄÄLLÄ, mutta virtaamamittausta ei ole; kiertoa ei vahvistettu."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Pumppu pysähtynyt; anturi näyttää ${fmt1(d.flow)} l/min. Arvot eivät vahvista kiertoa.` : "Pumppu pysähtynyt, virtaamamittausta ei ole."
      : `Luotettavaa pumpputilaa ei ole; ${fmt1(d.flow)} l/min ei vahvista kiertoa.`], // pump
    [(d) => pelMeasured(d) ? "Sähköteho · HomeHub" : "Sähköteho (arvio)", "Sähköteho", (d) => pelMeasured(d) ? "HomeHub-rekisterin 51 sähköteho. Dokumentaatio ei vahvista kalibrointia, mittauskohtaa tai kaikkien lämmittimien sisältymistä; tämä ei ole sertifioitu järjestelmämittari." : "COP/EER-arvio: CT-vaiheiden summa × oletettu 230 V. Jännite ja tehokerroin ovat tuntemattomia; invertterivirta kattaa vain kompressorin ja CT-raja riippuu kytkennästä.", (d) => d.pelHeld ? "Kompressori on pysähtynyt, joten invertterivirta on edelliseltä käynniltä; sähkötehoa ja hyötysuhdetta ei voi ilmoittaa."
      : d.pel == null ? "Profiilissa ei ole nykyistä virtamittausta, joten COP/EER ei ole laskettavissa."
      : d.pelSrc === "MB" ? "Arvo HomeHub-rekisteristä 51; tarkkaa mittausrajaa ei ole dokumentoitu."
      : d.pelSrc === "CT" ? "CT-arvio; mukana olevat kuormat riippuvat kytkennästä." : "Invertterivirrasta — vain kompressori."], // pel
    ["Sulatus", "Sulatus", "Käänteinen kierto sulattaa jään ulkolämmönvaihtimesta; lämmitys keskeytyy hetkeksi.", (d) => d.defrost == null ? null : d.defrost ? "Sulatus aktiivinen." : "Pois — sulatus ei ole aktiivinen."], // defrost
    ["Hiljainen tila", "Hiljainen tila", "Vähentää melua yleensä rajoittamalla puhallinta tai kompressoria ja voi pienentää käytettävissä olevaa tehoa.", (d) => d.quiet == null ? null : d.quiet ? "Hiljainen tila aktiivinen." : "Pois — hiljainen tila ei ole aktiivinen."], // quiet
    ["Kaasulinja", "Kylmäaineen kaasulinja", "Split-yksiköiden välinen kylmäainelinja. Lämmityksessä kuuma korkeapainekaasu kulkee PHE:lle; jäähdytyksessä suunta vaihtuu. Monoblockissa linjaa ei ole.", (d) => compressorRunning(d) ? d.rps != null ? `Kierto — ${fmt1(d.circP)} bar lämpötilassa ${fmt0(d.disch)} °C.` : "Kierto — HomeHub vahvistaa kompressorin; paine ja lämpötila vaativat X10A:n." : "Ei aktiivista kylmäainekiertoa — kompressori pysähtynyt; paineen tasaantuminen riippuu piiristä ja pysähdysajasta."], // rhot
    ["Nestelinja", "Kylmäaineen nestelinja", "Split-yksiköiden välinen nestemäisen kylmäaineen linja. Lämmityksessä se palaa ulkoyksikön paisuntaventtiilille; jäähdytyksessä suunta vaihtuu. Monoblockissa linjaa ei ole.", (d) => compressorRunning(d) ? d.rps != null ? `Kierto — paisuntaventtiili ${fmt0(d.eev)} pulssia.` : "Kierto — HomeHub vahvistaa kompressorin; venttiilin asento vaatii X10A:n." : "Pysähtynyt — kompressori pois."], // rcold
    ["PHE:n lähtöputki", "PHE:n lähtöputki", "R1T:n vesi kulkee BUH:n ja pumpun läpi; 3WV ohjaa sen tiloihin tai säiliöön. Jäähdytyksessä tämä on kylmä puoli; BUH:n jälkeinen anturi voi sisältää sähkövastuksen lämmön.", (d) => waterMoving(d) ? `R1T ennen BUH:ta ${degC(d.lwt)}, ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; BUH aktiivinen jäljempänä" : ""}.` : "Pumppu ja virtaama eivät vahvista kiertoa putkessa."], // wsup
    ["Säiliöpiiri", "Säiliöpiiri", "Käyttövesi- tai varaajasäiliötä lämmittävä hydraulinen haara. Tarkka lämmönvaihdin riippuu rakenteesta; kuva näyttää toiminnon, ei mallin rakennetta.", (d) => d.valveDhw === true ? waterMoving(d) ? `Säiliö valittu, ${fmt1(d.flow)} l/min; PHE ${degC(d.lwt)}, säiliö ${degC(d.tank)}.` : "Säiliö valittu, mutta kierto ei vahvista aktiivista latausta." : "Säiliöreittiä ei ole valittu; ohjaus ilmoittaa tilapiirin."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Jäähdytyshaara" : activeSpaceKind(d) === "heat" ? "Lämmityshaara" : "Tilahaara", "Tilahaara", "Haara pattereille, lattialämmitykselle tai puhallinkonvektoreille. R1T/R4T mitataan lämpöpumpun sisällä, ei tässä haarassa; ΔT sisältää myös putkiston vaikutuksen.", (d) => d.valveDhw === true ? "Tilahaaraa ei ole valittu; ohjaus ilmoittaa säiliön." : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `Jälkilämmön kierto ${fmt1(d.flow)} l/min; ei aktiivista jäähdytystä. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.` : `Kierto tiloihin ${fmt1(d.flow)} l/min. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.` : "Tilahaaran kiertoa ei ole vahvistettu."], // wheat
    ["PHE:n paluuputki", "PHE:n paluuputki", "Yhteinen paluu R4T:lle säiliö- ja tilahaarojen yhdistyttyä. Lämmityksessä yleensä R1T:tä kylmempi, jäähdytyksessä lämpimämpi; R4T ei ole lämmönluovuttimien lähellä.", (d) => waterMoving(d) ? `Paluu ${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` : "Paluuputken kiertoa ei ole vahvistettu."], // wret
    ["Vesivirtaama", "Vesivirtaama", "Yhteisen piirin virtaama; vaadittu minimi riippuu mallista ja tilasta."], // flow
    ["Virtauskytkimen tila", "Virtauskytkimen tila", "X10A:n binääritila; ei mittaa l/min-arvoa eikä vahvista mallin minimivirtaamaa.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A PÄÄLLÄ; vertaa pumppuun ja arvoon ${fmt1(d.flow)} l/min.` : `X10A POIS; pumpun käydessä vertaa arvoa ${fmt1(d.flow)} l/min ja vikaa 7H/C0.`], // flow_switch
    ["Vedenpaine", "Vedenpaine", "Suljetun vesipiirin paine. Sallittu alue riippuu mallista, korkeuserosta ja paisuntasäiliöstä; katso ohjekirja."], // wp
  ],
);

HOMEHUB_LABEL_I18N.fi = homeHubValues([
  "Pääalueen lämmityksen menovesitavoite", // 1
  "Pääalueen jäähdytyksen menovesitavoite", // 2
  "Lämmitys-/jäähdytystila", // 3
  "Tilalämmitys/-jäähdytys sallittu", // 4
  "Pääalueen lämmitystavoite", // 6
  "Pääalueen jäähdytystavoite", // 7
  "Hiljainen tila", // 9
  "Käyttöveden uudelleenlämmitystavoite", // 10
  "Yksikön diagnostiikkatila", // 21
  "Yksikön vikakoodi", // 22
  "Yksikön vian alikoodi", // 23
  "Kiertovesipumppu aktiivinen", // 30
  "Kompressori aktiivinen", // 31
  "Säiliövastus aktiivinen", // 32
  "Säiliön desinfiointi aktiivinen", // 33
  "3-tieventtiilin asento", // 37
  "Nykyinen lämmitys-/jäähdytystila", // 38
  "PHE:n lähtölämpötila", // 40
  "Menovesi BUH:n jälkeen", // 41
  "Paluuveden lämpötila", // 42
  "Käyttövesisäiliön lämpötila", // 43
  "Ulkolämpötila", // 44
  "Nestepuolen kylmäaineen lämpötila", // 45
  "Vesivirtaama", // 49
  "Pääalueen huonelämpötila", // 50
  "Sähköteho", // 51
  "Käyttövesitoiminta", // 52
  "Tilalämmitys/-jäähdytys", // 53
  "Pääalueen lämmitysmenoveden korjaus", // 54
  "Smart Grid -tila", // 56
  "Varaajan tehoraja", // 57
  "Kokonaistehoraja", // 58
]);
