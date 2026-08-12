# Anlagendiagnose einfach erklärt

<!-- user-docs-contract: 103d9ea4da700d26a32e16f077a0db71bf601424660db1e1520206f69e57e2a1 -->
<!-- user-docs: health_guide -->

Diese Seite richtet sich an Menschen, die ihre Wärmepumpe verstehen möchten, ohne Heizungsfachleute
zu sein. Die Diagnose läuft automatisch auf dem ESP32. Sie **liest** Messwerte und zählt Ereignisse;
sie verändert keine Einstellung und steuert die Wärmepumpe nicht.

Zu jeder Prüfung gibt es zusätzlich eine [Beleg- und Grenzmatrix](DIAGNOSTIC_EVIDENCE.md). Dort steht
nachprüfbar, welche Aussage aus Daikin-Unterlagen oder Primärforschung stammt, welche Schwelle nur
eine Projekt-Heuristik ist und was die Messung ausdrücklich nicht beweisen kann.

In der Weboberfläche steht die Karte **„Anlagendiagnose · 24 h“** direkt unter dem Anlagenschema.
Tippe eine Zeile an, um Messwert, Bewertung, normale Einordnung und einen Handlungshinweis zu sehen.

## Was die Wörter bedeuten

| Anzeige | Bedeutung für dich |
|---------|--------------------|
| **OK** | Für genau diese Prüfung lagen genug Daten vor, und darin wurde nichts Auffälliges gefunden. Das ist kein Gesundheitszeugnis für die gesamte Anlage. |
| **HINWEIS** | Etwas ist auffällig oder wissenswert. Beobachten und den erklärenden Text lesen; das ist noch kein Defektnachweis. |
| **WARNUNG** | Die Wärmepumpe meldet selbst einen Fehler oder eine dokumentierte Grenze wurde länger verletzt. Zeitnah prüfen. |
| **PRÜFT** | Es fehlen noch genügend Stunden oder verwertbare Messwerte. Warten ist hier die richtige Reaktion. |
| **NUR MESSWERT** | Der Wert ist nützlich, aber ohne Gerätemodell und Betriebszustand gibt es keine seriöse allgemeine Gut-/Schlecht-Grenze. |
| **EXPERIMENTELL** | Das Signal ist noch nicht ausreichend durch Herstellerunterlagen abgesichert. Es ist eine Spur, kein Urteil. |
| **NICHT VERFÜGBAR** | Das erkannte Anlagenprofil liefert die nötigen Daten nicht, oder diese Prüfung kann bei diesem Betriebsablauf nicht zuverlässig abgeschlossen werden. |

Die meisten Entwarnungen brauchen ein vollständiges 24-Stunden-Fenster und mindestens 90 % lesbare
Daten des jeweils benötigten Signals. Nach einer Änderung des Diagnoseformats beginnt das Fenster
neu. Deshalb ist **PRÜFT** nach einem Update normal.

Öffne in der Karte zuerst **„So liest du diese Karte“**. Unter **„Datenfenster“** steht, warum frühere
Diagnosedaten bei diesem Start übernommen oder verworfen wurden. Bei einem gewöhnlichen Neustart mit
durchgehendem Strom bleiben sie normalerweise erhalten. Nach einer Stromunterbrechung beginnt die
Diagnose dagegen neu, denn ihr 24-Stunden-Fenster liegt derzeit nur im stromerhaltenen RAM und nicht
in einem Flash-Archiv. Auch ein Firmware-Update muss es verwerfen, wenn sich die Bedeutung oder
Struktur der gespeicherten Zähler geändert hat.

Die gespeicherten 5-Minuten-Verläufe sind davon getrennt. Sie halten pro Zeitfenster nur den letzten
Messwert beziehungsweise einen verdichteten Ereigniszustand. Daraus lassen sich sekundengenaue
Verdichterstarts, die Betriebsart eines vollständigen Laufs oder eine ungestörte Warmwasserstunde
nicht zuverlässig wiederherstellen. Sie werden deshalb nicht nachträglich als Diagnosebeleg
ausgegeben.

## Was wird geprüft?

<!-- user-docs: health_fault -->
### Störung der Anlage

**Einfach gesagt:** Die Diagnose merkt sich, ob die Wärmepumpe selbst einen Fehler, eine Warnung oder
eine Vorsichtsmeldung meldet. Auch eine inzwischen verschwundene Meldung bleibt bis zu 24 Stunden
sichtbar.

**Was du tun kannst:** Bei **WARNUNG** zuerst unter **Betrieb** den Fehlercode öffnen und notieren.
Bedienungsanleitung oder Daikin-Serviceunterlagen nennen die Bedeutung. Bei einer einmaligen,
verschwundenen Meldung zunächst beobachten; bei Wiederholung Zeitpunkt, Betriebsart und Code für den
Fachbetrieb festhalten.

**Belege und Grenzen:** [Gerätestörung](DIAGNOSTIC_EVIDENCE.md#1-störung-der-anlage-fault)

<!-- user-docs: health_dhw_loss -->
### Wärmeverlust Warmwasserspeicher

**Einfach gesagt:** Die Diagnose sucht ruhige Stunden, in denen der Speicher weder geladen noch
offensichtlich durch eine Zapfung beeinflusst wurde. Dann misst sie, wie schnell die Temperatur im
Speicher fällt. Eine optional gemessene Zirkulationspumpe hilft zu erklären, ob sie Wärme aus dem
Speicher transportiert hat.

**Welchen Bereich kann sie beurteilen?** Ab **0,8 K/h** erscheint ein **HINWEIS**. Das ist eine
Projekt-Heuristik aus einer Referenzanlage und kein Daikin-Grenzwert. Der Wert ist nicht einfach auf
andere Speicher übertragbar: Speichervolumen und der Temperaturunterschied zwischen warmem Speicher
und Aufstellraum verändern die Abkühlrate. Das Verfahren kann auffällige bereinigte Stunden nur bis
etwa **1,85 K/h** sicher erkennen. Bei noch schnellerem kontinuierlichem Verlust kann der
Temperaturabfall wie eine Zapfung aussehen; das Fenster wird dann verworfen.

**Was bedeuten OK und NICHT VERFÜGBAR hier?** **OK** heißt nur, dass in den auswertbaren ruhigen
Stunden kein Verlust im erkennbaren Band ab 0,8 K/h gefunden wurde. Es schließt einen schnelleren
Dauerverlust nicht aus. **NICHT VERFÜGBAR** nach vielen verworfenen Fenstern sagt ebenfalls nicht,
welche Ursache überwog: Ladung, Pumpenlauf, Zapfung, unlesbare Daten und ein wie Zapfung aussehender
Dauerverlust können mit den gespeicherten Summen nicht sicher auseinandergehalten werden.

**Was das Ergebnis nicht beweist:** Ein schneller Temperaturabfall beweist allein weder ein undichtes
Ventil noch schlechte Dämmung. Der Sensor misst nur an einer Stelle im geschichteten Speicher;
Warmwasserentnahme und natürliche Zirkulation können ähnlich aussehen.

**Was du tun kannst:** Bei wiederholtem **HINWEIS** zuerst Laufzeiten und Zeitplan der
Warmwasser-Zirkulationspumpe prüfen. Beobachte, ob der Hinweis auch ohne Zapfung und bei sicher
ausgeschalteter Zirkulationspumpe bleibt. Erst dann lohnt sich eine Prüfung durch den Fachbetrieb.

**Belege und Grenzen:**
[Wärmeverlust Warmwasserspeicher](DIAGNOSTIC_EVIDENCE.md#2-wärmeverlust-warmwasserspeicher-dhw_loss)

<!-- user-docs: health_cycling -->
### Verdichterstarts

Der **Verdichter** ist der Kompressor der Wärmepumpe. Ein Lauf beginnt beim Einschalten und endet beim
Ausschalten.

**Einfach gesagt:** Viele sehr kurze Heizläufe können bedeuten, dass die Wärmepumpe ihre Wärme nicht
lange genug an das Haus abgeben kann. Die Diagnose trennt vollständige Läufe nach Möglichkeit in
**Raumheizung**, **Warmwasser** und **Kühlen**. Nur bestätigte Raumheizung wird für den Hinweis auf
kurze Heizläufe bewertet. So kann ein langer Warmwasserlauf kurze Heizläufe nicht schönrechnen.

Beispiel:

```text
17 Starts · Raum 16 × 5 min · Warmwasser 1 × 2 h
```

Das bedeutet: 17 Verdichterstarts insgesamt; 16 vollständige Heizläufe dauerten im Mittel fünf
Minuten, ein Warmwasserlauf zwei Stunden. **„Kühlen … ausgeschlossen“** heißt, dass diese Läufe
erkannt, aber nicht als Heizen bewertet wurden. **„… ohne Zuordnung“** heißt, dass eine Umschaltung
oder Messlücke keine sichere Zuordnung erlaubte.

**Wann erscheint ein Hinweis?** Als vorsichtige Projekt-Heuristik bei mindestens zwölf bestätigten
Heizläufen mit durchschnittlich weniger als zehn Minuten. Das ist kein Daikin-Grenzwert und nicht
automatisch ein Defekt.

**Was du tun kannst:** Mehrere Tage beobachten und Außentemperatur sowie Betriebsart beachten.
Prüfen, ob viele Raumthermostate oder Heizkreise geschlossen sind und ob Zeitprogramme den
Heizbetrieb häufig unterbrechen. Einstellungen nicht nur wegen eines einzelnen Tages ändern. Bleibt
das Muster bestehen, kann der Fachbetrieb Heizkurve, Wasserdurchfluss und hydraulischen Abgleich
gezielt prüfen.

**Belege und Grenzen:** [Verdichterstarts](DIAGNOSTIC_EVIDENCE.md#3-verdichterstarts-cycling)

<!-- user-docs: health_defrost -->
### Abtauvorgänge

Bei kaltem, feuchtem Wetter kann der Außenwärmetauscher vereisen. Die Wärmepumpe taut ihn dann kurz
ab; das ist grundsätzlich normal.

**Einfach gesagt:** Die Diagnose zählt Abtauvorgänge und berechnet, welcher Anteil der gleichzeitig
beobachteten Verdichterlaufzeit dafür verwendet wurde. Ein höherer Anteil ist nur ein Hinweis, weil
X10A weder Luftfeuchte noch die Oberflächentemperatur des Wärmetauschers liefert.

**Wann erscheint ein Hinweis?** Als Projekt-Heuristik bei mindestens drei auswertbaren
Abtauvorgängen und mehr als 15 % Abtauzeit an der gleichzeitig beobachteten Verdichterlaufzeit. Das
ist kein Daikin-Grenzwert.

**Was du tun kannst:** Wetter und Außengerät ansehen. Schnee, Laub oder Gegenstände dürfen Luftweg
und Wasserablauf nicht blockieren. Häufiges Abtauen bei nasskaltem Wetter kann normal sein; bei
mildem, trockenem Wetter oder sichtbarer dauerhafter Vereisung den Fachbetrieb fragen.

**Belege und Grenzen:** [Abtauvorgänge](DIAGNOSTIC_EVIDENCE.md#4-abtauvorgänge-defrost)

<!-- user-docs: health_pressure -->
### Wasserdruck, niedrigster

**Einfach gesagt:** Angezeigt wird der niedrigste gültige Wasserdruck im beobachteten Zeitraum. Bei
höchstens 1,0 bar erscheint ein Hinweis, nach 60 Sekunden durchgehend niedrigem Druck eine Warnung.

**Was du tun kannst:** Den zulässigen Bereich in der Anleitung des genauen Geräts prüfen. Nicht
blind nachfüllen: Wiederholt fallender Druck kann auf Luft, ein Ausdehnungsgefäßproblem oder
Wasserverlust hindeuten und gehört zum Fachbetrieb. Bei akutem Gerätefehler die Anlagenanleitung
befolgen.

**Belege und Grenzen:** [Wasserdruck](DIAGNOSTIC_EVIDENCE.md#5-wasserdruck-niedrigster-pressure)

<!-- user-docs: health_flow -->
### Durchfluss, niedrigster

**Einfach gesagt:** Die Diagnose zeigt den niedrigsten Wasserdurchfluss, nachdem die interne Pumpe
mindestens 60 Sekunden lief. Werte beim Pumpenstart und bei stillstehender Pumpe werden bewusst
nicht verwendet.

**Warum steht dort nur Messwert?** Der notwendige Durchfluss hängt von Gerätemodell und Betriebsart
ab: Heizen, Kühlen, Warmwasser und Abtauen brauchen nicht denselben Wert. Angezeigt wird ein
beobachtetes **Teillast-Minimum** der modulierenden Pumpe. Das ist nicht der Nenn- oder
Auslegungsdurchfluss, der in einer Anleitung für einen anderen Betriebspunkt stehen kann.

**Was du tun kannst:** Nicht direkt mit dem Nenndurchfluss vergleichen. Nur einen Mindestwert aus der
genauen Installationsanleitung heranziehen, wenn er für dieselbe Betriebsart und Bedingung gilt. Ein
einzelner niedriger Wert ohne Gerätefehler ist noch keine Diagnose. Bei wiederholter Unterschreitung
dieses passenden Minimums oder einer Durchflussstörung sollte der Fachbetrieb Filter, Ventile,
Pumpeneinstellung und Hydraulik prüfen.

**Belege und Grenzen:** [Durchfluss](DIAGNOSTIC_EVIDENCE.md#6-durchfluss-niedrigster-flow)

<!-- user-docs: health_heater -->
### Zusatzheizer

**Einfach gesagt:** Die Diagnose zählt getrennt, wie lange der elektrische Zusatzheizer für den
Heizkreis (**BUH**) und der elektrische Heizstab im Warmwasserspeicher (**BSH**) liefen.

**Was du tun kannst:** Laufzeit zusammen mit Wetter, Warmwasserprogramm, Abtauung, Notbetrieb und
eventueller PV-Überschusssteuerung betrachten. Ein kurzer Einsatz kann gewollt sein. Unerwartet
häufige oder lange Laufzeit ist ein Anlass, Einstellungen und Anlagenleistung prüfen zu lassen, aber
für sich allein kein Defektnachweis.

**Belege und Grenzen:** [Zusatzheizer](DIAGNOSTIC_EVIDENCE.md#7-zusatzheizer-heater)

<!-- user-docs: health_retries -->
### Schutz-Rückregelungen

**Einfach gesagt:** Die Diagnose beobachtet fünf interne Zähler, die auf Schutz- oder
Leistungsbegrenzungen hindeuten können. Nur ein sicher beobachteter Anstieg zählt. Die genaue
Herstellerbedeutung der Zähler ist nicht vollständig dokumentiert; deshalb ist diese Zeile
**EXPERIMENTELL**.

**Was du tun kannst:** Ein einzelner Anstieg erfordert normalerweise keine Handlung. Bei wiederholten
Anstiegen zusammen mit schlechter Leistung, ungewöhnlichen Geräuschen oder Fehlercodes Zeitpunkt und
Betriebszustand notieren und dem Fachbetrieb zeigen.

**Belege und Grenzen:**
[Schutz-Rückregelungen](DIAGNOSTIC_EVIDENCE.md#8-schutz-rückregelungen-retries)

## Was die Diagnose nicht kann

Die Karte erkennt nicht zuverlässig:

- Kältemittelmangel, verschmutzte Filter oder mechanischen Verschleiß,
- einen korrekten hydraulischen Abgleich,
- die Ursache jedes hohen Verbrauchs,
- die Effizienz über eine Heizsaison,
- den Zustand aller Sensoren oder Ventile.

**OK bedeutet daher immer:** In den vorhandenen Daten dieser einen Prüfung wurde nichts Auffälliges
gefunden. Es bedeutet nicht: Die gesamte Wärmepumpe ist garantiert in Ordnung.

## Begriffe ohne Fachsprache

| Begriff | Bedeutung |
|---------|-----------|
| Verdichter | Kompressor der Wärmepumpe; transportiert Wärme auf ein nutzbares Temperaturniveau. |
| Raumheizung | Wärme für Heizkörper oder Fußbodenheizung. |
| Warmwasser / DHW | Trinkwarmwasser im Speicher. DHW steht für „Domestic Hot Water“. |
| Abtauung | Kurzzeitiger Betriebswechsel, um Eis am Außengerät zu entfernen. |
| 3-Wege-Ventil | Lenkt Heizungswasser entweder zum Haus oder zum Warmwasserspeicher. |
| BUH | Elektrischer Zusatzheizer für den Heizkreis. |
| BSH | Elektrischer Heizstab im Warmwasserspeicher. |
| X10A | Service-Schnittstelle, über die der ESP32 die Wärmepumpe nur ausliest. |

---

## Plain-language guide (English)

The **Plant diagnostics · 24 h** card watches the heat pump without controlling it. Open a row to
see its reading, assessment, normal context and a suggested next step. `OK` applies only to that one
check and only to the observed data; it is not a health certificate for the whole installation.

Open **How to read this card** to see why the diagnosis window was retained or restarted. Ordinary
powered resets can retain it in `.noinit` RAM; a power interruption cannot, because the diagnosis
currently has no flash journal. A firmware change also discards an older window when its counters no
longer have exactly the same meaning. Saved five-minute trend aggregates are separate and cannot
reconstruct the correlated per-second events needed by these checks.

The checks cover the unit's own fault state, hot-water tank cooling, compressor run length, defrost
share, lowest water pressure, lowest steady flow, electric backup-heater runtime and experimental
protection-counter changes. `NOTE` means worth observing, not proven failure; `WARNING` means a
device fault or a sustained documented boundary; `CHECKING` means more evidence is needed;
`MEASURED ONLY` has no universal limit; and `NOT AVAILABLE` means the necessary evidence cannot be
obtained for that check.

For tank cooling, 0.8 K/h is a project heuristic for one reference installation, not a transferable
manufacturer limit. Clean one-hour windows can expose the notable band only up to about 1.85 K/h;
faster continuous loss may look like a draw and be discarded, so neither `OK` nor a blocked check
excludes it. The flow row likewise reports an observed part-load minimum, not the nominal or design
flow from a manual.

For compressor cycling, complete runs are separated into space heating, hot water and cooling when
the signals permit it. Only confirmed space-heating runs are judged by the short-run heuristic;
cooling and hot water are shown but excluded. Unread or mixed runs are shown as unclassified. A NOTE
requires at least twelve confirmed heating runs averaging under ten minutes. Observe several days
before changing settings, and ask an installer to check heat-curve settings, water flow and hydraulic
balance if the pattern persists.

The German sections above contain the complete per-check explanation and recommended next steps.
