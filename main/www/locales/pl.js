// translation-source: 5d871d5ac649125e5dd02c251c9b45a34dc6cedbda5e9c48c95895bed7694182
const plNoun = (n, one, few, many) => {
  const value = Math.abs(Number(n)), mod10 = value % 10, mod100 = value % 100;
  return value === 1 ? one
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many;
};
I18N.pl = localeValues([
  /* sys.nodata */ "Brak danych",
  /* sys.unreachable */ "Nieosiągalne",
  /* sys.x10a_down */ "X10A poza siecią",
  /* sys.mb_carrying */ "Nieznany tryb pracy — odczyty z Modbus",
  /* sys.mb_only */ "X10A poza siecią — odczyty z Modbus",
  /* sys.mb_source */ "X10A poza siecią · Modbus",
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
  /* sys.online */ "W sieci",
  /* sys.fault */ "Usterka",
  /* sys.warning */ "Ostrzeżenie",
  /* sys.fault_line */ (c) => "Usterka · " + c + " — sprawdź kod usterki Daikin.",
  /* sys.warning_line */ (c) => "Ostrzeżenie · " + c + " — sprawdź pompę ciepła.",
  /* sys.polled */ (s) => `Odczytano ${s} s temu`,
  /* recovery.title */ "Tryb odzyskiwania",
  /* recovery.meta_heap */ "Urządzeniu wielokrotnie zabrakło pamięci i uruchomiło się ponownie. Działa teraz z wyłączonym połączeniem z pompą ciepła i MQTT, aby interfejs WWW pozostał dostępny. Konfiguracja jest najprawdopodobniej prawidłowa — zainstaluj nowszą wersję firmware w Ustawieniach. Wyłączenie i ponowne włączenie zasilania ponawia uruchomienie pełnego zestawu usług.",
  /* recovery.meta */ "Urządzenie wielokrotnie uruchomiło się ponownie i weszło w tryb odzyskiwania. Komunikacja z pompą ciepła i MQTT jest wstrzymana. Sprawdź konfigurację — zwłaszcza piny RX/TX na karcie Protokół w Ustawieniach — a następnie uruchom urządzenie ponownie.",
  /* rollback.title */ "Zmiana WiFi nie powiodła się — przywrócono poprzednie ustawienia",
  /* rollback.meta */ (back) => `Urządzenie nie mogło połączyć się z użyciem nowych ustawień WiFi. Przywróciło poprzednią sieć${back} i uruchomiło się ponownie. Sprawdź nazwę sieci i hasło w Ustawienia → Połączenia, a następnie spróbuj ponownie.`,
  /* crash.title_fault */ "Urządzenie uruchomiło się ponownie po awarii",
  /* crash.title_orphan */ "Raport awarii oczekuje od wcześniejszego ponownego uruchomienia",
  /* crash.reset */ "Reset",
  /* crash.task */ "zadanie",
  /* crash.fw */ "FW",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "uszkodzony",
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
  /* bug.what_ph */ "Od rana temperatura zbiornika wskazuje 12800 °C w Home Assistant.",
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
  /* nav.settings_alert */ (n) => `Ustawienia — ${n} ${plNoun(n, "połączenie niedostępne", "połączenia niedostępne", "połączeń niedostępnych")}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Oba źródła są zgodne",
  /* src.delta */ (d, u) => `Różnica ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Oba źródła podają różny stan",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Wyszukiwanie…",
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
  /* modbus.err.request_failed */ (r) => `Nie można utworzyć żądania Modbus${r ? ` dla rejestru ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Upłynął limit czasu wysyłania żądania Modbus${r ? ` przy rejestrze ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `Nie można wysłać żądania Modbus${r ? ` przy rejestrze ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Upłynął limit czasu odpowiedzi HomeHub${r ? ` przy rejestrze ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `HomeHub zamknął połączenie${r ? ` przy rejestrze ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `Nie można odczytać odpowiedzi HomeHub${r ? ` przy rejestrze ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Nieprawidłowa odpowiedź Modbus${r ? ` przy rejestrze ${r}` : ""}.`,
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
  /* service.title */ "Obieg chłodniczy podczas ogrzewania",
  /* service.state.waiting */ "CZEKA NA OGRZEWANIE",
  /* service.state.observing */ "REJESTRUJE",
  /* service.state.limited */ "REJESTRUJE · BRAK CZĘŚCI DANYCH",
  /* service.state.interrupted */ "WSTRZYMANE",
  /* service.row.window */ "Zarejestrowano dotąd",
  /* service.row.reason */ "Dlaczego ten stan?",
  /* service.reason.unsupported_profile */ "Ten model nie udostępnia wszystkich potrzebnych odczytów.",
  /* service.reason.compressor_not_running */ "Sprężarka nie pracuje.",
  /* service.reason.unsupported_or_unknown_mode */ "Pompa ciepła nie pracuje w zwykłym ogrzewaniu albo tryb jest niedostępny.",
  /* service.reason.dhw_path */ "Pompa ciepła ogrzewa ciepłą wodę użytkową.",
  /* service.reason.defrost */ "Jednostka zewnętrzna jest odszraniana.",
  /* service.reason.unit_fault */ "Pompa ciepła zgłasza usterkę.",
  /* service.reason.special_controller_phase */ "Aktywna jest krótka faza rozruchu lub specjalnej regulacji.",
  /* service.reason.missing_fresh_signal */ "Brakuje co najmniej jednego potrzebnego bieżącego odczytu.",
  /* service.reason.poll_gap */ "Połączenie X10A zostało przerwane lub celowo wstrzymane.",
  /* service.window */ (d, n) => `${d} · ${n} ${n === 1 ? "bieżący odczyt" : "bieżące odczyty"}`,
  /* service.help.observing */ "Wartości są teraz rejestrowane ciągle podczas zwykłego ogrzewania.",
  /* service.help.limited */ "Rejestrowanie trwa, ale brakuje niektórych dodatkowych odczytów porównawczych.",
  /* service.help.interrupted */ "Rejestrowanie zakończyło się i uruchomi automatycznie przy następnym odpowiednim ogrzewaniu.",
  /* service.common */ "W obsługiwanych modelach uruchamia się automatycznie przy zwykłym ogrzewaniu; bez trybu serwisowego i zmian ustawień. Nie ocenia czynnika ani norm. Wartość zaworu: polecenie, nie zmierzona pozycja.",
  /* check.fault */ "Usterka jednostki",
  /* check.dhw_loss */ "Strata ciepła zbiornika CWU",
  /* check.cycling */ "Uruchomienia sprężarki",
  /* check.defrost */ "Cykle odszraniania",
  /* check.pressure */ "Ciśnienie wody, najniższe",
  /* check.flow */ "Przepływ, najniższy",
  /* check.heater */ "Grzałka dodatkowa",
  /* check.retries */ "Ponowienia zabezpieczeń",
  /* check.status.ok */ "OK",
  /* check.status.info */ "UWAGA",
  /* check.status.warn */ "OSTRZEŻENIE",
  /* check.status.collecting */ "SPRAWDZANIE",
  /* check.status.observation */ "TYLKO POMIAR",
  /* check.status.experimental */ "EKSPERYMENTALNE",
  /* check.status.unavailable */ "NIEDOSTĘPNE",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · oceniono ${n}/${a}` : s,
  /* check.detail.value_label */ "Wartość:",
  /* check.detail.assessment_label */ "Ocena:",
  /* check.detail.ok */ "Ocena zakończona; w obserwowanych danych instalacji nie wykryto problemu.",
  /* check.detail.info */ "Warto o tym wiedzieć, ale nie jest to dowód usterki. To, co jest tutaj uznawane za istotne, opisano poniżej w sekcji „Norma”.",
  /* check.detail.warn */ "Wskazanie urządzenia lub udokumentowany limit wymagają uwagi.",
  /* check.detail.fault.error */ "Jednostka zgłasza obecnie błąd. Dokładny kod znajduje się na karcie „Praca”.",
  /* check.detail.fault.warning */ "Jednostka zgłasza obecnie ostrzeżenie lub przestrogę, a nie błąd. Dokładny kod znajduje się na karcie „Praca”.",
  /* check.detail.fault.past */ "Obecnie nic nie jest zgłaszane. W ciągu ostatnich 24 godzin pojawił się komunikat, który sam zniknął, dlatego ten wiersz nie ma stanu OK. Komunikat, który zniknął, nie wymaga działania; jeśli powraca, zanotuj, kiedy się pojawia.",
  /* check.detail.fault.past_unknown */ "W ciągu ostatnich 24 godzin pojawił się komunikat. Nie można odczytać, czy jest teraz aktywny — wiersz usterek nie odpowiada, więc sprawdź połączenie X10A.",
  /* check.detail.collecting */ (n, r) => `Zebrano ${n} z ${r}; ocena nie jest jeszcze możliwa.`,
  /* check.detail.cycling_split */ " Oceniane jest tu tylko potwierdzone ogrzewanie pomieszczeń. Cykle ciepłej wody podlegają innym ograniczeniom; jednoznacznie rozpoznane chłodzenie jest wykluczone. Zliczanie odbywa się dla pełnego cyklu: zawór 3-drogowy oraz, w obiegu pomieszczeń, tryb pracy I/U muszą pozostać czytelne i niezmienne przez cały cykl. Wszystko inne pozostaje niesklasyfikowane i nie jest oceniane.",
  /* check.detail.cycling_pooled */ " Wszystkie cykle oceniono łącznie z powodu niewystarczających danych klasyfikacyjnych: dane wejściowe były zbyt rzadkie, sklasyfikowano mniej niż 12 cykli albo ponad 10% zakończonych cykli pozostało niesklasyfikowanych. Ciepła woda lub chłodzenie mogą więc ukryć krótkie cykle ogrzewania. Widoczne obok dane klas są obserwacjami, a nie podstawą werdyktu.",
  /* check.detail.outdoor_cycling */ " Dane zewnętrzne X10A obejmują tylko świeże próbki z zakończonych, konsekwentnie sklasyfikowanych cykli ogrzewania pomieszczeń. Stanowią kontekst i nie zmieniają progu ani oceny taktowania.",
  /* check.detail.outdoor_defrost */ " Dane zewnętrzne X10A obejmują tylko świeże próbki, gdy stan odszraniania i sprężarki był czytelny, a sprężarka pracowała. Stanowią kontekst i nie zmieniają progu ani oceny odszraniania.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} z ${r} zakończono w czystych oknach godzinnych; bieżące czyste okno: ${c} z ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} z ${r} zakończono w czystych oknach godzinnych; wykryto ładowanie zbiornika lub BSH, pozostały czas stabilizacji: ${s}.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} z ${r} zakończono w czystych oknach godzinnych; nie ma jeszcze pełnego czystego okna godzinnego.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${plNoun(n, "odrzucone okno kandydujące", "odrzucone okna kandydujące", "odrzuconych okien kandydujących")} (${reasons}); najdłuższe osiągnęło ${best} z 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `Brak możliwości oceny tą metodą: przez pełne 24 godziny nie zakończyło się ani jedno czyste okno godzinne, a odrzucono ${n} ${plNoun(n, "okno kandydujące", "okna kandydujące", "okien kandydujących")} (${reasons}); najdłuższe osiągnęło ${best} z 60 min. Ładowanie zbiornika wymaga 105 niezakłóconych minut (45 min stabilizacji i okno 60 min); pobór wody, praca pompy, nieczytelne dane lub ciągła strata ciepła na tyle szybka, że przypomina pobór, również mogą uniemożliwić czystą godzinę. Zapisane sumy nie wskazują dominującej przyczyny, więc nie można wykluczyć szybkiej ciągłej straty ciepła.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `Brak możliwości oceny: przez pełne 24 godziny nie zakończyło się ani jedno czyste okno godzinne, a odrzucono ${n === 1 ? "jedyne okno kandydujące" : `wszystkie ${n} ${plNoun(n, "okno kandydujące", "okna kandydujące", "okien kandydujących")}`}, ponieważ połączenie X10A przestało odpowiadać w trakcie okna; najdłuższe osiągnęło ${best} z 60 min. Problem dotyczy połączenia, nie instalacji — sprawdź okablowanie X10A i piny RX/TX.`,
  /* check.detail.dhw_reason.charge */ "ładowanie zbiornika",
  /* check.detail.dhw_reason.pump */ "pompa wewnętrzna",
  /* check.detail.dhw_reason.draw */ "spadek podobny do poboru",
  /* check.detail.dhw_reason.reading */ "niewiarygodne R5T",
  /* check.detail.dhw_reason.blind */ "X10A nie odpowiada",
  /* check.detail.collecting_unknown */ "Za mało użytecznych danych do oceny.",
  /* check.detail.observation */ "Tylko wartość zmierzona; nie istnieje uniwersalny limit OK/OSTRZEŻENIE.",
  /* check.detail.experimental */ "Obserwacja eksperymentalna; stabilny licznik nie dowodzi, że nie wystąpiło ograniczenie.",
  /* check.detail.unavailable */ "Aktywny profil nie dostarcza danych pozwalających ocenić tę kontrolę.",
  /* check.starts */ (n) => `${n} ${plNoun(n, "uruchomienie", "uruchomienia", "uruchomień")}`,
  /* check.cycles */ (n) => `${n} ${plNoun(n, "cykl", "cykle", "cykli")}`,
  /* check.paired_cycles */ (n) => `${n} ${plNoun(n, "sparowany", "sparowane", "sparowanych")}`,
  /* check.mean */ (d) => `${d}/uruchomienie`,
  /* check.cycling_space */ (n, d) => d ? `pomieszczenia ${n} × ${d}` : `pomieszczenia ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `ciepła woda ${n} × ${d}` : `ciepła woda ${n}`,
  /* check.cycling_cooling */ (n) => `chłodzenie: wykluczono ${n}`,
  /* check.cycling_censored */ (n) => `${n} ${plNoun(n, "niesklasyfikowany", "niesklasyfikowane", "niesklasyfikowanych")}`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · średnia ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `zbiornik ${m} min`,
  /* check.tank_runtime */ (d) => `zbiornik ${d}`,
  /* check.loss_windows */ (n) => `${n} ${plNoun(n, "okno", "okna", "okien")}`,
  /* check.loss_pump_off */ "również przy wyłączonej pompie cyrkulacyjnej",
  /* check.loss_with_pump */ "podczas pracy pompy cyrkulacyjnej",
  /* check.loss_unattributed */ "niepełne przypisanie do pompy",
  /* check.fault_err */ "Usterka aktywna",
  /* check.fault_warn */ "Ostrzeżenie aktywne",
  /* check.fault_past */ "Wystąpiło w ciągu ostatnich 24 h · teraz nieaktywne",
  /* check.fault_none */ "Brak aktywnych",
  /* check.fault_unknown */ "Bieżący stan nieznany",
  /* check.fault_past_unknown */ "Wystąpiło w ciągu ostatnich 24 h · bieżący stan nieznany",
  /* check.retry_seen */ "Wykryto wzrost licznika",
  /* check.retry_none */ "Nie wykryto wzrostu",
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
  /* hist.loading */ "Ładowanie przebiegu…",
  /* hist.none */ "Nie zarejestrowano jeszcze odczytów.",
  /* hist.err */ "Przebieg niedostępny.",
  /* hist.gaps */ (n) => `${n} ${plNoun(n, "przerwa", "przerwy", "przerw")} — brak pomiaru`,
  /* hist.nm */ "brak pomiaru",
  /* hist.rel */ (h) => `${h} h temu`,
  /* hist.held */ "jednostka zewnętrzna w spoczynku",
  /* hist.heldnote */ (h) => `${h} h spoczynku — brak pomiaru`,
  /* hist.forecast */ "Open-Meteo · prognoza",
  /* hist.in_hours */ (h) => `za ${h} h`,
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
  /* hist.boost_aria */ (l, d) => `${l} — oś czasu stanu Smart Grid ze wszystkimi czterema trybami. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.defrost_total */ (d) => `Zaobserwowane aktywne odszranianie · ${d} próbkowanego czasu`,
  /* hist.defrost_none */ "Nie zaobserwowano cyklu odszraniania w zarejestrowanym okresie.",
  /* hist.defrost_active */ "Odszranianie aktywne",
  /* hist.defrost_inactive */ "Odszranianie wyłączone",
  /* hist.defrost_aria */ (l, d) => `${l} — oś czasu odszraniania. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.quiet_total */ (d) => `Zaobserwowany aktywny tryb cichy · ${d} próbkowanego czasu`,
  /* hist.quiet_none */ "Nie zaobserwowano okresu trybu cichego w zarejestrowanym okresie.",
  /* hist.quiet_active */ "Tryb cichy aktywny",
  /* hist.quiet_inactive */ "Tryb cichy wyłączony",
  /* hist.quiet_aria */ (l, d) => `${l} — oś czasu trybu cichego. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.heater_total */ (d) => `Zaobserwowana aktywna grzałka · ${d} próbkowanego czasu`,
  /* hist.heater_none */ "Nie zaobserwowano użycia grzałki zbiornika w zarejestrowanym okresie.",
  /* hist.heater_active */ "Grzałka aktywna",
  /* hist.heater_inactive */ "Grzałka wyłączona",
  /* hist.heater_aria */ (l, d) => `${l} — oś czasu grzałki zbiornika. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.preheat_total */ (d) => `Zaobserwowane aktywne wstępne podgrzewanie zbiornika · ${d} próbkowanego czasu`,
  /* hist.preheat_none */ "Nie zaobserwowano okresu wstępnego podgrzewania zbiornika w zarejestrowanym okresie.",
  /* hist.preheat_active */ "Wstępne podgrzewanie zbiornika aktywne",
  /* hist.preheat_inactive */ "Wstępne podgrzewanie zbiornika wyłączone",
  /* hist.preheat_aria */ (l, d) => `${l} — oś czasu wstępnego podgrzewania zbiornika X10A. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.disinfection_total */ (d) => `Zaobserwowana aktywna dezynfekcja · ${d} próbkowanego czasu`,
  /* hist.disinfection_none */ "Nie zaobserwowano dezynfekcji w zarejestrowanym okresie.",
  /* hist.disinfection_active */ "Dezynfekcja aktywna",
  /* hist.disinfection_inactive */ "Dezynfekcja wyłączona",
  /* hist.disinfection_aria */ (l, d) => `${l} — oś czasu dezynfekcji HomeHub. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.buh_total */ (d) => `Zaobserwowana aktywna grzałka dodatkowa · ${d} próbkowanego czasu`,
  /* hist.buh_none */ "Nie zaobserwowano użycia grzałki dodatkowej w zarejestrowanym okresie.",
  /* hist.buh_active */ "Grzałka dodatkowa aktywna",
  /* hist.buh_inactive */ "Grzałka dodatkowa wyłączona",
  /* hist.buh_step1 */ "Stopień 1",
  /* hist.buh_step2 */ "Stopień 2",
  /* hist.buh_aria */ (l, d) => `${l} — oś czasu grzałki dodatkowej. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.valve_dhw_total */ (d) => `CWU · ${d}`,
  /* hist.valve_space_total */ (d) => `Obieg pomieszczeń · ${d}`,
  /* hist.valve_none */ "Brak pozycji CWU w zarejestrowanym okresie.",
  /* hist.valve_dhw */ "CWU",
  /* hist.valve_space */ "Obieg pomieszczeń",
  /* hist.valve_aria */ (l, d) => `${l} — oś czasu zaworu 3-drogowego. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.circ_total */ (d) => `Zaobserwowana praca pompy · ${d} próbkowanego czasu`,
  /* hist.circ_none */ "Nie zaobserwowano pracy pompy w zarejestrowanym okresie.",
  /* hist.circ_on */ "Pracuje",
  /* hist.circ_off */ "Zatrzymana",
  /* hist.circ_unavailable */ "Niedostępne",
  /* hist.circ_gaps */ (n) => `${n} ${plNoun(n, "niedostępny okres", "niedostępne okresy", "niedostępnych okresów")}`,
  /* hist.circ_aria */ (l, d) => `${l} — oś czasu pompy cyrkulacyjnej. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.valve2_on_total */ (d) => `Wyjście 2WV WŁ. · ${d}`,
  /* hist.valve2_off_total */ (d) => `Wyjście 2WV WYŁ. · ${d}`,
  /* hist.valve2_on */ "Wyjście 2WV WŁ.",
  /* hist.valve2_off */ "Wyjście 2WV WYŁ.",
  /* hist.valve2_none */ "Nie zarejestrowano włączenia wyjścia zaworu 2-drogowego w wybranym okresie.",
  /* hist.valve2_aria */ (l, d) => `${l} — oś czasu wyjścia zaworu 2-drogowego. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* hist.flow_switch_total */ (d) => `Stan X10A WŁ. · ${d} próbkowanego czasu`,
  /* hist.flow_switch_on */ "Stan X10A WŁ.",
  /* hist.flow_switch_off */ "Stan X10A WYŁ.",
  /* hist.flow_switch_none */ "Nie zarejestrowano włączenia tego stanu X10A w wybranym okresie.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — oś czasu styku przepływu wody. ${d}. Klawisze strzałek odczytują poszczególne próbki.`,
  /* toast.saved */ "Zapisano",
  /* toast.no_changes */ "Brak zmian",
  /* toast.reboot */ "Ponowne uruchamianie — łączenie…",
  /* toast.rebooted */ "Uruchomiono ponownie — połącz się ponownie z urządzeniem",
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
  /* wifi.err_ssid */ "SSID może mieć najwyżej 32 znaki",
  /* wifi.err_pass */ "Hasło musi być puste (sieć otwarta) albo mieć od 8 do 63 znaków",
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
  /* dyn.card */ "Diagnostyka krzywej grzewczej",
  /* dyn.state */ "Stan",
  /* dyn.state_recording */ "Rejestrowanie",
  /* dyn.state_recording_nowx */ "Rejestrowanie · brak prognozy",
  /* dyn.state_waiting */ "Oczekiwanie na ogrzewanie pomieszczeń",
  /* dyn.state_cooling */ "Chłodzenie · bez próbkowania",
  /* dyn.state_room */ "Źródło temperatury pomieszczenia nieużyteczne",
  /* dyn.state_x10a */ "X10A poza siecią",
  /* dyn.state_homehub */ "HomeHub poza siecią",
  /* dyn.state_gate */ "Stan instalacji nieznany",
  /* dyn.state_mode */ "Tryb ogrzewania/chłodzenia nieznany",
  /* dyn.state_clock */ "Zegar nieustawiony",
  /* dyn.state_blocked */ "Brak rejestrowania",
  /* dyn.state_setup_room */ "Skonfiguruj źródło temperatury pomieszczenia",
  /* dyn.state_setup_homehub */ "HomeHub nieskonfigurowany",
  /* dyn.state_homehub_disabled */ "Diagnostyka wyłączona — HomeHub wyłączony",
  /* dyn.state_no_broker */ "Brak rejestrowania — brak brokera MQTT",
  /* dyn.state_safe_mode */ "Brak rejestrowania — tryb bezpieczny",
  /* dyn.state_inactive */ "Brak rejestrowania — próbnik nie działa",
  /* dyn.room_off */ "Termostat pokojowy wyłączony",
  /* dyn.room_not_heating */ "Termostat pokojowy nie jest w trybie ogrzewania",
  /* dyn.room_stale */ "Odczyt temperatury pomieszczenia jest za stary",
  /* dyn.room_no_value */ "Oczekiwanie na odczyt temperatury pomieszczenia",
  /* dyn.room_invalid_payload */ "Nieprawidłowy komunikat MQTT",
  /* dyn.room_invalid_temperature */ "Temperatura pomieszczenia poza dozwolonym zakresem",
  /* dyn.room_invalid_setpoint */ "Temperatura docelowa poza dozwolonym zakresem",
  /* dyn.room_no_setpoint */ "Brak temperatury docelowej",
  /* dyn.room_no_time */ "Brak czasu pomiaru",
  /* dyn.room_retained_no_time */ "Wartość retained bez czasu pomiaru",
  /* dyn.room_future_time */ "Czas pomiaru jest w przyszłości",
  /* dyn.room_backward_time */ "Czas pomiaru cofnął się",
  /* dyn.room_invalid_time */ "Nieprawidłowy czas pomiaru",
  /* dyn.room_no_enabled */ "Brak stanu włączenia termostatu",
  /* dyn.room_no_hvac_mode */ "Brak trybu pracy termostatu",
  /* dyn.room_source */ "Źródło temperatury pomieszczenia",
  /* dyn.weather */ "Opcjonalna prognoza porównawcza",
  /* dyn.strategy */ "Sygnał diagnostyczny",
  /* dyn.not_configured */ "Nieskonfigurowane",
  /* dyn.outdoor */ "Zmierzona temperatura powietrza zewnętrznego",
  /* dyn.outdoor_detail_status */ "Stan",
  /* dyn.outdoor_detail_now */ "Bieżący odczyt",
  /* dyn.outdoor_detail_sample */ "Przy ostatnim zarejestrowanym zdarzeniu",
  /* dyn.outdoor_status_live */ (source) => `${source} ma bieżący odczyt; jest on dołączany do każdego zarejestrowanego zdarzenia jako kontekst.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} jest skonfigurowane, ale nie ma bieżącego odczytu. Zdarzenia są nadal rejestrowane bez tej osi.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} nie jest skonfigurowane. Zdarzenia są nadal rejestrowane bez tej osi.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} jest skonfigurowane, ale obecnie nic nie jest rejestrowane. Powyższy wiersz stanu podaje przyczynę.`,
  /* dyn.outdoor_sample_none */ "Zarejestrowano bez wartości zewnętrznej",
  /* dyn.outdoor_help_axis */ "Temperatura zewnętrzna pozwala zinterpretować zarejestrowane odchylenie temperatury pomieszczenia. Bez niej +0,5 K przy −5 °C i +0,5 K przy +12 °C wyglądają tak samo, choć pierwsze wskazuje na zbyt stromą krzywą, a drugie na krzywą ustawioną zbyt wysoko. Jest opcjonalna: rejestrowanie trwa bez niej, a wartość nigdy nie decyduje o zarejestrowaniu zdarzenia.",
  /* dyn.outdoor_help_placement */ "Jest to wartość mierzona przez czujnik w miejscu montażu. Firmware nie może określić, gdzie się znajduje — obok jednostki wewnętrznej mierzy powietrze w pomieszczeniu, w zacienionym miejscu na zewnątrz rzeczywiste powietrze zewnętrzne, i tylko ten drugi wariant nadaje porównaniu sens.",
  /* dyn.outdoor_help_setup */ "Dane może dostarczać M5Stack ENV III podłączony do portu Grove płytki. Zamontowany na zewnątrz, w cieniu, stale mierzy powietrze zewnętrzne — w przeciwieństwie do czujnika pompy ciepła, który przestaje być odświeżany, gdy jednostka zewnętrzna odpoczywa. Konfiguruje się go w ESP32 → Sprzęt razem z płytką, do której jest podłączony.",
  /* dyn.plant_outdoor */ "Powietrze zewnętrzne instalacji",
  /* dyn.plant_outdoor_help */ "To wejście HomeHub 44, czyli własna wartość powietrza zewnętrznego pompy ciepła. Jest pobierana z tego samego bieżącego cyklu Modbus co warunki okna ogrzewania, a jej źródło jest zapisywane ze zdarzeniem. Pozostaje oddzielna od ENV III i nigdy nie zmienia decyzji o zarejestrowaniu zdarzenia.",
  /* dyn.shadow_strategy */ "Surowe odchylenie temperatury pomieszczenia · 30 min",
  /* dyn.card_help */ "Co 30 minut podczas jednoznacznie rozpoznanego ogrzewania pomieszczeń firmware rejestruje odchylenie temperatury pomieszczenia referencyjnego od wartości docelowej wraz z temperaturą zewnętrzną w tej chwili, jeśli dostarcza ją czujnik. W połączeniu z czasem pracy, minimalnymi ograniczeniami temperatury wody zasilającej i aktywnością termostatu długoterminowy przebieg może wskazać, czy krzywa grzewcza jest zwykle zbyt wysoka lub zbyt niska. Odchylenie temperatury pomieszczenia o 1 K nie oznacza automatycznie zmiany temperatury wody zasilającej o 1 K. Ta funkcja tylko odczytuje dane i nie zapisuje niczego do pompy ciepła.",
  /* dyn.state_help_recording */ "Potwierdzone ogrzewanie pomieszczeń działa, a dane z pomieszczenia są prawidłowe, dlatego rejestrowane są surowe próbki błędu temperatury. Oceniaj przebieg sezonu wraz z czasem pracy i dowodami ograniczeń; pojedyncza próbka nie jest werdyktem.",
  /* dyn.state_help_waiting */ "Instalacja nie pracuje teraz w normalnym trybie pomieszczeń, dlatego próbka nie jest rejestrowana. Latem jest to normalny, oczekiwany stan, a nie usterka.",
  /* dyn.state_help_cooling */ "HomeHub zgłasza normalną pracę obiegu pomieszczeń, ale bieżącym trybem jest chłodzenie. Okna chłodzenia są celowo wykluczone ze zbioru danych krzywej grzewczej.",
  /* dyn.state_help_blocked */ "Brakuje wymaganego wejścia, dlatego nic nie jest rejestrowane. Rejestrowanie zostanie wznowione, gdy wróci; nieaktualne ani niejednoznaczne dane nigdy nie są próbkowane.",
  /* dyn.state_help_room */ "Odczyt z pomieszczenia dociera do urządzenia, ale obecnie nie pozwala obliczyć prawidłowego odchylenia od celu. Próbka nie powstanie, dopóki źródło nie będzie ponownie użyteczne.",
  /* dyn.state_help_setup */ "Diagnostyka rozpoczyna się po zapisaniu źródła temperatury pomieszczenia MQTT ze znacznikiem czasu i wartością docelową. Prognoza jest opcjonalnym materiałem porównawczym; ujawnianie lokalizacji nie jest wymagane.",
  /* dyn.state_help_inactive */ "Źródła są skonfigurowane, ale nic ich nie ocenia: próbnik działa w ramach połączenia MQTT, a ta płytka uruchomiła się w trybie bezpiecznym po powtarzających się awariach podczas rozruchu, w którym wszystkie opcjonalne usługi pozostają wyłączone. Nic nie przepada — rejestrowanie wznowi się automatycznie, gdy płytka znów uruchomi się normalnie.",
  /* dyn.state_help_no_broker */ "Źródło temperatury pomieszczenia jest zapisane, ale diagnostyka odczytuje je przez MQTT, a broker nie jest skonfigurowany. Ustaw brokera na karcie Połączenia; zapisane źródło zostanie zachowane, a rejestrowanie uruchomi się automatycznie.",
  /* dyn.state_help_setup_homehub */ "Diagnostyka wymaga HomeHub, aby określić, kiedy instalacja rzeczywiście ogrzewa; bez niego nie odróżni okna ogrzewania od ciepłej wody ani postoju. Ustaw adres HomeHub na karcie Protokół.",
  /* dyn.state_help_homehub_disabled */ "Ta diagnostyka zależy od dwóch sygnałów instalacji HomeHub. Przy jawnie pustym adresie HomeHub nie działa ani Modbus, ani ta zależna diagnostyka.",
  /* dyn.strategy_help */ "Próbka to docelowa temperatura pomieszczenia minus rzeczywista temperatura pomieszczenia: wartość dodatnia oznacza temperaturę poniżej celu, ujemna — powyżej. Nie ma strefy nieczułości, zaokrąglania, ograniczenia ani limitu szybkości zmian. To nieskalibrowany wskaźnik, nie żądana korekta temperatury wody zasilającej. Pomieszczenie referencyjne musi reprezentować ogrzewaną strefę. Jego termostat lub zamknięte zawory tworzą wewnętrzną pętlę regulacji: mogą usunąć zapotrzebowanie na ciepło i ukryć zbyt wysoką krzywą. Oceniaj przebieg temperatury pomieszczenia wraz z częstością utrzymywania temperatury wody zasilającej na minimum (udział ograniczenia D2) oraz rzeczywistego zapotrzebowania strefy na ciepło.",
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
  /* ref.title */ "Źródło temperatury pomieszczenia",
  /* ref.name */ "Nazwa",
  /* ref.temperature_source */ "Źródło temperatury",
  /* ref.target */ "Temperatura docelowa",
  /* ref.timestamp_source */ "Źródło znacznika czasu · opcjonalne",
  /* ref.max_age */ "Maksymalny wiek · sekundy",
  /* ref.temperature_source_help */ "Dokładny temat MQTT i opcjonalna ścieżka JSON po $. Brakujące lub błędne ścieżki są zgłaszane po nadejściu payloadu.",
  /* ref.target_help */ "Stała wartość w °C albo dokładny temat MQTT z opcjonalną ścieżką JSON po $.",
  /* ref.timestamp_source_help */ "Opcjonalny czas źródłowy RFC3339/Unix jako topic$path. Puste pole używa czasu nadejścia MQTT na żywo; wartości retained są wtedy bezpiecznie odrzucane.",
  /* ref.max_age_help */ "Maksymalny dozwolony wiek odczytu źródłowego, od 10 do 3600 sekund.",
  /* ref.error */ "Ostatni błąd",
  /* ref.broker_off */ "Broker MQTT wyłączony",
  /* ref.retained */ "zbuforowane przez brokera",
  /* ref.time_untrusted */ "Zachowana wartość bez wiarygodnego czasu pomiaru",
  /* ref.clock_unsynced */ "Zegar urządzenia nie jest zsynchronizowany",
  /* ref.now */ "teraz",
  /* ref.ago */ (s) => `${s} s temu`,
  /* ref.age_unknown */ "nieznany",
  /* ref.saved */ "Zapisano źródło temperatury pomieszczenia",
  /* ref.detail.status_label */ "Stan:",
  /* ref.detail.diagnosis_label */ "Diagnostyka krzywej grzewczej:",
  /* ref.status.measurement_valid */ "Pomiar prawidłowy",
  /* ref.status.not_configured */ "Nieskonfigurowane",
  /* ref.status.usable */ "Użyteczne",
  /* ref.status.unusable */ "Nieużyteczne",
  /* ref.status.error */ "Błąd",
  /* ref.status.stale */ "Nieaktualne",
  /* ref.status.waiting */ "Oczekiwanie",
  /* ref.status.unavailable */ "Niedostępne",
  /* ref.detail.setup */ "Dodaj źródło MQTT za pomocą ikony ołówka",
  /* ref.detail.stale */ "Odczyt jest starszy niż dozwolony",
  /* ref.detail.waiting */ "Nie odebrano jeszcze odczytu MQTT",
  /* ref.detail.error */ (e) => `Odrzucono komunikat MQTT: ${e}`,
  /* ref.detail.temperature_label */ "Temperatura pomieszczenia:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Temperatura docelowa:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Najnowszy odczyt:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · dozwolone: najwyżej ${max} s`,
  /* ref.detail.purpose */ "Diagnostyka porównuje temperaturę pomieszczenia i temperaturę docelową, aby z czasem wskazać, czy krzywa grzewcza jest zbyt wysoka lub zbyt niska. Pompa ciepła nie jest sterowana.",
  /* ref.delete */ "Usuń",
  /* ref.deleting */ "Usuwanie…",
  /* ref.deleted */ "Usunięto źródło temperatury pomieszczenia i zebrany odczyt",
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
  /* wx.title */ "Prognoza pogody Open-Meteo",
  /* wx.latitude */ "Szerokość geograficzna",
  /* wx.longitude */ "Długość geograficzna",
  /* wx.waiting */ "Oczekiwanie na prognozę",
  /* wx.fetching */ "Pobieranie prognozy Open-Meteo…",
  /* wx.unavailable */ "Niedostępne",
  /* wx.error */ "Błąd prognozy Open-Meteo",
  /* wx.detail.status */ "Stan:",
  /* wx.status.fresh */ "Aktualna",
  /* wx.status.inactive */ "Wyłączona",
  /* wx.status.fetching */ "Aktualizowanie",
  /* wx.status.stale */ "Nieaktualna",
  /* wx.status.unavailable */ "Niedostępna",
  /* wx.status.waiting */ "Oczekiwanie",
  /* wx.detail.fresh */ "Prognoza została pobrana pomyślnie.",
  /* wx.detail.fetching */ "ESP32 pobiera nowe dane prognozy.",
  /* wx.detail.stale */ "Ostatnie pomyślne pobranie jest za stare; wartości są wyświetlane wyłącznie do diagnostyki.",
  /* wx.detail.unavailable */ "Ostatnie pobranie nie powiodło się; starsza wartość, jeśli istnieje, jest wyświetlana wyłącznie do diagnostyki.",
  /* wx.detail.waiting */ "Nie odebrano jeszcze prognozy.",
  /* wx.detail.temperature_label */ "Temperatura:",
  /* wx.detail.temperature */ (v) => `${v} °C to prognozowana średnia temperatura powietrza zewnętrznego na następne dwie pełne godziny.`,
  /* wx.detail.solar_label */ "Napromienienie słoneczne:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² to prognozowane globalne napromienienie poziome w tym samym okresie dwóch godzin.`,
  /* wx.detail.source_label */ "Źródło:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Tylko obserwacja; prognoza nie zmienia sterowania pompą ciepła.",
  /* wx.err_both */ "Wpisz szerokość i długość geograficzną albo pozostaw oba pola puste, aby wyłączyć",
  /* wx.err_latitude */ "Szerokość geograficzna musi być liczbą dziesiętną od -90 do 90",
  /* wx.err_longitude */ "Długość geograficzna musi być liczbą dziesiętną od -180 do 180",
  /* wx.saving */ "Zapisywanie źródła pogody…",
  /* wx.hint.configured */ "ESP32 pobiera nową prognozę co 45 minut. Każde żądanie wysyła współrzędne do Open-Meteo i ujawnia publiczny adres IP połączenia. Pozostaw oba pola współrzędnych puste, aby usunąć źródło.",
  /* wx.hint.setup */ "Wpisz szerokość i długość geograficzną. Parę współrzędnych skopiowaną z Google Maps można wkleić w dowolne pole, a zostanie automatycznie rozdzielona. Po zapisaniu ESP32 pobiera nową prognozę co 45 minut. Każde żądanie wysyła współrzędne do Open-Meteo i ujawnia publiczny adres IP połączenia. Prognoza służy wyłącznie do obserwacji i nie zmienia sterowania pompą ciepła.",
  /* wx.attribution */ "Dane pogodowe: Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Wpisz dokładny temat MQTT, opcjonalnie z następującą po nim ścieżką $json-path",
  /* ref.err_target */ "Wpisz stałą wartość od 5 do 35 °C lub dokładny temat MQTT, opcjonalnie z następującą po nim ścieżką $json-path",
  /* ref.err_timestamp_source */ "Wpisz dokładny temat MQTT, opcjonalnie z następującą po nim ścieżką $json-path",
  /* ref.err_max_age */ "Maksymalny wiek musi być liczbą całkowitą od 10 do 3600 sekund",
  /* ref.save_help */ "Zapisz przechowuje mapowanie. Subskrypcja działa, gdy Diagnostyka instalacji jest włączona; w przeciwnym razie pozostaje nieaktywna. Nadal wymagana jest czytelna, świeża wartość MQTT.",
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
  /* board.led_rgb_off */ "Wyłączona — brak aktywnego trybu Wi-Fi.",
  /* board.led_rgb_setup */ "Niebieska, wolno miga — portal konfiguracji aktywny.",
  /* board.led_rgb_connecting */ "Żółta, szybko miga — łączenie z Wi-Fi.",
  /* board.led_rgb_healthy */ "Zielona, świeci stale — wszystkie skonfigurowane połączenia gotowe.",
  /* board.led_rgb_bus_down */ "Czerwona, podwójny błysk — X10A rozłączone.",
  /* board.led_rgb_mqtt_down */ "Pomarańczowa, miga — X10A połączone, MQTT rozłączone.",
  /* board.led_rgb_wipe_armed */ "Czerwona, bardzo szybko miga — kasowanie uzbrojone; zwolnij, aby anulować.",
  /* board.led_rgb_wiping */ "Biała, świeci stale — reset/kasowanie danych; nie odłączaj zasilania.",
  /* board.led_gpio_off */ "Wyłączona — brak aktywnego trybu Wi-Fi.",
  /* board.led_gpio_setup */ "Wolno miga — portal konfiguracji aktywny.",
  /* board.led_gpio_connecting */ "Szybko miga — łączenie z Wi-Fi.",
  /* board.led_gpio_healthy */ "Świeci stale — wszystkie skonfigurowane połączenia gotowe.",
  /* board.led_gpio_bus_down */ "Podwójny błysk — X10A rozłączone.",
  /* board.led_gpio_mqtt_down */ "Miga ze średnią szybkością — X10A połączone, MQTT rozłączone.",
  /* board.led_gpio_wipe_armed */ "Bardzo szybko miga — kasowanie uzbrojone; zwolnij, aby anulować.",
  /* board.led_gpio_wiping */ "Świeci stale po szybkim miganiu — reset/kasowanie danych; nie odłączaj zasilania.",
  /* board.ledinv */ "Aktywny stan niski (dioda świeci, gdy pin jest ustawiony na LOW)",
  /* board.btninv */ "Aktywny stan niski (przycisk zwiera pin do GND)",
  /* board.hint */ "Reset fabryczny: przytrzymaj 5 s. Trwale kasuje Wi-Fi/wszystkie ustawienia, historię/trendy, czasy stanów i surowy zrzut po awarii. Portal otworzy się tylko po pełnym sukcesie. Jeśli nie, zwolnij i przytrzymaj ponownie 5 s. Bez przycisku wybierz „Brak”.",
  /* card.hardware */ "Sprzęt",
  /* card.hw_off */ "Brak",
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
  /* card.diagnostics_help */ "Włącza 24-godzinną kontrolę instalacji, diagnostykę krzywej grzewczej oraz dodatkowe źródła, takie jak temperatura pomieszczenia, prognoza pogody i moc pompy cyrkulacyjnej.",
  /* diagnostics.off */ "Wyłączona",
  /* diagnostics.on */ "Włączona",
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
  /* hist.cop_none */ "Brak wykresu COP dla CT: okablowanie określa odbiorniki, a ciepło przed BUH pomija BSH.",
]);
INSPECT_I18N.pl = inspectValues(
  ["Brak bieżącego odczytu:", "sprężarka stoi, a jednostka zewnętrzna odświeża własne czujniki tylko podczas pracy. Wartość z poprzedniego cyklu jest ukryta, aby nie wyglądała na aktualny pomiar."],
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
      : `${fmt1(d.dt)} K${d.dtSet != null ? ` przy celu ogrzewania ${fmt1(d.dtSet)} K` : ""}. Wartość dodatnia oznacza oddawanie ciepła do wody.`], // dt
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
      : d.copBlock === "mb_scope" ? "Brak COP — X10A milczy, a HomeHub podaje pobór całej jednostki z grzałkami, podczas gdy moc cieplna dotyczy tylko PHE. Bez stanu grzałek i czujnika za nimi zakresów nie można uzgodnić."
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
    ["Pompa obiegowa", "Prędkość pompy obiegowej", "Tłoczy wodę przez wspólny obieg i drogę wybraną przez 3WV. Może pracować przy stojącej sprężarce dla wybiegu, ochrony lub wyrównania temperatury; prędkość sama nie dowodzi przepływu.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `Pompa zgłasza postój, ale czujnik pokazuje ${fmt1(d.flow)} l/min. Możliwy jest obieg zewnętrzny, wybieg albo sprzeczne/stare sygnały; sprawdź oba odczyty.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Sygnał prędkości: ${fmt0(d.pump)} %; zmierzony przepływ: ${fmt1(d.flow)} l/min.` : `Sygnał prędkości: ${fmt0(d.pump)} %, ale brak pomiaru przepływu; cyrkulacja nie jest potwierdzona.`
      : waterMoving(d) ? `Czujnik pokazuje ${fmt1(d.flow)} l/min mimo braku użytecznej wartości prędkości pompy.`
      : d.pumpOn === true ? d.flow != null ? `Stan pompy WŁ., ale przepływ to tylko ${fmt1(d.flow)} l/min; cyrkulacja nie jest potwierdzona.` : "Stan pompy WŁ., ale brak pomiaru przepływu; cyrkulacja nie jest potwierdzona."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Pompa zgłasza postój; czujnik pokazuje ${fmt1(d.flow)} l/min. Te wartości nie potwierdzają cyrkulacji.` : "Pompa zgłasza postój i brak pomiaru przepływu."
      : `Brak wiarygodnego stanu pompy; ${fmt1(d.flow)} l/min nie potwierdza cyrkulacji.`], // pump
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
  "Stan diagnostyczny jednostki", // 21
  "Kod błędu jednostki", // 22
  "Podkod błędu jednostki", // 23
  "Pompa obiegowa aktywna", // 30
  "Sprężarka aktywna", // 31
  "Grzałka zbiornika aktywna", // 32
  "Dezynfekcja zbiornika aktywna", // 33
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
  ["Dogrzewanie podnosi temperaturę zasobnika do nastawy po spadku poniżej progu."], // 23
  ["Storage comfort wybiera wyższą, a Storage eco niższą zaprogramowaną temperaturę."], // 24
  ["W układzie hybrydowym sterownik żąda od kotła przygotowania CWU."], // 25
  ["Zawór przełączający kieruje wodę do zasobnika CWU albo obiegu domu."], // 26
  ["Wyjście 2WV pozostaje WŁ./WYŁ.; WYŁ. nie dowodzi chłodzenia ani położenia zaworu."], // 27
  ["Stopień otwarcia zaworu mieszającego drugiej strefy."], // 28
  ["Docelowa temperatura zasilania dla wybranego ogrzewania lub chłodzenia."], // 29
  ["Temperatura zmieszanego zasilania drugiej strefy za zaworem mieszającym."], // 30
  ["Temperatura wody za elektrycznym BUH, zwykle R2T."], // 31
  ["R1T mierzy wodę z PHE przed BUH; tryb, R4T i przepływ określają sens i szacunek mocy."], // 32
  ["R4T jest wspólnym powrotem do PHE; R1T−R4T to ΔT PHE, nie odbiorników."], // 33
  ["Szybkość obiegu wody we wspólnym układzie ogrzewania/chłodzenia i CWU."], // 34
  ["Ciśnienie wody; zakres zależy od modelu, przy ≤1,0 bar sprawdź jego instrukcję."], // 35
  ["Odwrócone polecenie pompy: 0 = pełna prędkość, 100 = postój."], // 36
  ["Praca pompy obiegowej nie dowodzi przekazywania ciepła; potwierdź przepływem."], // 37
  ["Stan pompy solarnej, niezależnej od pompy obiegowej układu pompy ciepła."], // 38
  ["Zgłoszona prędkość pompy wskazanej przez profil."], // 39
  ["Flow switch X10A zgłasza tylko ruch; nie mierzy przepływu ani minimum modelu."], // 40
  ["Bieżący tryb strony wodnej: postój, ogrzewanie, chłodzenie, CWU lub połączenie."], // 41
  ["Smart Grid zgłasza czterostanowe polecenie energetyczne, nie tryb ogrzewania/chłodzenia."], // 42
  ["Bieżący tryb domu to ogrzewanie/chłodzenie bez trybu automatycznego; nie dowodzi pracy sprężarki."], // 43
  ["Ustawiony wybór HomeHub: Auto, ogrzewanie lub chłodzenie."], // 44
  ["Stan jednostki zewnętrznej: postój, ogrzewanie lub chłodzenie; nie dowodzi przekazywania ciepła."], // 45
  ["Odszranianie jest normalne w zimnej, wilgotnej pogodzie; sam bit bez wilgotności nie ocenia częstotliwości."], // 46
  ["Klasa aktywnej usterki: stan normalny, błąd, ostrzeżenie albo przestroga."], // 47
  ["Znaczenie aktualnie zgłoszonego kodu usterki."], // 48
  ["Tryb awaryjny po usterce pompy ciepła."], // 49
  ["Przekaźnik alarmowy sygnalizuje usterkę podłączonemu zewnętrznemu monitoringowi."], // 50
  ["Docelowa temperatura pomieszczenia głównej strefy w ogrzewaniu lub chłodzeniu."], // 51
  ["„Thermo ON“ to wewnętrzne żądanie, nie wskazanie odbiornika ani dowód pracy sprężarki."], // 52
  ["Stan zacisku wyjściowego „Space H Operation”."], // 53
  ["Normalna praca domu nie oznacza tylko ogrzewania ani termostatu; rozstrzygają I/U i napędy."], // 54
  ["Docelowa temperatura strefy sterowanej własnym czujnikiem pokojowym urządzenia."], // 55
  ["Temperatura pomieszczenia zmierzona wbudowanym lub przewodowym czujnikiem urządzenia."], // 56
  ["Ochrona temperatury tłoczenia: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 57
  ["Ochrona prądu inwertera: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 58
  ["Ochrona wysokiego ciśnienia: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 59
  ["Ochrona niskiego ciśnienia: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 60
  ["Ochrona temperatury radiatora inwertera: Drop=ON/OFF, Retry=0…7; tylko wzrost w ciągłych porównywalnych próbkach dowodzi zdarzenia, nie wartość bezwzględna."], // 61
  ["Wewnętrzna zbiorcza flaga ograniczenia, nieprzypisana do pięciu nazwanych zabezpieczeń."], // 62
  ["Temperatura wody na wejściu lub wyjściu PHE między czynnikiem a obiegiem wody."], // 63
  ["Temperatura wymiennika zewnętrznego; sama bez wilgotności nie dowodzi oblodzenia."], // 64
  ["Temperatura zewnętrzna przy urządzeniu może różnić się przez słońce i przepływ powietrza."], // 65
  ["Gorący gaz za sprężarką; zależy od ciśnienia, prędkości, trybu i obciążenia. Jedna wartość lub zakres innej rodziny nie dowodzi usterki ani braku czynnika."], // 66
  ["Temperatura chłodnego gazu czynnika o niskim ciśnieniu wracającego do sprężarki."], // 67
  ["Temperatura czynnika chłodniczego w przewodzie cieczowym między wymiennikami."], // 68
  ["Temperatura czynnika przy wejściu lub wyjściu parownika."], // 69
  ["Temperatura przewodu wtrysku czynnika."], // 70
  ["Temperatura w części obiegu zawierającej ciecz i parę."], // 71
  ["Czujnik odszraniania na wymienniku; położenie i sterowanie zależą od modelu. Jeden punkt nie dowodzi lodu na całej powierzchni ani końca odszraniania."], // 72
  ["Temperatura nasycenia z ciśnienia dla danego czynnika; nie jest czujnikiem ani wartością bar."], // 73
  ["Ciśnienie wysokie/niskie: oceniaj stabilny trend tego samego trybu/modelu; rozruch, powrót oleju i odszranianie je zmieniają. Brak uniwersalnego zakresu."], // 74
  ["Prędkość sprężarki w rps steruje wydajnością, lecz nie mierzy mocy cieplnej."], // 75
  ["Polecenie EEV w krokach, bez mechanicznego sprzężenia, nie % ani przepływ. Samo nie dowodzi ruchu, zacięcia ani braku czynnika."], // 76
  ["Temperatura elektroniki sterującej silnika wentylatora zewnętrznego."], // 77
  ["Prędkość wentylatora zewnętrznego jest podana jako stopień lub obr./min."], // 78
  ["Cel wewnętrzny zależny od modelu/trybu; porównaj z odpowiadającą temperaturą nasycenia z ciśnienia. Różnica nie diagnozuje przyczyny ani napełnienia."], // 79
  ["Wewnętrzny cel temperatury tłoczenia służy ochronie sprężarki."], // 80
  ["Cel ΔT zależy od modelu i trybu; porównuj z nim, nie z uniwersalnymi 5 K."], // 81
  ["Rodzaj czynnika, np. R32/R410A, wyznacza krzywą ciśnienie–temperatura nasycenia."], // 82
  ["Temperatura mierzona przy porcie sprężarki, używana przez wewnętrzny nadzór ochronny."], // 83
  ["Odczyt ciśnienia w obiegu czynnika z jednostki zewnętrznej."], // 84
  ["Tylko pełny zestaw CT × 230 V daje niekalibrowany szacunek; okablowanie, napięcie i cos φ ograniczają wynik."], // 85
  ["Prąd pobierany przez inwerter sprężarki — przybliżenie intensywności jej pracy."], // 86
  ["Temperatura radiatora inwertera/elektroniki mocy w jednostce zewnętrznej."], // 87
  ["Aktywne stopnie elektrycznego BUH przedstawione jako stopień mocy."], // 88
  ["Stopień BUH dodaje ciepło do wody; jego zezwolenia i progi ustawia instalator."], // 89
  ["HomeHub 32: stan BSH, nie moc; rejestr 51 to osobny pobór „pompy ciepła”, nie moc BSH, a jego zakres nie jest potwierdzony."], // 90
  ["BSH może grzać bez sprężarki i pompy; X10A zgłasza tylko WŁ./WYŁ., nie moc."], // 91
  ["Stan łańcucha ochrony termicznej grzałki, który ma przerwać jej pracę po otwarciu."], // 92
  ["Ochrona rur przed mrozem wymaga zasilania i nie gwarantuje działania przy jego zaniku."], // 93
  ["Bit mrozu X10A nie jest publicznie jednoznacznie przypisany ochronie pomieszczenia lub rur."], // 94
  ["Solanka gruntowa: dopuszczalne stężenie, ciśnienie i temperatury zależą od instalacji."], // 95
  ["Tryb źródła w układzie hybrydowym: tylko pompa, praca łączona lub tylko kocioł."], // 96
  ["Docelowa temperatura zasilania podczas ogrzewania hybrydowego."], // 97
  ["Czy praca biwalentna z drugim źródłem jest aktywna lub dozwolona przez konfigurację."], // 98
  ["Bieżące żądanie pracy kotła w układzie biwalentnym lub hybrydowym."], // 99
  ["Docelowa temperatura wody żądana dla ogrzewania kotłem, nie zmierzona temperatura."], // 100
  ["BE_COP porównuje źródła hybrydowe; nie jest zmierzonym COP, a skala X10A nie jest opisana."], // 101
  ["Taryfa, Smart Grid lub solar może ograniczyć albo żądać ciepła; działanie określa konfiguracja."], // 102
  ["Nominalna moc/klasa jednostki to stała cecha modelu, nie bieżący pomiar."], // 103
  ["Tryb cichy zmniejsza hałas, lecz może ograniczyć dostępną moc ogrzewania/chłodzenia."], // 104
  ["Bieżący stan diagnostyczny z HomeHub: brak błędu, usterka lub ostrzeżenie."], // 105
  ["Znaczenie aktualnie zgłoszonego kodu usterki."], // 106
  ["Numeryczny podkod zawężający sąsiedni kod diagnostyczny Daikin."], // 107
  ["HomeHub zgłasza tylko pracę sprężarki, nie obroty ani moc; sens określa obieg i przepływ."], // 108
  ["Praca CWU: praca = WŁ., oczekiwanie/buforowanie = WYŁ.; flaga nie podaje przyczyny."], // 109
  ["Praca domu: praca = WŁ., oczekiwanie/buforowanie = WYŁ.; tryb rozróżnia ogrzewanie/chłodzenie."], // 110
  ["Temperatura wody opuszczającej PHE przed elektrycznym BUH."], // 111
  ["Temperatura zasilania za elektrycznym BUH."], // 112
  ["Temperatura wody zmierzona w zasobniku CWU."], // 113
  ["Temperatura ciekłego czynnika wymaga kontekstu trybu; pojedynczy odczyt nie diagnozuje."], // 114
  ["Temperatura głównej strefy zgłaszana przez sterownik pokojowy."], // 115
  ["Pobór układu z HomeHub zależy od grzałek; nie przypisuj całej wartości sprężarce."], // 116
  ["Odczytywany cel zasilania ogrzewania może być stały lub pogodowy; firmware go nie zmienia."], // 117
  ["Cel chłodzenia jest tylko odczytywany i ma znaczenie wyłącznie przy aktywnym chłodzeniu."], // 118
  ["Czy obieg domu jest w ogóle WŁĄCZONY — to przełącznik, nie bieżąca aktywność."], // 119
  ["Cicha praca zmniejsza hałas jednostki zewnętrznej i może obniżyć dostępną moc."], // 120
  ["Cel dogrzewania CWU nie jest progiem startu; wpływają też histereza i harmonogram."], // 121
  ["Odczytywana korekta celu ogrzewania −10…+10 K; niezerowa wartość nie dowodzi aktywnej pracy."], // 122
  ["Limit Smart Grid „zalecane włączenie”; działa niższy z nim i limitem ogólnym, to nie bieżący pobór."], // 123
  ["Ogólny limit HomeHub, także przy swobodnej pracy; to ustawiony sufit, nie zmierzony pobór."], // 124
]);

MODEL_DESCRIPTION_I18N.pl = modelDescriptionValues([
  ["Zgłasza własny stan błędu lub ostrzeżenia pompy. Aktywny błąd daje OSTRZEŻENIE; ostrzeżenie albo komunikat pojawiający się i znikający w 24 h daje UWAGĘ. To komunikat urządzenia, nie domysł projektu. Brak bieżącej ani zapamiętanej wiadomości po odczytaniu wszystkich obsługiwanych pól. Zniknięty komunikat może pozostać 24 h; aktywny kod jest pod Stanem pracy."], // 0
  ["R5T warstw.;K/h=MAX≠Ø/doba;cyrk.≠przycz.;zakres proj.0,8–1,85.Zał.:200l równo;ważne=MAX;COP;wykl./brak h poza;el≠pomiar."], // 1
  ["Liczy przejścia sprężarki WYŁ.→WŁ. i długość pełnych cykli; jeśli sygnały pozwalają, rozdziela ogrzewanie, CWU i chłodzenie. Mieszane lub nieczytelne pozostają bez klasyfikacji. Potwierdzone cykle ogrzewania mają średnio ≥10 min. Przy co najmniej 12 krótszych pojawia się UWAGA; CWU i chłodzenie są wykluczone. Przy zbyt wielu nieklasyfikowanych oceniane są wszystkie. To nie limit Daikin."], // 2
  ["Liczy odszraniania: UWAGA powyżej 15% i przy ≥3 zdarzeniach; to nie limit Daikin. R4T jest kontekstem na żywo poza oceną, a jeden punkt nie opisuje całego wymiennika."], // 3
  ["Najniższe prawidłowe ciśnienie wody w obiegu grzewczym w ruchomym oknie. Powyżej 1,0 bar. Przy ≤1,0 bar natychmiast UWAGA, po 60 s ciągle — OSTRZEŻENIE. Zakres zależy od modelu; porównaj dokładną instrukcję."], // 4
  ["Najniższy przepływ po 60 s ciągłej pracy pompy wewnętrznej; pomija rozruch, postój i luki komunikacji. TYLKO POMIAR: minimum częściowego obciążenia po rozruchu, nie przepływ nominalny ani projektowy. Nie ma uniwersalnej granicy; minimum instrukcji dotyczy tego samego modelu, trybu i warunków. Jedna niska wartość bez błędu niewiele dowodzi."], // 5
  ["Osobno pokazuje czas pracy BUH dla obiegu domu i BSH w zasobniku CWU. TYLKO POMIAR. Mróz, awaria, wsparcie odszraniania, harmonogram CWU lub sterowanie nadwyżką mogą uzasadniać pracę. Nie ma uniwersalnego progu OK/OSTRZEŻENIE."], // 6
  ["Eksperymentalnie obserwuje pięć wewnętrznych liczników ochrony. Liczy tylko wyraźny wzrost między porównywalnymi odczytami, także pierwszy widoczny przy postoju lub zmianie sprężarki; baza, brak wzrostu, spadki, luki i reset nie liczą się. Brak zaobserwowanego wzrostu. Wzrost daje UWAGĘ, nie diagnozę usterki; brak wzrostu nie dowodzi braku ograniczeń, bo liczniki nie są w pełni opisane."], // 7
  ["Pamięć RAM obecnie nieużywana przez firmware. Krótkie zmiany od WiFi, MQTT i WWW są normalne; trend 24 h mówi więcej niż jeden odczyt. Zwykle stabilna z przejściowymi spadkami, które wracają. Trwały spadek może oznaczać niezwolnione alokacje. Restart z zasilaniem zachowuje trend w RAM; zwykły restart, aktualizacja lub utrata zasilania odtwarza zakończone 5-minutowe koszyki z flash. Może brakować tylko otwartego."], // 8
  ["Największy ciągły blok wolnej pamięci RAM. TLS i OTA potrzebują jednego dość dużego bloku, nawet gdy łącznie wolnej pamięci jest więcej. Zawsze nie większy niż cała wolna RAM. Jeśli wolna RAM jest stabilna, a ten blok maleje, rośnie fragmentacja sterty i duża alokacja może zawieść przed wyczerpaniem pamięci."], // 9
  ["Nominalna moc jednostki zewnętrznej z jej strony identyfikacyjnej. To klasa sprzętu, nie aktualna produkcja."], // 10
  ["Nominalna moc JEDNOSTKI WEWNĘTRZNEJ. Jest pokazana, gdy strona identyfikacji zewnętrznej nie ma własnej mocy; etykieta wskazuje źródło. Jednostki mogą mieć różne klasy. Nie odczytuj tego jako mocy zewnętrznej ani całego systemu."], // 11
  ["Ta sama klasa i rejestry: wybór reprezentanta nie zmienia dekodowanych wartości."], // 12
  ["Kilka rodzin Daikin udostępnia te same rejestry, więc interfejs nie rozróżnia nazwy handlowej. Nagłówek pozostaje „Daikin Altherma”, bez zgadywania. Jednostka zewnętrzna nie podaje mocy, więc kandydaci mogą mieć różne klasy. Firmware dekoduje wariant najlepiej pasujący do wewnętrznej, ale bez pełnej pewności. Porównaj identyfikator z tabliczką."], // 13
  ["Surowe bajty ID bez publicznej tabeli nazw; przy niejasności porównaj je znak po znaku z tabliczką."], // 14
]);
