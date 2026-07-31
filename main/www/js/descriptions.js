// ── Value descriptions (tap a value row → a plain-language explainer slides down) ─────────────
// Each heat-pump reading gets a short "what is this / what's normal" note, keyed to the value LABEL
// by a first-match-wins regex — the same pattern-over-label technique pickValue()/groupOf()/vLwt use,
// so one entry covers every profile's spelling of a concept (there are ~200 distinct labels but far
// fewer physical quantities). English only, matching the fixed English labels and the §1 design
// contract (there is no language selector). ORDER MATTERS: put specific/compound labels before the
// general ones they contain (e.g. "after BUH" before plain "leaving water", BUH/capacity before the
// bare "capacity" catch). A row whose label matches nothing here stays a plain, non-expandable row.
// `normal` is optional guidance on typical vs worth-a-look values — deliberately hedged; the exact
// figures are model- and install-specific.
// Keep the English column byte-for-byte aligned with logic/error_codes.hpp. That header enriches
// live X10A values; this browser lookup explains ONLY the currently reported code when either X10A
// or HomeHub exposes the error-code row. The 63-entry vocabulary is never printed as a catalogue in
// the UI. The HomeHub's separate numeric sub-code is intentionally not folded into this lookup: it
// narrows a main code but is not another main-code vocabulary.
const DAIKIN_FAULT_CODES = Object.freeze([
  { code: "7H", en: "Water flow problem", de: "Problem mit dem Wasserdurchfluss" },
  { code: "80", en: "Return water temperature sensor fault", de: "Fehler am Rücklauftemperaturfühler" },
  { code: "81", en: "Leaving water temperature sensor fault", de: "Fehler am Vorlauftemperaturfühler" },
  { code: "89", en: "Heat exchanger frost protection activated", de: "Frostschutz des Wärmetauschers ausgelöst" },
  { code: "8F", en: "Abnormal DHW outlet water temperature rise", de: "Ungewöhnlicher Temperaturanstieg am Warmwasseraustritt" },
  { code: "8H", en: "Abnormal leaving water temperature rise", de: "Ungewöhnlicher Anstieg der Vorlauftemperatur" },
  { code: "A1", en: "Zero-crossing detection failure", de: "Fehler der Nulldurchgangserkennung" },
  { code: "A5", en: "High-pressure peak-cut / frost protection problem", de: "Problem mit Hochdruckbegrenzung oder Frostschutz" },
  { code: "AA", en: "Backup heater overheated or not connected", de: "Zusatzheizer überhitzt oder nicht angeschlossen" },
  { code: "AC", en: "Booster heater overheated", de: "Speicherheizstab überhitzt" },
  { code: "AH", en: "Tank disinfection (anti-legionella) not completed", de: "Speicherdesinfektion zum Legionellenschutz nicht abgeschlossen" },
  { code: "AJ", en: "DHW heat-up time exceeded", de: "Aufheizzeit für Warmwasser überschritten" },
  { code: "C0", en: "Flow sensor fault", de: "Fehler am Volumenstromsensor" },
  { code: "C4", en: "Heat exchanger temperature sensor fault", de: "Fehler am Temperaturfühler des Wärmetauschers" },
  { code: "C5", en: "Heat exchanger sensor fault", de: "Fehler an einem Wärmetauscherfühler" },
  { code: "CJ", en: "Room temperature sensor fault", de: "Fehler am Raumtemperaturfühler" },
  { code: "E1", en: "Outdoor unit PCB defect", de: "Platine der Außeneinheit defekt" },
  { code: "E2", en: "Leakage current detection fault", de: "Fehler der Fehlerstromerkennung" },
  { code: "E3", en: "Outdoor unit high-pressure switch activated", de: "Hochdruckschalter der Außeneinheit ausgelöst" },
  { code: "E4", en: "Suction pressure fault", de: "Fehler beim Kältemittel-Saugdruck" },
  { code: "E5", en: "Outdoor unit inverter compressor motor overheat", de: "Inverter-Verdichtermotor der Außeneinheit überhitzt" },
  { code: "E6", en: "Outdoor unit compressor startup failure", de: "Verdichter der Außeneinheit startet nicht" },
  { code: "E7", en: "Outdoor unit fan motor fault", de: "Fehler am Lüftermotor der Außeneinheit" },
  { code: "E8", en: "Outdoor unit input overvoltage", de: "Überspannung am Eingang der Außeneinheit" },
  { code: "E9", en: "Electronic expansion valve fault", de: "Fehler am elektronischen Expansionsventil" },
  { code: "EA", en: "Outdoor unit cooling/heating switchover problem", de: "Umschaltproblem zwischen Kühlen und Heizen an der Außeneinheit" },
  { code: "EC", en: "Abnormal tank temperature rise", de: "Ungewöhnlicher Temperaturanstieg im Speicher" },
  { code: "F3", en: "Outdoor unit discharge pipe temperature fault", de: "Temperaturfehler an der Heißgasleitung der Außeneinheit" },
  { code: "F6", en: "Outdoor unit abnormally high pressure during cooling", de: "Ungewöhnlich hoher Druck der Außeneinheit beim Kühlen" },
  { code: "FA", en: "Outdoor unit abnormally high pressure, high-pressure switch activated", de: "Ungewöhnlich hoher Druck der Außeneinheit; Hochdruckschalter ausgelöst" },
  { code: "H0", en: "Outdoor unit voltage/current sensor fault", de: "Fehler am Spannungs- oder Stromsensor der Außeneinheit" },
  { code: "H1", en: "External temperature sensor fault", de: "Fehler an einem externen Temperaturfühler" },
  { code: "H3", en: "Outdoor unit high-pressure switch fault", de: "Fehler am Hochdruckschalter der Außeneinheit" },
  { code: "H5", en: "Compressor overload protection fault", de: "Fehler am Überlastschutz des Verdichters" },
  { code: "H6", en: "Outdoor unit position-detection sensor fault", de: "Fehler am Positionserkennungssensor der Außeneinheit" },
  { code: "H8", en: "Outdoor unit compressor input (CT) system fault", de: "Fehler am CT-Strommesssystem des Außeneinheit-Verdichters" },
  { code: "H9", en: "Outdoor unit outside air temperature sensor fault", de: "Fehler am Außentemperaturfühler der Außeneinheit" },
  { code: "HC", en: "Tank temperature sensor fault", de: "Fehler am Speichertemperaturfühler" },
  { code: "HJ", en: "Water pressure sensor fault", de: "Fehler am Wasserdrucksensor" },
  { code: "J3", en: "Outdoor unit discharge pipe sensor fault", de: "Fehler am Heißgasleitungsfühler der Außeneinheit" },
  { code: "J6", en: "Outdoor unit heat exchanger sensor fault", de: "Fehler am Wärmetauscherfühler der Außeneinheit" },
  { code: "JA", en: "Outdoor unit high-pressure sensor fault", de: "Fehler am Hochdrucksensor der Außeneinheit" },
  { code: "L1", en: "Inverter PCB fault", de: "Fehler an der Inverterplatine" },
  { code: "L3", en: "Outdoor unit control box temperature rise fault", de: "Unzulässiger Temperaturanstieg im Schaltkasten der Außeneinheit" },
  { code: "L4", en: "Outdoor unit inverter heat sink temperature rise fault", de: "Unzulässiger Temperaturanstieg am Inverter-Kühlkörper der Außeneinheit" },
  { code: "L5", en: "Outdoor unit inverter overcurrent (DC) detected", de: "Gleichstrom-Überstrom am Inverter der Außeneinheit erkannt" },
  { code: "L8", en: "Inverter PCB thermal protection tripped", de: "Thermoschutz der Inverterplatine ausgelöst" },
  { code: "L9", en: "Compressor lock protection", de: "Blockierschutz des Verdichters ausgelöst" },
  { code: "LC", en: "Outdoor unit communication system fault", de: "Fehler im Kommunikationssystem der Außeneinheit" },
  { code: "P1", en: "Power supply phase imbalance / open phase", de: "Phasenunsymmetrie oder Phasenausfall der Stromversorgung" },
  { code: "P3", en: "Abnormal DC detected", de: "Ungewöhnliche Gleichspannung erkannt" },
  { code: "P4", en: "Outdoor unit heat sink temperature sensor fault", de: "Fehler am Kühlkörper-Temperaturfühler der Außeneinheit" },
  { code: "PJ", en: "Capacity setting mismatch", de: "Leistungseinstellung passt nicht zur Anlage" },
  { code: "U0", en: "Outdoor unit refrigerant shortage", de: "Kältemittelmangel an der Außeneinheit" },
  { code: "U1", en: "Reverse phase / open phase malfunction", de: "Phasenfolgefehler oder Phasenausfall" },
  { code: "U2", en: "Outdoor unit mains voltage fault", de: "Netzspannungsfehler der Außeneinheit" },
  { code: "U3", en: "Underfloor heating screed-drying function not completed correctly", de: "Estrichtrocknungsprogramm der Fußbodenheizung nicht korrekt abgeschlossen" },
  { code: "U4", en: "Indoor/outdoor unit communication problem", de: "Kommunikationsproblem zwischen Innen- und Außeneinheit" },
  { code: "U5", en: "User interface communication problem", de: "Kommunikationsproblem mit der Bedieneinheit" },
  { code: "U7", en: "Outdoor unit main CPU / inverter CPU transmission fault", de: "Übertragungsfehler zwischen Haupt-CPU und Inverter-CPU der Außeneinheit" },
  { code: "U8", en: "External device (LAN adapter / room thermostat / USB) communication problem", de: "Kommunikationsproblem mit LAN-Adapter, Raumthermostat oder USB-Gerät" },
  { code: "UA", en: "Indoor/outdoor unit combination or compatibility problem", de: "Innen- und Außeneinheit sind falsch kombiniert oder nicht kompatibel" },
  { code: "UF", en: "Reversed piping or faulty communication wiring detected", de: "Vertauschte Rohrleitungen oder fehlerhafte Kommunikationsverdrahtung erkannt" },
]);

const DESCRIPTIONS = [
  // ── Domestic hot water ──
  { re: /dhw setpoint|dhw set ?point/i,
    what: "Target temperature for the hot-water tank. The unit runs DHW mode until the tank sensor reaches it, then stops.",
    normal: "usually 45–55 °C. Higher leans on the electric backup heater and costs more; a weekly ≥60 °C cycle is the normal anti-legionella boost.",
    de: { what: "Zieltemperatur für den Warmwasserspeicher. Das Gerät läuft im Warmwasser-Modus, bis der Speicherfühler sie erreicht, dann stoppt es.",
          normal: "meist 45–55 °C. Höher belastet den elektrischen Zusatzheizer und kostet mehr; ein wöchentlicher Zyklus auf ≥60 °C ist die normale Legionellen-Aufheizung." } },
  { re: /2nd domestic hot water/i,
    what: "A second temperature sensor in the hot-water tank (used on tanks with two sensors, e.g. top and bottom).",
    de: { what: "Ein zweiter Temperaturfühler für Warmwasserspeicher mit zwei Messpunkten, etwa oben und unten." } },
  { re: /dhw tank temp|dhw tank/i,
    what: "The water temperature actually measured inside the hot-water tank (sensor R5T).",
    normal: "Below the DHW setpoint is expected after hot water has been used. During an active DHW cycle the temperature should rise; if it does not, compare the operation, flow and fault rows before drawing a conclusion.",
    de: { what: "Die tatsächlich im Warmwasserspeicher gemessene Wassertemperatur am Fühler R5T.",
          normal: "Nach einer Warmwasserentnahme liegt sie erwartbar unter dem Sollwert. Während eines aktiven Warmwasser-Zyklus sollte sie steigen; tut sie das nicht, zuerst Betriebs-, Durchfluss- und Fehlerzeilen gemeinsam prüfen." } },
  { re: /powerful dhw/i,
    what: "A one-off boost that heats the tank to the setpoint as fast as possible, calling in the backup heater if needed.",
    normal: "OFF in day-to-day use; ON only while you've triggered a manual boost.",
    de: { what: "Eine einmalige Schnellaufheizung, die den Speicher so schnell wie möglich auf den Sollwert bringt und bei Bedarf den Zusatzheizer zuschaltet.",
          normal: "im Alltag OFF; nur ON, während du eine manuelle Aufheizung ausgelöst hast." } },
  { re: /tank preheat/i,
    what: "The tank is being warmed ahead of an expected draw (from the schedule or weather forecast) so hot water is ready in time.",
    normal: "briefly ON around scheduled/anticipated demand, OFF otherwise.",
    de: { what: "Der Speicher wird vor einer erwarteten Entnahme vorgewärmt, etwa nach Zeitplan oder Wetterprognose, damit rechtzeitig Warmwasser bereitsteht.",
          normal: "kurz ON bei geplantem oder erwartetem Bedarf, sonst OFF." } },
  { re: /reheat on/i,
    what: "The tank is being topped back up to its comfort temperature between scheduled heating slots.",
    normal: "ON in short bursts to hold the tank warm; OFF most of the time.",
    de: { what: "Der Speicher wird zwischen geplanten Heizzeiten wieder auf seine Komforttemperatur nachgeladen.",
          normal: "ON in kurzen Schüben, um den Speicher warm zu halten; die meiste Zeit OFF." } },
  { re: /storage (eco|comfort)/i,
    what: "Which stored-hot-water target is active: Comfort keeps the tank fuller/hotter, ECO holds a lower reserve to save energy.",
    de: { what: "Welches Warmwasser-Speicherziel aktiv ist: Komfort hält den Speicher voller/heißer, ECO hält eine niedrigere Reserve, um Energie zu sparen." } },
  { re: /boiler dhw demand/i,
    what: "On a hybrid (heat-pump + gas boiler) system: the boiler has been asked to make the hot water instead of the heat pump.",
    normal: "OFF on a heat-pump-only system; on a hybrid it comes ON when the boiler is cheaper/faster than the heat pump for DHW.",
    de: { what: "In einem Hybridsystem aus Wärmepumpe und Gaskessel wurde der Kessel angefordert, das Warmwasser statt der Wärmepumpe zu erzeugen.",
          normal: "OFF bei reinem Wärmepumpenbetrieb; im Hybridsystem ON, wenn der Kessel Warmwasser günstiger oder schneller erzeugt als die Wärmepumpe." } },

  // ── Valves ──
  { re: /3.?way valve/i,
    what: "The diverter valve routes water either to the DHW tank or to the space circuit. Both sources are shown as the named positions DHW and Space heating; the underlying X10A bit remains 1 = DHW and 0 = space circuit.",
    normal: "DHW is the tank route; Space heating is the space-circuit route. The position alone does not prove that either circuit is currently operating.",
    de: { what: "Das Umschaltventil leitet Wasser entweder zum Warmwasserspeicher oder in den Heiz- oder Kühlkreis. Beide Quellen werden als Brauchwarmwasser oder Raumheizung angezeigt; das zugrunde liegende X10A-Bit bleibt 1 = Warmwasser und 0 = Raumkreis.",
          normal: "Brauchwarmwasser ist der Speicherweg, Raumheizung der Weg zum Raumkreis. Die Ventilposition allein beweist nicht, dass der jeweilige Kreis gerade in Betrieb ist." } },
  { re: /2.?way valve/i,
    what: "Selects the water path for the current mode. The named display is Heating or Cooling; the underlying X10A bit remains 1 = Heating and 0 = Cooling.",
    de: { what: "Wählt den Wasserweg für den aktuellen Modus. Angezeigt wird Heizen oder Kühlen; das zugrunde liegende X10A-Bit bleibt 1 = Heizen und 0 = Kühlen." } },
  { re: /mix valve position|bizone kit mix valve/i,
    what: "Opening of the bizone mixing valve, blending hot flow with cooler return to hold a lower temperature for a second (e.g. underfloor) zone.",
    normal: "modulates between fully closed and fully open to hold that zone's target.",
    de: { what: "Öffnung des Bizone-Mischventils. Es mischt heißen Vorlauf mit kühlerem Rücklauf, um für eine zweite Zone, etwa eine Fußbodenheizung, eine niedrigere Temperatur zu halten.",
          normal: "regelt zwischen ganz geschlossen und ganz offen, um das Ziel dieser Zone zu halten." } },

  // ── Leaving / return / mixed water ──
  { re: /(leaving water|lw) set ?point/i,
    what: "The target flow (leaving-water) temperature the controller is aiming for — usually set automatically by weather compensation, warmer when it's colder outside.",
    normal: "tracks the outdoor temperature: higher on cold days, lower on mild ones.",
    de: { what: "Die Ziel-Vorlauftemperatur, die der Regler anstrebt — meist automatisch über die Witterungsführung gesetzt, wärmer wenn es draußen kälter ist.",
          normal: "folgt der Außentemperatur: höher an kalten, niedriger an milden Tagen." } },
  { re: /mixed (leaving|water)/i,
    what: "Blended flow temperature of a mixed heating zone (after its mixing valve) — typically a cooler underfloor loop fed off a hotter primary circuit.",
    de: { what: "Gemischte Vorlauftemperatur einer Heizzone hinter ihrem Mischventil. Typisch ist ein kühlerer Fußbodenkreis, der aus einem heißeren Primärkreis gespeist wird." } },
  { re: /after buh|outlet water buh|after buffer|tvbh/i,
    what: "Water temperature after the electric backup heater (sensor R2T) — the temperature that actually reaches your radiators/underfloor.",
    normal: "equal to the before-BUH temperature when the backup heater is off (the usual case); higher only while the BUH is firing.",
    de: { what: "Wassertemperatur nach dem elektrischen Zusatzheizer, gemessen am Fühler R2T. Diese Temperatur erreicht tatsächlich die Heizkörper oder Fußbodenheizung.",
          normal: "entspricht im Normalfall der Temperatur vor dem BUH, solange der Zusatzheizer OFF ist; höher nur, während der BUH heizt." } },
  { re: /before buh|after phe|outlet water heat exch|leaving water.*\(?r1t\)?|tv inflow|outlet water heat exchanger/i,
    what: "Water temperature leaving the heat pump's own heat exchanger, before the backup heater (sensor R1T) — the true heat-pump output temperature and the one used for ΔT / heat-output / COP.",
    normal: "space heating ~30–45 °C (underfloor lower, radiators higher); up to ~55 °C on a DHW run. Much higher than the target usually means the backup heater is contributing.",
    de: { what: "Wassertemperatur am Fühler R1T, die den Wärmetauscher der Wärmepumpe noch vor dem Zusatzheizer verlässt. Sie ist die eigentliche Vorlauftemperatur der Wärmepumpe und die Basis für ΔT, Wärmeleistung und COP.",
          normal: "bei Raumheizung meist ~30–45 °C; für Fußbodenheizung niedriger, für Heizkörper höher. Während einer Warmwasserladung sind bis zu ~55 °C üblich. Deutlich über dem Ziel wirkt meist der Zusatzheizer mit." } },
  { re: /inlet water|return water|tr return/i,
    what: "Water returning from the house back into the unit (sensor R4T). Leaving-water minus this is the ΔT across the system.",
    normal: "During heat delivery it is normally below the leaving-water temperature. The resulting ΔT depends on load and flow, so assess it only with the pump running and the operating mode known.",
    de: { what: "Wasser, das aus dem Haus zurück ins Gerät strömt, gemessen am Fühler R4T. Die Differenz zum Vorlauf ergibt das ΔT der Anlage.",
          normal: "Bei Wärmeabgabe liegt sie normalerweise unter der Vorlauftemperatur. Das daraus entstehende ΔT hängt von Last und Volumenstrom ab und ist nur bei laufender Pumpe und bekannter Betriebsart sinnvoll zu bewerten." } },

  // ── Flow / pressure / pump ──
  { re: /flow (sensor|rate)|flow rate/i,
    what: "How fast water is circulating through the heating/DHW circuit.",
    normal: "Above zero while water is circulating; the expected rate is specific to the unit and hydraulic system. Judge a low value together with pump state and any reported flow fault.",
    de: { what: "Wie schnell das Wasser durch den Heiz-/Warmwasserkreis zirkuliert.",
          normal: "Bei Wasserumlauf größer als null; der erwartbare Wert hängt von Gerät und Hydraulik ab. Einen niedrigen Wert zusammen mit Pumpenstatus und einer gegebenenfalls gemeldeten Durchflussstörung bewerten." } },
  { re: /water pressure/i,
    what: "Water pressure in the sealed heating circuit.",
    normal: "roughly 1.0–2.0 bar when cold. Below ~0.5 bar needs topping up; a persistent low reading can stop the pump.",
    de: { what: "Wasserdruck im geschlossenen Heizkreis.",
          normal: "kalt etwa 1,0–2,0 bar. Unter ~0,5 bar muss nachgefüllt werden; ein dauerhaft niedriger Wert kann die Pumpe stoppen." } },
  { re: /water pump signal/i,
    what: "The speed command sent to the circulation pump. Note it is inverted — 0 means full speed, 100 means stopped (per the label).",
    normal: "a low number (fast pump) while heating or making DHW; 100 (stopped) when idle.",
    de: { what: "Der Drehzahlbefehl an die Umwälzpumpe ist umgekehrt skaliert: 0 bedeutet volle Drehzahl, 100 bedeutet Stillstand.",
          normal: "eine niedrige Zahl und damit schnelle Pumpendrehzahl beim Heizen oder Warmwasserbereiten; 100 im Leerlauf." } },
  { re: /water pump operation|circulation pump|solar pump|main pump|add pump|pump speed/i,
    what: "The circulation pump that moves water between the unit and the tank/emitters — whether it's running (or how hard, for a speed reading).",
    normal: "For an ON/OFF state, ON means the pump is running and OFF means it is stopped. Overrun and protective functions can keep it ON even when the compressor is not running.",
    de: { what: "Zeigt, ob die Umwälzpumpe Wasser zwischen Gerät, Speicher und Heizflächen bewegt und bei einer Drehzahlangabe auch wie stark.",
          normal: "Bei einem ON/OFF-Status bedeutet ON, dass die Pumpe läuft, und OFF, dass sie steht. Nachlauf und Schutzfunktionen können sie auch bei stehendem Verdichter auf ON halten." } },
  { re: /water flow switch/i,
    what: "A safety switch that confirms water is genuinely flowing before the compressor or backup heater are allowed to run — protecting the heat exchanger from running dry.",
    normal: "ON (flow proven) whenever the pump is running.",
    de: { what: "Ein Sicherheitsschalter, der den Wasserfluss bestätigt, bevor Verdichter oder Zusatzheizer laufen dürfen, und so den Wärmetauscher vor Trockenlauf schützt.",
          normal: "ON bestätigt den Durchfluss, sobald die Pumpe läuft." } },

  // ── Operation / mode / fault ──
  { re: /i\/u operation mode/i,
    what: "What the water (indoor) side is doing right now: Stop, Heating, Cooling, Domestic Hot Water, or a heating+DHW combination.",
    normal: "reflects the current job. During a hot-water cycle it reads DHW even though the outdoor unit still shows Heating.",
    de: { what: "Was die Wasserseite der Inneneinheit gerade tut: Stopp, Heizen, Kühlen, Warmwasser oder Heizen + Warmwasser.",
          normal: "spiegelt die aktuelle Aufgabe wider. Während eines Warmwasserzyklus steht hier Warmwasser, obwohl die Außeneinheit weiterhin Heizen anzeigt." } },
  // `exact` is enforced by the description audit: this HomeHub enum must win before the broad X10A
  // "operation mode" entry below. Without that ordering the Modbus card described the SG modes as the
  // outdoor unit's Heating/Cooling thermodynamic state, which is a different register and meaning.
  { exact: true, re: /^smart[- ]grid operation mode$/i,
    what: "The Smart-Grid request: Free running, Forced off, Recommended on or Forced on. The HomeHub reports it directly; the X10A row derives the same four states from contacts 1 and 2. It is an energy-management command, not the outdoor unit's Heating/Cooling mode.",
    normal: "Free running during ordinary autonomous operation. The other modes should appear only while an external energy manager deliberately blocks, recommends or forces operation.",
    de: { what: "Die Smart-Grid-Anforderung: Freier Betrieb, Zwangsabschaltung, Empfehlung ein oder Erzwungen ein. Der HomeHub meldet sie direkt; die X10A-Zeile leitet dieselben vier Zustände aus Kontakt 1 und 2 ab. Das ist ein Energiemanagement-Befehl und nicht der Heiz- oder Kühlmodus der Außeneinheit.",
          normal: "Freier Betrieb im normalen autonomen Betrieb. Die anderen Modi sollten nur erscheinen, wenn ein externes Energiemanagement den Betrieb bewusst sperrt, empfiehlt oder erzwingt." } },
  { re: /operation mode|operation \/ fault|^operation$/i,
    what: "The configured heat/cool mode: Auto, Heating or Cooling. It is a mode selection, not a statement that the compressor or space circuit is running right now.",
    de: { what: "Der eingestellte Heiz- oder Kühlmodus: Auto, Heizen oder Kühlen. Das ist eine Moduswahl und keine Aussage darüber, ob Verdichter oder Raumkreis gerade laufen." } },
  { re: /defrost/i,
    what: "The unit is melting frost off the outdoor coil by briefly running its cycle in reverse. Heating output pauses and steam may rise from the outdoor unit.",
    normal: "normal and self-clearing in cold, damp weather; a few minutes every so often. Constant defrosting suggests low refrigerant or poor airflow.",
    de: { what: "Das Gerät taut Reif von der Außeneinheit ab, indem es den Kreislauf kurz umkehrt. Die Heizleistung pausiert, und aus der Außeneinheit kann Dampf aufsteigen.",
          normal: "normal und selbstbeendend bei kaltem, feuchtem Wetter; ab und zu ein paar Minuten. Ständiges Abtauen deutet auf zu wenig Kältemittel oder schlechten Luftstrom hin." } },
  { re: /error type/i,
    what: "The severity class of any active fault: Normal, Error, Warning or Caution.",
    normal: "Normal. Anything else points to an active fault or advisory — check the fault code.",
    de: { what: "Die Schwereklasse einer aktiven Störung: Normal, Fehler, Warnung oder Hinweis.",
          normal: "Normal. Alles andere weist auf eine aktive Störung oder einen Hinweis hin — den Fehlercode prüfen." } },
  { re: /error code|fault code/i, faultCode: true,
    what: "Meaning of the currently reported fault code",
    de: { what: "Bedeutung des aktuell gemeldeten Fehlercodes" } },
  { re: /emergency/i,
    what: "Emergency operation: the system is running in a fallback mode (often backup-heater only) after a fault, to keep some heat/hot water until it's serviced.",
    de: { what: "Notbetrieb: Die Anlage läuft nach einer Störung in einem Ersatzbetrieb, häufig nur mit dem Zusatzheizer, um bis zur Wartung etwas Wärme und Warmwasser zu liefern." } },
  { re: /alarm output/i,
    what: "The unit's alarm relay — switched ON to signal a fault to any external alarm/monitoring wired to it.",
    de: { what: "Das Alarmrelais des Geräts steht auf ON, um eine Störung an eine angeschlossene externe Alarm- oder Überwachungseinrichtung zu melden." } },

  // ── Room / thermostat ──
  // This is the INDOOR UNIT's thermo-on bit (0x60/2 bit 3), not a room thermostat: it sits in the
  // same status byte as the I/U operation mode and it says the hydro module wants the compressor,
  // whichever load that is for. Measured over three days on a live unit, every single ON minute was
  // a DHW charge and none had the 3-way valve on space heating — so copy that promised "the room is
  // calling for heat" described the wrong thing entirely (#199).
  { exact: true, re: /^room thermostat control (heating|cooling) setpoint main$/i,
    what: "The target room temperature for the main zone in Heating or Cooling mode. This is a temperature setpoint, not the unit's ON/OFF thermo-demand signal.",
    normal: "Use the configured comfort target for the selected mode. Whether the unit starts also depends on the measured room temperature and controller logic.",
    de: { what: "Die Raum-Solltemperatur der Hauptzone für den Heiz- oder Kühlbetrieb. Das ist ein Temperatur-Sollwert und nicht das ON/OFF-Thermo-Anforderungssignal der Anlage.",
          normal: "Maßgeblich ist der konfigurierte Komfort-Sollwert der gewählten Betriebsart. Ob die Anlage startet, hängt zusätzlich von gemessener Raumtemperatur und Reglerlogik ab." } },
  { re: /thermostat/i,
    what: "Whether the indoor unit is currently asking the outdoor unit to run — Daikin's \"thermo ON\". It does not say what the heat is for: a hot-water charge turns it ON exactly like a call for space heating. For the heating circuit alone, read \"Space heating Operation\".",
    normal: "ON while the unit runs, OFF while it is satisfied — for either load.",
    de: { what: "Ob die Inneneinheit gerade Betrieb der Außeneinheit anfordert — Daikins „Thermo ON\". Wofür die Wärme gebraucht wird, sagt das Bit nicht: Eine Warmwasserladung setzt es genauso auf ON wie eine Heizungsanforderung. Für den Heizkreis allein ist „Space heating Operation\" der richtige Wert.",
          normal: "ON, solange das Gerät läuft, OFF, wenn der Bedarf gedeckt ist — für beide Lasten." } },
  { re: /space heating operation|space h operation/i,
    what: "Whether space heating (as opposed to hot-water production) is currently active or being called for. This is the branch-specific one: it stays OFF through a hot-water charge, which the unit-wide \"Thermostat ON/OFF\" does not.",
    normal: "OFF all summer, and OFF while the 3-way valve is diverted to the tank.",
    de: { what: "Ob die Raumheizung im Unterschied zur Warmwasserbereitung gerade aktiv ist oder angefordert wird. Das ist der zweigspezifische Wert: Er bleibt während einer Warmwasserladung OFF — anders als das geräteweite „Thermostat ON/OFF\".",
          normal: "den ganzen Sommer OFF, und auch OFF, solange das 3-Wege-Ventil auf den Speicher geschaltet ist." } },
  { re: /rt set ?point/i,
    what: "The target room temperature you've set for the zone the unit's own room sensor controls.",
    de: { what: "Die von dir eingestellte Ziel-Raumtemperatur für die Zone, die der eigene Raumfühler des Geräts regelt." } },
  { re: /\brt temp|indoor ambient|ext\. indoor ambient/i,   // \b so "po(rt temp)erature" doesn't hit this
    what: "The room temperature measured by the unit's built-in or wired room sensor.",
    normal: "sits near the room setpoint once the zone is satisfied.",
    de: { what: "Die vom eingebauten oder verdrahteten Raumfühler des Geräts gemessene Raumtemperatur.",
          normal: "liegt nahe am Raum-Sollwert, sobald die Zone zufrieden ist." } },

  // ── Protection retries & drop control (page 0x10 offsets 10-12, def/overlay.hpp) ──
  // These 11 rows are the ONLY catalog labels that reached the UI with no explainer — and two of
  // them ("Fin Temp. Drop Control", "Fin Temp. Protection Retry Qty") had something worse: they fell
  // through to the "fin temp" heatsink-TEMPERATURE entry below, so a protection FLAG and a retry
  // COUNT were both explained as a temperature reading. That is the #35-#39 shape in explainer copy —
  // well-formed, plausible, and false — so this section MUST stay ahead of the outdoor/refrigerant
  // and electrical sections that contain the entries it out-ranks (first match wins).
  // One entry per PROTECTION rather than per row: the flag and the counter for the same quantity are
  // adjacent rows off the same byte (docs/REGISTERS.md §5), and what a reader actually needs is what
  // the unit is protecting and why — so each entry names both readings and stays honest about which
  // is which. Counters are a 3-BIT field (conv 310/311), hence 0-7 and read as a rate, never a
  // lifetime total (docs/HOME_ASSISTANT.md "Protection retries & drop control").
  { re: /discharge temp\.? ?(drop|protection retry)/i,
    what: "Discharge-temperature protection: the gas leaving the compressor is nearing its safe limit, so the unit throttles the compressor back rather than trip out. The \"Drop\" row is ON while it is doing that right now; the \"Retry Qty\" row counts how often it has had to.",
    normal: "OFF / 0. Occasional retries at high flow temperatures are normal; repeated ones point at low refrigerant charge or a flow temperature set higher than the unit likes.",
    de: { what: "Schutz der Druckgastemperatur: Das den Verdichter verlassende Gas nähert sich seiner Grenze, deshalb regelt das Gerät den Verdichter zurück, statt zu stören. Die Zeile „Drop“ ist ON, solange das gerade passiert; die Zeile „Retry Qty“ zählt, wie oft es nötig war.",
          normal: "OFF / 0. Vereinzelte Rückregelungen bei hohen Vorlauftemperaturen sind normal; häufige deuten auf zu wenig Kältemittel oder eine zu hoch eingestellte Vorlauftemperatur hin." } },
  { re: /comp\.? inv current (drop|protection retry)/i,
    what: "Compressor-inverter current protection: the current the inverter feeds the compressor is nearing its ceiling, so the unit reduces compressor speed. The \"Drop\" row is ON while that limiting is active; the \"Retry Qty\" row counts how often it has happened.",
    normal: "OFF / 0. Expected occasionally under heavy load in cold weather; frequent counts on mild days are worth a look.",
    de: { what: "Stromschutz des Verdichter-Inverters: Der Strom, den der Inverter dem Verdichter liefert, nähert sich seiner Obergrenze, deshalb senkt das Gerät die Verdichterdrehzahl. Die Zeile „Drop“ ist ON, solange diese Begrenzung aktiv ist; die Zeile „Retry Qty“ zählt, wie oft das vorkam.",
          normal: "OFF / 0. Bei hoher Last im Kalten gelegentlich erwartbar; häufige Zählungen an milden Tagen sind einen Blick wert." } },
  { re: /^hp (drop|protection retry)/i,
    what: "High-pressure protection: condensing pressure on the hot side is climbing toward the cut-out, so the unit backs off before the pressure switch stops it. The \"Drop Control\" row is ON while it is limiting; the \"Retry Qty\" row counts the occurrences.",
    normal: "OFF / 0. When heating, repeated counts usually mean the water side cannot take the heat away — a high flow-temperature target, a slow pump, air or a dirty filter.",
    de: { what: "Hochdruckschutz: Der Kondensationsdruck auf der heißen Seite steigt Richtung Abschaltpunkt, deshalb regelt das Gerät zurück, bevor der Druckschalter es stoppt. Die Zeile „Drop Control“ ist ON, solange begrenzt wird; die Zeile „Retry Qty“ zählt die Vorfälle.",
          normal: "OFF / 0. Im Heizbetrieb heißt häufiges Zählen meist, dass die Wasserseite die Wärme nicht abführt — zu hohes Vorlaufziel, langsame Pumpe, Luft oder ein verschmutzter Filter." } },
  { re: /^lp (drop|protection retry)/i,
    what: "Low-pressure protection: evaporating pressure on the cold side is falling toward the cut-out, so the unit backs off. The \"Drop Control\" row is ON while it is limiting; the \"Retry Qty\" row counts the occurrences.",
    normal: "OFF / 0. When heating, counts cluster around hard frost and defrosts; persistent ones suggest a frosted or blocked outdoor coil, or low refrigerant charge.",
    de: { what: "Niederdruckschutz: Der Verdampfungsdruck auf der kalten Seite fällt Richtung Abschaltpunkt, deshalb regelt das Gerät zurück. Die Zeile „Drop Control“ ist ON, solange begrenzt wird; die Zeile „Retry Qty“ zählt die Vorfälle.",
          normal: "OFF / 0. Im Heizbetrieb häufen sich Zählungen bei strengem Frost und um Abtauvorgänge; dauerhafte deuten auf einen vereisten oder verlegten Außenwärmetauscher oder zu wenig Kältemittel hin." } },
  { re: /fin temp\.? ?(drop|protection retry)/i,
    what: "Inverter-heatsink protection: the power electronics' cooling fins are getting too hot, so the unit reduces output to cool them. The \"Drop Control\" row is ON while it is limiting; the \"Retry Qty\" row counts how often it has had to. (This is the protection — the heatsink's own temperature is the separate \"INV fin temp.\" reading.)",
    normal: "OFF / 0. Expected at most in hot weather at full output; regular counts point at restricted airflow around the outdoor unit.",
    de: { what: "Schutz des Inverter-Kühlkörpers: Die Kühlrippen der Leistungselektronik werden zu heiß, deshalb senkt das Gerät die Leistung, um sie abzukühlen. Die Zeile „Drop Control“ ist ON, solange begrenzt wird; die Zeile „Retry Qty“ zählt, wie oft es nötig war. Gemeint ist hier der Schutz; die Kühlkörpertemperatur selbst steht im eigenen Wert „INV fin temp.“.",
          normal: "OFF / 0. Allenfalls bei heißem Wetter unter Volllast erwartbar; regelmäßige Zählungen deuten auf behinderten Luftstrom rund um die Außeneinheit hin." } },
  { re: /other drop control/i,
    what: "A catch-all flag: some protection other than discharge temperature, inverter current, high/low pressure or heatsink temperature is limiting the unit right now. The unit does not report which one.",
    normal: "OFF. If it sits ON, read it together with the fault code and the other protection rows.",
    de: { what: "Ein Sammel-Flag: Irgendein Schutz außer Druckgastemperatur, Inverterstrom, Hoch-/Niederdruck oder Kühlkörpertemperatur begrenzt das Gerät gerade. Welcher, meldet das Gerät nicht.",
          normal: "OFF. Bleibt es ON, zusammen mit dem Fehlercode und den anderen Schutz-Zeilen lesen." } },

  // ── Outdoor / refrigerant circuit ──
  { re: /outside air|outdoor air|outdoor ambient|r1t-outdoor|^outdoor/i,
    what: "The outside air temperature measured at the unit. The controller uses it for weather-dependent control and operating decisions.",
    normal: "Compare it with local outdoor conditions; placement, sun and airflow can make it differ from a nearby weather station.",
    de: { what: "Die am Gerät gemessene Außenlufttemperatur. Der Regler nutzt sie für die witterungsabhängige Regelung und Betriebsentscheidungen.",
          normal: "Mit den lokalen Außenbedingungen vergleichen; Aufstellort, Sonne und Luftstrom können Abweichungen zu einer nahen Wetterstation verursachen." } },
  { re: /water heat exchanger (inlet|outlet)/i,
    what: "Raw water temperatures at the inlet/outlet of the plate heat exchanger that transfers heat between the refrigerant and the water.",
    de: { what: "Rohe Wassertemperaturen am Ein- und Austritt des Plattenwärmetauschers, der Wärme zwischen Kältemittel und Wasser überträgt." } },
  { re: /o\/u heat exch|outdoor heat exchanger|heat exchanger mid-?temp|heat exch\. (mid-?)?temp/i,
    what: "Temperature of the outdoor coil, where refrigerant boils off (heating) or condenses (cooling) by exchanging heat with the outside air.",
    normal: "near or below freezing in cold-weather heating — that frost build-up is what triggers the periodic defrost.",
    de: { what: "Temperatur der Wärmetauscherlamellen an der Außeneinheit. Dort verdampft das Kältemittel im Heizbetrieb oder kondensiert im Kühlbetrieb und tauscht dabei Wärme mit der Außenluft.",
          normal: "beim Heizen im Kalten nahe oder unter dem Gefrierpunkt — diese Reifbildung löst das periodische Abtauen aus." } },
  { re: /discharge pipe|compressor outlet|inv discharge/i,
    what: "Temperature of the hot compressed refrigerant gas leaving the compressor.",
    normal: "the hottest point in the circuit, well above the condensing temperature. A very high value makes the unit throttle back to protect the compressor.",
    de: { what: "Temperatur des heißen, verdichteten Kältemittelgases, das den Verdichter verlässt.",
          normal: "der heißeste Punkt im Kreislauf, deutlich über der Kondensationstemperatur. Ein sehr hoher Wert lässt das Gerät zurückregeln, um den Verdichter zu schützen." } },
  { re: /suction (pipe )?temp|suction temp/i,
    what: "Temperature of the cool low-pressure refrigerant gas returning to the compressor.",
    de: { what: "Temperatur des kühlen Kältemittelgases mit niedrigem Druck, das zum Verdichter zurückströmt." } },
  { re: /liquid (pipe )?temp|liquid temperature|refrig\. temp\. liquid/i,
    what: "Refrigerant temperature on the liquid line between the heat exchangers.",
    de: { what: "Kältemitteltemperatur in der Flüssigkeitsleitung zwischen den Wärmetauschern." } },
  { re: /refrig\. temp\. evap/i,
    what: "Refrigerant temperature entering/leaving the evaporator (the heat exchanger absorbing heat).",
    de: { what: "Kältemitteltemperatur beim Ein- oder Austritt des Verdampfers, also des wärmeaufnehmenden Wärmetauschers." } },
  { re: /injection tube|2 phase thermistor|r4t-deicer/i,
    what: "Temperature of a vapour/liquid-injection or de-icer sensor used by the compressor's internal control.",
    de: { what: "Temperatur eines Dampf-, Flüssigkeitseinspritz- oder Enteiserfühlers, den die interne Verdichterregelung nutzt." } },
  { re: /(high|low) pressure ?\(?(sat|t)/i,
    what: "The high/low refrigerant pressure expressed as a saturation temperature — the temperature the refrigerant boils/condenses at for that pressure. Easier to sanity-check than raw bar.",
    de: { what: "Der Hoch-/Niederdruck des Kältemittels ausgedrückt als Sättigungstemperatur — die Temperatur, bei der das Kältemittel bei diesem Druck siedet/kondensiert. Leichter einzuschätzen als reine bar." } },
  { re: /(high|low) pressure/i,
    what: "Refrigerant pressure on the high (compressor discharge) or low (compressor suction) side. The gap between them is what the compressor works against, and it drives efficiency.",
    normal: "varies with outdoor temperature and load; steady during stable running.",
    de: { what: "Kältemitteldruck auf der Druck- oder Saugseite des Verdichters. Die Differenz zwischen Hoch- und Niederdruck bestimmt, wogegen der Verdichter arbeitet, und beeinflusst die Effizienz.",
          normal: "variiert mit Außentemperatur und Last; im stabilen Betrieb gleichmäßig." } },
  { re: /compressor speed|inv frequency|frequency \(rps\)/i,
    what: "How fast the inverter-driven compressor is spinning, in revolutions per second. This is the unit's main output control.",
    normal: "modulates from 0 up to ~100+ rps to match demand — higher when there's more to heat, 0 when idle.",
    de: { what: "Wie schnell der invertergeregelte Verdichter dreht, in Umdrehungen pro Sekunde. Das ist die wichtigste Leistungsstellgröße des Geräts.",
          normal: "moduliert von 0 bis ~100+ rps je nach Bedarf — höher, wenn mehr zu heizen ist, 0 im Leerlauf." } },
  { re: /expansion valve/i,
    what: "Opening of the electronic expansion valve, in steps/pulses. It meters exactly how much refrigerant flows into the evaporator.",
    normal: "continuously adjusts while running to keep the refrigerant cycle in its sweet spot.",
    de: { what: "Öffnung des elektronischen Expansionsventils, in Schritten/Impulsen. Es dosiert genau, wie viel Kältemittel in den Verdampfer strömt.",
          normal: "regelt im Betrieb ständig nach, um den Kältekreis im optimalen Bereich zu halten." } },
  { re: /fan\d? fin temp|fan \d fin/i,
    what: "Temperature of the outdoor fan motor's driver electronics.",
    de: { what: "Temperatur der Leistungselektronik des Außenlüftermotors." } },
  { re: /^fan ?\d|fan \d \(/i,
    what: "Outdoor fan speed, as a step or in rpm. The fan pulls outside air across the coil.",
    normal: "ramps up with compressor load; drops to 0 when idle and during parts of a defrost.",
    de: { what: "Drehzahl des Außenlüfters, als Stufe oder in U/min. Der Lüfter zieht Außenluft über die Lamellen.",
          normal: "steigt mit der Verdichterlast; fällt im Leerlauf und in Teilen eines Abtauvorgangs auf 0." } },
  { re: /target (evap|cond)/i,
    what: "An internal control target the unit is steering the refrigerant circuit toward (target evaporating/condensing temperature) — not a value you set.",
    de: { what: "Eine interne Regelvorgabe für den Kältekreis. Ziel ist die Verdampfungs- oder Kondensationstemperatur; dieser Wert wird nicht vom Benutzer eingestellt." } },
  { re: /target (discharge|port)/i,
    what: "An internal control target for the compressor discharge/port temperature — used by the unit's own protection logic.",
    de: { what: "Eine interne Regelvorgabe für die Temperatur am Druckgas- oder Verdichteranschluss, die von der Schutzlogik des Geräts genutzt wird." } },
  { re: /target delta t/i,
    what: "The target temperature difference (ΔT) between leaving and returning water the controller aims to maintain across the circuit.",
    normal: "commonly around 5 K for heating; the pump speed is trimmed to hold it.",
    de: { what: "Die vom Regler angestrebte Temperaturdifferenz ΔT zwischen Vor- und Rücklauf.",
          normal: "beim Heizen üblich um 5 K; die Pumpendrehzahl wird nachgeregelt, um sie zu halten." } },
  { re: /refrigerant type/i,
    what: "The refrigerant this unit is charged with (e.g. R32 or R410A). It sets the pressure↔temperature curve used for the saturation-temperature readings.",
    de: { what: "Das Kältemittel, mit dem dieses Gerät gefüllt ist, etwa R32 oder R410A. Es legt die Druck-Temperatur-Kurve der Sättigungstemperaturen fest." } },
  { re: /compressor port/i,
    what: "Temperature measured at a compressor port — part of the unit's internal protection monitoring.",
    de: { what: "An einem Verdichteranschluss gemessene Temperatur — Teil der internen Schutzüberwachung des Geräts." } },
  { re: /refrigerant pressure|pressure/i,
    what: "A refrigerant-circuit pressure reading from the outdoor unit.",
    de: { what: "Ein Druckwert aus dem Kältekreis der Außeneinheit." } },

  // ── Electrical ──
  { re: /ct sensor|current measured by ct/i,
    what: "Mains current on one phase (L1/L2/L3), measured by a clamp (CT) sensor. Combined, these estimate the electrical power the unit is drawing.",
    normal: "rises with compressor and backup-heater load; near zero when idle.",
    de: { what: "Netzstrom einer der Phasen L1, L2 oder L3, gemessen mit einem CT-Stromwandler. Gemeinsam liefern die Phasenströme eine Schätzung der elektrischen Leistungsaufnahme.",
          normal: "steigt mit Verdichter- und Zusatzheizer-Last; nahe null im Leerlauf." } },
  { re: /inv (primary|secondary|compressor) current|inv .*current \(a\)/i,
    what: "Current drawn by the compressor inverter — a proxy for how hard the compressor is working.",
    de: { what: "Vom Verdichter-Inverter aufgenommener Strom — ein Maß dafür, wie stark der Verdichter arbeitet." } },
  { re: /inv fin temp|fin temp|heat sink temp/i,
    what: "Temperature of the inverter/power-electronics heatsink in the outdoor unit.",
    normal: "warm under load; a very high value makes the unit throttle to protect the electronics.",
    de: { what: "Temperatur des Kühlkörpers der Inverter- und Leistungselektronik in der Außeneinheit.",
          normal: "unter Last warm; ein sehr hoher Wert lässt das Gerät zurückregeln, um die Elektronik zu schützen." } },

  // ── Backup / booster heater ──
  { re: /buh output capacity/i,
    what: "Which stage(s) of the electric backup heater are engaged, as a capacity step.",
    normal: "0 when the heat pump covers the load alone; higher only in very cold weather or a fast DHW boost.",
    de: { what: "Welche Leistungsstufen des elektrischen Zusatzheizers aktiv sind.",
          normal: "0, wenn die Wärmepumpe die Last allein deckt; höher nur bei sehr kaltem Wetter oder einer schnellen Warmwasser-Aufheizung." } },
  { re: /buh step/i,
    what: "An electric backup-heater stage. These use resistive electricity (efficiency ≈ 1, unlike the heat pump), so they add heat when the heat pump can't keep up.",
    normal: "OFF most of the time. Frequent use noticeably raises running cost — expected only in a cold snap or during a boost.",
    de: { what: "Eine Stufe des elektrischen Zusatzheizers. Sie nutzt Widerstandsstrom mit einem Wirkungsgrad von etwa 1 und ergänzt Wärme, wenn die Wärmepumpe nicht nachkommt.",
          normal: "die meiste Zeit OFF. Häufiger Einsatz erhöht die Betriebskosten spürbar — erwartbar nur bei Kälteeinbruch oder während einer Aufheizung." } },
  { re: /^bsh$/i,
    what: "The electric immersion heater in the domestic-hot-water tank. It can heat the tank without the compressor or water circulation pump running. X10A reports this BSH register only as ON/OFF; it carries no dedicated heater-power reading.",
    normal: "OFF in normal heat-pump operation; ON during an electric DHW boost or when the controller calls for resistive assistance.",
    de: { what: "Der elektrische Tauchheizer im Warmwasserspeicher. Er kann den Speicher erwärmen, ohne dass Verdichter oder Wasserpumpe laufen. X10A meldet dieses BSH-Register nur als ON/OFF; eine eigene Heizstableistung enthält es nicht.",
          normal: "im normalen Wärmepumpenbetrieb OFF; ON bei elektrischer Warmwasser-Aufheizung oder wenn der Regler Widerstandswärme anfordert." } },
  { re: /thermal protector/i,
    what: "The thermal cut-out that protects an electric heater from overheating.",
    normal: "normal/closed in regular operation; it trips only on an over-temperature fault.",
    de: { what: "Die thermische Schutzabschaltung, die einen elektrischen Heizer vor Übertemperatur schützt.",
          normal: "im regulären Betrieb normal/geschlossen; sie löst nur bei Übertemperatur aus." } },
  { re: /freeze protection/i,
    what: "Anti-freeze protection: the unit runs the pump (and if needed the heater) to stop water in the pipes freezing while it's otherwise idle in the cold.",
    normal: "ON only in freezing conditions when the system is idle.",
    de: { what: "Frostschutz: Das Gerät lässt die Pumpe und bei Bedarf auch den Heizer laufen, damit das Wasser in den Leitungen bei Kälte nicht einfriert.",
          normal: "nur bei Frost und ruhender Anlage ON." } },

  // ── Geothermal / brine ──
  { re: /brine (inlet|outlet|temp|pump)|entering brine|leaving brine/i,
    what: "Ground-loop (brine) circuit reading on a geothermal unit — the fluid that carries heat to/from the ground, and its pump.",
    normal: "brine temperatures stay in a narrow band set by the ground; a slow seasonal drift is normal, a sharp drop is not.",
    de: { what: "Messwert des erdseitigen Solekreises einer Erdwärmepumpe. Erfasst werden die Flüssigkeit, die Wärme aus dem Erdreich aufnimmt oder dorthin abgibt, und ihre Pumpe.",
          normal: "Sole-Temperaturen bleiben in einem engen, vom Erdreich bestimmten Band; eine langsame saisonale Drift ist normal, ein plötzlicher Einbruch nicht." } },

  // ── Hybrid / second source / smart grid ──
  { re: /hybrid (op|heating)/i,
    what: "On a hybrid heat-pump + boiler system: which source the controller has chosen (heat pump only, hybrid, or boiler only) and its target.",
    de: { what: "Bei einem Hybridsystem aus Wärmepumpe und Kessel zeigt der Wert die gewählte Quelle und ihren Zielwert: reine Wärmepumpe, Hybridbetrieb oder reiner Kesselbetrieb." } },
  { re: /bivalent|boiler operation|boiler heating target/i,
    what: "A second heat source (typically a boiler) being called in a bivalent/hybrid setup when the heat pump alone isn't enough or isn't the cheaper option.",
    de: { what: "Eine zweite Wärmequelle, meist ein Kessel, die in einer bivalenten oder hybriden Anlage zugeschaltet wird, wenn die Wärmepumpe allein nicht ausreicht oder nicht die günstigere Wahl ist." } },
  { re: /be_cop|^cop\b/i,
    what: "The unit's own live estimate of its coefficient of performance — heat delivered ÷ electricity used. Higher is more efficient (3 means 3 kW of heat per 1 kW of power).",
    normal: "typically ~3–5 in mild heating; lower in hard frost or during DHW, and drops toward 1 whenever the backup heater runs.",
    de: { what: "Die geräteeigene Live-Schätzung der Leistungszahl: gelieferte Wärme geteilt durch aufgenommene elektrische Leistung. Ein höherer Wert ist effizienter; 3 bedeutet 3 kW Wärme je 1 kW Strom.",
          normal: "typisch ~3–5 bei milder Heizung; niedriger bei strengem Frost oder Warmwasser und fällt Richtung 1, sobald der Zusatzheizer läuft." } },
  { re: /benefit kwh|smartgrid|smart grid|solar input/i,
    what: "An external utility/smart-grid or solar signal input — e.g. a cheap-tariff or surplus-PV window telling the unit it's a good time to store extra heat.",
    normal: "ON only while that external signal is active.",
    de: { what: "Ein externes Signal vom Versorger, Smart Grid oder der Solaranlage, beispielsweise ein Niedrigtarif- oder PV-Überschussfenster. Es signalisiert dem Gerät, dass jetzt günstig zusätzliche Wärme gespeichert werden kann.",
          normal: "nur ON, solange dieses externe Signal aktiv ist." } },

  // ── Capacity / identity (put after BUH-capacity above) ──
  { re: /capacity/i,
    what: "The nominal rated capacity/size class of the unit (indoor or outdoor), in kW or as a code. It's a fixed property of the model, not a live measurement.",
    de: { what: "Die Nennleistung oder Größenklasse der Innen- oder Außeneinheit, angegeben in kW oder als Code. Sie ist eine feste Eigenschaft des Modells und kein Live-Messwert." } },
  { re: /silent mode|low noise/i,
    what: "Low-noise / quiet mode: caps fan and compressor speed to run more quietly, at the cost of some heating output.",
    normal: "ON during any scheduled quiet hours you've set; OFF otherwise.",
    de: { what: "Der Leisebetrieb begrenzt Lüfter- und Verdichterdrehzahl. Dadurch arbeitet die Anlage ruhiger, verliert aber etwas Heizleistung.",
          normal: "ON während eingestellter Ruhezeiten; sonst OFF." } },
  // ── HomeHub (Modbus) rows that no X10A entry above already covers ─────────────────────────────
  // Appended LAST on purpose: descFor takes the FIRST match, so nothing here can hijack copy an
  // X10A catalog label already resolves to. The entries below are the HomeHub-specific remainder;
  // coverage alone is not semantic correctness (a setpoint must not inherit an ON/OFF explanation
  // merely because its label contains "thermostat").
  { exact: true, re: /^unit abnormality$/i,
    what: "The unit's current diagnostic state reported by the HomeHub: No error, Fault or Warning.",
    normal: "No error means that this register reports neither a current Fault nor Warning. For Fault or Warning, read the neighbouring code and sub-code; this state alone does not identify the cause.",
    de: { what: "Der vom HomeHub gemeldete aktuelle Diagnosezustand der Anlage: Kein Fehler, Fehler oder Warnung.",
          normal: "Kein Fehler bedeutet, dass dieses Register aktuell weder Fehler noch Warnung meldet. Bei Fehler oder Warnung den benachbarten Code und Subcode mitlesen; der Zustand allein benennt keine Ursache." } },
  { exact: true, re: /^unit abnormality code$/i, faultCode: true,
    what: "Meaning of the currently reported fault code",
    de: { what: "Bedeutung des aktuell gemeldeten Fehlercodes" } },
  { exact: true, re: /^unit abnormality sub code$/i,
    what: "The numeric sub-code that narrows the neighbouring Daikin diagnostic code to a specific case.",
    normal: "It is supplemental information, not a status by itself. Read it only together with Unit abnormality and its code; unavailable values are deliberately not displayed.",
    de: { what: "Der numerische Subcode, der den benachbarten Daikin-Diagnosecode auf einen konkreten Fall eingrenzt.",
          normal: "Er ist eine Zusatzinformation und allein kein Status. Nur zusammen mit Anlagenstatus und Code auswerten; nicht verfügbare Werte werden bewusst nicht angezeigt." } },
  { exact: true, re: /^dhw normal operation$/i,
    what: "Whether normal domestic-hot-water operation is active. The UI renders the HomeHub states Operating and Idle/buffering as ON and OFF.",
    normal: "ON = Operating; OFF = Idle/buffering. This flag says that DHW operation is active, but not why it started.",
    de: { what: "Ob der normale Warmwasserbetrieb aktiv ist. Die HomeHub-Zustände In Betrieb und Leerlauf/Pufferung werden in der UI als ON und OFF dargestellt.",
          normal: "ON = In Betrieb; OFF = Leerlauf/Pufferung. Das Flag zeigt einen aktiven Warmwasserbetrieb, aber nicht dessen Auslöser." } },
  { exact: true, re: /^space heating\/cooling normal operation$/i,
    what: "Whether normal space heating or cooling operation is active. The UI renders the HomeHub states Operating and Idle/buffering as ON and OFF.",
    normal: "ON = Operating; OFF = Idle/buffering. Use Operation mode to distinguish Heating from Cooling and the valve position to see the selected water route.",
    de: { what: "Ob der normale Raumheiz- oder Kühlbetrieb aktiv ist. Die HomeHub-Zustände In Betrieb und Leerlauf/Pufferung werden in der UI als ON und OFF dargestellt.",
          normal: "ON = In Betrieb; OFF = Leerlauf/Pufferung. Heizen oder Kühlen unterscheidet die Betriebsart; den gewählten Wasserweg zeigt die Ventilposition." } },
  { exact: true, re: /^leaving water temperature phe$/i,
    what: "The water temperature leaving the plate heat exchanger, before the electric backup heater.",
    normal: "Compare it with return temperature only while water is circulating: it is normally higher during heating and lower during cooling. Their difference is the water-side ΔT.",
    de: { what: "Die Wassertemperatur am Austritt des Plattenwärmetauschers, vor dem elektrischen Zusatzheizer.",
          normal: "Nur bei Wasserumlauf mit der Rücklauftemperatur vergleichen: beim Heizen normalerweise höher, beim Kühlen niedriger. Die Differenz ist das wasserseitige ΔT." } },
  { exact: true, re: /^leaving water temperature buh$/i,
    what: "The leaving-water temperature after the electric backup heater.",
    normal: "With the backup heater OFF it should be close to the PHE value. A rise across the two sensors can indicate heater contribution, but confirm it with the BUH state rather than temperature alone.",
    de: { what: "Die Vorlauftemperatur nach dem elektrischen Zusatzheizer.",
          normal: "Bei Zusatzheizer OFF sollte sie nahe am PHE-Wert liegen. Ein Anstieg zwischen beiden Fühlern kann einen Heizbeitrag zeigen, sollte aber mit dem BUH-Status bestätigt werden." } },
  { exact: true, re: /^domestic hot water temperature$/i,
    what: "The water temperature measured in the domestic-hot-water tank.",
    normal: "Below the DHW target is expected after hot water has been used. During DHW operation ON it should rise; if it does not, compare operation, flow and diagnostic rows before drawing a conclusion.",
    de: { what: "Die im Warmwasserspeicher gemessene Wassertemperatur.",
          normal: "Nach einer Warmwasserentnahme liegt sie erwartbar unter dem Sollwert. Bei Warmwasserbetrieb ON sollte sie steigen; tut sie das nicht, Betriebs-, Durchfluss- und Diagnosezeilen gemeinsam prüfen." } },
  { exact: true, re: /^liquid refrigerant temperature$/i,
    what: "The refrigerant temperature in the liquid line between the outdoor unit and the indoor heat exchanger.",
    normal: "Its expected relationship to water and outdoor temperature changes with Heating, Cooling and idle operation. A single value without operating context is not a fault diagnosis.",
    de: { what: "Die Kältemitteltemperatur in der Flüssigkeitsleitung zwischen Außeneinheit und Innenwärmetauscher.",
          normal: "Ihr Verhältnis zu Wasser- und Außentemperatur ändert sich mit Heizen, Kühlen und Stillstand. Ein Einzelwert ohne Betriebskontext ist keine Störungsdiagnose." } },
  { exact: true, re: /^remote controller room temperature main$/i,
    what: "The main-zone room temperature reported by the remote controller.",
    normal: "No value is expected when that room sensor is not available or configured. When present, compare it with the controller display and consider where the controller is mounted.",
    de: { what: "Die vom Bedienteil gemeldete Raumtemperatur der Hauptzone.",
          normal: "Kein Wert ist erwartbar, wenn dieser Raumfühler nicht verfügbar oder konfiguriert ist. Bei vorhandenem Wert mit der Anzeige des Bedienteils vergleichen und dessen Montageort berücksichtigen." } },
  { exact: true, re: /^heat pump power consumption$/i,
    what: "The electrical power consumption reported by the heat-pump system through the HomeHub. The X10A side only provides an estimate derived from phase currents.",
    normal: "The expected value depends on mode, load and model. Correlate it with compressor and electric-heater states; do not attribute the whole value to the compressor alone.",
    de: { what: "Die vom Wärmepumpensystem über den HomeHub gemeldete elektrische Leistungsaufnahme. Die X10A-Seite liefert dafür nur eine aus Phasenströmen abgeleitete Schätzung.",
          normal: "Der erwartbare Wert hängt von Betriebsart, Last und Modell ab. Mit Verdichter- und Elektroheizerstatus abgleichen und nicht den gesamten Wert allein dem Verdichter zuschreiben." } },
  { exact: true, re: /^leaving water main heating setpoint$/i,
    what: "The target leaving-water temperature for the main heating zone, read back from the HomeHub. It is read-only in this firmware.",
    normal: "It can be fixed or weather-dependent according to the controller settings. Lower targets can improve efficiency if the building still reaches its room-temperature target.",
    de: { what: "Die vom HomeHub zurückgelesene Soll-Vorlauftemperatur der Haupt-Heizzone. In dieser Firmware ist sie nur lesbar.",
          normal: "Je nach Reglereinstellung kann sie fest oder witterungsabhängig sein. Niedrigere Sollwerte können die Effizienz verbessern, sofern das Gebäude sein Raumtemperaturziel weiterhin erreicht." } },
  { exact: true, re: /^leaving water main cooling setpoint$/i,
    what: "The target leaving-water temperature for the main cooling zone, read back from the HomeHub. It is read-only in this firmware.",
    normal: "It is relevant only when cooling is supported and enabled; otherwise a configured value may remain visible without active cooling.",
    de: { what: "Die vom HomeHub zurückgelesene Soll-Vorlauftemperatur der Haupt-Kühlzone. In dieser Firmware ist sie nur lesbar.",
          normal: "Sie ist nur bei unterstützter und freigegebener Kühlung relevant; andernfalls kann ein konfigurierter Wert auch ohne aktiven Kühlbetrieb sichtbar bleiben." } },
  { re: /^space heating\/cooling on\/off$/i,
    what: "Whether the space circuit is ENABLED at all — the switch, not the current activity. The space-operation row above says whether it is being served right now.",
    normal: "ON = space heating/cooling enabled; OFF = disabled. OFF prevents normal space operation regardless of demand; seasonal scheduling depends on the installation's settings.",
    de: { what: "Ob der Heiz- oder Kühlkreis überhaupt FREIGEGEBEN ist — der Schalter, nicht die aktuelle Tätigkeit. Ob er gerade bedient wird, sagt die Zeile zum normalen Raumheiz- oder Kühlbetrieb.",
          normal: "ON = Raumheizung/-kühlung freigegeben; OFF = gesperrt. OFF verhindert den normalen Raumbetrieb unabhängig von einer Anforderung; die saisonale Schaltung hängt von der Anlagenkonfiguration ab." } },
  { exact: true, re: /^quiet mode operation$/i,
    what: "Low-noise operation: the outdoor unit caps its fan and compressor speed, which costs capacity.",
    normal: "ON = quiet mode active; OFF = inactive. Whether a schedule enables it is installation-specific. If heat demand is not met while it is ON, the reduced output limit is relevant context.",
    de: { what: "Geräuscharmer Betrieb: die Außeneinheit begrenzt Lüfter- und Verdichterdrehzahl, was Leistung kostet.",
          normal: "ON = Leisebetrieb aktiv; OFF = inaktiv. Ob ein Zeitprogramm ihn einschaltet, ist anlagenspezifisch. Wird der Wärmebedarf bei ON nicht erreicht, ist die reduzierte Leistungsgrenze ein relevanter Zusammenhang." } },
  { re: /^dhw reheat setpoint$/i,
    what: "The target tank temperature used for DHW reheat operation. It is not, by itself, the temperature at which reheat starts.",
    normal: "The start threshold also depends on the configured reheat hysteresis and operating schedule. Interpret this target together with those settings and the current tank temperature.",
    de: { what: "Die Zieltemperatur des Warmwasserspeichers für den Nachheizbetrieb. Sie ist für sich allein nicht die Temperatur, bei der das Nachheizen startet.",
          normal: "Die Startschwelle hängt zusätzlich von der eingestellten Nachheiz-Hysterese und dem Betriebszeitplan ab. Diesen Sollwert zusammen mit diesen Einstellungen und der aktuellen Speichertemperatur bewerten." } },
  { exact: true, re: /^power limit during recommended on \/ buffering$/i,
    what: "The electrical power limit used during Smart-Grid Recommended on buffering.",
    normal: "During buffering in Recommended on, the effective limit is the lower of this value and General power limit. It is a configured ceiling, not the unit's current consumption.",
    de: { what: "Die elektrische Leistungsgrenze während der Smart-Grid-Pufferung im Modus Empfehlung ein.",
          normal: "Bei Pufferung mit Empfehlung ein gilt der niedrigere Wert aus dieser Grenze und der allgemeinen Leistungsgrenze. Das ist eine konfigurierte Obergrenze und nicht die aktuelle Leistungsaufnahme." } },
  { exact: true, re: /^general power limit$/i,
    what: "The general electrical power limit applied by the HomeHub, including during Free running.",
    normal: "It is a configured ceiling, not measured consumption. A lower value intentionally restricts the power available to the unit across the Smart-Grid operating modes.",
    de: { what: "Die allgemeine elektrische Leistungsgrenze des HomeHub, die auch bei Freier Betrieb gilt.",
          normal: "Sie ist eine konfigurierte Obergrenze und keine gemessene Leistungsaufnahme. Ein niedrigerer Wert begrenzt die für die Anlage verfügbare Leistung über die Smart-Grid-Betriebsarten hinweg." } },
];

// ── The two sources ─────────────────────────────────────────────────────────────────────────────
// X10A and the HomeHub are INDEPENDENT stacks on the device: separate tasks, separate caches,
// separate link states, and either can be down while the other reports (docs/MODBUS_PROTOCOL.md).
// The UI keeps them apart everywhere except one place — a value row, where showing the same quantity
// from both is the entire point of having two sources.
//
// They are paired on the `concept` the DEVICE puts on each row (logic/homehub_map.hpp), never on the
// label: the catalog spells one quantity many ways across the 43 profiles and reuses tags across
// different quantities, so a label match here would be both incomplete and wrong. The browser does
// no matching of its own — it looks up a string the firmware already resolved structurally.
// A gateway reading, or null. Gated on mbLive() as well as on the row existing: the firmware now
// omits the whole array while the link is down, but this is the helper every consumer goes through
// and it must be correct ON ITS OWN — /status carries the link state on an 8 s cadence while
// /values runs at 2 s, so "the payload will be empty" is a guarantee about another request. It was
// not gated at all, and the last good cache went on being drawn as the live second opinion, with a
// computed difference against it.
const mbByConcept = (cid) =>
  cid && mbLive()
    ? (S._modbus || []).find((m) => m && m.concept === cid && m.value != null) || null
    : null;

// Is the X10A stack currently delivering? Keyed on the LINK, not on individual rows: a bus that has
// stopped answering leaves the last cache in place, so per-row emptiness would lag behind the truth.
const x10aDown = () => !!(S.status && S.status.hp && S.status.hp.connected === false);
// Is the HomeHub stack running AND connected? Both matter: `enabled` false means this installation
// has no HomeHub at all, and then nothing Modbus is shown anywhere.
const mbLive = () => !!(S.status && S.status.modbus && S.status.modbus.enabled && S.status.modbus.connected);

// The Modbus row that STANDS IN for an X10A row — only while X10A is down and the HomeHub is live.
// Returns null in normal operation: with both sources up, X10A leads everywhere and Modbus appears
// only as the second opinion inside the explainer.
const mbFallbackFor = (cid) => (x10aDown() && mbLive() ? mbByConcept(cid) : null);
// The Modbus reading of the SAME quantity as an X10A row — its second opinion, for the explainer.
// Takes the row rather than a concept id so every caller resolves it the one way: `concept` is put
// on the row by the FIRMWARE (logic/homehub_map.hpp, structurally by reg/offset/unit), and a browser
// that started matching labels here would re-open exactly the substitution that header exists to
// prevent. Null for an absent row, a row the firmware paired with nothing, and every device without
// a HomeHub — so each caller's "no second source" branch is the same one.
//
// AND null while the X10A link is down, which is the load-bearing half. A SECOND opinion requires a
// FIRST one: with the bus silent the X10A row handed in here is whatever the retained cache still
// holds (kept on purpose — the trend rings need it), so every consumer went on comparing it against
// the live gateway. The row header had already switched to the gateway value while the explainer
// beneath it printed that same gateway row again as the "second source" and a difference against a
// minutes-old X10A number — the comparison of two INSTANTS presented as a comparison of two
// INSTRUMENTS, which is the exact defect the cache-dropping in hp_modbus.cpp removed from the other
// direction. Gated HERE rather than at the call sites because it was already spelled out at three
// of them and they had drifted; this is the same argument stateOf() makes for plant states, applied
// to readings.
const mbTwin = (row) => (row && !x10aDown() ? mbByConcept(row.concept) : null);

// The six quantities BOTH sources measure, in ONE table. Each row names the same thing three ways:
// the field liveData fills, the schematic pill that draws it, the INSPECT target that pill opens —
// against the CONCEPT the firmware paired them on (logic/homehub_map.hpp, resolved structurally by
// register/offset/unit, never by label).
//
// One table because these were three separate lists of the same six things, and they had already
// drifted: liveData's field is `ret` where the INSPECT target is `rwt`. Three lists are three
// chances to disagree, and the disagreement is SILENT in the worst direction — a name that matches
// nothing means the second source simply never appears, which looks exactly like a HomeHub that
// does not carry the register. The concept strings are the firmware's own trend ids; a typo here
// cannot show a wrong value, only no value.
const MB_PAIRS = [
  { fld: "lwt",  pill: "svLwt",  insp: "lwt",  cid: "leaving_water" },
  { fld: "ret",  pill: "svRwt",  insp: "rwt",  cid: "return_water"  },
  { fld: "tank", pill: "svTank", insp: "tank", cid: "dhw_tank"      },
  { fld: "out",  pill: "svOut",  insp: "out",  cid: "outdoor_air"   },
  { fld: "flow", pill: "svFlow", insp: "flow", cid: "flow"          },
  { fld: "room", pill: "svRoom", insp: "room", cid: "room_temp"     },
];
// The Modbus reading an INSPECT target stands for, while the drawing is running on the second
// source. This is what stops the explainer from CONTRADICTING the picture: with X10A down — or with
// one X10A row held over while the rest of its link remains live — the pill states the gateway's
// number, so tapping it must open the same number under the gateway's own register name. The
// inspector blanking what the pill blanks is the rule (ou_stale.hpp); the converse has to hold too.
const mbForInspect = (key) => {
  // Smart Grid is a Modbus-ONLY fact, not a fallback for an X10A reading. It therefore remains the
  // inspector's source while both stacks are live — precisely the normal case in which the drawing
  // needs to prove that an external energy manager's request reached the HomeHub.
  if (key === "sgrequest") return mbRow(MB_OFF_SMART_GRID);
  if (!mbLive()) return null;
  const p = MB_PAIRS.find((q) => q.insp === key);
  // Normally only a silent X10A link makes the gateway lead. `mbFields` is the per-reading exception:
  // liveData marks outdoor air there while X10A is connected but its sleeping outdoor-unit row is
  // retained from the last run. No marker means X10A still leads and Modbus remains a second opinion.
  const leads = x10aDown() || !!(p && S.live && S.live.mbFields && S.live.mbFields.has(p.fld));
  if (!leads) return null;
  // Electrical input has no X10A concept twin. It still becomes the schematic pill's source when
  // X10A is down, so the inspector needs the real register row for its label and Modbus badge rather
  // than treating the measured headline as an untraceable derived value.
  if (key === "pel") return mbPower();
  return p ? mbByConcept(p.cid) : null;
};
// A true binary row as a tri-state boolean (null = absent or malformed). A plain numeric 0/1 can be
// a count or a setpoint, so the structural marker is mandatory.
const binaryValue = (r) => {
  if (!r || r.value == null || r.binary !== true) return null;
  const value = String(r.value).trim();
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
};
// A numeric HomeHub enum, validated against the structural semantic id /values carries beside it.
// Never infer a mode from the label or accept a decimal/text alias: unknown future values stay raw
// in the value list but cannot become a plausible current state in the schematic.
const modbusEnumNumber = (r, semantic, max) => {
  if (!r || r.value == null || r.enum !== semantic) return null;
  const raw = String(r.value).trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
};
// Most gateway states retain the firmware-wide numeric 1/0 contract. The 3-way valve is an enum,
// but its PUBLIC value is now also the raw numeric Modbus constant. Its enum id preserves the
// destination meaning while still giving the schematic a boolean direction to route on.
const mbBinaryValue = (r) => {
  const binary = binaryValue(r);
  if (binary != null) return binary;
  const valve = modbusEnumNumber(r, "three_way_valve", 1);
  if (valve != null) return valve === 1;
  return null;
};
// A HomeHub STATE register by its EKRHH offset, as a tri-state boolean (null = the gateway did not
// answer it either). State is not a reading: it carries no unit and no trend, so it rides the offset
// rather than the concept vocabulary logic/homehub_map.hpp reserves for paired MEASUREMENTS.
const mbBool = (off) => mbBinaryValue(mbRow(off));
// EKRHH input 21 is a three-state enum, not a flag. Preserve the raw constant while ensuring the
// status header never treats an unknown future value as a known Fault or Warning.
const mbUnitAbnormality = () => modbusEnumNumber(mbRow(21), "unit_abnormality", 2);
// The same register as raw TEXT — the error code is a Text16, not a flag.
const mbVal = (off) => { const r = mbRow(off); return r ? String(r.value) : null; };
// The MEASURED power consumption (EKRHH input register 51, def/homehub.hpp). Named because the map
// carries three "kW" rows and the other two are the power-LIMIT setpoints (holding 57/58): anything
// selecting this reading by its UNIT will sooner or later select an installer's ceiling instead.
const MB_OFF_POWER = 51;
// The EKRHH data-model offset is 56; Modbus puts it on zero-based PDU address 55. evcc's `boost`
// writes mode 2 (Recommended on) there. Keep the data-model offset here because `/values.modbus`
// exposes `off`, not the wire address — mixing the two would make the active request disappear.
const MB_OFF_SMART_GRID = 56;
// …and the lookup itself is a named helper for the same reason every other resolution here is one:
// it gives the rule ONE definition to be gated on, instead of a lookup spelled out at the call site
// where the next reader sees a `find()` and a unit and has no way to know which of the three kW rows
// was meant. Null when the gateway did not answer 51 — a missing measurement, never the nearest
// number that shares its unit.
const mbPower = () => mbRow(MB_OFF_POWER);
const SMART_GRID_MODE_VALUE = Object.freeze([
  "Free running", "Forced off", "Recommended on", "Forced on",
]);
// The HomeHub boundary exposes the raw 0..3 constant. The enum id makes the number structural;
// unknown future/corrupt values must not become a plausible-looking Smart-Grid request.
const mbSmartGridMode = () =>
  modbusEnumNumber(mbRow(MB_OFF_SMART_GRID), "smart_grid_mode", 3);
// One lookup both go through. Gated on mbLive() for mbByConcept's reason: correct on its own.
const mbRow = (off) =>
  mbLive() ? (S._modbus || []).find((m) => m && m.off === off && m.value != null) || null : null;

// X10A exposes the Smart-Grid interface as two independent contact bits. Neither contact alone is
// a user-facing operating mode; their documented combination is. Resolve the rows by the structural
// metadata supplied by the firmware, fail closed if either bit is absent/malformed, and retain the
// same canonical four names the HomeHub boundary uses.
const x10aSemanticRow = (semantic, values = S._values || []) =>
  values.find((r) => r && r.binary_semantic === semantic && r.value != null) || null;
const x10aSmartGridModeFrom = (values) => {
  const c1 = binaryValue(x10aSemanticRow("smart_grid_contact_1", values));
  const c2 = binaryValue(x10aSemanticRow("smart_grid_contact_2", values));
  if (c1 == null || c2 == null) return null;
  return c1 ? (c2 ? 3 : 2) : (c2 ? 1 : 0);
};
const x10aSmartGridMode = () => x10aDown() ? null : x10aSmartGridModeFrom(S._values || []);
const x10aSmartGridRow = () => {
  const mode = x10aSmartGridMode();
  return mode == null ? null : {
    label: "Smart Grid operation mode",
    displayLabel: t("values.sg_x10a_mode"),
    value: SMART_GRID_MODE_VALUE[mode],
    unit: "",
    group: "Operation",
    key: "x10a:smart-grid-mode",
  };
};

// Closed-drawing and inspector wording for the same four-value enum. Only mode 2 gets the compact
// boost marker; every other state stays readable in the HomeHub row and in an already-open
// inspector without adding a permanent status label to the drawing.
const sgModeText = (mode) => mode == null ? "—" : t(`sg.mode${mode}`);
const sgRequestText = (mode) => mode === 2 ? t("schem.sg_boost") : "";

// ── WHICH SOURCE ANSWERS A PLANT STATE ─────────────────────────────────────────────────────────
// One rule, one place. X10A leads while its link is LIVE and carries the row; otherwise a LIVE
// gateway answers; otherwise nobody does and the caller blanks.
//
// This exists because the rule was written out three times — for the valve, the pump and the
// space-heating demand — and the three had already drifted into three different behaviours. The
// valve read `X10A ?? Modbus` and was never cleared when the X10A link dropped, so the STALE X10A
// position beat a live gateway one: measured, the header said "DHW · readings from Modbus" while
// the drawing routed water through the radiators and left the tank branch idle. The pump and the
// demand had the opposite bug — cleared on link loss and never restored from the gateway, so they
// simply went blank next to readings that were arriving.
//
// The X10A cache is deliberately KEPT when its link drops (the trend rings need it), so "the row
// exists" is not the same question as "the row is current". Every consumer has to ask the second
// one, and asking it once is the only way they cannot disagree.
const stateOf = (re, mbOffset) => {
  const x = x10aDown() ? null : vOn(re);
  if (x != null) return x;
  // Not gated on x10aDown: a profile can lack the X10A row while the bus is perfectly healthy, and
  // the gateway knowing something X10A never carried is not a fallback, it is just the answer.
  return mbBool(mbOffset);
};

// First matching description for a value label, or null (→ a plain, non-expandable row).
function descFor(label) {
  const l = label || "";
  for (const d of DESCRIPTIONS) if (d.re.test(l)) return d;
  return null;
}
// EVERY paragraph of an explainer body goes through descParaHtml — the "what is it" sentence as
// much as the notes after it. Not just the notes: .vdesc-p's first-child rule (which suppresses the
// leading gap) can only see ELEMENTS, so a description left as a bare text node made the note that
// followed it the first child, and the paragraph break silently collapsed to nothing.
const descParaHtml = (html) => `<div class="vdesc-p">${html}</div>`;

// A labelled note under the "what is it" sentence, opened by a lead-in in stronger ink. Both notes
// an explainer can carry take this shape — the timeless "Normal:" one below and the live held-over
// one (HELD_OVER_NOW) the inspector appends — so one helper renders both and they cannot drift into
// two different-looking kinds of note. A paragraph rather than a run-on sentence because the two
// halves answer different questions ("what IS this" vs "what should it read"), and set solid they
// read as one paragraph that changes subject mid-way.
// All text is our own static copy (labels come from the firmware's own def/ tables), but escape
// anyway — cheap and keeps the one-encoder rule.
const descNoteHtml = (lead, text) =>
  descParaHtml(`<span class="vdesc-n">${esc(lead)}</span> ${esc(text)}`);

// The SECOND source, as one plain line at the END of the explainer — after the "Normal:" note, in
// the same paragraph shape as everything else in the body, in the Modbus petrol.
//
// It used to be a bordered card at the TOP, listing X10A and Modbus as two labelled rows with the
// difference under them. That inverted the panel: the row's OWN value is already stated an inch
// above, in the row header the reader just tapped, so the card repeated it in a heavier shape than
// the original and pushed the description — the thing a reader opens an explainer FOR — below the
// fold. One line naming the other instrument is the whole content; the comparison the reader wants
// is between this line and the value at the top, which is where their eye already is.
//
// The unit is the MODBUS row's own, not the X10A row's: this states what the gateway reads, and
// borrowing the other source's unit word would quietly assert the two are identically scaled (they
// are spelled "L/min" and "l/min" for the flow, which is exactly the kind of difference worth
// keeping visible). Returns "" with no twin, with no X10A value to complement, and on every device
// without a HomeHub — so an unpaired row keeps precisely the explainer it had before.
function mbNoteHtml(row, mb) {
  if (!mb || mb.value == null || !row || row.value == null) return "";
  return mbRowHtml(mb) + mbDeltaHtml(row, mb);
}

// One gateway reading as a FULL row: its own label, the badge, and the value on the right — the
// same shape the X10A row above it has, so the two line up and read as two instruments answering
// one question rather than a reading and a footnote about it.
//
// The label is the MODBUS register's own (`Return water temperature`), never the X10A row's. Under
// an X10A row called "3way valve" the gateway's line reads "3-way valve", which NAMES the
// register the status came from — and naming it is the point: this line is what someone verifying
// the pairing on real hardware reads to check that the two rows are the same quantity. Reusing the
// X10A label would show them their own assumption back.
function mbRowHtml(mb) {
  return `<div class="mb-line">` +
    `<span>${esc(displayHomeHubLabel(mb))} ` +
      `<span class="mb-tag">${esc(t("src.modbus_tag"))}</span></span>` +
    `<span>${esc(displayValue(mb))}${mb.unit ? " " + esc(mb.unit) : ""}</span></div>`;
}

// WHY two correct instruments read differently, per pairing. Only three of the nine have a
// structural answer, and the other six deliberately have none: they read the same sensor of the
// same circuit, so a gap there is instrument tolerance and inventing a reason for it would teach a
// reader to explain away a discrepancy that might be a real defect. The point of stating the reason
// where one EXISTS is the opposite — without it, the leaving-water pair's steady offset reads as one
// of the two being wrong, and the outdoor pair's several-Kelvin gap at rest reads as a broken sensor
// when it is the documented behaviour of a sleeping outdoor unit (logic/ou_stale.hpp).
const MB_DELTA_WHY = {
  leaving_water: {
    en: "the HomeHub measures at the plate heat exchanger, X10A before the backup heater",
    de: "der HomeHub misst am Plattentauscher, X10A vor dem Reserveheizer",
  },
  outdoor_air: {
    en: "while the compressor rests X10A holds the last run's value — the HomeHub keeps measuring",
    de: "bei stehendem Verdichter hält X10A den Wert des letzten Laufs — der HomeHub misst weiter",
  },
  room_temp: {
    en: "the two read the room from different controllers",
    de: "die beiden lesen den Raum von unterschiedlichen Reglern",
  },
};

// The difference, stated in the row's own unit, with the reason after it where there is one.
// A WIDE gap is deliberately NOT coloured as an error: two sensors legitimately sit at different
// points in the circuit, so a gap is information. What it must never do is stay silent — a reader
// comparing two numbers wants to know whether they agree, and "1.7 K apart, and here is why" is a
// different statement from two numbers left side by side to be squinted at.
function mbDeltaHtml(row, mb) {
  const why = MB_DELTA_WHY[row.concept] ? tx(MB_DELTA_WHY[row.concept]) : "";
  // A bit flag has no difference to state. Agreement on a flag is unremarkable and says nothing;
  // a MISMATCH is worth a line, since the two sources are then contradicting each other about a
  // discrete fact rather than differing by a tolerance.
  const x10aState = binaryValue(row), mbState = mbBinaryValue(mb);
  if (x10aState != null || mbState != null) {
    // X10A serves binary flags as 1/0; the gateway's valve serves its named destination. Compare
    // their structural meanings, never their different wire spellings.
    return x10aState != null && mbState != null && x10aState === mbState
      ? "" : `<div class="mb-delta">${esc(t("src.disagree"))}</div>`;
  }
  const a = parseFloat(row.value), b = parseFloat(mb.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return why ? `<div class="mb-delta">${esc(why)}</div>` : "";
  const dv = Math.abs(a - b);
  const head = dv < 0.05 ? t("src.agree") : t("src.delta", fmt1(dv), row.unit || "");
  return `<div class="mb-delta">${esc(head)}${why ? " — " + esc(why) : ""}</div>`;
}

// Explain only the code the row reports NOW. Keeping all 63 meanings as a lookup is useful; printing
// all 63 every time the row opens is not. An unavailable HomeHub value (`--`) must not be translated
// into "no fault" because the neighbouring diagnostic-state register is the authority for that.
function faultCodeDetailHtml(currentValue) {
  const raw = String(currentValue == null ? "" : currentValue).trim();
  const match = raw.match(/^([0-9A-Z]{2})(?=$|[:\s-])/i);
  if (!match) {
    return descParaHtml(esc(LANG === "de"
      ? "Aktuell wird kein Fehlercode übertragen."
      : "No fault code is currently being transmitted."));
  }
  const code = match[1].toUpperCase();
  const entry = DAIKIN_FAULT_CODES.find((candidate) => candidate.code === code);
  const meaning = entry
    ? (LANG === "de" ? entry.de : entry.en)
    : (LANG === "de" ? "Keine Kurzbeschreibung für diesen Code hinterlegt."
                     : "No short explanation is stored for this code.");
  return `<div class="fault-code-current"><code>${esc(code)}</code><span>${esc(meaning)}</span></div>`;
}

// Description body: the plain "what is it" sentence, plus an optional "Normal:" note or the current
// fault-code meaning. `currentValue` is optional because most explainers do not need their row value.
function descBodyHtml(d, currentValue) {
  const b = (LANG === "de" && d.de) ? d.de : d;   // German copy when present, else the English row
  if (d.faultCode) return faultCodeDetailHtml(currentValue);
  const intro = descParaHtml(esc(b.what));
  return intro + (b.normal ? descNoteHtml(t("normal.label"), b.normal) : "");
}
