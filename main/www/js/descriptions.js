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
    what: "The target temperature for the domestic-hot-water tank or thermal store. The controller heats the tank until the relevant sensor reaches this value.",
    normal: "use the setpoint configured for your tank and operating mode. Higher temperatures generally use more energy and may require an electric heater. Disinfection temperature and schedule are installer settings that must follow the tank manual and local regulations.",
    de: { what: "Die Solltemperatur des Warmwasserspeichers oder Wärmespeichers. Der Regler lädt den Speicher, bis der zugehörige Fühler diesen Wert erreicht.",
          normal: "maßgeblich ist der Sollwert, der für deinen Speicher und die gewählte Betriebsart eingestellt wurde. Höhere Temperaturen benötigen meist mehr Energie und können einen elektrischen Heizer erfordern. Temperatur und Zeitplan der Desinfektion muss der Installateur passend zum Speicher und zu den örtlichen Vorschriften festlegen." } },
  { re: /2nd domestic hot water/i,
    what: "The reading from a second temperature sensor in the hot-water tank, for example the lower sensor in a tank with sensors at the top and bottom.",
    de: { what: "Der Messwert eines zweiten Temperaturfühlers im Warmwasserspeicher, zum Beispiel des unteren Fühlers bei einem Speicher mit Fühlern oben und unten." } },
  { re: /dhw tank temp|dhw tank/i,
    what: "The temperature reported by tank sensor R5T. Depending on the tank design, this is the domestic hot water or the water in a thermal store.",
    normal: "it normally rises during a tank-heating cycle and falls as heat or hot water is used. If it does not rise while the tank is being heated, compare it with the other tank sensors and the active heat source.",
    de: { what: "Die von Speicherfühler R5T gemeldete Temperatur. Je nach Speicherbauart ist das die Warmwassertemperatur oder die Temperatur des Wassers in einem Wärmespeicher.",
          normal: "sie steigt normalerweise während einer Speicherladung und fällt, wenn Wärme oder Warmwasser entnommen wird. Steigt sie während der Ladung nicht, vergleiche sie mit den anderen Speicherfühlern und der aktiven Wärmequelle." } },
  { re: /powerful dhw/i,
    what: "Powerful operation starts tank heating immediately and aims for the configured comfort or tank setpoint. Depending on the installation, an auxiliary heater may assist.",
    normal: "ON only while a manually requested boost is active. Daikin notes that frequent use consumes extra energy and can interrupt space heating for longer periods.",
    de: { what: "Der Hochleistungsbetrieb startet die Speicherladung sofort und heizt auf den eingestellten Komfort- oder Speicher-Sollwert. Je nach Anlage kann ein Zusatzheizer unterstützen.",
          normal: "nur ON, solange eine manuell angeforderte Schnellaufheizung läuft. Daikin weist darauf hin, dass häufiger Einsatz zusätzliche Energie benötigt und die Raumheizung länger unterbrechen kann." } },
  { re: /tank preheat/i,
    what: "The controller is preheating the tank before a configured demand or schedule so that hot water is available in time.",
    normal: "ON only during the configured preheating period; OFF otherwise.",
    de: { what: "Der Regler heizt den Speicher vor einem eingestellten Bedarf oder Zeitplan vor, damit rechtzeitig Warmwasser bereitsteht.",
          normal: "nur während der eingestellten Vorheizzeit ON, sonst OFF." } },
  { re: /reheat on/i,
    what: "Reheat operation raises the tank back to the configured reheat setpoint after it has cooled below the switch-on threshold. It can run on its own or in addition to a schedule, depending on the selected tank mode.",
    normal: "ON while the controller is reheating the tank; OFF once the reheat target is reached.",
    de: { what: "Die Nachheizfunktion lädt den Speicher wieder auf den eingestellten Nachheiz-Sollwert, nachdem die Einschaltschwelle unterschritten wurde. Je nach gewählter Speicher-Betriebsart arbeitet sie allein oder zusätzlich zu einem Zeitplan.",
          normal: "während des Nachheizens ON; nach Erreichen des Nachheiz-Sollwerts OFF." } },
  { re: /storage (eco|comfort)/i,
    what: "Which scheduled tank-temperature preset is active. Storage comfort uses the higher configured target; storage eco uses the lower target.",
    de: { what: "Welcher geplante Speicher-Sollwert aktiv ist. „Storage comfort“ verwendet den höher eingestellten Sollwert, „Storage eco“ den niedrigeren." } },
  { re: /boiler dhw demand/i,
    what: "In a hybrid system, the controller is requesting domestic-hot-water operation from the boiler. On systems with instantaneous hot water, a draw at the tap can trigger this request and takes priority over boiler space heating.",
    normal: "OFF when there is no boiler hot-water demand. The exact response depends on the hybrid configuration and country-specific installation.",
    de: { what: "In einem Hybridsystem fordert der Regler Warmwasserbetrieb vom Kessel an. Bei Anlagen mit direkter Warmwasserbereitung kann eine Zapfung diese Anforderung auslösen; sie hat dann Vorrang vor der Raumheizung durch den Kessel.",
          normal: "ohne Warmwasseranforderung an den Kessel OFF. Das genaue Verhalten hängt von der Hybrid-Konfiguration und der länderspezifischen Installation ab." } },

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
    what: "How far the mixing valve for a second heating zone is open. It blends hot flow water with cooler return water, for example to supply an underfloor-heating zone at a lower temperature.",
    normal: "moves between fully closed and fully open as needed to hold the second zone's target temperature.",
    de: { what: "Wie weit das Mischventil einer zweiten Heizzone geöffnet ist. Es mischt heißes Vorlaufwasser mit kühlerem Rücklauf, um zum Beispiel eine Fußbodenheizung mit niedrigerer Temperatur zu versorgen.",
          normal: "regelt je nach Bedarf zwischen ganz geschlossen und ganz geöffnet, um die Solltemperatur der zweiten Zone zu halten." } },

  // ── Leaving / return / mixed water ──
  { re: /(leaving water|lw) set ?point/i,
    what: "The leaving-water target for the selected heating or cooling mode. It may be fixed or determined by that mode's weather-dependent control settings.",
    normal: "Compare it only with the selected operating mode and its configured limits; heating and cooling use different target logic.",
    de: { what: "Die Soll-Austrittstemperatur für den gewählten Heiz- oder Kühlbetrieb. Sie kann fest sein oder aus den witterungsabhängigen Einstellungen der jeweiligen Betriebsart folgen.",
          normal: "Nur mit der gewählten Betriebsart und deren konfigurierten Grenzen vergleichen; Heizen und Kühlen verwenden unterschiedliche Sollwertlogik." } },
  { re: /mixed (leaving|water)/i,
    what: "Blended flow temperature of a mixed heating zone (after its mixing valve) — typically a cooler underfloor loop fed off a hotter primary circuit.",
    de: { what: "Gemischte Vorlauftemperatur einer Heizzone hinter ihrem Mischventil. Typisch ist ein kühlerer Fußbodenkreis, der aus einem heißeren Primärkreis gespeist wird." } },
  { re: /after buh|outlet water buh|after buffer|tvbh/i,
    what: "Water temperature after the electric backup heater, usually measured by sensor R2T. It is downstream of the heat pump's own heat exchanger and includes any temperature rise added by the backup heater, but is still inside the hydro module before the field-side 3-way valve and piping. It does not prove the temperature at the emitters.",
    normal: "close to the pre-heater temperature while the backup heater is off; higher only while the heater is adding heat. The water may then be routed to the space circuit or tank.",
    de: { what: "Wassertemperatur nach dem elektrischen Zusatzheizer, üblicherweise gemessen von Fühler R2T. Sie liegt hinter dem Wärmetauscher der Wärmepumpe und enthält den Temperaturanstieg durch den Zusatzheizer, befindet sich aber weiterhin in der Inneneinheit vor bauseitigem 3-Wege-Ventil und Rohrnetz. Sie belegt nicht die Temperatur an den Raumflächen.",
          normal: "bei Zusatzheizer OFF nahe an der Temperatur vor dem Heizer; höher nur, solange der Heizer Wärme ergänzt. Danach kann das Wasser zum Raumkreis oder Speicher geleitet werden." } },
  { re: /before buh|after phe|outlet water heat exch|leaving water.*\(?r1t\)?|tv inflow|outlet water heat exchanger/i,
    what: "Water leaving the heat pump's exchanger before the electric backup heater, usually measured by sensor R1T. With a running compressor it is above R4T in heating/DHW and below R4T in cooling. Together with R4T and flow it supports a mode-aware capacity estimate.",
    normal: "it should follow the active leaving-water target; permitted limits depend on model and emitter type. Interpret it with compressor state and operating mode: a hot value while Cooling is selected can be residual heat after DHW with the compressor stopped, not cooling supply temperature.",
    de: { what: "Wassertemperatur am Austritt des Wärmepumpen-Wärmetauschers vor dem elektrischen Zusatzheizer, üblicherweise gemessen von Fühler R1T. Bei laufendem Verdichter liegt sie beim Heizen bzw. bei Warmwasser über R4T, beim Kühlen unter R4T. Zusammen mit R4T und Durchfluss ermöglicht sie eine betriebsartabhängige Leistungsschätzung.",
          normal: "sie sollte dem aktiven Vorlauf-Sollwert folgen; die zulässigen Grenzen hängen von Modell und Heizflächenart ab. Nur zusammen mit Verdichterstatus und Betriebsart bewerten: Ein heißer Wert bei gewähltem Kühlen kann nach einer Warmwasserladung Restwärme bei stehendem Verdichter sein und ist dann keine Kühl-Vorlauftemperatur." } },
  { re: /inlet water|return water|tr return/i,
    what: "Water entering the PHE at sensor R4T on the common internal return after the branches merge. R1T minus R4T is the signed water-side ΔT across the PHE, not a direct emitter ΔT.",
    normal: "With active heating it is normally below R1T; with active cooling it is normally above R1T. Assess the difference only with flow, compressor state and operating mode known, and compare it with the model- and emitter-specific controller target rather than a universal 5 K rule.",
    de: { what: "Wasser am PHE-Eintritt R4T im gemeinsamen internen Rücklauf nach Zusammenführung der Zweige. R1T minus R4T ist das vorzeichenbehaftete wasserseitige ΔT am PHE und nicht direkt das ΔT der Raumflächen.",
          normal: "Beim aktiven Heizen liegt R4T normalerweise unter R1T, beim aktiven Kühlen darüber. Die Differenz nur bei bekanntem Durchfluss, Verdichterstatus und Betriebsmodus bewerten und mit dem modell- und heizflächenspezifischen Reglerziel statt einer allgemeinen 5-K-Regel vergleichen." } },

  // ── Flow / pressure / pump ──
  { re: /flow (sensor|rate)|flow rate/i,
    what: "How fast water is circulating through the common space-heating/cooling and DHW hydronic circuit.",
    normal: "compare it with the minimum flow rate in the installation manual for the exact model and operating mode. Daikin specifies different minima for heating, cooling, DHW and defrost. Low flow can cause a 7H error; common hydraulic causes include closed valves, air or a blocked filter.",
    de: { what: "Wie schnell das Wasser durch den gemeinsamen Heiz-/Kühl- und Warmwasser-Hydraulikkreis zirkuliert.",
          normal: "vergleiche den Wert mit dem Mindestdurchfluss in der Installationsanleitung des genauen Modells und der aktuellen Betriebsart. Daikin nennt unterschiedliche Mindestwerte für Heizen, Kühlen, Warmwasser und Abtauen. Zu wenig Durchfluss kann eine 7H-Störung auslösen; häufige hydraulische Ursachen sind geschlossene Ventile, Luft oder ein zugesetzter Filter." } },
  { re: /water pressure/i,
    what: "Water pressure in the sealed hydronic circuit.",
    normal: "roughly 1.0–2.0 bar when cold. Below ~0.5 bar needs topping up; a persistent low reading can stop the pump.",
    de: { what: "Wasserdruck im geschlossenen Hydraulikkreis.",
          normal: "kalt etwa 1,0–2,0 bar. Unter ~0,5 bar muss nachgefüllt werden; ein dauerhaft niedriger Wert kann die Pumpe stoppen." } },
  { re: /water pump signal/i,
    what: "The speed command sent to the circulation pump. Note it is inverted — 0 means full speed, 100 means stopped (per the label).",
    normal: "a low number (fast pump) while heating, cooling or making DHW; 100 (stopped) when idle.",
    de: { what: "Der Drehzahlbefehl an die Umwälzpumpe ist umgekehrt skaliert: 0 bedeutet volle Drehzahl, 100 bedeutet Stillstand.",
          normal: "eine niedrige Zahl und damit schnelle Pumpendrehzahl beim Heizen, Kühlen oder Warmwasserbereiten; 100 im Leerlauf." } },
  { re: /water pump operation|circulation pump|solar pump|main pump|add pump|pump speed/i,
    what: "Status or speed of a circulation pump. Depending on the label, it moves water through the space-heating circuit, tank circuit or solar circuit.",
    normal: "ON or running when its circuit needs flow; OFF when no circulation is requested. Depending on the installation, it can also run during air purge, frost protection, defrost support or a pump test.",
    de: { what: "Status oder Drehzahl einer Umwälzpumpe. Je nach Bezeichnung bewegt sie Wasser durch den Heizkreis, Speicherkreis oder Solarkreis.",
          normal: "ON beziehungsweise laufend, wenn ihr Kreis Durchfluss benötigt; OFF ohne Zirkulationsanforderung. Je nach Anlage kann sie auch beim Entlüften, Frostschutz, zur Unterstützung des Abtauens oder bei einem Pumpentest laufen." } },
  { re: /water flow switch/i,
    what: "A flow-proving switch in the water circuit. The controller uses it as a safety input before operating equipment that requires circulation.",
    normal: "ON when sufficient flow has been proven. A running pump does not guarantee this state if a valve is closed, air is present or the circuit is blocked.",
    de: { what: "Ein Durchflusswächter im Wasserkreis. Der Regler nutzt ihn als Sicherheitseingang, bevor Bauteile betrieben werden, die Wasserumlauf benötigen.",
          normal: "ON, wenn ausreichender Durchfluss bestätigt ist. Eine laufende Pumpe allein garantiert diesen Zustand nicht, etwa bei geschlossenem Ventil, Luft oder einer Verstopfung im Kreis." } },

  // ── Operation / mode / fault ──
  { re: /i\/u operation mode/i,
    what: "The controller's current operating mode for the water (indoor) side: Stop, Heating, Cooling, Domestic Hot Water, or a combination. The mode alone does not prove that the compressor is running or useful heating/cooling is being transferred.",
    normal: "Read it together with the activity line, compressor, pump, valve and temperatures. During a hot-water cycle it reads DHW even though the outdoor unit still shows Heating.",
    de: { what: "Die aktuelle Regler-Betriebsart der Wasserseite: Stopp, Heizen, Kühlen, Warmwasser oder eine Kombination. Die Betriebsart allein belegt weder einen laufenden Verdichter noch eine nutzbare Heiz- oder Kälteleistung.",
          normal: "Zusammen mit Aktivitätszeile, Verdichter, Pumpe, Ventil und Temperaturen lesen. Während eines Warmwasserzyklus steht hier Warmwasser, obwohl die Außeneinheit weiterhin Heizen anzeigt." } },
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
    what: "Emergency operation after a heat-pump fault. Depending on the configured emergency mode and the installation, an electric backup heater or a boiler can take over some or all space-heating and hot-water demand.",
    de: { what: "Notbetrieb nach einer Störung der Wärmepumpe. Je nach eingestelltem Notbetrieb und Anlagenaufbau kann ein elektrischer Zusatzheizer oder ein Kessel einen Teil oder den gesamten Heiz- und Warmwasserbedarf übernehmen." } },
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
    what: "Whether the indoor unit is currently asking the outdoor unit to run — Daikin's \"thermo ON\". It does not identify the load or prove compressor operation; use I/U mode, valve, compressor and pump together. \"Space heating Operation\" is normal space heat/cool operation, not a thermostat request.",
    normal: "ON while the unit runs, OFF while it is satisfied — for either load.",
    de: { what: "Ob die Inneneinheit gerade Betrieb der Außeneinheit anfordert — Daikins „Thermo ON\". Das Bit benennt weder die Last noch belegt es Verdichterbetrieb; I/U-Modus, Ventil, Verdichter und Pumpe gemeinsam auswerten. „Space heating Operation\" bedeutet normalen Raumheiz-/kühlbetrieb und ist keine Thermostatanforderung.",
          normal: "ON, solange das Gerät läuft, OFF, wenn der Bedarf gedeckt ist — für beide Lasten." } },
  { re: /space heating operation|space h operation/i,
    what: "Whether normal space heating/cooling operation is enabled or in operation. Despite the legacy catalog label, it is not heating-only and not a thermostat demand; the selected I/U mode and compressor/pump states say what is actually happening.",
    normal: "Can be ON in Cooling with the thermostat and compressor OFF, for example during controller-managed circulation.",
    de: { what: "Ob normaler Raumheiz-/kühlbetrieb freigegeben oder in Betrieb ist. Trotz der historischen Katalogbezeichnung ist der Wert weder heizungsexklusiv noch eine Thermostatanforderung; I/U-Modus sowie Verdichter- und Pumpenstatus zeigen die tatsächliche Aufgabe.",
          normal: "Kann im Modus Kühlen auch bei Thermostat OFF und stehendem Verdichter ON sein, etwa bei reglergeführter Umwälzung." } },
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
    what: "Inverter-heatsink protection. The unit reduces output when the power electronics approach their internal temperature limit. \"Drop Control\" is ON while limiting is active; \"Retry Qty\" is the small retry counter. The separate \"INV fin temp.\" row is the temperature itself.",
    normal: "OFF / 0 when this protection is not intervening. Repeated activity should be checked with heatsink temperature, ambient conditions and airflow around the outdoor unit.",
    de: { what: "Schutz des Inverter-Kühlkörpers. Das Gerät reduziert die Leistung, wenn sich die Leistungselektronik ihrer internen Temperaturgrenze nähert. „Drop Control“ ist während der Begrenzung ON; „Retry Qty“ ist der kleine Wiederholungszähler. Die separate Zeile „INV fin temp.“ zeigt die Temperatur selbst.",
          normal: "OFF / 0, solange dieser Schutz nicht eingreift. Wiederholte Aktivität sollte zusammen mit Kühlkörpertemperatur, Umgebungsbedingungen und Luftweg der Außeneinheit geprüft werden." } },
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
    what: "Water temperature at the inlet or outlet of the plate heat exchanger that transfers heat between refrigerant and the water circuit.",
    de: { what: "Wassertemperatur am Ein- oder Austritt des Plattenwärmetauschers, der Wärme zwischen Kältemittel und Wasserkreis überträgt." } },
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
  { re: /injection tube/i,
    what: "Temperature on the refrigerant-injection line. The outdoor unit uses it internally to control compressor injection and protect the refrigerant cycle.",
    de: { what: "Temperatur an der Kältemittel-Einspritzleitung. Die Außeneinheit nutzt sie intern zur Regelung der Verdichtereinspritzung und zum Schutz des Kältekreises." } },
  { re: /2 phase thermistor/i,
    what: "Temperature measured in a part of the refrigerant circuit containing both liquid and vapour. It is an internal control input, not a user setpoint.",
    de: { what: "Temperatur in einem Abschnitt des Kältekreises, der Flüssigkeit und Dampf enthält. Sie ist ein interner Regelwert und kein Sollwert für den Nutzer." } },
  { re: /r4t-deicer/i,
    what: "Temperature from the outdoor coil's de-icer sensor. The outdoor unit uses it as one input when deciding whether frost protection or defrosting is needed.",
    de: { what: "Temperatur des Enteiser-Fühlers am Außenwärmetauscher. Die Außeneinheit verwendet sie als einen Eingang für die Entscheidung über Frostschutz und Abtauen." } },
  { re: /(high|low) pressure ?\(?(sat|t)/i,
    what: "High- or low-side refrigerant pressure converted to saturation temperature: the boiling or condensing temperature corresponding to that pressure for the configured refrigerant.",
    de: { what: "Auf Sättigungstemperatur umgerechneter Hoch- oder Niederdruck des Kältemittels: die Siede- beziehungsweise Kondensationstemperatur, die bei diesem Druck für das eingestellte Kältemittel gilt." } },
  { re: /(high|low) pressure/i,
    what: "Refrigerant pressure on the high (compressor discharge) or low (compressor suction) side. The gap between them is what the compressor works against, and it drives efficiency.",
    normal: "varies with outdoor temperature and load; steady during stable running.",
    de: { what: "Kältemitteldruck auf der Druck- oder Saugseite des Verdichters. Die Differenz zwischen Hoch- und Niederdruck bestimmt, wogegen der Verdichter arbeitet, und beeinflusst die Effizienz.",
          normal: "variiert mit Außentemperatur und Last; im stabilen Betrieb gleichmäßig." } },
  { re: /compressor speed|inv frequency|frequency \(rps\)/i,
    what: "How fast the inverter-driven compressor is spinning, in revolutions per second. This is the unit's main output control.",
    normal: "0 when stopped and modulating while running. The permitted range is model-specific; a higher speed generally means the controller is requesting more compressor output, but it is not a direct heat-output measurement.",
    de: { what: "Wie schnell der invertergeregelte Verdichter dreht, in Umdrehungen pro Sekunde. Das ist die wichtigste Leistungsstellgröße des Geräts.",
          normal: "0 im Stillstand und im Betrieb geregelt. Der zulässige Bereich ist modellspezifisch; eine höhere Drehzahl bedeutet meist, dass der Regler mehr Verdichterleistung anfordert, ist aber keine direkte Messung der Wärmeleistung." } },
  { re: /expansion valve/i,
    what: "Commanded position of an electronic expansion valve, reported in motor steps or pulses. The valve regulates refrigerant flow and the pressure drop into the evaporating side; the number is not an opening percentage or a direct mass-flow reading.",
    normal: "adjusts while the compressor runs and can move to a control-specific position when stopped or during defrost. Compare it only with the same valve on the same model and operating mode.",
    de: { what: "Vorgegebene Stellung eines elektronischen Expansionsventils, angegeben in Motorschritten oder Impulsen. Das Ventil regelt Kältemittelstrom und Druckabfall zur Verdampferseite; der Wert ist weder ein Öffnungsprozentsatz noch eine direkte Massenstrommessung.",
          normal: "wird bei laufendem Verdichter nachgeregelt und kann im Stillstand oder beim Abtauen eine regelungsabhängige Stellung anfahren. Vergleiche den Wert nur mit demselben Ventil bei gleichem Modell und gleicher Betriebsart." } },
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
    normal: "depends on model, operating mode and configured emitter type. Daikin manuals show variable targets as well as fixed values such as 8 or 10 K; compare the measured ΔT with this target rather than with a universal 5 K rule.",
    de: { what: "Die vom Regler angestrebte Temperaturdifferenz ΔT zwischen Vor- und Rücklauf.",
          normal: "hängt von Modell, Betriebsart und eingestellter Heizflächenart ab. Daikin-Handbücher nennen variable Ziele ebenso wie feste Werte von beispielsweise 8 oder 10 K; vergleiche das gemessene ΔT mit diesem Ziel statt mit einer allgemeinen 5-K-Regel." } },
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
    what: "Mains current reported for one phase (L1/L2/L3) by a current transformer (CT). The UI adds the available phase currents and multiplies by an assumed 230 V to obtain a rough electrical-input estimate.",
    normal: "depends on supply layout and which loads the CTs cover. The derived kW value is not a calibrated energy meter and ignores power factor and actual line voltage.",
    de: { what: "Vom Stromwandler (CT) gemeldeter Netzstrom einer Phase (L1/L2/L3). Die UI addiert die verfügbaren Phasenströme und multipliziert sie mit angenommenen 230 V, um die elektrische Aufnahme grob zu schätzen.",
          normal: "hängt von Netzform und den durch die Stromwandler erfassten Verbrauchern ab. Der abgeleitete kW-Wert ist kein geeichter Energiezähler und berücksichtigt weder Leistungsfaktor noch tatsächliche Netzspannung." } },
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
    normal: "0 while no backup-heater stage is active. A higher step can be requested for low-temperature support, defrost, DHW, disinfection or emergency operation, depending on the model and settings.",
    de: { what: "Welche Leistungsstufen des elektrischen Zusatzheizers aktiv sind.",
          normal: "0, solange keine Zusatzheizerstufe aktiv ist. Je nach Modell und Einstellungen kann eine höhere Stufe bei niedriger Außentemperatur, zur Unterstützung des Abtauens, für Warmwasser, Desinfektion oder im Notbetrieb angefordert werden." } },
  { re: /buh step/i,
    what: "An electric resistance-heater stage in the hydronic unit. It adds heat directly to the water when the controller permits or requests auxiliary heat.",
    normal: "OFF when no auxiliary heat is required. Legitimate reasons for ON include low-temperature support, defrost, DHW, disinfection and emergency operation; the exact permission and balance temperatures are installer settings.",
    de: { what: "Eine elektrische Widerstandsheizer-Stufe in der Hydraulikeinheit. Sie gibt Wärme direkt an das Wasser ab, wenn die Regelung Zusatzwärme erlaubt oder anfordert.",
          normal: "OFF, solange keine Zusatzwärme benötigt wird. Zulässige Gründe für ON sind unter anderem Unterstützung bei niedriger Außentemperatur, Abtauen, Warmwasser, Desinfektion und Notbetrieb; Freigaben und Gleichgewichtstemperaturen stellt der Installateur ein." } },
  { re: /^booster heater run$/i,
    exact: true,
    what: "The HomeHub's ON/OFF readback for the electric immersion heater in the domestic-hot-water tank (input register 32). It reports use, not power. Input register 51 is the measured electrical input of the whole heat-pump system and cannot be relabelled as the heater's own power.",
    normal: "OFF while the tank heater is not active; ON means the controller reports the immersion heater running.",
    de: { what: "Die ON/OFF-Rückmeldung des HomeHub für den elektrischen Tauchheizer im Warmwasserspeicher (Eingangsregister 32). Sie meldet den Einsatz, nicht die Leistung. Eingangsregister 51 ist die gemessene elektrische Gesamtaufnahme der Wärmepumpenanlage und darf nicht als eigene Heizstableistung bezeichnet werden.",
          normal: "OFF, solange der Speicherheizstab nicht aktiv ist; ON bedeutet, dass die Regelung den laufenden Heizstab meldet." } },
  { re: /^bsh$/i,
    what: "The electric immersion heater in the domestic-hot-water tank. It can heat the tank without the compressor or water circulation pump running. X10A reports BSH only as ON/OFF; HomeHub input register 32 provides the same run state. Neither source carries dedicated heater power, and HomeHub input 51 is whole-system electrical input only.",
    normal: "OFF while the tank heater is not requested. Depending on the configuration it can be ON for powerful DHW, scheduled assistance, disinfection or emergency operation.",
    de: { what: "Der elektrische Tauchheizer im Warmwasserspeicher. Er kann den Speicher erwärmen, ohne dass Verdichter oder Wasserpumpe laufen. X10A meldet BSH nur als ON/OFF; HomeHub-Eingangsregister 32 liefert denselben Laufzustand. Keine der Quellen enthält eine eigene Heizstableistung, und HomeHub-Eingang 51 ist nur die elektrische Gesamtaufnahme.",
          normal: "OFF, solange der Speicherheizer nicht angefordert ist. Je nach Konfiguration kann er für Warmwasser-Hochleistungsbetrieb, geplante Unterstützung, Desinfektion oder Notbetrieb ON sein." } },
  { re: /thermal protector/i,
    what: "The thermal cut-out that protects an electric heater from overheating.",
    normal: "normal/closed in regular operation; it trips only on an over-temperature fault.",
    de: { what: "Die thermische Schutzabschaltung, die einen elektrischen Heizer vor Übertemperatur schützt.",
          normal: "im regulären Betrieb normal/geschlossen; sie löst nur bei Übertemperatur aus." } },
  { re: /freeze protection/i,
    what: "Anti-freeze protection: the unit runs the pump (and if needed the heater) to stop water in the pipes freezing while it's otherwise idle in the cold.",
    normal: "ON when the controller has activated water-circuit frost protection. Exact start conditions and which heat source assists are model- and configuration-specific; power must remain available for this protection to work.",
    de: { what: "Frostschutz: Das Gerät lässt die Pumpe und bei Bedarf auch den Heizer laufen, damit das Wasser in den Leitungen bei Kälte nicht einfriert.",
          normal: "ON, wenn der Regler den Frostschutz des Wasserkreises aktiviert hat. Die genauen Einschaltbedingungen und die unterstützende Wärmequelle hängen von Modell und Konfiguration ab; damit der Schutz funktioniert, muss die Stromversorgung ON bleiben." } },

  // ── Geothermal / brine ──
  { re: /brine (inlet|outlet|temp|pump)|entering brine|leaving brine/i,
    what: "Ground-loop (brine) circuit reading on a geothermal unit — the fluid that carries heat to/from the ground, and its pump.",
    normal: "compare inlet and outlet temperatures with the ground-loop design and the operating limits in the exact unit manual. Seasonal change is expected; the permitted fluid type, concentration, pressure and temperature range are installation-specific.",
    de: { what: "Messwert des erdseitigen Solekreises einer Erdwärmepumpe. Erfasst werden die Flüssigkeit, die Wärme aus dem Erdreich aufnimmt oder dorthin abgibt, und ihre Pumpe.",
          normal: "vergleiche Ein- und Austrittstemperatur mit der Auslegung des Erdkreises und den Betriebsgrenzen der genauen Geräteanleitung. Saisonale Änderungen sind zu erwarten; zulässiges Medium, Konzentration, Druck und Temperaturbereich hängen von der Installation ab." } },

  // ── Hybrid / second source / smart grid ──
  { re: /hybrid (op|heating)/i,
    what: "On a hybrid heat-pump + boiler system: which source the controller has chosen (heat pump only, hybrid, or boiler only) and its target.",
    de: { what: "Bei einem Hybridsystem aus Wärmepumpe und Kessel zeigt der Wert die gewählte Quelle und ihren Zielwert: reine Wärmepumpe, Hybridbetrieb oder reiner Kesselbetrieb." } },
  { re: /bivalent|boiler operation|boiler heating target/i,
    what: "Status or target for a second heat source, usually a boiler. In a bivalent setup it follows configured changeover temperatures and demand; a Daikin hybrid can additionally optimise the choice for energy cost or primary-energy use.",
    de: { what: "Status oder Sollwert einer zweiten Wärmequelle, meist eines Kessels. In einer bivalenten Anlage folgt sie den eingestellten Umschalttemperaturen und dem Bedarf; ein Daikin-Hybridsystem kann die Wahl zusätzlich nach Energiekosten oder Primärenergieeinsatz optimieren." } },
  { re: /be_cop|^cop\b/i,
    what: "The unit's own live estimate of its coefficient of performance — heat delivered ÷ electricity used. Higher is more efficient (3 means 3 kW of heat per 1 kW of power).",
    normal: "depends on source temperature, leaving-water temperature, load and which electrical consumers are included. Use it as an instantaneous estimate, not a universal pass/fail range; metered seasonal energy gives a more meaningful efficiency figure.",
    de: { what: "Die geräteeigene Live-Schätzung der Leistungszahl: gelieferte Wärme geteilt durch aufgenommene elektrische Leistung. Ein höherer Wert ist effizienter; 3 bedeutet 3 kW Wärme je 1 kW Strom.",
          normal: "hängt von Quellentemperatur, Vorlauftemperatur, Last und den einbezogenen Stromverbrauchern ab. Nutze den Wert als Momentanschätzung, nicht als allgemeingültigen Gut-/Schlecht-Bereich; aussagekräftiger ist die saisonale Effizienz aus gemessener Energie." } },
  { re: /benefit kwh|smartgrid|smart grid|solar input/i,
    what: "An external utility, Smart Grid or solar input. Depending on the configured contact combination, it can restrict operation or request/recommend additional heat storage; the label alone does not identify the configured action.",
    normal: "ON only while the corresponding external contact is active. Check the Smart Grid or preferential-tariff configuration to learn what ON means on this installation.",
    de: { what: "Ein externer Versorger-, Smart-Grid- oder Solareingang. Je nach eingestellter Kontaktkombination kann er den Betrieb sperren oder zusätzliche Wärmespeicherung anfordern beziehungsweise empfehlen; die Bezeichnung allein nennt die konfigurierte Wirkung nicht.",
          normal: "nur ON, solange der zugehörige externe Kontakt aktiv ist. Prüfe die Smart-Grid- oder Niedrigtarif-Konfiguration, um die Bedeutung von ON in dieser Anlage zu kennen." } },

  // ── Capacity / identity (put after BUH-capacity above) ──
  { re: /capacity/i,
    what: "The nominal rated capacity/size class of the unit (indoor or outdoor), in kW or as a code. It's a fixed property of the model, not a live measurement.",
    de: { what: "Die Nennleistung oder Größenklasse der Innen- oder Außeneinheit, angegeben in kW oder als Code. Sie ist eine feste Eigenschaft des Modells und kein Live-Messwert." } },
  { re: /silent mode|low noise/i,
    what: "Low-noise / quiet mode reduces outdoor-unit sound according to the selected quiet level. The available heating or cooling capacity can fall while it is active.",
    normal: "ON when a quiet level is active, whether manually, by schedule or by an installer restriction. Daikin notes that quiet mode reduces available heating/cooling capacity.",
    de: { what: "Der Geräuscharm-/Leise-Modus senkt den Schallpegel der Außeneinheit entsprechend der gewählten Stufe. Dabei kann die verfügbare Heiz- oder Kühlleistung sinken.",
          normal: "ON, wenn eine Leise-Stufe aktiv ist — manuell, per Zeitplan oder durch eine Installateurbegrenzung. Daikin weist darauf hin, dass der Leise-Modus die verfügbare Heiz-/Kühlleistung reduziert." } },
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
  { exact: true, re: /^compressor running$/i,
    what: "Whether the HomeHub currently reports the heat-pump compressor running. This is the activity witness the Modbus-only schematic uses to distinguish active heat transfer from pump-only circulation; it does not report compressor speed or capacity.",
    normal: "ON while the compressor is running; OFF while it is stopped. Interpret it together with DHW/space operation, valve position, flow and water temperatures.",
    de: { what: "Ob der HomeHub den Verdichter der Wärmepumpe aktuell als laufend meldet. Im reinen Modbus-Schema unterscheidet dieser Aktivitätsnachweis einen aktiven Wärmeübergang von reinem Pumpenumlauf; Verdichterdrehzahl oder -leistung enthält er nicht.",
          normal: "ON bei laufendem Verdichter, OFF bei Stillstand. Gemeinsam mit Warmwasser-/Raumbetrieb, Ventilstellung, Durchfluss und Wassertemperaturen auswerten." } },
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
    what: "Low-noise operation reduces outdoor-unit sound according to the configured quiet level. The available heating or cooling capacity can fall while it is active.",
    normal: "ON = quiet mode active; OFF = inactive. It can be selected manually, by schedule or by an installer restriction. If demand is not met while it is ON, the reduced available capacity is relevant context.",
    de: { what: "Der Leisebetrieb senkt den Schallpegel der Außeneinheit entsprechend der eingestellten Stufe. Dabei kann die verfügbare Heiz- oder Kühlleistung sinken.",
          normal: "ON = Leisebetrieb aktiv; OFF = inaktiv. Er kann manuell, per Zeitplan oder durch eine Installateurbegrenzung aktiviert werden. Wird der Bedarf bei ON nicht erreicht, ist die verringerte verfügbare Leistung ein wichtiger Zusammenhang." } },
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
// Is the HomeHub runtime task running AND connected? Both matter: an empty saved address leaves no
// live HomeHub source, and then nothing Modbus is shown anywhere.
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
  // The tank heater is an exact state pair rather than a numeric pill in MB_PAIRS. When the X10A
  // BSH row is absent/silent, its inspector still needs HomeHub input 32 as the named source.
  if (key === "bsh") return mbByConcept("bsh_state");
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

// Inspector wording for the four-value enum. The closed BOOST pill intentionally keeps only its
// stable name; the exact state is written in the inspector and in the target's accessible name.
const sgModeText = (mode) => mode == null ? "—" : t(`sg.mode${mode}`);

// ── WHICH SOURCE ANSWERS A PLANT STATE ─────────────────────────────────────────────────────────
// One rule, one place. X10A leads while its link is LIVE and carries the row; otherwise a LIVE
// gateway answers; otherwise nobody does and the caller blanks.
//
// This exists because the rule was written out three times — for the valve, the pump and the
// space-operation state — and the three had already drifted into three different behaviours. The
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
// borrowing the other source's unit word would quietly assert the two are identically scaled.
// `displayUnit` only canonicalises spelling (not scale), so the legacy X10A `l/min` and HomeHub
// `L/min` forms no longer create a purely typographic mismatch. Returns "" with no twin, with no
// X10A value to complement, and on every device without a HomeHub — so an unpaired row keeps
// precisely the explainer it had before.
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
  const unit = displayUnit(mb);
  return `<div class="mb-line">` +
    `<span>${esc(displayHomeHubLabel(mb))} ` +
      `<span class="mb-tag">${esc(t("src.modbus_tag"))}</span></span>` +
    `<span>${esc(displayValue(mb))}${unit ? " " + esc(unit) : ""}</span></div>`;
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
  const head = dv < 0.05 ? t("src.agree") : t("src.delta", fmt1(dv), displayUnit(row));
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
