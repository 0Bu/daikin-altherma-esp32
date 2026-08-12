# Belege und Grenzen der Anlagendiagnosen

<!-- diagnostic-evidence-contract: d7e9c1b55422a14f596e9e92ad11cf790b2946a336a3ba2019d5b5ea948be2bc -->

Diese Seite beantwortet für jede Zeile der Karte **„Anlagendiagnose · 24 h“** vier Fragen:

1. Welche Tatsache ist extern belegt?
2. Was wertet die Firmware tatsächlich aus?
3. Welche Schwelle stammt nur aus diesem Projekt?
4. Was darf aus dem Ergebnis ausdrücklich **nicht** geschlossen werden?

Damit ist eine Herstellerangabe nicht automatisch ein Grenzwert für jedes Daikin-Modell. Die
genaue Installationsanleitung der eigenen Innen- und Außeneinheit bleibt maßgeblich. Die hier
verlinkten Primärquellen wurden zuletzt am **12. August 2026** geprüft.

## Wie belastbar ist eine Aussage?

| Kennzeichnung | Bedeutung |
|----------------|-----------|
| **Gerätemeldung** | Die Wärmepumpe meldet den Zustand selbst. Die Firmware transportiert und speichert ihn, erfindet aber keine Ursache. |
| **Herstellergrenze** | Eine konkrete Daikin-Anleitung nennt die Grenze. Sie gilt nur für die dort aufgeführten Modelle und Bedingungen. |
| **Beobachtung** | Die Firmware zählt oder misst ein vorhandenes X10A-Signal, ohne daraus gut oder schlecht abzuleiten. |
| **Projekt-Heuristik** | Das Projekt markiert ein Muster vorsichtig als auffällig. Die Schwelle ist kein Daikin-Servicegrenzwert. |
| **Experimentell** | Signalname und Änderung sind beobachtbar, seine vollständige Herstellersemantik ist öffentlich nicht belegt. |

Die Signaladressen stammen aus der durch Protokollanalyse und Live-Mitschnitte validierten
[X10A-Registerkarte](REGISTERS.md). Das ist belastbare Projektevidenz für die **Dekodierung**, aber
keine offizielle Zusage von Daikin, dass X10A eine öffentliche oder über Modellgenerationen stabile
Diagnoseschnittstelle ist.

## Belegmatrix für alle acht Diagnosen

### 1. Störung der Anlage (`fault`)

**Extern belegt:** Daikin beschreibt in der Installateur-Referenz der Altherma 3 R W, dass bei einer
Störung ein Fehlercode mit Kurz- und Langbeschreibung in der Bedienoberfläche erscheint. Kapitel
12.4 enthält die Fehlercode-Tabelle, darunter Kältekreis-, Elektronik- und 7H-Durchflussfehler
([D1], Abschnitt 12.4, gedruckte Seiten 89–90).

**Firmware-Regel:** Die Diagnose liest die von der Anlage gelieferte Fehlerklasse. Ein aktuell
aktiver Fehler wird sofort gemeldet; eine im rollenden Fenster beobachtete, inzwischen beendete
Warnung bleibt als vergangenes Ereignis sichtbar. Implementiert ist das in
[`checkup_evaluate()`](../main/logic/checkup.hpp) im Zweig `Fault`; die Dekodierung der Fehlerklasse
kommt aus [`fault_state.hpp`](../main/logic/fault_state.hpp).

**Nicht bewiesen:** Die Zeile stellt keine eigene Fehlerursache fest und ersetzt nicht die
codespezifische Daikin-Serviceanleitung. Ein nicht lesbares Signal ist nicht gleichbedeutend mit
„kein Fehler“.

### 2. Wärmeverlust Warmwasserspeicher (`dhw_loss`)

**Extern belegt:** Die EU definiert den Bereitschaftsverlust eines Warmwasserspeichers als die bei
festgelegter Wasser- und Umgebungstemperatur abgegebene Wärmeleistung in Watt. Speichervolumen und
Bereitschaftsverlust sind getrennt anzugebende technische Parameter ([E1], Artikel 2(17) und Anhang
III Abschnitt 7). Das belegt, dass Speicherverlust real und messbar ist, aber auch von Prüfbedingung
und Speichergröße abhängt.

**Firmware-Regel:** Ausgewertet werden vollständige, ruhige Ein-Stunden-Fenster des
Speicherfühlers R5T. Laden, interne Pumpenbewegung, eine erkannte Zapfung, unplausible Werte und zu
lange Datenlücken verwerfen das Fenster. Nach einer echten Ladung gelten 45 Minuten Beruhigungszeit.
Ein **HINWEIS** entsteht ab `0,8 K/h`; für ein entwarnendes Ergebnis werden sechs saubere Stunden
innerhalb eines vollständigen 24-Stunden-Lebenszyklus benötigt. Die Regeln stehen als
`DHW_LOSS_*`-Konstanten und im `DhwLoss`-Zweig von
[`checkup.hpp`](../main/logic/checkup.hpp).

**Projektanteil:** `0,8 K/h`, die 45 Minuten Beruhigung, sechs saubere Stunden und der erkennbare
obere Bereich von ungefähr `1,85 K/h` sind **Projekt-Heuristiken**, keine Daikin-Grenzwerte und
keine Umsetzung der EU-Prüfmethode. Ein Temperaturabfall in K/h ist außerdem nicht unmittelbar mit
einem Produktdatenblattwert in W vergleichbar.

**Nicht bewiesen:** Ein auffälliger Abfall beweist weder ein undichtes 3-Wege-Ventil noch schlechte
Dämmung. Zapfung, Schichtung, Schwerkraftzirkulation, Rückschlagventil und externe Zirkulation können
ähnliche Verläufe erzeugen. Auch `OK` schließt einen schnelleren Dauerverlust außerhalb des
erkennbaren Bandes nicht aus.

### 3. Verdichterstarts (`cycling`)

**Extern belegt:** Ein im Auftrag des britischen Department of Energy and Climate Change erstellter
Versuchsbericht untersuchte eine Luft- und eine Sole/Wasser-Wärmepumpe mit festen
Verdichterdrehzahlen. Im untersuchten Aufbau verschlechterten Laufzeiten unter ungefähr sechs
Minuten die Energieeffizienz; der Bericht betont zugleich den Einfluss von Wärmeabgabe,
Wasservolumen, Regelung und Außentemperatur ([R1], Zusammenfassung und Abschnitte 1–2). Das belegt
die Relevanz sehr kurzer Läufe, aber keinen universellen Daikin-Grenzwert.

**Firmware-Regel:** Gezählt werden vollständige Verdichterläufe. Wenn 3-Wege-Ventil und Betriebsart
durchgehend lesbar sind, werden Raumheizung, Warmwasser und Kühlen getrennt; nur bestätigte
Raumheizung entscheidet. Ein **HINWEIS** benötigt mindestens zwölf beurteilbare Läufe mit im Mittel
weniger als zehn Minuten sowie ausreichend vollständige 24-Stunden-Evidenz. Gemischte oder durch
Messlücken unterbrochene Läufe werden zensiert. Die Konstanten heißen
`CHECKUP_CYCLING_MIN_STARTS`, `CHECKUP_CYCLING_SHORT_RUN_S` und
`CHECKUP_CYCLING_CLASSIFIED_PCT` in [`checkup.hpp`](../main/logic/checkup.hpp).

**Projektanteil:** Zwölf Läufe und zehn Minuten sind eine bewusst vorsichtige
**Projekt-Heuristik**. Sie sind weder aus [R1] übernommen noch eine Daikin-Vorgabe. [R1] untersuchte
andere, nicht modulierende Geräte; er stützt nur die allgemeine Aussage, dass kurze Laufzeiten und
Anlagenhydraulik für die Effizienz relevant sein können.

**Nicht bewiesen:** Der Hinweis beweist weder Überdimensionierung noch einen falschen hydraulischen
Abgleich. Ohne Gebäudelast, Wetter, Sollwerte und Wärmeabgabe ist keine eindeutige Ursache möglich.

### 4. Abtauvorgänge (`defrost`)

**Extern belegt:** Daikin führt Abtauung als Betriebsart und eine manuell auslösbare Funktion auf;
bei der Inbetriebnahme muss der Mindestdurchfluss auch während Abtauung und Zusatzheizerbetrieb
gesichert sein ([D1], Abschnitte 8.4.8, 8.4.9 und 9.3–9.4). Experimentelle Forschung zeigt, dass
Vereisung und Abtauverhalten wesentlich von Außenlufttemperatur, relativer Feuchte und
Wärmetauscherzustand abhängen ([R2]).

**Firmware-Regel:** Die Diagnose zählt die steigenden Flanken von `Defrost Operation`. Ein Anteil
wird nur aus Zeiten gebildet, in denen Abtausignal und Verdichterzustand gleichzeitig lesbar waren.
Ein **HINWEIS** erscheint bei mindestens drei so gepaarten Abtauvorgängen und **mehr als 15 %**
Abtauzeit an der gepaarten Verdichterlaufzeit. Implementiert ist das mit
`CHECKUP_DEFROST_MIN_COUNT` und `CHECKUP_DEFROST_SHARE_PCT` in
[`checkup.hpp`](../main/logic/checkup.hpp).

**Projektanteil:** 15 % und drei Ereignisse sind eine breite **Projekt-Heuristik**, keine
Daikin-Grenze. Die Firmware kennt weder Luftfeuchte noch Oberflächen- oder Lamellentemperatur des
Außenwärmetauschers.

**Nicht bewiesen:** Häufiges Abtauen ist bei nasskaltem Wetter nicht automatisch fehlerhaft. Die
Zeile beweist weder einen blockierten Luftweg noch Kältemittelmangel oder einen Sensordefekt.

### 5. Wasserdruck, niedrigster (`pressure`)

**Extern belegt:** Für die in [D1] aufgeführten Altherma-3-R-W-Modelle verlangt Daikin bei der
Fehlersuche einen Pumpeneinlassdruck **über 1 bar** und nennt als Prüfpunkte Drucksensor,
Ausdehnungsgefäß, dessen Ventil und Vordruck ([D1], Abschnitt 12.3.4, gedruckte Seite 87). Mehrere
weitere Altherma-Anleitungen nennen ebenfalls mindestens beziehungsweise mehr als 1 bar; der
zulässige Füll- und Betriebsbereich bleibt trotzdem modellabhängig ([D2], Abschnitt 8.1.3).

**Firmware-Regel:** Angezeigt wird der niedrigste gültige Wert im rollenden Fenster. Bei
`<= 1,0 bar` erscheint sofort ein **HINWEIS**; erst nach 60 Sekunden ununterbrochener
Unterschreitung wird daraus **WARNUNG**. Die Rohmessung wird durch die Bestätigung nicht verändert.
Siehe `CHECKUP_BAR_WARN_TENTHS` und `CHECKUP_PRESSURE_CONFIRM_S` in
[`checkup.hpp`](../main/logic/checkup.hpp).

**Projektanteil:** Die einminütige Bestätigung ist der Störimpulsfilter dieses Projekts. Sie steht
nicht in der Daikin-Anleitung. Die Firmware verwendet 1,0 bar als konservative gemeinsame
Diagnosegrenze, nicht als vollständigen erlaubten Bereich jedes Modells.

**Nicht bewiesen:** Niedriger Druck bestimmt die Ursache nicht. Nachfüllen ohne Prüfung kann ein
Problem mit Ausdehnungsgefäß, Luft oder Wasserverlust verdecken.

### 6. Durchfluss, niedrigster (`flow`)

**Extern belegt:** Der Mindestdurchfluss ist tatsächlich modellabhängig. [D1] nennt für die dort
aufgeführten Altherma-3-R-W-Geräte `12 l/min` und Fehler 7H bei Unterschreitung (Abschnitte 6.4.3,
9.4.1 und 12.4). Eine Altherma 3 H HT F nennt dagegen je nach Variante `25 l/min` oder `22 l/min`
([D2], Abschnitt 8.1.3). Damit wäre ein einziger, firmwareweiter Grenzwert sachlich falsch.

**Firmware-Regel:** Die Diagnose meldet ausschließlich den niedrigsten gültigen Durchfluss,
nachdem die interne Pumpe mindestens 60 Sekunden ununterbrochen gelaufen ist. Sie vergibt dafür
keinen Gut-/Schlecht-Befund. Siehe `CHECKUP_FLOW_RUNUP_S` und den Zweig `Flow` in
[`checkup.hpp`](../main/logic/checkup.hpp).

**Projektanteil:** Die 60 Sekunden sind ein Messfilter gegen Anlauf, Ventilbewegung und Entlüftung;
kein Herstellergrenzwert.

**Nicht bewiesen:** Das beobachtete Teillast-Minimum ist nicht automatisch der in einer
Inbetriebnahmeprüfung verlangte Auslegungsdurchfluss. Ein Vergleich ist nur mit der Anleitung der
genauen Modellkombination und derselben Betriebsbedingung zulässig.

### 7. Zusatzheizer (`heater`)

**Extern belegt:** Daikin beschreibt mehrere legitime Einsatzgründe: Der Booster Heater kann je
nach Konfiguration bei Warmwasserbereitung, Desinfektion oder außerhalb des
Wärmepumpen-Betriebsbereichs laufen; bei Wärmepumpenausfall können Backup und/oder Booster Heater
die Last im Notbetrieb übernehmen ([D1], Abschnitte 8.4.6 und 8.4.9, gedruckte Seiten 66 und
71–72). Die Dokumentation verlangt außerdem ausreichenden Durchfluss während Backup-Heater- und
Abtaubetrieb ([D1], Abschnitt 9.3).

**Firmware-Regel:** Die aktiven Sekunden von BUH Schritt 1/2 für den Heizkreis und BSH für den
Warmwasserspeicher werden getrennt summiert. Die Zeile bleibt **NUR MESSWERT**, weil es ohne Wetter,
Konfiguration, Sollwerte und Betriebsgrund keine allgemeine erlaubte Laufzeit gibt. Siehe den Zweig
`Heater` in [`checkup.hpp`](../main/logic/checkup.hpp).

**Nicht bewiesen:** Laufzeit allein beweist weder einen Defekt noch unnötigen Stromverbrauch. Für
eine energetische Aussage fehlen insbesondere elektrische Leistung und die vom Heizer abgegebene
Wärme.

### 8. Schutz-Rückregelungen (`retries`)

**Extern belegt:** Die Projekt-Registerkarte enthält fünf getrennte X10A-Zähler für
Heißgastemperatur, Verdichter-Inverterstrom, Hochdruck, Niederdruck und Inverter-Lamellentemperatur
([Register 0x10](REGISTERS.md#register-0x10)). Daikin dokumentiert zugehörige Fehler- und
Schutzklassen wie Hochdruck, Verdichterüberhitzung und Inverterüberstrom in der Fehlercode-Tabelle
([D1], Abschnitt 12.4).

**Firmware-Regel:** Ein Ereignis wird nur gemeldet, wenn derselbe exakte Zähler zwischen zwei
vergleichbaren, beobachteten Werten **ansteigt**. Ein bereits beim Start ungleich null stehender
Zähler reicht nicht. Alle fünf Zähler und ein lesbarer Verdichterzustand werden benötigt. Siehe
`checkup_retry_index()`, `CHECKUP_RETRY_COUNT` und den Zweig `Retries` in
[`checkup.hpp`](../main/logic/checkup.hpp).

**Experimentelle Grenze:** Für diese fünf internen X10A-Zähler wurde in den öffentlich verfügbaren
Daikin-Unterlagen keine vollständige Semantik gefunden: weder Rücksetzverhalten noch garantierte
Zählweise oder kausale Zuordnung sind veröffentlicht. Deshalb kann die Dokumentation hier bewusst
keine Herstellergrenze nennen, und die UI kennzeichnet die Zeile als **EXPERIMENTELL**.

**Nicht bewiesen:** Ein Anstieg ist kein bestimmter Fehler und ein stabiler Zähler beweist nicht,
dass keine Schutzregelung stattfand. Für eine Ursache müssen Zeitpunkt, Betriebszustand und
offizieller Fehlercode gemeinsam betrachtet werden.

## Quellen

### Herstellerunterlagen

<a id="source-d1"></a>

- **[D1]** Daikin, *Daikin Altherma 3 R W – Installer reference guide*, Modelle
  ERGA04–08DAV3(A) + EHBH/X04+08DA, Dokument **4P496758-1B**, Revision 2019-10:
  [offizielle PDF][D1-pdf]. Verwendete Stellen: 6.4.3 Wasserinhalt/Durchfluss; 8.4.6 Tank;
  8.4.8 Information; 8.4.9 Installateureinstellungen; 9.3–9.4 Inbetriebnahme; 12.3.4 Pumpengeräusch;
  12.4 Fehlercodes.

<a id="source-d2"></a>

- **[D2]** Daikin, *Daikin Altherma 3 H HT F – Installer reference guide*, Modelle
  EPRA14–18D + ETVH16SU18+23E, Dokument **4P644738-1D**, Revision 2023-10:
  [offizielle PDF][D2-pdf]. Verwendete Stelle: 8.1.3 Wasserleitungen; Mindestdruck 1 bar und
  modellabhängiger Mindestdurchfluss 25 beziehungsweise 22 l/min.

### Vorschrift und Forschung

<a id="source-e1"></a>

- **[E1]** Europäische Kommission, Verordnung (EU) Nr. 814/2013 über Ökodesign-Anforderungen an
  Warmwasserbereiter und Warmwasserspeicher: [amtlicher EUR-Lex-Text][E1-web]. Verwendete Stellen:
  Artikel 2(17), Anhang II Abschnitt 2 und Anhang III Abschnitt 7.

<a id="source-r1"></a>

- **[R1]** Robert Green / EA Technology für DECC, *The Effects of Cycling on Heat Pump Performance*,
  Projekt 46640, November 2012: [amtliche Veröffentlichungsseite][R1-web] und
  [Versuchsbericht][R1-pdf]. Die Ergebnisse gelten für die untersuchten Geräte und begründen **nicht**
  die Zehn-Minuten-Schwelle dieses Projekts.

<a id="source-r2"></a>

- **[R2]** Y.-G. Chen und X.-M. Guo, *Dynamic defrosting characteristics of air source heat pump and
  effects of outdoor air parameters on defrost cycle performance*, Applied Thermal Engineering 29
  (2009), 2701–2707, DOI 10.1016/j.applthermaleng.2009.01.003:
  [Verlagsseite und Abstract][R2-doi]. Die Studie belegt die Abhängigkeit von Außenbedingungen,
  nicht die 15-Prozent-Heuristik dieses Projekts.

## Pflege-Regel

Eine Diagnoseänderung ist dokumentarisch erst vollständig, wenn diese Seite weiterhin für jede
betroffene Zeile Beobachtung, externe Grundlage, Projektanteil und Aussagegrenze nennt. Ein neuer
Schwellwert darf nur **Herstellergrenze** heißen, wenn eine genaue, zur Modellfamilie passende
Primärquelle mit Dokumentnummer, Revision und Abschnitt angegeben ist. Andernfalls bleibt er klar
als Beobachtung, Projekt-Heuristik oder experimentell bezeichnet.

Das CI-Gate `scripts/run-diagnostic-evidence-audit.sh` bindet diese Aussagen an die aktuelle
Diagnose-Implementierung, die sichtbaren Diagnose-IDs, die fünf Schutz-Zähler und die zugehörige
Projektevidenz in `docs/REGISTERS.md`. Es prüft außerdem die vollständige Belegmatrix,
Quellenverweise, HTTPS-Auflösung und bei Daikin-Unterlagen Modell, Dokumentnummer, Revision und
verwendete Stelle. Ändert sich eine dieser Grundlagen oder diese Seite selbst, meldet es `E010`.
Erst nach inhaltlicher Prüfung mit `/diagnostic-evidence-review` darf der Fingerabdruck erneuert
werden:

```bash
scripts/run-diagnostic-evidence-audit.sh --update
scripts/run-diagnostic-evidence-audit.sh
tools/diagnostic_evidence/selftest.sh
```

Der Fingerabdruck belegt, dass Code, Aussagen und Katalog gemeinsam geprüft wurden. Er beweist nicht
automatisch, dass eine Quelle fachlich passt; diese Prüfung bleibt der menschliche Teil des Gates.

[D1]: #source-d1
[D2]: #source-d2
[E1]: #source-e1
[R1]: #source-r1
[R2]: #source-r2
[D1-pdf]: https://my.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/EHBH-D6V%2C%20EHBH-D9W%2C%20EHBX-D6V%2C%20EHBX-D9W%2C%20ERGA04-08DV%2C%20ERGA04-08DVA_4PEN496758-1B_2019_10_Installer%20reference%20guide_English.pdf
[D2-pdf]: https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/air-to-water-heat-pump-high-temperature/epra14-18dw7/EPRA014-018D%28V.W%29.EPRA14-18D%28V.W%297.ETVH16UE6V%287%29_Installer%20reference%20guide_4PEN644738-1D_English.pdf
[E1-web]: https://eur-lex.europa.eu/eli/reg/2013/814/oj/deu
[R1-web]: https://www.gov.uk/government/publications/heat-pump-performance-effects-of-cycling
[R1-pdf]: https://assets.publishing.service.gov.uk/media/5a78e0d9e5274a2acd18a7c6/7389-effects-cycling-heat-pump-performance.pdf
[R2-doi]: https://doi.org/10.1016/j.applthermaleng.2009.01.003
