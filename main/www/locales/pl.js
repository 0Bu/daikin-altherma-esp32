// translation-source: bef241956252223e473986f0f04b14ff68b2285466e981c89ba24e3e766e587f
const plNoun = (n, one, few, many) => {
  const value = Math.abs(Number(n)), mod10 = value % 10, mod100 = value % 100;
  return value === 1 ? one
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many;
};
const plAria = (x) => (l, d) => `${l} — oś czasu ${x}. ${d}. Klawisze strzałek odczytują poszczególne próbki.`;
const plMb = (a, p = "przy rejestrze") => (r) => `${a}${r ? ` ${p} ${r}` : ""}.`;
I18N.pl = localeValues([
  /* sys.nodata */ "Brak danych",
  /* sys.unreachable */ "Nieosiągalne",
  /* sys.mb_only */ "X10A poza siecią — odczyty z Modbus",
  /* mode.stop */ "Zatrzymanie",
  /* mode.heat */ "Ogrzewanie",
  /* mode.cool */ "Chłodzenie",
  /* mode.space */ "Ogrz./chłodz. pomieszczeń",
  /* mode.dhw */ "Ciepła woda",
  /* mode.heat_dhw */ "Ogrzewanie + ciepła woda",
  /* mode.cool_dhw */ "Chłodzenie + ciepła woda",
  /* mode.space_dhw */ "Ogrz./chłodz. pomieszczeń + ciepła woda",
  /* sys.unreachable_sub */ "Nie można połączyć się z urządzeniem — ponawianie…",
  /* sys.waiting */ "Oczekiwanie na pompę ciepła…",
  /* sys.operating */ "Praca",
  /* sys.standby */ "Czuwanie — bez pracy",
  /* sys.defrosting */ "Odszranianie",
  /* sys.circulating */ "Cyrkulacja — sprężarka wyłączona",
  /* sys.cool_mode */ "Tryb chłodzenia",
  /* sys.residual_circulating */ "Cyrkulacja ciepła resztkowego — bez chłodzenia",
  /* sys.bsh_active */ "Elektryczna grzałka zbiornika aktywna",
  /* sys.disinfecting */ "Dezynfekcja zbiornika aktywna",
  /* sys.online */ "W sieci",
  /* sys.fault */ "Usterka",
  /* sys.warning */ "Ostrzeżenie",
  /* sys.fault_line */ (c) => "Usterka · " + c + " — sprawdź kod usterki Daikin.",
  /* sys.warning_line */ (c) => "Ostrzeżenie · " + c + " — sprawdź pompę ciepła.",
  /* sys.polled */ (s) => `Odczytano ${s} s temu`,
  /* config.unreadable_title */ "Nieczytelne ustawienia usług",
  /* config.unreadable_meta */ "Ta wersja nie mogła odczytać zapisanych ustawień usług. Używa ustawień zastępczych i nie zastąpiła zachowanej kopii. Nowsze zgodne oprogramowanie może ją przywrócić. Udany zapis ustawień usług ją zastępuje; zapis samych pinów X10A lub protokołu nie.",
  /* recovery.title */ "Tryb odzyskiwania",
  /* recovery.meta_heap */ "Urządzeniu wielokrotnie zabrakło pamięci i uruchomiło się ponownie. Działa teraz z wyłączonym połączeniem z pompą ciepła i MQTT, aby interfejs WWW pozostał dostępny. Konfiguracja jest najprawdopodobniej prawidłowa — zainstaluj nowszą wersję firmware w Ustawieniach. Wyłączenie i ponowne włączenie zasilania ponawia uruchomienie pełnego zestawu usług.",
  /* recovery.meta */ "Urządzenie wielokrotnie uruchomiło się ponownie i weszło w tryb odzyskiwania. Komunikacja z pompą ciepła i MQTT jest wstrzymana. Sprawdź konfigurację — zwłaszcza piny RX/TX na karcie Protokół w Ustawieniach — a następnie uruchom urządzenie ponownie.",
  /* rollback.title */ "Zmiana WiFi nie powiodła się — przywrócono poprzednie ustawienia",
  /* rollback.meta */ (back) => `Urządzenie nie mogło połączyć się z użyciem nowych ustawień WiFi. Przywróciło poprzednią sieć${back} i uruchomiło się ponownie. Sprawdź nazwę sieci i hasło w Ustawienia → Połączenia, a następnie spróbuj ponownie.`,
  /* crash.title_fault */ "Urządzenie uruchomiło się ponownie po błędzie",
  /* crash.title_orphan */ "Raport awarii oczekuje od wcześniejszego ponownego uruchomienia",
  /* crash.reset */ "Reset",
  /* crash.task */ "zadanie",
  /* crash.fw */ "FW",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "uszkodzony",
  /* crash.stored_dump */ "Zapisany raport awarii",
  /* crash.stored_hint */ "Wiek raportu i jego związek z tym ponownym uruchomieniem są nieznane.",
  /* crash.backtrace */ "Stos wywołań",
  /* crash.download */ "Pobierz raport awarii",
  /* crash.copy */ "Kopiuj diagnostykę",
  /* crash.dismiss */ "Usuń raport",
  /* crash.copied */ "Skopiowano diagnostykę — wklej ją do zgłoszenia błędu",
  /* crash.copy_fail */ "Kopiowanie nie powiodło się — otwórz ręcznie /coredump i /diag",
  /* crash.ask_dump */ "Usunąć z urządzenia? Zostanie również usunięty zrzut pamięci — najpierw pobierz go do zgłoszenia błędu.",
  /* crash.ask */ "Usunąć ten raport z urządzenia?",
  /* crash.ask_yes */ "Usuń",
  /* crash.ask_no */ "Zachowaj",
  /* crash.deleted */ "Usunięto raport awarii",
  /* crash.delete_fail */ "Urządzenie nie mogło go usunąć — raport nadal istnieje",
  /* bug.row */ "Zgłoś błąd",
  /* bug.title */ "Zgłoś błąd",
  /* bug.intro */ "Krótko opisz problem. Urządzenie doda swój stan, odczyty i dziennik po usunięciu nazw sieci, adresów i nazw serwerów.",
  /* bug.what */ "Co się dzieje",
  /* bug.need_text */ "Najpierw opisz, co się dzieje — wystarczy jedno lub dwa zdania.",
  /* bug.continue */ "Przygotuj raport",
  /* bug.step2_title */ "Sprawdź raport",
  /* bug.step2 */ "Sprawdź poniższy raport. Przycisk skopiuje go i otworzy formularz zgłoszenia GitHub z wypełnionym opisem. Wklej raport w pole „Device report”, odpowiedz na pozostałe pytania i wyślij zgłoszenie.",
  /* bug.collecting */ "Zbieranie danych urządzenia…",
  /* bug.collect_fail */ "Nie można odczytać urządzenia — poniższy raport wskazuje brakujące części.",
  /* bug.copy */ "Kopiuj i otwórz GitHub",
  /* bug.download */ "Pobierz .md",
  /* bug.md_hint */ "Jeśli kopiowanie się nie powiedzie lub wolisz plik, pobierz ten sam raport jako .md. Przeciągnij plik do pola „Device report” formularza zamiast wklejać tekst.",
  /* bug.copied */ "Skopiowano raport — wklej go w pole „Device report”",
  /* bug.copy_fail */ "Kopiowanie nie powiodło się — zaznacz poniższy tekst i skopiuj go ręcznie",
  /* bug.redacted */ "Nazwa sieci, adresy, broker i nazwy serwerów zostały już usunięte.",
  /* nav.settings */ "Ustawienia",
  /* nav.back */ "Wstecz",
  /* nav.cards */ "Karty panelu",
  /* nav.diagnosis */ "Diagnostyka",
  /* nav.outdoor */ "Jednostka zewnętrzna",
  /* nav.settings_alert */ (n) => `Ustawienia — ${n} ${plNoun(n, "połączenie niedostępne", "połączenia niedostępne", "połączeń niedostępnych")}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Oba źródła są zgodne",
  /* src.delta */ (d, u) => `Różnica ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Oba źródła podają różny stan",
  /* conn.homehub */ "HomeHub",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Połączenia",
  /* conn.offline */ "Poza siecią",
  /* conn.disabled */ "Wyłączone",
  /* conn.connecting */ "Łączenie…",
  /* conn.connected */ "Połączono",
  /* conn.resolving */ "Ustalanie adresu…",
  /* conn.eth_no_cable */ "Brak kabla",
  /* conn.eth_no_lease */ "Kabel podłączony, brak adresu",
  /* conn.eth_fd */ "pełny dupleks",
  /* conn.enabled */ "Włączone",
  /* conn.enabled_noping */ "Włączone, host nie odpowiada na ping",
  /* conn.synced */ "Zsynchronizowano",
  /* conn.syncing */ "Synchronizacja…",
  /* conn.error */ (e) => "Błąd: " + e,
  /* conn.connected_to */ (s) => "Połączono z " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Dotknij, aby edytować.`,
  /* modbus.err.mdns_not_found */ "Nie znaleziono HomeHub przez mDNS.",
  /* modbus.err.no_address */ "Nie skonfigurowano adresu HomeHub.",
  /* modbus.err.resolve_failed */ "Nie można ustalić adresu HomeHub.",
  /* modbus.err.connect_timeout */ "Upłynął limit czasu połączenia — HomeHub jest nieosiągalny.",
  /* modbus.err.connection_refused */ "HomeHub jest osiągalny, ale port Modbus TCP jest zamknięty.",
  /* modbus.err.network_unreachable */ "Brak trasy sieciowej do HomeHub.",
  /* modbus.err.host_unreachable */ "HomeHub jest nieosiągalny w sieci.",
  /* modbus.err.connect_failed */ "Połączenie z HomeHub nie powiodło się.",
  /* modbus.err.request_failed */ plMb("Nie można utworzyć żądania Modbus", "dla rejestru"),
  /* modbus.err.send_timeout */ plMb("Upłynął limit czasu wysyłania żądania Modbus"),
  /* modbus.err.send_failed */ plMb("Nie można wysłać żądania Modbus"),
  /* modbus.err.response_timeout */ plMb("Upłynął limit czasu odpowiedzi HomeHub"),
  /* modbus.err.connection_closed */ plMb("HomeHub zamknął połączenie"),
  /* modbus.err.receive_failed */ plMb("Nie można odczytać odpowiedzi HomeHub"),
  /* modbus.err.invalid_response */ plMb("Nieprawidłowa odpowiedź Modbus"),
  /* modbus.err.internal_error */ "Wewnętrzny błąd cyklu odpytywania Modbus.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub odrzucił rejestr ${r || "?"} (wyjątek ${n}: ${why}).`,
  /* modbus.exc.1 */ "niedozwolona funkcja",
  /* modbus.exc.2 */ "niedozwolony adres danych",
  /* modbus.exc.3 */ "niedozwolona wartość danych",
  /* modbus.exc.4 */ "awaria urządzenia",
  /* modbus.exc.5 */ "żądanie potwierdzone",
  /* modbus.exc.6 */ "urządzenie zajęte",
  /* modbus.exc.8 */ "błąd parzystości pamięci",
  /* modbus.exc.10 */ "ścieżka bramy niedostępna",
  /* modbus.exc.11 */ "urządzenie docelowe nie odpowiedziało",
  /* modbus.exc.unknown */ "nieznana przyczyna",
  /* card.model */ "Model",
  /* card.hplink */ "Połączenie z pompą ciepła",
  /* card.online */ "W sieci",
  /* card.uptime */ "Czas pracy",
  /* card.freeheap */ "Wolna pamięć",
  /* card.maxalloc */ "Największy wolny blok",
  /* card.offline */ "Poza siecią",
  /* card.protocol */ "Protokół",
  /* card.rxpin */ "Pin RX",
  /* card.txpin */ "Pin TX",
  /* card.capacity */ "Moc",
  /* card.hplink_help */ "Pokazuje, czy ESP32 odbiera obecnie prawidłowe odpowiedzi z pompy ciepła przez X10A.",
  /* card.protocol_help */ "X10A-I i X10A-S to dwa obsługiwane formaty ramek interfejsu serwisowego. Firmware rozpoznaje format na podstawie prawidłowych odpowiedzi.",
  /* card.rxpin_help */ "GPIO, na którym ESP32 odbiera dane X10A z pompy ciepła. Gdy połączenie jest poza siecią, wybranie pary rozpoczyna nową próbę automatycznego wykrywania.",
  /* card.txpin_help */ "GPIO, na którym ESP32 wysyła żądania X10A do pompy ciepła. RX i TX muszą być różne i zgodne z fizycznym okablowaniem.",
  /* card.capacity_iu */ "Moc (jednostka wewnętrzna)",
  /* card.candidates */ "Możliwe modele",
  /* card.oueeprom */ "ID jednostki zewnętrznej",
  /* card.checkup */ "Diagnostyka instalacji · 24 h",
  /* service.title */ "Obieg chłodniczy (CO)",
  /* service.state.waiting */ "CZEKA",
  /* service.state.observing */ "ZAPIS",
  /* service.state.limited */ "CZĘŚCIOWO",
  /* service.state.interrupted */ "PAUZA",
  /* service.reason.unsupported_profile */ "Ten model nie udostępnia wszystkich potrzebnych odczytów.",
  /* service.reason.compressor_not_running */ "Sprężarka nie pracuje.",
  /* service.reason.unsupported_or_unknown_mode */ "Normalne ogrzewanie pomieszczeń niepotwierdzone.",
  /* service.reason.dhw_path */ "Pompa ciepła ogrzewa ciepłą wodę użytkową.",
  /* service.reason.defrost */ "Jednostka zewnętrzna jest odszraniana.",
  /* service.reason.unit_fault */ "Pompa ciepła zgłasza usterkę lub ostrzeżenie.",
  /* service.reason.special_controller_phase */ "Aktywna jest krótka faza rozruchu lub specjalnej regulacji.",
  /* service.reason.missing_fresh_signal */ "Brakuje co najmniej jednego potrzebnego bieżącego odczytu.",
  /* service.reason.poll_gap */ "Połączenie X10A zostało przerwane lub celowo wstrzymane.",
  /* service.window */ (d, n) => `${d} · ${n} ${n === 1 ? "bieżący odczyt" : "bieżące odczyty"}`,
  /* service.help.observing */ "Rejestrowanie tego cyklu ogrzewania.",
  /* service.help.limited */ "Rejestracja trwa; brakujący kontekst podano wyżej.",
  /* service.help.interrupted */ "Wznawia przy kolejnym odpowiednim cyklu ogrzewania.",
  /* service.common */ "Jeden cykl ogrzewania, oddzielny od sprawdzeń 24 h. Bez diagnozy ilości czynnika lub normalnych zakresów. Zawór: polecenie, nie zmierzona pozycja.",
  /* check.fault */ "Usterka jednostki",
  /* check.dhw_loss */ "Wychładzanie CWU",
  /* check.cycling */ "Starty sprężarki",
  /* check.defrost */ "Odszraniania",
  /* check.pressure */ "Ciśnienie wody",
  /* check.flow */ "Min. przepływ",
  /* check.flow.lowest */ "Najniższy przepływ podczas ogrzewania",
  /* check.flow.runup */ "Pomiary są uwzględniane po co najmniej dziesięciu minutach ciągłego ogrzewania pomieszczeń.",
  /* check.flow.assessment */ "Instrukcja montażu podaje minimalny przepływ dla każdego modelu i trybu pracy. Zbyt mały przepływ może wywołać błąd 7H.",
  /* check.flow.explain */ "Przepływ pokazuje, ile litrów wody przepływa przez pompę ciepła w ciągu minuty.",
  /* check.flow.pump */ "Sygnał sterujący pompą",
  /* check.flow.live */ "Teraz",
  /* check.flow.show */ "Pokaż minimum na wykresie",
  /* check.flow.readout */ (value) => `W tym przedziale co najmniej raz zmierzono ${value}. Ogrzewanie pomieszczeń trwało już od co najmniej dziesięciu minut.`,
  /* check.flow.locations_missing */ "Nie zapisano czasu starszych pomiarów o tej wartości.",
  /* check.flow.x10a_only */ "Najniższy przepływ podczas ogrzewania jest obliczany na podstawie pomiarów X10A.",
  /* check.flow.waiting */ "Oczekiwanie na okres ogrzewania spełniający warunki pomiaru.",
  /* check.heater */ "Grzałki",
  /* check.retries */ "Liczniki ochrony",
  /* check.status.ok */ "OK",
  /* check.status.info */ "INFO",
  /* check.status.warn */ "UWAGA",
  /* check.status.collecting */ "W TOKU",
  /* check.status.observation */ "POMIAR",
  /* check.status.experimental */ "TESTOWO",
  /* check.status.unavailable */ "N/D",
  /* check.status.no_window */ "BRAK OKNA",
  /* check.dhw.maximum */ "Największy godzinowy spadek temperatury na czujniku zasobnika",
  /* check.dhw.hour_unit */ "°C na godzinę",
  /* check.dhw.timeline */ "Historia z 24 godzin",
  /* check.dhw.context_title */ "Przyczyna nieznana",
  /* check.dhw.context_hour */ "Godzina pomiaru z tą wartością",
  /* check.dhw.context_missing */ "Czas i okoliczności tego pomiaru są niedostępne.",
  /* check.dhw.context_pump */ "W ciągu tej godziny pracowała wewnętrzna pompa wody pompy ciepła.",
  /* check.dhw.context_draw */ "Szybki spadek temperatury może wynikać z poboru ciepłej wody albo szybkiego stygnięcia.",
  /* check.dhw.context_quiet */ "Nie wykryto pracy pompy ani spadku przypominającego pobór wody. Pobór ciepłej wody nadal jest możliwy.",
  /* check.dhw.context_selected */ "Przyczyna tego spadku pozostaje niejasna.",
  /* check.dhw.hint */ "Godzina bez zarejestrowanych oznak pompy lub poboru osiągnęła próg orientacyjny projektu.",
  /* check.dhw.before_snapshot */ (d) => `${d} przed zapisem stanu`,
  /* check.dhw.marker_yes */ "zarejestrowano",
  /* check.dhw.marker_no */ "nie zarejestrowano",
  /* check.dhw.pump */ "Pompa wewnętrzna",
  /* check.dhw.draw */ "Spadek podobny do poboru",
  /* check.dhw.previous */ "Poprzednie ukończone okno",
  /* check.dhw.next */ "Następne ukończone okno",
  /* check.dhw.timeline_unavailable */ "Brak okien z czasami. Historia nie jest odtwarzana z sum.",
  /* check.dhw.timeline_empty */ "Brak ukończonych okien z danymi czasowymi w tym widoku 24 h.",
  /* check.dhw.chart_title */ "Chłodzenie w ukończonym oknie",
  /* check.dhw.timed_scope */ (n) => `Zmierzone godziny na wykresie: ${n} (ostatnie 24 h). Maksimum i liczniki mogą też opierać się na zapisanych danych godzinowych, nie tylko na oknach wykresu.`,
  /* check.dhw.blank */ "Obszary kreskowane: brak dostępnego ukończonego okna z danymi czasowymi, nie zerowe chłodzenie. Znaki oznaczają obecność, nie czas trwania.",
  /* check.dhw.snapshot */ "Stan danych",
  /* check.dhw.stale */ "Bieżące odczyty do oceny wychładzania zasobnika CWU są niedostępne lub nieaktualne; zakończone okna pozostają obserwacjami historycznymi.",
  /* check.dhw.limit */ "R5T mierzy jeden punkt warstwowego zasobnika, nie jego energię. Oznaki pompy i poboru nie dowodzą ani przyczyny, ani poboru wody.",
  /* check.dhw.basis */ "Szczegóły danych",
  /* check.dhw.energy */ "Przykład obliczeń · nie pomiar energii",
  /* check.detail.dhw_energy */ (a, b, c, d) => `Przykład jednej godziny: 200 l wody stygnącej równomiernie o ${a} K/h → ${b} kWh ciepła; uzupełnienie ${c}–${d} kWh prądu przy założonym COP 2,5–3 (ciepło ÷ prąd). Nie jest to pomiar energii.`,
  /* check.detail.dhw_context */ (a, b, c) => `Okna: pompa wewnętrzna ${a}; spadek podobny do poboru ${b}; bez oznaczeń ≥0,8 K/h ${c}. Mogą się pokrywać.`,
  /* check.detail.value_label */ "Wartość:",
  /* check.detail.assessment_label */ "Ocena:",
  /* check.detail.ok */ "Reguła nie zadziałała w czytelnych danych.",
  /* check.detail.info */ "Zaobserwowana wskazówka; ograniczenie opisano niżej.",
  /* check.detail.warn */ "Błąd urządzenia lub zaobserwowane trwałe niskie ciśnienie.",
  /* check.detail.fault.error */ "Jednostka zgłasza obecnie błąd. Dokładny kod znajduje się na karcie „Praca”.",
  /* check.detail.fault.warning */ "Jednostka zgłasza obecnie ostrzeżenie lub przestrogę, a nie błąd. Dokładny kod znajduje się na karcie „Praca”.",
  /* check.detail.fault.past */ "Obecnie brak komunikatu; w tym okresie zapisano komunikat. Zniknięcie nie potwierdza przyczyny ani usunięcia problemu.",
  /* check.detail.fault.past_unknown */ "Zapisano komunikat; bieżący stan usterki jest nieczytelny.",
  /* check.detail.collecting */ (a, b) => `Czytelne sygnały: ${a} z wymaganych ${b}.`,
  /* check.detail.outdoor_defrost */ " Dane zewnętrzne X10A obejmują tylko świeże próbki, gdy stan odszraniania i sprężarki był czytelny, a sprężarka pracowała. Stanowią kontekst i nie zmieniają progu ani oceny odszraniania.",
  /* check.detail.dhw_candidate */ (a, b, c, d) => `Przyjęte okna godzinowe: ${a}; bieżący kandydat: ${c} z ${d}.`,
  /* check.detail.dhw_settling */ (a, b, c) => `Przyjęte okna godzinowe: ${a}; wykryto ładowanie lub grzałkę zasobnika. Pozostały czas stabilizacji: ${c}.`,
  /* check.detail.dhw_waiting */ (a, b) => `Przyjęte okna godzinowe: ${a}; oczekiwanie na kolejną odpowiednią godzinę.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${plNoun(n, "odrzucone okno kandydujące", "odrzucone okna kandydujące", "odrzuconych okien kandydujących")} (${reasons}); najdłuższe osiągnęło ${best} z 60 min.`,
  /* check.detail.dhw_blocked */ (a, b, c) => "Brak pełnej godziny w 24 h." + (a > 0 ? ` Odrzucone okna: ${a} (${b}); najdłuższe ${c}.` : ""),
  /* check.detail.dhw_blocked_link */ (a, b) => `Brak odpowiedniego okna godzinowego w 24 h: Przerwane okna: ${a}, przez zbyt długi brak wymaganych odczytów; najdłuższy ${b} z 60 min. Brak odpowiedzi lub przerwy odpytywania tworzą luki. Nie ocenia to zasobnika.`,
  /* check.detail.dhw_reason.charge */ "ładowanie zbiornika",
  /* check.detail.dhw_reason.pump */ "pompa wewnętrzna",
  /* check.detail.dhw_reason.draw */ "spadek podobny do poboru",
  /* check.detail.dhw_reason.reading */ "R5T niepotwierdzone",
  /* check.detail.dhw_reason.blind */ "brak odczytów: X10A milczy lub odpytywanie wstrzymane",
  /* check.detail.collecting_unknown */ "Brak bieżącej oceny.",
  /* check.detail.observation */ "Tylko obserwacja; bez uniwersalnej granicy OK/UWAGA.",
  /* check.detail.experimental */ "Liczniki eksperymentalne; stabilność nie wyklucza ograniczeń.",
  /* check.detail.unavailable */ "Brak ocenialnego sygnału w tym profilu.",
  /* check.starts */ (n) => `${n} ${plNoun(n, "uruchomienie", "uruchomienia", "uruchomień")}`,
  /* check.cycles */ (n) => `${n} ${plNoun(n, "cykl", "cykle", "cykli")}`,
  /* check.paired_cycles */ (n) => `${n} ${plNoun(n, "sparowany", "sparowane", "sparowanych")}`,
  /* check.cycling.runs */ (n) => `${n} ${plNoun(n, "cykl", "cykle", "cykli")}`,
  /* check.cycling.mean */ (d) => `Śr. ${d}`,
  /* check.cycling.completed */ "Zakończone cykle",
  /* check.cycling.unclear */ "Nieustalone",
  /* check.cycling.unclear_hint */ "W trakcie cyklu tryb może się zmienić lub może brakować części pomiarów.",
  /* check.cycling.short */ "Cykle ogrzewania trwają średnio krótko.",
  /* check.cycling.normal */ "Cykle ogrzewania trwają średnio wystarczająco długo.",
  /* check.cycling.few */ "Jeszcze za mało cykli ogrzewania.",
  /* check.cycling.waiting */ "Potrzeba więcej danych.",
  /* check.cycling.class_unavailable */ "Ta instalacja podaje za mało informacji o cyklach ogrzewania.",
  /* check.cycling.unavailable */ "Brak danych ze sprężarki.",
  /* check.cycling.stale */ "Chwilowo brakuje odczytów.",
  /* check.cycling.history_empty */ "Nie ma jeszcze historii.",
  /* check.cycling.timed_starts */ (s) => `${s} z zarejestrowaną godziną`,
  /* check.cycling.run_start */ "Uruchomienie",
  /* check.cycling.run_stop */ "Zatrzymanie",
  /* check.cycling.run_duration */ "Czas trwania",
  /* check.cycling.run_ongoing */ "W trakcie pracy",
  /* check.cycling.run_stop_unknown */ "Czas zatrzymania nieznany",
  /* check.cycling.no_timed_runs */ "W tej godzinie nie zarejestrowano czasu uruchomienia.",
  /* check.cycling.run_details_unavailable */ "Brak czasów poszczególnych cykli dla tej godziny.",
  /* check.cycling.saved_starts */ (s) => `W tym ${s} z zapisów godzinowych sprzed restartu.`,
  /* check.cycling.short_runs */ (n) => `${n} < 5 min`,
  /* check.cycling.col_stop */ "Dlaczego się zatrzymała",
  /* check.cycling.stop_low_flow */ "Zasilanie ponad cel · niski przepływ",
  /* check.cycling.stop_low_rps */ "Zasilanie ponad cel · niskie obroty",
  /* check.cycling.stop_req_off */ "Zakończono żądanie sprężarki",
  /* check.cycling.stop_tgt_drop */ "Obniżono temperaturę zadaną",
  /* check.cycling.stop_defrost */ "Przerwa na odszranianie",
  /* check.cycling.stop_defrost_done */ "Odszranianie zakończone",
  /* check.cycling.stop_dhw */ "Przełączono na CWU",
  /* check.cycling.stop_normal_dhw */ "Zakończono cykl CWU",
  /* check.cycling.stop_normal */ "Zwykłe zatrzymanie",
  /* check.cycling.out_cond */ (v) => ` (${v} na zewn.)`,
  /* check.cycling.find_low_flow */ (minFlow, typ) => `Krótkie cykle, mały przepływ: nad cel w min (${minFlow}${typ}).`,
  /* check.cycling.find_low_rps */ (flow, cond) => `Krótkie cykle, niskie obr.${cond}: nad cel po starcie (${flow}).`,
  /* check.cycling.find_control */ "Stop sterowania: żądanie off lub niższy cel.",
  /* check.cycling.find_defrost_dhw */ (cond) => `Odszranianie & CWU${cond}: przerwa na odszranianie i CWU.`,
  /* check.cycling.find_defrost */ (cond) => `Odszranianie${cond}: przerwa na odszranianie.`,
  /* check.cycling.find_dhw */ "CWU: przerwa dla CWU.",
  /* check.cycling.find_steady */ (flow) => flow ? `Stabilne grzanie: min. ${flow}.` : "Stabilne grzanie.",
  /* check.cycling.pause_tag */ (d) => ` po przerwie ${d}`,
  /* check.cycling.cond_tag */ (lwt, tgt) => tgt ? `zasilanie ${lwt}, cel ${tgt}` : `zasilanie ${lwt}`,
  /* check.cycling.from_tag */ (prev) => ` z ${prev}`,
  /* check.cycling.rwt_tag */ (rwt) => `powrót ${rwt}`,
  /* check.cycling.typ_tag */ (typ) => `, zwykle ${typ}`,
  /* check.cycling.s_cool */ (at, pause, lwt, tgt) => `Start ${at}${pause}: zasilanie ${lwt}, cel ${tgt}, żądanie aktywne.`,
  /* check.cycling.s_req */ (at, pause, cond) => `Start ${at}${pause}: żądanie aktywne${cond}.`,
  /* check.cycling.s_tgt */ (at, pause, prev, tgt, cond) => `Start ${at}${pause}: cel podniesiony${prev} na ${tgt}${cond}.`,
  /* check.cycling.s_defrost_after */ (at, pause, cond) => `Wznowiono ${at}${pause}, odszranianie zakończone${cond}.`,
  /* check.cycling.s_dhw_after */ (at, pause, cond) => `Wznowiono ${at}${pause}, CWU zakończone${cond}.`,
  /* check.cycling.s_defrost */ (at, pause) => `Start ${at}${pause} na odszranianie.`,
  /* check.cycling.s_dhw */ (at, pause, cond) => `Start ${at}${pause} dla CWU${cond}.`,
  /* check.cycling.s_gen */ (at, pause, cond) => `Start ${at}${pause}${cond}.`,
  /* check.cycling.e_low_flow */ (to, lwt, tgt, rwt, flow, typ) => `Stop ${to}: zasilanie ${lwt} ponad cel ${tgt}${rwt} przy ${flow}${typ}.`,
  /* check.cycling.e_low_rps */ (to, lwt, tgt, rwt, flow, rps) => `Stop ${to}: zasilanie ${lwt} ponad cel ${tgt}${rwt} przy ${flow} i ${rps}.`,
  /* check.cycling.e_req */ (to, vals) => `Stop ${to}: żądanie zakończone${vals}.`,
  /* check.cycling.e_tgt */ (to, prev, tgt, vals) => `Stop ${to}: cel obniżony${prev} na ${tgt}${vals}.`,
  /* check.cycling.e_defrost_run */ (to, vals) => `Odszranianie zakończone ${to}${vals}.`,
  /* check.cycling.e_defrost_pause */ (to, vals) => `Stop ${to} na odszranianie${vals}.`,
  /* check.cycling.e_dhw */ (to, vals) => `Stop ${to}: przejście na CWU${vals}.`,
  /* check.cycling.e_norm */ (to, vals) => `Koniec ${to}${vals}.`,
  /* check.cycling.e_ongoing */ "Praca przy ostatnim odczycie.",
  /* check.cycling.cause_unavailable */ "Brak szczegółów",
  /* check.cycling.cause_older_unavailable */ "Brak zapisanych szczegółów uruchomienia i zatrzymania dla tych wcześniejszych cykli.",
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · średnia ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank_runtime */ (d) => `zbiornik ${d}`,
  /* check.buh_runtime */ (d) => `dodatkowa ${d}`,
  /* check.buh_short */ "Wsp.",
  /* check.tank_short */ "Zas.",
  /* check.hour.latest */ "Ostatni przedział",
  /* check.hour.earlier */ (h) => `${h} godz. wcześniej`,
  /* check.hour.other */ "Inne / nieznane",
  /* check.hour.gap */ "Luka w pomiarach",
  /* check.hour.coverage */ (observed, possible) => possible ? `Zaobserwowano ${observed} z ${possible}` : `Zaobserwowano ${observed} · nieznany czas od początku`,
  /* check.hour.ending */ (time) => `Koniec przedziału ${time}`,
  /* check.hour.saved */ (time) => `Zapisana godzina ${time}`,
  /* check.loss_windows */ (n) => `${n} ${plNoun(n, "okno", "okna", "okien")}`,
  /* check.fault_err */ "Usterka aktywna",
  /* check.fault_warn */ "Ostrzeżenie aktywne",
  /* check.fault_past */ "Wcześniej aktywna",
  /* check.fault_none */ "Brak aktywnych",
  /* check.fault_unknown */ "Stan nieznany",
  /* check.fault_past_unknown */ "Była · stan nieznany",
  /* check.fault_since_short */ (d) => `od ${d}`,
  /* check.fault_ago_short */ (d) => `${d} temu`,
  /* check.fault_hero_ok */ (d) => `Brak zgłoszonych usterek lub ostrzeżeń w ciągu ${d} z 24 h obserwacji.`,
  /* check.fault_latched_only */ "Pompa ciepła zgłasza zapisaną flagę usterki; w zarejestrowanym oknie 24 h nie mieści się żaden epizod ze znacznikiem czasu.",
  /* check.fault_unit_outdoor */ "Jednostka zewnętrzna",
  /* check.fault_unit_indoor */ "Jednostka wewnętrzna",
  /* check.fault_unit_both */ "Zewnętrzna + wewnętrzna",
  /* check.fault_secondary */ (s) => `Aktywne także: ${s}`,
  /* check.fault_stop_ongoing */ "aktywna",
  /* check.fault_stop_unknown */ "niejasne",
  /* check.fault_col_code */ "Kod",
  /* check.fault_col_meaning */ "Znaczenie",
  /* check.fault_ok_label */ "Bez usterek",
  /* check.fault_gap_label */ "Brak pomiaru",
  /* check.fault_severity_caution */ "Uwaga",
  /* check.retry_seen */ "Wzrost",
  /* check.retry_none */ "Bez wzrostu",
  /* service.metric.comp */ "Sprężarka",
  /* service.metric.disch */ "Temperatura tłoczenia",
  /* service.metric.eev */ "Polecenie zaworu rozprężnego",
  /* service.metric.hp */ "Wysokie ciśnienie",
  /* service.metric.lp */ "Niskie ciśnienie",
  /* check.hydronic.agree_labels */ "Tylko pompa R1T−R4T|Tylko pompa R2T−R1T|Stan zgodności|Ograniczenia zgodności",
  /* check.hydronic.agree_reasons */ "Przepływ poniżej 5,0 l/min|Sprężarka pracuje|Grzałka aktywna lub niejasna|Zmiana zaworu 3-drożnego|Temperatury niestacjonarne",
  /* check.hydronic.agree_limits */ "R2T niedostępny|Uwzględniono obieg CWU",
  /* check.hydronic.agree_meta */ "okna|odczyty|Tylko zgodność pasywna; nie kalibracja; obce ciepło niewykluczone.",
  /* service.metric.range */ (a, b, c, d) => `min. ${a} · średnia ${b} · maks. ${c} ${d}`,
  /* service.metric.samples */ n => `Liczba przyjętych odczytów: ${n}`,
  /* service.metric.input_none */ "Brak wybranego wejścia",
  /* service.metric.meta_limit */ "Liczby to przyjęte odczyty, a nie pokrycie czasu. Wybrane wejście nie potwierdza bieżącego odczytu.",
  /* service.limit.special_phases_unavailable */ "Fazy sterownika",
  /* service.limit.temperature_context_incomplete */ "Kontekst temperatur",
  /* service.limit.pressure_sides_incomplete */ "Strona/y ciśnienia",
  /* service.limit.outdoor_context_incomplete */ "Kontekst zewnętrzny",
  /* service.row.limits */ "Brakujący kontekst:",
  /* check.loss_max */ (a) => `maks. ${a} K/h`,
  /* check.loss_high */ (a, b) => `${a}/${b} okien: próg osiągnięty`,
  /* check.detail.period_label */ "Okres danych:",
  /* check.detail.period */ (a) => `${a}, maks. 24 h; możliwe luki`,
  /* check.detail.age_label */ "Wiek ostatniego pomiaru:",
  /* check.detail.horizon_wait */ (a) => `Brakuje pełnego okna 24 godzin: pozostało ${a}.`,
  /* check.detail.fault.ok */ "Brak bieżącego lub zapisanego komunikatu w czytelnych sygnałach usterek.",
  /* check.detail.defrost.info */ "≥3 powiązane odszraniania przekraczają 15% czytelnego czasu sprężarki: wskazówka projektu.",
  /* check.detail.defrost.ok */ "Bez wskazówki udziału; pogoda i luki nieocenione.",
  /* check.defrost.last_start */ (date, route, outdoor) => `Ostatni zaobserwowany początek odszraniania · ${date} · Obieg ${route} · Powietrze zewnętrzne ${outdoor}`,
  /* check.defrost.route_space */ "Ogrzewanie pomieszczeń",
  /* check.defrost.route_dhw */ "Zasobnik ciepłej wody",
  /* check.detail.pressure.info */ "Niskie",
  /* check.detail.pressure.warn */ "Krytyczne",
  /* check.detail.pressure.ok */ "W normie",
  /* check.detail.defrost_events_insufficient */ "Mniej niż trzy powiązane odszraniania; bez oceny udziału.",
  /* check.detail.source_stale */ "Brak świeżego odczytu X10A; bieżący stan nieznany. Historia zachowana.",
  /* check.detail.no_paired_runtime */ "Brak powiązanego czytelnego czasu; tylko liczba.",
  /* check.detail.current_label */ "≤1,0 bar niskie",
  /* check.detail.minimum_time_label */ "≤0,5 bar krytyczne",
  /* check.detail.coverage_missing */ (a) => `Brakujący czytelny czas: ${a} s.`,
  /* check.detail.channel_coverage */ (a, b) => `${a}: pokrycie ${b}`,
  /* check.summary.warnings */ (n) => `${n} ${n === 1 ? "ostrzeżenie" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "ostrzeżenia" : "ostrzeżeń"}`,
  /* check.summary.notes */ (n) => `${n} ${n === 1 ? "informacja" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "informacje" : "informacji"}`,
  /* check.summary.ok */ "Bez wskazówek w ocenionych danych",
  /* check.summary.collecting */ "Zbieranie danych",
  /* check.summary.observations */ "Obserwacje",
  /* values.waiting */ "Oczekiwanie na pierwszy odczyt…",
  /* values.sg_x10a_mode */ "Tryb Smart Grid (styki X10A)",
  /* group.Operation */ "Praca",
  /* group.Domestic hot water */ "Ciepła woda użytkowa",
  /* group.Water circuit */ "Obieg wodny",
  /* group.Refrigerant / outdoor */ "Czynnik chłodniczy / zewnętrzne",
  /* group.Electrical */ "Elektryczne",
  /* group.Device */ "Urządzenie",
  /* group.Other values */ "Inne wartości",
  /* group.Protection */ "Zabezpieczenia",
  /* protect.limiting */ "ograniczenie aktywne",
  /* group.Values */ "Wartości",
  /* state.on */ "WŁ.",
  /* state.off */ "WYŁ.",
  /* enum.auto */ "Auto",
  /* enum.heating */ "Ogrzewanie",
  /* enum.cooling */ "Chłodzenie",
  /* enum.no_error */ "Brak błędu",
  /* enum.fault */ "Usterka",
  /* enum.warning */ "Ostrzeżenie",
  /* enum.space_heating */ "Ogrzewanie pomieszczeń",
  /* enum.dhw */ "CWU",
  /* enum.free_running */ "Praca swobodna",
  /* enum.forced_off */ "Wymuszone wyłączenie",
  /* enum.recommended_on */ "Zalecane włączenie",
  /* enum.forced_on */ "Wymuszone włączenie",
  /* enum.space_cooling */ "Chłodzenie pomieszczeń",
  /* enum.none */ "Brak",
  /* enum.reduced */ "Ograniczone",
  /* enum.automatic */ "Automatyczny",
  /* enum.manual */ "Ręczny",
  /* enum.actuator */ "Siłownik",
  /* enum.tank_heat_up */ "Podgrzewanie zbiornika",
  /* a4.quiet_selection */ "Wybór trybu cichego",
  /* a4.heating_offset */ "Korekta ogrzewania zależnego od pogody, główna strefa",
  /* a4.imposed_power_limit */ "Narzucony limit mocy",
  /* a4.pre_phe_outdoor */ "Temperatura wody przed zewnętrznym wymiennikiem płytowym",
  /* a4.main_target */ "Nastawa ogrzewania/chłodzenia, główna strefa",
  /* a4.quiet_help */ "Wybiera Wyłączony, Automatyczny lub Ręczny tryb cichy. Nie informuje, czy tryb cichy jest teraz aktywny; wybrany poziom lub harmonogram może nadal przewidywać Wyłączony.",
  /* a4.current_help */ "Zgłasza Brak, Ogrzewanie lub Chłodzenie dla klimatyzacji pomieszczeń. Odczytuj razem z flagą normalnej pracy; nie dowodzi to, że sprężarka pracuje.",
  /* a4.limit_help */ "Narzucony limit mocy elektrycznej, a nie zmierzony pobór. Praca ochronna może przekroczyć to ustawienie.",
  /* a4.demand_help */ "Zgłasza Praca swobodna, Wymuszone wyłączenie, Wymuszone włączenie, Zalecane włączenie lub Ograniczone jako reakcję na zapotrzebowanie energetyczne. Te kody liczbowe różnią się od skonfigurowanego wyboru Smart Grid.",
  /* a4.operation_help */ "Zgłasza Zatrzymanie, Podgrzewanie zbiornika, Ogrzewanie pomieszczeń, Chłodzenie pomieszczeń lub Pracę siłownika. To zgłoszony stan, a nie dowód użytecznego przekazywania ciepła.",
  /* a4.heating_offset_help */ "Przesuwa pogodową krzywą grzewczą strefy głównej w kelwinach. To przesunięcie, nie zmierzona temperatura ani pełna temperatura zadana wody.",
  /* a4.pre_phe_outdoor_help */ "Temperatura wody przed zewnętrznym płytowym wymiennikiem ciepła. To czujnik po stronie wody, nie temperatura powietrza zewnętrznego ani czynnika chłodniczego.",
  /* a4.flow_help */ "Skalowanie przepływu Altherma 4 nie zostało potwierdzone. Wartość L/min używa dotychczasowego przeliczenia; przed oceną wydajności porównaj ją z odczytem urządzenia.",
  /* a4.pump_help */ "Instrukcja Altherma 4 nazywa tę wartość prędkością pompy, ale podaje L/min. Wyświetlana jednostka % jest niepotwierdzonym założeniem; porównaj z odczytem urządzenia.",
  /* a4.pressure_help */ "Skalowanie ciśnienia Altherma 4 nie zostało potwierdzone. Wartość bar używa dotychczasowego przeliczenia; przed oceną ciśnienia porównaj ją z odczytem urządzenia.",
  /* a4.demand_response */ "Tryb reakcji na zapotrzebowanie",
  /* a4.unit_operation */ "Stan pracy jednostki",
  /* a4.cooling_offset */ "Korekta pogodowa chłodzenia, strefa główna",
  /* a4.add_target */ "Cel grzania/chłodzenia, strefa dodatkowa",
  /* a4.abnormality_counter */ "Licznik błędów użytkownika",
  /* a4.cooling_offset_help */ "Przesuwa krzywą pogodową chłodzenia strefy głównej w kelwinach. Jest to korekta, nie zmierzona temperatura ani pełna nastawa wody.",
  /* a4.abnormality_help */ "Łączna liczba błędów użytkownika zarejestrowanych przez jednostkę. Niezmienna wartość niezerowa dotyczy zdarzeń z przeszłości, nie aktywnej usterki; sprawdź stan diagnostyczny i kod błędu.",
  /* enum.unknown */ (n) => `Nieznane (${n})`,
  /* chip.space_on */ "Obieg WŁ.",
  /* chip.space_off */ "Obieg WYŁ.",
  /* chip.quiet */ "Cichy",
  /* schem.sg_boost */ "WZMOCN.",
  /* sg.mode0 */ "Praca swobodna",
  /* sg.mode1 */ "Wymuszone wyłączenie",
  /* sg.mode2 */ "Zalecane włączenie",
  /* sg.mode3 */ "Wymuszone włączenie",
  /* schem.to_dhw */ "3WV → CWU",
  /* schem.to_space */ "3WV → dom",
  /* normal.label */ "Norma:",
  /* meaning.label */ "Jak to odczytać:",
  /* hist.title */ "Ostatnie 24 godziny",
  /* hist.recorded */ (h) => `Zarejestrowano · ${h} h`,
  /* hist.now */ "teraz",
  /* hist.ago */ (h) => `${h} h temu`,
  /* hist.retained */ "Ostatnia odebrana próbka",
  /* hist.before_retained */ (h) => `${h} godz. przed ostatnią odebraną próbką`,
  /* hist.loading */ "Ładowanie przebiegu…",
  /* hist.none */ "Nie zarejestrowano jeszcze odczytów.",
  /* hist.err */ "Przebieg niedostępny.",
  /* hist.gaps */ (n) => `${n} ${plNoun(n, "przerwa", "przerwy", "przerw")} — brak pomiaru`,
  /* hist.nm */ "brak pomiaru",
  /* hist.rel */ (h) => `${h} h temu`,
  /* hist.held */ "jednostka zewnętrzna w spoczynku",
  /* hist.heldnote */ (h) => `${h} h spoczynku — brak pomiaru`,
  /* hist.aria */ (l) => `${l} — przebieg 24-godzinny. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.aria_pinned */ (l, r) => `${l} — przebieg 24-godzinny. Przypięty odczyt: ${r}. Dotknij ponownie, aby wyczyścić.`,
  /* hist.pin_hint */ "dotknij, aby przypiąć",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} h`,
  /* hist.duration_hm */ (h, m) => `${h} h ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · około ${d}`,
  /* hist.state_active */ "Aktywne",
  /* hist.state_off */ "Wyłączone",
  /* val.since */ (d) => `od ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `brak obserwacji przez ${d}`,
  /* hist.modbus_plateau */ (when, d) => `rejestr bez zmian ${when} · około ${d} · wiek pomiaru nieznany`,
  /* hist.boost_total */ (d) => `Wzmocnienie aktywne · ${d}`,
  /* hist.boost_none */ "Brak wzmocnienia w zarejestrowanym okresie.",
  /* hist.boost_ago_range */ (a, b) => `${a}–${b} h temu`,
  /* hist.boost_active */ "Wzmocnienie aktywne",
  /* hist.boost_inactive */ "Wzmocnienie wyłączone",
  /* hist.boost_aria */ plAria("stanu Smart Grid ze wszystkimi czterema trybami"),
  /* hist.defrost_total */ (d) => `Zaobserwowane aktywne odszranianie · ${d} próbkowanego czasu`,
  /* hist.defrost_none */ "Nie zaobserwowano cyklu odszraniania w zarejestrowanym okresie.",
  /* hist.defrost_active */ "Odszranianie aktywne",
  /* hist.defrost_inactive */ "Odszranianie wyłączone",
  /* hist.defrost_aria */ plAria("odszraniania"),
  /* hist.quiet_total */ (d) => `Zaobserwowany aktywny tryb cichy · ${d} próbkowanego czasu`,
  /* hist.quiet_none */ "Nie zaobserwowano okresu trybu cichego w zarejestrowanym okresie.",
  /* hist.quiet_active */ "Tryb cichy aktywny",
  /* hist.quiet_inactive */ "Tryb cichy wyłączony",
  /* hist.quiet_aria */ plAria("trybu cichego"),
  /* hist.heater_total */ (d) => `Zaobserwowana aktywna grzałka · ${d} próbkowanego czasu`,
  /* hist.heater_none */ "Nie zaobserwowano użycia grzałki zbiornika w zarejestrowanym okresie.",
  /* hist.heater_active */ "Grzałka aktywna",
  /* hist.heater_inactive */ "Grzałka wyłączona",
  /* hist.heater_aria */ plAria("grzałki zbiornika"),
  /* hist.preheat_total */ (d) => `Zaobserwowane aktywne wstępne podgrzewanie zbiornika · ${d} próbkowanego czasu`,
  /* hist.preheat_none */ "Nie zaobserwowano okresu wstępnego podgrzewania zbiornika w zarejestrowanym okresie.",
  /* hist.preheat_active */ "Wstępne podgrzewanie zbiornika aktywne",
  /* hist.preheat_inactive */ "Wstępne podgrzewanie zbiornika wyłączone",
  /* hist.preheat_aria */ plAria("wstępnego podgrzewania zbiornika X10A"),
  /* hist.disinfection_total */ (d) => `Zaobserwowana aktywna dezynfekcja · ${d} próbkowanego czasu`,
  /* hist.disinfection_none */ "Nie zaobserwowano dezynfekcji w zarejestrowanym okresie.",
  /* hist.disinfection_active */ "Dezynfekcja aktywna",
  /* hist.disinfection_inactive */ "Dezynfekcja wyłączona",
  /* hist.disinfection_aria */ plAria("dezynfekcji HomeHub"),
  /* hist.buh_total */ (d) => `Zaobserwowana aktywna grzałka dodatkowa · ${d} próbkowanego czasu`,
  /* hist.buh_none */ "Nie zaobserwowano użycia grzałki dodatkowej w zarejestrowanym okresie.",
  /* hist.buh_active */ "Grzałka dodatkowa aktywna",
  /* hist.buh_inactive */ "Grzałka dodatkowa wyłączona",
  /* hist.buh_step1 */ "Stopień 1",
  /* hist.buh_step2 */ "Stopień 2",
  /* hist.buh_aria */ plAria("grzałki dodatkowej"),
  /* hist.valve_dhw_total */ (d) => `CWU · ${d}`,
  /* hist.valve_space_total */ (d) => `Obieg pomieszczeń · ${d}`,
  /* hist.valve_none */ "Brak pozycji CWU w zarejestrowanym okresie.",
  /* hist.valve_dhw */ "CWU",
  /* hist.valve_space */ "Obieg pomieszczeń",
  /* hist.valve_aria */ plAria("zaworu 3-drogowego"),
  /* hist.circ_total */ (d) => `Zaobserwowana praca pompy · ${d} próbkowanego czasu`,
  /* hist.circ_none */ "Nie zaobserwowano pracy pompy w zarejestrowanym okresie.",
  /* hist.circ_on */ "Pracuje",
  /* hist.circ_off */ "Zatrzymana",
  /* hist.circ_unavailable */ "Niedostępne",
  /* hist.circ_gaps */ (n) => `${n} ${plNoun(n, "niedostępny okres", "niedostępne okresy", "niedostępnych okresów")}`,
  /* hist.circ_aria */ plAria("pompy cyrkulacyjnej"),
  /* hist.valve2_on_total */ (d) => `Wyjście 2WV WŁ. · ${d}`,
  /* hist.valve2_off_total */ (d) => `Wyjście 2WV WYŁ. · ${d}`,
  /* hist.valve2_on */ "Wyjście 2WV WŁ.",
  /* hist.valve2_off */ "Wyjście 2WV WYŁ.",
  /* hist.valve2_none */ "Nie zarejestrowano włączenia wyjścia zaworu 2-drogowego w wybranym okresie.",
  /* hist.valve2_aria */ plAria("wyjścia zaworu 2-drogowego"),
  /* hist.flow_switch_total */ (d) => `Stan X10A WŁ. · ${d} próbkowanego czasu`,
  /* hist.flow_switch_on */ "Stan X10A WŁ.",
  /* hist.flow_switch_off */ "Stan X10A WYŁ.",
  /* hist.flow_switch_none */ "Nie zarejestrowano włączenia tego stanu X10A w wybranym okresie.",
  /* hist.flow_switch_aria */ plAria("styku przepływu wody"),
  /* hist.comp_total */ (d, n) => `Sprężarka · ${d} · ${n} ${n === 1 ? "faza" : "faz"}`,
  /* hist.comp_none */ "W zarejestrowanym okresie nie zaobserwowano pracy sprężarki.",
  /* hist.comp_active */ "Sprężarka pracuje",
  /* hist.comp_inactive */ "Sprężarka wyłączona",
  /* hist.comp_aria */ plAria("sprężarki HomeHub"),
  /* hist.mb_defrost_total */ (d) => `Odszranianie / restart · ${d}`,
  /* hist.mb_defrost_none */ "W zarejestrowanym okresie nie zaobserwowano fazy odszraniania ani restartu.",
  /* hist.mb_defrost_active */ "Odszranianie / restart",
  /* hist.mb_defrost_inactive */ "Normalnie / postój",
  /* hist.mb_defrost_aria */ plAria("odszraniania/restartu HomeHub"),
  /* hist.pump_total */ (d) => `Pompa · ${d}`,
  /* hist.pump_none */ "W zarejestrowanym okresie nie zaobserwowano pracy pompy obiegowej.",
  /* hist.pump_active */ "Pompa pracuje",
  /* hist.pump_inactive */ "Pompa wyłączona",
  /* hist.pump_aria */ plAria("pompy obiegowej HomeHub"),
  /* toast.saved */ "Zapisano",
  /* toast.no_changes */ "Brak zmian",
  /* toast.reboot */ "Ponowne uruchamianie — łączenie…",
  /* toast.rebooted */ "Uruchomiono ponownie — połącz się ponownie z urządzeniem",
  /* board.draft_stale */ "Ustawienia płytki się zmieniły. Otwórz edytor ponownie przed zapisaniem.",
  /* toast.busy_retry */ "Urządzenie zajęte — spróbuj ponownie za chwilę",
  /* toast.unreachable */ "Nie można połączyć się z urządzeniem",
  /* toast.rejected */ "Odrzucono",
  /* toast.applying */ "Nadal stosowana jest ostatnia zmiana…",
  /* toast.check_wifi */ "Sprawdź ustawienia WiFi",
  /* toast.check_broker */ "Sprawdź adres brokera",
  /* toast.check_syslog_port */ "Sprawdź port Syslog",
  /* toast.verifying_mqtt */ "Weryfikacja połączenia MQTT…",
  /* toast.saving_syslog */ "Zapisywanie ustawień Syslog…",
  /* toast.saving_ntp */ "Zapisywanie ustawień NTP…",
  /* toast.trying_pins */ "Sprawdzanie pinów…",
  /* toast.saving_board */ "Zapisywanie sprzętu płytki…",
  /* ota.uptodate */ "aktualne",
  /* ota.check_failed */ "sprawdzenie nie powiodło się",
  /* ota.starting */ "uruchamianie…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "ponowne uruchamianie…",
  /* ota.failed */ "aktualizacja nie powiodła się",
  /* ota.timeout */ "upłynął limit czasu",
  /* ota.cancelled */ "anulowano",
  /* ota.busy */ "urządzenie zajęte",
  /* ota.replaced */ "Operacja aktualizacji zmieniła się — sprawdź ponownie",
  /* ota.unreachable */ "urządzenie nieosiągalne",
  /* ota.active_title */ "Aktualizacja firmware",
  /* ota.active_sub */ (detail) => `Instalacja w toku · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Instalacja w toku · ${detail} · ostatni odebrany stan`,
  /* ota.snapshot_title */ "Aktualizacja firmware",
  /* ota.snapshot_label */ "Stan danych",
  /* ota.snapshot_value */ "Migawka",
  /* ota.snapshot_help */ "Ostatni stan odebrany przed ponownym załadowaniem. Dane na żywo mogą zostać wstrzymane podczas instalacji; ustawienia pozostają zablokowane do ponownego uruchomienia.",
  /* ota.reload_hint */ "zainstalowano — załaduj stronę ponownie",
  /* ota.dialog_title */ "Aktualizacja firmware",
  /* ota.switch_title */ "Zmień wersję firmware",
  /* ota.changes_title */ "Zmiany w tej aktualizacji",
  /* ota.no_changes */ "Dla tej aktualizacji nie dostarczono listy zmian.",
  /* ota.install_help */ "Urządzenie pobierze i zainstaluje podpisany obraz, a następnie uruchomi się ponownie. Jeśli nowy firmware nie uzyska połączenia, urządzenie automatycznie przywróci bieżącą kompilację.",
  /* ota.switch_help */ "Ta kompilacja jest starsza, ponieważ wybrano inny kanał aktualizacji. Jej podpis zostanie sprawdzony przed instalacją. Jeśli starsza kompilacja nie uzyska połączenia, urządzenie automatycznie przywróci bieżącą kompilację.",
  /* ota.install */ "Zainstaluj aktualizację",
  /* ota.switch */ "Zainstaluj starszą kompilację",
  /* aria.ota */ "Sprawdź aktualizacje firmware",
  /* ota.title_check */ "Dotknij, aby sprawdzić aktualizacje firmware",
  /* ota.title_avail */ (v) => `Dostępna aktualizacja v${v} — dotknij, aby zainstalować`,
  /* mq.err_format */ "Wpisz host:port — np. 192.168.1.10:1883 — lub mqtts://host:8883 dla TLS",
  /* sl.err_port */ "Port musi być liczbą całkowitą od 1 do 65535 (np. logs.example.com:514).",
  /* btn.saving */ "Zapisywanie…",
  /* btn.verifying */ "Weryfikacja…",
  /* btn.save */ "Zapisz",
  /* btn.cancel */ "Anuluj",
  /* btn.close */ "Zamknij",
  /* schem.card_aria */ "Schemat instalacji na żywo: jednostka zewnętrzna, obieg czynnika chłodniczego, wymiennik płytowy, obieg wody z grzałką pomocniczą i zaworem 3-drogowym, zasobnik CWU i obieg domu",
  /* schem.group_aria */ "Schemat instalacji na żywo — wybierz wartość lub element, aby wyświetlić objaśnienie",
  /* schem.outdoor_unit */ "JEDNOSTKA ZEWNĘTRZNA",
  /* schem.defrost_pill */ "❄ odszran.",
  /* schem.outdoor */ "Zewn.",
  /* insp.close */ "Zamknij",
  /* schem.defrost_transfer */ "Podczas potwierdzonego odszraniania ciepło może przepływać z wody do czynnika chłodniczego. Rury wskazują ten kierunek tylko wtedy, gdy potwierdzają go bieżący przepływ i temperatury.",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "ZBIORNIK CWU",
  /* schem.set */ "zadana",
  /* schem.bsh_label */ "Grzałka el.",
  /* schem.space_circuit */ "OBIEG DOMU",
  /* schem.heating */ "OGRZEWANIE",
  /* schem.cooling */ "CHŁODZENIE",
  /* schem.pump */ "POMPA",
  /* schem.return */ "R4T",
  /* schem.room */ "Pokój",
  /* schem.flow_rate */ "przepływ",
  /* schem.water_press */ "ciśnienie wody",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "STYK PRZ.",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Konfiguracja WiFi",
  /* wifi.ssid */ "Sieć WiFi (SSID)",
  /* wifi.pass */ "Hasło WiFi",
  /* wifi.err_ssid */ "SSID musi mieć od 1 do 32 bajtów UTF-8",
  /* wifi.err_pass */ "Hasło musi być puste (sieć otwarta) albo mieć od 8 do 63 bajtów UTF-8",
  /* wifi.hint */ "Wpisz nazwę sieci WiFi. Jeśli urządzenie nie może się połączyć, automatycznie przywróci poprzednie ustawienia WiFi.",
  /* mqtt.title */ "Broker MQTT",
  /* mqtt.hostport */ "Host : port",
  /* mqtt.user */ "Nazwa użytkownika · opcjonalna",
  /* mqtt.pass */ "Hasło · opcjonalne",
  /* mqtt.clear */ "Usuń zapisane dane logowania — połącz anonimowo",
  /* mqtt.hint */ "Nazwa użytkownika lub hasło wymagają szyfrowanego połączenia TLS (mqtts://, na przykład mqtts://host:8883). Pozostaw host pusty, aby wyłączyć MQTT.",
  /* mqtt.base */ "Temat bazowy",
  /* mqtt.base_hint */ "Jeden temat bazowy na urządzenie. Druga płytka u tego brokera potrzebuje własnego, inaczej obie będą współdzielić tematy, metryki i urządzenie Home Assistant. Zmiana nazwy powoduje zmianę nazwy tej instalacji w Home Assistant i pozostawia u brokera stare tematy retained.",
  /* err.mqtt_base_too_long */ "Temat bazowy jest za długi.",
  /* err.mqtt_base_wildcard */ "Temat bazowy nie może zawierać + ani # — to symbole wieloznaczne subskrypcji, a broker odmawia publikowania w takich tematach.",
  /* err.mqtt_base_reserved */ "Temat bazowy nie może zaczynać się od $ — to drzewo należy do brokera.",
  /* err.mqtt_base_slash */ "Temat bazowy nie może zaczynać się ani kończyć ukośnikiem.",
  /* err.mqtt_base_control */ "Temat bazowy nie może zawierać znaków sterujących.",
  /* err.mqtt_base_space */ "Temat bazowy nie może zawierać spacji.",
  /* err.mqtt_base_empty_segment */ "Temat bazowy nie może zawierać pustego segmentu (//).",
  /* err.mqtt_base_not_sluggable */ "Temat bazowy musi zawierać co najmniej jedną literę lub cyfrę — staje się identyfikatorem urządzenia tej instalacji w Home Assistant, a bez niego dwa urządzenia weszłyby w konflikt.",
  /* mqtt.err.waiting_x10a */ "Brak odpowiedzi pompy ciepła przez X10A — sprawdź okablowanie, GND i piny RX/TX.",
  /* mqtt.err.task_alloc */ "Nie można uruchomić zadania MQTT — uruchom urządzenie ponownie i sprawdź diagnostykę.",
  /* mqtt.err.transport */ "Połączenie TLS/TCP z brokerem nie powiodło się.",
  /* mqtt.err.refused */ "Broker odrzucił połączenie — sprawdź nazwę użytkownika i hasło.",
  /* mqtt.err.connection */ "Połączenie z brokerem MQTT nie powiodło się.",
  /* dyn.state_gate */ "Stan instalacji nieznany",
  /* dyn.state_mode */ "Tryb ogrzewania/chłodzenia nieznany",
  /* env.title */ "Czujnik zewnętrzny",
  /* env.card */ "Klimat zewnętrzny",
  /* env.none */ "Brak czujnika",
  /* env.temperature */ "Temperatura",
  /* env.humidity */ "Wilgotność",
  /* env.pressure */ "Ciśnienie powietrza",
  /* env.sensor_state */ "Czujnik",
  /* env.live */ "Na żywo",
  /* env.collecting */ "Zbieranie…",
  /* env.history_title */ "Pomiary ENV III",
  /* env.history_help */ "Temperatura, wilgotność i ciśnienie powietrza są przechowywane w ESP32 jako kroczące przebiegi 24-godzinne w odstępach pięciominutowych.",
  /* env.history_scales */ "oddzielne skale",
  /* env.unavailable */ "Czujnik niedostępny",
  /* env.err_pins */ "SDA i SCL muszą być różnymi prawidłowymi pinami",
  /* env.saving */ "Zapisywanie konfiguracji czujnika zewnętrznego…",
  /* env.checking */ "Sprawdzanie ENV III…",
  /* env.err_not_reachable */ "ENV III jest obecnie nieosiągalny na tych pinach SDA/SCL.",
  /* env.err_sht30 */ "Czujnik temperatury/wilgotności ENV III jest nieosiągalny na tych pinach.",
  /* env.err_qmp6988 */ "Czujnik ciśnienia ENV III jest nieosiągalny na tych pinach.",
  /* env.err_disable_first */ "Wybierz Brak czujnika i zapisz przed zmianą pinów SDA/SCL.",
  /* env.pins_hint */ "SDA = dane (żółty przewód Grove); SCL = zegar (biały przewód Grove). Jeśli dwa wybrane GPIO są zamienione, firmware sprawdzi odwrotną kolejność i automatycznie zapisze działające przypisanie.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: użyj dwóch z oferowanych pinów — złącze obudowy udostępnia GPIO5–GPIO8 i GPIO38. Port Grove (GPIO2/1) pojawia się tylko wtedy, gdy nie jest używany przez połączenie X10A: jeden styk nie może jednocześnie obsługiwać łącza szeregowego i magistrali I2C. GPIO39 jest niedostępny dla ENV III.",
  /* circ.title */ "Źródło pompy cyrkulacyjnej",
  /* circ.row */ "Pompa cyrkulacyjna CWU",
  /* circ.default_name */ "Pompa cyrkulacyjna",
  /* circ.name */ "Nazwa",
  /* circ.topic */ "Temat MQTT",
  /* circ.power_path */ "Ścieżka JSON mocy",
  /* circ.time_path */ "Ścieżka JSON znacznika czasu",
  /* circ.power_help */ "Rzeczywista moc czynna w watach; wyjście przekaźnika nie jest używane.",
  /* circ.time_help */ "Czas pomiaru jako RFC3339 lub sekundy Unix.",
  /* circ.on_threshold */ "WŁ. od · W",
  /* circ.off_threshold */ "WYŁ. do · W",
  /* circ.max_age */ "Maksymalny wiek · sekundy",
  /* circ.confirm */ "Potwierdzenie · sekundy",
  /* circ.hint */ "Tylko odczyt. Zapisanie najpierw sprawdza jedną świeżą wartość MQTT i nigdy nie przełącza gniazdka.",
  /* circ.settings_help */ "Płytka koreluje rzeczywistą moc pompy z czystymi godzinnymi oknami stygnięcia zbiornika. Tylko obserwuje i nigdy nie przełącza gniazdka.",
  /* circ.not_configured */ "Nieskonfigurowane",
  /* circ.unavailable */ "Niedostępne",
  /* circ.broker_off */ "Brak brokera MQTT",
  /* circ.running */ "Pracuje",
  /* circ.stopped */ "Zatrzymana",
  /* circ.checking */ "Sprawdzanie",
  /* circ.stale */ "Nieaktualne",
  /* circ.waiting */ "Oczekiwanie na komunikat",
  /* circ.detail.source */ "Źródło",
  /* circ.detail.power */ "Moc czynna",
  /* circ.detail.state */ "Wykryty stan",
  /* circ.detail.age */ "Wiek pomiaru",
  /* circ.delete */ "Usuń",
  /* circ.deleting */ "Usuwanie…",
  /* circ.deleted */ "Usunięto źródło pompy cyrkulacyjnej",
  /* circ.saved */ "Zapisano źródło pompy cyrkulacyjnej",
  /* circ.test_failed */ "Nie odebrano czytelnej, świeżej wartości mocy pompy",
  /* circ.err_topic */ "Wpisz dokładny temat MQTT bez symboli wieloznacznych + ani #",
  /* circ.err_power_path */ "Wpisz ścieżkę JSON mocy czynnej, na przykład apower",
  /* circ.err_time_path */ "Wpisz ścieżkę JSON znacznika czasu, na przykład aenergy.minute_ts",
  /* circ.err_max_age */ "Maksymalny wiek musi być liczbą całkowitą od 10 do 3600 sekund",
  /* circ.err_confirm */ "Potwierdzenie musi być liczbą całkowitą od 1 do 600 sekund",
  /* circ.err_threshold */ "Progi mocy mogą mieć najwyżej jedno miejsce po przecinku",
  /* circ.err_order */ "Próg WŁ. musi być większy niż próg WYŁ.",
  /* syslog.title */ "Serwer Syslog",
  /* syslog.hostport */ "Host : port",
  /* syslog.hint */ "Wpisz serwer Syslog jako nazwę hosta lub adres IP wraz z portem. Pozostaw pole puste, aby wyłączyć Syslog.",
  /* ntp.title */ "Serwer NTP",
  /* ntp.server */ "Serwer",
  /* ntp.hint */ "Wpisz nazwę hosta lub adres IP serwera czasu. Pozostaw pole puste, aby użyć wartości domyślnej firmware.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Host · IP lub nazwa .local",
  /* homehub.port */ "Port",
  /* homehub.unit */ "ID jednostki",
  /* homehub.hint */ "Świeżo zainstalowany firmware automatycznie wyszukuje HomeHub raz przy pierwszym uruchomieniu z siecią i zapisuje wynik. Wyszukiwanie można także uruchomić ręcznie tutaj. Zapisz wynik lub wpisz adres ręcznie. Zapisanie pustego adresu trwale wyłącza HomeHub: bez przyszłego automatycznego wyszukiwania, żądań Modbus ani zależnej diagnostyki. Domyślny port to 502, a ID jednostki 1. To okno konfiguruje wyłącznie źródło danych; nie udostępnia sterowania pompą ciepła.",
  /* hh.search */ "Szukaj",
  /* hh.searching */ "Wyszukiwanie…",
  /* hh.found */ (host) => `Znaleziono HomeHub: ${host}`,
  /* hh.not_found */ "Nie znaleziono HomeHub — wpisz adres ręcznie.",
  /* hh.saved */ "Zapisano ustawienia Modbus",
  /* hh.err_port */ "Port musi mieścić się w zakresie od 1 do 65535",
  /* hh.err_unit */ "ID jednostki musi mieścić się w zakresie od 1 do 247",
  /* board.title */ "Sprzęt płytki",
  /* board.ledtype */ "Dioda stanu",
  /* board.none */ "Brak",
  /* board.reset_section */ "Przycisk reset",
  /* board.env3_section */ "ENV III · Czujnik zewnętrzny",
  /* board.preset */ "Płytka",
  /* board.preset_custom */ "Niestandardowa",
  /* board.not_selected */ "Nie wybrano",
  /* board.led_gpio */ "Zwykła dioda LED (GPIO)",
  /* board.led_ws2812 */ "Adresowalna RGB (WS2812)",
  /* board.ledpin */ "Pin LED",
  /* board.btnpin */ "Pin przycisku reset",
  /* board.ledlegend_rgb */ "Kolory i wzory migania diody LED",
  /* board.ledlegend_gpio */ "Wzory migania diody LED",
  /* board.led_rgb_off */ "Wyłączona — brak aktywnej sieci.",
  /* board.led_rgb_setup */ "Niebieska, wolno miga — portal konfiguracji aktywny.",
  /* board.led_rgb_connecting */ "Żółta, szybko miga — łączenie z siecią.",
  /* board.led_rgb_healthy */ "Zielona, świeci stale — X10A i, jeśli skonfigurowano, MQTT połączone.",
  /* board.led_rgb_bus_down */ "Czerwona, podwójny błysk — X10A rozłączone lub tryb odzyskiwania.",
  /* board.led_rgb_mqtt_down */ "Pomarańczowa, miga — X10A połączone, MQTT rozłączone.",
  /* board.led_rgb_wipe_armed */ "Czerwona, bardzo szybko miga — kasowanie uzbrojone; zwolnij, aby anulować.",
  /* board.led_rgb_wiping */ "Biała, świeci stale — reset/kasowanie danych; nie odłączaj zasilania.",
  /* board.led_gpio_off */ "Wyłączona — brak aktywnej sieci.",
  /* board.led_gpio_setup */ "Wolno miga — portal konfiguracji aktywny.",
  /* board.led_gpio_connecting */ "Szybko miga — łączenie z siecią.",
  /* board.led_gpio_healthy */ "Świeci stale — X10A i, jeśli skonfigurowano, MQTT połączone.",
  /* board.led_gpio_bus_down */ "Podwójny błysk — X10A rozłączone lub tryb odzyskiwania.",
  /* board.led_gpio_mqtt_down */ "Miga ze średnią szybkością — X10A połączone, MQTT rozłączone.",
  /* board.led_gpio_wipe_armed */ "Bardzo szybko miga — kasowanie uzbrojone; zwolnij, aby anulować.",
  /* board.led_gpio_wiping */ "Świeci stale po szybkim miganiu — reset/kasowanie danych; nie odłączaj zasilania.",
  /* board.ledinv */ "Aktywny stan niski (dioda świeci, gdy pin jest ustawiony na LOW)",
  /* board.btninv */ "Aktywny stan niski (przycisk zwiera pin do GND)",
  /* board.hint */ "Reset fabryczny: przytrzymaj przycisk przez 5 s. Jeśli dziennik historii nie jest gotowy, żadne dane nie zostaną usunięte. Usuwa ustawienia Wi-Fi i inne ustawienia, zapisaną historię, czasy trwania stanów, surowy zrzut pamięci po awarii i zapisany rekord do czyszczenia MQTT. Ustawienia płytki, diody LED i przycisku pozostają, jeśli to możliwe. Błąd podczas kasowania może sprawić, że tylko część danych zostanie usunięta. Urządzenie uruchomi się ponownie tylko po pomyślnym wykonaniu wszystkich kroków kasowania. Jeśli reset się nie rozpocznie lub nie zakończy, sprawdź /diag. Bez podłączonego przycisku wybierz „Brak”.",
  /* card.hardware */ "Sprzęt",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite to kompaktowa płytka ESP32-S3 z wbudowaną diodą stanu RGB WS2812.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 to kompaktowa płytka ESP32-S3 firmy Seeed Studio.",
  /* card.hw_board_other */ (name) => `Wybrana płytka: ${name}.`,
  /* card.hw_active_low */ "aktywny LOW",
  /* card.hw_active_high */ "aktywny HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} na GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Nieskonfigurowane.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Nieskonfigurowane.",
  /* card.hw_env_detail */ (sda, scl) => `SDA na GPIO${sda}, SCL na GPIO${scl}.`,
  /* card.hw_env_disabled */ "Nieskonfigurowane.",
  /* card.firmware */ "Wersja",
  /* card.channel */ "Kanał aktualizacji",
  /* card.firmware_help */ "Wersja aktualnie działająca na ESP32. Dotknij wartości, aby sprawdzić wybrany kanał aktualizacji pod kątem podpisanego obrazu firmware.",
  /* card.channel_help */ "Kanał wydań śledzi ręcznie publikowane stabilne wersje. Kanał rozwojowy śledzi najnowsze scalenie dotyczące oprogramowania. Zmiana kanału natychmiast sprawdza źródło aktualizacji.",
  /* chan.release */ "Wydania",
  /* chan.dev */ "Rozwój",
  /* chan.saved */ (c) => `Kanał aktualizacji: ${c}`,
  /* card.proto_title */ "Protokół",
  /* card.fw_title */ "Oprogramowanie",
  /* settings.diagnostics */ "Diagnostyka instalacji",
  /* card.language */ "Język",
  /* card.language_help */ "Przeglądarka używa własnych preferencji językowych. Wybranie języka zapisuje stały język interfejsu dla całego urządzenia.",
  /* card.diagnostics */ "Diagnostyka instalacji",
  /* card.diagnostics_help */ "Włącza 24-godzinną kontrolę instalacji i opcjonalne monitorowanie mocy pompy cyrkulacyjnej.",
  /* diagnostics.off */ "Wyłączona",
  /* diagnostics.saved_on */ "Włączono diagnostykę instalacji — zbieranie rozpoczyna się teraz",
  /* diagnostics.saved_off */ "Wyłączono diagnostykę instalacji — zbieranie zatrzymane",
  /* probe.toggle */ "Diagnostyka protokołu",
  /* probe.intro */ "Bezpośredni odczyt strony rejestrów X10A z opcjonalnym przeliczeniem wartości.",
  /* probe.request */ "Żądanie",
  /* probe.register */ "Rejestr",
  /* probe.manual */ "Wpis ręczny",
  /* probe.page */ "Strona rejestru",
  /* probe.offset */ "Przesunięcie w danych",
  /* probe.size */ "Szerokość pola",
  /* probe.byte */ "bajt",
  /* probe.bytes */ "bajty",
  /* probe.converter */ "Przelicznik",
  /* probe.page_help */ "Szesnastkowo lub dziesiętnie · 0…255",
  /* probe.offset_help */ "Indeks w danych · 0…31",
  /* probe.size_help */ "Bajty do dekodowania",
  /* probe.converter_auto */ "Automatycznie",
  /* probe.converter_auto_help */ size=>`Sprawdza wszystkie dostępne przeliczniki dla pola ${size}-bajtowego.`,
  /* probe.conv_raw_byte */ "surowy bajt · 0…255",
  /* probe.conv_unsigned_byte */ "bajt bez znaku",
  /* probe.conv_tenth_byte */ "surowy bajt × 0,1",
  /* probe.conv_unsigned_half_byte */ "bajt bez znaku × 0,5",
  /* probe.conv_signed_raw_le */ "liczba ze znakiem · little-endian",
  /* probe.conv_signed_raw_be */ "liczba ze znakiem · big-endian",
  /* probe.conv_signed_256_le */ "ze znakiem ÷ 256 · little-endian",
  /* probe.conv_signed_256_be */ "ze znakiem ÷ 256 · big-endian",
  /* probe.conv_signed_tenth_le */ "ze znakiem × 0,1 · little-endian",
  /* probe.conv_signed_tenth_be */ "ze znakiem × 0,1 · big-endian",
  /* probe.conv_signed_tenth_nodata_le */ "ze znakiem × 0,1 · little-endian · 0x8000 = brak danych",
  /* probe.conv_signed_tenth_nodata_be */ "ze znakiem × 0,1 · big-endian · 0x8000 = brak danych",
  /* probe.conv_signed_128_le */ "ze znakiem ÷ 256 × 2 · little-endian",
  /* probe.conv_signed_128_be */ "ze znakiem ÷ 256 × 2 · big-endian",
  /* probe.conv_signed_half_be */ "ze znakiem × 0,5 · big-endian",
  /* probe.conv_signed_hundredth_be */ "ze znakiem × 0,01 · big-endian",
  /* probe.conv_unsigned_raw_le */ "liczba bez znaku · little-endian",
  /* probe.conv_unsigned_raw_be */ "liczba bez znaku · big-endian",
  /* probe.conv_unsigned_half_be */ "bez znaku × 0,5 · big-endian",
  /* probe.conv_saturation */ "ciśnienie → temperatura nasycenia",
  /* probe.conv_raw_fan */ "surowy bajt / stopień wentylatora",
  /* probe.conv_capacity */ "kod mocy jednostki wewnętrznej",
  /* probe.conv_eeprom_digit */ "surowa cyfra EEPROM",
  /* probe.conv_eeprom_pair */ "para surowych cyfr EEPROM",
  /* probe.conv_bits_high */ "bity 4–6 · licznik 3-bitowy",
  /* probe.conv_bits_low */ "bity 0–2 · licznik 3-bitowy",
  /* probe.conv_operation_mode */ "tryb pracy",
  /* probe.conv_error_class */ "klasa błędu",
  /* probe.conv_error_code */ "kod błędu Daikin",
  /* probe.conv_indoor_mode */ "tryb jednostki wewnętrznej · starszy półbajt",
  /* probe.conv_hybrid_mode */ "tryb hybrydowy",
  /* probe.conv_bit */ bit=>`bit ${bit} · 0 lub 1`,
  /* probe.conv_unknown */ "nieznany przelicznik",
  /* probe.send */ "Odczytaj rejestr",
  /* probe.querying */ "Odczyt…",
  /* probe.action_note */ "Jedno żądanie na cykl odpytywania. Blokowane podczas OTA.",
  /* probe.catalog_loading */ "Wczytywanie aktywnego profilu…",
  /* probe.catalog_empty */ "Brak dostępnych definicji rejestrów.",
  /* probe.catalog_error */ "Nie udało się wczytać rejestrów profilu.",
  /* probe.catalog_profile */ profile=>`Profil: ${profile}`,
  /* probe.catalog_fallback */ (definition,profile)=>`main/def: ${definition} · profil: ${profile}`,
  /* probe.response */ "Odpowiedź",
  /* probe.frame */ "Ramka",
  /* probe.payload */ "Dane",
  /* probe.slice */ "Wybrane bajty",
  /* probe.interpretation */ "Interpretacja",
  /* probe.response_for */ reg=>`Odpowiedź rejestru ${reg}`,
  /* probe.payload_marked */ "Dane · zaznaczono wybrane bajty",
  /* probe.slice_note */ (offset,size,slice)=>`Przesunięcie ${offset} · ${size} bajt${size===1?"":"y"} · 0x${String(slice).replace(/\s+/g,"")}`,
  /* probe.full_frame */ "Pełna ramka",
  /* probe.decode_value */ "Wynik przelicznika",
  /* probe.no_decodes */ "Brak wyniku przelicznika.",
  /* probe.refused */ "Wartość odrzucona",
  /* probe.unimplemented */ "Niezaimplementowane",
  /* probe.aliases */ "także",
  /* probe.invalid */ "Sprawdź stronę, przesunięcie, szerokość pola i przelicznik.",
  /* probe.failed */ "Żądanie nie powiodło się.",
  /* probe.status_ok */ "Prawidłowa odpowiedź",
  /* probe.status_busy */ "Zajęte",
  /* probe.status_no_link */ "Brak łącza X10A",
  /* probe.status_timeout */ "Przekroczono czas",
  /* probe.status_no_reply */ "Brak odpowiedzi",
  /* probe.status_rejected */ "Odrzucono",
  /* probe.status_bad_crc */ "Błędna suma kontrolna",
  /* probe.status_unexpected_reply */ "Nieoczekiwana odpowiedź",
  /* probe.status_invalid_length */ "Nieprawidłowa długość",
  /* probe.status_short_reply */ "Częściowa odpowiedź",
  /* probe.status_out_of_bounds */ "Poza danymi",
  /* probe.status_error */ "Błąd",
  /* probe.transport_ok */ "Ramka pełna i prawidłowa.",
  /* probe.transport_busy */ "Trwa inne żądanie rejestru.",
  /* probe.transport_no_link */ "Łącze X10A jest niedostępne.",
  /* probe.transport_timeout */ "Zadanie odpytywania nie wykonało żądania na czas.",
  /* probe.transport_no_reply */ "Nie odebrano bajtów odpowiedzi.",
  /* probe.transport_rejected */ "Urządzenie odrzuciło tę stronę rejestrów.",
  /* probe.transport_bad_crc */ "Odebrano odpowiedź; suma kontrolna jest błędna.",
  /* probe.transport_unexpected_reply */ "Odpowiedź dotyczy innej strony rejestrów.",
  /* probe.transport_invalid_length */ "Odpowiedź podaje nieprawidłową długość ramki.",
  /* probe.transport_short_reply */ "Odebrano tylko część odpowiedzi.",
  /* probe.transport_out_of_bounds */ "Żądane bajty są poza tymi danymi.",
  /* probe.transport_error */ "Żądanie nie powiodło się.",
  /* lang.auto */ "Przeglądarka",
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
  /* lang.saved */ "Zapisano język",
  /* check.detail.dhw_reason.blind_modbus */ "brak odczytów: Modbus milczy lub odpytywanie wstrzymane",
  /* check.detail.source_stale_modbus */ "Brak świeżego odczytu Modbus; bieżący stan nieznany. Historia zachowana.",
  /* mb.flow_scale_help */ "Niezweryfikowana skala /100 (sonda/profil zastępczy); porównaj L/min z wyświetlaczem. Poza animacją, ΔT, mocą i testem 24 h.",
  /* hist.modbus_flow_unverified */ "Niezweryfikowana skala Modbus /100 (sonda/profil zastępczy); porównaj z jednostką.",
  /* wf.label */ "Współczynnik efektywności",
  /* wf.short.partial */ "wst.",
  /* wf.short.limited */ "ogr.",
  /* wf.state.unsupported */ "Brak obsługi",
  /* wf.state.collecting */ "Zbieranie",
  /* wf.state.standby */ "Czuwanie",
  /* wf.verdict.cheaper */ "taniej niż gaz",
  /* wf.verdict.similar */ "jak gaz",
  /* wf.verdict.more_expensive */ "drożej niż gaz",
  /* wf.verdict.limited */ "ograniczony",
  /* wf.verdict.measured */ "zmierzony",
  /* wf.verdict.partial */ "wstępny",
  /* wf.aria.estimate */ (v) => `szacowany ${v}`,
  /* wf.kpi.breakeven */ (be) => `Próg ${be}`,
  /* wf.kpi.hp_cost */ "Pompa ciepła",
  /* wf.kpi.gas_cost */ "Gaz · 88 %",
  /* wf.kpi.delta */ "Różnica",
  /* wf.kpi.energy */ "Ciepło 24 h",
  /* wf.kpi.heat_elec */ (e) => `prąd ${e} kWh`,
  /* wf.scope.est */ "szac.",
  /* wf.scope.comp */ "tylko sprężarka",
  /* wf.scale.label */ "Próg opłacalności",
  /* wf.scale.band */ (p) => `±${p} %`,
  /* wf.scale.cheaper */ "Taniej →",
  /* wf.scale.expensive */ "← Drożej",
  /* wf.cta.tariffs */ "Ustaw taryfy",
  /* wf.cta.edit_tariffs */ "Zmień taryfy",
  /* wf.desc.collecting */ (o) => `Pierwszy wynik po 2 h · dotąd ${o}`,
  /* wf.desc.standby */ (o) => `Za mało pracy na wynik · ${o}`,
  /* wf.desc.unsupported */ "Brak wymaganych pomiarów przepływu, temperatury lub mocy.",
  /* wf.banner.stale */ "Nieaktualny sygnał źródła — obliczenia wstrzymane.",
  /* wf.banner.buh_limited */ "Grzałka poza zakresem pomiaru prądu — wynik ograniczony.",
  /* wf.banner.buh_unpaired */ "Grzałka aktywna bez czujnika za nią — pominięto.",
  /* wf.banner.bsh_excluded */ (d) => `Grzałka zasobnika ${d} pominięta.`,
  /* wf.banner.ct_unwired */ "Przekładnik 0 A — używana tylko sprężarka.",
  /* wf.ctx.window */ "Okres",
  /* wf.ctx.power */ "Pomiar mocy",
  /* wf.ctx.outdoor */ "Zewnątrz",
  /* wf.ctx.outdoor_range */ (avg, min) => `śr. ${avg} °C · min. ${min} °C`,
  /* wf.ctx.defrost */ "Odszranianie",
  /* wf.ctx.buh */ "Grzałka",
  /* wf.ctx.buh_inc */ (d) => `${d} · wliczona`,
  /* wf.ctx.cooling */ "Chłodzenie",
  /* wf.ctx.excluded */ (d) => `${d} pominięte`,
  /* wf.src.x10a_ct */ "Przekładnik · całość",
  /* wf.src.x10a_inv */ "Falownik · tylko sprężarka",
  /* wf.foot.base */ "24 h ogrzewanie i CWU · czysta woda · szacunek.",
  /* wf.foot.gas */ "24 h ogrzewanie i CWU · czysta woda · kocioł kondensacyjny 88 % bez opłat stałych · szacunek.",
  /* wf.gas.row */ "Porównanie z gazem",
  /* wf.gas.title */ "Taryfy gazu",
  /* wf.not_configured */ "Brak taryf",
  /* wf.gas.detail.elec */ "Prąd",
  /* wf.gas.detail.gas */ "Gaz",
  /* wf.gas.detail.breakeven */ "Próg opłacalności",
  /* wf.gas.settings_help */ "24 h PC vs stały nowoczesny kocioł gazowy kondensacyjny (88% Hs, czysta woda 4,186 kJ/(L·K), bez opłat stałych).",
  /* wf.gas.elec_price */ "Prąd / kWh",
  /* wf.gas.gas_price */ "Gaz / kWh",
  /* wf.gas.currency */ "Waluta",
  /* wf.gas.preview */ (b) => `Próg: ${b} (±20%)`,
  /* wf.gas.preview_empty */ "Podaj ceny, aby wyliczyć próg.",
  /* wf.gas.hint */ "Stały nowoczesny kocioł gazowy kondensacyjny (88% Hs) i czysta woda (4,186 kJ/(L·K)), ogrzewanie + CWU, bez stałych. Odświeża 24 h.",
  /* wf.gas.delete */ "Wyczyść",
  /* wf.gas.deleting */ "Czyszczenie…",
  /* wf.gas.saved */ "Zapisano taryfy",
  /* wf.gas.deleted */ "Wyczyszczono taryfy",
  /* wf.gas.err_price */ "0,0001–99,9999.",
  /* wf.gas.err_currency */ "Wybierz obsługiwaną walutę.",
]);
INSPECT_I18N.pl = inspectValues(
  ["Brak bieżącego odczytu:", "sprężarka stoi, a jednostka zewnętrzna odświeża własne czujniki tylko podczas pracy. Wartość z poprzedniego cyklu jest ukryta, aby nie wyglądała na aktualny pomiar.", "Nie można odczytać prędkości sprężarki, więc wartości jednostki zewnętrznej mogą być z poprzedniego cyklu."],
  [
    ["Tryb pracy", 0, "Tryb jednostki wewnętrznej; nie potwierdza sam pracy sprężarki ani przepływu."], // status
    ["Warunki zewnętrzne", "Warunki zewnętrzne z ENV III", "Temperatura, wilgotność i ciśnienie z czujnika ENV III przy ESP32."], // env3
    [(d) => sgInspectIsX10a(d) ? "Żądanie Smart Grid przez X10A" : "Żądanie Smart Grid przez Modbus", "Żądanie Smart Grid", (d) => sgInspectIsX10a(d)
      ? "Zewnętrzne żądanie z fizycznych styków SG-Ready: praca swobodna, wymuszone wyłączenie, zalecane włączenie lub wymuszone włączenie. To polecenie zarządzania energią, nie tryb ogrzewania/chłodzenia ani dowód ładowania zbiornika; żądanie sieciowe może nie pojawić się na tych stykach."
      : "Zewnętrzne żądanie odczytane z HomeHub: praca swobodna, wymuszone wyłączenie, zalecane włączenie lub wymuszone włączenie. To polecenie zarządzania energią, nie tryb ogrzewania/chłodzenia ani dowód rozpoczęcia ładowania zbiornika.", (d) => !d || d.sgMode == null
      ? "Brak aktualnej wartości Smart Grid."
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "Styki SG-Ready zgłaszają zalecane włączenie. Menedżer energii używa tego stanu do wzmocnienia; tryb CWU, 3WV i przepływ osobno pokazują, czy zbiornik jest rzeczywiście ładowany."
      : d.sgMode === 2
      ? "HomeHub zgłasza zalecane włączenie. Menedżer energii używa tego stanu do wzmocnienia; tryb CWU, 3WV i przepływ osobno pokazują, czy zbiornik jest rzeczywiście ładowany."
      : d.sgMode === 1 ? "Zewnętrzne zarządzanie energią zgłasza „wymuszone wyłączenie”."
      : d.sgMode === 3 ? "Zewnętrzne zarządzanie energią zgłasza „wymuszone włączenie”."
      : "Brak zewnętrznego żądania Smart Grid; urządzenie pracuje autonomicznie."], // sgrequest
    ["Jednostka zewnętrzna", 0, "W powietrznej pompie ciepła wentylator prowadzi powietrze przez wymiennik, a sprężarka podnosi ciśnienie i temperaturę czynnika. To uproszczony schemat; monoblok, gruntowa pompa ciepła i hybryda mają inny układ.", (d) => d.defrost
      ? "Odszranianie — obieg pracuje odwrotnie, aby stopić lód, i chwilowo odbiera ciepło z wody."
      : compressorRunning(d)
      ? d.rps != null
        ? `Praca — sprężarka ${fmt0(d.rps)} rps${d.quiet ? ", ograniczona trybem cichym" : ""}.`
        : "Praca — HomeHub potwierdza włączenie sprężarki; prędkość i szczegóły jednostki wymagają X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "Postój — brak aktywnego przekazywania ciepła. X10A nie odświeża wtedy czujników jednostki; temperatura zewnętrzna pochodzi z Modbus, lecz rejestr nie ma czasu źródłowego, a temperatura tłoczenia pozostaje „—”."
      : "Postój — sprężarka stoi, więc nie ma aktywnego ogrzewania ani chłodzenia. Czujniki jednostki nie są odświeżane; zamiast starych wartości wyświetlane jest „—”."], // ou
    ["Sprężarka", 0, "Spręża czynnik chłodniczy. Prędkość w rps wskazuje jej pracę, ale sama nie jest mocą cieplną."], // comp
    ["Temperatura zewnętrzna", 0, "Temperatura przy czujniku jednostki zewnętrznej; wpływają na nią słońce i montaż."], // out
    ["Temperatura wymiennika zewnętrznego (R4T)", "Temperatura wymiennika zewnętrznego R4T", "Temperatura wymiennika powietrznego. Podczas ogrzewania może spaść poniżej 0 °C; dopiero razem ze stanem odszraniania opisuje oblodzenie i jego usuwanie."], // ouhx
    ["Wysokie ciśnienie", 0, "Ciśnienie czynnika po stronie wysokiego ciśnienia. Interpretuj je z trybem pracy i temperaturą tłoczenia; nie jest to ciśnienie wody."], // hp
    ["Temperatura tłoczenia", 0, "Temperatura gorącego czynnika opuszczającego sprężarkę. Wartość zależy od obciążenia i trybu, a podczas postoju stary odczyt jest ukrywany."], // disch
    ["Niskie ciśnienie", 0, "Ciśnienie czynnika po stronie niskiego ciśnienia sprężarki; w ogrzewaniu jest to strona parowania za rozprężeniem. Nie każdy profil udostępnia ten czujnik."], // lp
    ["Zawór rozprężny", 0, "Zadana pozycja elektronicznego zaworu w impulsach. Reguluje przepływ czynnika; liczba nie jest procentem otwarcia."], // eev
    ["Temperatura ciekłego czynnika (R3T)", "Temperatura ciekłego czynnika R3T", "Temperatura czynnika po ciekłej stronie wymiennika wewnętrznego; to nie temperatura powrotu wody."], // r3t
    ["Płytowy wymiennik ciepła", 0, "PHE przekazuje energię między czynnikiem chłodniczym a wodą bez mieszania obu mediów. Moc jest szacowana z przepływu i R1T/R4T, których dokładne położenie zależy od modelu.", (d) => !compressorRunning(d, 5)
      ? "Brak aktywnego przekazywania po stronie czynnika — sprężarka stoi. Sam obieg pompy może rozprowadzać ciepło resztkowe, ale nie jest mocą grzewczą ani chłodniczą."
      : d.dtStale ? "Nie można obliczyć przekazywania po stronie wody — pompa i przepływ nie potwierdzają ruchu wody przez PHE."
      : d.pth == null ? "Brak kierunkowego oszacowania — odczyty nie potwierdzają użytecznego przekazywania w wybranym trybie."
      : d.pthKind === "cooling"
      ? `Z wody odbierane jest około ${fmt1(d.pth)} kW (${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K).`
      : `Do wody przekazywane jest około ${fmt1(d.pth)} kW (${fmt1(d.flow)} l/min, ΔT ${fmt1(d.dt)} K).`], // phe
    ["Wyjście wody z PHE przed BUH (R1T)", "Wyjście wody z PHE przed BUH R1T", "Temperatura wody opuszczającej PHE przed elektrycznym BUH. W ogrzewaniu/CWU zwykle przewyższa R4T, a w chłodzeniu jest niższa."], // lwt
    ["Woda za BUH (R2T)", "Woda za BUH R2T", "Temperatura wody za grzałką BUH; w przeciwieństwie do R1T może obejmować ciepło dodane elektrycznie. Dokładne położenie zależy od modułu hydraulicznego."], // r2t
    ["Wejście wody do PHE (R4T)", "Wejście wody do PHE R4T", "Temperatura wody wracającej do PHE. Oceniaj ją razem z R1T, przepływem, sprężarką i trybem pracy."], // rwt
    ["ΔT wody na PHE", "Różnica temperatury wody na PHE", "R1T na wyjściu PHE minus R4T na wejściu. Jest obliczane z dwóch czujników; wraz z przepływem opisuje wymianę, ale nie mierzy bezpośrednio temperatur przy odbiornikach w budynku.", (d) => d.dtStale
      ? "Brak roboczego ΔT — pompa i przepływ nie potwierdzają ruchu wody. Bez cyrkulacji różnica stygnących czujników nie jest punktem pracy."
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K przy pracy samej pompy — wyrównywanie ciepła resztkowego, nie moc ogrzewania ani chłodzenia.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. Przy aktywnym chłodzeniu R1T powinno być niższe od R4T, więc różnica jest ujemna.`
      : `${fmt1(d.dt)} K. Wartość dodatnia oznacza oddawanie ciepła do wody.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Moc chłodnicza (szacunek)" : "Moc cieplna (szacunek)", "Szacowana moc cieplna na PHE", (d) => d && d.pthKind === "cooling"
      ? "Szacunek ciepła odbieranego wodzie: przepływ × (R4T−R1T) × 4,186, przy założeniu czystej wody. Czujniki, glikol i brak pomiaru za odbiornikami ograniczają dokładność; wartość pojawia się tylko przy potwierdzonym chłodzeniu."
      : "Szacunek ciepła oddawanego wodzie: przepływ × (R1T−R4T) × 4,186, przy założeniu czystej wody. Czujniki i glikol ograniczają dokładność; BUH za R1T nie jest ujęty.", (d) => d.dtStale
      ? d.bsh === true
        ? "Nie można obliczyć przekazywania na PHE, bo brak potwierdzonej cyrkulacji. Wewnętrzna grzałka może nadal ogrzewać zbiornik, lecz jej ciepło nie przechodzi przez czujniki PHE i magistrala nie podaje jej mocy."
        : "Nie można teraz obliczyć mocy, bo brak potwierdzonego ruchu wody przez PHE. To brak użytecznego punktu pracy, nie moc równa zero."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW chłodzenia${d.cop != null ? `, EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER pompy ciepła (szacunek)"
      : d && d.copScope === "plant" ? "COP za BUH (szacunek)" : "COP pompy ciepła (szacunek)", "Szacowana efektywność", (d) => d && d.efficiencyKind === "eer"
      ? "Szacowana moc chłodnicza podzielona przez szacowany pobór. Wynik dziedziczy założenia o wodzie/glikolu, czujnikach, napięciu i współczynniku mocy; to chwilowy EER, nie efektywność sezonowa."
      : "Szacowana moc cieplna podzielona przez zgodny zakresowo pobór energii. Dla CT ciepło może być liczone za BUH, a dla prądu falownika dotyczy samej pompy; montaż CT decyduje o ujętych odbiornikach. To wskazanie chwilowe, nie licznik sezonowy.", (d) => d.copBlock === "tank_heater"
      ? "Brak COP — grzałka zbiornika jest włączona. Jej pobór może wejść do bilansu prądu, lecz ciepło trafia prosto do zbiornika i nie przechodzi przez czujniki wody; zakresy nie pasują."
      : d.copBlock === "buh_no_r2t" ? "Brak COP — BUH grzeje, ale profil nie ma czujnika wody za nim. Pobór może obejmować grzałkę, a moc cieplna kończy się przed nią."
      : d.copBlock === "mb_scope" ? "COP niedostępny. Dokumentacja HomeHub nie określa, które odbiorniki obejmuje podany pobór prądu. Szacowane ciepło dotyczy wymiennika płytowego. Obliczenie COP wymaga potwierdzenia zgodności zakresów pomiaru."
      : d.copBlock === "no_pel"
      ? d.pelHeld ? "Brak COP — przy stojącej sprężarce prąd falownika jest pozostałością z poprzedniego cyklu, a nie bieżącym pomiarem."
        : "Brak COP — profil nie podaje poboru ani z CT, ani z prądu falownika."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW chłodzenia na 1 kW prądu — ≈ ${fmt1(d.copPth)} kW przy ≈ ${fmt1(d.pel)} kW poboru.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW ciepła za BUH na 1 kW poboru z CT — ≈ ${fmt1(d.copPth)} kW przy ≈ ${fmt1(d.pel)} kW. Zakres odbiorników zależy od montażu CT.`
      : `${fmt1(d.cop)} kW ciepła na 1 kW prądu w granicy pompy — ≈ ${fmt1(d.copPth)} kW przy ≈ ${fmt1(d.pel)} kW. BUH jest poza obiema wielkościami.`], // cop
    ["Grzałka dodatkowa (BUH)", "Grzałka dodatkowa BUH", "Elektryczna grzałka w obiegu wodnym, używana m.in. przy mrozie, odszranianiu lub awarii. Stopień opisuje załączoną moc, nie oddzielny pomiar kW.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Stopień 2 — pracują oba stopnie." : d.buh1 ? "Stopień 1 — pracuje jeden stopień." : "Wyłączona — żaden stopień BUH nie pracuje."], // buh
    ["Elektryczna grzałka zbiornika", 0, "Grzałka zanurzeniowa BSH ogrzewa zbiornik bez sprężarki i obiegu wody. X10A podaje tylko stan włączona/wyłączona, nie jej moc.", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "Elektryczna grzałka zbiornika jest aktywna." : "Wyłączona — zbiornik nie używa grzałki zanurzeniowej."; }], // bsh
    ["Zawór 3-drogowy", 0, "Sterownik wybiera nim drogę do zbiornika albo obiegu domu. Jest to zgłoszone polecenie, nie mechaniczne potwierdzenie położenia ani przepływu.", (d) => d.valveDhw == null ? null : d.valveDhw ? "Sterownik wybrał drogę do zbiornika; samo zgłoszenie nie potwierdza przepływu ani ładowania." : "Sterownik wybrał drogę do obiegu domu; samo zgłoszenie nie potwierdza cyrkulacji."], // valve
    ["Wyjście zaworu 2-drogowego", 0, "Binarny sygnał wyjściowy X10A dla zaworu 2-drogowego. Nie jest mechanicznym potwierdzeniem położenia ani samodzielnym dowodem ogrzewania lub chłodzenia.", (d) => d.valve2On == null ? null : d.valve2On ? "X10A zgłasza wyjście 2WV WŁ.; osobno sprawdź tryb i pracę obiegu." : "X10A zgłasza wyjście 2WV WYŁ.; samo to nie oznacza chłodzenia ani nie przeczy ustawionemu ogrzewaniu podczas postoju obiegu."], // valve2
    ["Zbiornik CWU / bufor", "Zbiornik CWU lub bufor", "Zbiornik opisują R5T, nastawa i droga 3WV; sama temperatura nie dowodzi ładowania."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Obieg chłodzenia" : activeSpaceKind(d) === "heat" ? "Obieg ogrzewania" : "Obieg domu", "Obieg domu", "Odbiorniki domu: grzejniki, podłogówka lub klimakonwektory. R1T/R4T są mierzone wewnątrz pompy i nie potwierdzają temperatury za instalacją polową.", (d) => d.valveDhw === true ? "Droga do obiegu domu nie jest wybrana; rzeczywisty przepływ do zbiornika pokazują osobno pompa i przepływ."
      : waterMoving(d)
      ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Ciepło resztkowe płynie do obiegu domu. Wewnętrzny R1T ma ${degC(d.lwt)}; brak czujnika za odbiornikami. To nie jest aktywne chłodzenie.`
        : `Woda płynie do obiegu ${activeSpaceKind(d) === "cool" ? "chłodzenia" : activeSpaceKind(d) === "heat" ? "ogrzewania" : "domu"}. Wewnętrzny R1T ma ${degC(d.lwt)}; brak czujnika za odbiornikami.`
      : "Pompa i przepływ nie potwierdzają cyrkulacji przez obieg domu."], // heat
    ["Praca ogrzewania/chłodzenia domu", "Praca ogrzewania lub chłodzenia domu", "Stan zwykłej pracy obiegu domu. Nie jest żądaniem termostatu i sam nie potwierdza pracy sprężarki."], // spaceh
    ["Temperatura w pomieszczeniu", 0, "Temperatura strefy odniesienia; porównuj ją z nastawą i trybem."], // room
    ["Pompa obiegowa", "Pompa obiegowa", "Odwrócony sygnał X10A (0 = maks, 100 = stop, [0, 100] → 100–0 %) nie mierzy RPM ani nie dowodzi obrotów, wysokości czy przepływu; czytaj WŁ./WYŁ. i przepływ osobno.", (d) => pumpNowText(d, [(n) => `Polecenie pompy ${n} %.`, "Stan pompy WŁ.", "Pompa zgłasza postój (WYŁ.).", "Stan WŁ./WYŁ. pompy nieznany.", (n) => `Zmierzony przepływ ${n} l/min.`, "Brak pomiaru przepływu.", "Zgłoszone WYŁ. jest sprzeczne z przepływem; możliwy obieg zewnętrzny, wybieg lub przestarzałe sygnały.", "Obieg nie jest potwierdzony."])], // pump
    [(d) => pelMeasured(d) ? "Pobór elektryczny (HomeHub)" : "Pobór elektryczny (szacunek)", "Pobór elektryczny", (d) => pelMeasured(d)
      ? "Wartość poboru z rejestru wejściowego HomeHub 51. Dokumentacja nie potwierdza kalibracji, dokładnego punktu pomiaru ani objęcia wszystkich grzałek; to nie jest certyfikowany licznik całej instalacji."
      : "Szacunek dla COP/EER: suma wszystkich zadeklarowanych faz CT × założone 230 V. Rzeczywiste napięcie i współczynnik mocy są nieznane; prąd falownika obejmuje tylko sprężarkę, a zakres CT zależy od okablowania.", (d) => d.pelHeld ? "Sprężarka stoi, więc prąd falownika jest wartością z poprzedniego cyklu, nie bieżącym pomiarem; nie można podać poboru ani sprawności."
      : d.pel == null ? "Profil nie ma bieżącego odczytu prądu, więc nie można też wyznaczyć COP/EER."
      : d.pelSrc === "MB" ? "Wartość z rejestru wejściowego HomeHub 51; dokładna granica pomiaru nie jest tu udokumentowana."
      : d.pelSrc === "CT" ? "Szacunek z przekładników CT; ujęte odbiorniki zależą od ich podłączenia."
      : "Z prądu falownika — tylko sprężarka."], // pel
    ["Odszranianie", 0, "Odwrócony cykl topi lód na wymienniku zewnętrznym; ogrzewanie jest wtedy chwilowo przerwane.", (d) => d.defrost == null ? null : d.defrost ? "Odszranianie jest aktywne." : "Wyłączone — cykl odszraniania nie jest aktywny."], // defrost
    ["Tryb cichy", 0, "Ogranicza hałas, zwykle przez ograniczenie wentylatora lub sprężarki. Może przez to zmniejszyć dostępną moc.", (d) => d.quiet == null ? null : d.quiet ? "Tryb cichy jest aktywny." : "Wyłączony — tryb cichy nie jest aktywny."], // quiet
    ["Przewód gazowy (gorący gaz w ogrzewaniu)", "Przewód gazowy", "Przewód czynnika między jednostkami układu split. W ogrzewaniu gorący gaz pod wysokim ciśnieniem płynie do PHE; w chłodzeniu kierunek się odwraca. Monoblok nie ma tego przewodu polowego.", (d) => compressorRunning(d) ? d.rps != null ? `Przepływ — ${fmt1(d.circP)} bar przy ${fmt0(d.disch)} °C.` : "Przepływ — HomeHub potwierdza sprężarkę; ciśnienie i temperatura tłoczenia wymagają X10A." : "Brak aktywnego obiegu czynnika — sprężarka stoi; wyrównanie ciśnień zależy od układu i czasu postoju."], // rhot
    ["Przewód cieczowy", 0, "Przewód ciekłego czynnika między jednostkami split. W ogrzewaniu czynnik wraca nim do zaworu rozprężnego jednostki zewnętrznej; w chłodzeniu kierunek się odwraca. Monoblok nie ma tego przewodu polowego.", (d) => compressorRunning(d) ? d.rps != null ? `Przepływ — zawór rozprężny: ${fmt0(d.eev)} impulsów.` : "Przepływ — HomeHub potwierdza sprężarkę; pozycja zaworu wymaga X10A." : "Postój — sprężarka jest wyłączona."], // rcold
    ["Przewód wyjściowy PHE", 0, "Woda z R1T opuszcza PHE, przechodzi przez BUH i pompę, a 3WV kieruje ją do domu lub zbiornika. W ogrzewaniu/CWU jest stroną ciepłą, w chłodzeniu — zimną; czujnik za BUH może obejmować ciepło elektryczne.", (d) => waterMoving(d) ? `R1T przed BUH: ${degC(d.lwt)} przy ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; dalej aktywny jest stopień BUH" : ""}.` : "Pompa i przepływ nie potwierdzają cyrkulacji w tym przewodzie."], // wsup
    ["Obieg zbiornika", 0, "Gałąź hydrauliczna ładująca zbiornik CWU lub bufor. Dokładny wymiennik zależy od konstrukcji; schemat pokazuje funkcję, nie wnętrze konkretnego modelu.", (d) => d.valveDhw === true ? waterMoving(d) ? `Wybrano zbiornik, przepływ ${fmt1(d.flow)} l/min; wyjście PHE ${degC(d.lwt)}, zbiornik ${degC(d.tank)}.` : "Wybrano zbiornik, ale pompa i przepływ nie potwierdzają aktywnego ładowania." : "Droga do zbiornika nie jest wybrana; sterownik zgłasza obieg domu."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Gałąź chłodzenia" : activeSpaceKind(d) === "heat" ? "Gałąź ogrzewania" : "Gałąź domu", "Gałąź domu", "Gałąź do grzejników, podłogówki, klimakonwektorów lub innych odbiorników. R1T/R4T mierzą obieg wewnątrz pompy, nie temperaturę na tej gałęzi; ΔT zawiera też wpływ rur i rozdziału.", (d) => d.valveDhw === true ? "Gałąź domu nie jest wybrana; sterownik zgłasza drogę do zbiornika."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0 ? `Obieg ciepła resztkowego do domu: ${fmt1(d.flow)} l/min; brak aktywnego chłodzenia. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.` : `Cyrkulacja do domu: ${fmt1(d.flow)} l/min. Wewnętrzne R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.` : "Pompa i przepływ nie potwierdzają cyrkulacji przez gałąź domu."], // wheat
    ["Przewód powrotny do PHE", 0, "Wspólny powrót do R4T po połączeniu gałęzi zbiornika i domu. W ogrzewaniu jest zwykle chłodniejszy od R1T, w aktywnym chłodzeniu cieplejszy; R4T nie jest czujnikiem przy odbiornikach.", (d) => waterMoving(d) ? `Powrót: ${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` : "Pompa i przepływ nie potwierdzają cyrkulacji w przewodzie powrotnym."], // wret
    ["Przepływ wody", 0, "Przepływ wspólnego obiegu; wymagane minimum zależy od modelu i trybu."], // flow
    ["Stan styku przepływu", 0, "Stan binarny X10A; nie mierzy l/min ani nie potwierdza minimum modelu.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A WŁ.; porównaj z pompą i ${fmt1(d.flow)} l/min.` : `X10A WYŁ.; przy pracy pompy porównaj ${fmt1(d.flow)} l/min i błąd 7H/C0.`], // flow_switch
    ["Ciśnienie wody", 0, "Ciśnienie w zamkniętym obiegu hydraulicznym. Dozwolony zakres zależy od modelu, wysokości instalacji i naczynia przeponowego; porównaj z instrukcją urządzenia."], // wp
  ],
);

HOMEHUB_LABEL_I18N.pl = homeHubValues([
  "Nastawa zasilania ogrzewania głównej strefy", // 1
  "Nastawa zasilania chłodzenia głównej strefy", // 2
  "Tryb ogrzewania/chłodzenia", // 3
  "Ogrzewanie/chłodzenie domu włączone", // 4
  "Nastawa ogrzewania głównej strefy", // 6
  "Nastawa chłodzenia głównej strefy", // 7
  "Tryb cichy", // 9
  "Nastawa dogrzewania CWU", // 10
  "Dogrzewanie CWU włączone", // 12
  "Tryb szybki CWU aktywny", // 13
  "Stan diagnostyczny jednostki", // 21
  "Kod błędu jednostki", // 22
  "Podkod błędu jednostki", // 23
  "Pompa obiegowa aktywna", // 30
  "Sprężarka aktywna", // 31
  "Grzałka zbiornika aktywna", // 32
  "Dezynfekcja zbiornika aktywna", // 33
  "Odszranianie lub restart", // 35
  "Gorący start", // 36
  "Pozycja zaworu 3-drogowego", // 37
  "Bieżący tryb ogrzewania/chłodzenia", // 38
  "Temperatura wyjścia PHE", // 40
  "Temperatura zasilania za BUH", // 41
  "Temperatura powrotu", // 42
  "Temperatura zbiornika CWU", // 43
  "Temperatura zewnętrzna", // 44
  "Temperatura ciekłego czynnika", // 45
  "Przepływ wody", // 49
  "Temperatura pomieszczenia głównej strefy", // 50
  "Pobór mocy elektrycznej", // 51
  "Praca CWU", // 52
  "Praca ogrzewania/chłodzenia domu", // 53
  "Korekta zasilania głównej strefy grzewczej", // 54
  "Korekta zasilania głównej strefy chłodzenia", // 55
  "Tryb Smart Grid", // 56
  "Limit mocy buforowania", // 57
  "Ogólny limit mocy", // 58
]);

DESCRIPTION_I18N.pl = descriptionValues([
  ["Docelowa temperatura zasobnika CWU lub bufora."], // 0
  ["Odczyt drugiego czujnika temperatury zasobnika CWU, np. czujnika dolnego."], // 1
  ["Temperatura z czujnika R5T zasobnika."], // 2
  ["Tryb Powerful natychmiast rozpoczyna grzanie zasobnika do ustawionej temperatury."], // 3
  ["Wstępne grzanie X10A nie jest flagą dezynfekcji HomeHub ani dowodem jej trwania."], // 4
  ["Wejście HomeHub 33 zgłasza dezynfekcję; impuls między odczytami Modbus może umknąć."], // 5
  ["Bit termostatu zewnętrznego jest niezależny od żądania wewnętrznego i nie dowodzi sprężarki."], // 6
  ["Bit ograniczenia hałasu jednostki zewnętrznej; poziom i przyczyna nie są potwierdzone."], // 7
  ["Bit wejścia instalacji solarnej obiegu wodnego; funkcja i polaryzacja nie są potwierdzone."], // 8
  ["Flaga fazy sterownika: oczekiwanie po restarcie lub sterowanie rozruchem."], // 9
  ["Sterownik zewnętrzny zgłasza operację powrotu oleju do sprężarki."], // 10
  ["Wyrównywanie ciśnienia to faza sterowania, nie pomiar ani potwierdzenie zaworu."], // 11
  ["Własna flaga zapotrzebowania ma publicznie nieokreślone znaczenie."], // 12
  ["Polecenie/stan zaworu 4-drogowego odwracającego obieg czynnika."], // 13
  ["Polecenie/stan grzałki karteru sprężarki."], // 14
  ["Własny bit wyjścia nie dowodzi ruchu zaworu ani aktywnej polaryzacji."], // 15
  ["Podkod uzupełnia główny błąd; wartości zależne od modelu nie mają zweryfikowanej tabeli."], // 16
  ["Flaga opcjonalnego zaworu odcinającego pętlę podłogową."], // 17
  ["WŁ. oznacza System off, ale nie dowodzi wyłączenia wszystkich pomp, grzałek i ochron."], // 18
  ["Wejście termostatu zewnętrznego jest żądaniem, nie temperaturą ani stanem sprężarki."], // 19
  ["Bit żądania termostatu głównej strefy dla chłodzenia lub ogrzewania."], // 20
  ["Cztery surowe bity limitu pozostają osobno; ich kodowanie nie jest potwierdzone."], // 21
  ["Bit grzałki PHE nie rozstrzyga polecenia ani sprzężenia i nie dowodzi poboru prądu."], // 22
  ["Zezwolenie na dogrzewanie CWU w rejestrze 12; ON = zezwolono, OFF = wyłączone, bez dowodu aktywnego ładowania."], // 23
  ["Żądanie trybu szybkiego/booster CWU w rejestrze 13; ON = żądany lub aktywny, OFF = normalna praca."], // 24
  ["Dogrzewanie podnosi temperaturę zasobnika do nastawy po spadku poniżej progu."], // 25
  ["Storage comfort wybiera wyższą, a Storage eco niższą zaprogramowaną temperaturę."], // 26
  ["W układzie hybrydowym sterownik żąda od kotła przygotowania CWU."], // 27
  ["Zawór przełączający kieruje wodę do zasobnika CWU albo obiegu domu."], // 28
  ["Wyjście 2WV pozostaje WŁ./WYŁ.; WYŁ. nie dowodzi chłodzenia ani położenia zaworu."], // 29
  ["Stopień otwarcia zaworu mieszającego drugiej strefy."], // 30
  ["Docelowa temperatura zasilania dla wybranego ogrzewania lub chłodzenia."], // 31
  ["Temperatura zmieszanego zasilania drugiej strefy za zaworem mieszającym."], // 32
  ["Temperatura wody za elektrycznym BUH, zwykle R2T."], // 33
  ["R1T mierzy wodę z PHE przed BUH; tryb, R4T i przepływ określają sens i szacunek mocy."], // 34
  ["R4T jest wspólnym powrotem do PHE; R1T−R4T to ΔT PHE, nie odbiorników."], // 35
  ["Szybkość obiegu wody we wspólnym układzie ogrzewania/chłodzenia i CWU."], // 36
  ["Ciśnienie wody; zakres zależy od modelu, przy ≤1,0 bar sprawdź jego instrukcję."], // 37
  ["Odwrócone polecenie X10A: 0 = maks, 100 = stop ([0, 100] → 100–0 %). Nie mierzy RPM ani nie dowodzi obrotów, wysokości czy przepływu; czytaj WŁ./WYŁ. i przepływ osobno."], // 38
  ["Praca pompy obiegowej nie dowodzi przekazywania ciepła; potwierdź przepływem."], // 39
  ["Stan pompy solarnej, niezależnej od pompy obiegowej układu pompy ciepła."], // 40
  ["Zgłoszona prędkość pompy wskazanej przez profil."], // 41
  ["Flow switch X10A zgłasza tylko ruch; nie mierzy przepływu ani minimum modelu."], // 42
  ["Bieżący tryb strony wodnej: postój, ogrzewanie, chłodzenie, CWU lub połączenie."], // 43
  ["Smart Grid zgłasza czterostanowe polecenie energetyczne, nie tryb ogrzewania/chłodzenia."], // 44
  ["Bieżący tryb domu to ogrzewanie/chłodzenie bez trybu automatycznego; nie dowodzi pracy sprężarki."], // 45
  ["Ustawiony wybór HomeHub: Auto, ogrzewanie lub chłodzenie."], // 46
  ["Stan jednostki zewnętrznej: postój, ogrzewanie lub chłodzenie; nie dowodzi przekazywania ciepła."], // 47
  ["Łączny znacznik odszraniania i restartu sprężarki w rejestrze 35; OFF = praca normalna, ON = odszranianie lub przygotowanie restartu."], // 48
  ["Znacznik gorącego startu w rejestrze 36; OFF = praca ciągła, ON = krótkie podgrzanie wymiennika."], // 49
  ["Odszranianie jest normalne w zimnej, wilgotnej pogodzie; sam bit bez wilgotności nie ocenia częstotliwości."], // 50
  ["Klasa aktywnej usterki: stan normalny, błąd, ostrzeżenie albo przestroga."], // 51
  ["Znaczenie aktualnie zgłoszonego kodu usterki."], // 52
  ["Tryb awaryjny po usterce pompy ciepła."], // 53
  ["Przekaźnik alarmowy sygnalizuje usterkę podłączonemu zewnętrznemu monitoringowi."], // 54
  ["Docelowa temperatura pomieszczenia głównej strefy w ogrzewaniu lub chłodzeniu."], // 55
  ["„Thermo ON“ to wewnętrzne żądanie, nie wskazanie odbiornika ani dowód pracy sprężarki."], // 56
  ["Stan zacisku wyjściowego „Space H Operation”."], // 57
  ["Normalna praca domu nie oznacza tylko ogrzewania ani termostatu; rozstrzygają I/U i napędy."], // 58
  ["Docelowa temperatura strefy sterowanej własnym czujnikiem pokojowym urządzenia."], // 59
  ["Temperatura pomieszczenia zmierzona wbudowanym lub przewodowym czujnikiem urządzenia."], // 60
  ["Ochrona temperatury tłoczenia: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 61
  ["Ochrona prądu inwertera: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 62
  ["Ochrona wysokiego ciśnienia: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 63
  ["Ochrona niskiego ciśnienia: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 64
  ["Ochrona temperatury radiatora inwertera: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 65
  ["Wewnętrzna zbiorcza flaga ograniczenia, nieprzypisana do pięciu nazwanych zabezpieczeń."], // 66
  ["Temperatura wody na wejściu lub wyjściu PHE między czynnikiem a obiegiem wody."], // 67
  ["Temperatura wymiennika zewnętrznego; sama bez wilgotności nie dowodzi oblodzenia."], // 68
  ["Temperatura zewnętrzna przy urządzeniu może różnić się przez słońce i przepływ powietrza."], // 69
  ["Gorący gaz za sprężarką; zależy od ciśnienia, prędkości, trybu i obciążenia. Jedna wartość lub zakres innej rodziny nie dowodzi usterki ani braku czynnika."], // 70
  ["Temperatura chłodnego gazu czynnika o niskim ciśnieniu wracającego do sprężarki."], // 71
  ["Temperatura czynnika chłodniczego w przewodzie cieczowym między wymiennikami."], // 72
  ["Temperatura czynnika przy wejściu lub wyjściu parownika."], // 73
  ["Temperatura przewodu wtrysku czynnika."], // 74
  ["Temperatura w części obiegu zawierającej ciecz i parę."], // 75
  ["Czujnik odszraniania na wymienniku; położenie i sterowanie zależą od modelu. Jeden punkt nie dowodzi lodu na całej powierzchni ani końca odszraniania."], // 76
  ["Temperatura nasycenia z ciśnienia dla danego czynnika; nie jest czujnikiem ani wartością bar."], // 77
  ["Ciśnienie wysokie/niskie: oceniaj stabilny trend tego samego trybu/modelu; rozruch, powrót oleju i odszranianie je zmieniają. Brak uniwersalnego zakresu."], // 78
  ["Prędkość sprężarki w rps steruje wydajnością, lecz nie mierzy mocy cieplnej."], // 79
  ["Polecenie EEV w krokach, bez mechanicznego sprzężenia, nie % ani przepływ. Samo nie dowodzi ruchu, zacięcia ani braku czynnika."], // 80
  ["Temperatura elektroniki sterującej silnika wentylatora zewnętrznego."], // 81
  ["Prędkość wentylatora zewnętrznego jest podana jako stopień lub obr./min."], // 82
  ["Cel wewnętrzny zależny od modelu/trybu; porównaj z odpowiadającą temperaturą nasycenia z ciśnienia. Różnica nie diagnozuje przyczyny ani napełnienia."], // 83
  ["Wewnętrzny cel temperatury tłoczenia służy ochronie sprężarki."], // 84
  ["Cel ΔT zależy od modelu i trybu; porównuj z nim, nie z uniwersalnymi 5 K."], // 85
  ["Rodzaj czynnika, np. R32/R410A, wyznacza krzywą ciśnienie–temperatura nasycenia."], // 86
  ["Temperatura mierzona przy porcie sprężarki, używana przez wewnętrzny nadzór ochronny."], // 87
  ["Odczyt ciśnienia w obiegu czynnika z jednostki zewnętrznej."], // 88
  ["Tylko pełny zestaw CT × 230 V daje niekalibrowany szacunek; okablowanie, napięcie i cos φ ograniczają wynik."], // 89
  ["Prąd pobierany przez inwerter sprężarki — przybliżenie intensywności jej pracy."], // 90
  ["Temperatura radiatora inwertera/elektroniki mocy w jednostce zewnętrznej."], // 91
  ["Aktywne stopnie elektrycznego BUH przedstawione jako stopień mocy."], // 92
  ["Stopień BUH dodaje ciepło do wody; jego zezwolenia i progi ustawia instalator."], // 93
  ["HomeHub 32: stan BSH, nie moc; rejestr 51 to osobny pobór „pompy ciepła”, nie moc BSH, a jego zakres nie jest potwierdzony."], // 94
  ["BSH może grzać bez sprężarki i pompy; X10A zgłasza tylko WŁ./WYŁ., nie moc."], // 95
  ["Stan łańcucha ochrony termicznej grzałki, który ma przerwać jej pracę po otwarciu."], // 96
  ["Ochrona rur przed mrozem wymaga zasilania i nie gwarantuje działania przy jego zaniku."], // 97
  ["Bit mrozu X10A nie jest publicznie jednoznacznie przypisany ochronie pomieszczenia lub rur."], // 98
  ["Solanka gruntowa: dopuszczalne stężenie, ciśnienie i temperatury zależą od instalacji."], // 99
  ["Tryb źródła w układzie hybrydowym: tylko pompa, praca łączona lub tylko kocioł."], // 100
  ["Docelowa temperatura zasilania podczas ogrzewania hybrydowego."], // 101
  ["Czy praca biwalentna z drugim źródłem jest aktywna lub dozwolona przez konfigurację."], // 102
  ["Bieżące żądanie pracy kotła w układzie biwalentnym lub hybrydowym."], // 103
  ["Docelowa temperatura wody żądana dla ogrzewania kotłem, nie zmierzona temperatura."], // 104
  ["BE_COP porównuje źródła hybrydowe; nie jest zmierzonym COP, a skala X10A nie jest opisana."], // 105
  ["Taryfa, Smart Grid lub solar może ograniczyć albo żądać ciepła; działanie określa konfiguracja."], // 106
  ["Nominalna moc/klasa jednostki to stała cecha modelu, nie bieżący pomiar."], // 107
  ["Tryb cichy zmniejsza hałas, lecz może ograniczyć dostępną moc ogrzewania/chłodzenia."], // 108
  ["Bieżący stan diagnostyczny z HomeHub: brak błędu, usterka lub ostrzeżenie."], // 109
  ["Znaczenie aktualnie zgłoszonego kodu usterki."], // 110
  ["Numeryczny podkod zawężający sąsiedni kod diagnostyczny Daikin."], // 111
  ["HomeHub zgłasza tylko pracę sprężarki, nie obroty ani moc; sens określa obieg i przepływ."], // 112
  ["Praca CWU: praca = WŁ., oczekiwanie/buforowanie = WYŁ.; flaga nie podaje przyczyny."], // 113
  ["Praca domu: praca = WŁ., oczekiwanie/buforowanie = WYŁ.; tryb rozróżnia ogrzewanie/chłodzenie."], // 114
  ["Temperatura wody opuszczającej PHE przed elektrycznym BUH."], // 115
  ["Temperatura zasilania za elektrycznym BUH."], // 116
  ["Temperatura wody zmierzona w zasobniku CWU."], // 117
  ["Temperatura ciekłego czynnika wymaga kontekstu trybu; pojedynczy odczyt nie diagnozuje."], // 118
  ["Temperatura głównej strefy zgłaszana przez sterownik pokojowy."], // 119
  ["Pobór układu z HomeHub zależy od grzałek; nie przypisuj całej wartości sprężarce."], // 120
  ["Odczytywany cel zasilania ogrzewania może być stały lub pogodowy; firmware go nie zmienia."], // 121
  ["Cel chłodzenia jest tylko odczytywany i ma znaczenie wyłącznie przy aktywnym chłodzeniu."], // 122
  ["Czy obieg domu jest w ogóle WŁĄCZONY — to przełącznik, nie bieżąca aktywność."], // 123
  ["Cicha praca zmniejsza hałas jednostki zewnętrznej i może obniżyć dostępną moc."], // 124
  ["Cel dogrzewania CWU nie jest progiem startu; wpływają też histereza i harmonogram."], // 125
  ["Odczytywana korekta celu ogrzewania −10…+10 K; niezerowa wartość nie dowodzi aktywnej pracy."], // 126
  ["Odczytywana korekta celu chłodzenia −10…+10 K; niezerowa wartość nie dowodzi aktywnego chłodzenia."], // 127
  ["Limit Smart Grid „zalecane włączenie”; działa niższy z nim i limitem ogólnym, to nie bieżący pobór."], // 128
  ["Ogólny limit HomeHub, także przy swobodnej pracy; to ustawiony sufit, nie zmierzony pobór."], // 129
]);

MODEL_DESCRIPTION_I18N.pl = modelDescriptionValues([
  ["Pokazuje kody błędów i ostrzeżeń zgłaszane przez pompę ciepła; krótkie opisy to ogólne wskazówki Daikin, a zniknięcie kodu nie dowodzi usunięcia przyczyny."], // health_fault
  ["R5T: punkt warstwowego zbiornika, nie energia.", "Próg projektu ≥0,8 K/h bez oznaczeń pompy/poboru. Pobór możliwy bez oznaczeń; 0 K/h nie wyklucza strat. Cyrkulacja nie dowodzi przyczyny."], // health_dhw_loss
  ["Przy brakujących pomiarach część uruchomień może nie zostać zliczona.", "Nie ma stałej liczby uruchomień uznawanej za normalną. Przy wystarczających danych ta kontrola uznaje średni czas zakończonych cykli ogrzewania wynoszący co najmniej 10 minut za wystarczający."], // health_cycling
  ["Odszranianie", "≥3 powiązane, >15% czasu pracy sprężarki przy czytelnych stanach sprężarki i odszraniania. Reguła projektu, nie Daikin; brak wilgotności i temperatury całego wymiennika."], // health_defrost
  ["24-godzinny wykres ciśnienia wody w zamkniętym obiegu hydraulicznym (X10A, minima 5-minutowe).", "Orientacja na wykresie: >1,0 bar w normie, ≤1,0 bar niskie, ≤0,5 bar krytyczne (diagnoza od 60 s ciągle). Dopuszczalne ciśnienie napełniania i pracy określa instrukcja dokładnego modelu oraz wysokość instalacji; sam odczyt nie dowodzi wycieku ani usterki."], // health_pressure
  ["Najniższy przepływ po 60 s ciągłej pracy pompy wewnętrznej; osobno: ważone próbkami statystyki różnicy temperatur wody, przepływu i wysterowania pompy po 600 s rozruchu grzania.", "Nie przepływ nominalny ani dowód pracy częściowej. Dotyczy wspólnego wymiennika wodnego. Wysterowanie pompy to nie obroty ani wysokość podnoszenia. Filtr projektu 600 s (luki ≤15 s) nie dowodzi stanu ustalonego, porównania z celem ani przyczyny hydraulicznej."], // health_flow
  ["Czas ON BUH/BSH", "nie energia ani dowód zbędnego grzania."], // health_heater
  ["5 eksperymentalnych liczników", "porównywalne wzrosty; luki/reset pomijane. Stabilność nie wyklucza ograniczeń ani nie dowodzi przyczyny."], // health_retries
  ["RAM 24 h: stabilna lub spadki z odbiciem; stały spadek, możliwy wyciek; zgodny restart z zasilaniem: możliwy wykres RAM. Inaczej tylko zgodne datowane 5 min dziennika flash po synchronizacji czasu. Co 5 min krótka przerwa może pozostać niewidoczna; otwarty/ostatnie niezapisane mogą zniknąć."], // 8
  ["Największy ciągły blok wolnej pamięci RAM. TLS i OTA potrzebują jednego dość dużego bloku, nawet gdy łącznie wolnej pamięci jest więcej. Zawsze nie większy niż cała wolna RAM. Jeśli wolna RAM jest stabilna, a ten blok maleje, rośnie fragmentacja sterty i duża alokacja może zawieść przed wyczerpaniem pamięci."], // 9
  ["Nominalna moc jednostki zewnętrznej z jej strony identyfikacyjnej. To klasa sprzętu, nie aktualna produkcja."], // 10
  ["Nominalna moc JEDNOSTKI WEWNĘTRZNEJ. Jest pokazana, gdy strona identyfikacji zewnętrznej nie ma własnej mocy; etykieta wskazuje źródło. Jednostki mogą mieć różne klasy. Nie odczytuj tego jako mocy zewnętrznej ani całego systemu."], // 11
  ["Ta sama klasa i rejestry: wybór reprezentanta nie zmienia dekodowanych wartości."], // 12
  ["Kilka rodzin Daikin udostępnia te same rejestry, więc interfejs nie rozróżnia nazwy handlowej. Nagłówek pozostaje „Daikin Altherma”, bez zgadywania. Jednostka zewnętrzna nie podaje mocy, więc kandydaci mogą mieć różne klasy. Firmware dekoduje wariant najlepiej pasujący do wewnętrznej, ale bez pełnej pewności. Porównaj identyfikator z tabliczką."], // 13
  ["Surowe bajty ID bez publicznej tabeli nazw; przy niejasności porównaj je znak po znaku z tabliczką."], // 14
]);

FAULT_CODE_I18N.pl = faultCodeValues([
  "Problem z przepływem wody", // 7H
  "Usterka czujnika temperatury powrotu", // 80
  "Usterka czujnika temperatury zasilania", // 81
  "Włączona ochrona wymiennika przed zamarzaniem", // 89
  "Nietypowy wzrost temperatury na wyjściu CWU", // 8F
  "Nietypowy wzrost temperatury zasilania", // 8H
  "Błąd wykrywania przejścia przez zero", // A1
  "Problem z ograniczeniem wysokiego ciśnienia lub ochroną przeciwzamrożeniową", // A5
  "Grzałka wspomagająca przegrzana lub niepodłączona", // AA
  "Grzałka zasobnika przegrzana", // AC
  "Dezynfekcja antylegionellowa zasobnika niezakończona", // AH
  "Przekroczony czas nagrzewania CWU", // AJ
  "Usterka czujnika przepływu", // C0
  "Usterka czujnika temperatury wymiennika", // C4
  "Usterka czujnika wymiennika", // C5
  "Usterka czujnika temperatury pomieszczenia", // CJ
  "Usterka płyty elektroniki jednostki zewnętrznej", // E1
  "Błąd wykrywania prądu upływowego", // E2
  "Zadziałał presostat wysokiego ciśnienia jednostki zewnętrznej", // E3
  "Błąd ciśnienia ssania", // E4
  "Przegrzanie silnika sprężarki inwerterowej jednostki zewnętrznej", // E5
  "Sprężarka jednostki zewnętrznej nie uruchamia się", // E6
  "Usterka silnika wentylatora jednostki zewnętrznej", // E7
  "Przepięcie na wejściu jednostki zewnętrznej", // E8
  "Usterka elektronicznego zaworu rozprężnego", // E9
  "Problem przełączania chłodzenie/grzanie w jednostce zewnętrznej", // EA
  "Nietypowy wzrost temperatury zasobnika", // EC
  "Błąd temperatury rury tłocznej jednostki zewnętrznej", // F3
  "Nietypowo wysokie ciśnienie jednostki zewnętrznej podczas chłodzenia", // F6
  "Nietypowo wysokie ciśnienie; zadziałał presostat wysokiego ciśnienia", // FA
  "Usterka czujnika napięcia lub prądu jednostki zewnętrznej", // H0
  "Usterka zewnętrznego czujnika temperatury", // H1
  "Usterka presostatu wysokiego ciśnienia jednostki zewnętrznej", // H3
  "Usterka zabezpieczenia przeciążeniowego sprężarki", // H5
  "Usterka czujnika położenia jednostki zewnętrznej", // H6
  "Usterka układu CT prądu wejściowego sprężarki zewnętrznej", // H8
  "Usterka czujnika temperatury zewnętrznej jednostki zewnętrznej", // H9
  "Usterka czujnika temperatury zasobnika", // HC
  "Usterka czujnika ciśnienia wody", // HJ
  "Usterka czujnika rury tłocznej jednostki zewnętrznej", // J3
  "Usterka czujnika wymiennika jednostki zewnętrznej", // J6
  "Usterka czujnika wysokiego ciśnienia jednostki zewnętrznej", // JA
  "Usterka płyty inwertera", // L1
  "Nietypowy wzrost temperatury w skrzynce sterującej jednostki zewnętrznej", // L3
  "Nietypowy wzrost temperatury radiatora inwertera jednostki zewnętrznej", // L4
  "Wykryto przetężenie DC inwertera jednostki zewnętrznej", // L5
  "Zadziałało zabezpieczenie termiczne płyty inwertera", // L8
  "Zadziałało zabezpieczenie przed zablokowaniem sprężarki", // L9
  "Usterka systemu komunikacji jednostki zewnętrznej", // LC
  "Asymetria lub zanik fazy zasilania", // P1
  "Wykryto nieprawidłowe napięcie DC", // P3
  "Usterka czujnika temperatury radiatora jednostki zewnętrznej", // P4
  "Niezgodne ustawienie wydajności", // PJ
  "Niedobór czynnika chłodniczego w jednostce zewnętrznej", // U0
  "Odwrócona kolejność lub zanik fazy", // U1
  "Błąd napięcia sieciowego jednostki zewnętrznej", // U2
  "Program suszenia jastrychu ogrzewania podłogowego nie zakończył się prawidłowo", // U3
  "Problem komunikacji jednostki wewnętrznej z zewnętrzną", // U4
  "Problem komunikacji z panelem sterowania", // U5
  "Błąd transmisji między głównym CPU a CPU inwertera jednostki zewnętrznej", // U7
  "Problem komunikacji z adapterem LAN, termostatem pokojowym lub USB", // U8
  "Nieprawidłowe połączenie lub zgodność jednostek", // UA
  "Wykryto zamienione rury lub błędne okablowanie komunikacji", // UF
], "Nie jest przesyłany żaden kod błędu.", "Brak krótkiego opisu tego kodu.");

MB_DELTA_I18N.pl = mbDeltaValues([
  "przy zatrzymanej sprężarce X10A zachowuje wartość z ostatniej pracy; rejestr HomeHub jest nadal odczytywany, ale nie ma czasu pomiaru", // outdoor_air
  "oba odczyty pochodzą z różnych regulatorów pomieszczenia", // room_temp
]);
